// 後台：交易量（每人一輪：從加入那天起算，每一輪一個月）
// GET   /api/admin/volumes?which=current|previous   每位研究員「這一輪／上一輪」在各交易所的交易量、那一輪達到第幾級、今天的等級、填過的交易所 UID
// POST  /api/admin/volumes  { which, qualifiedOn: "2026-10-20", rows: [{ userId, amounts: { OKX, UM } }] }
//       Bybit、BingX 是自動同步的，這裡送來也會保留資料庫的數字
//       三級制度：那一輪達到第幾級就是下一輪的等級（規則在 shared/rules.js 的 TIERS，門檻固定、後台不能改）
import {
  supabaseAdmin, requireAdmin, readBody, route,
  EXCHANGES, AUTO_EXCHANGES, LOCKED_AUTO, TIERS, tierOf, todayTW, isDate, saveVolumes, periodFor, nextPeriod, anchorOf, tiersFor,
} from "../lib/index.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const whichOf = (v) => (v === "previous" ? "previous" : "current");

async function snapshot(which) {
  const [{ data: members, error: e1 }, { data: links }] = await Promise.all([
    supabaseAdmin.from("members").select("user_id, email, banned, note, created_at, free, min_tier, min_tier_until").order("created_at", { ascending: true }),
    supabaseAdmin.from("exchange_links").select("user_id, exchange, exchange_uid, account_name"),
  ]);
  if (e1) throw e1;
  const today = todayTW();
  const list = (members || []).map((m) => ({ m, p: periodFor(m, which, today) })).filter((x) => x.p);
  const starts = [...new Set(list.map((x) => x.p.start))];
  const { data: vols, error: e2 } = starts.length
    ? await supabaseAdmin.from("volumes").select("user_id, period_start, amounts, updated_at, updated_by, qualified_at").in("period_start", starts)
    : { data: [] };
  if (e2) throw e2;
  const tiers = await tiersFor(members || [], today);
  const byKey = new Map((vols || []).map((v) => [`${v.user_id}:${v.period_start}`, v]));
  const linkMap = new Map();
  // UM 的格子下面也寫開戶的英文姓名，對帳比較準
  for (const l of links || []) linkMap.set(l.user_id, { ...(linkMap.get(l.user_id) || {}), [l.exchange]: l.account_name ? `${l.exchange_uid}・${l.account_name}` : l.exchange_uid });
  return {
    which,
    today,
    exchanges: EXCHANGES,
    autoExchanges: LOCKED_AUTO, // 表格裡不能改的欄位
    syncExchanges: AUTO_EXCHANGES,
    tiers: TIERS.map(({ tier, usdt, lots }) => ({ tier, usdt, lots })),
    rows: list.map(({ m, p }) => {
      const v = byKey.get(`${m.user_id}:${p.start}`);
      return {
        user_id: m.user_id, email: m.email, banned: m.banned, note: m.note, free: !!m.free,
        tier: tiers.get(m.user_id)?.tier ?? 0, tier_until: tiers.get(m.user_id)?.until ?? null, // 今天的等級
        period_start: p.start, period_end: p.end, next_end: nextPeriod(anchorOf(m), p).end,
        amounts: v?.amounts || {}, updated_at: v?.updated_at || null, updated_by: v?.updated_by || null,
        cycle_tier: tierOf(v?.amounts || {}), // 那一輪達到第幾級（＝下一輪的等級）
        qualified_at: v?.qualified_at || null,
        links: linkMap.get(m.user_id) || {},
      };
    }),
  };
}

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    return res.status(200).json(await snapshot(whichOf(req.query?.which)));
  },

  async POST(req, res) {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;
    const b = readBody(req);
    const which = whichOf(b.which);
    if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 500) return res.status(400).json({ error: "沒有要儲存的資料" });
    const qualifiedOn = b.qualifiedOn === undefined ? todayTW() : b.qualifiedOn;
    if (!isDate(qualifiedOn)) return res.status(400).json({ error: "達標日期格式不正確" });
    const ids = b.rows.filter((r) => UUID_RE.test(String(r.userId || ""))).map((r) => String(r.userId));
    const { data: mems, error } = ids.length ? await supabaseAdmin.from("members").select("user_id, created_at").in("user_id", ids) : { data: [] };
    if (error) throw error;
    const byId = new Map((mems || []).map((m) => [m.user_id, m]));
    const entries = b.rows
      .filter((r) => byId.has(String(r.userId)))
      .map((r) => ({ user_id: String(r.userId), period: periodFor(byId.get(String(r.userId)), which), amounts: r.amounts, qualifiedOn }))
      .filter((e) => e.period);
    const { saved, tierUps } = await saveVolumes({ entries, updatedBy: ctx.user.email, keepAuto: true });
    if (!saved && !entries.length) return res.status(400).json({ error: "找不到這些研究員" });
    const snap = await snapshot(which);
    return res.status(200).json({ ...snap, saved, tierUps });
  },
});
