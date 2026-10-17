// 直播預告：後台排好直播時間 → 機器人發到 Discord 的「研究員專屬公告」頻道並提及實驗室研究員
// 改時間、取消、開播前 30 分鐘提醒都回覆在同一則公告下面
// Discord 的時間用 <t:秒數:F>，每個人看到的是自己的當地時間
import { supabaseAdmin } from "./env.js";
import { discordConfigured, getDiscordSettings, sendMessage, editMessage } from "./discord.js";

export const LIVE_TITLE_MAX = 60;
export const LIVE_NOTE_MAX = 500;
export const REMIND_BEFORE_MIN = 30;

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);
const WEEK = "日一二三四五六";
// 台灣時間：10/20（二）20:00
export function fmtLiveTW(iso) {
  const d = new Date(Date.parse(iso) + 8 * 3600e3);
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[d.getUTCDay()]}）${hh}:${mm}`;
}

// 公告本體（新增時發、修改時改）
export function liveAnnouncement(live, { roleId } = {}) {
  const t = unix(live.starts_at);
  if (live.status === "cancelled") {
    return { content: `## ~~📡 直播預告：${live.title}~~\n❌ 這場直播取消了（原本 <t:${t}:F>）`, allowed_mentions: { parse: [] } };
  }
  const lines = [
    roleId ? `<@&${roleId}>` : "",
    `## 📡 直播預告：${live.title}`,
    `🗓 <t:${t}:F>（<t:${t}:R>）`,
    live.hosts?.length ? `🎙 主講：${live.hosts.join("、")}` : "",
    live.note ? `\n${live.note}` : "",
    live.link ? `\n🔗 ${live.link}` : "",
  ].filter(Boolean);
  return { content: lines.join("\n"), allowed_mentions: { roles: roleId ? [roleId] : [] } };
}

// 回覆在公告下面的通知：改時間、取消、快開始了
export function liveReply(live, kind, { roleId } = {}) {
  const t = unix(live.starts_at);
  const ping = roleId ? `<@&${roleId}> ` : "";
  const text = {
    moved: `${ping}⏰ 「${live.title}」改時間了：<t:${t}:F>（<t:${t}:R>）`,
    cancelled: `${ping}❌ 「${live.title}」取消了，之後的時間會再公告。`,
    reminder: `${ping}🔴 「${live.title}」${live.hosts?.length ? `（${live.hosts.join("、")}）` : ""}<t:${t}:R>開始！${live.link ? `\n🔗 ${live.link}` : ""}`,
  }[kind];
  const out = { content: text, allowed_mentions: { roles: roleId ? [roleId] : [] } };
  if (live.discord_message_id) out.message_reference = { message_id: live.discord_message_id, fail_if_not_exists: false };
  return out;
}

// 發到 Discord：kind = "new" | "edit" | "moved" | "cancelled" | "reminder"
// 回傳 { posted, error? }；Discord 還沒設定好不算錯，網站照樣存
export async function announceLive(live, kind) {
  if (!discordConfigured()) return { posted: false, error: "Discord 機器人還沒設定" };
  const s = await getDiscordSettings();
  const channel = live.discord_channel_id || s.labChannelId;
  if (!channel) return { posted: false, error: "還沒有研究員專屬公告頻道（到「Discord 審核」按一鍵建立）" };
  const roleId = live.mention === false ? "" : s.roleId; // 新增時可以選要不要提及實驗室研究員
  try {
    if (kind === "new") {
      const msg = await sendMessage(channel, liveAnnouncement(live, { roleId }));
      await supabaseAdmin.from("lives").update({ discord_channel_id: channel, discord_message_id: msg?.id || null }).eq("id", live.id);
      return { posted: true };
    }
    if (live.discord_message_id && kind !== "reminder") {
      // 公告本體一律更新成最新內容（改了不會再提及一次，所以改時間、取消另外回覆）
      await editMessage(channel, live.discord_message_id, liveAnnouncement(live, { roleId })).catch((e) => {
        if (e.status !== 404) throw e;
      });
    }
    if (kind === "moved" || kind === "cancelled" || kind === "reminder") await sendMessage(channel, liveReply(live, kind, { roleId }));
    return { posted: true };
  } catch (e) {
    console.error("live discord failed", e?.status, e?.message);
    return { posted: false, error: String(e?.message || e).slice(0, 160) };
  }
}

// 研究員首頁的「下一場直播」：還沒開始的、或開始不到 3 小時的
export async function nextLive(now = Date.now()) {
  const { data } = await supabaseAdmin.from("lives").select("id, title, starts_at, note, link, hosts")
    .eq("status", "scheduled").gte("starts_at", new Date(now - 3 * 3600e3).toISOString())
    .order("starts_at", { ascending: true }).limit(1);
  return data?.[0] || null;
}
