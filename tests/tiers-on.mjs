// 測試用：v1.37.0 拿掉交易量門檻後，三級制度、單位制的算法還留著（shared/rules.js 的 VOLUME_TIERS_ON）
// 舊的等級測試第一個 import 這個檔，把等級打開再載入規則，確認留著的算法還是對的
// 模擬伺服器：環境變數 TIERS_ON=1 才打開（tests/run.sh 決定哪幾組要開）
globalThis.__CCC_TIERS_ON = typeof process !== "undefined" && process.env.TIERS_ON === "0" ? false : true;
