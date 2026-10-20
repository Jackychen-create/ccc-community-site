// 編輯影片：標題、類型（直播留檔／教學課程／公開影片）、日期、主講、封面、簡介、章節、發布、教材、寄信通知
import * as A from "../core/index.js";
const { el, api, icon } = A;
import { COURSE_HOSTS, COURSE_PARTS, courseWeek } from "../shared/rules.js";
import { state } from "./state.js";
import { fail } from "./common.js";
import { renderVideos, deleteVideo } from "./videos.js";
import { guessType, uploadRow, putFile } from "./transfer.js";

const PARTS = Array.from({ length: COURSE_PARTS }, (_, i) => i + 1);

// 編輯影片（含教材附件）
export function openEditor(id, { justUploaded = false } = {}) {
  const v = state.videos.find((x) => x.id === id);
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

  // 類型：直播留檔／教學課程（CCC、OC、X 各 6 份，研究員加入後每週解鎖一份）／公開影片（不用登入，例如培訓計畫介紹）
  let kind = v.is_public ? "public" : v.course_host ? "course" : "live";
  const kindBtns = [["live", "直播留檔"], ["course", "教學課程"], ["public", "公開影片（不用登入）"]].map(([k, label]) => {
    const b = el("button", { class: "chip", type: "button", "aria-pressed": String(kind === k), text: label });
    b.addEventListener("click", () => { kind = k; paintKind(); });
    b.dataset.k = k;
    return b;
  });
  const cHost = el("select", { class: "input", "aria-label": "課程主講" }, ...COURSE_HOSTS.map((h) => el("option", { value: h, text: h })));
  const cPart = el("select", { class: "input", "aria-label": "第幾份" }, ...PARTS.map((n) => el("option", { value: String(n), text: `第 ${n} 份` })));
  cHost.value = v.course_host || COURSE_HOSTS[0];
  cPart.value = String(v.course_part || 1);
  const courseHint = el("div", { class: "hint" });
  const courseFields = el("div", { class: "field course-fields" },
    el("div", { class: "course-pick" }, cHost, cPart), courseHint);
  // 公開影片：分享連結
  const shareUrl = `${location.origin}/watch?v=${v.id}`;
  const publicFields = el("div", { class: "field" },
    el("div", { class: "share-row" },
      el("input", { class: "input num", type: "text", readonly: true, value: shareUrl, "aria-label": "分享連結", onfocus: (e) => e.target.select() }),
      el("button", { class: "btn sm", type: "button", onclick: () => A.copyText(shareUrl) }, icon("copy"), "複製連結")),
    el("div", { class: "hint", text: "任何人拿到連結都能看，不用登入；登入頁也會出現「還沒加入？先看…」。不會出現在研究員的直播留檔列表，也不寄通知。要發布才看得到。" }));
  const pubLabel = el("span", { text: "發布（研究員看得到）" });
  const hostField = hostOpts.length ? el("div", { class: "field" }, el("span", { class: "label", style: { display: "block", marginBottom: "8px" }, text: "主講（可複選）" }), hostBox) : null;
  const paintKind = () => {
    kindBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === kind)));
    courseFields.hidden = kind !== "course";
    publicFields.hidden = kind !== "public";
    pubLabel.textContent = kind === "public" ? "發布（拿到連結的人都看得到）" : "發布（研究員看得到）";
    if (hostField) hostField.hidden = kind === "course";
    const week = courseWeek(cHost.value, Number(cPart.value)) + 1;
    const taken = kind === "course" && state.videos.find((x) => x.id !== v.id && x.course_host === cHost.value && x.course_part === Number(cPart.value));
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
    const isPublic = typeof kind !== "undefined" ? kind === "public" : !!v.is_public;
    notifyNote.textContent = isPublic ? "公開影片是給還沒加入的人看的，不寄全體通知" : isCourse ? "教學課程依每個人的加入日期解鎖，不寄全體通知" : v.notified_at ? `上次寄出：${A.fmtRel(v.notified_at)}` : v.is_published ? "還沒寄過" : "發布後才能寄";
    notifyBtn.disabled = !v.is_published || isCourse || isPublic;
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
      publicFields,
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
      el("div", { class: "field" }, el("label", { class: "switch" }, pub, el("span", { class: "track" }), pubLabel)),
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
          course_host: kind === "course" ? cHost.value : null, course_part: kind === "course" ? Number(cPart.value) : null, is_public: kind === "public" },
      });
      const savedTitle = saved?.title || t;
      const wasPublished = v.is_published;
      Object.assign(v, { title: savedTitle, description: desc.value.trim() || null, published_at: date.value || A.today(), is_published: pub.checked, hosts: kind === "course" ? [cHost.value] : pickedHosts(), chapters: parseChapters(chapText.value).chapters,
        course_host: kind === "course" ? cHost.value : null, course_part: kind === "course" ? Number(cPart.value) : null, is_public: kind === "public" });
      renderVideos();
      m.close();
      if (kind === "public" && pub.checked) A.toast(`已儲存。分享連結：${shareUrl}`);
      else if (pub.checked && !wasPublished && kind !== "course") {
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
  const ui = uploadRow(file, box);
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
    ui.fail(e.message, () => uploadAttachment(v, file, box, rerender));
    A.report("upload", `教材上傳失敗：${e.message}`, { file: file.name, size: file.size });
  }
}
