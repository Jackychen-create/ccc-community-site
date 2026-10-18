// 後台：研究員
// GET   /api/admin/members
// PATCH /api/admin/members  { userId, action: "ban" | "unban" | "reset" }
//                            { userId, action: "access", accessUntil: "2026-10-31" | null, note }
import { supabaseAdmin, requireAdmin, readBody, randomPassword, cleanText, isDate, route } from "../lib/index.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOREVER = "876000h"; // 約 100 年

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;

    const { data: members, error } = await supabaseAdmin
      .from("members")
      .select("user_id, email, invite_code, banned, created_at, access_until, note, notify, free")
      .order("created_at", { ascending: false });
    if (error) throw error;

    // 最近登入時間在 Supabase Auth 裡，分頁抓回來對照
    const lastSeen = new Map();
    const authEmail = new Map();
    for (let page = 1; page <= 20; page++) {
      const { data, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (listError) break;
      for (const u of data.users) {
        lastSeen.set(u.id, u.last_sign_in_at || null);
        if (u.email) authEmail.set(u.id, u.email);
      }
      if (data.users.length < 1000) break;
    }

    // 每個人看過幾支影片；填過的交易所 UID；用同一個 UID 在 Discord 通過申請的人（對得到 Discord 名稱）
    const [{ data: prog }, { data: links }, { data: apps }] = await Promise.all([
      supabaseAdmin.from("watch_progress").select("user_id"),
      supabaseAdmin.from("exchange_links").select("user_id, exchange, exchange_uid, account_name"),
      supabaseAdmin.from("discord_applications").select("exchange, exchange_uid, discord_name, discord_user_id").eq("status", "approved"),
    ]);
    const uids = new Map();
    const accountNames = new Map(); // UM 開戶的英文姓名
    for (const l of links || []) {
      uids.set(l.user_id, { ...(uids.get(l.user_id) || {}), [l.exchange]: l.exchange_uid });
      if (l.account_name) accountNames.set(l.user_id, { ...(accountNames.get(l.user_id) || {}), [l.exchange]: l.account_name });
    }
    const dcBy = new Map((apps || []).map((a) => [`${a.exchange}:${a.exchange_uid}`, a.discord_name || a.discord_user_id]));
    const watched = new Map();
    for (const p of prog || []) watched.set(p.user_id, (watched.get(p.user_id) || 0) + 1);

    return res.status(200).json({
      members: (members || []).map((m) => ({
        ...m,
        email: authEmail.get(m.user_id) || m.email,
        last_sign_in_at: lastSeen.get(m.user_id) || null,
        watched_count: watched.get(m.user_id) || 0,
        uids: uids.get(m.user_id) || {},
        account_names: accountNames.get(m.user_id) || {},
        discord: Object.entries(uids.get(m.user_id) || {}).map(([ex, uid]) => dcBy.get(`${ex}:${uid}`)).find(Boolean) || null,
      })),
    });
  },

  async PATCH(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const userId = String(b.userId || "");
    if (!UUID_RE.test(userId)) return res.status(400).json({ error: "研究員編號不正確" });

    // 只能操作 members 表裡的研究員，管理員帳號不受影響
    const { data: m, error } = await supabaseAdmin
      .from("members")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!m) return res.status(404).json({ error: "找不到這位研究員" });

    if (b.action === "ban" || b.action === "unban") {
      const banned = b.action === "ban";
      const { error: upError } = await supabaseAdmin
        .from("members")
        .update({ banned })
        .eq("user_id", userId);
      if (upError) throw upError;
      // 同時在 Supabase 停用登入，已登入的人下一次換 token 時就會被登出
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        ban_duration: banned ? FOREVER : "none",
      });
      if (authError) throw authError;
      return res.status(200).json({ ok: true });
    }

    if (b.action === "access") {
      const patch = {};
      if (b.accessUntil !== undefined) {
        if (b.accessUntil !== null && !isDate(b.accessUntil)) return res.status(400).json({ error: "日期格式不正確" });
        patch.access_until = b.accessUntil;
      }
      if (b.note !== undefined) patch.note = cleanText(b.note, 200) || null;
      if (!Object.keys(patch).length) return res.status(400).json({ error: "沒有要修改的內容" });
      const { error: upError } = await supabaseAdmin.from("members").update(patch).eq("user_id", userId);
      if (upError) throw upError;
      return res.status(200).json({ ok: true });
    }

    if (b.action === "reset") {
      const password = randomPassword();
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
      });
      if (authError) throw authError;
      return res.status(200).json({ password });
    }

    return res.status(400).json({ error: "不支援的動作" });
  },
});
