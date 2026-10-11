// 規則和伺服器小工具的單元測試（不用瀏覽器，幾秒鐘跑完）。npm test 會先跑這一支。
import assert from "node:assert/strict";
import { addDays, cycleEnd, courseWeek, courseUnlockDate, isQualified, COURSE_HOSTS, COURSE_PARTS } from "../public/assets/js/shared/rules.js";
import { mergeBuckets } from "../server/lib/buckets.js";
import { cleanTitle, cleanChapters, toInt, isDate } from "../server/lib/text.js";

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
  assert.equal(isQualified({ OKX: 100, UM: 3300000 }, 3300000), true);
  assert.equal(isQualified({ OKX: 3299999 }, 3300000), false);
  assert.equal(isQualified(null, 3300000), false);
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

console.log(`\n單元測試：${pass} 項通過，${fail} 項失敗`);
process.exit(fail ? 1 : 0);
