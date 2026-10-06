/**
 * Built-in dictionary: the symbols a Chinese-speaking long-term watcher reaches for most, with
 * the Chinese name and lower-case aliases (code, English, pinyin, pinyin initials). Matched
 * locally by the global search, so「腾讯」or「tx」finds 0700.HK without any network call.
 */
import { tickerOf } from "./symbols";

export interface WellKnown {
  key: string;
  zh: string;
  en?: string;
  aliases: string[];
}

const w = (key: string, zh: string, en: string | undefined, ...aliases: string[]): WellKnown => ({ key, zh, en, aliases });

export const WELLKNOWN: WellKnown[] = [
  // crypto
  w("binance:BTCUSDT", "比特币", "Bitcoin", "btc", "bitcoin", "bitebi", "btb"),
  w("binance:ETHUSDT", "以太坊", "Ethereum", "eth", "ethereum", "yitaifang", "ytf"),
  w("binance:SOLUSDT", "Solana", "Solana", "sol", "solana"),
  w("binance:BNBUSDT", "BNB", "BNB", "bnb", "binance coin"),
  w("binance:XRPUSDT", "瑞波币", "XRP", "xrp", "ripple", "ruibo", "ruibobi", "rbb"),
  w("binance:DOGEUSDT", "狗狗币", "Dogecoin", "doge", "dogecoin", "gougoubi", "ggb"),
  w("binance:ADAUSDT", "艾达币", "Cardano", "ada", "cardano", "aidabi", "adb"),
  w("binance:AVAXUSDT", "Avalanche", "Avalanche", "avax", "avalanche"),
  w("binance:LINKUSDT", "Chainlink", "Chainlink", "link", "chainlink"),
  // US indices and ETFs
  w("yahoo:SPY", "标普 500 ETF", "SPDR S&P 500 ETF", "spy", "biaopu", "bp", "sp500", "s&p"),
  w("yahoo:^GSPC", "标普 500 指数", "S&P 500", "spx", "gspc", "biaopu500", "bp500", "sp500 index", "biaopuzhishu", "bpzs"),
  w("yahoo:QQQ", "纳指 100 ETF", "Invesco QQQ", "qqq", "nazhi", "nz", "nasdaq100", "nasdaq 100"),
  w("yahoo:^NDX", "纳指 100 指数", "Nasdaq 100", "ndx", "nazhi100", "nz100", "nasdaq 100 index"),
  w("yahoo:^IXIC", "纳斯达克综合指数", "Nasdaq Composite", "ixic", "nasdaq", "nasidake", "nsdk", "comp"),
  w("yahoo:^DJI", "道琼斯指数", "Dow Jones Industrial Average", "dji", "dow", "daozhi", "dz", "daoqiongsi", "dqs"),
  w("yahoo:IWM", "罗素 2000 ETF", "iShares Russell 2000 ETF", "iwm", "russell", "russell2000", "luosu", "ls", "luosu2000"),
  w("yahoo:^VIX", "恐慌指数 VIX", "CBOE Volatility Index", "vix", "konghuang", "kh", "konghuangzhishu", "khzs", "bodong"),
  w("yahoo:TLT", "美债 20 年+ ETF", "iShares 20+ Year Treasury Bond ETF", "tlt", "changzhai", "cz"),
  w("yahoo:GLD", "黄金 ETF", "SPDR Gold Shares", "gld", "huangjin etf"),
  w("yahoo:IBIT", "比特币现货 ETF", "iShares Bitcoin Trust", "ibit", "bitebi etf"),
  // HK / A-share indices
  w("yahoo:^HSI", "恒生指数", "Hang Seng Index", "hsi", "hangseng", "hengsheng", "hs", "hengshengzhishu", "hszs"),
  w("yahoo:^HSCE", "国企指数", "Hang Seng China Enterprises Index", "hsce", "hscei", "guoqi", "gq", "guoqizhishu", "gqzs"),
  w("tv:HSI:HSTECH", "恒生科技指数", "Hang Seng TECH Index", "hstech", "hengshengkeji", "hskj", "hangseng tech"),
  w("tv:SSE:000300", "沪深 300", "CSI 300", "csi300", "000300", "hushen300", "hushen", "hs300", "hs"),
  w("yahoo:000001.SS", "上证指数", "SSE Composite Index", "000001", "sse", "shangzheng", "sz", "shangzhengzhishu", "szzs", "shanghai"),
  w("yahoo:399006.SZ", "创业板指", "ChiNext Index", "399006", "chinext", "chuangyeban", "cyb", "chuangyebanzhi", "cybz"),
  // macro
  w("tv:TVC:GOLD", "黄金", "Gold", "gold", "huangjin", "hj", "xau", "xauusd"),
  w("tv:TVC:SILVER", "白银", "Silver", "silver", "baiyin", "by", "xag", "xagusd"),
  w("tv:TVC:USOIL", "原油 WTI", "WTI Crude Oil", "usoil", "oil", "wti", "crude", "yuanyou", "yy", "shiyou", "sy"),
  w("tv:TVC:UKOIL", "布伦特原油", "Brent Crude Oil", "ukoil", "brent", "bulunte", "blt"),
  w("tv:TVC:US02Y", "美债 2 年", "US 2Y Treasury Yield", "us02y", "us2y", "2y", "meizhai2nian", "mz2n"),
  w("tv:TVC:US10Y", "美债 10 年", "US 10Y Treasury Yield", "us10y", "10y", "meizhai", "mz", "meizhai10nian", "mz10n", "shouyilv", "syl", "guozhai", "gz", "yield"),
  w("tv:TVC:US30Y", "美债 30 年", "US 30Y Treasury Yield", "us30y", "30y", "meizhai30nian", "mz30n"),
  w("tv:TVC:DXY", "美元指数", "US Dollar Index", "dxy", "dollar", "usd", "meiyuan", "my", "meiyuanzhishu", "myzs"),
  w("tv:FX_IDC:USDCNH", "离岸人民币", "USD/CNH", "usdcnh", "cnh", "cny", "rmb", "renminbi", "lianrenminbi", "larmb", "huilv", "hl"),
  w("tv:FX_IDC:USDJPY", "美元日元", "USD/JPY", "usdjpy", "jpy", "yen", "riyuan", "ry", "meiyuanriyuan", "myry"),
  w("tv:FX_IDC:EURUSD", "欧元美元", "EUR/USD", "eurusd", "eur", "euro", "ouyuan", "oy"),
  w("yahoo:^N225", "日经 225", "Nikkei 225", "n225", "nikkei", "rijing", "rj", "rijing225", "riben", "rb"),
  w("yahoo:^GDAXI", "德国 DAX", "DAX", "dax", "gdaxi", "deguo", "dg"),
  w("yahoo:^FTSE", "富时 100", "FTSE 100", "ftse", "fushi", "fs", "yingguo", "yg"),
  w("yahoo:^STOXX50E", "欧洲斯托克 50", "Euro Stoxx 50", "stoxx", "stoxx50", "sx5e", "ouzhou", "oz"),
  w("yahoo:^KS11", "韩国综合指数", "KOSPI", "kospi", "ks11", "hanguo", "hg"),
  w("yahoo:^TWII", "台湾加权指数", "TAIEX", "twii", "taiex", "taiwan", "tw", "taiwanjiaquan", "twjq"),
  // US stocks
  w("yahoo:AAPL", "苹果", "Apple", "aapl", "apple", "pingguo", "pg"),
  w("yahoo:MSFT", "微软", "Microsoft", "msft", "microsoft", "weiruan", "wr"),
  w("yahoo:NVDA", "英伟达", "NVIDIA", "nvda", "nvidia", "yingweida", "ywd"),
  w("yahoo:TSLA", "特斯拉", "Tesla", "tsla", "tesla", "tesila", "tsl"),
  w("yahoo:GOOGL", "谷歌", "Alphabet", "googl", "goog", "google", "alphabet", "guge", "gg"),
  w("yahoo:AMZN", "亚马逊", "Amazon", "amzn", "amazon", "yamaxun", "ymx"),
  w("yahoo:META", "Meta", "Meta Platforms", "meta", "facebook", "fb"),
  w("yahoo:TSM", "台积电", "TSMC", "tsm", "tsmc", "taijidian", "tjd"),
  w("yahoo:AMD", "AMD", "Advanced Micro Devices", "amd", "chaowei", "cw"),
  w("yahoo:AVGO", "博通", "Broadcom", "avgo", "broadcom", "botong", "bt"),
  w("yahoo:NFLX", "奈飞", "Netflix", "nflx", "netflix", "naifei", "nf"),
  w("yahoo:BRK-B", "伯克希尔", "Berkshire Hathaway", "brk", "brkb", "brk-b", "berkshire", "bokexier", "bkxe", "bafeite", "bft"),
  w("yahoo:COIN", "Coinbase", "Coinbase", "coin", "coinbase"),
  w("yahoo:MSTR", "微策略", "Strategy (MicroStrategy)", "mstr", "microstrategy", "strategy", "weicelue", "wcl"),
  // HK / A-share stocks
  w("yahoo:0700.HK", "腾讯控股", "Tencent", "0700", "700", "tencent", "tengxun", "tx", "tengxunkonggu", "txkg"),
  w("yahoo:9988.HK", "阿里巴巴", "Alibaba", "9988", "baba", "alibaba", "ali", "alibaba", "albb"),
  w("yahoo:3690.HK", "美团", "Meituan", "3690", "meituan", "mt"),
  w("yahoo:1810.HK", "小米集团", "Xiaomi", "1810", "xiaomi", "xm", "xiaomijituan", "xmjt"),
  w("yahoo:1211.HK", "比亚迪", "BYD", "1211", "byd", "biyadi", "byd"),
  w("yahoo:9618.HK", "京东", "JD.com", "9618", "jd", "jingdong"),
  w("yahoo:9888.HK", "百度", "Baidu", "9888", "bidu", "baidu", "bd"),
  w("yahoo:0981.HK", "中芯国际", "SMIC", "0981", "981", "smic", "zhongxin", "zx", "zhongxinguoji", "zxgj"),
  w("yahoo:2318.HK", "中国平安", "Ping An Insurance", "2318", "pingan", "pa", "zhongguopingan", "zgpa"),
  w("yahoo:600519.SS", "贵州茅台", "Kweichow Moutai", "600519", "maotai", "mt", "guizhoumaotai", "gzmt"),
  w("yahoo:300750.SZ", "宁德时代", "CATL", "300750", "catl", "ningde", "nd", "ningdeshidai", "ndsd"),
];

const byKey = new Map(WELLKNOWN.map((e) => [e.key, e]));

export function wellKnown(key: string): WellKnown | undefined {
  return byKey.get(key);
}

/** The Chinese name from the dictionary, if the key is in it. */
export function wellKnownName(key: string): string | null {
  return byKey.get(key)?.zh ?? null;
}

/** Display rule everywhere: the yaml name, else the dictionary's Chinese name, else what the source reports. */
export function displayName(key: string, yamlName?: string | null, sourceName?: string | null): string {
  return yamlName ?? wellKnownName(key) ?? sourceName ?? tickerOf(key);
}
