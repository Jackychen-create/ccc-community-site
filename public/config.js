// 這兩個值是「公開」的，可以放前端（在 Supabase 後台 Project Settings → API 找）
// 千萬不要把 service_role 金鑰放在這裡
window.APP_CONFIG = {
  SUPABASE_URL: "https://vwepwxihugvtezmrvavo.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3ZXB3eGlodWd2dGV6bXJ2YXZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NzkxOTEsImV4cCI6MjEwNzE1NTE5MX0.USa-Gm_yF5TBSWDFeIxHKroKRdDtpTYIOP2X9f7lcNM",
  SITE_NAME: "CCC 交易實驗室", // 顯示在瀏覽器分頁
  HOSTS: ["CCC", "X", "OC"], // 主講人選項（後台上傳時勾選），也是左上角翻牌會翻過的名字
  BINGX_INVITE_URL: "", // CCC 的 BingX 邀請連結（填了之後，研究員綁定 BingX 時會看到「用邀請連結註冊」）
};
