// 執行方式：npm test（會自動開模擬伺服器）
// v1.20：一對一交流：第三級在右邊選講師（三選一），看排第幾；後台三位講師的名單、標記已約好；協作管理員也看得到
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
const j = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const closeAll = async (p) => { for (let i = 0; i < 6; i++) { await p.waitForTimeout(1200); if (!(await p.locator(".modal-back, .lvl-back").count())) break; if (await p.locator(".lvl-back").count()) await p.waitForSelector(".lvl-flaps[data-done]"); await p.keyboard.press("Escape"); } };
(async () => {
  const tok = (await j("/sb/auth/v1/token", { method: "POST", body: { email: "boss@gmail.com", password: "password1" } })).body.access_token;
  const mk = async (email, uid, okx) => {
    await j("/api/register", { method: "POST", body: { email, password: "password1", inviteCode: "K7QM-2XPA", exchange: "OKX", uid } });
    const id = (await j("/api/admin/members", { token: tok })).body.members.find((m) => m.email === email).user_id;
    await j("/api/admin/volumes", { method: "POST", token: tok, body: { which: "current", rows: [{ userId: id, amounts: { OKX: okx } }] } });
    return id;
  };
  await mk("t3@example.com", "66660001", 1600000);
  await mk("t2@example.com", "66660002", 300000);
  // 先讓 5 位交易量更高的人選 X，名額滿（OC 2026-11-09 停止合作，一對一只剩 CCC、X）
  for (let i = 0; i < 5; i++) {
    await mk(`big${i}@example.com`, `6666100${i}`, 3000000 + i);
    const t = (await j("/sb/auth/v1/token", { method: "POST", body: { email: `big${i}@example.com`, password: "password1" } })).body.access_token;
    await j("/api/oneonone", { method: "POST", token: t, body: { host: "X" } });
  }

  const b = await chromium.launch();
  const ctx = async (vp) => {
    const c = await b.newContext({ viewport: vp });
    await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    return [c, p];
  };
  const login = async (p, email) => { await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])"); await p.fill("#email", email); await p.fill("#password", "password1"); await p.click("#authSubmit"); await p.waitForSelector("#appView:not([hidden])"); };

  // 第二級看不到一對一
  let [c, p] = await ctx({ width: 1280, height: 900 });
  await login(p, "t2@example.com"); await p.waitForSelector("#grid .vrow"); await closeAll(p);
  check("第二級沒有一對一", !(await p.isVisible("#onePanel")));
  await c.close();

  // 第三級：選講師
  [c, p] = await ctx({ width: 1280, height: 900 });
  await login(p, "t3@example.com"); await p.waitForSelector("#onePanel:not([hidden])"); await closeAll(p);
  check("第三級看得到一對一，兩位講師", (await p.locator("#onePanel .one-host").count()) === 2 && (await p.textContent("#onePanel")).includes("選一位講師"));
  check("X 名額已滿寫 5／5", (await p.textContent("#onePanel .one-host:has-text('X')")).includes("5／5"));
  await p.click("#onePanel .one-host:has-text('X')"); await p.waitForSelector("#onePanel .pill:has-text('候補')");
  check("選滿的 X：候補第 1 位、說可以改選", (await p.textContent("#onePanel")).includes("候補第 1 位") && (await p.textContent("#onePanel")).includes("改選"), await p.textContent("#onePanel"));
  await p.click("#onePanel .one-host:has-text('CCC')"); await p.waitForSelector("#onePanel .pill:has-text('確定')");
  check("改選 CCC：排第 1 位確定", (await p.textContent("#onePanel")).includes("CCC，排第 1 位（確定）"));
  check("CCC 那格亮起來", (await p.getAttribute("#onePanel .one-host:has-text('CCC')", "aria-pressed")) === "true");
  await p.locator("#onePanel").screenshot({ path: "output/shots/v26-member.png" });
  await c.close();

  // 後台：三欄名單、標記已約好
  [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "boss@gmail.com");
  await p.goto(BASE + "/admin#oneonone"); await p.waitForSelector(".one-cols");
  check("後台兩位講師各一欄", (await p.locator(".one-col").count()) === 2);
  const oc = p.locator(".one-col").nth(1);
  check("X 5／5、交易量高的排前面", (await oc.textContent()).includes("5／5") && (await oc.locator("li").first().textContent()).includes("big4@example.com"));
  const ccc = p.locator(".one-col", { hasText: "CCC" }).first();
  check("CCC 有 t3、寫這一輪交易量", (await ccc.textContent()).includes("t3@example.com") && (await ccc.textContent()).includes("OKX 160 萬"));
  await ccc.locator("button:has-text('已約好')").click(); await p.waitForSelector(".toast:has-text('已約好')");
  check("標記已約好", (await p.locator(".one-col", { hasText: "CCC" }).first().textContent()).includes("已約好"));
  await p.screenshot({ path: "output/shots/v26-admin.png" });
  await c.close();

  // 研究員看到已約好、不能改選
  [c, p] = await ctx({ width: 390, height: 844 });
  await login(p, "t3@example.com"); await p.waitForSelector("#onePanel:not([hidden])"); await closeAll(p);
  check("研究員看到已約好", (await p.textContent("#onePanel")).includes("已經跟 CCC 約好了"));
  check("約好之後別位講師不能按", await p.locator("#onePanel .one-host:has-text('X')").isDisabled());
  check("手機沒有橫向捲動", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await c.close();

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
