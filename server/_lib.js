// 共用工具：Supabase、R2、登入驗證、權限。
// 跑在 Cloudflare Pages Functions：環境變數由 functions/api/[[path]].js 每次請求時用 setEnv() 帶進來。
import { createClient } from "@supabase/supabase-js";
import { presign } from "./sigv4.js";

export const env = {};
export let supabaseAdmin = null;

export function setEnv(e) {
  if (supabaseAdmin && env.SUPABASE_URL === e.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY === e.SUPABASE_SERVICE_ROLE_KEY) return;
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "ADMIN_EMAILS", "BREVO_API_KEY", "MAIL_FROM", "MAIL_FROM_NAME"]) {
    env[k] = e[k] || "";
  }
  supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── R2 ─────────────────────────────────────────

function r2(o) {
  return presign({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    ...o,
  });
}

// 讀取用的簽名網址（預設 1 小時；過期時播放器會自動換新連結，從原位置繼續）
export function signGet(key, { expiresIn = 60 * 60, downloadName } = {}) {
  const query = downloadName
    ? { "response-content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}` }
    : undefined;
  return r2({ method: "GET", key, expiresIn, query });
}

// 上傳用的簽名網址（後台瀏覽器直傳 R2，不經過伺服器）
// 簽進檔案大小和格式，上傳的檔案必須跟申請時一樣
export function signPut(key, contentType, size, { expiresIn = 2 * 60 * 60 } = {}) {
  return r2({ method: "PUT", key, expiresIn, headers: { "content-type": contentType, "content-length": String(size) } });
}

// 只接受 upload-url 產生的格式，例如 videos/2026/10/0a1b2c3d4e5f-live.mp4
export function isIssuedKey(key, prefix) {
  return (
    typeof key === "string" &&
    !key.includes("..") &&
    new RegExp(`^${prefix}/\\d{4}/\\d{2}/[0-9a-f]{12}-[A-Za-z0-9._-]{1,80}$`).test(key)
  );
}

export async function deleteObject(key) {
  if (!key) return;
  try {
    const url = await r2({ method: "DELETE", key, expiresIn: 60 });
    const r = await fetch(url, { method: "DELETE" });
    if (!r.ok && r.status !== 404) console.error("R2 delete failed", key, r.status);
  } catch (err) {
    console.error("R2 delete failed", key, err?.message);
  }
}

// ── 權限 ────────────────────────────────────────

export function adminEmails() {
  return (env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  return !!email && adminEmails().includes(String(email).trim().toLowerCase());
}

// 管理員：Email 在名單內、Email 已驗證，而且「不是」用實驗室密碼加入的研究員帳號。
// 研究員註冊時 Email 沒有經過收信驗證，所以研究員帳號永遠不能變成管理員，
// 就算之後把同一個 Email 加進 ADMIN_EMAILS 也一樣。
function adminEligible(user) {
  return isAdminEmail(user?.email) && !!user?.email_confirmed_at;
}

async function memberRow(userId) {
  const { data, error } = await supabaseAdmin
    .from("members")
    .select("user_id, banned, access_until, notify, created_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getUser(req) {
  const auth = req.headers?.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// 研究員或管理員才放行；失敗時直接回應錯誤並回傳 null
export async function requireMember(req, res) {
  const user = await getUser(req);
  if (!user) {
    res.status(401).json({ error: "請先登入" });
    return null;
  }
  const member = await memberRow(user.id);
  if (!member && adminEligible(user)) return { user, isAdmin: true };
  if (!member || member.banned) {
    res.status(403).json({ error: "這個帳號目前沒有觀看權限，請聯絡管理員" });
    return null;
  }
  // 每月資格：過了到期日就不能看（到期日當天還可以）
  if (member.access_until && member.access_until < todayTW()) {
    res.status(403).json({ error: `你的觀看資格到 ${member.access_until} 為止，請聯絡管理員更新`, code: "expired" });
    return null;
  }
  return { user, isAdmin: false, member };
}

export async function requireAdmin(req, res) {
  const user = await getUser(req);
  if (!user) {
    res.status(401).json({ error: "請先登入" });
    return null;
  }
  if (!adminEligible(user) || (await memberRow(user.id))) {
    res.status(403).json({ error: "只有管理員可以使用後台" });
    return null;
  }
  return { user };
}

// ── 小工具 ──────────────────────────────────────

// 台灣日期 YYYY-MM-DD（伺服器在 UTC，直接用會差 8 小時）
export function todayTW() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// ── 每月交易量 ──
// 三間合作交易所，任一間當月成交金額（USDT）達到門檻，就有當月觀看資格
export const EXCHANGES = ["OKX", "Bybit", "UM"];
export const DEFAULT_THRESHOLD = 3300000;

// 日期加減天數（YYYY-MM-DD）
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
// 時間戳記 → 台灣日期
export function twDate(ts) {
  return new Date(new Date(ts).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// ── 教學課程 ──
// CCC、X、OC 的教學影片各 6 份，共 18 份。每位研究員從加入那天起：
// 每 4 週為一輪，前 3 週依序解鎖 CCC、X、OC 各一份，第 4 週休息。
export const COURSE_HOSTS = ["CCC", "X", "OC"];
export const COURSE_PARTS = 6;
export const COURSE_CYCLE_WEEKS = 4;
export function courseWeek(host, part) {
  return (part - 1) * COURSE_CYCLE_WEEKS + COURSE_HOSTS.indexOf(host); // 從 0 起算：第 0 週＝加入當天
}
export function courseUnlockDate(startDate, host, part) {
  return addDays(startDate, courseWeek(host, part) * 7);
}
export function isCourse(v) {
  return !!(v && v.course_host);
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
export async function getThreshold() {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", "volume_threshold").maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD;
}
// 只收三間交易所、0 以上的數字，四捨五入到小數 2 位
export function cleanAmounts(v) {
  const out = {};
  for (const ex of EXCHANGES) {
    const n = Number(v?.[ex]);
    if (Number.isFinite(n) && n >= 0 && n <= 1e13) out[ex] = Math.round(n * 100) / 100;
  }
  return out;
}
export function isQualified(amounts, threshold) {
  return EXCHANGES.some((ex) => Number(amounts?.[ex] || 0) >= threshold);
}

// 標題開頭的「10/9 直播：」拿掉（列表已經有日期欄）；拿掉後是空的就保留原樣
export function cleanTitle(v) {
  const t = cleanText(v, 120);
  if (!t) return t;
  const stripped = t.replace(/^\s*\d{1,2}\s*[\/.\-]\s*\d{1,2}\s*(?:(?:直播|live)\s*)?(?:[：:\-–—|｜]\s*|\s+(?=\S))/i, "").trim();
  return stripped && stripped !== t ? stripped : t;
}

// 章節：[{t: 秒, title}]，依時間排序、最多 60 個、同一秒只留一個
export function cleanChapters(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const c of v) {
    const t = Math.floor(Number(c?.t));
    const title = cleanText(c?.title, 60);
    if (!Number.isFinite(t) || t < 0 || t > 24 * 3600 || !title || seen.has(t)) continue;
    seen.add(t);
    out.push({ t, title });
    if (out.length >= 60) break;
  }
  return out.sort((a, b) => a.t - b.t);
}

// 請求內容已在 functions/api/[[path]].js 解析成物件
export function readBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === "string") {
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  }
  return b;
}

export function toInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export function cleanText(v, max = 500) {
  if (v === undefined || v === null) return null;
  return String(v).trim().slice(0, max);
}

export function isDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
}

// 公平的隨機整數（0 到 n-1），用 Web Crypto
function randomInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}
export function randomHex(bytes) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// 產生不易猜的字串，排除容易看錯的 0/O/1/I/L
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function randomCode(groups = 2, size = 4) {
  const out = [];
  for (let g = 0; g < groups; g++) {
    let s = "";
    for (let i = 0; i < size; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    out.push(s);
  }
  return out.join("-");
}

export function randomPassword(len = 12) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[randomInt(chars.length)];
  return s;
}

// 包一層：只接受指定的 method，未預期的錯誤統一回 500
export function route(methods) {
  return async function handler(req, res) {
    const fn = methods[req.method];
    if (!fn) {
      res.setHeader("Allow", Object.keys(methods).join(", "));
      return res.status(405).json({ error: "Method not allowed" });
    }
    res.setHeader("Cache-Control", "no-store");
    try {
      return await fn(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: "系統錯誤，請稍後再試" });
    }
  };
}
