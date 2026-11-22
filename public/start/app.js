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

  // ── 公開影片（研究員專區的 /api/public-video，不用登入）；拿不到就整段不顯示 ──
  // 第一支（形象片）滿版、靜音循環，捲到就直接開始播、捲走就暫停；其他的排在下面
  var SITE = ""; // 介紹頁跟研究員專區同一個網站，直接用相對路徑
  var box = document.getElementById("vidList");
  var getJson = function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }); };
  if (box && window.fetch) {
    getJson(SITE + "/api/public-video").then(function (d) {
      var vs = (d && d.videos) || [];
      if (!vs.length) return;
      var sec = document.getElementById("videos");
      sec.hidden = false;
      vs.slice(1, 4).forEach(function (v) {
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
      return getJson(SITE + "/api/public-video?id=" + encodeURIComponent(vs[0].id)).then(function (one) {
        if (!one || !one.url) return;
        var film = document.getElementById("film"), vid = document.getElementById("filmVideo");
        if (one.thumb_url) vid.poster = one.thumb_url;
        // 形象片（v1.33.41 起）：直接放在網站裡的 /start/film.mp4（1080×1080、30 秒、有聲音），跟網站同一個網址，
        // 讀畫面亮度（圓形閃光、灑出來的光）一定讀得到。萬一這個檔載不到，就改播研究員專區後台那支（R2）
        vid.crossOrigin = "anonymous";
        vid.addEventListener("error", function retry() {
          vid.removeEventListener("error", retry);
          vid.removeAttribute("crossorigin"); vid.src = one.url; vid.load();
        });
        vid.src = "/start/film.mp4";
        vid.setAttribute("aria-label", one.title || "介紹影片");
        film.hidden = false;
        var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (calm) vid.controls = true; // 減少動態效果：不自動播，給播放鍵
        var inView = false;
        var sync = function () { if (calm) return; if (inView && !document.hidden) { var p = vid.play(); if (p && p.catch) p.catch(function () { vid.controls = true; }); } else vid.pause(); };
        if ("IntersectionObserver" in window) {
          new IntersectionObserver(function (es) { es.forEach(function (e) { inView = e.isIntersecting; sync(); }); }, { threshold: 0, rootMargin: "120px 0px" }).observe(film); // 一露出來就開始播
        } else { inView = true; sync(); }
        document.addEventListener("visibilitychange", sync);
        // 影片原本的聲音：瀏覽器不准一打開就有聲音，所以先靜音播；訪客在頁面上第一次點一下或按鍵，就把聲音打開。右下角的按鈕可以自己開關
        var snd = document.getElementById("filmSound"), chose = false;
        var setSound = function (on) {
          vid.muted = !on;
          if (snd) { snd.setAttribute("aria-pressed", String(on)); snd.textContent = on ? "關閉聲音" : "開啟聲音"; }
          if (on && vid.paused && inView && !calm) { var p = vid.play(); if (p && p.catch) p.catch(function () {}); }
        };
        if (snd) snd.addEventListener("click", function (e) { e.stopPropagation(); chose = true; setSound(vid.muted); });
        var firstTouch = function (e) {
          if (snd && e.target === snd) return;
          document.removeEventListener("pointerup", firstTouch, true); document.removeEventListener("keydown", firstTouch, true);
          if (!chose) setSound(true);
        };
        document.addEventListener("pointerup", firstTouch, true); document.addEventListener("keydown", firstTouch, true);
        // 閃白光時收成圓形：每一格縮成 64×64 讀平均亮度，越亮 --fr 越小（最後一層圓形遮罩越緊），亮起來快、退得慢一點
        // 影片的光灑到外面（v1.33.42）：
        // ・背光：同一格畫到 40×40，先把暗灰扣掉（只留真的亮的地方），再放大、模糊放在影片後面，開頭暗的時候不會有一圈灰白霧
        // ・光線：讀影片四邊靠內一圈的亮度，哪裡有光打到邊上，就從那裡往外延伸一道同顏色的光，像光線射出影片
        (function () {
          var N = 64, cv = document.createElement("canvas"); cv.width = cv.height = N;
          var cx = cv.getContext("2d", { willReadFrequently: true }), lvl = 0, noRead = false;
          var amb = document.createElement("canvas"); amb.className = "film-ambient"; amb.width = amb.height = 40; amb.setAttribute("aria-hidden", "true");
          var ax = amb.getContext("2d", { willReadFrequently: true });
          var rays = document.createElement("canvas"); rays.className = "film-rays"; rays.setAttribute("aria-hidden", "true");
          var rx = rays.getContext("2d");
          film.insertBefore(rays, film.firstChild); film.insertBefore(amb, film.firstChild);
          var K = .5, vw = 0, vh = 0, ox = 0, oy = 0;
          var sizeRays = function () {
            var w = film.clientWidth, h = film.clientHeight; if (!w || !h) return;
            rays.width = Math.round(w * 1.8 * K); rays.height = Math.round(h * 1.8 * K);
            vw = w * K; vh = h * K; ox = w * .4 * K; oy = h * .4 * K;
          };
          window.addEventListener("resize", sizeRays);
          var st = { t: new Float32Array(N), b: new Float32Array(N), l: new Float32Array(N), r: new Float32Array(N) };
          // 一條邊：沿著邊每一格取靠內 3–8 格的平均顏色。只有「比這條邊其他地方明顯亮」的點才往外射光：
          // 整條邊都亮（閃白光、整片亮）就不射，交給背光；這樣不會出現一整圈條紋
          var cr0 = new Float32Array(N), cg0 = new Float32Array(N), cb0 = new Float32Array(N), Ls = new Float32Array(N);
          var edge = function (d, key, horiz, inner, outward) {
            var arr = st[key], mean = 0, i;
            for (i = 0; i < N; i++) {
              var R = 0, G = 0, B = 0;
              for (var k = 3; k <= 8; k++) {
                var row = horiz ? (inner ? k : N - 1 - k) : i, col = horiz ? i : (inner ? k : N - 1 - k);
                var o = (row * N + col) * 4; R += d[o]; G += d[o + 1]; B += d[o + 2];
              }
              cr0[i] = R / 6; cg0[i] = G / 6; cb0[i] = B / 6;
              Ls[i] = (cr0[i] * .2126 + cg0[i] * .7152 + cb0[i] * .0722) / 255; mean += Ls[i];
            }
            mean /= N;
            var floor = Math.max(.3, mean * 1.3, mean + .14);
            for (i = 0; i < N; i++) {
              var Lm = (Ls[Math.max(0, i - 1)] + 2 * Ls[i] + Ls[Math.min(N - 1, i + 1)]) / 4;
              var sNow = Math.max(0, Math.min(1, (Lm - floor) / .5));
              arr[i] = Math.max(sNow, arr[i] * .72);
              var s = arr[i]; if (s < .04) continue;
              var m = Math.max(cr0[i], cg0[i], cb0[i], 1);
              var col = Math.round(cr0[i] * 255 / m) + "," + Math.round(cg0[i] * 255 / m) + "," + Math.round(cb0[i] * 255 / m);
              var cell = (horiz ? vw : vh) / N, len = (horiz ? vh : vw) * (.2 + .6 * s), g, x0, y0, wd = cell * (1.2 + 1.6 * s);
              if (horiz) {
                x0 = ox + (i + .5) * cell; y0 = inner ? oy + vh * .08 : oy + vh * .92;
                g = rx.createLinearGradient(x0, y0, x0, y0 + outward * len);
              } else {
                y0 = oy + (i + .5) * cell; x0 = inner ? ox + vw * .08 : ox + vw * .92;
                g = rx.createLinearGradient(x0, y0, x0 + outward * len, y0);
              }
              g.addColorStop(0, "rgba(" + col + "," + (.7 * s).toFixed(3) + ")");
              g.addColorStop(.3, "rgba(" + col + "," + (.28 * s).toFixed(3) + ")");
              g.addColorStop(1, "rgba(" + col + ",0)");
              rx.fillStyle = g;
              if (horiz) rx.fillRect(x0 - wd / 2, outward < 0 ? y0 - len : y0, wd, len);
              else rx.fillRect(outward < 0 ? x0 - len : x0, y0 - wd / 2, len, wd);
            }
          };
          var tick = function () {
            if (!vid.paused && vid.readyState >= 2) {
              if (!noRead) {
                try {
                  cx.drawImage(vid, 0, 0, N, N);
                  var d = cx.getImageData(0, 0, N, N).data, sum = 0;
                  for (var i = 0; i < d.length; i += 4) sum += d[i] * .2126 + d[i + 1] * .7152 + d[i + 2] * .0722;
                  var L = sum / (d.length / 4) / 255;
                  var f = Math.min(1, Math.max(0, (L - .22) / .33)); f = f * f * (3 - 2 * f);
                  lvl = f > lvl ? lvl + (f - lvl) * .7 : lvl + (f - lvl) * .18;
                  var w = vid.clientWidth, h = vid.clientHeight;
                  var far = Math.sqrt(w * w + h * h) / 2 / .56 + 40, near = Math.min(w, h) / 2;
                  film.style.setProperty("--fr", Math.round(far + (near - far) * lvl) + "px");
                  window.__cccFilmLight = Math.min(1, L * 1.6); // 0–1：給背景水流用
                  // 背光：扣掉暗灰，只留亮的地方
                  ax.drawImage(vid, 0, 0, 40, 40);
                  var im = ax.getImageData(0, 0, 40, 40), p = im.data;
                  for (var j = 0; j < p.length; j += 4) { p[j] = Math.max(0, (p[j] - 42) * 1.7); p[j + 1] = Math.max(0, (p[j + 1] - 42) * 1.7); p[j + 2] = Math.max(0, (p[j + 2] - 42) * 1.7); }
                  ax.putImageData(im, 0, 0);
                  // 光線
                  if (!vw) sizeRays();
                  rx.clearRect(0, 0, rays.width, rays.height);
                  rx.globalCompositeOperation = "lighter";
                  edge(d, "t", true, true, -1); edge(d, "b", true, false, 1);
                  edge(d, "l", false, true, -1); edge(d, "r", false, false, 1);
                  rx.globalCompositeOperation = "source-over";
                } catch (e) { noRead = true; film.style.removeProperty("--fr"); window.__cccFilmLight = 0; ax.clearRect(0, 0, 40, 40); rx.clearRect(0, 0, rays.width, rays.height); }
              }
            }
            if (vid.requestVideoFrameCallback) vid.requestVideoFrameCallback(tick); else requestAnimationFrame(tick);
          };
          vid.addEventListener("pause", function () { window.__cccFilmLight = 0; });
          if (vid.requestVideoFrameCallback) vid.requestVideoFrameCallback(tick); else requestAnimationFrame(tick);
        })();
        // 框的比例跟影片本身一樣（形象片接近正方形），就不會左右留一大片黑
        vid.addEventListener("loadedmetadata", function () {
          if (vid.videoWidth && vid.videoHeight) film.style.setProperty("--ar", vid.videoWidth + " / " + vid.videoHeight);
        });
        // 往下捲的時候，影片從上一段接著浮上來、慢慢放大到原本的大小（捲動帶動，不是定時動畫）
        if (!calm) {
          var raf = 0;
          var rise = function () {
            raf = 0;
            var r = film.getBoundingClientRect(), vh = window.innerHeight;
            var p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.75)));
            var e = 1 - Math.pow(1 - p, 3);
            film.style.setProperty("--p", e.toFixed(3));
          };
          var onScroll = function () { if (!raf) raf = requestAnimationFrame(rise); };
          window.addEventListener("scroll", onScroll, { passive: true });
          window.addEventListener("resize", onScroll);
          film.classList.add("rise");
          rise();
        }
      });
    }).catch(function () {});
  }

  // ── 首屏的數字、研究員在聊什麼（/api/public-stats：只有數字和管理員勾過的精選，沒有名字）──
  getJson(SITE + "/api/public-stats").then(function (d) {
    if (!d) return;
    var hs = document.getElementById("heroStats");
    var bits = [];
    if (d.discord >= 100) bits.push(["Discord", d.discord.toLocaleString("en-US"), "人"]);
    if (d.lives >= 3) bits.push(["直播留檔", String(d.lives), "場"]);
    if (d.liveHours >= 3) bits.push(["", String(d.liveHours), "小時可以回看"]);
    if (hs && bits.length) {
      bits.forEach(function (b) {
        var s = document.createElement("span"); s.className = "hs";
        if (b[0]) s.append(b[0] + " ");
        var n = document.createElement("b"); n.className = "num"; n.textContent = b[1]; s.append(n, " " + b[2]);
        hs.appendChild(s);
      });
      hs.hidden = false;
    }
    var fs = (d.featured || []).filter(function (f) { return f && f.text; });
    var vl = document.getElementById("voiceList");
    if (vl && fs.length) {
      fs.forEach(function (f) {
        var q = document.createElement("figure"); q.className = "voice";
        var t = document.createElement("blockquote"); t.textContent = f.text;
        var c = document.createElement("figcaption");
        var dt = new Date(f.at);
        c.textContent = "研究員・" + (dt.getMonth() + 1) + "/" + dt.getDate() + (f.votes ? "・" + f.votes + " 票想聽點評" : "");
        q.append(t, c);
        vl.appendChild(q);
      });
      document.getElementById("voices").hidden = false;
    }
  }).catch(function () {});

  // 品牌三片翻牌：打開時翻一次、滑過再翻
  var flap = document.querySelector(".top .flap");
  var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function go() { if (calm || !flap) return; flap.classList.remove("go"); void flap.offsetWidth; flap.classList.add("go"); }
  go();
  var brand = document.querySelector(".brand");
  if (brand) { brand.addEventListener("mouseenter", go); brand.addEventListener("focus", go); }
})();

// ── 首屏的交易所卡片：中間那張是選到的，左右兩張排在同一條線上、變暗。點中間那張直接開 CCC 註冊連結，點旁邊的轉到中間 ──
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
      var x = d * w * (wide() ? .98 : .78);
      // 三張排在同一條線上，中間那張放大一點、亮一點，像站在前面；旁邊兩張縮小、變暗，像往後退
      // 縮放的中心放在標誌正中間，三個標誌才會維持在同一條線上（offsetTop 不受 transform 影響）
      var art = c.querySelector(".oc-art"), mk = art && art.querySelector("img, .wm");
      if (mk) c.style.transformOrigin = "50% " + (art.offsetTop + mk.offsetTop + mk.offsetHeight / 2) + "px";
      c.style.transform = "translate3d(" + x + "px, 0, 0) scale(" + (d === 0 ? 1.1 : .8) + ")";
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

// 整頁背景（首屏地球以外）：一條條藍色的細光從上往下流，像水流過玻璃；首屏擋住的時候不畫，減少動態效果時只畫一張靜止的
// 跟著捲動：往下捲水流加速往下；往上捲水流掉頭往上，之後就一直往上流，直到再往下捲才掉頭回來；捲越快流越快
(function () {
  var cv = document.querySelector("canvas.rain");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d"), hero = document.querySelector(".hero");
  var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var W = 0, H = 0, drops = [], last = 0, on = false;
  var lastY = window.scrollY, sv = 0; // sv：平滑過的捲動速度（px/秒，往下為正）
  var dir = 1, flow = 1, from = 1, turnT = 0, TURN = 7; // dir：最後一次捲動的方向（1 往下、-1 往上），停下來也記著；flow 用 TURN 秒、頭尾都慢的曲線轉到 dir
  // 預先畫好一條光：上面透明、往下慢慢變亮，最下面是亮頭；外面再一層很淡的光暈
  var sprite = document.createElement("canvas"); sprite.width = 8; sprite.height = 256;
  var spriteUp = document.createElement("canvas"); spriteUp.width = 8; spriteUp.height = 256; // 上下顛倒：往上流時亮頭在上面
  (function () {
    var g = sprite.getContext("2d");
    var glow = g.createLinearGradient(0, 0, 0, 256);
    glow.addColorStop(0, "rgba(70, 130, 255, 0)"); glow.addColorStop(.85, "rgba(70, 130, 255, .16)"); glow.addColorStop(1, "rgba(120, 170, 255, .28)");
    g.fillStyle = glow; g.fillRect(0, 0, 8, 256);
    var core = g.createLinearGradient(0, 0, 0, 256);
    core.addColorStop(0, "rgba(110, 160, 255, 0)"); core.addColorStop(.7, "rgba(110, 160, 255, .55)"); core.addColorStop(1, "rgba(170, 200, 255, .85)");
    g.clearRect(3, 0, 2, 256); g.fillStyle = core; g.fillRect(3, 0, 2, 256);
    var u = spriteUp.getContext("2d"); u.translate(0, 256); u.scale(1, -1); u.drawImage(sprite, 0, 0);
  })();
  function drop(top, fromBottom) {
    return { x: Math.random() * W, y: top ? Math.random() * H : fromBottom ? H + Math.random() * 300 : -Math.random() * 300, len: 70 + Math.random() * 220,
      v: 22 + Math.random() * 60, a: .05 + Math.random() * .13, w: Math.random() < .2 ? 1.6 : 1 };
  }
  function size() {
    var dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.round(Math.min(85, Math.max(30, W / 20)));
    drops = []; for (var i = 0; i < n; i++) drops.push(drop(true));
  }
  function covered() { return hero && hero.getBoundingClientRect().bottom >= H; } // 首屏還蓋滿整個畫面
  function paint(dt) {
    ctx.clearRect(0, 0, W, H);
    // 方向：捲動超過一點點就記下新方向，停下來也維持；flow 用大約七秒慢慢減速、停住、再往另一邊流，像水被帶著轉向
    var want = sv < -40 ? -1 : sv > 40 ? 1 : dir;
    if (want !== dir) { dir = want; from = flow; turnT = 0; } // 轉到一半又換方向：從現在的位置重新開始轉
    if (flow !== dir) {
      turnT = Math.min(TURN, turnT + dt);
      var k = turnT / TURN; k = k * k * (3 - 2 * k); // 開始和結束都很慢，中間才轉得比較快
      flow = from + (dir - from) * k;
    }
    var stretch = 1 + Math.min(.6, Math.abs(sv) / 1500); // 捲得快，光稍微拉長一點
    // 形象片播到亮的畫面時，背景的水流跟著亮起來（最多亮到 2.5 倍），像影片的光照到水上
    var glow = 1 + Math.min(1, window.__cccFilmLight || 0) * 1.5;
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      // 捲動速度只帶一點點進來（上限 240px/秒），而且只在跟水流同方向時才加：反方向捲的時候不會把水一下推回去
      var push = Math.max(-2000, Math.min(2000, sv)) * .12 * Math.max(0, sv >= 0 ? flow : -flow);
      var v = d.v * flow + push;
      d.y += v * dt;
      var len = d.len * stretch;
      if (v >= 0 && d.y - len > H) { drops[i] = d = drop(false); }
      else if (v < 0 && d.y + len < 0) { drops[i] = d = drop(false, true); }
      // 轉向的時候亮頭不要一下跳到另一端：速度接近 0 時兩個方向的光交叉淡入淡出
      var down = Math.min(1, Math.max(0, (v + 25) / 50));
      var al = Math.min(1, d.a * glow);
      if (down > 0) { ctx.globalAlpha = al * down; ctx.drawImage(sprite, d.x - 4 * d.w, d.y - len, 8 * d.w, len); }
      if (down < 1) { ctx.globalAlpha = al * (1 - down); ctx.drawImage(spriteUp, d.x - 4 * d.w, d.y, 8 * d.w, len); }
    }
    ctx.globalAlpha = 1;
  }
  function frame(t) {
    var dt = last ? Math.min(.05, (t - last) / 1000) : 0; last = t;
    var y = window.scrollY;
    if (dt > 0) {
      var raw = Math.max(-4000, Math.min(4000, (y - lastY) / dt));
      sv += (raw - sv) * Math.min(1, dt * (Math.abs(raw) > Math.abs(sv) ? 3 : 1.5)); // 加速、減速都慢慢來，不會一下衝很快
    }
    lastY = y;
    if (!document.hidden && !covered()) paint(dt);
    if (on) requestAnimationFrame(frame);
  }
  size();
  window.addEventListener("resize", size);
  if (calm) { paint(0); window.addEventListener("resize", function () { paint(0); }); return; }
  on = true; requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", function () { last = 0; });
})();

// 滑鼠周圍的白色光暈：只在有滑鼠的裝置；游標移出視窗就淡掉。減少動態效果時直接貼著游標，不做滑行
(function () {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var g = document.createElement("div"); g.className = "cursor-glow"; g.setAttribute("aria-hidden", "true");
  document.body.appendChild(g);
  var tx = 0, ty = 0, x = 0, y = 0, raf = 0, seen = false;
  function put() { g.style.transform = "translate3d(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px, 0)"; }
  function step() {
    raf = 0;
    x += (tx - x) * .22; y += (ty - y) * .22; put();
    if (Math.abs(tx - x) > .3 || Math.abs(ty - y) > .3) raf = requestAnimationFrame(step);
  }
  document.addEventListener("pointermove", function (e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    tx = e.clientX; ty = e.clientY;
    if (!seen || calm) { x = tx; y = ty; put(); seen = true; }
    g.classList.add("on");
    if (!calm && !raf) raf = requestAnimationFrame(step);
  }, { passive: true });
  document.addEventListener("pointerleave", function () { g.classList.remove("on"); });
  document.documentElement.addEventListener("mouseleave", function () { g.classList.remove("on"); });
  window.addEventListener("blur", function () { g.classList.remove("on"); });
})();

// 首屏地球上方的星空（v1.33.44 改寫實）：像照片裡的星星——每顆都是很小、很銳利的一點（直接畫在螢幕的實際像素上，不糊成灰點），
// 大部分很暗、少數很亮，亮的帶一點藍白或暖黃；沒有光暈。只有幾顆亮星非常輕微地閃。地球蓋在上面，所以只在地平線以上
(function () {
  var cv = document.querySelector(".sky .stars");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d"), hero = document.querySelector(".hero");
  var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var Wp = 0, Hp = 0, dpr = 1, stars = [], tw = [], on = false;
  var seed = 11; var rnd = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  function build() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var b = cv.parentNode.getBoundingClientRect();
    Wp = Math.round(b.width * dpr); Hp = Math.round(b.height * dpr);
    cv.width = Wp; cv.height = Hp;
    seed = 11; stars = []; tw = [];
    var n = Math.round(b.width * b.height / 3200);
    for (var i = 0; i < n; i++) {
      // 亮度照真實星空的比例：很暗的最多，亮的很少
      var m = Math.pow(rnd(), 3.2);
      var v = 40 + Math.round(m * 215);
      var t = rnd(), r = v, g = v, bl = v;
      if (m > .35) { if (t < .3) { r = v * .82; g = v * .9; } else if (t < .45) { g = v * .92; bl = v * .78; } }
      var size = m > .75 ? 2 : 1;
      var st = { x: Math.round(rnd() * Wp), y: Math.round(Math.pow(rnd(), 1.2) * Hp), s: size * (dpr > 1.5 ? 1 : 1), c: "rgb(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(bl) + ")", m: m, sp: .5 + rnd() * 1.2, ph: rnd() * 6.283 };
      stars.push(st); if (m > .55) tw.push(st);
    }
  }
  function paint(t) {
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, Wp, Hp);
    for (var i = 0; i < stars.length; i++) { var s = stars[i]; ctx.fillStyle = s.c; ctx.fillRect(s.x, s.y, s.s, s.s); }
    if (!calm) { // 只有亮星輕輕地閃（大氣擾動），暗的星不動
      ctx.fillStyle = "#000";
      for (var k = 0; k < tw.length; k++) { var q = tw[k]; ctx.globalAlpha = .35 * (.5 + .5 * Math.sin(t / 1000 * q.sp + q.ph)); ctx.fillRect(q.x, q.y, q.s, q.s); }
      ctx.globalAlpha = 1;
    }
  }
  function frame(t) {
    if (!document.hidden && hero.getBoundingClientRect().bottom > 0) paint(t);
    if (on) requestAnimationFrame(frame);
  }
  build(); paint(0);
  window.addEventListener("resize", function () { build(); paint(performance.now()); });
  if (!calm) { on = true; requestAnimationFrame(frame); }
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
    var mob = W <= 760; // 跟 style.css 的 .earth 一樣：球寬 230vw（手機 300vw）
    // 地平線的高度直接讀 .limb 的位置（style.css 的 --top 會照螢幕高度往上移）
    var limb = cv.parentNode.querySelector(".limb");
    var top = limb ? limb.offsetTop : H * (mob ? .64 : .60);
    R = W * (mob ? 1.5 : 1.15); cx = W / 2; cy = top + R;
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

// 主講卡片後面的大字：照卡片大小縮放，整個字都放得進去、不裁切
(function () {
  var marks = [].slice.call(document.querySelectorAll(".host-mark > span"));
  if (!marks.length) return;
  function fit() {
    marks.forEach(function (s) {
      var box = s.parentNode.parentNode;
      s.style.fontSize = "100px";
      var w = s.offsetWidth, h = s.offsetHeight;
      if (!w || !h) return;
      var k = Math.min((box.clientWidth * 0.9) / w, (box.clientHeight * 0.9) / h);
      s.style.fontSize = Math.floor(100 * k) + "px";
    });
  }
  fit();
  window.addEventListener("resize", fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
})();
