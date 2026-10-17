// 排程：開播前 30 分鐘在 Discord 公告下面提醒
// 由 Supabase 的 pg_cron 每 5 分鐘呼叫，見 supabase/schema.sql v1.15
// POST /api/cron/lives   Header：X-Cron-Secret = Cloudflare 環境變數 CRON_SECRET
import { supabaseAdmin, route, cronAuthorized, announceLive, REMIND_BEFORE_MIN } from "../lib/index.js";

export default route({
  async POST(req, res) {
    if (!cronAuthorized(req)) return res.status(401).json({ error: "unauthorized" });
    const now = Date.now();
    // 30 分鐘內要開始、還沒提醒過的（開始超過 10 分鐘就不提醒了）
    const { data, error } = await supabaseAdmin.from("lives").select("*")
      .eq("status", "scheduled").is("reminded_at", null)
      .gte("starts_at", new Date(now - 10 * 60e3).toISOString())
      .lte("starts_at", new Date(now + REMIND_BEFORE_MIN * 60e3).toISOString());
    if (error) throw error;
    let reminded = 0;
    for (const live of data || []) {
      // 先標記再發，排程重疊時不會提醒兩次
      const { data: claimed } = await supabaseAdmin.from("lives").update({ reminded_at: new Date().toISOString() })
        .eq("id", live.id).is("reminded_at", null).select("id").maybeSingle();
      if (!claimed) continue;
      const r = await announceLive(live, "reminder");
      if (r.posted) reminded++;
    }
    return res.status(200).json({ ok: true, due: (data || []).length, reminded });
  },
});
