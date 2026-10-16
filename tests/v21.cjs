// 執行方式：npm test（會自動開模擬伺服器）
// v1.13：協作管理員（OC）只能管影片、回提問、看統計、看研究員名單
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

  // ── 協作管理員 ──
  let [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "oc@gmail.com"); await p.waitForSelector("#appView:not([hidden])");
  await p.goto(BASE + "/admin"); await p.waitForSelector("#shell:not([hidden])"); await closeModals(p);
  const nav = await p.$$eval(".nav a[data-view]", (as) => as.map((a) => a.dataset.view));
  check("側欄只有影片、研究員、觀看統計、提問回報", JSON.stringify(nav) === JSON.stringify(["videos", "members", "feedback", "stats"]), nav.join(","));
  check("左下角寫協作管理員", (await p.textContent("#whoami")).includes("協作管理員"));
  await p.goto(BASE + "/admin#volumes"); await p.waitForTimeout(600);
  check("直接打網址去交易量也進不去（回到影片）", await p.isVisible("#v-videos") && !(await p.isVisible("#v-volumes")));
  await p.goto(BASE + "/admin#members"); await p.waitForSelector("#memberTableBox table"); await closeModals(p);
  check("研究員名單看得到", (await p.textContent("#memberTableBox")).includes("amy@example.com"));
  check("不能改資格、重設密碼、停權", (await p.locator("#memberTableBox button:has-text('停權'), #memberTableBox button:has-text('重設密碼')").count()) === 0 && (await p.textContent("#memberTableBox")).includes("只能檢視"));
  const api = await p.evaluate(async () => {
    const r = {};
    for (const [k, path, opt] of [["volumes", "/api/admin/volumes"], ["invites", "/api/admin/invites"], ["ban", "/api/admin/members", { method: "PATCH", body: { userId: "00000000-0000-4000-8000-000000000002", action: "ban" } }], ["videos", "/api/admin/videos"], ["stats", "/api/admin/stats"], ["feedback", "/api/admin/feedback"]]) {
      try { await App.api(path, opt); r[k] = 200; } catch (e) { r[k] = e.status + ":" + (e.code || ""); }
    }
    return r;
  });
  check("伺服器也擋：交易量、實驗室密碼、停權", api.volumes === "403:owner_only" && api.invites === "403:owner_only" && api.ban === "403:owner_only", JSON.stringify(api));
  check("影片、統計、提問可以用", api.videos === 200 && api.stats === 200 && api.feedback === 200, JSON.stringify(api));
  await p.goto(BASE + "/admin#videos"); await p.waitForTimeout(800); await closeModals(p);
  check("影片頁可以用", await p.isVisible("#v-videos"));
  await p.screenshot({ path: "output/shots/v21-editor.png" });
  await c.close();

  // ── 主要管理員不受影響 ──
  [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "boss@gmail.com"); await p.waitForSelector("#appView:not([hidden])");
  await p.goto(BASE + "/admin#members"); await p.waitForSelector("#memberTableBox table"); await closeModals(p);
  check("主要管理員側欄完整", (await p.locator(".nav a[data-view]").count()) >= 8);
  check("主要管理員可以停權", (await p.locator("#memberTableBox button:has-text('停權')").count()) > 0);
  await c.close();

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
