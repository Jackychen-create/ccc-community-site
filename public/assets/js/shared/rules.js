// 規則：前台、後台、伺服器、測試用的假伺服器都讀這一份，改一次就全部一致。
// 規則改了要一起更新 docs/功能說明.md 和 PRODUCT.md。

// ── 日期（YYYY-MM-DD）──
export function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 從這天起一個月（含當天），例如 10/15 → 11/14；1/31 → 2/27（2 月沒有 31 號就用月底）
export function cycleEnd(date) {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const next = new Date(Date.UTC(y, m, Math.min(d, last)));
  return addDays(next.toISOString().slice(0, 10), -1);
}

// ── 每人的一輪（2026-10-17 起）──
// 從加入那天起算，每一輪剛好一個月：10/16 加入 → 第一輪 10/16～11/15、第二輪 11/16～12/15…
// 這一輪內交易量達標 → 可以看到「下一輪」結束；沒達標，下一輪第一天就不能看
// 1/31 加入：1/31～2/27、2/28～3/30、3/31～4/29…（沒有 31 號的月份用月底，之後回到 31 號）
export function addMonths(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
// anchor（加入那天）＋某一天 → 那天所在的一輪 { index, start, end }（加入之前的日子算第一輪）
export function periodOf(anchor, date) {
  const [ay, am] = anchor.split("-").map(Number);
  const [y, m] = date.split("-").map(Number);
  let k = Math.max(0, (y - ay) * 12 + (m - am));
  while (k > 0 && addMonths(anchor, k) > date) k--;
  return { index: k, start: addMonths(anchor, k), end: addDays(addMonths(anchor, k + 1), -1) };
}
// 下一輪
export const nextPeriod = (anchor, period) => periodOf(anchor, addDays(period.end, 1));
// 上一輪（第一輪就沒有上一輪，回傳 null）
export const prevPeriod = (anchor, period) => (period.index > 0 ? periodOf(anchor, addDays(period.start, -1)) : null);

// ── 交易量 ──
// 合作交易所，任一間當月交易量達標就算達標
// OKX、UM 由管理員填；Bybit、BingX 由網站每天自動抓（研究員綁定 UID 後）
// UM（Ultima Markets，MT5）用「手」算，門檻固定在 LOT_GOALS；其他用 USDT 成交金額，門檻在後台可以改（settings.volume_threshold）
export const EXCHANGES = ["OKX", "UM", "Bybit", "BingX"];
export const AUTO_EXCHANGES = ["Bybit", "BingX"];
export const LOT_GOALS = { UM: 10 }; // 一個月 10 手（2026-10-16 確定）
export const DEFAULT_THRESHOLD = 1000000;
// 交易所帳號：OKX、Bybit、BingX 填 UID；UM 填 MT5 帳號（一樣是一串數字），另外填在 UM 開戶的英文姓名，
// 跟 UM 代理後台「近期新開戶」的帳號、姓名對得起來（2026-10-17）
export const idLabel = (ex) => (ex === "UM" ? "MT5 帳號" : "UID");
export const cleanExId = (ex, v) => String(v ?? "").normalize("NFKC").replace(/\s/g, "");
export const exIdOk = (ex, v) => /^\d{5,20}$/.test(v);
export const exIdError = (ex) => (ex === "UM" ? "MT5 帳號是一串數字，請再確認一次" : "UID 是一串數字，請再確認一次");
export const NEEDS_NAME = ["UM"];
export const needsName = (ex) => NEEDS_NAME.includes(ex);
// 姓名：去掉前後空白、多個空白變一個，英文轉大寫（UM 後台大小寫不一，比對比較準）
export const cleanAccountName = (v) => String(v ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
export const accountNameOk = (v) => /^[^\r\n`<>@]{2,60}$/u.test(v);
export const ACCOUNT_NAME_ERROR = "請填你在 UM 開戶的英文姓名（跟護照一樣，例如 WANG XIAO MING）";
// Bybit 的 TradFi（黃金、股票等）交易量打一折算：100 萬 TradFi ≈ 10 萬加密貨幣（2026-10-17 確定）
export const TRADFI_WEIGHT = 0.1;
export const TRADFI_NOTE = "Bybit 的 TradFi（黃金、股票等）交易量以十分之一計算。";
export const unitOf = (ex) => (ex in LOT_GOALS ? "手" : "USDT");
export const goalOf = (ex, threshold) => LOT_GOALS[ex] ?? threshold;
// 達標進度：各交易所「交易量 ÷ 門檻」最高的那間，回傳 { ex, n, goal, ratio }
export function bestProgress(amounts, threshold, exchanges = EXCHANGES) {
  let best = { ex: exchanges[0], n: 0, goal: goalOf(exchanges[0], threshold), ratio: 0 };
  for (const ex of exchanges) {
    const n = Number(amounts?.[ex] || 0);
    const goal = goalOf(ex, threshold);
    if (n / goal > best.ratio) best = { ex, n, goal, ratio: n / goal };
  }
  return best;
}
export function isQualified(amounts, threshold) {
  return EXCHANGES.some((ex) => Number(amounts?.[ex] || 0) >= goalOf(ex, threshold));
}
// 顯示用：UM「3.5 手」；USDT「120 萬」（不到 1 萬就直接寫數字）
export function fmtAmount(ex, n) {
  n = Number(n) || 0;
  if (ex in LOT_GOALS) return `${Math.round(n * 100) / 100} 手`;
  return n >= 1e4 ? `${Math.round((n / 1e4) * 10) / 10} 萬` : n.toLocaleString("en-US");
}
// 「還差 40 萬」；最接近的是 UM 的話寫「UM 還差 3 手」
export function gapText(amounts, threshold, exchanges = EXCHANGES) {
  const b = bestProgress(amounts, threshold, exchanges);
  return `${b.ex in LOT_GOALS ? b.ex + " " : ""}還差 ${fmtAmount(b.ex, Math.max(0, b.goal - b.n))}`;
}
// 「OKX、Bybit、BingX 任一間這一輪成交金額達 100 萬 USDT，或 UM 達 10 手」
export function ruleText(threshold, exchanges = EXCHANGES) {
  const usdt = exchanges.filter((ex) => !(ex in LOT_GOALS));
  const lots = exchanges.filter((ex) => ex in LOT_GOALS);
  const parts = [];
  if (usdt.length) parts.push(`${usdt.join("、")} ${usdt.length > 1 ? "任一間" : ""}這一輪成交金額達 ${fmtAmount("", threshold)} USDT`.replace("  ", " "));
  for (const ex of lots) parts.push(`${ex} 這一輪達 ${LOT_GOALS[ex]} 手`);
  return parts.join("，或 ");
}

// ── 教學課程 ──
// CCC、OC、X 的教學影片各 6 份，共 18 份。每位研究員從加入那天起：
// 每 4 週為一輪，前 3 週依序解鎖 CCC、OC、X 各一份，第 4 週休息。
export const COURSE_HOSTS = ["CCC", "OC", "X"]; // 解鎖順序
export const COURSE_PARTS = 6;
export const COURSE_CYCLE_WEEKS = 4;
export function courseWeek(host, part) {
  return (part - 1) * COURSE_CYCLE_WEEKS + COURSE_HOSTS.indexOf(host); // 從 0 起算：第 0 週＝加入當天
}
export function courseUnlockDate(startDate, host, part) {
  return addDays(startDate, courseWeek(host, part) * 7);
}

// ── 觀看分段：每 30 秒一格（後台「觀看曲線」用）──
export const BUCKET_SEC = 30;
