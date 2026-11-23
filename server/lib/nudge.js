// 補發給掉隊的人（後台「新人試用週」卡片下面，管理員按了才發）
// unregistered：Discord 報名通過、拿到實驗室密碼，卻一直沒註冊網站 → 助教私訊他自己的加入連結
// unwatched：註冊網站超過 2 天、一支影片都沒看過 → 推薦從 EP1（CCC 第 1 份課程）開始：有 Discord 就私訊，沒有才寄信（v1.26.20）
// 同一個人 30 天內只補發一次：bot_state 的 nudge_sent { users: { "dc:ID" | "m:ID": at } }
import { supabaseAdmin } from "./env.js";
import { discordApi, sendMessage } from "./discord.js";
import { adminEmails } from "./auth.js";
import { mailReady, escHtml } from "./mail.js";
import { SITE_URL, LAB_URL } from "./discord-flow.js";
import { BRAND } from "./chatlog.js";
import { discordIds } from "./milestone.js";
import { dmOrMail } from "./course-mail.js";

const LOGO = `${SITE_URL}/assets/brand/ccc-bot.png`;
const COOL_DAYS = 30;
const GRACE_MS = 2 * 86400e3;

async function loadSent() {
  const { data } = await supabaseAdmin.from("bot_state").select("value").eq("key", "nudge_sent").maybeSingle();
  return data?.value?.users ? data.value : { users: {} };
}
const recently = (sent, key, now) => sent.users[key] && now - Date.parse(sent.users[key]) < COOL_DAYS * 86400e3;

export async function nudgeLists(now = Date.now()) {
  const [{ data: apps, error: aErr }, { data: members, error: mErr }, { data: watched, error: wErr }, sent] = await Promise.all([
    supabaseAdmin.from("discord_applications").select("discord_user_id, discord_name, invite_code, reviewed_at").eq("status", "approved").not("invite_code", "is", null).order("reviewed_at", { ascending: false }),
    supabaseAdmin.from("members").select("user_id, email, banned, invite_code, created_at"),

    supabaseAdmin.from("watch_progress").select("user_id"),
    loadSent(),
  ]);
  for (const e of [aErr, mErr, wErr]) if (e) throw e;
  const used = new Set((members || []).map((m) => m.invite_code).filter(Boolean));
  const seen = new Set();
  const unregistered = [];
  for (const a of apps || []) {
    if (seen.has(a.discord_user_id)) continue; // 同一個人：看最新那次
    seen.add(a.discord_user_id);
    if (used.has(a.invite_code) || now - Date.parse(a.reviewed_at) < GRACE_MS) continue;
    unregistered.push({ id: a.discord_user_id, name: a.discord_name || "", code: a.invite_code, approvedAt: a.reviewed_at, sentAt: recently(sent, `dc:${a.discord_user_id}`, now) ? sent.users[`dc:${a.discord_user_id}`] : null });
  }
  const admins = new Set(adminEmails());
  const has = new Set((watched || []).map((w) => w.user_id));
  const memBy = new Map((members || []).map((m) => [m.user_id, m]));
  const unwatched = (members || []).filter((m) => !m.banned && !has.has(m.user_id) && !admins.has(String(m.email).toLowerCase()) && now - Date.parse(m.created_at) >= GRACE_MS)
    .map((m) => ({ id: m.user_id, email: m.email, invite_code: m.invite_code, joinedAt: m.created_at, sentAt: recently(sent, `m:${m.user_id}`, now) ? sent.users[`m:${m.user_id}`] : null }));
  // 有沒有連到 Discord（後台顯示「私訊」或「寄信」）
  const dc = unwatched.length ? await discordIds(unwatched.map((p) => p.id), memBy) : new Map();
  for (const p of unwatched) { p.discordId = dc.get(p.id) || null; delete p.invite_code; }
  return { unregistered, unwatched, sent };
}

export function unregisteredEmbed(code) {
  return {
    author: { name: `${BRAND}｜實驗室助教`, icon_url: LOGO },
    title: "你的研究員專區還沒開通喔",
    description: `之前你的培訓計畫報名已經通過，但還沒用實驗室密碼註冊網站。\n直播留檔、系統分享、交易系統分享都在研究員專區，註冊一分鐘就好：\n\n${LAB_URL}?invite=${code}\n（註冊時選報名時的交易所、填同一個 UID）\n\n密碼不能用或有問題，直接回這則訊息或開客服單。`,
    color: 0xcda45e,
    footer: { text: "這個連結只能用一次，請不要給別人", icon_url: LOGO },
  };
}
export function unwatchedEmbed(ep1) {
  const link = ep1 ? `${LAB_URL}#/v/${ep1.id}` : `${LAB_URL}#/course`;
  return {
    author: { name: `${BRAND}｜實驗室助教`, icon_url: LOGO },
    title: "從這一支開始看吧",
    description: `研究員專區開通好幾天了，還沒看過影片的話，推薦從這支開始：\n\n**[${ep1?.title || "系統分享第 1 份"}](${link})**\n\nCCC 講自己的進出場規則和邏輯，大部分研究員都從這支開始，看完再接著看其他系統分享和直播留檔。`,
    color: 0xcda45e,
    footer: { text: "登入有問題：直接回這則訊息或開客服單", icon_url: LOGO },
  };
}
export function unwatchedHtml(ep1) {
  const link = ep1 ? `${LAB_URL}#/v/${ep1.id}` : `${LAB_URL}#/course`;
  return `<p>研究員專區開通了好幾天，還沒看過任何影片的話，推薦從這一支開始：</p>
<p style="font-size:18px;font-weight:700;margin:8px 0">${escHtml(ep1?.title || "系統分享第 1 份")}</p>
<p>CCC 講自己的進出場規則和邏輯，大部分研究員都從這支開始，看完再接著看其他系統分享和直播留檔。</p>
<p><a href="${link}" style="display:inline-block;background:#cda45e;color:#1b1f1d;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">開始看</a></p>
<p style="color:#7a817d;font-size:13px">登入遇到問題，回這封信或在 Discord 開客服單。</p>`;
}

export async function runNudge(kind, now = Date.now()) {
  const { unregistered, unwatched, sent } = await nudgeLists(now);
  const out = { ok: true, kind, sent: 0, skipped: 0, failed: [] };
  if (kind === "unregistered") {
    const todo = unregistered.filter((p) => !p.sentAt);
    out.skipped = unregistered.length - todo.length;
    for (const p of todo) sent.users[`dc:${p.id}`] = new Date(now).toISOString();
    await saveSent(sent, now);
    for (const p of todo) {
      try {
        const ch = await discordApi("POST", "/users/@me/channels", { recipient_id: p.id });
        await sendMessage(ch.id, { embeds: [unregisteredEmbed(p.code)], allowed_mentions: { parse: [] } });
        out.sent++;
      } catch (e) { out.failed.push({ name: p.name || p.id, error: String(e?.message || e).slice(0, 100) }); }
    }
    return out;
  }
  if (kind === "unwatched") {
    const todo = unwatched.filter((p) => !p.sentAt);
    if (!mailReady() && todo.some((p) => !p.discordId)) return { ok: false, error: "有人沒有連到 Discord，要寄信但還沒設定寄信服務（Brevo）" };
    out.skipped = unwatched.length - todo.length;
    const { data: ep1 } = await supabaseAdmin.from("videos").select("id, title").eq("is_published", true).eq("course_host", "CCC").eq("course_part", 1).maybeSingle();
    for (const p of todo) sent.users[`m:${p.id}`] = new Date(now).toISOString();
    await saveSent(sent, now);
    out.dms = 0; out.mails = 0;
    for (const p of todo) {
      const how = await dmOrMail(p.discordId, p.email, { embed: unwatchedEmbed(ep1), subject: "從這一支開始看：CCC 的進出場規則", html: unwatchedHtml(ep1) });
      if (how) { out.sent++; out[how === "dm" ? "dms" : "mails"]++; } else out.failed.push({ name: p.email, error: "私訊、寄信都失敗" });
    }
    return out;
  }
  return { ok: false, error: "不知道要補發給誰" };
}
async function saveSent(st, now) {
  const keep = Object.fromEntries(Object.entries(st.users).filter(([, at]) => now - Date.parse(at) < 90 * 86400e3));
  const { error } = await supabaseAdmin.from("bot_state").upsert({ key: "nudge_sent", value: { users: keep }, updated_at: new Date().toISOString() });
  if (error) throw error;
}
