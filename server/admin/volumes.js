// 後台：每月交易量
// GET   /api/admin/volumes?month=2026-10   這個月每位研究員在各交易所的交易量、門檻、資格、綁定的交易所 UID（links）
// POST  /api/admin/volumes  { month, rows: [{ userId, amounts: { OKX } }] }（Bybit、BingX 是自動同步的，這裡送來也會保留資料庫的數字）
//       { month, qualifiedOn: "2026-10-15", rows }
//       儲存交易量；這次「新達標」的人記下達標日，觀看資格延長到達標日起一個月（10/15 → 11/14）
//       原本更晚就不動；「不限」的研究員不動；同一個月已經達標過的不會再延一次
// PATCH /api/admin/volumes  { threshold }    修改門檻（USDT）
import {
  supabaseAdmin, requireAdmin, readBody, route,
  EXCHANGES, AUTO_EXCHANGES, getThreshold, thisMonthTW, monthEnd, isMonth, isQualified, todayTW, cycleEnd, isDate, saveVolumes,
} from "../lib/index.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function snapshot(month) {
  const [threshold, { data: members, error: e1 }, { data: vols, error: e2 }, { data: links }] = await Promise.all([
    getThreshold(),
    supabaseAdmin.from("members").select("user_id, email, banned, access_until, note").order("created_at", { ascending: true }),
    supabaseAdmin.from("volumes").select("user_id, amounts, updated_at, updated_by, qualified_at").eq("month", month),
    supabaseAdmin.from("exchange_links").select("user_id, exchange, exchange_uid"),
  ]);
  if (e1 || e2) throw e1 || e2;
  const byUser = new Map((vols || []).map((v) => [v.user_id, v]));
  const linkMap = new Map();
  for (const l of links || []) linkMap.set(l.user_id, { ...(linkMap.get(l.user_id) || {}), [l.exchange]: l.exchange_uid });
  return {
    month,
    monthEnd: monthEnd(month),
    exchanges: EXCHANGES,
    autoExchanges: AUTO_EXCHANGES,
    threshold,
    rows: (members || []).map((m) => {
      const v = byUser.get(m.user_id);
      return {
        user_id: m.user_id, email: m.email, banned: m.banned, access_until: m.access_until, note: m.note,
        amounts: v?.amounts || {}, updated_at: v?.updated_at || null, updated_by: v?.updated_by || null,
        qualified: v ? isQualified(v.amounts, threshold) : false,
        qualified_at: v?.qualified_at || null,
        qualified_until: v?.qualified_at ? cycleEnd(v.qualified_at) : null,
        links: linkMap.get(m.user_id) || {},
      };
    }),
  };
}

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const month = req.query?.month || thisMonthTW();
    if (!isMonth(month)) return res.status(400).json({ error: "月份格式不正確" });
    return res.status(200).json(await snapshot(month));
  },

  async POST(req, res) {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;
    const b = readBody(req);
    if (!isMonth(b.month)) return res.status(400).json({ error: "月份格式不正確" });
    if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 500) return res.status(400).json({ error: "沒有要儲存的資料" });

    const qualifiedOn = b.qualifiedOn === undefined ? todayTW() : b.qualifiedOn;
    if (!isDate(qualifiedOn)) return res.status(400).json({ error: "達標日期格式不正確" });
    const entries = b.rows
      .filter((r) => UUID_RE.test(String(r.userId || "")))
      .map((r) => ({ user_id: String(r.userId), amounts: r.amounts, qualifiedOn }));
    const { saved, extended } = await saveVolumes({ month: b.month, entries, updatedBy: ctx.user.email, keepAuto: true });
    if (!saved) return res.status(400).json({ error: "找不到這些研究員" });
    const snap = await snapshot(b.month);
    return res.status(200).json({ ...snap, saved, extended, until: cycleEnd(qualifiedOn) });
  },

  async PATCH(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const t = Math.round(Number(b.threshold));
    if (!Number.isFinite(t) || t <= 0 || t > 1e12) return res.status(400).json({ error: "門檻要是大於 0 的數字" });
    const { error } = await supabaseAdmin.from("settings").upsert({ key: "volume_threshold", value: t });
    if (error) throw error;
    return res.status(200).json({ ok: true, threshold: t });
  },
});
