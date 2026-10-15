// 排程：每天自動同步 Bybit、BingX 交易量
// 由 Supabase（東京）的 pg_cron 每天呼叫，見 supabase/schema.sql v1.9。Bybit 會擋美國 IP，所以不從 GitHub Actions 發
// POST /api/cron/sync   Header：X-Cron-Secret = Cloudflare 環境變數 CRON_SECRET
import { env, route, syncAll } from "../lib/index.js";

// 逐字比較（時間固定），避免從回應時間猜出密碼
function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default route({
  async POST(req, res) {
    if (!env.CRON_SECRET || !same(req.headers?.["x-cron-secret"] || "", env.CRON_SECRET)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const results = await syncAll();
    const ok = Object.values(results).every((s) => s.ok);
    return res.status(ok ? 200 : 502).json({ ok, results });
  },
});
