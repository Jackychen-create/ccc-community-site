// 前台用的日期、數字、觀看進度判斷
export const DAY = 86400000;

// "2026-10-15" → "10/15"
export const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
// 1000000 → "100 萬"
export const fmtWan = (n) => (n >= 1e4 ? `${Math.round((n / 1e4) * 10) / 10} 萬` : (Number(n) || 0).toLocaleString("en-US"));

export function shortDate(d) {
  const s = String(d).slice(0, 10);
  return `${Number(s.slice(5, 7))}/${s.slice(8, 10)}`;
}
const WD = "日一二三四五六";
export function weekday(d) {
  const s = String(d).slice(0, 10);
  const t = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return "週" + WD[t.getDay()];
}
export function monthKey(v) {
  return String(v.published_at).slice(0, 7);
}
export function monthLabel(k) {
  const [y, m] = k.split("-");
  return Number(y) === new Date().getFullYear() ? `${Number(m)} 月` : `${y} 年 ${Number(m)} 月`;
}

// 觀看進度
export function pctOf(v) {
  const d = v.duration_sec;
  return d ? Math.min(1, (v.position_sec || 0) / d) : 0;
}
export const isWatched = (v) => pctOf(v) >= 0.95;
export const isInProgress = (v) => (v.position_sec || 0) >= 15 && !isWatched(v);
export const isNew = (v) => !v.position_sec && Date.now() - new Date(v.published_at).getTime() < 7 * DAY;
