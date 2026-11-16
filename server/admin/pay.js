// 後台「付費」（主要管理員）
// GET   /api/admin/pay                                     設定、正式金鑰填了沒、統計、最近的訂單
// PUT   /api/admin/pay { mode, monthly, part, paidFrom, legacyUntil }   改設定（mode：off 關、test 測試、live 正式）
// POST  /api/admin/pay { email, kind: "monthly", months }  手動送月費幾個月（不扣款）
// POST  /api/admin/pay { email, kind: "part", part }       手動開某一集
// PATCH /api/admin/pay { tradeNo, action: "cancel" }       幫研究員停掉月費的自動扣款（用到期滿）
// PATCH /api/admin/pay { tradeNo, action: "revoke" }       收回手動給的、或已經退款的訂單
import {
  supabaseAdmin, requireAdmin, readBody, route, todayTW, getPay, savePay, liveReady, countedModes, newTradeNo, stopRecurring, setOrder, getOrder, syncRole, roleWanted, sweep, subEnd, itemName, PAY_DEFAULTS,
} from "../lib/index.js";
import { addMonths, isPaidOn, COURSE_PARTS } from "../../public/assets/js/shared/rules.js";

const isYmd = (v) => /^\d{4}-\d\d-\d\d$/.test(String(v || ""));

async function overview() {
  const cfg = await getPay();
  const today = todayTW();
  const [{ data: orders, error }, { data: members }] = await Promise.all([
    supabaseAdmin.from("pay_orders").select("trade_no, user_id, kind, part, amount, mode, status, paid_until, times, last_msg, note, created_at, updated_at").order("created_at", { ascending: false }).limit(300),
    supabaseAdmin.from("members").select("user_id, email, created_at"),
  ]);
  if (error) throw error;
  const emailBy = new Map((members || []).map((m) => [m.user_id, m.email]));
  const modes = countedModes(cfg);
  const counted = (orders || []).filter((o) => modes.includes(o.mode));
  const subs = new Set(counted.filter((o) => o.kind === "monthly" && ["active", "past_due", "canceled"].includes(o.status) && subEnd(o) >= today).map((o) => o.user_id));
  const month = today.slice(0, 7);
  // 這個月收到的錢（只算真的刷卡的：正式模式算正式，測試模式算測試）：單集看付款那天、月費看最後一次扣款
  const real = counted.filter((o) => o.mode !== "grant" && ["paid", "active", "past_due", "canceled", "ended"].includes(o.status));
  const paidFromCount = isYmd(cfg.paidFrom) ? (members || []).filter((m) => new Date(Date.parse(m.created_at) + 8 * 3600e3).toISOString().slice(0, 10) >= cfg.paidFrom).length : 0;
  return {
    cfg, today, liveReady: liveReady(), on: isPaidOn(cfg.paidFrom, today),
    stats: {
      subscribers: subs.size,
      renewing: new Set(counted.filter((o) => o.kind === "monthly" && o.status === "active").map((o) => o.user_id)).size,
      partsSold: counted.filter((o) => o.kind === "part" && o.status === "paid" && o.mode !== "grant").length,
      monthIncome: real.filter((o) => String(o.updated_at || o.created_at).slice(0, 7) === month && (o.kind === "part" || o.times > 0)).reduce((s, o) => s + o.amount, 0),
      newPaidMembers: paidFromCount,
    },
    orders: (orders || []).filter((o) => o.status !== "pending").slice(0, 150).map((o) => ({
      tradeNo: o.trade_no, email: emailBy.get(o.user_id) || "（帳號已刪除）", kind: o.kind, part: o.part, item: itemName(o), amount: o.amount, mode: o.mode, status: o.status,
      paidUntil: o.paid_until, end: o.kind === "monthly" ? subEnd(o) : null, times: o.times, msg: o.last_msg, note: o.note, createdAt: o.created_at, counted: modes.includes(o.mode),
    })),
  };
}

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    // 打開後台順便整理一次期滿的月費（排程也會做）
    await sweep().catch((e) => console.error("pay sweep (admin)", e?.message));
    return res.status(200).json(await overview());
  },

  async PUT(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const cfg = await getPay();
    const next = { ...PAY_DEFAULTS, ...cfg };
    if (b.mode !== undefined) {
      if (!["off", "test", "live"].includes(b.mode)) return res.status(400).json({ error: "收款模式只有 關閉、測試、正式" });
      if (b.mode === "live" && !liveReady()) return res.status(400).json({ error: "還沒在 Cloudflare 填綠界的正式特店代號和金鑰（ECPAY_MERCHANT_ID、ECPAY_HASH_KEY、ECPAY_HASH_IV）" });
      next.mode = b.mode;
    }
    for (const k of ["monthly", "part"]) {
      if (b[k] === undefined) continue;
      const n = Number(b[k]);
      if (!Number.isInteger(n) || n < 10 || n > 100000) return res.status(400).json({ error: "價格要是 10 到 100,000 之間的整數" });
      next[k] = n;
    }
    for (const k of ["paidFrom", "legacyUntil"]) {
      if (b[k] === undefined) continue;
      const v = String(b[k] || "");
      if (v && !isYmd(v)) return res.status(400).json({ error: "日期格式不對" });
      next[k] = v || null;
    }
    if (next.legacyUntil && next.paidFrom && next.legacyUntil < next.paidFrom) return res.status(400).json({ error: "舊研究員照舊到哪天，要在付費制開始那天之後" });
    await savePay({ ...next, updatedAt: new Date().toISOString() });
    return res.status(200).json(await overview());
  },

  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const email = String(b.email || "").trim().toLowerCase();
    const { data: m } = await supabaseAdmin.from("members").select("user_id, email").eq("email", email).maybeSingle();
    if (!m) return res.status(404).json({ error: "找不到這個 Email 的研究員" });
    const today = todayTW();
    const note = String(b.note || "").trim().slice(0, 200) || null;
    let row;
    if (b.kind === "monthly") {
      const months = Number(b.months);
      if (!Number.isInteger(months) || months < 1 || months > 24) return res.status(400).json({ error: "月數要是 1 到 24" });
      // 接在他現在的月費後面
      const { data: cur } = await supabaseAdmin.from("pay_orders").select("status, paid_until").eq("user_id", m.user_id).eq("kind", "monthly").in("status", ["active", "past_due", "canceled"]);
      const last = (cur || []).map(subEnd).filter((d) => d && d >= today).sort().pop();
      row = { kind: "monthly", part: null, amount: 0, status: "canceled", paid_until: addMonths(last || today, months), times: 0, last_msg: `手動給 ${months} 個月` };
    } else if (b.kind === "part") {
      const part = Number(b.part);
      if (!Number.isInteger(part) || part < 1 || part > COURSE_PARTS) return res.status(400).json({ error: "沒有這一集" });
      row = { kind: "part", part, amount: 0, status: "paid", times: 1, last_msg: "手動開" };
    } else return res.status(400).json({ error: "要給月費還是某一集？" });
    const { error } = await supabaseAdmin.from("pay_orders").insert({ ...row, trade_no: newTradeNo(), user_id: m.user_id, mode: "grant", note });
    if (error) throw error;
    if (row.kind === "monthly" && (await roleWanted(m.user_id))) await syncRole(m.user_id, true);
    return res.status(200).json(await overview());
  },

  async PATCH(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const o = await getOrder(String(b.tradeNo || ""));
    if (!o) return res.status(404).json({ error: "找不到這筆訂單" });
    if (b.action === "cancel") {
      if (o.kind !== "monthly" || !["active", "past_due"].includes(o.status)) return res.status(400).json({ error: "這筆沒有在自動扣款" });
      const r = await stopRecurring(o);
      if (!r.ok) return res.status(502).json({ error: `綠界沒有取消成功（${r.msg}），請到綠界後台手動停掉 ${o.trade_no}` });
      await setOrder(o.trade_no, { status: "canceled", last_msg: "管理員停掉續扣" });
    } else if (b.action === "revoke") {
      if (o.kind === "monthly" && ["active", "past_due"].includes(o.status)) return res.status(400).json({ error: "還在自動扣款，先按「停扣」" });
      await setOrder(o.trade_no, { status: o.mode === "grant" ? "ended" : "refunded", last_msg: o.mode === "grant" ? "管理員收回" : "已退款，管理員收回" });
      if (o.kind === "monthly" && (await roleWanted(o.user_id)) === false) await syncRole(o.user_id, false);
    } else return res.status(400).json({ error: "要做什麼？" });
    return res.status(200).json(await overview());
  },
});
