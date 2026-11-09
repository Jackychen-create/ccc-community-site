// OKX 自動同步：OKX 推薦人 API 只給每個人的「累計交易量」（totalVol），沒有每天的明細
// 所以每天記一次累計（okx_snapshots），一輪的交易量＝今天的累計－這一輪開始那天（或之前最近一天）的累計
// 這一輪開始之後才在 OKX 註冊的人（joinTime ≥ 開始那天）：起點就是 0
// 對不到起點（網站開始記錄之前就開始的那一輪）：先不動，保留管理員填的數字；下一輪起就會自動
import { supabaseAdmin } from "./env.js";
import { todayTW, twDate } from "./dates.js";
import { saveVolumes, syncPeriods, countFrom } from "./volume.js";
import { getDiscordSettings } from "./discord.js";
import { checkOkxClient, okxInviteCode } from "./okx.js";
import { linkedMembers } from "./bingx-sync.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 一輪的交易量（純計算，測試用）：list＝這個人的每日累計（照日期排好），from／end＝這一輪的起訖，今天的累計 totalVol
// 對不到起點回傳 null（不動，保留管理員填的）
export function okxPeriodVolume({ list = [], totalVol = 0, joinDay = null, from, end, today }) {
  let base = null;
  if (joinDay && joinDay >= from) base = 0;
  else {
    const before = list.filter((s) => s.day <= from);
    if (before.length) base = Number(before[before.length - 1].total_vol) || 0;
  }
  if (base === null) return null;
  let last = totalVol;
  if (end < today) { // 已經結束的那一輪：用結束那天（或之後最近一天）的累計當終點
    const after = list.filter((s) => s.day >= end);
    last = after.length ? Number(after[0].total_vol) || 0 : totalVol;
  }
  return Math.max(0, Math.round((last - base) * 100) / 100);
}

export async function syncOkx({ uid } = {}) {
  const links = await linkedMembers("OKX", uid);
  const result = { users: links.length, saved: 0, tierUps: 0, noBase: 0, notInvited: 0 };
  if (!links.length) return result;
  const today = todayTW();
  const code = okxInviteCode((await getDiscordSettings().catch(() => ({}))).invites?.OKX);
  const uids = [...new Set(links.map((l) => String(l.exchange_uid)))];
  const now = new Map();
  for (const u of uids) {
    const r = await checkOkxClient(u, { code });
    if (r.invited) now.set(u, r);
    else result.notInvited++;
    await sleep(150); // OKX 限流：每 2 秒 20 次
  }
  // 今天的累計記下來
  if (now.size) {
    const rows = [...now].map(([u, r]) => ({ uid: u, day: today, total_vol: r.totalVol, join_time: r.joinTime ? new Date(r.joinTime).toISOString() : null }));
    const { error } = await supabaseAdmin.from("okx_snapshots").upsert(rows, { onConflict: "uid,day" });
    if (error) throw error;
  }
  const { data: snaps, error } = await supabaseAdmin.from("okx_snapshots").select("uid, day, total_vol").in("uid", [...now.keys()]).order("day", { ascending: true });
  if (error) throw error;
  const byUid = new Map();
  for (const s of snaps || []) (byUid.get(s.uid) || byUid.set(s.uid, []).get(s.uid)).push(s);

  const entries = [];
  for (const l of links) {
    const r = now.get(String(l.exchange_uid));
    if (!r) continue;
    const list = byUid.get(String(l.exchange_uid)) || [];
    for (const p of syncPeriods(l.member, today)) {
      const joinDay = r.joinTime ? twDate(new Date(r.joinTime).toISOString()) : null;
      const total = okxPeriodVolume({ list, totalVol: r.totalVol, joinDay, from: countFrom(l.member, p), end: p.end, today });
      if (total === null) { result.noBase++; continue; }
      entries.push({ user_id: l.user_id, period: p, amounts: { OKX: total }, qualifiedOn: today });
    }
  }
  if (!entries.length) return result;
  const s = await saveVolumes({ entries, updatedBy: "OKX 自動同步", merge: true });
  return { ...result, saved: s.saved, tierUps: s.tierUps || 0 };
}
