// 介紹頁（首頁「/」）：分享出去的研究員專區連結（/#/v/12 這種）→ 帶到實驗室培訓房 /lab，保留後面的 #/…
// 2026-11-23 起介紹網站和實驗室培訓房分開：登入過的人打開「/」一樣看介紹頁
(function () {
  if (location.pathname !== "/") return;
  if (location.hash.indexOf("#/") === 0) location.replace("/lab" + location.hash);
})();
