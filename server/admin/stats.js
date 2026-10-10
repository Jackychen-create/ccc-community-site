// 後台：觀看統計（只算會員，不算管理員自己看的）
// GET /api/admin/stats
import { supabaseAdmin, requireAdmin, route } from "../_lib.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const [{ data: members, error: e1 }, { data: videos, error: e2 }, { data: progress, error: e3 }] = await Promise.all([
      supabaseAdmin.from("members").select("user_id, email, banned, access_until"),
      supabaseAdmin.from("videos").select("id, title, published_at, duration_sec, is_published").order("published_at", { ascending: false }),
      supabaseAdmin.from("watch_progress").select("user_id, video_id, position_sec, duration_sec, updated_at").limit(100000),
    ]);
    if (e1 || e2 || e3) throw e1 || e2 || e3;

    const memberIds = new Set((members || []).map((m) => m.user_id));
    const dur = new Map((videos || []).map((v) => [v.id, v.duration_sec]));
    const rows = (progress || []).filter((p) => memberIds.has(p.user_id) && p.position_sec > 0);
    const pct = (p) => {
      const d = dur.get(p.video_id) || p.duration_sec;
      return d ? Math.min(1, p.position_sec / d) : 0;
    };

    const byVideo = new Map();
    const byMember = new Map();
    for (const p of rows) {
      const f = pct(p);
      const v = byVideo.get(p.video_id) || { viewers: 0, completed: 0, sum: 0 };
      v.viewers++;
      v.sum += f;
      if (f >= 0.95) v.completed++;
      byVideo.set(p.video_id, v);
      const m = byMember.get(p.user_id) || { watched: 0, completed: 0, last: null };
      m.watched++;
      if (f >= 0.95) m.completed++;
      if (!m.last || p.updated_at > m.last) m.last = p.updated_at;
      byMember.set(p.user_id, m);
    }

    return res.status(200).json({
      memberCount: memberIds.size,
      videos: (videos || []).map((v) => {
        const s = byVideo.get(v.id) || { viewers: 0, completed: 0, sum: 0 };
        return {
          id: v.id, title: v.title, published_at: v.published_at, is_published: v.is_published,
          viewers: s.viewers, completed: s.completed, avg_pct: s.viewers ? Math.round((s.sum / s.viewers) * 100) : 0,
        };
      }),
      members: (members || []).map((m) => {
        const s = byMember.get(m.user_id) || { watched: 0, completed: 0, last: null };
        return { user_id: m.user_id, email: m.email, banned: m.banned, access_until: m.access_until, watched: s.watched, completed: s.completed, last_watched_at: s.last };
      }).sort((a, b) => String(b.last_watched_at || "").localeCompare(String(a.last_watched_at || ""))),
    });
  },
});
