// Discord 客服單（取代 Ticket Tool）：跟培訓計畫報名一樣，按按鈕 → 開一個只有他和客服看得到的私人頻道
// 流程：客服中心選「要問什麼」→ 填主旨、說明 → 機器人開「客服-名字」頻道，通知客服身分組
//   → 客服按「我來處理」→ 處理完任一方按「關閉客服單」→ 確認 → 完整紀錄存到客服紀錄頻道、私訊開單的人 → 刪頻道
// 一個人同時只會有一張開著的客服單（discord_tickets，kind = support）
import { supabaseAdmin, env } from "./env.js";
import { getChannel, createChannel, editChannel, deleteChannel, sendMessage, editMessage, saveDiscordSettings, getDiscordSettings, discordApi, dm } from "./discord.js";
import { postWithFiles, twStamp } from "./chatlog.js";

const B = { VIEW: 1n << 10n, SEND: 1n << 11n, MANAGE_CHANNELS: 1n << 4n, MANAGE_MESSAGES: 1n << 13n, EMBED: 1n << 14n, ATTACH: 1n << 15n, HISTORY: 1n << 16n, THREADS: (1n << 35n) | (1n << 36n) | (1n << 38n) };
const bits = (...xs) => String(xs.reduce((a, b) => a | b, 0n));
export const GOLD = 0xcda45e, GREEN = 0x5fa285, GREY = 0x7f8a8c;
export const LOGO = "https://ccc-community-site.pages.dev/assets/brand/ccc-bot.png";

export const SUPPORT_TOPICS = [
  { value: "member", label: "培訓計畫、研究員身分", emoji: "🧪", hint: "報名、身分組、等級、系統分享" },
  { value: "exchange", label: "交易所、UID、交易量", emoji: "💱", hint: "綁定 UID、交易量沒更新、返佣" },
  { value: "site", label: "網站、帳號登入", emoji: "💻", hint: "實驗室密碼、登入、影片看不了" },
  { value: "biz", label: "合作洽談", emoji: "🤝", hint: "商業合作、邀約、贊助" },
  { value: "other", label: "其他問題", emoji: "💬", hint: "都不是的話選這個" },
];
export const topicOf = (v) => SUPPORT_TOPICS.find((t) => t.value === v) || SUPPORT_TOPICS[SUPPORT_TOPICS.length - 1];

export const SUPPORT_CHANNELS = {
  category: { name: "🎫 客服單", type: 4 },
  panel: { name: "🎫客服中心", type: 0, topic: "有問題按下面選單開客服單：只有你和客服看得到。" },
  log: { name: "📋客服紀錄", type: 0, topic: "每張客服單結案後的完整紀錄。只有管理員和客服看得到。" },
};

// ── 權限 ──
export function supportOverwrites(kind, { guildId, botId, staffRoleIds = [], userId }) {
  const bot = { id: botId, type: 1, allow: bits(B.VIEW, B.SEND, B.HISTORY, B.EMBED, B.ATTACH, B.MANAGE_MESSAGES, B.MANAGE_CHANNELS), deny: "0" };
  const staff = staffRoleIds.map((id) => ({ id, type: 0, allow: bits(B.VIEW, B.SEND, B.HISTORY, B.ATTACH, B.EMBED), deny: "0" }));
  if (kind === "panel") return [{ id: guildId, type: 0, allow: bits(B.VIEW, B.HISTORY), deny: bits(B.SEND, B.THREADS) }, bot];
  const hidden = { id: guildId, type: 0, allow: "0", deny: bits(B.VIEW) };
  if (kind === "ticket") return [hidden, bot, ...staff, { id: userId, type: 1, allow: bits(B.VIEW, B.SEND, B.HISTORY, B.ATTACH, B.EMBED), deny: "0" }];
  return [hidden, bot, ...staff]; // category、log
}

// ── 訊息長相 ──
// 使用者寫的說明：把 [文字](網址) 這種「藏起來的連結」拆開，網址會直接顯示，不會偽裝成官方連結
export const plain = (s) => String(s || "").replace(/[\[\]]/g, (c) => (c === "[" ? "［" : "］"));
const brand = (text = "CCC 交易實驗室｜客服中心") => ({ name: text, icon_url: LOGO });
export function supportPanelMessage() {
  return {
    embeds: [{
      author: brand(),
      title: "🎫 需要幫忙嗎？開一張客服單",
      description: [
        "在下面選你要問的類型，填一下主旨和說明，機器人會幫你開一個**只有你和客服看得到的私人頻道**。",
        "",
        ...SUPPORT_TOPICS.map((t) => `${t.emoji} **${t.label}**　${t.hint}`),
        "",
        "> 🔒 私人頻道，其他研究員看不到",
        "> ⚡ 客服會收到通知，看到就回你",
        "> 🗂️ 結案後會私訊你一份對話紀錄",
      ].join("\n"),
      color: GOLD,
      footer: { text: "請不要在任何頻道貼出密碼、私鑰、助記詞；客服不會跟你要這些", icon_url: LOGO },
    }],
    components: [{ type: 1, components: [{ type: 3, custom_id: "support_topic", placeholder: "🎫 選擇要問的類型，開一張客服單", options: SUPPORT_TOPICS.map((t) => ({ label: t.label, value: t.value, description: t.hint, emoji: { name: t.emoji } })) }] }],
    allowed_mentions: { parse: [] },
  };
}
export function supportModal(topic) {
  const t = topicOf(topic);
  return {
    type: 9,
    data: {
      custom_id: `support_form:${t.value}`,
      title: `開客服單：${t.label}`.slice(0, 45),
      components: [
        { type: 1, components: [{ type: 4, custom_id: "subject", style: 1, label: "主旨（一句話）", min_length: 2, max_length: 60, required: true, placeholder: "例如：BingX 交易量三天沒更新" }] },
        { type: 1, components: [{ type: 4, custom_id: "detail", style: 2, label: "說明（越清楚越快處理）", min_length: 5, max_length: 1000, required: true, placeholder: "發生什麼事、什麼時候開始、交易所和 UID（不要填密碼）" }] },
      ],
    },
  };
}
export const ticketNo = (no) => `#${String(no || 0).padStart(4, "0")}`;
const claimBtn = (disabled = false, by = "") => ({ type: 2, style: disabled ? 2 : 1, custom_id: "support_claim", label: disabled ? `${by || "客服"} 處理中` : "我來處理", emoji: { name: "🙋" }, disabled });
const closeBtn = { type: 2, style: 4, custom_id: "support_close", label: "關閉客服單", emoji: { name: "🔒" } };

export function supportTicketEmbed(t, { claimedBy = "" } = {}) {
  const tp = topicOf(t.topic);
  return {
    author: brand(`客服單 ${ticketNo(t.no)}`),
    title: `${tp.emoji} ${t.subject || tp.label}`,
    description: plain(t.detail).slice(0, 1500),
    color: claimedBy ? GREEN : GOLD,
    fields: [
      { name: "開單的人", value: `<@${t.discord_user_id}>`, inline: true },
      { name: "類型", value: tp.label, inline: true },
      { name: "狀態", value: claimedBy ? `🟢 ${claimedBy} 處理中` : "🟡 等待客服", inline: true },
    ],
    footer: { text: "處理完任一方按「關閉客服單」；結案後會私訊一份對話紀錄給開單的人" },
    timestamp: t.created_at || new Date().toISOString(),
  };
}
export function supportWelcome(t, staffRoleIds = []) {
  const ping = staffRoleIds.map((r) => `<@&${r}>`).join(" ");
  return {
    content: `<@${t.discord_user_id}> 客服單開好了，客服看到會馬上回你 🙌${ping ? `\n${ping} 有新的客服單` : ""}`,
    embeds: [supportTicketEmbed(t)],
    components: [{ type: 1, components: [claimBtn(), closeBtn] }],
    allowed_mentions: { users: [t.discord_user_id], roles: staffRoleIds },
  };
}
export function claimedMessage(t, by) {
  return { embeds: [supportTicketEmbed(t, { claimedBy: by })], components: [{ type: 1, components: [claimBtn(true, by), closeBtn] }], allowed_mentions: { parse: [] } };
}
export const confirmCloseMessage = () => ({
  type: 4,
  data: {
    flags: 64,
    content: "確定要關閉這張客服單嗎？頻道會刪掉，完整紀錄會存起來並私訊給開單的人。",
    components: [{ type: 1, components: [{ type: 2, style: 4, custom_id: "support_close_yes", label: "確定關閉", emoji: { name: "🔒" } }] }],
  },
});
export function closedLogEmbed(t, { by, messages, closedAt = Date.now() }) {
  const tp = topicOf(t.topic);
  const mins = Math.max(1, Math.round((closedAt - Date.parse(t.created_at || closedAt)) / 60000));
  const dur = mins >= 60 * 24 ? `${Math.round(mins / 60 / 24)} 天` : mins >= 60 ? `${Math.round(mins / 60)} 小時` : `${mins} 分鐘`;
  return {
    author: brand(`客服單 ${ticketNo(t.no)} 結案`),
    title: `${tp.emoji} ${t.subject || tp.label}`,
    color: GREY,
    fields: [
      { name: "開單的人", value: `<@${t.discord_user_id}>（${t.discord_name || "?"}）`, inline: true },
      { name: "處理", value: t.claimed_by || "—", inline: true },
      { name: "關閉", value: by || "—", inline: true },
      { name: "類型", value: tp.label, inline: true },
      { name: "花了多久", value: dur, inline: true },
      { name: "訊息", value: `${messages} 則`, inline: true },
    ],
    footer: { text: "完整對話在附件" },
    timestamp: new Date(closedAt).toISOString(),
  };
}

// ── 資料庫 ──
// 防洗版：同一個人關單後 10 分鐘內不能再開；整個伺服器同時最多 50 張開著的客服單
export const SUPPORT_COOLDOWN_MS = { value: 10 * 60 * 1000 };
export const SUPPORT_MAX_OPEN = 50;
export async function supportBlocked(userId, now = Date.now()) {
  const { data: mine } = await supabaseAdmin.from("discord_tickets").select("closed_at").eq("discord_user_id", userId).eq("kind", "support").eq("status", "closed").order("closed_at", { ascending: false }).limit(20);
  const last = Math.max(0, ...(mine || []).map((r) => Date.parse(r.closed_at) || 0));
  if (now - last < SUPPORT_COOLDOWN_MS.value) return `你剛關掉一張客服單，請 ${Math.ceil((SUPPORT_COOLDOWN_MS.value - (now - last)) / 60000)} 分鐘後再開。急的話可以私訊管理員。`;
  const { data: open } = await supabaseAdmin.from("discord_tickets").select("channel_id").eq("kind", "support").eq("status", "open").limit(SUPPORT_MAX_OPEN);
  if ((open || []).length >= SUPPORT_MAX_OPEN) return "客服單現在太多了，請稍後再試，或私訊管理員。";
  return "";
}
export async function openSupportOf(userId) {
  const { data } = await supabaseAdmin.from("discord_tickets").select("*").eq("discord_user_id", userId).eq("kind", "support").eq("status", "open").limit(1);
  return data?.[0] || null;
}
async function exists(id) {
  if (!id) return false;
  try { await getChannel(id); return true; } catch (e) { if (e.status === 404 || e.status === 403) return false; throw e; }
}
const safeName = (name) => `客服-${String(name || "研究員").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "研究員"}`;

async function ensureCategory(guildId, s) {
  if (await exists(s.supportCategoryId)) return s.supportCategoryId;
  const cat = await createChannel(guildId, { ...SUPPORT_CHANNELS.category, permission_overwrites: supportOverwrites("category", { guildId, botId: env.DISCORD_APP_ID, staffRoleIds: s.staffRoleIds || [] }) });
  await saveDiscordSettings({ ...(await getDiscordSettings()), supportCategoryId: cat.id });
  return cat.id;
}

// 開客服單；已經有開著的就給那個
export async function openSupport({ guildId, user, name, s, topic, subject, detail }) {
  const existing = await openSupportOf(user.id);
  if (existing) {
    if (await exists(existing.channel_id)) return { channelId: existing.channel_id, created: false, ticket: existing };
    await supabaseAdmin.from("discord_tickets").update({ status: "closed", closed_at: new Date().toISOString(), closed_by: "頻道已經不在" }).eq("channel_id", existing.channel_id);
  }
  const blocked = await supportBlocked(user.id);
  if (blocked) return { blocked };
  const staffRoleIds = s.staffRoleIds || [];
  const parent = await ensureCategory(guildId, s);
  const tp = topicOf(topic);
  const ch = await createChannel(guildId, {
    name: safeName(name), type: 0, parent_id: parent,
    topic: `${tp.emoji} ${tp.label}｜${String(subject).slice(0, 80)}`,
    permission_overwrites: supportOverwrites("ticket", { guildId, botId: env.DISCORD_APP_ID, staffRoleIds, userId: user.id }),
  });
  const { data, error } = await supabaseAdmin.from("discord_tickets").insert({ channel_id: ch.id, discord_user_id: user.id, discord_name: name || null, status: "open", kind: "support", topic: tp.value, subject, detail }).select("*").single();
  if (error) {
    await deleteChannel(ch.id).catch(() => {});
    const other = await openSupportOf(user.id);
    if (other) return { channelId: other.channel_id, created: false, ticket: other };
    throw error;
  }
  const t = data || { channel_id: ch.id, discord_user_id: user.id, discord_name: name, topic: tp.value, subject, detail, created_at: new Date().toISOString() };
  const msg = await sendMessage(ch.id, supportWelcome(t, staffRoleIds));
  if (msg?.id) await supabaseAdmin.from("discord_tickets").update({ message_id: msg.id }).eq("channel_id", ch.id);
  return { channelId: ch.id, created: true, ticket: t };
}

export async function claimSupport(t, by) {
  await supabaseAdmin.from("discord_tickets").update({ claimed_by: by }).eq("channel_id", t.channel_id);
  if (t.message_id) await editMessage(t.channel_id, t.message_id, claimedMessage(t, by)).catch(() => {});
}

// 整張客服單的對話（最多 1000 則，舊到新）
export async function fetchAll(channelId, { api = discordApi, max = 10 } = {}) {
  const out = [];
  let before = "", more = false;
  for (let i = 0; i < max; i++) {
    const page = await api("GET", `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ""}`);
    if (!page?.length) { more = false; break; }
    out.push(...page);
    before = page[page.length - 1].id;
    more = page.length === 100;
    if (!more) break;
  }
  const list = out.reverse();
  list.truncated = more; // 超過 1000 則：最舊的沒抓到
  return list;
}
export function supportTranscript(t, messages) {
  const tp = topicOf(t.topic);
  const lines = [
    `CCC 交易實驗室｜客服單 ${ticketNo(t.no)}`,
    `類型：${tp.label}`,
    `主旨：${t.subject || ""}`,
    `開單：${t.discord_name || t.discord_user_id}（${t.created_at ? twStamp(Date.parse(t.created_at)) : "?"} +0800）`,
    `處理：${t.claimed_by || "—"}`,
    "=".repeat(48),
    "【說明】",
    String(t.detail || ""),
    "=".repeat(48),
  ];
  if (messages.truncated) lines.push(`（對話超過 ${messages.length} 則，更早的訊息沒有收進這份紀錄）`, "");
  for (const m of messages) {
    if (m.author?.bot && !m.content) continue;
    lines.push(`[${twStamp(Date.parse(m.timestamp))}] ${m.author?.global_name || m.author?.username || "?"}${m.author?.bot ? "（機器人）" : ""}`);
    if (m.content) lines.push(String(m.content));
    for (const a of m.attachments || []) lines.push(`［附件］${a.filename}：${a.url}`);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

// 關單：先在資料庫把「開著」改成「關閉」，改到的才繼續（兩個人同時按只會跑一次）
// 紀錄存不進客服紀錄頻道就不刪頻道（對話還在，管理員可以再按一次關閉）
export async function closeSupport(t, by, s) {
  const { data: won } = await supabaseAdmin.from("discord_tickets").update({ status: "closed", closed_at: new Date().toISOString(), closed_by: by || null }).eq("channel_id", t.channel_id).eq("status", "open").select("channel_id");
  if (!won?.length) return { ok: false, reason: "already_closed" };
  let messages = [];
  try { messages = await fetchAll(t.channel_id); } catch (e) { console.error("support fetch failed", e?.message); }
  const human = messages.filter((m) => !m.author?.bot).length;
  const text = supportTranscript(t, messages);
  const file = { name: `ccc_ticket_${String(t.no || 0).padStart(4, "0")}.txt`, text };
  const embed = closedLogEmbed(t, { by, messages: human });
  let saved = !s.supportLogChannelId;
  if (s.supportLogChannelId) saved = await postWithFiles(s.supportLogChannelId, [embed], [file]).then(() => true, (e) => { console.error("support log failed", e?.message); return false; });
  if (!saved) {
    await supabaseAdmin.from("discord_tickets").update({ status: "open", closed_at: null, closed_by: null }).eq("channel_id", t.channel_id);
    await sendMessage(t.channel_id, { content: "⚠️ 紀錄存不進「客服紀錄」頻道，這個頻道先保留。請管理員確認機器人看得到客服紀錄頻道，再按一次關閉。", allowed_mentions: { parse: [] } }).catch(() => {});
    return { ok: false, reason: "log_failed" };
  }
  await dm(t.discord_user_id, `🗂️ 你的客服單 ${ticketNo(t.no)}「${t.subject || ""}」已經結案，謝謝你！附上這次的對話紀錄。\n之後還有問題，隨時到客服中心再開一張。`);
  await dmFile(t.discord_user_id, file);
  try { await deleteChannel(t.channel_id); } catch (e) { if (e.status !== 404) throw e; }
  return { ok: true };
}
async function dmFile(userId, file) {
  try {
    const ch = await discordApi("POST", "/users/@me/channels", { recipient_id: userId });
    await postWithFiles(ch.id, [], [file]);
  } catch { /* 對方關掉私訊就算了，紀錄頻道有存 */ }
}

// 客服身分組改了：開著的客服單頻道權限一起更新（拿掉的身分組就看不到了）
export async function resyncSupportTickets(ctx) {
  const { data } = await supabaseAdmin.from("discord_tickets").select("channel_id,discord_user_id").eq("kind", "support").eq("status", "open").limit(SUPPORT_MAX_OPEN);
  let n = 0;
  for (const t of data || []) {
    try { await editChannel(t.channel_id, { permission_overwrites: supportOverwrites("ticket", { ...ctx, userId: t.discord_user_id }) }); n++; } catch (e) { if (e.status !== 404) console.error("support resync failed", e?.message); }
  }
  return n;
}

// 後台「一鍵建立客服中心」：分類、客服中心頻道、客服紀錄頻道、貼按鈕（已經有就沿用、權限調回正確）
export async function setupSupport() {
  const s = await getDiscordSettings();
  if (!s.guildId) return { ok: false, error: "先在上面按「一鍵建立」，讓機器人認得你的伺服器" };
  const ctx = { guildId: s.guildId, botId: env.DISCORD_APP_ID, staffRoleIds: s.staffRoleIds || [] };
  const ids = { supportCategoryId: s.supportCategoryId, supportPanelChannelId: s.supportPanelChannelId, supportLogChannelId: s.supportLogChannelId };
  const created = [];
  // 每一步都標清楚，出錯時看得出是哪一步；做好的先存起來，再按一次會從斷掉的地方繼續
  const step = async (label, fn) => { try { return await fn(); } catch (e) { await saveDiscordSettings({ ...s, ...ids }).catch(() => {}); throw Object.assign(new Error(`${label}：${e.message}`), { status: e.status, code: e.code }); } };
  await step("建立「🎫 客服單」分類", async () => {
    if (await exists(ids.supportCategoryId)) await editChannel(ids.supportCategoryId, { permission_overwrites: supportOverwrites("category", ctx) });
    else { ids.supportCategoryId = (await createChannel(s.guildId, { ...SUPPORT_CHANNELS.category, permission_overwrites: supportOverwrites("category", ctx) })).id; created.push(SUPPORT_CHANNELS.category.name); }
  });
  for (const [kind, key] of [["panel", "supportPanelChannelId"], ["log", "supportLogChannelId"]]) {
    const def = SUPPORT_CHANNELS[kind];
    await step(`建立「${def.name}」頻道`, async () => {
      if (await exists(ids[key])) return editChannel(ids[key], { permission_overwrites: supportOverwrites(kind, ctx) });
      // 放在客服單分類底下（分類的權限是「只有客服看得到」，頻道自己的權限會蓋過去）
      ids[key] = (await createChannel(s.guildId, { name: def.name, type: 0, topic: def.topic, parent_id: ids.supportCategoryId, permission_overwrites: supportOverwrites(kind, ctx) })).id;
      created.push(def.name);
    });
  }
  const next = { ...s, ...ids };
  await step("貼開單選單", async () => {
    let repost = !s.supportPanelMessageId || s.supportPanelChannelId !== ids.supportPanelChannelId;
    if (!repost) await editMessage(ids.supportPanelChannelId, s.supportPanelMessageId, supportPanelMessage()).catch((e) => { if (e.status === 404) repost = true; else throw e; });
    if (repost) next.supportPanelMessageId = (await sendMessage(ids.supportPanelChannelId, supportPanelMessage())).id;
  });
  await saveDiscordSettings(next);
  return { ok: true, created, settings: next };
}
