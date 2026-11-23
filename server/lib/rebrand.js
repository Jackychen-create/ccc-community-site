// v1.37.18：Discord 裡每一個自動化機器人都改成「研研（助理）」＋研究員貓頭鷹頭貼
// 由每 5 分鐘的排程（/api/cron/lives）呼叫，做完就不再動；狀態記在 bot_state 的 rebrand
// 1. 實驗室助教（機器人帳號）：頭貼、名字、在伺服器的暱稱
// 2. 每個 Webhook 機器人：網站存的（後台「機器人」、聊天統計每日回顧），加上機器人看得到的伺服器 Webhook 清單（有「管理 Webhook」權限才拿得到）
//    → 名字、頭貼一起改
// 3. Webhook 以前發的訊息不會跟著變（Discord 每則訊息記住當時的名字和頭貼），所以把每個 Webhook 在每個頻道／討論串
//    今天發的訊息（今天沒有就最新一則）用新名字、新頭貼原樣再發一次，舊的不刪
// 查進度：GET /api/discord-rebrand
import { env, supabaseAdmin } from "./env.js";
import { discordApi, getDiscordSettings, discordConfigured } from "./discord.js";
import { OWL_PNG_BASE64 } from "./owl-avatar.js";
import { SITE_URL } from "./discord-flow.js";

export const REBRAND = { version: "yanyan-1", name: "研研（助理）" };
const AVATAR = `data:image/png;base64,${OWL_PNG_BASE64}`;
const AVATAR_URL = `${SITE_URL}/assets/brand/ccc-owl.png`;
const HOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d{17,20})\/([\w-]{20,100})$/;
const hookBase = (u) => (env.DISCORD_API_BASE ? u.replace(/^https:\/\/[^/]+\/api(?:\/v\d+)?/, env.DISCORD_API_BASE) : u);
const clean = (e) => String(e?.message || e).replace(/webhooks\/(\d+)\/[\w-]+/g, "webhooks/$1/…").slice(0, 160);
const tpeDay = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);
const MAX_ROUNDS = 12;
const noAccess = (e) => e?.status === 403 || e?.status === 404 || e?.code === 50001 || e?.code === 50013;

async function loadState() {
  const { data } = await supabaseAdmin.from("bot_state").select("value").eq("key", "rebrand").maybeSingle();
  return data?.value || {};
}
const saveState = (st, now) => supabaseAdmin.from("bot_state").upsert({ key: "rebrand", value: st, updated_at: new Date(now).toISOString() });

// 網站存著的 Webhook，和它們設定的討論串
async function storedHooks(d) {
  const hooks = new Map(); // id → { id, url, threads:Set }
  const add = (url, thread) => {
    const m = String(url || "").match(HOOK_RE);
    if (!m) return;
    const h = hooks.get(m[1]) || { id: m[1], url, threads: new Set() };
    if (thread && /^\d{17,20}$/.test(String(thread))) h.threads.add(String(thread));
    hooks.set(m[1], h);
  };
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", "bots").maybeSingle();
  const b = data?.value || {};
  for (const o of b.outlets || []) {
    add(o?.url, o?.thread);
    for (const conf of Object.values(b.bots || {})) if (conf?.outlet === o?.id) add(o.url, conf.thread);
  }
  for (const c of d.chatChannels || []) add(c?.webhook);
  return hooks;
}

const keepEmbed = (e) => {
  const o = {};
  for (const k of ["title", "description", "url", "color", "timestamp"]) if (e[k] != null) o[k] = e[k];
  if (e.fields?.length) o.fields = e.fields.map(({ name, value, inline }) => ({ name, value, inline: !!inline }));
  if (e.author?.name) o.author = { name: e.author.name, ...(e.author.url ? { url: e.author.url } : {}), ...(e.author.icon_url ? { icon_url: e.author.icon_url } : {}) };
  if (e.footer?.text) o.footer = { text: e.footer.text, ...(e.footer.icon_url ? { icon_url: e.footer.icon_url } : {}) };
  if (e.image?.url) o.image = { url: e.image.url };
  if (e.thumbnail?.url) o.thumbnail = { url: e.thumbnail.url };
  return o;
};

// 用 Webhook 原樣再發一次（新名字、新頭貼），附件重新上傳
async function repost(hook, m, thread) {
  const payload = {
    content: m.content || "",
    embeds: (m.embeds || []).filter((e) => !e.type || e.type === "rich").map(keepEmbed).slice(0, 10),
    username: REBRAND.name,
    avatar_url: AVATAR_URL,
    allowed_mentions: { parse: [] },
  };
  const form = new FormData();
  const atts = [];
  for (const [i, a] of (m.attachments || []).slice(0, 10).entries()) {
    if (!a?.url || a.size > 8e6) continue;
    const r = await fetch(a.url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) continue;
    form.append(`files[${atts.length}]`, new Blob([await r.arrayBuffer()], { type: a.content_type || "application/octet-stream" }), a.filename || `file${i}`);
    atts.push({ id: atts.length, filename: a.filename || `file${i}` });
  }
  if (!payload.content && !payload.embeds.length && !atts.length) return null;
  if (atts.length) payload.attachments = atts;
  form.append("payload_json", JSON.stringify(payload));
  const q = `?wait=true${thread ? `&thread_id=${thread}` : ""}`;
  const res = await fetch(hookBase(hook.url) + q, { method: "POST", body: form, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw Object.assign(new Error(`再發一次失敗：Discord ${res.status} ${(await res.text().catch(() => "")).slice(0, 80)}`), { status: res.status });
  return (await res.json().catch(() => ({}))).id || "x";
}

export async function runRebrand(now = Date.now()) {
  if (!discordConfigured()) return null;
  let st = await loadState();
  if (st.version !== REBRAND.version) st = { version: REBRAND.version, rounds: 0, bot: {}, hooks: {}, places: {}, posted: {} };
  if (st.finished) return { finished: true };
  if (st.rounds >= MAX_ROUNDS) return { gaveUp: true };
  if (st.nextAt && now < st.nextAt) return { waiting: true };
  st.rounds++;
  const errors = [];
  const d = await getDiscordSettings().catch(() => ({}));

  // 1. 機器人帳號
  if (!st.bot.avatar) await discordApi("PATCH", "/users/@me", { avatar: AVATAR }).then(() => (st.bot.avatar = true), (e) => errors.push(`助教頭貼：${clean(e)}`));
  if (!st.bot.username) await discordApi("PATCH", "/users/@me", { username: REBRAND.name }).then(() => (st.bot.username = true), (e) => { errors.push(`助教名字：${clean(e)}`); if (e?.status === 400) st.bot.username = "rejected"; });
  if (!st.bot.nick && d.guildId) await discordApi("PATCH", `/guilds/${d.guildId}/members/@me`, { nick: REBRAND.name }).then(() => (st.bot.nick = true), (e) => errors.push(`助教暱稱：${clean(e)}`));

  // 2. Webhook 清單：網站存的 + 伺服器的（拿得到才算）
  const hooks = await storedHooks(d);
  if (d.guildId) {
    try {
      const list = await discordApi("GET", `/guilds/${d.guildId}/webhooks`);
      st.guildList = true;
      for (const w of list || []) {
        if (w.type !== 1) continue; // 只有一般 Webhook（追蹤公告頻道的不算）
        const h = hooks.get(w.id) || { id: w.id, url: w.token ? `https://discord.com/api/webhooks/${w.id}/${w.token}` : "", threads: new Set() };
        h.channel = w.channel_id;
        hooks.set(w.id, h);
      }
    } catch (e) { st.guildList = noAccess(e) ? "沒有管理 Webhook 權限" : clean(e); }
  }
  st.hooksTotal = hooks.size;

  for (const h of hooks.values()) {
    const rec = (st.hooks[h.id] ||= {});
    if (rec.gone) continue;
    if (!rec.renamed) {
      try {
        let w;
        if (h.url) {
          const r = await fetch(hookBase(h.url), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: REBRAND.name, avatar: AVATAR }), signal: AbortSignal.timeout(10000) });
          if (r.status === 404 || r.status === 401) { rec.gone = true; continue; }
          if (!r.ok) throw Object.assign(new Error(`Discord ${r.status}`), { status: r.status });
          w = await r.json().catch(() => ({}));
        } else {
          w = await discordApi("PATCH", `/webhooks/${h.id}`, { name: REBRAND.name, avatar: AVATAR });
        }
        rec.renamed = true;
        rec.channel = w?.channel_id || h.channel || rec.channel;
      } catch (e) { errors.push(`Webhook ${h.id}：${clean(e)}`); continue; }
    }
    if (!h.url) continue; // 沒有網址就沒辦法用它再發
    // 3. 再發一次：Webhook 所在的頻道，加上它設定的討論串
    const places = [...(rec.channel ? [{ id: rec.channel, thread: null }] : []), ...[...h.threads].map((t) => ({ id: t, thread: t }))];
    for (const p of places) {
      const key = `${h.id}:${p.id}`;
      if (st.places[key]) continue;
      try {
        const msgs = (await discordApi("GET", `/channels/${p.id}/messages?limit=50`)) || [];
        const mine = msgs.filter((m) => m.webhook_id === h.id && !st.posted[m.id]);
        const today = mine.filter((m) => tpeDay(Date.parse(m.timestamp)) === tpeDay(now));
        const pick = (today.length ? today : mine.slice(0, 1)).slice(0, 6).reverse();
        for (const m of pick) {
          const newId = await repost(h, m, p.thread);
          st.posted[m.id] = true;
          if (newId) st.posted[newId] = true;
          await saveState(st, now);
        }
        st.places[key] = pick.length ? `再發 ${pick.length} 則` : "沒有訊息";
      } catch (e) {
        if (noAccess(e)) st.places[key] = "機器人看不到這個頻道";
        else errors.push(`再發一次（${p.id}）：${clean(e)}`);
      }
    }
  }

  st.errors = errors.slice(0, 10);
  st.at = now;
  if (errors.filter((x) => !x.startsWith("助教名字")).length === 0) st.finished = true;
  else st.nextAt = now + 20 * 60e3;
  // posted 只留最近的，免得越來越大
  const ids = Object.keys(st.posted);
  if (ids.length > 300) st.posted = Object.fromEntries(ids.slice(-300).map((k) => [k, true]));
  await saveState(st, now);
  return { finished: !!st.finished, errors: st.errors.length };
}

// 公開的進度（不含網址、不含 token）
export async function rebrandStatus() {
  const st = await loadState();
  const hooks = Object.values(st.hooks || {});
  return {
    version: st.version || null, finished: !!st.finished, rounds: st.rounds || 0, at: st.at || null,
    bot: st.bot || {}, guildWebhookList: st.guildList ?? null,
    webhooks: { total: st.hooksTotal || 0, renamed: hooks.filter((h) => h.renamed).length, gone: hooks.filter((h) => h.gone).length },
    places: Object.values(st.places || {}), errors: st.errors || [],
  };
}
