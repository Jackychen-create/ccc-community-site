// 觀看資格：到期提醒橫幅、右欄「本月交易量」
import { $, el, icons, fmtRel } from "../core/index.js";
import { state } from "./state.js";
import { DAY, md, fmtWan } from "./format.js";

// 每月資格：到期前 7 天提醒
export function renderAccessBanner() {
  const me = state.me;
  const box = $("#accessBanner");
  const until = me?.accessUntil;
  if (!until) return (box.hidden = true);
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(until) - Date.parse(today)) / DAY);
  if (days > 7) return (box.hidden = true);
  box.hidden = false;
  box.replaceChildren(
    el("span", { html: icons.clock }),
    el("span", { text: days <= 0 ? `你的觀看資格今天（${until}）到期。` : `你的觀看資格到 ${until}，還有 ${days} 天。` }),
    el("span", { class: "muted", text: volHint(me.volume) })
  );
}

// 資格提醒的第二句：這個月達標還能延長，就講這個月；已經到月底了，就講下個月
function volHint(v) {
  if (!v) return "要繼續觀看請聯絡管理員更新資格。";
  const rule = `任一間（${v.exchanges.join("、")}）當月交易量達 ${fmtWan(v.threshold)} USDT`;
  return v.qualified ? `下個月${rule}，達標那天起可以再看一個月。` : `這個月${rule}，達標那天起可以再看一個月。`;
}

// 右欄：本月交易量（管理員在後台填，任一間達標就有資格）
export function renderVolPanel() {
  const box = $("#volPanel");
  const v = state.me?.volume;
  if (!v) return (box.hidden = true);
  box.hidden = false;
  const monthNo = Number(v.month.slice(5));
  const best = Math.max(0, ...v.exchanges.map((ex) => Number(v.amounts?.[ex] || 0)));
  box.replaceChildren(
    el("div", { class: "panel-head", style: { padding: "14px 18px" } },
      el("h2", { text: `${monthNo} 月交易量` }),
      v.qualified ? el("span", { class: "pill good" }, el("span", { class: "dot" }), "已達標")
        : el("span", { class: "pill" }, v.amounts ? `還差 ${fmtWan(Math.max(0, v.threshold - best))}` : "尚未更新")),
    el("div", { class: "vol-rows" },
      ...v.exchanges.map((ex) => {
        const n = Number(v.amounts?.[ex] || 0);
        return el("div", { class: "vol-row" + (n >= v.threshold ? " ok" : "") },
          el("span", { class: "vol-ex", text: ex }),
          el("span", { class: "num vol-n", text: v.amounts ? fmtWan(n) : "—" }),
          el("span", { class: "track" }, el("i", { style: { width: Math.min(100, (n / v.threshold) * 100) + "%" } })));
      })),
    el("p", { class: "small muted vol-note", text: (v.qualifiedAt ? `${md(v.qualifiedAt)} 達標，可以看到 ${md(v.qualifiedUntil)}。` : `任一間當月成交金額達 ${fmtWan(v.threshold)} USDT，達標那天起可以看一個月（例如 10/15 達標，看到 11/14）。`) + (v.updatedAt ? `數字由管理員更新（${fmtRel(v.updatedAt)}）。` : "數字由管理員每月更新。") })
  );
}
