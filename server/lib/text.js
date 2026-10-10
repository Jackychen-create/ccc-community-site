// 整理使用者送來的文字、數字、日期、標題、章節
// 標題開頭的「10/9 直播：」拿掉（列表已經有日期欄）；拿掉後是空的就保留原樣
export function cleanTitle(v) {
  const t = cleanText(v, 120);
  if (!t) return t;
  const stripped = t.replace(/^\s*\d{1,2}\s*[\/.\-]\s*\d{1,2}\s*(?:(?:直播|live)\s*)?(?:[：:\-–—|｜]\s*|\s+(?=\S))/i, "").trim();
  return stripped && stripped !== t ? stripped : t;
}

// 章節：[{t: 秒, title}]，依時間排序、最多 60 個、同一秒只留一個
export function cleanChapters(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const c of v) {
    const t = Math.floor(Number(c?.t));
    const title = cleanText(c?.title, 60);
    if (!Number.isFinite(t) || t < 0 || t > 24 * 3600 || !title || seen.has(t)) continue;
    seen.add(t);
    out.push({ t, title });
    if (out.length >= 60) break;
  }
  return out.sort((a, b) => a.t - b.t);
}

export function toInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export function cleanText(v, max = 500) {
  if (v === undefined || v === null) return null;
  return String(v).trim().slice(0, max);
}

export function isDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
}
