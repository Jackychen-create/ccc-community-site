// 每支機器人實際執行的程式（registry.js 是給後台看的說明，這裡是給 Edge Function 跑的）
import { twClose, twNews, twDisclosure, twFlow } from "./tw.js";

export const RUNNERS = {
  tw_close: twClose,
  tw_news: twNews,
  tw_disclosure: twDisclosure,
  tw_flow: twFlow,
};
