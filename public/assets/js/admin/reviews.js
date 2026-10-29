// 交易檢討投稿（放在「聊天統計」頁）：研究員在交易績效自己的貼文按 🔍，每週日 21:00 整理
// 伺服器在 server/admin/reviews.js、server/lib/reviews.js
import * as A from "../core/index.js";
const { el, api } = A;

const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const when = (ms) => { const d = new Date(ms + 8 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

export function reviewsCard() {
  const card = el("section", { class: "card chat-set", id: "reviewsCard" }, el("h2", { text: "交易檢討投稿" }), el("p", { class: "small muted", text: "載入中…" }));
  load(card);
  return card;
}

async function load(card) {
  let r;
  try { r = await api("/api/admin/reviews"); } catch (e) {
    card.replaceChildren(el("h2", { text: "交易檢討投稿" }), el("p", { class: "form-error", text: e.message || "載入失敗" }));
    return;
  }
  render(card, r);
}

function render(card, r) {
  const perf = el("input", { class: "input num", type: "text", inputmode: "numeric", maxlength: "20", value: r.perfChannelId, placeholder: "交易績效頻道 ID", "aria-label": "交易績效頻道 ID", id: "rvPerf" });
  const pub = el("input", { class: "input num", type: "text", inputmode: "numeric", maxlength: "20", value: r.reviewPublicChannelId, placeholder: "公開通知頻道 ID（選填）", "aria-label": "公開通知頻道 ID", id: "rvPublic" });
  const err = el("div", { class: "form-error", role: "alert", hidden: true });
  const save = el("button", { class: "btn primary", type: "button", text: "儲存" });
  save.addEventListener("click", async () => {
    err.hidden = true;
    A.setBusy(save, true, "向 Discord 確認中…");
    try {
      await api("/api/admin/reviews", { method: "PATCH", body: { perfChannelId: perf.value.trim(), reviewPublicChannelId: pub.value.trim() } });
      A.toast("已儲存交易檢討投稿的頻道");
      await load(card);
    } catch (e) { err.textContent = e.message; err.hidden = false; A.setBusy(save, false); }
  });
  const run = el("button", { class: "btn", type: "button", text: "立即整理這一週", disabled: !r.perfChannelId });
  run.addEventListener("click", async () => {
    if (!(await A.confirmDialog({ title: "現在整理這一週的投稿？", message: "新的投稿會貼到審核頻道、私訊投稿的人；有新投稿時公開頻道也會貼筆數。已經整理過的不會重複。", confirmText: "整理" }))) return;
    A.setBusy(run, true, "整理中…");
    try {
      const x = await api("/api/admin/reviews", { method: "POST", body: { action: "run" } });
      A.toast(x.fresh ? `新收到 ${x.fresh} 筆投稿（這週共 ${x.count} 筆），已私訊 ${x.dms} 人` : `沒有新的投稿（這週共 ${x.count} 筆）`);
      await load(card);
    } catch (e) { A.toast(e.message, "error"); A.setBusy(run, false); }
  });

  const weeks = r.weeks.filter((w) => w.items.length);
  const list = weeks.length ? weeks.map((w) => el("div", { class: "rv-week" },
    el("h3", { class: "rv-week-h", text: `${md(w.week)} 那週・${w.items.length} 筆（已點評 ${w.items.filter((i) => i.reviewed).length}）` }),
    ...w.items.map((it) => {
      const box = el("input", { type: "checkbox", "aria-label": `${it.authorName} 的投稿已點評` });
      box.checked = !!it.reviewed;
      box.addEventListener("change", async () => {
        box.disabled = true;
        try {
          await api("/api/admin/reviews", { method: "POST", body: { action: "reviewed", week: w.week, id: it.id, reviewed: box.checked } });
          A.toast(box.checked ? `已標記點評，已私訊 ${it.authorName}` : "已取消點評標記");
        } catch (e) { box.checked = !box.checked; A.toast(e.message, "error"); }
        box.disabled = false;
      });
      return el("div", { class: "rv-item" + (it.reviewed ? " done" : "") },
        el("label", { class: "rv-check" }, box, el("span", { class: "small", text: "已點評" })),
        el("div", { class: "rv-body" },
          el("div", { class: "small" }, el("b", { text: it.authorName }), el("span", { class: "muted num", text: `・${when(it.at)}` }), it.attachments ? el("span", { class: "muted", text: `・📎 ${it.attachments}` }) : null),
          el("p", { class: "rv-text", text: it.text || "（只有圖片）" }),
          r.guildId ? el("a", { class: "small", href: `https://discord.com/channels/${r.guildId}/${it.channel}/${it.id}`, target: "_blank", rel: "noopener", text: "在 Discord 看原文 ↗" }) : null));
    }))) : [el("p", { class: "small muted", text: r.perfChannelId ? "還沒有投稿。研究員在交易績效自己的貼文按 🔍，每週日 21:00 會整理到這裡。" : "先填交易績效頻道。" })];

  card.replaceChildren(...[
    el("h2", { text: "交易檢討投稿" }),
    el("p", { class: "small sub", text: "研究員在交易績效頻道自己的貼文按 🔍 就是投稿（別人幫按不算）。每週日 21:00 機器人整理：完整清單貼到審核頻道（只有管理員看得到），公開頻道只貼「本週收到 N 筆」，不寫是誰、投了什麼；投稿的人會收到私訊。點評完在下面勾「已點評」，機器人會再私訊告訴他。" }),
    el("div", { class: "chat-target" },
      el("span", { class: "small chat-k", text: "交易績效" }), perf, r.perfChannelName ? el("span", { class: "small dc-ok", text: `✓ #${r.perfChannelName}` }) : null),
    el("div", { class: "chat-target" },
      el("span", { class: "small chat-k", text: "公開通知" }), pub, r.reviewPublicChannelName ? el("span", { class: "small dc-ok", text: `✓ #${r.reviewPublicChannelName}` }) : el("span", { class: "small muted", text: "空白＝不貼公開通知" })),
    !r.reviewChannelId ? el("p", { class: "small warn-text", text: "還沒有審核頻道（Discord 頁的「審核頻道」），講師清單只會在這頁看得到。" }) : null,
    err,
    el("div", { class: "actions", style: { marginTop: "12px", flexWrap: "wrap" } }, save, run),
    ...list].filter(Boolean));
}
