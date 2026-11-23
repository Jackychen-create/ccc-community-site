// GET /api/discord-rebrand：Discord 機器人改名、換頭貼的進度（公開，不含網址和 token）
import { route } from "./lib/index.js";
import { rebrandStatus } from "./lib/rebrand.js";

export default route({
  async GET(req, res) {
    return res.status(200).json(await rebrandStatus());
  },
});
