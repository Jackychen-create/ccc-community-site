#!/usr/bin/env bash
# 產生測試用的假影片和封面（需要 ffmpeg）。只在第一次跑 npm test 時自動執行。
set -e
cd "$(dirname "$0")"
mkdir -p fixtures
ffmpeg -loglevel error -y -f lavfi -i "testsrc2=size=640x360:rate=10" -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 90 \
  -c:v libvpx -b:v 300k -c:a libvorbis -shortest fixtures/live.webm
for t in 5 20 40; do
  ffmpeg -loglevel error -y -ss $t -i fixtures/live.webm -frames:v 1 -q:v 4 fixtures/thumb$t.jpg
done
echo "測試素材已產生在 tests/fixtures/"
