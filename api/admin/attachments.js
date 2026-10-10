// 後台：教材附件
// POST   /api/admin/attachments          { video_id, title, r2_key, size_bytes }
// DELETE /api/admin/attachments?id=3
import {
  supabaseAdmin,
  requireAdmin,
  deleteObject,
  readBody,
  toInt,
  cleanText,
  isIssuedKey,
  route,
} from "../_lib.js";

export default route({
  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const video_id = toInt(b.video_id);
    const title = cleanText(b.title, 120);
    const r2_key = String(b.r2_key || "");
    if (video_id === null) return res.status(400).json({ error: "影片編號不正確" });
    if (!title) return res.status(400).json({ error: "請填寫教材名稱" });
    if (!isIssuedKey(r2_key, "files")) return res.status(400).json({ error: "檔案路徑不正確" });

    const size = Math.round(Number(b.size_bytes));
    const { data, error } = await supabaseAdmin
      .from("attachments")
      .insert({ video_id, title, r2_key, size_bytes: size > 0 ? size : null })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23503") return res.status(404).json({ error: "找不到這支影片" });
      throw error;
    }
    return res.status(200).json({ id: data.id });
  },

  async DELETE(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const id = toInt(req.query?.id);
    if (id === null) return res.status(400).json({ error: "附件編號不正確" });

    const { data: a, error } = await supabaseAdmin
      .from("attachments")
      .select("id, r2_key")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!a) return res.status(404).json({ error: "找不到這個附件" });

    const { error: delError } = await supabaseAdmin.from("attachments").delete().eq("id", id);
    if (delError) throw delError;
    await deleteObject(a.r2_key);
    return res.status(200).json({ ok: true });
  },
});
