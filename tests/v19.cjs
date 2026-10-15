// 執行方式：npm test（會自動開模擬伺服器）。單獨跑：node tests/mock-server.mjs &; node tests/v18.cjs
// v1.9：Bybit 綁定 UID、自動同步交易量（隔天更新、達標日記昨天）、後台兩間的同步狀態
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

  // ── 研究員：綁定 Bybit ──
  let [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "amy@example.com"); await p.waitForSelector(".vrow"); await p.waitForTimeout(500); await closeModals(p);
  const panel = () => p.textContent("#volPanel");
  await p.click("#volPanel .bx-row .btn:has-text('綁定 Bybit')"); await p.waitForSelector(".modal:has-text('綁定 Bybit')");
  check("綁定視窗提醒填主帳號 UID", (await p.textContent(".modal")).includes("主帳號"));
  await p.fill(".modal input", "88880001"); await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(400);
  check("BingX 的 UID 不能拿來綁 Bybit", (await p.textContent(".modal .form-error")).includes("Bybit 邀請碼"), await p.textContent(".modal .form-error"));
  await p.fill(".modal input", "77770001"); await p.click(".modal-foot .btn.primary");
  await p.waitForSelector(".toast:has-text('已綁定')");
  check("提醒 Bybit 隔天才更新", (await p.textContent(".toast:has-text('已綁定')")).includes("隔天"));
  await p.waitForSelector("#volPanel .bx-text:has-text('77770001')");
  check("Bybit 交易量 150 萬、達標", (await panel()).includes("150 萬") && (await panel()).includes("已達標"), await panel());
  check("BingX 還是可以另外綁", await p.isVisible("#volPanel .bx-row .btn:has-text('綁定 BingX')"));
  await p.screenshot({ path: "output/shots/v19-bound.png" });

  // 另一位研究員不能綁同一個 UID
  const [cb, pb] = await ctx({ width: 1280, height: 800 });
  await pb.goto(BASE + "/"); await pb.evaluate(() => fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "bob@example.com", password: "password1", inviteCode: "K7QM-2XPA" }) }));
  await login(pb, "bob@example.com"); await pb.waitForSelector(".vrow, #volPanel"); await pb.waitForTimeout(400); await closeModals(pb);
  if (await pb.isVisible("#volPanel .bx-row .btn:has-text('綁定 Bybit')")) {
    await pb.click("#volPanel .bx-row .btn:has-text('綁定 Bybit')"); await pb.waitForSelector(".modal input");
    await pb.fill(".modal input", "77770001"); await pb.click(".modal-foot .btn.primary"); await pb.waitForTimeout(400);
    check("同一個 UID 不能綁兩位", (await pb.textContent(".modal .form-error")).includes("已經被其他研究員綁定"));
  } else check("同一個 UID 不能綁兩位（找不到 bob 的綁定按鈕）", false);
  await cb.close();

  // ── 後台：兩間各一列、Bybit 欄唯讀、立即同步兩間 ──
  const [c2, a] = await ctx({ width: 1440, height: 900 });
  await login(a, "boss@gmail.com"); await a.waitForSelector("#appView:not([hidden])");
  await a.goto(BASE + "/admin#volumes"); await a.waitForSelector(".vol-table"); await closeModals(a);
  check("同步列有 Bybit 和 BingX", (await a.locator(".bx-line").count()) === 2);
  check("Bybit 已綁定 1 位", (await a.textContent(".bx-line:has-text('Bybit')")).includes("已綁定 1 位"));
  const amyRow = "#volBox tr:has-text('amy@example.com')";
  check("Bybit 欄唯讀、顯示 UID", (await a.getAttribute(`${amyRow} input[aria-label$='Bybit 交易量']`, "readonly")) !== null && (await a.textContent(amyRow)).includes("UID 77770001"));
  check("只有 OKX 可以手填", (await a.locator(`${amyRow} input.vol-input:not([readonly])`).count()) === 1);
  check("表頭寫 Bybit（自動）", (await a.textContent(".vol-table thead")).includes("Bybit（自動）"));
  await a.click(".bx-bar .btn:has-text('立即同步')"); await a.waitForSelector(".toast:has-text('已同步')");
  check("立即同步兩間", (await a.textContent(".toast:has-text('已同步')")).includes("Bybit、BingX"));
  check("同步後顯示上次同步", (await a.textContent(".bx-line:has-text('Bybit')")).includes("上次同步"));
  await a.screenshot({ path: "output/shots/v19-admin.png" });
  await c2.close();

  // ── 解除 Bybit ──
  await p.click("#volPanel .bx-row:has-text('Bybit') .btn:has-text('解除')"); await p.waitForSelector(".modal:has-text('解除綁定 Bybit')");
  await p.click(".modal-foot .btn.danger-solid"); await p.waitForSelector(".toast:has-text('已解除')");
  await p.waitForSelector("#volPanel .bx-row .btn:has-text('綁定 Bybit')");
  check("解除後回到「綁定 Bybit」", true);
  await c.close();

  // ── 手機：兩列綁定 ──
  const [c3, m] = await ctx({ width: 390, height: 844 });
  await login(m, "amy@example.com"); await m.waitForSelector(".vrow"); await m.waitForTimeout(400); await closeModals(m);
  const ov = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("手機沒有橫向捲動", ov <= 0, `overflow=${ov}`);
  await m.locator("#volPanel").screenshot({ path: "output/shots/v19-mobile-panel.png" });
  await c3.close();

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
