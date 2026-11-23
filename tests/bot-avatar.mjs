// v1.37.16：每個自動化 Discord 機器人的頭貼（機器人帳號 + 網站存的每個 Webhook）換成貓頭鷹
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { syncBotAvatar, BOT_AVATAR } from "../server/lib/discord-setup.js";

const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${s.address().port}`)));
const readJson = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b)); } catch { r(null); } }); });
const HOOK1 = "https://discord.com/api/webhooks/123456789012345678/" + "a".repeat(30);
const HOOK2 = "https://discord.com/api/webhooks/223456789012345678/" + "b".repeat(30);
const db = {
  settings: [{ key: "bots", value: { outlets: [{ id: "o1", url: HOOK1 }] } }, { key: "discord", value: { chatChannels: [{ id: "300000000000000000", webhook: HOOK2 }] } }],
  bot_state: [],
};
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const table = u.pathname.split("/").pop();
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? d[0] ?? null : d)); };
  const key = (u.searchParams.get("key") || "").replace(/^eq\./, "");
  if (req.method === "GET") return send((db[table] || []).filter((r) => !key || r.key === key));
  const body = await readJson(req);
  for (const row of [].concat(body)) { const i = db[table].findIndex((r) => r.key === row.key); if (i >= 0) db[table][i] = row; else db[table].push(row); }
  return send([].concat(body), 201);
});
const calls = [];
const disc = http.createServer(async (req, res) => {
  calls.push({ method: req.method, path: req.url, body: await readJson(req) });
  res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}");
});
const [SUPA, DISC] = await Promise.all([listen(supa), listen(disc)]);
if (!globalThis.WebSocket) globalThis.WebSocket = class {};
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "s", DISCORD_APP_ID: "111111111111111111", DISCORD_PUBLIC_KEY: "a".repeat(64), DISCORD_BOT_TOKEN: "bot", DISCORD_API_BASE: DISC });
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => String(url).endsWith(BOT_AVATAR.path) ? Promise.resolve(new Response(new Uint8Array([137, 80, 78, 71]))) : realFetch(url, init);

const r = await syncBotAvatar(Date.now());
assert.equal(r.bot, true, JSON.stringify(r));
assert.equal(r.webhooks, 2, JSON.stringify(r));
const me = calls.find((c) => c.path === "/users/@me");
assert.equal(me.method, "PATCH"); assert.match(me.body.avatar, /^data:image\/png;base64,/);
assert.ok(calls.some((c) => c.method === "PATCH" && c.path.startsWith("/webhooks/123456789012345678/")));
assert.ok(calls.some((c) => c.method === "PATCH" && c.path.startsWith("/webhooks/223456789012345678/")));
const n = calls.length;
assert.equal((await syncBotAvatar(Date.now())).updated, false);
assert.equal(calls.length, n, "換過的不再換");
console.log("PASS 機器人和 Webhook 頭貼換成貓頭鷹，換過的不再換");
supa.close(); disc.close();
