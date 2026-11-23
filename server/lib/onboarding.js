// 新人試用週：Discord 報名通過後的第 1～7 天，每天晚上 8 點（台灣時間）助教私訊一則引導
// 誰：discord_applications 通過（reviewed_at）在後台打開之後的人；同一個人只會收到一次同一天的
// 紀錄：bot_state 的 onboarding_sent { users: { discordId: { day, at } } }，超過 14 天的會清掉
// 第 1 天看他註冊網站了沒（報名通過拿到的實驗室密碼有沒有被用掉），沒有就提醒
import { supabaseAdmin } from "./env.js";
import { discordApi, getDiscordSettings, sendMessage } from "./discord.js";
import { SITE_URL, LAB_URL } from "./discord-flow.js";
import { BRAND } from "./chatlog.js";
import { reviewEmojisOf, emojiText } from "./reviews.js";

const LOGO = `${SITE_URL}/assets/brand/ccc-bot.png`;
export const ONBOARD_DAYS = 7;
export const ONBOARD_HOUR = 20;
const twDay = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
const ch = (id, name) => (id ? `<#${id}>` : `「${name}」頻道`);

// 每一天的內容；s＝Discord 設定，who＝{ registered, code }
export function onboardingStep(day, s = {}, who = {}) {
  const emo = emojiText(reviewEmojisOf(s)[0]);
  const steps = {
    1: who.registered === false
      ? { title: "先把實驗室培訓房開通好", body: `你還沒開通網站喔！直播紀錄、交易分享都在實驗室培訓房。\n\n到 ${LAB_URL} 選交易所、貼上 UID，再用 Discord 授權就開通了（用報名時同一間交易所、同一個 UID）。` }
      : { title: "從直播紀錄開始", body: `網站登入後先看最新一場「直播紀錄」，可以跳章節、記筆記。\n「交易分享」上架就能看，加入的研究員都看得到。\n\n${LAB_URL}` },
    2: { title: "直播和直播精華", body: `會員直播會在 Discord 公告時間，錯過了到網站「直播紀錄」看。\n每一場直播助教都會整理重點和章節，貼在 ${ch(s.highlightChannelId, "直播精華")}，沒空看完整場可以先看重點。` },
    3: { title: "想聽主講點評你的交易？", body: `把交易貼到 ${ch(s.perfChannelId, "交易績效")}，對想聽主講點評的交易按 ${emo}，自己的、別人的都可以投。\n每週日晚上 9 點整理票數，主講挑票多的在直播點評。` },
    4: { title: "來研究員大廳聊聊", body: `研究員大廳是研究員的討論區，每天助教會整理一則前一天的「每日回顧」，錯過的討論看回顧就好。\n${s.labChannelId ? `公告都在 <#${s.labChannelId}>。` : ""}` },
    5: { title: "筆記和提問", body: `看直播紀錄時可以在任何一秒記筆記，之後到「我的筆記」一次看完。\n看不懂的地方，網站右上角選單「我的提問」直接問。` },
    6: { title: "有問題找誰", body: `網站右上角選單「我的提問」可以直接問管理員，回覆會寄信給你。\n帳號、交易所的問題也可以在 Discord 開客服單。` },
    7: { title: "第一週辛苦了 🎉", body: `這週就到這裡！接下來照自己的步調：直播有空就來、錯過的看直播紀錄、交易貼到績效讓大家一起看。\n實驗室很高興有你 🙌` },
  };
  const st = steps[day];
  if (!st) return null;
  return {
    author: { name: `${BRAND}｜新人第一週`, icon_url: LOGO },
    title: `第 ${day} 天｜${st.title}`,
    description: st.body,
    color: 0xcda45e,
    footer: { text: `新人第一週 ${day}/${ONBOARD_DAYS}・每天晚上 8 點一則`, icon_url: LOGO },
  };
}

async function loadSent() {
  const { data } = await supabaseAdmin.from("bot_state").select("value").eq("key", "onboarding_sent").maybeSingle();
  return data?.value?.users ? data.value : { users: {} };
}
async function saveSent(st, now) {
  const keep = Object.fromEntries(Object.entries(st.users).filter(([, v]) => now - Date.parse(v.at) < 14 * 86400e3));
  const { error } = await supabaseAdmin.from("bot_state").upsert({ key: "onboarding_sent", value: { users: keep }, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// 這次要發給誰、第幾天（後台預覽也用）
export async function onboardingDue(now = Date.now(), s = null) {
  s ||= await getDiscordSettings();
  if (!s.onboardingOn) return { s, due: [], people: [] };
  const since = Math.max(Date.parse(s.onboardingSince || 0) || 0, now - (ONBOARD_DAYS + 1) * 86400e3);
  const { data: apps } = await supabaseAdmin.from("discord_applications").select("discord_user_id, discord_name, invite_code, reviewed_at")
    .eq("status", "approved").gte("reviewed_at", new Date(since).toISOString()).order("reviewed_at", { ascending: true });
  const today = twDay(now);
  const byUser = new Map();
  for (const a of apps || []) if (!byUser.has(a.discord_user_id)) byUser.set(a.discord_user_id, a); // 同一個人通過兩次：用第一次
  const sent = await loadSent();
  const people = [...byUser.values()].map((a) => ({ ...a, day: daysBetween(twDay(Date.parse(a.reviewed_at)), today), last: sent.users[a.discord_user_id]?.day || 0 }))
    .filter((p) => p.day >= 0 && p.day <= ONBOARD_DAYS);
  return { s, sent, people, due: people.filter((p) => p.day >= 1 && p.day > p.last) };
}

// 每 5 分鐘的排程叫：每天 20:00～20:10（台灣時間）發
export async function runOnboarding(now = Date.now(), { force = false } = {}) {
  const tw = new Date(now + 8 * 3600e3);
  if (!force && (tw.getUTCHours() !== ONBOARD_HOUR || tw.getUTCMinutes() >= 10)) return null;
  const { s, sent, due } = await onboardingDue(now);
  if (!due.length) return { ok: true, sent: 0 };
  // 第 1 天看有沒有註冊（實驗室密碼用掉了沒）
  const codes = due.filter((p) => p.day === 1 && p.invite_code).map((p) => p.invite_code);
  const { data: used } = codes.length ? await supabaseAdmin.from("members").select("invite_code").in("invite_code", codes) : { data: [] };
  const usedSet = new Set((used || []).map((m) => m.invite_code));
  // 先記再發：排程重疊時不會發兩次
  for (const p of due) sent.users[p.discord_user_id] = { day: p.day, at: new Date(now).toISOString() };
  await saveSent(sent, now);
  let ok = 0;
  const failed = [];
  for (const p of due) {
    const embed = onboardingStep(p.day, s, p.day === 1 ? { registered: p.invite_code ? usedSet.has(p.invite_code) : undefined, code: p.invite_code } : {});
    try {
      const dmc = await discordApi("POST", "/users/@me/channels", { recipient_id: p.discord_user_id });
      await sendMessage(dmc.id, { embeds: [embed], allowed_mentions: { parse: [] } });
      ok++;
    } catch (e) {
      failed.push({ user: p.discord_name || p.discord_user_id, day: p.day, error: String(e?.message || e).slice(0, 120) });
    }
  }
  return { ok: true, sent: ok, failed };
}
