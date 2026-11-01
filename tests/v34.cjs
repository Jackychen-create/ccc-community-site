// 執行方式：npm test（會自動開模擬伺服器）
// v1.26.21：研究員自己連結 Discord（選單、一次性連結、用過不能再用、解除）
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
const j = async (path, body) => (await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })).json();

(async () => {
  const b = await chromium.launch();
  for (const [name, vp] of [["電腦", { width: 1280, height: 900 }], ["手機", { width: 390, height: 844 }]]) {
    const c = await b.newContext({ viewport: vp });
    await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
    await p.fill("#email", "amy@example.com"); await p.fill("#password", "password1"); await p.click("#authSubmit"); await p.waitForSelector("#appView:not([hidden])");
    for (let i = 0; i < 6; i++) { await p.waitForTimeout(1200); if (!(await p.locator(".modal-back, .lvl-back").count())) break; if (await p.locator(".lvl-back").count()) await p.waitForSelector(".lvl-flaps[data-done]"); await p.keyboard.press("Escape"); }
    await p.click("#menuBtn");
    check(`${name}：選單有「連結 Discord」`, (await p.textContent("#menuDiscord")).includes("連結 Discord"));
    await p.click("#menuDiscord"); await p.waitForSelector(".modal .link-steps");
    check(`${name}：說明三個步驟、帶去 Discord 的按鈕`, (await p.textContent(".modal")).includes("#實驗室公告") && (await p.getAttribute(".modal a.btn", "href")).startsWith("https://discord.com/channels/"));
    if (name === "手機") check("手機沒有橫向捲動", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.screenshot({ path: `output/shots/v34-link-${name === "電腦" ? "desktop" : "mobile"}.png` });
    await p.keyboard.press("Escape");
    // Discord 給的連結
    const { token } = await j("/api/__test/discord-token", { name: name === "電腦" ? "amy_dc" : "amy_phone", id: name === "電腦" ? "111111111111111198" : "111111111111111197" });
    await p.goto(`${BASE}/#/link-discord?t=${token}`);
    await p.waitForSelector(".toast");
    check(`${name}：打開連結就連好`, (await p.textContent(".toast:last-child")).includes("已連結 Discord") && (await p.evaluate(() => location.hash)) === "#/");
    await p.click("#menuBtn");
    check(`${name}：選單顯示已連結和名字`, (await p.textContent("#menuDiscord")).includes("Discord 已連結") && (await p.textContent("#menuDiscord")).includes(name === "電腦" ? "amy_dc" : "amy_phone"));
    await p.keyboard.press("Escape");
    await p.goto(`${BASE}/#/link-discord?t=${token}`);
    await p.waitForSelector(".modal:has-text('連結沒有成功')");
    check(`${name}：同一個連結不能再用`, (await p.textContent(".modal")).includes("過期或用過"));
    await p.keyboard.press("Escape");
    await p.click("#menuBtn"); await p.click("#menuDiscord"); await p.click(".modal .btn:has-text('解除')");
    await p.waitForTimeout(400); await p.click("#menuBtn");
    check(`${name}：解除後變回「連結 Discord」`, (await p.textContent("#menuDiscord")).includes("連結 Discord"));
    await c.close();
  }
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
