// 徽章：整理研究員的事實 → 算出拿到哪些（規則在 shared/rules.js 的 BADGES）→ 新拿到的記進 badges 表
// 研究員首頁打開時算一次（GET /api/badges），不用排程
import { supabaseAdmin } from "./env.js";
import { twDate } from "./dates.js";
import { BADGES, earnedBadges, bestStreakOf, progressTo, tierOf, SITE_TIER, periodOf, COURSE_HOSTS, COURSE_PARTS, EXCHANGES } from "../../public/assets/js/shared/rules.js";

const DONE = 0.95; // 看到片長 95% 算看完（跟後台觀看統計一樣）

// 最多連續幾輪第二級以上：每一筆交易量換成「第幾輪」，看連在一起最長的一段
export function longestStreak(anchor, rows) {
  const idx = [...new Set(rows.filter((r) => tierOf(r.amounts) >= SITE_TIER).map((r) => periodOf(anchor, r.period_start).index))].sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  for (const i of idx) {
    run = prev !== null && i === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = i;
  }
  return best;
}

export async function badgeFacts(userId, member) {
  const [vols, prog, vids, notes, fb, qw, ck] = await Promise.all([
    supabaseAdmin.from("volumes").select("period_start, amounts, qualified_at").eq("user_id", userId),
    supabaseAdmin.from("watch_progress").select("video_id, position_sec, duration_sec").eq("user_id", userId),
    supabaseAdmin.from("videos").select("id, duration_sec, course_host, course_part").eq("is_published", true),
    supabaseAdmin.from("notes").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabaseAdmin.from("feedback").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabaseAdmin.from("quest_weeks").select("week", { count: "exact", head: true }).eq("user_id", userId).not("done_at", "is", null),
    supabaseAdmin.from("checkins").select("day").eq("user_id", userId),
  ]);
  for (const r of [vols, prog, vids]) if (r.error) throw r.error;
  const rows = vols.data || [];
  const anchor = twDate(member.created_at);
  const vidBy = new Map((vids.data || []).map((v) => [Number(v.id), v]));
  const done = (prog.data || []).filter((p) => {
    const dur = Number(vidBy.get(Number(p.video_id))?.duration_sec || p.duration_sec || 0);
    return dur > 0 && p.position_sec >= dur * DONE;
  }).map((p) => vidBy.get(Number(p.video_id))).filter(Boolean);
  const course = done.filter((v) => v.course_host && COURSE_HOSTS.includes(v.course_host));
  const hostsDone = COURSE_HOSTS.filter((h) => new Set(course.filter((v) => v.course_host === h).map((v) => v.course_part)).size >= COURSE_PARTS);
  return {
    traded: rows.some((r) => EXCHANGES.some((ex) => Number(r.amounts?.[ex] || 0) > 0)),
    bestPct: Math.max(0, ...rows.map((r) => progressTo(r.amounts || {}, SITE_TIER).ratio * 100)),
    qualified: rows.filter((r) => tierOf(r.amounts) >= SITE_TIER).length,
    maxTier: Math.max(0, ...rows.map((r) => tierOf(r.amounts))),
    streak: longestStreak(anchor, rows),
    hostsDone,
    courseDone: new Set(course.map((v) => `${v.course_host}:${v.course_part}`)).size,
    liveDone: done.filter((v) => !v.course_host).length,
    notes: notes.count || 0,
    questions: fb.count || 0,
    questWeeks: qw.count || 0,
    bestStreak: bestStreakOf((ck.data || []).map((r) => r.day)),
  };
}

// 算出徽章、把新拿到的記下來；回傳 [{ id, earnedAt, isNew }]（isNew：還沒在網站上看過恭喜）
// 已經拿過的徽章不會因為數字變少被收回
export async function syncBadges(userId, member) {
  const facts = await badgeFacts(userId, member);
  const { data: had, error } = await supabaseAdmin.from("badges").select("badge, earned_at, seen").eq("user_id", userId);
  if (error) throw error;
  const hadIds = new Set((had || []).map((r) => r.badge));
  const fresh = earnedBadges(facts).filter((id) => !hadIds.has(id));
  const now = new Date().toISOString();
  if (fresh.length) {
    const { error: e2 } = await supabaseAdmin.from("badges").insert(fresh.map((badge) => ({ user_id: userId, badge, earned_at: now, seen: false })));
    if (e2) throw e2;
  }
  const all = [...(had || []), ...fresh.map((badge) => ({ badge, earned_at: now, seen: false }))];
  const order = new Map(BADGES.map((b, i) => [b.id, i]));
  return {
    facts,
    badges: all.filter((r) => order.has(r.badge)).sort((a, b) => order.get(a.badge) - order.get(b.badge)).map((r) => ({ id: r.badge, earnedAt: r.earned_at, isNew: !r.seen })),
  };
}
export async function earnedIds(userId) {
  const { data } = await supabaseAdmin.from("badges").select("badge").eq("user_id", userId);
  return (data || []).map((r) => r.badge);
}
