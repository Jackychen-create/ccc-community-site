// /lab：實驗室培訓房（研究員專區）。介紹頁右上角「進入-實驗室培訓房」、Discord、信裡的連結都到這裡
export async function onRequestGet({ request, env }) {
  const r = await env.ASSETS.fetch(new URL("/", request.url));
  const res = new Response(r.body, r);
  res.headers.set("Cache-Control", "no-cache");
  return res;
}
