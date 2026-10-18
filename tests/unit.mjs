// 規則和伺服器小工具的單元測試（不用瀏覽器，幾秒鐘跑完）。npm test 會先跑這一支。
import assert from "node:assert/strict";
import { addDays, cycleEnd, periodOf, nextPeriod, prevPeriod, addMonths, courseWeek, courseUnlockDate, COURSE_HOSTS, COURSE_PARTS, EXCHANGES, AUTO_EXCHANGES, TIERS, tierOf, tierStatus, gapTo, tierRuleText, tierName, rankOneOnOne, oneOnOneScore, ONE_ON_ONE_CAP, streakOf, bestStreakOf, weekOf, BADGES, earnedBadges, THEMES, themeUnlocked } from "../public/assets/js/shared/rules.js";
import { longestStreak } from "../server/lib/badges.js";
import { oneOnOneNotice } from "../server/lib/oneonone.js";
const pick = ({ tier, until, cycleTier }) => ({ tier, until, cycleTier });
import { mergeBuckets } from "../server/lib/buckets.js";
import { cleanTitle, cleanChapters, toInt, isDate } from "../server/lib/text.js";
import http from "node:http";
import { env } from "../server/lib/env.js";
import { buildCanonical, hmacHex, parseSafe, dayChunks, summarize, checkInvite, fetchDaily, commissionDay } from "../server/lib/bingx.js";
import { bybitSign, bybitQuery, capRange, checkBybitClient, fetchBybitVolumes, bybitProxyUrl } from "../server/lib/bybit.js";
import { syncPeriods } from "../server/lib/volume.js";

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("PASS " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "：" + e.message); }
}

test("每人一輪：10/16 加入 → 10/16～11/15，11/16 是第二輪", () => {
  assert.deepEqual(periodOf("2026-10-16", "2026-10-16"), { index: 0, start: "2026-10-16", end: "2026-11-15" });
  assert.deepEqual(periodOf("2026-10-16", "2026-11-15"), { index: 0, start: "2026-10-16", end: "2026-11-15" });
  assert.deepEqual(periodOf("2026-10-16", "2026-11-16"), { index: 1, start: "2026-11-16", end: "2026-12-15" });
});
test("每人一輪：第一輪達標可以看到第二輪結束", () => assert.equal(nextPeriod("2026-10-16", periodOf("2026-10-16", "2026-10-20")).end, "2026-12-15"));
test("每人一輪：跨年", () => assert.deepEqual(periodOf("2026-12-20", "2027-01-25"), { index: 1, start: "2027-01-20", end: "2027-02-19" }));
test("每人一輪：1/31 加入，2 月用月底，3 月回到 31 號", () => {
  assert.deepEqual(periodOf("2026-01-31", "2026-02-28"), { index: 1, start: "2026-02-28", end: "2026-03-30" });
  assert.deepEqual(periodOf("2026-01-31", "2026-03-31"), { index: 2, start: "2026-03-31", end: "2026-04-29" });
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
});
test("每人一輪：第一輪沒有上一輪", () => {
  assert.equal(prevPeriod("2026-10-16", periodOf("2026-10-16", "2026-10-20")), null);
  assert.equal(prevPeriod("2026-10-16", periodOf("2026-10-16", "2026-11-20")).start, "2026-10-16");
});
test("同步哪幾輪：上一輪剛結束 3 天內也補一次", () => {
  const m = { created_at: "2026-10-16T04:00:00Z" };
  assert.equal(syncPeriods(m, "2026-11-18").length, 2);
  assert.equal(syncPeriods(m, "2026-11-19").length, 1);
  assert.equal(syncPeriods(m, "2026-10-20").length, 1);
});
test("資格一輪：10/15 達標看到 11/14", () => assert.equal(cycleEnd("2026-10-15"), "2026-11-14"));
test("資格一輪：1/31 → 2/27（2 月沒有 31 號）", () => assert.equal(cycleEnd("2026-01-31"), "2026-02-27"));
test("資格一輪：12/1 跨年 → 12/31", () => assert.equal(cycleEnd("2026-12-01"), "2026-12-31"));
test("資格一輪：12/20 跨年 → 1/19", () => assert.equal(cycleEnd("2026-12-20"), "2027-01-19"));
test("日期加減跨月", () => assert.equal(addDays("2026-10-30", 3), "2026-11-02"));

test("交易所：OKX、UM 手填，Bybit、BingX 自動同步", () => { assert.deepEqual(EXCHANGES, ["OKX", "UM", "Bybit", "BingX"]); assert.deepEqual(AUTO_EXCHANGES, ["Bybit", "BingX"]); });
test("三級門檻：1 萬／0.01 手、20 萬／2 手、150 萬／15 手", () => {
  assert.deepEqual(TIERS.map((t) => [t.tier, t.usdt, t.lots]), [[1, 10000, 0.01], [2, 200000, 2], [3, 1500000, 15]]);
  assert.equal(tierOf({}), 0);
  assert.equal(tierOf(null), 0);
  assert.equal(tierOf({ OKX: 9999 }), 0);
  assert.equal(tierOf({ OKX: 10000 }), 1);
  assert.equal(tierOf({ UM: 0.01 }), 1);
  assert.equal(tierOf({ UM: 0.009 }), 0);
  assert.equal(tierOf({ OKX: 199999, UM: 1.9 }), 1);
  assert.equal(tierOf({ BingX: 200000 }), 2);
  assert.equal(tierOf({ OKX: 100, UM: 2 }), 2);
  assert.equal(tierOf({ Bybit: 1500000 }), 3);
  assert.equal(tierOf({ UM: 15 }), 3);
  assert.deepEqual([tierName(0), tierName(1), tierName(3)], ["沒有等級", "第一級", "第三級"]);
});
test("還差多少：挑最接近的那間", () => {
  assert.equal(gapTo({ UM: 1.5, OKX: 100000 }, 2), "UM 還差 0.5 手");
  assert.equal(gapTo({ UM: 0.5, OKX: 150000 }, 2), "還差 5 萬");
  assert.equal(gapTo({}, 3), "還差 150 萬");
});
test("規則文字", () => assert.equal(tierRuleText(2), "OKX、Bybit、BingX 任一間 20 萬 USDT，或 UM 2 手"));
test("等級：這一輪達到的撐到下一輪結束、上一輪的撐到這一輪結束、第一輪先給第一級", () => {
  const am = (map) => (st) => map[st] || {};
  // 第一輪、沒交易量 → 第一級，到這一輪結束
  assert.deepEqual(pick(tierStatus({ anchor: "2026-10-10", today: "2026-10-18", amountsOf: am({}) })), { tier: 1, until: "2026-11-09", cycleTier: 0 });
  // 第一輪就到第二級 → 撐到第二輪結束
  assert.deepEqual(pick(tierStatus({ anchor: "2026-10-10", today: "2026-10-18", amountsOf: am({ "2026-10-10": { OKX: 250000 } }) })), { tier: 2, until: "2026-12-09", cycleTier: 2 });
  // 上一輪第二級、這一輪還沒 → 第二級到這一輪結束；這一輪只有第一級 → 下一輪降到第一級
  assert.deepEqual(pick(tierStatus({ anchor: "2026-09-10", today: "2026-10-18", amountsOf: am({ "2026-09-10": { OKX: 300000 }, "2026-10-10": { OKX: 20000 } }) })), { tier: 2, until: "2026-11-09", cycleTier: 1 });
  // 上一輪不到第一級 → 沒有等級
  assert.deepEqual(pick(tierStatus({ anchor: "2026-09-10", today: "2026-10-18", amountsOf: am({}) })), { tier: 0, until: null, cycleTier: 0 });
  // 管理員手動給第二級到某天、或不限
  assert.deepEqual(pick(tierStatus({ anchor: "2026-09-10", today: "2026-10-18", amountsOf: am({}), override: { tier: 2, until: "2026-11-01" } })), { tier: 2, until: "2026-11-01", cycleTier: 0 });
  assert.deepEqual(pick(tierStatus({ anchor: "2026-09-10", today: "2026-10-18", amountsOf: am({}), override: { tier: 2, until: null } })), { tier: 2, until: null, cycleTier: 0 });
  // 手動給的過期了 → 照交易量
  assert.equal(tierStatus({ anchor: "2026-09-10", today: "2026-10-18", amountsOf: am({}), override: { tier: 3, until: "2026-10-17" } }).tier, 0);
  // 交易量比手動給的高 → 照交易量
  assert.equal(tierStatus({ anchor: "2026-09-10", today: "2026-10-18", amountsOf: am({ "2026-10-10": { UM: 15 } }), override: { tier: 2, until: null } }).tier, 3);
});
test("一對一：每位講師最多 5 位，超過照交易量排，已約好的一定確定", () => {
  assert.equal(ONE_ON_ONE_CAP, 5);
  assert.ok(oneOnOneScore({ UM: 15 }) === oneOnOneScore({ OKX: 1500000 }), "UM 和 USDT 換算成第三級門檻的幾倍才比得了");
  const e = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ user_id: "u" + i, host: "CCC", score: i, created_at: `2026-10-0${i}`, booked: false }));
  e.push({ user_id: "x", host: "OC", score: 99, created_at: "2026-10-01", booked: false });
  const r = rankOneOnOne(e, "CCC");
  assert.deepEqual(r.map((x) => x.user_id), ["u7", "u6", "u5", "u4", "u3", "u2", "u1"]);
  assert.deepEqual(r.map((x) => x.confirmed), [true, true, true, true, true, false, false]);
  e[0].booked = true; // 交易量最低但已經約好
  const r2 = rankOneOnOne(e, "CCC");
  assert.equal(r2[0].user_id, "u1"); assert.ok(r2[0].confirmed);
  assert.deepEqual(r2.filter((x) => !x.confirmed).map((x) => x.user_id), ["u3", "u2"]);
  // 交易量一樣：先選的先
  const r3 = rankOneOnOne([{ user_id: "a", host: "X", score: 1, created_at: "2026-10-02" }, { user_id: "b", host: "X", score: 1, created_at: "2026-10-01" }], "X");
  assert.deepEqual(r3.map((x) => x.user_id), ["b", "a"]);
});
test("一對一的 Discord 通知：有填講師 ID 就 @ 他，沒填寫名字", () => {
  const pick = oneOnOneNotice({ kind: "pick", email: "a@x.com", host: "OC", rank: 6, confirmed: false, month: "2026-11", hostIds: { OC: "123456789012345678" } });
  assert.ok(pick.content.includes("<@123456789012345678>") && pick.content.includes("11 月") && pick.content.includes("a@x.com") && pick.content.includes("第 6 位（候補）"), pick.content);
  assert.deepEqual(pick.allowed_mentions.users, ["123456789012345678"]);
  const ch = oneOnOneNotice({ kind: "change", email: "a@x.com", host: "CCC", prevHost: "OC", rank: 1, confirmed: true, month: "2026-11" });
  assert.ok(ch.content.startsWith("🔁 CCC") && ch.content.includes("從 OC 改選你") && ch.content.includes("確定"), ch.content);
  assert.deepEqual(ch.allowed_mentions.users, []);
  const c = oneOnOneNotice({ kind: "cancel", email: "a@x.com", prevHost: "X", month: "2026-11", hostIds: { X: "223456789012345678" } });
  assert.ok(c.content.includes("<@223456789012345678>") && c.content.includes("取消了"), c.content);
});
test("連續打卡：今天還沒開也不會一過午夜就歸零；最長紀錄", () => {
  assert.equal(streakOf(["2026-10-17", "2026-10-18", "2026-10-19"], "2026-10-19"), 3);
  assert.equal(streakOf(["2026-10-17", "2026-10-18"], "2026-10-19"), 2);
  assert.equal(streakOf(["2026-10-16"], "2026-10-19"), 0);
  assert.equal(bestStreakOf(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-09"]), 3);
});
test("本週小目標：星期一開始", () => {
  assert.deepEqual(weekOf("2026-10-19"), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(weekOf("2026-10-25"), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(weekOf("2026-10-18"), { start: "2026-10-12", end: "2026-10-18" });
});
test("徽章：照事實給，id 不重複", () => {
  assert.equal(new Set(BADGES.map((b) => b.id)).size, BADGES.length);
  const none = { traded: false, bestPct: 0, qualified: 0, maxTier: 0, streak: 0, hostsDone: [], courseDone: 0, liveDone: 0, notes: 0, questions: 0 };
  assert.deepEqual(earnedBadges(none), []);
  assert.deepEqual(earnedBadges({ ...none, traded: true, bestPct: 60, questions: 1 }), ["first_trade", "half", "question"]);
  assert.deepEqual(earnedBadges({ ...none, maxTier: 3 }), ["tier3"]);
  assert.deepEqual(earnedBadges({ ...none, streak: 3, qualified: 3, hostsDone: ["CCC"], courseDone: 18, liveDone: 10, notes: 10 }).sort(), ["course18", "half", "host6", "live10", "notes10", "qualified", "streak3"].filter((x) => x !== "half").sort());
});
test("主題：前三個免費，其他要對應的徽章；管理員全部可以用", () => {
  assert.deepEqual(THEMES.filter((t) => !t.unlock).map((t) => t.id), ["board", "night", "paper"]);
  for (const t of THEMES) if (t.unlock) assert.ok(BADGES.some((b) => b.id === t.unlock), t.id);
  assert.equal(themeUnlocked("vault", []), false);
  assert.equal(themeUnlocked("vault", ["qualified"]), true);
  assert.equal(themeUnlocked("vault", [], true), true);
  assert.equal(themeUnlocked("nope", ["qualified"], true), false);
});
test("連續第二級以上：照每人自己的輪算最長的一段", () => {
  const q = (start) => ({ period_start: start, amounts: { OKX: 200000 }, qualified_at: start });
  assert.equal(longestStreak("2026-01-16", [q("2026-01-16"), q("2026-02-16"), q("2026-04-16"), q("2026-05-16"), q("2026-06-16")]), 3);
  assert.equal(longestStreak("2026-01-16", [q("2026-01-16"), { period_start: "2026-02-16", amounts: { OKX: 5 }, qualified_at: null }, q("2026-03-16")]), 1);
  assert.equal(longestStreak("2026-01-16", []), 0);
});
test("課程順序是 CCC → OC → X，各 6 份", () => { assert.deepEqual(COURSE_HOSTS, ["CCC", "OC", "X"]); assert.equal(COURSE_PARTS, 6); });
test("課程：加入當天解鎖 CCC 第 1 份", () => assert.equal(courseUnlockDate("2026-10-01", "CCC", 1), "2026-10-01"));
test("課程：第 2 週 OC、第 3 週 X、第 4 週休息", () => {
  assert.equal(courseUnlockDate("2026-10-01", "OC", 1), "2026-10-08");
  assert.equal(courseUnlockDate("2026-10-01", "X", 1), "2026-10-15");
  assert.equal(courseUnlockDate("2026-10-01", "CCC", 2), "2026-10-29"); // 中間 10/22 那週休息
});
test("課程：18 份的週次不重複，最後一份在第 23 週", () => {
  const weeks = COURSE_HOSTS.flatMap((h) => Array.from({ length: COURSE_PARTS }, (_, i) => courseWeek(h, i + 1)));
  assert.equal(new Set(weeks).size, 18);
  assert.equal(Math.max(...weeks), 22); // 從 0 起算
  assert.ok(!weeks.some((w) => w % 4 === 3), "第 4、8、12… 週應該休息");
});


test("觀看分段：合併、每次最多 +5、擋掉怪資料", () => {
  assert.deepEqual(mergeBuckets({ 0: 2 }, { 0: 1, 1: 9, "-1": 1, x: 1 }), { 0: 3, 1: 5 });
  assert.deepEqual(mergeBuckets(null, null), {});
});
test("標題開頭的日期會拿掉", () => {
  assert.equal(cleanTitle("10/9 直播：本週盤勢"), "本週盤勢");
  assert.equal(cleanTitle("10/9"), "10/9");
});
test("章節：排序、同一秒只留一個、擋掉負數", () => {
  assert.deepEqual(cleanChapters([{ t: 60, title: "b" }, { t: 0, title: "a" }, { t: 60, title: "c" }, { t: -1, title: "x" }]), [{ t: 0, title: "a" }, { t: 60, title: "b" }]);
});
test("數字和日期檢查", () => {
  assert.equal(toInt("12"), 12); assert.equal(toInt("1.5"), null);
  assert.equal(isDate("2026-10-10"), true); assert.equal(isDate("2026-1-1"), false);
});

// ── BingX ──
async function atest(name, fn) {
  try { await fn(); pass++; console.log("PASS " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "：" + e.message); }
}
test("BingX 簽名字串：依 key 排序、不編碼", () => assert.equal(buildCanonical({ timestamp: 1696751141337, symbol: "BTC-USDT", recvWindow: 0 }), "recvWindow=0&symbol=BTC-USDT&timestamp=1696751141337"));
await atest("BingX 簽名跟 openssl 算的一樣", async () => assert.equal(await hmacHex("SECRET_KEY", "recvWindow=0&symbol=BTC-USDT&timestamp=1696751141337"), "fe041f159118c90ac13eab4d32f9e2d75b80ca6fe17ca8acd290aba864753ce2"));
test("很長的整數不失真", () => assert.equal(parseSafe('{"data":{"uid":12345678901234567890,"n":5}}').data.uid, "12345678901234567890"));
test("BingX 一次最多查 30 天：長的區間切段", () => {
  assert.deepEqual(dayChunks("2026-10-16", "2026-10-20"), [["20261016", "20261020"]]);
  assert.deepEqual(dayChunks("2026-10-16", "2026-11-18"), [["20261016", "20261114"], ["20261115", "20261118"]]);
});
test("BingX 達標日＝累計第一次跨過門檻那天", () => {
  const day = (d) => Date.UTC(2026, 9, d);
  const toDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const s = summarize([
    { uid: 111, commissionTime: day(3), tradingVolume: "1000000" },
    { uid: 111, commissionTime: day(1), tradingVolume: "2000000" },
    { uid: 111, commissionTime: day(9), tradingVolume: "500000.5" },
    { uid: 222, commissionTime: day(2), tradingVolume: "10" },
  ], 3300000, toDay);
  assert.deepEqual(s.get("111"), { total: 3500000.5, qualifiedOn: "2026-10-09" });
  assert.deepEqual(s.get("222"), { total: 10, qualifiedOn: null });
});

test("BingX commissionTime：毫秒、秒、YYYYMMDD 都看得懂（台灣日期）", () => {
  assert.equal(commissionDay(Date.UTC(2026, 9, 18)), "2026-10-18");
  assert.equal(commissionDay(String(Date.UTC(2026, 9, 18, 17))), "2026-10-19");
  assert.equal(commissionDay(Date.UTC(2026, 9, 18) / 1000), "2026-10-18");
  assert.equal(commissionDay("20261018"), "2026-10-18");
  assert.equal(commissionDay(20261018), "2026-10-18");
  assert.equal(commissionDay("2026-10-18"), "2026-10-18");
  assert.equal(commissionDay(""), null);
});

// 假的 BingX 伺服器：檢查簽名、分頁
const seen = [];
const fake = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const params = Object.fromEntries([...u.searchParams].filter(([k]) => k !== "signature"));
  const okSig = (await hmacHex("test-secret", buildCanonical(params))) === u.searchParams.get("signature");
  seen.push({ path: u.pathname, params, okSig, key: req.headers["x-bx-apikey"] });
  const send = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
  if (!okSig) return send({ code: 100001, msg: "signature" });
  if (u.pathname.endsWith("/inviteRelationCheck")) return send({ code: 0, data: { uid: Number(params.uid), inviteResult: params.uid === "88880001", directInvitation: true } });
  if (u.pathname.endsWith("/commissionDataList")) {
    if (bingxWants === "ms" && !/^\d{13}$/.test(params.startTime)) return send({ code: 100400, msg: "beginTime-over-366. The query time range cannot exceed 366 days" });
    if (bingxWants === "ymd" && !/^\d{8}$/.test(params.startTime)) return send({ code: 100400, msg: "startTime format error" });
    const page = Number(params.pageIndex);
    const all = Array.from({ length: 130 }, (_, i) => ({ uid: 88880001, commissionTime: Date.UTC(2026, 9, 1 + (i % 10)), tradingVolume: "100" }));
    return send({ code: 0, data: { list: all.slice((page - 1) * 100, page * 100), total: all.length } });
  }
  send({ code: 404, msg: "?" });
});
let bingxWants = "ms";
await new Promise((r) => fake.listen(0, r));
Object.assign(env, { BINGX_API_KEY: "test-key", BINGX_SECRET_KEY: "test-secret", BINGX_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
await atest("BingX 查邀請關係：簽名正確、帶 API Key", async () => {
  assert.deepEqual(await checkInvite("88880001"), { invited: true, direct: true });
  assert.deepEqual(await checkInvite("12345"), { invited: false, direct: true });
  assert.ok(seen.every((x) => x.okSig && x.key === "test-key" && x.params.timestamp && x.params.recvWindow === "5000"));
});
await atest("BingX 每日交易量會翻頁抓完（時間用毫秒，台灣那天的 00:00～23:59）", async () => {
  const list = await fetchDaily("20261001", "20261012");
  assert.equal(list.length, 130);
  const calls = seen.filter((x) => x.path.endsWith("/commissionDataList"));
  assert.deepEqual(calls.map((x) => x.params.pageIndex), ["1", "2"]);
  assert.equal(calls[0].params.startTime, String(Date.parse("2026-10-01T00:00:00+08:00")));
  assert.equal(calls[0].params.endTime, String(Date.parse("2026-10-12T23:59:59.999+08:00")));
});
await atest("BingX 如果要 YYYYMMDD 會自動改用，之後記住", async () => {
  bingxWants = "ymd";
  const n = seen.length;
  assert.equal((await fetchDaily("20261001", "20261012")).length, 130);
  assert.equal((await fetchDaily("20261001", "20261012")).length, 130);
  const tries = seen.slice(n).filter((x) => x.path.endsWith("/commissionDataList")).map((x) => x.params.startTime);
  assert.deepEqual(tries, [String(Date.parse("2026-10-01T00:00:00+08:00")), "20261001", "20261001", "20261001", "20261001"]);
  bingxWants = "ms";
  assert.equal((await fetchDaily("20261001", "20261012")).length, 130, "再換回毫秒也可以");
});
await atest("BingX 回錯誤代碼會丟出來", async () => {
  env.BINGX_SECRET_KEY = "wrong";
  await assert.rejects(checkInvite("88880001"), /100001/);
  env.BINGX_SECRET_KEY = "test-secret";
});
fake.close();

// ── Bybit ──
await atest("Bybit 簽名跟 openssl 算的一樣（timestamp + key + recvWindow + query）", async () =>
  assert.equal(await bybitSign("SECRET", "1658384314791", "XXXXXXXXXX", "category=option&symbol=BTC-29JUL22-25000-C"), "127fcc9af2478ece79faf001bb923e88bffacd4cc6218287491a8e5fb8d6c432"));
test("Bybit 參數：照順序、略過空值", () => assert.equal(bybitQuery({ size: 100, cursor: "", startDate: "2026-10-01" }), "size=100&startDate=2026-10-01"));
test("Bybit 查詢區間：這一輪第一天到昨天、一輪結束為止、第一天當天沒有資料", () => {
  assert.deepEqual(capRange("2026-10-16", "2026-11-15", "2026-10-20"), ["2026-10-16", "2026-10-19"]);
  assert.deepEqual(capRange("2026-10-16", "2026-11-15", "2026-11-17"), ["2026-10-16", "2026-11-15"]);
  assert.equal(capRange("2026-10-16", "2026-11-15", "2026-10-16"), null);
});
const bseen = [];
const bfake = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const query = u.search.slice(1);
  const h = req.headers;
  const okSig = h["x-bapi-sign"] === (await bybitSign("by-secret", h["x-bapi-timestamp"], "by-key", query));
  bseen.push({ path: u.pathname, query, okSig, key: h["x-bapi-api-key"], recv: h["x-bapi-recv-window"] });
  const send = (o, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (u.searchParams.get("uid") === "403") return send({}, 403);
  if (!okSig) return send({ retCode: 10004, retMsg: "error sign!" });
  if (u.pathname === "/v5/user/aff-customer-info") {
    const uid = u.searchParams.get("uid");
    return uid === "77770001" ? send({ retCode: 0, retMsg: "OK", result: { uid, tradeVol30Day: "1" } }) : send({ retCode: 10001, retMsg: "not your client" });
  }
  if (u.pathname === "/v5/affiliate/aff-user-list") {
    const cursor = u.searchParams.get("cursor") || "0";
    const all = Array.from({ length: 150 }, (_, i) => ({ userId: String(77770001 + i), tradeVol: String(1000 * (i + 1)), ...(i === 1 ? { tradfiTradeVol: "5890.958" } : {}) }));
    const start = Number(cursor);
    return send({ retCode: 0, retMsg: "OK", result: { list: all.slice(start, start + 100), nextPageCursor: start + 100 < all.length ? String(start + 100) : "" } });
  }
  send({ retCode: 10017, retMsg: "route not found" });
});
await new Promise((r) => bfake.listen(0, r));
Object.assign(env, { BYBIT_API_KEY: "by-key", BYBIT_SECRET_KEY: "by-secret", BYBIT_BASE_URL: `http://127.0.0.1:${bfake.address().port}` });
await atest("Bybit 查客戶：是我們的、不是我們的", async () => {
  assert.equal((await checkBybitClient("77770001")).invited, true);
  assert.equal((await checkBybitClient("12345")).invited, false);
  assert.ok(bseen.every((x) => x.okSig && x.key === "by-key" && x.recv === "5000"));
});
await atest("Bybit 設定錯誤（簽名、Key）會丟出來，不會當成「不是客戶」", async () => {
  env.BYBIT_SECRET_KEY = "wrong";
  await assert.rejects(checkBybitClient("77770001"), /10004/);
  env.BYBIT_SECRET_KEY = "by-secret";
});
await atest("Bybit 被擋地區（403）會丟出來", async () => assert.rejects(checkBybitClient("403"), /擋下/));
await atest("Bybit 交易量清單會翻頁抓完", async () => {
  const m = await fetchBybitVolumes("2026-10-01", "2026-10-14");
  assert.equal(m.size, 150);
  assert.equal(m.get("77770001"), 1000);
  assert.equal(m.get("77770150"), 150000);
  assert.ok(Math.abs(m.get("77770002") - (2000 + 589.0958)) < 1e-6, "TradFi（黃金、股票）打一折算進去");
  assert.deepEqual(bseen.filter((x) => x.path.endsWith("/aff-user-list")).map((x) => new URLSearchParams(x.query).get("cursor") || ""), ["", "100"]);
});
// 東京轉送：網站把簽好名的請求交給 bybit-proxy，從東京送出
const proxySeen = [];
let proxyDown = false;
const pfake = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", async () => {
    const b = JSON.parse(raw);
    proxySeen.push({ region: req.headers["x-region"], path: b.path, signed: !!b.headers?.["X-BAPI-SIGN"] });
    if (proxyDown) { res.writeHead(502); return res.end("{}"); }
    const r = await fetch(`${b.base}${b.path}?${b.query}`, { headers: b.headers });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: r.status, body: await r.text() }));
  });
});
await new Promise((r) => pfake.listen(0, r));
env.BYBIT_PROXY_URL = `http://127.0.0.1:${pfake.address().port}`;
await atest("Bybit 改從東京轉送：帶 x-region、簽好名，結果一樣", async () => {
  assert.equal((await checkBybitClient("77770001")).invited, true);
  assert.equal((await checkBybitClient("12345")).invited, false);
  assert.deepEqual(proxySeen.slice(-1)[0], { region: "ap-northeast-1", path: "/v5/user/aff-customer-info", signed: true });
});
await atest("轉送壞了就直接連 Bybit", async () => {
  proxyDown = true;
  const n = bseen.length;
  assert.equal((await checkBybitClient("77770001")).invited, true);
  assert.ok(bseen.length > n);
  proxyDown = false;
});
await atest("沒有設定 Supabase 或用假的 Bybit 時不轉送", async () => {
  const keep = env.BYBIT_PROXY_URL; delete env.BYBIT_PROXY_URL;
  assert.equal(bybitProxyUrl(), null);
  const base = env.BYBIT_BASE_URL; delete env.BYBIT_BASE_URL; env.SUPABASE_URL = "https://x.supabase.co/";
  assert.equal(bybitProxyUrl(), "https://x.supabase.co/functions/v1/bybit-proxy");
  env.BYBIT_PROXY = "off"; assert.equal(bybitProxyUrl(), null); delete env.BYBIT_PROXY;
  env.BYBIT_BASE_URL = base; env.BYBIT_PROXY_URL = keep;
});
delete env.BYBIT_PROXY_URL;
pfake.close();
bfake.close();

console.log(`\n單元測試：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
