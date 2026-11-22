// 後台：交易檢討投稿（研究員在交易績效自己的貼文按 🔍）
// GET   /api/admin/reviews                         設定＋最近 8 週的投稿
// PATCH /api/admin/reviews { perfChannelId, reviewPublicChannelId }   交易績效頻道、公開通知頻道
// POST  /api/admin/reviews { action: "run" }        立即整理這一週（已整理過的只補新的）
// POST  /api/admin/reviews { action: "reviewed", week, id, reviewed }   勾「已點評」（第一次勾會私訊投稿的人）
// POST  /api/admin/reviews { action: "feature", week, id, on }   放上／拿下介紹頁的精選（只放文字和票數）
import { requireAdmin, readBody, route, discordConfigured, getDiscordSettings, saveDiscordSettings, isSnowflake, discordApi } from "../lib/index.js";
import { loadReviews, runWeeklyReviews, markReviewed, reviewEmojisOf, loadFeatured, setFeatured } from "../lib/reviews.js";

// 伺服器的自訂表情（後台選投稿表情用）
const guildEmojis = async (guildId) => {
  if (!guildId || !discordConfigured()) return [];
  const list = (await discordApi("GET", `/guilds/${guildId}/emojis`).catch(() => [])) || [];
  return list.filter((e) => e.id && e.available !== false).map((e) => ({ id: e.id, name: e.name, animated: !!e.animated }));
};

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const s = await getDiscordSettings();
    const st = await loadReviews();
    const weeks = Object.entries(st.weeks).sort((a, b) => b[0].localeCompare(a[0])).map(([week, w]) => ({ week, at: w.at, items: w.items || [] }));
    return res.status(200).json({ configured: discordConfigured(), guildId: s.guildId || "", reviewEmojis: reviewEmojisOf(s), guildEmojis: await guildEmojis(s.guildId), perfChannelId: s.perfChannelId || "", perfChannelName: s.perfChannelName || "", reviewPublicChannelId: s.reviewPublicChannelId || "", reviewPublicChannelName: s.reviewPublicChannelName || "", reviewChannelId: s.reviewChannelId || "", featured: (await loadFeatured()).map((x) => x.id), weeks });
  },

  async PATCH(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const next = { ...(await getDiscordSettings()) };
    for (const [k, label] of [["perfChannelId", "交易績效頻道"], ["reviewPublicChannelId", "公開通知頻道"]]) {
      if (b[k] === undefined) continue;
      const v = String(b[k] || "").trim();
      if (v && !isSnowflake(v)) return res.status(400).json({ error: `${label} ID 是 17–20 位數字（在 Discord 對頻道按右鍵「複製頻道 ID」）` });
      let name = "";
      if (v && discordConfigured()) {
        try {
          name = (await discordApi("GET", `/channels/${v}`))?.name || "";
          if (k === "perfChannelId") await discordApi("GET", `/channels/${v}/messages?limit=1`);
        } catch (e) {
          return res.status(400).json({ error: `${label}：${e?.status === 404 ? "找不到這個頻道" : k === "perfChannelId" ? "機器人看不到這個頻道或不能讀訊息歷史，請在頻道權限把機器人加進去（檢視頻道、讀取訊息歷史）" : "機器人看不到這個頻道，請在頻道權限把機器人加進去（檢視頻道、傳送訊息、嵌入連結）"}` });
        }
      }
      next[k] = v;
      next[k.replace("Id", "Name")] = name;
    }
    if (b.reviewEmojis !== undefined) {
      const list = Array.isArray(b.reviewEmojis) ? b.reviewEmojis : [];
      if (!list.length || list.length > 5) return res.status(400).json({ error: "投稿表情選 1 到 5 個" });
      const custom = list.some((e) => e?.id) ? await guildEmojis(next.guildId) : [];
      const clean = [];
      for (const e of list) {
        if (e?.id) {
          const g = custom.find((x) => x.id === String(e.id));
          if (!g) return res.status(400).json({ error: "找不到這個伺服器表情（要是這個 Discord 伺服器自己的表情）" });
          clean.push(g);
        } else {
          const n = String(e?.name || "").trim();
          if (!n || n.length > 16 || /[\s<>:]/.test(n)) return res.status(400).json({ error: "投稿表情不對" });
          clean.push({ name: n });
        }
      }
      next.reviewEmojis = clean;
    }
    await saveDiscordSettings(next);
    return res.status(200).json({ ok: true, reviewEmojis: reviewEmojisOf(next), perfChannelId: next.perfChannelId || "", perfChannelName: next.perfChannelName || "", reviewPublicChannelId: next.reviewPublicChannelId || "", reviewPublicChannelName: next.reviewPublicChannelName || "" });
  },

  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    if (b.action === "feature") {
      const r = await setFeatured(String(b.week || ""), String(b.id || ""), b.on !== false);
      return res.status(r.ok ? 200 : 400).json(r.ok ? r : { error: r.error });
    }
    if (!discordConfigured()) return res.status(503).json({ error: "還沒設定 Discord 機器人" });
    if (b.action === "run") {
      const r = await runWeeklyReviews(Date.now(), { force: true });
      return res.status(r.ok ? 200 : 400).json(r.ok ? r : { error: r.error });
    }
    if (b.action === "reviewed") {
      const r = await markReviewed(String(b.week || ""), String(b.id || ""), b.reviewed !== false);
      return res.status(r.ok ? 200 : 404).json(r.ok ? r : { error: r.error });
    }
    return res.status(400).json({ error: "不知道要做什麼" });
  },
});
