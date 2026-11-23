// 執行方式：npm test（會自動開模擬伺服器）
// v1.20：連續打卡（頁首 🔥）、本週小目標（選做：看完 1 部、記 1 則筆記、這週打開網站 3 天）
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
const j = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const closeAll = async (p) => { for (let i = 0; i < 6; i++) { await p.waitForTimeout(1200); if (!(await p.locator(".modal-back, .lvl-back").count())) break; await p.keyboard.press("Escape"); } };
(async () => {
  const tok = (await j("/sb/auth/v1/token", { method: "POST", body: { email: "boss@gmail.com", password: "password1" } })).body.access_token;
  await j("/api/register", { method: "POST", body: { email: "qq@example.com", password: "password1", inviteCode: "K7QM-2XPA", exchange: "OKX", uid: "88881111" } });
  const id = (await j("/api/admin/members", { token: tok })).body.members.find((m) => m.email === "qq@example.com").user_id;
  // 先到第二級（看得到直播紀錄）
  await j("/api/admin/volumes", { method: "POST", token: tok, body: { which: "current", rows: [{ userId: id, amounts: { OKX: 250000 } }] } });
  const mt = (await j("/sb/auth/v1/token", { method: "POST", body: { email: "qq@example.com", password: "password1" } })).body.access_token;

  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
  const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
  await p.fill("#email", "qq@example.com"); await p.fill("#password", "password1"); await p.click("#authSubmit");
  await p.waitForSelector("#questPanel:not([hidden])"); await closeAll(p);
  check("頁首有連續打卡 🔥 1", (await p.textContent("#streakChip")).includes("🔥 1") && (await p.isVisible("#streakChip")));
  check("本週小目標三個；今天打開算第 1 天", (await p.locator("#questPanel .quest-list li").count()) === 3 && (await p.locator("#questPanel .quest-list li.done").count()) === 0 && (await p.textContent("#questPanel")).includes("1／3"));
  check("寫選做、口氣輕鬆", (await p.textContent("#questPanel")).includes("選做") && (await p.textContent("#questPanel")).includes("有空再做就好"));

  // 做小目標：看完一部（存進度到片尾）、記 1 則筆記、這週另外兩天也有打開
  await j("/api/progress", { method: "POST", token: mt, body: { videoId: 5, position: 90, duration: 90 } });
  await j("/api/notes", { method: "POST", token: mt, body: { videoId: 5, t: 10, body: "筆記" } });
  const wk = await j("/api/quests", { token: mt });
  await j("/api/__test/checkin", { method: "POST", body: { email: "qq@example.com", days: Array.from({ length: 7 }, (_, i) => new Date(Date.parse(wk.body.week.start + "T00:00:00Z") + i * 864e5).toISOString().slice(0, 10)) } });
  await p.reload(); await p.waitForSelector("#questPanel:not([hidden])");
  await p.waitForSelector(".toast:has-text('小目標都完成了')", { timeout: 8000 }).catch(() => {});
  check("三個都完成：打勾、蓋「完成」章", (await p.locator("#questPanel .quest-list li.done").count()) === 3 && (await p.isVisible("#questPanel .quest-stamp")));
  check("跳一次提示、累積 1 週", (await p.textContent("body")).includes("已經累積 1 週"));
  await closeAll(p);
  await p.locator("#questPanel").screenshot({ path: "output/shots/v27-quests.png" });
  await c.close();

  // 手機
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 } });
  await c2.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  await c2.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
  const m = await c2.newPage(); m.on("pageerror", (e) => errs.push(e.message));
  await m.goto(BASE + "/"); await m.waitForSelector("#authView:not([hidden])");
  await m.fill("#email", "qq@example.com"); await m.fill("#password", "password1"); await m.click("#authSubmit");
  await m.waitForSelector("#questPanel:not([hidden])"); await closeAll(m);
  check("手機頁首看得到 🔥", await m.isVisible("#streakChip"));
  check("手機沒有橫向捲動", await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await m.screenshot({ path: "output/shots/v27-mobile-header.png" });
  await c2.close();

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
