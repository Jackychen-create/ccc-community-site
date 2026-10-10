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
  let host = ""; // 主講人篩選，空字串＝全部
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
      // 不是帳號的問題（網路斷線、網站設定、伺服器錯誤），不要讓會員以為自己被停權
      show("blockedView");
      $("#blockedTitle").textContent = "網站暫時無法使用";
      $("#blockedMsg").textContent = e.status === 0 ? "連線失敗，請檢查網路後再試一次。" : e.message;
      $("#blockedRetry").hidden = false;
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
    renderAccessBanner();
    A.whatsNew();
    if (!routerOn) {
      routerOn = true;
      window.addEventListener("hashchange", route);
    }
    route();
  }

  function showBlocked(msg) {
    show("blockedView");
    $("#blockedTitle").textContent = "沒有觀看權限";
    $("#blockedRetry").hidden = true;
    $("#blockedMsg").textContent = msg || "這個帳號目前沒有觀看權限，請聯絡管理員。";
  }
  $("#blockedLogout").addEventListener("click", () => sb.auth.signOut());
  $("#blockedRetry").addEventListener("click", () => location.reload());

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
    loadBoard();
  }

  // 登入頁上方的小看板：最新一場的日期、累計場次（不含任何影片內容）
  let boardLoaded = false;
  async function loadBoard() {
    if (boardLoaded) return;
    try {
      const r = await api("/api/stats");
      boardLoaded = true;
      if (r.latest) {
        $("#statLatest").textContent = shortDate(r.latest);
      }
      const n = document.createTextNode("0");
      $("#statCount").replaceChildren(n, el("span", { text: "場" }));
      A.countUp(n, r.count || 0);
      $("#authBoard").classList.add("tick");
    } catch {}
  }

  function setMode(m) {
    mode = m;
    const reg = m === "register";
    $("#tabLogin").setAttribute("aria-selected", String(!reg));
    $("#tabRegister").setAttribute("aria-selected", String(reg));
    $("#inviteRow").hidden = !reg;
    $("#invite").required = reg;
    $("#authTitle").textContent = reg ? "加入會員" : "登入";
    $("#authSub").textContent = reg ? "輸入實驗室密碼，建立你的帳號" : "登入以觀看直播留檔";
    $("#pwLabel").textContent = reg ? "設定你的登入密碼（至少 8 個字元）" : "密碼";
    $("#password").autocomplete = reg ? "new-password" : "current-password";
    $("#authSubmit").textContent = reg ? "建立帳號並登入" : "登入";
    setAuthError("");
  }
  $("#tabLogin").addEventListener("click", () => setMode("login"));
  $("#tabRegister").addEventListener("click", () => setMode("register"));

  const reveal = $("#revealPw");
  reveal.innerHTML = icons.eyeOff; // 預設密碼是隱藏的：顯示斜線眼睛
  reveal.addEventListener("click", () => {
    const pw = $("#password");
    const showing = pw.type === "text";
    pw.type = showing ? "password" : "text";
    reveal.innerHTML = showing ? icons.eyeOff : icons.eye; // 看得到密碼 = 張開的眼睛
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
    // 登入不檢查長度（管理員在 Supabase 建的帳號密碼可能比較短）；註冊才要求至少 8 個字元
    if (!password) return setAuthError("請輸入密碼");
    if (mode === "register" && password.length < 8) return setAuthError("密碼至少需要 8 個字元");
    if (mode === "register" && !invite) return setAuthError("請輸入實驗室密碼");

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
    menuPanel.replaceChildren(...[
      el("div", { class: "who" }, el("div", { text: "登入身分" }), el("div", { style: { color: "var(--ink)" }, text: me?.email || "" })),
      me?.isAdmin ? el("a", { href: "/admin", role: "menuitem" }, icon("settings"), "後台管理") : null,
      el("a", { href: "#/notes", role: "menuitem", onclick: () => toggleMenu(false) }, icon("note"), "我的筆記"),
      me && me.notify !== null && !me.isAdmin
        ? el("button", { type: "button", role: "menuitemcheckbox", "aria-checked": String(!!me.notify), onclick: toggleNotify },
            icon("mail"), el("span", { style: { flex: "1" }, text: "新影片寄信通知" }), el("span", { class: "menu-state" + (me.notify ? " on" : ""), text: me.notify ? "開" : "關" }))
        : null,
      el("button", { type: "button", role: "menuitem", onclick: () => { toggleMenu(false); A.whatsNew({ all: true }); } }, icon("news"), "更新紀錄"),
      el("button", { type: "button", role: "menuitem", onclick: changePassword }, icon("key"), "修改密碼"),
      el("button", { type: "button", role: "menuitem", onclick: () => sb.auth.signOut() }, icon("logout"), "登出"),
    ].filter(Boolean));
  }
  async function toggleNotify() {
    const next = !me.notify;
    try {
      await api("/api/me", { method: "PATCH", body: { notify: next } });
      me.notify = next;
      renderMenu();
      A.toast(next ? "新影片上架時會寄信通知你" : "已關閉新影片寄信通知");
    } catch (e) {
      A.toast(e.message, "err");
    }
  }

  // 每月資格：到期前 7 天提醒
  function renderAccessBanner() {
    const box = $("#accessBanner");
    const until = me?.accessUntil;
    if (!until) return (box.hidden = true);
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const days = Math.round((Date.parse(until) - Date.parse(today)) / DAY);
    if (days > 7) return (box.hidden = true);
    box.hidden = false;
    box.replaceChildren(
      el("span", { html: icons.clock }),
      el("span", { text: days <= 0 ? `你的觀看資格今天（${until}）到期。` : `你的觀看資格到 ${until}，還有 ${days} 天。` }),
      el("span", { class: "muted", text: "要繼續觀看請聯絡管理員更新資格。" })
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
    const m = location.hash.match(/^#\/v\/(\d+)(?:\?t=(\d+))?/);
    if (m) openWatch(Number(m[1]), { t: m[2] !== undefined ? Number(m[2]) : null });
    else if (location.hash === "#/notes") openNotes();
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
    asideAnimated = false;
    leaveWatch();
    $("#watchView").hidden = true;
    $("#notesView").hidden = true;
    $("#listView").hidden = false;
    $("#searchBox").hidden = false;
    document.title = SITE;
    if (!loadedList) renderSkeleton();
    else {
      renderList();
      requestAnimationFrame(() => window.scrollTo(0, listScroll));
    }
    loadRecentNotes();
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
    $("#continueList").replaceChildren(el("div", { class: "skel-row", "aria-hidden": "true" }, el("i"), el("div", null, el("i"), el("i"))));
    $("#statsPanel").replaceChildren();
    $("#chips").replaceChildren();
    $("#countText").textContent = "";
    const items = [];
    for (let i = 0; i < 6; i++) items.push(el("div", { class: "skel-row", "aria-hidden": "true" }, el("i"), el("div", null, el("i"), el("i"))));
    $("#grid").replaceChildren(...items);
  }

  function monthKey(v) {
    return String(v.published_at).slice(0, 7);
  }
  function monthLabel(k) {
    const [y, m] = k.split("-");
    return Number(y) === new Date().getFullYear() ? `${Number(m)} 月` : `${y} 年 ${Number(m)} 月`;
  }
  function shortDate(d) {
    const s = String(d).slice(0, 10);
    return `${Number(s.slice(5, 7))}/${s.slice(8, 10)}`;
  }
  const WD = "日一二三四五六";
  function weekday(d) {
    const s = String(d).slice(0, 10);
    const t = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
    return "週" + WD[t.getDay()];
  }

  function renderChips() {
    const months = [...new Set(videos.map(monthKey))];
    const opts = [["all", "全部"], ["unfinished", "未看完"], ...months.map((k) => ["m:" + k, monthLabel(k)])];
    if (!opts.some(([k]) => k === filter)) filter = "all";
    const hosts = hostList();
    if (host && !hosts.includes(host)) host = "";
    $("#chips").replaceChildren(...[
      ...opts.map(([k, label]) =>
        el("button", {
          class: "chip", type: "button", "aria-pressed": String(filter === k), text: label,
          onclick: () => {
            filter = k;
            renderList();
          },
        })
      ),
      hosts.length > 1 ? el("span", { class: "chip-sep", "aria-hidden": "true" }) : null,
      ...(hosts.length > 1 ? hosts : []).map((h) =>
        el("button", {
          class: "chip host-chip", type: "button", "aria-pressed": String(host === h), title: `只看 ${h} 主講的場次`, text: h,
          onclick: () => {
            host = host === h ? "" : h;
            renderList();
          },
        })
      ),
    ].filter(Boolean));
  }

  // 有出現在影片裡的主講人，照 config.js 的順序排
  function hostList() {
    const used = new Set(videos.flatMap((v) => v.hosts || []));
    const order = A.cfg.HOSTS || [];
    return [...order.filter((h) => used.has(h)), ...[...used].filter((h) => !order.includes(h))];
  }
  // 搜尋到章節時，列出符合的章節，點了直接跳到那個時間
  function chapterHits(v) {
    const q = query.trim().toLowerCase();
    if (!q || !v.chapters?.length) return null;
    const hits = v.chapters.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 3);
    if (!hits.length) return null;
    return el("div", { class: "chap-hits" }, ...hits.map((c) =>
      el("span", { class: "chap-hit", role: "link", tabindex: "0", onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        location.hash = `#/v/${v.id}?t=${c.t}`;
      } }, el("b", { class: "num", text: A.fmtDur(c.t) }), c.title)));
  }

  function hostTags(v) {
    return v.hosts?.length ? el("div", { class: "hosts" }, ...v.hosts.map((h) => el("span", { class: "host", text: h }))) : null;
  }

  function filtered() {
    const q = query.trim().toLowerCase();
    return videos.filter((v) => {
      if (filter === "unfinished" && isWatched(v)) return false;
      if (filter.startsWith("m:") && monthKey(v) !== filter.slice(2)) return false;
      if (host && !(v.hosts || []).includes(host)) return false;
      if (q && !`${v.title} ${v.description || ""} ${(v.hosts || []).join(" ")} ${(v.chapters || []).map((c) => c.title).join(" ")}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  let ticked = false; // 新上架的那一列只在第一次顯示時跳一下
  let asideAnimated = false; // 右側統計數字、進度條：進到列表時跑一次

  function renderList() {
    renderChips();
    renderTicker();
    const list = filtered();
    $("#countText").textContent = videos.length ? `共 ${videos.length} 場` : "";
    renderAside();

    if (!videos.length) {
      $("#grid").replaceChildren(emptyBox("目前還沒有影片", "新的直播留檔上傳後會出現在這裡。"));
      return;
    }
    if (!list.length) {
      const box = emptyBox("找不到符合的場次", query.trim() ? `沒有標題或簡介包含「${query.trim()}」的場次。` : "換個篩選條件試試看。");
      box.append(el("button", { class: "btn sm", type: "button", style: { marginTop: "14px" }, text: "顯示全部場次", onclick: () => {
        filter = "all";
        host = "";
        query = "";
        $("#search").value = "";
        renderList();
      } }));
      $("#grid").replaceChildren(box);
      return;
    }
    $("#grid").replaceChildren(...list.map(row));
    ticked = true;
  }

  function renderTicker() {
    const t = $("#ticker");
    if (!videos.length) return t.replaceChildren();
    t.replaceChildren(
      el("span", null, "最新一場", el("b", { text: shortDate(videos[0].published_at) })),
      el("span", null, "累計", el("b", { text: String(videos.length) }), " 場")
    );
  }

  function statusOf(v, { compact = false } = {}) {
    if (isNew(v)) return el("span", { class: "st new" }, el("span", { html: icons.up }), compact ? "新" : "新上架");
    if (isWatched(v)) return el("span", { class: "st done", text: "看完" });
    const p = pctOf(v);
    if (p > 0.01) {
      const pct = Math.round(p * 100);
      return el("span", { class: "st part" }, `${pct}%`, compact ? null : el("span", { class: "meter" + (ticked ? "" : " grow") }, el("i", { style: { width: pct + "%" } })));
    }
    return el("span", { class: "st todo", text: "未看" });
  }

  function emptyBox(title, text, retry) {
    const box = el("div", { class: "empty" },
      el("span", { html: icons.film, style: { display: "block" } }),
      el("h2", { text: title }),
      el("p", { class: "small", text })
    );
    if (retry) box.append(el("button", { class: "btn sm", type: "button", style: { marginTop: "14px" }, text: "重新整理", onclick: openList }));
    return box;
  }

  function thumbBox(v) {
    const box = el("div", { class: "screen" });
    if (v.thumb_url) box.append(A.thumbImg(v.thumb_url));
    else box.append(A.placeholderSvg());
    return box;
  }

  function row(v) {
    const fresh = isNew(v);
    const dur = v.duration_sec ? A.fmtDur(v.duration_sec) : "—";
    const files = v.attachment_count || 0;
    return el("a", { class: "vrow" + (fresh ? " is-new" + (ticked ? "" : " tick") : ""), href: `#/v/${v.id}` },
      el("span", { class: "vdate" }, shortDate(v.published_at), el("small", { text: weekday(v.published_at) })),
      el("span", { style: { minWidth: "0" } },
        el("div", { class: "vtitle", text: v.title }),
        v.description ? el("div", { class: "vdesc", text: v.description }) : null,
        hostTags(v),
        chapterHits(v),
        el("div", { class: "vm" }, el("span", { text: dur }), files ? el("span", { text: `教材 ${files}` }) : null)
      ),
      el("span", { class: "vfig r" + (v.duration_sec ? "" : " dim"), text: dur }),
      el("span", { class: "vfig r" + (files ? "" : " dim"), text: files ? String(files) : "—" }),
      el("span", { class: "r" }, statusOf(v))
    );
  }

  // 右側：上次看到哪一場、本月統計、最近的筆記、快捷鍵（一直都在，不讓右邊空著）
  function renderAside() {
    const box = $("#continueList");
    const animate = !asideAnimated;
    asideAnimated = true;
    const numNode = (n) => {
      const t = document.createTextNode(String(n));
      if (animate) A.countUp(t, n);
      return t;
    };

    // 統計
    const thisMonth = new Date().toISOString().slice(0, 7);
    const watchedThisMonth = videos.filter((v) => v.position_sec > 0 && String(v.watched_at || "").slice(0, 7) === thisMonth).length;
    const unfinished = videos.filter((v) => !isWatched(v)).length;
    const done = videos.filter(isWatched).length;
    const stat = (label, n) => el("div", null, el("small", { text: label }), el("b", null, numNode(n), el("span", { text: "場" })));
    $("#statsPanel").replaceChildren(
      el("div", { class: "stats stats-4" }, stat("這個月看了", watchedThisMonth), stat("未看完", unfinished), stat("看完了", done), stat("全部場次", videos.length))
    );

    // 上次看到／最新一場／還沒有影片
    if (!videos.length) {
      box.replaceChildren(el("div", { class: "resume" },
        el("span", { class: "label", text: "最新一場" }),
        el("div", { class: "screen" }, A.placeholderSvg()),
        el("div", { class: "vtitle", text: "第一場直播還沒上架" }),
        el("p", { class: "small muted", style: { marginTop: "6px" }, text: me?.notify ? "上架後會出現在這裡，也會寄信通知你。" : "上架後會出現在這裡。" })));
      return;
    }
    const cont = videos
      .filter(isInProgress)
      .sort((a, b) => new Date(b.watched_at || 0) - new Date(a.watched_at || 0));
    if (!cont.length) {
      const latest = videos[0];
      box.replaceChildren(
        el("div", { class: "resume" },
          el("span", { class: "label", text: "最新一場" }),
          el("a", { href: `#/v/${latest.id}`, style: { display: "block" } }, thumbBox(latest)),
          el("div", { class: "vtitle", text: latest.title }),
          el("div", { class: "prog" }, el("span", { text: shortDate(latest.published_at) }), el("span", { text: latest.duration_sec ? A.fmtDur(latest.duration_sec) : "" })),
          el("a", { class: "btn primary block", href: `#/v/${latest.id}` }, icon("play"), "開始看")
        )
      );
      return;
    }
    const v = cont[0];
    const pct = Math.round(pctOf(v) * 100);
    const left = v.duration_sec ? A.fmtDur(v.duration_sec - v.position_sec) : "";
    const screen = thumbBox(v);
    screen.append(el("span", { class: "tc", text: `${A.fmtDur(v.position_sec)}${v.duration_sec ? " / " + A.fmtDur(v.duration_sec) : ""}` }));
    const more = cont.slice(1, 4);
    box.replaceChildren(...[
      el("div", { class: "resume" },
        el("span", { class: "label", text: "上次看到" }),
        el("a", { href: `#/v/${v.id}`, style: { display: "block" }, "aria-label": `繼續看 ${v.title}` }, screen),
        el("div", { class: "vtitle", text: v.title }),
        el("div", { class: "prog" }, el("span", { text: shortDate(v.published_at) }), el("span", { text: left ? `剩 ${left}` : "" })),
        el("div", { class: "track" + (animate ? " grow" : "") }, el("i", { style: { width: pct + "%" } })),
        el("a", { class: "btn primary block", href: `#/v/${v.id}` }, icon("play"), `從 ${A.fmtDur(v.position_sec)} 繼續`)
      ),
      more.length ? el("div", { class: "more" }, ...more.map((m) =>
        el("a", { href: `#/v/${m.id}` }, el("span", { text: m.title }), el("span", { class: "num", text: Math.round(pctOf(m) * 100) + "%" })))) : null,
    ].filter(Boolean));
  }

  // 最近的筆記（右欄）：進到列表時抓一次
  async function loadRecentNotes() {
    const box = $("#recentNotesList");
    let list = [];
    try {
      list = (await api("/api/notes")).notes || [];
    } catch {
      return;
    }
    const recent = list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 3);
    if (!recent.length) {
      box.replaceChildren(el("p", { class: "small muted note-empty", text: "看影片時按 N 就能在那個時間點記一筆，最近的筆記會出現在這裡。" }));
      return;
    }
    box.replaceChildren(...recent.map((n) =>
      el("a", { class: "recent-note", href: `#/v/${n.video_id}?t=${n.t}` },
        el("span", { class: "num", text: A.fmtDur(n.t) }),
        el("span", null, el("span", { class: "recent-note-body", text: n.body }), el("span", { class: "small muted", text: `${shortDate(n.published_at)} ${n.video_title}` })))));
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

  async function openWatch(id, { t = null } = {}) {
    if (current && current.id === id) {
      if (t !== null) {
        video.currentTime = t;
        video.play().catch(() => {});
      }
      return;
    }
    if (!$("#listView").hidden) listScroll = window.scrollY;
    leaveWatch();
    $("#listView").hidden = true;
    $("#notesView").hidden = true;
    $("#watchView").hidden = false;
    document.body.classList.add("watching");
    renderChapters(null);
    notes = [];
    renderNotes();
    $("#searchBox").hidden = true;
    window.scrollTo(0, 0);

    $("#wTitle").textContent = "載入中…";
    $("#wDate").textContent = "";
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
    $("#wDate").textContent = shortDate(d.published_at);
    const meta = $("#wMeta");
    meta.append(el("span", { text: `${String(d.published_at).slice(0, 4)} 年・${weekday(d.published_at)}` }));
    if (d.hosts?.length) meta.append(el("span", null, "主講 ", ...d.hosts.map((h) => el("span", { class: "host", text: h }))));
    if (d.duration_sec) meta.append(el("span", { class: "num", text: A.fmtDur(d.duration_sec) }));
    if (!d.is_published) meta.append(el("span", { class: "pill warn", text: "草稿預覽（會員看不到）" }));
    $("#wDesc").textContent = d.description || "";

    if (d.attachments?.length) {
      $("#wFiles").hidden = false;
      $("#wFileList").replaceChildren(...d.attachments.map(fileRow));
    }

    const pos = d.position_sec || 0;
    const nearEnd = d.duration_sec && pos > d.duration_sec - 20;
    pendingSeek = t !== null ? t : pos >= 15 && !nearEnd ? pos : null;
    if (t !== null) jumpedTo = t;
    renderChapters(d);
    loadNotes(d.id);

    video.defaultPlaybackRate = A.store.get("speed", 1);
    startWatermark();
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
    const others = videos.filter((v) => v.id !== id).slice(0, 8);
    const box = $("#others");
    if (!others.length) {
      box.replaceChildren(el("p", { class: "small muted", text: loadedList ? "目前沒有其他場次" : "" }));
      return;
    }
    box.replaceChildren(
      ...others.map((v) =>
        el("a", { href: `#/v/${v.id}` },
          el("span", { class: "vdate", text: shortDate(v.published_at) }),
          el("span", { class: "vtitle", text: v.title }),
          statusOf(v, { compact: true })
        )
      )
    );
  }

  // ── 浮水印（防外流）：會員 Email 在畫面上定時換位置，全螢幕時一起顯示 ──
  let wmTimer = null;
  function startWatermark() {
    const box = $("#wm");
    const who = me?.email || "";
    const stamp = new Date().toISOString().slice(0, 10);
    const tile = el("div", { class: "wm-tile" });
    for (let i = 0; i < 24; i++) tile.append(el("span", { text: who }));
    const mover = el("div", { class: "wm-move", text: `${who}・${stamp}` });
    box.replaceChildren(tile, mover);
    const move = () => {
      mover.style.left = 4 + Math.random() * 56 + "%";
      mover.style.top = 6 + Math.random() * 78 + "%";
    };
    move();
    clearInterval(wmTimer);
    wmTimer = setInterval(move, 12000);
  }
  function stopWatermark() {
    clearInterval(wmTimer);
    wmTimer = null;
    $("#wm").replaceChildren();
  }

  // 全螢幕一律放大整個播放區（含浮水印），不用影片本身的全螢幕
  const player = $("#player");
  const canFs = !!(player.requestFullscreen || player.webkitRequestFullscreen);
  function toggleFullscreen() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else if (player.requestFullscreen) player.requestFullscreen().catch(() => {});
    else if (player.webkitRequestFullscreen) player.webkitRequestFullscreen();
  }
  if (!canFs) $("#fsBtn").hidden = true;
  $("#fsBtn").addEventListener("click", toggleFullscreen);
  video.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (canFs) toggleFullscreen();
  });
  player.addEventListener("contextmenu", (e) => e.preventDefault());

  function leaveWatch() {
    document.body.classList.remove("watching", "playing");
    if (current) saveProgress(true);
    current = null;
    pendingSeek = null;
    stopWatermark();
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

  // ── 章節 ──
  let chapters = [];
  let jumpedTo = null;
  function renderChapters(d) {
    chapters = d?.chapters || [];
    const has = chapters.length > 0;
    $("#wChapters").hidden = !has;
    $("#chapBar").hidden = !has;
    if (!has) {
      $("#chapList").replaceChildren();
      $("#chapBar").replaceChildren();
      return;
    }
    $("#chapCount").textContent = `${chapters.length} 段`;
    $("#chapList").replaceChildren(...chapters.map((c, i) =>
      el("button", { class: "chap", type: "button", dataset: { i }, onclick: () => seekTo(c.t) },
        el("span", { class: "num", text: A.fmtDur(c.t) }), el("span", { class: "chap-title", text: c.title }))));
    // 時間軸：每一段一格，寬度照長度
    const total = d.duration_sec || chapters[chapters.length - 1].t + 60;
    $("#chapBar").replaceChildren(
      ...chapters.map((c, i) => {
        const end = chapters[i + 1]?.t ?? total;
        return el("button", { class: "seg", type: "button", title: `${A.fmtDur(c.t)} ${c.title}`, "aria-label": `跳到 ${A.fmtDur(c.t)} ${c.title}`,
          style: { flexGrow: String(Math.max(1, end - c.t)) }, dataset: { i }, onclick: () => seekTo(c.t) }, el("i"));
      })
    );
    updateChapter();
  }
  function seekTo(t) {
    if (!isFinite(video.duration)) {
      pendingSeek = t;
      jumpedTo = t;
      return;
    }
    video.currentTime = t;
    video.play().catch(() => {});
  }
  let activeChap = -1;
  function updateChapter() {
    if (!chapters.length) return;
    const now = video.currentTime || 0;
    let idx = -1;
    chapters.forEach((c, i) => {
      if (now >= c.t) idx = i;
    });
    document.querySelectorAll("#chapBar .seg").forEach((seg, i) => {
      const c = chapters[i];
      const end = chapters[i + 1]?.t ?? (video.duration || c.t + 60);
      const f = Math.max(0, Math.min(1, (now - c.t) / Math.max(1, end - c.t)));
      seg.firstChild.style.width = f * 100 + "%";
    });
    if (idx === activeChap) return;
    activeChap = idx;
    document.querySelectorAll("#chapList .chap").forEach((b, i) => b.classList.toggle("on", i === idx));
    document.querySelectorAll("#chapBar .seg").forEach((b, i) => b.classList.toggle("on", i === idx));
  }
  video.addEventListener("timeupdate", updateChapter);
  video.addEventListener("seeked", updateChapter);
  video.addEventListener("play", () => document.body.classList.add("playing"));
  video.addEventListener("pause", () => document.body.classList.remove("playing"));
  video.addEventListener("ended", () => document.body.classList.remove("playing"));

  // ── 筆記（只有自己看得到）──
  let notes = [];
  let noteAt = 0;
  function setNoteAt(t) {
    noteAt = Math.max(0, Math.floor(t || 0));
    $("#noteAt").textContent = A.fmtDur(noteAt);
  }
  $("#noteAt").addEventListener("click", () => setNoteAt(video.currentTime));
  $("#noteBody").addEventListener("focus", () => {
    if (!$("#noteBody").value.trim()) setNoteAt(video.currentTime);
  });
  async function loadNotes(id) {
    try {
      const r = await api(`/api/notes?videoId=${id}`);
      if (current?.id !== id) return;
      notes = r.notes || [];
      renderNotes();
    } catch {}
  }
  function renderNotes() {
    const list = $("#noteList");
    if (!notes.length) {
      list.replaceChildren(el("p", { class: "small muted note-empty", text: "還沒有筆記。播放到重點時寫一句，之後點時間就能跳回來。" }));
      return;
    }
    list.replaceChildren(...notes.map((n) =>
      el("div", { class: "note" },
        el("button", { class: "note-t num", type: "button", text: A.fmtDur(n.t), "aria-label": `跳到 ${A.fmtDur(n.t)}`, onclick: () => seekTo(n.t) }),
        el("p", { class: "note-body", text: n.body }),
        el("button", { class: "btn sm ghost icon", type: "button", "aria-label": "刪除這則筆記", onclick: () => deleteNote(n) }, icon("trash")))));
  }
  $("#noteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = $("#noteBody").value.trim();
    if (!body || !current) return;
    const btn = $("#noteSave");
    A.setBusy(btn, true, "儲存中…");
    try {
      const r = await api("/api/notes", { method: "POST", body: { videoId: current.id, t: noteAt, body } });
      notes.push(r.note);
      notes.sort((a, b) => a.t - b.t);
      $("#noteBody").value = "";
      renderNotes();
      A.toast(`已記在 ${A.fmtDur(r.note.t)}`);
    } catch (err) {
      A.toast(err.message, "err");
    } finally {
      A.setBusy(btn, false);
    }
  });
  $("#noteBody").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("#noteForm").requestSubmit();
  });
  async function deleteNote(n) {
    try {
      await api(`/api/notes?id=${n.id}`, { method: "DELETE" });
      notes = notes.filter((x) => x.id !== n.id);
      renderNotes();
      if (!$("#notesView").hidden) openNotes();
    } catch (err) {
      A.toast(err.message, "err");
    }
  }

  // ── 我的筆記（全部）──
  async function openNotes() {
    leaveWatch();
    $("#listView").hidden = true;
    $("#watchView").hidden = true;
    $("#notesView").hidden = false;
    $("#searchBox").hidden = true;
    document.title = `我的筆記｜${SITE}`;
    const box = $("#notesAll");
    box.replaceChildren(el("div", { class: "skel-row" }, el("i"), el("div", null, el("i"), el("i"))));
    let all = [];
    try {
      all = (await api("/api/notes")).notes || [];
    } catch (e) {
      return handleErr(e, () => box.replaceChildren(emptyBox("讀不到筆記", e.message, true)));
    }
    $("#notesCount").textContent = all.length ? `共 ${all.length} 則` : "";
    if (!all.length) {
      box.replaceChildren(emptyBox("還沒有筆記", "看影片時在播放器下方寫一句，就會出現在這裡。"));
      return;
    }
    const groups = new Map();
    for (const n of all) {
      if (!groups.has(n.video_id)) groups.set(n.video_id, { title: n.video_title, date: n.published_at, items: [] });
      groups.get(n.video_id).items.push(n);
    }
    box.replaceChildren(...[...groups.entries()]
      .sort((a, b) => String(b[1].date).localeCompare(String(a[1].date)))
      .map(([vid, g]) =>
        el("section", { class: "note-group" },
          el("a", { class: "note-group-head", href: `#/v/${vid}` }, el("span", { class: "vdate", text: shortDate(g.date) }), el("span", { class: "vtitle", text: g.title })),
          ...g.items.map((n) =>
            el("div", { class: "note" },
              el("a", { class: "note-t num", href: `#/v/${vid}?t=${n.t}`, text: A.fmtDur(n.t) }),
              el("p", { class: "note-body", text: n.body }),
              el("button", { class: "btn sm ghost icon", type: "button", "aria-label": "刪除這則筆記", onclick: () => deleteNote(n) }, icon("trash")))))));
  }

  // 影片事件
  video.addEventListener("loadedmetadata", () => {
    $("#videoLoading").hidden = true;
    video.playbackRate = A.store.get("speed", 1);
    if (pendingSeek !== null && pendingSeek < video.duration - 5) {
      const at = pendingSeek;
      video.currentTime = at;
      if (!retried) {
        const jumped = jumpedTo !== null;
        jumpedTo = null;
        setNotice(el("div", { class: "notice" },
          el("span", { html: icons.clock }),
          el("span", { text: jumped ? `從 ${A.fmtDur(at)} 開始播放` : `已從 ${A.fmtDur(at)} 繼續播放` }),
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
      if (canFs) toggleFullscreen();
    } else if (k === "m") {
      video.muted = !video.muted;
    } else if (k === "n") {
      e.preventDefault();
      setNoteAt(video.currentTime);
      $("#noteBody").focus({ preventScroll: false });
    }
  });
})();
