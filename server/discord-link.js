// 研究員連結 Discord 帳號（server/lib/discord-link.js）
// GET    /api/discord-link            連了沒、連的是誰、去哪裡按按鈕
// POST   /api/discord-link { token }  用 Discord 給的一次性連結完成連結
// DELETE /api/discord-link            解除
import { requireMember, readBody, route, getDiscordSettings, roleWanted, syncRole } from "./lib/index.js";
import { linkedOf, redeemLinkToken, unlink } from "./lib/discord-link.js";

const where = (s) => (s.guildId && s.linkChannelId ? `https://discord.com/channels/${s.guildId}/${s.linkChannelId}${s.linkMessageId ? `/${s.linkMessageId}` : ""}` : null);

export default route({
  async GET(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 });
    if (!ctx) return;
    const [l, s] = await Promise.all([linkedOf(ctx.user.id), getDiscordSettings()]);
    return res.status(200).json({ linked: !!l, name: l?.discord_name || "", linkedAt: l?.linked_at || null, where: where(s), channelName: s.linkChannelName || "" });
  },
  async POST(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 });
    if (!ctx) return;
    if (ctx.isAdmin && !ctx.member) return res.status(400).json({ error: "管理員帳號不用連結" });
    const r = await redeemLinkToken(ctx.user.id, readBody(req).token);
    // 連好 Discord 就給研究員身分組：付費制看有沒有月費；照舊的研究員（含 v1.34.0 在網站用 UID 直接加入的）一律給
    if (r.ok) {
      const want = await roleWanted(ctx.user.id).catch(() => null);
      if (want || (want === null && ctx.member && !ctx.member.banned)) r.role = await syncRole(ctx.user.id, true);
    }
    return res.status(r.ok ? 200 : r.status).json(r.ok ? r : { error: r.error });
  },
  async DELETE(req, res) {
    const ctx = await requireMember(req, res, { minTier: 0 });
    if (!ctx) return;
    if (ctx.member) await unlink(ctx.user.id);
    return res.status(200).json({ ok: true });
  },
});
