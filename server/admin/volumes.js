// 後台：每月交易量
// GET   /api/admin/volumes?month=2026-10   這個月每位研究員在三間交易所的交易量、門檻、資格
// POST  /api/admin/volumes  { month, rows: [{ userId, amounts: { OKX, Bybit, UM } }] }
//       { month, qualifiedOn: "2026-10-15", rows }
//       儲存交易量；這次「新達標」的人記下達標日，觀看資格延長到達標日起一個月（10/15 → 11/14）
//       原本更晚就不動；「不限」的研究員不動；同一個月已經達標過的不會再延一次
// PATCH /api/admin/volumes  { threshold }    修改門檻（USDT）
import {
  supabaseAdmin, requireAdmin, readBody, route,
  EXCHANGES, getThreshold, thisMonthTW, monthEnd, isMonth, cleanAmounts, isQualified, todayTW, cycleEnd, isDate,
} from "../lib/index.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function snapshot(month) {
  const [threshold, { data: members, error: e1 }, { data: vols, error: e2 }] = await Promise.all([
    getThreshold(),
    supabaseAdmin.from("members").select("user_id, email, banned, access_until, note").order("created_at", { ascending: true }),
    supabaseAdmin.from("volumes").select("user_id, amounts, updated_at, updated_by, qualified_at").eq("month", month),
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
        qualified_at: v?.qualified_at || null,
        qualified_until: v?.qualified_at ? cycleEnd(v.qualified_at) : null,
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
    const threshold = await getThreshold();
    const ids = b.rows.map((r) => String(r.userId || "")).filter((id) => UUID_RE.test(id));
    const [{ data: members, error }, { data: prev, error: e2 }] = await Promise.all([
      supabaseAdmin.from("members").select("user_id, access_until").in("user_id", ids),
      supabaseAdmin.from("volumes").select("user_id, qualified_at").eq("month", b.month).in("user_id", ids),
    ]);
    if (error || e2) throw error || e2;
    const known = new Map((members || []).map((m) => [m.user_id, m]));
    const before = new Map((prev || []).map((v) => [v.user_id, v.qualified_at]));

    const upserts = [];
    const extend = new Map(); // 新的到期日 → [user_id]
    for (const r of b.rows) {
      const m = known.get(String(r.userId));
      if (!m) continue;
      const amounts = cleanAmounts(r.amounts);
      const ok = isQualified(amounts, threshold);
      // 這個月已經達標過就沿用原本的達標日；這次才達標的記今天（或管理員選的日期）；沒達標清掉
      const qualified_at = ok ? before.get(m.user_id) || qualifiedOn : null;
      upserts.push({ user_id: m.user_id, month: b.month, amounts, qualified_at, updated_at: new Date().toISOString(), updated_by: ctx.user.email });
      if (ok && !before.get(m.user_id)) {
        const until = cycleEnd(qualified_at);
        // 「不限」（空白）的研究員維持不限；原本就更晚的不縮短
        if (m.access_until && m.access_until < until) {
          if (!extend.has(until)) extend.set(until, []);
          extend.get(until).push(m.user_id);
        }
      }
    }
    if (!upserts.length) return res.status(400).json({ error: "找不到這些研究員" });
    const { error: upErr } = await supabaseAdmin.from("volumes").upsert(upserts);
    if (upErr) throw upErr;
    let extended = 0;
    for (const [until, list] of extend) {
      const { error: exErr } = await supabaseAdmin.from("members").update({ access_until: until }).in("user_id", list);
      if (exErr) throw exErr;
      extended += list.length;
    }
    const snap = await snapshot(b.month);
    return res.status(200).json({ ...snap, saved: upserts.length, extended, until: cycleEnd(qualifiedOn) });
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
