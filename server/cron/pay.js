// POST /api/cron/pay   期滿的月費：改成結束、拿掉 Discord 研究員身分組（Supabase pg_cron 每小時打一次，帶 X-Cron-Secret）
import { route, cronAuthorized, sweep } from "../lib/index.js";

export default route({
  async POST(req, res) {
    if (!cronAuthorized(req)) return res.status(401).json({ error: "unauthorized" });
    return res.status(200).json(await sweep());
  },
});
