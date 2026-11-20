// /login（2026-11-20 合併網站）：介紹頁的「登入」、分享出去的 #/ 連結都帶到這裡，一律給研究員專區（登入頁）
export async function onRequestGet({ request, env }) {
  const r = await env.ASSETS.fetch(new URL("/", request.url));
  const res = new Response(r.body, r);
  res.headers.set("Cache-Control", "no-cache");
  return res;
}
