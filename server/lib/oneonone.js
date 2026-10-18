// 一對一交流（第三級）：每個月選一位講師，每位講師最多 5 位，超過照交易量排（規則在 shared/rules.js 的 rankOneOnOne）
import { supabaseAdmin } from "./env.js";
import { thisMonthTW, todayTW } from "./dates.js";
import { tiersFor } from "./tier.js";
import { periodOf, progressTo, fmtAmount, isLots, oneOnOneScore, rankOneOnOne, ONE_ON_ONE_HOSTS, MAX_TIER } from "../../public/assets/js/shared/rules.js";
import { twDate } from "./dates.js";
import { discordConfigured, getDiscordSettings, sendMessage } from "./discord.js";


// 某個月的名單：每位講師排好順序。只算今天還是第三級的人（管理員已經約好的照樣留著）
export async function oneOnOneBoard(month = thisMonthTW(), today = todayTW()) {
  const { data: picks, error } = await supabaseAdmin.from("one_on_ones").select("user_id, host, booked, created_at").eq("month", month);
  if (error) throw error;
  if (!picks?.length) return { month, hosts: ONE_ON_ONE_HOSTS.map((host) => ({ host, list: [] })) };
  const ids = picks.map((p) => p.user_id);
  const { data: mems, error: e2 } = await supabaseAdmin.from("members").select("user_id, email, banned, created_at, min_tier, min_tier_until").in("user_id", ids);
  if (e2) throw e2;
  const live = (mems || []).filter((m) => !m.banned);
  const tiers = await tiersFor(live, today);
  // 這一輪的交易量（排順序用）
  const starts = [...new Set(live.map((m) => periodOf(twDate(m.created_at), today).start))];
  const { data: vols } = starts.length ? await supabaseAdmin.from("volumes").select("user_id, period_start, amounts").in("user_id", ids).in("period_start", starts) : { data: [] };
  const amountsOf = (m) => (vols || []).find((v) => v.user_id === m.user_id && v.period_start === periodOf(twDate(m.created_at), today).start)?.amounts || {};
  const memBy = new Map(live.map((m) => [m.user_id, m]));
  const entries = picks.filter((p) => memBy.has(p.user_id)).map((p) => {
    const m = memBy.get(p.user_id);
    const amounts = amountsOf(m);
    const b = progressTo(amounts, MAX_TIER);
    return { ...p, email: m.email, tier: tiers.get(p.user_id)?.tier ?? 0, score: oneOnOneScore(amounts), volume: b.n ? `${b.ex} ${fmtAmount(b.ex, b.n)}${isLots(b.ex) ? "" : " USDT"}` : "—" };
  }).filter((e) => e.booked || e.tier >= MAX_TIER);
  return { month, hosts: ONE_ON_ONE_HOSTS.map((host) => ({ host, list: rankOneOnOne(entries, host) })) };
}


// Discord 通知講師：有人選、改選、取消一對一時，發在審核頻道（只有管理員、客服看得到）
// 後台「Discord 審核」→ 進階設定填了講師的 Discord 使用者 ID，就會 @ 他
export function oneOnOneNotice({ kind, email, host, prevHost, rank, confirmed, month, hostIds = {} }) {
  const at = (h) => (hostIds[h] ? `<@${hostIds[h]}>` : h);
  const m = Number(String(month).slice(5));
  const where = rank ? `，目前第 ${rank} 位（${confirmed ? "確定" : "候補"}）` : "";
  const text = {
    pick: `🎙 ${at(host)} ${m} 月的一對一：**${email}** 選了你${where}`,
    change: `🔁 ${at(host)} ${m} 月的一對一：**${email}** 從 ${prevHost} 改選你${where}`,
    cancel: `↩️ ${at(prevHost)} ${m} 月的一對一：**${email}** 取消了`,
  }[kind];
  const ids = [kind === "cancel" ? prevHost : host].map((h) => hostIds[h]).filter(Boolean);
  return { content: text + "\n到後台「一對一」看名單、約時間。", allowed_mentions: { users: ids } };
}
export async function notifyOneOnOne(info) {
  if (!discordConfigured()) return false;
  try {
    const s = await getDiscordSettings();
    const channel = s.reviewChannelId || s.panelChannelId;
    if (!channel) return false;
    await sendMessage(channel, oneOnOneNotice({ ...info, hostIds: s.hostIds || {} }));
    return true;
  } catch (e) {
    console.error("oneonone notify failed", e?.message);
    return false;
  }
}
