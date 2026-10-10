// 執行方式：npm test（會自動開模擬伺服器）。單獨跑：node tests/mock-server.mjs &; node tests/v16.cjs
// v1.6：教學課程、使用教學、研究員
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
(async () => {
  const b = await chromium.launch();
  async function ctx(vp, offered = true, mobile = false) {
    const c = await b.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
    if (offered) await c.addInitScript(() => { try { localStorage.setItem("tutorialOffered", "true"); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    p.tut = [];
    p.on("request", (r) => { if (r.url().includes("/tutorial/")) p.tut.push(new URL(r.url()).pathname); });
    return [c, p];
  }
  async function login(p, email) {
    await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
    await p.fill("#email", email); await p.fill("#password", "password1"); await p.click("#authSubmit");
  }
  // 第一次來：問要不要看教學
  let [c, p] = await ctx({ width: 1440, height: 900 }, false);
  const WEBM = require("fs").readFileSync(__dirname + "/fixtures/live.webm");
  await p.route("**/tutorial/*.mp4", (r) => r.fulfill({ status: 200, contentType: "video/mp4", body: WEBM }));
  await login(p, "amy@example.com");
  await p.waitForSelector(".modal:has-text('歡迎加入交易實驗室')", { timeout: 8000 }).catch(() => {});
  check("第一次來會問要不要看教學", await p.isVisible(".modal:has-text('歡迎加入交易實驗室')"));
  await p.screenshot({ path: "output/shots/v16-welcome.png" });
  await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(400);
  check("教學影片：電腦看橫式", p.tut.includes("/tutorial/member-landscape.mp4"), p.tut.join());
  await p.waitForSelector(".modal video.tut-video", { timeout: 15000 });
  check("教學影片先整支載入（blob）", (await p.getAttribute(".modal video.tut-video", "src")).startsWith("blob:"));
  await p.waitForFunction(() => document.querySelector(".modal video.tut-video").readyState >= 1, null, { timeout: 15000 });
  const seekOk = await p.evaluate(() => new Promise((ok) => { const v = document.querySelector(".modal video.tut-video"); v.pause(); v.addEventListener("seeked", () => ok(v.currentTime), { once: true }); v.currentTime = 60; setTimeout(() => ok(v.currentTime), 5000); }));
  check("教學影片可以拉進度條", Math.abs(seekOk - 60) < 1, String(seekOk));
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  check("登入頁沒有「研究員」以外的舊稱", !(await p.textContent("body")).includes("會員"));
  // 直播列表不含課程
  await p.waitForSelector(".vrow");
  check("直播列表不會出現課程", !(await p.textContent("#grid")).includes("交易計畫怎麼寫"));
  const cp = await p.textContent("#coursePanel");
  check("右邊有教學課程卡", cp.includes("3／18 已解鎖") && cp.includes("下一份：CCC 第 2 份"), cp);
  await p.screenshot({ path: "output/shots/v16-list.png" });
  // 課程頁
  await p.click("#navCourse"); await p.waitForSelector("#courseView:not([hidden]) .course-row"); await p.waitForTimeout(300);
  check("頂部導覽標示目前頁", (await p.getAttribute("#navCourse", "aria-current")) === "page");
  check("課程 18 份", (await p.locator(".course-row").count()) === 18);
  check("已解鎖 3／18", (await p.textContent("#courseCount")).includes("3／18"));
  check("第 2 週是 OC、第 3 週是 X", (await p.textContent(".course-row >> nth=1")).includes("OC") && (await p.textContent(".course-row >> nth=2")).includes("X"));
  check("第 4 週休息（第 4 列是第 5 週）", (await p.textContent(".course-row >> nth=3")).includes("第 5 週"));
  check("沒解鎖的寫解鎖日", (await p.textContent(".course-row >> nth=3")).includes("解鎖"));
  check("沒解鎖的不能點", (await p.locator(".course-row >> nth=3").evaluate((e) => e.tagName)) === "DIV");
  check("還沒上架的寫準備中", (await p.textContent(".course-row >> nth=6")).includes("解鎖") || (await p.textContent(".course-row >> nth=6")).includes("準備中"));
  await p.screenshot({ path: "output/shots/v16-course.png", fullPage: true });
  await p.click(".course-row >> nth=0"); await p.waitForSelector("#watchView:not([hidden])"); await p.waitForTimeout(600);
  check("課程播放頁標示", (await p.textContent("#wMeta")).includes("教學課程") && (await p.textContent("#wMeta")).includes("第 1 份"));
  check("返回連結是教學課程", (await p.textContent("#watchBack")).includes("教學課程"));
  // 直接開沒解鎖的
  await p.goto(BASE + "/#/v/23"); await p.waitForTimeout(1200);
  check("沒解鎖的直接開也看不到", (await p.textContent("#wTitle")).includes("還沒解鎖"), await p.textContent("#wTitle"));
  check("沒解鎖不會跳到停權畫面", await p.isHidden("#blockedView"));
  await c.close();

  // 手機
  [c, p] = await ctx({ width: 390, height: 844 }, false, true);
  await login(p, "amy@example.com");
  await p.waitForSelector(".modal:has-text('歡迎加入交易實驗室')");
  await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(400);
  check("教學影片：手機看直式", p.tut.includes("/tutorial/member-portrait.mp4"), p.tut.join());
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  await p.screenshot({ path: "output/shots/v16-m-list.png" });
  const order = await p.evaluate(() => { const a = document.querySelector("#coursePanel").getBoundingClientRect().top; const l = document.querySelector("#listView .desk > .panel").getBoundingClientRect().top; return a < l; });
  check("手機上課程卡在列表上面", order);
  await p.click("#coursePanel a.btn"); await p.waitForSelector("#courseView:not([hidden]) .course-row"); await p.waitForTimeout(300);
  check("手機沒有橫向捲動（課程）", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.screenshot({ path: "output/shots/v16-m-course.png", fullPage: true });
  await c.close();

  // 管理員
  [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "boss@gmail.com"); await p.waitForSelector("#appView:not([hidden])");
  await p.click("#menuBtn"); await p.waitForTimeout(200);
  check("管理員選單有管理員使用教學", (await p.locator("#menuPanel :text('管理員使用教學')").count()) === 1);
  await p.goto(BASE + "/admin"); await p.waitForSelector(".course-grid"); await p.waitForTimeout(400);
  check("後台課程格子", (await p.textContent(".course-grid-card")).includes("已上架 4／18"));
  await p.screenshot({ path: "output/shots/v16-admin-videos.png" });
  await p.click("#videoTableBox tbody tr:has-text('停損設在哪裡') .btn:has-text('編輯')"); await p.waitForTimeout(300);
  check("直播留檔預設隱藏課程欄位", await p.isHidden(".modal .course-fields"));
  await p.click(".modal .chip:text-is('教學課程')");
  await p.selectOption(".modal select[aria-label='課程主講']", "CCC");
  await p.selectOption(".modal select[aria-label='第幾份']", "1");
  check("同一格已經有影片會提醒", (await p.textContent(".modal .course-fields .hint")).includes("已經是"));
  await p.selectOption(".modal select[aria-label='課程主講']", "OC");
  await p.selectOption(".modal select[aria-label='第幾份']", "2");
  check("寫出第幾週解鎖（OC 第 2 份＝第 6 週）", (await p.textContent(".modal .course-fields .hint")).includes("第 6 週"), await p.textContent(".modal .course-fields .hint"));
  check("課程不能寄全體通知", await p.isDisabled(".modal .btn:has-text('寄信通知研究員')"));
  await p.screenshot({ path: "output/shots/v16-admin-editor.png" });
  await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(600);
  check("表格標出課程", (await p.textContent("#videoTableBox")).includes("課程 OC 2/6"));
  check("格子變成 5／18", (await p.textContent(".course-grid-card")).includes("已上架 5／18"));
  check("後台沒有舊稱", !(await p.textContent("body")).includes("會員"));
  await p.click("#tutorialLink"); await p.waitForTimeout(300);
  check("後台使用教學", p.tut.includes("/tutorial/admin-landscape.mp4"), p.tut.join());
  await p.keyboard.press("Escape");
  await p.screenshot({ path: "output/shots/v16-admin-after.png" });
  // 教學影片不存在時的提示
  await p.evaluate(() => { const v = document.createElement("video"); });
  await p.route("**/tutorial/admin-landscape.mp4", (r) => r.fulfill({ status: 404, contentType: "text/html", body: "<html></html>" }));
  await p.click("#tutorialLink"); await p.waitForTimeout(1200);
  check("影片不見時會說明", (await p.textContent(".modal")).includes("教學影片還沒放上網站"));
  await p.keyboard.press("Escape");
  await c.close();
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
