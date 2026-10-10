# CCC 交易實驗室：研究員專區

只給「實驗室研究員」看的直播留檔網站：研究員用實驗室密碼加入，看直播留檔、教學課程、下載教材、記筆記、提問；CCC、X、OC 三位管理員在 `/admin` 上傳影片、填交易量、回覆提問、追蹤研究員狀況。

- 網址：https://ccc-community-site.pages.dev
- 目前版本：看 `public/changelog.json` 最上面那則；上次上線的版本記在 `released.json`

## 用到的服務

| 服務 | 用途 | 費用 |
|---|---|---|
| Cloudflare Pages | 網頁（`public/`）和 API（`functions/` → `server/`），推到 `main` 自動部署 | 免費 |
| Supabase | 帳號登入、資料庫 | 免費方案 |
| Cloudflare R2 | 影片、封面、教材檔 | 10 GB 內免費，下載不收費 |
| Brevo | 寄信（新影片通知、提問通知與回覆） | 免費方案每天 300 封 |

## 資料夾

```
public/            網頁：index.html（研究員）、admin.html（後台）、changelog.json（更新公告）、tutorial/（使用教學影片）
  assets/js/       程式：core/（共用）、member/（研究員頁）、admin/（後台）、shared/rules.js（資格、交易量、課程規則）
  assets/css/      樣式（app.css 依序載入）
functions/api/     Cloudflare Pages Functions 的入口，把 /api/* 交給 server/
server/            API 的實際程式（admin/ 是後台用的，lib/ 是共用工具）
supabase/          資料庫結構 schema.sql（每個版本新增的部分接在後面）
tests/             自動測試：模擬伺服器＋瀏覽器測試（npm test）
tools/tutorial/    重錄使用教學影片的程式（示範資料、錄影、配樂）
scripts/           發布前檢查（npm run check）
docs/              說明文件
DESIGN.md          畫面設計規格（顏色、字體、元件）
PRODUCT.md         產品定位、使用者、確認過的規則
```

## 文件

- [部署與設定](docs/部署與設定.md)：Supabase、R2、Cloudflare、寄信、加管理員
- [功能說明](docs/功能說明.md)：研究員和後台的功能、交易量資格、教學課程的規則
- [發布流程](docs/發布流程.md)：改版、寫更新公告、測試、上線
- [開發指南](docs/開發指南.md)：本機開發、測試、程式架構、寫法慣例

## 常用指令

```bash
npm install          # 第一次
npm run dev          # 本機跑網站（要先把 .dev.vars.example 複製成 .dev.vars 填好）
npm test             # 跑全部自動測試（第一次會自動安裝測試工具）
npm run check        # 發布前檢查更新公告
```
