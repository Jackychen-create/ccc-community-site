// GET /api/videos          已發布影片清單＋我的觀看進度
// GET /api/videos?id=12    單支影片的播放連結、教材下載連結、上次看到哪
import { supabaseAdmin, requireMember, signGet, toInt, route, todayTW, twDate, courseUnlockDate } from "./lib/index.js";
import { SITE_TIER, courseTierOk, courseSkipSchedule, tierRuleText } from "../public/assets/js/shared/rules.js";

// 三級制度：直播留檔要第二級；教學課程第一級看得到每位講師的第 1 份
const needTier2 = (res) => res.status(403).json({ error: `這個內容要第二級（這一輪 ${tierRuleText(SITE_TIER)}）`, code: "tier" });

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res, { minTier: 1 });
    if (!ctx) return;
    const { user, isAdmin } = ctx;
    const tier = ctx.member ? ctx.tier.tier : Infinity;

    if (req.query?.id === undefined) return tier < SITE_TIER ? needTier2(res) : list(res, user);

    const id = toInt(req.query.id);
    if (id === null) return res.status(400).json({ error: "影片編號不正確" });
    return detail(res, ctx, id, tier);
  },
});

async function list(res, user) {
  const [{ data: videos, error }, { data: progress }, { data: atts }] = await Promise.all([
    supabaseAdmin
      .from("videos")
      .select("id, title, description, published_at, duration_sec, thumb_key, hosts, chapters, created_at")
      .eq("is_published", true)
      .is("course_host", null) // 教學課程另外列在 /api/course
      .eq("is_public", false) // 公開影片（培訓計畫介紹）不放進直播留檔列表
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

async function detail(res, ctx, id, tier) {
  const { user, isAdmin, member } = ctx;
  const { data: v, error } = await supabaseAdmin
    .from("videos")
    .select("id, title, description, published_at, duration_sec, r2_key, thumb_key, is_published, hosts, chapters, course_host, course_part")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  // 草稿只有管理員看得到（方便發布前先預覽）
  if (!v || (!v.is_published && !isAdmin)) {
    return res.status(404).json({ error: "找不到這支影片" });
  }
  // 等級不夠：直播留檔要第二級；教學課程第一級只看得到第 1 份
  if (!isAdmin && (v.course_host ? !courseTierOk(tier, v.course_part) : tier < SITE_TIER)) return needTier2(res);
  // 教學課程：從加入那天起每週解鎖，還沒到的不給播放連結
  if (v.course_host && !isAdmin && !courseSkipSchedule(tier)) { // 第三級不用等排程
    const unlock = courseUnlockDate(twDate(member.created_at), v.course_host, v.course_part);
    if (unlock > todayTW()) return res.status(403).json({ error: `這一份課程 ${unlock} 解鎖`, code: "locked", unlock_on: unlock });
  }

  const [{ data: atts }, { data: p }, { data: hl }] = await Promise.all([
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
    // 直播精華（AI 整理的摘要、重點、標的、章節）
    supabaseAdmin.from("video_highlights").select("status, summary, points, tickers, chapters").eq("video_id", id).maybeSingle(),
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
    course_host: v.course_host || null,
    course_part: v.course_part || null,
    thumb_url: v.thumb_key ? await signGet(v.thumb_key, { expiresIn: 12 * 60 * 60 }) : null,
    url: await signGet(v.r2_key),
    position_sec: p?.position_sec ?? 0,
    attachments,
    highlight: hl?.status === "done" ? { summary: hl.summary, points: hl.points || [], tickers: hl.tickers || [], chapters: hl.chapters || [] } : null,
  });
}

function fileNameFor(a) {
  const ext = (a.r2_key.match(/\.[a-z0-9]{1,8}$/i) || [""])[0];
  const base = a.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "教材";
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : base + ext;
}
