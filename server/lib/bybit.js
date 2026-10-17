// Bybit 聯盟（代理商）API（唯讀）：確認 UID 是不是我們邀請的直屬客戶、抓被邀請人一段期間的交易量
// 文件：https://bybit-exchange.github.io/docs/zh-TW/v5/affiliate/affiliate-info
//       https://bybit-exchange.github.io/docs/zh-TW/v5/affiliate/affiliate-user-list
// 簽名：HMAC-SHA256(Secret, timestamp + apiKey + recvWindow + queryString)，小寫 hex
//       Header：X-BAPI-API-KEY、X-BAPI-TIMESTAMP、X-BAPI-RECV-WINDOW、X-BAPI-SIGN
// 注意：美國、中國大陸的 IP 會被 Bybit 擋（403），所以每天的排程從東京發出（見 supabase/schema.sql v1.9）
import { env } from "./env.js";
import { hmacHex } from "./bingx.js";
import { TRADFI_WEIGHT } from "../../public/assets/js/shared/rules.js";

const BASES = ["https://api.bybit.com", "https://api.bytick.com"]; // 第二個只在連不上第一個時用
const RECV_WINDOW = 5000;

// 這些錯誤代表我們這邊的設定有問題（Key、簽名、權限、IP、限流、Bybit 系統），不是「不是我們的客戶」
export const BYBIT_SETUP_ERRORS = new Set([10002, 10003, 10004, 10005, 10006, 10007, 10009, 10010, 10016, 10017, 10018]);

export const bybitConfigured = () => !!(env.BYBIT_API_KEY && env.BYBIT_SECRET_KEY);

export class BybitError extends Error {
  constructor(code, msg) {
    super(`Bybit ${code}: ${msg}`);
    this.code = code;
  }
}

export function bybitQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export async function bybitSign(secret, timestamp, apiKey, query) {
  return hmacHex(secret, `${timestamp}${apiKey}${RECV_WINDOW}${query}`);
}

// Bybit 擋美國 IP；Discord 的請求常從美國的 Cloudflare 進來，所以預設改從東京送出：
// 這裡簽好名，交給 Supabase 的 bybit-proxy（Edge Function，用 x-region 固定在東京）轉送，轉送那邊不放金鑰
// 轉送本身壞了（不是 Bybit 回的錯）才改成直接連；BYBIT_PROXY=off 可以關掉
const PROXY_REGION = "ap-northeast-1";
export function bybitProxyUrl() {
  if (env.BYBIT_PROXY === "off") return null;
  if (env.BYBIT_PROXY_URL) return env.BYBIT_PROXY_URL;
  if (env.BYBIT_BASE_URL || !env.SUPABASE_URL) return null; // 測試用假的 Bybit 時不轉送
  return `${String(env.SUPABASE_URL).replace(/\/$/, "")}/functions/v1/bybit-proxy`;
}

// 送出去，回傳 { status, text }
async function send(base, path, query, headers) {
  const proxy = bybitProxyUrl();
  if (proxy) {
    try {
      const res = await fetch(proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-region": PROXY_REGION },
        body: JSON.stringify({ base, path, query, headers }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const r = await res.json();
        if (typeof r?.status === "number") return { status: r.status, text: r.body };
      }
      console.error("bybit proxy failed", res.status);
    } catch (e) {
      console.error("bybit proxy failed", e?.message);
    }
  }
  const res = await fetch(`${base}${path}${query ? "?" + query : ""}`, { headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, text: await res.text() };
}

// 送一個簽好名的 GET；回傳 result。連不上主網址才換備用網址
export async function bybitGet(path, params = {}) {
  if (!bybitConfigured()) throw new BybitError("not_configured", "還沒設定 Bybit API Key");
  const query = bybitQuery(params);
  const bases = env.BYBIT_BASE_URL ? [env.BYBIT_BASE_URL] : BASES;
  let lastErr;
  for (const base of bases) {
    try {
      const ts = String(Date.now());
      const sign = await bybitSign(env.BYBIT_SECRET_KEY, ts, env.BYBIT_API_KEY, query);
      const res = await send(base, path, query, {
        "X-BAPI-API-KEY": env.BYBIT_API_KEY,
        "X-BAPI-TIMESTAMP": ts,
        "X-BAPI-RECV-WINDOW": String(RECV_WINDOW),
        "X-BAPI-SIGN": sign,
      });
      if (res.status === 403) throw new BybitError("blocked", "Bybit 擋下了這個地區的連線（美國、中國大陸的 IP 不能用）");
      const json = JSON.parse(res.text);
      if (json.retCode !== 0) throw new BybitError(json.retCode, json.retMsg || "未知錯誤");
      return json.result;
    } catch (e) {
      lastErr = e;
      const network = e instanceof TypeError || e?.name === "AbortError" || e?.name === "TimeoutError";
      if (!network) throw e;
    }
  }
  throw lastErr;
}

// 這個 UID 是不是我們的直屬客戶（只支援主帳號 UID）
// 查得到就是；Bybit 回「不是你的客戶」這類錯誤就不是；Key、簽名、權限等設定問題會丟出錯誤
export async function checkBybitClient(uid) {
  try {
    const r = await bybitGet("/v5/user/aff-customer-info", { uid });
    return { invited: !!r && String(r.uid ?? uid) === String(uid), direct: true };
  } catch (e) {
    if (e instanceof BybitError && typeof e.code === "number" && !BYBIT_SETUP_ERRORS.has(e.code)) return { invited: false, direct: false, code: e.code };
    throw e;
  }
}

// 所有被邀請人在 startDate～endDate（YYYY-MM-DD，含頭尾）的交易量（USDT）
// tradeVol 是合約＋選擇權＋現貨；TradFi（黃金、股票等）另外放在 tradfiTradeVol，照規則打折後加進來（TRADFI_WEIGHT 在 rules.js）
// Bybit 的交易量是隔天（T+1）才更新，所以 endDate 最多到昨天
export async function fetchBybitVolumes(startDate, endDate) {
  const out = new Map();
  let cursor = "";
  for (let page = 0; page < 200; page++) {
    const r = await bybitGet("/v5/affiliate/aff-user-list", { size: 100, cursor, startDate, endDate });
    for (const u of r?.list || []) out.set(String(u.userId), (Number(u.tradeVol) || 0) + (Number(u.tradfiTradeVol) || 0) * TRADFI_WEIGHT);
    cursor = r?.nextPageCursor || "";
    if (!cursor || !(r?.list || []).length) break;
  }
  return out;
}

// 一輪要查的區間：這一輪第一天到「這一輪最後一天和昨天比較早的那天」；還沒有資料（例如這一輪今天才開始）就回 null
export function capRange(start, end, today) {
  const t = new Date(today + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - 1);
  const yesterday = t.toISOString().slice(0, 10);
  const to = end < yesterday ? end : yesterday;
  return to < start ? null : [start, to];
}
