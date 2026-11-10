// GET /api/public-market   對外網站的行情（BTC、ETH、SOL、黃金、恐慌貪婪指數），不用登入
// 資料從 Supabase Edge Function「market」（東京）拿；Cloudflare 快取 1 分鐘，訪客再多也只每分鐘打一次
import { route, env } from "./lib/index.js";

const TTL = 60;
const KEY = "https://cache.ccc-lab.internal/public-market";

export function marketUrl() {
  if (env.MARKET_URL) return env.MARKET_URL; // 測試用
  if (!env.SUPABASE_URL) return null;
  return `${String(env.SUPABASE_URL).replace(/\/$/, "")}/functions/v1/market`;
}

export default route({
  async GET(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", `public, max-age=${TTL}`);
    const cache = globalThis.caches?.default;
    if (cache) {
      const hit = await cache.match(KEY).catch(() => null);
      if (hit) return res.status(200).json(await hit.json());
    }
    const url = marketUrl();
    if (!url) return res.status(503).json({ error: "行情還沒設定" });
    let d;
    try {
      const r = await fetch(url, { headers: { "x-region": "ap-northeast-1" }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`http ${r.status}`);
      d = await r.json();
    } catch (e) {
      return res.status(502).json({ error: "行情暫時拿不到", detail: String(e?.message || e).slice(0, 80) });
    }
    const out = {
      at: d.at || new Date().toISOString(),
      items: (d.items || []).slice(0, 6).map((x) => ({ name: String(x.name), note: x.note || null, price: Number(x.price), chg24: Math.round(Number(x.chg24) * 100) / 100, high24: Number(x.high24), low24: Number(x.low24), spark: (x.spark || []).slice(-25).map(Number) })),
      fng: d.fng && Number.isFinite(Number(d.fng.value)) ? { value: Number(d.fng.value), label: String(d.fng.label || "") } : null,
    };
    if (cache && out.items.length) {
      await cache.put(KEY, new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${TTL}` } })).catch(() => {});
    }
    return res.status(200).json(out);
  },
});
