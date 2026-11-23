// 交易分享（v1.37.0，取代系統分享）：videos.trade_share = true 的影片，加入就能看，沒有解鎖排程
// schema 還沒套用 v1.37.0（沒有 trade_share 欄位）時一律當作沒有，網站照常
import { supabaseAdmin } from "./env.js";

// 交易分享的影片 id（直播紀錄列表、搜尋要排除）
export async function tradeShareIds() {
  const { data, error } = await supabaseAdmin.from("videos").select("id").eq("trade_share", true);
  if (error) return new Set();
  return new Set((data || []).map((v) => v.id));
}

// 研究員看得到的交易分享（上架的，新的在前）
export async function tradeShareVideos() {
  const { data, error } = await supabaseAdmin
    .from("videos")
    .select("id, title, description, published_at, duration_sec, thumb_key, hosts, chapters")
    .eq("is_published", true)
    .eq("trade_share", true)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) {
    if (!/trade_share/.test(error.message || "")) throw error;
    return [];
  }
  return data || [];
}
