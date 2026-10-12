// 後台：BingX 自動同步
// GET  /api/admin/bingx   設定好了沒、上次同步的結果、綁定了幾位研究員
// POST /api/admin/bingx   立即同步（這個月；每月 1–3 號也同步上個月）
import { supabaseAdmin, requireAdmin, route, bingxConfigured, syncBingx, lastSync } from "../lib/index.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const { count } = await supabaseAdmin.from("exchange_links").select("user_id", { count: "exact", head: true }).eq("exchange", "BingX");
    return res.status(200).json({ configured: bingxConfigured(), linked: count || 0, last: await lastSync() });
  },
  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    if (!bingxConfigured()) return res.status(503).json({ error: "還沒設定 BingX API Key（Cloudflare 的 BINGX_API_KEY、BINGX_SECRET_KEY）" });
    const status = await syncBingx();
    if (!status.ok) return res.status(502).json({ error: `同步失敗：${status.error}`, status });
    return res.status(200).json(status);
  },
});
