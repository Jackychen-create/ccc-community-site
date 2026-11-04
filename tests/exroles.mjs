// v1.26.22：交易所活動身分組（例如 Bybit）
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { runExchangeRoles, exchangeRoleTargets, grantExchangeRole, exchangeRoleOf } from "../server/lib/exchange-roles.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => r(Buffer.concat(c).toString())); });
const ROLE = "1566785691034066974", GUILD = "1472994801078108265";
const db = {
  settings: [{ key: "discord", value: { guildId: GUILD, roleId: "1560542923173400596", exchangeRoles: { Bybit: ROLE, OKX: "not-an-id" } } }],
  bot_state: [],
  discord_applications: [
    { discord_user_id: "444444444444444401", status: "approved", exchange: "Bybit", invite_code: "B1" },
    { discord_user_id: "444444444444444402", status: "rejected", exchange: "Bybit" },
    { discord_user_id: "444444444444444403", status: "approved", exchange: "OKX", invite_code: "O1", exchange_uid: "1" },
    { discord_user_id: "444444444444444405", status: "approved", exchange: "Bybit", invite_code: "B2" }, // 已經離開伺服器
  ],
  exchange_links: [{ user_id: "u3", exchange: "Bybit", exchange_uid: "9" }, { user_id: "u9", exchange: "Bybit", exchange_uid: "8" }],
  members: [{ user_id: "u3", invite_code: "O1", banned: false }, { user_id: "u9", invite_code: null, banned: false }],
  member_discord: [{ user_id: "u9", discord_user_id: "444444444444444409" }],
};
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const t = u.pathname.split("/").pop();
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? d[0] ?? null : d)); };
  if (req.method === "GET") {
    let rows = db[t] || [];
    for (const [k, v] of u.searchParams) {
      if (["select", "order", "limit"].includes(k)) continue;
      const [op, ...rest] = v.split("."); const val = rest.join(".");
      if (op === "eq") rows = rows.filter((r) => String(r[k]) === val);
      if (op === "in") { const list = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")); rows = rows.filter((r) => list.includes(String(r[k]))); }
    }
    return send(rows);
  }
  const body = JSON.parse((await readBody(req)) || "null");
  for (const it of Array.isArray(body) ? body : [body]) { const i = db[t].findIndex((r) => r.key === it.key); if (i >= 0) db[t][i] = { ...db[t][i], ...it }; else db[t].push(it); }
  return send([body], 201);
});
const puts = [];
const disc = http.createServer((req, res) => {
  puts.push(`${req.method} ${req.url}`);
  if (req.url.includes("444444444444444405")) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ message: "Unknown Member", code: 10007 })); }
  res.writeHead(204); res.end();
});
const [SUPA, DISC] = await Promise.all([listen(supa), listen(disc)]);
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test", DISCORD_API_BASE: DISC, DISCORD_BOT_TOKEN: "t", DISCORD_APP_ID: "1", DISCORD_PUBLIC_KEY: "k" });

await test("設定：身分組 ID 格式不對就當沒設", () => {
  const s = db.settings[0].value;
  assert.equal(exchangeRoleOf(s, "Bybit"), ROLE);
  assert.equal(exchangeRoleOf(s, "OKX"), null);
  assert.equal(exchangeRoleOf(s, "BingX"), null);
});
await test("誰該有 Bybit 身分組：用 Bybit 報名通過的＋網站綁了 Bybit UID、對得到 Discord 的", async () => {
  const t = (await exchangeRoleTargets("Bybit")).sort();
  assert.deepEqual(t, ["444444444444444401", "444444444444444403", "444444444444444405", "444444444444444409"]);
});
await test("每小時補發：給身分組；離開伺服器的記下來不再試", async () => {
  assert.equal(await runExchangeRoles(Date.parse("2026-11-04T02:30:00Z")), null); // 不是整點前 5 分鐘
  const r = await runExchangeRoles(Date.parse("2026-11-04T03:01:00Z"));
  assert.equal(r.Bybit.granted, 3, JSON.stringify(r));
  assert.ok(puts.includes(`PUT /guilds/${GUILD}/members/444444444444444401/roles/${ROLE}`));
  assert.ok(!r.OKX);
  const g = db.bot_state.find((x) => x.key === "exchange_roles_granted").value[`Bybit:${ROLE}`];
  assert.equal(g["444444444444444405"], "left");
});
await test("下一次只給新的人", async () => {
  const n = puts.length;
  db.discord_applications.push({ discord_user_id: "444444444444444406", status: "approved", exchange: "Bybit" });
  const r = await runExchangeRoles(0, { force: true });
  assert.equal(r.Bybit.granted, 1);
  assert.equal(puts.length, n + 1);
});
await test("報名通過當下：Bybit 給、別間不給", async () => {
  const s = db.settings[0].value;
  const n = puts.length;
  assert.equal(await grantExchangeRole(s, GUILD, "444444444444444407", "Bybit"), true);
  assert.equal(await grantExchangeRole(s, GUILD, "444444444444444407", "BingX"), false);
  assert.equal(puts.length, n + 1);
});

console.log(`\n${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
