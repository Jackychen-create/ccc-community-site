// BingX 自動同步：把已綁定研究員這個月在 BingX 的交易量抓回來，存進 volumes，達標就延長資格
// 觸發：見 autosync.js
import { supabaseAdmin } from "./env.js";
import { todayTW, twDate } from "./dates.js";
import { getThreshold, saveVolumes } from "./volume.js";
import { fetchDaily, monthRanges, summarize } from "./bingx.js";

export const SYNC_BY = "BingX 自動同步";

// 同步一個月；uid 給了就只同步那個 BingX UID
export async function syncBingxMonth(month, { uid } = {}) {
  let q = supabaseAdmin.from("exchange_links").select("user_id, exchange_uid").eq("exchange", "BingX");
  if (uid) q = q.eq("exchange_uid", String(uid));
  const { data: links, error } = await q;
  if (error) throw error;
  const result = { month, users: links?.length || 0, saved: 0, extended: 0 };
  if (!links?.length) return result;
  const ranges = monthRanges(month, todayTW());
  if (!ranges.length) return result;
  const list = [];
  for (const [a, b] of ranges) list.push(...(await fetchDaily(a, b, uid)));
  const threshold = await getThreshold();
  const sums = summarize(list.filter((r) => twDate(Number(r.commissionTime)).startsWith(month)), threshold, (ms) => twDate(ms));
  const entries = links.map((l) => {
    const s = sums.get(String(l.exchange_uid)) || { total: 0, qualifiedOn: null };
    return { user_id: l.user_id, amounts: { BingX: s.total }, qualifiedOn: s.qualifiedOn || todayTW() };
  });
  const r = await saveVolumes({ month, entries, updatedBy: SYNC_BY, merge: true });
  return { ...result, saved: r.saved, extended: r.extended };
}
