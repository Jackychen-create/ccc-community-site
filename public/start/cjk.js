// 中文換行：只在詞和詞之間換行，數字和單位不拆開，標點不放行首，最後一兩個字不單獨掉到下一行
// 跟研究員專區 public/assets/js/core/cjk.js 同一套規則；這一頁是靜態的，打開時處理一次，
// 而且裡面有 <strong>、<a> 的段落也處理（一個一個文字節點切）
(function () {
  if (typeof Intl === "undefined" || !Intl.Segmenter) return;
  var seg = new Intl.Segmenter("zh-Hant", { granularity: "word" });
  var NO_BEFORE = /^[，。、：；！？）」』】〉》,.:;!?)\]%…—・·～]/;
  var NO_AFTER = /[（「『【〈《(\[]$/;
  var IS_NUM = /^[\d.,:+\-−\/]+$/;
  var HAN = /[㐀-鿿]/;
  var KEEP = /(實驗室研究員|實驗室密碼|留檔|達標|解鎖|一對一|實驗室助教|研究員專區|研究員大廳|培訓計畫|身分組|交易所|交易量|系統分享|直播留檔|直播精華|每日回顧|客服單|身分驗證)/;
  var seen = new WeakSet(); // 切過的文字節點不再切（外層 li 跟裡面的 p 都會被選到）

  function splitText(node, isLast) {
    var text = node.nodeValue;
    if (seen.has(node) || !HAN.test(text)) return;
    var segs = [];
    // 社群自己的詞（斷詞器不認得）整個當一個詞，不從中間斷
    text.split(KEEP).forEach(function (part, k) {
      if (!part) return;
      if (k % 2) { segs.push(part); return; }
      for (var it = seg.segment(part)[Symbol.iterator](), s = it.next(); !s.done; s = it.next()) segs.push(s.value.segment);
    });
    var tail = segs.length - 1;
    while (tail > 0 && NO_BEFORE.test(segs[tail])) tail--;
    var frag = document.createDocumentFragment(), buf = "";
    segs.forEach(function (cur, i) {
      if (i > 0) {
        var prev = segs[i - 1];
        var ok = !NO_BEFORE.test(cur) && !NO_AFTER.test(prev) &&
          !(IS_NUM.test(prev) && !/^\s/.test(cur)) &&
          !(isLast && i === tail && cur.trim().length <= 2) &&
          !/\s$/.test(prev) && !/^\s/.test(cur);
        if (ok) { var t = document.createTextNode(buf); seen.add(t); frag.appendChild(t); frag.appendChild(document.createElement("wbr")); buf = ""; }
      }
      buf += cur;
    });
    var last = document.createTextNode(buf); seen.add(last); frag.appendChild(last);
    node.parentNode.replaceChild(frag, node);
  }

  function run() {
    var els = document.querySelectorAll("h1, h2, h3, .lead, .intro, main p, main li, summary, .tr > span, .disclaimer, .board span");
    [].forEach.call(els, function (el) {
      if (el.dataset.cjk) return;
      el.dataset.cjk = "1";
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) { return n.parentNode.closest("code, .num") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
      });
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(function (n, i) { splitText(n, i === nodes.length - 1); });
      el.classList.add("cjk");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
