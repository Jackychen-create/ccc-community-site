// 後台：實驗室密碼
// GET   /api/admin/invites
// POST  /api/admin/invites   { max_uses, note }  產生一組新實驗室密碼
// PATCH /api/admin/invites   { code, disabled }  停用／重新啟用
import { supabaseAdmin, requireAdmin, readBody, cleanText, randomCode, route } from "../_lib.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const { data, error } = await supabaseAdmin
      .from("invite_codes")
      .select("code, max_uses, used_count, note, disabled, created_at")
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

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const { data, error } = await supabaseAdmin
        .from("invite_codes")
        .insert({ code, max_uses: max, note })
        .select("code, max_uses, used_count, note, disabled, created_at")
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
    if (!code || typeof b.disabled !== "boolean") {
      return res.status(400).json({ error: "資料不正確" });
    }
    const { data, error } = await supabaseAdmin
      .from("invite_codes")
      .update({ disabled: b.disabled })
      .eq("code", code)
      .select("code")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "找不到這組實驗室密碼" });
    return res.status(200).json({ ok: true });
  },
});
