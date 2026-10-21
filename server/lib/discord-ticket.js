// Discord 私人報名頻道（像 Ticket Tool）：開頻道、權限、關頻道、每個人專用的實驗室密碼
// 一個人同時只會有一個開著的報名頻道（discord_tickets，status = open）
import { supabaseAdmin, env } from "./env.js";
import { randomCode } from "./random.js";
import {
  getChannel, createChannel, deleteChannel, sendMessage, saveDiscordSettings, getDiscordSettings,
} from "./discord.js";
import { ticketWelcome } from "./discord-flow.js";

// 權限位元（https://discord.com/developers/docs/topics/permissions）
const B = { MANAGE_CHANNELS: 1n << 4n, VIEW: 1n << 10n, SEND: 1n << 11n, MANAGE_MESSAGES: 1n << 13n, EMBED: 1n << 14n, ATTACH: 1n << 15n, HISTORY: 1n << 16n };
const bits = (...xs) => String(xs.reduce((a, b) => a | b, 0n));

export const TICKET_CATEGORY = { name: "🎫 培訓計畫報名", type: 4 };

// 分類：只有機器人和客服身分組看得到（管理員本來就看得到全部）
export function categoryOverwrites({ guildId, botId, staffRoleIds = [] }) {
  return [
    { id: guildId, type: 0, allow: "0", deny: bits(B.VIEW) },
    { id: botId, type: 1, allow: bits(B.VIEW, B.SEND, B.HISTORY, B.EMBED, B.MANAGE_MESSAGES, B.MANAGE_CHANNELS), deny: "0" },
    ...staffRoleIds.map((id) => ({ id, type: 0, allow: bits(B.VIEW, B.SEND, B.HISTORY, B.ATTACH), deny: "0" })),
  ];
}

// 一個報名頻道：申請人、機器人、客服身分組看得到，其他人看不到
export function ticketOverwrites({ guildId, botId, userId, staffRoleIds = [] }) {
  return [
    ...categoryOverwrites({ guildId, botId, staffRoleIds }),
    { id: userId, type: 1, allow: bits(B.VIEW, B.SEND, B.HISTORY, B.ATTACH), deny: "0" },
  ];
}

// 頻道名稱：申請-名字（Discord 會自動轉小寫、空白變 -）
export const ticketName = (name) => `報名-${String(name || "研究員").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "研究員"}`;

async function channelExists(id) {
  if (!id) return false;
  try { await getChannel(id); return true; } catch (e) { if (e.status === 404 || e.status === 403) return false; throw e; }
}

// 找（或建立）放報名頻道的分類
export async function ensureTicketCategory(guildId, s) {
  if (await channelExists(s.ticketCategoryId)) return s.ticketCategoryId;
  const cat = await createChannel(guildId, {
    ...TICKET_CATEGORY,
    permission_overwrites: categoryOverwrites({ guildId, botId: env.DISCORD_APP_ID, staffRoleIds: s.staffRoleIds || [] }),
  });
  const latest = await getDiscordSettings();
  await saveDiscordSettings({ ...latest, ticketCategoryId: cat.id });
  return cat.id;
}

export async function openTicketOf(userId) {
  const { data } = await supabaseAdmin.from("discord_tickets").select("*").eq("discord_user_id", userId).eq("kind", "apply").eq("status", "open").limit(1);
  return data?.[0] || null;
}
export async function ticketOf(channelId) {
  if (!channelId) return null;
  const { data } = await supabaseAdmin.from("discord_tickets").select("*").eq("channel_id", channelId).maybeSingle();
  return data || null;
}
const markClosed = (channelId, by) => supabaseAdmin.from("discord_tickets")
  .update({ status: "closed", closed_at: new Date().toISOString(), closed_by: by || null }).eq("channel_id", channelId);

// 幫這個人開一個報名頻道；已經有開著的就回傳那個（頻道被手動刪掉了就重開）
export async function openTicket({ guildId, user, name, s }) {
  const existing = await openTicketOf(user.id);
  if (existing) {
    if (await channelExists(existing.channel_id)) return { channelId: existing.channel_id, created: false };
    await markClosed(existing.channel_id, "頻道已經不在");
  }
  const staffRoleIds = s.staffRoleIds || [];
  const parent = await ensureTicketCategory(guildId, s);
  const ch = await createChannel(guildId, {
    name: ticketName(name), type: 0, parent_id: parent,
    topic: `${name || user.id} 的培訓計畫報名。選交易所、填 UID；完成後按「關閉這個頻道」。`,
    permission_overwrites: ticketOverwrites({ guildId, botId: env.DISCORD_APP_ID, userId: user.id, staffRoleIds }),
  });
  const { error } = await supabaseAdmin.from("discord_tickets").insert({ channel_id: ch.id, discord_user_id: user.id, discord_name: name || null, status: "open", kind: "apply" });
  if (error) {
    // 同一個人連按兩次：另一次已經開好了，把這次多開的刪掉
    await deleteChannel(ch.id).catch(() => {});
    const other = await openTicketOf(user.id);
    if (other) return { channelId: other.channel_id, created: false };
    throw error;
  }
  await sendMessage(ch.id, ticketWelcome(user.id));
  return { channelId: ch.id, created: true };
}

export async function closeTicket(channelId, by) {
  await markClosed(channelId, by);
  try { await deleteChannel(channelId); } catch (e) { if (e.status !== 404) throw e; }
}

// 通過的人：產生一組只能用一次的實驗室密碼（備註寫 Discord 名稱和交易所 UID，後台查得到是誰的）
export async function personalCode({ name, exchange, uid }) {
  const note = `Discord：${String(name || "").slice(0, 40)}（${exchange} ${uid}）`;
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    const { error } = await supabaseAdmin.from("invite_codes").insert({ code, max_uses: 1, note });
    if (!error) return code;
    if (error.code !== "23505") throw error;
  }
  throw new Error("產生實驗室密碼失敗");
}
