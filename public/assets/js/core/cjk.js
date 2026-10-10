// 中文換行：只在詞和詞之間換行，數字和單位不拆開，最後一兩個字不單獨掉到下一行
// 載入就開始運作（監看畫面變化）
const CJK_SEL = ".vtitle, .vdesc, .desc, h1, h2, .intro, .notice span, .t-title, .t-sub, .page-head p, .whatsnew li, .auth-foot";
const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("zh-Hant", { granularity: "word" }) : null;
const done = new WeakMap();
const NO_BREAK_BEFORE = /^[，。、：；！？）」』】〉》,.:;!?)\]%…—・·]/;
const NO_BREAK_AFTER = /[（「『【〈《(\[]$/;
const IS_NUM = /^[\d.,:+\-−]+$/;
function cjkify(node) {
  if (!segmenter || done.get(node) === node.textContent) return;
  // 只處理純文字的元素（避免動到裡面的按鈕或圖示）
  if (node.children.length && [...node.childNodes].some((c) => c.nodeType === 1 && c.tagName !== "WBR")) return;
  const text = node.textContent;
  if (!/[㐀-鿿]/.test(text)) {
    done.set(node, text);
    return;
  }
  const segs = [...segmenter.segment(text)].map((s) => s.segment);
  // 最後一個詞（扣掉標點）只有一兩個字時，跟前一個詞黏在一起
  let tail = segs.length - 1;
  while (tail > 0 && NO_BREAK_BEFORE.test(segs[tail])) tail--;
  const frag = document.createDocumentFragment();
  let buf = "";
  segs.forEach((seg, i) => {
    if (i > 0) {
      const prev = segs[i - 1];
      const allow =
        !NO_BREAK_BEFORE.test(seg) && !NO_BREAK_AFTER.test(prev) &&
        !(IS_NUM.test(prev) && !/^\s/.test(seg)) &&
        !(i === tail && seg.trim().length <= 2) &&
        !/\s$/.test(prev) && !/^\s/.test(seg);
      if (allow) {
        frag.append(buf, document.createElement("wbr"));
        buf = "";
      }
    }
    buf += seg;
  });
  frag.append(buf);
  node.replaceChildren(frag);
  node.classList.add("cjk");
  done.set(node, node.textContent);
}
let cjkQueued = false;
function cjkScan() {
  cjkQueued = false;
  document.querySelectorAll(CJK_SEL).forEach(cjkify);
}
if (segmenter) {
  new MutationObserver(() => {
    if (!cjkQueued) {
      cjkQueued = true;
      requestAnimationFrame(cjkScan);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener("DOMContentLoaded", cjkScan);
}
