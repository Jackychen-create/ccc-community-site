// BingX 代理商 API（唯讀）：確認 UID 是不是用我們的邀請碼註冊、抓被邀請人每天的交易量
// 文件：https://github.com/bingx-api/api-ai-skills（skills/agent、skills/references/authentication.md）
// 簽名：所有參數（含 timestamp）依 key 的 ASCII 排序組成 key=value&...，不做 URL 編碼，
//       用 Secret 做 HMAC-SHA256、轉小寫 hex，加在最後面 &signature=...；Header 帶 X-BX-APIKEY
import { env } from "./env.js";

const BASES = ["https://open-api.bingx.com", "https://open-api.bingx.pro"]; // 第二個只在連不上第一個時用

export const bingxConfigured = () => !!(env.BINGX_API_KEY && env.BINGX_SECRET_KEY);

// 參數值不能有 & = ? # 換行，避免被塞進其他參數
function validateParams(params) {
  for (const [k, v] of Object.entries(params)) {
    if (/[&=?#\r\n]/.test(String(v))) throw new Error(`參數 ${k} 含有不允許的字元`);
  }
}

export function buildCanonical(params) {
  return Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
}

export async function hmacHex(secret, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 很長的整數（例如 UID、訂單編號）先轉成字串再解析，避免 JSON.parse 失去精度
export function parseSafe(text) {
  return JSON.parse(text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
}

export class BingxError extends Error {
  constructor(code, msg) {
    super(`BingX ${code}: ${msg}`);
    this.code = code;
  }
}

// 送一個簽好名的 GET；回傳 data。連不上主網址才換備用網址
export async function bingxGet(path, params = {}) {
  if (!bingxConfigured()) throw new BingxError("not_configured", "還沒設定 BingX API Key");
  const all = { ...params, recvWindow: 5000, timestamp: Date.now() };
  validateParams(all);
  const canonical = buildCanonical(all);
  const signature = await hmacHex(env.BINGX_SECRET_KEY, canonical);
  const bases = env.BINGX_BASE_URL ? [env.BINGX_BASE_URL] : BASES;
  let lastErr;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}?${canonical}&signature=${signature}`, {
        headers: { "X-BX-APIKEY": env.BINGX_API_KEY },
        signal: AbortSignal.timeout(10000),
      });
      const json = parseSafe(await res.text());
      if (json.code !== 0) throw new BingxError(json.code, json.msg || "未知錯誤");
      return json.data;
    } catch (e) {
      lastErr = e;
      const network = e instanceof TypeError || e?.name === "AbortError" || e?.name === "TimeoutError";
      if (!network) throw e;
    }
  }
  throw lastErr;
}

// 這個 UID 跟我們的代理商帳號有沒有邀請關係
export async function checkInvite(uid) {
  const d = await bingxGet("/openApi/agent/v1/account/inviteRelationCheck", { uid });
  return { invited: d?.inviteResult === true, direct: d?.directInvitation === true };
}

// 被邀請人每天的交易量（commissionDataList，一次最多 30 天，每頁最多 100 筆）
// start、end：YYYYMMDD；uid 給了就只查那個人
export async function fetchDaily(start, end, uid) {
  const out = [];
  for (let page = 1; page <= 200; page++) {
    const params = { startTime: start, endTime: end, pageIndex: page, pageSize: 100 };
    if (uid) params.uid = uid;
    const d = await bingxGet("/openApi/agent/v2/reward/commissionDataList", params);
    const list = d?.list || [];
    out.push(...list);
    if (list.length < 100 || out.length >= Number(d?.total || 0)) break;
  }
  return out;
}

// 一個月切成兩段（每段不超過 30 天），而且不查未來的日子
export function monthRanges(month, today) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ymd = (d) => `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  const todayYmd = today.replaceAll("-", "");
  const ranges = [[1, Math.min(15, last)], [16, last]]
    .map(([a, b]) => [ymd(a), ymd(b)])
    .filter(([a]) => a <= todayYmd)
    .map(([a, b]) => [a, b < todayYmd ? b : todayYmd]);
  return ranges;
}

// 依 UID 加總當月交易量，並找出「累計第一次跨過門檻」的那一天
// list：commissionDataList 的資料；dayOf：commissionTime（毫秒）→ YYYY-MM-DD
export function summarize(list, threshold, dayOf) {
  const byUid = new Map();
  for (const r of list) {
    const uid = String(r.uid);
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid).push({ day: dayOf(Number(r.commissionTime)), vol: Number(r.tradingVolume) || 0 });
  }
  const out = new Map();
  for (const [uid, rows] of byUid) {
    rows.sort((a, b) => a.day.localeCompare(b.day));
    let total = 0;
    let qualifiedOn = null;
    for (const r of rows) {
      total += r.vol;
      if (!qualifiedOn && total >= threshold) qualifiedOn = r.day;
    }
    out.set(uid, { total: Math.round(total * 100) / 100, qualifiedOn });
  }
  return out;
}
