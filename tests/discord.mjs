// Discord 審核機器人：整個流程跑一遍（不用瀏覽器）
// 用假的 Supabase（PostgREST）、假的 Discord API、假的 BingX，直接呼叫 server/discord/interactions.js
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import handler from "../server/discord/interactions.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readJson = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(b ? JSON.parse(b) : null); } catch { r(null); } }); });

// ── 假的 Supabase：只做這個流程會用到的 select / insert / update / upsert ──
const db = { discord_applications: [], settings: [] };
let nextId = 1;
const filtersOf = (sp) => [...sp].filter(([k]) => !["select", "order", "limit", "on_conflict"].includes(k)).map(([col, v]) => {
  const [op, ...rest] = v.split(".");
  return { col, op, val: rest.join(".") };
});
const match = (row, fs) => fs.every(({ col, op, val }) => (op === "eq" ? String(row[col]) === val : op === "neq" ? String(row[col]) !== val : true));
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const table = u.pathname.split("/").pop();
  const rows = db[table];
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? data[0] ?? null : data)); };
  if (!rows) return send([], 404);
  const fs = filtersOf(u.searchParams);
  if (req.method === "GET") {
    let out = rows.filter((r) => match(r, fs));
    const lim = Number(u.searchParams.get("limit")); if (lim) out = out.slice(0, lim);
    return send(out);
  }
  const body = await readJson(req);
  if (req.method === "POST") {
    const items = Array.isArray(body) ? body : [body];
    const out = [];
    for (const it of items) {
      if (table === "settings") {
        const i = rows.findIndex((r) => r.key === it.key);
        if (i >= 0) rows[i] = { ...rows[i], ...it }; else rows.push(it);
        out.push(it); continue;
      }
      const row = { id: nextId++, status: "pending", auto: false, reviewed_by: null, review_message_id: null, note: null, created_at: new Date().toISOString(), reviewed_at: null, ...it };
      if (row.status === "approved" && rows.some((r) => r.status === "approved" && r.exchange === row.exchange && r.exchange_uid === row.exchange_uid)) {
        res.writeHead(409, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ code: "23505", message: "duplicate" }));
      }
      rows.push(row); out.push(row);
    }
    return send(out, 201);
  }
  if (req.method === "PATCH") {
    const out = rows.filter((r) => match(r, fs));
    for (const r of out) Object.assign(r, body);
    return send(out);
  }
  send([], 405);
});

// ── 假的 Discord API ──
const calls = [];
let roleFail = false;
const disc = http.createServer(async (req, res) => {
  const body = await readJson(req);
  calls.push({ method: req.method, path: req.url, body, auth: req.headers.authorization });
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };
  if (req.method === "PUT" && /\/roles\//.test(req.url)) {
    if (roleFail) return send({ message: "Missing Permissions", code: 50013 }, 403);
    res.writeHead(204); return res.end();
  }
  if (req.method === "POST" && req.url === "/users/@me/channels") return send({ id: "dm-" + body.recipient_id });
  if (req.method === "POST" && /\/channels\/\d+\/messages/.test(req.url)) return send({ id: "900000000000000001" });
  if (req.method === "PATCH") return send({ id: "x" });
  send({ message: "?" }, 404);
});

// ── 假的 BingX：88880001 是 CCC 邀請的 ──
const bingx = http.createServer((req, res) => {
  const uid = new URL(req.url, "http://x").searchParams.get("uid");
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ code: 0, data: { uid: Number(uid), inviteResult: uid === "88880001", directInvitation: true } }));
});

const [SUPA, DISC, BX] = await Promise.all([listen(supa), listen(disc), listen(bingx)]);

// 金鑰（Discord 用 Ed25519 簽名）
const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const pubHex = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("hex");
// Node 20 沒有全域 WebSocket，Supabase 的即時連線會抱怨；這個測試用不到即時連線
if (!globalThis.WebSocket) globalThis.WebSocket = class {};
setEnv({
  SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test",
  DISCORD_APP_ID: "111111111111111111", DISCORD_PUBLIC_KEY: pubHex, DISCORD_BOT_TOKEN: "bot-token", DISCORD_API_BASE: DISC,
  BINGX_API_KEY: "k", BINGX_SECRET_KEY: "s", BINGX_BASE_URL: BX,
});
const ROLE = "1560542923173400596", GUILD = "222222222222222222", REVIEW = "333333333333333333";
db.settings.push({ key: "discord", value: { roleId: ROLE, panelChannelId: "444444444444444444", reviewChannelId: REVIEW, invites: { BingX: "https://bingx.com/invite/CCC" } } });

// 送一個 Discord 互動進去
const ADMIN_PERMS = String(1n << 28n);
async function interact(payload, { badSig = false } = {}) {
  const raw = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  let sig = Buffer.from(await crypto.subtle.sign("Ed25519", kp.privateKey, new TextEncoder().encode(ts + raw))).toString("hex");
  if (badSig) sig = sig.replace(/^./, (c) => (c === "a" ? "b" : "a"));
  const pending = [];
  const res = { statusCode: 200, body: null, headersSent: false, headers: {} };
  res.status = (c) => ((res.statusCode = c), res);
  res.setHeader = (k, v) => ((res.headers[k] = v), res);
  res.json = (d) => ((res.body = d), (res.headersSent = true), res);
  await handler({ method: "POST", headers: { "x-signature-ed25519": sig, "x-signature-timestamp": ts }, rawBody: raw, body: payload, waitUntil: (p) => pending.push(p) }, res);
  await Promise.all(pending);
  return res;
}
const member = (id, { roles = [], perms = "0", name = "user" + id.slice(-2) } = {}) => ({ user: { id, username: name, global_name: name }, roles, permissions: perms });
const button = (custom_id, m) => ({ type: 3, guild_id: GUILD, token: "tok", member: m, data: { custom_id, component_type: 2 } });
const modal = (ex, uid, m) => ({ type: 5, guild_id: GUILD, token: "tok-" + uid, member: m, data: { custom_id: `apply_uid:${ex}`, components: [{ type: 1, components: [{ type: 4, custom_id: "uid", value: uid }] }] } });
const lastEdit = () => [...calls].reverse().find((c) => c.method === "PATCH" && c.path.includes("/webhooks/"));
const AMY = "500000000000000001", BOB = "500000000000000002", CAT = "500000000000000003", DAN = "500000000000000004", BOSS = "500000000000000009";

await test("簽名不對就擋掉", async () => assert.equal((await interact({ type: 1 }, { badSig: true })).statusCode, 401));
await test("Discord 驗證網址時的 PING", async () => assert.deepEqual((await interact({ type: 1 })).body, { type: 1 }));

await test("按「申請」→ 選交易所（只有自己看得到）", async () => {
  const r = (await interact(button("apply", member(AMY)))).body;
  assert.equal(r.type, 4); assert.equal(r.data.flags, 64);
  assert.deepEqual(r.data.components[0].components[0].options.map((o) => o.value), ["OKX", "UM", "Bybit", "BingX"]);
});
await test("已經有身分組的人不用再申請", async () => {
  const r = (await interact(button("apply", member(AMY, { roles: [ROLE] })))).body;
  assert.match(r.data.content, /已經有實驗室的身分組/);
});
await test("選 BingX → 跳出填 UID 的表單", async () => {
  const r = (await interact({ ...button("apply_ex", member(AMY)), data: { custom_id: "apply_ex", values: ["BingX"] } })).body;
  assert.equal(r.type, 9); assert.equal(r.data.custom_id, "apply_uid:BingX");
});
await test("UID 不是數字會提醒", async () => assert.match((await interact(modal("BingX", "abc", member(AMY)))).body.data.content, /一串數字/));

await test("BingX 是 CCC 邀請的 → 自動給身分組", async () => {
  const r = await interact(modal("BingX", "8888 0001", member(AMY)));
  assert.equal(r.body.type, 5);
  const put = calls.find((c) => c.method === "PUT");
  assert.equal(put.path, `/guilds/${GUILD}/members/${AMY}/roles/${ROLE}`);
  assert.equal(put.auth, "Bot bot-token");
  assert.match(lastEdit().body.content, /審核通過/);
  const row = db.discord_applications.find((a) => a.discord_user_id === AMY);
  assert.equal(row.status, "approved"); assert.equal(row.auto, true); assert.equal(row.exchange_uid, "88880001");
});
await test("同一個 UID 不能給第二個人用", async () => assert.match((await interact(modal("BingX", "88880001", member(BOB)))).body.data.content, /已經被其他人/));
await test("BingX 不是 CCC 邀請的 → 不給，附邀請連結", async () => {
  await interact(modal("BingX", "12345678", member(BOB)));
  assert.match(lastEdit().body.content, /不是用 CCC 的 BingX 邀請連結/);
  assert.match(lastEdit().body.content, /bingx\.com\/invite\/CCC/);
  assert.equal(db.discord_applications.find((a) => a.discord_user_id === BOB).status, "rejected");
});

let okxId;
await test("OKX → 送到審核頻道等管理員", async () => {
  const before = calls.length;
  await interact(modal("OKX", "123456789012345678", member(CAT)));
  const post = calls.slice(before).find((c) => c.method === "POST" && c.path === `/channels/${REVIEW}/messages`);
  assert.ok(post, "沒有送到審核頻道");
  assert.match(post.body.content, /123456789012345678/);
  okxId = db.discord_applications.find((a) => a.discord_user_id === CAT).id;
  assert.deepEqual(post.body.components[0].components.map((b) => b.custom_id), [`approve:${okxId}`, `reject:${okxId}`]);
  assert.match(lastEdit().body.content, /已經送出申請/);
  assert.equal(db.discord_applications.find((a) => a.id === okxId).review_message_id, "900000000000000001");
});
await test("審核中不能再送一次", async () => assert.match((await interact(modal("UM", "556677", member(CAT)))).body.data.content, /審核中/));
await test("不是管理員按不了通過", async () => assert.match((await interact(button(`approve:${okxId}`, member(DAN)))).body.data.content, /只有管理員/));
await test("管理員按通過 → 給身分組、更新訊息、私訊通知", async () => {
  const before = calls.length;
  const r = (await interact(button(`approve:${okxId}`, member(BOSS, { perms: ADMIN_PERMS, name: "CCC" })))).body;
  assert.equal(r.type, 7); assert.match(r.data.content, /已通過/); assert.match(r.data.content, /審核：CCC/); assert.deepEqual(r.data.components, []);
  assert.ok(calls.slice(before).some((c) => c.method === "PUT" && c.path.endsWith(`/members/${CAT}/roles/${ROLE}`)));
  assert.ok(calls.slice(before).some((c) => c.path === `/channels/dm-${CAT}/messages` && /審核通過/.test(c.body.content)));
  assert.equal(db.discord_applications.find((a) => a.id === okxId).status, "approved");
});
await test("重複按通過不會再給一次", async () => {
  const before = calls.length;
  const r = (await interact(button(`approve:${okxId}`, member(BOSS, { perms: ADMIN_PERMS })))).body;
  assert.equal(r.type, 7);
  assert.ok(!calls.slice(before).some((c) => c.method === "PUT"));
});
await test("UM 不通過 → 更新訊息、私訊原因", async () => {
  await interact(modal("UM", "556677", member(DAN)));
  const id = db.discord_applications.find((a) => a.discord_user_id === DAN).id;
  const before = calls.length;
  const r = (await interact(button(`reject:${id}`, member(BOSS, { perms: ADMIN_PERMS })))).body;
  assert.match(r.data.content, /不通過/);
  assert.ok(calls.slice(before).some((c) => c.path === `/channels/dm-${DAN}/messages` && /沒有通過/.test(c.body.content)));
  assert.ok(!calls.slice(before).some((c) => c.method === "PUT"));
});
await test("機器人給不了身分組（權限不夠）→ 轉人工審核並寫原因", async () => {
  roleFail = true;
  db.discord_applications = db.discord_applications.filter((a) => a.exchange_uid !== "88880001");
  const before = calls.length;
  await interact(modal("BingX", "88880001", member("500000000000000005")));
  roleFail = false;
  const post = calls.slice(before).find((c) => c.path === `/channels/${REVIEW}/messages`);
  assert.ok(post); assert.match(post.body.content, /給身分組失敗/);
  assert.match(lastEdit().body.content, /已經送出申請/);
});
await test("管理員按通過但機器人權限不夠 → 告訴管理員怎麼修", async () => {
  const id = db.discord_applications.find((a) => a.discord_user_id === "500000000000000005").id;
  roleFail = true;
  const r = (await interact(button(`approve:${id}`, member(BOSS, { perms: ADMIN_PERMS })))).body;
  roleFail = false;
  assert.equal(r.type, 4); assert.match(r.data.content, /管理身分組/);
  assert.equal(db.discord_applications.find((a) => a.id === id).status, "pending");
});

supa.close(); disc.close(); bingx.close();
console.log(`\nDiscord 機器人：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
