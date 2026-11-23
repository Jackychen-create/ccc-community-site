// 排程：開播前 30 分鐘在 Discord 公告下面提醒
// 由 Supabase 的 pg_cron 每 5 分鐘呼叫，見 supabase/schema.sql v1.15
// POST /api/cron/lives   Header：X-Cron-Secret = Cloudflare 環境變數 CRON_SECRET
import { supabaseAdmin, route, cronAuthorized, announceLive, REMIND_BEFORE_MIN } from "../lib/index.js";
import { maybeWeeklyReviews } from "../lib/reviews.js";
import { flushAnnouncements } from "../lib/announce.js";
import { runOnboarding } from "../lib/onboarding.js";
import { runCourseMail } from "../lib/course-mail.js";
const COURSE_MAIL_ON = false;
import { runExchangeRoles } from "../lib/exchange-roles.js";
import { okxProbe } from "../lib/okx.js";
import { fixHighlightFooters } from "../lib/highlights.js";
import { syncPanelMessage } from "../lib/discord-setup.js";
import { runRebrand } from "../lib/rebrand.js";

export default route({
  async POST(req, res) {
    if (!cronAuthorized(req)) return res.status(401).json({ error: "unauthorized" });
    const now = Date.now();
    // 30 分鐘內要開始、還沒提醒過的（開始超過 10 分鐘就不提醒了）
    const { data, error } = await supabaseAdmin.from("lives").select("*")
      .eq("status", "scheduled").is("reminded_at", null)
      .gte("starts_at", new Date(now - 10 * 60e3).toISOString())
      .lte("starts_at", new Date(now + REMIND_BEFORE_MIN * 60e3).toISOString());
    if (error) throw error;
    let reminded = 0;
    for (const live of data || []) {
      // 先標記再發，排程重疊時不會提醒兩次
      const { data: claimed } = await supabaseAdmin.from("lives").update({ reminded_at: new Date().toISOString() })
        .eq("id", live.id).is("reminded_at", null).select("id").maybeSingle();
      if (!claimed) continue;
      const r = await announceLive(live, "reminder");
      if (r.posted) reminded++;
    }
    // 順便：每週日 21:00 整理交易檢討投稿（server/lib/reviews.js）
    const reviews = await maybeWeeklyReviews(now).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    // 順便：公告佇列（bot_state 的 announce_queue）
    const announced = await flushAnnouncements().catch((e) => [{ ok: false, error: String(e?.message || e) }]);
    // 順便：新人試用週，每天 20:00 私訊（server/lib/onboarding.js）
    const onboarding = await runOnboarding(now).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    // 課程解鎖提醒信（server/lib/course-mail.js）：v1.37.0 系統分享改成交易分享、沒有解鎖排程，停掉
    const courseMail = COURSE_MAIL_ON ? await runCourseMail(now).catch((e) => ({ ok: false, error: String(e?.message || e) })) : { skipped: true };
    // 順便：每小時補發交易所活動身分組（server/lib/exchange-roles.js）
    const exchangeRoles = await runExchangeRoles(now).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    // OKX 連線測試：bot_state 的 okx_probe 有 { uid, pending: true } 就跑一次，結果寫回去（設定 OKX 時用）
    const okx = await runOkxProbe().catch((e) => ({ ok: false, error: String(e?.message || e) }));
    // 一次性：舊的直播精華卡片拿掉「AI」字眼（v1.26.32）
    const footers = await fixHighlightFooters().catch((e) => ({ ok: false, error: String(e?.message || e) }));
    // 報名頻道的固定訊息跟程式不一樣了（例如拿掉 UM 開戶按鈕）就自動更新
    const panel = await syncPanelMessage().catch((e) => ({ ok: false, error: String(e?.message || e) }));
    // 所有機器人改名「研研（助理）」、換貓頭鷹頭貼、今天的訊息再發一次（做完就不動，server/lib/rebrand.js）
    const avatar = await runRebrand(now).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    return res.status(200).json({ ok: true, due: (data || []).length, reminded, reviews, announced, onboarding, courseMail, exchangeRoles, okx, footers, panel, avatar });
  },
});

async function runOkxProbe() {
  const { data } = await supabaseAdmin.from("bot_state").select("value").eq("key", "okx_probe").maybeSingle();
  if (!data?.value?.pending || !data.value.uid) return null;
  const r = await okxProbe(data.value.uid);
  await supabaseAdmin.from("bot_state").upsert({ key: "okx_probe", value: { uid: data.value.uid, pending: false, result: r }, updated_at: new Date().toISOString() });
  return { probed: true, ok: r.ok };
}
