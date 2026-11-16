// 執行方式：npm test（會自動開模擬伺服器）
// v1.17：贈送名額：後台產生免綁交易所的實驗室密碼；用它註冊不用填交易所、不限期、不會跳出補填 UID
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
(async () => {
  const b = await chromium.launch();
  async function ctx(vp, { prompted = true } = {}) {
    const c = await b.newContext({ viewport: vp });
    await c.addInitScript((pr) => { try { if (pr) sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); localStorage.setItem("seenVersion", JSON.stringify("9.9.9")); } catch {} }, prompted);
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    return [c, p];
  }
  const closeModals = async (p) => { while (await p.locator(".modal-back").count()) { await p.keyboard.press("Escape"); await p.waitForTimeout(150); } };

  // 後台：產生贈送名額
  let [c, a] = await ctx({ width: 1440, height: 900 });
  await a.goto(BASE + "/"); await a.waitForSelector("#authView:not([hidden])");
  await a.fill("#email", "boss@gmail.com"); await a.fill("#password", "password1"); await a.click("#authSubmit");
  await a.waitForSelector("#appView:not([hidden])");
  await a.goto(BASE + "/admin#invites"); await a.waitForSelector("#inviteTableBox table"); await closeModals(a);
  check("列表標出贈送名額", (await a.textContent("#inviteTableBox")).includes("贈送名額"));
  await a.check("#invFree");
  check("勾贈送名額後次數變 1", (await a.inputValue("#invMax")) === "1");
  await a.fill("#invNote", "贈送：小華");
  await a.click("#invCreate"); await a.waitForSelector("#invResult .new-code");
  check("產生結果寫贈送名額", (await a.textContent("#invResult")).includes("贈送名額"));
  check("產生後取消勾選", !(await a.isChecked("#invFree")));
  await a.screenshot({ path: "output/shots/v23-admin.png" });
  // 實驗室密碼備註：直接在列表改
  const row = a.locator("#inviteTableBox tr", { hasText: "GF7T-2FRE" });
  await row.locator(".note-btn").click(); await a.waitForSelector(".modal-back textarea");
  check("備註視窗帶入原本的備註", (await a.inputValue(".modal-back textarea")) === "贈送：小明");
  await a.fill(".modal-back textarea", "送給小明（Threads 粉絲）"); await a.click(".modal-back button:has-text('儲存')");
  await a.waitForSelector(".toast:has-text('備註已儲存')");
  check("實驗室密碼備註更新", (await row.textContent()).includes("送給小明（Threads 粉絲）"));
  const k7 = a.locator("#inviteTableBox tr", { hasText: "K7QM-2XPA" });
  await k7.locator(".note-btn").click(); await a.fill(".modal-back textarea", ""); await a.click(".modal-back button:has-text('儲存')");
  await a.waitForSelector(".toast:has-text('備註已清除')");
  check("清掉備註後顯示「備註」按鈕", (await k7.locator(".note-btn").textContent()).includes("備註") && !(await k7.textContent()).includes("第一批研究員"));
  await c.close();

  // 一般實驗室密碼：還是要填交易所
  [c, a] = await ctx({ width: 1280, height: 860 }, { prompted: false });
  await a.goto(BASE + "/?invite=K7QM-2XPA"); await a.waitForSelector("#authView:not([hidden])"); await a.waitForTimeout(300);
  check("一般密碼要填交易所", await a.isVisible("#uidRow") && !(await a.isVisible("#freeNote")));

  // 贈送名額：交易所欄位收起來
  await a.goto(BASE + "/?invite=GF7T-2FRE"); await a.waitForSelector("#freeNote:not([hidden])");
  check("贈送名額不用填交易所", !(await a.isVisible("#uidRow")));
  check("說明不限期", (await a.textContent("#freeNote")).includes("不限期"));
  await a.screenshot({ path: "output/shots/v23-register.png" });
  // 手動改成一般密碼，交易所欄位又出現
  await a.fill("#invite", "K7QM-2XPA"); await a.dispatchEvent("#invite", "change"); await a.waitForSelector("#uidRow:not([hidden])");
  check("改成一般密碼後要填交易所", await a.isVisible("#uidRow"));
  await a.fill("#invite", "GF7T-2FRE"); await a.waitForSelector("#freeNote:not([hidden])");
  await a.fill("#email", "gift@example.com"); await a.fill("#password", "password1");
  await a.click("#authSubmit"); await a.waitForSelector("#appView:not([hidden])");
  check("贈送名額註冊成功", true);
  await a.waitForTimeout(1500);
  const modalText = (await a.locator(".modal-back").count()) ? await a.textContent(".modal-back") : "";
  check("不會跳出補填交易所 UID", !/填寫你的交易所 UID/.test(modalText), modalText.slice(0, 80));
  await closeModals(a);
  await a.waitForSelector("#volPanel:not([hidden])");
  const vp = await a.textContent("#volPanel");
  check("右欄寫贈送名額、不限期", vp.includes("贈送名額") && vp.includes("不限期") && !vp.includes("還差"), vp.slice(0, 120));
  check("沒有到期提醒", !(await a.isVisible("#accessBanner")));
  await a.screenshot({ path: "output/shots/v23-member.png" });
  await c.close();

  // 這組用完了：再用就不是贈送名額
  [c, a] = await ctx({ width: 1280, height: 860 });
  await a.goto(BASE + "/?invite=GF7T-2FRE"); await a.waitForSelector("#authView:not([hidden])"); await a.waitForTimeout(400);
  check("用完的贈送名額不再收起交易所", await a.isVisible("#uidRow"));
  await c.close();

  // 後台研究員列表標出贈送名額
  [c, a] = await ctx({ width: 1440, height: 900 });
  await a.goto(BASE + "/"); await a.waitForSelector("#authView:not([hidden])");
  await a.fill("#email", "boss@gmail.com"); await a.fill("#password", "password1"); await a.click("#authSubmit");
  await a.waitForSelector("#appView:not([hidden])");
  await a.goto(BASE + "/admin#members"); await a.waitForSelector("#memberTableBox table"); await closeModals(a);
  await a.waitForTimeout(300);
  const body = await a.textContent("#memberTableBox");
  check("研究員列表標出贈送名額", body.includes("gift@example.com") && body.includes("贈送名額"));
  // 研究員備註：名字旁邊直接改
  const gr = a.locator("#memberTableBox tr", { hasText: "gift@example.com" });
  await gr.locator(".note-btn").click(); await a.fill(".modal-back textarea", "小明，朋友介紹");
  await a.click(".modal-back button:has-text('儲存')"); await a.waitForSelector(".toast:has-text('備註已儲存')");
  check("研究員備註顯示在名字下面", (await gr.locator("td").first().textContent()).includes("小明，朋友介紹"));
  await a.fill("#memberSearch", "朋友介紹"); await a.waitForTimeout(200);
  check("可以用備註搜尋研究員", (await a.textContent("#memberTableBox")).includes("gift@example.com") && !(await a.textContent("#memberTableBox")).includes("amy@example.com"));
  await a.fill("#memberSearch", "");
  await a.screenshot({ path: "output/shots/v23-members.png" });
  await c.close();

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
