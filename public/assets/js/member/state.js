// 研究員前台的共用狀態：各個畫面都讀寫這一份
import { cfg, $ } from "../core/index.js";

export const SITE = cfg.SITE_NAME || "交易實驗室";

export const state = {
  me: null, // /api/me 的結果
  videos: [], // 直播留檔列表
  loadedList: false,
  course: null, // /api/course 的結果
  current: null, // 正在看的影片
  ticked: false, // 新上架那一列只在第一次顯示時跳一下
  player: {
    pendingSeek: null, // 影片載入後要跳到的秒數
    jumpedTo: null, // 從章節／筆記／搜尋跳進來的秒數
    retried: false, // 連結過期已經換過一次
    lastSaved: -1,
    lastSaveAt: 0,
  },
};

export const video = $("#video");
