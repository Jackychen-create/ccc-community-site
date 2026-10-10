# CCC 交易實驗室 研究員專區

研究員用用實驗室密碼加入後，可以觀看直播留檔、下載教材。管理員在 `/admin` 上傳影片、發實驗室密碼、管理研究員。

- 網站與 API：Cloudflare Pages（免費方案，可商用；網頁在 `public/`，API 在 `functions/` 與 `server/`）
- 帳號與資料：Supabase（免費方案）
- 影片與教材檔：Cloudflare R2（10 GB 內免費，下載流量不收費）

---

## 一、Supabase

1. 到 supabase.com 建立專案。
2. 打開 **SQL Editor**，把 `supabase/schema.sql` 整份貼上執行。
3. 打開 **Authentication → Sign In / Providers**，照下面設定：
   - **Allow new users to sign up：關閉**。這一步一定要做，不然別人可以不用實驗室密碼直接註冊。
   - **Confirm email：保持開啟**
   - **Secure email change：保持開啟**
4. 建立你自己的管理員帳號：**Authentication → Users → Add user → Create new user**
   - Email 填你的 Gmail（`a0926580734@gmail.com`）
   - 設一組密碼，並勾選 **Auto Confirm User**
   - 管理員帳號只能在這裡建立，不能用用實驗室密碼加入。
5. 打開 **Project Settings → API**，記下這三個值：Project URL、anon public key、service_role key。
6. 把 `public/config.js` 裡的 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 換成你的。這兩個值本來就是公開的，可以放在前端。

## 二、Cloudflare R2

1. 打開 **R2 → Create bucket**，名稱例如 `community-videos`。不要開啟 Public access。
2. 打開 **R2 → Manage API Tokens → Create API token**：
   - 權限選 **Object Read & Write**，範圍只限這個 bucket。
   - 記下 Access Key ID、Secret Access Key，以及頁面上的 Account ID。
3. 打開 bucket 的 **Settings → CORS Policy**，貼上下面這段（把網址換成你的 pages.dev 網址；搬家期間可以新舊網址都放），後台才能直接在網頁上傳：

```json
[
  {
    "AllowedOrigins": ["https://你的網站.pages.dev"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type", "content-length", "range"],
    "ExposeHeaders": ["etag", "content-length", "content-range"],
    "MaxAgeSeconds": 3600
  }
]
```

之後如果綁了自己的網域，記得把網域加進 `AllowedOrigins`。

## 三、Cloudflare Pages

1. 把這個資料夾推到 GitHub（建議 private）。
2. Cloudflare 後台 → **Workers & Pages → Create → Pages → Connect to Git**，選這個 repo。
3. 建置設定：
   - **Framework preset**：None
   - **Build command**：`npm install`
   - **Build output directory**：`public`
4. **Environment variables**（Production）填入下面這些值，金鑰類請選 **Encrypt**（範本在 `.dev.vars.example`）：

| 名稱 | 內容 |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role 金鑰，**絕對不要放到前端或 GitHub** |
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | R2 token 的 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2 token 的 Secret |
| `R2_BUCKET` | bucket 名稱 |
| `ADMIN_EMAILS` | 可以進後台的 Email，多人用逗號分隔，例如 `a0926580734@gmail.com` |

5. 按 **Save and Deploy**。之後每次推到 GitHub 都會自動重新部署；改了環境變數要到 **Deployments → 最新一筆 → Retry deployment** 才會生效。
6. 拿到 `xxx.pages.dev` 網址後，把它加進 R2 bucket 的 CORS `AllowedOrigins`（第二節）。

## 四、第一次使用

1. 打開 `你的網址/admin`，用第四步建立的 Gmail 帳號登入。
2. 到 **實驗室密碼** 產生一組（例如可以用 30 次），按「複製加入訊息」貼給研究員。研究員點開連結，實驗室密碼會自動帶入。
3. 到 **影片** 把直播錄影拖進去。系統會自動抓片長和封面，上傳完補上標題、簡介、教材，就可以發布。

### 想讓別人也能進後台
1. 把他的 Email 加進 Cloudflare Pages 的 `ADMIN_EMAILS`，然後重新部署。
2. 在 Supabase 的 Users 用 **Add user**（勾 Auto Confirm）幫他建立帳號。

用用實驗室密碼加入的研究員帳號，就算 Email 後來被加進管理員名單，也不會變成管理員。這是刻意的設計，因為研究員註冊時沒有驗證過信箱。

## 五、功能一覽

**研究員**
- 用實驗室密碼加入、Email 登入，可以自己修改密碼
- 繼續觀看：記得每支影片看到哪裡，換裝置也會同步
- 搜尋、依月份篩選、只看「未看完」
- 新影片標示「新」，看完的標示「看完了」，卡片上有進度條
- 播放頁：倍速（0.75–2×，會記住你的選擇）、快捷鍵（空白、← →、F、M）、看完後可以直接接下一場
- 教材下載、側欄列出其他場次
- 登入頁只顯示最新一場的日期和累計場數（`/api/stats`，不含任何標題或內容）
- 支援手機版；固定深色（營業廳看板風格）
- 防外流：播放時畫面上有研究員 Email 浮水印（定時換位置，全螢幕也看得到），關閉下載、子母畫面與右鍵

**後台**
- 網頁直接上傳影片到 R2，可看進度、速度、剩餘時間，上傳中可以取消
- 自動擷取封面和片長，上傳後先存成草稿，確認後再發布
- 編輯標題、日期、簡介，一鍵切換發布或草稿，用研究員畫面預覽
- 每支影片可以掛多個教材（PDF、圖片、壓縮檔、Office 檔）
- 實驗室密碼：設定次數、備註、停用或啟用，一鍵複製註冊連結
- 研究員：最近登入時間、看過幾支、停權或恢復、重設密碼（產生新密碼讓你轉交）、觀看資格到期日
- 交易量：每月填 OKX、Bybit、UM 的成交金額，任一間達標自動延長資格到月底（見下方「每月資格」）

## 六、限制與建議

- **格式：** 上傳 **MP4（H.264 + AAC）** 最保險。MKV 或 HEVC 有些瀏覽器播不了，後台在上傳時會提醒。可以用 `ffmpeg -i in.mkv -c:v libx264 -c:a aac -movflags +faststart out.mp4` 轉檔。
- **大小：** 單一影片最大 5 GB。1 小時 1080p 錄影通常 1–3 GB。
- **連結期限：** 影片連結 1 小時後失效，播放中過期會自動換新連結並接著播。
- **防盜錄的極限：** 網頁擋不住螢幕錄影或手機翻拍。浮水印的用途是外流時看得出是哪個帳號。iPhone 的瀏覽器不支援把播放區整塊放大成全螢幕，所以 iPhone 上不顯示我們的全螢幕按鈕；但 iPhone 系統播放器自己的全螢幕擋不掉，用它全螢幕時浮水印不會出現。
- **免費額度：** R2 免費 10 GB，超過約每 GB 每月 0.015 美元。下載流量不收費。

## 寄信通知（選用）

發布新影片時可以寄信通知研究員。用 Brevo 寄信，免費方案每天 300 封，夠 20–30 位研究員用。

1. 到 brevo.com 註冊。
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**，寄件人填你的 Gmail，收信完成驗證。
3. **SMTP & API → API Keys → Generate a new API key**，複製金鑰。
4. Cloudflare Pages 加三個環境變數，然後重新部署：
   - `BREVO_API_KEY`：剛剛的金鑰（選 Secret）
   - `MAIL_FROM`：第 2 步驗證過的 Email
   - `MAIL_FROM_NAME`：`CCC 交易實驗室`

沒設定也沒關係，後台按「寄信通知」時會提示還沒設定，其他功能照常。用 Gmail 當寄件人，信有可能被分到垃圾信，第一次請研究員把它標成「不是垃圾郵件」。之後如果有自己的網域，改用網域信箱寄會更穩。

## 資格（交易量）

社群沒有會費，資格看交易量決定：**OKX、Bybit、UM 任選一間，當月成交金額（USDT）達門檻（預設 3,300,000），從達標那天起可以看一個月**。例如 10/15 達標，可以看到 11/14。

**後台「交易量」頁**
- 選月份，每位研究員一列，三間交易所各一格。可以打 `3300000`、`3,300,000`、`330萬`、`3.3m`、`500k`。
- 上方的「達標日」預設今天。這次新達標的人，資格算到「達標日起一個月」。如果你是隔幾天才補登，可以把達標日改成實際達標那天。
- 存的時候：這個月第一次達標的人自動延長資格，並記下達標日；這個月已經達標過的不會再延一次；原本就比較晚的不會被縮短；「不限」的研究員（例如你們三位）不會被改。
- 「貼上一整批」：每行一位，`amy@gmail.com OKX 3,500,000`，或照順序 `amy@gmail.com 0 3500000 0`，試算表直接複製（Tab 分隔）也可以。
- 「門檻」按鈕可以改門檻。

**研究員看到的**：右邊「本月交易量」三間各自的數字和進度；達標後寫「10/15 達標，可以看到 11/14」。資格到期前 7 天上方會提醒。

**新研究員**：用實驗室密碼加入，先給加入那天起一個月。

**手動調整**：後台「研究員」每一列的「資格」按鈕可以直接改日期（今天起一個月／這個月底／不限）。

## 教學課程

CCC、X、OC 的教學影片各切成 6 份，共 18 份。每位研究員**從自己加入那天起**，每週解鎖一份：

| 週 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | … | 23 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 解鎖 | CCC 1 | OC 1 | X 1 | 休息 | CCC 2 | OC 2 | X 2 | 休息 | CCC 3 | … | X 6 |

- 上傳方式跟直播一樣：上傳後按「編輯」，「類型」選「教學課程」，再選主講和第幾份。編輯視窗會寫出這一份是加入後第幾週解鎖。
- 後台「影片」最上面的格子看得到 18 份哪幾份已經上架（實心＝已發布、框線＝草稿、虛線＝還沒有）。點格子直接編輯。
- 課程不會出現在直播留檔列表，也不寄全體通知（每個人解鎖時間不同）。
- 還沒解鎖的課程，研究員只看得到標題和解鎖日期；就算直接打網址也拿不到影片。
- 解鎖規則寫在 `server/_lib.js` 的 `COURSE_CYCLE_WEEKS`（每幾週一輪）和 `courseWeek()`。

## 使用教學影片

`public/tutorial/` 裡有四支教學影片（研究員、管理員，各有手機直式和電腦橫式）。研究員第一次登入會問要不要看，右上角選單有「使用教學」；管理員在後台左下角「使用教學」，或研究員頁面選單的「管理員使用教學」。換影片就直接覆蓋同名檔案。

## 七、發新版本

1. 改完功能，在 `public/changelog.json` 最上面加一筆（版本號、日期、研究員看得懂的白話條目）。
2. 推到 GitHub，Cloudflare 自動部署。
3. 已經開著網站的人，最多 30 分鐘內（或切回分頁時）上方會出現「網站有新版本」的提示；老研究員下次登入會看到這次更新了什麼。第一次來的研究員不會跳公告。

## 八、本機測試

把 `.dev.vars.example` 複製成 `.dev.vars` 填好，執行 `npm install`、`npm run dev`，打開 http://localhost:8788 。
