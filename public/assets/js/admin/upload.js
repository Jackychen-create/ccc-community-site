// 上傳影片：選檔或拖進來 → 直傳 R2 → 建成草稿 → 打開編輯器補資訊
import * as A from "../core/index.js";
const { $, api } = A;
import { loadVideos } from "./videos.js";
import { openEditor } from "./editor.js";
import { guessType, uploadRow, putFile, probeVideo } from "./transfer.js";

// 正在上傳的檔案（登出、關分頁前會先確認）
export const activeUploads = new Set();

// 影片上傳
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

async function uploadVideo(file) {
  const ui = uploadRow(file, $("#uploads"));
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
    else {
      ui.fail(e.message, () => uploadVideo(file));
      A.report("upload", `影片上傳失敗：${e.message}`, { file: file.name, size: file.size });
    }
  } finally {
    activeUploads.delete(token);
  }
}
