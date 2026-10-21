// 機器人清單（後台和 Edge Function 都讀這一份）：名稱、分類、排程、可以調的選項
// 排程用台灣時間：days = "weekdays"（週一到五）、"daily"、或星期幾的陣列（0 = 週日）
//   at：幾點開始跑；until：資料還沒出來就每 5 分鐘再試，試到幾點；every：每幾分鐘跑一次（window 限定時段）
// 排程每 5 分鐘叫一次 Edge Function，它照這裡決定這一輪要跑哪些
export const GROUPS = ["台股", "美股", "加密", "社群"];
export const BOTS = [
  { key: "tw_close", group: "台股", name: "台股盤後報告", desc: "加權、櫃買、成交值、三大法人、強弱族群、熱門股、技術面、CCC 盤後觀點", schedule: { days: "weekdays", at: "15:15", until: "17:30" }, when: "週一到五 15:15（休市日不發）" },
  { key: "tw_news", group: "台股", name: "台股每日頭條", desc: "中央社、Yahoo 股市篩選可能影響台股的新聞（標題、來源、影響理由、原文連結），附上昨晚美股、費半、台積電 ADR 溢價", schedule: { days: "daily", at: "08:00", until: "09:00" }, when: "每天 08:00", opts: [{ k: "max", label: "最多幾則", def: 8 }, { k: "overnight", label: "附昨晚美股（on／off）", def: "on" }] },
  { key: "tw_disclosure", group: "台股", name: "台股重大訊息雷達", desc: "上市櫃重大訊息：全市場高影響事件，自選股門檻較低", schedule: { days: "daily", every: 10, window: ["07:00", "23:00"] }, when: "每 10 分鐘（07:00–23:00）", opts: [{ k: "watch", label: "自選股（代號，逗號分開）", def: "2330,2317,2454,2308,2382,2303,3711,2891" }, { k: "minScore", label: "全市場門檻", def: 6 }, { k: "watchMinScore", label: "自選股門檻", def: 2 }] },
  { key: "tw_flow", group: "台股", name: "法人籌碼雷達", desc: "上市櫃外資、投信買賣超排行、同步買進、連買連賣、自選股籌碼", schedule: { days: "weekdays", at: "16:30", until: "19:00" }, when: "週一到五 16:30（休市日不發）", opts: [{ k: "watch", label: "自選股（代號，逗號分開）", def: "2330,2317,2454,2308,2382,2303,3711,2891" }] },
  { key: "us_news", group: "美股", name: "美股重點新聞", desc: "CNBC、MarketWatch、Fed、SEC 篩選影響美股的新聞，英文標題保留原文", schedule: { days: "daily", at: "19:30", until: "21:00" }, when: "每天 19:30", opts: [{ k: "max", label: "最多幾則", def: 8 }] },
  { key: "us_week", group: "美股", name: "美股下週重點事件", desc: "下週一到週日的 CPI、PPI、非農、FOMC、GDP、PCE 等，換算成台灣時間，附官方連結", schedule: { days: [0], at: "20:00", until: "22:00" }, when: "每週日 20:00" },
  { key: "earn_week", group: "美股", name: "財報雷達：下週財報", desc: "自選美股下週預定財報（盤前／盤後、EPS 預估）", schedule: { days: [0], at: "19:30", until: "21:00" }, when: "每週日 19:30", opts: [{ k: "watch", label: "自選美股（代號，逗號分開）", def: "NVDA,AAPL,MSFT,GOOGL,META,AMZN,TSLA,AMD,TSM" }] },
  { key: "earn_filings", group: "美股", name: "財報雷達：SEC 新申報", desc: "自選美股在 SEC 的 10-Q、10-K、8-K、20-F、6-K 正式申報；第一次只記基準，不補發舊的", schedule: { days: "daily", every: 30 }, when: "每 30 分鐘", opts: [{ k: "watch", label: "自選美股（代號，逗號分開）", def: "NVDA,AAPL,MSFT,GOOGL,META,AMZN,TSLA,AMD,TSM" }] },
  { key: "crypto_digest", group: "加密", name: "鏈上行情總覽", desc: "BTC、ETH、SOL 鏈上穩定幣池價格、1／24 小時漲跌、成交量、流動性，加恐慌貪婪指數（DEX Screener，不是交易所報價）", schedule: { days: "daily", at: "21:00", until: "22:00" }, when: "每天 21:00" },
  { key: "crypto_alert", group: "加密", name: "行情異動提醒", desc: "1 小時或 24 小時漲跌第一次跨過門檻才發", schedule: { days: "daily", every: 10 }, when: "每 10 分鐘檢查", opts: [{ k: "th1", label: "1 小時門檻 %", def: 3 }, { k: "th24", label: "24 小時門檻 %", def: 8 }] },
  { key: "okx_news", group: "加密", name: "OKX 官方公告", desc: "上新、下架、交易規則、充提、API、維護；不收活動", schedule: { days: "daily", every: 15 }, when: "每 15 分鐘" },
  { key: "bybit_news", group: "加密", name: "Bybit 官方公告", desc: "繁中公告：上新、下架、維護、平台異動；不收活動抽獎", schedule: { days: "daily", every: 15 }, when: "每 15 分鐘" },
  { key: "daily_question", group: "社群", name: "皮老闆每日一題", desc: "每天一題交易交流題目，60 題輪替；Webhook 取名「皮老闆」、換頭像就是皮老闆發的", schedule: { days: "daily", at: "12:00", until: "13:00" }, when: "每天 12:00" },
];
export const botByKey = (k) => BOTS.find((b) => b.key === k) || null;

const toMin = (hm) => { const [h, m] = String(hm).split(":").map(Number); return h * 60 + m; };
// 這一輪（每 5 分鐘一輪）要不要跑
export function isDue(schedule, hm, weekday, tick = 5) {
  const s = schedule || {};
  const days = s.days === "weekdays" ? [1, 2, 3, 4, 5] : s.days === "daily" || !s.days ? [0, 1, 2, 3, 4, 5, 6] : s.days;
  if (!days.includes(weekday)) return false;
  const now = toMin(hm);
  if (s.every) {
    const [a, b] = s.window || ["00:00", "23:59"];
    if (now < toMin(a) || now > toMin(b)) return false;
    return now % s.every < tick;
  }
  if (!s.at) return false;
  const start = toMin(s.at), end = s.until ? toMin(s.until) : start + tick;
  return now >= start && now < end;
}
