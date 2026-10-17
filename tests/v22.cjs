// 執行方式：npm test（會自動開模擬伺服器）
// v1.15：直播預告：後台排直播（發 Discord 公告）、修改、取消；研究員首頁顯示下一場
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
(async () => {
  const b = await chromium.launch();
  async function ctx(vp) {
    const c = await b.newContext({ viewport: vp });
    await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); localStorage.setItem("seenVersion", JSON.stringify("9.9.9")); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    return [c, p];
  }
  async function login(p, email) {
    await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
    await p.fill("#email", email); await p.fill("#password", "password1"); await p.click("#authSubmit");
  }
  const closeModals = async (p) => { while (await p.locator(".modal-back").count()) { await p.keyboard.press("Escape"); await p.waitForTimeout(150); } };

  const pad = (n) => String(n).padStart(2, "0");
  const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day2 = new Date(Date.now() + 2 * 86400e3); day2.setHours(20, 0, 0, 0);
  const day3 = new Date(Date.now() + 3 * 86400e3); day3.setHours(21, 30, 0, 0);

  let [c, a] = await ctx({ width: 1440, height: 900 });
  await login(a, "boss@gmail.com"); await a.waitForSelector("#appView:not([hidden])");
  await a.goto(BASE + "/admin#lives"); await a.waitForSelector("#liveTableBox .empty"); await closeModals(a);
  check("側欄有直播預告", await a.isVisible(".nav a[data-view='lives']"));
  check("還沒排直播的說明", (await a.textContent("#liveTableBox")).includes("還沒有排直播"));
  check("說明會發到實驗室頻道", (await a.textContent("#liveHint")).includes("🧪實驗室"));
  await a.click("#liveSave"); await a.waitForTimeout(300);
  check("沒標題會提醒", (await a.textContent(".toast:last-child")).includes("標題"));
  await a.fill("#liveTitle", "NQ 盤前直播");
  await a.fill("#liveAt", local(day2));
  await a.fill("#liveNote", "聊這週的 FOMC 和開盤區間");
  await a.fill("#liveLink", "https://youtube.com/live/abc");
  check("預設提及實驗室研究員", await a.isChecked("#liveMention"));
  await a.click("#liveSave"); await a.waitForSelector(".toast:has-text('已排定')");
  check("排定後提示已通知 Discord", (await a.textContent(".toast:last-child")).includes("Discord"));
  const row = await a.textContent("#liveTableBox");
  check("列表出現這場、時間 20:00、已公告", row.includes("NQ 盤前直播") && row.includes("20:00") && row.includes("已公告"), row.slice(0, 200));
  check("表單清空", (await a.inputValue("#liveTitle")) === "");
  check("排定後說明還是寫會發到實驗室頻道", (await a.textContent("#liveHint")).includes("🧪實驗室"), await a.textContent("#liveHint"));
  await a.screenshot({ path: "output/shots/v22-admin.png" });

  // 修改時間
  await a.click("#liveTableBox button:has-text('修改')");
  check("修改時帶入原本的資料", (await a.inputValue("#liveTitle")) === "NQ 盤前直播" && (await a.inputValue("#liveAt")) === local(day2));
  check("修改時不顯示提及選項", !(await a.isVisible("#liveMentionRow")));
  await a.fill("#liveAt", local(day3));
  await a.click("#liveSave"); await a.waitForSelector(".toast:has-text('已改時間')");
  check("改時間後列表更新", (await a.textContent("#liveTableBox")).includes("21:30"));
  await a.fill("#liveTitle", "加開：選擇權入門"); await a.fill("#liveAt", local(new Date(day3.getTime() + 86400e3)));
  await a.click("#liveSave");
  // 前一則「已排定」的提示可能還在，等列表真的多一場
  await a.waitForFunction(() => document.querySelector("#cLives").textContent.trim() === "2", null, { timeout: 5000 }).catch(() => {});
  check("側欄數字是 2 場", (await a.textContent("#cLives")).trim() === "2");

  // 研究員首頁
  const [c2, m] = await ctx({ width: 1440, height: 900 });
  await login(m, "amy@example.com"); await m.waitForSelector("#livePanel:not([hidden])"); await closeModals(m);
  const card = await m.textContent("#livePanel");
  check("研究員首頁顯示下一場直播", card.includes("下一場直播") && card.includes("NQ 盤前直播") && card.includes("21:30"), card);
  check("顯示還有幾天", /再 3 天|明天|再 \d+ 天/.test(card), card);
  check("有前往直播按鈕", (await m.getAttribute("#livePanel a.btn", "href")) === "https://youtube.com/live/abc");
  await m.screenshot({ path: "output/shots/v22-member.png" });
  await c2.close();

  // 取消
  await a.click("#liveTableBox tr:has-text('NQ 盤前直播') button:has-text('取消直播')"); await a.waitForSelector(".modal:has-text('取消這場直播')");
  check("取消前會確認", (await a.textContent(".modal")).includes("劃掉"));
  await a.click(".modal-foot .btn.danger-solid"); await a.waitForSelector(".toast:has-text('已取消直播')");
  const after = await a.textContent("#liveTableBox");
  check("取消的移到下面", after.includes("已結束、已取消（1）"), after.slice(0, 200));
  check("側欄數字剩 1 場", (await a.textContent("#cLives")).trim() === "1");
  await c.close();

  const [c3, m2] = await ctx({ width: 390, height: 844 });
  await login(m2, "amy@example.com"); await m2.waitForSelector("#livePanel:not([hidden])"); await closeModals(m2);
  check("取消後首頁換成下一場", (await m2.textContent("#livePanel")).includes("選擇權入門"));
  const ov = await m2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("手機沒有橫向捲動", ov <= 0, `overflow=${ov}`);
  await m2.screenshot({ path: "output/shots/v22-mobile.png", fullPage: true });
  await c3.close();
  const [c4, am] = await ctx({ width: 390, height: 844 });
  await login(am, "boss@gmail.com"); await am.waitForSelector("#appView:not([hidden])");
  await am.goto(BASE + "/admin#lives"); await am.waitForSelector("#liveTableBox table"); await closeModals(am);
  const ov2 = await am.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("後台手機沒有橫向捲動", ov2 <= 0, `overflow=${ov2}`);
  await am.screenshot({ path: "output/shots/v22-admin-mobile.png", fullPage: true });
  await c4.close();

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
