// 後台：直播預告（主要管理員、協作管理員都可以用）
// GET    /api/admin/lives                 最近 30 天到之後的直播、Discord 有沒有設定好
// POST   /api/admin/lives { title, startsAt, hosts, note, link, mention }   新增，發到 Discord 研究員專屬公告頻道
// 回應都附上最新的列表；announce = { posted, error? } 是這次有沒有發到 Discord
// PATCH  /api/admin/lives { id, title, startsAt, note, link }        修改；改了時間會在公告下面回覆通知
// DELETE /api/admin/lives?id=1                                      取消（公告劃掉並回覆通知，紀錄保留）
import {
  supabaseAdmin, requireAdmin, readBody, route, toInt, cleanText, discordConfigured, getDiscordSettings,
  announceLive, LIVE_TITLE_MAX, LIVE_NOTE_MAX, cleanHosts,
} from "../lib/index.js";

const FIELDS = "id, title, starts_at, note, link, hosts, mention, status, discord_channel_id, discord_message_id, reminded_at, created_by, created_at, updated_at";
const DAY = 86400e3;

// 檢查並整理表單；partial=true 時只檢查有給的欄位
function clean(b, { partial = false } = {}) {
  const out = {};
  if (!partial || b.title !== undefined) {
    out.title = cleanText(b.title, LIVE_TITLE_MAX);
    if (!out.title) return { error: "要填直播標題" };
  }
  if (!partial || b.startsAt !== undefined) {
    const t = Date.parse(b.startsAt);
    if (!Number.isFinite(t)) return { error: "直播時間格式不正確" };
    if (t < Date.now() - 10 * 60e3) return { error: "直播時間已經過了" };
    if (t > Date.now() + 366 * DAY) return { error: "只能排一年內的直播" };
    out.starts_at = new Date(t).toISOString();
  }
  if (!partial || b.hosts !== undefined) out.hosts = cleanHosts(b.hosts); // 主講人，可以複選
  if (!partial || b.note !== undefined) out.note = String(b.note || "").trim().slice(0, LIVE_NOTE_MAX) || null;
  if (!partial || b.link !== undefined) {
    const link = String(b.link || "").trim();
    if (link && !/^https:\/\/\S{4,300}$/.test(link)) return { error: "直播連結要是 https:// 開頭的網址" };
    out.link = link || null;
  }
  return { row: out };
}

async function list() {
  const [{ data, error }, s] = await Promise.all([
    supabaseAdmin.from("lives").select(FIELDS).gte("starts_at", new Date(Date.now() - 30 * DAY).toISOString()).order("starts_at", { ascending: true }),
    getDiscordSettings(),
  ]);
  if (error) throw error;
  return { lives: data || [], discord: { configured: discordConfigured(), channelId: s.labChannelId || null } };
}

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    return res.status(200).json(await list());
  },

  async POST(req, res) {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;
    const b = readBody(req);
    const { row, error: bad } = clean(b);
    if (bad) return res.status(400).json({ error: bad });
    const { data: live, error } = await supabaseAdmin.from("lives")
      .insert({ ...row, mention: b.mention !== false, status: "scheduled", created_by: ctx.user.email }).select(FIELDS).single();
    if (error) throw error;
    const announce = await announceLive(live, "new");
    return res.status(200).json({ ...(await list()), id: live.id, announce });
  },

  async PATCH(req, res) {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;
    const b = readBody(req);
    const id = toInt(b.id);
    if (id === null) return res.status(400).json({ error: "資料不正確" });
    const { data: old } = await supabaseAdmin.from("lives").select(FIELDS).eq("id", id).maybeSingle();
    if (!old) return res.status(404).json({ error: "找不到這場直播" });
    if (old.status !== "scheduled") return res.status(400).json({ error: "這場直播已經取消了" });
    const { row, error: bad } = clean(b, { partial: true });
    if (bad) return res.status(400).json({ error: bad });
    const moved = row.starts_at && Date.parse(row.starts_at) !== Date.parse(old.starts_at);
    const patch = { ...row, updated_at: new Date().toISOString(), ...(moved ? { reminded_at: null } : {}) };
    const { data: live, error } = await supabaseAdmin.from("lives").update(patch).eq("id", id).select(FIELDS).single();
    if (error) throw error;
    const announce = await announceLive(live, moved ? "moved" : "edit");
    return res.status(200).json({ ...(await list()), announce });
  },

  async DELETE(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const id = toInt(req.query?.id);
    if (id === null) return res.status(400).json({ error: "資料不正確" });
    const { data: live, error } = await supabaseAdmin.from("lives")
      .update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "scheduled").select(FIELDS).maybeSingle();
    if (error) throw error;
    if (!live) return res.status(404).json({ error: "找不到這場直播，或已經取消了" });
    const announce = await announceLive(live, "cancelled");
    return res.status(200).json({ ...(await list()), announce });
  },
});
