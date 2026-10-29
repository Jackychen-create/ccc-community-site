// 執行方式：npm test（會自動開模擬伺服器）
// v1.26.14–15：交易檢討投稿（後台「聊天統計」頁：填頻道、投稿表情、立即整理、勾已點評）
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];

(async () => {
  const b = await chromium.launch();
  for (const [name, vp] of [["電腦", { width: 1280, height: 900 }], ["手機", { width: 390, height: 844 }]]) {
    const c = await b.newContext({ viewport: vp });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
    await p.fill("#email", "boss@gmail.com"); await p.fill("#password", "password1"); await p.click("#authSubmit"); await p.waitForSelector("#appView:not([hidden])");
    await p.goto(BASE + "/admin#chat"); await p.waitForSelector("#reviewsCard #rvPerf");
    if (name === "電腦") {
      check("沒填交易績效頻道時「立即整理」不能按", await p.isDisabled("#reviewsCard .btn:has-text('立即整理')"));
      await p.fill("#rvPerf", "123"); await p.click("#reviewsCard .btn:has-text('儲存')"); await p.waitForTimeout(300);
      check("頻道 ID 格式不對會擋", !(await p.isHidden("#reviewsCard .form-error")) && (await p.textContent("#reviewsCard .form-error")).includes("17–20"));
      await p.fill("#rvPerf", "100000000000000011"); await p.fill("#rvPublic", "100000000000000012");
      check("投稿表情：預設放大鏡，伺服器的熊熊也列出來", (await p.locator("#reviewsCard .rv-emo").count()) === 3 && (await p.getAttribute("#reviewsCard .rv-emo[aria-label*='bear_ok']", "aria-pressed")) === "false" && (await p.getAttribute("#reviewsCard .rv-emo >> nth=0", "aria-pressed")) === "true");
      await p.click("#reviewsCard .rv-emo[aria-label*='bear_ok']"); await p.click("#reviewsCard .rv-emo >> nth=0"); await p.click("#reviewsCard .rv-emo >> nth=1");
      await p.click("#reviewsCard .btn:has-text('儲存')"); await p.waitForSelector("#reviewsCard .dc-ok");
      check("只選熊熊、儲存後還是熊熊", (await p.locator("#reviewsCard .rv-emo[aria-pressed=true]").count()) === 1 && (await p.getAttribute("#reviewsCard .rv-emo[aria-pressed=true]", "aria-label")).includes("bear_ok"));
      check("儲存後顯示頻道名稱", (await p.textContent("#reviewsCard")).includes("#交易績效") && (await p.textContent("#reviewsCard")).includes("#實驗大廳"));
      await p.click("#reviewsCard .btn:has-text('立即整理')"); await p.click(".modal .btn:has-text('整理')");
      await p.waitForSelector("#reviewsCard .rv-item");
      check("整理後列出投稿（名字、內容、只有圖片、原文連結）", (await p.locator("#reviewsCard .rv-item").count()) === 2 && (await p.textContent("#reviewsCard")).includes("NQ 開盤追空") && (await p.textContent("#reviewsCard")).includes("（只有圖片）") && (await p.getAttribute("#reviewsCard .rv-item a", "href")).startsWith("https://discord.com/channels/900000000000000000/100000000000000011/"));
      await p.check("#reviewsCard .rv-item >> nth=0 >> input[type=checkbox]"); await p.waitForTimeout(400);
      const dms = await (await fetch(BASE + "/api/__test/review-dms")).json();
      check("勾已點評：私訊投稿的人", dms.length === 1 && dms[0] === "111111111111111111", JSON.stringify(dms));
      check("提示已私訊", (await p.textContent(".toast:last-child")).includes("已私訊 Amy"));
      // v1.26.18 新人試用週
      await p.waitForSelector("#onboardCard #obState");
      check("新人試用週：預設沒打開、可以看 7 天內容", (await p.textContent("#obState")).includes("還沒打開") && (await p.locator("#onboardCard .ob-msg").count()) === 7 && (await p.textContent("#onboardCard .ob-msg")).includes("#頻道"));
      await p.click("#onboardCard .btn:has-text('打開')"); await p.click(".modal .btn:has-text('打開')");
      await p.waitForSelector("#obState.dc-ok");
      check("打開後顯示已打開、列出這 7 天的新人", (await p.textContent("#onboardCard")).includes("新人小明") && (await p.textContent("#onboardCard")).includes("第 2 天"));
    } else {
      await p.waitForSelector("#reviewsCard .rv-item");
      check("手機沒有橫向捲動", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await p.locator("#reviewsCard").screenshot({ path: `output/shots/v32-reviews-${name === "電腦" ? "desktop" : "mobile"}.png` });
    await c.close();
  }
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
