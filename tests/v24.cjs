// 執行方式：npm test（會自動開模擬伺服器）
// v1.20：三級制度：新研究員第一輪是第二級；第二輪起上一輪只到第一級 → 第一級（網站內容鎖著、看得到升級說明）→ 交易量升級時首頁跳恭喜 → 第二級打開網站 → 第三級一對一
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
const j = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
// 把跳出來的視窗（升級、徽章）一個一個關掉，回傳看到的文字
const closeAll = async (p) => { const seen = []; for (let i = 0; i < 6; i++) { await p.waitForTimeout(1300); if (!(await p.locator(".modal-back, .lvl-back").count())) break; if (await p.locator(".lvl-back").count()) await p.waitForSelector(".lvl-flaps[data-done]"); seen.push(await p.textContent(".modal-back, .lvl-back")); await p.keyboard.press("Escape"); } return seen.join(" ‖ "); };
(async () => {
  const reg = await j("/api/register", { method: "POST", body: { email: "ms@example.com", password: "password1", inviteCode: "K7QM-2XPA", exchange: "OKX", uid: "55550001" } });
  check("註冊新研究員", reg.status === 200, JSON.stringify(reg.body));
  const tok = (await j("/sb/auth/v1/token", { method: "POST", body: { email: "boss@gmail.com", password: "password1" } })).body.access_token;
  const id = (await j("/api/admin/members", { token: tok })).body.members.find((m) => m.email === "ms@example.com").user_id;
  const setOkx = (n) => j("/api/admin/volumes", { method: "POST", token: tok, body: { which: "current", rows: [{ userId: id, amounts: { OKX: n } }] } });
  const mtok = (await j("/sb/auth/v1/token", { method: "POST", body: { email: "ms@example.com", password: "password1" } })).body.access_token;

  // 新研究員第一輪先是第二級（v1.20.6）
  const first = await j("/api/me", { token: mtok });
  check("新研究員第一輪先是第二級", first.body.tier === 2 && first.body.volume.tier === 2, JSON.stringify([first.body.tier, first.body.volume?.tier]));
  // 往後移到第二輪，上一輪只到第一級 → 這一輪是第一級
  await j("/api/__test/age", { method: "POST", body: { email: "ms@example.com", days: 40, prevAmounts: { OKX: 15000 } } });

  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
  const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
  await p.fill("#email", "ms@example.com"); await p.fill("#password", "password1"); await p.click("#authSubmit");
  await p.waitForSelector(".lock-page");
  check("上一輪只到第一級：網站內容鎖著，顯示升級說明", (await p.textContent(".lock-page")).includes("你現在是第一級") && !(await p.locator("#grid .vrow").count()));
  check("升級說明列出三級和門檻", (await p.locator(".tier-card").count()) === 3 && (await p.textContent(".tier-card.me")).includes("第一級") && (await p.textContent(".lock-page")).includes("150 萬 USDT"));
  check("還沒有交易量也寫出來", (await p.textContent(".lock-hero")).includes("還沒有交易量"));
  check("右欄看得到我的等級", (await p.textContent("#volPanel")).includes("你現在是第一級"));
  check("階梯三格都沒亮（這一輪還沒交易量）", (await p.locator("#volPanel .ms-step").count()) === 3 && (await p.locator("#volPanel .ms-step.on").count()) === 0);
  check("繼續看、課程、筆記這些不顯示", !(await p.isVisible("#continueList")) && !(await p.isVisible("#statsPanel")) && !(await p.isVisible("#recentNotes")));
  check("沒有跳恭喜", !(await closeAll(p)).includes("升上"));
  check("第一級：首頁有「先看系統分享第 1 份」", await p.isVisible(".lock-free"));
  // v1.37.0：系統分享頁改成交易分享，第 1 份的解鎖在 /api/videos 測
  await p.evaluate(() => (location.hash = "#/v/6")); await p.waitForTimeout(800);
  check("直播紀錄要第二級", (await p.textContent("#wTitle")).includes("第二級"), await p.textContent("#wTitle"));
  await p.screenshot({ path: "output/shots/v24-tier1-course.png" });
  await p.evaluate(() => (location.hash = "#/")); await p.waitForSelector(".lock-page");
  await p.screenshot({ path: "output/shots/v24-locked.png" });
  const v = await j("/api/videos", { token: mtok });
  check("伺服器也擋：直播紀錄要第二級", v.status === 403 && v.body.code === "tier" && v.body.error.includes("第二級"), JSON.stringify(v.body));

  // 1.5 萬 → 第一級（這一輪自己達到的）
  await setOkx(15000);
  await p.evaluate(() => (location.hash = "#/"));
  await p.reload(); await p.waitForSelector(".lock-page");
  const t1 = await closeAll(p);
  check("升上第一級：跳恭喜、寫第二級還差多少", t1.includes("升上第一級") && t1.includes("第二級還差 18.5 萬"), t1.slice(0, 160));
  check("還是鎖著（要第二級）", await p.isVisible(".lock-page"));
  check("階梯亮第一格", (await p.locator("#volPanel .ms-step.on").count()) === 1);

  // 25 萬 → 第二級，網站打開
  await setOkx(250000);
  await p.reload(); await p.waitForSelector("#volPanel:not([hidden])");
  const t2 = await closeAll(p);
  check("升上第二級：跳恭喜、寫解鎖什麼", t2.includes("升上第二級") && t2.includes("直播紀錄") && t2.includes("至少到"), t2.slice(0, 200));
  await p.waitForSelector("#grid .vrow");
  check("第二級看得到直播紀錄", (await p.locator("#grid .vrow").count()) > 0 && !(await p.isVisible(".lock-page")));
  const v2 = await j("/api/videos", { token: mtok });
  check("伺服器也放行", v2.status === 200);
  check("階梯亮到第二格", (await p.locator("#volPanel .ms-step.on").count()) === 2 && (await p.textContent("#volPanel .ms-step.now .ms-label")) === "第二級");
  check("右欄寫第三級還差多少", (await p.textContent("#volPanel")).includes("第三級還差 125 萬"), await p.textContent("#volPanel"));
  await p.reload(); await p.waitForSelector("#grid .vrow");
  check("看過就不再跳", !(await closeAll(p)).includes("升上"));

  // 160 萬 → 第三級
  await setOkx(1600000);
  await p.reload(); await p.waitForSelector("#grid .vrow");
  const t3 = await closeAll(p);
  check("升上第三級：寫一對一", t3.includes("升上第三級") && t3.includes("一對一"), t3.slice(0, 200));
  check("階梯三格都亮", (await p.locator("#volPanel .ms-step.on").count()) === 3);
  await p.evaluate(() => (location.hash = "#/")); await p.waitForSelector("#grid .vrow");
  await p.locator("#volPanel").screenshot({ path: "output/shots/v24-tier3-panel.png" });
  await c.close();

  // 手機：另一位新研究員的升級說明
  await j("/api/register", { method: "POST", body: { email: "ms2@example.com", password: "password1", inviteCode: "K7QM-2XPA", exchange: "OKX", uid: "55550009" } });
  await j("/api/__test/age", { method: "POST", body: { email: "ms2@example.com", days: 40, prevAmounts: { OKX: 15000 } } });
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 } });
  await c2.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  await c2.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
  const m = await c2.newPage(); m.on("pageerror", (e) => errs.push(e.message));
  await m.goto(BASE + "/"); await m.waitForSelector("#authView:not([hidden])");
  await m.fill("#email", "ms2@example.com"); await m.fill("#password", "password1"); await m.click("#authSubmit");
  await m.waitForSelector(".lock-page"); await closeAll(m);
  const ov = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("手機沒有橫向捲動", ov <= 0, `overflow=${ov}`);
  await m.screenshot({ path: "output/shots/v24-locked-mobile.png", fullPage: true });
  await c2.close();

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
