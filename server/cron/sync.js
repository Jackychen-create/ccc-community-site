// 排程：每天自動同步 Bybit、BingX 交易量
// 由 Supabase（東京）的 pg_cron 每天呼叫，見 supabase/schema.sql v1.9。Bybit 會擋美國 IP，所以不從 GitHub Actions 發
// POST /api/cron/sync   Header：X-Cron-Secret = Cloudflare 環境變數 CRON_SECRET
import { route, syncAll, cronAuthorized } from "../lib/index.js";

export default route({
  async POST(req, res) {
    if (!cronAuthorized(req)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const results = await syncAll();
    const ok = Object.values(results).every((s) => s.ok);
    return res.status(ok ? 200 : 502).json({ ok, results });
  },
});
