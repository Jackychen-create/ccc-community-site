// 排程：每天自動同步交易所交易量
// 由 Supabase（東京）的 pg_cron 每天呼叫，見 supabase/schema.sql v1.9、v1.26.36。Bybit 會擋美國 IP，所以不從 GitHub Actions 發
// POST /api/cron/sync   Header：X-Cron-Secret = Cloudflare 環境變數 CRON_SECRET
// Body { exchange }：只同步這一間。Cloudflare 一次請求最多 50 個對外連線，研究員一多，三間一起跑會超過，
// 所以排程是一間一間各打一次；不給 exchange 還是全部跑（舊的排程相容用）
import { route, readBody, syncAll, syncExchange, cronAuthorized, AUTO_EXCHANGES, PROVIDERS } from "../lib/index.js";

export default route({
  async POST(req, res) {
    if (!cronAuthorized(req)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const ex = readBody(req)?.exchange;
    if (ex && !AUTO_EXCHANGES.includes(ex)) return res.status(400).json({ error: "不支援這間交易所" });
    let results;
    if (ex) results = PROVIDERS[ex].configured() ? { [ex]: await syncExchange(ex) } : {};
    else results = await syncAll();
    const ok = Object.values(results).every((s) => s.ok);
    return res.status(ok ? 200 : 502).json({ ok, results });
  },
});
