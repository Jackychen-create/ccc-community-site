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
    // 每一場、每位研究員的數字在資料庫裡算好（supabase/schema.sql 的 admin_video_stats、admin_member_progress）
    const [{ data: members, error: e1 }, { data: videos, error: e2 }, { data: vstats, error: e3 }, { data: mstats, error: e4 }] = await Promise.all([
      supabaseAdmin.from("members").select("user_id, email, banned, access_until"),
      supabaseAdmin.from("videos").select("id, title, published_at, duration_sec, is_published").order("published_at", { ascending: false }),
      supabaseAdmin.rpc("admin_video_stats"),
      supabaseAdmin.rpc("admin_member_progress"),
    ]);
    if (e1 || e2 || e3 || e4) throw e1 || e2 || e3 || e4;

    const memberIds = new Set((members || []).map((m) => m.user_id));
    const byVideo = new Map((vstats || []).map((v) => [v.video_id, v]));
    const byMember = new Map((mstats || []).map((m) => [m.user_id, m]));

    return res.status(200).json({
      memberCount: memberIds.size,
      videos: (videos || []).map((v) => {
        const s = byVideo.get(v.id) || { viewers: 0, completed: 0, avg_pct: 0 };
        return {
          id: v.id, title: v.title, published_at: v.published_at, is_published: v.is_published,
          viewers: s.viewers, completed: s.completed, avg_pct: s.avg_pct,
        };
      }),
      members: (members || []).map((m) => {
        const s = byMember.get(m.user_id) || { watched: 0, completed: 0, last_watched_at: null };
        return { user_id: m.user_id, email: m.email, banned: m.banned, access_until: m.access_until, watched: s.watched, completed: s.completed, last_watched_at: s.last_watched_at };
      }).sort((a, b) => String(b.last_watched_at || "").localeCompare(String(a.last_watched_at || ""))),
    });
  },
});
