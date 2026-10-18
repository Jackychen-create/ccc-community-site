// 後台：待跟進的研究員
// GET /api/admin/followup
// 每位研究員列出需要注意的地方：沒有等級、下一輪會降級、第三級一對一、很久沒來、課程落後、有提問還沒回
import {
  supabaseAdmin, requireAdmin, route, todayTW, twDate, addDays,
  gapTo, tierName, tierFromRows, periodFor, oneOnOneBoard, COURSE_HOSTS, COURSE_PARTS, courseUnlockDate,
} from "../lib/index.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const today = todayTW();
    const board = await oneOnOneBoard().catch(() => null); // 這個月的一對一（表還沒建立時當作沒有）
    const pickOf = new Map();
    for (const h of board?.hosts || []) for (const e of h.list) pickOf.set(e.user_id, { host: h.host, ...e });
    const [m, v, p, vol, fb] = await Promise.all([
      supabaseAdmin.from("members").select("user_id, email, banned, note, created_at, free, min_tier, min_tier_until"),
      supabaseAdmin.from("videos").select("id, course_host, course_part").eq("is_published", true).not("course_host", "is", null),
      // 每位研究員看過幾場、看完哪幾場：資料庫算好（supabase/schema.sql 的 admin_member_progress）
      supabaseAdmin.rpc("admin_member_progress"),
      supabaseAdmin.from("volumes").select("user_id, period_start, amounts, qualified_at").gte("period_start", addDays(today, -70)),
      supabaseAdmin.from("feedback").select("user_id").eq("status", "open"),
    ]);
    for (const r of [m, v, p, vol, fb]) if (r.error) throw r.error;

    const courseVideo = new Map((v.data || []).map((x) => [`${x.course_host}:${x.course_part}`, x]));
    const progress = new Map((p.data || []).map((r) => [r.user_id, r]));
    const volBy = new Map((vol.data || []).map((x) => [`${x.user_id}:${x.period_start}`, x]));
    const openFb = new Map();
    for (const r of fb.data || []) openFb.set(r.user_id, (openFb.get(r.user_id) || 0) + 1);

    const rows = [];
    for (const mem of m.data || []) {
      if (mem.banned) continue;
      const reasons = [];
      const joined = twDate(mem.created_at);
      const prog = progress.get(mem.user_id) || { watched: 0, completed: 0, last_watched_at: null, done_ids: [] };
      const doneIds = new Set((prog.done_ids || []).map(Number));

      // 等級（三級制度）
      const ts = tierFromRows(mem, vol.data || [], today);
      const period = periodFor(mem, "current", today);
      const vr = volBy.get(`${mem.user_id}:${period.start}`);
      const md = (d) => d.slice(5).replace("-", "/");
      if (mem.free) { /* 贈送名額不分級，不列等級相關的提醒 */ }
      else if (ts.tier === 0) reasons.push({ key: "notier", label: "沒有等級（Discord 身分組可以拿掉）", level: 2 });
      else if (ts.cycleTier < ts.tier && ts.until && !mem.free) {
        // 這一輪還沒達到現在的等級 → 下一輪會降級
        const soon = ts.until <= addDays(today, 7);
        reasons.push({ key: "drop", label: `${md(ts.until)} 後降到${tierName(ts.cycleTier)}（${tierName(ts.tier)}${gapTo(vr?.amounts || {}, ts.tier)}）`, level: soon ? 2 : 1 });
      }
      if (!mem.free && ts.tier >= 3) {
        const pk = pickOf.get(mem.user_id);
        if (!pk) reasons.push({ key: "oneonone", label: "第三級：這個月還沒選一對一講師", level: 1 });
        else if (!pk.booked) reasons.push({ key: "oneonone", label: `一對一：${pk.host} 第 ${pk.rank} 位（${pk.confirmed ? "確定，還沒約時間" : "候補"}）`, level: pk.confirmed ? 2 : 1 });
      }

      // 很久沒來
      const last = prog.last_watched_at || null;
      const daysAway = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
      if (addDays(joined, 7) <= today) {
        if (!last) reasons.push({ key: "inactive", label: "加入後還沒看過影片", level: 2 });
        else if (daysAway >= 14) reasons.push({ key: "inactive", label: `${daysAway} 天沒來看`, level: daysAway >= 30 ? 2 : 1 });
      }

      // 課程落後：已經解鎖、也上架了，但還沒看完的份數
      let unlocked = 0, behind = 0;
      for (let part = 1; part <= COURSE_PARTS; part++) {
        for (const h of COURSE_HOSTS) {
          if (courseUnlockDate(joined, h, part) > today) continue;
          const cv = courseVideo.get(`${h}:${part}`);
          if (!cv) continue;
          unlocked++;
          if (!doneIds.has(Number(cv.id))) behind++;
        }
      }
      if (behind >= 2) reasons.push({ key: "course", label: `課程有 ${behind} 份還沒看完`, level: 1 });

      // 提問
      const q = openFb.get(mem.user_id) || 0;
      if (q) reasons.push({ key: "feedback", label: `${q} 則提問還沒回`, level: 2 });

      rows.push({
        user_id: mem.user_id, email: mem.email, tier: ts.tier, tier_until: ts.until, cycle_tier: ts.cycleTier, min_tier: mem.min_tier, min_tier_until: mem.min_tier_until, note: mem.note, joined,
        last_watched_at: last, watched: prog.watched, completed: prog.completed,
        course: { unlocked, behind },
        reasons, score: reasons.reduce((a, r) => a + r.level, 0),
      });
    }
    rows.sort((a, b) => b.score - a.score || String(a.email).localeCompare(b.email));
    const counts = {};
    for (const r of rows) for (const x of r.reasons) counts[x.key] = (counts[x.key] || 0) + 1;
    return res.status(200).json({ today, counts, rows });
  },
});
