// 後台編輯影片：直播精華（AI 整理的摘要、重點、標的、建議章節）
// 直播留檔發布後，GitHub Actions 大約 2 小時內會自動產生；這裡看結果、套用章節、重做、再貼一次 Discord
import * as A from "../core/index.js";

const { el, api, icon } = A;
const STATUS = {
  pending: "排隊中，大約 2 小時內會產生",
  processing: "正在整理中…",
  failed: "上次失敗了",
  skipped: "略過（聽不到講話的內容）",
};

// onApply(chapters)：把 AI 建議的章節填進章節欄（還沒儲存）
export function highlightField(v, { onApply }) {
  const body = el("div", { class: "hl-admin" }, el("p", { class: "small muted", text: "讀取中…" }));
  const box = el("div", { class: "field" },
    el("div", { class: "section-label" }, el("span", { class: "label", text: "✨ 直播精華（自動整理）" })),
    body);

  const btn = (label, ic, fn) => {
    const b = el("button", { class: "btn sm", type: "button" }, icon(ic), label);
    b.addEventListener("click", async () => { A.setBusy(b, true); try { await fn(); } catch (e) { A.toast(e.message, "err"); } A.setBusy(b, false); });
    return b;
  };
  const redo = () => btn("重新產生", "pulse", async () => {
    await api("/api/admin/highlights", { method: "POST", body: { video: v.id, action: "redo" } });
    A.toast("已排進去，大約 2 小時內會重新產生（不會再貼一次 Discord）");
    load();
  });

  async function load() {
    let h;
    try { h = (await api(`/api/admin/highlights?video=${v.id}`)).highlight; } catch (e) { body.replaceChildren(el("p", { class: "small warn-text", text: e.message })); return; }
    if (!h) {
      body.replaceChildren(el("p", { class: "small muted", text: v.is_published ? "還沒產生。發布後大約 2 小時內會自動整理好，研究員在播放頁會看到。" : "發布後大約 2 小時內會自動整理好。" }),
        v.is_published ? el("div", { class: "hl-actions" }, redo()) : null);
      return;
    }
    if (h.status !== "done") {
      body.replaceChildren(el("p", { class: `small ${h.status === "failed" ? "warn-text" : "muted"}`, text: `${STATUS[h.status] || h.status}${h.error ? `：${h.error}` : ""}` }),
        h.status === "processing" && !h.stale ? null : el("div", { class: "hl-actions" }, redo()));
      return;
    }
    const chaps = h.chapters || [];
    body.replaceChildren(
      el("p", { class: "small", text: h.summary }),
      h.points?.length ? el("ul", { class: "small hl-points" }, ...h.points.map((x) => el("li", { text: x }))) : null,
      h.tickers?.length ? el("p", { class: "small muted", text: `提到的標的：${h.tickers.map((x) => x.name).join("、")}` }) : null,
      el("p", { class: "small muted", text: `${h.posted_at ? `已貼到 Discord（${A.fmtRel(h.posted_at)}）` : "還沒貼到 Discord（後台 Discord 審核 → 直播精華頻道 ID 要先設定）"}・${h.model || ""}` }),
      el("div", { class: "hl-actions" },
        chaps.length ? btn(`把建議的 ${chaps.length} 段章節填進章節欄`, "edit", async () => { onApply(chaps); A.toast("已填進章節欄，看過沒問題再按儲存"); }) : null,
        btn(h.posted_at ? "再貼一次到 Discord" : "貼到 Discord", "chat", async () => {
          await api("/api/admin/highlights", { method: "POST", body: { video: v.id, action: "post" } });
          A.toast("已貼到 Discord");
          load();
        }),
        redo()),
      h.transcript ? el("details", { class: "hl-transcript" }, el("summary", { class: "small", text: `看逐字稿（${h.chunk_count} 段）` }), el("pre", { class: "small", text: h.transcript })) : null,
    );
  }
  load();
  return box;
}
