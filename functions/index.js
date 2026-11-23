// 首頁「/」：永遠是介紹頁（v1.36.3，2026-11-23 把介紹網站和實驗室培訓房分開）
// 實驗室培訓房（研究員專區）在 /lab（functions/lab.js），/login 一樣通
//   網址帶參數（?invite=、?next=admin 這種，舊的加入連結、後台登入回來）→ 轉到 /lab，參數跟著帶過去
//   分享出去的 /#/v/12 這種連結：伺服器看不到 # 後面，介紹頁的 gate.js 會帶到 /lab#/v/12
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.search) return Response.redirect(new URL(`/lab${url.search}`, url).toString(), 302);
  const page = await env.ASSETS.fetch(new URL("/start/", url));
  const res = new Response(page.body, page);
  res.headers.set("Cache-Control", "no-cache");
  return res;
}
