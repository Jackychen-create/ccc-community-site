// 很小的 RSS／Atom 讀取器：拿標題、連結、時間、摘要（不靠任何套件）
const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
};

export function parseFeed(xml, source = "") {
  const out = [];
  const items = String(xml || "").match(/<item[\s>][\s\S]*?<\/item>/gi) || String(xml || "").match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const it of items) {
    let link = decode(tag(it, "link"));
    if (!link) { const m = it.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ""; }
    const when = decode(tag(it, "pubDate") || tag(it, "published") || tag(it, "updated") || tag(it, "dc:date"));
    const ms = Date.parse(when);
    out.push({
      title: decode(tag(it, "title")),
      link: link.trim(),
      ms: Number.isFinite(ms) ? ms : null,
      summary: decode(tag(it, "description") || tag(it, "summary") || tag(it, "content")).slice(0, 400),
      id: decode(tag(it, "guid") || tag(it, "id")) || link.trim(),
      source,
    });
  }
  return out.filter((x) => x.title && x.link);
}
