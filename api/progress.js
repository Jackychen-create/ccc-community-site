// POST /api/progress  { videoId, position, duration }
// 記錄看到哪裡，下次從這裡繼續（換裝置也會同步）
import { supabaseAdmin, requireMember, readBody, toInt, route } from "./_lib.js";

export default route({
  async POST(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;

    const body = readBody(req);
    const videoId = toInt(body.videoId);
    const position = Math.floor(Number(body.position));
    const duration = Math.floor(Number(body.duration));
    if (videoId === null || !Number.isFinite(position) || position < 0 || position > 24 * 3600) {
      return res.status(400).json({ error: "資料不正確" });
    }

    const { data: v } = await supabaseAdmin
      .from("videos")
      .select("id, is_published")
      .eq("id", videoId)
      .maybeSingle();
    if (!v || (!v.is_published && !ctx.isAdmin)) {
      return res.status(404).json({ error: "找不到這支影片" });
    }

    const { error } = await supabaseAdmin.from("watch_progress").upsert({
      user_id: ctx.user.id,
      video_id: videoId,
      position_sec: position,
      duration_sec: Number.isFinite(duration) && duration > 0 ? duration : null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return res.status(204).end();
  },
});
