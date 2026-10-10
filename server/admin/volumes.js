// 後台：每月交易量
// GET   /api/admin/volumes?month=2026-10   這個月每位會員在三間交易所的交易量、門檻、資格
// POST  /api/admin/volumes  { month, rows: [{ userId, amounts: { OKX, Bybit, UM } }] }
//       儲存交易量；任一間達標 → 觀看資格延長到那個月底（原本更晚就不動；「不限」的會員不動）
// PATCH /api/admin/volumes  { threshold }    修改門檻（USDT）
import {
  supabaseAdmin, requireAdmin, readBody, route,
  EXCHANGES, getThreshold, thisMonthTW, monthEnd, isMonth, cleanAmounts, isQualified,
} from "../_lib.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function snapshot(month) {
  const [threshold, { data: members, error: e1 }, { data: vols, error: e2 }] = await Promise.all([
    getThreshold(),
    supabaseAdmin.from("members").select("user_id, email, banned, access_until, note").order("created_at", { ascending: true }),
    supabaseAdmin.from("volumes").select("user_id, amounts, updated_at, updated_by").eq("month", month),
  ]);
  if (e1 || e2) throw e1 || e2;
  const byUser = new Map((vols || []).map((v) => [v.user_id, v]));
  return {
    month,
    monthEnd: monthEnd(month),
    exchanges: EXCHANGES,
    threshold,
    rows: (members || []).map((m) => {
      const v = byUser.get(m.user_id);
      return {
        user_id: m.user_id, email: m.email, banned: m.banned, access_until: m.access_until, note: m.note,
        amounts: v?.amounts || {}, updated_at: v?.updated_at || null, updated_by: v?.updated_by || null,
        qualified: v ? isQualified(v.amounts, threshold) : false,
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

    const threshold = await getThreshold();
    const end = monthEnd(b.month);
    const ids = b.rows.map((r) => String(r.userId || "")).filter((id) => UUID_RE.test(id));
    const { data: members, error } = await supabaseAdmin.from("members").select("user_id, access_until").in("user_id", ids);
    if (error) throw error;
    const known = new Map((members || []).map((m) => [m.user_id, m]));

    const upserts = [];
    const extend = [];
    for (const r of b.rows) {
      const m = known.get(String(r.userId));
      if (!m) continue;
      const amounts = cleanAmounts(r.amounts);
      upserts.push({ user_id: m.user_id, month: b.month, amounts, updated_at: new Date().toISOString(), updated_by: ctx.user.email });
      // 達標：資格延長到這個月底。「不限」（空白）的會員維持不限；原本就更晚的不縮短
      if (isQualified(amounts, threshold) && m.access_until && m.access_until < end) extend.push(m.user_id);
    }
    if (!upserts.length) return res.status(400).json({ error: "找不到這些會員" });
    const { error: upErr } = await supabaseAdmin.from("volumes").upsert(upserts);
    if (upErr) throw upErr;
    if (extend.length) {
      const { error: exErr } = await supabaseAdmin.from("members").update({ access_until: end }).in("user_id", extend);
      if (exErr) throw exErr;
    }
    const snap = await snapshot(b.month);
    return res.status(200).json({ ...snap, saved: upserts.length, extended: extend.length });
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
