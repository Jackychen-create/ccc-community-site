# CCC 交易實驗室：研究員專區

先看 README.md 和 docs/。重點：

- 介面文字繁體中文、白話；成員叫「研究員」，註冊碼叫「實驗室密碼」；畫面照 DESIGN.md。
- 每個版本在 `public/changelog.json` 最上面加一則白話公告（每版分開一則），規則見 docs/發布流程.md。
- 改 API 要同步改 `tests/mock-server.mjs`；改完跑 `npm test`、`npm run check`。
- 資料庫變更接在 `supabase/schema.sql` 最後面並標版本。
- 規則（交易量資格、教學課程解鎖）只寫在 `public/assets/js/shared/rules.js`，改了要更新 docs/功能說明.md 和 PRODUCT.md。
- 程式架構看 docs/開發指南.md「程式架構」：前端是 ES modules（`public/assets/js/`），伺服器共用工具從 `server/lib/index.js` 匯入。
- 不要把任何金鑰寫進程式或 git。
