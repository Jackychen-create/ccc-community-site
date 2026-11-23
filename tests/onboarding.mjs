// 新人試用週：假的 Supabase（報名、研究員、設定、bot_state）、假的 Discord（私訊）
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { runOnboarding, onboardingStep, onboardingDue } from "../server/lib/onboarding.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => r(Buffer.concat(c).toString())); });

// 台灣 11/2 20:03
const NOW = Date.parse("2026-11-02T12:03:00Z");
const D = 86400e3;
const db = {
  settings: [{ key: "discord", value: { onboardingOn: true, onboardingSince: "2026-10-20T00:00:00Z", perfChannelId: "100000000000000011", highlightChannelId: "100000000000000013", labChannelId: "100000000000000014", reviewEmojis: [{ id: "800000000000000001", name: "13_" }] } }],
  bot_state: [],
  members: [{ invite_code: "USED-0001" }],
  discord_applications: [
    { discord_user_id: "111111111111111101", discord_name: "昨天通過・沒註冊", invite_code: "NEW-0001", status: "approved", reviewed_at: new Date(NOW - 1 * D).toISOString() },
    { discord_user_id: "111111111111111102", discord_name: "昨天通過・已註冊", invite_code: "USED-0001", status: "approved", reviewed_at: new Date(NOW - 1 * D).toISOString() },
    { discord_user_id: "111111111111111103", discord_name: "三天前", invite_code: "X", status: "approved", reviewed_at: new Date(NOW - 3 * D).toISOString() },
    { discord_user_id: "111111111111111104", discord_name: "今天剛通過", invite_code: "Y", status: "approved", reviewed_at: new Date(NOW - 3600e3).toISOString() },
    { discord_user_id: "111111111111111105", discord_name: "十天前", invite_code: "Z", status: "approved", reviewed_at: new Date(NOW - 10 * D).toISOString() },
    { discord_user_id: "111111111111111106", discord_name: "沒通過", invite_code: null, status: "rejected", reviewed_at: new Date(NOW - 1 * D).toISOString() },
    { discord_user_id: "111111111111111107", discord_name: "關私訊", invite_code: "W", status: "approved", reviewed_at: new Date(NOW - 2 * D).toISOString() },
  ],
};
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const table = u.pathname.split("/").pop();
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? d[0] ?? null : d)); };
  if (req.method === "GET") {
    let rows = db[table];
    for (const [k, v] of u.searchParams) {
      if (["select", "order", "limit"].includes(k)) continue;
      const [op, ...rest] = v.split("."); const val = rest.join(".");
      if (op === "eq") rows = rows.filter((r) => String(r[k]) === val);
      if (op === "gte") rows = rows.filter((r) => Date.parse(r[k]) >= Date.parse(val));
      if (op === "in") { const list = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")); rows = rows.filter((r) => list.includes(String(r[k]))); }
    }
    return send(rows);
  }
  const body = JSON.parse((await readBody(req)) || "null");
  for (const it of Array.isArray(body) ? body : [body]) { const i = db[table].findIndex((r) => r.key === it.key); if (i >= 0) db[table][i] = { ...db[table][i], ...it }; else db[table].push(it); }
  return send(Array.isArray(body) ? body : [body], 201);
});
const dms = [];
const disc = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };
  const body = JSON.parse((await readBody(req)) || "null");
  if (u.pathname === "/users/@me/channels") return body.recipient_id === "111111111111111107" ? send({ message: "Cannot send messages to this user", code: 50007 }, 403) : send({ id: "7" + body.recipient_id.slice(1) });
  const m = u.pathname.match(/^\/channels\/(\d+)\/messages$/);
  if (m) { dms.push({ to: "1" + m[1].slice(1), body }); return send({ id: "5" }); }
  return send({ message: "not found" }, 404);
});
const [SUPA, DISC] = await Promise.all([listen(supa), listen(disc)]);
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test", DISCORD_API_BASE: DISC, DISCORD_BOT_TOKEN: "t", DISCORD_APP_ID: "1", DISCORD_PUBLIC_KEY: "k" });

const title = (to) => dms.filter((d) => d.to === to).map((d) => d.body.embeds[0].title);

await test("不是晚上 8 點：不發", async () => {
  assert.equal(await runOnboarding(NOW - 3600e3), null);
  assert.equal(await runOnboarding(NOW + 10 * 60e3), null);
  assert.equal(dms.length, 0);
});
await test("晚上 8 點：通過後第 1～7 天的人各收到當天那一則；今天剛通過、十天前、沒通過的不發", async () => {
  const r = await runOnboarding(NOW);
  assert.equal(r.sent, 3, JSON.stringify(r));
  assert.deepEqual(title("111111111111111101"), ["第 1 天｜先把研究員專區註冊好"]);
  assert.deepEqual(title("111111111111111102"), ["第 1 天｜從系統分享開始"]);
  assert.deepEqual(title("111111111111111103"), ["第 3 天｜想聽主講點評你的交易？"]);
  assert.equal(dms.filter((d) => ["111111111111111104", "111111111111111105", "111111111111111106"].includes(d.to)).length, 0);
  assert.equal(r.failed.length, 1); assert.equal(r.failed[0].day, 2); // 關私訊的略過
});
await test("沒註冊的第 1 天附自己的加入連結；第 3 天寫績效頻道和熊熊表情；不 @ 任何人", () => {
  const d1 = dms.find((d) => d.to === "111111111111111101").body;
  assert.ok(d1.embeds[0].description.includes("/lab?invite=NEW-0001"));
  const d3 = dms.find((d) => d.to === "111111111111111103").body;
  assert.ok(d3.embeds[0].description.includes("<#100000000000000011>") && d3.embeds[0].description.includes("<:13_:800000000000000001>"));
  assert.deepEqual(d3.allowed_mentions, { parse: [] });
});
await test("同一天再跑：不重複", async () => {
  const n = dms.length;
  const r = await runOnboarding(NOW + 5 * 60e3);
  assert.equal(r.sent, 0); assert.equal(dms.length, n);
});
await test("隔天：收到下一天", async () => {
  await runOnboarding(NOW + D);
  assert.deepEqual(title("111111111111111101"), ["第 1 天｜先把研究員專區註冊好", "第 2 天｜直播和直播精華"]);
  assert.equal(title("111111111111111104").length, 1); assert.ok(title("111111111111111104")[0].startsWith("第 1 天")); // 昨天剛通過的人今天收第 1 天
});
await test("第 7 天之後就不發了", async () => {
  const { people } = await onboardingDue(NOW + 8 * D);
  assert.ok(people.every((p) => p.day <= 7));
  assert.ok(!people.some((p) => p.discord_user_id === "111111111111111103"));
});
await test("後台打開之前通過的人不發", async () => {
  db.settings[0].value.onboardingSince = new Date(NOW - 2 * D).toISOString();
  const { people } = await onboardingDue(NOW);
  assert.ok(!people.some((p) => p.discord_user_id === "111111111111111103"));
});
await test("關掉就不發", async () => {
  db.settings[0].value.onboardingOn = false;
  const r = await runOnboarding(NOW + 2 * D);
  assert.equal(r.sent, 0);
});
await test("7 天內容都有", () => {
  for (let d = 1; d <= 7; d++) assert.ok(onboardingStep(d, {}, {}).title.startsWith(`第 ${d} 天`));
  assert.equal(onboardingStep(8, {}, {}), null);
});

console.log(`\n${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
