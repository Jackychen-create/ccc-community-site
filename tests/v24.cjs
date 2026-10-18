// 執行方式：npm test（會自動開模擬伺服器）
// v1.18：進度里程碑：這一輪交易量跨過 25／50／75／100% → 首頁跳一次恭喜、右欄四格亮起來
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
const j = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
// 把跳出來的視窗（里程碑、徽章）一個一個關掉，回傳看到的文字
const closeAll = async (p) => { const seen = []; for (let i = 0; i < 6; i++) { await p.waitForTimeout(1300); if (!(await p.locator(".modal-back").count())) break; seen.push(await p.textContent(".modal-back")); await p.keyboard.press("Escape"); } return seen.join(" ‖ "); };
(async () => {
  // 新研究員（OKX）＋管理員登入
  const reg = await j("/api/register", { method: "POST", body: { email: "ms@example.com", password: "password1", inviteCode: "K7QM-2XPA", exchange: "OKX", uid: "55550001" } });
  check("註冊新研究員", reg.status === 200, JSON.stringify(reg.body));
  const tok = (await j("/sb/auth/v1/token", { method: "POST", body: { email: "boss@gmail.com", password: "password1" } })).body.access_token;
  const id = (await j("/api/admin/members", { token: tok })).body.members.find((m) => m.email === "ms@example.com").user_id;
  const setOkx = (n) => j("/api/admin/volumes", { method: "POST", token: tok, body: { which: "current", rows: [{ userId: id, amounts: { OKX: n } }] } });

  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
  const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
  await p.fill("#email", "ms@example.com"); await p.fill("#password", "password1"); await p.click("#authSubmit");
  await p.waitForSelector("#volPanel:not([hidden])"); await p.waitForTimeout(1200);
  check("還沒有交易量：不跳恭喜", !(await p.locator(".modal-back").count()));
  check("右欄有四格里程碑，都沒亮", (await p.locator(".ms-step").count()) === 4 && (await p.locator(".ms-step.on").count()) === 0);

  // 60 萬 → 50%
  await setOkx(600000);
  await p.reload(); await p.waitForSelector(".modal-back"); 
  const t50 = await p.textContent(".modal-back");
  check("跨過 50%：跳恭喜", t50.includes("跨過 50%") && t50.includes("還差 40 萬"), t50.slice(0, 120));
  check("亮到第二格（50%）", (await p.locator(".ms-step.on").count()) === 2 && (await p.locator(".ms-step.now .ms-label").textContent()) === "50%");
  await p.screenshot({ path: "output/shots/v24-50.png" });
  await p.click(".modal-back button:has-text('繼續衝')"); await p.waitForTimeout(300);
  await closeAll(p);
  await p.reload(); await p.waitForSelector("#volPanel:not([hidden])");
  check("看過就不再跳", !/跨過|達標了/.test(await closeAll(p)));

  // 120 萬 → 達標
  await setOkx(1200000);
  await p.reload(); await p.waitForSelector(".modal-back");
  const t100 = await p.textContent(".modal-back");
  check("達標：跳恭喜、寫資格延長到哪天", t100.includes("達標了") && t100.includes("觀看資格延長到"), t100.slice(0, 120));
  check("四格都亮", (await p.locator(".ms-step.on").count()) === 4);
  await p.screenshot({ path: "output/shots/v24-100.png" });
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  await closeAll(p);
  await p.reload(); await p.waitForSelector("#volPanel:not([hidden])");
  check("按 Esc 關掉也算看過", !/跨過|達標了/.test(await closeAll(p)));
  await c.close();

  // 手機
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 } });
  await c2.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  await c2.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
  const m = await c2.newPage(); m.on("pageerror", (e) => errs.push(e.message));
  await m.goto(BASE + "/"); await m.waitForSelector("#authView:not([hidden])");
  await m.fill("#email", "ms@example.com"); await m.fill("#password", "password1"); await m.click("#authSubmit");
  await m.waitForSelector("#volPanel:not([hidden])"); await m.waitForTimeout(800);
  const ov = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("手機沒有橫向捲動", ov <= 0, `overflow=${ov}`);
  await m.locator("#volPanel").screenshot({ path: "output/shots/v24-mobile-panel.png" });
  await c2.close();

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
