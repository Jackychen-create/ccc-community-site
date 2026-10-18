// 徽章（右欄）、拿到新徽章的恭喜、外觀主題選擇
// 規則在 shared/rules.js 的 BADGES、THEMES
import { $, el, api, modal, toast, applyTheme, currentTheme } from "../core/index.js";
import { state } from "./state.js";
import { THEMES, themeUnlocked, badgeById } from "../shared/rules.js";

let data = null; // GET /api/badges 的結果
const earned = () => (data?.badges || []).map((b) => b.id);

// 還沒拿到的徽章：寫出目前做到哪
function hint(id, p) {
  if (!p) return "";
  return {
    half: `往第二級最高到 ${p.bestPct}%`,
    qualified: `往第二級最高到 ${p.bestPct}%`,
    streak3: `目前最多連續 ${p.streak} 輪`,
    live10: `已看完 ${p.liveDone}／10 場`,
    host6: "看完同一位主講的 6 份",
    course18: `已看完 ${p.courseDone}／18 份`,
    notes10: `已寫 ${p.notes}／10 則`,
  }[id] || "";
}

export async function loadBadges() {
  if (!state.me || state.me.isAdmin) return;
  try {
    data = await api("/api/badges");
  } catch {
    return;
  }
  renderBadges();
  celebrateBadges();
}

export function renderBadges() {
  const box = $("#badgePanel");
  if (!data || state.me?.isAdmin) return (box.hidden = true);
  const have = new Map(data.badges.map((b) => [b.id, b]));
  box.hidden = false;
  box.replaceChildren(
    el("div", { class: "panel-head", style: { padding: "14px 18px" } },
      el("h2", { text: "我的徽章" }),
      el("span", { class: "pill" }, el("span", { class: "num", text: `${have.size}／${data.all.length}` }))),
    el("ul", { class: "badge-grid" },
      ...data.all.map((b) => {
        const got = have.get(b.id);
        const unlocks = THEMES.find((t) => t.unlock === b.id);
        const tip = `${b.name}：${b.desc}${got ? "（已拿到）" : hint(b.id, data.progress) ? `（${hint(b.id, data.progress)}）` : ""}${unlocks ? `｜解鎖主題「${unlocks.name}」` : ""}`;
        return el("li", { class: "badge" + (got ? " got" : ""), title: tip },
          el("span", { class: "badge-ico", "aria-hidden": "true", text: b.icon }),
          el("span", { class: "badge-name", text: b.name }),
          el("span", { class: "sr-only", text: tip }));
      })),
    el("p", { class: "small muted badge-note", text: "滑鼠移到徽章上看怎麼拿。有些徽章會解鎖新的外觀主題（右上角帳號選單 →「外觀主題」）。" })
  );
}

// 第一次拿到的徽章跳一次恭喜（等其他視窗關了再跳）
function celebrateBadges() {
  const fresh = (data?.badges || []).filter((b) => b.isNew).map((b) => badgeById(b.id)).filter(Boolean);
  if (!fresh.length) return;
  let tries = 0;
  const open = () => {
    if (document.querySelector(".modal-back, .lvl-back")) return ++tries < 180 && setTimeout(open, 1000);
    const themes = fresh.map((b) => THEMES.find((t) => t.unlock === b.id)).filter(Boolean);
    const ok = el("button", { class: "btn primary", type: "button", text: themes.length ? `換上「${themes[0].name}」` : "好" });
    const later = themes.length ? el("button", { class: "btn", type: "button", text: "之後再說" }) : null;
    const mm = modal({
      title: fresh.length > 1 ? `拿到 ${fresh.length} 個新徽章！` : "拿到新徽章！",
      body: el("div", { class: "badge-pop" },
        el("ul", { class: "badge-pop-list" }, ...fresh.map((b) => el("li", null,
          el("span", { class: "badge-pop-ico", "aria-hidden": "true", text: b.icon }),
          el("div", null, el("b", { text: b.name }), el("div", { class: "small sub", text: b.desc }))))),
        themes.length ? el("p", { class: "small", text: `解鎖了外觀主題：${themes.map((t) => `「${t.name}」`).join("、")}` }) : null),
      actions: [later, ok].filter(Boolean),
      onClose: () => {
        api("/api/badges", { method: "PATCH", body: { seen: true } }).catch(() => {});
        for (const b of data.badges) b.isNew = false;
      },
    });
    ok.addEventListener("click", () => { if (themes.length) setTheme(themes[0].id); mm.close(); });
    later?.addEventListener("click", () => mm.close());
  };
  setTimeout(open, 900);
}

// 帳號裡存的主題跟這台瀏覽器不一樣時（換電腦），用帳號的
export function syncThemeFromAccount() {
  const t = state.me?.theme;
  if (t && t !== currentTheme()) applyTheme(t);
}

async function setTheme(id) {
  const before = currentTheme();
  applyTheme(id);
  if (!state.me || state.me.isAdmin || !state.me.volume) return true; // 管理員只記在這台瀏覽器
  try {
    await api("/api/me", { method: "PATCH", body: { theme: id } });
    state.me.theme = id;
    return true;
  } catch (e) {
    applyTheme(before);
    toast(e.message, "err");
    return false;
  }
}

// 帳號選單 →「外觀主題」
export async function openThemePicker() {
  if (!data && state.me && !state.me.isAdmin) { try { data = await api("/api/badges"); renderBadges(); } catch {} }
  const isAdmin = !!state.me?.isAdmin;
  const grid = el("div", { class: "theme-grid", role: "group", "aria-label": "外觀主題" });
  const draw = () => grid.replaceChildren(...THEMES.map((t) => {
    const open = themeUnlocked(t.id, earned(), isAdmin);
    const need = t.unlock ? badgeById(t.unlock) : null;
    return el("button", {
      class: "theme-opt", type: "button", disabled: !open, "aria-pressed": String(currentTheme() === t.id),
      onclick: async () => { if (await setTheme(t.id)) { draw(); toast(`已換成「${t.name}」`); } },
    },
      el("span", { class: "theme-sw", "aria-hidden": "true" }, el("span", { style: { background: t.swatch[0] } }), el("span", { style: { background: t.swatch[1] } }), el("span", { class: "acc", style: { background: t.swatch[2] } })),
      el("span", { class: "theme-name" }, t.name, currentTheme() === t.id ? el("span", { class: "pill good", text: "使用中" }) : null),
      el("span", { class: "theme-desc", text: t.desc }),
      !open && need ? el("span", { class: "theme-lock", text: `🔒 拿到「${need.icon} ${need.name}」解鎖` }) : null);
  }));
  draw();
  modal({ title: "外觀主題", body: el("div", null, el("p", { class: "small sub", style: { marginTop: "12px" }, text: "換了馬上生效，也會記在你的帳號裡，換電腦一樣。" }), grid) });
}
