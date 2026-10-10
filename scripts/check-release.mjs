// 發布前檢查：npm run check
// 1. 每一則更新公告都要有版本號、日期、至少一條改動，而且版本號不能重複
// 2. 列出「上次上線之後」所有公告（released.json 記上次上線的版本），寫到 docs_tmp/RELEASE_NOTES_PENDING.md 讓你對照
// 版本號不比大小，用 changelog.json 的排列順序（最上面＝最新）
import fs from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const log = JSON.parse(fs.readFileSync(path.join(root, "public/changelog.json"), "utf8"));
const released = JSON.parse(fs.readFileSync(path.join(root, "released.json"), "utf8")).version;

const problems = [];
const seen = new Set();
for (const [i, c] of log.entries()) {
  if (!c.version) problems.push(`第 ${i + 1} 則沒有版本號`);
  if (seen.has(c.version)) problems.push(`版本 ${c.version} 重複了`);
  seen.add(c.version);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date || "")) problems.push(`版本 ${c.version} 的日期格式不對（要 YYYY-MM-DD）`);
  if (!Array.isArray(c.items) || !c.items.length || c.items.some((t) => !String(t).trim())) problems.push(`版本 ${c.version} 沒有寫改了什麼`);
}
const idx = log.findIndex((c) => c.version === released);
if (idx === -1) problems.push(`released.json 的 ${released} 不在 changelog.json 裡`);

const pending = idx === -1 ? [] : log.slice(0, idx);
const lines = [`# 這次要發布的更新公告`, ``, `上次上線：v${released}`, `這次最新：v${log[0]?.version}`, ``];
for (const c of pending) lines.push(`## v${c.version}（${c.date}）`, ...c.items.map((t) => `- ${t}`), ``);
fs.mkdirSync(path.join(root, "docs_tmp"), { recursive: true });
fs.writeFileSync(path.join(root, "docs_tmp/RELEASE_NOTES_PENDING.md"), lines.join("\n"));

if (problems.length) {
  console.error("✗ 更新公告有問題：\n  " + problems.join("\n  "));
  process.exit(1);
}
if (!pending.length) console.log(`目前版本 v${log[0].version} 已經上線過了；這次有使用者看得到的改動的話，記得在 changelog.json 最上面加一則。`);
else console.log(`release notes cover ${pending.length} 個版本、${pending.reduce((a, c) => a + c.items.length, 0)} 條改動（v${released} 之後）。完整清單：docs_tmp/RELEASE_NOTES_PENDING.md`);
