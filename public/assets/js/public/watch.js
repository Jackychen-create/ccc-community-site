// 公開影片頁（不用登入）：/watch?v=12 播單支；/watch 列出全部公開影片
// 資料來自 /api/public-video（只給已發布＋公開的影片）
const $ = (s) => document.querySelector(s);
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "text") n.textContent = v;
    else if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
}
const dur = (s) => {
  s = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
async function get(path) {
  let res;
  try { res = await fetch(path); } catch {
    await new Promise((r) => setTimeout(r, 1000));
    res = await fetch(path).catch(() => null);
  }
  if (!res) throw Object.assign(new Error("連線失敗，請檢查網路後重新整理"), { status: 0 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "發生錯誤，請稍後再試"), { status: res.status });
  return data;
}
const box = $("#pubBox");
const join = () => el("section", { class: "pub-join card" },
  el("h2", { text: "想加入 CCC 交易實驗室？" }),
  el("p", { class: "sub", text: "研究員可以看每週直播的完整留檔、教學課程，還能記筆記、跳章節。拿到實驗室密碼後就能註冊。" }),
  el("a", { class: "btn primary", href: "/", text: "我有實驗室密碼，前往註冊" }));

function showError(msg) {
  box.replaceChildren(el("div", { class: "empty" }, el("h2", { text: msg }), el("p", { class: "small", style: "margin-top:8px" }, el("a", { href: "/watch", text: "看其他公開影片" }))));
}

async function showVideo(id) {
  const v = await get(`/api/public-video?id=${encodeURIComponent(id)}`);
  document.title = `${v.title}｜CCC 交易實驗室`;
  const video = el("video", { class: "pub-video", controls: true, playsinline: true, preload: "metadata", poster: v.thumb_url || null, src: v.url });
  video.addEventListener("error", () => {
    if (video.dataset.retried) return;
    video.dataset.retried = "1"; // 連結過期就換一個新的，從原本的位置繼續
    const at = video.currentTime || 0;
    get(`/api/public-video?id=${encodeURIComponent(id)}`).then((d) => { video.src = d.url; video.currentTime = at; }).catch(() => {});
  });
  const chapters = (v.chapters || []).length
    ? el("ol", { class: "pub-chapters" }, ...v.chapters.map((c) => el("li", null, el("button", { type: "button", onclick: () => { video.currentTime = c.t; video.play().catch(() => {}); } }, el("span", { class: "num", text: dur(c.t) }), el("span", { text: c.title })))))
    : null;
  box.replaceChildren(...[
    el("div", { class: "pub-player" }, video),
    el("h1", { class: "pub-title", text: v.title }),
    v.duration_sec ? el("p", { class: "small muted num", text: `片長 ${dur(v.duration_sec)}` }) : null,
    v.description ? el("p", { class: "pub-desc", text: v.description }) : null,
    chapters ? el("h2", { class: "pub-h", text: "章節" }) : null,
    chapters,
    join()].filter(Boolean));
}

async function showList() {
  const { videos } = await get("/api/public-video");
  if (!videos.length) return showError("目前沒有公開的影片");
  if (videos.length === 1) { history.replaceState(null, "", `/watch?v=${videos[0].id}`); return showVideo(videos[0].id); }
  box.replaceChildren(
    el("h1", { class: "pub-title", text: "公開影片" }),
    el("div", { class: "pub-list" }, ...videos.map((v) => el("a", { class: "pub-item card", href: `/watch?v=${v.id}` },
      el("div", { class: "pub-thumb" }, v.thumb_url ? el("img", { src: v.thumb_url, alt: "", loading: "lazy" }) : null),
      el("div", null, el("b", { text: v.title }), v.duration_sec ? el("div", { class: "small muted num", text: dur(v.duration_sec) }) : null)))),
    join());
}

const id = new URLSearchParams(location.search).get("v");
(id ? showVideo(id) : showList()).catch((e) => showError(e.message));
