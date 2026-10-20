// 執行方式：npm test（會自動開模擬伺服器）
// v1.22：後台「聊天統計」：設定要統計的頻道（大廳、研究員大廳）、回報頻道，立即統計，看最近 30 天
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
    await p.goto(BASE + "/admin#chat"); await p.waitForSelector("#chatBox .chat-set");
    if (name === "電腦") {
      check("側欄有「聊天統計」", (await p.locator(".nav a[data-view=chat]").count()) === 1);
      check("還沒設定：提示先填頻道、立即統計不能按", (await p.textContent("#chatBox")).includes("先在上面填要統計的頻道") && (await p.isDisabled("#chatBox .chat-set:nth-of-type(2) .btn")));
      await p.fill("input[aria-label='要統計的頻道 ID']", "abc");
      await p.click("#chatBox .btn.primary"); await p.waitForTimeout(300);
      check("ID 格式不對會說清楚", (await p.textContent("#chatBox .form-error")).includes("複製頻道 ID"));
      await p.fill("input[aria-label='要統計的頻道 ID']", "100000000000000001, 100000000000000002");
      await p.click("#chatBox .btn.primary"); await p.waitForSelector("#chatBox .pill");
      check("預設各自貼回自己的頻道，說明研究員紀錄只有研究員看得到", (await p.getAttribute("[data-mode=own]", "aria-pressed")) === "true" && (await p.textContent("#chatBox")).includes("只有研究員看得到") && !(await p.isVisible("input[aria-label='每日回顧貼在哪個頻道']")));
      await p.click("[data-mode=single]");
      check("選全部貼同一個頻道：出現頻道欄位和提醒", (await p.isVisible("input[aria-label='每日回顧貼在哪個頻道']")) && (await p.textContent("#chatBox")).includes("研究員大廳的紀錄也會被看到"));
      await p.click("[data-mode=own]");
      check("儲存後顯示頻道名稱", (await p.textContent("#chatBox")).includes("#大廳") && (await p.textContent("#chatBox")).includes("#研究員大廳"));
      await p.click("#chatBox .chat-set:nth-of-type(2) .btn"); await p.waitForSelector(".chat-table tbody tr");
      check("立即統計：告訴總數、已貼到 Discord", (await p.textContent(".toast:last-child")).includes("100 則") && (await p.textContent(".toast:last-child")).includes("每日回顧已貼到 Discord"));
      check("最近 30 天表格：每個大廳一欄、有合計", (await p.textContent(".chat-table thead")).includes("#研究員大廳") && (await p.textContent(".chat-table thead")).includes("合計") && (await p.textContent(".chat-table tbody")).includes("40 則"));
      await p.screenshot({ path: "output/shots/v29-chat.png", fullPage: true });
    } else {
      check("手機沒有橫向捲動", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await p.screenshot({ path: "output/shots/v29-chat-mobile.png", fullPage: true });
    }
    await c.close();
  }
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
