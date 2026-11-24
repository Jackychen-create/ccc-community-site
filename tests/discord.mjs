// Discord 審核機器人：整個流程跑一遍（不用瀏覽器）
// 用假的 Supabase（PostgREST）、假的 Discord API、假的 BingX，直接呼叫 server/discord/interactions.js
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import handler, { CLOSE_DELAY_MS } from "../server/discord/interactions.js";
import { closeSupport, resyncSupportTickets, SUPPORT_COOLDOWN_MS } from "../server/lib/discord-support.js";
import { setupWiki, syncWikiPanel, searchTerms, canView, GLOSSARY } from "../server/lib/discord-wiki.js";
import { setupGuild, BOT_PERMISSIONS, inviteUrl, syncPanelMessage } from "../server/lib/discord-setup.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readJson = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(b ? JSON.parse(b) : null); } catch { r(null); } }); });

// ── 假的 Supabase：只做這個流程會用到的 select / insert / update / upsert ──
const db = { discord_applications: [], settings: [], discord_tickets: [], invite_codes: [] };
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
      if (table === "discord_tickets" && rows.some((r) => r.status === "open" && r.discord_user_id === it.discord_user_id && (r.kind || "apply") === (it.kind || "apply"))) {
        res.writeHead(409, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ code: "23505", message: "duplicate" }));
      }
      if (table === "discord_tickets" || table === "invite_codes") { const row = { status: "open", used_count: 0, ...(table === "discord_tickets" ? { kind: "apply", no: rows.length + 1, created_at: new Date().toISOString() } : {}), ...it }; rows.push(row); out.push(row); continue; }
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
const GUILD_ID = "222222222222222222";
const channels = new Map();
let chanSeq = 0, botRolePos = 3, msgSeq = 0;
let roleFail = false;
// 頻道導覽用：一般分類、只有研究員看得到的分類、私人客服分類
const VIEW_BIT = String(1n << 10n);
const guildChannels = [
  { id: "700000000000000001", type: 4, name: "📌 新手報到", position: 0, permission_overwrites: [] },
  { id: "700000000000000002", type: 0, name: "📜規則", position: 0, parent_id: "700000000000000001", topic: "先看這裡\n第二行不要", permission_overwrites: [] },
  { id: "700000000000000003", type: 4, name: "🧪 研究員專區", position: 1, permission_overwrites: [{ id: GUILD_ID, type: 0, allow: "0", deny: VIEW_BIT }, { id: "1560542923173400596", type: 0, allow: VIEW_BIT, deny: "0" }] },
  { id: "700000000000000004", type: 0, name: "💬研究員聊天", position: 0, parent_id: "700000000000000003", permission_overwrites: [{ id: GUILD_ID, type: 0, allow: "0", deny: VIEW_BIT }, { id: "1560542923173400596", type: 0, allow: VIEW_BIT, deny: "0" }] },
  { id: "700000000000000005", type: 2, name: "🎙️語音", position: 1, parent_id: "700000000000000001", permission_overwrites: [] },
  { id: "700000000000000006", type: 4, name: "🎫 客服單", position: 2, permission_overwrites: [] },
  { id: "700000000000000007", type: 0, name: "客服-Eve", position: 0, parent_id: "700000000000000006", permission_overwrites: [] },
];
const disc = http.createServer(async (req, res) => {
  const body = await readJson(req);
  calls.push({ method: req.method, path: req.url, body, auth: req.headers.authorization });
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };
  if (req.method === "PUT" && /\/roles\//.test(req.url)) {
    if (roleFail) return send({ message: "Missing Permissions", code: 50013 }, 403);
    res.writeHead(204); return res.end();
  }
  if (req.method === "POST" && req.url === "/users/@me/channels") return send({ id: "dm-" + body.recipient_id });
  if (req.method === "GET" && /\/channels\/\d+\/messages\?/.test(req.url)) return send(req.url.includes("before=") ? [] : [{ id: "1", timestamp: "2026-10-22T01:00:00Z", author: { id: "500000000000000005", global_name: "Eve" }, content: "我的交易量沒更新" }, { id: "2", timestamp: "2026-10-22T01:05:00Z", author: { id: "500000000000000009", global_name: "boss" }, content: "幫你補好了" }]);
  if (req.method === "POST" && /\/channels\/[\w-]+\/messages$/.test(req.url) && req.headers["content-type"]?.startsWith("multipart/")) return send({ id: "920000000000000001" });
  if (req.method === "POST" && /\/channels\/\d+\/messages/.test(req.url)) return send({ id: String(900000000000000000n + BigInt(++msgSeq)) });
  if (req.method === "DELETE" && /^\/channels\/\d+$/.test(req.url)) { channels.delete(req.url.split("/")[2]); return send({}); }
  if (req.method === "PATCH" && req.url.includes("/webhooks/")) return send({ id: "910000000000000001" });
  // 一鍵建立用
  if (req.method === "GET" && req.url === "/users/@me/guilds") return send([{ id: GUILD_ID, name: "CCC 交易實驗室" }]);
  if (req.method === "GET" && req.url === `/guilds/${GUILD_ID}`) return send({ id: GUILD_ID, name: "CCC 交易實驗室" });
  if (req.method === "GET" && req.url === `/guilds/${GUILD_ID}/channels`) return send(guildChannels);
  if (req.method === "GET" && req.url === `/guilds/${GUILD_ID}/roles`) return send([{ id: GUILD_ID, name: "@everyone", position: 0, permissions: VIEW_BIT }, { id: "1560542923173400596", name: "實驗室研究員", position: 5 }, { id: "777", name: "CCC 小幫手", position: botRolePos }]);
  if (req.method === "GET" && /\/members\/111111111111111111$/.test(req.url)) return send({ roles: ["777"] });
  if (req.method === "POST" && req.url === `/guilds/${GUILD_ID}/channels`) { const id = String(800000000000000000n + BigInt(++chanSeq)); channels.set(id, body); return send({ id, ...body }); }
  if (req.method === "GET" && /^\/channels\/\d+$/.test(req.url)) { const id = req.url.split("/")[2]; return channels.has(id) ? send({ id, ...channels.get(id) }) : send({ message: "Unknown Channel", code: 10003 }, 404); }
  if (req.method === "PATCH" && /^\/channels\/\d+$/.test(req.url)) return send({ id: req.url.split("/")[2] });
  if (req.method === "PUT" && /\/pins\//.test(req.url)) { res.writeHead(204); return res.end(); }
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

CLOSE_DELAY_MS.value = 0;
const PANEL = "444444444444444444";
const ticketOfUser = (uid) => db.discord_tickets.find((t) => t.discord_user_id === uid && t.status === "open");
const at = (chan, p) => ({ ...p, channel_id: chan });
// 按「申請」開頻道，回傳頻道 ID
async function openFor(m) {
  const r = await interact(at(PANEL, button("apply", m)));
  assert.equal(r.body.type, 5); assert.equal(r.body.data.flags, 64);
  return ticketOfUser(m.user.id)?.channel_id;
}
const postsTo = (chan, from = 0) => calls.slice(from).filter((c) => c.method === "POST" && c.path === `/channels/${chan}/messages`);

let amyChan;
await test("按「申請」→ 開一個只有他和管理員看得到的申請頻道", async () => {
  const before = calls.length;
  amyChan = await openFor(member(AMY, { name: "Amy 小美" }));
  assert.ok(amyChan, "沒有記下申請頻道");
  const ch = channels.get(amyChan);
  assert.equal(ch.type, 0); assert.match(ch.name, /^報名-Amy-小美$/);
  const everyone = ch.permission_overwrites.find((o) => o.id === GUILD);
  assert.ok(BigInt(everyone.deny) & (1n << 10n), "everyone 要看不到");
  const me = ch.permission_overwrites.find((o) => o.id === AMY);
  assert.equal(me.type, 1); assert.ok(BigInt(me.allow) & (1n << 10n) && BigInt(me.allow) & (1n << 11n), "申請人要看得到、能發言");
  const cat = channels.get(ch.parent_id);
  assert.equal(cat.name, "🎫 培訓計畫報名"); assert.equal(cat.type, 4);
  assert.equal(db.settings.find((r) => r.key === "discord").value.ticketCategoryId, ch.parent_id);
  const welcome = postsTo(amyChan, before)[0];
  assert.ok(welcome, "沒有歡迎訊息"); assert.match(welcome.body.content, new RegExp(`<@${AMY}>`));
  assert.equal(welcome.body.components[0].components[0].custom_id, "apply_ex");
  assert.deepEqual(welcome.body.components[0].components[0].options.map((o) => o.value), ["OKX", "Bybit", "BingX"]);
  assert.match(lastEdit().body.content, new RegExp(`<#${amyChan}>`));
});
await test("再按一次不會開第二個，給原本的頻道連結", async () => {
  const n = channels.size;
  await openFor(member(AMY));
  assert.equal(channels.size, n);
  assert.match(lastEdit().body.content, /已經有一個報名頻道/);
});
await test("頻道被手動刪掉了 → 再按會重開一個", async () => {
  channels.delete(amyChan);
  const again = await openFor(member(AMY));
  assert.notEqual(again, amyChan);
  assert.equal(db.discord_tickets.find((t) => t.channel_id === amyChan).status, "closed");
  amyChan = again;
});
await test("已經有身分組的人不用再申請", async () => {
  const r = (await interact(at(PANEL, button("apply", member(AMY, { roles: [ROLE] }))))).body;
  assert.match(r.data.content, /已經加入培訓計畫/);
});
await test("在申請頻道選 BingX → 跳出填 UID 的表單", async () => {
  const r = (await interact(at(amyChan, { ...button("apply_ex", member(AMY)), data: { custom_id: "apply_ex", values: ["BingX"] } }))).body;
  assert.equal(r.type, 9); assert.equal(r.data.custom_id, "apply_uid:BingX");
});
await test("別人不能在你的申請頻道操作", async () => {
  const r = (await interact(at(amyChan, { ...button("apply_ex", member(BOB)), data: { custom_id: "apply_ex", values: ["BingX"] } }))).body;
  assert.match(r.data.content, /別人的報名頻道/);
  assert.match((await interact(at(amyChan, modal("BingX", "88880001", member(BOB))))).body.data.content, /別人的報名頻道/);
});
await test("不在申請頻道裡送 UID 會請他先開頻道", async () => assert.match((await interact(at(PANEL, modal("BingX", "88880001", member(AMY))))).body.data.content, /先到報名頻道/));
await test("UID 不是數字會提醒", async () => assert.match((await interact(at(amyChan, modal("BingX", "abc", member(AMY))))).body.data.content, /一串數字/));
await test("UM 撤掉了：選 UM、送 UM 的表單都不收", async () => {
  const r = (await interact(at(amyChan, { ...button("apply_ex", member(AMY)), data: { custom_id: "apply_ex", values: ["UM"] } }))).body;
  assert.match(r.data.content, /重新選一次交易所/);
  assert.match((await interact(at(amyChan, modal("UM", "35908033", member(AMY))))).body.data.content, /重新選一次交易所/);
});
await test("報名頻道的訊息沒有 UM", async () => {
  const { panelMessage } = await import("../server/lib/discord-flow.js");
  const p = panelMessage({ OKX: "https://okx.com/join/CCC", UM: "https://ultgo.com/x" });
  assert.ok(!/UM/.test(p.content), p.content);
  assert.deepEqual(p.components[1].components.map((b) => b.label), ["OKX 註冊"]);
});

await test("BingX 是 CCC 邀請的 → 自動給身分組，在頻道裡給專用實驗室密碼", async () => {
  const before = calls.length;
  const r = await interact(at(amyChan, modal("BingX", "8888 0001", member(AMY))));
  assert.equal(r.body.type, 5); assert.equal(r.body.data, undefined, "結果要留在頻道裡，大家看得到");
  const put = calls.slice(before).find((c) => c.method === "PUT");
  assert.equal(put.path, `/guilds/${GUILD}/members/${AMY}/roles/${ROLE}`);
  assert.equal(put.auth, "Bot bot-token");
  const row = db.discord_applications.find((a) => a.discord_user_id === AMY);
  assert.equal(row.status, "approved"); assert.equal(row.auto, true); assert.equal(row.exchange_uid, "88880001"); assert.equal(row.channel_id, amyChan);
  const inv = db.invite_codes.at(-1);
  assert.equal(inv.max_uses, 1); assert.match(inv.note, /BingX 88880001/); assert.equal(row.invite_code, inv.code);
  const msg = lastEdit().body.content;
  assert.match(msg, /審核通過/); assert.ok(msg.includes(inv.code)); assert.ok(msg.includes(`invite=${inv.code}`));
  assert.equal(lastEdit().body.components[0].components[0].custom_id, "close_ticket");
  assert.ok(calls.slice(before).some((c) => c.path === `/channels/dm-${AMY}/messages` && c.body.content.includes(inv.code)), "要私訊一份實驗室密碼");
});
let bobChan;
await test("同一個 UID 不能給第二個人用", async () => {
  bobChan = await openFor(member(BOB));
  assert.match((await interact(at(bobChan, modal("BingX", "88880001", member(BOB))))).body.data.content, /已經被其他人/);
});
await test("BingX 不是 CCC 邀請的 → 不給，附邀請連結，可以重選", async () => {
  await interact(at(bobChan, modal("BingX", "12345678", member(BOB))));
  const e = lastEdit().body;
  assert.match(e.content, /不是用 CCC 的 BingX 邀請連結/);
  assert.match(e.content, /bingx\.com\/invite\/CCC/);
  assert.equal(e.components[0].components[0].custom_id, "apply_ex");
  assert.equal(db.discord_applications.find((a) => a.discord_user_id === BOB).status, "rejected");
});

let okxId, catChan;
await test("OKX → 在申請頻道等管理員，審核頻道收到通知", async () => {
  catChan = await openFor(member(CAT));
  const before = calls.length;
  await interact(at(catChan, modal("OKX", "123456789012345678", member(CAT))));
  okxId = db.discord_applications.find((a) => a.discord_user_id === CAT).id;
  const e = lastEdit().body;
  assert.match(e.content, /123456789012345678/); assert.match(e.content, /等待管理員審核/);
  assert.deepEqual(e.components[0].components.map((b) => b.custom_id), [`approve:${okxId}`, `reject:${okxId}`]);
  assert.equal(db.discord_applications.find((a) => a.id === okxId).review_message_id, "910000000000000001");
  const notice = postsTo(REVIEW, before)[0];
  assert.ok(notice, "審核頻道沒有通知"); assert.ok(notice.body.content.includes(`<#${catChan}>`));
});
await test("審核中不能再送一次", async () => assert.match((await interact(at(catChan, modal("OKX", "556677", member(CAT))))).body.data.content, /審核中/));
await test("不是管理員按不了通過", async () => assert.match((await interact(at(catChan, button(`approve:${okxId}`, member(DAN))))).body.data.content, /只有管理員/));
await test("管理員按通過 → 給身分組、更新訊息、頻道裡給實驗室密碼", async () => {
  const before = calls.length;
  const r = (await interact(at(catChan, button(`approve:${okxId}`, member(BOSS, { perms: ADMIN_PERMS, name: "CCC" }))))).body;
  assert.equal(r.type, 7); assert.match(r.data.content, /已通過/); assert.match(r.data.content, /審核：CCC/); assert.deepEqual(r.data.components, []);
  assert.ok(calls.slice(before).some((c) => c.method === "PUT" && c.path.endsWith(`/members/${CAT}/roles/${ROLE}`)));
  const code = db.discord_applications.find((a) => a.id === okxId).invite_code;
  assert.ok(code, "沒有產生實驗室密碼");
  assert.ok(postsTo(catChan, before).some((c) => /審核通過/.test(c.body.content) && c.body.content.includes(code)));
  assert.equal(db.discord_applications.find((a) => a.id === okxId).status, "approved");
});
await test("重複按通過不會再給一次", async () => {
  const before = calls.length;
  const r = (await interact(at(catChan, button(`approve:${okxId}`, member(BOSS, { perms: ADMIN_PERMS }))))).body;
  assert.equal(r.type, 7);
  assert.ok(!calls.slice(before).some((c) => c.method === "PUT"));
});
await test("客服身分組也可以審核、也看得到申請分類", async () => {
  const STAFF = "666666666666666666";
  const st = db.settings.find((r) => r.key === "discord").value;
  st.staffRoleIds = [STAFF];
  const danChan = await openFor(member(DAN));
  assert.ok(BigInt(channels.get(danChan).permission_overwrites.find((o) => o.id === STAFF).allow) & (1n << 10n), "客服身分組要看得到申請頻道");
  await interact(at(danChan, modal("OKX", "5566778899", member(DAN))));
  assert.match(lastEdit().body.content, /UID：`5566778899`/);
  const id = db.discord_applications.find((a) => a.discord_user_id === DAN).id;
  const before = calls.length;
  const r = (await interact(at(danChan, button(`reject:${id}`, member(BOSS.replace(/9$/, "8"), { roles: [STAFF], name: "客服" }))))).body;
  assert.match(r.data.content, /不通過/);
  const back = postsTo(danChan, before).find((c) => /沒有通過/.test(c.body.content));
  assert.ok(back, "頻道裡要告訴他沒通過"); assert.equal(back.body.components[0].components[0].custom_id, "apply_ex");
  assert.ok(!calls.slice(before).some((c) => c.method === "PUT"));
  st.staffRoleIds = [];
});
await test("機器人給不了身分組（權限不夠）→ 轉人工審核並寫原因", async () => {
  roleFail = true;
  db.discord_applications = db.discord_applications.filter((a) => a.exchange_uid !== "88880001");
  const EVE = "500000000000000005";
  const eveChan = await openFor(member(EVE));
  await interact(at(eveChan, modal("BingX", "88880001", member(EVE))));
  roleFail = false;
  assert.match(lastEdit().body.content, /給身分組失敗/);
  assert.match(lastEdit().body.content, /等待管理員審核/);
});
await test("管理員按通過但機器人權限不夠 → 告訴管理員怎麼修", async () => {
  const id = db.discord_applications.find((a) => a.discord_user_id === "500000000000000005").id;
  roleFail = true;
  const r = (await interact(button(`approve:${id}`, member(BOSS, { perms: ADMIN_PERMS })))).body;
  roleFail = false;
  assert.equal(r.type, 4); assert.match(r.data.content, /管理身分組/);
  assert.equal(db.discord_applications.find((a) => a.id === id).status, "pending");
});
await test("別人不能關你的頻道；自己按關閉 → 刪掉頻道", async () => {
  assert.match((await interact(at(amyChan, button("close_ticket", member(BOB))))).body.data.content, /別人的報名頻道/);
  const r = (await interact(at(amyChan, button("close_ticket", member(AMY))))).body;
  assert.equal(r.type, 4); assert.match(r.data.content, /關閉/);
  assert.ok(calls.some((c) => c.method === "DELETE" && c.path === `/channels/${amyChan}`));
  assert.equal(db.discord_tickets.find((t) => t.channel_id === amyChan).status, "closed");
  assert.ok(!channels.has(amyChan));
});
await test("管理員可以關別人的頻道", async () => {
  await interact(at(bobChan, button("close_ticket", member(BOSS, { perms: ADMIN_PERMS }))));
  assert.equal(db.discord_tickets.find((t) => t.channel_id === bobChan).status, "closed");
});

// ── 一鍵建立頻道 ──
await test("邀請連結帶好權限（管理身分組、管理頻道）", () => {
  assert.ok((BigInt(BOT_PERMISSIONS) & (1n << 28n)) && (BigInt(BOT_PERMISSIONS) & (1n << 4n)));
  assert.match(inviteUrl("111111111111111111"), /client_id=111111111111111111&scope=bot&permissions=\d+/);
});
let firstRun;
await test("一鍵建立：分類＋三個頻道、權限、申請按鈕，不貼共用實驗室密碼", async () => {
  const before = calls.length;
  db.settings.find((r) => r.key === "discord").value.labCode = "OLD1-CODE";
  firstRun = await setupGuild();
  assert.equal(firstRun.ok, true);
  assert.deepEqual(firstRun.created, ["🧪 CCC 交易實驗室", "📝加入培訓計畫", "🔒報名審核", "📢研究員專屬公告"], "申請分類前面已經開過，沿用");
  const made = [...channels.values()];
  const lab = made.find((c) => c.name === "📢研究員專屬公告");
  const everyoneLab = lab.permission_overwrites.find((o) => o.id === GUILD_ID);
  assert.ok(BigInt(everyoneLab.deny) & (1n << 10n), "實驗室頻道 everyone 要看不到");
  assert.ok(BigInt(lab.permission_overwrites.find((o) => o.id === ROLE).allow) & (1n << 10n), "實驗室身分組要看得到");
  const review = made.find((c) => c.name === "🔒報名審核");
  assert.ok(BigInt(review.permission_overwrites.find((o) => o.id === GUILD_ID).deny) & (1n << 10n), "審核頻道 everyone 要看不到");
  const posts = calls.slice(before).filter((c) => c.method === "POST" && /\/messages$/.test(c.path));
  // v1.37.9：固定訊息改成帶去實驗室培訓房（網站貼 UID、Discord 授權），按鈕是連結
  const isJoin = (c) => c.body.components?.[0]?.components?.[0]?.url === "https://ccc-community-site.pages.dev/lab";
  assert.ok(posts.some(isJoin), "沒有「到實驗室培訓房加入」按鈕");
  const signup = posts.find(isJoin).body.components[1];
  assert.deepEqual(signup.components.map((b) => [b.style, b.label, b.url]), [[5, "BingX 註冊", "https://bingx.com/invite/CCC"]], "有填邀請連結的交易所要有註冊按鈕");
  assert.equal(posts.length, 1, "只貼申請按鈕");
  assert.ok(!calls.slice(before).some((c) => c.method === "PUT" && /\/pins\//.test(c.path)), "不用釘選");
  const saved = db.settings.find((r) => r.key === "discord").value;
  assert.equal(saved.guildId, GUILD_ID); assert.equal(saved.labCode, undefined, "舊的共用實驗室密碼設定要清掉");
  assert.ok(saved.panelChannelId && saved.reviewChannelId && saved.labChannelId && saved.categoryId);
});
await test("身分組順序不對會提醒（機器人排在實驗室身分組下面）", () => assert.equal(firstRun.hierarchyOk, false));
await test("再按一次不會重複建立、不會重貼", async () => {
  botRolePos = 9;
  const before = calls.length;
  const r = await setupGuild();
  assert.equal(r.created.length, 0);
  assert.equal(r.hierarchyOk, true);
  assert.ok(!calls.slice(before).some((c) => c.method === "POST"), "不應該再建立或貼訊息");
  assert.equal(calls.slice(before).filter((c) => c.method === "PATCH" && /^\/channels\/\d+$/.test(c.path)).length, 4, "三個頻道和申請分類的權限要調回正確");
});
await test("舊版預設的頻道名稱會改成新的、報名按鈕改成新文字（自己改過的名字不動）", async () => {
  const st = db.settings.find((r) => r.key === "discord").value;
  channels.get(st.panelChannelId).name = "📝申請加入實驗室";
  channels.get(st.reviewChannelId).name = "🔒申請審核";
  channels.get(st.labChannelId).name = "研究員專屬公告";
  const before = calls.length;
  await setupGuild();
  const c = calls.slice(before);
  const panelPatch = c.find((x) => x.method === "PATCH" && x.path === `/channels/${st.panelChannelId}`);
  assert.equal(panelPatch.body.name, "📝加入培訓計畫");
  assert.equal(c.find((x) => x.method === "PATCH" && x.path === `/channels/${st.reviewChannelId}`).body.name, "🔒報名審核");
  assert.equal(c.find((x) => x.method === "PATCH" && x.path === `/channels/${st.labChannelId}`).body.name, undefined, "自己改過的不動");
  const edit = c.find((x) => x.method === "PATCH" && x.path === `/channels/${st.panelChannelId}/messages/${st.panelMessageId}`);
  assert.ok(edit, "要把報名按鈕那則改成新文字");
  assert.equal(edit.body.components[0].components[0].label, "到實驗室培訓房加入");
  assert.ok(!c.some((x) => x.method === "POST" && /\/messages$/.test(x.path)), "不用重貼");
});

// ── 客服單（取代 Ticket Tool）──
const EVE = "500000000000000005", STAFF_ROLE = "666666666666666666";
const topicSelect = (v, m) => ({ type: 3, guild_id: GUILD, token: "tok-s", member: m, channel_id: "555555555555555555", data: { custom_id: "support_topic", component_type: 3, values: [v] } });
const supportForm = (topic, subject, detail, m) => ({ type: 5, guild_id: GUILD, token: "tok-sf", member: m, channel_id: "555555555555555555", data: { custom_id: `support_form:${topic}`, components: [{ type: 1, components: [{ type: 4, custom_id: "subject", value: subject }] }, { type: 1, components: [{ type: 4, custom_id: "detail", value: detail }] }] } });
let eveChan;
await test("客服中心：選類型 → 跳出主旨、說明的表單", async () => {
  const r = await interact(topicSelect("exchange", member(EVE)));
  assert.equal(r.body.type, 9);
  assert.equal(r.body.data.custom_id, "support_form:exchange");
  assert.deepEqual(r.body.data.components.map((c) => c.components[0].custom_id), ["subject", "detail"]);
});
await test("送出 → 開私人客服頻道（只有他、客服看得到），卡片寫主旨、說明、狀態，通知客服身分組", async () => {
  db.settings.find((r) => r.key === "discord").value.staffRoleIds = [STAFF_ROLE];
  const before = calls.length;
  const r = await interact(supportForm("exchange", "BingX 交易量沒更新", "三天沒更新了，UID 12345678", member(EVE, { name: "Eve" })));
  assert.equal(r.body.type, 5); assert.equal(r.body.data.flags, 64);
  const t = db.discord_tickets.find((x) => x.discord_user_id === EVE && x.kind === "support");
  assert.ok(t && t.status === "open" && t.subject === "BingX 交易量沒更新");
  eveChan = t.channel_id;
  const made = calls.slice(before).find((c) => c.method === "POST" && c.path === `/guilds/${GUILD}/channels` && c.body.parent_id);
  assert.equal(made.body.name, "客服-Eve");
  const ow = made.body.permission_overwrites;
  assert.ok(BigInt(ow.find((o) => o.id === GUILD).deny) & (1n << 10n), "everyone 看不到");
  assert.ok(BigInt(ow.find((o) => o.id === EVE).allow) & (1n << 10n), "開單的人看得到");
  assert.ok(BigInt(ow.find((o) => o.id === STAFF_ROLE).allow) & (1n << 10n), "客服身分組看得到");
  const welcome = postsTo(eveChan, before)[0].body;
  assert.ok(welcome.content.includes(`<@&${STAFF_ROLE}>`));
  assert.equal(welcome.embeds[0].title, "💱 BingX 交易量沒更新");
  assert.ok(welcome.embeds[0].fields.some((f) => f.value === "🟡 等待客服"));
  assert.deepEqual(welcome.components[0].components.map((b) => b.custom_id), ["support_claim", "support_close"]);
  assert.match(lastEdit().body.content, new RegExp(`客服單開好了：<#${eveChan}>`));
});
await test("同一個人再開一張 → 給原本那張；報名頻道和客服單可以同時各一個", async () => {
  const r = await interact(topicSelect("site", member(EVE)));
  assert.match(r.body.data.content, new RegExp(`已經有一張客服單了：<#${eveChan}>`));
});
await test("只有客服能「我來處理」；接手後卡片變處理中", async () => {
  assert.match((await interact(at(eveChan, button("support_claim", member(EVE))))).body.data.content, /只有客服/);
  const r = await interact(at(eveChan, button("support_claim", member(BOSS, { roles: [STAFF_ROLE], name: "boss" }))));
  assert.equal(r.body.type, 7);
  assert.ok(r.body.data.embeds[0].fields.some((f) => f.value === "🟢 boss 處理中"));
  assert.equal(r.body.data.components[0].components[0].disabled, true);
  assert.equal(db.discord_tickets.find((x) => x.channel_id === eveChan).claimed_by, "boss");
});
await test("報名頻道的按鈕在客服單裡不能用", async () => {
  assert.match((await interact(at(eveChan, { type: 3, guild_id: GUILD, token: "t", member: member(EVE), data: { custom_id: "apply_ex", values: ["BingX"] } }))).body.data.content, /報名培訓計畫/);
});
await test("別人不能關；開單的人按關閉 → 先確認 → 紀錄存到客服紀錄、私訊、刪頻道", async () => {
  db.settings.find((r) => r.key === "discord").value.supportLogChannelId = "777777777777777777";
  assert.match((await interact(at(eveChan, button("support_close", member(DAN))))).body.data.content, /只有開單的人或客服/);
  const ask = await interact(at(eveChan, button("support_close", member(EVE))));
  assert.equal(ask.body.data.components[0].components[0].custom_id, "support_close_yes");
  const before = calls.length;
  const r = await interact(at(eveChan, button("support_close_yes", member(EVE, { name: "Eve" }))));
  assert.equal(r.body.type, 7);
  const c = calls.slice(before);
  assert.ok(c.some((x) => x.method === "GET" && x.path.startsWith(`/channels/${eveChan}/messages?limit=100`)), "要抓完整對話");
  assert.ok(c.some((x) => x.method === "POST" && x.path === "/channels/777777777777777777/messages"), "紀錄要存到客服紀錄頻道");
  assert.ok(c.some((x) => x.method === "POST" && x.path === `/channels/dm-${EVE}/messages` && /已經結案/.test(x.body.content)), "要私訊開單的人");
  assert.ok(c.some((x) => x.method === "DELETE" && x.path === `/channels/${eveChan}`));
  assert.equal(db.discord_tickets.find((x) => x.channel_id === eveChan).status, "closed");
});

await test("同一張客服單關兩次只跑一次（不會重複存紀錄、私訊）", async () => {
  const t = db.discord_tickets.find((x) => x.channel_id === eveChan);
  const before = calls.length;
  const r = await closeSupport({ ...t, status: "open" }, "boss", db.settings.find((x) => x.key === "discord").value);
  assert.equal(r.reason, "already_closed");
  assert.equal(calls.length, before, "不能再打 Discord");
});
await test("關單後 10 分鐘內不能馬上再開（防洗版）", async () => {
  const r = await interact(topicSelect("other", member(EVE)));
  assert.match(r.body.data.content, /分鐘後再開/);
  const r2 = await interact(supportForm("other", "再一張", "我想再開一張看看", member(EVE)));
  assert.equal(r2.body.type, 5);
  assert.ok(!db.discord_tickets.some((x) => x.discord_user_id === EVE && x.kind === "support" && x.status === "open"), "表單直接送也不能開");
});
await test("說明裡的「藏起來的連結」會被拆開；別的伺服器按的不理", async () => {
  SUPPORT_COOLDOWN_MS.value = 0;
  const before = calls.length;
  await interact(supportForm("other", "連結測試", "點這裡 [bybit.com](https://evil.example) 領獎", member(EVE)));
  const welcome = calls.slice(before).find((x) => x.method === "POST" && /\/messages$/.test(x.path) && x.body?.embeds);
  assert.ok(welcome && !/\]\(/.test(welcome.body.embeds[0].description), "不能有 [文字](網址)");
  const other = await interact({ ...topicSelect("other", member(EVE)), guild_id: "999999999999999999" });
  assert.match(other.body.data.content, /CCC 的 Discord 伺服器/);
});

await test("客服身分組改了：開著的客服單頻道權限跟著換", async () => {
  const t = db.discord_tickets.find((x) => x.discord_user_id === EVE && x.kind === "support" && x.status === "open");
  const before = calls.length;
  const n = await resyncSupportTickets({ guildId: GUILD, botId: "123", staffRoleIds: ["888888888888888888"] });
  assert.ok(n >= 1);
  const p = calls.slice(before).find((x) => x.method === "PATCH" && x.path === `/channels/${t.channel_id}`);
  const ids = p.body.permission_overwrites.map((o) => o.id);
  assert.ok(ids.includes("888888888888888888") && !ids.includes(STAFF_ROLE) && ids.includes(EVE));
});

await test("排程：報名訊息跟程式不一樣才更新（拿掉 UM 開戶按鈕）", async () => {
  const st = db.settings.find((r) => r.key === "discord").value;
  st.invites = { OKX: "https://okx.com/join/CCC", UM: "https://ultgo.com/x" };
  delete st.panelHash;
  let before = calls.length;
  assert.deepEqual(await syncPanelMessage(), { updated: true });
  const edit = calls.slice(before).find((x) => x.method === "PATCH" && x.path === `/channels/${st.panelChannelId}/messages/${st.panelMessageId}`);
  assert.ok(edit, "要改報名訊息");
  assert.deepEqual(edit.body.components[1].components.map((b) => b.label), ["OKX 註冊"]);
  before = calls.length;
  assert.deepEqual(await syncPanelMessage(), { updated: false });
  assert.ok(!calls.slice(before).some((x) => x.method === "PATCH"), "內容一樣就不再改");
});

// ── 📚 交易百科與頻道導覽 ──
const wikiOf = (custom_id, m, extra = {}) => ({ type: 3, guild_id: GUILD, token: "tok-w", member: m, channel_id: "555555555555555555", data: { custom_id, component_type: extra.values ? 3 : 2, ...extra } });
await test("交易百科：搜尋中文、英文、縮寫、打錯字都找得到", async () => {
  assert.deepEqual(searchTerms("delta").map((e) => e.term), ["Delta"]);
  assert.deepEqual(searchTerms("爆倉").map((e) => e.term), ["強平"]);
  assert.deepEqual(searchTerms("sweeep").map((e) => e.term), ["流動性掃蕩"]);
  assert.deepEqual(searchTerms("xyz"), []);
  assert.ok(GLOSSARY.every((e) => e.short.length <= 100 && e.body.length < 4000), "下拉選單說明 100 字內");
  assert.ok(GLOSSARY.filter((e) => e.featured).length <= 25, "下拉選單最多 25 個");
});
await test("交易百科：後台貼面板（沒填頻道 → 建「📚交易百科」，大家看得到、不能發言）；再按一次改原本那則", async () => {
  const st = db.settings.find((r) => r.key === "discord").value;
  st.guildId = GUILD; delete st.wikiChannelId; delete st.wikiMessageId;
  let before = calls.length;
  const r = await setupWiki();
  assert.ok(r.ok); assert.deepEqual(r.created, ["📚交易百科"]);
  const made = calls.slice(before).find((c) => c.method === "POST" && c.path === `/guilds/${GUILD}/channels`);
  assert.equal(made.body.name, "📚交易百科");
  assert.ok(BigInt(made.body.permission_overwrites.find((o) => o.id === GUILD).deny) & (1n << 11n), "不能發言");
  const panel = postsTo(r.settings.wikiChannelId, before)[0].body;
  assert.equal(panel.embeds[0].title, "📚 交易百科與頻道導覽");
  assert.equal(panel.components[0].components[0].custom_id, "wiki_term");
  assert.deepEqual(panel.components[1].components.map((b) => b.label), ["頻道導覽", "搜尋其他名詞"]);
  before = calls.length;
  const again = await setupWiki();
  assert.equal(again.reposted, false);
  assert.ok(calls.slice(before).some((c) => c.method === "PATCH" && c.path === `/channels/${r.settings.wikiChannelId}/messages/${r.settings.wikiMessageId}`), "改原本那則");
  assert.equal(postsTo(r.settings.wikiChannelId, before).length, 0, "不重貼");
  assert.match((await setupWiki({ channelId: "799999999999999999" })).error, /找不到這個頻道/);
});
await test("交易百科：排程自動貼（只自動一次）、內容一樣不動", async () => {
  const st = db.settings.find((r) => r.key === "discord").value;
  delete st.wikiChannelId; delete st.wikiMessageId; delete st.wikiHash; delete st.wikiAutoTried;
  const r = await syncWikiPanel();
  assert.equal(r.posted, true);
  const now = db.settings.find((x) => x.key === "discord").value;
  assert.ok(now.wikiMessageId && now.wikiHash && now.wikiAutoTried);
  let before = calls.length;
  assert.deepEqual(await syncWikiPanel(), { updated: false });
  assert.ok(!calls.slice(before).some((c) => c.method !== "GET"), "內容一樣什麼都不做");
  now.wikiHash = "old";
  before = calls.length;
  assert.deepEqual(await syncWikiPanel(), { updated: true });
  assert.ok(calls.slice(before).some((c) => c.method === "PATCH" && c.path === `/channels/${now.wikiChannelId}/messages/${now.wikiMessageId}`));
  delete db.settings.find((x) => x.key === "discord").value.wikiMessageId;
  assert.equal(await syncWikiPanel(), null, "已經自動貼過一次，之後被刪掉就不再自己貼");
});
await test("交易百科：選名詞 → 只有自己看得到的說明", async () => {
  const r = await interact(wikiOf("wiki_term", member(EVE), { values: ["FVG"] }));
  assert.equal(r.body.type, 4); assert.equal(r.body.data.flags, 64);
  assert.match(r.body.data.embeds[0].title, /FVG/);
  assert.match(r.body.data.embeds[0].footer.text, /不是進出場建議/);
});
await test("交易百科：搜尋其他名詞 → 表單 → 一個結果直接給說明、多個給選單、找不到給提示", async () => {
  const m = await interact(wikiOf("wiki_search", member(EVE)));
  assert.equal(m.body.type, 9); assert.equal(m.body.data.custom_id, "wiki_search_form");
  const form = (q) => ({ type: 5, guild_id: GUILD, token: "tok-wf", member: member(EVE), channel_id: "555555555555555555", data: { custom_id: "wiki_search_form", components: [{ type: 1, components: [{ type: 4, custom_id: "q", value: q }] }] } });
  const one = await interact(form("資費"));
  assert.match(one.body.data.embeds[0].title, /資金費率/); assert.equal(one.body.data.flags, 64);
  const many = await interact(form("訂單"));
  assert.equal(many.body.data.components[0].components[0].custom_id, "wiki_term");
  assert.ok(many.body.data.components[0].components[0].options.length >= 2);
  const none = await interact(form("香蕉"));
  assert.match(none.body.data.content, /找不到「香蕉」/);
});
await test("頻道導覽：先回處理中，再列出這個人看得到的頻道（照分類，私人客服分類不列）", async () => {
  db.settings.find((r) => r.key === "discord").value.supportCategoryId = "700000000000000006";
  const r = await interact(wikiOf("wiki_guide", member(EVE)));
  assert.equal(r.body.type, 5); assert.equal(r.body.data.flags, 64);
  const emb = lastEdit().body.embeds[0];
  assert.equal(emb.title, "🧭 頻道導覽");
  assert.deepEqual(emb.fields.map((f) => f.name), ["📌 新手報到"], "沒有研究員身分組看不到研究員專區");
  assert.equal(emb.fields[0].value, "<#700000000000000002>｜先看這裡\n<#700000000000000005>");
  await interact(wikiOf("wiki_guide", member(EVE, { roles: [ROLE] })));
  assert.deepEqual(lastEdit().body.embeds[0].fields.map((f) => f.name), ["📌 新手報到", "🧪 研究員專區"]);
});
await test("頻道導覽：權限計算（everyone 擋、身分組開、個人擋、管理員全看得到）", async () => {
  const roles = [{ id: GUILD, permissions: VIEW_BIT }, { id: "9", permissions: "0" }, { id: "8", permissions: String(1n << 3n) }];
  const ch = (ow) => ({ permission_overwrites: ow });
  const ctx = (memberRoles = [], userId = "u") => ({ guildId: GUILD, roles, memberRoles, userId });
  assert.equal(canView(ch([]), ctx()), true);
  assert.equal(canView(ch([{ id: GUILD, type: 0, allow: "0", deny: VIEW_BIT }]), ctx()), false);
  assert.equal(canView(ch([{ id: GUILD, type: 0, allow: "0", deny: VIEW_BIT }, { id: "9", type: 0, allow: VIEW_BIT, deny: "0" }]), ctx(["9"])), true);
  assert.equal(canView(ch([{ id: "u", type: 1, allow: "0", deny: VIEW_BIT }]), ctx(["9"])), false);
  assert.equal(canView(ch([{ id: GUILD, type: 0, allow: "0", deny: VIEW_BIT }]), ctx(["8"])), true);
});

supa.close(); disc.close(); bingx.close();
console.log(`\nDiscord 機器人：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
