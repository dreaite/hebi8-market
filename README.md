# hebi8 market

> hebi（蛇）首尾相衔，七天一个轮回；多出来的第八天，用来观测市场。

自己用的长线看盘面板。界面干净，默认显示周线和对数坐标，常用指标都有，也能加自定义指标。数据存在本机 SQLite，不需要账号，指标数量也不受限制。

- **总览**：自选列表以卡片显示最新价、涨跌幅、距历史高点的回撤、在 52 周高低区间中的位置，以及近两年的周线迷你图。涨跌周期可以从 1 周、1 月、3 月、今年以来、1 年、3 年、5 年中任选，最多 4 个。
- **图表**：基于 [KLineChart](https://github.com/klinecharts/KLineChart)，可切换日 / 周 / 月线，支持对数坐标。K 线样式可选实心、空心阳线、美国线或面积图。指标可开关，参数可改，参数按周期分别保存在浏览器里。
- **公式指标**：在界面里直接写公式定义指标，可叠加在主图或单独放在副图，例如 `(close / sma(close, 40) - 1) * 100`，不用改代码。
- **代码指标**：内置「回撤」（距历史最高收盘价的跌幅）和「相对强弱」（相对基准的强弱线）作为示例。复杂的指标可以写成计算函数。
- **涨跌色**：右上角可切换绿涨红跌或红涨绿跌，颜色跟随系统的亮色 / 暗色模式。

## 数据源

| source | 覆盖 | 说明 |
|---|---|---|
| `yahoo` | 美股、港股、A 股、指数、ETF | 经 [yahoo-finance2](https://github.com/gadicc/yahoo-finance2) 拉取完整日线历史，价格为复权价（含拆股和分红，最新价保持真实）。直接请求 Yahoo 接口会返回 429，所以必须走这个库。 |
| `binance` | 加密货币现货 | 公开 K 线接口，无需 key，增量拉取。 |
| `tv` | 指数、国债收益率、外汇、商品等 Yahoo 缺的品种 | 非官方的 [TradingView-API](https://github.com/Mathieu2301/TradingView-API)，无需登录，最多约 6000 根日线。属于逆向接口，TradingView 改动协议后可能失效。 |

代码示例：`yahoo:AAPL`、`yahoo:0700.HK`、`yahoo:600519.SS`、`yahoo:^GSPC`、`binance:BTCUSDT`、`tv:TVC:US10Y`、`tv:HSI:HSTECH`、`tv:FX_IDC:USDCNH`。

只存日线，周线和月线由日线合成（周一为一周的起点）。各数据源的日线时间戳不同：美股记在开盘时刻，亚洲市场记在 01:30 UTC，外汇和 TVC 品种记在前一晚开盘时刻。入库前统一按交易所时区换算成交易日。

## 运行

```bash
npm install
npm run dev        # http://localhost:3000
```

首次打开会拉取种子自选的全部历史，大约几秒。之后数据超过 6 小时才会重新拉取。生产模式用 `npm run build && npm start`。

每天定时同步（可选，同时同步各标的的基准）：

```cron
30 22 * * 1-5  cd ~/out/hebi8-market && npm run sync
```

`npm run sync -- --force` 会忽略 6 小时的新鲜度窗口。

| 环境变量 | 默认值 | 作用 |
|---|---|---|
| `HEBI8_DB` | `./data/hebi8.db` | SQLite 文件位置 |
| `BINANCE_API_URL` | `https://api.binance.com` | 换成 `https://data-api.binance.vision` 等镜像 |

## 公式指标

在图表页的指标栏点「+ 公式指标」。每一行（或用分号隔开的一段）画一条线。`name = 表达式` 可以给线命名，后面的行能引用它。`#` 后面是注释。公式保存在浏览器里。

```text
# 均线乖离：价格偏离 40 周线多少 %
(close / sma(close, 40) - 1) * 100

# 唐奇安通道，叠加在主图
upper = highest(high, 20)
lower = lowest(low, 20)

# 相对基准，需要在添加自选时设置对比基准
close / bench
```

| 类别 | 可用 |
|---|---|
| 变量 | `open` `high` `low` `close` `volume` `bench` `hl2` `hlc3` |
| 运算 | `+ - * / ^`、括号，数字和序列可以混合计算 |
| 滚动窗口 | `sma(x, n)` `ema(x, n)` `std(x, n)` `sum(x, n)` `highest(x, n)` `lowest(x, n)` `rsi(x, n)` |
| 前值比较 | `ref(x, n)` `change(x, n=1)` `roc(x, n=1)` |
| 其他 | `cummax(x)` `cummin(x)` `max(a, b)` `min(a, b)` `abs` `sqrt` `log` `exp` |

窗口 `n` 按当前周期计数：周线上 `sma(close, 40)` 就是 40 周均线。

## 代码指标

公式写不出来的逻辑，可以写成代码：

1. 在 `src/indicators/calc.ts` 写纯计算函数（方便测试）。
2. 在 `src/indicators/custom.ts` 写一个 KLineChart 的 `IndicatorTemplate`，并加进 `customIndicators`：

   ```ts
   export const distanceFromMa: IndicatorTemplate<{ dist?: number }, number> = {
     name: "DIST",
     shortName: "均线乖离",
     calcParams: [200],
     figures: [{ key: "dist", title: "乖离 %: ", type: "line" }],
     calc: (dataList, { calcParams: [n] }) => {
       const ma = sma(dataList.map((d) => d.close), n);
       return dataList.map((d, i) => ({ dist: ma[i] ? (d.close / ma[i]! - 1) * 100 : undefined }));
     },
   };
   ```

3. 在 `src/indicators/catalog.ts` 的 `INDICATORS` 里登记：名称、主图或副图、各周期的默认参数。指标栏会自动出现对应的开关和参数编辑。

KLineChart 内置的 MA、EMA、BOLL、VOL、MACD、RSI、KDJ、SAR、OBV 等 27 个指标，也可以直接登记进 `INDICATORS`。

需要对比数据的指标（比如相对强弱）读取每根 K 线上的 `bench` 字段，即基准的收盘价。它由 `/api/bars` 按交易日对齐并前向填充，基准在添加自选时设置。

## 结构

```text
src/
├── app/
│   ├── page.tsx              总览
│   ├── chart/page.tsx        图表页 /chart?key=yahoo:SPY
│   └── api/
│       ├── overview/         自选 + 统计（按需同步）
│       ├── bars/             日/周/月 K 线 + 基准
│       └── watchlist/        增删自选（添加时会先拉一次数据作为校验）
├── components/               Overview / SymbolCard / ChartView / KChart / IndicatorBar / FormulaEditor …
├── indicators/               指标目录、代码指标、公式引擎（formula.ts）、纯计算函数
└── lib/
    ├── sources/              yahoo / binance / tradingview 适配器
    ├── db.ts store.ts        SQLite（symbols、bars 两张表）
    ├── sync.ts               过期判断、增量或全量写入、并发控制
    ├── series.ts             周/月线合成、基准对齐
    ├── stats.ts              总览统计
    └── time.ts               时间戳换算成交易日
scripts/sync.ts               cron 用的同步脚本
tests/                        vitest
```

```bash
npm test           # 单元测试
npm run typecheck
npm run lint
```

## License

Apache-2.0
