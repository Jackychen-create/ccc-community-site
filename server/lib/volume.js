// 交易量：門檻、金額整理、每人一輪的資格（規則在 shared/rules.js）
// 每人從加入那天起算，每一輪剛好一個月；這一輪達標 → 可以看到下一輪結束；沒達標 → 下一輪第一天就不能看
import { supabaseAdmin } from "./env.js";
import { twDate, todayTW } from "./dates.js";
import { EXCHANGES, AUTO_EXCHANGES, DEFAULT_THRESHOLD, isQualified, milestoneOf, periodOf, nextPeriod, prevPeriod, addDays } from "../../public/assets/js/shared/rules.js";
import { notifyMilestones } from "./milestone.js";
export { EXCHANGES, AUTO_EXCHANGES, LOT_GOALS, DEFAULT_THRESHOLD, isQualified, goalOf, unitOf, gapText, ruleText, periodOf, nextPeriod, prevPeriod, addMonths, idLabel, cleanExId, exIdOk, exIdError, needsName, cleanAccountName, accountNameOk, ACCOUNT_NAME_ERROR } from "../../public/assets/js/shared/rules.js";

export async function getThreshold() {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", "volume_threshold").maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD;
}
// 只收合作交易所、0 以上的數字，四捨五入到小數 2 位
export function cleanAmounts(v) {
  const out = {};
  for (const ex of EXCHANGES) {
    const n = Number(v?.[ex]);
    if (Number.isFinite(n) && n >= 0 && n <= 1e13) out[ex] = Math.round(n * 100) / 100;
  }
  return out;
}

// 一輪從哪天開始算：加入那天（台灣日期）
export const anchorOf = (m) => twDate(m.created_at);

// 某位研究員「這一輪」或「上一輪」：which = "current" | "previous"
export function periodFor(m, which = "current", today = todayTW()) {
  const cur = periodOf(anchorOf(m), today);
  return which === "previous" ? prevPeriod(anchorOf(m), cur) : cur;
}

// 要同步的輪：這一輪；上一輪剛結束 3 天內也再同步一次（Bybit 隔天才更新，補上最後一兩天）
export function syncPeriods(m, today = todayTW()) {
  const cur = periodFor(m, "current", today);
  const prev = prevPeriod(anchorOf(m), cur);
  return prev && addDays(prev.end, 3) >= today ? [cur, prev] : [cur];
}

// 儲存一批交易量，並處理資格（管理員手動填、自動同步都走這裡，規則一致）
// entries: [{ user_id, period: { start, end }, amounts, qualifiedOn }]
//   qualifiedOn：這次如果是「新達標」，達標日記哪一天（管理員選的日期，或交易所實際跨過門檻的那天）
// merge=true：只更新 entries 給的交易所，其他交易所保留原本的數字（自動同步用）
// keepAuto=true：自動同步的交易所一律保留資料庫裡的數字，不被手動儲存蓋掉（管理員儲存用）
// 規則：同一輪已經達標過的不會再延；新達標的資格延長到「下一輪」結束；原本更晚的不縮短；「不限」（空白）的研究員不動
export async function saveVolumes({ entries, updatedBy, merge = false, keepAuto = false }) {
  const threshold = await getThreshold();
  const ids = [...new Set(entries.map((e) => e.user_id))];
  if (!ids.length) return { saved: 0, extended: 0, newlyQualified: [] };
  const starts = [...new Set(entries.map((e) => e.period.start))];
  const [{ data: members, error }, { data: prev, error: e2 }] = await Promise.all([
    supabaseAdmin.from("members").select("user_id, access_until, created_at").in("user_id", ids),
    supabaseAdmin.from("volumes").select("user_id, period_start, amounts, qualified_at").in("user_id", ids).in("period_start", starts),
  ]);
  if (error || e2) throw error || e2;
  const known = new Map((members || []).map((m) => [m.user_id, m]));
  const before = new Map((prev || []).map((v) => [`${v.user_id}:${v.period_start}`, v]));

  const upserts = [];
  const extend = new Map(); // 新的到期日 → [user_id]
  const newlyQualified = [];
  const hits = []; // 這次跨過的里程碑（25／50／75／100%）
  for (const e of entries) {
    const m = known.get(e.user_id);
    if (!m) continue;
    const old = before.get(`${m.user_id}:${e.period.start}`);
    let raw = merge ? { ...(old?.amounts || {}), ...e.amounts } : { ...(e.amounts || {}) };
    if (keepAuto) for (const ex of AUTO_EXCHANGES) {
      if (old?.amounts?.[ex] !== undefined) raw[ex] = old.amounts[ex];
      else delete raw[ex];
    }
    const amounts = cleanAmounts(raw);
    // 自動同步時數字沒變就不寫，免得「最後更新」一直被改成自動同步
    if (merge && old && JSON.stringify(amounts) === JSON.stringify(cleanAmounts(old.amounts))) continue;
    const ok = isQualified(amounts, threshold);
    // 達標日要落在這一輪裡
    let qOn = e.qualifiedOn || todayTW();
    if (qOn < e.period.start) qOn = e.period.start;
    if (qOn > e.period.end) qOn = e.period.end;
    const qualified_at = ok ? old?.qualified_at || qOn : null;
    // 進度里程碑：只看這一輪（和剛結束 3 天內的上一輪），跨過新的一格才通知
    const lvl = milestoneOf(amounts, threshold);
    if (lvl > milestoneOf(cleanAmounts(old?.amounts || {}), threshold) && addDays(e.period.end, 3) >= todayTW()) {
      hits.push({ user_id: m.user_id, period: e.period, level: lvl, amounts, nextEnd: nextPeriod(anchorOf(m), e.period).end });
    }
    upserts.push({ user_id: m.user_id, period_start: e.period.start, period_end: e.period.end, amounts, qualified_at, updated_at: new Date().toISOString(), updated_by: updatedBy });
    if (ok && !old?.qualified_at) {
      newlyQualified.push(m.user_id);
      const until = nextPeriod(anchorOf(m), e.period).end;
      if (m.access_until && m.access_until < until) {
        if (!extend.has(until)) extend.set(until, []);
        extend.get(until).push(m.user_id);
      }
    }
  }
  if (!upserts.length) return { saved: 0, extended: 0, newlyQualified };
  const { error: upErr } = await supabaseAdmin.from("volumes").upsert(upserts, { onConflict: "user_id,period_start" });
  if (upErr) throw upErr;
  let extended = 0;
  for (const [until, list] of extend) {
    const { error: exErr } = await supabaseAdmin.from("members").update({ access_until: until }).in("user_id", list);
    if (exErr) throw exErr;
    extended += list.length;
  }
  // 通知失敗不影響存檔
  let milestones = { recorded: 0, sent: 0 };
  try { milestones = await notifyMilestones(hits, threshold); } catch (err) { console.error("milestone notify failed", err?.message); }
  return { saved: upserts.length, extended, newlyQualified, milestones };
}
