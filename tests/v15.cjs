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
  // amy 進到第二輪、上一輪沒有交易量（第一輪先給第二級，這裡要測「手動給的第二級快到期」）
  const age = (email, days, prevAmounts) => fetch(BASE + "/api/__test/age", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, days, prevAmounts }) });
  await age("amy@example.com", 40);
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
  check("研究員看得到我的等級", await p.isVisible("#volPanel"));
  check("三級階梯寫出門檻", (await p.locator("#volPanel .ms-step").count()) === 3 && (await p.textContent("#volPanel .ms-strip")).includes("20 萬 USDT") && !(await p.textContent("#volPanel .ms-strip")).includes("手"));
  { const vt = await p.textContent("#volPanel"); check("寫出現在第幾級、還沒保住、三間交易所都列出、沒有 UM", vt.includes("你現在是第二級") && vt.includes("這一輪還沒保住") && ["OKX", "Bybit", "BingX"].every((ex) => vt.includes(ex)) && !vt.includes("UM"), vt); }
  check("還沒填不放空的進度條", (await p.locator("#volPanel .vol-row").count()) === 0);
  const banner = await p.textContent("#accessBanner");
  check("等級快到期會提醒還差多少、之後是第幾級", banner.includes("你的第二級到") && banner.includes("還有 5 天") && banner.includes("還差 20 萬") && banner.includes("起是沒有等級"), banner);
  check("標題寫我的等級和這一輪日期", (await p.textContent("#volPanel h2")) === "我的等級" && /這一輪 \d+\/\d+～\d+\/\d+/.test(await p.textContent("#volPanel .vol-range")));
  await p.screenshot({ path: "output/shots/v15-member-empty.png" });
  await c.close();

  // 管理員
  [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "boss@gmail.com"); await p.waitForSelector("#appView:not([hidden])");
  await p.goto(BASE + "/admin#volumes"); await p.waitForSelector(".vol-table"); await p.waitForTimeout(400);
  check("後台交易量頁：各級人數（停權的不算）", (await p.textContent("#volSub")).includes("還沒到第一級 1 位") && (await p.textContent("#volSub")).includes("不含 1 位已停權"), await p.textContent("#volSub"));
  check("停權的人預設不顯示", !(await p.isVisible("tr:has-text('banned@example.com')")));
  check("三級門檻按鈕", (await p.textContent("#volThreshold")).includes("三級門檻"));
  const amy = "tr:has-text('amy@example.com')", ban = "tr:has-text('banned@example.com')";
  await p.fill(`${amy} input[aria-label$='OKX 交易量']`, "100萬");
  check("100萬 即時顯示第二級、第三級還差 50 萬", (await p.textContent(`${amy} .vol-result`)).includes("第二級") && (await p.textContent(`${amy} .vol-result`)).includes("第三級還差 50 萬"), await p.textContent(`${amy} .vol-result`));
  await p.click("#volBox .vol-seg-btn[data-tab='banned']");
  check("切到「已停權」看得到停權的人、看不到正常的", (await p.isVisible(ban)) && !(await p.isVisible(amy)));
  await p.fill(`${ban} input[aria-label$='OKX 交易量']`, "0.6m");
  check("0.6m 顯示第二級、第三級還差 90 萬", (await p.textContent(`${ban} .vol-result`)).includes("第三級還差 90 萬"), await p.textContent(`${ban} .vol-result`));
  await p.fill(`${ban} input[aria-label$='OKX 交易量']`, "");
  check("交易量表格沒有 UM 欄", !(await p.textContent(".vol-table thead")).includes("UM") && !(await p.locator(`${ban} input[aria-label$='UM 交易量']`).count()));
  await p.fill(`${ban} input[aria-label$='OKX 交易量']`, "abc");
  check("看不懂的數字標紅框", (await p.getAttribute(`${ban} input[aria-label$='OKX 交易量']`, "class")).includes("bad"));
  await p.click(".vol-foot .btn.primary"); await p.waitForTimeout(300);
  check("有錯不能存", (await p.textContent(".toast:last-child")).includes("看不懂"));
  await p.fill(`${ban} input[aria-label$='OKX 交易量']`, "");
  await p.click("#volBox .vol-seg-btn[data-tab='active']");
  check("切回「正常」，剛剛填的數字還在", (await p.inputValue(`${amy} input[aria-label$='OKX 交易量']`)) === "1,000,000");
  await p.screenshot({ path: "output/shots/v15-admin-filled.png" });
  await p.click(".vol-foot .btn.primary"); await p.waitForTimeout(600);
  const toast = await p.textContent(".toast:last-child");
  check("儲存後寫幾位升級", toast.includes("已儲存 2 位") && toast.includes("1 位升級"), toast);
  const amyRow = await p.evaluate(() => App.api("/api/admin/volumes").then((r) => r.rows.find((x) => x.email === "amy@example.com")));
  check("今天的等級：第二級到下一輪結束", amyRow.tier === 2 && amyRow.cycle_tier === 2 && amyRow.tier_until === amyRow.next_end && (await p.textContent(amy)).includes("第二級，到 "), JSON.stringify(amyRow));
  check("每個人顯示自己這一輪的日期", (await p.textContent(amy)).includes("這一輪 "));
  check("顯示誰更新", (await p.textContent(amy)).includes("由 boss 更新"));
  check("各級人數更新（停權的不算）", (await p.textContent("#volSub")).includes("第二級 1 位"), await p.textContent("#volSub"));
  check("輸入框格式化成千分位", (await p.inputValue(`${amy} input[aria-label$='OKX 交易量']`)) === "1,000,000");
  // 三級門檻（只能看，不能改）
  await p.click("#volThreshold"); await p.waitForSelector(".modal .tier-table");
  check("三級門檻視窗列出三級", (await p.locator(".modal .tier-card").count()) === 3 && (await p.textContent(".modal")).includes("150 萬"));
  await p.keyboard.press("Escape");
  // 貼上一整批
  await p.click("#volPaste"); await p.waitForTimeout(200);
  await p.fill(".modal textarea", "amy@example.com 5,200,000\nnobody@x.com OKX 1\nbanned@example.com\tOKX\t600萬");
  await p.screenshot({ path: "output/shots/v15-paste.png" });
  await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(200);
  const hint = await p.textContent(".modal .hint");
  check("貼上：找不到的研究員有提醒", hint.includes("已填進 2 行") && hint.includes("nobody@x.com"), hint);
  await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(300);
  check("知道了會關掉視窗", !(await p.isVisible(".modal")));
  check("貼上：千分位數字正確", (await p.inputValue(`${amy} input[aria-label$='OKX 交易量']`)) === "5,200,000");
  check("貼上：Tab 分隔正確", (await p.inputValue(`${ban} input[aria-label$='OKX 交易量']`)) === "6,000,000");
  await p.click(".vol-foot .btn.primary"); await p.waitForTimeout(600);
  check("貼上 520 萬：第三級 1 位", (await p.textContent("#volSub")).includes("第三級 1 位"), await p.textContent("#volSub"));
  await p.screenshot({ path: "output/shots/v15-admin.png", fullPage: true });
  // 上一輪：兩位都還在第一輪
  await p.click("#volWhich .vol-seg-btn[data-which='previous']"); await p.waitForTimeout(500);
  check("上一輪：只列進到第二輪的人", (await p.textContent("#volBox")).includes("amy@example.com") && !(await p.textContent("#volBox")).includes("banned@example.com"), await p.textContent("#volBox"));
  await p.click("#volWhich .vol-seg-btn[data-which='current']"); await p.waitForSelector(".vol-table");
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
    check(`研究員看到第三級（${name}）`, t.includes("你現在是第三級") && t.includes("520 萬") && t.includes("已經是最高級"), t);
    check(`這一輪保住了就不提醒（${name}）`, !(await p.isVisible("#accessBanner")));
    if (name === "mobile") check("手機沒有橫向捲動（研究員）", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.screenshot({ path: `output/shots/v15-member-${name}.png`, fullPage: name === "mobile" });
    await c.close();
  }
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e); process.exit(1); });
