// 環境變數和 Supabase 連線（service role，只在伺服器用）。
// 跑在 Cloudflare Pages Functions：functions/api/[[path]].js 每次請求時用 setEnv() 帶進來。
import { createClient } from "@supabase/supabase-js";

export const env = {};
export let supabaseAdmin = null;

export function setEnv(e) {
  env.AI = e.AI || null; // Cloudflare Workers AI（wrangler.toml 的 [ai] binding），直播精華用
  // 只記「名字」（不記內容），設定金鑰時檢查名字有沒有打錯用
  env.__names = Object.keys(e || {}).filter((k) => typeof e[k] === "string");
  if (supabaseAdmin && env.SUPABASE_URL === e.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY === e.SUPABASE_SERVICE_ROLE_KEY) return;
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "ADMIN_EMAILS", "BREVO_API_KEY", "MAIL_FROM", "MAIL_FROM_NAME", "BINGX_API_KEY", "BINGX_SECRET_KEY", "BINGX_BASE_URL", "BYBIT_API_KEY", "BYBIT_SECRET_KEY", "BYBIT_BASE_URL", "OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE", "OKX_BASE_URL", "OKX_PROXY", "MARKET_URL", "DISCORD_APP_ID", "DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN", "DISCORD_API_BASE", "CRON_SECRET", "ECPAY_MERCHANT_ID", "ECPAY_HASH_KEY", "ECPAY_HASH_IV", "ECPAY_BASE_URL"]) {
    env[k] = e[k] || "";
  }
  supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: retryReads },
  });
}

// Supabase 偶爾閃一下（回 5xx，例如 555、503）：讀取的請求等一下自動再試一次；寫入不重試，免得寫兩次
export const RETRY_DELAY_MS = { value: 400 };
export async function retryReads(input, init = {}) {
  const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD") return fetch(input, init);
  try {
    const r = await fetch(input, init);
    if (r.status < 500) return r;
  } catch (e) {
    if (init.signal?.aborted) throw e;
  }
  await new Promise((res) => setTimeout(res, RETRY_DELAY_MS.value));
  return fetch(input, init);
}
