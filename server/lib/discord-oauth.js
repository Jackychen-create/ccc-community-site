// 一鍵連結 Discord（v1.35.0）：研究員在網站按「用 Discord 連結」→ Discord 授權頁按同意 → 回到網站
// 回來的時候：記下 Discord 帳號（member_discord）＋不在伺服器的話直接把他加進去、在的話補「實驗室研究員」身分組
// 要設定：Cloudflare 的 DISCORD_CLIENT_SECRET（Discord Developer Portal → OAuth2 → Client Secret），
//         Discord Developer Portal → OAuth2 → Redirects 加上 https://ccc-community-site.pages.dev/api/discord-oauth/callback
// state 不存資料庫：用 Client Secret 簽「研究員 ID.到期時間」，10 分鐘內有效
import { env, supabaseAdmin } from "./env.js";
import { getDiscordSettings, discordApi, addRole, isSnowflake } from "./discord.js";
import { linkedUserOfDiscord } from "./discord-link.js";
import { roleWanted } from "./pay.js";

export const OAUTH_TTL_MS = 10 * 60e3;
const SITE = "https://ccc-community-site.pages.dev";
export const redirectUri = () => (env.DISCORD_OAUTH_REDIRECT || `${SITE}/api/discord-oauth/callback`);
export const oauthConfigured = () => !!(env.DISCORD_APP_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_BOT_TOKEN);

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.DISCORD_CLIENT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}
export async function makeState(userId, now = Date.now()) {
  const body = `${userId}.${now + OAUTH_TTL_MS}`;
  return `${body}.${await hmac(body)}`;
}
export async function readState(state, now = Date.now()) {
  const m = String(state || "").match(/^([0-9a-f-]{36})\.(\d{13})\.([A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  if (Number(m[2]) < now) return null;
  const want = await hmac(`${m[1]}.${m[2]}`);
  return want === m[3] ? m[1] : null;
}
export async function authorizeUrl(userId) {
  const q = new URLSearchParams({ client_id: env.DISCORD_APP_ID, response_type: "code", redirect_uri: redirectUri(), scope: "identify guilds.join", state: await makeState(userId) });
  return `https://discord.com/oauth2/authorize?${q}`;
}

// 回來之後：換 token → 拿 Discord 帳號 → 記下來 → 加進伺服器／補身分組
export async function finishOAuth(userId, code) {
  const base = env.DISCORD_API_BASE || "https://discord.com/api/v10";
  const tr = await fetch(`${base}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.DISCORD_APP_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: redirectUri() }),
    signal: AbortSignal.timeout(10000),
  });
  const tok = await tr.json().catch(() => null);
  if (!tr.ok || !tok?.access_token) return { ok: false, error: "Discord 授權沒有完成，請再試一次" };
  const ur = await fetch(`${base}/users/@me`, { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10000) });
  const du = await ur.json().catch(() => null);
  if (!ur.ok || !isSnowflake(du?.id || "")) return { ok: false, error: "拿不到你的 Discord 帳號，請再試一次" };
  const other = await linkedUserOfDiscord(du.id);
  if (other && other !== userId) return { ok: false, error: "這個 Discord 帳號已經連在別的研究員帳號上了，有問題請開客服單" };
  const name = String(du.global_name || du.username || "").slice(0, 80) || null;
  const { error } = await supabaseAdmin.from("member_discord").upsert({ user_id: userId, discord_user_id: du.id, discord_name: name, linked_at: new Date().toISOString() });
  if (error) throw error;

  // 該不該給身分組：付費制看有沒有月費（roleWanted＝false 就只加進伺服器、不給身分組）；照舊的研究員一律給
  const { data: m } = await supabaseAdmin.from("members").select("banned").eq("user_id", userId).maybeSingle();
  const want = await roleWanted(userId).catch(() => null);
  const giveRole = !m?.banned && (want === true || want === null);
  const s = await getDiscordSettings();
  let joined = "skip";
  if (s.guildId) {
    const roles = giveRole && isSnowflake(s.roleId || "") ? [s.roleId] : [];
    try {
      // 不在伺服器：直接加進去（同時帶身分組，回 201）；已經在：回 204，身分組要另外補
      const r = await discordApi("PUT", `/guilds/${s.guildId}/members/${du.id}`, { access_token: tok.access_token, roles });
      joined = r ? "joined" : "already";
      if (!r && roles.length) await addRole(s.guildId, du.id, roles[0]);
    } catch (e) {
      console.error("discord oauth join failed", e?.status, e?.message);
      joined = "error";
    }
  }
  return { ok: true, name, joined, role: giveRole };
}
