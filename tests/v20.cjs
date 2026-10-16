// 執行方式：npm test（會自動開模擬伺服器）。單獨跑：node tests/mock-server.mjs &; node tests/v18.cjs
// v1.10：後台「Discord 審核」頁：最近的申請、機器人設定、張貼申請按鈕
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

  const [c, a] = await ctx({ width: 1440, height: 900 });
  await login(a, "boss@gmail.com"); await a.waitForSelector("#appView:not([hidden])");
  await a.goto(BASE + "/admin#discord"); await a.waitForSelector("#dcAppsBox table"); await closeModals(a);
  check("側欄先不顯示 Discord 審核（改回人工）", !(await a.isVisible(".nav a[data-view='discord']")));
  const apps = await a.textContent("#dcAppsBox");
  check("列出最近的申請", apps.includes("小明") && apps.includes("123456789012345678") && apps.includes("BingX 自動確認"), apps);
  check("三種狀態都有", ["等待審核", "已通過", "不通過"].every((t) => apps.includes(t)));
  check("機器人已連上", (await a.textContent("#dcSettingsBox")).includes("機器人已連上"));
  check("身分組預設是你的身分組", (await a.inputValue("#dcRole")) === "1560542923173400596");
  check("顯示 Interactions Endpoint URL", (await a.textContent(".dc-endpoint")).includes("/api/discord/interactions"));

  check("有把機器人加進伺服器的按鈕", (await a.getAttribute("#dcInvite", "href")).includes("scope=bot"));
  check("實驗室密碼預設帶入可用的一組", (await a.inputValue("#dcCode")) === "K7QM-2XPA");
  await a.fill("#dcCode", "NOPE-0000"); await a.click("#dcSetup"); await a.waitForTimeout(400);
  check("實驗室密碼不存在會擋", (await a.textContent(".toast:last-child")).includes("找不到這組實驗室密碼"));
  await a.fill("#dcCode", "K7QM-2XPA"); await a.click("#dcSetup"); await a.waitForSelector(".toast:has-text('建立 4 個頻道')");
  check("一鍵建立頻道", true);
  check("提醒把機器人身分組拖到上面", (await a.textContent("#dcSetupResult")).includes("拖到「實驗室研究員」上面"), await a.textContent("#dcSetupResult"));
  await a.screenshot({ path: "output/shots/v20-setup.png" });
  await a.click("#dcSettingsBox details summary");
  check("建立後頻道 ID 自動填好", (await a.inputValue("#dcPanel")) === "800000000000000002");
  await a.fill("#dcPanel", "abc"); await a.click("#dcSettingsBox details .btn.primary"); await a.waitForTimeout(400);
  check("ID 格式不對會擋", (await a.textContent(".toast:last-child")).includes("17–20 位數字"));
  await a.fill("#dcPanel", "444444444444444444"); await a.fill("#dcReview", "333333333333333333");
  await a.fill("#dcSettingsBox input[data-ex='OKX']", "https://okx.com/join/CCC");
  await a.click("#dcSettingsBox details .btn.primary"); await a.waitForSelector(".toast:has-text('已儲存 Discord 設定')");
  const saved = await a.evaluate(() => App.api("/api/admin/discord").then((r) => r.settings));
  check("設定存起來", saved.panelChannelId === "444444444444444444" && saved.reviewChannelId === "333333333333333333" && saved.invites.OKX === "https://okx.com/join/CCC", JSON.stringify(saved));
  await a.click("#dcSettingsBox details summary");
  await a.click("#dcSettingsBox .btn:has-text('重新張貼申請按鈕')"); await a.waitForSelector(".toast:has-text('已經在申請頻道張貼')");
  check("張貼申請按鈕", true);
  await a.screenshot({ path: "output/shots/v20-admin.png" });

  // ── 實驗室密碼：刪除 ──
  await a.goto(BASE + "/admin#invites"); await a.waitForSelector("#inviteTableBox table"); await closeModals(a);
  await a.click("tr:has-text('K7QM-2XPA') button:has-text('刪除')"); await a.waitForSelector(".modal:has-text('刪除實驗室密碼')");
  check("刪除前會確認，說明已加入的人不受影響", (await a.textContent(".modal")).includes("不受影響"));
  await a.click(".modal-foot .btn.danger-solid"); await a.waitForTimeout(400);
  check("放在 Discord 實驗室頻道的那組不能刪", (await a.textContent(".toast:last-child")).includes("Discord"), await a.textContent(".toast:last-child"));
  check("沒刪掉", (await a.textContent("#inviteTableBox")).includes("K7QM-2XPA"));
  await a.click("tr:has-text('HW3N-8RTE') button:has-text('刪除')"); await a.waitForSelector(".modal:has-text('刪除實驗室密碼')");
  await a.click(".modal-foot .btn.danger-solid"); await a.waitForSelector(".toast:has-text('已刪除 HW3N-8RTE')");
  check("刪除後從列表消失", !(await a.textContent("#inviteTableBox")).includes("HW3N-8RTE"));
  const left = await a.evaluate(() => App.api("/api/admin/invites").then((r) => r.invites.map((x) => x.code)));
  check("伺服器也刪掉了", !left.includes("HW3N-8RTE") && left.includes("K7QM-2XPA"), left.join(","));
  await a.screenshot({ path: "output/shots/v20-invites.png" });
  await c.close();

  const [c2, m] = await ctx({ width: 390, height: 844 });
  await login(m, "boss@gmail.com"); await m.waitForSelector("#appView:not([hidden])");
  await m.goto(BASE + "/admin#discord"); await m.waitForSelector("#dcAppsBox table"); await closeModals(m);
  const ov = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("手機沒有橫向捲動", ov <= 0, `overflow=${ov}`);
  await m.screenshot({ path: "output/shots/v20-mobile.png", fullPage: true });
  await c2.close();

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
