// 格式化：時間長度、檔案大小、日期
export function fmtDur(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s2 = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s2}` : `${m}:${s2}`;
}
export function fmtLeft(sec) {
  const m = Math.round(sec / 60);
  if (m < 1) return "不到 1 分鐘";
  if (m < 60) return `剩 ${m} 分鐘`;
  const h = Math.floor(m / 60);
  return `剩 ${h} 小時${m % 60 ? ` ${m % 60} 分` : ""}`;
}
export function fmtBytes(n) {
  n = Number(n) || 0;
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + " GB";
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}
export function fmtDate(v) {
  if (!v) return "";
  return String(v).slice(0, 10);
}
export function fmtRel(iso) {
  if (!iso) return "從未";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "剛剛";
  if (d < 3600) return `${Math.floor(d / 60)} 分鐘前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 小時前`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} 天前`;
  return fmtDate(iso);
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
