// 後台：網站狀況（研究員那邊自動回報的問題）
// GET    /api/admin/errors?days=7     依種類＋訊息分組：次數、幾個人遇到、最近一次
// DELETE /api/admin/errors?kind=video&message=...   這一組標成處理好了（刪掉）
import { supabaseAdmin, requireAdmin, route } from "../_lib.js";

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const days = Math.max(1, Math.min(90, Number(req.query?.days) || 7));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("client_errors")
      .select("kind, message, context, email, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw error;
    const groups = new Map();
    const searches = new Map();
    for (const e of data || []) {
      if (e.kind === "search_empty") {
        const q = String(e.context?.q || e.message).trim().toLowerCase();
        const g = searches.get(q) || { q: e.context?.q || e.message, count: 0, users: new Set(), last_at: e.created_at };
        g.count++;
        if (e.email) g.users.add(e.email);
        searches.set(q, g);
        continue;
      }
      const key = e.kind + "|" + e.message;
      const g = groups.get(key) || { kind: e.kind, message: e.message, count: 0, users: new Set(), last_at: e.created_at, samples: [] };
      g.count++;
      if (e.email) g.users.add(e.email);
      if (g.samples.length < 5) g.samples.push({ email: e.email, at: e.created_at, context: e.context });
      groups.set(key, g);
    }
    const pack = (g) => ({ ...g, users: [...g.users], user_count: g.users.size });
    return res.status(200).json({
      days,
      total: (data || []).length,
      groups: [...groups.values()].map(pack).sort((a, b) => b.count - a.count),
      searches: [...searches.values()].map(pack).sort((a, b) => b.count - a.count).slice(0, 50),
    });
  },

  async DELETE(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const kind = String(req.query?.kind || "");
    const message = String(req.query?.message || "");
    if (!kind) return res.status(400).json({ error: "資料不正確" });
    let q = supabaseAdmin.from("client_errors").delete().eq("kind", kind);
    if (kind === "search_empty") q = q.ilike("context->>q", message);
    else q = q.eq("message", message);
    const { error } = await q;
    if (error) throw error;
    return res.status(200).json({ ok: true });
  },
});
