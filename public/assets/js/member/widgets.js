// 好幾個畫面共用的小元件：觀看狀態、主講標籤、封面、教材、空白提示、載入中
import { el, icons, fmtBytes, thumbImg, placeholderSvg } from "../core/index.js";
import { state } from "./state.js";
import { pctOf, isWatched, isNew } from "./format.js";

export function statusOf(v, { compact = false } = {}) {
  if (isNew(v)) return el("span", { class: "st new" }, el("span", { html: icons.up }), compact ? "新" : "新上架");
  if (isWatched(v)) return el("span", { class: "st done", text: "看完" });
  const p = pctOf(v);
  if (p > 0.01) {
    const pct = Math.round(p * 100);
    return el("span", { class: "st part" }, `${pct}%`, compact ? null : el("span", { class: "meter" + (state.ticked ? "" : " grow") }, el("i", { style: { width: pct + "%" } })));
  }
  return el("span", { class: "st todo", text: "未看" });
}

export function hostTags(v) {
  return v.hosts?.length ? el("div", { class: "hosts" }, ...v.hosts.map((h) => el("span", { class: "host", text: h }))) : null;
}

export function thumbBox(v) {
  const box = el("div", { class: "screen" });
  if (v.thumb_url) box.append(thumbImg(v.thumb_url));
  else box.append(placeholderSvg());
  return box;
}

export function fileRow(a) {
  const ext = (a.title.match(/\.([a-z0-9]{1,5})$/i) || a.url.split("?")[0].match(/\.([a-z0-9]{1,5})$/i) || [, "檔案"])[1].toUpperCase();
  return el("a", { class: "file", href: a.url, rel: "noopener" },
    el("span", { class: "ext", text: ext.slice(0, 4) }),
    el("span", { class: "grow" }, el("div", { class: "name", text: a.title }), a.size_bytes ? el("div", { class: "small muted", text: fmtBytes(a.size_bytes) }) : null),
    el("span", { class: "dl", html: icons.download })
  );
}

// 空白／錯誤提示；onRetry 有給就多一顆「重新整理」
export function emptyBox(title, text, onRetry) {
  const box = el("div", { class: "empty" },
    el("span", { html: icons.film, style: { display: "block" } }),
    el("h2", { text: title }),
    el("p", { class: "small", text })
  );
  if (onRetry) box.append(el("button", { class: "btn sm", type: "button", style: { marginTop: "14px" }, text: "重新整理", onclick: onRetry }));
  return box;
}

// 載入中的灰色列
export const skelRow = (attrs = null) => el("div", { class: "skel-row", ...attrs }, el("i"), el("div", null, el("i"), el("i")));
