// 規則和伺服器小工具的單元測試（不用瀏覽器，幾秒鐘跑完）。npm test 會先跑這一支。
import assert from "node:assert/strict";
import { addDays, cycleEnd, courseWeek, courseUnlockDate, isQualified, COURSE_HOSTS, COURSE_PARTS, EXCHANGES, AUTO_EXCHANGES, DEFAULT_THRESHOLD } from "../public/assets/js/shared/rules.js";
import { mergeBuckets } from "../server/lib/buckets.js";
import { cleanTitle, cleanChapters, toInt, isDate } from "../server/lib/text.js";
import http from "node:http";
import { env } from "../server/lib/env.js";
import { buildCanonical, hmacHex, parseSafe, monthRanges, summarize, checkInvite, fetchDaily } from "../server/lib/bingx.js";

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("PASS " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "：" + e.message); }
}

test("資格一輪：10/15 達標看到 11/14", () => assert.equal(cycleEnd("2026-10-15"), "2026-11-14"));
test("資格一輪：1/31 → 2/27（2 月沒有 31 號）", () => assert.equal(cycleEnd("2026-01-31"), "2026-02-27"));
test("資格一輪：12/1 跨年 → 12/31", () => assert.equal(cycleEnd("2026-12-01"), "2026-12-31"));
test("資格一輪：12/20 跨年 → 1/19", () => assert.equal(cycleEnd("2026-12-20"), "2027-01-19"));
test("日期加減跨月", () => assert.equal(addDays("2026-10-30", 3), "2026-11-02"));

test("交易所：OKX、Bybit、BingX（UM 先不算），BingX 自動同步", () => { assert.deepEqual(EXCHANGES, ["OKX", "Bybit", "BingX"]); assert.deepEqual(AUTO_EXCHANGES, ["BingX"]); });
test("預設門檻 100 萬", () => assert.equal(DEFAULT_THRESHOLD, 1000000));
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

test("交易量：任一間達門檻就算達標", () => {
  assert.equal(isQualified({ OKX: 100, BingX: 1000000 }, 1000000), true);
  assert.equal(isQualified({ OKX: 999999 }, 1000000), false);
  assert.equal(isQualified({ UM: 5000000 }, 1000000), false, "UM 先不算");
  assert.equal(isQualified(null, 1000000), false);
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
test("一個月切兩段、不查未來", () => {
  assert.deepEqual(monthRanges("2026-10", "2026-10-12"), [["20261001", "20261012"]]);
  assert.deepEqual(monthRanges("2026-10", "2026-10-31"), [["20261001", "20261015"], ["20261016", "20261031"]]);
  assert.deepEqual(monthRanges("2026-02", "2026-03-05"), [["20260201", "20260215"], ["20260216", "20260228"]]);
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
    const page = Number(params.pageIndex);
    const all = Array.from({ length: 130 }, (_, i) => ({ uid: 88880001, commissionTime: Date.UTC(2026, 9, 1 + (i % 10)), tradingVolume: "100" }));
    return send({ code: 0, data: { list: all.slice((page - 1) * 100, page * 100), total: all.length } });
  }
  send({ code: 404, msg: "?" });
});
await new Promise((r) => fake.listen(0, r));
Object.assign(env, { BINGX_API_KEY: "test-key", BINGX_SECRET_KEY: "test-secret", BINGX_BASE_URL: `http://127.0.0.1:${fake.address().port}` });
await atest("BingX 查邀請關係：簽名正確、帶 API Key", async () => {
  assert.deepEqual(await checkInvite("88880001"), { invited: true, direct: true });
  assert.deepEqual(await checkInvite("12345"), { invited: false, direct: true });
  assert.ok(seen.every((x) => x.okSig && x.key === "test-key" && x.params.timestamp && x.params.recvWindow === "5000"));
});
await atest("BingX 每日交易量會翻頁抓完", async () => {
  const list = await fetchDaily("20261001", "20261012");
  assert.equal(list.length, 130);
  assert.deepEqual(seen.filter((x) => x.path.endsWith("/commissionDataList")).map((x) => x.params.pageIndex), ["1", "2"]);
});
await atest("BingX 回錯誤代碼會丟出來", async () => {
  env.BINGX_SECRET_KEY = "wrong";
  await assert.rejects(checkInvite("88880001"), /100001/);
  env.BINGX_SECRET_KEY = "test-secret";
});
fake.close();

console.log(`\n單元測試：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
