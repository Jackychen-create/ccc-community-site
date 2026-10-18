// 遊戲感：等級徽章（銅／銀／金盾牌）、升級畫面（翻牌換等級、經驗條、解鎖獎勵一個一個出來）
// 翻牌沿用左上角 CCC 的招牌動作（DESIGN.md「招牌動作」）；減少動態效果時直接顯示結果
import { el, reduceMotion } from "../core/index.js";
import { TIERS, MAX_TIER, tierName, tierInfo, gapTo } from "../shared/rules.js";

const NUM = "零一二三";
const RANK = { 0: "rank0", 1: "rank1", 2: "rank2", 3: "rank3" };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 等級徽章：盾牌＋中文數字。size 是像素
export function emblem(tier, size = 28, label = true) {
  const t = Math.max(0, Math.min(MAX_TIER, tier || 0));
  const svg = `<svg viewBox="0 0 32 36" width="${size}" height="${Math.round(size * 1.125)}" aria-hidden="true">`
    + `<path class="em-body" d="M16 1.5 29.5 6v11.2c0 8.3-5.7 14.6-13.5 17.3C8.2 31.8 2.5 25.5 2.5 17.2V6Z"/>`
    + `<path class="em-shine" d="M16 4.6 26.6 8.2v8.9c0 6.6-4.4 11.6-10.6 13.9Z"/>`
    + `<text x="16" y="22.5" text-anchor="middle" class="em-num">${t ? NUM[t] : "–"}</text></svg>`;
  return el("span", { class: `emblem ${RANK[t]}`, role: label ? "img" : null, "aria-label": label ? tierName(t) : null, html: svg });
}

// 翻牌：三片牌從舊等級翻到新等級（第一級 → 第二級，中間那片翻過幾個字）
function flapWord(from, to) {
  const tiles = [...from].map((ch) => el("span", { class: "flap lvl-flap", "aria-hidden": "true" }, el("b", { text: ch })));
  const box = el("span", { class: "lvl-flaps", role: "img", "aria-label": to }, ...tiles);
  // 翻完會標 data-done（沒有動畫就一開始就標）
  if (from === to) box.dataset.done = "1";
  const play = async () => {
    const spin = "零一二三四五六七八九";
    await Promise.all(tiles.map(async (tile, i) => {
      const target = to[i];
      if (from[i] === target) return;
      await wait(i * 90);
      for (let k = 0; k < 6 + i * 2; k++) {
        tile.replaceChildren(el("b", { class: "flip", text: spin[Math.floor(Math.random() * spin.length)] }));
        await wait(70);
      }
      tile.replaceChildren(el("b", { class: "flip", text: target }));
      tile.classList.add("settle");
    }));
    box.dataset.done = "1";
  };
  return { box, play, tiles };
}

// 升級畫面。level：升到第幾級；amounts：這一輪交易量；until：至少到哪天；onClose：關掉後
export function levelUp({ level, prev = level - 1, amounts = {}, exchanges, until, oneOnOne = false, onClose }) {
  const motion = !reduceMotion();
  const toName = tierName(level);
  // 從上一級翻過來；沒有上一級就從「第零級」翻
  const fromName = prev > 0 ? tierName(prev) : "第零級";
  const flaps = flapWord(motion ? fromName : toName, toName);
  const perks = TIERS.filter((t) => t.tier === level).flatMap((t) => t.perks);
  const next = level < MAX_TIER ? level + 1 : null;
  const close = el("button", { class: "btn primary lg", type: "button", text: "繼續" });
  const sparks = el("div", { class: "lvl-sparks", "aria-hidden": "true" },
    ...Array.from({ length: 18 }, (_, i) => el("i", { style: { "--a": `${(360 / 18) * i + Math.random() * 12}deg`, "--d": `${90 + Math.random() * 90}px`, "--s": `${4 + Math.random() * 5}px`, "--t": `${Math.random() * 0.25}s` } })));
  const bar = el("div", { class: "lvl-xp" }, el("i"));
  const list = el("ul", { class: "lvl-perks" }, ...perks.map((p) => el("li", null, el("span", { class: "lvl-check", "aria-hidden": "true", text: "✓" }), p)),
    oneOnOne ? el("li", null, el("span", { class: "lvl-check", "aria-hidden": "true", text: "✓" }), "右邊「一對一交流」選這個月的講師") : null);
  const back = el("div", { class: "lvl-back" + (motion ? " anim" : ""), role: "dialog", "aria-modal": "true", "aria-label": `升上${toName}` },
    el("div", { class: "lvl-card" },
      sparks,
      el("div", { class: "lvl-kicker num", text: "LEVEL UP" }),
      el("div", { class: "lvl-emblem" }, emblem(level, 92)),
      el("h2", { class: "lvl-title" }, "升上", flaps.box),
      bar,
      el("div", { class: "small muted lvl-sub", text: until ? `至少到 ${until.slice(5).replace("-", "/")}` : "" }),
      el("div", { class: "lvl-unlock small", text: "解鎖" }),
      list,
      next ? el("p", { class: "small lvl-next", text: `下一級：${tierName(next)}${gapTo(amounts, next, exchanges)}（${tierInfo(next).perks[0]}）` }) : el("p", { class: "small lvl-next", text: "已經是最高級 🏆" }),
      close));
  const done = () => {
    back.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === "Escape") done(); };
  close.addEventListener("click", done);
  document.addEventListener("keydown", onKey);
  document.body.append(back);
  close.focus();
  if (motion) setTimeout(() => flaps.play(), 450);
  return { close: done, el: back };
}

// 頁首頭像外圈：照等級變色（銅／銀／金）
export function rankRing(avatar, tier) {
  if (!avatar) return;
  avatar.classList.remove("rank0", "rank1", "rank2", "rank3");
  if (tier !== null && tier !== undefined) avatar.classList.add(RANK[Math.max(0, Math.min(MAX_TIER, tier))]);
  if (tier !== null && tier !== undefined) avatar.title = tierName(tier);
}
