// 每支機器人實際執行的程式（registry.js 是給後台看的說明，這裡是給 Edge Function 跑的）
import { twClose, twNews, twDisclosure, twFlow } from "./tw.js";
import { usNews, usWeek, earnWeek, earnFilings } from "./us.js";
import { cryptoDigest, cryptoAlert, okxNews, bybitNews } from "./crypto.js";
import { dailyQuestion } from "./community.js";

export const RUNNERS = {
  tw_close: twClose,
  tw_news: twNews,
  tw_disclosure: twDisclosure,
  tw_flow: twFlow,
  us_news: usNews,
  us_week: usWeek,
  earn_week: earnWeek,
  earn_filings: earnFilings,
  crypto_digest: cryptoDigest,
  crypto_alert: cryptoAlert,
  okx_news: okxNews,
  bybit_news: bybitNews,
  daily_question: dailyQuestion,
};
