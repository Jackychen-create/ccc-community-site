// v1.37.18：所有 Discord 機器人改名「研研（助理）」、換頭貼，今天的訊息用新名字再發一次
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { runRebrand, rebrandStatus, REBRAND } from "../server/lib/rebrand.js";

const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${s.address().port}`)));
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
const H1 = "123456789012345678", H2 = "223456789012345678", H3 = "323456789012345678";
const T1 = "a".repeat(30), T2 = "b".repeat(30);
const CH1 = "400000000000000001", CH2 = "400000000000000002", TH = "400000000000000009", GUILD = "500000000000000000";
const db = {
  settings: [
    { key: "bots", value: { outlets: [{ id: "o1", url: `https://discord.com/api/webhooks/${H1}/${T1}` }], bots: { tw: { outlet: "o1", thread: TH } } } },
    { key: "discord", value: { guildId: GUILD, chatChannels: [{ id: "300000000000000000", webhook: `https://discord.com/api/webhooks/${H2}/${T2}` }] } },
  ],
  bot_state: [],
};
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const table = u.pathname.split("/").pop();
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? d[0] ?? null : d)); };
  const key = (u.searchParams.get("key") || "").replace(/^eq\./, "");
  if (req.method === "GET") return send((db[table] || []).filter((r) => !key || r.key === key));
  const body = JSON.parse(await readBody(req));
  for (const row of [].concat(body)) { const i = db[table].findIndex((r) => r.key === row.key); if (i >= 0) db[table][i] = row; else db[table].push(row); }
  return send([].concat(body), 201);
});
const today = new Date().toISOString(), old = new Date(Date.now() - 5 * 864e5).toISOString();
const msgs = {
  [CH1]: [{ id: "m3", webhook_id: H1, timestamp: old, content: "台股入口", embeds: [{ type: "rich", title: "入口", footer: { text: "f", proxy_icon_url: "x", icon_url: "https://e/i.png" } }] }, { id: "m0", author: { bot: true }, timestamp: today, content: "別人的" }],
  [CH2]: [{ id: "m2", webhook_id: H2, timestamp: today, content: "", embeds: [{ type: "rich", title: "每日回顧 B" }] }, { id: "m1", webhook_id: H2, timestamp: today, content: "", embeds: [{ type: "rich", title: "每日回顧 A" }] }],
  [TH]: [],
};
const calls = [];
let seq = 0;
const disc = http.createServer(async (req, res) => {
  const body = await readBody(req);
  calls.push({ method: req.method, path: req.url, body });
  const json = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };
  const u = new URL(req.url, "http://x");
  if (u.pathname === `/guilds/${GUILD}/webhooks`) return json([{ id: H3, type: 1, token: "c".repeat(30), channel_id: CH1 }, { id: "9", type: 2 }]);
  const wh = u.pathname.match(/^\/webhooks\/(\d+)\/[\w-]+$/);
  if (wh && req.method === "PATCH") return json({ id: wh[1], channel_id: wh[1] === H1 ? CH1 : wh[1] === H2 ? CH2 : CH1 });
  if (wh && req.method === "POST") return json({ id: `new${++seq}` });
  const ch = u.pathname.match(/^\/channels\/(\d+)\/messages$/);
  if (ch) return json(msgs[ch[1]] || []);
  return json({});
});
const [SUPA, DISC] = await Promise.all([listen(supa), listen(disc)]);
if (!globalThis.WebSocket) globalThis.WebSocket = class {};
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "s", DISCORD_APP_ID: "111111111111111111", DISCORD_PUBLIC_KEY: "a".repeat(64), DISCORD_BOT_TOKEN: "bot", DISCORD_API_BASE: DISC });

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, e.message); } };

await test("機器人帳號：頭貼、名字、伺服器暱稱", async () => {
  const r = await runRebrand(Date.now());
  assert.equal(r.finished, true, JSON.stringify(await rebrandStatus()));
  const me = calls.filter((c) => c.method === "PATCH" && c.path === "/users/@me").map((c) => JSON.parse(c.body));
  assert.ok(me.some((b) => /^data:image\/png;base64,/.test(b.avatar)));
  assert.ok(me.some((b) => b.username === REBRAND.name));
  assert.ok(calls.some((c) => c.method === "PATCH" && c.path === `/guilds/${GUILD}/members/@me` && JSON.parse(c.body).nick === REBRAND.name));
});
await test("每個 Webhook（網站存的＋伺服器清單）都改名、換頭貼", async () => {
  for (const id of [H1, H2, H3]) {
    const c = calls.find((x) => x.method === "PATCH" && x.path.startsWith(`/webhooks/${id}/`));
    assert.ok(c, id); const b = JSON.parse(c.body); assert.equal(b.name, REBRAND.name); assert.match(b.avatar, /^data:image\/png/);
  }
});
await test("今天的訊息再發一次（今天沒有就最新一則），用新名字", async () => {
  const posts = calls.filter((c) => c.method === "POST" && /^\/webhooks\//.test(c.path));
  const titles = posts.map((p) => p.body.match(/"title":"([^"]+)"/)?.[1]);
  assert.deepEqual(titles.filter((t) => t?.startsWith("每日回顧")), ["每日回顧 A", "每日回顧 B"]);
  assert.ok(titles.includes("入口"));
  assert.ok(posts.every((p) => p.body.includes(REBRAND.name)));
  assert.ok(!posts.some((p) => p.body.includes("別人的")));
});
await test("做完就不再動", async () => {
  const n = calls.length;
  assert.deepEqual(await runRebrand(Date.now()), { finished: true });
  assert.equal(calls.length, n);
  const s = await rebrandStatus();
  assert.equal(s.webhooks.renamed, 3); assert.ok(!JSON.stringify(s).includes(T1));
});
supa.close(); disc.close();
process.exit(failed ? 1 : 0);
