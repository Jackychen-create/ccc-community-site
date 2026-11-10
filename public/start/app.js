// 交易所分頁、目前在哪一段（頁首底線）、品牌翻牌
(function () {
  // 交易所分頁：網址帶 #okx / #bybit / #bingx / #um 會直接打開那一間
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
  var want = { "#okx": "t-okx", "#bybit": "t-bybit", "#bingx": "t-bingx", "#um": "t-um" }[location.hash.toLowerCase()];
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
  var TIERS = { usdt: [10000, 200000, 1500000], um: [0.01, 2, 15] };
  var NAMES = ["第一級", "第二級", "第三級"];
  var form = document.getElementById("calc");
  if (form) {
    var $ = function (id) { return document.getElementById(id); };
    var fmt = function (n, um) {
      if (um) return (Math.round(n * 100) / 100).toLocaleString("zh-TW") + " 手";
      if (n >= 10000) return (Math.round(n / 1000) / 10).toLocaleString("zh-TW") + " 萬 USDT";
      return Math.round(n).toLocaleString("zh-TW") + " USDT";
    };
    var calc = function () {
      var um = form.kind.value === "um";
      $("fSize").querySelector("span").textContent = um ? "每筆幾手" : "每筆倉位（含槓桿）";
      $("fSize").querySelector("em").textContent = um ? "手" : "USDT";
      $("calcNote").textContent = um
        ? "UM 用手數算，一筆算一次。實際以交易所的紀錄為準。"
        : "交易量算開倉加平倉的成交金額，所以一筆來回算兩次。實際以交易所的紀錄為準。";
      var size = Math.max(0, +$("cSize").value || 0), n = Math.max(0, +$("cTrades").value || 0), d = Math.min(31, Math.max(0, +$("cDays").value || 0));
      var vol = size * n * d * (um ? 1 : 2);
      var t = TIERS[um ? "um" : "usdt"], lv = -1;
      t.forEach(function (x, i) { if (vol >= x) lv = i; });
      var next = t[lv + 1];
      var out = $("calcOut");
      out.replaceChildren();
      var big = document.createElement("span"); big.className = "calc-vol num"; big.textContent = fmt(vol, um);
      var lvl = document.createElement("span"); lvl.className = "calc-lv" + (lv >= 0 ? " on" : "");
      lvl.textContent = lv >= 0 ? "一個月大約到「" + NAMES[lv] + "」" : "還不到第一級";
      var hint = document.createElement("span"); hint.className = "calc-hint";
      hint.textContent = next ? "離" + NAMES[lv + 1] + "還差 " + fmt(next - vol, um) : "已經是最高級";
      out.append(big, lvl, hint);
    };
    form.addEventListener("input", calc);
    calc();
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
