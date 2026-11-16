// GET /api/public-membership   對外網站用：現在是三級制度還是單位制（不用登入，只給日期）、付費制的價格
import { route, todayTW, getMembership, publicPay } from "./lib/index.js";
import { isUnitOn } from "../public/assets/js/shared/rules.js";

export default route({
  async GET(req, res) {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const m = await getMembership().catch(() => ({}));
    // pay：付費制（v1.28.0）開了沒、價格；登入頁看這個決定註冊要不要填實驗室密碼
    return res.status(200).json({ unitFrom: m.unitFrom || null, on: isUnitOn(m.unitFrom, todayTW()), pay: await publicPay() });
  },
});
