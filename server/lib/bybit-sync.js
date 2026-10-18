// Bybit 自動同步：把已綁定研究員「這一輪」在 Bybit 的交易量抓回來，存進 volumes，達標就延長資格
// Bybit 只給「一段期間的加總」、而且隔天才更新，所以查「這一輪第一天～昨天」，
// 第一次看到超過門檻，就把查詢的最後一天（昨天）記為達標日
import { todayTW } from "./dates.js";
import { saveVolumes, syncPeriods, countFrom } from "./volume.js";
import { tierOf, SITE_TIER } from "../../public/assets/js/shared/rules.js";
import { fetchBybitVolumes, capRange } from "./bybit.js";
import { linkedMembers } from "./bingx-sync.js";

export async function syncBybit({ uid } = {}) {
  const links = await linkedMembers("Bybit", uid);
  const result = { users: links.length, saved: 0, tierUps: 0 };
  if (!links.length) return result;
  const today = todayTW();
  const cache = new Map(); // 同一段期間只查一次
  const entries = [];
  for (const l of links) {
    for (const p of syncPeriods(l.member, today)) {
      const range = capRange(countFrom(l.member, p), p.end, today);
      if (!range) continue; // 這一輪今天才開始，Bybit 還沒有資料
      const key = range.join(":");
      if (!cache.has(key)) cache.set(key, await fetchBybitVolumes(range[0], range[1]));
      const total = Math.round((cache.get(key).get(String(l.exchange_uid)) || 0) * 100) / 100;
      entries.push({ user_id: l.user_id, period: p, amounts: { Bybit: total }, qualifiedOn: tierOf({ Bybit: total }) >= SITE_TIER ? range[1] : today });
    }
  }
  const r = await saveVolumes({ entries, updatedBy: "Bybit 自動同步", merge: true });
  return { ...result, saved: r.saved, tierUps: r.tierUps || 0 };
}
