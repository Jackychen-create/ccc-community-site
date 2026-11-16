// Discord 機器人：驗證 Discord 送來的請求、呼叫 Discord API（給身分組、發訊息）、審核設定
// 文件：https://discord.com/developers/docs/interactions/receiving-and-responding
// 機器人跑在網站的 /api/discord/interactions（HTTP 互動，不用另外開主機）
import { env, supabaseAdmin } from "./env.js";

export const discordConfigured = () => !!(env.DISCORD_APP_ID && env.DISCORD_PUBLIC_KEY && env.DISCORD_BOT_TOKEN);

const hexToBytes = (hex) => new Uint8Array((String(hex).match(/../g) || []).map((h) => parseInt(h, 16)));

// Discord 每個請求都有 Ed25519 簽名；驗不過一律擋掉（Discord 也會故意送錯的來測）
export async function verifyDiscord(rawBody, signature, timestamp, publicKey = env.DISCORD_PUBLIC_KEY) {
  if (!signature || !timestamp || !publicKey || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const data = new TextEncoder().encode(timestamp + rawBody);
  // 標準名稱是 Ed25519；比較舊的 Cloudflare 執行環境叫 NODE-ED25519
  for (const alg of [{ name: "Ed25519" }, { name: "NODE-ED25519", namedCurve: "NODE-ED25519" }]) {
    try {
      const key = await crypto.subtle.importKey("raw", hexToBytes(publicKey), alg, false, ["verify"]);
      return await crypto.subtle.verify(alg.name, key, hexToBytes(signature), data);
    } catch {}
  }
  return false;
}

export class DiscordError extends Error {
  constructor(status, msg, code) {
    super(`Discord ${status}${code ? `/${code}` : ""}: ${msg}`);
    this.status = status;
    this.code = code;
  }
}

// 呼叫 Discord API（用機器人的 Token）
// 400「Invalid Form Body」時 Discord 會說是哪個欄位錯：{ parent_id: { _errors: [{ message }] } } → 「（parent_id：…）」
export function formErrors(errors) {
  const out = [];
  const walk = (o, path) => {
    if (!o || typeof o !== "object" || out.length >= 3) return;
    if (Array.isArray(o._errors)) for (const e of o._errors) out.push(`${path.join(".")}：${e.message || e.code}`);
    for (const [k, v] of Object.entries(o)) if (k !== "_errors") walk(v, [...path, k]);
  };
  walk(errors, []);
  return out.length ? `（${out.slice(0, 3).join("；")}）` : "";
}
export async function discordApi(method, path, body) {
  const base = env.DISCORD_API_BASE || "https://discord.com/api/v10";
  const headers = {
    Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "DiscordBot (https://ccc-community-site.pages.dev, 1.0)",
  };
  if (method === "PUT" && path.includes("/roles/")) headers["X-Audit-Log-Reason"] = encodeURIComponent("CCC 實驗室審核通過");
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new DiscordError(res.status, (data?.message || text.slice(0, 200)) + formErrors(data?.errors), data?.code);
  return data;
}

export const addRole = (guildId, userId, roleId) => discordApi("PUT", `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
export const removeRole = (guildId, userId, roleId) => discordApi("DELETE", `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
export const sendMessage = (channelId, payload) => discordApi("POST", `/channels/${channelId}/messages`, payload);
export const editMessage = (channelId, messageId, payload) => discordApi("PATCH", `/channels/${channelId}/messages/${messageId}`, payload);
// 回覆（先回「處理中」之後再改內容）
export const editOriginal = (token, payload) => discordApi("PATCH", `/webhooks/${env.DISCORD_APP_ID}/${token}/messages/@original`, payload);

// 私訊；對方關掉私訊就算了，不影響審核
export async function dm(userId, content) {
  try {
    const ch = await discordApi("POST", "/users/@me/channels", { recipient_id: userId });
    await sendMessage(ch.id, { content, allowed_mentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}

// ── 設定：伺服器、身分組、報名頻道、審核頻道、各交易所邀請連結（後台「實驗室密碼」頁可以改）──
// staffRoleIds：除了管理員之外，也看得到報名頻道、可以按通過的身分組（例如客服）
// ticketCategoryId：私人報名頻道放在哪個分類（沒有會自動建立「🎫 培訓計畫報名」）
export const DEFAULT_DISCORD = { guildId: "", roleId: "1560542923173400596", panelChannelId: "", reviewChannelId: "", ticketCategoryId: "", staffRoleIds: [], invites: {} };
const SNOWFLAKE = /^\d{17,20}$/;
export const isSnowflake = (v) => SNOWFLAKE.test(String(v || ""));

export async function getDiscordSettings() {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", "discord").maybeSingle();
  return { ...DEFAULT_DISCORD, ...(data?.value || {}) };
}

export async function saveDiscordSettings(v) {
  const { error } = await supabaseAdmin.from("settings").upsert({ key: "discord", value: v });
  if (error) throw error;
  return v;
}

// 按的人能不能審核：有「管理身分組」或「管理員」權限，或是有設定的客服身分組
export function canReview(member, staffRoleIds = []) {
  if ((member?.roles || []).some((r) => staffRoleIds.includes(r))) return true;
  try {
    const p = BigInt(member?.permissions || "0");
    return (p & (1n << 3n)) !== 0n || (p & (1n << 28n)) !== 0n;
  } catch {
    return false;
  }
}

// ── 一鍵建立頻道用 ──
export const getGuilds = () => discordApi("GET", "/users/@me/guilds");
export const getGuild = (g) => discordApi("GET", `/guilds/${g}`);
export const getRoles = (g) => discordApi("GET", `/guilds/${g}/roles`);
export const getMember = (g, u) => discordApi("GET", `/guilds/${g}/members/${u}`);
export const getChannel = (c) => discordApi("GET", `/channels/${c}`);
export const createChannel = (g, payload) => discordApi("POST", `/guilds/${g}/channels`, payload);
export const editChannel = (c, payload) => discordApi("PATCH", `/channels/${c}`, payload);
export const deleteChannel = (c) => discordApi("DELETE", `/channels/${c}`);
export const pinMessage = (c, m) => discordApi("PUT", `/channels/${c}/pins/${m}`);
