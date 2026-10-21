// 執行方式：npm test（會自動開模擬伺服器）
// v1.26：直播精華（播放頁的 AI 重點、後台套用 AI 章節）、研究員等級卡（分享到 Discord、下載卡片圖）
const { chromium } = require("playwright");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
const j = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const HL = { status: "done", summary: "這場講開盤區間怎麼畫，以及兩個常見陷阱。", points: ["先等 30 分鐘再畫高低點", "假突破要看量"], tickers: [{ name: "NQ", note: "開盤區間" }, { name: "BTC", note: "順帶一提" }], chapters: [{ t: 0, title: "開場" }, { t: 45, title: "常見陷阱" }], model: "@cf/openai/gpt-oss-120b", posted_at: null, transcript: "[0:00] 大家好\n[0:45] 陷阱" };

(async () => {
  const tok = (await j("/sb/auth/v1/token", { method: "POST", body: { email: "boss@gmail.com", password: "password1" } })).body.access_token;
  const set = await j("/api/admin/discord", { method: "PATCH", token: tok, body: { highlightChannelId: "900000000000000001", celebrateChannelId: "900000000000000002" } });
  check("後台可以設直播精華、升級慶祝頻道", set.status === 200 && set.body.settings.highlightChannelId === "900000000000000001" && set.body.settings.celebrateChannelId === "900000000000000002");
  const bad = await j("/api/admin/discord", { method: "PATCH", token: tok, body: { celebrateChannelId: "123" } });
  check("頻道 ID 格式不對會擋", bad.status === 400);
  await j("/api/__test/highlight", { method: "POST", body: { video: 5, highlight: HL } });

  const b = await chromium.launch();
  const ctx = async (vp) => {
    const c = await b.newContext({ viewport: vp, acceptDownloads: true });
    await c.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    return [c, p];
  };
  const login = async (p, email) => { await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])"); await p.fill("#email", email); await p.fill("#password", "password1"); await p.click("#authSubmit"); await p.waitForSelector("#appView:not([hidden])"); };
  const closeAll = async (p) => { for (let i = 0; i < 6; i++) { await p.waitForTimeout(1200); if (!(await p.locator(".modal-back, .lvl-back").count())) break; if (await p.locator(".lvl-back").count()) await p.waitForSelector(".lvl-flaps[data-done]"); await p.keyboard.press("Escape"); } };

  // ── 播放頁：直播精華 ──
  for (const [name, vp] of [["電腦", { width: 1280, height: 900 }], ["手機", { width: 390, height: 844 }]]) {
    const [c, p] = await ctx(vp);
    await login(p, "amy@example.com"); await closeAll(p);
    await p.evaluate(() => (location.hash = "#/v/5")); await p.waitForSelector("#wHl:not([hidden])");
    const box = await p.textContent("#wHl");
    check(`${name}：播放頁有直播精華（摘要、重點、標的、AI 提醒）`, box.includes("開盤區間怎麼畫") && (await p.locator("#wHl .ai-hl-points li").count()) === 2 && box.includes("NQ") && box.includes("AI 自動整理"), box.slice(0, 80));
    check(`${name}：沒有手動章節時用 AI 的章節`, !(await p.isHidden("#wChapters")) && (await p.textContent("#chapList")).includes("常見陷阱"));
    await p.evaluate(() => (location.hash = "#/v/6")); await p.waitForTimeout(900);
    check(`${name}：沒有精華的場次不顯示`, await p.isHidden("#wHl"));
    check(`${name}：有手動章節的照舊`, (await p.textContent("#chapList")).includes("本週違規回顧"));
    if (name === "手機") check("手機沒有橫向捲動", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.evaluate(() => (location.hash = "#/v/5")); await p.waitForSelector("#wHl:not([hidden])");
    await p.screenshot({ path: `output/shots/v31-highlight-${name === "電腦" ? "desktop" : "mobile"}.png`, fullPage: true });
    await c.close();
  }

  // ── 後台：編輯影片看精華、把 AI 章節填進章節欄 ──
  {
    const [c, p] = await ctx({ width: 1280, height: 900 });
    await login(p, "boss@gmail.com");
    await p.goto(BASE + "/admin#videos"); await p.waitForSelector("#v-videos tr");
    await p.click("#v-videos tr:has-text('NQ 開盤區間') .btn:has-text('編輯')");
    await p.waitForSelector(".hl-admin .hl-actions");
    check("後台編輯影片看得到精華摘要", (await p.textContent(".hl-admin")).includes("開盤區間怎麼畫"));
    await p.click(".hl-admin .btn:has-text('填進章節欄')"); await p.waitForTimeout(200);
    const chap = await p.inputValue(".modal textarea.mono-ish");
    check("一鍵把 AI 章節填進章節欄（還沒儲存）", chap.includes("0:00 開場") && chap.includes("0:45 常見陷阱"), chap);
    await p.click(".hl-admin .btn:has-text('貼到 Discord')"); await p.waitForTimeout(500);
    check("手動貼到 Discord", (await p.textContent(".toast:last-child")).includes("已貼到 Discord"));
    await p.click(".hl-admin details summary");
    check("看得到逐字稿", (await p.textContent(".hl-transcript pre")).includes("大家好"));
    await p.click(".modal .chip:has-text('教學課程')");
    check("教學課程不顯示直播精華", await p.isHidden(".hl-admin"));
    await p.screenshot({ path: "output/shots/v31-editor.png", fullPage: true });
    await c.close();
  }

  // ── 研究員升級 → 分享到 Discord、下載卡片圖 ──
  {
    const reg = await j("/api/register", { method: "POST", body: { email: "lv@example.com", password: "password1", inviteCode: "K7QM-2XPA", exchange: "OKX", uid: "55550031" } });
    check("註冊新研究員", reg.status === 200, JSON.stringify(reg.body));
    const id = (await j("/api/admin/members", { token: tok })).body.members.find((m) => m.email === "lv@example.com").user_id;
    await j("/api/admin/volumes", { method: "POST", token: tok, body: { which: "current", rows: [{ userId: id, amounts: { OKX: 250000 } }] } });
    const [c, p] = await ctx({ width: 1280, height: 900 });
    await login(p, "lv@example.com");
    await p.waitForSelector(".lvl-back", { timeout: 15000 }); await p.waitForSelector(".lvl-flaps[data-done]");
    check("升級畫面有「下載卡片圖」「分享到 Discord」", (await p.locator(".lvl-share .btn").count()) === 2);
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click(".lvl-share .btn:has-text('下載卡片圖')")]);
    check("下載卡片圖：PNG", dl.suggestedFilename() === "ccc_lab_level2.png", dl.suggestedFilename());
    await p.screenshot({ path: "output/shots/v31-levelup.png" });
    await p.click(".lvl-share .btn:has-text('分享到 Discord')"); await p.waitForTimeout(600);
    check("分享後按鈕變「已分享」", (await p.textContent(".lvl-share")).includes("已分享") && await p.isDisabled(".lvl-share .btn:has-text('已分享')"));
    const shares = (await j("/api/__test/shares")).body;
    check("伺服器收到分享（第二級、升級慶祝頻道）", shares.length === 1 && shares[0].level === 2 && shares[0].channel === "900000000000000002", JSON.stringify(shares));
    const mtok = (await j("/sb/auth/v1/token", { method: "POST", body: { email: "lv@example.com", password: "password1" } })).body.access_token;
    const again = await j("/api/share", { method: "POST", token: mtok, body: { level: 2 } });
    check("同一次升級不能分享兩次", again.status === 409);
    await c.close();
  }

  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})().catch((e) => { console.log(out.join("\n")); console.log("TEST CRASHED:", e.message); process.exit(1); });
