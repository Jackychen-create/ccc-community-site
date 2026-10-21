// Supabase Edge Function「bots」：CCC Market Lab 的定時機器人（台股、美股、加密、社群）
// 排程：Supabase pg_cron 每 5 分鐘 POST 一次（Header x-cron-secret＝Vault 的 cron_secret），這裡決定這一輪跑哪些
// 後台「機器人」的「立即執行／預覽」也走這裡：POST { run: "tw_close", force: true, dryRun: true }
// 部署：supabase functions deploy bots --no-verify-jwt（用 x-cron-secret 自己驗證）
// 這裡不放任何金鑰；Webhook 網址存在資料庫 settings.bots，只有 service role 讀得到
import { makeDb } from "./core.js";
import { runBot, dueBots, checkMissed, weeklyReport } from "./engine.js";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const db = makeDb(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const secret = req.headers.get("x-cron-secret") || "";
  if (!(await db.auth(secret))) return json({ error: "unauthorized" }, 401);
  let b: { run?: string; force?: boolean; dryRun?: boolean } = {};
  try { b = await req.json(); } catch { /* 空的也可以 */ }
  const now = new Date();
  const settings = await db.settings();
  if (b.run) return json(await runBot(b.run, { db, now, settings, force: !!b.force, dryRun: !!b.dryRun }));
  // 排程：每支機器人各自開一次 Edge Function 跑（各有各的時間和 CPU 額度）
  const keys = dueBots(settings, now);
  const self = `${url.replace(/\/$/, "")}/functions/v1/bots`;
  const results = await Promise.all(keys.map(async (k) => {
    try {
      const r = await fetch(self, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": secret }, body: JSON.stringify({ run: k }), signal: AbortSignal.timeout(140000) });
      return [k, await r.json()];
    } catch (e) {
      return [k, { ok: false, note: String((e as Error)?.message || e) }];
    }
  }));
  // 漏發檢查、週報（出錯不影響這一輪）
  await checkMissed(db, settings, { now }).catch(() => {});
  await weeklyReport(db, settings, { now }).catch(() => {});
  // 每天清一次 14 天前的執行紀錄
  if (now.getUTCHours() === 19 && now.getUTCMinutes() < 5) await db.req("DELETE", `/bot_runs?at=lt.${new Date(now.getTime() - 14 * 86400e3).toISOString()}`).catch(() => {});
  return json({ ran: Object.fromEntries(results) });
});
