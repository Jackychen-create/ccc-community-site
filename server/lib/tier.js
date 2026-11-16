// 三級制度：某位研究員今天是第幾級（規則在 shared/rules.js 的 TIERS、tierStatus）
// 看「上一輪」和「這一輪」的交易量，加上管理員手動給的等級（members.min_tier、min_tier_until）
import { supabaseAdmin } from "./env.js";
import { twDate, todayTW } from "./dates.js";
import { tierStatus, periodOf, prevPeriod, SITE_TIER, MAX_TIER, usdtEquiv, unitStatus, unitTier } from "../../public/assets/js/shared/rules.js";
import { unitOn } from "./membership.js";
import { memberPaid, paidFor } from "./pay.js";

export const overrideOf = (m) => (m?.min_tier ? { tier: m.min_tier, until: m.min_tier_until || null } : null);

// 贈送名額不分級：一直照第二級開網站內容（不升也不降），free: true 讓畫面不顯示等級
const freeStatus = (member, today) => ({ tier: SITE_TIER, until: null, cycleTier: SITE_TIER, period: periodOf(twDate(member.created_at), today), free: true });

// 單位制（membership.unitFrom 那天起）：全部的輪加起來算累計，等級一律第二級、累計 100 萬第三級；回傳多一個 unit
function unitFromRows(member, rows, today) {
  const period = periodOf(twDate(member.created_at), today);
  const cum = rows.filter((r) => r.user_id === undefined || r.user_id === member.user_id).reduce((s, r) => s + usdtEquiv(r.amounts), 0);
  const ovOn = member.min_tier && (!member.min_tier_until || member.min_tier_until >= today) ? member.min_tier : 0;
  const unit = unitStatus(cum, { allCourse: !!member.free || ovOn >= MAX_TIER, oneOnOne: !member.free && ovOn >= MAX_TIER });
  const tier = member.free ? SITE_TIER : unitTier(unit);
  return { tier, until: null, cycleTier: tier, period, unit, ...(member.free ? { free: true } : {}) };
}

// member 要有 user_id、created_at、min_tier、min_tier_until（有 free 的話贈送名額不分級）
export async function memberTier(member, today = todayTW()) {
  // 付費制（v1.28.0）：付費的研究員看月費和買了哪幾集；照舊的人往下照原本的規則
  const paid = await memberPaid(member, today);
  if (paid) return paid;
  if (await unitOn(today)) {
    const { data, error } = await supabaseAdmin.from("volumes").select("amounts").eq("user_id", member.user_id);
    if (error) throw error;
    return unitFromRows(member, data || [], today);
  }
  if (member.free) return freeStatus(member, today);
  const anchor = twDate(member.created_at);
  const cur = periodOf(anchor, today);
  const prev = prevPeriod(anchor, cur);
  const starts = [cur.start, prev?.start].filter(Boolean);
  const { data, error } = await supabaseAdmin.from("volumes").select("period_start, amounts").eq("user_id", member.user_id).in("period_start", starts);
  if (error) throw error;
  const by = new Map((data || []).map((r) => [r.period_start, r.amounts || {}]));
  return tierStatus({ anchor, today, amountsOf: (s) => by.get(s) || {}, override: overrideOf(member) });
}

// 很多人一次算（後台列表用）：volRows 是這些人的交易量（至少含上一輪、這一輪）
// unit＝單位制（volRows 要含這個人全部的輪）
export function tierFromRows(member, volRows, today = todayTW(), unit = false) {
  if (unit) return unitFromRows(member, volRows.filter((r) => r.user_id === member.user_id), today);
  if (member.free) return freeStatus(member, today);
  const by = new Map(volRows.filter((r) => r.user_id === member.user_id).map((r) => [r.period_start, r.amounts || {}]));
  return tierStatus({ anchor: twDate(member.created_at), today, amountsOf: (s) => by.get(s) || {}, override: overrideOf(member) });
}

// 一次算很多人的等級：回傳 Map(user_id → tierStatus)
// 交易量只要抓最近 70 天開始的輪（上一輪＋這一輪一定在裡面）
export async function tiersFor(members, today = todayTW()) {
  const ids = members.map((m) => m.user_id);
  if (!ids.length) return new Map();
  const paid = await paidFor(members, today); // 付費的研究員（照舊的不在裡面）
  const unit = await unitOn(today);
  const since = unit ? "2000-01-01" : new Date(Date.parse(today + "T00:00:00Z") - 70 * 86400e3).toISOString().slice(0, 10); // 單位制要全部的輪
  const { data, error } = await supabaseAdmin.from("volumes").select("user_id, period_start, amounts").in("user_id", ids).gte("period_start", since);
  if (error) throw error;
  return new Map(members.map((m) => [m.user_id, paid.get(m.user_id) || tierFromRows(m, data || [], today, unit)]));
}
