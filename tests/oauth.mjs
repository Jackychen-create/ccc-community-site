// v1.35.0：一鍵連結 Discord（OAuth）：state 簽章、換 token、加進伺服器、給身分組
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { makeState, readState, finishOAuth, authorizeUrl } from "../server/lib/discord-oauth.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

const U1 = "00000000-0000-4000-8000-000000000001", U2 = "00000000-0000-4000-8000-000000000002";
const db = { member_discord: [{ user_id: U2, discord_user_id: "222222222222222222" }], members: [{ user_id: U1, banned: false, created_at: "2026-10-01T00:00:00Z" }, { user_id: U2, banned: false }], settings: [{ key: "discord", value: { guildId: "100000000000000001", roleId: "100000000000000002" } }], payments: [], subscriptions: [] };
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };
  const table = u.pathname.split("/").pop();
  const rows = db[table] || [];
  const filt = [...u.searchParams].filter(([k]) => !["select", "order", "limit", "on_conflict"].includes(k));
  const match = (r) => filt.every(([k, v]) => !v.startsWith("eq.") || String(r[k]) === v.slice(3));
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  if (req.method === "GET") { const out = rows.filter(match); return send(one ? out[0] ?? null : out); }
  if (req.method === "POST") { const b = JSON.parse(await readBody(req)); for (const it of [].concat(b)) { const i = rows.findIndex((r) => r.user_id === it.user_id); if (i >= 0) rows[i] = { ...rows[i], ...it }; else rows.push(it); } db[table] = rows; return send(b, 201); }
  return send([]);
});
const calls = [];
let inGuild = false;
const discord = http.createServer(async (req, res) => {
  const body = await readBody(req);
  calls.push({ m: req.method, p: req.url, body, auth: req.headers.authorization });
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(d === null ? "" : JSON.stringify(d)); };
  if (req.url === "/oauth2/token") return new URLSearchParams(body).get("code") === "good" ? send({ access_token: "at-1", token_type: "Bearer" }) : send({ error: "invalid_grant" }, 400);
  if (req.url === "/users/@me") return send({ id: req.headers.authorization === "Bearer at-1" ? "111111111111111111" : "0", username: "amy", global_name: "Amy" });
  if (req.method === "PUT" && /\/guilds\/\d+\/members\/\d+$/.test(req.url)) { if (inGuild) { res.writeHead(204); return res.end(); } inGuild = true; return send({ user: {} }, 201); }
  if (req.method === "PUT" && /\/roles\//.test(req.url)) { res.writeHead(204); return res.end(); }
  return send({ message: "?" }, 404);
});
const SUPA = await listen(supa), DC = await listen(discord);
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "x", DISCORD_APP_ID: "999", DISCORD_CLIENT_SECRET: "sec", DISCORD_BOT_TOKEN: "bot", DISCORD_API_BASE: DC });

await test("state：自己簽的才認、過期不認、改過不認", async () => {
  const s = await makeState(U1);
  assert.equal(await readState(s), U1);
  assert.equal(await readState(s, Date.now() + 11 * 60e3), null);
  assert.equal(await readState(s.replace(U1, U2)), null);
  assert.equal(await readState("abc"), null);
});
await test("授權網址：要 identify、guilds.join，回網站的網址固定", async () => {
  const u = new URL(await authorizeUrl(U1));
  assert.equal(u.searchParams.get("scope"), "identify guilds.join");
  assert.equal(u.searchParams.get("redirect_uri"), "https://ccc-community-site.pages.dev/api/discord-oauth/callback");
});
await test("不在伺服器：加進去、同時帶研究員身分組", async () => {
  const r = await finishOAuth(U1, "good");
  assert.deepEqual([r.ok, r.joined, r.role, r.name], [true, "joined", true, "Amy"]);
  const put = calls.find((c) => c.m === "PUT" && c.p.endsWith("/members/111111111111111111"));
  assert.deepEqual(JSON.parse(put.body), { access_token: "at-1", roles: ["100000000000000002"] });
  assert.equal(put.auth, "Bot bot");
  assert.ok(db.member_discord.some((x) => x.user_id === U1 && x.discord_user_id === "111111111111111111"));
});
await test("已經在伺服器：另外補身分組", async () => {
  calls.length = 0;
  const r = await finishOAuth(U1, "good");
  assert.equal(r.joined, "already");
  assert.ok(calls.some((c) => c.m === "PUT" && c.p.endsWith("/roles/100000000000000002")));
});
await test("授權碼不對：不連", async () => {
  assert.equal((await finishOAuth(U1, "bad")).ok, false);
});
await test("這個 Discord 已經連在別人身上：不連", async () => {
  db.member_discord.push({ user_id: U2, discord_user_id: "111111111111111111" });
  db.member_discord = db.member_discord.filter((x) => x.user_id !== U1);
  const r = await finishOAuth(U1, "good");
  assert.equal(r.ok, false); assert.match(r.error, /別的研究員/);
});

supa.close(); discord.close();
console.log(`\n一鍵連結 Discord：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
