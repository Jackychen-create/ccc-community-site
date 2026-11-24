# 使用教學影片

重錄四支使用教學（研究員／管理員 × 電腦橫式／手機直式），配上程式合成的原創配樂，壓好後直接放進 `public/tutorial/`。

```bash
bash tools/tutorial/make.sh            # 四支全部重錄（約 15–20 分鐘）
bash tools/tutorial/make.sh member d   # 只錄研究員・電腦橫式（member／admin，d／m）
```

需要 node、python3（`pip install pillow numpy scipy`）、ffmpeg。

| 檔案 | 用途 |
|---|---|
| `server.mjs` | 管理員教學用的假網站資料，跑在 4400 port |
| `../../tests/mock-server.mjs`（`TUTORIAL=1`） | 研究員教學用的示範網站（v1.37.22 起；跟測試同一份，換成示範影片和封面） |
| `gen_media.py` | 產生示範影片（62 分鐘 K 線回放）、封面、上傳用的檔案，放在 `media/`、`upload/` |
| `lib.cjs` | 錄影工具：字幕、游標、框選、標題卡，錄下來組成 mp4 |
| `member.cjs`、`admin.cjs` | 兩支影片的腳本（字幕內容和操作步驟都在這裡改） |
| `music.py` | 合成配樂 |

錄影的暫存檔（`media/`、`upload/`、`rec/`、`out/`）不會進 git。
