// POST /api/progress  { videoId, position, duration, seen? }
// seen：這段時間看過的 30 秒格子 { "12": 1, "13": 1 }，用來畫「大家在哪裡停下、哪裡重看」
// 記錄看到哪裡，下次從這裡繼續（換裝置也會同步）
import { supabaseAdmin, requireMember, readBody, toInt, route, mergeBuckets } from "./lib/index.js";

export default route({
  async POST(req, res) {
    const ctx = await requireMember(req, res, { minTier: 1 }); // 第一級也看得到課程第 1 份，可以存進度、記筆記
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

    const row = {
      user_id: ctx.user.id,
      video_id: videoId,
      position_sec: position,
      duration_sec: Number.isFinite(duration) && duration > 0 ? duration : null,
      updated_at: new Date().toISOString(),
    };
    // 管理員自己看的不算進統計
    if (!ctx.isAdmin && body.seen && typeof body.seen === "object" && Object.keys(body.seen).length) {
      const { data: cur } = await supabaseAdmin.from("watch_progress").select("buckets").eq("user_id", ctx.user.id).eq("video_id", videoId).maybeSingle();
      row.buckets = mergeBuckets(cur?.buckets, body.seen);
    }
    const { error } = await supabaseAdmin.from("watch_progress").upsert(row);
    if (error) throw error;
    return res.status(204).end();
  },
});
