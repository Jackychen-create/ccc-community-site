// 會員前台：登入／註冊、影片列表、播放頁
(function () {
  "use strict";
  const A = window.App;
  const { el, $, api, sb, icon, icons } = A;

  const SITE = A.cfg.SITE_NAME || "會員專區";
  const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
  const DAY = 86400000;

  let me = null;
  let videos = [];
  let loadedList = false;
  let filter = "all";
  let query = "";
  let listScroll = 0;
  let routerOn = false;

  // 播放狀態
  let current = null;
  let pendingSeek = null;
  let retried = false;
  let lastSaved = -1;
  let lastSaveAt = 0;

  const video = $("#video");

  // ─────────────────────────────────────────────
  // 開機
  // ─────────────────────────────────────────────
  document.querySelectorAll("[data-site-name]").forEach((n) => (n.textContent = SITE));
  document.title = SITE;

  function show(id) {
    for (const v of ["bootView", "authView", "appView", "blockedView"]) $("#" + v).hidden = v !== id;
  }

  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      me = null;
      videos = [];
      loadedList = false;
      leaveWatch();
      showAuth();
    }
  });

  (async function boot() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return showAuth();
    await enterApp();
  })();

  async function enterApp() {
    try {
      me = await api("/api/me");
    } catch (e) {
      if (e.status === 401) {
        await sb.auth.signOut();
        return;
      }
      if (e.status === 403) return showBlocked(e.message);
      show("blockedView");
      $("#blockedMsg").textContent = e.message;
      return;
    }
    const next = new URLSearchParams(location.search).get("next");
    if (next === "admin" && me.isAdmin) {
      location.replace("/admin");
      return;
    }
    if (location.search) history.replaceState(null, "", location.pathname + location.hash);
    show("appView");
    renderMenu();
    if (!routerOn) {
      routerOn = true;
      window.addEventListener("hashchange", route);
    }
    route();
  }

  function showBlocked(msg) {
    show("blockedView");
    $("#blockedMsg").textContent = msg || "這個帳號目前沒有觀看權限，請聯絡管理員。";
  }
  $("#blockedLogout").addEventListener("click", () => sb.auth.signOut());

  // ─────────────────────────────────────────────
  // 登入／註冊
  // ─────────────────────────────────────────────
  let mode = "login";

  function showAuth() {
    show("authView");
    document.title = SITE;
    const params = new URLSearchParams(location.search);
    const invite = params.get("invite");
    if (invite) {
      $("#invite").value = invite.toUpperCase();
      setMode("register");
    } else {
      setMode(mode);
    }
    const remembered = A.store.get("lastEmail", "");
    if (remembered && !$("#email").value) $("#email").value = remembered;
  }

  function setMode(m) {
    mode = m;
    const reg = m === "register";
    $("#tabLogin").setAttribute("aria-selected", String(!reg));
    $("#tabRegister").setAttribute("aria-selected", String(reg));
    $("#inviteRow").hidden = !reg;
    $("#invite").required = reg;
    $("#authTitle").textContent = reg ? "加入會員" : "登入";
    $("#authSub").textContent = reg ? "輸入邀請碼，建立你的帳號" : "登入以觀看直播留檔";
    $("#pwLabel").textContent = reg ? "設定密碼（至少 8 個字元）" : "密碼";
    $("#password").autocomplete = reg ? "new-password" : "current-password";
    $("#authSubmit").textContent = reg ? "建立帳號並登入" : "登入";
    setAuthError("");
  }
  $("#tabLogin").addEventListener("click", () => setMode("login"));
  $("#tabRegister").addEventListener("click", () => setMode("register"));

  const reveal = $("#revealPw");
  reveal.innerHTML = icons.eye;
  reveal.addEventListener("click", () => {
    const pw = $("#password");
    const showing = pw.type === "text";
    pw.type = showing ? "password" : "text";
    reveal.innerHTML = showing ? icons.eye : icons.eyeOff;
    reveal.setAttribute("aria-pressed", String(!showing));
    reveal.setAttribute("aria-label", showing ? "顯示密碼" : "隱藏密碼");
  });

  function setAuthError(msg) {
    const box = $("#authError");
    box.textContent = msg;
    box.hidden = !msg;
  }

  function loginErrorText(err) {
    const m = String(err?.message || "");
    if (/invalid login credentials/i.test(m)) return "Email 或密碼錯誤";
    if (/banned/i.test(m)) return "這個帳號已被停用，請聯絡管理員";
    if (/email not confirmed/i.test(m)) return "這個帳號還沒完成驗證，請聯絡管理員";
    if (/rate limit|too many/i.test(m)) return "嘗試次數太多，請稍等幾分鐘再試";
    return "登入失敗，請稍後再試";
  }

  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim().toLowerCase();
    const password = $("#password").value;
    const invite = $("#invite").value.trim().toUpperCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setAuthError("請輸入正確的 Email");
    if (password.length < 8) return setAuthError("密碼至少需要 8 個字元");
    if (mode === "register" && !invite) return setAuthError("請輸入邀請碼");

    const btn = $("#authSubmit");
    A.setBusy(btn, true, mode === "register" ? "建立帳號中…" : "登入中…");
    setAuthError("");
    try {
      if (mode === "register") {
        await api("/api/register", { method: "POST", body: { email, password, inviteCode: invite } });
      }
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(loginErrorText(error));
      A.store.set("lastEmail", email);
      $("#password").value = "";
      await enterApp();
    } catch (err) {
      setAuthError(err.message);
    } finally {
      A.setBusy(btn, false);
    }
  });

  // ─────────────────────────────────────────────
  // 帳號選單
  // ─────────────────────────────────────────────
  const menuBtn = $("#menuBtn");
  const menuPanel = $("#menuPanel");

  function renderMenu() {
    $("#avatar").textContent = (me?.email || "?").charAt(0).toUpperCase();
    menuPanel.replaceChildren(
      el("div", { class: "who" }, el("div", { text: "登入身分" }), el("div", { style: { color: "var(--ink)" }, text: me?.email || "" })),
      me?.isAdmin ? el("a", { href: "/admin", role: "menuitem" }, icon("settings"), "後台管理") : null,
      el("button", { type: "button", role: "menuitem", onclick: changePassword }, icon("key"), "修改密碼"),
      el("button", { type: "button", role: "menuitem", onclick: () => sb.auth.signOut() }, icon("logout"), "登出")
    );
  }
  function toggleMenu(open) {
    const willOpen = open ?? menuPanel.hidden;
    menuPanel.hidden = !willOpen;
    menuBtn.setAttribute("aria-expanded", String(willOpen));
  }
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  document.addEventListener("click", (e) => {
    if (!menuPanel.hidden && !menuPanel.contains(e.target)) toggleMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menuPanel.hidden) {
      toggleMenu(false);
      menuBtn.focus();
    }
  });

  function changePassword() {
    toggleMenu(false);
    const p1 = el("input", { class: "input", type: "password", autocomplete: "new-password", minlength: "8" });
    const p2 = el("input", { class: "input", type: "password", autocomplete: "new-password", minlength: "8" });
    const err = el("div", { class: "form-error", role: "alert", hidden: true });
    const save = el("button", { class: "btn primary", type: "button", text: "儲存新密碼" });
    const m = A.modal({
      title: "修改密碼",
      body: el("div", null,
        el("label", { class: "field" }, el("span", { class: "label", text: "新密碼（至少 8 個字元）" }), p1),
        el("label", { class: "field" }, el("span", { class: "label", text: "再輸入一次" }), p2),
        err),
      actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }), save],
    });
    const fail = (t) => {
      err.textContent = t;
      err.hidden = false;
    };
    save.addEventListener("click", async () => {
      if (p1.value.length < 8) return fail("密碼至少需要 8 個字元");
      if (p1.value !== p2.value) return fail("兩次輸入的密碼不一樣");
      A.setBusy(save, true, "儲存中…");
      const { error } = await sb.auth.updateUser({ password: p1.value });
      A.setBusy(save, false);
      if (error) {
        return fail(/different/i.test(error.message) ? "新密碼不能跟舊密碼一樣" : "修改失敗，請重新登入後再試");
      }
      m.close();
      A.toast("密碼已更新");
    });
  }

  // ─────────────────────────────────────────────
  // 路由
  // ─────────────────────────────────────────────
  function route() {
    if (!me) return;
    const m = location.hash.match(/^#\/v\/(\d+)/);
    if (m) openWatch(Number(m[1]));
    else openList();
  }

  // ─────────────────────────────────────────────
  // 影片列表
  // ─────────────────────────────────────────────
  function pctOf(v) {
    const d = v.duration_sec;
    return d ? Math.min(1, (v.position_sec || 0) / d) : 0;
  }
  const isWatched = (v) => pctOf(v) >= 0.95;
  const isInProgress = (v) => (v.position_sec || 0) >= 15 && !isWatched(v);
  const isNew = (v) => !v.position_sec && Date.now() - new Date(v.published_at).getTime() < 7 * DAY;

  async function openList() {
    leaveWatch();
    $("#watchView").hidden = true;
    $("#listView").hidden = false;
    $("#searchBox").hidden = false;
    document.title = SITE;
    if (!loadedList) renderSkeleton();
    else {
      renderList();
      requestAnimationFrame(() => window.scrollTo(0, listScroll));
    }
    try {
      const r = await api("/api/videos");
      videos = r.videos || [];
      loadedList = true;
      if (!$("#listView").hidden) renderList();
    } catch (e) {
      handleErr(e, () => {
        $("#grid").replaceChildren(emptyBox("讀不到影片清單", e.message, true));
      });
    }
  }

  function handleErr(e, fallback) {
    if (e.status === 401) return sb.auth.signOut();
    if (e.status === 403) return showBlocked(e.message);
    fallback && fallback();
  }

  function renderSkeleton() {
    $("#continueSec").hidden = true;
    $("#chips").replaceChildren();
    $("#countText").textContent = "";
    const items = [];
    for (let i = 0; i < 6; i++) {
      items.push(el("div", { class: "skel", "aria-hidden": "true" }, el("div", { class: "thumb" }), el("div", { class: "line" }), el("div", { class: "line short" })));
    }
    $("#grid").replaceChildren(...items);
  }

  function monthKey(v) {
    return String(v.published_at).slice(0, 7);
  }
  function monthLabel(k) {
    const [y, m] = k.split("-");
    return Number(y) === new Date().getFullYear() ? `${Number(m)} 月` : `${y} 年 ${Number(m)} 月`;
  }

  function renderChips() {
    const months = [...new Set(videos.map(monthKey))];
    const opts = [["all", "全部"], ["unfinished", "未看完"], ...months.map((k) => ["m:" + k, monthLabel(k)])];
    if (!opts.some(([k]) => k === filter)) filter = "all";
    $("#chips").replaceChildren(
      ...opts.map(([k, label]) =>
        el("button", {
          class: "chip", type: "button", "aria-pressed": String(filter === k), text: label,
          onclick: () => {
            filter = k;
            renderList();
          },
        })
      )
    );
  }

  function filtered() {
    const q = query.trim().toLowerCase();
    return videos.filter((v) => {
      if (filter === "unfinished" && isWatched(v)) return false;
      if (filter.startsWith("m:") && monthKey(v) !== filter.slice(2)) return false;
      if (q && !`${v.title} ${v.description || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function renderList() {
    renderChips();
    const list = filtered();
    $("#countText").textContent = videos.length ? `共 ${videos.length} 支` : "";

    const cont = videos
      .filter(isInProgress)
      .sort((a, b) => new Date(b.watched_at || 0) - new Date(a.watched_at || 0))
      .slice(0, 3);
    const showCont = cont.length > 0 && filter === "all" && !query.trim();
    $("#continueSec").hidden = !showCont;
    if (showCont) $("#continueList").replaceChildren(...cont.map(continueRow));

    if (!videos.length) {
      $("#grid").replaceChildren(emptyBox("目前還沒有影片", "新的直播留檔上傳後會出現在這裡。"));
      return;
    }
    if (!list.length) {
      $("#grid").replaceChildren(emptyBox("找不到符合的影片", "換個關鍵字或篩選條件試試看。"));
      return;
    }
    $("#grid").replaceChildren(...list.map(card));
  }

  function emptyBox(title, text, retry) {
    const box = el("div", { class: "empty", style: { gridColumn: "1 / -1" } },
      el("span", { html: icons.film, style: { display: "block" } }),
      el("h2", { text: title }),
      el("p", { class: "small", style: { marginTop: "6px" }, text })
    );
    if (retry) box.append(el("button", { class: "btn sm", type: "button", style: { marginTop: "14px" }, text: "重新整理", onclick: openList }));
    return box;
  }

  function thumbBox(v, { small = false } = {}) {
    const box = el("div", { class: "thumb" });
    if (v.thumb_url) box.append(A.thumbImg(v.thumb_url));
    else box.append(A.placeholderSvg());
    if (!small) box.append(el("div", { class: "center" }, el("div", { class: "play", html: icons.play })));
    const tl = el("div", { class: "tl" });
    if (!small && isNew(v)) tl.append(el("span", { class: "pill brass", text: "新" }));
    if (!small && isWatched(v)) tl.append(el("span", { class: "pill good" }, icon("check"), "看完了"));
    if (tl.childNodes.length) box.append(tl);
    if (v.duration_sec && !small) box.append(el("span", { class: "dur num", text: A.fmtDur(v.duration_sec) }));
    const p = pctOf(v);
    if (p > 0.01 && !isWatched(v)) box.append(el("div", { class: "bar" }, el("i", { style: { width: Math.round(p * 100) + "%" } })));
    return box;
  }

  function card(v, i) {
    const meta = el("div", { class: "vmeta" }, el("span", { class: "num", text: A.fmtDate(v.published_at) }));
    if (v.attachment_count) meta.append(el("span", { class: "meta-ico" }, icon("paperclip"), `教材 ${v.attachment_count}`));
    return el("a", { class: "vcard rise", href: `#/v/${v.id}`, style: { animationDelay: Math.min(i, 8) * 0.04 + "s" } },
      thumbBox(v),
      el("div", { class: "vbody" },
        el("div", { class: "vtitle", text: v.title }),
        meta,
        v.description ? el("p", { class: "vdesc", text: v.description }) : null
      )
    );
  }

  function continueRow(v) {
    const left = v.duration_sec ? A.fmtLeft(v.duration_sec - v.position_sec) : `看到 ${A.fmtDur(v.position_sec)}`;
    return el("a", { class: "crow", href: `#/v/${v.id}` },
      thumbBox(v, { small: true }),
      el("div", { style: { minWidth: "0" } },
        el("div", { class: "vtitle", text: v.title }),
        el("div", { class: "vmeta" }, el("span", { class: "meta-ico", style: { color: "var(--brass)" } }, icon("play"), "繼續看"), el("span", { text: left }))
      )
    );
  }

  $("#search").addEventListener("input", (e) => {
    query = e.target.value;
    if (loadedList) renderList();
  });

  // ─────────────────────────────────────────────
  // 播放頁
  // ─────────────────────────────────────────────
  function renderSpeed() {
    const cur = A.store.get("speed", 1);
    $("#speed").replaceChildren(
      ...SPEEDS.map((s) =>
        el("button", {
          type: "button", "aria-pressed": String(s === cur), text: s + "×",
          onclick: () => setSpeed(s),
        })
      )
    );
  }
  function setSpeed(s) {
    A.store.set("speed", s);
    video.defaultPlaybackRate = s;
    video.playbackRate = s;
    renderSpeed();
  }
  renderSpeed();

  function setNotice(node) {
    $("#watchNotice").replaceChildren(...(node ? [node] : []));
  }

  async function openWatch(id) {
    if (current && current.id === id) return;
    if (!$("#listView").hidden) listScroll = window.scrollY;
    leaveWatch();
    $("#listView").hidden = true;
    $("#watchView").hidden = false;
    $("#searchBox").hidden = true;
    window.scrollTo(0, 0);

    $("#wTitle").textContent = "載入中…";
    $("#wMeta").replaceChildren();
    $("#wDesc").textContent = "";
    $("#wFiles").hidden = true;
    $("#videoLoading").hidden = false;
    setNotice(null);
    renderOthers(id);

    let d;
    try {
      d = await api(`/api/videos?id=${id}`);
    } catch (e) {
      return handleErr(e, () => {
        $("#videoLoading").hidden = true;
        $("#wTitle").textContent = e.status === 404 ? "找不到這支影片" : "影片載入失敗";
        $("#wDesc").textContent = e.status === 404 ? "影片可能已經下架，回到列表看看其他場次。" : e.message;
      });
    }
    if (!location.hash.startsWith(`#/v/${id}`)) return; // 使用者已經離開

    current = d;
    retried = false;
    lastSaved = d.position_sec || -1;
    document.title = `${d.title}｜${SITE}`;
    $("#wTitle").textContent = d.title;
    const meta = $("#wMeta");
    meta.append(el("span", { class: "num", text: A.fmtDate(d.published_at) }));
    if (d.duration_sec) meta.append(el("span", { class: "num", text: A.fmtDur(d.duration_sec) }));
    if (!d.is_published) meta.append(el("span", { class: "pill warn", text: "草稿預覽（會員看不到）" }));
    $("#wDesc").textContent = d.description || "";

    if (d.attachments?.length) {
      $("#wFiles").hidden = false;
      $("#wFileList").replaceChildren(...d.attachments.map(fileRow));
    }

    const pos = d.position_sec || 0;
    const nearEnd = d.duration_sec && pos > d.duration_sec - 20;
    pendingSeek = pos >= 15 && !nearEnd ? pos : null;

    video.defaultPlaybackRate = A.store.get("speed", 1);
    video.src = d.url;
    if (!loadedList) {
      api("/api/videos").then((r) => {
        videos = r.videos || [];
        loadedList = true;
        if (current) renderOthers(current.id);
      }).catch(() => {});
    }
  }

  function fileRow(a) {
    const ext = (a.title.match(/\.([a-z0-9]{1,5})$/i) || a.url.split("?")[0].match(/\.([a-z0-9]{1,5})$/i) || [, "檔案"])[1].toUpperCase();
    return el("a", { class: "file", href: a.url, rel: "noopener" },
      el("span", { class: "ext", text: ext.slice(0, 4) }),
      el("span", { class: "grow" }, el("div", { class: "name", text: a.title }), a.size_bytes ? el("div", { class: "small muted", text: A.fmtBytes(a.size_bytes) }) : null),
      el("span", { class: "dl", html: icons.download })
    );
  }

  function renderOthers(id) {
    const others = videos.filter((v) => v.id !== id).slice(0, 6);
    const box = $("#others");
    if (!others.length) {
      box.replaceChildren(el("p", { class: "small muted", text: loadedList ? "目前沒有其他場次" : "" }));
      return;
    }
    box.replaceChildren(
      ...others.map((v) =>
        el("a", { class: "crow", href: `#/v/${v.id}` },
          thumbBox(v, { small: true }),
          el("div", { style: { minWidth: "0" } },
            el("div", { class: "vtitle", text: v.title }),
            el("div", { class: "vmeta" }, el("span", { class: "num", text: A.fmtDate(v.published_at) }), isWatched(v) ? el("span", { text: "看完了" }) : null)
          )
        )
      )
    );
  }

  function leaveWatch() {
    if (current) saveProgress(true);
    current = null;
    pendingSeek = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  function saveProgress(force) {
    if (!current || !video.duration || !isFinite(video.duration)) return;
    const pos = Math.floor(video.ended ? video.duration : video.currentTime);
    if (!force && Math.abs(pos - lastSaved) < 5) return;
    lastSaved = pos;
    lastSaveAt = Date.now();
    const dur = Math.floor(video.duration);
    const v = videos.find((x) => x.id === current.id);
    if (v) {
      v.position_sec = pos;
      v.duration_sec = v.duration_sec || dur;
      v.watched_at = new Date().toISOString();
    }
    api("/api/progress", { method: "POST", body: { videoId: current.id, position: pos, duration: dur }, keepalive: true }).catch(() => {});
  }

  // 影片事件
  video.addEventListener("loadedmetadata", () => {
    $("#videoLoading").hidden = true;
    video.playbackRate = A.store.get("speed", 1);
    if (pendingSeek !== null && pendingSeek < video.duration - 5) {
      const at = pendingSeek;
      video.currentTime = at;
      if (!retried) {
        setNotice(el("div", { class: "notice" },
          el("span", { html: icons.clock }),
          el("span", { text: `已從 ${A.fmtDur(at)} 繼續播放` }),
          el("span", { class: "spacer" }),
          el("button", { class: "btn sm", type: "button", text: "從頭開始", onclick: () => {
            video.currentTime = 0;
            setNotice(null);
            video.play().catch(() => {});
          } })
        ));
      }
    }
    pendingSeek = null;
  });
  video.addEventListener("waiting", () => ($("#videoLoading").hidden = false));
  video.addEventListener("loadeddata", () => ($("#videoLoading").hidden = true));
  video.addEventListener("pause", () => ($("#videoLoading").hidden = true));
  video.addEventListener("canplay", () => ($("#videoLoading").hidden = true));
  video.addEventListener("playing", () => {
    $("#videoLoading").hidden = true;
    retried = false;
  });
  video.addEventListener("pause", () => saveProgress(true));
  video.addEventListener("seeked", () => saveProgress(false));
  video.addEventListener("timeupdate", () => {
    if (Date.now() - lastSaveAt > 15000) saveProgress(false);
  });
  video.addEventListener("ratechange", () => {
    if (SPEEDS.includes(video.playbackRate) && video.playbackRate !== A.store.get("speed", 1)) {
      A.store.set("speed", video.playbackRate);
      renderSpeed();
    }
  });
  video.addEventListener("ended", () => {
    saveProgress(true);
    const idx = videos.findIndex((v) => v.id === current?.id);
    const next = idx >= 0 ? videos[idx + 1] : null;
    setNotice(el("div", { class: "notice" },
      el("span", { html: icons.ok }),
      el("span", { text: "這一場看完了" }),
      el("span", { class: "spacer" }),
      next ? el("a", { class: "btn sm primary", href: `#/v/${next.id}`, text: `下一場：${next.title}` }) : el("a", { class: "btn sm", href: "#/", text: "回到列表" })
    ));
  });
  video.addEventListener("error", async () => {
    if (!current || !video.getAttribute("src")) return;
    $("#videoLoading").hidden = true;
    // 簽名連結過期（例如暫停太久）就換一個新的，從原本的位置繼續
    if (!retried) {
      retried = true;
      const at = video.currentTime || pendingSeek || 0;
      try {
        const d = await api(`/api/videos?id=${current.id}`);
        if (!current || current.id !== d.id) return;
        pendingSeek = at;
        video.src = d.url;
        return;
      } catch {}
    }
    setNotice(el("div", { class: "notice" }, el("span", { html: icons.alert }),
      el("span", { text: "影片暫時無法播放，請重新整理頁面，或確認瀏覽器支援這個格式。" })));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveProgress(true);
  });
  window.addEventListener("pagehide", () => saveProgress(true));

  // 快捷鍵
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest("input, textarea, select, button, a, video, [contenteditable]")) return;
    if ($("#appView").hidden) return;
    if (!$("#listView").hidden && e.key === "/") {
      e.preventDefault();
      $("#search").focus();
      return;
    }
    if ($("#watchView").hidden || !current) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") {
      e.preventDefault();
      video.paused ? video.play().catch(() => {}) : video.pause();
    } else if (k === "arrowleft" || k === "j") {
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - 10);
    } else if (k === "arrowright" || k === "l") {
      e.preventDefault();
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
    } else if (k === "f") {
      const p = $("#player");
      if (document.fullscreenElement) document.exitFullscreen();
      else if (p.requestFullscreen) p.requestFullscreen().catch(() => {});
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    } else if (k === "m") {
      video.muted = !video.muted;
    }
  });
})();
