// 介紹頁放在首頁「/」時（2026-11-20 合併網站）：
// - 分享出去的研究員專區連結（#/v/12 這種）→ 帶到 /login，保留後面的 #/…
// - 已經登入過、但還沒有旗標 cookie 的人（合併之前就登入的）→ 補上旗標，重新整理就會進研究員專區
(function () {
  if (location.pathname !== "/") return;
  if (location.hash.indexOf("#/") === 0) { location.replace("/login" + location.hash); return; }
  try {
    for (var i = 0; i < localStorage.length; i++) {
      if (/^sb-.+-auth-token$/.test(localStorage.key(i) || "")) {
        document.cookie = "ccc_in=1; Path=/; Max-Age=31536000; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
        if (/(?:^|;\s*)ccc_in=1/.test(document.cookie)) location.replace("/");
        return;
      }
    }
  } catch (e) {}
})();
