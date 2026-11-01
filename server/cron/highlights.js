// 直播精華的工作流程（GitHub Actions 呼叫，見 server/lib/highlights.js 開頭的說明）
// 驗證：GitHub Actions 的 OIDC 身分證明（Authorization: Bearer …），或 X-Cron-Secret（手動測試用）
// GET  /api/cron/highlights                       下一支要做的直播 { job: { videoId, title, url, … } | null }
// PUT  /api/cron/highlights?video=12&chunk=0      內容是一段聲音（mp3，10 分鐘）→ 轉成文字存起來
// POST /api/cron/highlights { video, done: true } 全部聲音都送完 → AI 整理、存起來、貼到 Discord
// POST /api/cron/highlights { video, error }      GitHub 那邊出錯（例如影片抓不到）
import { route, cronAuthorized, supabaseAdmin, signGet, toInt, readBody } from "../lib/index.js";
import { verifyGithubOidc } from "../lib/oidc.js";
import { pointTimesOf } from "../lib/search.js";
import { CHUNK_SEC, MAX_CHUNKS, nextJob, transcribeChunk, transcriptOf, summarize, postHighlight, isQuota } from "../lib/highlights.js";

export const MAX_AUDIO = 8 * 1024 * 1024;

async function authorized(req) {
  if (cronAuthorized(req)) return true;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || "");
  return !!(m && (await verifyGithubOidc(m[1])));
}
const rowOf = async (id) => (await supabaseAdmin.from("video_highlights").select("*").eq("video_id", id).maybeSingle()).data;
const fail = (id, msg, status = "failed") => supabaseAdmin.from("video_highlights").update({ status, error: String(msg || "").slice(0, 480), updated_at: new Date().toISOString() }).eq("video_id", id);

export default route({
  async GET(req, res) {
    if (!(await authorized(req))) return res.status(401).json({ error: "unauthorized" });
    const v = await nextJob();
    if (!v) return res.status(200).json({ job: null });
    return res.status(200).json({
      job: { videoId: v.id, title: v.title, hosts: v.hosts || [], duration: v.duration_sec, url: await signGet(v.r2_key, { expiresIn: 6 * 3600 }), chunkSec: CHUNK_SEC, maxChunks: MAX_CHUNKS },
    });
  },

  async PUT(req, res) {
    if (!(await authorized(req))) return res.status(401).json({ error: "unauthorized" });
    const id = toInt(req.query?.video), chunk = toInt(req.query?.chunk);
    if (id === null || chunk === null || chunk < 0 || chunk >= MAX_CHUNKS) return res.status(400).json({ error: "bad request" });
    const bytes = req.rawBytes;
    if (!bytes?.byteLength) return res.status(400).json({ error: "沒有聲音" });
    if (bytes.byteLength > MAX_AUDIO) return res.status(413).json({ error: "這一段太大" });
    const row = await rowOf(id);
    if (!row || row.status !== "processing") return res.status(409).json({ error: "這支不在處理中" });
    let segs;
    try {
      segs = await transcribeChunk(new Uint8Array(bytes), chunk * CHUNK_SEC);
    } catch (e) {
      // 額度用完：回 429，GitHub 那邊就停下來，這支排回去下一輪再做（不算失敗次數）
      if (isQuota(e)) return res.status(429).json({ error: `Workers AI 額度用完或被限流：${String(e?.message || e).slice(0, 160)}`, code: "quota" });
      return res.status(502).json({ error: `轉文字失敗：${String(e?.message || e).slice(0, 200)}` });
    }
    // 重新讀一次再寫（一段一段依序送，不會同時寫）
    const cur = (await rowOf(id))?.chunks || {};
    const { error } = await supabaseAdmin.from("video_highlights").update({ chunks: { ...cur, [chunk]: segs }, updated_at: new Date().toISOString() }).eq("video_id", id);
    if (error) throw error;
    return res.status(200).json({ ok: true, segments: segs.length });
  },

  async POST(req, res) {
    if (!(await authorized(req))) return res.status(401).json({ error: "unauthorized" });
    const b = readBody(req);
    const id = toInt(b.video);
    if (id === null) return res.status(400).json({ error: "bad request" });
    const row = await rowOf(id);
    if (!row || row.status !== "processing") return res.status(409).json({ error: "這支不在處理中" });
    if (b.error) {
      if (b.quota) {
        await supabaseAdmin.from("video_highlights").update({ status: "pending", attempts: Math.max(0, (row.attempts || 1) - 1), error: String(b.error).slice(0, 480), updated_at: new Date().toISOString() }).eq("video_id", id);
      } else await fail(id, b.error);
      return res.status(200).json({ ok: true });
    }
    if (!b.done) return res.status(400).json({ error: "bad request" });

    const { data: v } = await supabaseAdmin.from("videos").select("id, title, hosts, duration_sec, is_published, published_at").eq("id", id).maybeSingle();
    if (!v) { await fail(id, "影片已經刪掉了", "skipped"); return res.status(200).json({ ok: false }); }
    const transcript = transcriptOf(row.chunks);
    if (transcript.length < 200) { await fail(id, "聽不到講話的內容（可能沒有聲音）", "skipped"); return res.status(200).json({ ok: false, skipped: true }); }
    let h;
    try {
      h = await summarize(v, transcript);
    } catch (e) {
      await fail(id, `AI 整理失敗：${e?.message || e}`);
      return res.status(502).json({ error: "AI 整理失敗" });
    }
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("video_highlights").update({ status: "done", summary: h.summary, points: h.points, point_times: pointTimesOf(h.points, row.chunks, h.pointTimesAi || [], v.duration_sec || 0), tickers: h.tickers, chapters: h.chapters, model: h.model, error: null, updated_at: now }).eq("video_id", id);
    if (error) throw error;
    // 第一次做好才貼 Discord（重做不再貼一次）；草稿不貼；直播日期超過 7 天的舊直播不自動貼，免得洗版
    // 先搶到「還沒貼過」才貼（同一支同時送兩次「送完了」也只會貼一次）
    let posted = false;
    const recent = Date.now() - Date.parse(`${v.published_at || "1970-01-01"}T00:00:00+08:00`) < 8 * 86400e3;
    if (!row.posted_at && v.is_published && recent) {
      const { data: won } = await supabaseAdmin.from("video_highlights").update({ posted_at: now }).eq("video_id", id).is("posted_at", null).select("video_id");
      if (won?.length) {
        try {
          posted = await postHighlight(v, h);
        } catch (e) {
          console.error("highlight post failed", e?.message);
        }
        if (!posted) await supabaseAdmin.from("video_highlights").update({ posted_at: null }).eq("video_id", id);
      }
    }
    return res.status(200).json({ ok: true, posted, points: h.points.length, chapters: h.chapters.length });
  },
});
