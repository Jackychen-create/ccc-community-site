# CCC° 交易實驗室 對外網站

不用登入的公開頁：加入流程、四間交易所註冊教學、研究員等級、研究員專區使用教學、Discord 功能、常見問題、社群連結。

- 純靜態（`index.html`、`style.css`、`app.js`、`cjk.js`），沒有建置步驟。
- 部署：Cloudflare Pages 另一個專案，連同一個 repo，**建置輸出目錄填 `guide`**，建置指令留空；建置監看路徑只放 `guide/*`。
- 交易所邀請連結、門檻寫死在 `index.html`：改了 `public/assets/js/shared/rules.js` 的 `TIERS` 或後台的邀請連結，這裡也要一起改。
- 交易所分頁可以直接連：`#okx`、`#bybit`、`#bingx`、`#um`。
