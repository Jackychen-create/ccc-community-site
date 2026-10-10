// 前台與後台共用：Supabase 登入、API 呼叫、DOM 小工具、格式化、提示訊息
(function () {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  // ── 儲存（瀏覽器可能封鎖，一律包 try）──
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v === null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    },
  };

  async function token() {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token || null;
  }

  // API 呼叫：自動帶登入 token，錯誤丟出含 status 的 Error
  async function api(path, { method = "GET", body, keepalive = false } = {}) {
    const headers = {};
    const t = await token();
    if (t) headers.Authorization = "Bearer " + t;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        keepalive,
      });
    } catch {
      const e = new Error("連線失敗，請檢查網路");
      e.status = 0;
      throw e;
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error || "發生錯誤，請稍後再試");
      e.status = res.status;
      throw e;
    }
    return data;
  }

  // ── DOM ──
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v; // 只用於本檔內的固定圖示字串
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (k === "dataset") Object.assign(node.dataset, v);
        else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }
  const $ = (sel, root = document) => root.querySelector(sel);

  // ── 圖示（固定字串）──
  const s = (d, w = 16, extra = "") =>
    `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
  const icons = {
    logo: `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="1" y="1" width="20" height="20" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 15l4-5 3 3 4-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    up: `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5L9.2 8.5H.8z" fill="currentColor"/></svg>`,
    play: `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v13l11-6.5z" fill="currentColor"/></svg>`,
    search: s('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
    back: s('<path d="M15 6l-6 6 6 6"/>'),
    file: s('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', 14),
    download: s('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>'),
    clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    news: s('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
    check: s('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 14),
    alert: s('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>'),
    ok: s('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>'),
    eye: s('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 18),
    eyeOff: s('<path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 18),
    logout: s('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>'),
    key: s('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>'),
    settings: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    video: s('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4-2.5z"/>'),
    users: s('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 5a3.5 3.5 0 0 1 0 6.5M18 14.3c2 .7 3.5 2.5 3.5 5.7"/>'),
    ticket: s('<path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4 2 2 0 0 0 0-4V6H3z"/><path d="M14 6v12" stroke-dasharray="2 2"/>'),
    upload: s('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>', 28),
    trash: s('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', 15),
    edit: s('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', 15),
    copy: s('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', 15),
    x: s('<path d="M6 6l12 12M18 6L6 18"/>', 18),
    plus: s('<path d="M12 5v14M5 12h14"/>'),
    paperclip: s('<path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.5-7.5"/>', 14),
    film: s('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4"/>', 28),
    ext: s('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 15),
  };
  function icon(name) {
    const span = document.createElement("span");
    span.style.display = "inline-flex";
    span.innerHTML = icons[name] || "";
    return span.firstElementChild || span;
  }

  // 沒有封面時的示意圖（淡淡的 K 線）
  const PH_CANDLES = [[18,96,120,104,114],[40,90,116,98,108],[62,74,104,80,96],[84,80,110,86,92],[106,62,94,70,84],
    [128,66,96,72,78],[150,50,84,58,70],[172,56,90,62,82],[194,46,78,52,64],[216,40,72,46,58],[238,48,80,54,70],
    [260,34,66,40,50],[282,28,60,34,46],[304,36,70,42,60]];
  function placeholderSvg(cls = "ph") {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 320 180");
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.setAttribute("class", cls);
    svg.setAttribute("aria-hidden", "true");
    PH_CANDLES.forEach(([x, hi, lo, top, bot], i) => {
      const up = i % 3 !== 1;
      const line = document.createElementNS(ns, "line");
      for (const [k, v] of [["x1", x], ["x2", x], ["y1", hi + 20], ["y2", lo + 20], ["stroke", "currentColor"], ["stroke-width", "1.5"]]) line.setAttribute(k, v);
      const rect = document.createElementNS(ns, "rect");
      for (const [k, v] of [["x", x - 6], ["y", top + 20], ["width", 12], ["height", bot - top], ["stroke", "currentColor"], ["stroke-width", "1.5"], ["fill", up ? "var(--sunken)" : "currentColor"]]) rect.setAttribute(k, v);
      svg.append(line, rect);
    });
    return svg;
  }

  // 封面圖：載入失敗就換成示意圖
  function thumbImg(src) {
    const img = el("img", { src, alt: "", loading: "lazy", decoding: "async" });
    img.addEventListener("error", () => img.replaceWith(placeholderSvg()), { once: true });
    return img;
  }

  // ── 格式化 ──
  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s2 = String(sec % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s2}` : `${m}:${s2}`;
  }
  function fmtLeft(sec) {
    const m = Math.round(sec / 60);
    if (m < 1) return "不到 1 分鐘";
    if (m < 60) return `剩 ${m} 分鐘`;
    const h = Math.floor(m / 60);
    return `剩 ${h} 小時${m % 60 ? ` ${m % 60} 分` : ""}`;
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + " GB";
    if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " B";
  }
  function fmtDate(v) {
    if (!v) return "";
    return String(v).slice(0, 10);
  }
  function fmtRel(iso) {
    if (!iso) return "從未";
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return "剛剛";
    if (d < 3600) return `${Math.floor(d / 60)} 分鐘前`;
    if (d < 86400) return `${Math.floor(d / 3600)} 小時前`;
    if (d < 86400 * 30) return `${Math.floor(d / 86400)} 天前`;
    return fmtDate(iso);
  }
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ── 提示訊息 ──
  let toastsBox;
  function toast(msg, kind = "ok") {
    if (!toastsBox) {
      toastsBox = el("div", { class: "toasts", role: "status", "aria-live": "polite" });
      document.body.append(toastsBox);
    }
    const t = el("div", { class: "toast " + kind }, icon(kind === "err" ? "alert" : "ok"), el("span", { text: msg }));
    toastsBox.append(t);
    setTimeout(() => t.remove(), kind === "err" ? 5000 : 2600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("已複製");
    } catch {
      toast("無法自動複製，請手動選取", "err");
    }
  }

  // ── Modal ──
  function modal({ title, body, actions = [], onClose }) {
    const prev = document.activeElement;
    const back = el("div", { class: "modal-back" });
    const box = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title });
    const close = () => {
      back.remove();
      document.removeEventListener("keydown", onKey);
      onClose && onClose();
      prev && prev.focus && prev.focus();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    box.append(
      el("div", { class: "modal-head" }, el("h2", { text: title }),
        el("button", { class: "btn ghost sm icon", type: "button", "aria-label": "關閉", onclick: close }, icon("x"))),
      el("div", { class: "modal-body" }, body)
    );
    if (actions.length) box.append(el("div", { class: "modal-foot" }, actions));
    back.append(box);
    back.addEventListener("mousedown", (e) => {
      if (e.target === back) close();
    });
    document.addEventListener("keydown", onKey);
    document.body.append(back);
    const first = box.querySelector("input, textarea, select, .modal-foot .btn.primary, .modal-foot .btn");
    (first || box).focus();
    return { close, box };
  }

  function confirmDialog({ title, message, confirmText = "確定", danger = false }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        m.close();
        resolve(v);
      };
      const m = modal({
        title,
        body: el("p", { class: "sub", style: { marginTop: "14px" }, text: message }),
        actions: [
          el("button", { class: "btn", type: "button", text: "取消", onclick: () => finish(false) }),
          el("button", { class: danger ? "btn danger-solid" : "btn primary", type: "button", text: confirmText, onclick: () => finish(true) }),
        ],
        onClose: () => finish(false),
      });
    });
  }

  function setBusy(btn, busy, label) {
    if (busy) {
      if (!btn._kids) btn._kids = [...btn.childNodes];
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.replaceChildren(el("span", { class: "spinner", "aria-hidden": "true" }), el("span", { text: label || "處理中…" }));
    } else {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      if (btn._kids) btn.replaceChildren(...btn._kids);
      btn._kids = null;
    }
  }

  const reduceMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── 數字從 0 數上去（減少動態效果時直接顯示）──
  function countUp(node, to, { ms = 700 } = {}) {
    to = Math.round(Number(to) || 0);
    if (reduceMotion() || to <= 0 || navigator.webdriver) {
      node.textContent = String(to);
      return;
    }
    const start = performance.now();
    node.textContent = "0";
    const step = (t) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      node.textContent = String(Math.round(to * eased));
      if (p < 1) requestAnimationFrame(step);
      else node.textContent = String(to); // 一定停在正確數字
    };
    requestAnimationFrame(step);
  }

  // ── 中文換行：只在詞和詞之間換行，數字和單位不拆開，最後一兩個字不單獨掉到下一行 ──
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

  // ── 版本：偵測新版本、更新公告 ──
  let changelog = null;
  let loadedVersion = null;
  async function fetchChangelog() {
    const r = await fetch("/changelog.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("changelog " + r.status);
    const list = await r.json();
    return Array.isArray(list) ? list : [];
  }
  async function checkVersion() {
    try {
      const list = await fetchChangelog();
      const v = list[0]?.version;
      if (!v) return;
      if (!loadedVersion) {
        loadedVersion = v;
        changelog = list;
      } else if (v !== loadedVersion) {
        showUpdateBar(v);
      }
    } catch {}
  }
  function showUpdateBar(v) {
    if (document.getElementById("updateBar")) return;
    const bar = el("div", { class: "update-bar", id: "updateBar", role: "status" },
      el("span", { text: `網站有新版本（v${v}）` }),
      el("button", { class: "btn sm primary", type: "button", text: "重新整理", onclick: () => location.reload() }),
      el("button", { class: "btn sm ghost icon", type: "button", "aria-label": "先不要", onclick: () => bar.remove() }, icon("x"))
    );
    document.body.prepend(bar);
  }
  // 打開時、切回分頁時、每 30 分鐘檢查一次；不會自動重新載入
  const versionReady = checkVersion();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkVersion());
  setInterval(checkVersion, 30 * 60 * 1000);

  // 更新公告：列出上次看過之後的每一個版本。第一次來的人不打擾，直接記成已看過。
  async function whatsNew({ all = false } = {}) {
    await versionReady;
    if (!changelog || !changelog.length) return;
    const latest = changelog[0].version;
    const seen = store.get("seenVersion", null);
    if (!all) {
      if (!seen) return store.set("seenVersion", latest);
      if (seen === latest) return;
    }
    let entries = changelog;
    if (!all) {
      const idx = changelog.findIndex((c) => c.version === seen);
      entries = idx === -1 ? changelog.slice(0, 2) : changelog.slice(0, idx);
    }
    store.set("seenVersion", latest);
    const body = el("div", { class: "whatsnew" },
      ...entries.map((c) =>
        el("section", null,
          el("h3", null, el("span", { class: "num", text: "v" + c.version }), el("span", { class: "muted small", text: c.date || "" })),
          el("ul", null, ...(c.items || []).map((t) => el("li", { text: t })))
        )
      )
    );
    const m = modal({
      title: all ? "更新紀錄" : "網站更新了",
      body,
      actions: [el("button", { class: "btn primary", type: "button", text: "知道了", onclick: () => m.close() })],
    });
  }

  // ── 左上角 CCC：像營業廳的翻牌看板 ──
  // 依序翻出三位主講（config.js 的 HOSTS，例如 X → OC），最後停在 CCC
  const FLAP_CHARS = "ABDEFGHJKLMNPRSTUVWXYZ0123456789";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function splitFlap(mark) {
    const word = mark.textContent.trim();
    if (!word) return;
    const size = word.length;
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", word);
    const tiles = [...word].map((ch) => el("span", { class: "flap", "aria-hidden": "true" }, el("b", { text: ch })));
    mark.replaceChildren(...tiles);

    // 要翻過的字：其他主講（放得下的才翻），最後回到原本的字
    const pad = (w) => {
      const left = Math.ceil((size - w.length) / 2);
      return (" ".repeat(left) + w).padEnd(size, " ");
    };
    const names = (cfg.HOSTS || []).map((h) => String(h).toUpperCase()).filter((h) => h && h !== word && h.length <= size);
    const words = [...names.map(pad), word];

    const show = (tile, ch) => {
      tile.replaceChildren(el("b", { class: "flip", text: ch.trim() ? ch : "" }));
      tile.classList.toggle("blank", !ch.trim());
    };
    // 一片翻牌：先翻過幾個亂數字母，再停在目標字
    async function flipTo(tile, ch, spins) {
      for (let k = 0; k < spins; k++) {
        show(tile, FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)]);
        await wait(55);
      }
      show(tile, ch);
    }

    let running = false;
    async function play() {
      if (running || reduceMotion() || navigator.webdriver) return;
      running = true;
      try {
        for (let w = 0; w < words.length; w++) {
          const last = w === words.length - 1;
          await Promise.all(tiles.map(async (tile, i) => {
            await wait(i * 70);
            await flipTo(tile, words[w][i], last ? 3 + i * 2 : 2 + i);
            if (last) {
              tile.classList.add("settle");
              setTimeout(() => tile.classList.remove("settle"), 500);
            }
          }));
          if (!last) await wait(520); // 每個名字停一下讓人看清楚
        }
      } finally {
        running = false;
      }
    }
    const brand = mark.closest("a") || mark;
    brand.addEventListener("mouseenter", play);
    brand.addEventListener("focus", play);
    return play;
  }
  const flaps = [...document.querySelectorAll(".mark")].map(splitFlap).filter(Boolean);
  // 字型載入後再翻，避免字寬跳動
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => flaps.forEach((play) => play()));

  window.App = {
    cfg, sb, api, store, el, $, icon, icons, placeholderSvg, thumbImg,
    fmtDur, fmtLeft, fmtBytes, fmtDate, fmtRel, today,
    toast, copyText, modal, confirmDialog, setBusy,
    countUp, whatsNew, reduceMotion,
  };
})();
