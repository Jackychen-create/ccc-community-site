# CCC° 交易實驗室 對外網站

不用登入的公開頁：加入流程、四間交易所註冊教學、研究員等級、研究員專區使用教學、Discord 功能、常見問題、社群連結。

- 純靜態（`index.html`、`style.css`、`app.js`、`cjk.js`），沒有建置步驟。
- 部署：Cloudflare Pages 獨立專案，連同一個 repo，建置輸出目錄 `guide`、沒有建置指令、只監看 `guide/*`。研究員專區那個專案排除 `guide/*`。
- 公開影片從研究員專區的 `/api/public-video` 拿（有開 CORS），拿不到那一段就不顯示。
- 交易量試算的門檻寫在 `app.js` 的 `TIERS`，要跟 `public/assets/js/shared/rules.js` 一致。
- 交易所邀請連結、門檻寫死在 `index.html`：改了 `public/assets/js/shared/rules.js` 的 `TIERS` 或後台的邀請連結，這裡也要一起改。
- 交易所分頁可以直接連：`#okx`、`#bybit`、`#bingx`、`#um`。
