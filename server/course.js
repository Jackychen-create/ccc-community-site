// GET /api/course   交易分享（v1.37.0，取代原本的系統分享）
// 後台把影片標成「交易分享」（videos.trade_share）就放在這裡，加入就能看，沒有解鎖排程、沒有交易量門檻
// 原本的系統分享（course_host、course_part）先收起來：資料還在，研究員這裡看不到
// 付費制（後台開了的話）照舊：要月費才能看
import { supabaseAdmin, requireMember, signGet, route } from "./lib/index.js";
import { tradeShareVideos } from "./lib/trade-share.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res, { minTier: 1 });
    if (!ctx) return;
    const pd = ctx.member ? ctx.tier.paid : null;
    const locked = !!pd && !pd.sub; // 付費制：沒有月費的只給標題
    const videos = await tradeShareVideos();
    const ids = videos.map((v) => v.id);
    const [{ data: progress }, { data: atts }] = ids.length
      ? await Promise.all([
          supabaseAdmin.from("watch_progress").select("video_id, position_sec, duration_sec, updated_at").eq("user_id", ctx.user.id).in("video_id", ids),
          supabaseAdmin.from("attachments").select("video_id").in("video_id", ids),
        ])
      : [{ data: [] }, { data: [] }];
    const prog = new Map((progress || []).map((p) => [p.video_id, p]));
    const attCount = new Map();
    for (const a of atts || []) attCount.set(a.video_id, (attCount.get(a.video_id) || 0) + 1);
    const items = [];
    for (const v of videos) {
      const p = prog.get(v.id);
      items.push(locked
        ? { id: v.id, title: v.title, published_at: v.published_at, hosts: v.hosts || [], locked: true }
        : {
            id: v.id, title: v.title, description: v.description, published_at: v.published_at, hosts: v.hosts || [],
            duration_sec: v.duration_sec ?? p?.duration_sec ?? null,
            thumb_url: v.thumb_key ? await signGet(v.thumb_key, { expiresIn: 12 * 60 * 60 }) : null,
            position_sec: p?.position_sec ?? 0, watched_at: p?.updated_at ?? null,
            attachment_count: attCount.get(v.id) || 0, chapters: v.chapters || [],
          });
    }
    return res.status(200).json({ items, locked });
  },
});
