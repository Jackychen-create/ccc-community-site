// 交易量：金額整理、每人一輪、存檔（規則在 shared/rules.js 的三級制度）
// 每人從加入那天起算，每一輪剛好一個月；這一輪達到第幾級 → 下一輪就是第幾級（等級怎麼算在 tier.js）
import { supabaseAdmin } from "./env.js";
import { twDate, todayTW } from "./dates.js";
import { EXCHANGES, LOCKED_AUTO, SITE_TIER, FIRST_CYCLE_TIER, tierOf, periodOf, nextPeriod, prevPeriod, addDays } from "../../public/assets/js/shared/rules.js";
import { notifyMilestones } from "./milestone.js";
export { EXCHANGES, AUTO_EXCHANGES, LOCKED_AUTO, TIERS, SITE_TIER, tierOf, tierName, goalFor, unitOf, gapTo, tierRuleText, periodOf, nextPeriod, prevPeriod, addMonths, idLabel, cleanExId, exIdOk, exIdError, needsName, cleanAccountName, accountNameOk, ACCOUNT_NAME_ERROR } from "../../public/assets/js/shared/rules.js";

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

// 這一輪的交易量從哪天開始算：平常是這一輪第一天；
// 第一輪如果管理員設了 volume_from（社群舊成員、網站才剛註冊），就從那天開始，加入網站前的量也算進第一輪
export function countFrom(m, p) {
  const f = m?.volume_from;
  return f && p.start === anchorOf(m) && f < p.start ? f : p.start;
}

// 要同步的輪：這一輪；上一輪剛結束 3 天內也再同步一次（Bybit 隔天才更新，補上最後一兩天）
export function syncPeriods(m, today = todayTW()) {
  const cur = periodFor(m, "current", today);
  const prev = prevPeriod(anchorOf(m), cur);
  return prev && addDays(prev.end, 3) >= today ? [cur, prev] : [cur];
}

// 儲存一批交易量（管理員手動填、自動同步都走這裡，規則一致）
// entries: [{ user_id, period: { start, end }, amounts, qualifiedOn }]
//   qualifiedOn：這次如果是「新到第二級」，記哪一天（管理員選的日期，或交易所實際跨過的那天）；存在 volumes.qualified_at
// merge=true：只更新 entries 給的交易所，其他交易所保留原本的數字（自動同步用）
// keepAuto=true：自動同步的交易所一律保留資料庫裡的數字，不被手動儲存蓋掉（管理員儲存用）
// 等級不用另外存：每次都從上一輪、這一輪的交易量算（tier.js）
// 這一輪升級（例如第一級 → 第二級）會通知研究員一次（milestone.js）
export async function saveVolumes({ entries, updatedBy, merge = false, keepAuto = false }) {
  const ids = [...new Set(entries.map((e) => e.user_id))];
  if (!ids.length) return { saved: 0, newlyQualified: [], tierUps: 0 };
  const starts = [...new Set(entries.map((e) => e.period.start))];
  const [{ data: members, error }, { data: prev, error: e2 }] = await Promise.all([
    supabaseAdmin.from("members").select("user_id, created_at, min_tier, min_tier_until").in("user_id", ids),
    supabaseAdmin.from("volumes").select("user_id, period_start, amounts, qualified_at").in("user_id", ids).in("period_start", starts),
  ]);
  if (error || e2) throw error || e2;
  const known = new Map((members || []).map((m) => [m.user_id, m]));
  const before = new Map((prev || []).map((v) => [`${v.user_id}:${v.period_start}`, v]));

  const upserts = [];
  const newlyQualified = [];
  const hits = []; // 這次升級的人（這一輪達到的等級變高）
  for (const e of entries) {
    const m = known.get(e.user_id);
    if (!m) continue;
    const old = before.get(`${m.user_id}:${e.period.start}`);
    let raw = merge ? { ...(old?.amounts || {}), ...e.amounts } : { ...(e.amounts || {}) };
    if (keepAuto) for (const ex of LOCKED_AUTO) {
      if (old?.amounts?.[ex] !== undefined) raw[ex] = old.amounts[ex];
      else delete raw[ex];
    }
    const amounts = cleanAmounts(raw);
    // 自動同步時數字沒變就不寫，免得「最後更新」一直被改成自動同步
    if (merge && old && JSON.stringify(amounts) === JSON.stringify(cleanAmounts(old.amounts))) continue;
    const tier = tierOf(amounts);
    const ok = tier >= SITE_TIER;
    // 到第二級的日子要落在這一輪裡
    let qOn = e.qualifiedOn || todayTW();
    if (qOn < e.period.start) qOn = e.period.start;
    if (qOn > e.period.end) qOn = e.period.end;
    const qualified_at = ok ? old?.qualified_at || qOn : null;
    // 升級通知：只看這一輪（和剛結束 3 天內的上一輪）
    // 本來就有的等級（第一輪先給的、管理員手動給的）比這次高或一樣，就不用恭喜「升上」較低的那一級
    const given = Math.max(e.period.start === anchorOf(m) ? FIRST_CYCLE_TIER : 0, m.min_tier && (!m.min_tier_until || m.min_tier_until >= todayTW()) ? m.min_tier : 0);
    if (tier > tierOf(cleanAmounts(old?.amounts || {})) && tier >= given && addDays(e.period.end, 3) >= todayTW()) {
      hits.push({ user_id: m.user_id, period: e.period, level: tier, amounts, nextEnd: nextPeriod(anchorOf(m), e.period).end });
    }
    upserts.push({ user_id: m.user_id, period_start: e.period.start, period_end: e.period.end, amounts, qualified_at, updated_at: new Date().toISOString(), updated_by: updatedBy });
    if (ok && !old?.qualified_at) newlyQualified.push(m.user_id);
  }
  if (!upserts.length) return { saved: 0, newlyQualified, tierUps: 0 };
  const { error: upErr } = await supabaseAdmin.from("volumes").upsert(upserts, { onConflict: "user_id,period_start" });
  if (upErr) throw upErr;
  // 通知失敗不影響存檔
  let milestones = { recorded: 0, sent: 0 };
  try { milestones = await notifyMilestones(hits); } catch (err) { console.error("milestone notify failed", err?.message); }
  return { saved: upserts.length, newlyQualified, tierUps: hits.length, milestones };
}
