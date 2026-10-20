// 排程：每天 00:05（台灣時間）統計前一天的聊天、把聊天紀錄存成文字檔貼到回報頻道（server/lib/chatlog.js）
// 由 Supabase 的 pg_cron 呼叫，見 supabase/schema.sql v1.22
// POST /api/cron/chatlog   Header：X-Cron-Secret = Cloudflare 環境變數 CRON_SECRET
import { route, cronAuthorized, runChatlog, todayTW, discordConfigured } from "../lib/index.js";
import { addDays } from "../../public/assets/js/shared/rules.js";

export default route({
  async POST(req, res) {
    if (!cronAuthorized(req)) return res.status(401).json({ error: "unauthorized" });
    if (!discordConfigured()) return res.status(200).json({ ok: false, skipped: "discord not configured" });
    const r = await runChatlog(addDays(todayTW(), -1));
    return res.status(200).json(r);
  },
});
