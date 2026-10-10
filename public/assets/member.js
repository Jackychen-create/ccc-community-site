// 研究員前台：登入／註冊、影片列表、播放頁
(function () {
  "use strict";
  const A = window.App;
  const { el, $, api, sb, icon, icons } = A;

  const SITE = A.cfg.SITE_NAME || "交易實驗室";
  const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
  const DAY = 86400000;

  let me = null;
  let videos = [];
  let loadedList = false;
  let filter = "all";
  let host = ""; // 主講人篩選，空字串＝全部
  let query = "";
  let searchMissTimer = null;
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
      // 不是帳號的問題（網路斷線、網站設定、伺服器錯誤），不要讓研究員以為自己被停權
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
    renderVolPanel();
    // 這個瀏覽器第一次進來：問要不要看使用教學（只問一次；老研究員看到的是「網站更新了」）
    const firstVisit = !A.store.get("seenVersion", null);
    A.whatsNew();
    if (firstVisit && !me.isAdmin && !A.store.get("tutorialOffered", false)) offerTutorial();
    if (!routerOn) {
      routerOn = true;
      window.addEventListener("hashchange", route);
    }
    route();
  }

  async function offerTutorial() {
    A.store.set("tutorialOffered", true);
    const yes = await A.confirmDialog({
      title: "歡迎加入交易實驗室",
      message: "第一次來？花 2 分鐘看使用教學：怎麼找影片、接著看、章節、筆記和每月交易量。之後也可以在右上角選單打開。",
      confirmText: "看使用教學",
      cancelText: "之後再看",
    });
    if (yes) A.tutorial();
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
    $("#authTitle").textContent = reg ? "加入實驗室" : "登入";
    $("#authSub").textContent = reg ? "輸入實驗室密碼，建立你的帳號" : "登入以觀看直播留檔";
    $("#pwLabel").textContent = reg ? "設定你的登入密碼（至少 8 個字元）" : "密碼";
    $("#password").autocomplete = reg ? "new-password" : "current-password";
    $("#authSubmit").textContent = reg ? "建立帳號並登入" : "登入";
    setAuthError("");
  }
  $("#tabLogin").addEventListener("click", () => setMode("login"));
  $("#tabRegister").addEventListener("click", () => setMode("register"));

  $("#authTutorial").addEventListener("click", (e) => {
    e.preventDefault();
    A.tutorial();
  });
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
    $("#menuBtn").classList.toggle("has-dot", !!me?.feedbackUnread);
    menuPanel.replaceChildren(...[
      el("div", { class: "who" }, el("div", { text: "登入身分" }), el("div", { style: { color: "var(--ink)" }, text: me?.email || "" })),
      me?.isAdmin ? el("a", { href: "/admin", role: "menuitem" }, icon("settings"), "後台管理") : null,
      el("a", { href: "#/course", role: "menuitem", onclick: () => toggleMenu(false) }, icon("book"), "教學課程"),
      el("a", { href: "#/notes", role: "menuitem", onclick: () => toggleMenu(false) }, icon("note"), "我的筆記"),
      el("a", { href: "#/feedback", role: "menuitem", onclick: () => toggleMenu(false) }, icon("chat"), "我的提問", me?.feedbackUnread ? el("span", { class: "menu-dot", "aria-label": "有新回覆" }) : null),
      me && me.notify !== null && !me.isAdmin
        ? el("button", { type: "button", role: "menuitemcheckbox", "aria-checked": String(!!me.notify), onclick: toggleNotify },
            icon("mail"), el("span", { style: { flex: "1" }, text: "新影片寄信通知" }), el("span", { class: "menu-state" + (me.notify ? " on" : ""), text: me.notify ? "開" : "關" }))
        : null,
      el("button", { type: "button", role: "menuitem", onclick: () => { toggleMenu(false); A.tutorial(); } }, icon("play"), "使用教學"),
      me?.isAdmin ? el("button", { type: "button", role: "menuitem", onclick: () => { toggleMenu(false); A.tutorial("admin"); } }, icon("play"), "管理員使用教學") : null,
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
    const v = me.volume;
    box.replaceChildren(
      el("span", { html: icons.clock }),
      el("span", { text: days <= 0 ? `你的觀看資格今天（${until}）到期。` : `你的觀看資格到 ${until}，還有 ${days} 天。` }),
      el("span", { class: "muted", text: volHint(v) })
    );
  }

  // 資格提醒的第二句：這個月達標還能延長，就講這個月；已經到月底了，就講下個月
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  function volHint(v) {
    if (!v) return "要繼續觀看請聯絡管理員更新資格。";
    const rule = `任一間（${v.exchanges.join("、")}）當月交易量達 ${fmtWan(v.threshold)} USDT`;
    return v.qualified ? `下個月${rule}，達標那天起可以再看一個月。` : `這個月${rule}，達標那天起可以再看一個月。`;
  }

  const fmtWan = (n) => (n >= 1e4 ? `${Math.round((n / 1e4) * 10) / 10} 萬` : (Number(n) || 0).toLocaleString("en-US"));

  // 右欄：本月交易量（管理員在後台填，任一間達標就有當月資格）
  function renderVolPanel() {
    const box = $("#volPanel");
    const v = me?.volume;
    if (!v) return (box.hidden = true);
    box.hidden = false;
    const monthNo = Number(v.month.slice(5));
    const best = Math.max(0, ...v.exchanges.map((ex) => Number(v.amounts?.[ex] || 0)));
    box.replaceChildren(
      el("div", { class: "panel-head", style: { padding: "14px 18px" } },
        el("h2", { text: `${monthNo} 月交易量` }),
        v.qualified ? el("span", { class: "pill good" }, el("span", { class: "dot" }), "已達標")
          : el("span", { class: "pill" }, v.amounts ? `還差 ${fmtWan(Math.max(0, v.threshold - best))}` : "尚未更新")),
      el("div", { class: "vol-rows" },
        ...v.exchanges.map((ex) => {
          const n = Number(v.amounts?.[ex] || 0);
          return el("div", { class: "vol-row" + (n >= v.threshold ? " ok" : "") },
            el("span", { class: "vol-ex", text: ex }),
            el("span", { class: "num vol-n", text: v.amounts ? fmtWan(n) : "—" }),
            el("span", { class: "track" }, el("i", { style: { width: Math.min(100, (n / v.threshold) * 100) + "%" } })));
        })),
      el("p", { class: "small muted vol-note", text: (v.qualifiedAt ? `${md(v.qualifiedAt)} 達標，可以看到 ${md(v.qualifiedUntil)}。` : `任一間當月成交金額達 ${fmtWan(v.threshold)} USDT，達標那天起可以看一個月（例如 10/15 達標，看到 11/14）。`) + (v.updatedAt ? `數字由管理員更新（${A.fmtRel(v.updatedAt)}）。` : "數字由管理員每月更新。") })
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
    else if (location.hash === "#/course") openCourse();
    else if (location.hash === "#/feedback") openFeedback();
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
    $("#courseView").hidden = true;
    $("#feedbackView").hidden = true;
    $("#listView").hidden = false;
    setNav("list");
    $("#searchBox").hidden = false;
    document.title = SITE;
    if (!loadedList) renderSkeleton();
    else {
      renderList();
      requestAnimationFrame(() => window.scrollTo(0, listScroll));
    }
    loadRecentNotes();
    loadCourse();
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
      const q = query.trim();
      clearTimeout(searchMissTimer);
      if (q.length >= 2) searchMissTimer = setTimeout(() => query.trim() === q && A.report("search_empty", q, { q }), 1500);
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
    $("#courseView").hidden = true;
    $("#feedbackView").hidden = true;
    $("#watchView").hidden = false;
    setNav(null);
    setWatchBack(false);
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
      if (e.code === "locked") {
        $("#videoLoading").hidden = true;
        setWatchBack(true);
        $("#wTitle").textContent = "這一份課程還沒解鎖";
        $("#wDesc").textContent = `${e.data.unlock_on} 解鎖。先看看已經解鎖的課程吧。`;
        return;
      }
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
    if (d.course_host) {
      setWatchBack(true);
      $("#wDate").textContent = "課程";
      meta.replaceChildren(el("span", null, "教學課程・", el("span", { class: "host", text: d.course_host }), ` 第 ${d.course_part} 份`));
    } else if (d.hosts?.length) meta.append(el("span", null, "主講 ", ...d.hosts.map((h) => el("span", { class: "host", text: h }))));
    if (d.duration_sec) meta.append(el("span", { class: "num", text: A.fmtDur(d.duration_sec) }));
    if (!d.is_published) meta.append(el("span", { class: "pill warn", text: "草稿預覽（研究員看不到）" }));
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

  // ── 浮水印（防外流）：研究員 Email 在畫面上定時換位置，全螢幕時一起顯示 ──
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
    seen = {};
    lastBucket = -1;
    stopWatermark();
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  // 觀看分段：每 30 秒一格，播放時每進到一格記一次（倒回去重看會再記一次），存進度時一起送出
  const BUCKET = 30;
  let seen = {};
  let lastBucket = -1;
  video.addEventListener("timeupdate", () => {
    if (!current || video.paused || video.seeking) return;
    const b = Math.floor(video.currentTime / BUCKET);
    if (b !== lastBucket) {
      seen[b] = (seen[b] || 0) + 1;
      lastBucket = b;
    }
  });
  video.addEventListener("seeking", () => (lastBucket = -1));

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
    const body = { videoId: current.id, position: pos, duration: dur };
    if (Object.keys(seen).length) {
      body.seen = seen;
      seen = {};
    }
    api("/api/progress", { method: "POST", body, keepalive: true }).catch(() => {});
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
  // ─────────────────────────────────────────────
  // 頂部導覽、教學課程
  // ─────────────────────────────────────────────
  function setNav(which) {
    $("#navList").toggleAttribute("aria-current", which === "list");
    $("#navCourse").toggleAttribute("aria-current", which === "course");
    if (which) $(which === "list" ? "#navList" : "#navCourse").setAttribute("aria-current", "page");
  }
  function setWatchBack(isCourse) {
    const a = $("#watchBack");
    a.href = isCourse ? "#/course" : "#/";
    a.lastChild.textContent = isCourse ? "教學課程" : "直播留檔";
  }

  let course = null;
  async function loadCourse() {
    try {
      course = await api("/api/course");
    } catch {
      course = null;
    }
    renderCoursePanel();
    if (!$("#courseView").hidden) renderCourse();
    return course;
  }
  const slotName = (s) => `${s.host} 第 ${s.part} 份`;

  // 右欄：最新解鎖的一份＋下一份什麼時候解鎖
  function renderCoursePanel() {
    const box = $("#coursePanel");
    if (!course?.slots?.length) return (box.hidden = true);
    const open = course.slots.filter((s) => s.unlocked);
    const latest = open[open.length - 1];
    const next = course.slots.find((s) => !s.unlocked);
    const done = open.filter((s) => s.video && s.video.duration_sec && s.video.position_sec >= s.video.duration_sec * 0.95).length;
    box.hidden = false;
    box.replaceChildren(
      el("div", { class: "panel-head", style: { padding: "14px 18px" } },
        el("h2", { text: "教學課程" }),
        el("span", { class: "small muted num", text: `${open.length}／${course.slots.length} 已解鎖` })),
      el("div", { class: "course-mini" },
        latest
          ? el("a", { class: "course-latest", href: latest.video?.id ? `#/v/${latest.video.id}` : "#/course" },
              el("span", { class: "host", text: latest.host }),
              el("span", { class: "grow" },
                el("div", { class: "small muted", text: `第 ${latest.week} 週・${slotName(latest)}` }),
                el("div", { class: "vtitle", text: latest.video?.title || "準備中，上架後就能看" })),
              latest.video?.id ? el("span", { class: "dl", html: icons.play }) : null)
          : null,
        el("span", { class: "usage" }, el("span", { class: "track" }, el("i", { style: { width: (done / course.slots.length) * 100 + "%" } }))),
        el("p", { class: "small muted", text: next ? `下一份：${slotName(next)}，${md(next.unlock_on)} 解鎖` : "全部都解鎖了" }),
        el("a", { class: "btn block", href: "#/course" }, "看全部課程"))
    );
  }

  async function openCourse() {
    leaveWatch();
    $("#listView").hidden = true;
    $("#watchView").hidden = true;
    $("#notesView").hidden = true;
    $("#feedbackView").hidden = true;
    $("#courseView").hidden = false;
    $("#searchBox").hidden = true;
    setNav("course");
    document.title = `教學課程｜${SITE}`;
    window.scrollTo(0, 0);
    if (course) renderCourse();
    else $("#courseList").replaceChildren(el("div", { class: "skel-row" }, el("i"), el("div", null, el("i"), el("i"))));
    await loadCourse();
    if (!course) $("#courseList").replaceChildren(emptyBox("讀不到課程", "請稍後再試。", true));
  }

  function renderCourse() {
    const slots = course.slots;
    const open = slots.filter((s) => s.unlocked).length;
    $("#courseCount").textContent = `已解鎖 ${open}／${slots.length}`;
    // 進度條：每一格是一份，休息週留空隙
    $("#courseTrack").replaceChildren(...slots.map((s, i) => {
      const v = s.video;
      const done = v?.duration_sec && v.position_sec >= v.duration_sec * 0.95;
      const gap = i > 0 && i % 3 === 0;
      return el("i", { class: [s.unlocked ? "on" : "", done ? "done" : "", gap ? "gap" : ""].join(" ").trim() });
    }));
    $("#courseList").replaceChildren(...slots.map((s) => {
      const v = s.video;
      const status = !s.unlocked
        ? el("span", { class: "st todo" }, el("span", { html: icons.lock }), `${md(s.unlock_on)} 解鎖`)
        : !v ? el("span", { class: "st todo", text: "準備中" })
        : statusOf(v);
      const body = el("span", { style: { minWidth: "0" } },
        el("div", { class: "vtitle" }, el("span", { class: "host", text: s.host }), " ", el("span", { text: `第 ${s.part} 份` }), v?.title ? el("span", { class: "course-title", text: `　${v.title}` }) : null),
        v?.description && s.unlocked ? el("div", { class: "vdesc", text: v.description }) : null,
        s.unlocked && v?.duration_sec ? el("div", { class: "vm" }, el("span", { text: A.fmtDur(v.duration_sec) })) : null);
      const cls = "vrow course-row" + (s.unlocked ? "" : " locked") + (s.unlocked && v?.id ? "" : " static");
      const kids = [
        el("span", { class: "vdate" }, `${s.week}`, el("small", { text: `第 ${s.week} 週` })),
        body,
        el("span", { class: "vfig r" + (v?.duration_sec && s.unlocked ? "" : " dim"), text: v?.duration_sec && s.unlocked ? A.fmtDur(v.duration_sec) : "—" }),
        el("span", { class: "vfig r" + (v?.attachment_count ? "" : " dim"), text: v?.attachment_count ? String(v.attachment_count) : "—" }),
        el("span", { class: "r" }, status),
      ];
      return s.unlocked && v?.id ? el("a", { class: cls, href: `#/v/${v.id}` }, ...kids) : el("div", { class: cls }, ...kids);
    }));
  }

  // ─────────────────────────────────────────────
  // 提問／回報
  // ─────────────────────────────────────────────
  function askQuestion(kindInit = "question") {
    const at = current && video.duration ? Math.floor(video.currentTime) : null;
    let kind = kindInit;
    let withTime = at !== null;
    const kinds = [["question", "問內容"], ["problem", "回報問題（播放、網站）"]].map(([k, label]) => {
      const b = el("button", { class: "chip", type: "button", "aria-pressed": String(kind === k), text: label });
      b.addEventListener("click", () => { kind = k; kinds.forEach((x, i) => x.setAttribute("aria-pressed", String(["question", "problem"][i] === kind))); paint(); });
      return b;
    });
    const timeChip = at !== null ? el("button", { class: "chip", type: "button", "aria-pressed": "true" }, icon("clock"), ` 在 ${A.fmtDur(at)} 這裡`) : null;
    if (timeChip) timeChip.addEventListener("click", () => { withTime = !withTime; timeChip.setAttribute("aria-pressed", String(withTime)); });
    const ta = el("textarea", { class: "textarea", rows: "5", maxlength: "2000" });
    const err = el("div", { class: "form-error", role: "alert", hidden: true });
    const send = el("button", { class: "btn primary", type: "button", text: "送出" });
    const paint = () => (ta.placeholder = kind === "question"
      ? "哪裡聽不懂、想再多講一點、或對這段有疑問，都可以問。例如：這裡停損為什麼放在前低下面？"
      : "遇到什麼問題？例如：影片卡住、聲音不同步、教材打不開。寫下用手機還是電腦會更好查。");
    paint();
    const m = A.modal({
      title: current ? `提問：${current.title}` : "提問／回報",
      body: el("div", null,
        el("div", { class: "chips", style: { marginTop: "14px" } }, ...kinds, timeChip),
        el("label", { class: "field" }, el("span", { class: "sr-only", text: "內容" }), ta),
        el("p", { class: "hint", text: "管理員回覆後會寄信給你，也可以在右上角「我的提問」看到。" }),
        err),
      actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }), send],
    });
    if (current) video.pause();
    setTimeout(() => ta.focus(), 30);
    send.addEventListener("click", async () => {
      if (!ta.value.trim()) { err.textContent = "請寫下你的問題"; err.hidden = false; return; }
      A.setBusy(send, true, "送出中…");
      try {
        await api("/api/feedback", { method: "POST", body: { kind, body: ta.value, videoId: current?.id ?? null, t: current && withTime ? at : null } });
        m.close();
        A.toast("已送出，回覆會寄到你的 Email");
      } catch (e) {
        A.setBusy(send, false);
        err.textContent = e.message; err.hidden = false;
      }
    });
  }
  $("#askBtn").addEventListener("click", () => askQuestion("question"));

  async function openFeedback() {
    leaveWatch();
    for (const id of ["#listView", "#watchView", "#notesView", "#courseView"]) $(id).hidden = true;
    $("#feedbackView").hidden = false;
    $("#searchBox").hidden = true;
    setNav(null);
    document.title = `我的提問｜${SITE}`;
    window.scrollTo(0, 0);
    const box = $("#feedbackList");
    box.replaceChildren(el("div", { class: "skel-row" }, el("i"), el("div", null, el("i"), el("i"))));
    let list = [];
    try {
      list = (await api("/api/feedback")).feedback || [];
    } catch (e) {
      return handleErr(e, () => box.replaceChildren(emptyBox("讀不到提問", e.message, true)));
    }
    if (me) { me.feedbackUnread = 0; renderMenu(); }
    $("#feedbackCount").textContent = list.length ? `共 ${list.length} 則` : "";
    if (!list.length) return box.replaceChildren(emptyBox("還沒有提問", "看影片時按「提問」，就能針對那個時間點發問。"));
    box.replaceChildren(...list.map((f) =>
      el("article", { class: "fb" + (f.is_new ? " is-new" : "") },
        el("div", { class: "fb-head" },
          el("span", { class: "pill" + (f.kind === "problem" ? " warn" : ""), text: f.kind === "problem" ? "回報問題" : "提問" }),
          f.video_id ? el("a", { class: "small", href: `#/v/${f.video_id}${f.t != null ? `?t=${f.t}` : ""}` }, f.video_title || "影片", f.t != null ? el("span", { class: "num", text: ` ${A.fmtDur(f.t)}` }) : null) : null,
          el("span", { class: "spacer" }),
          el("span", { class: "small muted", text: A.fmtRel(f.created_at) })),
        el("p", { class: "fb-body", text: f.body }),
        f.reply
          ? el("div", { class: "fb-reply" }, el("div", { class: "small muted" }, "管理員回覆・", A.fmtRel(f.replied_at), f.is_new ? el("span", { class: "pill brass", style: { marginLeft: "8px" }, text: "新回覆" }) : null), el("p", { text: f.reply }))
          : el("p", { class: "small muted", text: f.status === "done" ? "已處理" : "等待回覆中" }))));
  }

  async function openNotes() {
    leaveWatch();
    $("#listView").hidden = true;
    $("#watchView").hidden = true;
    $("#courseView").hidden = true;
    $("#feedbackView").hidden = true;
    $("#notesView").hidden = false;
    setNav(null);
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
    A.report("video", `播放失敗（錯誤碼 ${video.error?.code ?? "?"}）`, { video: current.id, title: current.title });
    setNotice(el("div", { class: "notice" }, el("span", { html: icons.alert }),
      el("span", { text: "影片暫時無法播放，請重新整理頁面，或確認瀏覽器支援這個格式。" }),
      el("span", { class: "spacer" }),
      el("button", { class: "btn sm", type: "button", text: "回報這個問題", onclick: () => askQuestion("problem") })));
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
