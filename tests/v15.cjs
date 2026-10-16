// 執行方式：npm test（會自動開模擬伺服器）。單獨跑：node tests/mock-server.mjs &; node tests/v15.cjs
// v1.5 每月交易量測試
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const end = (() => { const [y, m, dd] = today.split("-").map(Number); const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); const x = new Date(Date.UTC(y, m, Math.min(dd, last))); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); })();
(async () => {
  const b = await chromium.launch();
  async function ctx(vp) {
    const c = await b.newContext({ viewport: vp }); await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    return [c, p];
  }
  async function login(p, email) {
    await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
    await p.fill("#email", email); await p.fill("#password", "password1"); await p.click("#authSubmit");
  }
  // 研究員：還沒填
  let [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "amy@example.com"); await p.waitForSelector(".vrow"); await p.waitForTimeout(800);
  check("研究員看得到本月交易量", await p.isVisible("#volPanel"));
  check("還沒填顯示尚未更新", (await p.textContent("#volPanel")).includes("尚未更新"));
  { const vt = await p.textContent("#volPanel"); check("四間交易所都列出", ["OKX", "UM", "Bybit", "BingX"].every((ex) => vt.includes(ex)) && vt.includes("10 手"), vt); }
  check("還沒填不放空的進度條", (await p.locator("#volPanel .vol-row").count()) === 0);
  const banner = await p.textContent("#accessBanner");
  check("資格提醒寫出達標後再看一個月", banner.includes("達標那天起可以再看一個月") && banner.includes("100 萬"), banner);
  await p.screenshot({ path: "output/shots/v15-member-empty.png" });
  await c.close();

  // 管理員
  [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "boss@gmail.com"); await p.waitForSelector("#appView:not([hidden])");
  await p.goto(BASE + "/admin#volumes"); await p.waitForSelector(".vol-table"); await p.waitForTimeout(400);
  check("後台交易量頁", (await p.textContent("#volSub")).includes("0／2"), await p.textContent("#volSub"));
  check("門檻按鈕 100 萬", (await p.textContent("#volThreshold")).includes("100 萬"));
  const amy = "tr:has-text('amy@example.com')", ban = "tr:has-text('banned@example.com')";
  await p.fill(`${amy} input[aria-label$='OKX 交易量']`, "100萬");
  check("100萬 即時顯示達標", (await p.textContent(`${amy} .vol-result`)).includes("達標"));
  await p.fill(`${ban} input[aria-label$='OKX 交易量']`, "0.6m");
  check("0.6m 顯示還差 40 萬", (await p.textContent(`${ban} .vol-result`)).includes("還差 40 萬"), await p.textContent(`${ban} .vol-result`));
  await p.fill(`${ban} input[aria-label$='UM 交易量']`, "7");
  check("UM 7 手顯示還差 3 手", (await p.textContent(`${ban} .vol-result`)).includes("UM 還差 3 手"), await p.textContent(`${ban} .vol-result`));
  await p.fill(`${ban} input[aria-label$='UM 交易量']`, "10");
  check("UM 10 手就達標", (await p.textContent(`${ban} .vol-result`)).includes("達標"));
  check("表頭寫 UM（手）", (await p.textContent(".vol-table thead")).includes("UM（手）"));
  await p.fill(`${ban} input[aria-label$='UM 交易量']`, "");
  await p.fill(`${ban} input[aria-label$='OKX 交易量']`, "abc");
  check("看不懂的數字標紅框", (await p.getAttribute(`${ban} input[aria-label$='OKX 交易量']`, "class")).includes("bad"));
  await p.click(".vol-foot .btn.primary"); await p.waitForTimeout(300);
  check("有錯不能存", (await p.textContent(".toast:last-child")).includes("看不懂"));
  await p.fill(`${ban} input[aria-label$='OKX 交易量']`, "");
  await p.screenshot({ path: "output/shots/v15-admin-filled.png" });
  await p.click(".vol-foot .btn.primary"); await p.waitForTimeout(600);
  const toast = await p.textContent(".toast:last-child");
  check("儲存後延長資格", toast.includes("已儲存 2 位") && toast.includes(`1 位的資格延長到 ${end}`), toast);
  check("表格顯示新資格", (await p.textContent(amy)).includes(`到 ${end}`));
  check("顯示誰更新", (await p.textContent(amy)).includes("由 boss 更新"));
  check("達標人數 1／2", (await p.textContent("#volSub")).includes("1／2"));
  check("輸入框格式化成千分位", (await p.inputValue(`${amy} input[aria-label$='OKX 交易量']`)) === "1,000,000");
  // 門檻
  await p.click("#volThreshold"); await p.waitForTimeout(200);
  await p.fill(".modal input", "500萬"); await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(600);
  check("門檻改成 500 萬", (await p.textContent("#volThreshold")).includes("500 萬"));
  check("新門檻重新判斷", (await p.textContent("#volSub")).includes("0／2") && (await p.textContent(`${amy} .vol-result`)).includes("還差 400 萬"));
  check("資格不會被收回", (await p.textContent(amy)).includes(`到 ${end}`));
  // 貼上一整批
  await p.click("#volPaste"); await p.waitForTimeout(200);
  await p.fill(".modal textarea", "amy@example.com 5,200,000 0\nnobody@x.com OKX 1\nbanned@example.com\tOKX\t600萬");
  await p.screenshot({ path: "output/shots/v15-paste.png" });
  await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(200);
  const hint = await p.textContent(".modal .hint");
  check("貼上：找不到的研究員有提醒", hint.includes("已填進 2 行") && hint.includes("nobody@x.com"), hint);
  await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(300);
  check("知道了會關掉視窗", !(await p.isVisible(".modal")));
  check("貼上：千分位數字正確", (await p.inputValue(`${amy} input[aria-label$='OKX 交易量']`)) === "5,200,000");
  check("貼上：Tab 分隔正確", (await p.inputValue(`${ban} input[aria-label$='OKX 交易量']`)) === "6,000,000");
  await p.click(".vol-foot .btn.primary"); await p.waitForTimeout(600);
  check("兩位都達標", (await p.textContent("#volSub")).includes("2／2"));
  await p.screenshot({ path: "output/shots/v15-admin.png", fullPage: true });
  // 上個月
  await p.fill("#volMonth", "2026-09"); await p.dispatchEvent("#volMonth", "change"); await p.waitForTimeout(500);
  check("切換月份是空的", (await p.textContent("#volSub")).includes("0／2"));
  await c.close();
  // 手機後台
  [c, p] = await ctx({ width: 390, height: 844 });
  await login(p, "boss@gmail.com"); await p.waitForSelector("#appView:not([hidden])");
  await p.goto(BASE + "/admin#volumes"); await p.waitForSelector(".vol-table"); await p.waitForTimeout(400);
  check("手機沒有橫向捲動", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.screenshot({ path: "output/shots/v15-admin-mobile.png", fullPage: true });
  await c.close();

  // 研究員：已達標
  for (const [name, vp] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    [c, p] = await ctx(vp);
    await login(p, "amy@example.com"); await p.waitForSelector(".vrow"); await p.waitForTimeout(900);
    const t = await p.textContent("#volPanel");
    check(`研究員看到已達標（${name}）`, t.includes("已達標") && t.includes("520 萬"), t);
    check(`資格離月底遠就不提醒（${name}）`, !(await p.isVisible("#accessBanner")));
    if (name === "mobile") check("手機沒有橫向捲動（研究員）", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.screenshot({ path: `output/shots/v15-member-${name}.png`, fullPage: name === "mobile" });
    await c.close();
  }
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e); process.exit(1); });
