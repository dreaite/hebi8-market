# hebi8 market v2 设计

> hebi（蛇）首尾相衔，七天一个轮回；多出来的第八天，用来观测市场。

hebi8 是一个**周度复盘工具**，不是 TradingView 的替代品。每天收盘后自动拉日线；第八天打开时做三件事：

| 动作 | 页面 | 回答的问题 |
|---|---|---|
| 扫描 | `/` 总览：分组表格、条件徽标、本周变化 | 我关心的东西现在各处于什么状态？ |
| 深看 | `/chart/[key]` 图表：K 线、指标、对比、画线、笔记 | 值得细看的几个，结构是什么样？和别的比呢？ |
| 记录 | `/review` 复盘：本周日志、上周日志、本周变化汇总 | 上周怎么想的，这周怎么想？ |

约束：单用户、无登录、只在 Tailscale 内网；只存日线，周/月/季线读时合成；**读取永远不碰网络**。

本文是 v2 的实施规范。v1 的代码可以参考（`tradingDay`、公式引擎、指标目录、统计定义都保留），但不需要兼容：目录、schema、接口都按本文重做。

---

## 1. 数据：缓存与内容分开

**一句话心智模型：`vault/` 是我的，`data/hebi8.db` 是缓存，删了会自动重建。**

```
data/hebi8.db                 SQLite 缓存：bars、symbols 元数据与同步状态、stats
vault/                        用户内容，gitignore；HEBI8_VAULT 环境变量可改位置
  hebi8.yaml                  自选分组、别名、公式指标、条件、同步时间表、图表偏好
  notes/<fileKey>.md          每个标的的笔记（thesis）
  journal/<YYYY>-W<ww>.md     每周复盘（ISO 周）
  charts/<fileKey>.json       每个标的的图表状态：对比列表、画线
vault.example/hebi8.yaml      首次运行时若 vault/ 不存在，复制为 vault/hebi8.yaml
```

### 1.1 `hebi8.yaml`

```yaml
sync:
  at: ["07:30", "17:30"]       # 本地时间，按 tz 解释；美股收盘后、亚洲收盘后各一次
  tz: Asia/Tokyo
prices: split                  # split = 拆股复权（默认，和 TradingView 一致）；total = 含分红的总回报
periods: [1W, 1M, 1Y]          # 总览显示的涨跌周期，最多 4 个：1W 1M 3M YTD 1Y 3Y 5Y
updown: green-up               # green-up | red-up

aliases:                       # 公式、条件、对比、合成标的里可用的短名
  SPY: yahoo:SPY
  QQQ: yahoo:QQQ
  HSI: yahoo:^HSI
  CSI300: tv:SSE:000300
  BTC: binance:BTCUSDT
  GOLD: tv:TVC:GOLD

groups:
  - name: 加密
    symbols:
      - BTC                                      # 字符串：别名或完整 key
      - { key: binance:ETHUSDT, bench: BTC }     # bench：相对强弱、close(bench) 的默认基准
  - name: 美股
    symbols:
      - SPY
      - { key: QQQ, bench: SPY }
      - { key: yahoo:NVDA, name: 英伟达, bench: QQQ }
  - name: 港 A
    symbols:
      - { key: yahoo:0700.HK, name: 腾讯控股, bench: HSI }
      - { key: yahoo:600519.SS, name: 贵州茅台, bench: CSI300 }
  - name: 宏观
    symbols: [GOLD, tv:TVC:US10Y, tv:TVC:DXY]
  - name: 比价
    symbols:
      - { key: "=BTC/GOLD", name: 比特币/黄金 }   # 以 = 开头的是合成标的，见 §3.3

indicators:                    # 公式指标，图表页可开关；语法见 §4
  - { id: dev40, label: 均线乖离, pane: sub, formula: "(close / sma(close, 40) - 1) * 100" }
  - { id: vs_bench, label: 对基准比价, pane: sub, formula: "close / close(bench)" }

conditions:                    # 总览条件徽标；同步时按周线计算，布尔结果
  - { id: trend, label: 趋势, formula: "close > sma(close, 40) and sma(close, 10) > sma(close, 40)" }
  - { id: near_high, label: 近高点, formula: "close >= highest(high, 52) * 0.9" }
  - { id: new_high, label: 新高, formula: "close >= highest(close, 52)" }
  - { id: rs_high, label: RS新高, formula: "rs = close / close(bench); rs >= highest(rs, 26)" }
  - { id: below_200w, label: 破200周, formula: "close < sma(close, 200)" }

chart:                         # 全局图表偏好（UI 改动会写回这里）
  tf: W                        # D | W | M | Q
  log: true
  style: candle_solid          # candle_solid | candle_up_stroke | ohlc | area
  indicators: [MA, VOL]        # 默认开启的指标名（内置 / 代码 / 公式 id）
  params:                      # 按周期覆盖指标参数；没写的用目录里的默认值
    W: { MA: [10, 40, 200] }
```

规则：

- 标的引用（groups、bench、公式里的 `close(X)`、合成表达式、对比列表）一律先查 `aliases`，查不到就当完整 key `source:ticker`。
- `key` 格式：`yahoo:AAPL`、`yahoo:0700.HK`、`yahoo:^GSPC`、`binance:BTCUSDT`、`tv:TVC:US10Y`、`tv:FX_IDC:USDCNH`，或 `=表达式`。
- 一个标的只出现在一个组里。显示名：`name` > 内置字典（`src/lib/wellknown.ts`）的中文名 > 数据源返回的名字。
- yaml 由 UI 写回时必须保留注释和顺序：用 `yaml` 包的 `parseDocument` 修改后 `toString()`，原子写入（写临时文件再 rename）。
- yaml 解析失败时页面显示错误（含行号），服务不崩。

### 1.2 `notes/<fileKey>.md` 与 `journal/`

```markdown
---
key: yahoo:NVDA
---
# 为什么看
...
```

- frontmatter 的 `key` 是权威，文件名只是派生。
- `fileKey(key)`：`key.replace(/[^A-Za-z0-9.\-]/g, "_")`；合成标的去掉 `=` 后加前缀 `expr_`。例：`tv:TVC:US10Y → tv_TVC_US10Y`，`=BTC/GOLD → expr_BTC_GOLD`。冲突时追加 6 位 hash。
- journal 文件名用 ISO 周：`2026-W41.md`。新建时给模板：`## 市场` / `## 持仓与自选` / `## 变动` / `## 下周看什么`。
- markdown 渲染用 `marked`（单用户本地工具，直接 `dangerouslySetInnerHTML` 即可）。

### 1.3 `charts/<fileKey>.json`

```json
{
  "compare": [{ "key": "yahoo:QQQ", "mode": "percent", "color": "#e8891d" }],
  "overlays": [{ "name": "horizontalStraightLine", "points": [{ "timestamp": 1700000000000, "value": 123.4 }] }]
}
```

- `overlays` 是 KLineChart overlay 的可序列化字段：`name`、`points`、`styles?`、`lock?`、`extendData?`。点是 `{timestamp, value}`，所以周线上画的线在日线/月线上也在。
- `compare[].mode`：`percent`（主图叠加，同百分比坐标）或 `pane`（独立副图）。

### 1.4 SQLite 缓存

```sql
PRAGMA user_version;           -- 迁移：一个 migrations 数组，按版本依次执行
CREATE TABLE symbols (
  key        TEXT PRIMARY KEY,  -- 不含合成标的
  source     TEXT NOT NULL, ticker TEXT NOT NULL,
  name       TEXT, exchange TEXT, currency TEXT, timezone TEXT, kind TEXT,  -- 来自数据源的元数据
  synced_at  INTEGER, sync_error TEXT, first_t INTEGER, last_t INTEGER
);
CREATE TABLE bars (
  key TEXT NOT NULL, t INTEGER NOT NULL,    -- t：交易日 UTC 零点的 unix 秒（同 v1）
  o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL,
  adj REAL NOT NULL DEFAULT 1,              -- 分红复权因子；o/h/l/c 本身只做拆股复权
  PRIMARY KEY (key, t)
) WITHOUT ROWID;
CREATE TABLE stats (
  key TEXT PRIMARY KEY,                     -- 含合成标的
  computed_at INTEGER NOT NULL, json TEXT NOT NULL
);
```

`symbols` 里只有缓存和元数据，**没有任何用户字段**（名字、分组、基准、排序都在 yaml）。

---

## 2. 数据源与同步

### 2.1 适配器接口

```ts
interface SourceAdapter {
  fetchDaily(ticker: string, since: number | null): Promise<{
    bars: Bar[];                     // 含 adj
    meta: { name?: string; exchange?: string; currency?: string; timezone?: string; kind?: string };
    mode: "replace" | "merge";
  }>;
  search?(query: string): Promise<{ key: string; name: string; exchange?: string; kind?: string }[]>;
}
```

| 源 | 价格 | adj | 增量 | 搜索 | 备注 |
|---|---|---|---|---|---|
| `yahoo` | `chart()` 的 open/high/low/close 本身是拆股复权，**原样存** | `adjclose / close` | 全量 replace | `new YahooFinance().search(q)` | 直接请求 Yahoo 会 429，必须走 yahoo-finance2 |
| `tv` | `setMarket(ticker, { timeframe: "D", range: 6000, adjustment: "splits" })` | 1 | 全量 replace | `TradingView.searchMarketV3(q)` | 一次同步共用一个 `Client`，顺序开 chart；30s 超时；逆向接口可能失效，错误只记在该标的上 |
| `binance` | `/api/v3/klines` 1d | 1 | 增量 merge（回拉 3 天覆盖未收盘的那根） | 静态：`/^[A-Z0-9]{2,12}USDT$/` 命中即给候选 | 00:00 UTC 开盘，无需时区换算 |

- 时间戳 → 交易日的映射沿用 v1 的 `tradingDay(tsSec, timeZone)`（+12h 后取交易所时区的日期）和 `tests/time.test.ts`，原样保留。各源的约定：美股记在开盘 13:30 UTC，亚洲记在 01:30 UTC，FX/TVC 记在前一晚的开盘。
- 已知数据事实：现库 12 个标的 73,543 根日线；`tv:TVC:US10Y` 2013 年以前没有周一的数据（源本身缺），周线合成能正常处理。

### 2.2 调度器（应用内，不依赖 systemd timer）

- `src/instrumentation.ts` 导出 `register()`，仅在 `process.env.NEXT_RUNTIME === "nodejs"` 时启动调度；用 `globalThis` 守卫防止 dev 模式重复启动。
- 按 `sync.at × sync.tz` 算下一个时刻（用 `Intl.DateTimeFormat` 处理时区与夏令时，不引入日期库），`setTimeout` 链式调度。
- 启动时：若 `max(symbols.synced_at)` 早于最近一个已过去的时刻，延迟 5s 后补跑一次（等价 systemd 的 `Persistent=true`）。
- 日志打到 stdout（journalctl 能看）。

### 2.3 `syncAll(force?)` / `syncOne(key, force?)`

- 要同步的 key 集合 = groups 里的 + 所有 `bench` + 公式/条件/合成表达式/各 `charts/*.json` 对比列表引用到的。别名本身不触发同步。
- 并发 4，同 key 去重，单个失败不影响其他；失败写 `sync_error`，页面上显示。
- 同步完成后立刻对**每个标的（含合成）**计算 `stats` 并写表（§3.4）。
- 读取路径（页面、API）**只读库**。首次运行库为空时，总览显示「首次拉取中…」并每 3s 刷新一次，同时后台触发 `syncAll`。
- 「刷新」按钮是 Server Action：`await syncAll(true)` 后 `revalidatePath`，按钮期间显示 pending（手动动作，阻塞 3–30s 可以接受）。
- 新增标的时立即 `syncOne(key, true)`，失败则不写入 yaml 并报错（首次拉取兼做校验）。

---

## 3. 序列层（纯函数，服务端与客户端共用）

### 3.1 `Bar`

`{ t, o, h, l, c, v: number | null, adj }`。按 `prices` 模式取价：`split` 直接用；`total` 时 o/h/l/c 乘 `adj`。

### 3.2 合成周期

D 原样；W 周一起算；M 月初；**Q 季初**（`Date.UTC(y, floor(m/3)*3, 1)`）。KLineChart 的 period：`Q = { type: "month", span: 3 }`。

### 3.3 对齐与合成标的

- `align(target: Bar[], other: Bar[])`：按 target 的交易日取 other 当天或之前最近一根的值（前向填充），开头没有数据的位置为 `null`。v1 的 `alignCloses` 泛化成返回整根 bar。
- 合成标的 `=表达式`：操作数是别名或带引号的完整 key（`="binance:BTCUSDT"/"tv:TVC:GOLD"`），支持 `+ - * / ^`、数字、括号。**逐字段计算**（o=oA/oB，h=hA/hB，l=lA/lB，c=cA/cB，v=null），这正是 TradingView spread 的做法。交易日取第一个操作数的交易日，其余前向填充；任一操作数尚无数据的前导区间丢掉。合成标的不入 `bars` 表，按需计算；其 `stats` 同普通标的。

### 3.4 `stats`

```ts
{
  last, lastTime, currency,
  changes: { "1W": number | null, "1M": ..., "3M", "YTD", "1Y", "3Y", "5Y" },  // 全部算好，显示哪些由 periods 决定
  ddAth,                                  // 距历史最高收盘的回撤，<= 0
  pos52,                                  // 52 周高低区间位置 0..1
  spark: number[],                        // 近 104 周的周收盘
  conditions: { [id]: { now: boolean | null, prev: boolean | null } }  // 最后一根周线、上一根周线
}
```

- `changes`/`ddAth`/`pos52` 的定义与 v1 `src/lib/stats.ts` 相同，按 yaml 的 `prices` 模式计算。
- 条件默认按周线算（条件可带 `tf` 覆盖）；`now` 是最后一根（周中为未完成的本周），`prev` 是上一根。`prev=false, now=true` 即「本周新触发」。

---

## 4. 公式引擎 v2

在 v1 `src/indicators/formula.ts` 的 tokenizer / parser / 序列求值上扩展，不重写。

**语法增量**

- 比较与布尔：`> < >= <= == !=`、`and or not`；结果是 0/1 序列。优先级：`not` > 比较 > `and` > `or`，都低于算术。
- 字符串字面量 `"..."`，只用于标的引用。
- 标的引用：`close`、`open`、`high`、`low`、`volume` 既是变量也是一元函数：`close` 是本标的；`close(QQQ)` / `close("yahoo:QQQ")` 是别的标的，按本标的交易日对齐并前向填充；`bench` 是本标的在 yaml 里的 `bench`（没配就报错「未设置基准」）。`close(bench)` 与裸 `bench` 等价。
- 新增函数：`iff(cond, a, b)`、`cross(a, b)`（a 上穿 b 的那根为 1）、`barssince(cond)`、`atr(n)`、`tr`、`corr(a, b, n)`、`pctrank(x, n)`。
- `compile(source)` 额外返回 `refs: string[]`（引用到的标的，别名已解析为 key）。
- `evaluate(program, { bars, refs: { [key]: AlignedBar[] } })`。

**用在三处**：图表指标（客户端，KLineChart 模板）、总览条件（服务端，同步时按周线）、对比面板（客户端）。引擎是纯 TS，没有环境依赖。

---

## 5. 页面

### 5.1 总览 `/`（RSC 直读 yaml + stats 表）

- 顶部：`自选 · 上次同步`；右侧「上次复盘 N 天前」链到 `/review`、「周期 · 1周 1月 1年」（点开选择显示的涨跌周期）、涨跌色分段开关「绿涨 | 红涨」、「刷新」、「+ 添加」（打开全局搜索，见 §5.4）。
- **一张表格**，`table-layout: fixed` + `<colgroup>`，分组做 subheader 行，所以「价格」列在每个分组里的 x 坐标一致。名称列吃剩余宽度并 truncate（title 显全名）；其余列固定：价格 112、每个涨跌周期 72、距高点 72、52 周 128、条件 220、两年 200、菜单 28。
- 表头整格可点排序：第一次降序、第二次升序、第三次恢复 yaml 顺序；箭头指示方向（`aria-sort`）；**同一列的排序同时作用于所有分组**。
- 整行是链接（`onClick` 路由 + 名称单元格是真正的 `<a>`，中键在新标签打开）。行尾「⋯」菜单始终可聚焦，视觉上 hover / focus / 打开时才显示；右键整行也打开：打开 / 移到分组 ▸（现有分组或新建）/ 改名 / 设基准 / 移除（toast「已移除 X · 撤销」，不用原生 confirm）。
- 条件徽标三态，同一个 `Badge` 组件（复盘页也用）：`now=true` 普通描边；**本周新触发**淡高亮底（浅色 `bg-accent/10 border-accent/40 text-accent`，深色 `bg-accent/15 border-accent/50`）加圆点；**本周失效**虚线边、`opacity .55`，不用删除线。
- 显示名：yaml `name` > 内置字典中文名 > 数据源名（超过 24 字符 truncate，hover 显全名）。
- ≤768px 隐藏 sparkline 与 52 周列，徽标 `whitespace-nowrap`；≤640px 改为列表：第一行 名称 + 价格，第二行 所选涨跌周期，第三行 徽标；外层 `overflow-x-auto` 兜底，不允许横向溢出。
- 页脚只显示相对路径 `vault/hebi8.yaml`。
- 同步错误显示在该行；库为空时显示「首次拉取中…」并轮询。

### 5.2 图表 `/chart/[key]`（key 需 URL 编码，`yahoo:SPY → yahoo%3ASPY`，合成 `=BTC/GOLD → %3DBTC%2FGOLD`）

头部：← 总览 · **名称（可点，打开搜索）** · `n / N`（在自选里的位置，‹ › 可点）· 代码 · 源 · 币种 · 基准（显示别名或短名，不显示数据源长名）· 最新价 · 本周期涨跌 · 同步时间。

**键盘**：`←/→` 与 `j/k` 按总览顺序切上一只 / 下一只（跨分组循环，客户端路由，周期等全局偏好保持；下一只的 `/api/bars` 低优先级预取）；焦点不在输入框时敲字母 / 数字直接打开搜索并带入该字符（`j`、`k` 除外）；`Esc` 关闭任何内联面板（对比、公式编辑、参数编辑、笔记编辑态、画线工具）。

工具栏（控件统一 26px 高、12px 字、4px 圆角；按钮只有 primary 实心 / secondary 描边 / 纯文本三种；分段控件 `.seg`）：周期 `日 周 月 季` · K 线样式（自定义下拉，不用原生 `<select>`）· 对数（对比打开百分比坐标时禁用，旁边灰字「百分比坐标下不可用」）· 含分红 · 「对比 N」· 画线按钮组 `水平线 线段 射线 趋势线 斐波那契 文字 清除`（选中态高亮；图上角提示「水平线 · 在主图上点击 · Esc 退出」；画完自动退出）· 笔记 · 刷新。≤640px 时折成「周期分段 + 一个 ⋯ 菜单」，指标芯片一行横向滚动。

指标栏同 v1：芯片 26px 高，参数文字激活 `fg`、未激活 `muted`（不用 accent），参数编辑按周期保存，公式指标编辑。

**布局**：副图（指标、独立副图对比）每个固定 100px；图表容器的最小高度随副图数量增长（`max(520, (101 × 副图数 + 25) / 0.54)`），保证主图至少占 45%。主图 y 轴上方留白 `16 + 20 × (tooltip 行数 + 对比条数)` px（`overrideYAxis({ gap: { top } })`，≥1 按像素），让 OHLC / 均线 / 对比图例不压在 K 线上。画布字体：刻度与十字线用 mono 栈，tooltip 与标注用 sans 栈（`setStyles` 里设 `family`）。

**窄屏**：≤768px 笔记改为底部抽屉（`fixed bottom-0`，最高 60vh），默认关闭；宽屏有笔记时默认打开。

**对比（和 TradingView 一致的显示）**

- 「对比」按钮弹出输入框：可输别名、完整 key，或搜索（§5.4 的搜索接口）；添加后写入 `charts/<fileKey>.json`。
- `percent` 模式（默认）：主图叠加。主图 y 轴切到 KLineChart 的 `percentage`（`overrideYAxis({ paneId: "candle_pane", name: "percentage" })`；百分比轴与对数轴互斥，开对比时对数自动关闭，关掉所有对比后恢复）。每个对比标的是叠在 `candle_pane` 上的一个 indicator（`createIndicator({...}, true)`，`series: "price"`，一条线），值 = `mainClose[base] × cmpClose[i] / cmpClose[base]`，`base` 是**可见区间左边缘**那根（`getVisibleRange().realFrom`，若该处对比标的无数据则向右找第一根有数据的）。订阅 `subscribeAction("onVisibleRangeChange")`，去抖 ~80ms 后用 `overrideIndicator` 更新 base 重算——这样滚动、缩放时所有线都从左边缘重新归零，和 TV 的「同百分比坐标」行为一致。
- `pane` 模式：对比标的放独立副图（`series: "normal"`，画原始收盘价，自己的坐标轴），用于美债收益率这类单位不同的叠加。
- 图例（TV 风格）：主标的一行 `名称 O H L C 涨跌`；每个对比标的一行：颜色点 · 名称 · 当前（十字线处）数值与相对 base 的 % · 隐藏/显示 · 移除。优先用 KLineChart 自己的 tooltip：indicator 模板的 `createTooltipDataSource` 返回 `+12.3%` 这样的值，tooltip `features` 放眼睛和 × 图标，由 `onIndicatorTooltipFeatureClick` 处理；若实现不顺，用一个绝对定位的 React 图例覆盖在左上角，通过 `onCrosshairChange` 取十字线处的值。
- 调色板（明暗模式都可读，且不与 KLineChart 默认指标色 `#FF9600 #935EBD #2196F3 #E11D74 #01C5C4` 撞色）：`#0e9aa7 #c2410c #2f6fde #a21caf #65a30d #4b5563`，按添加顺序取；线宽 2px。青和锈色排在前面，常见的一两条对比不会和均线同色。
- 对比面板用全局搜索组件的 `pick` 模式（§5.4）：别名不区分大小写，自选 / 常用 / 搜索三段，Enter = 加入对比，加入后输入框清空；「主图叠加 / 独立副图」单选保留。`pane` 模式的图例同样显示相对可见区间起点的 %。

**画线**：KLineChart 内置 overlay。工具：水平线 `horizontalStraightLine`、线段 `segment`、射线 `rayLine`、趋势线 `straightLine`、斐波那契 `fibonacciLine`、文字 `simpleAnnotation`。画完 / 拖动结束 / 删除即序列化 `getOverlays()` 写回 `charts/<fileKey>.json`；加载时 `createOverlay` 恢复。**删除必须写回**：KLineChart 在把 overlay 从列表移除之前就调用 `onRemoved`，所以序列化时按 id 排除正在删除的那条。只保存主图（`candle_pane`）上的画线；在副图上点击会被丢弃并重新开始同一个工具（10.0.3 的 `paneId` 并不能把绘制钉在某个 pane）。提供「清除全部画线」。

**笔记**：右侧可收起侧栏，显示 `notes/<fileKey>.md` 的渲染结果，「编辑」切换 textarea，保存走 Server Action。没有笔记时显示「写下为什么看它」。

**数据流**：客户端组件请求 `GET /api/bars?key=&tf=&prices=&with=k1,k2`，`with` = 对比列表 ∪ 已开启公式指标的 `refs` ∪ bench；响应里带对齐好的 `refs`，公式模板通过闭包拿到。`tf`/`log`/`style`/指标开关/参数变化写回 yaml `chart:`（参数编辑去抖）。

### 5.3 复盘 `/review`

- 本周 journal：textarea 自动聚焦，**自动保存**（§5.6）；为空时填模板。
- 上周 journal：渲染展示。
- 本周变化：遍历 stats，列出所有 `prev != now` 的 (标的, 条件)，按组排列，用同一个 `Badge`（新触发 = 淡高亮，失效 = 虚线），点击进图表。
- 有笔记的标的：名称 + 笔记首行**纯文本**（`plainFirstLine`：跳过标题和分隔线，去掉强调、代码、链接、图片、列表与引用标记）。

### 5.4 全局搜索（找标的 / 切标的 / 加标的 / 对比，同一个组件 `SymbolSearch`）

**入口**：页头中间的搜索框（占位「搜索标的 · 按 /」）；任何页面焦点不在输入框时按 `/` 或 `Ctrl/Cmd+K`；图表页直接敲字母 / 数字（带入该字符）；图表页标题可点；总览「+ 添加」；对比面板（`pick` 模式，内联）。`Esc` 关闭。

**结果三段**（`role="combobox"` / `listbox` / `aria-activedescendant`，默认高亮第一行，↑↓ 移动，Enter 主动作，Tab 在高亮行的分组芯片间切换，鼠标点击 = Enter）：

1. 「使用 `<key>`」：输入本身是合法 key（`yahoo:XXX`、`binance:XXX`、`tv:EX:SYM`、`=A/B`）或别名（不区分大小写）时永远是第一行。
2. 「自选」：本地即时匹配，不区分大小写，匹配 name、ticker、key、yaml 别名、分组名、内置字典的中文名和拼音（全拼 / 首字母）；每行「名称 · 代码 · 分组」；Enter = 打开（图表页 = 客户端切换）。
3. 「常用」：yaml `aliases` 与内置字典里尚未在自选的条目；Enter = 添加并打开。
4. 「搜索」：外部结果，300ms 防抖（ASCII ≥2 字符，CJK ≥1）；状态「搜索中…」/「无结果，可直接输入 source:ticker 或 =表达式」；已在自选的行尾标「已在自选 · 分组」且 Enter = 打开。

**添加**（`navigate` 模式，行不在自选时）：行尾显示推断的分组芯片——`binance` / 加密类 → 加密；`.HK/.SS/.SZ` 或 `tv:SSE/SZSE/HKEX` → 港 A；`tv:TVC/FX_IDC/OANDA` 或 kind ∈ index/bond/commodity/forex/cfd/currency/economic → 宏观；`=` → 比价；其余 → 美股。按组名（含同义词）匹配 yaml 里现有的组，没有就落到第一个组；高亮行展开全部芯片 + 「新建分组…」（内联输入）。Enter = `addSymbol` 到该组 + 立即开图；名称写 yaml 时取字典中文名；若输入的是中文搜索词且添加成功，把「搜索词 → key」写进 `aliases`；成功 toast「已添加到 港 A · 撤销」（撤销 = `removeSymbol`）；已存在 → 直接打开。

**`pick` 模式**（对比面板）：主动作是「加入对比」，自选段也是；排除当前标的与已对比的 key。

**后端**（纯函数在 `src/lib/search.ts`，可测试；路由只做编排）：规范化 query → 合法 key 直接返回 → 本地层（在浏览器里跑：自选 + aliases + 字典 `src/lib/wellknown.ts`，约 65 条 `{ key, zh, en, aliases }`，拼音直接写在 aliases 里，不引入拼音库）→ 外部层并行：

- Binance：`/api/v3/ticker/price` 内存缓存 24h，取 `*USDT`，按币名前缀匹配，`<base>USDT` 完全匹配排最前。
- Yahoo：仅 ASCII 查询（含 CJK 直接抛 `Invalid Search Query`）；过滤 FUTURE / OPTION / MUTUALFUND；外地挂牌（`.TO/.DU/.F/.DE/.L/.MX…`，`.HK/.SS/.SZ` 除外）只在查询本身含 `.` 时保留；同一公司只留主上市。
- TradingView：查询含 CJK、或含 `:`、或 Yahoo 命中 < 3 时调用；含 `:` 时直接按交易所查，否则并行 `index`、`cfd`、`stock`（像收益率的查询再加 `bond`）各取前几条合并；丢 bond（除非查询像 `US10Y` / 收益率 / 国债）、structured、swap、dr、warrant、futures（除非查询含 `!` / 期货）、FINRA 等数据商序列；`<em>` 高亮去掉；大交易所的股票 / ETF 改写成 Yahoo key（`HKEX:700 → yahoo:0700.HK`、`SSE:600519 → yahoo:600519.SS`、`NASDAQ:AAPL → yahoo:AAPL`），`BINANCE:XXXUSDT → binance:XXXUSDT`。

排序：精确代码匹配 > 自选 > 字典 > 来源偏好（股票 yahoo > tv；币 binance > yahoo；宏观 / 指数 / 汇率 tv:TVC/HSI/FX_IDC/OANDA > yahoo）> 名称前缀 > 交易所白名单（TVC、HSI、SSE、SZSE、HKEX、NASDAQ、NYSE、BINANCE、FX_IDC、OANDA）> 其余按到达顺序。同一标的多源去重（`yahoo:BTC-USD` 与 `binance:BTCUSDT` 算同一个，币优先 binance）。返回 `{ key, name, exchange?, kind?, source, inWatchlist?, suggestedGroup }`，最多 12 条。

### 5.5 设置

不做单独页面。周期选择、涨跌色、图表偏好由各处 UI 写回 yaml；分组、名称、基准由总览行菜单写回；其余（同步时间、别名、条件）直接改 yaml，页面上给出 vault 相对路径提示。

### 5.6 自动保存（笔记与复盘日志）

`useAutosave`：输入停止 1s 后保存（Server Action）；`Ctrl/Cmd+S` 立即保存；保存中又有输入则保存完再发最新的；dirty 时 `beforeunload` 拦截；状态文字用 muted 色：「已保存 12:03」/「保存中…」/「未保存」/「保存失败：…」。localStorage 草稿兜底：key 含文件名（`hebi8:draft:notes/<fileKey>.md`、`hebi8:draft:journal/<week>.md`），每次输入写入，保存成功即清；打开时若有草稿、内容与文件不同且比文件的 mtime 新，横幅提示「有 12:03 的未保存草稿 · 恢复 / 丢弃」。笔记面板保留「编辑 / 完成」切换，没有保存按钮。

### 5.7 视觉规范（客观项）

- 次要文字最小 11px；浅色 `--green: #138a4b`（白底 ≥ 4.5:1），深色不变。
- 所有可聚焦元素统一 `:focus-visible` 2px accent 外框。
- 状态文字（已保存等）用 muted，不用 accent。
- 全站按钮：`.btn` 纯文本（hover 底色）、`.btn-primary`（实心 fg 底 + bg 字）、`.btn-secondary`（1px line 描边）；分段 `.seg`；输入 `.input`；徽标 `.badge`；菜单 `.menu`。

---

## 6. 接口

**Route Handlers（只读 JSON）**

- `GET /api/bars?key=&tf=D|W|M|Q&prices=split|total&with=k1,k2`
  → `{ symbol: {key, name, source, ticker, currency, bench, syncedAt, syncError}, pricePrecision, bars: [{timestamp, open, high, low, close, volume}], refs: { [key]: { c: (number|null)[], o?, h?, l?, v? } } }`，`refs` 与 `bars` 等长对齐。按 `synced_at` 生成 ETag。
- `GET /api/search?q=` → 外部结果 `SearchResult[]`（§5.4；本地层在浏览器里算）。

**Server Actions（写）**：`refresh()`、`addSymbol({ key, group, name?, bench?, alias? })`、`removeSymbol(key)`、`moveSymbol(key, group)`、`renameSymbol(key, name)`、`setBench(key, bench | null)`、`saveNote(key, body)`、`saveJournal(week, body)`、`saveIndicator(def)` / `deleteIndicator(id)`、`saveCondition(def)` / `deleteCondition(id)`、`saveChartState(key, state)`、`setChartPrefs(partial)`、`setPeriods(list)`、`setUpdown(mode)`。Server Action 在客户端是**串行派发**的，自动保存靠去抖合并，不并行发。

所有写入校验输入；文件路径只能落在 vault 内（fileKey 已保证无 `/`、`..`）；写入原子。

---

## 7. Next.js 用法（这版 Next 与训练数据不同，写代码前读 `node_modules/next/dist/docs/01-app/`）

必读：`01-getting-started/06-fetching-data.md`、`08-caching.md`、`09-revalidating.md`、`15-route-handlers.md`、`02-guides/server-actions.md`、`02-guides/instrumentation.md`、`03-api-reference/03-file-conventions/02-route-segment-config/`。

- 页面是 RSC，直接读 vault 与 SQLite，**必须是动态渲染**（按文档用 route segment config 或 `connection()`），否则 build 时会被静态预渲染成空页面。
- `params` / `searchParams` 是 Promise（v1 已经 `await searchParams`）。
- 交互部分（表格排序、图表、编辑器）是 client component；数据通过 props 从 RSC 下发，除了图表用 `/api/bars`。
- `next.config.ts` 的 `serverExternalPackages` 保留 `better-sqlite3`、`yahoo-finance2`、`@mathieuc/tradingview`。
- 涨跌色在 SSR 时从 yaml 读出写到 `<html data-updown>`，不再需要 head 里的 localStorage 脚本；localStorage 整体不再使用。

**KLineChart v10 已确认的 API**：`init(el, { locale, timezone: "UTC" })`、`setDataLoader`、`setSymbol`、`setPeriod`、`setStyles`、`overrideYAxis({ paneId, name: "normal" | "percentage" | "logarithm" })`、`createIndicator(create, isStack)`（pane 通过 `create.paneId`）、`overrideIndicator`、`removeIndicator`、`registerIndicator`、`createOverlay` / `getOverlays` / `removeOverlay` / `overrideOverlay`、`subscribeAction(type, cb)`（`onVisibleRangeChange`、`onCrosshairChange`、`onIndicatorTooltipFeatureClick` 等）、`getVisibleRange()`。

---

## 8. 实施顺序与验收

每个阶段结束：`npm test`、`npm run typecheck`、`npm run lint`、`npm run build` 全过，提交一次（conventional commit）。

**阶段 1 · 地基**（做完功能与 v1 持平，v1 的 8 个设计问题消失）
schema v2 + 迁移；`adj` 因子与 `prices` 模式；适配器 meta；应用内调度器；同步后计算 stats；vault（yaml/notes/journal/charts 的读写层 + `vault.example`）；RSC 总览分组表格（排序、徽标位先留空）；图表页迁移到 yaml 偏好；`/api/bars` v2；添加/移除标的；README 重写。
验收：`rm -rf data vault && npm run dev` 后首页能从 `vault.example` 起步、自动拉取、显示表格；图表页周/月/季线、对数、四种样式、内置与代码指标正常；`vault/hebi8.yaml` 注释在 UI 改动后仍保留。

**阶段 2 · 公式与对比**
公式引擎 v2（布尔、引用、新函数、`refs`）；合成标的；条件计算与徽标、本周变化；对比（percent / pane、图例、调色板）；公式指标编辑写回 yaml。
验收：`=BTC/GOLD` 能开图并有 stats；NVDA 对比 QQQ、SPY 在 percent 模式下滚动时从左边缘重新归零；US10Y 以 pane 模式叠在 SPY 上；条件徽标与「本周新触发」在总览上出现。

**阶段 3 · 复盘**
笔记侧栏；journal 与 `/review`；「上次复盘」；画线工具与持久化。
验收：周线上画的水平线切到日线还在，刷新后还在；`/review` 能写本周、看上周、列出本周变化。

**阶段 4 · 顺手**（可选）
搜索添加；`vault:check` 校验命令；宏观面板（FRED / ETF 流入）留空位不做。

**测试**：保留 v1 的 time/series/stats/formula 测试并按新接口调整；新增：公式 v2（布尔、引用、字符串）、合成表达式逐字段计算、季线合成、前向填充对齐、stats 的 `prev/now`、vault 解析与写回（注释保留、fileKey）、调度器下一时刻计算（含跨日与夏令时）。

---

## 9. 不做的事

登录鉴权（Tailscale 内网）；日内数据；推送告警（第八天打开就是提醒）；多用户；Pine Script 兼容；拖拽排序（改 yaml）。
