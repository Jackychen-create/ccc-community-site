// 後台：影片上傳與管理、實驗室密碼、研究員
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
  const COURSE_HOSTS = ["CCC", "OC", "X"]; // 教學課程解鎖順序

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
  $("#tutorialLink").addEventListener("click", (e) => {
    e.preventDefault();
    A.tutorial("admin");
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
    const view = ["videos", "invites", "members", "volumes", "stats"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "videos";
    document.querySelectorAll("[data-view-panel]").forEach((p) => (p.hidden = p.dataset.viewPanel !== view));
    document.querySelectorAll(".nav a").forEach((a) => {
      if (a.dataset.view === view) {
        a.setAttribute("aria-current", "page");
        // 手機上導覽是橫向捲動，切過去時把目前這頁捲進畫面
        if (matchMedia("(max-width: 900px)").matches) a.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      else a.removeAttribute("aria-current");
    });
    document.title = { videos: "影片", invites: "實驗室密碼", members: "研究員", volumes: "交易量", stats: "觀看統計" }[view] + "｜後台管理";
    if (view === "videos") loadVideos();
    if (view === "invites") loadInvites();
    if (view === "members") loadMembers();
    if (view === "stats") loadStats();
    if (view === "volumes") loadVolumes();
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
          el("div", { class: "t-title" }, v.course_host ? el("span", { class: "pill brass course-tag", text: `課程 ${v.course_host} ${v.course_part}/6` }) : null, v.title),
          el("div", { class: "t-sub", text: v.description || "尚未填寫簡介" }),
          v.hosts?.length && !v.course_host ? el("div", { class: "hosts", style: { marginTop: "6px" } }, ...v.hosts.map((h) => el("span", { class: "host", text: h }))) : null),
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
    // 教學課程進度：CCC、X、OC 各 6 份，哪幾份上架了
    const slot = (h, n) => videos.find((x) => x.course_host === h && x.course_part === n);
    const filled = COURSE_HOSTS.reduce((a, h) => a + [1, 2, 3, 4, 5, 6].filter((n) => slot(h, n)?.is_published).length, 0);
    const courseCard = el("div", { class: "card course-grid-card" },
      el("div", { class: "course-grid-head" },
        el("h2", { text: "教學課程" }),
        el("span", { class: "small muted", text: `已上架 ${filled}／18・研究員加入後每週解鎖一份（CCC→OC→X，每 4 週休息一週）` })),
      el("div", { class: "course-grid" },
        ...COURSE_HOSTS.map((h) => el("div", { class: "course-grid-row" },
          el("span", { class: "host", text: h }),
          ...[1, 2, 3, 4, 5, 6].map((n) => {
            const x = slot(h, n);
            return el("button", {
              class: "cg-cell" + (x ? (x.is_published ? " on" : " draft") : ""), type: "button",
              title: x ? `${h} 第 ${n} 份：${x.title}${x.is_published ? "" : "（草稿）"}` : `${h} 第 ${n} 份：還沒有影片。上傳後在「編輯」把類型改成教學課程`,
              onclick: () => (x ? openEditor(x.id) : A.toast(`上傳影片後，在「編輯」把類型選「教學課程」、${h} 第 ${n} 份`)),
            }, String(n));
          })))));
    box.replaceChildren(
      courseCard,
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
      message: `確定要刪除「${v.title}」嗎？影片檔、封面、教材和研究員的觀看紀錄會一起刪除，無法復原。`,
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
    const desc = el("textarea", { class: "textarea", maxlength: "2000", rows: "4", placeholder: "這場直播在講什麼？研究員在列表和播放頁都看得到。" });
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

    // 類型：直播留檔／教學課程（CCC、X、OC 各 6 份，研究員加入後每週解鎖一份）
    let kind = v.course_host ? "course" : "live";
    const kindBtns = [["live", "直播留檔"], ["course", "教學課程"]].map(([k, label]) => {
      const b = el("button", { class: "chip", type: "button", "aria-pressed": String(kind === k), text: label });
      b.addEventListener("click", () => { kind = k; paintKind(); });
      b.dataset.k = k;
      return b;
    });
    const cHost = el("select", { class: "input", "aria-label": "課程主講" }, ...COURSE_HOSTS.map((h) => el("option", { value: h, text: h })));
    const cPart = el("select", { class: "input", "aria-label": "第幾份" }, ...[1, 2, 3, 4, 5, 6].map((n) => el("option", { value: String(n), text: `第 ${n} 份` })));
    cHost.value = v.course_host || COURSE_HOSTS[0];
    cPart.value = String(v.course_part || 1);
    const courseHint = el("div", { class: "hint" });
    const courseFields = el("div", { class: "field course-fields" },
      el("div", { class: "course-pick" }, cHost, cPart), courseHint);
    const hostField = hostOpts.length ? el("div", { class: "field" }, el("span", { class: "label", style: { display: "block", marginBottom: "8px" }, text: "主講（可複選）" }), hostBox) : null;
    const paintKind = () => {
      kindBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === kind)));
      courseFields.hidden = kind !== "course";
      if (hostField) hostField.hidden = kind === "course";
      const week = (Number(cPart.value) - 1) * 4 + COURSE_HOSTS.indexOf(cHost.value) + 1;
      const taken = kind === "course" && videos.find((x) => x.id !== v.id && x.course_host === cHost.value && x.course_part === Number(cPart.value));
      courseHint.textContent = taken
        ? `「${cHost.value} 第 ${cPart.value} 份」已經是「${taken.title}」，要換的話先把那支改掉。`
        : `研究員加入後第 ${week} 週解鎖（${week === 1 ? "加入當天" : `加入第 ${(week - 1) * 7} 天`}）。不會出現在直播留檔列表，也不寄全體通知。`;
      courseHint.classList.toggle("warn-text", !!taken);
      paintNotify();
    };
    cHost.addEventListener("change", paintKind);
    cPart.addEventListener("change", paintKind);

    // 章節：一行一段「05:30 開盤區間」
    const chapText = el("textarea", { class: "textarea mono-ish", rows: "5", placeholder: "一行一段，時間在前面，例如：\n00:00 開場\n05:30 開盤區間怎麼畫\n32:10 停損案例\n1:02:00 Q&A" });
    chapText.value = (v.chapters || []).map((c) => `${A.fmtDur(c.t)} ${c.title}`).join("\n");
    const chapHint = el("div", { class: "hint" });
    const updateChapHint = () => {
      const { chapters, bad } = parseChapters(chapText.value);
      chapHint.textContent = bad.length
        ? `第 ${bad.join("、")} 行看不懂時間，會略過。時間要寫成 5:30 或 1:02:10`
        : chapters.length ? `共 ${chapters.length} 段，研究員可以在播放頁點章節直接跳過去` : "可以不填。填了之後研究員在播放頁會看到章節，也能用搜尋找到。";
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
    const notifyBtn = el("button", { class: "btn sm", type: "button" }, icon("mail"), "寄信通知研究員");
    const notifyNote = el("span", { class: "small muted" });
    const paintNotify = () => {
      const isCourse = typeof kind !== "undefined" ? kind === "course" : !!v.course_host;
      notifyNote.textContent = isCourse ? "教學課程依每個人的加入日期解鎖，不寄全體通知" : v.notified_at ? `上次寄出：${A.fmtRel(v.notified_at)}` : v.is_published ? "還沒寄過" : "發布後才能寄";
      notifyBtn.disabled = !v.is_published || isCourse;
    };
    notifyBtn.addEventListener("click", async () => {
      if (v.notified_at && !(await A.confirmDialog({ title: "再寄一次？", message: `這一場 ${A.fmtRel(v.notified_at)} 已經寄過通知，確定要再寄一次嗎？`, confirmText: "再寄一次" }))) return;
      A.setBusy(notifyBtn, true, "寄送中…");
      try {
        const r = await api("/api/admin/notify", { method: "POST", body: { videoId: v.id } });
        v.notified_at = new Date().toISOString();
        A.toast(`已寄給 ${r.sent} 位研究員`);
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
        justUploaded ? el("p", { class: "small sub", style: { marginTop: "14px" }, text: "影片目前是草稿，研究員還看不到。填好標題和簡介，按下儲存就會發布。" }) : null,
        el("label", { class: "field" }, el("span", { class: "label", text: "標題" }), title),
        el("div", { class: "field" }, el("span", { class: "label", style: { display: "block", marginBottom: "8px" }, text: "類型" }), el("div", { class: "chips" }, ...kindBtns)),
        courseFields,
        el("label", { class: "field" }, el("span", { class: "label", text: "日期" }), date),
        hostField,
        el("div", { class: "field" },
          el("span", { class: "label", style: { display: "block", marginBottom: "8px" }, text: "封面" }),
          el("div", { class: "cover-row" }, coverImg,
            el("div", { class: "cover-actions" },
              el("button", { class: "btn sm", type: "button", onclick: () => pickFrame(v, paintCover) }, icon("video"), "從影片挑一格"),
              el("button", { class: "btn sm", type: "button", onclick: () => coverInput.click() }, icon("image"), "上傳圖片"),
              coverInput))),
        el("label", { class: "field" }, el("span", { class: "label", text: "簡介" }), desc),
        el("label", { class: "field" }, el("span", { class: "label", text: "章節" }), chapText, chapHint),
        el("div", { class: "field" }, el("label", { class: "switch" }, pub, el("span", { class: "track" }), el("span", { text: "發布（研究員看得到）" }))),
        el("div", { class: "field" },
          el("div", { class: "section-label" }, el("span", { class: "label", text: "教材附件" }),
            el("button", { class: "btn sm", type: "button", onclick: () => attInput.click() }, icon("plus"), "新增教材")),
          attList, attUploads, attInput),
        el("div", { class: "field notify-row" }, notifyBtn, notifyNote),
        err,
        el("p", { class: "small", style: { marginTop: "16px" } }, el("a", { href: `/#/v/${v.id}`, target: "_blank", rel: "noopener", class: "meta-ico" }, icon("ext"), "用研究員畫面預覽"))
      ),
      actions: [
        el("button", { class: "btn danger", type: "button", style: { marginRight: "auto" }, onclick: async () => {
          if (await deleteVideo(v)) m.close();
        } }, icon("trash"), "刪除"),
        el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }),
        save,
      ],
    });

    paintKind();
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
          body: { id: v.id, title: t, description: desc.value, published_at: date.value || A.today(), is_published: pub.checked, hosts: kind === "course" ? [cHost.value] : pickedHosts(), chapters: parseChapters(chapText.value).chapters,
            course_host: kind === "course" ? cHost.value : null, course_part: kind === "course" ? Number(cPart.value) : null },
        });
        const savedTitle = saved?.title || t;
        const wasPublished = v.is_published;
        Object.assign(v, { title: savedTitle, description: desc.value.trim() || null, published_at: date.value || A.today(), is_published: pub.checked, hosts: kind === "course" ? [cHost.value] : pickedHosts(), chapters: parseChapters(chapText.value).chapters,
          course_host: kind === "course" ? cHost.value : null, course_part: kind === "course" ? Number(cPart.value) : null });
        renderVideos();
        m.close();
        if (pub.checked && !wasPublished && kind !== "course") {
          // 剛發布：問要不要順便寄信
          const send = await A.confirmDialog({ title: "已發布，研究員現在看得到了", message: "要順便寄信通知研究員有新的一場嗎？（關掉通知的研究員不會收到）", confirmText: "寄信通知" });
          if (send) {
            try {
              const r = await api("/api/admin/notify", { method: "POST", body: { videoId: v.id } });
              v.notified_at = new Date().toISOString();
              A.toast(`已寄給 ${r.sent} 位研究員`);
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
      if (!info.playable) ui.note("這個檔案在瀏覽器裡讀不出畫面，研究員可能也無法播放。建議轉成 MP4（H.264）再上傳。");

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
      box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: "還沒有實驗室密碼" }), el("p", { class: "small", style: { marginTop: "6px" }, text: "在右邊產生第一組，把註冊連結傳給研究員。" })));
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
  // 研究員
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
    $("#memberSub").textContent = members.length ? `共 ${members.length} 位，${active} 位可觀看` : "用實驗室密碼加入的研究員";
    const list = members.filter((m) => !memberQuery || `${m.email} ${m.invite_code || ""}`.toLowerCase().includes(memberQuery));
    const box = $("#memberTableBox");
    if (!members.length) {
      box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: "還沒有研究員" }), el("p", { class: "small", style: { marginTop: "6px" }, text: "到「實驗室密碼」產生一組，把註冊連結傳出去。" })));
      return;
    }
    if (!list.length) {
      box.replaceChildren(el("div", { class: "empty" }, el("p", { text: "找不到符合的研究員" })));
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
    const note = el("input", { class: "input", type: "text", maxlength: "200", placeholder: "例如：先試用一個月", value: m.note || "" });
    const quick = (label, val) => el("button", { class: "chip", type: "button", text: label, onclick: () => (date.value = val) });
    const err = el("div", { class: "form-error", role: "alert", hidden: true });
    const save = el("button", { class: "btn primary", type: "button", text: "儲存" });
    const mm = A.modal({
      title: "觀看資格",
      body: el("div", null,
        el("p", { class: "small sub", style: { marginTop: "14px", wordBreak: "break-all" }, text: m.email }),
        el("label", { class: "field" }, el("span", { class: "label", text: "可以看到哪一天（含當天）" }), date),
        el("div", { class: "chips", style: { marginTop: "10px" } }, quick(`今天起一個月（${cycleEnd(twToday()).slice(5).replace("-", "/")}）`, cycleEnd(twToday())), quick("這個月底", monthEnd(0)), quick("不限", "")),
        el("p", { class: "hint", text: "過了這天研究員就不能看，到期前 7 天會在畫面上提醒他。留空白＝不限。" }),
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
  // 每月交易量（OKX、Bybit、UM 任一間達標 → 看到那個月底）
  // ─────────────────────────────────────────────
  let vol = null; // 伺服器回來的這個月資料
  const fmtUsd = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const parseAmount = (t) => {
    const s = String(t || "").replace(/[,\s，]/g, "").replace(/usdt?$/i, "");
    if (!s) return null;
    // 支援 330萬、1.2m、500k
    const m = s.match(/^(\d+(?:\.\d+)?)(萬|w|m|k)?$/i);
    if (!m) return NaN;
    const mult = { "萬": 1e4, w: 1e4, W: 1e4, m: 1e6, M: 1e6, k: 1e3, K: 1e3 }[m[2]] || 1;
    return Math.round(Number(m[1]) * mult * 100) / 100;
  };
  const shortUsd = (n) => (n >= 1e4 ? `${Math.round((n / 1e4) * 10) / 10} 萬` : fmtUsd(n));

  $("#volMonth").value = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
  $("#volMonth").addEventListener("change", () => loadVolumes());
  $("#volQualOn").addEventListener("change", () => vol && vol._refresh && vol._refresh());
  $("#volQualOn").value = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  // 達標日起算一個月：10/15 → 11/14
  const cycleEnd = (date) => {
    const [y, m, d] = date.split("-").map(Number);
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const next = new Date(Date.UTC(y, m, Math.min(d, last)));
    next.setUTCDate(next.getUTCDate() - 1);
    return next.toISOString().slice(0, 10);
  };
  const mdv = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  async function loadVolumes() {
    const box = $("#volBox");
    box.replaceChildren(loadingBox());
    try {
      vol = await api(`/api/admin/volumes?month=${encodeURIComponent($("#volMonth").value)}`);
      renderVolumes();
    } catch (e) {
      fail(e);
    }
  }

  function renderVolumes() {
    const { exchanges, threshold, rows } = vol;
    $("#volThreshold").replaceChildren(icon("edit"), `門檻 ${shortUsd(threshold)} USDT`);
    const passed = rows.filter((r) => r.qualified).length;
    $("#volSub").textContent = `${exchanges.join("、")} 任一間當月成交金額達 ${fmtUsd(threshold)} USDT，達標那天起可以看一個月（例如 10/15 達標，看到 11/14）。這個月 ${passed}／${rows.length} 位達標。`;
    const box = $("#volBox");
    if (!rows.length) {
      box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: "還沒有研究員" })));
      return;
    }
    const inputs = new Map(); // user_id → {ex: input}
    const saveBtn = el("button", { class: "btn primary", type: "button", disabled: true }, "儲存這個月的交易量");
    const dirty = new Set();
    const refreshers = [];
    const resultCell = (r, cell) => {
      const vals = exchanges.map((ex) => parseAmount(inputs.get(r.user_id)[ex].value) || 0);
      const best = Math.max(0, ...vals);
      const ok = vals.some((v) => v >= threshold);
      const qualOn = r.qualified_at || $("#volQualOn").value;
      cell.replaceChildren(
        ok ? el("span", { class: "pill good", title: `${mdv(qualOn)} 達標，看到 ${mdv(cycleEnd(qualOn))}` }, el("span", { class: "dot" }), `達標 ${mdv(qualOn)}→${mdv(cycleEnd(qualOn))}`)
           : el("span", { class: "small muted" }, best ? `還差 ${shortUsd(threshold - best)}` : "未填"),
        el("span", { class: "usage" }, el("span", { class: "track" }, el("i", { style: { width: Math.min(100, (best / threshold) * 100) + "%" } })))
      );
    };
    const accessText = (r) => (!r.access_until ? "不限" : r.access_until < new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) ? `已過期 ${r.access_until}` : `到 ${r.access_until}`);
    const trs = rows.map((r) => {
      const map = {};
      const result = el("td", { class: "vol-result" });
      const cells = exchanges.map((ex) => {
        const inp = el("input", { class: "input vol-input num", type: "text", inputmode: "decimal", "aria-label": `${r.email} ${ex} 交易量`, placeholder: "0",
          value: r.amounts?.[ex] ? fmtUsd(r.amounts[ex]) : "" });
        inp.addEventListener("input", () => {
          dirty.add(r.user_id);
          saveBtn.disabled = false;
          inp.classList.toggle("bad", Number.isNaN(parseAmount(inp.value)));
          resultCell(r, result);
        });
        inp.addEventListener("blur", () => {
          const n = parseAmount(inp.value);
          if (n !== null && !Number.isNaN(n)) inp.value = fmtUsd(n);
        });
        map[ex] = inp;
        return el("td", { "data-label": ex }, inp);
      });
      inputs.set(r.user_id, map);
      resultCell(r, result);
      refreshers.push(() => resultCell(r, result));
      return el("tr", null,
        el("td", null, el("div", { class: "t-title", style: { wordBreak: "break-all" }, text: r.email }),
          r.banned ? el("span", { class: "pill warn", style: { marginTop: "6px" } }, "已停權") : null,
          r.updated_by ? el("div", { class: "small muted", text: `${A.fmtRel(r.updated_at)} 由 ${r.updated_by.split("@")[0]} 更新` }) : null),
        ...cells,
        result,
        el("td", { class: "small hide-sm", text: accessText(r) }));
    });
    box.replaceChildren(
      el("div", { class: "table-wrap" },
        el("table", { class: "table stack vol-table" },
          el("thead", null, el("tr", null, el("th", { text: "研究員" }), ...exchanges.map((ex) => el("th", { text: `${ex}（USDT）` })), el("th", { text: "結果" }), el("th", { class: "hide-sm", text: "觀看資格" }))),
          el("tbody", null, trs))),
      el("div", { class: "vol-foot" },
        el("p", { class: "small muted", text: "可以打 3300000、3,300,000、330萬 或 3.3m。這次新達標的人，資格延長到「達標日」起一個月；這個月已經達標過的不會再延；「不限」的研究員不會被改。" }),
        saveBtn)
    );
    vol._inputs = inputs;
    vol._dirty = dirty;
    vol._refresh = () => refreshers.forEach((f) => f());
    vol._markDirty = () => (saveBtn.disabled = false);
    saveBtn.addEventListener("click", async () => {
      const out = [];
      for (const id of dirty) {
        const amounts = {};
        for (const ex of exchanges) {
          const n = parseAmount(inputs.get(id)[ex].value);
          if (Number.isNaN(n)) return A.toast("有數字看不懂（紅框），請修正後再存", "err");
          if (n !== null) amounts[ex] = n;
        }
        out.push({ userId: id, amounts });
      }
      if (!out.length) return;
      A.setBusy(saveBtn, true, "儲存中…");
      try {
        const r = await api("/api/admin/volumes", { method: "POST", body: { month: vol.month, qualifiedOn: $("#volQualOn").value, rows: out } });
        vol = r;
        renderVolumes();
        A.toast(r.extended ? `已儲存 ${r.saved} 位，${r.extended} 位的資格延長到 ${r.until}` : `已儲存 ${r.saved} 位`);
        membersLoaded = false;
      } catch (e) {
        A.setBusy(saveBtn, false);
        fail(e);
      }
    });
  }

  // 修改門檻
  $("#volThreshold").addEventListener("click", () => {
    if (!vol) return;
    const inp = el("input", { class: "input num", type: "text", inputmode: "decimal", value: fmtUsd(vol.threshold) });
    const err = el("div", { class: "form-error", role: "alert", hidden: true });
    const save = el("button", { class: "btn primary", type: "button", text: "儲存門檻" });
    const m = A.modal({
      title: "交易量門檻",
      body: el("div", null,
        el("label", { class: "field" }, el("span", { class: "label", text: "任一間交易所當月成交金額（USDT）達到" }), inp),
        el("p", { class: "hint", text: "改了之後，這個月已經填過的交易量會照新門檻重新判斷，但已經延長的資格不會被收回。" }),
        err),
      actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }), save],
    });
    save.addEventListener("click", async () => {
      const n = parseAmount(inp.value);
      if (!n || Number.isNaN(n)) {
        err.textContent = "請輸入大於 0 的數字";
        err.hidden = false;
        return;
      }
      A.setBusy(save, true, "儲存中…");
      try {
        await api("/api/admin/volumes", { method: "PATCH", body: { threshold: n } });
        m.close();
        A.toast(`門檻改成 ${fmtUsd(n)} USDT`);
        loadVolumes();
      } catch (e) {
        A.setBusy(save, false);
        err.textContent = e.message;
        err.hidden = false;
      }
    });
  });

  // 貼上一整批：每行「Email 交易所 金額」或「Email OKX Bybit UM」
  $("#volPaste").addEventListener("click", () => {
    if (!vol || !vol._inputs) return;
    const ta = el("textarea", { class: "textarea mono-ish", rows: "8", placeholder: "每行一位，例如：\namy@example.com OKX 3,500,000\nbob@gmail.com Bybit 120萬\n或照順序填三間：\namy@example.com 0 3500000 0" });
    const out = el("div", { class: "hint" });
    const apply = el("button", { class: "btn primary", type: "button", text: "填進表格" });
    const m = A.modal({
      title: "貼上一整批交易量",
      body: el("div", null, el("p", { class: "small sub", style: { marginTop: "14px" }, text: `從交易所後台或試算表複製，順序是 ${vol.exchanges.join("、")}。填進表格後檢查一下，再按「儲存這個月的交易量」。` }), el("div", { class: "field" }, ta), out),
      actions: [el("button", { class: "btn", type: "button", text: "取消", onclick: () => m.close() }), apply],
    });
    let done = false;
    apply.addEventListener("click", () => {
      if (done) return m.close();
      const byEmail = new Map(vol.rows.map((r) => [r.email.toLowerCase(), r.user_id]));
      const exLower = new Map(vol.exchanges.map((e) => [e.toLowerCase(), e]));
      let filled = 0;
      const missing = [];
      const bad = [];
      ta.value.split(/\r?\n/).forEach((line, i) => {
        // 試算表複製是 Tab 分隔；手打是空白分隔（數字裡的千分位逗號保留）；都沒有才當成 CSV 逗號分隔
        const t = line.trim();
        let parts = t.includes("\t") ? t.split(/\t+/) : t.split(/\s+/);
        if (parts.length === 1) parts = t.split(/[,，]/);
        parts = parts.map((x) => x.trim()).filter(Boolean);
        if (!parts.length) return;
        const email = (parts[0] || "").toLowerCase();
        const id = byEmail.get(email);
        if (!id) return missing.push(parts[0]);
        const map = vol._inputs.get(id);
        if (parts.length >= 3 && exLower.has(parts[1].toLowerCase())) {
          const n = parseAmount(parts.slice(2).join(""));
          if (n === null || Number.isNaN(n)) return bad.push(i + 1);
          map[exLower.get(parts[1].toLowerCase())].value = fmtUsd(n);
        } else if (parts.length === vol.exchanges.length + 1) {
          const nums = parts.slice(1).map(parseAmount);
          if (nums.some((n) => n === null || Number.isNaN(n))) return bad.push(i + 1);
          vol.exchanges.forEach((ex, k) => (map[ex].value = fmtUsd(nums[k])));
        } else return bad.push(i + 1);
        map[vol.exchanges[0]].dispatchEvent(new Event("input"));
        filled++;
      });
      if (bad.length || missing.length) {
        out.textContent = [
          filled ? `已填進 ${filled} 行。` : "",
          missing.length ? `找不到這些研究員：${missing.slice(0, 5).join("、")}${missing.length > 5 ? " 等" : ""}。` : "",
          bad.length ? `第 ${bad.slice(0, 8).join("、")} 行看不懂。` : "",
        ].join(" ");
        out.classList.add("warn-text");
        if (!filled) return;
        apply.textContent = "知道了";
        done = true;
        return;
      }
      m.close();
      A.toast(`已填進 ${filled} 位，檢查後按「儲存這個月的交易量」`);
    });
  });

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
    $("#statsSub").textContent = `目前 ${n} 位研究員。每一場有多少研究員看、看到哪裡（不算管理員自己看的）`;
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
        el("thead", null, el("tr", null, el("th", { text: "研究員" }), el("th", { text: "看過" }), el("th", { class: "hide-sm", text: "看完" }), el("th", { text: "最近觀看" }))),
        el("tbody", null, (r.members || []).length ? r.members.map((m) =>
          el("tr", null,
            el("td", null, el("div", { class: "t-title", style: { wordBreak: "break-all" }, text: m.email }), m.banned ? el("span", { class: "pill warn", text: "已停權" }) : null),
            el("td", null, el("span", { class: "num stat-n", text: `${m.watched}` }), el("span", { class: "small muted", text: vids.length ? `／${vids.length} 場` : " 場" })),
            el("td", { class: "hide-sm" }, el("span", { class: "num stat-n", text: `${m.completed}` }), el("span", { class: "small muted", text: " 場" })),
            el("td", { class: "small", text: m.last_watched_at ? A.fmtRel(m.last_watched_at) : "還沒看過" })
          )) : [el("tr", null, el("td", { colspan: "4", class: "muted", text: "還沒有研究員" }))])));
    box.replaceChildren(
      el("h2", { class: "stats-h", text: "每一場" }), vTable,
      el("h2", { class: "stats-h", text: "每位研究員" }), mTable
    );
  }

  async function setBan(m, ban) {
    if (ban) {
      const ok = await A.confirmDialog({
        title: "停權研究員",
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
      const msg = `你的交易實驗室新密碼：${r.password}\n登入後可以在右上角選單自行修改。`;
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
