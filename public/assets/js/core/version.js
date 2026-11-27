// 版本：更新紀錄（只在研究員自己打開「更新紀錄」時顯示）。1.38.9 起更新不再自動公告、也不再跳「網站有新版本」
import { el } from "./dom.js";
import { modal } from "./ui.js";

let changelog = null;
async function fetchChangelog() {
  const r = await fetch("/changelog.json?t=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("changelog " + r.status);
  const list = await r.json();
  return Array.isArray(list) ? list : [];
}

// 更新紀錄：只有研究員自己按「更新紀錄」才打開，列出全部版本
export async function whatsNew({ all = false } = {}) {
  if (!all) return;
  try { changelog = changelog || await fetchChangelog(); } catch { return; }
  if (!changelog.length) return;
  const entries = changelog;
  const body = el("div", { class: "whatsnew" },
    ...entries.map((c) =>
      el("section", null,
        el("h3", null, el("span", { class: "num", text: "v" + c.version }), el("span", { class: "muted small", text: c.date || "" })),
        el("ul", null, ...(c.items || []).map((t) => el("li", { text: t })))
      )
    )
  );
  const m = modal({
    title: "更新紀錄",
    body,
    actions: [el("button", { class: "btn primary", type: "button", text: "知道了", onclick: () => m.close() })],
  });
}
