// 後台：直播精華（AI 摘要、重點、標的、建議章節）
// GET  /api/admin/highlights?video=12                     狀態、結果、逐字稿
// POST /api/admin/highlights { video, action: "redo" }    重新產生（下一輪 GitHub Actions 會做，大約 2 小時內）
// POST /api/admin/highlights { video, action: "apply" }   把 AI 建議的章節套用成影片的正式章節
// POST /api/admin/highlights { video, action: "post" }    貼到 Discord（第一次做好時會自動貼；這是手動再貼一次）
import { supabaseAdmin, requireAdmin, readBody, route, toInt, cleanChapters } from "../lib/index.js";
import { transcriptOf, postHighlight } from "../lib/highlights.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const id = toInt(req.query?.video);
    if (id === null) return res.status(400).json({ error: "影片編號不正確" });
    const { data: h, error } = await supabaseAdmin.from("video_highlights").select("*").eq("video_id", id).maybeSingle();
    if (error) throw error;
    if (!h) return res.status(200).json({ highlight: null });
    const { chunks, ...rest } = h;
    return res.status(200).json({ highlight: { ...rest, chunk_count: Object.keys(chunks || {}).length, transcript: transcriptOf(chunks).slice(0, 60000) } });
  },

  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const id = toInt(b.video);
    if (id === null) return res.status(400).json({ error: "影片編號不正確" });
    const { data: v } = await supabaseAdmin.from("videos").select("id, title, hosts, duration_sec, is_published, course_host").eq("id", id).maybeSingle();
    if (!v) return res.status(404).json({ error: "找不到這支影片" });

    if (b.action === "redo") {
      if (v.course_host) return res.status(400).json({ error: "教學課程不做直播精華" });
      const { error } = await supabaseAdmin.from("video_highlights").upsert({ video_id: id, status: "pending", attempts: 0, error: null, updated_at: new Date().toISOString() });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    const { data: h } = await supabaseAdmin.from("video_highlights").select("status, summary, points, tickers, chapters").eq("video_id", id).maybeSingle();
    if (!h || h.status !== "done") return res.status(400).json({ error: "精華還沒做好" });
    if (b.action === "apply") {
      const chapters = cleanChapters(h.chapters || []);
      if (!chapters.length) return res.status(400).json({ error: "AI 沒有建議章節" });
      const { error } = await supabaseAdmin.from("videos").update({ chapters }).eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true, chapters });
    }
    if (b.action === "post") {
      if (!v.is_published) return res.status(400).json({ error: "影片還沒發布" });
      let posted;
      try { posted = await postHighlight(v, h); } catch (e) { return res.status(502).json({ error: `貼到 Discord 失敗：${String(e?.message || e).slice(0, 200)}` }); }
      if (!posted) return res.status(400).json({ error: "還沒設定直播精華要貼到哪個頻道（後台 Discord 審核 → 直播精華頻道）" });
      await supabaseAdmin.from("video_highlights").update({ posted_at: new Date().toISOString() }).eq("video_id", id);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "不知道要做什麼" });
  },
});
