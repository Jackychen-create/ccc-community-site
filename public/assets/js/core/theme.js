// 外觀主題：套用、記在這台瀏覽器（下次打開由 /assets/theme-boot.js 先套上）
import { store } from "./store.js";
import { THEMES, DEFAULT_THEME, themeById } from "../shared/rules.js";

export const currentTheme = () => document.documentElement.getAttribute("data-theme") || DEFAULT_THEME;
export function applyTheme(id) {
  const t = themeById(id) || themeById(DEFAULT_THEME);
  if (t.id === DEFAULT_THEME) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t.id);
  store.set("theme", t.id);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.swatch[0]);
  return t.id;
}
export { THEMES };
