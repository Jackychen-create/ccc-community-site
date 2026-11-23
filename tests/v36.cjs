// 執行方式：npm test（會自動開模擬伺服器）
// v1.36.0：加入培訓計畫兩步（選交易所、貼 UID → 進入 Discord 實驗室研究員專區）、成功頁的 Email／通知、用 Discord 登入、舊的 Email 登入收在下面
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
const j = async (path, body) => (await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })).json();

(async () => {
  const b = await chromium.launch();
  const ctx = async (vp) => {
    const c = await b.newContext({ viewport: vp });
    await c.addInitScript(() => { try { localStorage.setItem("tutorialOffered", "true"); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    return c;
  };
  // 新流程沒開：跟以前一樣，直接看到 Email 登入
  {
    const c = await ctx({ width: 390, height: 844 });
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE + "/"); await p.waitForSelector("#email", { state: "visible" });
    check("新流程沒設定好：退回 Email 登入（舊的表單直接打開）", await p.locator("#mainTabs").isHidden() && await p.locator("#joinPane").isHidden());
    await c.close();
  }
  await j("/api/__test/join-on", {});
  const c = await ctx({ width: 390, height: 844 });
  const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + "/"); await p.waitForSelector("#joinForm", { state: "visible" });
  check("登入頁預設是「加入培訓計畫」：交易所、UID 兩欄，沒有 Email、密碼", await p.locator("#email").isHidden() && await p.locator("#joinUid").isVisible());
  await p.screenshot({ path: "output/shots/v36-join-mobile.png" });
  await p.click("#joinSubmit");
  check("沒選交易所：提醒", (await p.textContent("#joinError")).includes("交易所"));
  await p.selectOption("#joinEx", "Bybit"); await p.fill("#joinUid", "90001234"); await p.click("#joinSubmit");
  await p.waitForSelector("#joinLinks", { state: "visible" });
  check("不是 CCC 連結註冊的：說原因、給三間的 CCC 註冊連結", (await p.textContent("#joinError")).includes("幾分鐘") && (await p.getAttribute("#joinLinks a[data-ex=Bybit]", "href")).includes("CCCX"));
  check("沒有「聯絡管理員」按鈕", !(await p.locator("#joinPane").textContent()).includes("聯絡管理員"));
  await p.fill("#joinUid", "12345678"); await p.click("#joinSubmit");
  await p.waitForSelector("#joinStep2", { state: "visible" });
  check("確認到：第二步只有「進入 Discord 實驗室研究員專區」", (await p.textContent("#joinOk")).includes("Bybit UID 12345678") && (await p.textContent("#joinDiscord")).includes("進入 Discord 實驗室研究員專區"));
  await p.screenshot({ path: "output/shots/v36-step2-mobile.png" });
  await p.click("#joinDiscord");
  await p.waitForSelector(".modal-back .welcome-box");
  const w = await p.textContent(".modal-back");
  check("授權回來：自動登入、開通完成、Email 帶好、有「打開 Discord 研究員頻道」", w.includes("開通完成") && (await p.inputValue(".welcome-box input[type=email]")) === "amy.lin@gmail.com" && (await p.getAttribute(".modal-back a.btn.primary", "href")).includes("/channels/100000000000000001/100000000000000003"));
  check("網址裡的登入代碼用完就拿掉", !(await p.evaluate(() => location.href)).includes("t="));
  check("右上角顯示他留的 Email，不是代號", (await p.textContent("#avatar")).trim() === "A");
  await p.screenshot({ path: "output/shots/v36-welcome-mobile.png" });
  await p.fill(".welcome-box input[type=email]", "amy.new@gmail.com");
  await p.click(".welcome-save .btn"); await p.waitForFunction(() => document.querySelector(".welcome-save p")?.textContent === "已儲存");
  const ct = await (await fetch(BASE + "/api/__test/shares")).ok;
  check("改 Email：儲存成功", ct);
  await c.close();
  // 另一台電腦：用 Discord 登入
  const c2 = await ctx({ width: 1280, height: 900 });
  const p2 = await c2.newPage(); p2.on("pageerror", (e) => errs.push(e.message));
  await p2.goto(BASE + "/"); await p2.waitForSelector("#tabSignin");
  await p2.click("#tabSignin");
  check("登入分頁：一顆「用 Discord 登入」", await p2.locator("#discordLogin").isVisible() && await p2.locator("#email").isHidden());
  await p2.screenshot({ path: "output/shots/v36-signin-desktop.png" });
  await p2.click("#discordLogin");
  await p2.waitForSelector("#appView:not([hidden])");
  check("用 Discord 登入：直接進研究員專區", await p2.locator("#authView").isHidden());
  await c2.close();
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
