// 執行方式：npm test（會自動開模擬伺服器）
// v1.26.19：直播留檔搜尋（連逐字稿）、AI 重點點了跳到那一段、後台補發給掉隊的人
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
const j = async (path, { method = "GET", body } = {}) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const HL = { status: "done", summary: "這場講開盤區間怎麼畫，以及兩個常見陷阱。", points: ["先等 30 分鐘再畫高低點", "假突破要看量"], point_times: [12, 45], tickers: [], chapters: [{ t: 0, title: "開場" }], model: "x", posted_at: null, transcript: "[0:00] 大家好今天講開盤區間\n[0:45] 第一個陷阱是假突破，要看成交量" };

(async () => {
  await j("/api/__test/highlight", { method: "POST", body: { video: 5, highlight: HL } });
  const b = await chromium.launch();
  const ctx = async (vp) => {
    const c = await b.newContext({ viewport: vp });
    await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    return [c, p];
  };
  const login = async (p, email) => { await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])"); await p.fill("#email", email); await p.fill("#password", "password1"); await p.click("#authSubmit"); await p.waitForSelector("#appView:not([hidden])"); };
  const closeAll = async (p) => { for (let i = 0; i < 6; i++) { await p.waitForTimeout(1200); if (!(await p.locator(".modal-back, .lvl-back").count())) break; if (await p.locator(".lvl-back").count()) await p.waitForSelector(".lvl-flaps[data-done]"); await p.keyboard.press("Escape"); } };

  for (const [name, vp] of [["電腦", { width: 1280, height: 900 }], ["手機", { width: 390, height: 844 }]]) {
    const [c, p] = await ctx(vp);
    await login(p, "amy@example.com"); await closeAll(p);
    await p.waitForSelector("#grid .vrow, #grid a");
    // 搜尋：標題沒有「陷阱」，但直播裡有講到
    if (name === "手機" && !(await p.isVisible("#search"))) await p.click("#searchBox").catch(() => {});
    await p.fill("#search", "陷阱");
    await p.waitForSelector("#grid .chap-hit", { timeout: 5000 }).catch(() => {});
    const grid = await p.textContent("#grid");
    check(`${name}：搜尋找得到直播裡講到的字（標題沒有）`, grid.includes("NQ 開盤區間") && (await p.locator("#grid .chap-hit").count()) >= 1 && grid.includes("0:45"), grid.slice(0, 120));
    await p.fill("#search", "完全沒有的字詞");
    await p.waitForTimeout(800);
    check(`${name}：搜不到時說連直播內容都沒有`, (await p.textContent("#grid")).includes("直播內容都沒有講到"));
    await p.fill("#search", "陷阱"); await p.waitForSelector("#grid .chap-hit");
    await p.click("#grid .chap-hit:has-text('0:45')");
    await p.waitForFunction(() => location.hash === "#/v/5?t=45");
    check(`${name}：點搜尋結果跳到那個時間`, true);
    await p.waitForSelector("#wHl:not([hidden]) .ai-hl-jump");
    check(`${name}：AI 重點有時間的可以點`, (await p.locator("#wHl .ai-hl-jump").count()) === 2 && (await p.textContent("#wHl .ai-hl-jump >> nth=1")).includes("0:45"));
    await p.evaluate(() => { const v = document.querySelector("#video"); v.muted = true; });
    await p.waitForFunction(() => document.querySelector("#video").readyState >= 1, null, { timeout: 15000 });
    await p.click("#wHl .ai-hl-jump >> nth=0"); await p.waitForTimeout(500);
    const t = await p.evaluate(() => document.querySelector("#video").currentTime);
    check(`${name}：點重點跳到那一段`, t >= 11.5 && t < 16, String(t));
    if (name === "手機") check("手機沒有橫向捲動", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.locator("#wHl").screenshot({ path: `output/shots/v33-points-${name === "電腦" ? "desktop" : "mobile"}.png` });
    await c.close();
  }

  // ── 後台：補發給之前的人 ──
  {
    const [c, p] = await ctx({ width: 1280, height: 900 });
    await login(p, "boss@gmail.com");
    await p.goto(BASE + "/admin#chat"); await p.waitForSelector("#obNudge [data-nudge]");
    check("補發名單：通過沒註冊、沒看過影片", (await p.textContent("#obNudge")).includes("還沒註冊的阿明") && (await p.textContent("#obNudge")).includes("never@example.com"));
    await p.click("#obNudge [data-nudge=unregistered]"); await p.click(".modal .btn:has-text('發送')");
    await p.waitForSelector("#obNudge [data-nudge=unregistered]:disabled");
    check("私訊後：顯示已發、按鈕變「都補發過了」", (await p.textContent(".toast:last-child")).includes("已發給 1 人") && (await p.textContent("#obNudge [data-nudge=unregistered]")).includes("都補發過了") && (await p.textContent("#obNudge")).includes("補發過"));
    await p.locator("#onboardCard").screenshot({ path: "output/shots/v33-nudge.png" });
    await c.close();
  }
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
