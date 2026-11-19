// 交易所分頁、目前在哪一段（頁首底線）、品牌翻牌
(function () {
  // 交易所分頁：網址帶 #okx / #bybit / #bingx 會直接打開那一間
  var tabs = [].slice.call(document.querySelectorAll('[role="tab"]'));
  function pick(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { pick(t); });
    t.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); pick(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  var want = { "#okx": "t-okx", "#bybit": "t-bybit", "#bingx": "t-bingx" }[location.hash.toLowerCase()];
  if (want) { pick(document.getElementById(want)); document.getElementById("exchanges").scrollIntoView(); }
  else if (tabs[0]) pick(tabs[0]);

  // 卡片的光：游標在卡片上哪裡，那裡亮一點（只有滑鼠）
  var glare = [].slice.call(document.querySelectorAll(".steps li, .host, .card, .ex, .calc, .tier-table"));
  glare.forEach(function (el) {
    el.classList.add("glare");
    el.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      var r = el.getBoundingClientRect();
      el.style.setProperty("--mx", (e.clientX - r.left) + "px");
      el.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });

  // 頁首：捲到哪一段就在那個連結下面畫底線
  var links = [].slice.call(document.querySelectorAll(".nav a"));
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.setAttribute("aria-current", String(a.getAttribute("href") === "#" + e.target.id)); });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    links.forEach(function (a) { var s = document.querySelector(a.getAttribute("href")); if (s) io.observe(s); });
  }

  // ── 交易量試算：門檻跟研究員專區 public/assets/js/shared/rules.js 的 TIERS 一樣 ──
  var TIERS = [10000, 200000, 1500000];
  var NAMES = ["第一級", "第二級", "第三級"];
  var form = document.getElementById("calc");
  if (form) {
    var $ = function (id) { return document.getElementById(id); };
    var fmt = function (n) {
      if (n >= 10000) return (Math.round(n / 1000) / 10).toLocaleString("zh-TW") + " 萬 USDT";
      return Math.round(n).toLocaleString("zh-TW") + " USDT";
    };
    var calc = function () {
      var unitMode = document.documentElement.dataset.mode === "unit";
      var size = Math.max(0, +$("cSize").value || 0), n = Math.max(0, +$("cTrades").value || 0), d = Math.min(31, Math.max(0, +$("cDays").value || 0));
      var vol = size * n * d * 2;
      if (unitMode) { // 單位制：累計每 20 萬一份，六份 120 萬，一對一 100 萬
        var o = $("calcOut"); o.replaceChildren();
        var b = document.createElement("span"); b.className = "calc-vol num"; b.textContent = fmt(vol);
        var l = document.createElement("span"); l.className = "calc-lv" + (vol >= 200000 ? " on" : "");
        var per = vol / 200000;
        l.textContent = vol > 0 ? (per >= 1 ? "一個月大約解鎖 " + (Math.floor(per * 10) / 10) + " 份" : "大約 " + Math.ceil(1 / per) + " 個月解鎖第 1 份") : "還沒有交易量";
        var h = document.createElement("span"); h.className = "calc-hint";
        h.textContent = vol > 0 ? "六份全開大約 " + Math.ceil(1200000 / vol) + " 個月，一對一大約 " + Math.ceil(1000000 / vol) + " 個月" : "";
        o.append(b, l, h);
        return;
      }
      var lv = -1;
      TIERS.forEach(function (x, i) { if (vol >= x) lv = i; });
      var next = TIERS[lv + 1];
      var out = $("calcOut");
      out.replaceChildren();
      var big = document.createElement("span"); big.className = "calc-vol num"; big.textContent = fmt(vol);
      var lvl = document.createElement("span"); lvl.className = "calc-lv" + (lv >= 0 ? " on" : "");
      lvl.textContent = lv >= 0 ? "一個月大約到「" + NAMES[lv] + "」" : "還不到第一級";
      var hint = document.createElement("span"); hint.className = "calc-hint";
      hint.textContent = next ? "離" + NAMES[lv + 1] + "還差 " + fmt(next - vol) : "已經是最高級";
      out.append(big, lvl, hint);
    };
    form.addEventListener("input", calc);
    calc();
    window.__recalc = calc;
  }

  // ── 會員制度：研究員專區後台設定的日期一到，換成單位制的說明（拿不到就照舊）──
  var SITE0 = "https://ccc-community-site.pages.dev";
  if (window.fetch) {
    fetch(SITE0 + "/api/public-membership").then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.on) return;
      document.documentElement.dataset.mode = "unit";
      [].forEach.call(document.querySelectorAll("[data-unit]"), function (e) { e.hidden = false; });
      [].forEach.call(document.querySelectorAll("[data-tier]"), function (e) { e.hidden = true; });
      if (window.__recalc) window.__recalc();
    }).catch(function () {});
  }

  // ── 行情（研究員專區的 /api/public-market：Bybit 現貨、恐慌貪婪指數），每分鐘更新；拿不到就整段不顯示 ──
  var mkt = document.getElementById("market");
  if (mkt && window.fetch) {
    var NS = "http://www.w3.org/2000/svg";
    var last = {};
    var svgEl = function (tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; };
    var fmtPx = function (n) {
      var d = n >= 1000 ? 1 : n >= 10 ? 2 : 4;
      return n.toLocaleString("en-US", { minimumFractionDigits: n >= 1000 ? 1 : 2, maximumFractionDigits: d });
    };
    var spark = function (pts) {
      var s = svgEl("svg", { viewBox: "0 0 100 34", preserveAspectRatio: "none", "aria-hidden": "true" });
      if (!pts || pts.length < 2) return s;
      var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), span = hi - lo || 1;
      var xy = pts.map(function (v, i) { return [(i / (pts.length - 1)) * 100, 31 - ((v - lo) / span) * 28]; });
      var d = xy.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(2) + " " + p[1].toFixed(2); }).join(" ");
      s.appendChild(svgEl("path", { class: "ar", d: d + " L100 34 L0 34 Z" }));
      s.appendChild(svgEl("path", { class: "ln", d: d, "vector-effect": "non-scaling-stroke" }));
      var lp = xy[xy.length - 1];
      s.appendChild(svgEl("circle", { class: "dot", cx: lp[0], cy: lp[1] }));
      return s;
    };
    var gauge = function (v) {
      var s = svgEl("svg", { viewBox: "0 0 100 56", "aria-hidden": "true" });
      var arc = "M8 50 A42 42 0 0 1 92 50";
      s.appendChild(svgEl("path", { class: "trk", d: arc }));
      var len = Math.PI * 42, col = v < 25 ? "#6BB592" : v < 45 ? "#9CC08A" : v < 55 ? "#CDA45E" : v < 75 ? "#D9946C" : "#D9776C";
      var p = svgEl("path", { class: "val", d: arc, stroke: col, "stroke-dasharray": (len * v / 100).toFixed(1) + " " + len.toFixed(1) });
      p.style.color = col;
      s.appendChild(p);
      return s;
    };
    var FNG_ZH = { "Extreme Fear": "極度恐慌", Fear: "恐慌", Neutral: "中性", Greed: "貪婪", "Extreme Greed": "極度貪婪" };
    var defs = function () {
      var s = svgEl("svg", { width: 0, height: 0, style: "position:absolute" });
      var d = svgEl("defs", {});
      [["gUp", "#D9776C"], ["gDn", "#6BB592"]].forEach(function (g) {
        var lg = svgEl("linearGradient", { id: g[0], x1: 0, y1: 0, x2: 0, y2: 1 });
        lg.appendChild(svgEl("stop", { offset: "0", "stop-color": g[1] }));
        lg.appendChild(svgEl("stop", { offset: "1", "stop-color": g[1], "stop-opacity": "0" }));
        d.appendChild(lg);
      });
      s.appendChild(d);
      return s;
    };
    var draw = function (d) {
      var items = (d && d.items) || [];
      if (!items.length) return;
      var list = document.getElementById("mktList");
      list.replaceChildren(defs());
      list.style.setProperty("--n", items.length);
      items.forEach(function (x) {
        var up = x.chg24 >= 0;
        var c = document.createElement("div"); c.className = "tk " + (up ? "up" : "dn");
        var nm = document.createElement("span"); nm.className = "tk-name"; nm.textContent = x.name;
        if (x.note) { var sm = document.createElement("small"); sm.textContent = x.note; nm.appendChild(sm); }
        var ch = document.createElement("span"); ch.className = "tk-chg"; ch.textContent = (up ? "▲ " : "▼ ") + Math.abs(x.chg24).toFixed(2) + "%";
        var px = document.createElement("span"); px.className = "tk-px"; px.textContent = fmtPx(x.price);
        if (last[x.name] && last[x.name] !== x.price) { px.classList.add(x.price > last[x.name] ? "flash-up" : "flash-dn"); setTimeout(function () { px.className = "tk-px"; }, 900); }
        last[x.name] = x.price;
        var rg = document.createElement("span"); rg.className = "tk-rng"; rg.textContent = "24h " + fmtPx(x.low24) + " – " + fmtPx(x.high24);
        c.setAttribute("aria-label", x.name + " " + fmtPx(x.price) + " USDT，24 小時" + (up ? "漲" : "跌") + Math.abs(x.chg24).toFixed(2) + "%");
        c.append(nm, ch, px, spark(x.spark), rg);
        list.appendChild(c);
      });
      if (d.fng) {
        var f = document.createElement("div"); f.className = "fng";
        var t = document.createElement("span"); t.className = "fng-t"; t.textContent = "恐慌貪婪指數";
        var b = document.createElement("b"); b.className = "num"; b.textContent = d.fng.value;
        var l = document.createElement("span"); l.textContent = FNG_ZH[d.fng.label] || d.fng.label;
        f.append(t, gauge(d.fng.value), b, l);
        list.appendChild(f);
      }
      var tm = new Date(d.at);
      var meta = document.getElementById("mktMeta");
      meta.replaceChildren();
      var dot = document.createElement("i"); dot.className = "live"; dot.setAttribute("aria-hidden", "true");
      meta.append(dot, "Bybit 現貨・" + String(tm.getHours()).padStart(2, "0") + ":" + String(tm.getMinutes()).padStart(2, "0") + " 更新・不構成投資建議");
      mkt.hidden = false;
    };
    var load = function () {
      fetch(SITE0 + "/api/public-market").then(function (r) { return r.ok ? r.json() : null; }).then(draw).catch(function () {});
    };
    load();
    setInterval(function () { if (!document.hidden) load(); }, 60000);
  }

  // ── 公開影片（研究員專區的 /api/public-video，不用登入）；拿不到就整段不顯示 ──
  var SITE = "https://ccc-community-site.pages.dev";
  var box = document.getElementById("vidList");
  if (box && window.fetch) {
    fetch(SITE + "/api/public-video").then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var vs = (d && d.videos) || [];
      if (!vs.length) return;
      vs.slice(0, 3).forEach(function (v) {
        var a = document.createElement("a");
        a.className = "vid"; a.href = SITE + "/watch?v=" + encodeURIComponent(v.id); a.target = "_blank"; a.rel = "noopener";
        var th = document.createElement("span"); th.className = "vid-th";
        if (v.thumb_url) { var img = document.createElement("img"); img.src = v.thumb_url; img.alt = ""; img.loading = "lazy"; th.appendChild(img); }
        var play = document.createElement("i"); play.className = "vid-play"; play.setAttribute("aria-hidden", "true"); th.appendChild(play);
        if (v.duration_sec) { var du = document.createElement("span"); du.className = "vid-du num"; var m = Math.floor(v.duration_sec / 60); du.textContent = m + ":" + String(v.duration_sec % 60).padStart(2, "0"); th.appendChild(du); }
        var t = document.createElement("span"); t.className = "vid-t"; t.textContent = v.title;
        a.append(th, t);
        box.appendChild(a);
      });
      document.getElementById("videos").hidden = false;
    }).catch(function () {});
  }

  // 品牌三片翻牌：打開時翻一次、滑過再翻
  var flap = document.querySelector(".top .flap");
  var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function go() { if (calm || !flap) return; flap.classList.remove("go"); void flap.offsetWidth; flap.classList.add("go"); }
  go();
  var brand = document.querySelector(".brand");
  if (brand) { brand.addEventListener("mouseenter", go); brand.addEventListener("focus", go); }
})();

// ── 首屏的交易所卡片（2026-11-19）：中間那張是選到的，左右兩張往內轉；下面的控制列跟著換、跟下面的註冊步驟分頁同步 ──
(function () {
  var orbit = document.getElementById("orbit");
  if (!orbit) return;
  var cards = [].slice.call(orbit.querySelectorAll(".oc"));
  var EX = {
    okx: { name: "OKX", code: "99357363", sub: "現貨・合約" },
    bybit: { name: "Bybit", code: "CCCX", sub: "現貨・合約・TradFi" },
    bingx: { name: "BingX", code: "GTUTWZ", sub: "現貨・合約・跟單" },
  };
  // 註冊連結只寫在下面的分頁裡（一個地方改就好）
  Object.keys(EX).forEach(function (k) { var a = document.querySelector("#p-" + k + " .ex-head a.btn"); if (a) EX[k].href = a.href; });
  var $ = function (id) { return document.getElementById(id); };
  var n = cards.length, idx = 0;
  var wide = function () { return window.matchMedia("(min-width: 761px)").matches; };

  function layout() {
    var w = cards[0].offsetWidth;
    cards.forEach(function (c, i) {
      var d = ((i - idx) % n + n + 1) % n - 1; // -1, 0, 1（繞一圈）
      var x = d * w * (wide() ? .98 : .9);
      var z = -Math.abs(d) * (wide() ? 170 : 120);
      c.style.transform = "translate3d(" + x + "px, " + (Math.abs(d) * 16) + "px, " + z + "px) rotateY(" + (-d * 26) + "deg)";
      c.style.zIndex = String(10 - Math.abs(d));
      c.setAttribute("aria-current", String(d === 0));
      c.tabIndex = d === 0 ? 0 : -1;
    });
  }
  function pick(i, fromTab) {
    idx = (i + n) % n;
    layout();
    var key = cards[idx].dataset.ex, ex = EX[key];
    $("dockName").textContent = ex.name;
    $("dockCode").textContent = "邀請碼 " + ex.code;
    $("dockSub").textContent = "・" + ex.sub;
    $("dockGo").href = $("dockPlay").href = ex.href || "#exchanges";
    $("dockGo").textContent = "用 CCC 連結註冊 " + ex.name;
    $("dockPlay").setAttribute("aria-label", "用 CCC 連結註冊 " + ex.name);
    $("dockLine").style.width = ((idx + 1) / n * 100) + "%";
    var art = cards[idx].querySelector(".oc-art");
    var th = $("dockThumb");
    th.className = "dock-thumb " + art.className.replace("oc-art", "").trim();
    th.replaceChildren(art.firstElementChild.cloneNode(true));
    if (!fromTab) { var t = document.getElementById("t-" + key); if (t && t.getAttribute("aria-selected") !== "true") t.click(); }
  }
  cards.forEach(function (c, i) {
    c.addEventListener("click", function () {
      if (i !== idx) return pick(i);
      document.getElementById("exchanges").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  });
  $("dockPrev").addEventListener("click", function () { pick(idx - 1); });
  $("dockNext").addEventListener("click", function () { pick(idx + 1); });
  orbit.addEventListener("keydown", function (e) {
    var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (d) { e.preventDefault(); pick(idx + d); cards[idx].focus(); }
  });
  // 手機：左右滑
  var sx = null;
  orbit.addEventListener("pointerdown", function (e) { sx = e.clientX; });
  orbit.addEventListener("pointerup", function (e) {
    if (sx === null) return;
    var dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 40) pick(idx + (dx < 0 ? 1 : -1));
  });
  // 複製邀請碼
  $("dockCopy").addEventListener("click", function () {
    var code = EX[cards[idx].dataset.ex].code, btn = this;
    var done = function () { btn.setAttribute("title", "已複製 " + code); btn.classList.add("ok"); setTimeout(function () { btn.classList.remove("ok"); btn.setAttribute("title", "複製邀請碼"); }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, function () {}); else done();
  });
  // 下面的分頁換了，上面也跟著換
  [].forEach.call(document.querySelectorAll('[role="tab"]'), function (t) {
    t.addEventListener("click", function () {
      var k = t.id.replace("t-", ""), i = cards.findIndex(function (c) { return c.dataset.ex === k; });
      if (i >= 0 && i !== idx) pick(i, true);
    });
  });
  var want = { "#okx": 0, "#bybit": 1, "#bingx": 2 }[location.hash.toLowerCase()];
  pick(want || 0, true);
  window.addEventListener("resize", layout);
})();

// 首屏中間那張卡片：滑鼠移動時微微傾斜（只有電腦、沒有減少動態效果）
(function () {
  var orbit = document.getElementById("orbit");
  if (!orbit || !window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var raf = 0;
  orbit.addEventListener("pointermove", function (e) {
    var c = orbit.querySelector('.oc[aria-current="true"]');
    if (!c) return;
    var r = c.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    if (Math.abs(x) > .8 || Math.abs(y) > .8) x = y = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () { c.querySelector(".oc-art").style.transform = "perspective(700px) rotateY(" + (x * 6) + "deg) rotateX(" + (-y * 6) + "deg)"; });
  });
  orbit.addEventListener("pointerleave", function () {
    [].forEach.call(orbit.querySelectorAll(".oc-art"), function (a) { a.style.transform = ""; });
  });
})();
