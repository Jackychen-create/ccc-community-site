// GET /api/stats  登入頁小看板用：最新一場的日期、已發布的直播紀錄場數（不含交易分享、公開影片）。
// 不需登入，只回這兩個數字，不含任何標題或內容。
import { supabaseAdmin, route } from "./lib/index.js";
import { tradeShareIds } from "./lib/trade-share.js";

export default route({
  async GET(req, res) {
    const { data, error } = await supabaseAdmin
      .from("videos")
      .select("id, published_at")
      .eq("is_published", true)
      .eq("is_public", false)
      .is("course_host", null)
      .order("published_at", { ascending: false });
    if (error) throw error;
    const shares = await tradeShareIds(); // v1.37.22：交易分享不算直播紀錄場數（跟直播紀錄列表一致）
    const lives = (data || []).filter((v) => !shares.has(v.id));
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({ latest: lives[0]?.published_at || null, count: lives.length });
  },
});
