#!/usr/bin/env bash
# 跑全部測試：npm test　只跑某幾組：npm test -- v16 v17（unit、discord 每次都會先跑）
# 每一組都會重新開一次模擬伺服器（資料重置），結果寫在 tests/output/
cd "$(dirname "$0")"
[ -d node_modules/playwright ] || { npm install --no-audit --no-fund && npx playwright install chromium; }
{ [ -f fixtures/live.webm ] && [ -f fixtures/silent.webm ]; } || bash make-fixtures.sh
mkdir -p output/shots
suites=("$@"); [ ${#suites[@]} -eq 0 ] && suites=(e2e v14 v15 v16 v17 v18 v19 v20 v21 v22 v23 v24 v25 v26 v27 v28 v29 v30 v31 v32 v33 v34 v35 v36 v37)
total_fail=0
# 不用瀏覽器的測試，幾秒鐘：unit（規則、伺服器小工具）、discord（Discord 審核機器人整個流程）、sync（自動同步交易量、每人一輪）、lives（直播預告）
for n in unit discord sync lives chatlog bots highlights reviews onboarding boost link exroles okx pay home uidjoin oauth join bot-avatar; do
  node "$n.mjs" > "output/$n.log" 2>&1; uc=$?
  uf=$(grep -c '^FAIL' "output/$n.log")
  # 程式當掉（沒跑完）或一項都沒跑到，也算失敗
  { [ $uc -ne 0 ] || [ "$(grep -c '^PASS' "output/$n.log")" -eq 0 ]; } && [ "$uf" -eq 0 ] && { uf=1; echo "$n 沒有正常跑完，看 tests/output/$n.log"; }
  echo "$n：$(grep -c '^PASS' "output/$n.log") 項通過，$uf 項失敗"
  grep '^FAIL' "output/$n.log" | head -5
  total_fail=$((total_fail + uf))
done
for t in "${suites[@]}"; do
  # v1.37.0 拿掉交易量等級：v35 以前的測試是在有等級的時候寫的，模擬伺服器把等級打開（TIERS_ON=1）再跑；v36 起照現在的設定
  tiers=1; case "$t" in v36|v37) tiers=0;; esac
  TIERS_ON=$tiers node mock-server.mjs > output/server.log 2>&1 &
  pid=$!
  sleep 1
  node "$t.cjs" > "output/$t.log" 2>&1; code=$?
  kill $pid 2>/dev/null; wait $pid 2>/dev/null
  p=$(grep -cE '^PASS|PASS ' "output/$t.log"); f=$(grep -cE '^FAIL|FAIL |TEST CRASHED' "output/$t.log")
  # 瀏覽器開不起來、程式當掉、一項都沒跑到：也算失敗，不能顯示「全部通過」
  if [ "$f" -eq 0 ] && { [ "$p" -eq 0 ] || [ $code -ne 0 ]; }; then f=1; echo "$t 沒有正常跑完（結束代碼 $code），看 tests/output/$t.log"; tail -3 "output/$t.log"; fi
  echo "$t：$p 項通過，$f 項失敗"
  grep -E '^FAIL|FAIL |TEST CRASHED' "output/$t.log" | head -5
  total_fail=$((total_fail + f))
done
[ $total_fail -eq 0 ] && echo "全部通過" || { echo "有 $total_fail 項失敗，詳細看 tests/output/*.log"; exit 1; }
