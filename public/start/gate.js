// 介紹頁（首頁「/」、/start/）一開始就跑（在 <head>，比畫面先）：
// - 分享出去的研究員專區連結（/#/v/12 這種）→ 帶到實驗室培訓房 /lab，保留後面的 #/…
// - v1.37.8：網址帶 #exchanges 這類錨點，一律從最上面開始（先把 # 拿掉，瀏覽器就不會跳到中間）
//   #okx／#bybit／#bingx 記在 window.__startHash，app.js 照樣選那一間交易所，但不捲過去
//   要直接到某一段用 ?go=join（例如登入頁的「看怎麼加入」），app.js 會捲到那一段
(function () {
  var p = location.pathname;
  if (p !== "/" && p !== "/start/" && p !== "/start/index.html") return;
  if (p === "/" && location.hash.indexOf("#/") === 0) { location.replace("/lab" + location.hash); return; }
  if (location.hash) {
    window.__startHash = location.hash.toLowerCase();
    try { history.replaceState(null, "", p + location.search); } catch (e) {}
  }
  try { history.scrollRestoration = "manual"; } catch (e) {}
})();
