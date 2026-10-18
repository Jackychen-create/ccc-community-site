// GET /api/course   教學課程：18 份（CCC、X、OC 各 6 份），每位研究員從加入那天起每週解鎖一份
// 每 4 週一輪：前 3 週依序 CCC、X、OC，第 4 週休息。管理員看到的是全部解鎖（方便檢查）
// 三級制度：第一級只看得到每位講師的第 1 份，其他的標 tier_locked（第二級解鎖）；第三級全部直接解鎖，不用等排程
import {
  supabaseAdmin, requireMember, signGet, route, todayTW, twDate,
  COURSE_HOSTS, COURSE_PARTS, courseWeek, courseUnlockDate,
} from "./lib/index.js";
import { courseTierOk, courseSkipSchedule } from "../public/assets/js/shared/rules.js";

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res, { minTier: 1 });
    if (!ctx) return;
    const today = todayTW();
    const start = ctx.member ? twDate(ctx.member.created_at) : today;

    const [{ data: videos, error }, { data: progress }, { data: atts }] = await Promise.all([
      supabaseAdmin
        .from("videos")
        .select("id, title, description, duration_sec, thumb_key, chapters, course_host, course_part")
        .eq("is_published", true)
        .not("course_host", "is", null),
      supabaseAdmin.from("watch_progress").select("video_id, position_sec, duration_sec, updated_at").eq("user_id", ctx.user.id),
      supabaseAdmin.from("attachments").select("video_id"),
    ]);
    if (error) throw error;
    const bySlot = new Map((videos || []).map((v) => [`${v.course_host}:${v.course_part}`, v]));
    const prog = new Map((progress || []).map((p) => [p.video_id, p]));
    const attCount = new Map();
    for (const a of atts || []) attCount.set(a.video_id, (attCount.get(a.video_id) || 0) + 1);

    const slots = [];
    for (let part = 1; part <= COURSE_PARTS; part++) {
      for (const host of COURSE_HOSTS) {
        const unlock_on = courseUnlockDate(start, host, part);
        const tierLocked = !!ctx.member && !courseTierOk(ctx.tier.tier, part);
        const unlocked = !ctx.member || ((unlock_on <= today || courseSkipSchedule(ctx.tier.tier)) && !tierLocked);
        const v = bySlot.get(`${host}:${part}`);
        const p = v && prog.get(v.id);
        slots.push({
          host, part,
          week: courseWeek(host, part) + 1,
          unlock_on, unlocked, tier_locked: tierLocked,
          // 還沒解鎖的只給標題，不給封面和播放資訊
          video: v
            ? unlocked
              ? {
                  id: v.id, title: v.title, description: v.description,
                  duration_sec: v.duration_sec ?? p?.duration_sec ?? null,
                  thumb_url: v.thumb_key ? await signGet(v.thumb_key, { expiresIn: 12 * 60 * 60 }) : null,
                  position_sec: p?.position_sec ?? 0, watched_at: p?.updated_at ?? null,
                  attachment_count: attCount.get(v.id) || 0, chapters: v.chapters || [],
                }
              : { title: v.title }
            : null,
        });
      }
    }
    slots.sort((a, b) => a.week - b.week);
    return res.status(200).json({ start, today, slots });
  },
});
