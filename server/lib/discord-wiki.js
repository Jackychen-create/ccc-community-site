// Discord「📚 交易百科與頻道導覽」：常駐面板（下拉選名詞、🧭 頻道導覽、🔎 搜尋其他名詞），回覆只有按的人看得到
// 名詞庫寫在下面的 GLOSSARY；改了之後到後台「Discord 審核」按「更新交易百科面板」，下拉選單就會換成新的
// 頻道導覽不用另外維護：每次按都讀伺服器現在的分類、頻道和頻道主題，只列出這位研究員看得到的頻道
import { env } from "./env.js";
import { discordApi, getDiscordSettings, saveDiscordSettings, getChannel, createChannel, sendMessage, editMessage } from "./discord.js";
import { supportOverwrites, GOLD, LOGO } from "./discord-support.js";

export const WIKI_IDS = { term: "wiki_term", guide: "wiki_guide", search: "wiki_search", form: "wiki_search_form", query: "q" };
export const WIKI_CHANNEL = { name: "📚交易百科", type: 0, topic: "交易名詞查詢、頻道導覽。按下面的選單或按鈕，回覆只有你看得到。" };
const FOOTER = "CCC 交易實驗室｜交易百科・只解釋觀念，不是進出場建議";
const EPHEMERAL = 64;

// featured：放進面板下拉選單（Discord 一個選單最多 25 個）；其他的用「搜尋其他名詞」找
export const GLOSSARY = [
  {"term": "訂單流", "en": "Order Flow", "aliases": ["orderflow", "order flow"], "emoji": "🌊", "featured": true, "short": "看實際成交的買賣力道，而不只看K線。", "body": "訂單流是觀察市場上「實際成交」的買單與賣單，看是誰在主動出手、在哪個價位出手。\n\nK線只告訴你價格走了多少，訂單流告訴你走這段路時，主動買方和主動賣方各用了多少力氣。常見工具有足跡圖、Delta、成交量分布與熱力圖。"},
  {"term": "足跡圖", "en": "Footprint", "aliases": ["footprint", "腳印圖", "fp"], "emoji": "👣", "featured": true, "short": "把每根K線拆開，顯示每個價位的買賣成交量。", "body": "足跡圖把一根K線拆成每個價位，分別列出該價位的主動賣量（左）與主動買量（右）。\n\n用來看某個價位是誰比較積極、有沒有失衡或吸收，是訂單流最核心的圖表。"},
  {"term": "Delta", "en": "Delta", "aliases": ["delta", "差額"], "emoji": "⚖️", "featured": true, "short": "主動買量減主動賣量。", "body": "Delta = 主動買進成交量 − 主動賣出成交量。\n\n正值代表這段時間主動買方較積極，負值代表主動賣方較積極。要注意：Delta 為正不代表價格一定會漲，價格與 Delta 方向不一致時，往往更值得留意。"},
  {"term": "CVD", "en": "Cumulative Volume Delta", "aliases": ["累積delta", "累積差額", "cvd"], "emoji": "📈", "featured": true, "short": "把每根K線的 Delta 一路累加起來的線。", "body": "CVD（累積成交量差額）是把每根K線的 Delta 持續加總畫成一條線。\n\n用來看一段時間內主動買賣力道的整體方向。常見用法是比對價格與 CVD：價格創新高但 CVD 沒跟上，稱為背離。"},
  {"term": "成交量分布", "en": "Volume Profile", "aliases": ["volume profile", "vp", "籌碼分布"], "emoji": "📊", "featured": true, "short": "以價格為軸，顯示每個價位累積成交了多少。", "body": "成交量分布把成交量依「價格」而不是「時間」堆疊，畫成橫向直方圖。\n\n成交量大的價位代表市場曾在這裡大量交易、認同這個價格；成交量少的價位代表市場很快通過。常與 POC、價值區一起看。"},
  {"term": "POC", "en": "Point of Control", "aliases": ["poc", "控制點"], "emoji": "🎯", "featured": true, "short": "一段區間內成交量最大的價位。", "body": "POC（控制點）是成交量分布中成交量最大的那個價位，可以理解為該區間市場最認同的價格。\n\n前一天的 POC 常被交易者拿來當作當天的參考位置。"},
  {"term": "價值區", "en": "Value Area (VAH / VAL)", "aliases": ["value area", "va", "vah", "val", "價值區間"], "emoji": "📦", "featured": true, "short": "約 70% 成交量集中的價格區間。", "body": "價值區是成交量分布中，包含約 70% 成交量的價格範圍。上緣稱 VAH，下緣稱 VAL。\n\n價格在價值區內通常代表市場處於平衡；離開價值區則代表市場可能在尋找新的價格。"},
  {"term": "VWAP", "en": "Volume Weighted Average Price", "aliases": ["vwap", "成交量加權平均價"], "emoji": "〰️", "featured": true, "short": "以成交量加權的平均成交價。", "body": "VWAP 是把每筆成交價格依成交量加權後算出的平均價，通常從每個交易日開盤重新計算。\n\n可以理解為當天大部分參與者的平均成本，常被當作日內多空強弱的參考線。"},
  {"term": "流動性", "en": "Liquidity", "aliases": ["liquidity", "流動"], "emoji": "💧", "featured": true, "short": "市場上等著被成交的掛單。", "body": "流動性指市場上可以被成交的掛單數量。掛單越多，大單進出越不容易推動價格。\n\n在 SMC 與訂單流裡，常說的「流動性」也指停損單聚集的地方，例如前高上方、前低下方。"},
  {"term": "流動性掃蕩", "en": "Liquidity Sweep", "aliases": ["sweep", "掃蕩", "掃流動性", "掃損", "liquidity grab"], "emoji": "🧹", "featured": true, "short": "價格短暫刺破前高或前低，觸發停損後又收回。", "body": "流動性掃蕩是指價格短暫突破明顯的前高或前低，把聚集在那裡的停損單成交掉，之後又回到原本的區間。\n\n重點不在「刺破」，而在刺破之後市場怎麼反應：是收得回來，還是真的站穩。"},
  {"term": "吸收", "en": "Absorption", "aliases": ["absorption"], "emoji": "🧽", "featured": true, "short": "大量主動單打進來，價格卻推不動。", "body": "吸收是指某一方大量主動成交，但價格幾乎沒有移動，代表另一邊有被動掛單把這些量全部接住。\n\n在足跡圖上常表現為某價位成交量特別大、價格卻停滯。"},
  {"term": "失衡", "en": "Imbalance", "aliases": ["imbalance", "不平衡"], "emoji": "↗️", "featured": true, "short": "斜對角比較時，一邊的主動量明顯大於另一邊。", "body": "失衡是足跡圖上的比較方式：拿某價位的主動買量，對比下一個價位的主動賣量（斜對角比較），比例超過設定值（常見 300%）就標記為失衡。\n\n連續幾個價位都出現同方向失衡，稱為堆疊失衡（Stacked Imbalance）。"},
  {"term": "熱力圖", "en": "Heatmap", "aliases": ["heatmap", "掛單熱力圖", "dom heatmap"], "emoji": "🔥", "featured": true, "short": "把掛單簿的變化畫成顏色深淺。", "body": "熱力圖把各價位的掛單量隨時間的變化畫成顏色，顏色越亮代表掛單越多。\n\n可以看到大掛單在哪裡、何時出現、何時被撤掉或被吃掉。要注意掛單可以隨時撤，看到的不一定是真的會成交的量。"},
  {"term": "冰山單", "en": "Iceberg Order", "aliases": ["iceberg", "冰山"], "emoji": "🧊", "featured": false, "short": "只露出一小部分、成交後自動補上的大單。", "body": "冰山單是把一筆大單拆成小份掛出，每份被吃掉後自動補上，讓別人看不出真正的數量。\n\n在訂單流上的特徵是：某價位成交量遠大於畫面上看到的掛單量。"},
  {"term": "SMC", "en": "Smart Money Concepts", "aliases": ["smc", "聰明錢", "smart money"], "emoji": "🧠", "featured": true, "short": "從大資金的角度解讀結構、流動性與供需區的方法。", "body": "SMC（聰明錢概念）是一套用市場結構、流動性與失衡區域來解讀價格的方法，常見概念有 BOS、CHoCH、訂單塊、FVG、溢價／折價區。\n\n它是一種看盤框架，不是保證獲利的公式。"},
  {"term": "BOS", "en": "Break of Structure", "aliases": ["bos", "結構突破"], "emoji": "🧱", "featured": true, "short": "順著原本趨勢方向突破前一個高點或低點。", "body": "BOS（結構突破）指價格順著目前的趨勢方向，突破前一個結構高點（上升趨勢）或結構低點（下降趨勢），代表趨勢延續。"},
  {"term": "CHoCH", "en": "Change of Character", "aliases": ["choch", "結構轉變", "特性改變"], "emoji": "🔄", "featured": true, "short": "第一次逆著原本趨勢破結構，可能是轉向的訊號。", "body": "CHoCH（結構特性改變）指價格第一次逆著原本的趨勢方向破結構，例如上升趨勢中跌破最近一個更高的低點。\n\n它提示趨勢可能轉變，但單一個 CHoCH 不等於趨勢已經反轉。"},
  {"term": "訂單塊", "en": "Order Block (OB)", "aliases": ["ob", "order block", "訂單區塊"], "emoji": "🟦", "featured": true, "short": "大幅推動前的最後一根反向K線所在區域。", "body": "訂單塊通常指一段強勢推動之前，最後一根反方向的K線區域，被認為是大資金建立部位的地方。\n\n價格之後回到這個區域時，交易者會觀察市場的反應。"},
  {"term": "FVG", "en": "Fair Value Gap", "aliases": ["fvg", "公平價值缺口", "失衡缺口"], "emoji": "🕳️", "featured": true, "short": "三根K線中，第一根與第三根影線沒有重疊的空隙。", "body": "FVG（公平價值缺口）出現在快速推動的三根K線中：第一根的高點與第三根的低點（或反之）之間沒有重疊，中間留下一段價格沒被充分交易的空隙。\n\n價格之後常會回來測試這段空隙。"},
  {"term": "溢價／折價區", "en": "Premium / Discount", "aliases": ["premium", "discount", "溢價區", "折價區"], "emoji": "⚖️", "featured": false, "short": "以一段波段的 50% 為界，上半是溢價、下半是折價。", "body": "把一段波段的高低點畫出來，50% 以上稱為溢價區，50% 以下稱為折價區。\n\nSMC 的觀念是在折價區找做多的理由、在溢價區找做空的理由，但仍需搭配其他條件。"},
  {"term": "等高／等低", "en": "Equal Highs / Equal Lows", "aliases": ["eqh", "eql", "等高", "等低", "雙頂", "雙底"], "emoji": "〽️", "featured": false, "short": "幾乎同一高度的多個高點或低點，上方或下方常聚集停損。", "body": "等高（EQH）或等低（EQL）是指兩個以上幾乎同高的高點或同低的低點。很多人會把停損設在它們外側，因此常被視為流動性聚集的地方。"},
  {"term": "未平倉量", "en": "Open Interest (OI)", "aliases": ["oi", "open interest", "持倉量"], "emoji": "📂", "featured": false, "short": "市場上還沒平掉的合約總數。", "body": "未平倉量是目前市場上尚未平倉的合約總數。價格上漲且 OI 增加，代表有新部位進場；價格上漲但 OI 減少，可能是空單在回補。"},
  {"term": "資金費率", "en": "Funding Rate", "aliases": ["funding", "funding rate", "資費"], "emoji": "💱", "featured": false, "short": "永續合約多空雙方定期互付的費用。", "body": "資金費率是加密貨幣永續合約用來讓合約價格貼近現貨價格的機制，多空雙方每隔固定時間互相支付。\n\n費率為正時多方付給空方，為負時空方付給多方。費率極端時，代表某一邊部位過度擁擠。"},
  {"term": "強平", "en": "Liquidation", "aliases": ["爆倉", "強制平倉", "liquidation", "清算"], "emoji": "💥", "featured": false, "short": "保證金不足時被交易所強制平倉。", "body": "強平（爆倉）是當帳戶虧損使保證金低於維持保證金時，交易所強制把部位平掉。\n\n槓桿越高，價格只要小幅反向就可能觸發強平。大量強平集中發生時，會讓價格短時間劇烈波動。"},
  {"term": "槓桿", "en": "Leverage", "aliases": ["leverage", "倍數"], "emoji": "🏋️", "featured": false, "short": "用較少保證金控制較大部位。", "body": "槓桿讓你用一部分保證金控制更大的部位，獲利與虧損都會等比例放大。\n\n真正決定風險的是部位大小與停損距離，而不是槓桿倍數本身。"},
  {"term": "保證金", "en": "Margin", "aliases": ["margin", "原始保證金", "維持保證金"], "emoji": "🏦", "featured": false, "short": "開期貨或合約部位需要押在帳戶裡的錢。", "body": "保證金是開立期貨或合約部位時，帳戶需要保留的資金。原始保證金是開倉門檻，維持保證金是持倉底線，低於底線就可能被追繳或強平。"},
  {"term": "滑價", "en": "Slippage", "aliases": ["slippage", "滑點"], "emoji": "🛝", "featured": false, "short": "實際成交價和預期價格的差距。", "body": "滑價是下單時預期的價格與實際成交價格之間的差距，常發生在市價單、行情快速波動或流動性不足時。"},
  {"term": "限價單／市價單", "en": "Limit / Market Order", "aliases": ["limit order", "market order", "限價單", "市價單", "掛單", "吃單"], "emoji": "📝", "featured": false, "short": "限價單指定價格等成交；市價單立刻用現價成交。", "body": "限價單是指定價格掛著等成交，提供流動性（被動方）；市價單是立刻用市場上最好的價格成交，消耗流動性（主動方）。\n\n訂單流裡說的「主動買／主動賣」，指的就是市價單那一方。"},
  {"term": "停損", "en": "Stop Loss", "aliases": ["stop", "stop loss", "sl", "止損"], "emoji": "🛑", "featured": false, "short": "事先設定好、虧到某個價位就出場。", "body": "停損是在進場前就決定好的出場價位，用來限制單筆交易的最大虧損。\n\n停損應該放在「交易想法被證明錯誤」的位置，而不是隨意的固定點數。"},
  {"term": "風險報酬比", "en": "Risk Reward Ratio", "aliases": ["rr", "r:r", "盈虧比", "風報比"], "emoji": "📐", "featured": false, "short": "預期獲利和可能虧損的比例。", "body": "風險報酬比（RR）= 預期獲利距離 ÷ 停損距離。例如停損 10 點、目標 30 點，RR 就是 1:3。\n\nRR 要搭配勝率一起看，單看其中一個沒有意義。"},
  {"term": "部位大小", "en": "Position Sizing", "aliases": ["position size", "倉位", "倉位管理", "口數"], "emoji": "🧮", "featured": false, "short": "根據可承受虧損決定要下多少。", "body": "部位大小是依照「這筆最多願意虧多少」和「停損距離」來決定下多少口或多少數量。\n\n公式概念：部位大小 = 可承受虧損金額 ÷（停損距離 × 每點價值）。"},
  {"term": "回撤", "en": "Drawdown", "aliases": ["drawdown", "dd", "最大回撤", "mdd"], "emoji": "📉", "featured": false, "short": "帳戶從高點回落的幅度。", "body": "回撤是帳戶淨值從前一個高點下跌的幅度。最大回撤（MDD）是一段期間內最大的那一次，常用來衡量策略或交易者承受過的最大損失。"},
  {"term": "NQ／MNQ", "en": "Nasdaq-100 Futures", "aliases": ["nq", "mnq", "小那斯達克", "微型那斯達克", "那指期貨"], "emoji": "🇺🇸", "featured": false, "short": "CME 的那斯達克 100 期貨與微型版。", "body": "NQ 是 CME 的 E-mini 那斯達克 100 期貨，每點 20 美元，最小跳動 0.25 點（5 美元）。\nMNQ 是微型版，大小為 NQ 的十分之一，每點 2 美元，最小跳動 0.25 點（0.5 美元）。"},
  {"term": "Tick", "en": "Tick", "aliases": ["tick", "跳動點", "最小跳動"], "emoji": "🔹", "featured": false, "short": "價格最小的變動單位。", "body": "Tick 是商品價格最小的跳動單位。不同商品的 Tick 大小與每 Tick 價值不同，計算部位與停損前要先確認。"},
  {"term": "永續合約", "en": "Perpetual Futures", "aliases": ["perp", "perpetual", "永續"], "emoji": "♾️", "featured": false, "short": "沒有到期日的加密貨幣合約。", "body": "永續合約是沒有到期日的合約，靠資金費率讓價格貼近現貨。可以做多也可以做空，通常搭配槓桿使用。"},];

// ── 搜尋 ──
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "").replace(/／/g, "/");
const keysOf = (e) => [e.term, e.en, ...(e.aliases || [])].filter(Boolean).map(norm);
export const termOf = (term) => GLOSSARY.find((e) => e.term === term) || null;
export const featuredTerms = () => (GLOSSARY.some((e) => e.featured) ? GLOSSARY.filter((e) => e.featured) : GLOSSARY).slice(0, 25);

// 兩個字串差幾個字（打錯字也找得到，例如 sweeep、footprnt）
function distance(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

export function searchTerms(query) {
  const q = norm(query).slice(0, 50);
  if (!q) return [];
  const exact = GLOSSARY.filter((e) => keysOf(e).includes(q));
  if (exact.length) return exact;
  const partial = GLOSSARY.filter((e) => keysOf(e).some((k) => k.includes(q) || (k.length >= 2 && q.includes(k))) || norm(e.short).includes(q));
  if (partial.length) return partial.slice(0, 25);
  if (q.length < 3) return [];
  return GLOSSARY
    .map((e) => ({ e, d: Math.min(...keysOf(e).map((k) => distance(q, k) / Math.max(q.length, k.length))) }))
    .filter((x) => x.d <= 0.34)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map((x) => x.e);
}

// ── 訊息長相 ──
const brand = { name: "CCC 交易實驗室｜交易百科", icon_url: LOGO };
const option = (e) => ({ label: e.term.slice(0, 100), value: e.term.slice(0, 100), description: e.short.slice(0, 100), emoji: { name: e.emoji || "📘" } });

export function wikiPanelMessage() {
  return {
    embeds: [{
      author: brand,
      title: "📚 交易百科與頻道導覽",
      description: "從下拉選單挑名詞，或按下方按鈕找主題。回覆只會顯示給你。",
      color: GOLD,
    }],
    components: [
      { type: 1, components: [{ type: 3, custom_id: WIKI_IDS.term, placeholder: "選一個交易名詞", options: featuredTerms().map(option) }] },
      { type: 1, components: [
        { type: 2, style: 1, custom_id: WIKI_IDS.guide, label: "頻道導覽", emoji: { name: "🧭" } },
        { type: 2, style: 2, custom_id: WIKI_IDS.search, label: "搜尋其他名詞", emoji: { name: "🔎" } },
      ] },
    ],
    allowed_mentions: { parse: [] },
  };
}

export function termEmbed(e) {
  const en = e.en && norm(e.en) !== norm(e.term) ? `（${e.en}）` : "";
  const emb = { author: brand, title: `${e.emoji || "📘"} ${e.term}${en}`, description: e.body, color: GOLD, footer: { text: FOOTER } };
  if (e.aliases?.length) emb.fields = [{ name: "也叫做", value: e.aliases.slice(0, 8).join("、") }];
  return emb;
}

const ephemeral = (data) => ({ type: 4, data: { flags: EPHEMERAL, allowed_mentions: { parse: [] }, ...data } });
export const termReply = (term) => {
  const e = termOf(term);
  return e ? ephemeral({ embeds: [termEmbed(e)] }) : ephemeral({ content: "這個名詞已經拿掉了，請重新選一次。" });
};

export const searchModal = () => ({
  type: 9,
  data: {
    custom_id: WIKI_IDS.form,
    title: "搜尋交易名詞",
    components: [{ type: 1, components: [{ type: 4, custom_id: WIKI_IDS.query, label: "名詞或關鍵字", style: 1, min_length: 1, max_length: 50, required: true, placeholder: "例如：Delta、FVG、掃蕩、資金費率" }] }],
  },
});

export function searchReply(query) {
  const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, 50);
  const hits = searchTerms(q);
  if (!hits.length) return ephemeral({ content: `找不到「${q}」。換個說法試試（中文、英文、縮寫都可以），或從面板的下拉選單挑。` });
  if (hits.length === 1) return ephemeral({ embeds: [termEmbed(hits[0])] });
  return ephemeral({
    content: `「${q}」相關的名詞有 ${hits.length} 個：`,
    components: [{ type: 1, components: [{ type: 3, custom_id: WIKI_IDS.term, placeholder: "選一個看說明", options: hits.slice(0, 25).map(option) }] }],
  });
}

// ── 頻道導覽：照 Discord 的規則算出這個人看得到哪些頻道 ──
const VIEW = 1n << 10n, ADMIN = 1n << 3n;
const LISTED = new Set([0, 2, 5, 13, 15, 16]); // 文字、語音、公告、舞台、論壇、媒體
const big = (v) => { try { return BigInt(v || 0); } catch { return 0n; } };

export function canView(channel, { guildId, roles, memberRoles = [], userId }) {
  const owned = new Set(memberRoles);
  let p = 0n;
  for (const r of roles) if (r.id === guildId || owned.has(r.id)) p |= big(r.permissions);
  if (p & ADMIN) return true;
  const ow = channel.permission_overwrites || [];
  const everyone = ow.find((o) => o.id === guildId);
  if (everyone) p = (p & ~big(everyone.deny)) | big(everyone.allow);
  let allow = 0n, deny = 0n;
  for (const o of ow) if (o.type === 0 && o.id !== guildId && owned.has(o.id)) { allow |= big(o.allow); deny |= big(o.deny); }
  p = (p & ~deny) | allow;
  const mine = ow.find((o) => o.type === 1 && o.id === userId);
  if (mine) p = (p & ~big(mine.deny)) | big(mine.allow);
  return (p & VIEW) !== 0n;
}

// 回傳 [{ name: 分類名, lines: ["<#id>｜主題第一行"] }]，分類、頻道照 Discord 上的順序
export function guideSections(channels, ctx, hideCategoryIds = []) {
  const hide = new Set(hideCategoryIds.filter(Boolean));
  const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
  const cats = channels.filter((c) => c.type === 4 && !hide.has(c.id)).sort(byPos);
  const kids = (parent) => channels
    .filter((c) => LISTED.has(c.type) && (c.parent_id || null) === parent && canView(c, ctx))
    .sort((a, b) => ((a.type === 2 || a.type === 13) - (b.type === 2 || b.type === 13)) || byPos(a, b)) // 語音放後面，跟 Discord 一樣
    .map((c) => {
      const topic = String(c.topic || "").split("\n")[0].trim();
      return `<#${c.id}>` + (topic ? `｜${topic.length > 60 ? topic.slice(0, 59) + "…" : topic}` : "");
    });
  const out = [];
  const top = kids(null);
  if (top.length) out.push({ name: "　", lines: top });
  for (const c of cats) {
    const lines = kids(c.id);
    if (lines.length) out.push({ name: c.name, lines });
  }
  return out;
}

export function guideEmbed(sections) {
  const fields = [];
  let total = 0;
  for (const s of sections) {
    if (fields.length >= 24 || total > 5000) break;
    let value = "", cut = 0;
    for (const l of s.lines) {
      if (value.length + l.length + 1 > 1000) { cut++; continue; }
      value += l + "\n";
    }
    if (cut) value += `…還有 ${cut} 個頻道`;
    total += value.length + s.name.length;
    fields.push({ name: s.name.slice(0, 256), value: value.trim() });
  }
  return {
    author: brand,
    title: "🧭 頻道導覽",
    description: fields.length ? "這些是你現在看得到的頻道，點名稱就能過去。" : "目前沒有找到你看得到的頻道。",
    color: GOLD,
    fields,
    footer: { text: "頻道後面的說明是頻道主題，管理員改了這裡就跟著變" },
  };
}

// 按「頻道導覽」之後（背景）：讀頻道、身分組，算好改掉「處理中」那則
export async function guideFor({ guildId, member, s }) {
  const [channels, roles] = await Promise.all([
    discordApi("GET", `/guilds/${guildId}/channels`),
    discordApi("GET", `/guilds/${guildId}/roles`),
  ]);
  const ctx = { guildId, roles: roles || [], memberRoles: member?.roles || [], userId: member?.user?.id };
  // 私人報名頻道、客服單的分類不列（只有管理員看得到，列出來也沒用）
  return guideEmbed(guideSections(channels || [], ctx, [s?.ticketCategoryId, s?.supportCategoryId]));
}

// 後台「交易百科」：有填頻道就貼在那裡；沒填就建「📚交易百科」（大家看得到、不能發言）。已經貼過就改那一則，不重貼
export async function setupWiki({ channelId = "" } = {}) {
  const s = await getDiscordSettings();
  if (!s.guildId) return { ok: false, error: "先在上面按「一鍵建立」，讓機器人認得你的伺服器" };
  const next = { ...s };
  const created = [];
  const exists = async (id) => { if (!id) return false; try { return !!(await getChannel(id)); } catch (e) { if (e.status === 404) return false; throw e; } };
  let target = String(channelId || "").trim() || s.wikiChannelId || "";
  if (target && !(await exists(target))) {
    if (channelId) return { ok: false, error: "找不到這個頻道，請確認頻道 ID，或留空讓機器人自己建一個" };
    target = "";
  }
  if (!target) {
    const ctx = { guildId: s.guildId, botId: env.DISCORD_APP_ID, staffRoleIds: s.staffRoleIds || [] };
    target = (await createChannel(s.guildId, { ...WIKI_CHANNEL, permission_overwrites: supportOverwrites("panel", ctx) })).id;
    created.push(WIKI_CHANNEL.name);
  }
  let repost = !s.wikiMessageId || s.wikiChannelId !== target;
  if (!repost) await editMessage(target, s.wikiMessageId, wikiPanelMessage()).catch((e) => { if (e.status === 404) repost = true; else throw e; });
  if (repost) next.wikiMessageId = (await sendMessage(target, wikiPanelMessage())).id;
  next.wikiChannelId = target;
  await saveDiscordSettings(next);
  return { ok: true, created, reposted: repost, settings: next };
}
