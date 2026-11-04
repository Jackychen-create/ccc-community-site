// 交易所活動身分組（v1.26.22，例如跟 Bybit 的活動）：settings 的 discord.exchangeRoles { "Bybit": "身分組 ID" }
// 誰拿得到：用這間交易所報名通過的人（discord_applications），和在網站綁了這間交易所 UID、Discord 對得到的研究員
// 什麼時候給：報名通過當下（interactions.js）＋每小時排程補一次（之前通過的、後來才綁 UID 的）
// 給過的記在 bot_state 的 exchange_roles_granted { "Bybit:身分組": { discordId: at } }，不重複呼叫 Discord
import { supabaseAdmin } from "./env.js";
import { addRole, getDiscordSettings, discordConfigured, isSnowflake } from "./discord.js";
import { discordIds } from "./milestone.js";

export const exchangeRoleOf = (s, ex) => (isSnowflake(s?.exchangeRoles?.[ex] || "") ? s.exchangeRoles[ex] : null);

// 報名通過當下：順便給交易所的身分組（失敗不影響通過，排程會再補）
export async function grantExchangeRole(s, guildId, discordUserId, ex) {
  const role = exchangeRoleOf(s, ex);
  if (!role || !guildId) return false;
  try { await addRole(guildId, discordUserId, role); return true; } catch (e) { console.error("exchange role failed", ex, e?.message); return false; }
}

// 這間交易所該有身分組的 Discord 帳號
export async function exchangeRoleTargets(ex) {
  const [{ data: apps, error: aErr }, { data: links, error: lErr }] = await Promise.all([
    supabaseAdmin.from("discord_applications").select("discord_user_id").eq("status", "approved").eq("exchange", ex),
    supabaseAdmin.from("exchange_links").select("user_id").eq("exchange", ex),
  ]);
  if (aErr) throw aErr;
  if (lErr) throw lErr;
  const out = new Set((apps || []).map((a) => a.discord_user_id));
  const ids = [...new Set((links || []).map((l) => l.user_id))];
  if (ids.length) {
    const { data: mem } = await supabaseAdmin.from("members").select("user_id, invite_code, banned").in("user_id", ids);
    const alive = (mem || []).filter((m) => !m.banned);
    const dc = await discordIds(alive.map((m) => m.user_id), new Map(alive.map((m) => [m.user_id, m])));
    for (const d of dc.values()) out.add(d);
  }
  return [...out].filter((d) => isSnowflake(d));
}

// 每 5 分鐘的排程叫：每小時前 5 分鐘補一次；force＝馬上跑（設定好身分組那一刻）
export async function runExchangeRoles(now = Date.now(), { force = false } = {}) {
  if (!force && new Date(now).getUTCMinutes() >= 5) return null;
  if (!discordConfigured()) return null;
  const s = await getDiscordSettings();
  const pairs = Object.keys(s.exchangeRoles || {}).map((ex) => [ex, exchangeRoleOf(s, ex)]).filter(([, r]) => r);
  if (!pairs.length || !s.guildId) return null;
  const { data: st } = await supabaseAdmin.from("bot_state").select("value").eq("key", "exchange_roles_granted").maybeSingle();
  const granted = st?.value || {};
  const out = {};
  for (const [ex, role] of pairs) {
    const key = `${ex}:${role}`;
    const done = granted[key] || {};
    const todo = (await exchangeRoleTargets(ex)).filter((d) => !done[d]).slice(0, 40); // 一次最多 40 個（Discord 限流）
    let ok = 0;
    const failed = [];
    for (const d of todo) {
      try { await addRole(s.guildId, d, role); done[d] = new Date(now).toISOString(); ok++; }
      catch (e) {
        // 已經不在伺服器裡（10007 Unknown Member）：記下來不再試
        if (e?.code === 10007) done[d] = "left";
        else failed.push({ id: d, error: String(e?.message || e).slice(0, 100) });
      }
    }
    granted[key] = done;
    out[ex] = { granted: ok, failed, total: Object.keys(done).length };
  }
  await supabaseAdmin.from("bot_state").upsert({ key: "exchange_roles_granted", value: granted, updated_at: new Date().toISOString() });
  return out;
}
