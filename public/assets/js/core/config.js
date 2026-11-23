// 設定（public/config.js）和 Supabase 連線
export const cfg = window.APP_CONFIG || {};
export const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// 2026-11-23 起介紹網站（/）和實驗室培訓房（/lab）分開：不再用 ccc_in 旗標，清掉以前留下的
try { if (/(?:^|;\s*)ccc_in=/.test(document.cookie)) document.cookie = `ccc_in=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } catch {}
sb.auth.onAuthStateChange((_e, session) => {
  // 從舊網址 /login 進來的，登入後網址換成 /lab
  if (session && location.pathname === "/login") history.replaceState(history.state, "", "/lab" + location.search + location.hash);
});
