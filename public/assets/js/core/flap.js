// 左上角 CCC：像營業廳的翻牌看板。載入就把頁面上的 .mark 變成翻牌
// 依序翻出三位主講（config.js 的 HOSTS，例如 X → OC），最後停在 CCC
import { cfg } from "./config.js";
import { el } from "./dom.js";
import { reduceMotion } from "./ui.js";

const FLAP_CHARS = "ABDEFGHJKLMNPRSTUVWXYZ0123456789";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function splitFlap(mark) {
  const word = mark.textContent.trim();
  if (!word) return;
  const size = word.length;
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", word);
  const tiles = [...word].map((ch) => el("span", { class: "flap", "aria-hidden": "true" }, el("b", { text: ch })));
  mark.replaceChildren(...tiles);

  // 要翻過的字：其他主講（放得下的才翻），最後回到原本的字
  const pad = (w) => {
    const left = Math.ceil((size - w.length) / 2);
    return (" ".repeat(left) + w).padEnd(size, " ");
  };
  const names = (cfg.HOSTS || []).map((h) => String(h).toUpperCase()).filter((h) => h && h !== word && h.length <= size);
  const words = [...names.map(pad), word];

  const show = (tile, ch) => {
    tile.replaceChildren(el("b", { class: "flip", text: ch.trim() ? ch : "" }));
    tile.classList.toggle("blank", !ch.trim());
  };
  // 一片翻牌：先翻過幾個亂數字母，再停在目標字
  async function flipTo(tile, ch, spins) {
    for (let k = 0; k < spins; k++) {
      show(tile, FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)]);
      await wait(55);
    }
    show(tile, ch);
  }

  let running = false;
  async function play() {
    if (running || reduceMotion() || navigator.webdriver) return;
    running = true;
    try {
      for (let w = 0; w < words.length; w++) {
        const last = w === words.length - 1;
        await Promise.all(tiles.map(async (tile, i) => {
          await wait(i * 70);
          await flipTo(tile, words[w][i], last ? 3 + i * 2 : 2 + i);
          if (last) {
            tile.classList.add("settle");
            setTimeout(() => tile.classList.remove("settle"), 500);
          }
        }));
        if (!last) await wait(520); // 每個名字停一下讓人看清楚
      }
    } finally {
      running = false;
    }
  }
  const brand = mark.closest("a") || mark;
  brand.addEventListener("mouseenter", play);
  brand.addEventListener("focus", play);
  return play;
}
const flaps = [...document.querySelectorAll(".mark")].map(splitFlap).filter(Boolean);
// 字型載入後再翻，避免字寬跳動
(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => flaps.forEach((play) => play()));
