# CCC° 交易實驗室 對外網站（已合併）

2026-11-20 起，對外網站和研究員專區合在同一個網站：`https://ccc-community-site.pages.dev/`。
沒登入的人在首頁看到介紹頁（`public/start/`），登入後首頁就是研究員專區（`functions/index.js` 看登入旗標決定）。

這個資料夾只剩 `_redirects`：這個 Cloudflare Pages 專案把所有網址 301 轉到合併後的網站，舊連結不會失效。
介紹頁的內容改在 `public/start/` 改。
