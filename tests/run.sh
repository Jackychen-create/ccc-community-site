#!/usr/bin/env bash
# 跑全部測試：npm test　只跑某幾組：npm test -- v16 v17（單元測試每次都會先跑）
# 每一組都會重新開一次模擬伺服器（資料重置），結果寫在 tests/output/
cd "$(dirname "$0")"
[ -d node_modules/playwright ] || { npm install --no-audit --no-fund && npx playwright install chromium; }
[ -f fixtures/live.webm ] || bash make-fixtures.sh
mkdir -p output/shots
suites=("$@"); [ ${#suites[@]} -eq 0 ] && suites=(e2e v14 v15 v16 v17)
total_fail=0
# 單元測試（規則、伺服器小工具），幾秒鐘
node unit.mjs > output/unit.log 2>&1; uc=$?
uf=$(grep -c '^FAIL' output/unit.log)
# 程式當掉（沒跑完）或一項都沒跑到，也算失敗
{ [ $uc -ne 0 ] || [ "$(grep -c '^PASS' output/unit.log)" -eq 0 ]; } && [ "$uf" -eq 0 ] && { uf=1; echo "unit 沒有正常跑完，看 tests/output/unit.log"; }
echo "unit：$(grep -c '^PASS' output/unit.log) 項通過，$uf 項失敗"
grep '^FAIL' output/unit.log | head -5
total_fail=$((total_fail + uf))
for t in "${suites[@]}"; do
  node mock-server.mjs > output/server.log 2>&1 &
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
