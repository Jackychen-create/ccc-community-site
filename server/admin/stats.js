// 後台：觀看統計（只算研究員，不算管理員自己看的）
// GET /api/admin/stats             每一場、每位研究員的總覽
// GET /api/admin/stats?video=12    單一場的觀看分段：每 30 秒有幾個人看過、看了幾次、大家在哪裡停下、哪裡有人提問
import { supabaseAdmin, requireAdmin, route, toInt, BUCKET_SEC } from "../lib/index.js";

async function videoDetail(res, id) {
  const [{ data: v, error }, { data: members }, { data: rows, error: e2 }, { data: fb }] = await Promise.all([
    supabaseAdmin.from("videos").select("id, title, published_at, duration_sec, chapters, course_host, course_part").eq("id", id).maybeSingle(),
    supabaseAdmin.from("members").select("user_id"),
    supabaseAdmin.from("watch_progress").select("user_id, position_sec, duration_sec, buckets").eq("video_id", id).limit(5000),
    supabaseAdmin.from("feedback").select("id, email, t, kind, body, status, created_at").eq("video_id", id).order("t"),
  ]);
  if (error || e2) throw error || e2;
  if (!v) return res.status(404).json({ error: "找不到這支影片" });
  const ids = new Set((members || []).map((m) => m.user_id));
  const mine = (rows || []).filter((r) => ids.has(r.user_id) && r.position_sec > 0);
  const duration = v.duration_sec || Math.max(0, ...mine.map((r) => r.duration_sec || 0)) || 0;
  const n = Math.max(1, Math.ceil(duration / BUCKET_SEC));
  const viewers = new Array(n).fill(0);
  const plays = new Array(n).fill(0);
  const stops = new Array(n).fill(0);
  let tracked = 0;
  for (const r of mine) {
    const b = r.buckets || {};
    const keys = Object.keys(b);
    if (keys.length) tracked++;
    for (const k of keys) {
      const i = Number(k);
      if (i >= 0 && i < n) { viewers[i]++; plays[i] += Number(b[k]) || 0; }
    }
    // 沒看完的人停在哪裡
    if (!(duration && r.position_sec >= duration * 0.95)) stops[Math.min(n - 1, Math.floor(r.position_sec / BUCKET_SEC))]++;
  }
  return res.status(200).json({
    video: v, duration, bucket_sec: BUCKET_SEC,
    viewers_total: mine.length, tracked,
    completed: mine.filter((r) => duration && r.position_sec >= duration * 0.95).length,
    buckets: viewers.map((x, i) => ({ viewers: x, plays: plays[i], stops: stops[i] })),
    feedback: fb || [],
  });
}

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    if (req.query?.video !== undefined) {
      const id = toInt(req.query.video);
      if (id === null) return res.status(400).json({ error: "影片編號不正確" });
      return videoDetail(res, id);
    }
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
