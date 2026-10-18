// 執行方式：npm test（會自動開模擬伺服器）。單獨跑：node tests/mock-server.mjs &; node tests/v17.cjs
// v1.7：提問回報、觀看分段、待跟進、網站狀況
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
(async () => {
  const b = await chromium.launch();
  async function ctx(vp, mobile = false) {
    const c = await b.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
    await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    return [c, p];
  }
  async function login(p, email) {
    await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
    await p.fill("#email", email); await p.fill("#password", "password1"); await p.click("#authSubmit");
  }
  // ── 研究員 ──
  let [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "amy@example.com"); await p.waitForSelector(".vrow");
  await p.goto(BASE + "/#/v/6"); await p.waitForSelector("#watchView:not([hidden])"); await p.waitForTimeout(1200);
  await p.evaluate(() => { const v = document.querySelector("#video"); v.currentTime = 0; return v.play(); });
  await p.waitForTimeout(3500);
  await p.evaluate(() => { document.querySelector("#video").currentTime = 50; });
  await p.waitForTimeout(3000);
  await p.evaluate(() => document.querySelector("#video").pause()); await p.waitForTimeout(800);
  const prog = await (await p.request.get(BASE + "/__log")).json();
  check("播放時有送出觀看分段", prog.some((l) => l.startsWith("POST /api/progress")));
  // 提問
  await p.click("#askBtn"); await p.waitForSelector(".modal");
  check("提問視窗帶出目前時間", (await p.textContent(".modal")).includes("這裡"));
  await p.fill(".modal textarea", "這裡停損為什麼放在前低下面？");
  await p.screenshot({ path: "output/shots/v17-ask.png" });
  await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(500);
  check("提問送出", (await p.textContent(".toast:last-child")).includes("已送出"));
  // 自動回報：播放失敗、搜尋找不到
  await p.evaluate(() => App.report("video", "播放失敗（錯誤碼 4）", { video: 6, title: "測試影片" }));
  await p.goto(BASE + "/#/"); await p.waitForSelector(".vrow");
  await p.fill("#search", "布林通道"); await p.waitForTimeout(2200);
  await c.close();

  // ── 管理員 ──
  [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "boss@gmail.com"); await p.waitForSelector("#appView:not([hidden])");
  await p.goto(BASE + "/admin#feedback"); await p.waitForSelector(".fb-card"); await p.waitForTimeout(300);
  check("側欄顯示待回覆數", (await p.textContent("#cFeedback")).trim() === "1");
  check("收件匣看得到提問和時間點", (await p.textContent(".fb-card")).includes("前低") && (await p.textContent(".fb-card")).includes("amy@example.com"));
  await p.screenshot({ path: "output/shots/v17-admin-feedback.png" });
  await p.fill(".fb-card textarea", "因為前低是結構點，跌破代表這筆的理由不成立。");
  await p.click(".fb-card .btn.primary"); await p.waitForTimeout(600);
  check("回覆並寄信", (await p.textContent(".toast:last-child")).includes("已回覆"));
  check("回覆後從待回覆消失", (await p.locator(".fb-card").count()) === 0);
  // 網站狀況
  await p.click(".nav a[data-view=health]"); await p.waitForSelector("#hlBox table"); await p.waitForTimeout(300);
  const hl = await p.textContent("#hlBox");
  check("網站狀況記到播放失敗", hl.includes("影片播不動") && hl.includes("播放失敗"), hl.slice(0, 120));
  check("記到搜尋找不到的關鍵字", hl.includes("布林通道"));
  await p.screenshot({ path: "output/shots/v17-admin-health.png", fullPage: true });
  await p.click("#hlBox tr:has-text('播放失敗') .btn"); await p.waitForTimeout(500);
  check("處理好了會移除", !(await p.textContent("#hlBox")).includes("播放失敗"));
  // 待跟進
  await p.click(".nav a[data-view=followup]"); await p.waitForSelector("#fuBox table"); await p.waitForTimeout(300);
  check("待跟進列出研究員和原因", (await p.locator("#fuBox tbody tr").count()) >= 1 && (await p.textContent("#fuBox")).includes("降到"));
  check("待跟進有篩選", (await p.locator("#fuFilter .chip").count()) >= 2);
  await p.screenshot({ path: "output/shots/v17-admin-followup.png", fullPage: true });
  await p.click("#fuBox tbody tr >> nth=0 >> .btn:has-text('等級')"); await p.waitForTimeout(300);
  check("待跟進可以直接改等級", await p.isVisible(".modal:has-text('手動給')"));
  await p.keyboard.press("Escape");
  // 觀看分段
  await p.click(".nav a[data-view=stats]"); await p.waitForSelector("#statsBox table"); await p.waitForTimeout(300);
  await p.click("#statsBox tr:has-text('本週盤勢') .btn:has-text('看分段')"); await p.waitForSelector(".ret-chart, .modal .empty", { timeout: 8000 });
  check("觀看分段有圖", (await p.locator(".ret-chart rect.ret-bar").count()) >= 3, String(await p.locator(".ret-chart rect.ret-bar").count()));
  check("分段重點整理", (await p.textContent(".ret-facts")).includes("人看過"));
  check("分段裡列出提問", (await p.textContent(".modal")).includes("前低"));
  await p.screenshot({ path: "output/shots/v17-admin-retention.png" });
  await p.keyboard.press("Escape");
  // 手機版後台
  await c.close();
  [c, p] = await ctx({ width: 390, height: 844 }, true);
  await login(p, "boss@gmail.com"); await p.waitForSelector("#appView:not([hidden])");
  await p.goto(BASE + "/admin#followup"); await p.waitForSelector("#fuBox table"); await p.waitForTimeout(300);
  check("手機後台沒有橫向捲動", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.screenshot({ path: "output/shots/v17-m-followup.png", fullPage: true });
  await c.close();

  // ── 研究員看到回覆 ──
  [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "amy@example.com"); await p.waitForSelector(".vrow"); await p.waitForTimeout(400);
  check("有新回覆時選單亮點", await p.evaluate(() => document.querySelector("#menuBtn").classList.contains("has-dot")));
  for (let i = 0; i < 5 && (await p.locator(".modal-back, .lvl-back").count()); i++) { await p.keyboard.press("Escape"); await p.waitForTimeout(300); }
  await p.click("#menuBtn"); await p.click("#menuPanel a[href='#/feedback']");
  await p.waitForSelector("#feedbackView:not([hidden]) .fb"); await p.waitForTimeout(300);
  const fbt = await p.textContent("#feedbackList");
  check("我的提問看得到回覆", fbt.includes("結構點") && fbt.includes("新回覆"));
  await p.screenshot({ path: "output/shots/v17-my-feedback.png" });
  await p.goto(BASE + "/#/"); await p.waitForTimeout(800);
  check("看過之後點點消失", !(await p.evaluate(() => document.querySelector("#menuBtn").classList.contains("has-dot"))));
  await c.close();
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
