// DOM 小工具、圖示元素、封面圖
import { icons } from "./icons.js";

export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v; // 只用於本檔內的固定圖示字串
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
export const $ = (sel, root = document) => root.querySelector(sel);

export function icon(name) {
  const span = document.createElement("span");
  span.style.display = "inline-flex";
  span.innerHTML = icons[name] || "";
  return span.firstElementChild || span;
}

// 沒有封面時的示意圖（淡淡的 K 線）
const PH_CANDLES = [[18,96,120,104,114],[40,90,116,98,108],[62,74,104,80,96],[84,80,110,86,92],[106,62,94,70,84],
  [128,66,96,72,78],[150,50,84,58,70],[172,56,90,62,82],[194,46,78,52,64],[216,40,72,46,58],[238,48,80,54,70],
  [260,34,66,40,50],[282,28,60,34,46],[304,36,70,42,60]];
export function placeholderSvg(cls = "ph") {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 320 180");
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  PH_CANDLES.forEach(([x, hi, lo, top, bot], i) => {
    const up = i % 3 !== 1;
    const line = document.createElementNS(ns, "line");
    for (const [k, v] of [["x1", x], ["x2", x], ["y1", hi + 20], ["y2", lo + 20], ["stroke", "currentColor"], ["stroke-width", "1.5"]]) line.setAttribute(k, v);
    const rect = document.createElementNS(ns, "rect");
    for (const [k, v] of [["x", x - 6], ["y", top + 20], ["width", 12], ["height", bot - top], ["stroke", "currentColor"], ["stroke-width", "1.5"], ["fill", up ? "var(--sunken)" : "currentColor"]]) rect.setAttribute(k, v);
    svg.append(line, rect);
  });
  return svg;
}

// 封面圖：載入失敗就換成示意圖
export function thumbImg(src) {
  const img = el("img", { src, alt: "", loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => img.replaceWith(placeholderSvg()), { once: true });
  return img;
}
