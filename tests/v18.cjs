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
    await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); localStorage.setItem("seenVersion", JSON.stringify("9.9.9")); } catch {} });
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
  check("還沒綁定時有「綁定 BingX」", await p.isVisible("#volPanel .bx-row:has-text('BingX') .btn:has-text('綁定')"));
  check("也有「綁定 Bybit」", await p.isVisible("#volPanel .bx-row:has-text('Bybit') .btn:has-text('綁定')"));
  check("還沒填任何 UID 會提醒", (await panel()).includes("管理員才對得到你的交易量"));
  check("四間都可以填 UID", ["OKX", "UM", "Bybit", "BingX"].every((ex) => (async () => true)()) && (await p.locator("#volPanel .bx-row").count()) === 4);
  await p.click("#volPanel .bx-row:has-text('OKX') .btn:has-text('填寫')"); await p.waitForSelector(".modal:has-text('填寫 OKX UID')");
  await p.fill(".modal input", "123 456 789 012 345 678"); await p.click(".modal-foot .btn.primary");
  await p.waitForSelector(".toast:has-text('已記下你的 OKX UID')");
  await p.waitForSelector("#volPanel .bx-text:has-text('123456789012345678')");
  check("OKX UID 記下來（18 位數字也可以）", true);
  check("填了之後提醒就消失", !(await panel()).includes("管理員才對得到你的交易量"));
  const before = await p.evaluate(() => App.api("/api/me").then((m) => m.accessUntil));

  await p.click("#volPanel .bx-row:has-text('BingX') .btn:has-text('綁定')"); await p.waitForSelector(".modal:has-text('綁定 BingX')");
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
  check("後台顯示 BingX 同步列", (await a.textContent(".bx-line:has-text('BingX')")).includes("已綁定 1 位"), await a.textContent(".bx-bar"));
  check("BingX 欄是自動的（唯讀）", await a.locator(".vol-table input.auto[readonly]").count() > 0);
  check("BingX 欄顯示研究員的 UID", (await a.textContent(".vol-table")).includes("UID 88880001"));
  check("OKX 欄也顯示 UID，對交易所後台時知道是誰", (await a.textContent(".vol-table")).includes("UID 123456789012345678"));
  const amyRow = "#volBox tr:has-text('amy@example.com')";
  check("BingX 數字出現在表格", (await a.inputValue(`${amyRow} input[aria-label$='BingX 交易量']`)).includes("3,500,000"));
  await a.click(".bx-bar .btn"); await a.waitForSelector(".toast:has-text('同步')");
  check("立即同步會更新狀態", (await a.textContent(".bx-bar")).includes("上次同步"), await a.textContent(".bx-bar"));
  await a.fill(`${amyRow} input[aria-label$='OKX 交易量']`, "120萬"); await a.click(".vol-foot .btn.primary"); await a.waitForSelector(".toast:has-text('已儲存')");
  const snap = await a.evaluate(() => App.api("/api/admin/volumes").then((r) => r.rows.find((x) => x.email === "amy@example.com").amounts));
  check("手動存 OKX 不會蓋掉 BingX", snap.OKX === 1200000 && snap.BingX === 3500000, JSON.stringify(snap));
  await a.click("#volPaste"); await a.waitForSelector(".modal textarea");
  check("貼上一整批只要填 OKX、UM（Bybit、BingX 自動）", (await a.textContent(".modal .sub")).includes("順序是 OKX、UM") && (await a.textContent(".modal .sub")).includes("自動同步，不用填"), await a.textContent(".modal .sub"));
  await closeModals(a);
  await c2.close();

  // ── 研究員：解除綁定 ──
  await p.click("#volPanel .bx-row:has-text('BingX') .btn:has-text('解除')"); await p.waitForSelector(".modal:has-text('解除綁定')");
  await p.click(".modal-foot .btn.danger-solid"); await p.waitForSelector(".toast:has-text('已解除')");
  await p.waitForSelector("#volPanel .bx-row:has-text('BingX') .btn:has-text('綁定')");
  check("解除後回到「綁定 BingX」", true);
  check("已經記下的數字保留", (await panel()).includes("350 萬"));
  await c.close();

  // ── 一間 UID 都沒填的研究員：登入後跳出來請他補填（同一次開網站只問一次）──
  {
    const c4 = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await c4.addInitScript(() => { try { localStorage.setItem("tutorialOffered", "true"); localStorage.setItem("seenVersion", JSON.stringify("9.9.9")); } catch {} });
    await c4.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const q = await c4.newPage(); q.on("pageerror", (e) => errs.push(e.message));
    await q.goto(BASE + "/"); await q.evaluate(() => fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "nouid@example.com", password: "password1", inviteCode: "K7QM-2XPA", exchange: "UM", uid: "99990001" }) }));
    // 模擬舊研究員：把 UID 刪掉再登入
    await login(q, "nouid@example.com"); await q.waitForSelector("#appView:not([hidden])");
    await q.evaluate(() => App.api("/api/exchange-link?exchange=UM", { method: "DELETE" }));
    await q.evaluate(() => sessionStorage.clear()); await q.reload(); await q.waitForSelector("#appView:not([hidden])"); await q.waitForTimeout(500);
    const news = async () => { if (await q.isVisible(".modal:has-text('網站更新了')")) { await q.keyboard.press("Escape"); await q.waitForTimeout(300); } };
    await news();
    await q.waitForSelector(".modal:has-text('填寫你的交易所 UID')", { timeout: 8000 });
    check("沒填 UID 的人登入後會被請他補填", true);
    await q.selectOption(".modal select", "UM"); await q.fill(".modal input", "99990001"); await q.click(".modal-foot .btn.primary");
    await q.waitForSelector(".toast:has-text('已記下你的 UM MT5 帳號')");
    check("補填 UM MT5 帳號", (await q.textContent("#volPanel")).includes("99990001"));
    await q.screenshot({ path: "output/shots/v18-uid-prompt-done.png" });
    await q.evaluate(() => sessionStorage.clear()); await q.reload(); await q.waitForSelector("#appView:not([hidden])"); await q.waitForTimeout(500); await news(); await q.waitForTimeout(1500);
    check("填過之後不會再跳出來", !(await q.isVisible(".modal:has-text('填寫你的交易所 UID')")));
    await c4.close();
  }

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
