// 後台：會員制度（主要管理員）
// GET /api/admin/membership              { unitFrom, on }
// PUT /api/admin/membership { unitFrom } 單位制開始日期（YYYY-MM-DD；空白＝取消，維持三級制度）
import { requireAdmin, readBody, route, todayTW, getMembership, saveMembership } from "../lib/index.js";
import { isUnitOn } from "../../public/assets/js/shared/rules.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const m = await getMembership();
    return res.status(200).json({ unitFrom: m.unitFrom || null, on: isUnitOn(m.unitFrom, todayTW()), today: todayTW() });
  },
  async PUT(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const v = String(b.unitFrom || "");
    if (v && !/^\d{4}-\d\d-\d\d$/.test(v)) return res.status(400).json({ error: "日期格式不對" });
    const m = await getMembership();
    await saveMembership({ ...m, unitFrom: v || null, updatedAt: new Date().toISOString() });
    return res.status(200).json({ unitFrom: v || null, on: isUnitOn(v, todayTW()), today: todayTW() });
  },
});
