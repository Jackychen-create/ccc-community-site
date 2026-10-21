// 研究員等級卡：升級後可以「下載卡片圖」（存成 PNG 分享到 IG、LINE）或「分享到 Discord」（伺服器貼到升級慶祝頻道）
// 卡片上不放真實姓名、交易量，只放等級、解鎖什麼、日期（隱私）
import { TIERS, tierName } from "../shared/rules.js";

export const RANK_COLOR = { 0: "#86938D", 1: "#B9784A", 2: "#B9C4CB", 3: "#CDA45E" };
const BG = "#0F1412", SURFACE = "#19221E", INK = "#DDE3E0", INK2 = "#A6B2AD", AMBER = "#CDA45E";
const FONT = '"Noto Sans TC", system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';
const NUM = "零一二三";

// 兩個顏色混合（跟 CSS color-mix 一樣）：p 是第一個顏色的比例
export function mix(a, b, p) {
  const h = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const [x, y] = [h(a), h(b)];
  return "#" + x.map((v, i) => Math.round(v * p + y[i] * (1 - p)).toString(16).padStart(2, "0")).join("");
}
// 等級徽章（獨立的 SVG，顏色寫死，畫到 canvas、做成 PNG 都用這個）
export function emblemSvg(tier, size = 256) {
  const rk = RANK_COLOR[tier] || RANK_COLOR[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 36" width="${size}" height="${Math.round(size * 1.125)}">`
    + `<path d="M16 1.5 29.5 6v11.2c0 8.3-5.7 14.6-13.5 17.3C8.2 31.8 2.5 25.5 2.5 17.2V6Z" fill="${mix(rk, SURFACE, 0.22)}" stroke="${rk}" stroke-width="2"/>`
    + `<path d="M16 4.6 26.6 8.2v8.9c0 6.6-4.4 11.6-10.6 13.9Z" fill="${rk}" fill-opacity="0.16"/>`
    + `<text x="16" y="22.5" text-anchor="middle" fill="${rk}" font-family='${FONT.replace(/"/g, "")}' font-weight="700" font-size="13">${tier ? NUM[tier] : "–"}</text></svg>`;
}

const loadImg = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
function wrap(ctx, text, maxW) {
  const out = [];
  let line = "";
  for (const ch of String(text)) {
    if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch;
  }
  if (line) out.push(line);
  return out;
}

// 畫一張 1080×1350 的卡片（IG 直式），回傳 canvas
export async function drawLevelCard({ level, date = new Date() }) {
  const W = 1080, H = 1350;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const rk = RANK_COLOR[level] || AMBER;
  // 背景：深色＋等級色的光暈＋細格線（報價看板的感覺）
  g.fillStyle = BG; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, 470, 40, W / 2, 470, 620);
  glow.addColorStop(0, mix(rk, BG, 0.28)); glow.addColorStop(1, BG);
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(221,227,224,0.045)"; g.lineWidth = 1;
  for (let x = 60; x < W; x += 60) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 60; y < H; y += 60) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = mix(rk, BG, 0.55); g.lineWidth = 3; g.strokeRect(36, 36, W - 72, H - 72);

  try { if (document.fonts?.ready) await document.fonts.ready; } catch { /* 沒有也沒關係 */ }
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  g.fillStyle = INK2; g.font = `600 34px ${FONT}`;
  g.fillText("CCC 交易實驗室", W / 2, 128);
  g.fillStyle = rk; g.font = `800 40px ${FONT}`;
  g.fillText("L E V E L   U P", W / 2, 196);

  const img = await loadImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(emblemSvg(level, 360)));
  g.drawImage(img, (W - 360) / 2, 250, 360, 405);

  g.fillStyle = INK; g.font = `900 92px ${FONT}`;
  g.fillText(`升上${tierName(level)}`, W / 2, 790);
  g.fillStyle = INK2; g.font = `500 38px ${FONT}`;
  g.fillText("實驗室研究員", W / 2, 852);

  // 解鎖什麼
  const perks = TIERS.filter((t) => t.tier === level).flatMap((t) => t.perks).slice(0, 3);
  g.textAlign = "left"; g.font = `500 36px ${FONT}`;
  let y = 960;
  for (const p of perks) {
    for (const [i, line] of wrap(g, p, 760).slice(0, 2).entries()) {
      if (i === 0) { g.fillStyle = rk; g.fillText("✓", 150, y); }
      g.fillStyle = INK; g.fillText(line, 205, y);
      y += 52;
    }
    y += 10;
  }
  g.textAlign = "center"; g.fillStyle = INK2; g.font = `500 30px ${FONT}`;
  const d = new Date(date);
  g.fillText(`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}・實驗室培訓計畫`, W / 2, H - 96);
  return c;
}

export async function downloadLevelCard(level) {
  const c = await drawLevelCard({ level });
  const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: `ccc_lab_level${level}.png` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
