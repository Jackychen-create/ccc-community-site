// OKX 聯盟（推薦人）API：確認某個 UID 是不是用 CCC 的連結註冊的、抓他的交易量
// 金鑰（OKX 推薦帳號開的唯讀 API）：OKX_API_KEY、OKX_SECRET_KEY、OKX_PASSPHRASE（Cloudflare 的「變數和密碼」）
// 簽名：base64(HMAC-SHA256(secret, 時間 + "GET" + 路徑含查詢))；OKX 也擋部分地區，預設經 Supabase 東京的 okx-proxy 送出
import { env } from "./env.js";

export class OkxError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const okxConfigured = () => !!(env.OKX_API_KEY && env.OKX_SECRET_KEY && env.OKX_PASSPHRASE);
const BASES = ["https://www.okx.com", "https://my.okx.com"];
const PROXY_REGION = "ap-northeast-1";

export async function okxSign(secret, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}
const queryOf = (params) => Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");

export function okxProxyUrl() {
  if (env.OKX_PROXY === "off") return null;
  if (env.OKX_BASE_URL || !env.SUPABASE_URL) return null; // 測試用假的 OKX 時不轉送
  return `${String(env.SUPABASE_URL).replace(/\/$/, "")}/functions/v1/okx-proxy`;
}
async function send(base, path, query, headers) {
  const proxy = okxProxyUrl();
  if (proxy) {
    try {
      const res = await fetch(proxy, { method: "POST", headers: { "Content-Type": "application/json", "x-region": PROXY_REGION }, body: JSON.stringify({ base, path, query, headers }), signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const r = await res.json();
        if (typeof r?.status === "number") return { status: r.status, text: r.body, via: "proxy" };
      }
      console.error("okx proxy failed", res.status);
    } catch (e) {
      console.error("okx proxy failed", e?.message);
    }
  }
  const res = await fetch(`${base}${path}${query ? "?" + query : ""}`, { headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, text: await res.text(), via: "direct" };
}

// 簽好名的 GET；回傳 data（陣列）
export async function okxGet(path, params = {}) {
  if (!okxConfigured()) throw new OkxError("not_configured", "還沒設定 OKX API Key");
  const query = queryOf(params);
  const bases = env.OKX_BASE_URL ? [env.OKX_BASE_URL] : BASES;
  let lastErr;
  for (const base of bases) {
    try {
      const ts = new Date().toISOString();
      const sign = await okxSign(env.OKX_SECRET_KEY, `${ts}GET${path}${query ? "?" + query : ""}`);
      const res = await send(base, path, query, { "OK-ACCESS-KEY": env.OKX_API_KEY, "OK-ACCESS-SIGN": sign, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": env.OKX_PASSPHRASE });
      let json;
      try { json = JSON.parse(res.text); } catch { throw new OkxError(`http_${res.status}`, `OKX 回應看不懂（HTTP ${res.status}）`); }
      if (String(json.code) !== "0") throw new OkxError(String(json.code), json.msg || `OKX 錯誤 ${json.code}`);
      return json.data || [];
    } catch (e) {
      lastErr = e;
      const network = e instanceof TypeError || e?.name === "AbortError" || e?.name === "TimeoutError";
      if (!network) throw e;
    }
  }
  throw lastErr;
}

// 推薦的人（invitee）的資料；不是 CCC 推薦的會回錯誤
export async function okxInvitee(uid) {
  const [d] = await okxGet("/api/v5/affiliate/invitee/detail", { uid: String(uid) });
  return d || null;
}

// 測試用（排程跑一次，結果記在 bot_state 的 okx_probe）：確認連得到、看 OKX 實際回哪些欄位
export async function okxProbe(uid) {
  const out = { at: new Date().toISOString(), configured: okxConfigured() };
  // 名字像 OKX 的環境變數（只有名字和有沒有值，不記內容）
  out.names = (env.__names || []).filter((k) => /okx|pass/i.test(k)).map((k) => ({ name: JSON.stringify(k), filled: !!env[k] || undefined }));
  out.has = { key: !!env.OKX_API_KEY, secret: !!env.OKX_SECRET_KEY, pass: !!env.OKX_PASSPHRASE };
  if (!out.configured) return out;
  try {
    const d = await okxInvitee(uid);
    out.ok = true;
    out.fields = d ? Object.keys(d) : [];
    out.sample = d ? Object.fromEntries(Object.entries(d).filter(([k]) => !/addr|email|phone|name/i.test(k))) : null;
  } catch (e) {
    out.ok = false;
    out.code = e?.code ?? null;
    out.error = String(e?.message || e).slice(0, 300);
  }
  return out;
}

// OKX 的錯誤碼 50xxx 是 API Key、簽名、限流、系統忙這類「設定或暫時」的問題：丟出去，讓管理員人工確認
const SETUP_ERROR = (code) => /^50\d{3}$/.test(String(code)) || code === "not_configured" || /^http_/.test(String(code));

// CCC 的 OKX 邀請碼（後台 Discord 設定的 OKX 邀請連結 …/join/99357363）；拿不到就不比對
export function okxInviteCode(link) {
  const m = String(link || "").match(/\/join\/([A-Za-z0-9]+)/);
  return m ? m[1] : "";
}

// 這個 UID 是不是用 CCC 的 OKX 連結註冊的（推薦帳號底下的人、而且邀請碼是 CCC 那一組）
export async function checkOkxClient(uid, { code = "" } = {}) {
  try {
    const d = await okxInvitee(uid);
    if (!d) return { invited: false };
    if (code && d.affiliateCode && String(d.affiliateCode) !== String(code)) return { invited: false, otherCode: true };
    return { invited: true, direct: true, totalVol: Number(d.totalVol) || 0, joinTime: Number(d.joinTime) || null, firstTrade: Number(d.firstTradeTime) || null };
  } catch (e) {
    if (e instanceof OkxError && !SETUP_ERROR(e.code)) return { invited: false, code: e.code };
    throw e;
  }
}
