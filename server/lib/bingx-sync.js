// BingX 自動同步：把已綁定研究員「這一輪」在 BingX 的交易量抓回來，存進 volumes，達標就延長資格
// BingX 給每天的明細，所以每個人的一輪各自加總，累計第一次跨過門檻的那天就是達標日
// 觸發：見 autosync.js
import { supabaseAdmin } from "./env.js";
import { todayTW, twDate } from "./dates.js";
import { saveVolumes, syncPeriods } from "./volume.js";
import { goalFor, SITE_TIER } from "../../public/assets/js/shared/rules.js";
import { fetchDaily, dayChunks, summarize } from "./bingx.js";

export const SYNC_BY = "BingX 自動同步";

// 讀綁定了這間交易所的研究員（含加入日期）；uid 給了就只讀那一位
export async function linkedMembers(exchange, uid) {
  let q = supabaseAdmin.from("exchange_links").select("user_id, exchange_uid").eq("exchange", exchange);
  if (uid) q = q.eq("exchange_uid", String(uid));
  const { data: links, error } = await q;
  if (error) throw error;
  if (!links?.length) return [];
  const { data: mem, error: e2 } = await supabaseAdmin.from("members").select("user_id, created_at").in("user_id", links.map((l) => l.user_id));
  if (e2) throw e2;
  const by = new Map((mem || []).map((m) => [m.user_id, m]));
  return links.filter((l) => by.has(l.user_id)).map((l) => ({ ...l, member: by.get(l.user_id) }));
}

export async function syncBingx({ uid } = {}) {
  const links = await linkedMembers("BingX", uid);
  const result = { users: links.length, saved: 0, tierUps: 0 };
  if (!links.length) return result;
  const today = todayTW();
  const plans = links.flatMap((l) => syncPeriods(l.member, today).map((p) => ({ l, p, to: p.end < today ? p.end : today })));
  const from = plans.reduce((a, x) => (x.p.start < a ? x.p.start : a), today);
  const list = [];
  for (const [a, b] of dayChunks(from, today, 30)) list.push(...(await fetchDaily(a, b, uid)));
  const entries = plans.map(({ l, p, to }) => {
    const rows = list.filter((r) => String(r.uid) === String(l.exchange_uid)).filter((r) => { const d = twDate(Number(r.commissionTime)); return d >= p.start && d <= to; });
    const s = summarize(rows, goalFor("BingX", SITE_TIER), (ms) => twDate(ms)).get(String(l.exchange_uid)) || { total: 0, qualifiedOn: null };
    return { user_id: l.user_id, period: p, amounts: { BingX: s.total }, qualifiedOn: s.qualifiedOn || today };
  });
  const r = await saveVolumes({ entries, updatedBy: SYNC_BY, merge: true });
  return { ...result, saved: r.saved, tierUps: r.tierUps || 0 };
}
