// 模擬伺服器用：TIERS_ON=1 才打開舊的等級（見 tiers-on.mjs）
globalThis.__CCC_TIERS_ON = process.env.TIERS_ON === "1";
