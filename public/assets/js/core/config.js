// 設定（public/config.js）和 Supabase 連線
export const cfg = window.APP_CONFIG || {};
export const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// 合併網站（2026-11-20）：首頁「/」靠這個旗標決定給介紹頁還是研究員專區（functions/index.js）。只是旗標，不是登入憑證
function signedInFlag(on) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = on ? `ccc_in=1; Path=/; Max-Age=31536000; SameSite=Lax${secure}` : `ccc_in=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
sb.auth.getSession().then(({ data }) => signedInFlag(!!data.session)).catch(() => {});
sb.auth.onAuthStateChange((_e, session) => {
  signedInFlag(!!session);
  // 從 /login 登入進來的，網址換回首頁（下次打開「/」就直接是研究員專區）
  if (session && location.pathname === "/login") history.replaceState(history.state, "", "/" + location.search + location.hash);
});
