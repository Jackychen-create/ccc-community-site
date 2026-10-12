// BingX 自動同步：把已綁定研究員這個月在 BingX 的交易量抓回來，存進 volumes，達標就延長資格
// 觸發：每天排程（/api/cron/bingx）、後台「立即同步」、研究員剛綁定時（只同步他一個人）
import { supabaseAdmin } from "./env.js";
import { todayTW, twDate, thisMonthTW } from "./dates.js";
import { getThreshold, saveVolumes } from "./volume.js";
import { fetchDaily, monthRanges, summarize, bingxConfigured } from "./bingx.js";

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

// 同步這個月；每月 1–3 號也再同步一次上個月，補上月底最後幾天的數字
export async function syncBingx() {
  if (!bingxConfigured()) throw new Error("還沒設定 BingX API Key");
  const today = todayTW();
  const months = [thisMonthTW()];
  if (Number(today.slice(8, 10)) <= 3) {
    const [y, m] = today.split("-").map(Number);
    months.push(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`);
  }
  const status = { at: new Date().toISOString(), ok: true, months: [] };
  try {
    for (const month of months) status.months.push(await syncBingxMonth(month));
  } catch (e) {
    status.ok = false;
    status.error = String(e?.message || e).slice(0, 300);
  }
  await supabaseAdmin.from("settings").upsert({ key: "bingx_sync", value: status });
  return status;
}

export async function lastSync() {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", "bingx_sync").maybeSingle();
  return data?.value || null;
}
