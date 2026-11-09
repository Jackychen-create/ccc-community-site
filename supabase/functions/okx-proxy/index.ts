// OKX 轉送（固定在東京跑）：OKX 擋美國等地區的 IP，網站的請求常從美國的 Cloudflare 進來，
// 所以網站把「已經簽好名」的 OKX 請求交給這裡，從東京送出去，再把 OKX 的回應原樣傳回。
// 這裡不放任何金鑰；只允許 OKX 唯讀的聯盟（推薦人）API，其他一律拒絕。
// 網站呼叫時帶 Header x-region: ap-northeast-1（見 server/lib/okx.js）
const BASES = ["https://www.okx.com", "https://my.okx.com"];
const PATHS = ["/api/v5/affiliate/invitee/detail"];
const HEADERS = ["OK-ACCESS-KEY", "OK-ACCESS-SIGN", "OK-ACCESS-TIMESTAMP", "OK-ACCESS-PASSPHRASE"];

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let b: { base?: string; path?: string; query?: string; headers?: Record<string, string> };
  try {
    b = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (!BASES.includes(String(b.base)) || !PATHS.includes(String(b.path))) return json({ error: "not allowed" }, 400);
  const query = typeof b.query === "string" ? b.query : "";
  if (query.length > 500 || /[\s#]/.test(query)) return json({ error: "bad query" }, 400);
  const headers: Record<string, string> = {};
  for (const k of HEADERS) {
    const v = b.headers?.[k];
    if (typeof v === "string" && v.length < 200) headers[k] = v;
  }
  try {
    const r = await fetch(`${b.base}${b.path}${query ? "?" + query : ""}`, { headers, signal: AbortSignal.timeout(10000) });
    return json({ status: r.status, body: await r.text(), region: Deno.env.get("SB_REGION") ?? null });
  } catch (e) {
    return json({ error: "upstream", message: String((e as Error)?.message || e).slice(0, 200) }, 502);
  }
});
