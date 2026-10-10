// 環境變數和 Supabase 連線（service role，只在伺服器用）。
// 跑在 Cloudflare Pages Functions：functions/api/[[path]].js 每次請求時用 setEnv() 帶進來。
import { createClient } from "@supabase/supabase-js";

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
