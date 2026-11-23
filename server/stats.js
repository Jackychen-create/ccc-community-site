// GET /api/stats  登入頁小看板用：最新一場的日期、已發布的直播紀錄場數（不含系統分享）。
// 不需登入，只回這兩個數字，不含任何標題或內容。
import { supabaseAdmin, route } from "./lib/index.js";

export default route({
  async GET(req, res) {
    const { data, count, error } = await supabaseAdmin
      .from("videos")
      .select("published_at", { count: "exact" })
      .eq("is_published", true)
      .is("course_host", null) // 只算直播紀錄，不算系統分享
      .order("published_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({ latest: data?.[0]?.published_at || null, count: count || 0 });
  },
});
