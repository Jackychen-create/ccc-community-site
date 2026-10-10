// 後台：待跟進的研究員
// GET /api/admin/followup
// 每位研究員列出需要注意的地方：已過期、快到期、這個月還沒達標、很久沒來、課程落後、有提問還沒回
import {
  supabaseAdmin, requireAdmin, route, todayTW, thisMonthTW, twDate, addDays,
  getThreshold, isQualified, EXCHANGES, COURSE_HOSTS, COURSE_PARTS, courseUnlockDate,
} from "../lib/index.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const today = todayTW();
    const month = thisMonthTW();
    const [threshold, m, v, p, vol, fb] = await Promise.all([
      getThreshold(),
      supabaseAdmin.from("members").select("user_id, email, banned, access_until, note, created_at"),
      supabaseAdmin.from("videos").select("id, course_host, course_part").eq("is_published", true).not("course_host", "is", null),
      // 每位研究員看過幾場、看完哪幾場：資料庫算好（supabase/schema.sql 的 admin_member_progress）
      supabaseAdmin.rpc("admin_member_progress"),
      supabaseAdmin.from("volumes").select("user_id, amounts, qualified_at").eq("month", month),
      supabaseAdmin.from("feedback").select("user_id").eq("status", "open"),
    ]);
    for (const r of [m, v, p, vol, fb]) if (r.error) throw r.error;

    const courseVideo = new Map((v.data || []).map((x) => [`${x.course_host}:${x.course_part}`, x]));
    const progress = new Map((p.data || []).map((r) => [r.user_id, r]));
    const volBy = new Map((vol.data || []).map((x) => [x.user_id, x]));
    const openFb = new Map();
    for (const r of fb.data || []) openFb.set(r.user_id, (openFb.get(r.user_id) || 0) + 1);

    const rows = [];
    for (const mem of m.data || []) {
      if (mem.banned) continue;
      const reasons = [];
      const joined = twDate(mem.created_at);
      const prog = progress.get(mem.user_id) || { watched: 0, completed: 0, last_watched_at: null, done_ids: [] };
      const doneIds = new Set((prog.done_ids || []).map(Number));

      // 資格
      if (mem.access_until && mem.access_until < today) reasons.push({ key: "expired", label: `已過期（${mem.access_until.slice(5).replace("-", "/")}）`, level: 3 });
      else if (mem.access_until && mem.access_until <= addDays(today, 7)) reasons.push({ key: "expiring", label: `${mem.access_until.slice(5).replace("-", "/")} 到期`, level: 2 });

      // 這個月交易量（「不限」的人不用看）
      const vr = volBy.get(mem.user_id);
      let best = 0;
      if (vr) best = Math.max(0, ...EXCHANGES.map((ex) => Number(vr.amounts?.[ex] || 0)));
      if (mem.access_until && !(vr && isQualified(vr.amounts, threshold))) {
        reasons.push({ key: "volume", label: vr ? `這個月還差 ${Math.round((threshold - best) / 1e4)} 萬` : "這個月還沒有交易量", level: 1 });
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
        user_id: mem.user_id, email: mem.email, access_until: mem.access_until, note: mem.note, joined,
        last_watched_at: last, watched: prog.watched, completed: prog.completed,
        course: { unlocked, behind }, volume_best: best, threshold,
        reasons, score: reasons.reduce((a, r) => a + r.level, 0),
      });
    }
    rows.sort((a, b) => b.score - a.score || String(a.email).localeCompare(b.email));
    const counts = {};
    for (const r of rows) for (const x of r.reasons) counts[x.key] = (counts[x.key] || 0) + 1;
    return res.status(200).json({ today, month, counts, rows });
  },
});
