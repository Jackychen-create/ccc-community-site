// 日期：伺服器在 UTC，這裡一律換成台灣日期（YYYY-MM-DD）
export { addDays, cycleEnd } from "../../public/assets/js/shared/rules.js";

// 台灣日期 YYYY-MM-DD（伺服器在 UTC，直接用會差 8 小時）
export function todayTW() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 時間戳記 → 台灣日期
export function twDate(ts) {
  return new Date(new Date(ts).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function thisMonthTW() {
  return todayTW().slice(0, 7);
}
// "2026-10" → "2026-10-31"
export function monthEnd(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export function isMonth(v) {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}
