// 後台：一對一交流（第三級研究員每個月選一位主講，每位最多 5 位，超過照交易量排）
// GET   /api/admin/oneonone?month=2026-10        每位主講的名單（確定／候補、交易量、約好了沒）
// PATCH /api/admin/oneonone { userId, month, booked }   標記「已約好」（約好的一定算確定）
// DELETE /api/admin/oneonone?userId=&month=           把這位從名單拿掉
// 協作管理員（OC）也可以用（他自己也是主講）
import { supabaseAdmin, requireAdmin, readBody, route, thisMonthTW, oneOnOneBoard, isMonth } from "../lib/index.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const month = isMonth(req.query?.month) ? req.query.month : thisMonthTW();
    return res.status(200).json(await oneOnOneBoard(month));
  },

  async PATCH(req, res) {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;
    const b = readBody(req);
    if (!UUID_RE.test(String(b.userId || "")) || !isMonth(b.month) || typeof b.booked !== "boolean") return res.status(400).json({ error: "資料不正確" });
    const { data, error } = await supabaseAdmin.from("one_on_ones").update({ booked: b.booked, booked_by: b.booked ? ctx.user.email : null }).eq("user_id", b.userId).eq("month", b.month).select("user_id").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "找不到這筆" });
    return res.status(200).json(await oneOnOneBoard(b.month));
  },

  async DELETE(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const userId = String(req.query?.userId || ""), month = String(req.query?.month || "");
    if (!UUID_RE.test(userId) || !isMonth(month)) return res.status(400).json({ error: "資料不正確" });
    const { error } = await supabaseAdmin.from("one_on_ones").delete().eq("user_id", userId).eq("month", month);
    if (error) throw error;
    return res.status(200).json(await oneOnOneBoard(month));
  },
});
