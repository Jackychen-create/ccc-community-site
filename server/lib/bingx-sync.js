// BingX 自動同步：把已綁定研究員「這一輪」在 BingX 的交易量抓回來，存進 volumes，達標就延長資格
// BingX 給每天的明細，所以每個人的一輪各自加總，累計第一次跨過門檻的那天就是達標日
// 觸發：見 autosync.js
import { supabaseAdmin } from "./env.js";
import { todayTW } from "./dates.js";
import { saveVolumes, syncPeriods, countFrom } from "./volume.js";
import { goalFor, SITE_TIER } from "../../public/assets/js/shared/rules.js";
import { fetchDaily, dayChunks, summarize, commissionDay, bingxTimeFormat } from "./bingx.js";

export const SYNC_BY = "BingX 自動同步";

// 讀綁定了這間交易所的研究員（含加入日期）；uid 給了就只讀那一位
export async function linkedMembers(exchange, uid) {
  let q = supabaseAdmin.from("exchange_links").select("user_id, exchange_uid").eq("exchange", exchange);
  if (uid) q = q.eq("exchange_uid", String(uid));
  const { data: links, error } = await q;
  if (error) throw error;
  if (!links?.length) return [];
  const { data: mem, error: e2 } = await supabaseAdmin.from("members").select("user_id, created_at, volume_from").in("user_id", links.map((l) => l.user_id));
  if (e2) throw e2;
  const by = new Map((mem || []).map((m) => [m.user_id, m]));
  return links.filter((l) => by.has(l.user_id)).map((l) => ({ ...l, member: by.get(l.user_id) }));
}

export async function syncBingx({ uid } = {}) {
  const links = await linkedMembers("BingX", uid);
  const result = { users: links.length, saved: 0, tierUps: 0 };
  if (!links.length) return result;
  const today = todayTW();
  const plans = links.flatMap((l) => syncPeriods(l.member, today).map((p) => ({ l, p, from: countFrom(l.member, p), to: p.end < today ? p.end : today })));
  const from = plans.reduce((a, x) => (x.from < a ? x.from : a), today);
  const list = [];
  for (const [a, b] of dayChunks(from, today, 30)) list.push(...(await fetchDaily(a, b, uid)));
  const entries = plans.map(({ l, p, from: f, to }) => {
    const rows = list.filter((r) => String(r.uid) === String(l.exchange_uid)).filter((r) => { const d = commissionDay(r.commissionTime); return d && d >= f && d <= to; });
    const s = summarize(rows, goalFor("BingX", SITE_TIER)).get(String(l.exchange_uid)) || { total: 0, qualifiedOn: null };
    return { user_id: l.user_id, period: p, amounts: { BingX: s.total }, qualifiedOn: s.qualifiedOn || today };
  });
  const r = await saveVolumes({ entries, updatedBy: SYNC_BY, merge: true });
  return { ...result, saved: r.saved, tierUps: r.tierUps || 0, diag: diagnose(list, links, plans, from, today) };
}

// 給後台看的檢查資料：BingX 回了幾筆、最新到哪天、每個綁定的 UID 有幾筆、加總多少、算進這一輪多少
// 用來分辨「BingX 還沒出資料（隔天才結算）」「交易在加入網站之前」「日期格式看不懂」
export function diagnose(list, links, plans, from, today) {
  const days = list.map((r) => commissionDay(r.commissionTime)).filter(Boolean).sort();
  const perUid = {};
  for (const l of links) {
    const uid = String(l.exchange_uid);
    const mine = list.filter((r) => String(r.uid) === uid);
    const md = mine.map((r) => commissionDay(r.commissionTime)).filter(Boolean).sort();
    const sum = (rs) => Math.round(rs.reduce((a, r) => a + (Number(r.tradingVolume) || 0), 0) * 100) / 100;
    const ps = plans.filter((x) => x.l === l);
    const inPeriod = mine.filter((r) => { const d = commissionDay(r.commissionTime); return d && ps.some((x) => d >= x.from && d <= today); });
    perUid[uid] = { rows: mine.length, total: sum(mine), inPeriod: sum(inPeriod), first: md[0] || null, last: md.at(-1) || null, periodStart: ps.map((x) => x.from).sort()[0] || null };
  }
  return {
    range: [from, today], format: bingxTimeFormat(), fetched: list.length,
    latest: days.at(-1) || null, badTime: list.length - days.length,
    sample: list[0] ? { commissionTime: list[0].commissionTime, tradingVolume: list[0].tradingVolume } : null,
    perUid,
  };
}
