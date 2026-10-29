// 交易檢討投稿：假的 Discord（訊息、🔍 反應、誰按的、私訊）、假的 Supabase，整個流程跑一遍
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv } from "../server/lib/env.js";
import { snowflakeAt } from "../server/lib/chatlog.js";
import { collectSubmissions, runWeeklyReviews, markReviewed, maybeWeeklyReviews, publicNotice, loadReviews, emojiText } from "../server/lib/reviews.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => r(Buffer.concat(c).toString())); });

const db = { settings: [], bot_state: [] };
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const table = u.pathname.split("/").pop();
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? d[0] ?? null : d)); };
  if (req.method === "GET") { const key = u.searchParams.get("key"); return send(db[table].filter((r) => !key || r.key === key.replace(/^eq\./, ""))); }
  const body = JSON.parse((await readBody(req)) || "null");
  for (const it of Array.isArray(body) ? body : [body]) { const i = db[table].findIndex((r) => r.key === it.key); if (i >= 0) db[table][i] = { ...db[table][i], ...it }; else db[table].push(it); }
  return send(Array.isArray(body) ? body : [body], 201);
});

// 2026-11-01 是週日；21:03 台灣時間
const NOW = Date.parse("2026-11-01T13:03:00Z");
const PERF = "100000000000000011", REVIEW = "100000000000000008", PUB = "100000000000000012";
const AMY = { id: "111111111111111111", username: "amy", global_name: "Amy" }, BOB = { id: "222222222222222222", username: "bob" }, BOT = { id: "999999999999999999", username: "bot", bot: true };
let seq = 0;
const msg = (ms, author, content, react = null, extra = {}) => ({ id: String(BigInt(snowflakeAt(ms)) + BigInt(++seq)), timestamp: new Date(ms).toISOString(), author, content, attachments: [], reactions: react ? [{ emoji: typeof react.emoji === "string" ? { name: react.emoji, id: null } : react.emoji, count: react.by.length }] : [], _by: react?.by || [], ...extra });
const H = 3600e3;
const perf = [
  msg(NOW - 8 * 86400e3, AMY, "八天前的不算", { emoji: "🔍", by: [AMY] }),
  msg(NOW - 50 * H, AMY, "NQ 開盤追空被掃，想請講師看進場點", { emoji: "🔍", by: [AMY] }, { attachments: [{ filename: "a.png" }] }),
  msg(NOW - 40 * H, BOB, "別人按的也算", { emoji: "🔍", by: [AMY] }),
  msg(NOW - 30 * H, BOB, "", { emoji: "🔎", by: [BOB, AMY] }, { attachments: [{ filename: "b.png" }, { filename: "c.png" }] }),
  msg(NOW - 20 * H, AMY, "沒按的不算"),
  msg(NOW - 10 * H, BOT, "機器人的不算", { emoji: "🔍", by: [BOT] }),
  msg(NOW - 5 * H, AMY, "按別的表情不算", { emoji: "👍", by: [AMY] }),
];
const posted = [], dms = [];
let dmFail = new Set();
const disc = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (d, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };
  const body = req.method === "POST" ? JSON.parse((await readBody(req)) || "null") : null;
  if (u.pathname === "/users/@me/channels") { if (dmFail.has(body.recipient_id)) return send({ message: "Cannot send messages to this user", code: 50007 }, 403); return send({ id: "7" + body.recipient_id.slice(1) }); }
  const r = u.pathname.match(/^\/channels\/(\d+)\/messages\/(\d+)\/reactions\/([^/]+)$/);
  if (r) { const m = perf.find((x) => x.id === r[2]); const e = decodeURIComponent(r[3]); const re = m?.reactions[0]?.emoji;
    return send(re && (re.id ? `${re.name}:${re.id}` : re.name) === e ? m._by.map((a) => ({ id: a.id, username: a.username })) : []); }
  const m = u.pathname.match(/^\/channels\/(\d+)(\/messages)?$/);
  if (!m) return send({ message: "not found" }, 404);
  if (req.method === "POST") {
    if (m[1].startsWith("7")) dms.push({ to: "1" + m[1].slice(1), content: body.content }); else posted.push({ channel: m[1], body });
    return send({ id: "5" });
  }
  if (!m[2]) return send({ id: m[1], name: m[1] === PERF ? "交易績效" : "其他" });
  const after = BigInt(u.searchParams.get("after") || "0");
  const list = (m[1] === PERF ? perf : []).filter((x) => BigInt(x.id) > after).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).slice(0, Number(u.searchParams.get("limit") || 50)).reverse()
    .map(({ _by, ...x }) => x);
  return send(list);
});

const [SUPA, DISC] = await Promise.all([listen(supa), listen(disc)]);
setEnv({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test", DISCORD_API_BASE: DISC, DISCORD_BOT_TOKEN: "t", DISCORD_APP_ID: "1", DISCORD_PUBLIC_KEY: "k" });

await test("投票：只算這 7 天、誰按 🔍／🔎 都算一票；機器人的貼文、別的表情不算；票多的排前面", async () => {
  const items = await collectSubmissions(PERF, NOW);
  assert.deepEqual(items.map((x) => [x.authorName, x.text, x.votes]), [["bob", "", 2], ["Amy", "NQ 開盤追空被掃，想請講師看進場點", 1], ["bob", "別人按的也算", 1]]);
  assert.ok(items.every((x) => x.reviewed === false && x.channel === PERF));
});
await test("還沒設定交易績效頻道：不跑", async () => {
  const r = await runWeeklyReviews(NOW);
  assert.equal(r.ok, false);
});
db.settings.push({ key: "discord", value: { guildId: "900000000000000000", reviewChannelId: REVIEW, perfChannelId: PERF, reviewPublicChannelId: PUB } });
await test("週日整理：講師清單貼到審核頻道、公開只貼筆數、每個投稿的人收到私訊", async () => {
  dmFail = new Set([BOB.id]);
  const r = await runWeeklyReviews(NOW);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.week, r.count, r.fresh, r.dms], ["2026-11-01", 3, 3, 1]); // Bob 關私訊，不影響
  const host = posted.find((p) => p.channel === REVIEW), pub = posted.find((p) => p.channel === PUB);
  assert.ok(host && pub, posted.map((p) => p.channel).join());
  const he = JSON.stringify(host.body);
  assert.ok(he.includes("Amy") && he.includes("NQ 開盤追空") && he.includes(`https://discord.com/channels/900000000000000000/${PERF}/`), he);
  assert.deepEqual(host.body.allowed_mentions, { parse: [] });
  const pe = JSON.stringify(pub.body);
  assert.ok(pe.includes("本週有 3 筆") && he.includes("2 票"), pe);
  assert.ok(!pe.includes("Amy") && !pe.includes("bob") && !pe.includes("NQ 開盤追空") && !pe.includes("discord.com/channels"), "公開通知不能有名字、內容、連結：" + pe);
  assert.ok(pe.includes("#交易績效"));
  assert.equal(dms.length, 1); assert.equal(dms[0].to, AMY.id); assert.ok(dms[0].content.includes("1 票"));
});
await test("同一週排程再叫一次：不重複", async () => {
  const before = [posted.length, dms.length];
  const r = await runWeeklyReviews(NOW + 5 * 60e3);
  assert.ok(r.skipped, JSON.stringify(r));
  assert.deepEqual([posted.length, dms.length], before);
});
await test("後台「立即整理」：沒有新投稿就不再貼公開通知、不再私訊", async () => {
  const before = [posted.length, dms.length];
  const r = await runWeeklyReviews(NOW + 10 * 60e3, { force: true });
  assert.equal(r.fresh, 0);
  assert.deepEqual([posted.length, dms.length], before);
});
await test("下一週：上週投過的不會再算一次，只算新的", async () => {
  perf.push(msg(NOW + 3 * 86400e3, BOB, "下週新的一筆", { emoji: "🔍", by: [BOB] }));
  dmFail = new Set();
  const r = await runWeeklyReviews(NOW + 7 * 86400e3);
  assert.equal(r.week, "2026-11-08");
  assert.deepEqual([r.count, r.fresh], [1, 1], JSON.stringify(r));
  const st = await loadReviews();
  assert.deepEqual(Object.keys(st.weeks).sort(), ["2026-11-01", "2026-11-08"]);
});
await test("勾已點評：第一次私訊投稿的人，取消再勾不重複私訊", async () => {
  const st = await loadReviews();
  const it = st.weeks["2026-11-01"].items.find((x) => x.author === AMY.id);
  const n = dms.length;
  assert.equal((await markReviewed("2026-11-01", it.id, true)).ok, true);
  assert.equal(dms.length, n + 1); assert.ok(dms.at(-1).content.includes("點評了") && dms.at(-1).to === AMY.id);
  await markReviewed("2026-11-01", it.id, false);
  assert.equal((await loadReviews()).weeks["2026-11-01"].items.find((x) => x.id === it.id).reviewed, false);
  await markReviewed("2026-11-01", it.id, true);
  assert.equal(dms.length, n + 1);
  assert.equal((await markReviewed("2026-11-01", "1", true)).ok, false);
});
await test("週中按「立即整理」也算到這週日那一週", async () => {
  perf.push(msg(NOW + 10 * 86400e3, AMY, "週三的", { emoji: "🔍", by: [AMY] }));
  const r = await runWeeklyReviews(NOW + 10 * 86400e3 + 60e3, { force: true }); // 11/11 週三
  assert.equal(r.week, "2026-11-15");
  assert.equal(r.fresh, 1);
  const n = posted.length;
  const sun = await runWeeklyReviews(Date.parse("2026-11-15T13:01:00Z")); // 週日排程照樣整理、貼公開筆數
  assert.ok(!sun.skipped, JSON.stringify(sun));
  assert.deepEqual([sun.count, sun.fresh], [1, 0]);
  assert.ok(posted.slice(n).some((p) => p.channel === PUB && JSON.stringify(p.body).includes("本週有 1 筆")));
  assert.ok((await runWeeklyReviews(Date.parse("2026-11-15T13:06:00Z"))).skipped);
});
await test("排程時間：只有週日 21:00–21:10（台灣時間）會跑", async () => {
  assert.equal(await maybeWeeklyReviews(Date.parse("2026-11-01T12:59:00Z")), null); // 20:59
  assert.equal(await maybeWeeklyReviews(Date.parse("2026-11-01T13:10:00Z")), null); // 21:10
  assert.equal(await maybeWeeklyReviews(Date.parse("2026-11-02T13:03:00Z")), null); // 週一
  const r = await maybeWeeklyReviews(Date.parse("2026-11-22T13:00:00Z"));
  assert.equal(r?.ok, true); assert.equal(r.week, "2026-11-22");
});
await test("週中整理後票數變多：週日再整理會更新票數", async () => {
  const m = perf.find((x) => x.content === "週三的");
  m.reactions[0].count = 4;
  const st = await loadReviews();
  assert.equal(st.weeks["2026-11-15"].items[0].votes, 1);
  await runWeeklyReviews(Date.parse("2026-11-15T13:20:00Z"), { force: true });
  assert.equal((await loadReviews()).weeks["2026-11-15"].items[0].votes, 4);
});
await test("自訂投稿表情（伺服器的熊熊）：按熊熊算、放大鏡就不算了；公開通知顯示熊熊", async () => {
  const BEAR = { name: "bear_ok", id: "800000000000000001" };
  const T = Date.parse("2026-12-06T13:03:00Z");
  perf.push(msg(T - 2 * H, AMY, "按熊熊投稿", { emoji: BEAR, by: [AMY] }));
  perf.push(msg(T - 1 * H, BOB, "按放大鏡", { emoji: "🔍", by: [BOB] }));
  perf.push(msg(T - 1 * H + 1, BOB, "按別的自訂表情", { emoji: { name: "bear_ok", id: "800000000000000002" }, by: [BOB] }));
  const items = await collectSubmissions(PERF, T, { emojis: [BEAR] });
  assert.deepEqual(items.map((x) => x.text), ["按熊熊投稿"]);
  const both = await collectSubmissions(PERF, T, { emojis: [BEAR, { name: "🔍" }] });
  assert.deepEqual(both.map((x) => x.text), ["按熊熊投稿", "按放大鏡"]);
  assert.equal(emojiText(BEAR), "<:bear_ok:800000000000000001>");
  assert.ok(JSON.stringify(publicNotice("2026-12-06", 1, "績效", [BEAR])).includes("<:bear_ok:800000000000000001>"));
});
await test("公開通知沒有任何個人資料", () => {
  const e = JSON.stringify(publicNotice("2026-11-01", 3, "交易績效"));
  assert.ok(e.includes("3 筆") && e.includes("🔍") && e.includes("別人的都可以"));
});

console.log(`\n${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
