# CCC 交易實驗室：研究員專區

先看 README.md 和 docs/。重點：

- 介面文字繁體中文、白話；成員叫「研究員」，註冊碼叫「實驗室密碼」；畫面照 DESIGN.md。
- 每個版本在 `public/changelog.json` 最上面加一則白話公告（每版分開一則），規則見 docs/發布流程.md。
- 改 API 要同步改 `tests/mock-server.mjs`；改完跑 `npm test`、`npm run check`。
- 資料庫變更接在 `supabase/schema.sql` 最後面並標版本。
- 規則（交易量資格、教學課程解鎖）只寫在 `public/assets/js/shared/rules.js`，改了要更新 docs/功能說明.md 和 PRODUCT.md。
- 程式架構看 docs/開發指南.md「程式架構」：前端是 ES modules（`public/assets/js/`），伺服器共用工具從 `server/lib/index.js` 匯入。
- 不要把任何金鑰寫進程式或 git。

## 多人協作（兩個人各自用 Claude 改同一個 repo，2026-11-22 起）

- 開工前先 `git pull`，從最新的 main 開新分支；一個功能一個分支、一個 PR。不要直接推 main（只有發布後改 `released.json` 例外）。
- 版本號以 origin/main 的 `public/changelog.json` 最上面那一則為準 +1。合併前先 rebase 到最新的 main；如果對方已經用掉這個號碼，就改成下一號，重跑 `npm run check`。
- 一次只發一個版本：合併前用 `gh pr list` 看有沒有別人的 PR 正在等 CI 或 Cloudflare 部署，有的話等它上線再合併自己的。
- 資料庫變更（migration）先在 PR 說明寫清楚，套用前確認對方沒有同時在改同一張表。
- 金鑰各自用自己的帳號連 Supabase、Cloudflare，不要互傳、不要寫進 git。
- 改到對方正在做的檔案（例如同一頁的 CSS），先問過對方或等對方合併。
