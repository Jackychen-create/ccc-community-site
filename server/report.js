// POST /api/report { kind, message, context }
// 研究員那邊自動回報的問題：影片播不動、讀取失敗、程式錯誤、搜尋找不到東西
// 沒登入就略過；每人每天最多 40 筆
import { supabaseAdmin, getUser, readBody, cleanText, route } from "./_lib.js";

const KINDS = ["video", "api", "js", "search_empty", "upload"];

export default route({
  async POST(req, res) {
    const user = await getUser(req);
    if (!user) return res.status(204).end();
    const b = readBody(req);
    if (!KINDS.includes(b.kind)) return res.status(400).json({ error: "資料不正確" });
    const message = cleanText(b.message, 300);
    if (!message) return res.status(400).json({ error: "資料不正確" });
    let context = {};
    if (b.context && typeof b.context === "object") {
      for (const [k, v] of Object.entries(b.context).slice(0, 12)) {
        if (["string", "number", "boolean"].includes(typeof v)) context[String(k).slice(0, 30)] = typeof v === "string" ? v.slice(0, 200) : v;
      }
    }
    const since = new Date(Date.now() - 86400000).toISOString();
    const { count } = await supabaseAdmin.from("client_errors").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
    if ((count || 0) >= 40) return res.status(204).end();
    await supabaseAdmin.from("client_errors").insert({ user_id: user.id, email: user.email, kind: b.kind, message, context });
    return res.status(204).end();
  },
});
