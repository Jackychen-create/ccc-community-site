// 行情（固定在東京跑，對外網站用）：Bybit 現貨報價、最近 24 小時每小時收盤（畫小走勢圖）、恐慌貪婪指數
// 都是公開資料、不用金鑰；網站的 /api/public-market 會快取 1 分鐘再給前台，不會每個訪客都打到這裡
// 呼叫時帶 Header x-region: ap-northeast-1
const SYMS = [
  { sym: "BTCUSDT", name: "BTC" },
  { sym: "ETHUSDT", name: "ETH" },
  { sym: "SOLUSDT", name: "SOL" },
  { sym: "XAUTUSDT", name: "黃金", note: "XAUT" },
];
const BASE = "https://api.bybit.com";
const get = async (url: string) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return await r.json();
};

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const items = await Promise.all(SYMS.map(async (s) => {
    try {
      const [t, k] = await Promise.all([
        get(`${BASE}/v5/market/tickers?category=spot&symbol=${s.sym}`),
        get(`${BASE}/v5/market/kline?category=spot&symbol=${s.sym}&interval=60&limit=25`),
      ]);
      const x = t?.result?.list?.[0];
      if (!x) return null;
      const spark = (k?.result?.list || []).map((r: string[]) => Number(r[4])).reverse().filter((n: number) => Number.isFinite(n));
      return { sym: s.sym, name: s.name, note: s.note || null, price: Number(x.lastPrice), chg24: Number(x.price24hPcnt) * 100, high24: Number(x.highPrice24h), low24: Number(x.lowPrice24h), spark };
    } catch {
      return null;
    }
  }));
  let fng = null;
  try {
    const f = await get("https://api.alternative.me/fng/?limit=1");
    const d = f?.data?.[0];
    if (d) fng = { value: Number(d.value), label: String(d.value_classification || "") };
  } catch { /* 拿不到就不顯示 */ }
  return new Response(JSON.stringify({ at: new Date().toISOString(), items: items.filter(Boolean), fng, region: Deno.env.get("SB_REGION") ?? null }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
  });
});
