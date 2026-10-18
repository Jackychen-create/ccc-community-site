// 連續打卡、每週任務（規則在 shared/rules.js 的 streakOf、QUESTS）
// 打卡：研究員打開網站（GET /api/me）就記今天；每週任務：GET /api/quests 算這週的進度
import { supabaseAdmin } from "./env.js";
import { todayTW, twDate } from "./dates.js";
import { streakOf, bestStreakOf, weekOf, addDays, periodOf, EXCHANGES, QUESTS, weeklyVolumeRatio } from "../../public/assets/js/shared/rules.js";

const DONE = 0.95; // 看到片長 95% 算看完
// 台灣日期 00:00 → ISO（UTC 前一天 16:00）
const twStartIso = (date) => new Date(Date.parse(date + "T00:00:00Z") - 8 * 3600e3).toISOString();

// 記今天打卡，回傳 { days 連續幾天, best 最長幾天 }；表還沒建立時回 null
export async function checkin(userId, today = todayTW()) {
  const { error } = await supabaseAdmin.from("checkins").upsert({ user_id: userId, day: today }, { onConflict: "user_id,day", ignoreDuplicates: true });
  if (error) throw error;
  const { data, error: e2 } = await supabaseAdmin.from("checkins").select("day").eq("user_id", userId).gte("day", addDays(today, -400));
  if (e2) throw e2;
  const days = (data || []).map((r) => r.day);
  return { days: streakOf(days, today), best: bestStreakOf(days) };
}

// 這週新增的交易量：第一次打開這週任務時記下當時這一輪的交易量當起點；這週中間換輪的話，上一輪剩下的＋新一輪的都算
async function weekVolumeDelta(userId, member, row, today) {
  const cur = periodOf(twDate(member.created_at), today);
  const base = row?.base || null;
  const starts = [cur.start, base?.period_start].filter(Boolean);
  const { data } = await supabaseAdmin.from("volumes").select("period_start, amounts").eq("user_id", userId).in("period_start", [...new Set(starts)]);
  const amountsOf = (s) => (data || []).find((v) => v.period_start === s)?.amounts || {};
  const now = amountsOf(cur.start);
  if (!base) return { delta: {}, base: { period_start: cur.start, amounts: now } };
  const delta = {};
  for (const ex of EXCHANGES) {
    const b = Number(base.amounts?.[ex] || 0);
    delta[ex] = base.period_start === cur.start
      ? Math.max(0, Number(now[ex] || 0) - b)
      : Math.max(0, Number(amountsOf(base.period_start)[ex] || 0) - b) + Number(now[ex] || 0);
  }
  return { delta, base };
}

// 這週的三個任務、累積完成幾週；全部完成的那一刻記 done_at（justDone＝這次才剛完成，前台跳一次恭喜）
export async function weeklyQuests(userId, member, today = todayTW()) {
  const week = weekOf(today);
  const since = twStartIso(week.start);
  const [{ data: row }, { data: prog }, { count: notes }] = await Promise.all([
    supabaseAdmin.from("quest_weeks").select("week, base, done_at").eq("user_id", userId).eq("week", week.start).maybeSingle(),
    supabaseAdmin.from("watch_progress").select("video_id, position_sec, duration_sec, updated_at").eq("user_id", userId).gte("updated_at", since),
    supabaseAdmin.from("notes").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since),
  ]);
  const ids = (prog || []).map((p) => p.video_id);
  const { data: vids } = ids.length ? await supabaseAdmin.from("videos").select("id, duration_sec").in("id", ids) : { data: [] };
  const durOf = new Map((vids || []).map((v) => [Number(v.id), Number(v.duration_sec || 0)]));
  const watched = (prog || []).filter((p) => { const d = durOf.get(Number(p.video_id)) || Number(p.duration_sec || 0); return d > 0 && p.position_sec >= d * DONE; }).length;
  const { delta, base } = await weekVolumeDelta(userId, member, row, today);
  const value = { watch: watched, notes: notes || 0, volume: weeklyVolumeRatio(delta) };
  const quests = QUESTS.map((q) => {
    const v = value[q.id];
    return { id: q.id, icon: q.icon, name: q.name, target: q.target, progress: Math.min(q.target, q.id === "volume" ? Math.round(v * 100) / 100 : v), done: v >= q.target };
  });
  const allDone = quests.every((q) => q.done);
  let justDone = false;
  if (!row) {
    await supabaseAdmin.from("quest_weeks").insert({ user_id: userId, week: week.start, base, done_at: allDone ? new Date().toISOString() : null });
    justDone = allDone;
  } else if (allDone && !row.done_at) {
    await supabaseAdmin.from("quest_weeks").update({ done_at: new Date().toISOString() }).eq("user_id", userId).eq("week", week.start);
    justDone = true;
  }
  const { count: weeksDone } = await supabaseAdmin.from("quest_weeks").select("week", { count: "exact", head: true }).eq("user_id", userId).not("done_at", "is", null);
  return { week, quests, allDone, justDone, weeksDone: weeksDone || 0, delta };
}
