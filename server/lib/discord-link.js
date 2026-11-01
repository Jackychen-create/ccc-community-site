// 研究員自己連結 Discord 帳號（v1.26.21）
// 1. 在 Discord 按「🔗 連結網站帳號」→ 助教只給他看一個一次性連結（15 分鐘、用一次）
// 2. 他用登入網站的那個瀏覽器打開連結 → 網站把這個 Discord 帳號記到他的研究員帳號（member_discord）
// 一個 Discord 帳號只能連一個網站帳號；換帳號要先在網站解除
import { supabaseAdmin } from "./env.js";
import { randomHex } from "./random.js";
import { SITE_URL } from "./discord-flow.js";

export const LINK_BUTTON_ID = "link_site";
export const LINK_TTL_MS = 15 * 60e3;

// 放在 Discord 頻道裡的那則（按鈕）
export function linkPanelMessage() {
  return {
    embeds: [{
      title: "🔗 連結網站帳號",
      description: "把你的 Discord 連到研究員專區，課程解鎖、升級、直播精華這些提醒就會由實驗室助教私訊給你。\n\n按下面的按鈕，用登入網站的瀏覽器打開助教給你的連結就完成了（連結 15 分鐘內有效、只能用一次）。",
      color: 0xcda45e,
    }],
    components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: LINK_BUTTON_ID, label: "連結網站帳號", emoji: { name: "🔗" } }] }],
  };
}

// 按下按鈕：開一個一次性連結
export async function createLinkToken(discordUserId, discordName, now = Date.now()) {
  const token = randomHex(24);
  // 順便清掉一天前的舊連結
  await supabaseAdmin.from("discord_link_tokens").delete().lt("created_at", new Date(now - 86400e3).toISOString());
  const { error } = await supabaseAdmin.from("discord_link_tokens").insert({ token, discord_user_id: discordUserId, discord_name: String(discordName || "").slice(0, 80) || null, expires_at: new Date(now + LINK_TTL_MS).toISOString() });
  if (error) throw error;
  return { token, url: `${SITE_URL}/#/link-discord?t=${token}` };
}

export async function linkedOf(userId) {
  const { data } = await supabaseAdmin.from("member_discord").select("discord_user_id, discord_name, linked_at").eq("user_id", userId).maybeSingle();
  return data || null;
}
export async function linkedUserOfDiscord(discordUserId) {
  const { data } = await supabaseAdmin.from("member_discord").select("user_id").eq("discord_user_id", discordUserId).maybeSingle();
  return data?.user_id || null;
}

// 網站這邊收到連結：回 { ok, name } 或 { error, status }
export async function redeemLinkToken(userId, token, now = Date.now()) {
  if (!/^[0-9a-f]{48}$/.test(String(token || ""))) return { status: 400, error: "連結不對，請回 Discord 再按一次「連結網站帳號」" };
  // 先搶下來（同一個連結同時用兩次也只會成功一次）
  const { data: t } = await supabaseAdmin.from("discord_link_tokens").update({ used_at: new Date(now).toISOString() })
    .eq("token", token).is("used_at", null).gt("expires_at", new Date(now).toISOString()).select("discord_user_id, discord_name").maybeSingle();
  if (!t) return { status: 410, error: "這個連結過期或用過了，請回 Discord 再按一次「連結網站帳號」" };
  const other = await linkedUserOfDiscord(t.discord_user_id);
  if (other && other !== userId) return { status: 409, error: "這個 Discord 帳號已經連到另一個網站帳號了。要換的話先用那個網站帳號解除，或找管理員" };
  const { error } = await supabaseAdmin.from("member_discord").upsert({ user_id: userId, discord_user_id: t.discord_user_id, discord_name: t.discord_name, linked_at: new Date(now).toISOString() });
  if (error) throw error;
  return { ok: true, name: t.discord_name || "" };
}

export async function unlink(userId) {
  const { error } = await supabaseAdmin.from("member_discord").delete().eq("user_id", userId);
  if (error) throw error;
}
