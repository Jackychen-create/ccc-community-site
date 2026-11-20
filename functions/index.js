// 首頁「/」（2026-11-20 合併網站）：同一個網址，沒登入看介紹頁，登入了看研究員專區
// 登入狀態存在瀏覽器（Supabase），伺服器看不到，所以網站在登入時另外記一個旗標 cookie：ccc_in=1
// （只是旗標，不是登入憑證；登出時清掉，見 public/assets/js/core/config.js）
//   有旗標、或網址帶參數（?invite=、?next= 等）→ 研究員專區（index.html）
//   沒有 → 介紹頁（public/start/index.html，網址還是「/」）
export const SIGNED_IN = /(?:^|;\s*)ccc_in=1(?:;|$)/;

export async function onRequestGet({ request, env, next }) {
  const url = new URL(request.url);
  if (url.search || SIGNED_IN.test(request.headers.get("cookie") || "")) {
    const r = await next();
    return withVary(r);
  }
  const page = await env.ASSETS.fetch(new URL("/start/", url));
  return withVary(page);
}

function withVary(r) {
  const res = new Response(r.body, r);
  res.headers.set("Vary", "Cookie");
  res.headers.set("Cache-Control", "no-cache");
  return res;
}
