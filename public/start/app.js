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

  // ── 公開影片（研究員專區的 /api/public-video，不用登入）；拿不到就整段不顯示。捲到時一支一支浮上來 ──
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
      var sec = document.getElementById("videos");
      sec.hidden = false;
      if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        sec.classList.add("pre");
        var vio = new IntersectionObserver(function (es) {
          es.forEach(function (e) { if (e.isIntersecting) { sec.classList.add("shown"); vio.disconnect(); } });
        }, { threshold: .25 });
        vio.observe(sec);
      }
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

// ── 首屏的交易所卡片：中間那張是選到的，左右兩張往內轉。點中間那張直接開 CCC 註冊連結，點旁邊的轉到中間 ──
(function () {
  var orbit = document.getElementById("orbit");
  if (!orbit) return;
  var cards = [].slice.call(orbit.querySelectorAll(".oc"));
  // 註冊連結只寫在下面的分頁裡（一個地方改就好）
  var href = {};
  ["okx", "bybit", "bingx"].forEach(function (k) { var a = document.querySelector("#p-" + k + " .ex-head a.btn"); href[k] = a ? a.href : "#exchanges"; });
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
      c.setAttribute("aria-label", c.querySelector(".oc-cap b").textContent + (d === 0 ? "：用 CCC 連結註冊" : ""));
      c.tabIndex = d === 0 ? 0 : -1;
    });
  }
  function pick(i, fromTab) {
    idx = (i + n) % n;
    layout();
    var key = cards[idx].dataset.ex;
    if (!fromTab) { var t = document.getElementById("t-" + key); if (t && t.getAttribute("aria-selected") !== "true") t.click(); }
  }
  var moved = false;
  cards.forEach(function (c, i) {
    c.addEventListener("click", function () {
      if (moved) { moved = false; return; }
      if (i !== idx) return pick(i);
      window.open(href[c.dataset.ex], "_blank", "noopener");
    });
  });
  orbit.addEventListener("keydown", function (e) {
    var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (d) { e.preventDefault(); pick(idx + d); cards[idx].focus(); }
  });
  // 手機：左右滑
  var sx = null;
  orbit.addEventListener("pointerdown", function (e) { sx = e.clientX; moved = false; });
  orbit.addEventListener("pointerup", function (e) {
    if (sx === null) return;
    var dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 40) { moved = true; pick(idx + (dx < 0 ? 1 : -1)); }
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

// 卡片的旋光：游標在哪，邊框那一段就亮起來、跟著繞；卡面上也跟著一圈柔光（只有滑鼠）
(function () {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  [].forEach.call(document.querySelectorAll(".oc"), function (c) {
    c.addEventListener("pointermove", function (e) {
      var r = c.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      var ang = Math.atan2(y - r.height / 2, x - r.width / 2) * 180 / Math.PI + 90;
      c.style.setProperty("--mx", x + "px");
      c.style.setProperty("--my", y + "px");
      c.style.setProperty("--ang", ang + "deg");
      c.classList.add("lit");
    });
    c.addEventListener("pointerleave", function () { c.classList.remove("lit"); });
  });
})();

// 首屏的地球：夜晚那一面的城市燈光，慢慢轉（減少動態效果時停住）
(function () {
  var cv = document.querySelector(".earth .lights");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d"), dots = [], W = 0, H = 0, R = 0, cx = 0, cy = 0;
  var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var seed = 7; var rnd = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  // 燈光聚成幾團（像城市帶），經度 0–360、緯度只取朝上那一面
  var clusters = [];
  for (var k = 0; k < 34; k++) clusters.push([rnd() * 360, 58 + rnd() * 28, 3 + rnd() * 9, 30 + Math.floor(rnd() * 90)]);
  clusters.forEach(function (c) { for (var i = 0; i < c[3]; i++) dots.push([c[0] + (rnd() - .5) * c[2] * 2, c[1] + (rnd() - .5) * c[2], .4 + rnd() * .9, .25 + rnd() * .75]); });
  for (var m = 0; m < 700; m++) dots.push([rnd() * 360, 55 + rnd() * 34, .3 + rnd() * .5, .1 + rnd() * .3]);
  function size() {
    var b = cv.parentNode.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    W = b.width; H = b.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var mob = W <= 760; // 跟 style.css 的 .earth 一樣：地平線在 60%（手機 64%），球寬 230vw（手機 300vw）
    R = W * (mob ? 1.5 : 1.15); cx = W / 2; cy = H * (mob ? .64 : .60) + R;
  }
  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    var rot = calm ? 0 : t / 1000 * 1.2; // 每秒 1.2 度
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i], lon = (d[0] + rot) % 360 - 180, lat = d[1];
      if (lon < -90 || lon > 90) continue;
      var la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
      var x = cx + R * Math.cos(la) * Math.sin(lo);
      var y = cy - R * Math.sin(la) * 1;
      var depth = Math.cos(lo) * Math.min(1, (y - (cy - R)) / 60); // 左右越靠邊、越貼近地平線越淡
      if (y > H || y < 0) continue;
      ctx.globalAlpha = d[3] * Math.max(0, depth) * .9;
      ctx.fillStyle = "#F2D9A6";
      ctx.beginPath(); ctx.arc(x, y, d[2], 0, 6.283); ctx.fill();
    }
    if (!calm) requestAnimationFrame(draw);
  }
  size(); window.addEventListener("resize", size);
  requestAnimationFrame(draw);
})();
