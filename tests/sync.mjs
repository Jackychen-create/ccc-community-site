// 自動同步交易量（每人一輪）＋後台「交易量」「待跟進」、研究員 /api/me：用假的 Supabase、BingX、Bybit 跑真的伺服器程式
import assert from "node:assert/strict";
import http from "node:http";
import { setEnv, env } from "../server/lib/env.js";
import { syncBingx } from "../server/lib/bingx-sync.js";
import { syncBybit } from "../server/lib/bybit-sync.js";
import { periodOf, nextPeriod, prevPeriod, addDays } from "../public/assets/js/shared/rules.js";
import { todayTW } from "../server/lib/dates.js";
import followup from "../server/admin/followup.js";
import adminVolumes from "../server/admin/volumes.js";
import me from "../server/me.js";
import { milestoneText } from "../server/lib/milestone.js";
import { memberTier } from "../server/lib/tier.js";
import course from "../server/course.js";
import videosApi from "../server/videos.js";
import oneonone from "../server/oneonone.js";
import adminOneonone from "../server/admin/oneonone.js";
import questsApi from "../server/quests.js";
import adminBots from "../server/admin/bots.js";
import adminMembership from "../server/admin/membership.js";
import cronSync from "../server/cron/sync.js";
import { thisMonthTW } from "../server/lib/dates.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name + "：" + e.message); }
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const readJson = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(b ? JSON.parse(b) : null); } catch { r(null); } }); });

// ── 假的 Supabase（PostgREST）──
const db = { members: [], exchange_links: [], volumes: [], milestones: [], one_on_ones: [], checkins: [], quest_weeks: [], bot_runs: [], notes: [], discord_applications: [], videos: [], feedback: [], watch_progress: [], settings: [{ key: "volume_threshold", value: 1000000 }] };
const tokens = { "tok-admin": { id: "admin-1", email: "boss@gmail.com", email_confirmed_at: "2026-01-01T00:00:00Z" } };
const writes = [];
function parseFilters(sp) {
  return [...sp].filter(([k]) => !["select", "order", "limit", "on_conflict", "columns"].includes(k)).map(([col, v]) => {
    const i = v.indexOf(".");
    return { col, op: v.slice(0, i), val: v.slice(i + 1) };
  });
}
const match = (row, fs) => fs.every(({ col, op, val }) => {
  const x = row[col] == null ? null : String(row[col]);
  if (op === "eq") return x === val;
  if (op === "neq") return x !== val;
  if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")).includes(x);
  if (op === "gte") return x !== null && x >= val;
  if (op === "lte") return x !== null && x <= val;
  if (op === "not") return val === "is.null" ? x !== null : true;
  if (op === "is") return val === "null" ? x === null : true;
  return true;
});
const supa = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/auth/v1/user") {
    const user = tokens[(req.headers.authorization || "").replace("Bearer ", "")];
    res.writeHead(user ? 200 : 401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(user || { message: "invalid" }));
  }
  if (u.pathname.startsWith("/rest/v1/rpc/")) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("[]"); }
  const table = u.pathname.split("/").pop();
  if (req.method === "HEAD") { const n = (db[table] || []).filter((r) => match(r, parseFilters(u.searchParams))).length; res.writeHead(200, { "Content-Range": `0-${Math.max(0, n - 1)}/${n}` }); return res.end(); }
  const rows = db[table];
  const one = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const send = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(one ? data[0] ?? null : data)); };
  if (!rows) return send([], 404);
  const fs = parseFilters(u.searchParams);
  if (req.method === "GET") return send(rows.filter((r) => match(r, fs)));
  const body = await readJson(req);
  if (req.method === "POST") {
    const conflict = (u.searchParams.get("on_conflict") || (table === "settings" ? "key" : "")).split(",").filter(Boolean);
    const out = [];
    for (const it of Array.isArray(body) ? body : [body]) {
      const i = conflict.length ? rows.findIndex((r) => conflict.every((c) => String(r[c]) === String(it[c]))) : -1;
      if (i >= 0) rows[i] = { ...rows[i], ...it }; else rows.push({ ...it });
      out.push(it);
      writes.push({ table, row: it });
    }
    return send(out, 201);
  }
  if (req.method === "PATCH") {
    const hit = rows.filter((r) => match(r, fs));
    for (const r of hit) Object.assign(r, body);
    writes.push({ table, patch: body, n: hit.length });
    return send(hit);
  }
  send([], 405);
});

// ── 假的 BingX：每天的明細 ──
let bingxRows = [];
let bingxHits = 0;
const bingx = http.createServer((req, res) => {
  bingxHits++;
  const sp = new URL(req.url, "http://x").searchParams;
  const ymd = (ms) => new Date(Number(ms) + 8 * 3600e3).toISOString().slice(0, 10).replaceAll("-", "");
  // 真的 BingX 要毫秒時間戳；傳 YYYYMMDD 會回 beginTime-over-366
  if (!/^\d{13}$/.test(sp.get("startTime") || "")) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ code: 100400, msg: "beginTime-over-366. The query time range cannot exceed 366 days" })); }
  const s = ymd(sp.get("startTime")), e = ymd(sp.get("endTime")), uid = sp.get("uid");
  const list = bingxRows.filter((r) => ymd(r.commissionTime) >= s && ymd(r.commissionTime) <= e && (!uid || String(r.uid) === uid));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ code: 0, data: { list, total: list.length } }));
});
// ── 假的 Bybit：一段期間的加總 ──
let bybitVol = {}; // uid → (start,end) → tradeVol
const bybitQueries = [];
const bybit = http.createServer((req, res) => {
  const sp = new URL(req.url, "http://x").searchParams;
  const s = sp.get("startDate"), e = sp.get("endDate");
  bybitQueries.push(`${s}:${e}`);
  const list = Object.entries(bybitVol).map(([userId, f]) => ({ userId, tradeVol: String(f(s, e)) }));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ retCode: 0, retMsg: "OK", result: { list, nextPageCursor: "" } }));
});

const [SUPA, BX, BY] = await Promise.all([listen(supa), listen(bingx), listen(bybit)]);
setEnv({
  SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-test",
  BINGX_API_KEY: "k", BINGX_SECRET_KEY: "s", BINGX_BASE_URL: BX,
  BYBIT_API_KEY: "k", BYBIT_SECRET_KEY: "s", BYBIT_BASE_URL: BY, ADMIN_EMAILS: "boss@gmail.com", CRON_SECRET: "cron-test",
});
if (!globalThis.WebSocket) globalThis.WebSocket = class {};

const today = todayTW();
// 台灣某天中午的時間戳記
const at = (d) => Date.parse(d + "T04:00:00Z");
const member = (id, joined, extra = {}) => ({ user_id: id, email: `${id}@example.com`, banned: false, note: null, notify: true, created_at: new Date(at(joined)).toISOString(), min_tier: null, min_tier_until: null, ...extra });
const vol = (id) => db.volumes.filter((v) => v.user_id === id);
const tierNow = (id) => memberTier(db.members.find((m) => m.user_id === id));

// A：5 天前加入，BingX 第 1 天累計就超過 20 萬（第二級）→ 記那天，這一輪和下一輪都是第二級
const aJoin = addDays(today, -5);
const aP = periodOf(aJoin, today);
db.members.push(member("u-a", aJoin));
db.exchange_links.push({ user_id: "u-a", exchange: "BingX", exchange_uid: "88880001" });
bingxRows = [
  { uid: 88880001, commissionTime: at(addDays(aJoin, -1)), tradingVolume: "900000" }, // 加入前的不算
  { uid: 88880001, commissionTime: at(addDays(aJoin, 1)), tradingVolume: "400000" },
  { uid: 88880001, commissionTime: at(addDays(aJoin, 2)), tradingVolume: "300000" },
  { uid: 88880001, commissionTime: at(addDays(aJoin, 3)), tradingVolume: "350000" },
  { uid: 99990000, commissionTime: at(addDays(aJoin, 1)), tradingVolume: "5000000" }, // 別人的不算
];
await test("BingX：只算這一輪、這個人的交易量，累計第一次到第二級那天記下來", async () => {
  const r = await syncBingx();
  assert.equal(r.saved, 1);
  const [v] = vol("u-a");
  assert.equal(v.period_start, aJoin);
  assert.equal(v.period_end, aP.end);
  assert.equal(v.amounts.BingX, 1050000);
  assert.equal(v.qualified_at, addDays(aJoin, 1));
});
await test("BingX：105 萬是第二級，撐到下一輪結束", async () => {
  const t = await tierNow("u-a");
  assert.deepEqual([t.tier, t.cycleTier, t.until], [2, 2, nextPeriod(aJoin, aP).end]);
});
await test("再同步一次，數字沒變就不重寫、不再通知", async () => {
  const before = writes.length;
  const r = await syncBingx();
  assert.equal(r.saved, 0); assert.equal(r.tierUps, 0);
  assert.equal(writes.length, before);
});

// B：3 天前加入，Bybit 150 萬 → 第三級，記昨天
const bJoin = addDays(today, -3);
const bP = periodOf(bJoin, today);
db.members.push(member("u-b", bJoin));
db.exchange_links.push({ user_id: "u-b", exchange: "Bybit", exchange_uid: "77770001" });
// C：今天才加入，Bybit 還沒有資料 → 不寫，第一輪先是第二級
db.members.push(member("u-c", today));
db.exchange_links.push({ user_id: "u-c", exchange: "Bybit", exchange_uid: "77770002" });
// D：上一輪（前天結束）Bybit 200 萬 → 這一輪第三級；這一輪只有 10 → 下一輪沒有等級
const dJoinFixed = (() => { let j = addDays(today, -27); for (let i = 0; i < 10; i++, j = addDays(j, -1)) { const p = periodOf(j, today); if (p.index === 1 && p.start === addDays(today, -1)) return j; } throw new Error("找不到測試用的加入日"); })();
const dCur = periodOf(dJoinFixed, today);
db.members.push(member("u-d", dJoinFixed));
db.exchange_links.push({ user_id: "u-d", exchange: "Bybit", exchange_uid: "77770003" });
bybitVol = {
  "77770001": (s, e) => (s === bJoin ? 1500000 : 0),
  "77770002": () => 9999999,
  "77770003": (s, e) => (s === dJoinFixed ? 2000000 : 10),
};
await test("Bybit：查這一輪第一天到昨天；150 萬是第三級", async () => {
  await syncBybit();
  const [v] = vol("u-b");
  assert.equal(v.amounts.Bybit, 1500000);
  assert.equal(v.qualified_at, addDays(today, -1));
  assert.equal((await tierNow("u-b")).tier, 3);
  assert.ok(bybitQueries.includes(`${bJoin}:${addDays(today, -1)}`), bybitQueries.join(","));
});
await test("Bybit：今天才加入的人，還沒有資料就不寫；第一輪先是第二級", async () => {
  assert.equal(vol("u-c").length, 0);
  const t = await tierNow("u-c");
  assert.deepEqual([t.tier, t.cycleTier, t.until], [2, 0, periodOf(today, today).end]);
});
await test("上一輪剛結束：補同步上一輪，上一輪第三級 → 這一輪是第三級到這一輪結束", async () => {
  const prev = vol("u-d").find((v) => v.period_start === dJoinFixed);
  assert.ok(prev, "沒有寫上一輪");
  assert.equal(prev.period_end, addDays(today, -2));
  assert.equal(prev.qualified_at, prev.period_end); // Bybit 查到上一輪最後一天
  const t = await tierNow("u-d");
  assert.deepEqual([t.tier, t.until], [3, dCur.end]);
});
await test("這一輪還不到第一級：記數字，下一輪會沒有等級", async () => {
  const cur = vol("u-d").find((v) => v.period_start === dCur.start);
  if (cur) assert.equal(cur.qualified_at, null);
  assert.equal((await tierNow("u-d")).cycleTier, 0);
});
await test("管理員手動給的等級：交易量低也照給；不限就一直有", async () => {
  db.members.push(member("u-e", addDays(today, -40), { min_tier: 2, min_tier_until: null }));
  assert.equal((await tierNow("u-e")).tier, 2);
  assert.equal((await tierNow("u-e")).until, null);
  db.members.push(member("u-e2", addDays(today, -40), { min_tier: 2, min_tier_until: addDays(today, -1) }));
  assert.equal((await tierNow("u-e2")).tier, 0); // 手動給的過期了，上一輪又沒交易量
});

// ── 真的 API 程式（模擬伺服器測不到的部分）──
async function call(handler, { method = "GET", query = {}, body, token = "tok-admin", route = "" } = {}) {
  const res = { statusCode: 200, body: null, headersSent: false, headers: {} };
  res.status = (c) => ((res.statusCode = c), res);
  res.setHeader = (k, v) => ((res.headers[k] = v), res);
  res.json = (d) => ((res.body = d), (res.headersSent = true), res);
  res.end = () => ((res.headersSent = true), res);
  await handler({ method, route, headers: { authorization: `Bearer ${token}` }, query, body }, res);
  return res;
}
await test("後台「待跟進」：下一輪會降級、沒有等級、第三級一對一", async () => {
  const r = await call(followup);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const d = r.body.rows.find((x) => x.user_id === "u-d");
  assert.ok(d.reasons.some((x) => x.key === "drop" && x.label.includes("降到沒有等級")), JSON.stringify(d.reasons));
  assert.ok(d.reasons.some((x) => x.key === "oneonone"), JSON.stringify(d.reasons));
  const e2 = r.body.rows.find((x) => x.user_id === "u-e2");
  assert.ok(e2.reasons.some((x) => x.key === "notier"), JSON.stringify(e2.reasons));
});
await test("後台「交易量」這一輪：每人自己的一輪、那一輪達到第幾級、今天的等級", async () => {
  const r = await call(adminVolumes, { query: { which: "current" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const a = r.body.rows.find((x) => x.user_id === "u-a");
  assert.equal(a.period_start, aJoin); assert.equal(a.next_end, nextPeriod(aJoin, aP).end); assert.equal(a.amounts.BingX, 1050000);
  assert.deepEqual([a.cycle_tier, a.tier], [2, 2]);
  assert.equal(r.body.tiers.length, 3);
});
await test("後台「交易量」手動填 OKX：升級有算到、不蓋掉自動的數字", async () => {
  const r = await call(adminVolumes, { method: "POST", body: { which: "current", qualifiedOn: today, rows: [{ userId: "00000000-0000-4000-8000-00000000000c", amounts: { OKX: 1 } }] } });
  assert.equal(r.statusCode, 400); // 不是 UUID 的研究員不收
  db.members.find((m) => m.user_id === "u-c").user_id = "00000000-0000-4000-8000-00000000000c";
  db.exchange_links.find((l) => l.user_id === "u-c").user_id = "00000000-0000-4000-8000-00000000000c";
  const r2 = await call(adminVolumes, { method: "POST", body: { which: "current", qualifiedOn: today, rows: [{ userId: "00000000-0000-4000-8000-00000000000c", amounts: { OKX: 1200000, Bybit: 99 } }] } });
  assert.equal(r2.statusCode, 200, JSON.stringify(r2.body));
  assert.equal(r2.body.tierUps, 1);
  const c = r2.body.rows.find((x) => x.email === "u-c@example.com");
  assert.equal(c.amounts.OKX, 1200000); assert.equal(c.amounts.Bybit, undefined);
  assert.deepEqual([c.cycle_tier, c.tier], [2, 2]);
});
await test("升級通知：自動同步、手動填都記一次，同樣數字再存不重複", async () => {
  assert.deepEqual(db.milestones.filter((r) => r.user_id === "u-a").map((r) => r.level), [2], JSON.stringify(db.milestones));
  assert.deepEqual(db.milestones.filter((r) => r.user_id === "u-b").map((r) => r.level), [3]);
  const c = db.milestones.filter((r) => r.user_id === "00000000-0000-4000-8000-00000000000c");
  assert.deepEqual(c.map((r) => r.level), [2]);
  const n = db.milestones.length;
  await call(adminVolumes, { method: "POST", body: { which: "current", qualifiedOn: today, rows: [{ userId: "00000000-0000-4000-8000-00000000000c", amounts: { OKX: 1300000 } }] } });
  assert.equal(db.milestones.length, n);
});
await test("升級通知：一級一級升上去各通知一次，一次跳兩級只通知最高的", async () => {
  const id = "00000000-0000-4000-8000-0000000000f1";
  db.members.push(member(id, addDays(today, -40), { email: "u-f@example.com" })); // 第二輪（第一輪先給第二級，看不出升級）
  const lv = () => db.milestones.filter((r) => r.user_id === id).map((r) => r.level).sort();
  await call(adminVolumes, { method: "POST", body: { which: "current", qualifiedOn: today, rows: [{ userId: id, amounts: { OKX: 15000 } }] } });
  assert.deepEqual(lv(), [1]);
  await call(adminVolumes, { method: "POST", body: { which: "current", qualifiedOn: today, rows: [{ userId: id, amounts: { OKX: 18000 } }] } });
  assert.deepEqual(lv(), [1]);
  await call(adminVolumes, { method: "POST", body: { which: "current", qualifiedOn: today, rows: [{ userId: id, amounts: { OKX: 1600000 } }] } });
  assert.deepEqual(lv(), [1, 3]);
});
await test("升級通知：第一輪本來就是第二級，到第一級不通知、到第二級以上才通知", async () => {
  const id = "00000000-0000-4000-8000-0000000000f9";
  db.members.push(member(id, today, { email: "u-new@example.com" }));
  const lv = () => db.milestones.filter((r) => r.user_id === id).map((r) => r.level).sort();
  await call(adminVolumes, { method: "POST", body: { which: "current", qualifiedOn: today, rows: [{ userId: id, amounts: { OKX: 15000 } }] } });
  assert.deepEqual(lv(), []);
  await call(adminVolumes, { method: "POST", body: { which: "current", qualifiedOn: today, rows: [{ userId: id, amounts: { OKX: 300000 } }] } });
  assert.deepEqual(lv(), [2]);
});
await test("升級通知：Discord 私訊內容", async () => {
  const period = { start: "2026-10-18", end: "2026-11-17" };
  const t1 = milestoneText({ level: 1, amounts: { OKX: 15000 }, period, nextEnd: "2026-12-17" });
  assert.ok(t1.includes("升上第一級") && t1.includes("會員直播") && t1.includes("12/17") && t1.includes("第二級還差 18.5 萬"), t1);
  const um = milestoneText({ level: 2, amounts: { UM: 3 }, period, nextEnd: "2026-12-17" });
  assert.ok(um.includes("升上第二級") && um.includes("UM 3 手") && um.includes("直播留檔") && um.includes("第三級UM 還差 12 手"), um);
  const t3 = milestoneText({ level: 3, amounts: { Bybit: 1600000 }, period, nextEnd: "2026-12-17" });
  assert.ok(t3.includes("升上第三級") && t3.includes("一對一"), t3);
});
await test("升級通知：贈送名額不記", async () => {
  const id = "00000000-0000-4000-8000-0000000000f2";
  db.members.push(member(id, today, { email: "u-g@example.com", free: true, min_tier: 2 }));
  await call(adminVolumes, { method: "POST", body: { which: "current", qualifiedOn: today, rows: [{ userId: id, amounts: { OKX: 900000 } }] } });
  assert.equal(db.milestones.filter((r) => r.user_id === id).length, 0);
});
await test("後台「交易量」上一輪：第一輪的人不列", async () => {
  const r = await call(adminVolumes, { query: { which: "previous" } });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.rows.every((x) => ["u-d", "u-e", "u-e2", "00000000-0000-4000-8000-0000000000f1"].includes(x.user_id)), r.body.rows.map((x) => x.user_id).join());
});
await test("研究員 /api/me：這一輪的日期、等級、升級恭喜", async () => {
  tokens["tok-a"] = { id: "u-a", email: "u-a@example.com", email_confirmed_at: null };
  const r = await call(me, { token: "tok-a" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.volume.periodStart, aJoin); assert.equal(r.body.volume.periodEnd, aP.end);
  assert.deepEqual([r.body.tier, r.body.volume.tier, r.body.volume.cycleTier, r.body.volume.tierUntil], [2, 2, 2, nextPeriod(aJoin, aP).end]);
  assert.equal(r.body.volume.milestone?.level, 2, JSON.stringify(r.body.volume.milestone));
  const seen = await call(me, { token: "tok-a", method: "PATCH", body: { milestoneSeen: true } });
  assert.equal(seen.statusCode, 200);
  const r2 = await call(me, { token: "tok-a" });
  assert.equal(r2.body.volume.milestone, null);
});
await test("沒有等級的研究員：/api/me 打得開，系統分享被擋（第一級才有第 1 份）", async () => {
  tokens["tok-e2"] = { id: "u-e2", email: "u-e2@example.com", email_confirmed_at: null };
  const r = await call(me, { token: "tok-e2" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.tier, 0);
  const c = await call(course, { token: "tok-e2" });
  assert.equal(c.statusCode, 403); assert.equal(c.body.code, "tier"); assert.ok(c.body.error.includes("第一級"), c.body.error);
  tokens["tok-c1"] = { id: "00000000-0000-4000-8000-0000000000f1", email: "u-f@example.com", email_confirmed_at: null };
  const ok = await call(course, { token: "tok-c1" });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body)); // 第三級看得到
  assert.ok(ok.body.slots.every((x) => x.unlocked), "第三級全部直接解鎖，不用等排程");
  const ok2 = await call(course, { token: "tok-a" }); // 第二級照排程
  assert.ok(ok2.body.slots.some((x) => !x.unlocked && !x.tier_locked));
});

await test("第一級：系統分享只開每位主講第 1 份，直播留檔被擋", async () => {
  const id = "00000000-0000-4000-8000-0000000000a1";
  const join = addDays(today, -40); // 第二輪，上一輪只到第一級
  db.members.push(member(id, join, { email: "t1@example.com" }));
  const prev = prevPeriod(join, periodOf(join, today));
  db.volumes.push({ user_id: id, period_start: prev.start, period_end: prev.end, amounts: { OKX: 20000 }, qualified_at: null });
  db.videos.push({ id: 501, title: "CCC 1", is_published: true, course_host: "CCC", course_part: 1, r2_key: "a.mp4", duration_sec: 60 }, { id: 502, title: "CCC 2", is_published: true, course_host: "CCC", course_part: 2, r2_key: "b.mp4", duration_sec: 60 }, { id: 503, title: "直播", is_published: true, course_host: null, r2_key: "c.mp4", duration_sec: 60 });
  tokens["tok-t1"] = { id, email: "t1@example.com", email_confirmed_at: null };
  const c = await call(course, { token: "tok-t1" });
  assert.equal(c.statusCode, 200, JSON.stringify(c.body));
  const ccc1 = c.body.slots.find((x) => x.host === "CCC" && x.part === 1), ccc2 = c.body.slots.find((x) => x.host === "CCC" && x.part === 2);
  assert.deepEqual([ccc1.unlocked, ccc1.tier_locked, ccc2.unlocked, ccc2.tier_locked], [true, false, false, true]);
  assert.equal(ccc2.video.id, undefined); // 鎖著的不給播放資訊
  const live = await call(videosApi, { token: "tok-t1", query: { id: "503" } });
  assert.equal(live.statusCode, 403); assert.equal(live.body.code, "tier");
  const l2 = await call(videosApi, { token: "tok-t1", query: { id: "502" } });
  assert.equal(l2.statusCode, 403);
  const list = await call(videosApi, { token: "tok-t1" });
  assert.equal(list.statusCode, 403);
});
await test("一對一：第三級才能選；每位主講 5 位，超過照交易量排；已約好的不會被擠掉", async () => {
  const P = periodOf(today, today);
  const ids = [1, 2, 3, 4, 5, 6].map((i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`);
  ids.forEach((id, i) => {
    db.members.push(member(id, today, { email: `one${i + 1}@example.com` }));
    db.volumes.push({ user_id: id, period_start: P.start, period_end: P.end, amounts: { OKX: 1500000 + (i + 1) * 100000 }, qualified_at: today });
    tokens[`tok-one${i + 1}`] = { id, email: `one${i + 1}@example.com`, email_confirmed_at: null };
  });
  // 第二級的人不能選
  tokens["tok-c"] = { id: "00000000-0000-4000-8000-00000000000c", email: "u-c@example.com", email_confirmed_at: null };
  const no = await call(oneonone, { token: "tok-c", method: "POST", body: { host: "CCC" } });
  assert.equal(no.statusCode, 403);
  const v = await call(oneonone, { token: "tok-c" });
  assert.equal(v.body.eligible, false);
  // 六位都選 CCC：交易量最低的 one1 變候補
  for (let i = 1; i <= 6; i++) {
    const r = await call(oneonone, { token: `tok-one${i}`, method: "POST", body: { host: "CCC" } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  }
  const me1 = (await call(oneonone, { token: "tok-one1" })).body;
  assert.deepEqual([me1.mine.host, me1.mine.rank, me1.mine.confirmed, me1.mine.waiting], ["CCC", 6, false, 1]);
  assert.deepEqual(me1.hosts.find((h) => h.host === "CCC"), { host: "CCC", total: 6, confirmed: 5 });
  const me6 = (await call(oneonone, { token: "tok-one6" })).body;
  assert.deepEqual([me6.mine.rank, me6.mine.confirmed], [1, true]);
  // 後台：照順序、管理員標記 one1 已約好 → one1 確定，one2 被擠到候補
  const b = await call(adminOneonone, { query: { month: thisMonthTW() } });
  assert.equal(b.statusCode, 200, JSON.stringify(b.body));
  assert.deepEqual(b.body.hosts.find((h) => h.host === "CCC").list.map((e) => e.email), [6, 5, 4, 3, 2, 1].map((i) => `one${i}@example.com`));
  const bk = await call(adminOneonone, { method: "PATCH", body: { userId: ids[0], month: thisMonthTW(), booked: true } });
  const list = bk.body.hosts.find((h) => h.host === "CCC").list;
  assert.equal(list.find((e) => e.email === "one1@example.com").confirmed, true);
  assert.equal(list.find((e) => e.email === "one2@example.com").confirmed, false);
  // 約好的不能自己改選或取消
  const sw = await call(oneonone, { token: "tok-one1", method: "POST", body: { host: "X" } });
  assert.equal(sw.statusCode, 400);
  // one2 改選 X → 馬上確定
  const r2 = await call(oneonone, { token: "tok-one2", method: "POST", body: { host: "X" } });
  assert.deepEqual([r2.body.mine.host, r2.body.mine.confirmed], ["X", true]);
  // OC 停止合作（2026-11-09）：不能再選
  assert.equal((await call(oneonone, { token: "tok-one4", method: "POST", body: { host: "OC" } })).statusCode, 400);
  // 主講名字亂填不收
  assert.equal((await call(oneonone, { token: "tok-one3", method: "POST", body: { host: "Bob" } })).statusCode, 400);
});
await test("本週小目標、連續打卡：看完 1 部、記 1 則筆記、這週打開 3 天，三個都完成算一週", async () => {
  const id = "00000000-0000-4000-8000-0000000000b1";
  db.members.push(member(id, today, { email: "q@example.com" }));
  tokens["tok-q"] = { id, email: "q@example.com", email_confirmed_at: null };
  // 前兩天也有打卡（連續）；今天是星期幾不一定，所以這週打開幾天要看日期
  db.checkins.push({ user_id: id, day: addDays(today, -1) }, { user_id: id, day: addDays(today, -2) });
  const r1 = await call(questsApi, { token: "tok-q" });
  assert.equal(r1.statusCode, 200, JSON.stringify(r1.body));
  assert.deepEqual(r1.body.quests.map((x) => x.done).slice(0, 2), [false, false]);
  assert.deepEqual([r1.body.streak.days, r1.body.streak.best], [3, 3]);
  // 這週其他天也補打卡，確定「這週 3 天」達成
  const wk = r1.body.week;
  for (let d = wk.start; d <= wk.end; d = addDays(d, 1)) if (!db.checkins.some((c) => c.user_id === id && c.day === d)) db.checkins.push({ user_id: id, day: d });
  db.videos.push({ id: 601, title: "v", is_published: true, duration_sec: 100 });
  db.watch_progress.push({ user_id: id, video_id: 601, position_sec: 99, duration_sec: 100, updated_at: new Date().toISOString() });
  db.notes.push({ id: 900, user_id: id, video_id: 601, created_at: new Date().toISOString() });
  const r2 = await call(questsApi, { token: "tok-q" });
  assert.deepEqual(r2.body.quests.map((x) => x.done), [true, true, true], JSON.stringify(r2.body.quests));
  assert.deepEqual([r2.body.allDone, r2.body.justDone, r2.body.weeksDone], [true, true, 1]);
  const r3 = await call(questsApi, { token: "tok-q" });
  assert.equal(r3.body.justDone, false); // 只提示一次
});
await test("贈送名額不分級：一直看得到網站、不顯示等級變化", async () => {
  const id = "00000000-0000-4000-8000-0000000000b2";
  db.members.push(member(id, addDays(today, -60), { email: "gift2@example.com", free: true, min_tier: 2 }));
  const t = await memberTier(db.members.find((m) => m.user_id === id));
  assert.deepEqual([t.tier, t.until, t.free], [2, null, true]);
});
await test("協作管理員：交易量、待跟進被擋，主要管理員不受影響", async () => {
  tokens["tok-oc"] = { id: "oc-1", email: "oc@gmail.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
  env.ADMIN_EMAILS = "boss@gmail.com,oc@gmail.com";
  db.settings.push({ key: "admin_roles", value: { "oc@gmail.com": "editor" } });
  const v = await call(adminVolumes, { token: "tok-oc", route: "admin/volumes" });
  assert.equal(v.statusCode, 403); assert.equal(v.body.code, "owner_only");
  const f = await call(followup, { token: "tok-oc", route: "admin/followup" });
  assert.equal(f.statusCode, 403);
  const o = await call(adminVolumes, { token: "tok-admin", route: "admin/volumes" });
  assert.equal(o.statusCode, 200);
  const m = await call(me, { token: "tok-oc" });
  assert.equal(m.body.adminRole, "editor");
  const one = await call(adminOneonone, { token: "tok-oc", route: "admin/oneonone" });
  assert.equal(one.statusCode, 200); // 主講（OC）看得到一對一名單
});
await test("停止合作的管理員（removed）：後台、管理員身分看網站都擋掉，就算還在 ADMIN_EMAILS", async () => {
  db.settings.find((x) => x.key === "admin_roles").value["oc@gmail.com"] = "removed";
  const one = await call(adminOneonone, { token: "tok-oc", route: "admin/oneonone" });
  assert.equal(one.statusCode, 403);
  const v = await call(adminVolumes, { token: "tok-oc", route: "admin/volumes" });
  assert.equal(v.statusCode, 403);
  const m = await call(me, { token: "tok-oc" });
  assert.equal(m.statusCode, 403);
  assert.equal((await call(adminVolumes, { token: "tok-admin", route: "admin/volumes" })).statusCode, 200);
});

await test("社群舊成員：設了第一輪起算日，加入網站前的 BingX 量也算進第一輪", async () => {
  db.members.push(member("u-old", today, { volume_from: addDays(today, -3) }));
  db.exchange_links.push({ user_id: "u-old", exchange: "BingX", exchange_uid: "88880009" });
  bingxRows.push(
    { uid: 88880009, commissionTime: at(addDays(today, -1)), tradingVolume: "12952.62" },
    { uid: 88880009, commissionTime: at(addDays(today, -5)), tradingVolume: "500000" }, // 起算日之前的不算
  );
  const r = await syncBingx({ uid: "88880009" });
  const [v] = vol("u-old");
  assert.equal(v.period_start, today);
  assert.equal(v.amounts.BingX, 12952.62);
  assert.equal(r.diag.perUid["88880009"].inPeriod, 12952.62);
  assert.equal((await tierNow("u-old")).cycleTier, 1);
});

await test("後台「機器人」：新增 Webhook 會先跟 Discord 確認、網址不回傳；選 Webhook、討論串格式、沒選不能打開", async () => {
  const hooks = http.createServer((req, res) => {
    res.writeHead(req.url.includes("deadtoken") ? 404 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(req.url.includes("deadtoken") ? { message: "Unknown Webhook" } : { name: "CCC Market Lab", channel_id: "100000000000000001" }));
  });
  env.DISCORD_API_BASE = await listen(hooks);
  const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEF";
  let r = await call(adminBots, { method: "PATCH", route: "admin/bots", body: { addOutlet: { name: "股市整合頻道", url: "https://evil.example/api/webhooks/1/2" } } });
  assert.equal(r.statusCode, 400);
  r = await call(adminBots, { method: "PATCH", route: "admin/bots", body: { addOutlet: { name: "x", url: "https://discord.com/api/webhooks/123456789012345678/deadtoken-xxxxxxxxxxxxxxxx" } } });
  assert.equal(r.statusCode, 400); assert.ok(r.body.error.includes("不存在"));
  r = await call(adminBots, { method: "PATCH", route: "admin/bots", body: { addOutlet: { name: "股市整合頻道", url: HOOK } } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(!JSON.stringify(r.body).includes("abcdefghijklmnop"), "網址不回傳");
  const id = r.body.outlets[0].id;
  assert.deepEqual([r.body.outlets[0].tail, r.body.outlets[0].hookName], ["CDEF", "CCC Market Lab"]);
  r = await call(adminBots, { method: "PATCH", route: "admin/bots", body: { bot: "tw_close", enabled: true } });
  assert.equal(r.statusCode, 400, "沒選 Webhook 不能打開");
  r = await call(adminBots, { method: "PATCH", route: "admin/bots", body: { bot: "tw_close", outlet: id, thread: "123" } });
  assert.equal(r.statusCode, 400);
  r = await call(adminBots, { method: "PATCH", route: "admin/bots", body: { bot: "tw_disclosure", outlet: id, thread: "777777777777777777", opts: { watch: "2330, 2317", minScore: "abc" } } });
  assert.equal(r.statusCode, 400, "數字選項要填數字");
  r = await call(adminBots, { method: "PATCH", route: "admin/bots", body: { bot: "tw_disclosure", outlet: id, thread: "777777777777777777", opts: { watch: "2330, 2317", minScore: "5" }, enabled: true } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.bots.tw_disclosure, { outlet: id, thread: "777777777777777777", opts: { watch: "2330, 2317", minScore: 5 }, enabled: true });
  const saved = db.settings.find((x) => x.key === "bots").value;
  assert.equal(saved.outlets[0].url, HOOK, "網址存在資料庫");
  const g = await call(adminBots, { route: "admin/bots" });
  assert.equal(g.statusCode, 200);
  assert.ok(!JSON.stringify(g.body).includes("abcdefghijklmnop"));
  assert.equal(g.body.bots.find((b) => b.key === "tw_disclosure").conf.enabled, true);
  r = await call(adminBots, { method: "PATCH", route: "admin/bots", body: { removeOutlet: id } });
  assert.equal(r.body.bots.tw_disclosure.enabled, false, "移除 Webhook：用到它的機器人關掉");
  // 協作管理員不能用
  const oc = await call(adminBots, { route: "admin/bots", token: "tok-oc" });
  assert.equal(oc.statusCode, 403);
  hooks.close();
  delete env.DISCORD_API_BASE;
});

await test("單位制（v1.26.34）：設定開始日期後，累計每 20 萬解鎖一份、直播留檔加入就能看、100 萬可以一對一", async () => {
  const oc = await call(adminMembership, { route: "admin/membership", method: "PUT", token: "tok-oc", body: { unitFrom: today } });
  assert.equal(oc.statusCode, 403, "協作管理員不能改");
  let r = await call(adminMembership, { route: "admin/membership", method: "PUT", body: { unitFrom: addDays(today, 1) } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body)); assert.equal(r.body.on, false, "明天才開始");
  r = await call(adminMembership, { route: "admin/membership", method: "PUT", body: { unitFrom: today } });
  assert.equal(r.body.on, true);
  // t1：上一輪 OKX 2 萬 → 累計 2 萬，系統分享一份都還沒開，但直播留檔看得到
  let c = await call(course, { token: "tok-t1" });
  assert.equal(c.statusCode, 200, JSON.stringify(c.body));
  assert.equal(c.body.unit.units, 0);
  const s1 = c.body.slots.find((x) => x.host === "CCC" && x.part === 1);
  assert.deepEqual([s1.unlocked, s1.need_usdt, s1.unlock_on], [false, 200000, null]);
  const live = await call(videosApi, { token: "tok-t1", query: { id: "503" } });
  assert.notEqual(live.statusCode, 403, JSON.stringify(live.body));
  const l1 = await call(videosApi, { token: "tok-t1", query: { id: "501" } });
  assert.equal(l1.statusCode, 403); assert.ok(l1.body.error.includes("20 萬"), l1.body.error);
  // 這一輪再加 Bybit 33 萬、UM 0.1 手（＝1 萬）→ 累計 36 萬 → 第 1 份
  const id = "00000000-0000-4000-8000-0000000000a1";
  const join = db.members.find((m) => m.user_id === id).created_at.slice(0, 10);
  const cur = periodOf(join, today);
  db.volumes.push({ user_id: id, period_start: cur.start, period_end: cur.end, amounts: { Bybit: 330000, UM: 0.1 }, qualified_at: null });
  c = await call(course, { token: "tok-t1" });
  assert.equal(c.body.unit.units, 1); assert.equal(c.body.unit.cum, 360000); // 2 萬＋33 萬＋UM 0.1 手（1 萬）
  assert.deepEqual(c.body.slots.filter((x) => x.unlocked).map((x) => `${x.host}${x.part}`), ["CCC1", "X1"], "36 萬 → 第 1 份");
  db.volumes.at(-1).amounts.UM = 1; // 1 手＝10 萬 → 累計 45 萬（2＋33＋10）
  c = await call(course, { token: "tok-t1" });
  assert.deepEqual(c.body.slots.filter((x) => x.unlocked).map((x) => `${x.host}${x.part}`), ["CCC1", "X1", "CCC2", "X2"]);
  const l2 = await call(videosApi, { token: "tok-t1", query: { id: "502" } });
  assert.notEqual(l2.statusCode, 403, "第 2 份不用等排程");
  const m1 = await call(me, { token: "tok-t1" });
  assert.equal(m1.body.tier, 2); assert.equal(m1.body.volume.unit.units, 2); assert.equal(m1.body.volume.milestone, null);
  let o = await call(oneonone, { token: "tok-t1" });
  assert.equal(o.body.eligible, false);
  db.volumes.at(-1).amounts.Bybit = 900000; // 累計 112 萬 → 一對一
  o = await call(oneonone, { token: "tok-t1" });
  assert.equal(o.body.eligible, true);
  // 後台交易量列表有累計
  const v = await call(adminVolumes, { query: { which: "current" } });
  assert.equal(v.body.rows.find((x) => x.user_id === id).unit.units, 5);
  r = await call(adminMembership, { route: "admin/membership", method: "PUT", body: { unitFrom: "" } });
  assert.equal(r.body.on, false);
  c = await call(course, { token: "tok-t1" });
  assert.equal(c.body.unit, null, "取消後回到三級制度");
});

// 排程一間一間同步（Cloudflare 一次請求的對外連線有上限，三間一起跑研究員一多會超過）
await test("排程同步可以只跑一間交易所", async () => {
  const run = async (headers, body) => {
    const res = { statusCode: 200, body: null, headersSent: false, headers: {} };
    res.status = (c) => ((res.statusCode = c), res);
    res.setHeader = (k, v) => ((res.headers[k] = v), res);
    res.json = (d) => ((res.body = d), (res.headersSent = true), res);
    res.end = () => ((res.headersSent = true), res);
    await cronSync({ method: "POST", route: "cron/sync", headers, query: {}, body }, res);
    return res;
  };
  assert.equal((await run({}, { exchange: "Bybit" })).statusCode, 401);
  const key = { "x-cron-secret": "cron-test" };
  assert.equal((await run(key, { exchange: "Nope" })).statusCode, 400);
  const bx = bingxHits, by = bybitQueries.length;
  const r = await run(key, { exchange: "Bybit" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body.results), ["Bybit"]);
  assert.equal(bingxHits, bx, "只跑 Bybit，不該叫 BingX");
  assert.ok(bybitQueries.length > by, "有查 Bybit");
  const all = await run(key, {});
  assert.ok(all.body.results.BingX && all.body.results.Bybit, "不給交易所還是全部跑：" + JSON.stringify(all.body));
});

supa.close(); bingx.close(); bybit.close();
console.log(`\n自動同步：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
