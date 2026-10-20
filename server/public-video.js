// 公開影片（不用登入）：例如培訓計畫介紹，後台編輯影片時類型選「公開影片」
// GET /api/public-video          公開影片清單（登入頁顯示「先看介紹」用）
// GET /api/public-video?id=12    單支公開影片的播放連結（分享連結 /watch?v=12 用）
// 只給「已發布＋公開」的影片；其他影片一律當作找不到，不透露是否存在
import { supabaseAdmin, signGet, toInt, route } from "./lib/index.js";

const FIELDS = "id, title, description, published_at, duration_sec, r2_key, thumb_key, chapters";
const thumbOf = (v) => (v.thumb_key ? signGet(v.thumb_key, { expiresIn: 12 * 60 * 60 }) : null);

export default route({
  async GET(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const base = () => supabaseAdmin.from("videos").select(FIELDS).eq("is_published", true).eq("is_public", true);
    if (req.query?.id === undefined) {
      const { data, error } = await base().order("published_at", { ascending: false }).order("id", { ascending: false }).limit(10);
      if (error) throw error;
      const videos = await Promise.all((data || []).map(async (v) => ({ id: v.id, title: v.title, duration_sec: v.duration_sec, thumb_url: await thumbOf(v) })));
      return res.status(200).json({ videos });
    }
    const id = toInt(req.query.id);
    if (id === null) return res.status(400).json({ error: "影片編號不正確" });
    const { data: v, error } = await base().eq("id", id).maybeSingle();
    if (error) throw error;
    if (!v) return res.status(404).json({ error: "找不到這支影片，可能已經下架了" });
    return res.status(200).json({
      id: v.id,
      title: v.title,
      description: v.description,
      published_at: v.published_at,
      duration_sec: v.duration_sec,
      chapters: v.chapters || [],
      thumb_url: await thumbOf(v),
      url: await signGet(v.r2_key, { expiresIn: 6 * 60 * 60 }),
    });
  },
});
