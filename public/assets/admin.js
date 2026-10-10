// 後台：影片上傳與管理、實驗室密碼、會員
(function () {
  "use strict";
  const A = window.App;
  const { el, $, api, sb, icon, icons } = A;

  let me = null;
  let videos = [];
  let invites = [];
  let members = [];
  let memberQuery = "";
  const activeUploads = new Set();

  document.querySelectorAll("[data-ico]").forEach((n) => {
    n.replaceWith(icon(n.dataset.ico));
  });

  // ─────────────────────────────────────────────
  // 開機與權限
  // ─────────────────────────────────────────────
  function show(id) {
    for (const v of ["boot", "noAccess", "shell"]) $("#" + v).hidden = v !== id;
  }

  (async function boot() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return location.replace("/?next=admin");
    try {
      me = await api("/api/me");
    } catch (e) {
      if (e.status === 401) {
        await sb.auth.signOut();
        return location.replace("/?next=admin");
      }
      show("noAccess");
      if (e.status !== 403) {
        $("#noAccessTitle").textContent = "網站暫時無法使用";
        $("#noAccessMsg").textContent = e.status === 0 ? "連線失敗，請檢查網路後再試一次。" : e.message;
      }
      return;
    }
    if (!me.isAdmin) return show("noAccess");
    $("#whoami").textContent = me.email;
    show("shell");
    window.addEventListener("hashchange", route);
    route();
    // 先把三個清單都抓回來，側欄數字才有東西
    loadInvites(true);
    loadMembers(true);
    A.whatsNew();
  })();

  async function logout(e) {
    e && e.preventDefault();
    if (activeUploads.size && !(await A.confirmDialog({ title: "還有影片在上傳", message: "現在登出會中斷上傳，確定要登出嗎？", confirmText: "登出", danger: true }))) return;
    await sb.auth.signOut();
    location.href = "/";
  }
  $("#logout").addEventListener("click", logout);
  $("#changelogLink").addEventListener("click", (e) => {
    e.preventDefault();
    A.whatsNew({ all: true });
  });
  $("#noAccessLogout").addEventListener("click", logout);

  function fail(e) {
    if (e.status === 401) {
      sb.auth.signOut().then(() => location.replace("/?next=admin"));
      return;
    }
    if (e.status === 403) return show("noAccess");
    A.toast(e.message || "發生錯誤", "err");
  }

  function route() {
    const view = ["videos", "invites", "members", "stats"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "videos";
    document.querySelectorAll("[data-view-panel]").forEach((p) => (p.hidden = p.dataset.viewPanel !== view));
    document.querySelectorAll(".nav a").forEach((a) => {
      if (a.dataset.view === view) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.title = { videos: "影片", invites: "實驗室密碼", members: "會員", stats: "觀看統計" }[view] + "｜後台管理";
    if (view === "videos") loadVideos();
    if (view === "invites") loadInvites();
    if (view === "members") loadMembers();
    if (view === "stats") loadStats();
  }

  function loadingBox() {
    return el("div", { class: "skel", style: { height: "220px" }, "aria-hidden": "true" });
  }

  // ─────────────────────────────────────────────
  // 影片列表
  // ─────────────────────────────────────────────
  let videosLoaded = false;
  async function loadVideos() {
    if (!videosLoaded) $("#videoTableBox").replaceChildren(loadingBox());
    try {
      const r = await api("/api/admin/videos");
      videos = r.videos || [];
      videosLoaded = true;
      renderVideos();
    } catch (e) {
      fail(e);
    }
  }

  function renderVideos() {
    $("#cVideos").textContent = videos.length || "";
    const box = $("#videoTableBox");
    if (!videos.length) {
      box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: "還沒有影片" }), el("p", { class: "small", style: { marginTop: "6px" }, text: "上傳第一場直播留檔吧，上傳完成後會先存成草稿。" })));
      return;
    }
    const rows = videos.map((v) => {
      const sw = el("input", { type: "checkbox", "aria-label": "發布" });
      sw.checked = v.is_published;
      sw.addEventListener("change", () => togglePublish(v, sw));
      const thumb = el("div", { class: "mini-thumb" });
      thumb.append(v.thumb_url ? A.thumbImg(v.thumb_url) : A.placeholderSvg());
      return el("tr", null,
        el("td", { class: "c-thumb", style: { width: "104px" } }, thumb),
        el("td", null,
          el("div", { class: "t-title", text: v.title }),
          el("div", { class: "t-sub", text: v.description || "尚未填寫簡介" }),
          v.hosts?.length ? el("div", { class: "hosts", style: { marginTop: "6px" } }, ...v.hosts.map((h) => el("span", { class: "host", text: h }))) : null),
        el("td", { class: "num small", style: { whiteSpace: "nowrap" }, text: A.fmtDate(v.published_at) }),
        el("td", { class: "num small hide-sm", text: v.duration_sec ? A.fmtDur(v.duration_sec) : "—" }),
        el("td", { class: "small hide-sm" }, v.attachments?.length ? el("span", { class: "meta-ico" }, icon("paperclip"), String(v.attachments.length)) : el("span", { class: "muted", text: "—" })),
        el("td", null, el("label", { class: "switch" }, sw, el("span", { class: "track" }), el("span", { class: "state", text: v.is_published ? "已發布" : "草稿" }))),
        el("td", null, el("div", { class: "actions" },
          el("button", { class: "btn sm", type: "button", onclick: () => openEditor(v.id) }, icon("edit"), "編輯"),
          el("button", { class: "btn sm icon danger", type: "button", "aria-label": `刪除 ${v.title}`, onclick: () => deleteVideo(v) }, icon("trash"))
        ))
      );
    });
    box.replaceChildren(
      el("div", { class: "table-wrap" },
        el("table", { class: "table stack vt" },
          el("thead", null, el("tr", null,
            el("th", null, el("span", { class: "sr-only", text: "封面" })), el("th", { text: "標題" }), el("th", { text: "日期" }),
            el("th", { class: "hide-sm", text: "長度" }), el("th", { class: "hide-sm", text: "教材" }), el("th", { text: "狀態" }),
            el("th", null, el("span", { class: "sr-only", text: "操作" })))),
          el("tbody", null, rows)))
    );
  }

  async function togglePublish(v, sw) {
    const next = sw.checked;
    sw.disabled = true;
    try {
      await api("/api/admin/videos", { method: "PATCH", body: { id: v.id, is_published: next } });
      v.is_published = next;
      sw.closest(".switch").querySelector(".state").textContent = next ? "已發布" : "草稿";
      A.toast(next ? `已發布「${v.title}」` : `已改回草稿「${v.title}」`);
    } catch (e) {
      sw.checked = !next;
      fail(e);
    } finally {
      sw.disabled = false;
    }
  }

  async function deleteVideo(v) {
    const ok = await A.confirmDialog({
      title: "刪除影片",
      message: `確定要刪除「${v.title}」嗎？影片檔、封面、教材和會員的觀看紀錄會一起刪除，無法復原。`,
      confirmText: "刪除",
      danger: true,
    });
    if (!ok) return false;
    try {
      await api(`/api/admin/videos?id=${v.id}`, { method: "DELETE" });
      videos = videos.filter((x) => x.id !== v.id);
      renderVideos();
      A.toast("已刪除");
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  // ─────────────────────────────────────────────
  // 編輯影片（含教材附件）
  // ─────────────────────────────────────────────
  function openEditor(id, { justUploaded = false } = {}) {
    const v = videos.find((x) => x.id === id);
    if (!v) return;
    const title = el("input", { class: "input", type: "text", maxlength: "120", value: v.title });
    const date = el("input", { class: "input", type: "date", value: A.fmtDate(v.published_at) });
    const desc = el("textarea", { class: "textarea", maxlength: "2000", rows: "4", placeholder: "這場直播在講什麼？會員在列表和播放頁都看得到。" });
    desc.value = v.description || "";
    const pub = el("input", { type: "checkbox" });
    pub.checked = justUploaded ? true : v.is_published;
    // 主講人：可以複選，選項在 config.js 的 HOSTS
    const hostSet = new Set(v.hosts || []);
    const hostOpts = [...new Set([...(A.cfg.HOSTS || []), ...hostSet])];
    const hostBox = el("div", { class: "chips", role: "group", "aria-label": "主講人" },
      ...hostOpts.map((h) => {
        const b = el("button", { class: "chip", type: "button", "aria-pressed": String(hostSet.has(h)), text: h });
        b.addEventListener("click", () => {
          hostSet.has(h) ? hostSet.delete(h) : hostSet.add(h);
          b.setAttribute("aria-pressed", String(hostSet.has(h)));
        });
        return b;
      }));
    const pickedHosts = () => hostOpts.filter((h) => hostSet.has(h));

    // 章節：一行一段「05:30 開盤區間」
    const chapText = el("textarea", { class: "textarea mono-ish", rows: "5", placeholder: "一行一段，時間在前面，例如：\n00:00 開場\n05:30 開盤區間怎麼畫\n32:10 停損案例\n1:02:00 Q&A" });
    chapText.value = (v.chapters || []).map((c) => `${A.fmtDur(c.t)} ${c.title}`).join("\n");
    const chapHint = el("div", { class: "hint" });
    const updateChapHint = () => {
      const { chapters, bad } = parseChapters(chapText.value);
      chapHint.textContent = bad.length
        ? `第 ${bad.join("、")} 行看不懂時間，會略過。時間要寫成 5:30 或 1:02:10`
        : chapters.length ? `共 ${chapters.length} 段，會員可以在播放頁點章節直接跳過去` : "可以不填。填了之後會員在播放頁會看到章節，也能用搜尋找到。";
      chapHint.classList.toggle("warn-text", bad.length > 0);
    };
    chapText.addEventListener("input", updateChapHint);
    updateChapHint();

    // 封面
    const coverImg = el("div", { class: "mini-thumb cover-preview" });
    const paintCover = () => coverImg.replaceChildren(v.thumb_url ? A.thumbImg(v.thumb_url) : A.placeholderSvg());
    paintCover();
    const coverInput = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
    coverInput.addEventListener("change", async () => {
      const f = coverInput.files[0];
      coverInput.value = "";
      if (!f) return;
      try {
        const blob = await imageToJpeg(f);
        await setCover(v, blob);
        paintCover();
      } catch (e) {
        A.toast(e.message || "封面上傳失敗", "err");
      }
    });

    // 寄通知
    const notifyBtn = el("button", { class: "btn sm", type: "button" }, icon("mail"), "寄信通知會員");
    const notifyNote = el("span", { class: "small muted" });
    const paintNotify = () => {
      notifyNote.textContent = v.notified_at ? `上次寄出：${A.fmtRel(v.notified_at)}` : v.is_published ? "還沒寄過" : "發布後才能寄";
      notifyBtn.disabled = !v.is_published;
    };
    paintNotify();
    notifyBtn.addEventListener("click", async () => {
      if (v.notified_at && !(await A.confirmDialog({ title: "再寄一次？", message: `這一場 ${A.fmtRel(v.notified_at)} 已經寄過通知，確定要再寄一次嗎？`, confirmText: "再寄一次" }))) return;
      A.setBusy(notifyBtn, true, "寄送中…");
      try {
        const r = await api("/api/admin/notify", { method: "POST", body: { videoId: v.id } });
        v.notified_at = new Date().toISOString();
        A.toast(`已寄給 ${r.sent} 位會員`);
      } catch (e) {
        A.toast(e.message, "err");
      } finally {
        A.setBusy(notifyBtn, false);
        paintNotify();
      }
    });
    const err = el("div", { class: "form-error", role: "alert", hidden: true });

    const attList = el("div", { style: { display: "grid", gap: "8px" } });
    const attUploads = el("div", { class: "uploads", style: { marginTop: "8px" } });
    const attInput = el("input", { type: "file", multiple: true, hidden: true, accept: ".pdf,.zip,.png,.jpg,.jpeg,.webp,.txt,.csv,.docx,.xlsx,.pptx,.doc,.xls,.ppt" });
    attInput.addEventListener("change", () => {
      for (const f of attInput.files) uploadAttachment(v, f, attUploads, renderAtts);
      attInput.value = "";
    });

    function renderAtts() {
      const list = v.attachments || [];
      attList.replaceChildren(
        ...(list.length
          ? list.map((a) =>
              el("div", { class: "file" },
                el("span", { class: "ext", text: ((a.title.match(/\.([a-z0-9]{1,4})$/i) || [, "檔"])[1]).toUpperCase() }),
                el("span", { class: "grow" }, el("div", { class: "name", text: a.title }), el("div", { class: "small muted", text: a.size_bytes ? A.fmtBytes(a.size_bytes) : "" })),
                el("button", { class: "btn sm icon danger", type: "button", "aria-label": `刪除 ${a.title}`, onclick: () => removeAttachment(v, a, renderAtts) }, icon("trash"))
              )
            )
          : [el("p", { class: "small muted", text: "還沒有教材。PDF、圖片、壓縮檔都可以。" })])
      );
    }
    renderAtts();

    const save = el("button", { class: "btn primary", type: "button", text: "儲存" });
    const updateSaveLabel = () => (save.textContent = pub.checked && !v.is_published ? "儲存並發布" : "儲存");
    pub.addEventListener("change", updateSaveLabel);
    updateSaveLabel();

    const m = A.modal({
      title: justUploaded ? "上傳完成，補上影片資訊" : "編輯影片",
      body: el("div", null,
        justUploaded ? el("p", { class: "small sub", style: { marginTop: "14px" }, text: "影片目前是草稿，會員還看不到。填好標題和簡介，按下儲存就會發布。" }) : null,
        el("label", { class: "field" }, el("span", { class: "label", text: "標題" }), title),
        el("label", { class: "field" }, el("span", { class: "label", text: "直播日期" }), date),
        hostOpts.length ? el("div", { class: "field" }, el("span", { class: "label", style: { display: "block", marginBottom: "8px" }, text: "主講（可複選）" }), hostBox) : null,
        el("div", { class: "field" },
          el("span", { class: "label", style: { display: "block", marginBottom: "8px" }, text: "封面" }),
          el("div", { class: "cover-row" }, coverImg,
            el("div", { class: "cover-actions" },
              el("button", { class: "btn sm", type: "button", onclick: () => pickFrame(v, paintCover) }, icon("video"), "從影片挑一格"),
              el("button", { class: "btn sm", type: "button", onclick: () => coverInput.click() }, icon("image"), "上傳圖片"),
              coverInput))),
        el("label", { class: "field" }, el("span", { class: "label", text: "簡介" }), desc),
        el("label", { class: "field" }, el("span", { class: "label", text: "章節" }), chapText, chapHint),
        el("div", { class: "field" }, el("label", { class: "switch" }, pub, el("span", { class: "track" }), el("span", { text: "發布（會員看得到）" }))),
        el("div", { class: "field" },
          el("div", { class: "section-label" }, el("span", { class: "label", text: "教材附件" }),
            el("button", { class: "btn sm", type: "button", onclick: () => attInput.click() }, icon("plus"), "新增教材")),
          attList, attUploads, attInput),
        el("div", { class: "field notify-row" }, notifyBtn, notifyNote),
        err,
        el("p", { class: "small", style: { marginTop: "16px" } }, el("a", { href: `/#/v/${v.id}`, target: "_blank", rel: "noopener", class: "meta-ico" }, icon("ext"), "用會員畫面預覽"))
      ),
      actions: [
        el("button", { class: "btn danger", type: "button", style: { marginRight: "auto" }, onclick: async () => {
          if (await deleteVideo(v)) m.close();
        } }, icon("trash"), "刪除"),
        el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }),
        save,
      ],
    });

    save.addEventListener("click", async () => {
      const t = title.value.trim();
      if (!t) {
        err.textContent = "標題不能空白";
        err.hidden = false;
        title.focus();
        return;
      }
      A.setBusy(save, true, "儲存中…");
      try {
        const saved = await api("/api/admin/videos", {
          method: "PATCH",
          body: { id: v.id, title: t, description: desc.value, published_at: date.value || A.today(), is_published: pub.checked, hosts: pickedHosts(), chapters: parseChapters(chapText.value).chapters },
        });
        const savedTitle = saved?.title || t;
        const wasPublished = v.is_published;
        Object.assign(v, { title: savedTitle, description: desc.value.trim() || null, published_at: date.value || A.today(), is_published: pub.checked, hosts: pickedHosts(), chapters: parseChapters(chapText.value).chapters });
        renderVideos();
        m.close();
        if (pub.checked && !wasPublished) {
          // 剛發布：問要不要順便寄信
          const send = await A.confirmDialog({ title: "已發布，會員現在看得到了", message: "要順便寄信通知會員有新的一場嗎？（關掉通知的會員不會收到）", confirmText: "寄信通知" });
          if (send) {
            try {
              const r = await api("/api/admin/notify", { method: "POST", body: { videoId: v.id } });
              v.notified_at = new Date().toISOString();
              A.toast(`已寄給 ${r.sent} 位會員`);
            } catch (e) {
              A.toast(e.message, "err");
            }
          }
        } else A.toast(savedTitle !== t ? `已儲存（標題開頭的日期拿掉了：「${savedTitle}」）` : "已儲存");
      } catch (e) {
        A.setBusy(save, false);
        err.textContent = e.message;
        err.hidden = false;
      }
    });
  }

  // 「05:30 標題」「1:02:10 - 標題」→ {t, title}
  function parseChapters(text) {
    const chapters = [];
    const bad = [];
    String(text || "").split(/\r?\n/).forEach((line, i) => {
      const raw = line.trim();
      if (!raw) return;
      const m = raw.match(/^(\d{1,2})[:：](\d{1,2})(?:[:：](\d{1,2}))?\s*[-–—|｜]?\s*(.*)$/);
      if (!m || !m[4].trim()) return bad.push(i + 1);
      const t = m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
      chapters.push({ t, title: m[4].trim().slice(0, 60) });
    });
    chapters.sort((a, b) => a.t - b.t);
    return { chapters, bad };
  }

  // 圖片轉成 1280 寬以內的 JPEG（封面只收 JPEG／WebP）
  function imageToJpeg(file) {
    return new Promise((resolve, reject) => {
      if (file.size > 15 * 1024 * 1024) return reject(new Error("圖片太大，請小於 15 MB"));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const w = Math.min(1280, img.naturalWidth);
        const h = Math.round((w * img.naturalHeight) / img.naturalWidth);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("圖片轉換失敗"))), "image/jpeg", 0.85);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("讀不出這張圖片"));
      };
      img.src = url;
    });
  }

  async function setCover(v, blob) {
    const t = await api("/api/admin/upload-url", { method: "POST", body: { kind: "thumb", filename: "cover.jpg", contentType: "image/jpeg", size: blob.size } });
    await putFile(t.url, blob, t.contentType, { progress() {}, setAbort() {} });
    const r = await api("/api/admin/videos", { method: "PATCH", body: { id: v.id, thumb_key: t.key } });
    v.thumb_url = r.thumb_url || URL.createObjectURL(blob);
    renderVideos();
    A.toast("封面已更新");
  }

  // 從影片挑一格當封面：拖時間軸找畫面，按「用這一格」
  async function pickFrame(v, onDone) {
    let d;
    try {
      d = await api(`/api/videos?id=${v.id}`);
    } catch (e) {
      return A.toast(e.message, "err");
    }
    const vid = el("video", { muted: true, playsinline: true, preload: "auto", crossorigin: "anonymous", class: "frame-video" });
    const range = el("input", { type: "range", min: "0", max: "1000", value: "100", class: "frame-range", "aria-label": "選擇畫面的時間" });
    const time = el("span", { class: "num frame-time", text: "0:00" });
    const use = el("button", { class: "btn primary", type: "button", text: "用這一格", disabled: true });
    const status = el("p", { class: "small muted", style: { marginTop: "8px" }, text: "載入影片中…" });
    const m = A.modal({
      title: "從影片挑封面",
      body: el("div", { class: "frame-picker" }, el("div", { class: "frame-box" }, vid), el("div", { class: "frame-ctrl" }, range, time), status),
      actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }), use],
    });
    m.box.style.maxWidth = "760px";
    const seek = () => {
      if (!isFinite(vid.duration)) return;
      vid.currentTime = (range.value / 1000) * vid.duration;
      time.textContent = A.fmtDur(vid.currentTime);
    };
    vid.addEventListener("loadedmetadata", () => {
      status.textContent = "拖動下面的時間軸，找一個好看的畫面";
      use.disabled = false;
      seek();
    });
    vid.addEventListener("error", () => (status.textContent = "影片載入失敗，請確認 R2 的 CORS 設定有包含這個網址"));
    range.addEventListener("input", seek);
    vid.src = d.url;
    use.addEventListener("click", async () => {
      A.setBusy(use, true, "上傳中…");
      try {
        const w = Math.min(1280, vid.videoWidth || 1280);
        const h = Math.round((w * vid.videoHeight) / vid.videoWidth) || 720;
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(vid, 0, 0, w, h);
        const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
        if (!blob) throw new Error("擷取畫面失敗");
        await setCover(v, blob);
        onDone && onDone();
        m.close();
      } catch (e) {
        A.setBusy(use, false);
        status.textContent = /tainted|insecure|security/i.test(String(e.message)) ? "瀏覽器不允許擷取這個影片的畫面（R2 的 CORS 需要允許這個網址）" : e.message;
      }
    });
  }

  async function removeAttachment(v, a, rerender) {
    const ok = await A.confirmDialog({ title: "刪除教材", message: `確定要刪除「${a.title}」嗎？`, confirmText: "刪除", danger: true });
    if (!ok) return;
    try {
      await api(`/api/admin/attachments?id=${a.id}`, { method: "DELETE" });
      v.attachments = (v.attachments || []).filter((x) => x.id !== a.id);
      rerender();
      renderVideos();
    } catch (e) {
      fail(e);
    }
  }

  async function uploadAttachment(v, file, box, rerender) {
    const ui = uploadRow(file.name, box);
    try {
      const type = file.type || guessType(file.name) || "application/octet-stream";
      const { key, url, contentType } = await api("/api/admin/upload-url", {
        method: "POST",
        body: { kind: "attachment", filename: file.name, contentType: type, size: file.size },
      });
      ui.status("上傳中");
      await putFile(url, file, contentType, ui);
      const r = await api("/api/admin/attachments", {
        method: "POST",
        body: { video_id: v.id, title: file.name, r2_key: key, size_bytes: file.size },
      });
      v.attachments = [...(v.attachments || []), { id: r.id, title: file.name, size_bytes: file.size }];
      ui.done("已加入");
      setTimeout(() => ui.remove(), 1200);
      rerender();
      renderVideos();
    } catch (e) {
      ui.fail(e.message);
    }
  }

  // ─────────────────────────────────────────────
  // 影片上傳
  // ─────────────────────────────────────────────
  const input = $("#videoInput");
  const drop = $("#drop");
  $("#pickVideo").addEventListener("click", () => input.click());
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", () => {
    for (const f of input.files) uploadVideo(f);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach((t) =>
    drop.addEventListener(t, (e) => {
      e.preventDefault();
      drop.classList.add("over");
    })
  );
  ["dragleave", "drop"].forEach((t) =>
    drop.addEventListener(t, (e) => {
      e.preventDefault();
      drop.classList.remove("over");
    })
  );
  drop.addEventListener("drop", (e) => {
    for (const f of e.dataTransfer.files) {
      if (f.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|m4v)$/i.test(f.name)) uploadVideo(f);
      else A.toast(`「${f.name}」不是影片檔`, "err");
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (activeUploads.size) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  function guessType(name) {
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
    return {
      mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
      pdf: "application/pdf", zip: "application/zip", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
      txt: "text/plain", csv: "text/csv",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint",
    }[ext];
  }

  function uploadRow(name, box) {
    const bar = el("i");
    const prog = el("div", { class: "progress active" }, bar);
    const status = el("span", { class: "small muted num", text: "準備中" });
    const cancel = el("button", { class: "btn sm ghost", type: "button", text: "取消" });
    const note = el("p", { class: "small muted", style: { marginTop: "8px" }, hidden: true });
    const row = el("div", { class: "upload" }, el("div", { class: "row" }, el("span", { class: "name", text: name }), el("span", { style: { display: "flex", alignItems: "center", gap: "8px" } }, status, cancel)), prog, note);
    box.prepend(row);
    let abort = null;
    cancel.addEventListener("click", () => {
      if (abort) abort();
      else row.remove();
    });
    return {
      setAbort(fn) { abort = fn; },
      status(t) { status.textContent = t; },
      progress(p, text) {
        bar.style.width = Math.round(p * 100) + "%";
        if (text) status.textContent = text;
      },
      note(t) { note.textContent = t; note.hidden = !t; },
      done(t) {
        prog.className = "progress done";
        bar.style.width = "100%";
        status.textContent = t || "完成";
        cancel.remove();
      },
      fail(t) {
        prog.className = "progress fail";
        status.textContent = "失敗";
        note.textContent = t;
        note.hidden = false;
        note.style.color = "var(--warn)";
        cancel.textContent = "移除";
        abort = null;
      },
      remove() { row.remove(); },
    };
  }

  // 直接 PUT 到 R2，回報進度、速度、剩餘時間
  function putFile(url, file, contentType, ui) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const started = Date.now();
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const p = e.loaded / e.total;
        const secs = (Date.now() - started) / 1000;
        const speed = secs > 1 ? e.loaded / secs : 0;
        const left = speed ? (e.total - e.loaded) / speed : 0;
        ui.progress(p, `${Math.floor(p * 100)}%　${A.fmtBytes(e.loaded)} / ${A.fmtBytes(e.total)}${speed ? `　剩 ${left > 90 ? Math.ceil(left / 60) + " 分" : Math.ceil(left) + " 秒"}` : ""}`);
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`上傳失敗（${xhr.status}）。請確認 R2 的 CORS 設定。`)));
      xhr.onerror = () => reject(new Error("上傳中斷，請檢查網路或 R2 的 CORS 設定後重試"));
      xhr.onabort = () => reject(Object.assign(new Error("已取消"), { aborted: true }));
      ui.setAbort(() => xhr.abort());
      xhr.send(file);
    });
  }

  // 在瀏覽器裡讀片長、擷取一張封面（不支援的格式就跳過）
  function probeVideo(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.muted = true;
      v.preload = "metadata";
      v.playsInline = true;
      let finished = false;
      const finish = (out) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        v.removeAttribute("src");
        v.load();
        resolve(out);
      };
      const timer = setTimeout(() => finish({ duration: isFinite(v.duration) ? v.duration : null, thumb: null, playable: false }), 15000);
      v.onerror = () => finish({ duration: null, thumb: null, playable: false });
      v.onloadedmetadata = () => {
        const d = v.duration;
        if (!isFinite(d) || !v.videoWidth) return finish({ duration: isFinite(d) ? d : null, thumb: null, playable: false });
        v.currentTime = Math.max(1, Math.min(d * 0.1, 120));
      };
      v.onseeked = () => {
        try {
          const w = 640;
          const h = Math.round((w * v.videoHeight) / v.videoWidth) || 360;
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          c.getContext("2d").drawImage(v, 0, 0, w, h);
          c.toBlob((blob) => finish({ duration: v.duration, thumb: blob, playable: true }), "image/jpeg", 0.82);
        } catch {
          finish({ duration: v.duration, thumb: null, playable: true });
        }
      };
      v.src = url;
    });
  }

  async function uploadVideo(file) {
    const ui = uploadRow(file.name, $("#uploads"));
    const token = {};
    activeUploads.add(token);
    try {
      const type = file.type || guessType(file.name) || "video/mp4";
      ui.status("讀取影片資訊");
      const info = await probeVideo(file);
      if (!info.playable) ui.note("這個檔案在瀏覽器裡讀不出畫面，會員可能也無法播放。建議轉成 MP4（H.264）再上傳。");

      const { key, url, contentType } = await api("/api/admin/upload-url", {
        method: "POST",
        body: { kind: "video", filename: file.name, contentType: type, size: file.size },
      });
      ui.status("上傳中");
      await putFile(url, file, contentType, ui);

      let thumbKey = null;
      if (info.thumb) {
        ui.status("上傳封面");
        try {
          const t = await api("/api/admin/upload-url", {
            method: "POST",
            body: { kind: "thumb", filename: "cover.jpg", contentType: "image/jpeg", size: info.thumb.size },
          });
          await putFile(t.url, info.thumb, t.contentType, { progress() {}, setAbort() {} });
          thumbKey = t.key;
        } catch {
          /* 封面失敗不影響影片 */
        }
      }

      ui.status("建立影片");
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "未命名直播";
      const r = await api("/api/admin/videos", {
        method: "POST",
        body: {
          title,
          r2_key: key,
          thumb_key: thumbKey,
          duration_sec: info.duration ? Math.round(info.duration) : null,
          size_bytes: file.size,
          published_at: A.today(),
          is_published: false,
        },
      });
      ui.done("完成，已存成草稿");
      await loadVideos();
      openEditor(r.id, { justUploaded: true });
      setTimeout(() => ui.remove(), 4000);
    } catch (e) {
      if (e.aborted) ui.remove();
      else ui.fail(e.message);
    } finally {
      activeUploads.delete(token);
    }
  }

  // ─────────────────────────────────────────────
  // 實驗室密碼
  // ─────────────────────────────────────────────
  let invitesLoaded = false;
  async function loadInvites(silent) {
    if (!invitesLoaded && !silent) $("#inviteTableBox").replaceChildren(loadingBox());
    try {
      const r = await api("/api/admin/invites");
      invites = r.invites || [];
      invitesLoaded = true;
      renderInvites();
    } catch (e) {
      if (!silent) fail(e);
    }
  }

  const inviteLink = (code) => `${location.origin}/?invite=${encodeURIComponent(code)}`;
  const shareText = (code) => `CCC 交易實驗室 實驗室密碼：${code}\n加入連結：${inviteLink(code)}`;

  function inviteState(i) {
    if (i.disabled) return ["已停用", "warn"];
    if (i.used_count >= i.max_uses) return ["已用完", ""];
    return ["可使用", "good"];
  }

  function renderInvites() {
    $("#cInvites").textContent = invites.filter((i) => inviteState(i)[1] === "good").length || "";
    const box = $("#inviteTableBox");
    if (!invites.length) {
      box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: "還沒有實驗室密碼" }), el("p", { class: "small", style: { marginTop: "6px" }, text: "在右邊產生第一組，把註冊連結傳給會員。" })));
      return;
    }
    box.replaceChildren(
      el("div", { class: "table-wrap" },
        el("table", { class: "table stack" },
          el("thead", null, el("tr", null, el("th", { text: "實驗室密碼" }), el("th", { text: "使用狀況" }), el("th", { class: "hide-sm", text: "備註" }), el("th", { text: "狀態" }), el("th", null, el("span", { class: "sr-only", text: "操作" })))),
          el("tbody", null,
            invites.map((i) => {
              const [label, kind] = inviteState(i);
              const pct = i.max_uses ? Math.min(100, (i.used_count / i.max_uses) * 100) : 0;
              return el("tr", null,
                el("td", null, el("span", { class: "code num", text: i.code }), el("div", { class: "small muted num", text: A.fmtDate(i.created_at) })),
                el("td", null, el("div", { class: "usage" }, el("span", { class: "track" }, el("i", { style: { width: pct + "%" } })), el("span", { class: "small num", text: `${i.used_count} / ${i.max_uses}` }))),
                el("td", { class: "small sub hide-sm", text: i.note || "—" }),
                el("td", null, el("span", { class: "pill " + kind }, el("span", { class: "dot" }), label)),
                el("td", null, el("div", { class: "actions" },
                  el("button", { class: "btn sm", type: "button", onclick: () => A.copyText(shareText(i.code)) }, icon("copy"), "複製連結"),
                  el("button", { class: "btn sm ghost", type: "button", text: i.disabled ? "啟用" : "停用", onclick: () => toggleInvite(i) })
                ))
              );
            })
          )))
    );
  }

  async function toggleInvite(i) {
    try {
      await api("/api/admin/invites", { method: "PATCH", body: { code: i.code, disabled: !i.disabled } });
      i.disabled = !i.disabled;
      renderInvites();
      A.toast(i.disabled ? "已停用，這組實驗室密碼不能再註冊" : "已重新啟用");
    } catch (e) {
      fail(e);
    }
  }

  $("#invCreate").addEventListener("click", async () => {
    const btn = $("#invCreate");
    const max = Number($("#invMax").value);
    if (!Number.isInteger(max) || max < 1 || max > 1000) return A.toast("可使用次數需要介於 1 到 1000", "err");
    A.setBusy(btn, true, "產生中…");
    try {
      const r = await api("/api/admin/invites", { method: "POST", body: { max_uses: max, note: $("#invNote").value } });
      invites.unshift(r.invite);
      renderInvites();
      $("#invNote").value = "";
      const code = r.invite.code;
      $("#invResult").replaceChildren(
        el("div", { class: "new-code" },
          el("div", { class: "label", text: "新的實驗室密碼" }),
          el("div", { class: "big num", text: code }),
          el("div", { class: "small sub", style: { marginTop: "4px", wordBreak: "break-all" }, text: inviteLink(code) }),
          el("div", { style: { display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" } },
            el("button", { class: "btn sm", type: "button", onclick: () => A.copyText(shareText(code)) }, icon("copy"), "複製加入訊息"),
            el("button", { class: "btn sm ghost", type: "button", onclick: () => A.copyText(code) }, "只複製代碼")
          )
        )
      );
    } catch (e) {
      fail(e);
    } finally {
      A.setBusy(btn, false);
    }
  });

  // ─────────────────────────────────────────────
  // 會員
  // ─────────────────────────────────────────────
  let membersLoaded = false;
  async function loadMembers(silent) {
    if (!membersLoaded && !silent) $("#memberTableBox").replaceChildren(loadingBox());
    try {
      const r = await api("/api/admin/members");
      members = r.members || [];
      membersLoaded = true;
      renderMembers();
    } catch (e) {
      if (!silent) fail(e);
    }
  }

  $("#memberSearch").addEventListener("input", (e) => {
    memberQuery = e.target.value.trim().toLowerCase();
    renderMembers();
  });

  function renderMembers() {
    $("#cMembers").textContent = members.length || "";
    const active = members.filter((m) => !m.banned).length;
    $("#memberSub").textContent = members.length ? `共 ${members.length} 位，${active} 位可觀看` : "用用實驗室密碼加入的會員";
    const list = members.filter((m) => !memberQuery || `${m.email} ${m.invite_code || ""}`.toLowerCase().includes(memberQuery));
    const box = $("#memberTableBox");
    if (!members.length) {
      box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: "還沒有會員" }), el("p", { class: "small", style: { marginTop: "6px" }, text: "到「實驗室密碼」產生一組，把註冊連結傳出去。" })));
      return;
    }
    if (!list.length) {
      box.replaceChildren(el("div", { class: "empty" }, el("p", { text: "找不到符合的會員" })));
      return;
    }
    box.replaceChildren(
      el("div", { class: "table-wrap" },
        el("table", { class: "table stack" },
          el("thead", null, el("tr", null, el("th", { text: "Email" }), el("th", { class: "hide-sm", text: "加入" }), el("th", { text: "最近登入" }), el("th", { class: "hide-sm", text: "看過" }), el("th", { text: "資格" }), el("th", { text: "狀態" }), el("th", null, el("span", { class: "sr-only", text: "操作" })))),
          el("tbody", null,
            list.map((m) =>
              el("tr", null,
                el("td", null, el("div", { class: "t-title", style: { wordBreak: "break-all" }, text: m.email }), el("div", { class: "small muted num", text: m.invite_code ? `實驗室密碼 ${m.invite_code}` : "" })),
                el("td", { class: "small num hide-sm", text: A.fmtDate(m.created_at) }),
                el("td", { class: "small", text: A.fmtRel(m.last_sign_in_at) }),
                el("td", { class: "small num hide-sm", text: `${m.watched_count} 支` }),
                el("td", null, accessCell(m)),
                el("td", null, m.banned ? el("span", { class: "pill warn" }, el("span", { class: "dot" }), "已停權") : el("span", { class: "pill good" }, el("span", { class: "dot" }), "正常")),
                el("td", null, el("div", { class: "actions" },
                  el("button", { class: "btn sm", type: "button", onclick: () => editAccess(m) }, icon("clock"), "資格"),
                  el("button", { class: "btn sm", type: "button", onclick: () => resetPassword(m) }, icon("key"), "重設密碼"),
                  m.banned
                    ? el("button", { class: "btn sm", type: "button", text: "恢復", onclick: () => setBan(m, false) })
                    : el("button", { class: "btn sm danger", type: "button", text: "停權", onclick: () => setBan(m, true) })
                ))
              )
            )
          )))
    );
  }

  // ── 每月資格（看單月交易量決定）──
  function twToday() {
    return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function monthEnd(offset = 0) {
    const [y, mo] = twToday().split("-").map(Number);
    const d = new Date(Date.UTC(y, mo - 1 + offset + 1, 0));
    return d.toISOString().slice(0, 10);
  }
  function accessCell(m) {
    const today = twToday();
    const until = m.access_until;
    const label = !until
      ? el("span", { class: "pill dash", text: "不限" })
      : until < today
        ? el("span", { class: "pill warn" }, el("span", { class: "dot" }), `已過期 ${until.slice(5).replace("-", "/")}`)
        : el("span", { class: "pill" + ((Date.parse(until) - Date.parse(today)) / 86400000 <= 7 ? " brass" : "") }, `到 ${until.slice(5).replace("-", "/")}`);
    return el("div", null, label, m.note ? el("div", { class: "small muted", style: { marginTop: "4px", maxWidth: "22ch", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: m.note, text: m.note }) : null);
  }
  function editAccess(m) {
    const date = el("input", { class: "input", type: "date", value: m.access_until || "" });
    const note = el("input", { class: "input", type: "text", maxlength: "200", placeholder: "例如：10 月交易量 120 口", value: m.note || "" });
    const quick = (label, val) => el("button", { class: "chip", type: "button", text: label, onclick: () => (date.value = val) });
    const err = el("div", { class: "form-error", role: "alert", hidden: true });
    const save = el("button", { class: "btn primary", type: "button", text: "儲存" });
    const mm = A.modal({
      title: "觀看資格",
      body: el("div", null,
        el("p", { class: "small sub", style: { marginTop: "14px", wordBreak: "break-all" }, text: m.email }),
        el("label", { class: "field" }, el("span", { class: "label", text: "可以看到哪一天（含當天）" }), date),
        el("div", { class: "chips", style: { marginTop: "10px" } }, quick("這個月底", monthEnd(0)), quick("下個月底", monthEnd(1)), quick("不限", "")),
        el("p", { class: "hint", text: "過了這天會員就不能看，到期前 7 天會在畫面上提醒他。留空白＝不限。" }),
        el("label", { class: "field" }, el("span", { class: "label", text: "備註（只有管理員看得到）" }), note),
        err),
      actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => mm.close() }), save],
    });
    save.addEventListener("click", async () => {
      A.setBusy(save, true, "儲存中…");
      try {
        const accessUntil = date.value || null;
        await api("/api/admin/members", { method: "PATCH", body: { userId: m.user_id, action: "access", accessUntil, note: note.value } });
        m.access_until = accessUntil;
        m.note = note.value.trim() || null;
        renderMembers();
        mm.close();
        A.toast(accessUntil ? `資格更新到 ${accessUntil}` : "已改成不限");
      } catch (e) {
        A.setBusy(save, false);
        err.textContent = e.message;
        err.hidden = false;
      }
    });
  }

  // ─────────────────────────────────────────────
  // 觀看統計
  // ─────────────────────────────────────────────
  async function loadStats() {
    const box = $("#statsBox");
    box.replaceChildren(loadingBox());
    let r;
    try {
      r = await api("/api/admin/stats");
    } catch (e) {
      return fail(e);
    }
    const n = r.memberCount || 0;
    $("#statsSub").textContent = `目前 ${n} 位會員。每一場有多少會員看、看到哪裡（不算管理員自己看的）`;
    const bar = (f) => el("span", { class: "usage" }, el("span", { class: "track" }, el("i", { style: { width: Math.round(f * 100) + "%" } })));
    const vids = (r.videos || []).filter((v) => v.is_published);
    const vTable = el("div", { class: "table-wrap" },
      el("table", { class: "table stack" },
        el("thead", null, el("tr", null, el("th", { text: "場次" }), el("th", { text: "看過" }), el("th", { class: "hide-sm", text: "看完" }), el("th", { text: "平均看到" }))),
        el("tbody", null, vids.length ? vids.map((v) =>
          el("tr", null,
            el("td", null, el("div", { class: "t-title", text: v.title }), el("div", { class: "small muted num", text: A.fmtDate(v.published_at) })),
            el("td", null, el("div", { class: "stat-cell" }, el("span", { class: "num stat-n", text: `${v.viewers}` }), el("span", { class: "small muted", text: n ? `／${n} 人` : "人" })), bar(n ? v.viewers / n : 0)),
            el("td", { class: "hide-sm" }, el("span", { class: "num stat-n", text: `${v.completed}` }), el("span", { class: "small muted", text: " 人" })),
            el("td", null, el("span", { class: "num stat-n", text: `${v.avg_pct}%` }))
          )) : [el("tr", null, el("td", { colspan: "4", class: "muted", text: "還沒有發布的影片" }))])));
    const mTable = el("div", { class: "table-wrap" },
      el("table", { class: "table stack" },
        el("thead", null, el("tr", null, el("th", { text: "會員" }), el("th", { text: "看過" }), el("th", { class: "hide-sm", text: "看完" }), el("th", { text: "最近觀看" }))),
        el("tbody", null, (r.members || []).length ? r.members.map((m) =>
          el("tr", null,
            el("td", null, el("div", { class: "t-title", style: { wordBreak: "break-all" }, text: m.email }), m.banned ? el("span", { class: "pill warn", text: "已停權" }) : null),
            el("td", null, el("span", { class: "num stat-n", text: `${m.watched}` }), el("span", { class: "small muted", text: vids.length ? `／${vids.length} 場` : " 場" })),
            el("td", { class: "hide-sm" }, el("span", { class: "num stat-n", text: `${m.completed}` }), el("span", { class: "small muted", text: " 場" })),
            el("td", { class: "small", text: m.last_watched_at ? A.fmtRel(m.last_watched_at) : "還沒看過" })
          )) : [el("tr", null, el("td", { colspan: "4", class: "muted", text: "還沒有會員" }))])));
    box.replaceChildren(
      el("h2", { class: "stats-h", text: "每一場" }), vTable,
      el("h2", { class: "stats-h", text: "每位會員" }), mTable
    );
  }

  async function setBan(m, ban) {
    if (ban) {
      const ok = await A.confirmDialog({
        title: "停權會員",
        message: `確定要停權 ${m.email} 嗎？對方會立刻無法觀看影片，之後可以再恢復。`,
        confirmText: "停權",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await api("/api/admin/members", { method: "PATCH", body: { userId: m.user_id, action: ban ? "ban" : "unban" } });
      m.banned = ban;
      renderMembers();
      A.toast(ban ? "已停權" : "已恢復觀看權限");
    } catch (e) {
      fail(e);
    }
  }

  async function resetPassword(m) {
    const ok = await A.confirmDialog({
      title: "重設密碼",
      message: `要幫 ${m.email} 產生一組新密碼嗎？舊密碼會立刻失效。`,
      confirmText: "產生新密碼",
    });
    if (!ok) return;
    try {
      const r = await api("/api/admin/members", { method: "PATCH", body: { userId: m.user_id, action: "reset" } });
      const msg = `你的會員專區新密碼：${r.password}\n登入後可以在右上角選單自行修改。`;
      const mm = A.modal({
        title: "新密碼",
        body: el("div", null,
          el("p", { class: "sub", style: { marginTop: "14px" }, text: `請私訊給 ${m.email}。這組密碼只會顯示這一次。` }),
          el("div", { class: "new-code" }, el("div", { class: "big num", style: { letterSpacing: ".04em" }, text: r.password }))
        ),
        actions: [
          el("button", { class: "btn", type: "button", onclick: () => A.copyText(r.password) }, icon("copy"), "只複製密碼"),
          el("button", { class: "btn primary", type: "button", onclick: () => { A.copyText(msg); mm.close(); } }, "複製訊息並關閉"),
        ],
      });
    } catch (e) {
      fail(e);
    }
  }
})();
