#!/usr/bin/env bash
# 重錄四支使用教學影片，配樂後放進 public/tutorial/（全部大約 15–20 分鐘）
# 需要：node、python3（pillow、numpy、scipy）、ffmpeg
# 只錄某一支：bash tools/tutorial/make.sh member d   （member／admin，d＝電腦橫式、m＝手機直式）
set -e
cd "$(dirname "$0")"
[ -d ../../tests/node_modules/playwright ] || (cd ../../tests && npm install --no-audit --no-fund && npx playwright install chromium)
[ -f media/live.webm ] || python3 gen_media.py   # 示範用的 62 分鐘 K 線回放影片、封面、上傳用檔案（第一次要幾分鐘）
mkdir -p out
jobs=("member d" "member m" "admin d" "admin m")
[ $# -eq 2 ] && jobs=("$1 $2")
for job in "${jobs[@]}"; do
  set -- $job
  PORT=4400 node server.mjs > server.log 2>&1 &
  pid=$!
  sleep 1
  node "$1.cjs" "$2" || { kill $pid; exit 1; }
  kill $pid; wait $pid 2>/dev/null || true
done

# 配樂（程式合成的原創曲）＋壓成網站用的大小（橫式 1280×720、直式 720×1280）
declare -A NAME=( ["研究員使用教學-電腦橫式"]="member-landscape" ["研究員使用教學-手機直式"]="member-portrait" ["管理員使用教學-電腦橫式"]="admin-landscape" ["管理員使用教學-手機直式"]="admin-portrait" )
for b in "${!NAME[@]}"; do
  f="out/$b.mp4"; [ -f "$f" ] || continue
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  case "$b" in *橫式) S=1280:720;; *) S=720:1280;; esac
  python3 music.py "$d" "out/bgm-$b.wav" > /dev/null
  ffmpeg -loglevel error -y -i "$f" -i "out/bgm-$b.wav" \
    -filter_complex "[0:v]scale=$S:flags=lanczos[v];[1:a]loudnorm=I=-20:TP=-2:LRA=11,aresample=48000[a]" \
    -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -profile:v high -level 4.0 \
    -c:a aac -b:a 128k -shortest -movflags +faststart "../../public/tutorial/${NAME[$b]}.mp4"
  echo "已更新 public/tutorial/${NAME[$b]}.mp4"
done
