// 執行方式：npm test（會自動開模擬伺服器）。單獨跑：node tests/mock-server.mjs &; node tests/v18.cjs
// v1.8：BingX 綁定 UID、自動同步交易量、後台同步狀態
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
(async () => {
  const b = await chromium.launch();
  async function ctx(vp) {
    const c = await b.newContext({ viewport: vp });
    await c.addInitScript(() => { try { localStorage.setItem("tutorialOffered", "true"); localStorage.setItem("seenVersion", JSON.stringify("9.9.9")); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    return [c, p];
  }
  async function login(p, email) {
    await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
    await p.fill("#email", email); await p.fill("#password", "password1"); await p.click("#authSubmit");
  }
  const closeModals = async (p) => { while (await p.locator(".modal-back").count()) { await p.keyboard.press("Escape"); await p.waitForTimeout(150); } };

  // ── 研究員：綁定 BingX ──
  let [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "amy@example.com"); await p.waitForSelector(".vrow"); await p.waitForTimeout(500); await closeModals(p);
  const panel = () => p.textContent("#volPanel");
  check("交易量說明列出 BingX", (await panel()).includes("BingX"), await panel());
  check("還沒綁定時有「綁定 BingX」", await p.isVisible("#volPanel .bx-row .btn:has-text('綁定 BingX')"));
  const before = await p.evaluate(() => App.api("/api/me").then((m) => m.accessUntil));

  await p.click("#volPanel .bx-row .btn"); await p.waitForSelector(".modal:has-text('綁定 BingX')");
  await p.fill(".modal input", "abc"); await p.click(".modal-foot .btn.primary");
  check("UID 不是數字會提醒", (await p.textContent(".modal .form-error")).includes("一串數字"));
  await p.fill(".modal input", "12345678"); await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(400);
  check("不是我們邀請的 UID 會被擋下", (await p.textContent(".modal .form-error")).includes("不是用 CCC"), await p.textContent(".modal .form-error"));
  await p.fill(".modal input", "8888 0001"); await p.click(".modal-foot .btn.primary");
  await p.waitForSelector(".toast:has-text('已綁定')");
  await p.waitForSelector("#volPanel .bx-text:has-text('88880001')");
  check("綁定後顯示 UID", (await panel()).includes("88880001"));
  check("BingX 交易量馬上更新、達標", (await panel()).includes("已達標") && (await panel()).includes("350 萬"), await panel());
  const after = await p.evaluate(() => App.api("/api/me").then((m) => m.accessUntil));
  check("新達標資格自動延長", after > before, `${before} → ${after}`);
  await p.screenshot({ path: "output/shots/v18-bound.png" });

  // ── 後台：BingX 欄是自動的、可以立即同步、手動儲存不會蓋掉 BingX ──
  const [c2, a] = await ctx({ width: 1440, height: 900 });
  await login(a, "boss@gmail.com"); await a.waitForSelector("#appView:not([hidden])");
  await a.goto(BASE + "/admin#volumes"); await a.waitForSelector(".vol-table"); await closeModals(a);
  check("後台顯示 BingX 同步列", (await a.textContent(".bx-bar")).includes("已綁定 1 位"), await a.textContent(".bx-bar"));
  check("BingX 欄是自動的（唯讀）", await a.locator(".vol-table input.auto[readonly]").count() > 0);
  check("BingX 欄顯示研究員的 UID", (await a.textContent(".vol-table")).includes("UID 88880001"));
  const amyRow = "#volBox tr:has-text('amy@example.com')";
  check("BingX 數字出現在表格", (await a.inputValue(`${amyRow} input.auto`)).includes("3,500,000"));
  await a.click(".bx-bar .btn"); await a.waitForSelector(".toast:has-text('同步')");
  check("立即同步會更新狀態", (await a.textContent(".bx-bar")).includes("上次同步"), await a.textContent(".bx-bar"));
  await a.fill(`${amyRow} input[aria-label$='OKX 交易量']`, "120萬"); await a.click(".vol-foot .btn.primary"); await a.waitForSelector(".toast:has-text('已儲存')");
  const snap = await a.evaluate(() => App.api("/api/admin/volumes").then((r) => r.rows.find((x) => x.email === "amy@example.com").amounts));
  check("手動存 OKX 不會蓋掉 BingX", snap.OKX === 1200000 && snap.BingX === 3500000, JSON.stringify(snap));
  await a.click("#volPaste"); await a.waitForSelector(".modal textarea");
  check("貼上一整批只要填三間（BingX 自動）", (await a.textContent(".modal")).includes("OKX、Bybit。") && !(await a.textContent(".modal .sub")).includes("BingX"));
  await closeModals(a);
  await c2.close();

  // ── 研究員：解除綁定 ──
  await p.click("#volPanel .bx-row .btn:has-text('解除')"); await p.waitForSelector(".modal:has-text('解除綁定')");
  await p.click(".modal-foot .btn.danger-solid"); await p.waitForSelector(".toast:has-text('已解除')");
  await p.waitForSelector("#volPanel .bx-row .btn:has-text('綁定 BingX')");
  check("解除後回到「綁定 BingX」", true);
  check("已經記下的數字保留", (await panel()).includes("350 萬"));
  await c.close();

  // ── 手機 ──
  const [c3, m] = await ctx({ width: 390, height: 844 });
  await login(m, "amy@example.com"); await m.waitForSelector(".vrow"); await m.waitForTimeout(400); await closeModals(m);
  const ov = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("手機沒有橫向捲動", ov <= 0, `overflow=${ov}`);
  await m.locator("#volPanel").screenshot({ path: "output/shots/v18-mobile-panel.png" });
  await c3.close();

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
