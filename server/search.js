// GET /api/search?q=假突破   直播紀錄搜尋：標題、簡介、章節、AI 重點、逐字稿（講到這個字的那一分鐘）
// 跟直播紀錄列表一樣要第二級；只找已發布、不是系統分享、不是公開影片的
import { tradeShareIds } from "./lib/trade-share.js";
import { supabaseAdmin, requireMember, route } from "./lib/index.js";
import { SITE_TIER, tierRuleText } from "../public/assets/js/shared/rules.js";
import { cleanQuery, likeEscape, hitsIn, metaHits } from "./lib/search.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res, { minTier: 1 });
    if (!ctx) return;
    const tier = ctx.member ? ctx.tier.tier : Infinity;
    if (tier < SITE_TIER) return res.status(403).json({ error: `這個內容要第二級（這一輪 ${tierRuleText(SITE_TIER)}）`, code: "tier" });
    const q = cleanQuery(req.query?.q);
    if ([...q].length < 2) return res.status(400).json({ error: "至少打兩個字" });

    const [{ data: videos, error }, { data: hls, error: hErr }, { data: found, error: sErr }] = await Promise.all([
      supabaseAdmin.from("videos").select("id, title, description, published_at, duration_sec, chapters")
        .eq("is_published", true).is("course_host", null).eq("is_public", false).order("published_at", { ascending: false }),
      supabaseAdmin.from("video_highlights").select("video_id, summary, points, point_times, chapters").eq("status", "done"),
      // 逐字稿在資料庫裡先篩出有這個字的影片（supabase/schema.sql 的 search_highlights）
      supabaseAdmin.rpc("search_highlights", { q: likeEscape(q) }),
    ]);
    if (error) throw error;
    if (hErr) throw hErr;
    if (sErr) throw sErr;
    const hl = new Map((hls || []).map((h) => [Number(h.video_id), h]));
    const tr = new Map((found || []).map((r) => [Number(r.video_id), r.chunks]));
    const results = [];
    const share = await tradeShareIds(); // v1.37.0：交易分享另外列
    for (const v of (videos || []).filter((x) => !share.has(x.id))) {
      const h = hl.get(Number(v.id));
      const meta = metaHits(v, h, q);
      const said = tr.has(Number(v.id)) ? hitsIn(tr.get(Number(v.id)), q) : [];
      const hits = [...meta.hits, ...said].filter((x, i, a) => x.t === null || a.findIndex((y) => y.t === x.t) === i).slice(0, 6);
      if (!meta.title && !meta.desc && !hits.length) continue;
      results.push({ id: v.id, title: v.title, published_at: v.published_at, duration_sec: v.duration_sec, titleHit: meta.title, hits });
    }
    // 標題有的排前面，再來是講到最多次的
    results.sort((a, b) => Number(b.titleHit) - Number(a.titleHit) || b.hits.length - a.hits.length);
    return res.status(200).json({ q, results: results.slice(0, 20) });
  },
});
