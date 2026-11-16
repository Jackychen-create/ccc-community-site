// 執行方式：npm test（會自動開模擬伺服器）
// v1.28.0：付費制——不用實驗室密碼註冊、我的方案、買單集、訂閱月費、取消續扣、系統分享的購買按鈕、舊研究員照舊、後台「付費」
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
const j = async (path, body) => (await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })).json();
const yesterday = new Date(Date.now() + 8 * 3600e3 - 86400e3).toISOString().slice(0, 10);

(async () => {
  await j("/api/__test/pay", { mode: "test", paidFrom: yesterday });
  const b = await chromium.launch();
  for (const [name, vp, email] of [["電腦", { width: 1280, height: 900 }, "paid-desk@example.com"], ["手機", { width: 390, height: 844 }, "paid-phone@example.com"]]) {
    const shot = (n) => `output/shots/v35-${n}-${name === "電腦" ? "desktop" : "mobile"}.png`;
    const c = await b.newContext({ viewport: vp });
    await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
    await p.click("#tabRegister");
    await p.waitForFunction(() => document.querySelector("#authSub").textContent.includes("選方案"));
    check(`${name}：註冊不用實驗室密碼、不用填交易所`, (await p.textContent("#inviteRow .label")).includes("沒有就空白") && await p.locator("#uidRow").isHidden());
    await p.screenshot({ path: shot("register") });
    await p.fill("#email", email); await p.fill("#password", "password1"); await p.click("#authSubmit");
    await p.waitForSelector(".plans");
    for (let i = 0; i < 3; i++) { if (!(await p.locator(".modal-back").count())) break; await p.keyboard.press("Escape"); await p.waitForTimeout(300); }
    const txt = await p.textContent(".plans");
    check(`${name}：沒訂閱的首頁是「我的方案」：月費 66、單集 666、六集`, txt.includes("NT$66") && txt.includes("NT$666") && (await p.locator(".part-list li").count()) === 6, txt.slice(0, 120));
    check(`${name}：測試模式有測試卡說明`, txt.includes("4311-9522-2222-2222"));
    if (name === "手機") check("手機沒有橫向捲動（方案頁）", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.screenshot({ path: shot("plans"), fullPage: true });
    // 直播留檔：沒月費進不去
    await p.goto(BASE + "/#/v/6"); await p.waitForFunction(() => document.querySelector("#wTitle").textContent.includes("月費"));
    check(`${name}：沒月費打開直播留檔 → 說要月費、有「看方案」`, (await p.locator("#wDesc a[href='#/plans']").count()) === 1);
    // 系統分享頁：鎖著的有購買按鈕
    await p.goto(BASE + "/#/course"); await p.waitForSelector("#courseList .course-row");
    check(`${name}：系統分享每一份都有「購買第 N 集」`, (await p.locator("#courseList button:has-text('購買第 1 集')").count()) === 2 && (await p.locator("#courseList button:has-text('購買')").count()) === 12);
    await p.screenshot({ path: shot("course-locked") });
    // 買第 1 集（系統分享頁）→ 確認 → 綠界（假的）→ 回來
    await p.locator("#courseList button:has-text('購買第 1 集')").first().click();
    await p.waitForSelector(".modal:has-text('購買系統分享第 1 集')");
    await p.click(".modal .btn.primary");
    await p.waitForURL(/#\/course/);
    await p.waitForFunction(() => document.querySelectorAll("#courseList a.course-row").length === 2, null, { timeout: 15000 }).catch(() => {});
    check(`${name}：買了第 1 集：CCC、X 的第 1 份都打開`, (await p.locator("#courseList a.course-row").count()) === 2);
    // 訂閱月費
    await p.goto(BASE + "/#/plans"); await p.waitForSelector(".plans");
    await p.waitForTimeout(600);
    if (await p.locator(".modal-back").count()) { await p.keyboard.press("Escape"); await p.waitForTimeout(300); }
    await p.click(".plans .btn.primary.lg");
    await p.waitForURL(/#\/plans/); await p.waitForSelector(".plan-note.good");
    await p.waitForFunction(() => document.querySelector(".plans .pill.good"), null, { timeout: 15000 }).catch(() => {});
    const t2 = await p.textContent(".plans");
    check(`${name}：訂閱後顯示「訂閱中」、每月自動扣、第 1 集已買`, t2.includes("訂閱中") && t2.includes("每個月自動扣") && (await p.locator(".part-list li.own").count()) === 1, t2.slice(0, 160));
    await p.screenshot({ path: shot("subscribed"), fullPage: true });
    await p.goto(BASE + "/#/"); await p.waitForSelector("#grid .vrow, #grid .vcard, #grid a", { timeout: 8000 }).catch(() => {});
    check(`${name}：有月費：首頁是直播留檔列表`, !(await p.locator(".plans").count()) && (await p.locator("#volPanel h2:has-text('我的方案')").count()) === 1);
    await p.click("#menuBtn");
    check(`${name}：選單有「我的方案・月費會員」`, (await p.textContent("#menuPanel")).includes("我的方案") && (await p.textContent("#menuPanel")).includes("月費會員"));
    await p.keyboard.press("Escape");
    // 取消續扣
    await p.goto(BASE + "/#/plans"); await p.waitForSelector(".plans");
    await p.click(".plans button:has-text('取消自動扣款')");
    await p.click(".modal .btn:has-text('取消自動扣款')");
    await p.waitForFunction(() => document.querySelector(".plans")?.textContent.includes("已取消自動扣款"), null, { timeout: 8000 }).catch(() => {});
    check(`${name}：取消續扣後寫「可以用到…」，還是月費會員`, (await p.textContent(".plans")).includes("已取消自動扣款，會員可以用到"));
    await c.close();
  }
  // 舊研究員（付費制之前加入）照舊：沒有「我的方案」
  {
    const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
    await p.fill("#email", "amy@example.com"); await p.fill("#password", "password1"); await p.click("#authSubmit"); await p.waitForSelector("#appView:not([hidden])");
    for (let i = 0; i < 6; i++) { await p.waitForTimeout(800); if (!(await p.locator(".modal-back, .lvl-back").count())) break; if (await p.locator(".lvl-back").count()) await p.waitForSelector(".lvl-flaps[data-done]"); await p.keyboard.press("Escape"); }
    await p.click("#menuBtn");
    check("舊研究員：選單沒有「我的方案」", !(await p.textContent("#menuPanel")).includes("我的方案"));
    await p.keyboard.press("Escape");
    await p.goto(BASE + "/#/plans"); await p.waitForTimeout(500);
    check("舊研究員：打開 #/plans 會回首頁", !(await p.locator(".plans").count()));
    await c.close();
  }
  // 後台「付費」
  {
    const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await c.addInitScript(() => { try { } catch {} });
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE + "/admin"); await p.waitForURL(/next=admin/);
    await p.fill("#email", "boss@gmail.com"); await p.fill("#password", "password1"); await p.click("#authSubmit");
    await p.waitForURL(/\/admin/); await p.waitForSelector("#shell:not([hidden])");
    for (let i = 0; i < 3; i++) { if (!(await p.locator(".modal-back").count())) break; await p.keyboard.press("Escape"); await p.waitForTimeout(300); }
    await p.click(".nav a[data-view=pay]"); await p.waitForSelector("#payBox .pay-panel");
    const t = await p.textContent("#v-pay");
    check("後台：付費頁有收款模式、價格、開始日期、訂單", t.includes("收款模式") && t.includes("付費制開始") && t.includes("paid-desk@example.com") && t.includes("系統分享第 1 集"), t.slice(0, 200));
    await p.fill("#payBox .pay-grant input[type=email]", "paid-phone@example.com");
    await p.selectOption("#payBox .pay-grant select", "part:3");
    await p.click("#payBox .pay-grant .btn");
    await p.waitForSelector(".toast");
    check("後台：手動開第 3 集", (await p.textContent("#payBox")).includes("系統分享第 3 集"));
    await p.screenshot({ path: "output/shots/v35-admin-pay.png", fullPage: true });
    await c.close();
  }
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
