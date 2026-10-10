// GET /api/videos          已發布影片清單＋我的觀看進度
// GET /api/videos?id=12    單支影片的播放連結、教材下載連結、上次看到哪
import { supabaseAdmin, requireMember, signGet, toInt, route } from "./_lib.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res);
    if (!ctx) return;
    const { user, isAdmin } = ctx;

    if (req.query?.id === undefined) return list(res, user);

    const id = toInt(req.query.id);
    if (id === null) return res.status(400).json({ error: "影片編號不正確" });
    return detail(res, user, isAdmin, id);
  },
});

async function list(res, user) {
  const [{ data: videos, error }, { data: progress }, { data: atts }] = await Promise.all([
    supabaseAdmin
      .from("videos")
      .select("id, title, description, published_at, duration_sec, thumb_key, hosts, chapters, created_at")
      .eq("is_published", true)
      .order("published_at", { ascending: false })
      .order("id", { ascending: false }),
    supabaseAdmin
      .from("watch_progress")
      .select("video_id, position_sec, duration_sec, updated_at")
      .eq("user_id", user.id),
    supabaseAdmin.from("attachments").select("video_id"),
  ]);
  if (error) throw error;

  const prog = new Map((progress || []).map((p) => [p.video_id, p]));
  const attCount = new Map();
  for (const a of atts || []) attCount.set(a.video_id, (attCount.get(a.video_id) || 0) + 1);

  const out = await Promise.all(
    (videos || []).map(async (v) => {
      const p = prog.get(v.id);
      return {
        id: v.id,
        title: v.title,
        description: v.description,
        published_at: v.published_at,
        duration_sec: v.duration_sec ?? p?.duration_sec ?? null,
        thumb_url: v.thumb_key ? await signGet(v.thumb_key, { expiresIn: 12 * 60 * 60 }) : null,
        position_sec: p?.position_sec ?? 0,
        watched_at: p?.updated_at ?? null,
        attachment_count: attCount.get(v.id) || 0,
        hosts: v.hosts || [],
        chapters: v.chapters || [],
      };
    })
  );
  return res.status(200).json({ videos: out });
}

async function detail(res, user, isAdmin, id) {
  const { data: v, error } = await supabaseAdmin
    .from("videos")
    .select("id, title, description, published_at, duration_sec, r2_key, is_published, hosts, chapters")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  // 草稿只有管理員看得到（方便發布前先預覽）
  if (!v || (!v.is_published && !isAdmin)) {
    return res.status(404).json({ error: "找不到這支影片" });
  }

  const [{ data: atts }, { data: p }] = await Promise.all([
    supabaseAdmin
      .from("attachments")
      .select("id, title, r2_key, size_bytes")
      .eq("video_id", id)
      .order("id"),
    supabaseAdmin
      .from("watch_progress")
      .select("position_sec")
      .eq("user_id", user.id)
      .eq("video_id", id)
      .maybeSingle(),
  ]);

  const attachments = await Promise.all(
    (atts || []).map(async (a) => ({
      id: a.id,
      title: a.title,
      size_bytes: a.size_bytes,
      url: await signGet(a.r2_key, { downloadName: fileNameFor(a) }),
    }))
  );

  return res.status(200).json({
    id: v.id,
    title: v.title,
    description: v.description,
    published_at: v.published_at,
    duration_sec: v.duration_sec,
    is_published: v.is_published,
    hosts: v.hosts || [],
    chapters: v.chapters || [],
    url: await signGet(v.r2_key),
    position_sec: p?.position_sec ?? 0,
    attachments,
  });
}

function fileNameFor(a) {
  const ext = (a.r2_key.match(/\.[a-z0-9]{1,8}$/i) || [""])[0];
  const base = a.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "教材";
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : base + ext;
}
