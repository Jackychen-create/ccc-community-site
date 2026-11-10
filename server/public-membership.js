// GET /api/public-membership   對外網站用：現在是三級制度還是單位制（不用登入，只給日期）
import { route, todayTW, getMembership } from "./lib/index.js";
import { isUnitOn } from "../public/assets/js/shared/rules.js";

export default route({
  async GET(req, res) {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const m = await getMembership().catch(() => ({}));
    return res.status(200).json({ unitFrom: m.unitFrom || null, on: isUnitOn(m.unitFrom, todayTW()) });
  },
});
