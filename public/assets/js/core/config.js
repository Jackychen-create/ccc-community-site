// 設定（public/config.js）和 Supabase 連線
export const cfg = window.APP_CONFIG || {};
export const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
