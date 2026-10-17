// 後台：實驗室密碼
// GET   /api/admin/invites
// POST  /api/admin/invites   { max_uses, note, free }  產生一組新實驗室密碼；free = 贈送名額（免綁交易所、觀看不限期）
// PATCH /api/admin/invites   { code, disabled }  停用／重新啟用；{ code, note } 改備註
// DELETE /api/admin/invites?code=XXXX-XXXX       刪除（用這組加入的研究員不受影響）
import { supabaseAdmin, requireAdmin, readBody, cleanText, randomCode, route } from "../lib/index.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const { data, error } = await supabaseAdmin
      .from("invite_codes")
      .select("code, max_uses, used_count, note, disabled, free, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return res.status(200).json({ invites: data || [] });
  },

  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const max = Math.round(Number(b.max_uses));
    if (!Number.isFinite(max) || max < 1 || max > 1000) {
      return res.status(400).json({ error: "可使用次數需要介於 1 到 1000" });
    }
    const note = cleanText(b.note, 100) || null;
    const free = b.free === true;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const { data, error } = await supabaseAdmin
        .from("invite_codes")
        .insert({ code, max_uses: max, note, free })
        .select("code, max_uses, used_count, note, disabled, free, created_at")
        .single();
      if (!error) return res.status(200).json({ invite: data });
      if (error.code !== "23505") throw error; // 23505 = 撞號，再產生一次
    }
    return res.status(500).json({ error: "產生實驗室密碼失敗，請再試一次" });
  },

  async PATCH(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const code = String(b.code || "").trim().toUpperCase();
    const patch = {};
    if (typeof b.disabled === "boolean") patch.disabled = b.disabled;
    if (b.note !== undefined) patch.note = cleanText(b.note, 100) || null;
    if (!code || !Object.keys(patch).length) {
      return res.status(400).json({ error: "資料不正確" });
    }
    const { data, error } = await supabaseAdmin
      .from("invite_codes")
      .update(patch)
      .eq("code", code)
      .select("code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "找不到這組實驗室密碼" });
    return res.status(200).json({ ok: true });
  },

  async DELETE(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const code = String(req.query?.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return res.status(400).json({ error: "資料不正確" });
    const { data, error } = await supabaseAdmin.from("invite_codes").delete().eq("code", code).select("code").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "找不到這組實驗室密碼" });
    return res.status(200).json({ ok: true });
  },
});
