// 管理員使用教學（給 CCC、X、OC）
const path = require("path");
const { start, BASE } = require("./lib.cjs");
const mobile = process.argv[2] === "m";
const N = 7;
const S = (i, t) => `${i}／${N}・${t}`;
const UP = (f) => ({ name: f, mimeType: f.endsWith(".pdf") ? "application/pdf" : "video/webm", buffer: require("fs").readFileSync(path.join(__dirname, "upload", f)) });

(async () => {
  const t = await start({ mobile, name: "admin-" + (mobile ? "m" : "d") });
  const { page } = t;
  await page.goto(BASE + "/");
  await page.waitForSelector("#authView:not([hidden])");
  await t.card("管理員使用教學", "給 CCC、X、OC<br>上傳影片、<em>教學課程</em>、實驗室密碼、交易量", 0);
  await t.rec();
  await t.wait(3800);
  await t.uncard();

  // 1 進後台
  await t.say(S(1, "進後台"), "用管理員帳號登入，右上角選單點「後台管理」", { pos: "top", ms: 300 });
  await t.type("#email", "ccc@example.com", 45);
  await t.type("#password", "password1", 45);
  await t.click("#authSubmit", 600);
  await page.waitForSelector(".vrow");
  await t.wait(700);
  await t.click("#menuBtn", 500);
  await t.click("#menuPanel a[href='/admin']", 300);
  await page.waitForSelector("#videoTableBox table");
  await t.wait(900);

  // 2 上傳
  await t.say(S(2, "上傳"), "點「上傳影片」選檔案，電腦上也可以直接把檔案拖進來", { ms: 400 });
  await t.fakeTap("#pickVideo", 700);
  await page.setInputFiles("#videoInput", UP("1010直播.webm"));
  await t.say(S(2, "上傳"), "影片直接傳到雲端，會顯示進度和剩餘時間；封面和片長自動抓好", { ms: 300 });
  await page.waitForSelector(".modal:has-text('上傳完成')", { timeout: 60000 });
  await t.wait(1800);

  // 3 補資訊、發布
  await t.say(S(3, "補資訊"), "上傳完會先存成草稿。標題寫主題就好，日期另外有欄位", { ms: 300 });
  await t.type(".modal input[type=text] >> nth=0", "假突破實戰檢討", 110);
  await t.wait(800);
  await t.say(S(3, "補資訊"), "勾這一場的主講，可以複選", { ms: 300 });
  await t.click(`.modal .chip:text-is("CCC")`, 400);
  await t.click(`.modal .chip:text-is("OC")`, 900);
  await t.say(S(3, "補資訊"), "簡介會出現在列表和播放頁", { ms: 300 });
  await t.type(".modal textarea >> nth=0", "週五盤中三次假突破，逐筆檢討進場理由。", 70);
  await t.say(S(3, "章節"), "章節一行一段，時間寫在前面。研究員點了就跳到那一段，搜尋也找得到", { ms: 300 });
  await t.type(".modal textarea >> nth=1", "0:00 開場\n5:20 第一次假突破\n21:45 第二次假突破\n38:10 怎麼避開\n52:00 Q&A", 55);
  await t.wait(600);
  await t.hl(".modal label.field:has(textarea.mono-ish) .hint", 2200); await t.unhl(200);
  await t.say(S(3, "教材"), "講義、表格放在教材附件，研究員在播放頁下載", { ms: 300 });
  await t.fakeTap(".modal button:has-text('新增教材')", 600);
  await page.setInputFiles(".modal input[type=file][multiple]", UP("10-10 盤勢整理.pdf"));
  await page.waitForSelector(".modal .file .name:has-text('盤勢整理')", { timeout: 20000 });
  await t.hl(".modal .file:has-text('盤勢整理')", 1800); await t.unhl(200);
  await t.say(S(3, "發布"), "按「儲存並發布」，研究員馬上看得到", { ms: 300 });
  await t.click(".modal-foot .btn.primary", 600);
  await page.waitForSelector(".modal:has-text('已發布，研究員現在看得到了')");
  await t.say(S(3, "發布"), "要寄信通知研究員就按「寄信通知」，關掉通知的研究員不會收到", { ms: 1200 });
  await t.click(".modal-foot .btn.primary:has-text('寄信通知')", 300);
  await page.waitForSelector(".toast:has-text('已寄給')");
  await t.wait(2200);
  await t.say(S(3, "發布"), "之後要改內容、補章節、再寄一次通知，都在每一列的「編輯」", { ms: 300 });
  await t.hl("#videoTableBox tbody tr >> nth=0", 3600); await t.unhl();

  // 4 教學課程
  await t.scrollTop();
  await t.say(S(4, "教學課程"), "最上面的格子是教學課程：CCC、X、OC 各 6 份，看得出哪幾份上架了", { ms: 300 });
  await t.hl(".course-grid-card", 3600); await t.unhl(200);
  await t.say(S(4, "教學課程"), "上傳方式一樣，在「編輯」把類型選「教學課程」，再選主講和第幾份", { ms: 300 });
  await t.click(".course-grid-row:has-text('CCC') .cg-cell.on >> nth=0", 900);
  await t.hl(".modal .course-fields", 300);
  await t.say(S(4, "教學課程"), "研究員從加入那天起每週解鎖一份，三人輪流、每 4 週休息一週；課程不寄全體通知");
  await t.unhl(200);
  await t.click(".modal-foot .btn:has-text('取消')", 600);

  // 5 實驗室密碼
  await t.scrollTop();
  await t.say(S(5, "實驗室密碼"), "新研究員要用實驗室密碼加入", { ms: 300 });
  await t.click(".nav a[data-view=invites]", 900);
  await t.say(S(5, "實驗室密碼"), "設定可以用幾次、寫個備註，按「產生實驗室密碼」", { ms: 300 });
  await t.type("#invNote", "10 月新研究員", 110);
  await t.click("#invCreate", 900);
  await page.waitForSelector(".new-code");
  await t.hl(".new-code", 300);
  await t.say(S(5, "實驗室密碼"), "把這個加入連結傳給新研究員，他打開就能註冊，密碼已經幫他填好");
  await t.unhl();

  // 6 交易量
  await t.scrollTop();
  await t.say(S(6, "交易量"), "每個月在「交易量」填研究員的成交金額", { ms: 300 });
  await t.click(".nav a[data-view=volumes]", 1000);
  await page.waitForSelector(".vol-table");
  await t.say(S(6, "交易量"), "OKX、Bybit、UM 任選一間，當月達 330 萬 USDT 就算達標，從達標那天起可以看一個月", { ms: 300 });
  await t.hl("#volSub", 3200); await t.unhl(200);
  await t.say(S(6, "交易量"), "「達標日」預設今天；隔幾天才補登的話，改成實際達標那天", { ms: 300 });
  await t.hl(".vol-qual", 3000); await t.unhl(200);
  const row = "#volBox tr:has-text('member@example.com')";
  await t.say(S(6, "交易量"), "可以打 3500000、3,500,000、350萬 或 3.5m，馬上顯示達標或還差多少", { ms: 300 });
  await t.type(`${row} input[aria-label$='UM 交易量']`, "350萬", 160);
  await t.wait(500);
  await t.hl(`${row} .vol-result`, 2400); await t.unhl(200);
  await t.say(S(6, "交易量"), "很多人要填的話，按「貼上一整批」，從試算表複製貼上", { ms: 300 });
  await t.click("#volPaste", 700);
  await t.type(".modal textarea", "alex.t@example.com Bybit 3,400,000\nkevin.l@example.com OKX 120萬", 45);
  await t.wait(600);
  await t.click(".modal-foot .btn.primary", 900);
  await t.say(S(6, "交易量"), "檢查一下，按「儲存」。新達標的人資格自動延長一個月", { ms: 300 });
  await t.click(".vol-foot .btn.primary", 600);
  await page.waitForSelector(".toast:has-text('已儲存')");
  await t.wait(2600);

  // 7 研究員與統計
  await t.scrollTop();
  await t.say(S(7, "研究員"), "「研究員」可以看每個人的資格到期日、停權、重設密碼", { ms: 300 });
  await t.click(".nav a[data-view=members]", 1000);
  await page.waitForSelector("#memberTableBox table");
  await t.wait(1200);
  await t.say(S(7, "研究員"), "要手動調整資格，按「資格」，有這個月底、下個月底、不限可以選", { ms: 300 });
  await t.click("#memberTableBox tbody tr:has-text('jay.h@example.com') .btn:has-text('資格')", 2800);
  await t.click(".modal-foot .btn:has-text('取消')", 600);
  await t.scrollTop();
  await t.say(S(7, "觀看統計"), "「觀看統計」看每一場有幾個人看、平均看完幾成", { ms: 300 });
  await t.click(".nav a[data-view=stats]", 1000);
  await page.waitForSelector("#statsBox table");
  await t.wait(3000);
  await t.quiet(300);

  if (mobile) {
    await t.say(S(7, "使用教學"), "這支影片在研究員頁面右上角選單「管理員使用教學」隨時可以再看");
  } else {
    await t.say(S(7, "使用教學"), "這支影片在後台左下角「使用教學」隨時可以再看", { ms: 300 });
    await t.hl("#tutorialLink", 2600); await t.unhl();
  }
  await t.quiet(300);
  await t.card("上傳一場，五分鐘搞定", "有問題找 CCC", 3800);
  await t.finish(`out/管理員使用教學-${mobile ? "手機直式" : "電腦橫式"}.mp4`);
})().catch((e) => { console.error(e); process.exit(1); });
