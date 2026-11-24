// 研究員使用說明（v1.37.22 重錄：交易所 UID ＋ Discord 加入、直播紀錄、交易分享、筆記、提問）
// 示範網站：TUTORIAL=1 的 tests/mock-server.mjs（make.sh 會自動開）
const { start, BASE } = require("./lib.cjs");
const mobile = process.argv[2] === "m";
const N = 7;
const S = (i, t) => `${i}／${N}・${t}`;

(async () => {
  const t = await start({ mobile, name: "member-" + (mobile ? "m" : "d") });
  const { page } = t;
  const closeModals = async () => {
    for (let i = 0; i < 3; i++) {
      const c = page.locator('.modal [aria-label="關閉"]').last();
      if (!(await c.count())) break;
      await t.click(c, 500);
    }
  };
  await fetch(BASE + "/api/__test/join-on", { method: "POST", headers: { "content-type": "application/json" }, body: '{"on":true}' });
  await page.goto(BASE + "/lab");
  await page.waitForSelector("#authView:not([hidden])");
  await t.card("實驗室培訓房使用說明", "CCC° 交易實驗室<br>加入、<em>直播紀錄</em>、<em>交易分享</em>、筆記、提問", 0);
  await t.rec();
  await t.wait(3600);
  await t.uncard();

  // 1 加入
  await t.say(S(1, "加入"), "選你用 CCC 連結註冊的交易所，填那個帳號的 UID", { pos: "top" });
  await t.moveTo("#joinEx"); await t.wait(300);
  await page.selectOption("#joinEx", "OKX"); await t.wait(600);
  await t.type("#joinUid", "601045615417133677", 45);
  await t.say(S(1, "加入"), "UID 在交易所 App 的個人頁面，名字旁邊那串數字", { pos: "top" });
  await t.click("#joinSubmit", 900);
  await t.say(S(1, "加入"), "確認是 CCC 的推薦用戶後，按「進入 Discord 實驗室研究員專區」", { pos: "top" });
  await t.hl("#joinDiscord", 1800); await t.unhl();
  await t.say(S(1, "加入"), "到 Discord 按「授權」，就會自動加入伺服器、拿到研究員身分", { pos: "top" });
  await t.click("#joinDiscord", 300);
  await page.waitForSelector(".modal:has-text('開通完成')");
  await t.wait(900);
  await t.say(S(1, "加入"), "開通完成。留一個 Email，直播通知和新影片會寄給你", { pos: "top" });
  await t.hl(".modal:has-text('開通完成')", 3000); await t.unhl();
  await t.say(S(1, "加入"), "「打開 Discord」會直接帶你到研究員專區", { pos: "top", ms: 2600 });
  await closeModals();
  await page.waitForSelector(".vrow");
  await t.wait(800);

  // 2 登入
  await t.say(S(2, "登入"), "之後要進來，到「登入」按「用 Discord 登入」就好，不用記密碼");
  await t.click("#menuBtn", 500);
  await t.click("#menuPanel [role=menuitem]:has-text('登出')", 900);
  await page.waitForSelector("#authView:not([hidden])");
  await t.click("#tabSignin", 600);
  await t.hl("#discordLogin", 1600); await t.unhl(200);
  await t.click("#discordLogin", 300);
  await page.waitForSelector(".vrow");
  await t.wait(800);
  await closeModals();
  await t.wait(600);

  // 3 直播紀錄
  if (mobile) await t.say(S(3, "直播紀錄"), "最上面是最新一場，按「開始看」馬上播");
  await t.scrollTo("#chips");
  await t.say(S(3, "直播紀錄"), "CCC、X 每場直播的完整紀錄：日期、主題、主講、片長、教材", { ms: 400 });
  await t.hl(".vrow >> nth=0", 3400); await t.unhl();
  await t.say(S(3, "直播紀錄"), "點主講人，只看他講的場次；「未看完」挑出還沒看完的", { ms: 400 });
  await t.click(`#chips :text-is("X")`, 2200);
  await t.click(`#chips :text-is("X")`, 900);
  await t.say(S(3, "直播紀錄"), "搜尋會找標題、簡介，也會找到影片裡的章節", { ms: 400 });
  await t.scrollTop();
  await t.type("#search", "停損", 160);
  await t.wait(600);
  await t.hl(".chap-hit", 2800); await t.unhl();
  await page.fill("#search", "");
  await t.wait(700);
  await t.scrollTo("#chips");

  // 4 看影片
  await t.click(".vrow >> nth=0", 400);
  await page.waitForSelector("#watchView:not([hidden])");
  await page.evaluate(() => { const v = document.querySelector("#video"); v.currentTime = 41 * 60; v.play().catch(() => {}); });
  await t.wait(800);
  await t.say(S(4, "看影片"), "畫面上會浮出你的帳號。影片只限研究員觀看，請不要錄影外流", { ms: 400 });
  await t.hl("#player", 3600); await t.unhl();
  await t.say(S(4, "看影片"), mobile ? "往下滑是章節，點一下就跳到那一段" : "右邊的章節點一下，就跳到那一段", { ms: 400 });
  await t.hl("#wChapters", 2000); await t.unhl(200);
  await t.click(`#chapList .chap:has-text("追單之後")`, 1600);
  if (mobile) await t.scrollTop();
  await t.say(S(4, "看影片"), "影片下方的時間軸也分好段落", { ms: 400 });
  await t.hl("#chapBar", 2600); await t.unhl();
  await t.say(S(4, "看影片"), mobile ? "倍速 0.75 到 2 倍，網站會記住" : "倍速 0.75 到 2 倍，網站會記住；按 F 全螢幕、空白鍵暫停", { ms: 400 });
  await t.click(`#speed button:text-is("1.5×")`, 2400);
  await t.say(S(4, "看影片"), "這一場的講義和表格，在「教材下載」", { ms: 400 });
  await t.hl("#wFiles", 2800); await t.unhl();
  await t.say(S(4, "看影片"), "看到一半離開，下次回來會從停下的地方接著播", { ms: 3000 });

  // 5 筆記
  await t.scrollTo("#wNotes");
  await t.say(S(5, "筆記"), "看到重點隨手記一筆，會自動記下現在的影片時間", { ms: 300 });
  await t.type("#noteBody", "追單之後：先問自己停損在哪，沒有就不加碼", 110);
  await t.click("#noteSave", 900);
  await t.say(S(5, "筆記"), mobile ? "點筆記前面的時間，就跳回影片那一段" : "點筆記前面的時間就跳回那一段；電腦上按 N 直接開始寫", { ms: 400 });
  await t.hl("#noteList", 3200); await t.unhl();

  // 6 提問
  await t.say(S(6, "提問"), "哪裡聽不懂，按「提問」直接問 CCC、X", { ms: 400 });
  await t.click("#askBtn", 900);
  await t.type(".modal textarea", "這裡停損為什麼放在前低下面？", 120);
  await t.say(S(6, "提問"), "會附上影片的時間點。回覆後寄信給你，右上角「我的提問」也看得到", { pos: "top" });
  await t.click(".modal-foot .btn:has-text('送出')", 1200);
  await page.evaluate(() => document.querySelector("#video")?.pause());

  // 7 交易分享與選單
  await t.scrollTop();
  if (mobile) {
    await t.click("#appView .brand", 1200);
    await page.waitForSelector("#listView:not([hidden])");
    await t.say(S(7, "交易分享"), "CCC、X 的實戰交易分享，在首頁的「交易分享」", { ms: 400 });
    await t.hl("#coursePanel", 2600); await t.unhl(200);
    await t.click("#coursePanel a.btn, #coursePanel button:has-text('看全部')", 900);
  } else {
    await t.say(S(7, "交易分享"), "上方的「交易分享」：CCC、X 的實戰交易分享", { ms: 400 });
    await t.click("#navCourse", 900);
  }
  await page.waitForSelector("#courseView:not([hidden]) .course-row");
  await t.wait(600);
  await t.say(S(7, "交易分享"), "加入就能看，有新的會標「新上架」");
  await t.click("#menuBtn", 400);
  await t.hl("#menuPanel", 300);
  await t.say(S(7, "選單"), "右上角選單：我的筆記、我的提問、新影片通知、外觀主題，這支說明也在這裡", { ms: 5400 });
  await t.unhl(200);
  await page.keyboard.press("Escape");
  await t.quiet(400);

  await t.card("歡迎加入，實驗室研究員", "有問題在 Discord 客服中心開單<br>或直接在影片裡提問", 3800);
  await t.finish(`out/研究員使用教學-${mobile ? "手機直式" : "電腦橫式"}.mp4`);
})().catch((e) => { console.error(e); process.exit(1); });
