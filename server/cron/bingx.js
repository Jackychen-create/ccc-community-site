// 排程：每天自動同步 BingX 交易量（由 GitHub Actions 的排程呼叫，見 .github/workflows/bingx-sync.yml）
// POST /api/cron/bingx   Header：X-Cron-Secret = Cloudflare 環境變數 CRON_SECRET
import { env, route, bingxConfigured, syncBingx } from "../lib/index.js";

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
    if (!bingxConfigured()) return res.status(503).json({ error: "BingX not configured" });
    const status = await syncBingx();
    return res.status(status.ok ? 200 : 502).json(status);
  },
});
