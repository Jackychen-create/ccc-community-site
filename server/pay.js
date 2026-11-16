// 付費（v1.28.0，規則在 shared/rules.js 的「付費制」，綠界在 server/lib/pay.js）
// GET    /api/pay                          我的方案：價格、月費到哪天、買了哪幾集、訂單
// POST   /api/pay { item: "monthly" }       訂閱月費 → 回傳要送到綠界的表單 { action, fields }
// POST   /api/pay { item: "part", part }    買系統分享第 part 集
// DELETE /api/pay                          取消月費的自動續扣（已經付的照用到期滿）
import { supabaseAdmin, requireMember, readBody, route, todayTW, getPay, creds, ordersOf, summarizeOrders, checkoutForm, newTradeNo, stopRecurring, setOrder, notifyStaff, emailOf, subEnd, money, itemName } from "./lib/index.js";
import { COURSE_PARTS, PAY_GRACE_DAYS } from "../public/assets/js/shared/rules.js";

const view = (o) => ({ tradeNo: o.trade_no, kind: o.kind, part: o.part, amount: o.amount, status: o.status, paidUntil: o.paid_until, end: o.kind === "monthly" ? subEnd(o) : null, test: o.mode === "test", grant: o.mode === "grant", createdAt: o.created_at, item: itemName(o) });

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 });
    if (!ctx) return;
    const cfg = await getPay();
    const paid = ctx.tier?.paid || null;
    const orders = ctx.member ? await ordersOf(ctx.user.id, cfg) : [];
    const { current } = summarizeOrders(orders, todayTW());
    return res.status(200).json({
      paid: !!paid, // 這位研究員是不是付費制（照舊的人 false）
      open: !!creds(cfg.mode), test: cfg.mode === "test",
      monthly: cfg.monthly, part: cfg.part, parts: COURSE_PARTS, graceDays: PAY_GRACE_DAYS,
      sub: paid ? { on: paid.sub, until: paid.subUntil, status: current?.status || null, renewing: current?.status === "active" } : null,
      owned: paid ? paid.parts : [],
      orders: orders.filter((o) => o.status !== "pending" && o.status !== "failed").slice(0, 30).map(view),
    });
  },

  async POST(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 });
    if (!ctx) return;
    if (!ctx.member) return res.status(400).json({ error: "管理員帳號不用付費" });
    if (ctx.member.banned) return res.status(403).json({ error: "這個帳號目前不能付費，請聯絡管理員" });
    const paid = ctx.tier?.paid;
    if (!paid) return res.status(400).json({ error: "你的帳號照原本的方式（交易量）解鎖，不用付費" });
    const cfg = await getPay();
    if (!creds(cfg.mode)) return res.status(403).json({ error: "付款還沒開放，請稍後再試" });
    const b = readBody(req);
    const today = todayTW();
    const orders = await ordersOf(ctx.user.id, cfg);
    let order;
    if (b.item === "monthly") {
      const { current } = summarizeOrders(orders, today);
      if (current?.status === "active" || current?.status === "past_due") return res.status(409).json({ error: "你已經在訂閱中了，每個月會自動扣款" });
      order = { kind: "monthly", part: null, amount: cfg.monthly };
    } else if (b.item === "part") {
      const part = Number(b.part);
      if (!Number.isInteger(part) || part < 1 || part > COURSE_PARTS) return res.status(400).json({ error: "沒有這一集" });
      if (paid.parts.includes(part)) return res.status(409).json({ error: `第 ${part} 集你已經買過了` });
      order = { kind: "part", part, amount: cfg.part };
    } else return res.status(400).json({ error: "要買什麼？" });
    order.trade_no = newTradeNo();
    const { error } = await supabaseAdmin.from("pay_orders").insert({ ...order, user_id: ctx.user.id, mode: cfg.mode, status: "pending" });
    if (error) throw error;
    const form = await checkoutForm(cfg, order, { back: order.kind === "part" ? "#/course?paid=1" : "#/plans?paid=1" });
    return res.status(200).json({ ...form, tradeNo: order.trade_no, amount: order.amount, test: cfg.mode === "test" });
  },

  async DELETE(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 });
    if (!ctx) return;
    if (!ctx.member) return res.status(400).json({ error: "管理員帳號沒有訂閱" });
    const cfg = await getPay();
    const orders = await ordersOf(ctx.user.id, cfg);
    const sub = orders.find((o) => o.kind === "monthly" && (o.status === "active" || o.status === "past_due"));
    if (!sub) return res.status(404).json({ error: "沒有在自動扣款的月費" });
    const r = await stopRecurring(sub);
    if (!r.ok) return res.status(502).json({ error: `綠界沒有取消成功（${r.msg}），請到 Discord 開客服單，我們幫你處理` });
    await setOrder(sub.trade_no, { status: "canceled", last_msg: "研究員取消續扣" });
    await notifyStaff(`${sub.mode === "test" ? "【測試】" : ""}${await emailOf(ctx.user.id)} 取消了月費的自動扣款，可以用到 ${sub.paid_until}（${money(sub.amount)}／月）`);
    return res.status(200).json({ ok: true, until: sub.paid_until });
  },
});
