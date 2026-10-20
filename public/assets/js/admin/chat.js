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
  const report = el("input", { class: "input num", type: "text", placeholder: "頻道 ID", value: r.reportChannelId, "aria-label": "每日回顧貼在哪個頻道" });
  let mode = r.postMode || "own";
  const modeBtns = [["own", "各自貼回自己的頻道"], ["single", "全部貼到同一個頻道"]].map(([k, label]) => {
    const btn = el("button", { class: "chip", type: "button", "data-mode": k, "aria-pressed": String(mode === k), text: label });
    btn.addEventListener("click", () => { mode = k; paintMode(); });
    return btn;
  });
  const reportField = el("label", { class: "field" }, el("span", { class: "label", text: "貼在哪個頻道" }), report,
    el("span", { class: "hint", text: "所有頻道的每日回顧（含完整紀錄）都貼到這裡。注意：大家看得到這個頻道的話，研究員大廳的紀錄也會被看到。" }));
  const modeHint = el("p", { class: "hint" });
  const paintMode = () => {
    modeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    reportField.hidden = mode !== "single";
    modeHint.textContent = mode === "own" ? "大廳的回顧貼在大廳、研究員大廳的回顧貼在研究員大廳，研究員的聊天紀錄只有研究員看得到。每張卡片也會寫出兩邊的人數和合計。" : "";
  };
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  const save = el("button", { class: "btn primary", type: "button", text: "儲存" });
  save.addEventListener("click", async () => {
    err.hidden = true;
    A.setBusy(save, true, "向 Discord 確認中…");
    try {
      const x = await api("/api/admin/chatlog", { method: "PATCH", body: { channelIds: ids.value, postMode: mode, reportChannelId: report.value } });
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

  paintMode();
  box.replaceChildren(
    el("section", { class: "card chat-set" },
      el("h2", { text: "設定" }),
      !r.configured ? el("p", { class: "form-error", text: "還沒設定 Discord 機器人（Cloudflare 的 DISCORD_BOT_TOKEN 等）" }) : null,
      el("label", { class: "field" }, el("span", { class: "label", text: "要統計的頻道（最多 5 個，用逗號分開）" }), ids,
        el("span", { class: "hint", text: "在 Discord 對頻道按右鍵「複製頻道 ID」（要先在 Discord 設定 → 進階 打開「開發者模式」）。機器人要能看到這些頻道、讀取訊息歷史。" })),
      r.channels.length ? el("div", { class: "chips", style: { marginTop: "8px" } }, ...r.channels.map((c) => el("span", { class: "pill", text: `#${c.name || c.id}` }))) : null,
      el("div", { class: "field" }, el("span", { class: "label", style: { display: "block", marginBottom: "8px" }, text: "每日回顧（卡片＋完整紀錄文字檔）貼在哪" }), el("div", { class: "chips" }, ...modeBtns), modeHint),
      reportField,
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
