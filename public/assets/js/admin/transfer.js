// 上傳到 R2 的基本工具：猜檔案格式、上傳進度列、直傳 R2、讀影片片長和封面
import * as A from "../core/index.js";
const { el, icon } = A;

export function guessType(name) {
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

// 一個檔案的上傳列：圖示、檔名、大小和進度、狀態、操作；失敗時顯示白話原因和「重新上傳」
// file 可以是 File（會顯示格式和大小）或檔名字串
export function uploadRow(file, box) {
  const name = typeof file === "string" ? file : file.name;
  const ext = (name.match(/\.([a-z0-9]{1,5})$/i) || [, ""])[1].toUpperCase();
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  const facts = [ext, typeof file === "string" ? "" : A.fmtBytes(file.size)].filter(Boolean).join(" · ");

  const bar = el("i");
  const prog = el("div", { class: "progress active" }, bar);
  const state = el("span", { class: "pill", text: "準備中" });
  const live = el("span", { class: "up-live num" });
  const cancel = el("button", { class: "btn sm ghost", type: "button", text: "取消" });
  const actions = el("span", { class: "up-actions" }, cancel);
  const note = el("p", { class: "up-note", hidden: true });
  const msg = el("div", { class: "up-msg", role: "alert", hidden: true });
  const ico = el("span", { class: "up-ico", "aria-hidden": "true" }, icon("film"));
  const row = el("div", { class: "upload" },
    el("div", { class: "up-head" },
      ico,
      el("div", { class: "up-main" },
        el("div", { class: "up-name", title: name }, el("span", { class: "up-base", text: base })),
        el("div", { class: "up-meta" }, facts ? el("span", { class: "num", text: facts }) : null, live)),
      state, actions),
    prog, note, msg);
  box.prepend(row);
  let abort = null;
  cancel.addEventListener("click", () => {
    if (abort) abort();
    else row.remove();
  });
  return {
    setAbort(fn) { abort = fn; },
    status(t) { state.textContent = t; },
    progress(p, text) {
      bar.style.width = Math.round(p * 100) + "%";
      if (text) live.textContent = text;
    },
    note(t) { note.replaceChildren(icon("alert"), el("span", { text: t })); note.hidden = !t; },
    done(t) {
      row.classList.add("is-done");
      prog.className = "progress done";
      bar.style.width = "100%";
      live.textContent = "";
      state.className = "pill good";
      state.replaceChildren(el("span", { class: "dot" }), t || "完成");
      ico.replaceChildren(icon("check"));
      cancel.remove();
    },
    // onRetry 有給就多一顆「重新上傳」
    fail(t, onRetry) {
      abort = null;
      row.classList.add("is-fail");
      prog.hidden = true;
      live.textContent = "";
      state.className = "pill warn";
      state.replaceChildren(el("span", { class: "dot" }), "上傳失敗");
      ico.replaceChildren(icon("alert"));
      msg.replaceChildren(
        el("b", { text: "這個檔案沒有傳上去" }),
        el("span", { text: t || "請稍後再試一次。" }));
      msg.hidden = false;
      actions.replaceChildren(...[
        onRetry ? el("button", { class: "btn sm", type: "button", text: "重新上傳", onclick: () => { row.remove(); onRetry(); } }) : null,
        el("button", { class: "btn sm ghost", type: "button", "aria-label": `移除 ${name}`, onclick: () => row.remove() }, icon("trash"), "移除"),
      ].filter(Boolean));
    },
    remove() { row.remove(); },
  };
}

// 直接 PUT 到 R2，回報進度、速度、剩餘時間

export function putFile(url, file, contentType, ui) {
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
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`影片空間（R2）拒絕了這次上傳（代碼 ${xhr.status}）。通常是 R2 金鑰設定不對（例如換了金鑰，但 Cloudflare 還沒重新部署）。`)));
    xhr.onerror = () => reject(new Error(navigator.onLine === false ? "網路斷線了，連上網路後按「重新上傳」。" : "連不上影片空間（R2）。網路正常的話，通常是 R2 的 CORS 設定還沒允許這個網址。"));
    xhr.onabort = () => reject(Object.assign(new Error("已取消"), { aborted: true }));
    ui.setAbort(() => xhr.abort());
    xhr.send(file);
  });
}

// 在瀏覽器裡讀片長、擷取一張封面（不支援的格式就跳過）

export function probeVideo(file) {
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
