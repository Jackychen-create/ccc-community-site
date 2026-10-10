// 版本：偵測新版本（跳出「重新整理」提示）、更新公告
import { el, icon } from "./dom.js";
import { store } from "./store.js";
import { modal } from "./ui.js";

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
export async function whatsNew({ all = false } = {}) {
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
