// 呼叫 /api：自動帶登入 token；伺服器出錯、連線失敗、程式錯誤自動回報到後台「網站狀況」
import { sb } from "./config.js";

async function token() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}

// API 呼叫：自動帶登入 token，錯誤丟出含 status 的 Error
export async function api(path, { method = "GET", body, keepalive = false } = {}) {
  const headers = {};
  const t = await token();
  if (t) headers.Authorization = "Bearer " + t;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  const send = () => fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), keepalive });
  try {
    try {
      res = await send();
    } catch (err) {
      // 手機網路一時斷掉（切換 Wi-Fi／4G、剛從背景回來）：讀取的請求等一下再試一次
      if (method !== "GET") throw err;
      await new Promise((r) => setTimeout(r, 1000));
      res = await send();
    }
  } catch {
    if (!path.startsWith("/api/report") && navigator.onLine !== false) report("api", `${method} ${path.split("?")[0]} → 連線失敗`, {});
    const e = new Error("連線失敗，請檢查網路");
    e.status = 0;
    throw e;
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  // 伺服器出錯（500 以上）自動記到後台「網站狀況」
  if (res.status >= 500 && !path.startsWith("/api/report")) report("api", `${method} ${path.split("?")[0]} → ${res.status}`, { error: data.error || "" });
  if (!res.ok) {
    const e = new Error(data.error || "發生錯誤，請稍後再試");
    e.status = res.status;
    e.code = data.code;
    e.data = data;
    throw e;
  }
  return data;
}

// ── 自動回報問題到後台「網站狀況」（同一個問題一次瀏覽只回報一次）──
const reported = new Set();
export function report(kind, message, context = {}) {
  const key = kind + "|" + message;
  if (reported.has(key) || reported.size > 30) return;
  reported.add(key);
  setTimeout(() => {
    api("/api/report", { method: "POST", body: { kind, message: String(message).slice(0, 300), context: { ...context, path: location.pathname + location.hash.split("?")[0], ua: navigator.userAgent.slice(0, 120) } }, keepalive: true }).catch(() => {});
  }, 0);
}
// 網站剛更新時，瀏覽器（特別是 iPhone Safari）可能拿到舊的頁面配新的程式，一打開就找不到畫面上的東西。
// 開頁 20 秒內出現這種錯誤，就重新整理一次拿新版（10 分鐘內最多一次，真的是程式錯誤也不會一直重來）
const STALE_RE = /null is not an object|Cannot (read|set) properties of null|undefined is not an object/;
export function reloadOnceForStale() {
  try {
    const last = Number(sessionStorage.getItem("staleReload")) || 0;
    if (Date.now() - last < 10 * 60e3) return false;
    sessionStorage.setItem("staleReload", String(Date.now()));
  } catch { return false; }
  setTimeout(() => location.reload(), 300);
  return true;
}
function reloadOnceIfStale(message) {
  if (performance.now() > 20000 || !STALE_RE.test(message)) return;
  reloadOnceForStale();
}
window.addEventListener("error", (e) => {
  if (!e.message || /ResizeObserver/.test(e.message)) return;
  report("js", e.message, { src: String(e.filename || "").split("/").pop(), line: e.lineno || 0, early: performance.now() < 20000 });
  reloadOnceIfStale(e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  const m = e.reason?.message || String(e.reason || "");
  if (!m || e.reason?.status) return; // api() 的錯誤畫面上已經處理了
  report("js", m, {});
});
