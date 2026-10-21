// 後台：機器人（只有主要管理員）。機器人本身跑在 Supabase Edge Function「bots」（supabase/functions/bots/）
// GET   /api/admin/bots                 清單、每支的設定、最近的執行結果、Webhook 出口（網址不回傳，只回後四碼）
// PATCH /api/admin/bots { addOutlet: { id?, name, url? } }    新增或改名一個出口（url 空白＝不改）
//                       { removeOutlet: "id" }                 移除出口（用到它的機器人會變成沒設定）
//                       { bot: "tw_close", enabled, outlet, thread, opts }   改一支機器人
//                       { alertOutlet: "id" | "" }             出錯時通知哪個出口
// POST  /api/admin/bots { run: "tw_close", dryRun: true }      預覽（不貼）或立即發一次
import { supabaseAdmin, requireAdmin, readBody, route, env, isSnowflake, cleanText } from "../lib/index.js";
import { BOTS, GROUPS, botByKey } from "../../supabase/functions/bots/registry.js";

const WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d{17,20})\/([\w-]{20,100})$/;
const OPT_RE = /^[\w\s,，、.\-:/]{0,300}$/;

async function readSettings() {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", "bots").maybeSingle();
  return { outlets: [], bots: {}, alertOutlet: "", ...(data?.value || {}) };
}
async function saveSettings(v) {
  const { error } = await supabaseAdmin.from("settings").upsert({ key: "bots", value: v });
  if (error) throw error;
}
const maskOutlets = (list) => (list || []).map((o) => ({ id: o.id, name: o.name, tail: o.url ? o.url.slice(-4) : "", hasUrl: !!o.url, hookName: o.hookName || "", channelId: o.channelId || "" }));
const newId = () => Math.random().toString(36).slice(2, 10);

// 讀 Webhook 的名字、在哪個頻道（儲存時確認網址有效）
async function webhookInfo(url) {
  const base = env.DISCORD_API_BASE;
  const u = base ? url.replace(/^https:\/\/[^/]+\/api(?:\/v\d+)?/, base) : url;
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(r.status === 404 || r.status === 401 ? "這個 Webhook 不存在或已經被刪掉了" : `Discord ${r.status}`);
  const w = await r.json();
  return { hookName: w.name || "", channelId: w.channel_id || "" };
}

export default route({
  async GET(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const s = await readSettings();
    const { data: runs, error } = await supabaseAdmin.from("bot_runs").select("bot, at, ok, posted, note, ms").order("at", { ascending: false }).limit(300);
    if (error) throw error;
    const last = {};
    for (const r of runs || []) (last[r.bot] ||= []).length < 5 && last[r.bot].push(r);
    return res.status(200).json({
      groups: GROUPS,
      bots: BOTS.map((b) => ({ ...b, conf: s.bots?.[b.key] || {}, runs: last[b.key] || [] })),
      outlets: maskOutlets(s.outlets),
      alertOutlet: s.alertOutlet || "",
      engineReady: !!(env.SUPABASE_URL && env.CRON_SECRET),
    });
  },

  async PATCH(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    const s = await readSettings();
    if (b.addOutlet) {
      const name = cleanText(b.addOutlet.name, 30);
      if (!name) return res.status(400).json({ error: "幫這個 Webhook 取個名字，例如「股市整合頻道」" });
      const url = String(b.addOutlet.url || "").trim();
      const cur = b.addOutlet.id ? s.outlets.find((o) => o.id === b.addOutlet.id) : null;
      if (b.addOutlet.id && !cur) return res.status(404).json({ error: "找不到這個 Webhook" });
      if (!cur && !url) return res.status(400).json({ error: "貼上 Webhook 網址（頻道設定 → 整合 → Webhook → 複製 Webhook 網址）" });
      const next = cur ? { ...cur, name } : { id: newId(), name };
      if (url) {
        if (!WEBHOOK_RE.test(url)) return res.status(400).json({ error: "Webhook 網址不對：要是 https://discord.com/api/webhooks/… 開頭" });
        try { Object.assign(next, { url }, await webhookInfo(url)); } catch (e) { return res.status(400).json({ error: e.message }); }
      }
      s.outlets = cur ? s.outlets.map((o) => (o.id === cur.id ? next : o)) : [...s.outlets, next];
    }
    if (b.removeOutlet) {
      s.outlets = s.outlets.filter((o) => o.id !== b.removeOutlet);
      for (const k of Object.keys(s.bots || {})) if (s.bots[k].outlet === b.removeOutlet) s.bots[k] = { ...s.bots[k], outlet: "", enabled: false };
      if (s.alertOutlet === b.removeOutlet) s.alertOutlet = "";
    }
    if (b.bot) {
      const meta = botByKey(b.bot);
      if (!meta) return res.status(404).json({ error: "沒有這支機器人" });
      const cur = s.bots?.[b.bot] || {};
      const next = { ...cur };
      if (b.outlet !== undefined) {
        if (b.outlet && !s.outlets.some((o) => o.id === b.outlet)) return res.status(400).json({ error: "先新增 Webhook，再選它" });
        next.outlet = b.outlet || "";
      }
      if (b.thread !== undefined) {
        const t = String(b.thread || "").trim();
        if (t && !isSnowflake(t)) return res.status(400).json({ error: "討論串 ID 是 17–20 位數字（對討論串按右鍵「複製討論串 ID」），不用就留空白" });
        next.thread = t;
      }
      if (b.opts && typeof b.opts === "object") {
        const opts = {};
        for (const o of meta.opts || []) {
          if (b.opts[o.k] === undefined || b.opts[o.k] === "") continue;
          const v = String(b.opts[o.k]).trim();
          if (!OPT_RE.test(v)) return res.status(400).json({ error: `「${o.label}」有不能用的字` });
          opts[o.k] = typeof o.def === "number" ? Number(v) : v;
          if (typeof o.def === "number" && !Number.isFinite(opts[o.k])) return res.status(400).json({ error: `「${o.label}」要填數字` });
        }
        next.opts = opts;
      }
      if (b.enabled !== undefined) {
        if (b.enabled && !next.outlet) return res.status(400).json({ error: "先選要貼到哪個 Webhook 再打開" });
        next.enabled = !!b.enabled;
      }
      s.bots = { ...(s.bots || {}), [b.bot]: next };
    }
    if (b.alertOutlet !== undefined) {
      if (b.alertOutlet && !s.outlets.some((o) => o.id === b.alertOutlet)) return res.status(400).json({ error: "找不到這個 Webhook" });
      s.alertOutlet = b.alertOutlet || "";
    }
    await saveSettings(s);
    return res.status(200).json({ ok: true, outlets: maskOutlets(s.outlets), bots: s.bots, alertOutlet: s.alertOutlet });
  },

  async POST(req, res) {
    if (!(await requireAdmin(req, res))) return;
    const b = readBody(req);
    if (!botByKey(b.run)) return res.status(404).json({ error: "沒有這支機器人" });
    if (!env.SUPABASE_URL || !env.CRON_SECRET) return res.status(503).json({ error: "還沒設定機器人引擎（Cloudflare 的 CRON_SECRET）" });
    const r = await fetch(`${String(env.SUPABASE_URL).replace(/\/$/, "")}/functions/v1/bots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": env.CRON_SECRET, "x-region": "ap-northeast-1" },
      body: JSON.stringify({ run: b.run, force: true, dryRun: !!b.dryRun }),
      signal: AbortSignal.timeout(120000),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e?.message || e) }) }));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: data.error || `機器人引擎回應 ${r.status}` });
    return res.status(200).json(data);
  },
});
