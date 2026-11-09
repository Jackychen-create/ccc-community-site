// 研究員的一對一交流（第三級）
// GET    /api/oneonone              這個月每位主講各選了幾位、我選了誰、排第幾、確定還是候補
// POST   /api/oneonone { host }     選（或改選）這個月的主講；要第三級
// DELETE /api/oneonone              取消這個月的選擇（管理員已經約好的不能自己取消）
import { supabaseAdmin, requireMember, readBody, route, thisMonthTW, oneOnOneBoard, notifyOneOnOne } from "./lib/index.js";
import { ONE_ON_ONE_HOSTS, ONE_ON_ONE_CAP, MAX_TIER } from "../public/assets/js/shared/rules.js";

async function view(ctx) {
  const board = await oneOnOneBoard();
  let mine = null;
  for (const h of board.hosts) {
    const me = h.list.find((e) => e.user_id === ctx.user.id);
    if (me) mine = { host: h.host, rank: me.rank, confirmed: me.confirmed, booked: !!me.booked, waiting: me.confirmed ? 0 : me.rank - ONE_ON_ONE_CAP };
  }
  return {
    month: board.month,
    cap: ONE_ON_ONE_CAP,
    eligible: (ctx.tier?.tier ?? 0) >= MAX_TIER,
    hosts: board.hosts.map((h) => ({ host: h.host, total: h.list.length, confirmed: h.list.filter((e) => e.confirmed).length })),
    mine,
  };
}

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 });
    if (!ctx) return;
    if (!ctx.member) return res.status(200).json({ month: thisMonthTW(), cap: ONE_ON_ONE_CAP, eligible: false, hosts: [], mine: null });
    return res.status(200).json(await view(ctx));
  },

  async POST(req, res) {
    const ctx = await requireMember(req, res, { minTier: MAX_TIER });
    if (!ctx) return;
    if (!ctx.member) return res.status(400).json({ error: "管理員帳號不用選" });
    const host = String(readBody(req).host || "");
    if (!ONE_ON_ONE_HOSTS.includes(host)) return res.status(400).json({ error: "請選一位主講" });
    const month = thisMonthTW();
    const { data: old } = await supabaseAdmin.from("one_on_ones").select("host, booked").eq("user_id", ctx.user.id).eq("month", month).maybeSingle();
    if (old?.booked && old.host !== host) return res.status(400).json({ error: `這個月已經跟 ${old.host} 約好了，要改請聯絡管理員` });
    const { error } = await supabaseAdmin.from("one_on_ones").upsert({ user_id: ctx.user.id, month, host, booked: old?.booked || false, created_at: old && old.host === host ? undefined : new Date().toISOString() }, { onConflict: "user_id,month" });
    if (error) throw error;
    const out = await view(ctx);
    // 選了新的主講才通知（重按同一位不通知）
    if (!old || old.host !== host) await notifyOneOnOne({ kind: old ? "change" : "pick", email: ctx.user.email, host, prevHost: old?.host, rank: out.mine?.rank, confirmed: out.mine?.confirmed, month });
    return res.status(200).json(out);
  },

  async DELETE(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 });
    if (!ctx) return;
    if (!ctx.member) return res.status(400).json({ error: "管理員帳號不用選" });
    const month = thisMonthTW();
    const { data: old } = await supabaseAdmin.from("one_on_ones").select("host, booked").eq("user_id", ctx.user.id).eq("month", month).maybeSingle();
    if (old?.booked) return res.status(400).json({ error: "已經約好時間了，要取消請聯絡管理員" });
    const { error } = await supabaseAdmin.from("one_on_ones").delete().eq("user_id", ctx.user.id).eq("month", month);
    if (error) throw error;
    if (old) await notifyOneOnOne({ kind: "cancel", email: ctx.user.email, prevHost: old.host, month });
    return res.status(200).json(await view(ctx));
  },
});
