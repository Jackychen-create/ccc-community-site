// Discord 一鍵建立：分類、三個頻道（權限設好）、放私人報名頻道的分類、報名按鈕
// 實驗室密碼不貼在頻道裡：每個通過的人在自己的報名頻道拿到專用的一組
// 可以重複按：已經建好的頻道、已經貼過的訊息不會重複建立，只會把權限調回正確
import {
  getGuilds, getGuild, getRoles, getMember, getChannel, createChannel, editChannel, sendMessage, editMessage,
  getDiscordSettings, saveDiscordSettings,
} from "./discord.js";
import { env } from "./env.js";
import { panelMessage } from "./discord-flow.js";
import { TICKET_CATEGORY, categoryOverwrites } from "./discord-ticket.js";

// 權限位元（https://discord.com/developers/docs/topics/permissions）
export const P = {
  MANAGE_CHANNELS: 1n << 4n, ADD_REACTIONS: 1n << 6n, VIEW: 1n << 10n, SEND: 1n << 11n, EMBED: 1n << 14n,
  MANAGE_MESSAGES: 1n << 13n, HISTORY: 1n << 16n, MANAGE_ROLES: 1n << 28n, THREADS: (1n << 35n) | (1n << 36n) | (1n << 38n),
};
const bits = (...xs) => String(xs.reduce((a, b) => a | b, 0n));
// 邀請機器人時要給的權限：管理頻道、看頻道、發訊息、管理訊息（釘選）、讀歷史、管理身分組
export const BOT_PERMISSIONS = bits(P.MANAGE_CHANNELS, P.VIEW, P.SEND, P.MANAGE_MESSAGES, P.HISTORY, P.EMBED, P.MANAGE_ROLES);
export const inviteUrl = (appId) => `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${BOT_PERMISSIONS}`;

// 舊版的預設名稱：再按一次一鍵建立時改成新名稱（你自己改過的名字不會動）
const OLD_NAMES = { panel: ["📝申請加入實驗室"], review: ["🔒申請審核"], lab: ["🧪實驗室"], ticket: ["🎫 實驗室申請"] };
async function renameIfOld(id, kind, def) {
  const ch = await getChannel(id).catch(() => null);
  return ch && OLD_NAMES[kind]?.includes(ch.name) ? { name: def.name, ...(def.topic ? { topic: def.topic } : {}) } : {};
}

export const CHANNELS = {
  category: { name: "🧪 CCC 交易實驗室", type: 4 },
  panel: { name: "📝報名培訓計畫", type: 0, topic: "按下面的按鈕，機器人會幫你開一個私人報名頻道。Bybit、BingX 自動確認；OKX、UM 由管理員審核。" },
  review: { name: "🔒報名審核", type: 0, topic: "有人在等管理員審核（OKX、UM）時會通知在這裡，點頻道連結過去按「通過」或「不通過」。只有管理員看得到。" },
  lab: { name: "📢研究員專屬公告", type: 0, topic: "實驗室研究員專屬：直播預告、公告" },
};

// 每個頻道的權限：everyone、實驗室身分組、機器人
export function overwrites(kind, { guildId, roleId, botId, staffRoleIds = [] }) {
  const bot = { id: botId, type: 1, allow: bits(P.VIEW, P.SEND, P.HISTORY, P.EMBED, P.MANAGE_MESSAGES), deny: "0" };
  if (kind === "panel") return [{ id: guildId, type: 0, allow: bits(P.VIEW, P.HISTORY), deny: bits(P.SEND, P.THREADS) }, bot];
  if (kind === "review") return [{ id: guildId, type: 0, allow: "0", deny: bits(P.VIEW) }, bot, ...staffRoleIds.map((id) => ({ id, type: 0, allow: bits(P.VIEW, P.HISTORY), deny: "0" }))];
  if (kind === "lab") return [
    { id: guildId, type: 0, allow: "0", deny: bits(P.VIEW) },
    { id: roleId, type: 0, allow: bits(P.VIEW, P.HISTORY, P.ADD_REACTIONS), deny: bits(P.SEND, P.THREADS) },
    bot,
  ];
  return [];
}

async function exists(id) {
  if (!id) return false;
  try { await getChannel(id); return true; } catch (e) { if (e.status === 404 || e.status === 403) return false; throw e; }
}

// 主流程；回傳結果和需要人處理的問題
export async function setupGuild() {
  const s = await getDiscordSettings();
  const botId = env.DISCORD_APP_ID;
  // 1. 找伺服器：機器人只在一個伺服器就用那個
  const guilds = await getGuilds();
  if (!guilds?.length) return { ok: false, error: "機器人還沒加進 Discord 伺服器，先用邀請連結把它加進去" };
  let guild = guilds.find((g) => g.id === s.guildId) || (guilds.length === 1 ? guilds[0] : null);
  if (!guild) return { ok: false, error: `機器人在好幾個伺服器裡（${guilds.map((g) => g.name).join("、")}），請先在設定填伺服器 ID` };
  const guildId = guild.id;
  guild = await getGuild(guildId).catch(() => guild);

  // 2. 檢查身分組順序：機器人的身分組要排在實驗室身分組上面，才能給別人這個身分組
  const [roles, me] = await Promise.all([getRoles(guildId), getMember(guildId, botId)]);
  const role = roles.find((r) => r.id === s.roleId);
  if (!role) return { ok: false, error: `伺服器裡找不到身分組 ${s.roleId}，請確認身分組 ID` };
  const botTop = Math.max(0, ...roles.filter((r) => me.roles?.includes(r.id)).map((r) => r.position));
  const hierarchyOk = botTop > role.position;

  // 3. 分類和頻道（已經有就沿用，權限調回正確）
  const staffRoleIds = s.staffRoleIds || [];
  const ctx = { guildId, roleId: s.roleId, botId, staffRoleIds };
  const ids = { categoryId: s.categoryId, panelChannelId: s.panelChannelId, reviewChannelId: s.reviewChannelId, labChannelId: s.labChannelId, ticketCategoryId: s.ticketCategoryId };
  const created = [];
  if (!(await exists(ids.categoryId))) {
    ids.categoryId = (await createChannel(guildId, { ...CHANNELS.category })).id;
    created.push(CHANNELS.category.name);
  }
  for (const [kind, key] of [["panel", "panelChannelId"], ["review", "reviewChannelId"], ["lab", "labChannelId"]]) {
    const def = CHANNELS[kind];
    const po = overwrites(kind, ctx);
    if (await exists(ids[key])) {
      await editChannel(ids[key], { permission_overwrites: po, ...(await renameIfOld(ids[key], kind, def)) });
    } else {
      ids[key] = (await createChannel(guildId, { name: def.name, type: def.type, topic: def.topic, parent_id: ids.categoryId, permission_overwrites: po })).id;
      created.push(def.name);
    }
  }

  // 私人報名頻道放的分類（只有機器人、客服身分組看得到）
  const tpo = categoryOverwrites({ guildId, botId, staffRoleIds });
  if (await exists(ids.ticketCategoryId)) {
    await editChannel(ids.ticketCategoryId, { permission_overwrites: tpo, ...(await renameIfOld(ids.ticketCategoryId, "ticket", TICKET_CATEGORY)) });
  } else {
    ids.ticketCategoryId = (await createChannel(guildId, { ...TICKET_CATEGORY, permission_overwrites: tpo })).id;
    created.push(TICKET_CATEGORY.name);
  }

  // 4. 報名按鈕（換了頻道才重貼）
  const next = { ...s, guildId, ...ids };
  delete next.labCode; delete next.labMessageId; // 舊版會在實驗室頻道貼共用實驗室密碼，現在不用了
  let repost = !s.panelMessageId || s.panelChannelId !== ids.panelChannelId;
  if (!repost) {
    // 已經貼過：改成最新的文字（例如改名成「報名培訓計畫」）；被刪掉了就重貼
    await editMessage(ids.panelChannelId, s.panelMessageId, panelMessage()).catch((e) => {
      if (e.status === 404) repost = true; else throw e;
    });
  }
  if (repost) next.panelMessageId = (await sendMessage(ids.panelChannelId, panelMessage())).id;
  await saveDiscordSettings(next);
  return { ok: true, guildName: guild.name, hierarchyOk, roleName: role.name, created, settings: next };
}
