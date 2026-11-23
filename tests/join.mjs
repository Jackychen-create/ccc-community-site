// v1.36.0：加入培訓計畫兩步（UID → Discord 授權開通）、用 Discord 登入、研究員名單的 Email
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import join, { login, contact } from "../server/join.js";
import { callback } from "../server/discord-oauth.js";
import { discordAuthEmail } from "../server/lib/join.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readJson = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b || "null")); } catch { r(b); } }); });

const GUILD = "100000000000000001", ROLE = "100000000000000002", LAB = "100000000000000003";
const db = {
  members: [], exchange_links: [], uid_join_attempts: [], okx_snapshots: [], volumes: [], member_discord: [], payments: [], subscriptions: [],
  settings: [{ key: "discord", value: { guildId: GUILD, roleId: ROLE, labChannelId: LAB, invites: { OKX: "https://okx.com/join/99357363" } } }],
};
const users = [];
const tokens = {}; // access token → user（網站登入後打 API 用）
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (d, s = 200, extra = {}) => { res.writeHead(s, { "Content-Type": "application/json", ...extra }); res.end(JSON.stringify(d)); };
  if (u.pathname === "/auth/v1/admin/users" && req.method === "POST") {
    const b = await readJson(req);
    if (users.some((x) => x.email === b.email)) return send({ msg: "User already registered" }, 422);
    const user = { id: `00000000-0000-4000-8000-${String(users.length + 1).padStart(12, "0")}`, email: b.email, user_metadata: b.user_metadata };
    users.push(user);
    return send(user);
  }
  if (u.pathname.startsWith("/auth/v1/admin/users/") && req.method === "GET") {
    const user = users.find((x) => x.id === u.pathname.split("/").pop());
    return user ? send(user) : send({ msg: "not found" }, 404);
  }
  if (u.pathname.startsWith("/auth/v1/admin/users/")) return send({});
  if (u.pathname === "/auth/v1/admin/generate_link") {
    const b = await readJson(req);
    return send({ id: "x", email: b.email, action_link: "https://x", hashed_token: `ht-${b.email}`, verification_type: b.type, redirect_to: "" });
  }
  if (u.pathname === "/auth/v1/user") { const user = tokens[(req.headers.authorization || "").replace("Bearer ", "")]; return send(user || { msg: "invalid" }, user ? 200 : 401); }
  if (u.pathname.startsWith("/rest/v1/rpc/")) return send(null);
  const table = u.pathname.split("/").pop();
  const rows = db[table];
  if (!rows) return send([], 200);
  const filt = [...u.searchParams].filter(([k]) => !["select", "order", "limit", "on_conflict"].includes(k));
  const match = (r) => filt.every(([k, v]) => {
    const [op, ...rest] = v.split("."); const val = rest.join(".");
    if (op === "eq") return String(r[k]) === val;
    if (op === "gte") return String(r[k]) >= val;
    return true;
  });
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  if (req.method === "HEAD") { const n = rows.filter(match).length; res.writeHead(200, { "Content-Range": `0-${Math.max(0, n - 1)}/${n}` }); return res.end(); }
  const pick = (r) => { const sel = u.searchParams.get("select"); if (!sel || sel === "*" || sel.includes("(")) return r; return Object.fromEntries(sel.split(",").map((k) => k.trim()).map((k) => [k, r[k]])); };
  if (req.method === "GET") { const out = rows.filter(match).map(pick); return send(one ? out[0] ?? null : out); }
  if (req.method === "PATCH") { const b = await readJson(req); for (const r of rows.filter(match)) Object.assign(r, b); return send([], 200); }
  if (req.method === "POST") {
    const b = await readJson(req);
    for (const it of [].concat(b)) {
      const i = table === "member_discord" ? rows.findIndex((r) => r.user_id === it.user_id) : -1;
      if (i >= 0) rows[i] = { ...rows[i], ...it }; else rows.push({ at: new Date().toISOString(), created_at: new Date().toISOString(), ...it });
    }
    return send(b, 201);
  }
  return send([]);
});
// 假的 OKX：…0001、…0005 是 CCC 邀請的，…0002 是別人邀請的，其他不是推薦的人
const okx = http.createServer((req, res) => {
  const uid = new URL(req.url, "http://x").searchParams.get("uid");
  const ok = ["817018337355330001", "817018337355330005"].includes(uid);
  const data = ok ? [{ affiliateCode: "99357363", totalVol: "500", joinTime: String(Date.now()) }] : uid === "817018337355330002" ? [{ affiliateCode: "OTHER", totalVol: "1" }] : [];
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data.length ? { code: "0", data } : { code: "51621", msg: "not invitee", data: [] }));
});
// 假的 Discord：code=amy → Amy（有驗證過的 Email），code=bob → Bob（沒有 Email）
const dcCalls = [];
const inGuild = new Set();
const discord = http.createServer(async (req, res) => {
  const body = await readJson(req);
  dcCalls.push({ m: req.method, p: req.url, body });
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(d === null ? "" : JSON.stringify(d)); };
  if (req.url === "/oauth2/token") { const c = new URLSearchParams(body).get("code"); return ["amycode1234", "bobcode1234"].includes(c) ? send({ access_token: `at-${c.slice(0, 3)}` }) : send({ error: "invalid_grant" }, 400); }
  if (req.url === "/users/@me") {
    const a = req.headers.authorization;
    if (a === "Bearer at-amy") return send({ id: "111111111111111111", username: "amy", global_name: "Amy", email: "Amy@Example.com", verified: true });
    if (a === "Bearer at-bob") return send({ id: "222222222222222222", username: "bob", email: null, verified: false });
    return send({ message: "401" }, 401);
  }
  const m = req.url.match(/\/guilds\/\d+\/members\/(\d+)$/);
  if (req.method === "PUT" && m) { if (inGuild.has(m[1])) { res.writeHead(204); return res.end(); } inGuild.add(m[1]); return send({ user: {} }, 201); }
  if (req.method === "PUT" && /\/roles\//.test(req.url)) { res.writeHead(204); return res.end(); }
  return send({ message: "?" }, 404);
});
const SUPA = await listen(supa), OKX = await listen(okx), DC = await listen(discord);
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "x", OKX_API_KEY: "k", OKX_SECRET_KEY: "s", OKX_PASSPHRASE: "p", OKX_BASE_URL: OKX, DISCORD_APP_ID: "999", DISCORD_CLIENT_SECRET: "sec", DISCORD_BOT_TOKEN: "bot", DISCORD_API_BASE: DC });

const call = async (handler, { method = "POST", body = {}, query = {}, ip = "1.2.3.4", token = "" } = {}) => {
  const out = { headers: {} };
  const res = { headersSent: false, setHeader: (k, v) => (out.headers[k] = v), status: (c) => ((out.statusCode = c), res), json: (b) => ((out.body = b), res), end: () => res };
  await handler({ method, headers: { "cf-connecting-ip": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body, query }, res);
  return out;
};
const back = (r) => Object.fromEntries(new URLSearchParams(r.headers.Location.split("?")[1]));

let joinState = "";
await test("第一步：UID 是 CCC 邀請的 → 給 Discord 授權網址（要 email、guilds.join）", async () => {
  const r = await call(join, { body: { exchange: "OKX", uid: " 817018337355330001 " } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const u = new URL(r.body.url);
  assert.equal(u.searchParams.get("scope"), "identify email guilds.join");
  joinState = u.searchParams.get("state");
  assert.match(joinState, /^j\.OKX\.817018337355330001\./);
  assert.equal(db.members.length, 0, "還沒建帳號");
});
await test("第一步：不是 CCC 邀請、用別人的碼 → 說原因、附三間的 CCC 註冊連結", async () => {
  const a = await call(join, { body: { exchange: "OKX", uid: "817018337355339999" } });
  assert.equal(a.body.code, "not_invited"); assert.match(a.body.error, /幾分鐘/); assert.ok(a.body.links.Bybit);
  const b = await call(join, { body: { exchange: "OKX", uid: "817018337355330002" } });
  assert.equal(b.body.code, "other_code"); assert.ok(b.body.links.OKX);
  const c = await call(join, { body: { exchange: "OKX", uid: "abc" } });
  assert.equal(c.statusCode, 400); assert.equal(c.body.links, undefined);
});
await test("第二步：Discord 授權回來 → 建帳號、記 UID 和 Discord、加進伺服器帶身分組、帶登入代碼回網站", async () => {
  const r = await call(callback, { method: "GET", query: { state: joinState, code: "amycode1234" } });
  const q = back(r);
  assert.equal(q.r, "welcome", JSON.stringify(q));
  assert.equal(q.t, `ht-${discordAuthEmail("111111111111111111")}`);
  assert.equal(q.g, "1");
  assert.equal(q.c, `https://discord.com/channels/${GUILD}/${LAB}`);
  const m = db.members[0];
  assert.equal(m.email, "amy@example.com"); assert.equal(m.notify, true); assert.ok(m.notify_consent_at); assert.equal(m.joined_via, "discord");
  assert.equal(users[0].email, discordAuthEmail("111111111111111111"), "網站帳號用代號 Email");
  assert.ok(db.exchange_links.some((l) => l.user_id === m.user_id && l.exchange_uid === "817018337355330001"));
  assert.ok(db.member_discord.some((l) => l.user_id === m.user_id && l.discord_user_id === "111111111111111111"));
  const put = dcCalls.find((c) => c.m === "PUT" && c.p.endsWith("/members/111111111111111111"));
  assert.deepEqual(put.body, { access_token: "at-amy", roles: [ROLE] });
});
await test("同一個 UID 再來一次：第一步就擋下，請他用 Discord 登入", async () => {
  const r = await call(join, { body: { exchange: "OKX", uid: "817018337355330001" } });
  assert.equal(r.statusCode, 409); assert.match(r.body.error, /Discord 登入/);
});
await test("用 Discord 登入：連過的 → 帶登入代碼回網站、補身分組", async () => {
  const s = new URL((await call(login)).body.url).searchParams.get("state");
  assert.match(s, /^l\./);
  dcCalls.length = 0;
  const q = back(await call(callback, { method: "GET", query: { state: s, code: "amycode1234" } }));
  assert.equal(q.r, "login"); assert.ok(q.t);
  assert.ok(dcCalls.some((c) => c.m === "PUT" && c.p.endsWith(`/roles/${ROLE}`)), "已在伺服器：另外補身分組");
  assert.equal(db.members.length, 1, "不會多建帳號");
});
await test("用 Discord 登入：沒加入過的 Discord → 請他先填 UID，不建帳號", async () => {
  const s = new URL((await call(login)).body.url).searchParams.get("state");
  const q = back(await call(callback, { method: "GET", query: { state: s, code: "bobcode1234" } }));
  assert.equal(q.r, "err"); assert.match(q.m, /UID/); assert.equal(q.w, "join");
  assert.equal(db.members.length, 1);
});
await test("Discord 沒有 Email：照樣開通，名單 Email 先空著、不寄通知", async () => {
  const st = new URL((await call(join, { body: { exchange: "OKX", uid: "817018337355330005" } })).body.url).searchParams.get("state");
  const q = back(await call(callback, { method: "GET", query: { state: st, code: "bobcode1234" } }));
  assert.equal(q.r, "welcome");
  const m = db.members.find((x) => x.user_id === users[1].id);
  assert.equal(m.notify, false);
  tokens.tb = users[1];
  const g = await call(contact, { method: "GET", token: "tb" });
  assert.equal(g.body.email, "", "代號 Email 不給研究員看");
  tokens.ta = users[0];
  const ga = await call(contact, { method: "GET", token: "ta" });
  assert.equal(ga.body.email, "amy@example.com", "Discord 給的 Email 讀得到");
});
await test("成功頁改 Email、開通知", async () => {
  const bad = await call(contact, { token: "tb", body: { email: "nope" } });
  assert.equal(bad.statusCode, 400);
  const r = await call(contact, { token: "tb", body: { email: " Bob@Mail.com ", notify: true } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const m = db.members.find((x) => x.user_id === users[1].id);
  assert.equal(m.email, "bob@mail.com"); assert.equal(m.notify, true); assert.ok(m.notify_consent_at);
});
await test("state 被改過、過期：不開通", async () => {
  const q = back(await call(callback, { method: "GET", query: { state: joinState.replace("817018337355330001", "817018337355330005"), code: "amycode1234" } }));
  assert.equal(q.r, "err");
});

supa.close(); okx.close(); discord.close();
console.log(`\n加入培訓計畫（Discord 開通）：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
