// 規則：前台、後台、伺服器、測試用的假伺服器都讀這一份，改一次就全部一致。
// 規則改了要一起更新 docs/功能說明.md 和 PRODUCT.md。

// ── 日期（YYYY-MM-DD）──
export function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 資格一輪：從這天起一個月（含當天），例如 10/15 → 11/14；1/31 → 2/27（2 月沒有 31 號就用月底）
export function cycleEnd(date) {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const next = new Date(Date.UTC(y, m, Math.min(d, last)));
  return addDays(next.toISOString().slice(0, 10), -1);
}

// ── 每月交易量 ──
// 合作交易所，任一間當月交易量達標就算達標
// OKX、UM 由管理員填；Bybit、BingX 由網站每天自動抓（研究員綁定 UID 後）
// UM（Ultima Markets，MT5）用「手」算，門檻固定在 LOT_GOALS；其他用 USDT 成交金額，門檻在後台可以改（settings.volume_threshold）
export const EXCHANGES = ["OKX", "UM", "Bybit", "BingX"];
export const AUTO_EXCHANGES = ["Bybit", "BingX"];
export const LOT_GOALS = { UM: 10 }; // 一個月 10 手（2026-10-16 確定）
export const DEFAULT_THRESHOLD = 1000000;
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
// 「OKX、Bybit、BingX 任一間當月成交金額達 100 萬 USDT，或 UM 達 10 手」
export function ruleText(threshold, exchanges = EXCHANGES) {
  const usdt = exchanges.filter((ex) => !(ex in LOT_GOALS));
  const lots = exchanges.filter((ex) => ex in LOT_GOALS);
  const parts = [];
  if (usdt.length) parts.push(`${usdt.join("、")} ${usdt.length > 1 ? "任一間" : ""}當月成交金額達 ${fmtAmount("", threshold)} USDT`.replace("  ", " "));
  for (const ex of lots) parts.push(`${ex} 當月達 ${LOT_GOALS[ex]} 手`);
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
