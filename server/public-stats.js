// GET /api/public-stats   介紹頁用（不用登入）：Discord 人數、直播紀錄場數和時數、交易檢討精選
// 只給數字和管理員勾過的精選（沒有名字、沒有圖片）；Cloudflare 快取 10 分鐘
import { route, supabaseAdmin, getDiscordSettings, discordApi, discordConfigured } from "./lib/index.js";
import { loadFeatured } from "./lib/reviews.js";

const TTL = 600;
const KEY = "https://cache.ccc-lab.internal/public-stats";

export async function buildStats() {
  const s = await getDiscordSettings().catch(() => ({}));
  let discord = null;
  if (s.guildId && discordConfigured()) {
    const g = await discordApi("GET", `/guilds/${s.guildId}?with_counts=true`).catch(() => null);
    discord = Number(g?.approximate_member_count) || null;
  }
  const { data: lives } = await supabaseAdmin.from("videos").select("duration_sec").eq("is_published", true).is("course_host", null).or("is_public.is.null,is_public.eq.false");
  const liveCount = (lives || []).length;
  const liveHours = Math.floor((lives || []).reduce((a, v) => a + (Number(v.duration_sec) || 0), 0) / 3600);
  const featured = (await loadFeatured().catch(() => [])).slice(0, 6).map((x) => ({ at: x.at, text: x.text, votes: x.votes }));
  return { discord, lives: liveCount, liveHours, featured };
}

export default route({
  async GET(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", `public, max-age=${TTL}`);
    const cache = globalThis.caches?.default;
    if (cache) {
      const hit = await cache.match(KEY).catch(() => null);
      if (hit) return res.status(200).json(await hit.json());
    }
    const out = await buildStats();
    if (cache) await cache.put(KEY, new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${TTL}` } })).catch(() => {});
    return res.status(200).json(out);
  },
});
