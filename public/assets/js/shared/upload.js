// 上傳相關的白話文字（純函式，伺服器測試也能用）
// R2 回的錯誤代碼 → 白話原因：5xx 是 R2 自己暫時出錯，重傳通常就好；4xx 才比較可能是金鑰或設定問題
export function putErrorText(status) {
  if (status >= 500) return `影片空間（R2）暫時出錯了（代碼 ${status}），不是你的檔案或設定的問題。等一下再按「重新上傳」通常就好。`;
  return `影片空間（R2）拒絕了這次上傳（代碼 ${status}）。通常是 R2 金鑰設定不對（例如換了金鑰，但 Cloudflare 還沒重新部署）。`;
}
