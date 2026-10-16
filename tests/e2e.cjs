// 執行方式：npm test（會自動開模擬伺服器）。單獨跑：node tests/mock-server.mjs &; node tests/e2e.cjs
// 用模擬後端在真的瀏覽器裡跑一遍前台與後台，截圖並收集錯誤
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = process.env.BASE || "http://localhost:4321";
const OUT = path.join(__dirname, "output", "shots");
const VIDEO_FILE = path.join(__dirname, "fixtures", process.env.UPLOAD || "live.webm");
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const results = [];
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

function watch(page, tag) {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`[${tag}] console.${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${tag}] pageerror: ${e.message}`));
}

async function login(page, email) {
  await page.goto(BASE + "/");
  await page.waitForSelector("#authView:not([hidden])");
  await page.fill("#email", email);
  await page.fill("#password", "password1");
  await page.click("#authSubmit");
}

(async () => {
  const browser = await chromium.launch();

  // ── 研究員：桌機 ──
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" }); await ctx.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  let page = await ctx.newPage();
  watch(page, "member-desktop");

  await page.goto(BASE + "/");
  await page.waitForSelector("#authView:not([hidden])");
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/01-login.png` });

  await page.goto(BASE + "/?invite=K7QM-2XPA");
  await page.waitForSelector("#inviteRow:not([hidden])");
  check("邀請連結自動切到註冊並帶入邀請碼", (await page.inputValue("#invite")) === "K7QM-2XPA");
  await page.screenshot({ path: `${OUT}/02-register.png` });

  // 錯誤訊息
  await page.click("#tabLogin");
  await page.fill("#email", "amy@example.com");
  await page.fill("#password", "wrongpass");
  await page.click("#authSubmit");
  await page.waitForSelector("#authError:not([hidden])");
  check("密碼錯誤顯示中文訊息", (await page.textContent("#authError")).includes("Email 或密碼錯誤"));

  // 註冊新研究員
  await page.click("#tabRegister");
  await page.fill("#email", "new@example.com");
  await page.fill("#password", "password1");
  await page.fill("#invite", "k7qm-2xpa");
  check("註冊要填交易所和 UID", await page.isVisible("#uidRow"));
  await page.click("#authSubmit"); await page.waitForTimeout(200);
  check("沒選交易所會提醒", (await page.textContent("#authError")).includes("選擇你用 CCC 邀請連結註冊的交易所"));
  await page.selectOption("#regEx", "BingX"); await page.fill("#regUid", "12345678");
  check("選交易所會換說明", (await page.textContent("#regUidHint")).includes("BingX"));
  await page.click("#authSubmit"); await page.waitForTimeout(400);
  check("Bybit、BingX 不是 CCC 邀請的不能註冊", (await page.textContent("#authError")).includes("不是用 CCC 的 BingX 邀請連結"), await page.textContent("#authError"));
  await page.selectOption("#regEx", "OKX"); await page.fill("#regUid", "1234 5678 9012");
  await page.screenshot({ path: `${OUT}/02b-register-uid.png` });
  await page.click("#authSubmit");
  await page.waitForSelector("#appView:not([hidden])", { timeout: 8000 });
  check("用邀請碼註冊後直接登入", true);
  const newLinks = await page.evaluate(() => App.api("/api/me").then((m) => m.links.filter((l) => l.uid).map((l) => `${l.exchange}:${l.uid}`)));
  check("註冊時填的 UID 記下來", newLinks.join() === "OKX:123456789012", newLinks.join());
  await page.evaluate(() => App.sb.auth.signOut());
  await page.waitForSelector("#authView:not([hidden])");

  await login(page, "amy@example.com");
  await page.waitForSelector(".vrow");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/03-list.png`, fullPage: true });
  check("列表有 5 支已發布影片（草稿不顯示）", (await page.locator(".vrow").count()) === 5);
  check("繼續觀看區出現", await page.isVisible("#continueSec"));
  check("新影片有「新」標籤", (await page.locator(".vrow .st.new").count()) >= 1);
  check("看完的影片有標記", (await page.locator(".vrow .st.done").count()) === 1);

  await page.fill("#search", "停損");
  check("搜尋「停損」只剩 1 支", (await page.locator(".vrow").count()) === 1);
  await page.fill("#search", "");
  await page.click(".chip:has-text('未看完')");
  check("「未看完」篩掉看完的", (await page.locator(".vrow").count()) === 4);
  await page.click(".chip:has-text('全部')");

  const canMp4 = await page.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"'));
  results.push(`INFO  測試瀏覽器 H.264 支援：「${canMp4 || "不支援"}」（用 WebM 測播放）`);

  // 繼續觀看 → 續播
  await page.click("#continueList .resume .btn.primary");
  await page.waitForSelector("#watchNotice .notice", { timeout: 10000 });
  const t = await page.evaluate(() => document.querySelector("#video").currentTime);
  check("從上次的位置續播", Math.abs(t - 40) < 2, `currentTime=${t.toFixed(1)}`);
  check("續播提示文字", (await page.textContent("#watchNotice")).includes("0:40"));
  await page.click(".speed button:has-text('1.5×')");
  check("倍速 1.5×", (await page.evaluate(() => document.querySelector("#video").playbackRate)) === 1.5);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Space");
  await page.waitForTimeout(1500);
  const playing = await page.evaluate(() => !document.querySelector("#video").paused);
  check("空白鍵播放", playing);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/04-watch.png`, fullPage: true });

  // 有教材的影片
  await page.goto(BASE + "/#/v/6");
  await page.waitForSelector("#wFiles:not([hidden]) .file");
  check("教材下載清單", (await page.locator("#wFileList .file").count()) === 2);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-watch-files.png`, fullPage: true });

  await page.goto(BASE + "/#/v/1");
  await page.waitForTimeout(800);
  check("研究員看不到草稿", (await page.textContent("#wTitle")).includes("找不到"));

  const log = await (await page.request.get(BASE + "/__log")).json();
  check("播放進度有存回伺服器", log.some((l) => l.startsWith("POST /api/progress")));

  // 回列表，進度更新
  await page.goto(BASE + "/#/");
  await page.waitForSelector(".vrow");

  // 選單
  await page.click("#menuBtn");
  await page.waitForTimeout(200);
  check("一般研究員選單沒有後台入口", (await page.locator("#menuPanel a[href='/admin']").count()) === 0);
  await page.screenshot({ path: `${OUT}/06-menu.png` });
  await page.click("#menuPanel button:has-text('修改密碼')");
  await page.waitForSelector(".modal");
  await page.screenshot({ path: `${OUT}/07-change-pw.png` });
  await page.keyboard.press("Escape");

  // 淺色模式
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/08-list-light.png` });
  await page.emulateMedia({ colorScheme: "dark" });
  await ctx.close();

  // ── 研究員：手機 ──
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" }); await ctx.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  page = await ctx.newPage();
  watch(page, "member-mobile");
  await page.goto(BASE + "/");
  await page.waitForSelector("#authView:not([hidden])");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/09-m-login.png`, fullPage: true });
  await page.fill("#email", "amy@example.com");
  await page.fill("#password", "password1");
  await page.click("#authSubmit");
  await page.waitForSelector(".vrow");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/10-m-list.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("手機列表沒有橫向捲動", overflow <= 0, `overflow=${overflow}`);
  await page.click(".vrow >> nth=0");
  await page.waitForSelector("#wTitle");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/11-m-watch.png`, fullPage: true });
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("手機播放頁沒有橫向捲動", overflow2 <= 0, `overflow=${overflow2}`);
  await ctx.close();

  // ── 停權研究員 ──
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  page = await ctx.newPage();
  watch(page, "banned");
  await login(page, "banned@example.com");
  await page.waitForSelector("#authError:not([hidden])");
  check("停權研究員無法登入", (await page.textContent("#authError")).includes("停用"));
  await ctx.close();

  // ── 管理員 ──
  ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" }); await ctx.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  page = await ctx.newPage();
  watch(page, "admin");
  await page.goto(BASE + "/admin");
  await page.waitForURL(/next=admin/);
  check("沒登入進後台會被導回登入頁", true);
  await page.fill("#email", "boss@gmail.com");
  await page.fill("#password", "password1");
  await page.click("#authSubmit");
  await page.waitForURL(/\/admin/);
  await page.waitForSelector("#videoTableBox table");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/12-admin-videos.png`, fullPage: true });
  check("後台看得到草稿", (await page.textContent("#videoTableBox")).includes("剪輯中"));

  // 上傳影片
  await page.setInputFiles("#videoInput", VIDEO_FILE);
  await page.waitForSelector(".upload");
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/13-admin-uploading.png` });
  await page.waitForSelector(".modal:has-text('上傳完成')", { timeout: 30000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/14-admin-after-upload.png` });
  const uploadLog = await (await page.request.get(BASE + "/__log")).json();
  check("影片直傳 R2", uploadLog.some((l) => l.startsWith("PUT /r2/video/")));
  check("自動擷取並上傳封面", uploadLog.some((l) => l.startsWith("PUT /r2/thumb/")));
  await page.fill(".modal textarea", "測試上傳的簡介");
  await page.setInputFiles(".modal input[type=file][multiple]", path.join(__dirname, "fixtures", "thumb5.jpg"));
  await page.waitForSelector(".modal .file .name:has-text('thumb5.jpg')", { timeout: 10000 });
  check("編輯視窗可加教材", true);
  await page.click(".modal-foot .btn.primary");
  await page.waitForSelector(".modal:has-text('已發布，研究員現在看得到了')");
  check("儲存並發布", true);
  await page.click(".modal-foot .btn.primary:has-text('寄信通知')");
  await page.waitForSelector(".toast:has-text('已寄給')");
  check("發布後可以順便寄信通知", true);

  // 刪除確認
  await page.click("#videoTableBox tbody tr:nth-child(1) .btn.danger");
  await page.waitForSelector(".modal:has-text('刪除影片')");
  await page.screenshot({ path: `${OUT}/15-admin-delete-confirm.png` });
  await page.click(".modal-foot .btn:has-text('取消')");

  // 邀請碼
  await page.click(".nav a[data-view=invites]");
  await page.waitForSelector("#inviteTableBox table");
  await page.fill("#invNote", "10 月新研究員");
  await page.click("#invCreate");
  await page.waitForSelector(".new-code");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/16-admin-invites.png`, fullPage: true });
  check("產生邀請碼與註冊連結", (await page.textContent(".new-code")).includes("?invite=NEW4-C0DE"));

  // 研究員
  await page.click(".nav a[data-view=members]");
  await page.waitForSelector("#memberTableBox table");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/17-admin-members.png`, fullPage: true });
  await page.click("#memberTableBox tbody tr:has-text('amy@example.com') .btn:has-text('重設密碼')");
  await page.click(".modal-foot .btn.primary");
  await page.waitForSelector(".modal:has-text('Tq8mWz3kPa7c')");
  await page.screenshot({ path: `${OUT}/18-admin-reset.png` });
  await page.keyboard.press("Escape");
  await page.click("#memberTableBox tbody tr:has-text('amy@example.com') .btn:has-text('停權')");
  await page.click(".modal-foot .btn.danger-solid");
  await page.waitForSelector("#memberTableBox tbody tr:has-text('amy@example.com') .pill.warn");
  check("停權研究員", true);
  await ctx.close();

  // ── 管理員：手機 ──
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await ctx.addInitScript(() => { try { sessionStorage.setItem("uidPrompted", "1"); localStorage.setItem("tutorialOffered", "true"); } catch {} });
  page = await ctx.newPage();
  watch(page, "admin-mobile");
  await login(page, "boss@gmail.com");
  await page.waitForSelector("#appView:not([hidden])");
  await page.click("#menuBtn");
  check("管理員選單有後台入口", (await page.locator("#menuPanel a[href='/admin']").count()) === 1);
  await page.goto(BASE + "/admin");
  await page.waitForSelector("#videoTableBox table");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/19-m-admin.png`, fullPage: true });
  const overflow3 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("手機後台沒有整頁橫向捲動", overflow3 <= 0, `overflow=${overflow3}`);
  await ctx.close();

  await browser.close();
  // 程式錯誤（pageerror）一定要是 0；網路的 400／404 是測試故意的，不算
  const pageErrors = [...new Set(problems.filter((x) => x.includes("pageerror")))];
  check("沒有頁面錯誤", !pageErrors.length, pageErrors.join(" | "));
  console.log(results.join("\n"));
  console.log("\n--- console / page errors ---");
  console.log(problems.length ? [...new Set(problems)].join("\n") : "(none)");
})().catch((e) => {
  console.log(results.join("\n"));
  console.log("\n--- problems ---\n" + [...new Set(problems)].join("\n"));
  console.error("\nTEST CRASHED:", e.message);
  process.exit(1);
});
