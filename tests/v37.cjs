// 執行方式：npm test（會自動開模擬伺服器，這組不打開舊的交易量等級）
// v1.37.0：拿掉交易量門檻和等級、系統分享改成交易分享（空的、沒有排程）、直播留檔改叫直播紀錄、預設主題跟介紹網站同一套
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];

(async () => {
  const b = await chromium.launch();
  const ctx = async (vp) => {
    const c = await b.newContext({ viewport: vp });
    await c.addInitScript(() => { try { localStorage.setItem("tutorialOffered", "true"); localStorage.setItem("seenVersion", "\"9.9.9\""); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    return [c, p];
  };
  const login = async (p, email) => { await p.goto(BASE + "/"); await p.waitForSelector("#email", { state: "visible" }); await p.fill("#email", email); await p.fill("#password", "password1"); await p.click("#authSubmit"); await p.waitForSelector("#appView:not([hidden])"); };
  const closeAll = async (p) => { for (let i = 0; i < 4; i++) { if (!(await p.locator(".modal-back").count())) break; await p.keyboard.press("Escape"); await p.waitForTimeout(250); } };

  for (const [name, vp] of [["電腦", { width: 1280, height: 900 }], ["手機", { width: 390, height: 844 }]]) {
    const [c, p] = await ctx(vp);
    await login(p, "amy@example.com"); await p.waitForTimeout(900); await closeAll(p);
    const page = await p.textContent("#appView");
    check(`${name}：沒有「我的等級」、交易量、等級提醒`, (await p.locator("#volPanel").isHidden()) && (await p.locator("#accessBanner").isHidden()) && !page.includes("第二級") && !page.includes("交易量"));
    check(`${name}：叫「直播紀錄」，沒有「直播留檔」「系統分享」`, page.includes("直播紀錄") && !page.includes("直播留檔") && !page.includes("系統分享"));
    check(`${name}：左上角是金色 CCC° 標誌`, (await p.locator("#appView .brand img.brand-logo").count()) === 1);
    const badges = await p.locator("#badgePanel .badge, #badgePanel li").allTextContents().catch(() => []);
    check(`${name}：徽章沒有交易量、等級的`, !badges.join("").match(/第一筆|半山腰|第三級|連續三輪/), badges.join("|").slice(0, 80));
    await p.click("#menuBtn");
    const menu = await p.textContent("#menuPanel");
    check(`${name}：選單是「交易分享」、通知不提課程解鎖`, menu.includes("交易分享") && !menu.includes("系統分享") && !menu.includes("課程解鎖"));
    await p.keyboard.press("Escape");
    await p.evaluate(() => (location.hash = "#/course")); await p.waitForSelector("#courseView:not([hidden]) .empty-share");
    check(`${name}：交易分享是空的，沒有解鎖日期、週數`, (await p.textContent("#courseView")).includes("還沒有交易分享") && !(await p.textContent("#courseView")).match(/解鎖|第 \d+ 週/));
    await p.screenshot({ path: `output/shots/v37-share-empty-${name === "電腦" ? "desktop" : "mobile"}.png` });
    if (name === "手機") check("手機沒有橫向捲動", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await c.close();
  }

  // 後台把一支影片改成「交易分享」→ 研究員的交易分享看得到、直播紀錄列表不見
  {
    const [c, p] = await ctx({ width: 1280, height: 900 });
    await login(p, "boss@gmail.com");
    await p.goto(BASE + "/admin#videos"); await p.waitForSelector("#v-videos tr"); await p.waitForTimeout(600); await closeAll(p);
    await p.click("#v-videos tr:has-text('資金控管') .btn:has-text('編輯')");
    await p.waitForSelector(".modal .chip:has-text('交易分享')");
    const chips = (await p.locator(".modal .chips .chip").allTextContents()).slice(0, 3); // 後面是主講
    check("後台類型：直播紀錄／交易分享／公開影片（一般影片沒有系統分享）", chips.join("|") === "直播紀錄|交易分享|公開影片（不用登入）", chips.join("|"));
    await p.click(".modal .chip:has-text('交易分享')");
    await p.click(".modal .btn.primary:has-text('儲存')"); await p.waitForTimeout(600);
    await c.close();
    const [c2, m] = await ctx({ width: 1280, height: 900 });
    await login(m, "amy@example.com"); await m.waitForTimeout(800); await closeAll(m);
    check("直播紀錄列表不放交易分享的影片", !(await m.textContent("#grid")).includes("資金控管"));
    await m.evaluate(() => (location.hash = "#/course")); await m.waitForSelector("#courseList .course-row");
    check("交易分享看得到、可以點進去看", (await m.textContent("#courseList")).includes("資金控管") && (await m.locator("#courseList a.course-row").count()) === 1);
    await m.click("#courseList a.course-row"); await m.waitForSelector("#watchView:not([hidden])"); await m.waitForTimeout(500);
    check("播放頁的返回是「交易分享」", (await m.textContent("#watchBack")).includes("交易分享"), await m.textContent("#watchBack"));
    await m.screenshot({ path: "output/shots/v37-share-desktop.png" });
    await c2.close();
  }
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
