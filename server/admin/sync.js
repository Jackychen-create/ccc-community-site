// 後台：交易量自動同步（Bybit、BingX）
// GET  /api/admin/sync                     每間設定好了沒、綁定了幾位研究員、上次同步的結果
// POST /api/admin/sync { exchange? }       立即同步（不給 exchange 就同步所有設定好的）；這個月，每月 1–3 號也同步上個月
import { requireAdmin, readBody, route, AUTO_EXCHANGES, PROVIDERS, syncExchange, syncOverview } from "../lib/index.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    return res.status(200).json({ exchanges: await syncOverview() });
  },
  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const list = b.exchange ? [b.exchange] : AUTO_EXCHANGES.filter((ex) => PROVIDERS[ex].configured());
    if (b.exchange && !AUTO_EXCHANGES.includes(b.exchange)) return res.status(400).json({ error: "不支援這間交易所" });
    if (!list.length) return res.status(503).json({ error: "還沒設定任何交易所的 API Key" });
    for (const ex of list) {
      if (!PROVIDERS[ex].configured()) return res.status(503).json({ error: `還沒設定 ${ex} API Key（Cloudflare 的 ${PROVIDERS[ex].keys}）` });
    }
    const results = {};
    for (const ex of list) results[ex] = await syncExchange(ex);
    const failed = Object.entries(results).filter(([, s]) => !s.ok);
    const exchanges = await syncOverview();
    if (failed.length) return res.status(502).json({ error: `同步失敗：${failed.map(([ex, s]) => `${ex}：${s.error}`).join("；")}`, exchanges });
    return res.status(200).json({ ok: true, exchanges });
  },
});
