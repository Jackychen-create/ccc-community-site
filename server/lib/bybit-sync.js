// Bybit 自動同步：把已綁定研究員這個月在 Bybit 的交易量抓回來，存進 volumes，達標就延長資格
// Bybit 只給「一段期間的加總」、而且隔天才更新，所以每天同步時第一次看到超過門檻，就把「查詢的最後一天（昨天）」記為達標日
import { supabaseAdmin } from "./env.js";
import { todayTW } from "./dates.js";
import { getThreshold, saveVolumes } from "./volume.js";
import { isQualified } from "../../public/assets/js/shared/rules.js";
import { fetchBybitVolumes, bybitRange } from "./bybit.js";

// 同步一個月；uid 給了就只存那個 Bybit UID（Bybit 沒有單一 UID 的區間查詢，所以還是抓整份清單）
export async function syncBybitMonth(month, { uid } = {}) {
  let q = supabaseAdmin.from("exchange_links").select("user_id, exchange_uid").eq("exchange", "Bybit");
  if (uid) q = q.eq("exchange_uid", String(uid));
  const { data: links, error } = await q;
  if (error) throw error;
  const result = { month, users: links?.length || 0, saved: 0, extended: 0 };
  if (!links?.length) return result;
  const range = bybitRange(month, todayTW());
  if (!range) return result;
  const vols = await fetchBybitVolumes(range[0], range[1]);
  const threshold = await getThreshold();
  const entries = links.map((l) => {
    const total = Math.round((vols.get(String(l.exchange_uid)) || 0) * 100) / 100;
    return { user_id: l.user_id, amounts: { Bybit: total }, qualifiedOn: isQualified({ Bybit: total }, threshold) ? range[1] : todayTW() };
  });
  const r = await saveVolumes({ month, entries, updatedBy: "Bybit 自動同步", merge: true });
  return { ...result, saved: r.saved, extended: r.extended };
}
