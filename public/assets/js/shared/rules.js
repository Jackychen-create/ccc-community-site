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
// 合作交易所，任一間當月成交金額（USDT）達到門檻就算達標
// BingX 由網站每天自動抓（研究員綁定 UID 後），其他三間由管理員填
export const EXCHANGES = ["OKX", "Bybit", "UM", "BingX"];
export const AUTO_EXCHANGES = ["BingX"];
export const DEFAULT_THRESHOLD = 3300000;
export function isQualified(amounts, threshold) {
  return EXCHANGES.some((ex) => Number(amounts?.[ex] || 0) >= threshold);
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
