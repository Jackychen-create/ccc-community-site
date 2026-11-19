// 外觀主題：在畫面出來之前套上上次選的主題（存在這台瀏覽器；登入後會再跟帳號裡的同步）
// 主題清單在 shared/rules.js 的 THEMES，顏色在 css/themes.css
(function () {
  var BG = { space: "#000000", board: "#0F1412", night: "#0E121A", paper: "#F4F1EA", vault: "#0D0C0A", aurora: "#100F1A", chalk: "#17241F" };
  try {
    var t = JSON.parse(localStorage.getItem("theme") || "null");
    if (t && BG[t] && t !== "space") {
      document.documentElement.setAttribute("data-theme", t);
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute("content", BG[t]);
    }
  } catch (e) { /* 私密模式讀不到就用預設 */ }
})();
