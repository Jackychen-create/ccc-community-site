// 前台與後台共用的基本工具。頁面程式從這裡 import。
// 載入順序有意義：先掛上錯誤回報，再啟動換行、版本檢查、翻牌。
import { cfg, sb } from "./config.js";
import { api, report } from "./api.js";
import { store } from "./store.js";
import { icons } from "./icons.js";
import { el, $, icon, placeholderSvg, thumbImg } from "./dom.js";
import { fmtDur, fmtLeft, fmtBytes, fmtDate, fmtRel, today } from "./format.js";
import { toast, copyText, modal, confirmDialog, setBusy, countUp, reduceMotion } from "./ui.js";
import "./cjk.js";
import { whatsNew } from "./version.js";
import { tutorial } from "./tutorial.js";
import "./flap.js";

export {
  cfg, sb, api, report, store, icons, el, $, icon, placeholderSvg, thumbImg,
  fmtDur, fmtLeft, fmtBytes, fmtDate, fmtRel, today,
  toast, copyText, modal, confirmDialog, setBusy, countUp, reduceMotion,
  whatsNew, tutorial,
};

// 給瀏覽器主控台除錯和測試用（頁面程式請用 import）
window.App = {
  cfg, sb, api, store, el, $, icon, icons, placeholderSvg, thumbImg,
  fmtDur, fmtLeft, fmtBytes, fmtDate, fmtRel, today,
  toast, copyText, modal, confirmDialog, setBusy,
  countUp, whatsNew, tutorial, reduceMotion, report,
};
