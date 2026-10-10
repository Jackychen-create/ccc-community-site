// 上傳到 R2 的基本工具：猜檔案格式、上傳進度列、直傳 R2、讀影片片長和封面
import * as A from "../core/index.js";
const { el } = A;

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

export function uploadRow(name, box) {
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
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`上傳失敗（${xhr.status}）。請確認 R2 的 CORS 設定。`)));
    xhr.onerror = () => reject(new Error("上傳中斷，請檢查網路或 R2 的 CORS 設定後重試"));
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
