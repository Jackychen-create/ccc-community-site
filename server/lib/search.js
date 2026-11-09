// 直播留檔搜尋＋AI 重點對時間
// 逐字稿（video_highlights.chunks）合成大約 20 秒一行；搜尋就是找有這個字的那幾行
export function linesOf(chunks) {
  const segs = Object.keys(chunks || {}).map(Number).sort((a, b) => a - b).flatMap((k) => chunks[k] || []);
  const lines = [];
  let cur = null;
  for (const x of segs) {
    if (cur && x.s - cur.s < 20 && cur.t.length < 160) { cur.t += (/[\p{L}\p{N}]$/u.test(cur.t) ? "，" : "") + x.t; continue; }
    if (cur) lines.push(cur);
    cur = { s: x.s, t: x.t };
  }
  if (cur) lines.push(cur);
  return lines;
}

export const cleanQuery = (q) => String(q ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
// 給資料庫 ilike 用：% _ \ 要跳脫
export const likeEscape = (q) => q.replace(/[\\%_]/g, (c) => "\\" + c);

// 一行裡面關鍵字附近的一段（前後各 24 字）
export function snippet(text, q, pad = 24) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, pad * 2);
  const a = Math.max(0, i - pad), b = Math.min(text.length, i + q.length + pad);
  return (a ? "…" : "") + text.slice(a, b) + (b < text.length ? "…" : "");
}

// 一支影片裡找關鍵字：逐字稿的行（最多 max 個）
export function hitsIn(chunks, q, max = 5) {
  const ql = q.toLowerCase();
  const out = [];
  for (const l of linesOf(chunks)) {
    if (!l.t.toLowerCase().includes(ql)) continue;
    out.push({ t: Math.max(0, Math.floor(l.s)), text: snippet(l.t, q) });
    if (out.length >= max) break;
  }
  return out;
}

// 標題、簡介、章節、AI 摘要和重點也一起找（系統分享沒有逐字稿也找得到）
export function metaHits(v, h, q) {
  const ql = q.toLowerCase();
  const has = (s) => String(s || "").toLowerCase().includes(ql);
  const out = [];
  for (const c of [...(v.chapters || []), ...(h?.chapters || [])]) if (has(c.title) && !out.some((x) => x.t === c.t)) out.push({ t: c.t, text: `章節：${c.title}` });
  (h?.points || []).forEach((p, i) => { if (has(p)) out.push({ t: h.point_times?.[i] ?? null, text: `重點：${p}` }); });
  return { title: has(v.title), desc: has(v.description) || has(h?.summary), hits: out };
}

// ── AI 重點對到逐字稿的時間：兩個字一組（中文沒有空格），重疊最多的那一行 ──
const grams = (s) => {
  const t = String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const g = new Set();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
};
export function matchTime(point, lines) {
  const pg = grams(point);
  if (pg.size < 3 || !lines.length) return null;
  let best = null, bestScore = 0;
  // 跟前後一行合起來比，重點常常橫跨兩行
  const own = lines.map((l) => grams(l.t));
  const hit = (g) => { let n = 0; for (const x of pg) if (g.has(x)) n++; return n / pg.size; };
  for (let i = 0; i < lines.length; i++) {
    // 自己這一行為主；跟下一行合起來的打九折（不然上一行會搶走下一行的分數）
    const score = Math.max(hit(own[i]), 0.9 * hit(grams(lines[i].t + (lines[i + 1]?.t || ""))));
    if (score > bestScore) { bestScore = score; best = lines[i]; }
  }
  return best && bestScore >= 0.3 ? Math.max(0, Math.floor(best.s)) : null;
}
// AI 給的時間（可能沒有、可能亂給）＋逐字稿比對；AI 給的跟比對差太多時用比對的
export function pointTimesOf(points, chunks, aiTimes = [], duration = 0) {
  const lines = linesOf(chunks);
  return (points || []).map((p, i) => {
    const ai = Number.isFinite(aiTimes[i]) && aiTimes[i] >= 0 && (!duration || aiTimes[i] < duration) ? Math.floor(aiTimes[i]) : null;
    const m = matchTime(p, lines);
    if (ai !== null && (m === null || Math.abs(ai - m) < 180)) return ai;
    return m;
  });
}
