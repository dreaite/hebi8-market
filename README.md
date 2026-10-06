# hebi8 market

> hebi（蛇）首尾相衔，七天一个轮回；多出来的第八天，用来观测市场。

自己用的周度复盘工具，不是 TradingView 的替代品。每天收盘后自动拉日线；第八天打开时做三件事：

| 动作 | 页面 | 回答的问题 |
|---|---|---|
| 扫描 | `/` 总览：分组表格、条件徽标、本周变化 | 我关心的东西现在各处于什么状态？ |
| 深看 | `/chart/[key]` 图表：K 线、指标、对比、画线、笔记 | 值得细看的几个，结构是什么样？和别的比呢？ |
| 记录 | `/review` 复盘：本周日志、上周日志、本周变化汇总 | 上周怎么想的，这周怎么想？ |

- **搜索**：页头搜索框，或在任何页面按 `/`、`Ctrl/Cmd+K`；图表页直接敲字母就开始搜。本地即时匹配自选、别名和一本约 65 条的内置字典（中文名、拼音、首字母：「腾讯」「tx」「maotai」都行），外部再查 Yahoo / TradingView / Binance。Enter 打开；不在自选的回车就按推断的分组加入并开图，Tab 换组，toast 可撤销。
- **总览**：按 `hebi8.yaml` 里的分组列一张表，显示最新价、所选周期的涨跌、距历史高点的回撤、52 周区间位置、条件徽标和近两年的周线迷你图。表头点击对所有分组排序（降序 → 升序 → 默认）；整行可点，行尾「⋯」或右键：移到分组、改名、设基准、移除（可撤销）。本周新触发的条件淡高亮，本周失效的虚线。
- **图表**：基于 [KLineChart](https://github.com/klinecharts/KLineChart)，日 / 周 / 月 / 季线，对数坐标，四种 K 线样式，「含分红」切换总回报价格。内置指标、代码指标和公式指标都可开关、改参数，参数按周期保存。`←/→` 或 `j/k` 按总览顺序切换标的，标题旁显示「3 / 11」；`Esc` 关掉任何面板。
- **对比**：把别的标的叠在主图上，用同百分比坐标——滚动、缩放时所有线从可见区间左边缘重新归零，和 TradingView 一致；单位不同的（比如美债收益率）放独立副图。
- **画线**：水平线、线段、射线、趋势线、斐波那契、文字标注，只画在主图上。按时间戳保存，周线上画的线切到日线还在。右键删除一条，`Esc` 退出绘制。
- **笔记与复盘**：每个标的一篇 markdown 笔记（thesis）；每周一篇复盘日志。都是自动保存：停止输入 1 秒后写盘，`Ctrl/Cmd+S` 立即保存，浏览器里留一份草稿兜底。复盘页列出本周所有条件变化和有笔记的标的。
- **合成标的**：`=BTC/GOLD` 这样的表达式当作标的看图、算统计、算条件，逐字段计算，和 TradingView 的 spread 一样。

约束：单用户、无登录、只在内网用；只存日线，周 / 月 / 季线读时合成；读取永远不碰网络。

## 数据源

| source | 覆盖 | 说明 |
|---|---|---|
| `yahoo` | 美股、港股、A 股、指数、ETF | 经 [yahoo-finance2](https://github.com/gadicc/yahoo-finance2) 拉取完整日线历史。价格是拆股复权价，分红因子另存，`prices: total` 时折进价格。直接请求 Yahoo 接口会返回 429，所以必须走这个库。 |
| `binance` | 加密货币现货 | 公开 K 线接口，无需 key，增量拉取。 |
| `tv` | 指数、国债收益率、外汇、商品等 Yahoo 缺的品种 | 非官方的 [TradingView-API](https://github.com/Mathieu2301/TradingView-API)，无需登录，最多约 6000 根日线。属于逆向接口，TradingView 改动协议后可能失效。 |

代码示例：`yahoo:AAPL`、`yahoo:0700.HK`、`yahoo:600519.SS`、`yahoo:^GSPC`、`binance:BTCUSDT`、`tv:TVC:US10Y`、`tv:HSI:HSTECH`、`tv:FX_IDC:USDCNH`、`=BTC/GOLD`。

各数据源的日线时间戳不同：美股记在开盘时刻，亚洲市场记在 01:30 UTC，外汇和 TVC 品种记在前一晚开盘时刻。入库前统一按交易所时区换算成交易日。

## 运行

```bash
npm install
npm run dev        # http://localhost:3000
```

首次打开会把 `vault.example/hebi8.yaml` 复制为 `vault/hebi8.yaml`，并在后台拉取全部历史，大约几秒。之后由应用内的调度器按 `sync.at` 的时间每天同步；应用停过一段时间再启动时会补跑一次。总览右上角的「刷新」强制全量同步。

生产模式 `npm run build && npm start`。

| 快捷键 | 作用 |
|---|---|
| `/`、`Ctrl/Cmd+K` | 打开搜索（图表页直接敲字母、数字也行） |
| `↑ ↓ Enter Tab Esc` | 搜索里移动、打开 / 添加、换分组、关闭 |
| `← →`、`j k` | 图表页切上一只 / 下一只 |
| `Esc` | 关闭面板、退出画线 |
| `Ctrl/Cmd+S` | 立即保存笔记 / 复盘 |

| 环境变量 | 默认值 | 作用 |
|---|---|---|
| `HEBI8_VAULT` | `./vault` | 用户内容目录 |
| `HEBI8_DB` | `./data/hebi8.db` | SQLite 缓存，删了会自动重建 |
| `BINANCE_API_URL` | `https://api.binance.com` | 换成 `https://data-api.binance.vision` 等镜像 |

## vault

**`vault/` 是我的，`data/hebi8.db` 是缓存。** vault 不进 git，放到自己的同步盘或者单独的仓库里。

```text
vault/
  hebi8.yaml                  自选分组、别名、公式指标、条件、同步时间表、图表偏好
  notes/<fileKey>.md          每个标的的笔记，frontmatter 里的 key 是权威
  journal/<YYYY>-W<ww>.md     每周复盘（ISO 周）
  charts/<fileKey>.json       每个标的的对比列表和画线
```

`hebi8.yaml` 的样子见 `vault.example/hebi8.yaml`。界面上改周期、涨跌色、图表偏好、添加 / 移除 / 移动 / 改名标的、设基准、编辑公式指标时会写回这个文件，注释和顺序都保留；同步时间、别名、条件直接改文件，不用重启。搜索时用中文词添加的标的，这个词会记进 `aliases`。

- 标的引用（分组、`bench`、公式里的 `close(X)`、合成表达式、对比、搜索）先查 `aliases`，查不到就当完整 key。
- 显示名：yaml 里的 `name` > 内置字典的中文名 > 数据源的名字。
- `bench` 是相对强弱和 `close(bench)` 的默认基准。
- `conditions` 在每次同步后按周线计算，`prev != now` 就是本周的变化。
- `fileKey`：`tv:TVC:US10Y → tv_TVC_US10Y`，`=BTC/GOLD → expr_BTC_GOLD`。

## 公式

公式用在三处：图表页的公式指标、总览的条件徽标、对比。每一行（或用分号隔开的一段）画一条线，`name = 表达式` 可以给线命名，后面的行能引用它，`#` 后面是注释。

```text
# 均线乖离：价格偏离 40 周线多少 %
(close / sma(close, 40) - 1) * 100

# 相对基准
close / close(bench)

# 条件：趋势向上且创 52 周新高
close > sma(close, 40) and close >= highest(close, 52)

# 和纳指比，用别名或带引号的 key
close(QQQ) / close("yahoo:SPY")
```

| 类别 | 可用 |
|---|---|
| 变量 | `open` `high` `low` `close` `volume` `bench` `hl2` `hlc3` `tr` |
| 别的标的 | `close(QQQ)`（别名）、`close("yahoo:QQQ")`、`close(bench)`；open / high / low / volume 同理，按本标的交易日对齐并前向填充 |
| 运算 | `+ - * / ^`、括号；比较 `> < >= <= == !=`；逻辑 `and or not`（结果是 0/1，优先级 not > 比较 > and > or，都低于算术） |
| 滚动窗口 | `sma(x, n)` `ema(x, n)` `std(x, n)` `sum(x, n)` `highest(x, n)` `lowest(x, n)` `rsi(x, n)` `atr(n)` `corr(a, b, n)` `pctrank(x, n)` |
| 前值比较 | `ref(x, n)` `change(x, n=1)` `roc(x, n=1)` `cross(a, b)` `barssince(cond)` |
| 其他 | `iff(cond, a, b)` `cummax(x)` `cummin(x)` `max(a, b)` `min(a, b)` `abs` `sqrt` `log` `exp` |

窗口 `n` 按当前周期计数：周线上 `sma(close, 40)` 就是 40 周均线。

合成标的的表达式更简单：操作数是别名或带引号的 key，支持 `+ - * / ^`、数字和括号，逐字段（开高低收）计算，交易日取第一个操作数的。

## 代码指标

公式写不出来的逻辑，可以写成代码：

1. 在 `src/indicators/calc.ts` 写纯计算函数（方便测试）。
2. 在 `src/indicators/custom.ts` 写一个 KLineChart 的 `IndicatorTemplate`，并加进 `customIndicators`。
3. 在 `src/indicators/catalog.ts` 的 `INDICATORS` 里登记：名称、主图或副图、各周期的默认参数。指标栏会自动出现对应的开关和参数编辑。

KLineChart 内置的 MA、EMA、BOLL、VOL、MACD、RSI、KDJ、SAR、OBV 等指标也可以直接登记进 `INDICATORS`。需要基准的指标（比如相对强弱）读每根 K 线上的 `bench` 字段，由 `/api/bars` 按交易日对齐并前向填充。

## 结构

```text
src/
├── app/
│   ├── page.tsx              总览（RSC，直接读 vault 和 SQLite）
│   ├── chart/[key]/page.tsx  图表页 /chart/yahoo%3ASPY
│   ├── review/page.tsx       复盘
│   ├── actions.ts            Server Actions：写 yaml / 笔记 / 日志 / 图表状态，刷新
│   └── api/
│       ├── bars/             日/周/月/季 K 线 + 对齐好的引用标的
│       └── search/           外部搜索（Yahoo / TradingView / Binance），本地匹配在浏览器里
├── instrumentation.ts        启动应用内调度器
├── components/               UiProvider（搜索浮层、toast、快捷键）/ SymbolSearch / Overview / RowMenu / ChartView / KChart / IndicatorBar / FormulaEditor / NotesPanel …
├── indicators/               指标目录、代码指标、公式引擎（formula.ts）、纯计算函数
└── lib/
    ├── search.ts wellknown.ts 搜索的纯函数（匹配、过滤、去重、排序、分组推断）与内置字典
    ├── use-autosave.ts       笔记 / 复盘的自动保存
    ├── sources/              yahoo / binance / tradingview 适配器
    ├── vault.ts config.ts    vault 的读写层、hebi8.yaml 的类型与校验
    ├── db.ts store.ts        SQLite 缓存（symbols、bars、stats）
    ├── sync.ts scheduler.ts  同步、同步后算 stats、每日定时
    ├── series.ts synth.ts    周/月/季线合成、对齐、合成标的
    ├── stats.ts conditions.ts 总览统计与条件
    └── time.ts tz.ts week.ts 交易日换算、时区、ISO 周
vault.example/hebi8.yaml      首次运行的起点
tests/                        vitest
```

```bash
npm test           # 单元测试
npm run typecheck
npm run lint
npm run build
```

## License

Apache-2.0
