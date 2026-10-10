// 使用教學影片（放在 public/tutorial/）：手機看直式、電腦看橫式
// 先整支下載（約 6 MB）再播放：Cloudflare Pages 的靜態檔不一定支援分段讀取，直接播會不能拉進度條
import { el } from "./dom.js";
import { modal } from "./ui.js";

export function tutorial(who = "member") {
  const portrait = matchMedia("(max-width: 760px)").matches;
  const src = `/tutorial/${who}-${portrait ? "portrait" : "landscape"}.mp4`;
  const bar = el("i", { style: { width: "0%" } });
  const label = el("span", { class: "small muted", text: "影片載入中…" });
  const box = el("div", { class: "tut-loading" + (portrait ? " portrait" : "") },
    el("span", { class: "spinner" }), label, el("span", { class: "usage" }, el("span", { class: "track" }, bar)));
  const wrap = el("div", null, box);
  let blobUrl = null;
  let video = null;
  const ctrl = new AbortController();
  const missing = () => wrap.replaceChildren(el("div", { class: "empty", style: { padding: "36px 12px" } },
    el("h2", { text: "教學影片還沒放上網站" }),
    el("p", { class: "small", style: { marginTop: "6px" }, text: "請管理員把影片放到 public/tutorial/ 之後重新部署。" })));
  const m = modal({
    title: who === "admin" ? "管理員使用教學" : "使用教學",
    body: wrap,
    onClose: () => {
      ctrl.abort();
      if (video) video.pause();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
  });
  m.box.classList.add("modal-video");
  (async () => {
    try {
      const res = await fetch(src, { signal: ctrl.signal });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.startsWith("video/")) return missing();
      const total = Number(res.headers.get("content-length")) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        if (total) {
          bar.style.width = Math.round((got / total) * 100) + "%";
          label.textContent = `影片載入中… ${Math.round((got / total) * 100)}%`;
        }
      }
      blobUrl = URL.createObjectURL(new Blob(chunks, { type: "video/mp4" }));
      video = el("video", {
        class: "tut-video" + (portrait ? " portrait" : ""), src: blobUrl,
        controls: true, playsinline: true, controlslist: "nodownload", disablepictureinpicture: true,
      });
      video.addEventListener("error", missing);
      wrap.replaceChildren(video);
      video.play().catch(() => {});
    } catch (e) {
      if (e.name !== "AbortError") missing();
    }
  })();
  return m;
}
