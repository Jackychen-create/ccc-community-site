// 研究員自己的時間點筆記（只有本人看得到）
// GET    /api/notes               我的全部筆記（附影片標題、日期）
// GET    /api/notes?videoId=12    某一場的筆記
// POST   /api/notes  { videoId, t, body }
// DELETE /api/notes?id=3
import { supabaseAdmin, requireMember, readBody, toInt, route } from "./_lib.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    let q = supabaseAdmin
      .from("notes")
      .select("id, video_id, t_sec, body, created_at, videos(title, published_at, is_published)")
      .eq("user_id", ctx.user.id)
      .order("video_id", { ascending: false })
      .order("t_sec", { ascending: true })
      .limit(1000);
    if (req.query?.videoId !== undefined) {
      const vid = toInt(req.query.videoId);
      if (vid === null) return res.status(400).json({ error: "影片編號不正確" });
      q = q.eq("video_id", vid);
    }
    const { data, error } = await q;
    if (error) throw error;
    const notes = (data || [])
      .filter((n) => n.videos && (n.videos.is_published || ctx.isAdmin))
      .map((n) => ({
        id: n.id,
        video_id: n.video_id,
        t: n.t_sec,
        body: n.body,
        created_at: n.created_at,
        video_title: n.videos.title,
        published_at: n.videos.published_at,
      }));
    return res.status(200).json({ notes });
  },

  async POST(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const b = readBody(req);
    const videoId = toInt(b.videoId);
    const t = Math.floor(Number(b.t));
    const body = typeof b.body === "string" ? b.body.trim().slice(0, 2000) : "";
    if (videoId === null || !Number.isFinite(t) || t < 0 || t > 24 * 3600 || !body) {
      return res.status(400).json({ error: "筆記內容不能空白" });
    }
    const { data: v } = await supabaseAdmin.from("videos").select("id, is_published").eq("id", videoId).maybeSingle();
    if (!v || (!v.is_published && !ctx.isAdmin)) return res.status(404).json({ error: "找不到這支影片" });

    // 每個人最多 2000 則，避免被灌爆
    const { count } = await supabaseAdmin.from("notes").select("id", { count: "exact", head: true }).eq("user_id", ctx.user.id);
    if ((count || 0) >= 2000) return res.status(400).json({ error: "筆記已經滿 2000 則，請先刪掉一些" });

    const { data, error } = await supabaseAdmin
      .from("notes")
      .insert({ user_id: ctx.user.id, video_id: videoId, t_sec: t, body })
      .select("id, video_id, t_sec, body, created_at")
      .single();
    if (error) throw error;
    return res.status(200).json({ note: { id: data.id, video_id: data.video_id, t: data.t_sec, body: data.body, created_at: data.created_at } });
  },

  async DELETE(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const id = toInt(req.query?.id);
    if (id === null) return res.status(400).json({ error: "筆記編號不正確" });
    const { error } = await supabaseAdmin.from("notes").delete().eq("id", id).eq("user_id", ctx.user.id);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  },
});
