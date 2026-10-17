// 直播預告：後台新增／修改／取消、Discord 公告和回覆、開播前提醒排程、研究員首頁的下一場
// 用假的 Supabase（PostgREST）和假的 Discord，直接跑真的伺服器程式
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv, env } from "../server/lib/env.js";
import adminLives from "../server/admin/lives.js";
import cronLives from "../server/cron/lives.js";
import me from "../server/me.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readJson = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(b ? JSON.parse(b) : null); } catch { r(null); } }); });

// ── 假的 Supabase ──
const ROLE = "1560542923173400596", LAB = "800000000000000004";
const db = {
  lives: [], members: [], exchange_links: [], volumes: [], feedback: [],
  settings: [{ key: "discord", value: { roleId: ROLE, labChannelId: LAB } }, { key: "admin_roles", value: { "oc@gmail.com": "editor" } }],
};
let liveSeq = 0;
const tokens = {
  "tok-admin": { id: "admin-1", email: "boss@gmail.com", email_confirmed_at: "2026-01-01T00:00:00Z" },
  "tok-oc": { id: "admin-2", email: "oc@gmail.com", email_confirmed_at: "2026-01-01T00:00:00Z" },
  "tok-m": { id: "u-1", email: "m@example.com", email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z" },
};
db.members.push({ user_id: "u-1", email: "m@example.com", banned: false, notify: true, access_until: null, created_at: "2026-10-01T00:00:00Z" });
const parse = (sp) => [...sp].filter(([k]) => !["select", "order", "limit", "on_conflict", "columns"].includes(k)).map(([col, v]) => {
  const i = v.indexOf(".");
  return { col, op: v.slice(0, i), val: v.slice(i + 1) };
});
const cmp = (x, val) => (/^\d{4}-\d\d-\d\dT/.test(val) ? Date.parse(x) - Date.parse(val) : String(x).localeCompare(val));
const match = (row, fs) => fs.every(({ col, op, val }) => {
  const x = row[col] == null ? null : String(row[col]);
  if (op === "eq") return x === val;
  if (op === "is") return val === "null" ? x === null : true;
  if (op === "gte") return x !== null && cmp(x, val) >= 0;
  if (op === "lte") return x !== null && cmp(x, val) <= 0;
  return true;
});
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/auth/v1/user") {
    const user = tokens[(req.headers.authorization || "").replace("Bearer ", "")];
    res.writeHead(user ? 200 : 401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(user || { message: "invalid" }));
  }
  const table = u.pathname.split("/").pop();
  if (req.method === "HEAD") { res.writeHead(200, { "Content-Range": "0-0/0" }); return res.end(); }
  const rows = db[table];
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? data[0] ?? null : data)); };
  if (!rows) return send([], 404);
  const fs = parse(u.searchParams);
  if (req.method === "GET") {
    let out = rows.filter((r) => match(r, fs));
    const ord = u.searchParams.get("order");
    if (ord) { const [c, dir] = ord.split("."); out = [...out].sort((a, b) => (dir === "desc" ? -1 : 1) * String(a[c]).localeCompare(String(b[c]))); }
    const lim = Number(u.searchParams.get("limit")); if (lim) out = out.slice(0, lim);
    return send(out);
  }
  const body = await readJson(req);
  if (req.method === "POST") {
    const out = (Array.isArray(body) ? body : [body]).map((it) => {
      const row = table === "lives" ? { id: ++liveSeq, discord_channel_id: null, discord_message_id: null, reminded_at: null, created_at: new Date().toISOString(), ...it } : it;
      rows.push(row); return row;
    });
    return send(out, 201);
  }
  if (req.method === "PATCH") {
    const hit = rows.filter((r) => match(r, fs));
    for (const r of hit) Object.assign(r, body);
    return send(hit);
  }
  send([], 405);
});

// ── 假的 Discord ──
const calls = [];
let msgSeq = 0;
const disc = http.createServer(async (req, res) => {
  const body = await readJson(req);
  calls.push({ method: req.method, path: req.url, body });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: String(950000000000000000n + BigInt(++msgSeq)) }));
});

const [SUPA, DISC] = await Promise.all([listen(supa), listen(disc)]);
if (!globalThis.WebSocket) globalThis.WebSocket = class {};
setEnv({
  SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test", ADMIN_EMAILS: "boss@gmail.com,oc@gmail.com",
  DISCORD_APP_ID: "111111111111111111", DISCORD_PUBLIC_KEY: "a".repeat(64), DISCORD_BOT_TOKEN: "bot", DISCORD_API_BASE: DISC,
  CRON_SECRET: "cron-test",
});

async function call(handler, { method = "GET", query = {}, body, token = "tok-admin", route = "admin/lives", headers = {} } = {}) {
  const res = { statusCode: 200, body: null, headersSent: false, headers: {} };
  res.status = (c) => ((res.statusCode = c), res);
  res.setHeader = (k, v) => ((res.headers[k] = v), res);
  res.json = (d) => ((res.body = d), (res.headersSent = true), res);
  res.end = () => ((res.headersSent = true), res);
  await handler({ method, route, headers: { authorization: `Bearer ${token}`, ...headers }, query, body }, res);
  return res;
}
const H = 3600e3;
const inHours = (h) => new Date(Date.now() + h * H).toISOString();
const since = (n) => calls.slice(n);
const live = (id) => db.lives.find((l) => l.id === id);

let id1;
await test("新增直播 → 存起來、發到實驗室頻道並提及實驗室研究員", async () => {
  const before = calls.length;
  const r = await call(adminLives, { method: "POST", body: { title: "NQ 盤前直播", startsAt: inHours(48), note: "聊這週的 FOMC", link: "https://youtube.com/live/abc" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.announce.posted, true);
  assert.equal(r.body.discord.configured, true); assert.equal(r.body.discord.channelId, LAB);
  id1 = r.body.id;
  const post = since(before).find((c) => c.method === "POST" && c.path === `/channels/${LAB}/messages`);
  assert.ok(post, "沒有發到實驗室頻道");
  assert.ok(post.body.content.startsWith(`<@&${ROLE}>`));
  assert.match(post.body.content, /直播預告：NQ 盤前直播/);
  assert.match(post.body.content, /<t:\d+:F>/); assert.match(post.body.content, /FOMC/); assert.match(post.body.content, /youtube\.com\/live\/abc/);
  assert.deepEqual(post.body.allowed_mentions, { roles: [ROLE] });
  assert.ok(live(id1).discord_message_id, "要記下公告的訊息 ID");
  assert.equal(live(id1).created_by, "boss@gmail.com");
  assert.equal(r.body.lives.length, 1);
});
await test("可以選不提及", async () => {
  const before = calls.length;
  const r = await call(adminLives, { method: "POST", body: { title: "加開場", startsAt: inHours(72), mention: false } });
  const post = since(before).find((c) => c.method === "POST");
  assert.ok(!post.body.content.includes("<@&")); assert.deepEqual(post.body.allowed_mentions, { roles: [] });
  assert.equal(live(r.body.id).mention, false);
});
await test("表單檢查：沒標題、過去的時間、連結不是 https", async () => {
  assert.match((await call(adminLives, { method: "POST", body: { title: "", startsAt: inHours(1) } })).body.error, /標題/);
  assert.match((await call(adminLives, { method: "POST", body: { title: "x", startsAt: inHours(-2) } })).body.error, /已經過了/);
  assert.match((await call(adminLives, { method: "POST", body: { title: "x", startsAt: "明天" } })).body.error, /格式/);
  assert.match((await call(adminLives, { method: "POST", body: { title: "x", startsAt: inHours(1), link: "javascript:alert(1)" } })).body.error, /https/);
});
await test("只改標題 → 改公告，不另外通知", async () => {
  const before = calls.length;
  const r = await call(adminLives, { method: "PATCH", body: { id: id1, title: "NQ 盤前直播（加長版）" } });
  assert.equal(r.statusCode, 200);
  const c = since(before);
  assert.ok(c.some((x) => x.method === "PATCH" && x.path === `/channels/${LAB}/messages/${live(id1).discord_message_id}` && /加長版/.test(x.body.content)));
  assert.ok(!c.some((x) => x.method === "POST"), "只改標題不用回覆");
});
await test("改時間 → 改公告，並在公告下面回覆提及", async () => {
  live(id1).reminded_at = new Date().toISOString();
  const before = calls.length;
  await call(adminLives, { method: "PATCH", body: { id: id1, startsAt: inHours(50) } });
  const reply = since(before).find((x) => x.method === "POST");
  assert.ok(reply, "沒有回覆");
  assert.match(reply.body.content, /改時間了/);
  assert.equal(reply.body.message_reference.message_id, live(id1).discord_message_id);
  assert.equal(live(id1).reminded_at, null, "改時間後要重新提醒");
});
await test("協作管理員也可以排直播", async () => {
  const r = await call(adminLives, { method: "POST", token: "tok-oc", body: { title: "OC 的直播", startsAt: inHours(24) } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
});
await test("研究員不能用後台", async () => assert.equal((await call(adminLives, { token: "tok-m" })).statusCode, 403));

await test("研究員首頁拿到最近的一場", async () => {
  const r = await call(me, { token: "tok-m", route: "me" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.nextLive.title, "OC 的直播");
});

let soonId;
await test("排程：沒有密碼擋掉", async () => assert.equal((await call(cronLives, { method: "POST", route: "cron/lives" })).statusCode, 401));
await test("排程：30 分鐘內要開始的發一次提醒，不重複", async () => {
  const r0 = await call(adminLives, { method: "POST", body: { title: "等等就開始", startsAt: inHours(0.3), link: "https://youtube.com/live/now" } });
  soonId = r0.body.id;
  const before = calls.length;
  const r = await call(cronLives, { method: "POST", route: "cron/lives", headers: { "x-cron-secret": "cron-test" } });
  assert.equal(r.body.reminded, 1, JSON.stringify(r.body));
  const reply = since(before).find((x) => x.method === "POST");
  assert.match(reply.body.content, /等等就開始/); assert.match(reply.body.content, /youtube\.com\/live\/now/);
  assert.ok(reply.body.content.startsWith(`<@&${ROLE}>`));
  assert.equal(reply.body.message_reference.message_id, live(soonId).discord_message_id);
  assert.ok(live(soonId).reminded_at);
  const again = await call(cronLives, { method: "POST", route: "cron/lives", headers: { "x-cron-secret": "cron-test" } });
  assert.equal(again.body.reminded, 0);
});
await test("取消 → 公告劃掉、回覆通知、首頁不再顯示", async () => {
  const before = calls.length;
  const r = await call(adminLives, { method: "DELETE", query: { id: String(soonId) } });
  assert.equal(r.statusCode, 200);
  const c = since(before);
  assert.ok(c.some((x) => x.method === "PATCH" && /~~/.test(x.body.content) && /取消/.test(x.body.content)));
  assert.ok(c.some((x) => x.method === "POST" && /取消了/.test(x.body.content)));
  assert.equal(live(soonId).status, "cancelled");
  assert.equal((await call(adminLives, { method: "DELETE", query: { id: String(soonId) } })).statusCode, 404);
  assert.equal((await call(adminLives, { method: "PATCH", body: { id: soonId, title: "x" } })).statusCode, 400);
  const m = await call(me, { token: "tok-m", route: "me" });
  assert.notEqual(m.body.nextLive?.title, "等等就開始");
});
await test("Discord 還沒設定：照樣存，告訴管理員沒發出去", async () => {
  const keep = env.DISCORD_BOT_TOKEN;
  env.DISCORD_BOT_TOKEN = "";
  const r = await call(adminLives, { method: "POST", body: { title: "沒有機器人", startsAt: inHours(5) } });
  env.DISCORD_BOT_TOKEN = keep;
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.announce.posted, false); assert.match(r.body.announce.error, /還沒設定/);
  assert.ok(db.lives.some((l) => l.title === "沒有機器人"));
});

supa.close(); disc.close();
console.log(`\n直播預告：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
