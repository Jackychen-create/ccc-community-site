// 執行方式：npm test（會自動開模擬伺服器）。單獨跑：node tests/mock-server.mjs &; node tests/v14.cjs
// v1.4 新功能測試
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:4321";
const FONT_CSS = ["noto-sans-tc/400","noto-sans-tc/500","noto-sans-tc/700","sofia-sans-semi-condensed/500","sofia-sans-semi-condensed/600","sofia-sans-semi-condensed/700"].map((f) => `@import url("${BASE}/__fonts/${f}.css");`).join("\n");
const out = []; const check = (n, ok, d = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
const errs = [];
(async () => {
  const b = await chromium.launch();
  async function ctx(vp) {
    const c = await b.newContext({ viewport: vp }); await c.addInitScript(() => { try { localStorage.setItem("tutorialOffered", "true"); } catch {} });
    await c.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "text/css", body: FONT_CSS }));
    const p = await c.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    return [c, p];
  }
  async function login(p, email) {
    await p.goto(BASE + "/"); await p.waitForSelector("#authView:not([hidden])");
    await p.fill("#email", email); await p.fill("#password", "password1"); await p.click("#authSubmit");
  }
  // ── 研究員 ──
  let [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "amy@example.com"); await p.waitForSelector(".vrow"); await p.waitForTimeout(800);
  // 封面：列表每一列都有封面格，有設封面的顯示圖片；播放器按播放前顯示封面
  check("列表每一列都有封面格", (await p.locator(".vrow .vthumb").count()) === (await p.locator(".vrow").count()));
  check("有封面的場次顯示封面圖", (await p.locator(".vrow .vthumb img").count()) >= 1);
  await p.evaluate(() => (location.hash = "#/v/6")); await p.waitForSelector("#watchView:not([hidden])"); await p.waitForTimeout(500);
  check("播放器先顯示封面", /thumb/.test((await p.getAttribute("#video", "poster")) || ""), await p.getAttribute("#video", "poster"));
  await p.evaluate(() => (location.hash = "#/")); await p.waitForSelector("#listView:not([hidden])"); await p.waitForTimeout(500);
  check("離開播放頁會清掉封面", !(await p.getAttribute("#video", "poster")));
  check("資格快到期會提醒", (await p.isVisible("#accessBanner")) && (await p.textContent("#accessBanner")).includes("還有 5 天"), await p.textContent("#accessBanner"));

  await p.fill("#search", "追單"); await p.waitForTimeout(300);
  check("搜尋找得到章節", (await p.locator(".chap-hit").count()) === 1);
  await p.screenshot({ path: "output/shots/v14-search-chapter.png" });
  await p.click(".chap-hit"); await p.waitForSelector("#watchView:not([hidden])"); await p.waitForTimeout(1500);
  const t1 = await p.evaluate(() => document.querySelector("#video").currentTime);
  check("點章節搜尋結果會跳到那個時間", Math.abs(t1 - 50) < 2, t1.toFixed(1));
  check("跳轉提示文字", (await p.textContent("#watchNotice")).includes("從 0:50 開始播放"));
  check("章節面板 4 段", (await p.locator("#chapList .chap").count()) === 4);
  check("章節時間軸 4 格", (await p.locator("#chapBar .seg").count()) === 4);
  await p.click("#chapList .chap:has-text('Q&A')"); await p.waitForTimeout(800);
  const t2 = await p.evaluate(() => document.querySelector("#video").currentTime);
  check("點章節會跳過去", t2 >= 75 && t2 < 80, t2.toFixed(1));
  check("目前章節有標示", (await p.getAttribute("#chapList .chap:nth-child(4)", "class")).includes("on"));
  await p.evaluate(() => document.querySelector("#video").pause());
  await p.screenshot({ path: "output/shots/v14-watch-chapters.png", fullPage: true });
  // 筆記
  await p.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  await p.keyboard.press("n");
  check("按 N 開始寫筆記", await p.evaluate(() => document.activeElement?.id === "noteBody"));
  await p.fill("#noteBody", "Q&A 這段：有人問停損要不要移");
  await p.click("#noteSave"); await p.waitForTimeout(400);
  check("新增筆記", (await p.locator("#noteList .note").count()) === 1);
  const noteT = await p.textContent("#noteList .note-t");
  check("筆記記在目前時間", /^1:1\d$/.test(noteT), noteT);
  await p.goto(BASE + "/#/v/5"); await p.waitForTimeout(1500);
  check("每場的筆記分開", (await p.locator("#noteList .note").count()) === 1 && (await p.textContent("#noteList .note-body")).includes("開盤區間"));
  await p.goto(BASE + "/#/notes"); await p.waitForSelector("#notesView:not([hidden])"); await p.waitForTimeout(600);
  check("我的筆記頁依場次分組", (await p.locator(".note-group").count()) === 2, String(await p.locator(".note-group").count()));
  await p.screenshot({ path: "output/shots/v14-notes.png" });
  await p.click(".note-group:nth-child(1) .note .btn"); await p.waitForTimeout(500);
  check("刪除筆記", (await p.locator(".note-group").count()) === 1);
  // 通知開關
  await p.click("#menuBtn"); await p.waitForTimeout(200);
  await p.screenshot({ path: "output/shots/v14-menu.png" });
  await p.click("[role=menuitemcheckbox]"); await p.waitForTimeout(400);
  check("關閉寄信通知", (await p.textContent(".toast")).includes("已關閉"));
  // 手機橫放
  await p.setViewportSize({ width: 844, height: 390 }); await p.goto(BASE + "/#/v/6"); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector("#video").play());
  await p.waitForTimeout(600);
  const pos = await p.evaluate(() => getComputedStyle(document.querySelector("#player")).position);
  check("手機橫放播放時佔滿畫面", pos === "fixed", pos);
  check("橫放時浮水印還在", await p.evaluate(() => !!document.querySelector("#wm .wm-move")));
  await p.screenshot({ path: "output/shots/v14-landscape.png" });
  await c.close();

  // ── 後台 ──
  [c, p] = await ctx({ width: 1440, height: 900 });
  await login(p, "boss@gmail.com"); await p.waitForSelector("#appView:not([hidden])");
  await p.goto(BASE + "/admin"); await p.waitForSelector("#shell:not([hidden])"); await p.waitForTimeout(600);
  await p.click("#videoTableBox tbody tr:has-text('NQ 開盤區間') .btn:has-text('編輯')"); await p.waitForTimeout(300);
  const chapTA = p.locator(".modal textarea").nth(1);
  await chapTA.fill("0:10 開頭\n0:40 開盤區間\n這行沒有時間");
  check("章節格式錯誤會提示", (await p.textContent(".modal .hint.warn-text")).includes("第 3 行"));
  await p.screenshot({ path: "output/shots/v14-admin-edit.png" });
  // 封面：上傳圖片
  await p.setInputFiles(".modal input[type=file][accept^=image]", path.join(__dirname, "fixtures", "thumb20.jpg"));
  await p.waitForSelector(".toast:has-text('封面已更新')", { timeout: 8000 }).catch(() => {});
  check("上傳圖片當封面", await p.isVisible(".toast:has-text('封面已更新')"));
  // 從影片挑一格
  await p.click(".modal .btn:has-text('從影片挑一格')");
  await p.waitForSelector(".frame-picker"); await p.waitForTimeout(1500);
  await p.fill(".frame-range", "500"); await p.dispatchEvent(".frame-range", "input"); await p.waitForTimeout(600);
  await p.screenshot({ path: "output/shots/v14-frame-picker.png" });
  await p.click(".modal .btn.primary:has-text('用這一格')");
  await p.waitForFunction(() => !document.querySelector(".frame-picker"), null, { timeout: 8000 }).catch(() => {});
  check("從影片挑一格當封面", !(await p.$(".frame-picker")));
  await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(600);
  const toast = await p.textContent(".toast:last-child");
  check("標題開頭的日期自動拿掉", toast.includes("NQ 開盤區間怎麼看") && toast.includes("拿掉"), toast);
  check("後台列表標題已更新", (await p.textContent("#videoTableBox")).includes("NQ 開盤區間怎麼看") && !(await p.textContent("#videoTableBox")).includes("10/2 直播"));
  // 寄通知
  await p.click("#videoTableBox tbody tr:has-text('本週盤勢') .btn:has-text('編輯')"); await p.waitForTimeout(300);
  await p.click(".modal .btn:has-text('寄信通知研究員')"); await p.waitForTimeout(500);
  check("寄信通知", (await p.textContent(".toast:last-child")).includes("已寄給"));
  await p.keyboard.press("Escape");
  // 研究員資格
  await p.goto(BASE + "/admin#members"); await p.waitForTimeout(700);
  await p.screenshot({ path: "output/shots/v14-admin-members.png" });
  check("研究員列表顯示資格", (await p.textContent("#memberTableBox")).includes("到 "));
  await p.click("#memberTableBox tbody tr:has-text('amy@example.com') .btn:has-text('資格')"); await p.waitForTimeout(200);
  await p.click(".modal .chip:has-text('這個月底')");
  await p.screenshot({ path: "output/shots/v14-access.png" });
  const monthEnd = await p.inputValue(".modal input[type=date]");
  check("一鍵設成這個月底", /^\d{4}-\d{2}-(28|29|30|31)$/.test(monthEnd), monthEnd);
  await p.fill(".modal input[type=date]", "2026-10-01");
  await p.click(".modal-foot .btn.primary"); await p.waitForTimeout(400);
  check("資格過期會標紅", (await p.textContent("#memberTableBox tbody tr:has-text('amy@example.com')")).includes("已過期"));
  // 統計
  await p.goto(BASE + "/admin#stats"); await p.waitForSelector("#statsBox table"); await p.waitForTimeout(400);
  check("觀看統計有兩張表", (await p.locator("#statsBox table").count()) === 2);
  await p.screenshot({ path: "output/shots/v14-stats.png", fullPage: true });
  await c.close();
  // 過期研究員登入
  [c, p] = await ctx({ width: 1100, height: 700 });
  await login(p, "amy@example.com"); await p.waitForSelector("#blockedView:not([hidden])");
  check("資格過期就不能看", (await p.textContent("#blockedMsg")).includes("觀看資格到 2026-10-01"), await p.textContent("#blockedMsg"));
  await c.close();
  check("沒有頁面錯誤", !errs.length, errs.join(" | "));
  console.log(out.join("\n")); await b.close();
})();
