// 機器人引擎：跑一支機器人（貼到它設定的 Webhook、記下結果），或每 5 分鐘看看這一輪該跑哪些
// 設定在 settings.bots：
//   outlets：[{ id, name, url }]  Webhook（「出口」），例如「股市整合頻道」「加密整合頻道」；網址只存在資料庫
//   bots：{ [key]: { enabled, outlet, thread, opts } }   每支機器人：開關、用哪個出口、貼到哪個討論串、選項
//   alertOutlet：出錯時通知哪個出口（管理員頻道）
import { BOTS, botByKey, isDue } from "./registry.js";
import { RUNNERS } from "./runners.js";
import { postWebhook, twHM, twWeekday, twStamp, twDate, addDays, author, footer } from "./core.js";

export async function runBot(key, { db, now = new Date(), settings, force = false, dryRun = false, base } = {}) {
  const meta = botByKey(key), fn = RUNNERS[key];
  if (!meta || !fn) return { ok: false, note: "沒有這支機器人" };
  const s = settings || (await db.settings());
  const conf = s.bots?.[key] || {};
  const outlet = (s.outlets || []).find((o) => o.id === conf.outlet);
  if (!dryRun && !outlet) return { ok: false, note: "還沒設定要貼到哪個 Webhook" };
  const opts = { ...Object.fromEntries((meta.opts || []).map((o) => [o.k, o.def])), ...(conf.opts || {}) };
  const t0 = Date.now();
  let posted = 0;
  const ctx = {
    db, now, force, dryRun, opts, key,
    post: async (payload) => { await postWebhook(outlet.url, payload, { thread: conf.thread || outlet.thread || undefined, base }); posted++; },
  };
  let out;
  try {
    const r = (await fn(ctx)) || {};
    out = { ok: true, posted: r.posted ?? posted, note: r.note || r.skipped || "", skipped: !!r.skipped, retry: !!r.retry, preview: r.preview };
  } catch (e) {
    out = { ok: false, posted, note: String(e?.message || e).slice(0, 300) };
  }
  out.ms = Date.now() - t0;
  if (!dryRun) {
    // 沒事的「略過」不記（每 10 分鐘一次的雷達會洗版）；發文、出錯、要等資料的才記
    if (!out.skipped || out.retry || force) await db.logRun(key, out).catch(() => {});
    if (!out.ok) await alertFailure(db, s, key, out.note, { now, base }).catch(() => {});
    // 定時的（每天一次、每週一次）：今天處理完了（發了、休市、沒新聞都算），漏發檢查就不會叫
    if (!force && out.ok && !out.retry && meta.schedule?.at && (out.posted || out.skipped)) await markDone(db, key, now).catch(() => {});
  }
  return out;
}
async function markDone(db, key, now) {
  const st = await db.getState("bot_day", {});
  await db.setState("bot_day", { ...st, [key]: twDate(now) });
}

// 出錯通知管理員（同一支 6 小時內只通知一次）
export async function alertFailure(db, s, key, note, { now, base }) {
  const outlet = (s.outlets || []).find((o) => o.id === s.alertOutlet);
  if (!outlet) return;
  const st = await db.getState("bot_alerts", {});
  if (st[key] && now.getTime() - st[key] < 6 * 3600e3) return;
  await postWebhook(outlet.url, { embeds: [{ author: author("機器人管理"), title: `⚠️ ${botByKey(key)?.name || key} 出錯了`, description: `> ${note}\n\n🕒 ${twStamp(now.getTime())}（台灣時間）\n🔧 到網站後台「機器人」看詳情、按「立即發一次」補發`, color: 0xd08b57 }] }, { base });
  await db.setState("bot_alerts", { ...st, [key]: now.getTime() });
}

// 這一輪要跑哪些（有開、有設 Webhook、時間到）
export function dueBots(settings, now = new Date()) {
  const hm = twHM(now), wd = twWeekday(now);
  return BOTS.filter((b) => settings.bots?.[b.key]?.enabled && isDue(b.schedule, hm, wd)).map((b) => b.key);
}

const toMin = (hm) => { const [h, m] = String(hm).split(":").map(Number); return h * 60 + m; };
const daysOf = (d) => (d === "weekdays" ? [1, 2, 3, 4, 5] : d === "daily" || !d ? [0, 1, 2, 3, 4, 5, 6] : d);
// 漏發檢查：定時的機器人到了最後重試時間（until）今天還沒處理完，就通知管理員（例如資料一直沒出來、來源連不上）
export function missedBots(settings, dayState, now = new Date(), tick = 5) {
  const hm = toMin(twHM(now)), wd = twWeekday(now), day = twDate(now);
  return BOTS.filter((b) => {
    const sc = b.schedule || {};
    if (!settings.bots?.[b.key]?.enabled || !sc.at || !sc.until || !daysOf(sc.days).includes(wd)) return false;
    const end = toMin(sc.until);
    return hm >= end && hm < end + tick && dayState?.[b.key] !== day;
  }).map((b) => b.key);
}
export async function checkMissed(db, settings, { now = new Date(), base } = {}) {
  const keys = missedBots(settings, await db.getState("bot_day", {}), now);
  for (const k of keys) {
    const b = botByKey(k);
    const note = `到 ${b.schedule.until} 還沒發出去（官方資料一直沒出來，或來源連不上）。今天不會再試，可以到後台按「立即發一次」補發。`;
    await db.logRun(k, { ok: false, posted: 0, note }).catch(() => {});
    await alertFailure(db, settings, k, note, { now, base }).catch(() => {});
  }
  return keys;
}

// 機器人週報：每週日 21:30 發到「出錯時通知」的 Webhook：這週每支發了幾則、出錯幾次
export function weeklyEmbed(settings, runs, now = new Date()) {
  const on = BOTS.filter((b) => settings.bots?.[b.key]?.enabled);
  const lines = on.map((b) => {
    const mine = runs.filter((r) => r.bot === b.key);
    const posted = mine.reduce((a, r) => a + (r.posted || 0), 0);
    const bad = mine.filter((r) => !r.ok);
    return `${bad.length ? "⚠️" : posted ? "✅" : "・"} ${b.name}：發了 ${posted} 則${bad.length ? `，出錯 ${bad.length} 次（最近：${String(bad[0].note || "").slice(0, 60)}）` : ""}`;
  });
  const off = BOTS.length - on.length;
  const day = twDate(now);
  return {
    author: author("機器人管理"),
    title: `🩺 機器人週報｜${addDays(day, -6).slice(5).replace("-", "/")}–${day.slice(5).replace("-", "/")}`,
    color: lines.some((l) => l.startsWith("⚠️")) ? 0xd08b57 : 0x5fa285,
    description: (lines.length ? lines.join("\n") : "目前沒有打開的機器人。") + (off ? `\n\n另外 ${off} 支沒打開。` : ""),
    footer: footer("每週日 21:30・詳情在網站後台「機器人」"),
  };
}
export async function weeklyReport(db, settings, { now = new Date(), base } = {}) {
  if (twWeekday(now) !== 0 || twHM(now) < "21:30" || twHM(now) >= "21:35") return false;
  const outlet = (settings.outlets || []).find((o) => o.id === settings.alertOutlet);
  if (!outlet) return false;
  const st = await db.getState("bot_weekly", {});
  if (st.day === twDate(now)) return false;
  const since = new Date(now.getTime() - 7 * 86400e3).toISOString();
  const runs = (await db.req("GET", `/bot_runs?at=gte.${since}&select=bot,ok,posted,note,at&order=at.desc&limit=3000`)) || [];
  await postWebhook(outlet.url, { embeds: [weeklyEmbed(settings, runs, now)] }, { base });
  await db.setState("bot_weekly", { day: twDate(now) });
  return true;
}
