// 介紹頁（public/start/index.html）標題用的襯線字 Noto Serif TC 只載標題用到的字（Google Fonts 的 &text=）
// node scripts/intro-fonts.mjs          把標題、品牌名用到的字重新算一次，寫回 index.html
// node scripts/intro-fonts.mjs --check  只檢查：有標題用到、但沒載的字就失敗（npm run check 會跑）
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../public/start/index.html", import.meta.url);
const EXTRA = "CCC°交易實驗室研究員在聊什麼X勇於碰撞，才擁卓越"; // 首屏標語（不是 h1/h2，要手動加） // 品牌名、JS 才放進去的標題
const html = readFileSync(FILE, "utf8");
const heads = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)].map((m) => m[1].replace(/<[^>]+>/g, "")).join("");
const want = [...new Set([...(heads + EXTRA)].filter((c) => c.trim()))].sort().join("");
const re = /(family=Noto\+Serif\+TC[^"]*&text=)([^"]*)"/;
const m = html.match(re);
if (!m) { console.error("intro-fonts：找不到 Noto Serif TC 的 &text= 連結"); process.exit(1); }
const have = decodeURIComponent(m[2]);
const missing = [...want].filter((c) => !have.includes(c));
if (process.argv.includes("--check")) {
  if (missing.length) { console.error(`intro-fonts：介紹頁標題有字沒載到襯線字：${missing.join("")}（跑 node scripts/intro-fonts.mjs 更新）`); process.exit(1); }
  console.log("intro-fonts：介紹頁標題字型 OK");
} else {
  writeFileSync(FILE, html.replace(re, `$1${encodeURIComponent(want)}"`));
  console.log(`intro-fonts：已更新，${want.length} 個字`);
}
