// 執行方式：npm test（會自動開模擬伺服器）
// v1.19：徽章（右欄、拿到新徽章的恭喜）、外觀主題（免費三個、徽章解鎖三個；存在帳號和這台瀏覽器）
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
const j = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
(async () => {
  await j("/api/register", { method: "POST", body: { email: "bd@example.com", password: "password1", inviteCode: "K7QM-2XPA", exchange: "OKX", uid: "55550002" } });
  const tok = (await j("/sb/auth/v1/token", { method: "POST", body: { email: "boss@gmail.com", password: "password1" } })).body.access_token;
  const id = (await j("/api/admin/members", { token: tok })).body.members.find((m) => m.email === "bd@example.com").user_id;
  const setOkx = (n) => j("/api/admin/volumes", { method: "POST", token: tok, body: { which: "current", rows: [{ userId: id, amounts: { OKX: n } }] } });
  // 跳出來的視窗一個一個關掉，記下內容
  const drain = async (p) => { const seen = []; for (let i = 0; i < 6; i++) { await p.waitForTimeout(1300); if (!(await p.locator(".modal-back, .lvl-back").count())) break; if (await p.locator(".lvl-back").count()) await p.waitForSelector(".lvl-flaps[data-done]"); seen.push(await p.textContent(".modal-back, .lvl-back")); await p.keyboard.press("Escape"); } return seen.join(" ‖ "); };

  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
  const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
  await p.fill("#email", "bd@example.com"); await p.fill("#password", "password1"); await p.click("#authSubmit");
  await p.waitForSelector("#badgePanel:not([hidden])");
  await drain(p);
  check("右欄有 12 個徽章，一個都沒拿到", (await p.locator("#badgePanel .badge").count()) === 12 && (await p.locator("#badgePanel .badge.got").count()) === 0);
  check("沒拿到的徽章寫怎麼拿", ((await p.getAttribute("#badgePanel .badge >> nth=4", "title")) || "").includes("連續 3 輪"));

  // 交易量 12 萬（第一級）→ 第一筆、半山腰（到第二級的一半）
  await setOkx(120000);
  await p.reload(); await p.waitForSelector("#badgePanel:not([hidden])");
  const pops = await drain(p);
  check("跳新徽章：第一筆、半山腰", pops.includes("拿到 2 個新徽章") && pops.includes("第一筆") && pops.includes("半山腰"), pops.slice(0, 200));
  check("徽章亮起來 2 個", (await p.locator("#badgePanel .badge.got").count()) === 2);
  await p.locator("#badgePanel").screenshot({ path: "output/shots/v25-badges.png" });
  await p.reload(); await p.waitForSelector("#badgePanel:not([hidden])");
  check("看過就不再跳", !(await drain(p)).includes("新徽章"));

  // 主題：免費的可以換，要徽章的鎖著
  await p.click("#menuBtn"); await p.click("text=外觀主題"); await p.waitForSelector(".theme-grid");
  check("有 6 個主題", (await p.locator(".theme-opt").count()) === 6);
  check("金庫鎖著、寫要哪個徽章", await p.locator(".theme-opt:has-text('金庫')").isDisabled() && (await p.textContent(".theme-opt:has-text('金庫')")).includes("第二級"));
  await p.click(".theme-opt:has-text('晨報')"); await p.waitForTimeout(300);
  check("換成晨報（淺色）", (await p.getAttribute("html", "data-theme")) === "paper");
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("背景變成米白", bg === "rgb(244, 241, 234)", bg);
  await p.keyboard.press("Escape");
  await p.screenshot({ path: "output/shots/v25-paper.png" });
  const locked = await p.evaluate(async () => (await fetch("/api/me", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: "Bearer " + JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("auth-token")) || "x") || "{}").access_token }, body: JSON.stringify({ theme: "vault" }) })).status);
  check("伺服器擋下還沒解鎖的主題", locked === 400, String(locked));

  // 升到第二級 → 「第二級」徽章，解鎖金庫，按「換上」
  await setOkx(300000);
  await p.reload(); await p.waitForSelector("#badgePanel:not([hidden])");
  for (let i = 0; i < 6; i++) { await p.waitForTimeout(1300); if (await p.locator(".lvl-back").count()) await p.waitForSelector(".lvl-flaps[data-done]"); const t = (await p.locator(".modal-back, .lvl-back").count()) ? await p.textContent(".modal-back, .lvl-back") : ""; if (!t) break; if (t.includes("解鎖了外觀主題")) break; await p.keyboard.press("Escape"); }
  const pop = await p.textContent(".modal-back, .lvl-back");
  check("升到第二級：跳徽章、說解鎖金庫", pop.includes("第一次在一輪內升到第二級") && pop.includes("金庫"), pop.slice(0, 160));
  await p.click(".modal-back button:has-text('換上「金庫」')"); await p.waitForTimeout(400);
  check("按換上就換成金庫", (await p.getAttribute("html", "data-theme")) === "vault");
  await p.reload(); await p.waitForSelector("#appView:not([hidden])");
  check("重新整理還是金庫（畫面出來前就套上）", (await p.getAttribute("html", "data-theme")) === "vault");
  await drain(p);
  await p.screenshot({ path: "output/shots/v25-vault.png" });
  await c.close();

  // 換一台電腦（新的瀏覽器）：用帳號裡的主題
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 } });
  await c2.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  await c2.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
  const m = await c2.newPage(); m.on("pageerror", (e) => errs.push(e.message));
  await m.goto(BASE + "/"); await m.waitForSelector("#authView:not([hidden])");
  check("登入前是預設主題", !(await m.getAttribute("html", "data-theme")));
  await m.fill("#email", "bd@example.com"); await m.fill("#password", "password1"); await m.click("#authSubmit");
  await m.waitForSelector("#badgePanel:not([hidden])"); await m.waitForTimeout(500);
  check("換電腦登入後套上帳號裡的金庫", (await m.getAttribute("html", "data-theme")) === "vault");
  const ov = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("手機沒有橫向捲動", ov <= 0, `overflow=${ov}`);
  await drain(m);
  await m.click("#menuBtn"); await m.click("text=外觀主題"); await m.waitForSelector(".theme-grid");
  await m.screenshot({ path: "output/shots/v25-picker-mobile.png" });
  await c2.close();

  // 每個主題截一張，檢查顏色有換
  const c3 = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await c3.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
  const t = await c3.newPage(); t.on("pageerror", (e) => errs.push(e.message));
  const bgs = new Set();
  for (const th of ["board", "night", "paper", "vault", "aurora", "chalk"]) {
    await t.goto(BASE + "/"); await t.evaluate((x) => localStorage.setItem("theme", JSON.stringify(x)), th);
    await t.goto(BASE + "/"); await t.waitForSelector("#authView:not([hidden])"); await t.waitForTimeout(400);
    bgs.add(await t.evaluate(() => getComputedStyle(document.body).backgroundColor));
    await t.screenshot({ path: `output/shots/v25-login-${th}.png` });
  }
  check("6 個主題背景都不一樣", bgs.size === 6, [...bgs].join(" "));
  await c3.close();

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
