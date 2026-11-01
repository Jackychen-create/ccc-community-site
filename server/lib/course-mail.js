// 課程解鎖提醒：每天早上 9 點（台灣時間），今天解鎖新一份教學課程的研究員收到一封信
// 誰：沒停權、開著通知（members.notify）、等級看得到那一份、不是第三級（第三級全部已經解鎖）
// 加入當天（第 0 週）那份不寄；影片還沒上傳的那份不寄
// 一天只跑一次：bot_state 的 course_mail { day }
import { supabaseAdmin } from "./env.js";
import { sendMail, mailReady, escHtml } from "./mail.js";
import { tiersFor } from "./tier.js";
import { twDate } from "./dates.js";
import { COURSE_HOSTS, COURSE_PARTS, courseUnlockDate, courseWeek, courseTierOk, courseSkipSchedule } from "../../public/assets/js/shared/rules.js";
import { SITE_URL } from "./discord-flow.js";

export const COURSE_MAIL_HOUR = 9;

// 今天每個人解鎖哪幾份（純計算，測試用）
export function unlocksToday(members, tiers, courseVideos, today) {
  const vid = new Map(courseVideos.map((v) => [`${v.course_host}:${v.course_part}`, v]));
  const out = [];
  for (const m of members) {
    if (m.banned || m.notify === false || !m.email) continue;
    const tier = tiers.get(m.user_id)?.tier || 0;
    if (!tier || courseSkipSchedule(tier)) continue;
    const start = twDate(m.created_at);
    const list = [];
    for (let part = 1; part <= COURSE_PARTS; part++) for (const host of COURSE_HOSTS) {
      if (courseWeek(host, part) === 0 || courseUnlockDate(start, host, part) !== today) continue;
      const v = vid.get(`${host}:${part}`);
      if (v && courseTierOk(tier, part)) list.push({ host, part, id: v.id, title: v.title });
    }
    if (list.length) out.push({ email: m.email, list });
  }
  return out;
}

export function courseMailHtml(list) {
  const items = list.map((x) => `<li style="margin:6px 0"><a href="${SITE_URL}/#/v/${x.id}" style="color:#9a6b1f;font-weight:700">${escHtml(x.host)} 講師第 ${x.part} 份：${escHtml(x.title)}</a></li>`).join("");
  return `<p>今天你的教學課程解鎖了新的一份：</p><ul style="padding-left:18px">${items}</ul>
<p>每週解鎖一份，照順序看效果最好。全部課程和你每一份的解鎖日期在網站「教學課程」。</p>
<p><a href="${SITE_URL}/#/course" style="display:inline-block;background:#cda45e;color:#1b1f1d;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">去看課程</a></p>
<p style="color:#7a817d;font-size:13px">不想收到通知：網站右上角選單 →「新影片寄信通知」關掉。</p>`;
}

export async function runCourseMail(now = Date.now(), { force = false } = {}) {
  const tw = new Date(now + 8 * 3600e3);
  if (!force && (tw.getUTCHours() !== COURSE_MAIL_HOUR || tw.getUTCMinutes() >= 10)) return null;
  if (!mailReady()) return { ok: false, error: "還沒設定寄信服務" };
  const today = twDate(now);
  const { data: st } = await supabaseAdmin.from("bot_state").select("value").eq("key", "course_mail").maybeSingle();
  if (!force && st?.value?.day === today) return { ok: true, skipped: "今天寄過了" };
  // 先記再寄：排程重疊時不會寄兩次
  await supabaseAdmin.from("bot_state").upsert({ key: "course_mail", value: { day: today, at: new Date(now).toISOString() }, updated_at: new Date().toISOString() });
  const [{ data: members, error }, { data: vids, error: vErr }] = await Promise.all([
    supabaseAdmin.from("members").select("user_id, email, banned, notify, created_at, free, min_tier, min_tier_until"),
    supabaseAdmin.from("videos").select("id, title, course_host, course_part").eq("is_published", true).not("course_host", "is", null),
  ]);
  if (error) throw error;
  if (vErr) throw vErr;
  const alive = (members || []).filter((m) => !m.banned);
  const tiers = await tiersFor(alive, today);
  const due = unlocksToday(alive, tiers, vids || [], today);
  let sent = 0;
  for (const d of due) {
    const subject = d.list.length === 1 ? `🔓 今天解鎖：${d.list[0].host} 講師第 ${d.list[0].part} 份課程` : `🔓 今天解鎖 ${d.list.length} 份教學課程`;
    if (await sendMail({ to: [d.email], subject, html: courseMailHtml(d.list) })) sent++;
  }
  await supabaseAdmin.from("bot_state").upsert({ key: "course_mail", value: { day: today, at: new Date(now).toISOString(), due: due.length, sent }, updated_at: new Date().toISOString() });
  return { ok: true, due: due.length, sent };
}
