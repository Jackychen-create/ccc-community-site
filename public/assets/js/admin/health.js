// 網站狀況：研究員那邊自動回報的問題（播不動、讀取失敗、程式錯誤、上傳失敗）和搜尋不到的關鍵字
import * as A from "../core/index.js";
const { el, $, api } = A;
import { fail, loadingBox } from "./common.js";

// 網站狀況
const HL_KIND = { video: "影片播不動", api: "讀取失敗", js: "程式錯誤", upload: "上傳失敗" };
$("#hlDays").addEventListener("change", () => loadHealth());
export async function loadHealth() {
  const box = $("#hlBox");
  box.replaceChildren(loadingBox());
  let r;
  try {
    r = await api(`/api/admin/errors?days=${$("#hlDays").value}`);
  } catch (e) {
    return fail(e);
  }
  const probs = r.groups.reduce((a, g) => a + g.count, 0);
  $("#cHealth").textContent = r.groups.length || "";
  $("#hlSub").textContent = probs ? `最近 ${r.days} 天記到 ${probs} 次問題（${r.groups.length} 種），還有 ${r.searches.length} 個搜尋找不到東西的關鍵字。` : `最近 ${r.days} 天沒有記到問題。`;
  const clear = async (kind, message) => {
    try {
      await api(`/api/admin/errors?kind=${encodeURIComponent(kind)}&message=${encodeURIComponent(message)}`, { method: "DELETE" });
      A.toast("已標成處理好了");
      loadHealth();
    } catch (e) {
      fail(e);
    }
  };
  const groups = r.groups.length
    ? el("div", { class: "table-wrap" }, el("table", { class: "table stack" },
        el("thead", null, el("tr", null, el("th", { text: "問題" }), el("th", { text: "次數" }), el("th", { class: "hide-sm", text: "遇到的人" }), el("th", { class: "hide-sm", text: "最近一次" }), el("th", null, el("span", { class: "sr-only", text: "操作" })))),
        el("tbody", null, r.groups.map((g) => {
          const s0 = g.samples[0]?.context || {};
          const detail = [s0.title ? `影片：${s0.title}` : "", s0.path ? `頁面：${s0.path}` : "", s0.ua ? (/(iPhone|iPad)/.test(s0.ua) ? "iPhone／iPad" : /Android/.test(s0.ua) ? "Android" : /Mac/.test(s0.ua) ? "Mac" : /Windows/.test(s0.ua) ? "Windows" : "") : ""].filter(Boolean).join("・");
          return el("tr", null,
            el("td", null, el("span", { class: "pill" + (g.kind === "video" ? " warn" : ""), text: HL_KIND[g.kind] || g.kind }), el("div", { class: "t-title", style: { marginTop: "6px" }, text: g.message }), detail ? el("div", { class: "small muted", text: detail }) : null),
            el("td", { class: "num stat-n", text: String(g.count) }),
            el("td", { class: "small hide-sm", title: g.users.join("\n"), text: `${g.user_count} 人` }),
            el("td", { class: "small hide-sm", text: A.fmtRel(g.last_at) }),
            el("td", null, el("button", { class: "btn sm", type: "button", text: "處理好了", onclick: () => clear(g.kind, g.message) })));
        }))))
    : el("div", { class: "empty" }, el("h2", { text: "沒有記到問題" }), el("p", { class: "small", style: { marginTop: "6px" }, text: "研究員那邊播不動、讀取失敗時，會自動記在這裡。" }));
  const searches = el("div", { class: "card hl-search" },
    el("h2", { text: "研究員搜尋但找不到" }),
    el("p", { class: "small muted", style: { margin: "4px 0 12px" }, text: "可以當作下一場要講什麼的參考，或補進影片簡介、章節。" }),
    r.searches.length
      ? el("div", { class: "chips" }, ...r.searches.map((q) => el("span", { class: "chip hl-q", title: q.users.join("\n") }, q.q, el("b", { class: "num", text: ` ${q.count}` }),
          el("button", { class: "hl-x", type: "button", "aria-label": `移除 ${q.q}`, onclick: () => clear("search_empty", q.q) }, "×"))))
      : el("p", { class: "small muted", text: "還沒有。" }));
  box.replaceChildren(groups, searches);
}
