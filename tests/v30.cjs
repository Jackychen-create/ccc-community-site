// 執行方式：npm test（會自動開模擬伺服器）
// v1.23：後台「機器人」：側欄分一組、新增 Webhook、每支機器人選 Webhook／討論串、預覽、打開、立即發一次
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
(async () => {
  const b = await chromium.launch();
  for (const [name, vp] of [["電腦", { width: 1280, height: 900 }], ["手機", { width: 390, height: 844 }]]) {
    const c = await b.newContext({ viewport: vp });
    await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
    await p.fill("#email", "boss@gmail.com"); await p.fill("#password", "password1"); await p.click("#authSubmit");
    await p.waitForSelector("#appView:not([hidden])");
    await p.goto(BASE + "/admin#bots"); await p.waitForSelector("#botsBox .bot-card");
    if (name === "電腦") {
      const nav = await p.locator(".nav").textContent();
      check("側欄有「機器人」一組：Discord 審核、聊天統計、機器人", (await p.isVisible("#navBotsHead")) && nav.indexOf("機器人") < nav.indexOf("Discord 審核") && nav.indexOf("Discord 審核") < nav.indexOf("聊天統計"));
      check("台股四支機器人分在「台股」", (await p.textContent("#botsBox")).includes("台股盤後報告") && (await p.locator(".bot-group:has(h2:text-is('台股')) .bot-card").count()) === 4);
      check("美股 4、加密 4、社群 1 支，各自一類", (await p.locator(".bot-group:has(h2:text-is('美股')) .bot-card").count()) === 4 && (await p.locator(".bot-group:has(h2:text-is('加密')) .bot-card").count()) === 4 && (await p.locator(".bot-group:has(h2:text-is('社群')) .bot-card").count()) === 1);
      await p.fill("input[aria-label='Webhook 名字']", "股市整合頻道");
      await p.fill("input[aria-label='Webhook 網址']", "https://example.com/x");
      await p.click(".bot-add .btn.primary"); await p.waitForTimeout(300);
      check("網址不對會說清楚", (await p.textContent(".bot-outlets .form-error")).includes("api/webhooks"));
      check("Webhook 網址用密碼框", (await p.getAttribute("input[aria-label='Webhook 網址']", "type")) === "password");
      await p.fill("input[aria-label='Webhook 網址']", "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEF");
      await p.click(".bot-add .btn.primary"); await p.waitForSelector(".bot-outlet");
      check("新增後只顯示名字和網址後四碼", (await p.textContent(".bot-outlet")).includes("股市整合頻道") && (await p.textContent(".bot-outlet")).includes("…CDEF") && !(await p.content()).includes("abcdefghijklmnop"));
      const card = ".bot-card:has(h3:text-is('台股盤後報告'))";
      await p.click(`${card} .switch`); await p.waitForTimeout(300);
      check("沒選 Webhook 不能打開", (await p.textContent(".toast:last-child")).includes("先選要貼到哪個 Webhook"));
      await p.selectOption(`${card} select`, { label: "股市整合頻道" });
      await p.fill(`${card} input[aria-label='台股盤後報告 的討論串 ID']`, "123");
      await p.click(`${card} .btn:has-text('儲存設定')`); await p.waitForTimeout(300);
      check("討論串 ID 格式不對會說清楚", (await p.textContent(".toast:last-child")).includes("複製討論串 ID"));
      await p.fill(`${card} input[aria-label='台股盤後報告 的討論串 ID']`, "777777777777777777");
      await p.click(`${card} .switch`); await p.waitForTimeout(500);
      check("打開：寫出什麼時候發", (await p.textContent(".toast:last-child")).includes("週一到五 15:15"));
      await p.click(`${card} .btn:has-text('預覽')`); await p.waitForSelector(`${card} .bot-embed`);
      check("預覽：顯示卡片內容", (await p.textContent(`${card} .bot-embed`)).includes("加權 46,887.77"));
      await p.click(`${card} .btn:has-text('立即發一次')`); await p.waitForTimeout(600);
      check("立即發一次：回報結果、顯示最近一次", (await p.textContent(".toast:last-child")).includes("已發到 Discord") && (await p.textContent(`${card} .bot-last`)).includes("✓ 已發"));
      check("開著的數量寫在標題下", (await p.textContent("#botsSub")).includes("1 支開著"));
      await p.screenshot({ path: "output/shots/v30-bots.png", fullPage: true });
    } else {
      check("手機沒有橫向捲動", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await p.screenshot({ path: "output/shots/v30-bots-mobile.png", fullPage: true });
    }
    await c.close();
  }
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
