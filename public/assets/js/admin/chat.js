// 聊天統計：每天統計指定 Discord 頻道（例如大廳、研究員大廳）的訊息數、發言人數，聊天紀錄存成文字檔貼到回報頻道
// 伺服器在 server/admin/chatlog.js、server/lib/chatlog.js；每天 00:05 自動跑前一天
import * as A from "../core/index.js";
const { el, $, api, icon } = A;
import { fail, loadingBox } from "./common.js";

const yesterday = () => { const d = new Date(Date.now() + 8 * 3600e3); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export async function loadChat() {
  const box = $("#chatBox");
  box.replaceChildren(loadingBox());
  let r;
  try {
    r = await api("/api/admin/chatlog");
  } catch (e) {
    return fail(e);
  }
  render(r);
}

function render(r) {
  const box = $("#chatBox");
  const ids = el("input", { class: "input num", type: "text", placeholder: "例如 1234567890123456789, 2345678901234567890", value: r.channels.map((c) => c.id).join(", "), "aria-label": "要統計的頻道 ID" });
  // 每個頻道用哪個 Webhook 貼每日回顧（Webhook 自己有名字、頭像，跟審核機器人分開；網址不會再顯示出來）
  const removed = new Set();
  const targets = r.channels.map((c) => {
    const label = `#${c.name || c.id}`;
    const input = el("input", { class: "input num", type: "password", autocomplete: "off", placeholder: c.hasWebhook ? "已設定，要換才貼新的網址" : "貼上 Webhook 網址（https://discord.com/api/webhooks/…）", "aria-label": `${label} 的每日回顧 Webhook 網址` });
    input.dataset.channel = c.id;
    const status = el("span", { class: "small" + (c.hasWebhook ? "" : " muted"), text: c.hasWebhook ? `✓ 用「${c.webhookName || "Webhook"}」貼${c.webhookChannelName ? `到 #${c.webhookChannelName}` : ""}` : `還沒設定：由審核機器人貼回 ${label}` });
    const rm = c.hasWebhook ? el("button", { class: "btn sm ghost", type: "button", text: "移除", "aria-label": `移除 ${label} 的 Webhook` }) : null;
    rm?.addEventListener("click", () => { removed.add(c.id); status.textContent = "按儲存後移除，改回由審核機器人貼"; rm.disabled = true; });
    return el("div", { class: "chat-target" }, el("span", { class: "pill", text: label }), input, el("div", { class: "chat-target-st" }, status, rm));
  });
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  const save = el("button", { class: "btn primary", type: "button", text: "儲存" });
  save.addEventListener("click", async () => {
    err.hidden = true;
    A.setBusy(save, true, "向 Discord 確認中…");
    try {
      const webhooks = Object.fromEntries(targets.map((t) => t.querySelector("input")).map((x) => [x.dataset.channel, removed.has(x.dataset.channel) ? null : x.value.trim()]));
      const x = await api("/api/admin/chatlog", { method: "PATCH", body: { channelIds: ids.value, webhooks, postMode: "own" } });
      A.toast(`已儲存：統計 ${x.channels.map((c) => `#${c.name || c.id}`).join("、") || "（沒有頻道）"}`);
      loadChat();
    } catch (e) {
      A.setBusy(save, false);
      err.textContent = e.message;
      err.hidden = false;
    }
  });

  const day = el("input", { class: "input chat-day", type: "date", value: yesterday(), max: yesterday(), "aria-label": "統計哪一天" });
  const run = el("button", { class: "btn", type: "button", disabled: !r.channels.length || !r.configured }, icon("chart"), "立即產生每日回顧");
  run.addEventListener("click", async () => {
    A.setBusy(run, true, "統計中…");
    try {
      const x = await api("/api/admin/chatlog", { method: "POST", body: { day: day.value } });
      const bad = x.rows.filter((y) => y.error);
      A.toast(bad.length ? `有 ${bad.length} 個頻道抓不到：${bad.map((y) => `#${y.name} ${y.error}`).join("、")}` : x.posted ? `${md(x.day)}：${x.total.messages} 則、${x.total.authors} 人，每日回顧已貼到 Discord` : `${md(x.day)}：${x.total.messages} 則、${x.total.authors} 人（沒有貼到 Discord：${x.postError || "沒有可以貼的頻道"}）`, bad.length || x.postError ? "err" : undefined);
      if (x.noContent) A.toast("聊天紀錄的內容是空的：請到 Discord Developer Portal → Bot 打開「Message Content Intent」", "err");
      loadChat();
    } catch (e) {
      A.setBusy(run, false);
      A.toast(e.message, "err");
    }
  });

  // 最近 30 天：一天一列，每個頻道一欄
  // 欄位順序跟設定一樣（例如先大廳再研究員大廳），之前統計過、現在拿掉的頻道放後面
  const names = new Map(r.stats.map((s) => [s.channel_id, s.channel_name || s.channel_id]));
  for (const c of r.channels) names.set(c.id, c.name || names.get(c.id) || c.id);
  const order = [...r.channels.map((c) => c.id), ...[...names.keys()].filter((id) => !r.channels.some((c) => c.id === id))];
  const chans = order.filter((id) => r.stats.some((s) => s.channel_id === id)).map((id) => [id, names.get(id)]);
  const days = [...new Set(r.stats.map((s) => s.day))];
  const cell = (d, id) => r.stats.find((s) => s.day === d && s.channel_id === id);
  const max = Math.max(1, ...r.stats.map((s) => s.messages));
  const table = days.length
    ? el("div", { class: "table-wrap" }, el("table", { class: "table chat-table" },
        el("thead", null, el("tr", null, el("th", { text: "日期" }), ...chans.map(([, n]) => el("th", { text: `#${n}` })), chans.length > 1 ? el("th", { text: "合計訊息" }) : null)),
        el("tbody", null, ...days.map((d) => el("tr", null,
          el("td", { class: "num small", text: md(d) }),
          ...chans.map(([id]) => {
            const s = cell(d, id);
            if (!s) return el("td", { class: "muted small", text: "—" });
            return el("td", { title: s.top?.length ? `最常發言：${s.top.map((t) => `${t.name} ${t.n}`).join("、")}` : "" },
              el("div", { class: "chat-bar", style: { width: `${Math.round((s.messages / max) * 100)}%` } }),
              el("span", { class: "num", text: `${s.messages} 則` }), el("span", { class: "small muted num", text: `・${s.authors} 人` }));
          }),
          chans.length > 1 ? el("td", { class: "num", text: String(chans.reduce((a, [id]) => a + (cell(d, id)?.messages || 0), 0)) }) : null)))))
    : el("div", { class: "empty" }, el("p", { text: r.channels.length ? "還沒有統計資料。每天 00:05 會自動統計前一天，也可以按上面的「立即統計」。" : "先在上面填要統計的頻道。" }));

  box.replaceChildren(
    el("section", { class: "card chat-set" },
      el("h2", { text: "設定" }),
      !r.configured ? el("p", { class: "form-error", text: "還沒設定 Discord 機器人（Cloudflare 的 DISCORD_BOT_TOKEN 等）" }) : null,
      el("label", { class: "field" }, el("span", { class: "label", text: "要統計的頻道（最多 5 個，用逗號分開）" }), ids,
        el("span", { class: "hint", text: "在 Discord 對頻道按右鍵「複製頻道 ID」（要先在 Discord 設定 → 進階 打開「開發者模式」）。機器人要能看到這些頻道、讀取訊息歷史。" })),
      r.channels.length ? el("div", { class: "field" }, el("span", { class: "label", style: { display: "block", marginBottom: "8px" }, text: "每日回顧用哪個 Webhook 貼（卡片＋完整紀錄文字檔）" }), ...targets,
        el("span", { class: "hint", text: "在要貼回顧的頻道：頻道設定 → 整合 → Webhook → 新 Webhook，取名（例如「CCC｜每日回顧」）、換頭像，按「複製 Webhook 網址」貼到這裡。回顧會貼在 Webhook 所在的頻道：大廳的建在原本的每日回顧頻道，研究員大廳的建在研究員大廳。網址等同發文的鑰匙，存好後不會再顯示。新增頻道後要先儲存一次才會出現在這裡。" })) : null,
      el("p", { class: "hint", text: "第一次用：到 Discord Developer Portal → 你的機器人 → Bot，打開「Message Content Intent」，才抓得到聊天內容。機器人在要貼的頻道要能「傳送訊息」「附加檔案」「嵌入連結」。" }),
      err,
      el("div", { class: "actions", style: { marginTop: "12px" } }, save)),
    el("section", { class: "card chat-set" },
      el("h2", { text: "立即統計" }),
      el("p", { class: "small sub", text: "每天 00:05（台灣時間）會自動統計前一天。想補某一天或先試試看，選日期按下面的按鈕。" }),
      el("div", { class: "actions", style: { marginTop: "10px", flexWrap: "wrap" } }, day, run)),
    el("h2", { class: "chat-h", text: "最近 30 天" }),
    table);
}
