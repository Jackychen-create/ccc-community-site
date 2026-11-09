// 後台：影片管理
// GET    /api/admin/videos            全部影片（含草稿、附件）
// POST   /api/admin/videos            上傳完成後建立影片
// PATCH  /api/admin/videos            修改標題、簡介、日期、發布狀態、封面
// DELETE /api/admin/videos?id=12      刪除影片（連同 R2 上的影片、封面、附件）
import {
  supabaseAdmin,
  requireAdmin,
  signGet,
  deleteObject,
  readBody,
  toInt,
  cleanText,
  isDate,
  isIssuedKey,
  cleanTitle,
  cleanChapters,
  COURSE_HOSTS, cleanHosts,
  COURSE_PARTS,
  route,
} from "../lib/index.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const { data, error } = await supabaseAdmin
      .from("videos")
      .select(
        "id, title, description, published_at, is_published, is_public, duration_sec, size_bytes, thumb_key, hosts, chapters, notified_at, course_host, course_part, created_at, attachments(id, title, size_bytes, created_at)"
      )
      .order("published_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw error;

    const videos = await Promise.all(
      (data || []).map(async ({ thumb_key, ...v }) => ({
        ...v,
        attachments: (v.attachments || []).sort((a, b) => a.id - b.id),
        thumb_url: thumb_key ? await signGet(thumb_key, { expiresIn: 12 * 60 * 60 }) : null,
      }))
    );
    return res.status(200).json({ videos });
  },

  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);

    const title = cleanTitle(b.title);
    const r2_key = String(b.r2_key || "");
    if (!title) return res.status(400).json({ error: "請填寫標題" });
    if (!isIssuedKey(r2_key, "videos")) {
      return res.status(400).json({ error: "影片檔案路徑不正確" });
    }
    const thumb_key = b.thumb_key ? String(b.thumb_key) : null;
    if (thumb_key && !isIssuedKey(thumb_key, "thumbs")) {
      return res.status(400).json({ error: "封面路徑不正確" });
    }

    const row = {
      title,
      description: cleanText(b.description, 2000) || null,
      published_at: isDate(b.published_at) ? b.published_at : new Date().toISOString().slice(0, 10),
      is_published: b.is_published === true,
      r2_key,
      thumb_key,
      duration_sec: posInt(b.duration_sec),
      size_bytes: posInt(b.size_bytes),
      hosts: cleanHosts(b.hosts),
      chapters: cleanChapters(b.chapters),
    };
    const { data, error } = await supabaseAdmin.from("videos").insert(row).select("id").single();
    if (error) throw error;
    return res.status(200).json({ id: data.id });
  },

  async PATCH(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const id = toInt(b.id);
    if (id === null) return res.status(400).json({ error: "影片編號不正確" });

    const patch = {};
    if (b.title !== undefined) {
      const t = cleanTitle(b.title);
      if (!t) return res.status(400).json({ error: "標題不能空白" });
      patch.title = t;
    }
    if (b.description !== undefined) patch.description = cleanText(b.description, 2000) || null;
    if (b.published_at !== undefined) {
      if (!isDate(b.published_at)) return res.status(400).json({ error: "日期格式不正確" });
      patch.published_at = b.published_at;
    }
    if (b.is_published !== undefined) patch.is_published = b.is_published === true;
    if (b.hosts !== undefined) patch.hosts = cleanHosts(b.hosts);
    if (b.chapters !== undefined) patch.chapters = cleanChapters(b.chapters);
    // 公開影片：不用登入就能看（分享連結 /watch?v=id）；公開的不能同時是系統分享
    if (b.is_public !== undefined) patch.is_public = b.is_public === true;
    // 系統分享：course_host + course_part（1–6）一起給；都給 null 就變回直播留檔
    if (b.course_host !== undefined || b.course_part !== undefined) {
      if (b.course_host === null || b.course_host === "") {
        patch.course_host = null;
        patch.course_part = null;
      } else {
        const part = toInt(b.course_part);
        if (!COURSE_HOSTS.includes(b.course_host) || part === null || part < 1 || part > COURSE_PARTS) {
          return res.status(400).json({ error: "系統分享要選主講和第幾份（1–6）" });
        }
        patch.course_host = b.course_host;
        patch.course_part = part;
      }
    }
    if (patch.is_public && (patch.course_host || (patch.course_host === undefined && b.course_part))) return res.status(400).json({ error: "公開影片不能同時是系統分享" });
    // 換封面：新的封面要是 upload-url 發的路徑，舊封面存好後再刪
    let oldThumb = null;
    if (b.thumb_key !== undefined) {
      const tk = String(b.thumb_key || "");
      if (!isIssuedKey(tk, "thumbs")) return res.status(400).json({ error: "封面路徑不正確" });
      const { data: cur } = await supabaseAdmin.from("videos").select("thumb_key").eq("id", id).maybeSingle();
      oldThumb = cur?.thumb_key && cur.thumb_key !== tk ? cur.thumb_key : null;
      patch.thumb_key = tk;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "沒有要修改的內容" });

    const { data, error } = await supabaseAdmin
      .from("videos")
      .update(patch)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error?.code === "23505") return res.status(409).json({ error: `${patch.course_host} 第 ${patch.course_part} 份已經有影片了，請先把那支改掉或刪除` });
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "找不到這支影片" });
    if (oldThumb) await deleteObject(oldThumb);
    const out = { ok: true };
    if (patch.title) out.title = patch.title;
    if (patch.thumb_key) out.thumb_url = await signGet(patch.thumb_key, { expiresIn: 12 * 60 * 60 });
    return res.status(200).json(out);
  },

  async DELETE(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const id = toInt(req.query?.id);
    if (id === null) return res.status(400).json({ error: "影片編號不正確" });

    const { data: v, error } = await supabaseAdmin
      .from("videos")
      .select("id, r2_key, thumb_key, attachments(r2_key)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!v) return res.status(404).json({ error: "找不到這支影片" });

    const { error: delError } = await supabaseAdmin.from("videos").delete().eq("id", id);
    if (delError) throw delError;

    // 資料刪掉後再清檔案；清檔失敗不影響結果（只會留下孤兒檔）
    await Promise.all([
      deleteObject(v.r2_key),
      deleteObject(v.thumb_key),
      ...(v.attachments || []).map((a) => deleteObject(a.r2_key)),
    ]);
    return res.status(200).json({ ok: true });
  },
});


function posInt(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}
