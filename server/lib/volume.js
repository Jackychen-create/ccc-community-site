// 每月交易量：門檻、金額整理（規則在 shared/rules.js）
import { supabaseAdmin } from "./env.js";
import { EXCHANGES, AUTO_EXCHANGES, DEFAULT_THRESHOLD, isQualified, cycleEnd } from "../../public/assets/js/shared/rules.js";
export { EXCHANGES, AUTO_EXCHANGES, DEFAULT_THRESHOLD, isQualified } from "../../public/assets/js/shared/rules.js";

export async function getThreshold() {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", "volume_threshold").maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD;
}
// 只收三間交易所、0 以上的數字，四捨五入到小數 2 位
export function cleanAmounts(v) {
  const out = {};
  for (const ex of EXCHANGES) {
    const n = Number(v?.[ex]);
    if (Number.isFinite(n) && n >= 0 && n <= 1e13) out[ex] = Math.round(n * 100) / 100;
  }
  return out;
}

// 儲存一批交易量，並處理資格（管理員手動填、BingX 自動同步都走這裡，規則一致）
// entries: [{ user_id, amounts, qualifiedOn }]
//   qualifiedOn：這次如果是「新達標」，達標日記哪一天（管理員選的日期，或 BingX 實際跨過門檻的那天）
// merge=true：只更新 entries 給的交易所，其他交易所保留原本的數字（自動同步用）
// keepAuto=true：自動同步的交易所（BingX）一律保留資料庫裡的數字，不被手動儲存蓋掉（管理員儲存用）
// 規則：同一個月已經達標過的沿用原本的達標日、不會再延；新達標的資格延長到達標日起一個月；
//       原本更晚的不縮短；「不限」（空白）的研究員不動
export async function saveVolumes({ month, entries, updatedBy, merge = false, keepAuto = false }) {
  const threshold = await getThreshold();
  const ids = [...new Set(entries.map((e) => e.user_id))];
  if (!ids.length) return { saved: 0, extended: 0, newlyQualified: [] };
  const [{ data: members, error }, { data: prev, error: e2 }] = await Promise.all([
    supabaseAdmin.from("members").select("user_id, access_until").in("user_id", ids),
    supabaseAdmin.from("volumes").select("user_id, amounts, qualified_at").eq("month", month).in("user_id", ids),
  ]);
  if (error || e2) throw error || e2;
  const known = new Map((members || []).map((m) => [m.user_id, m]));
  const before = new Map((prev || []).map((v) => [v.user_id, v]));

  const upserts = [];
  const extend = new Map(); // 新的到期日 → [user_id]
  const newlyQualified = [];
  for (const e of entries) {
    const m = known.get(e.user_id);
    if (!m) continue;
    const old = before.get(m.user_id);
    let raw = merge ? { ...(old?.amounts || {}), ...e.amounts } : { ...(e.amounts || {}) };
    if (keepAuto) for (const ex of AUTO_EXCHANGES) {
      if (old?.amounts?.[ex] !== undefined) raw[ex] = old.amounts[ex];
      else delete raw[ex];
    }
    const amounts = cleanAmounts(raw);
    // 自動同步時數字沒變就不寫，免得「最後更新」一直被改成自動同步
    if (merge && old && JSON.stringify(amounts) === JSON.stringify(cleanAmounts(old.amounts))) continue;
    const ok = isQualified(amounts, threshold);
    const qualified_at = ok ? old?.qualified_at || e.qualifiedOn : null;
    upserts.push({ user_id: m.user_id, month, amounts, qualified_at, updated_at: new Date().toISOString(), updated_by: updatedBy });
    if (ok && !old?.qualified_at) {
      newlyQualified.push(m.user_id);
      const until = cycleEnd(qualified_at);
      if (m.access_until && m.access_until < until) {
        if (!extend.has(until)) extend.set(until, []);
        extend.get(until).push(m.user_id);
      }
    }
  }
  if (!upserts.length) return { saved: 0, extended: 0, newlyQualified };
  const { error: upErr } = await supabaseAdmin.from("volumes").upsert(upserts);
  if (upErr) throw upErr;
  let extended = 0;
  for (const [until, list] of extend) {
    const { error: exErr } = await supabaseAdmin.from("members").update({ access_until: until }).in("user_id", list);
    if (exErr) throw exErr;
    extended += list.length;
  }
  return { saved: upserts.length, extended, newlyQualified };
}
