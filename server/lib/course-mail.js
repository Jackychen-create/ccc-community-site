// 課程解鎖提醒：每天早上 9 點（台灣時間），今天解鎖新一份系統分享的研究員收到提醒
// 怎麼發（v1.26.20）：有連到 Discord 帳號（報名通過的那個）就助教私訊；沒有才寄信
// 誰：沒停權、開著通知（members.notify）、等級看得到那一份、不是第三級（第三級全部已經解鎖）
// 加入當天（第 0 週）那份不寄；影片還沒上傳的那份不寄
// 一天只跑一次：bot_state 的 course_mail { day }
import { supabaseAdmin } from "./env.js";
import { sendMail, mailReady, escHtml } from "./mail.js";
import { tiersFor } from "./tier.js";
import { twDate } from "./dates.js";
import { COURSE_HOSTS, COURSE_PARTS, courseUnlockDate, courseWeek, courseTierOk, courseSkipSchedule } from "../../public/assets/js/shared/rules.js";
import { SITE_URL, LAB_URL } from "./discord-flow.js";
import { discordConfigured, discordApi, sendMessage } from "./discord.js";
import { discordIds } from "./milestone.js";
import { BRAND } from "./chatlog.js";
import { unitOn } from "./membership.js";

// 私訊用的卡片
export function courseUnlockEmbed(list) {
  return {
    author: { name: `${BRAND}｜系統分享`, icon_url: `${SITE_URL}/assets/brand/ccc-bot.png` },
    title: list.length === 1 ? `🔓 解鎖：${list[0].host} 主講第 ${list[0].part} 份` : `🔓 解鎖 ${list.length} 份系統分享`,
    description: list.map((x) => `**[${x.host} 主講第 ${x.part} 份：${x.title}](${LAB_URL}#/v/${x.id})**`).join("\n") + `\n\n照順序看效果最好。全部系統分享在網站「系統分享」。`,
    color: 0xcda45e,
    footer: { text: "不想收到：網站右上角選單關掉「新影片、課程解鎖通知」" },
  };
}
// 先私訊、私訊不到才寄信；回傳 "dm" | "mail" | null
export async function dmOrMail(discordId, email, { embed, subject, html }) {
  if (discordId && discordConfigured()) {
    try {
      const ch = await discordApi("POST", "/users/@me/channels", { recipient_id: discordId });
      await sendMessage(ch.id, { embeds: [embed], allowed_mentions: { parse: [] } });
      return "dm";
    } catch { /* 關掉私訊：改寄信 */ }
  }
  if (email && mailReady() && (await sendMail({ to: [email], subject, html }))) return "mail";
  return null;
}

export const COURSE_MAIL_HOUR = 9;

// 今天每個人解鎖哪幾份（純計算，測試用）
export function unlocksToday(members, tiers, courseVideos, today) {
  const vid = new Map(courseVideos.map((v) => [`${v.course_host}:${v.course_part}`, v]));
  const out = [];
  for (const m of members) {
    if (m.banned || m.notify === false || !m.email) continue;
    const tier = tiers.get(m.user_id)?.tier || 0;
    if (!tier || courseSkipSchedule(tier) || tiers.get(m.user_id)?.paid) continue; // 付費的研究員是買了才開，沒有每週解鎖
    const start = twDate(m.created_at);
    const list = [];
    for (let part = 1; part <= COURSE_PARTS; part++) for (const host of COURSE_HOSTS) {
      if (courseWeek(host, part) === 0 || courseUnlockDate(start, host, part) !== today) continue;
      const v = vid.get(`${host}:${part}`);
      if (v && courseTierOk(tier, part)) list.push({ host, part, id: v.id, title: v.title });
    }
    if (list.length) out.push({ user_id: m.user_id, email: m.email, list });
  }
  return out;
}

// 單位制：累計交易量多解鎖了幾份（純計算，測試用）
// notified＝上次通知到第幾份 { user_id: units }；第一次看到的人只記下來不通知（切換那天不會一次洗一堆）
export function unitUnlocks(members, tiers, courseVideos, notified = {}) {
  const vid = new Map(courseVideos.map((v) => [`${v.course_host}:${v.course_part}`, v]));
  const next = { ...notified };
  const out = [];
  for (const m of members) {
    const u = tiers.get(m.user_id)?.unit;
    if (!u || m.banned) continue;
    const before = notified[m.user_id];
    next[m.user_id] = Math.max(before ?? 0, u.units);
    if (before === undefined || u.units <= before || m.notify === false || !m.email || m.free) continue;
    const list = [];
    for (let part = before + 1; part <= u.units; part++) for (const host of COURSE_HOSTS) {
      const v = vid.get(`${host}:${part}`);
      if (v) list.push({ host, part, id: v.id, title: v.title });
    }
    if (list.length) out.push({ user_id: m.user_id, email: m.email, list });
  }
  return { due: out, next };
}
export function courseMailHtml(list) {
  const items = list.map((x) => `<li style="margin:6px 0"><a href="${LAB_URL}#/v/${x.id}" style="color:#9a6b1f;font-weight:700">${escHtml(x.host)} 主講第 ${x.part} 份：${escHtml(x.title)}</a></li>`).join("");
  return `<p>你的系統分享解鎖了新的一份：</p><ul style="padding-left:18px">${items}</ul>
<p>照順序看效果最好。全部系統分享在網站「系統分享」。</p>
<p><a href="${LAB_URL}#/course" style="display:inline-block;background:#cda45e;color:#1b1f1d;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">去看課程</a></p>
<p style="color:#7a817d;font-size:13px">不想收到通知：網站右上角選單 →「新影片、課程解鎖通知」關掉。</p>`;
}

export async function runCourseMail(now = Date.now(), { force = false } = {}) {
  const tw = new Date(now + 8 * 3600e3);
  if (!force && (tw.getUTCHours() !== COURSE_MAIL_HOUR || tw.getUTCMinutes() >= 10)) return null;
  if (!mailReady() && !discordConfigured()) return { ok: false, error: "還沒設定寄信服務、Discord 機器人" };
  const today = twDate(now);
  const { data: st } = await supabaseAdmin.from("bot_state").select("value").eq("key", "course_mail").maybeSingle();
  if (!force && st?.value?.day === today) return { ok: true, skipped: "今天寄過了" };
  // 先記再寄：排程重疊時不會寄兩次
  await supabaseAdmin.from("bot_state").upsert({ key: "course_mail", value: { day: today, at: new Date(now).toISOString() }, updated_at: new Date().toISOString() });
  const [{ data: members, error }, { data: vids, error: vErr }] = await Promise.all([
    supabaseAdmin.from("members").select("user_id, email, banned, notify, created_at, free, min_tier, min_tier_until, invite_code"),
    supabaseAdmin.from("videos").select("id, title, course_host, course_part").eq("is_published", true).not("course_host", "is", null),
  ]);
  if (error) throw error;
  if (vErr) throw vErr;
  const alive = (members || []).filter((m) => !m.banned);
  const tiers = await tiersFor(alive, today);
  let due;
  if (await unitOn(today)) {
    const { data: un } = await supabaseAdmin.from("bot_state").select("value").eq("key", "unit_notified").maybeSingle();
    const r = unitUnlocks(alive, tiers, vids || [], un?.value || {});
    due = r.due;
    await supabaseAdmin.from("bot_state").upsert({ key: "unit_notified", value: r.next, updated_at: new Date().toISOString() });
  } else due = unlocksToday(alive, tiers, vids || [], today);
  const dc = due.length ? await discordIds(due.map((d) => d.user_id), new Map(alive.map((m) => [m.user_id, m]))) : new Map();
  let dms = 0, mails = 0;
  for (const d of due) {
    const subject = d.list.length === 1 ? `🔓 今天解鎖：${d.list[0].host} 主講第 ${d.list[0].part} 份課程` : `🔓 今天解鎖 ${d.list.length} 份系統分享`;
    const how = await dmOrMail(dc.get(d.user_id), d.email, { embed: courseUnlockEmbed(d.list), subject, html: courseMailHtml(d.list) });
    if (how === "dm") dms++; else if (how === "mail") mails++;
  }
  await supabaseAdmin.from("bot_state").upsert({ key: "course_mail", value: { day: today, at: new Date(now).toISOString(), due: due.length, dms, mails }, updated_at: new Date().toISOString() });
  return { ok: true, due: due.length, dms, mails, sent: dms + mails };
}
