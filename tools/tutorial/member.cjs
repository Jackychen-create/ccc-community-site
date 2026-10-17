// 研究員使用教學
const { start, BASE } = require("./lib.cjs");
const mobile = process.argv[2] === "m";
const N = 8;
const S = (i, t) => `${i}／${N}・${t}`;

(async () => {
  const t = await start({ mobile, name: "member-" + (mobile ? "m" : "d") });
  const { page } = t;
  await page.goto(BASE + "/?invite=K7QM-2XPA");
  await page.waitForSelector("#authView:not([hidden])");
  await t.card("實驗室研究員使用教學", "CCC 交易實驗室<br>直播留檔、章節、筆記、<em>教學課程</em>、交易量", 0);
  await t.rec();
  await t.wait(3600);
  await t.uncard();

  // 1 加入
  await t.say(S(1, "加入"), "打開管理員給你的註冊連結，實驗室密碼已經幫你填好", { pos: "top" });
  await t.hl("#inviteRow", 1600); await t.unhl();
  await t.say(S(1, "加入"), "填你的 Email，再設一組 8 個字以上的密碼", { pos: "top", ms: 300 });
  await t.type("#email", "newbie@example.com");
  await t.type("#password", "mypassword", 70);
  await t.say(S(1, "加入"), "選你用 CCC 邀請連結註冊的交易所，再填那個帳號的 UID", { pos: "top", ms: 300 });
  await page.selectOption("#regEx", "OKX"); await page.dispatchEvent("#regEx", "change"); await t.wait(500);
  await t.type("#regUid", "601045615417133677", 45);
  await t.click("#authSubmit", 600);
  await page.waitForSelector(".modal:has-text('歡迎加入實驗室培訓計畫')");
  await t.say(S(1, "加入"), "第一次進來會問你要不要看這支教學，之後在右上角選單也找得到", { pos: "top" });
  await t.click(".modal-foot .btn:has-text('之後再看')", 600);
  await page.waitForSelector(".vrow");
  await t.say(S(1, "加入"), "加入完成，馬上就能看所有直播留檔", { pos: "top" });
  await t.say(S(1, "加入"), "之後打開網站，用 Email 和密碼登入就好", { pos: "top", ms: 600 });
  await t.click("#menuBtn", 500);
  await t.click("#menuPanel [role=menuitem]:has-text('登出')", 900);
  await page.waitForSelector("#authView:not([hidden])");
  await t.click("#tabLogin", 500);
  await t.type("#email", "member@example.com", 45);
  await t.type("#password", "password1", 45);
  await t.click("#authSubmit", 600);
  await page.waitForSelector(".vrow");
  await t.wait(1200);

  // 2 找影片
  await t.say(S(2, "找影片"), "每一場一列：日期、主題、主講、片長、教材，還有你看到哪裡", { ms: 400 });
  await t.hl(".vrow >> nth=1", 3600); await t.unhl();
  await t.say(S(2, "找影片"), "點主講人，只看他講的場次", { ms: 400 });
  await t.click(`#chips :text-is("OC")`, 2000);
  await t.say(S(2, "找影片"), "再點一次就取消", { ms: 300 });
  await t.click(`#chips :text-is("OC")`, 1200);
  await t.say(S(2, "找影片"), "搜尋會找標題和簡介，也會找到影片裡的章節", { ms: 400 });
  await t.scrollTop();
  await t.type("#search", "停損", 160);
  await t.wait(500);
  await t.hl(".chap-hit", 2800); await t.unhl();
  await page.fill("#search", "");
  await t.wait(600);
  await t.scrollTop();

  // 3 接著看
  await t.say(S(3, "接著看"), "「上次看到」記得你停在哪裡，換手機或電腦都會同步", { ms: 400 });
  await t.hl("#continueList", 3600); await t.unhl();
  await t.click("#continueList a.btn", 300);
  await page.waitForSelector("#watchView:not([hidden])");
  await page.evaluate(() => document.querySelector("#video").play().catch(() => {}));
  await t.say(S(3, "接著看"), "從上次停下的 23:40 接著播");
  await t.say(S(3, "接著看"), "畫面上會浮出你的帳號。影片只限研究員觀看，請不要錄影外流", { ms: 400 });
  await t.hl("#player", 3800); await t.unhl();

  // 4 章節
  await t.say(S(4, "章節"), mobile ? "往下滑是章節列表，點一下就跳到那一段" : "右邊的章節點一下，就跳到那一段", { ms: 400 });
  await t.hl("#wChapters", 2200); await t.unhl(200);
  await t.click(`#chapList .chap:has-text("實盤回放")`, 1800);
  if (mobile) await t.scrollTop();
  await t.say(S(4, "章節"), "影片下方的時間軸也分好段落，點哪段就跳哪段", { ms: 400 });
  await t.hl("#chapBar", 3000); await t.unhl();

  // 5 倍速
  await t.say(S(5, "倍速"), mobile ? "倍速可以選 0.75 到 2 倍，網站會記住你的選擇" : "倍速可以選 0.75 到 2 倍，網站會記住你的選擇；按 F 全螢幕", { ms: 400 });
  await t.click(`#speed button:text-is("1.5×")`, 2600);

  // 6 筆記與教材
  await t.say(S(6, "筆記"), "看到重點隨手記一筆，會自動記下現在的影片時間", { ms: 300 });
  await t.scrollTo("#wNotes");
  await t.type("#noteBody", "假突破：量沒跟上就先不追", 120);
  await t.click("#noteSave", 900);
  await t.say(S(6, "筆記"), mobile ? "點筆記前面的時間，就跳回影片那一段" : "點筆記前面的時間，就跳回影片那一段；電腦上按 N 可以直接開始寫", { ms: 400 });
  await t.hl("#noteList", 3800); await t.unhl();
  await t.say(S(6, "教材"), "這一場的講義和表格，在這裡下載", { ms: 400 });
  await t.hl("#wFiles", 3000); await t.unhl();
  await page.evaluate(() => document.querySelector("#video").pause());

  // 7 教學課程
  await t.scrollTop();
  if (mobile) {
    await t.click("#appView .brand", 1200);
    await page.waitForSelector("#listView:not([hidden])");
    await t.say(S(7, "教學課程"), "列表上面的「教學課程」：CCC、X、OC 的教學影片各 6 份", { ms: 400 });
    await t.hl("#coursePanel", 3200); await t.unhl(200);
    await t.click("#coursePanel a.btn", 900);
  } else {
    await t.say(S(7, "教學課程"), "上方的「教學課程」：CCC、X、OC 的教學影片各 6 份", { ms: 400 });
    await t.click("#navCourse", 900);
  }
  await page.waitForSelector("#courseView:not([hidden]) .course-row");
  await t.wait(600);
  await t.say(S(7, "教學課程"), "從你加入那天起每週解鎖一份，三人輪流，每 4 週休息一週", { ms: 400 });
  await t.hl("#courseTrack", 3200); await t.unhl(200);
  await t.say(S(7, "教學課程"), "還沒解鎖的會寫解鎖日期，到了那天就能看", { ms: 300 });
  await t.hl(".course-row.locked >> nth=0", 3000); await t.unhl();

  // 8 交易量與設定
  await t.scrollTop();
  await t.click("#appView .brand", 1200);
  await page.waitForSelector("#listView:not([hidden])");
  await t.say(S(8, "交易量"), "這裡是你這一輪的交易量，每一輪從你加入那天起算一個月", { ms: 400 });
  await t.hl("#volPanel", 1800);
  await t.say(S(8, "交易量"), "這一輪內任一間交易所達到交易量條件，就能繼續看到下一輪結束");
  await t.say(S(8, "交易量"), "Bybit、BingX 綁定 UID 後每天自動更新，還差多少一看就知道");
  await t.unhl();
  await t.scrollTop();
  await t.click("#menuBtn", 400);
  await t.hl("#menuPanel", 300);
  await t.say(S(8, "設定"), "右上角選單：教學課程、使用教學、我的筆記、寄信通知、修改密碼都在這裡", { ms: 5200 });
  await t.unhl(200);
  await page.keyboard.press("Escape");
  await t.quiet(400);

  await t.card("歡迎加入，實驗室研究員", "有問題直接問 CCC・X・OC<br>祝交易順利", 3800);
  await t.finish(`out/研究員使用教學-${mobile ? "手機直式" : "電腦橫式"}.mp4`);
})().catch((e) => { console.error(e); process.exit(1); });
