// 執行方式：npm test（會自動開模擬伺服器）
// v1.21：公開影片（不用登入）：後台類型選「公開影片」→ 分享連結 /watch?v=id、登入頁「還沒加入？先看…」；研究員列表不會出現
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
  const b = await chromium.launch();
  const ctx = async (vp) => {
    const c = await b.newContext({ viewport: vp }); await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    await c.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message)); return [c, p];
  };
  // 還沒有公開影片：登入頁不顯示、/watch 寫沒有
  check("還沒有公開影片：API 回空清單", (await j("/api/public-video")).body.videos.length === 0);
  check("不是公開的影片：不用登入拿不到", (await j("/api/public-video?id=2")).status === 404);

  // 管理員：把影片 2 改成公開影片
  let [c, p] = await ctx({ width: 1280, height: 900 });
  await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
  await p.fill("#email", "boss@gmail.com"); await p.fill("#password", "password1"); await p.click("#authSubmit");
  await p.waitForSelector("#appView:not([hidden])");
  await p.goto(BASE + "/admin"); await p.waitForSelector("#videoTableBox tbody tr, .vtable tbody tr, table tbody tr");
  await p.click("tr:has-text('資金控管') .btn:has-text('編輯')"); await p.waitForSelector(".modal");
  await p.click(".modal .chip:has-text('公開影片')");
  check("類型切到公開影片", (await p.getAttribute(".modal .chip:has-text('公開影片')", "aria-pressed")) === "true" && (await p.getAttribute(".modal .chip:has-text('直播紀錄')", "aria-pressed")) === "false");
  check("選公開影片：出現分享連結", (await p.inputValue(".modal .share-row input")).endsWith("/watch?v=2"));
  check("發布開關寫拿到連結的人都看得到", (await p.textContent(".modal .switch")).includes("拿到連結"));
  check("公開影片不能寄通知", await p.isDisabled(".modal .notify-row .btn"));
  await p.screenshot({ path: "output/shots/v28-editor.png" });
  await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(500);
  check("儲存後告訴分享連結", (await p.textContent(".toast:last-child")).includes("/watch?v=2"));
  check("列表標「公開」、有複製連結按鈕", (await p.textContent("tr:has-text('資金控管')")).includes("公開") && (await p.locator("tr:has-text('資金控管') [aria-label*='分享連結']").count()) === 1);
  // 研究員畫面：直播紀錄列表沒有它
  const tok = (await j("/sb/auth/v1/token", { method: "POST", body: { email: "boss@gmail.com", password: "password1" } })).body.access_token;
  const list = await j("/api/videos", { token: tok });
  check("公開影片不在直播紀錄列表", !list.body.videos.some((v) => v.id === 2));
  await c.close();

  // 沒登入：分享連結直接看
  for (const [name, vp] of [["電腦", { width: 1280, height: 900 }], ["手機", { width: 390, height: 844 }]]) {
    [c, p] = await ctx(vp);
    await p.goto(BASE + "/watch?v=2"); await p.waitForSelector(".pub-title");
    check(`沒登入也能看（${name}）`, (await p.textContent(".pub-title")).includes("資金控管") && !!(await p.getAttribute("video.pub-video", "src")));
    check(`畫面上沒有多出 null（${name}）`, !(await p.textContent(".pub-box")).includes("null"));
    check(`有加入說明和註冊按鈕（${name}）`, (await p.textContent(".pub-join")).includes("實驗室密碼"));
    if (name === "手機") check("手機沒有橫向捲動", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.screenshot({ path: `output/shots/v28-watch-${name === "電腦" ? "desktop" : "mobile"}.png`, fullPage: true });
    await c.close();
  }
  // 登入頁：還沒加入？先看…
  [c, p] = await ctx({ width: 1280, height: 900 });
  await p.goto(BASE + "/"); await p.waitForSelector("#authIntro:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("登入頁顯示「還沒加入？先看…」", (await p.isVisible("#authIntro")) && (await p.getAttribute("#authIntro", "href")) === "/watch?v=2" && (await p.textContent("#authIntro")).includes("資金控管"));
  await p.screenshot({ path: "output/shots/v28-login.png" });
  await p.goto(BASE + "/watch?v=999"); await p.waitForSelector(".empty");
  check("找不到的影片寫清楚", (await p.textContent(".empty")).includes("找不到"));
  await p.goto(BASE + "/watch"); await p.waitForSelector(".pub-title");
  check("/watch 只有一支就直接播", (await p.textContent(".pub-title")).includes("資金控管") && (await p.evaluate(() => location.search)) === "?v=2");
  await c.close();
  // 下架（改回直播紀錄）就看不到
  await j("/api/admin/videos", { method: "PATCH", token: tok, body: { id: 2, is_public: false } });
  check("改回直播紀錄：不用登入就看不到", (await j("/api/public-video?id=2")).status === 404);

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
