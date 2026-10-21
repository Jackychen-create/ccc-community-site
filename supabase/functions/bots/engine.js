// 機器人引擎：跑一支機器人（貼到它設定的 Webhook、記下結果），或每 5 分鐘看看這一輪該跑哪些
// 設定在 settings.bots：
//   outlets：[{ id, name, url }]  Webhook（「出口」），例如「股市整合頻道」「加密整合頻道」；網址只存在資料庫
//   bots：{ [key]: { enabled, outlet, thread, opts } }   每支機器人：開關、用哪個出口、貼到哪個討論串、選項
//   alertOutlet：出錯時通知哪個出口（管理員頻道）
import { BOTS, botByKey, isDue } from "./registry.js";
import { RUNNERS } from "./runners.js";
import { postWebhook, twHM, twWeekday, twStamp } from "./core.js";

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
  }
  return out;
}

// 出錯通知管理員（同一支 6 小時內只通知一次）
async function alertFailure(db, s, key, note, { now, base }) {
  const outlet = (s.outlets || []).find((o) => o.id === s.alertOutlet);
  if (!outlet) return;
  const st = await db.getState("bot_alerts", {});
  if (st[key] && now.getTime() - st[key] < 6 * 3600e3) return;
  await postWebhook(outlet.url, { embeds: [{ title: `⚠️ 機器人出錯：${botByKey(key)?.name || key}`, description: `${note}\n\n${twStamp(now.getTime())}（台灣時間）・到網站後台「機器人」看詳情`, color: 0xd08b57 }] }, { base });
  await db.setState("bot_alerts", { ...st, [key]: now.getTime() });
}

// 這一輪要跑哪些（有開、有設 Webhook、時間到）
export function dueBots(settings, now = new Date()) {
  const hm = twHM(now), wd = twWeekday(now);
  return BOTS.filter((b) => settings.bots?.[b.key]?.enabled && isDue(b.schedule, hm, wd)).map((b) => b.key);
}
