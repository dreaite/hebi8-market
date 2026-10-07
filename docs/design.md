# hebi8 market v2 设计

> hebi（蛇）首尾相衔，七天一个轮回；多出来的第八天，用来观测市场。

hebi8 是一个**周度复盘工具**，不是 TradingView 的替代品。每天收盘后自动拉日线；第八天打开时做三件事：

| 动作 | 页面 | 回答的问题 |
|---|---|---|
| 扫描 | `/` 总览：分组表格、条件徽标、本周变化 | 我关心的东西现在各处于什么状态？ |
| 深看 | `/chart/[key]` 图表：K 线、指标、对比、画线、笔记 | 值得细看的几个，结构是什么样？和别的比呢？ |
| 记录 | `/review` 复盘：本周日志、上周日志、本周变化汇总 | 上周怎么想的，这周怎么想？ |

约束：只在 Tailscale 内网；只存日线，周/月/季线读时合成；**读取永远不碰网络**。默认单用户、无登录；在 yaml 里设了 `owner` 之后，局域网里的几个人可以共用一台实例，每人用 GitHub 登录后看到自己的自选、画线、笔记和通知（§1.6）。

第八天之外只有两种打扰，都推到 Telegram 或 webhook：每次同步后，自己标了 `notify` 的条件**新成立**（§2.5）；以及价格警报，有警报的标的盘中每 5 分钟取一次最新价来判断（§2.6）。只存日线，不存日内 K 线。

本文是 v2 的实施规范。v1 的代码可以参考（`tradingDay`、公式引擎、指标目录、统计定义都保留），但不需要兼容：目录、schema、接口都按本文重做。

---

## 1. 数据：缓存与内容分开

**一句话心智模型：`vault/` 是我的，`data/hebi8.db` 是缓存，删了会自动重建。**

```
data/hebi8.db                 SQLite 缓存：bars、symbols 元数据与同步状态、stats、告警状态
data/datasets/<name>/         自定义数据集仓库的浅克隆（§2.4），删了下次同步重新克隆
vault/                        用户内容，gitignore；HEBI8_VAULT 环境变量可改位置
  hebi8.yaml                  自选分组、别名、公式指标、条件、同步时间表、图表偏好；owner 的
  notes/<fileKey>.md          每个标的的笔记（thesis）
  journal/<YYYY>-W<ww>.md     每周复盘（ISO 周）
  charts/<fileKey>.json       每个标的的图表状态：对比列表、画线
  users/<login>/              共用实例里其他人的 vault（§1.6），结构同上，没有实例级设置
vault.example/hebi8.yaml      首次运行时若 vault/ 不存在，复制为 vault/hebi8.yaml
```

### 1.1 `hebi8.yaml`

```yaml
owner: [dreaife, dreaifekks]   # 可省；写了就是共用实例，这些 GitHub 账号共用根 vault（§1.6），也可以只写一个字符串
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
  GPU4090: data:gpu/4090-xianyu

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
  - { id: new_high, label: 新高, formula: "close >= highest(close, 52)", notify: true }   # notify：新成立时推送（§2.5）
  - { id: rs_high, label: RS新高, formula: "rs = close / close(bench); rs >= highest(rs, 26)" }
  - { id: below_200w, label: 破200周, formula: "close < sma(close, 200)", notify: true }

alerts:                        # 价格警报（§2.6）；图表上建的写成第一种，也可以手写公式
  - { key: BTC, cond: crossing_up, value: 130000, trigger: once }            # BTC 上穿 130,000，仅一次
  - { key: SPY, cond: entering, value: [500, 520], trigger: bar }            # 进入通道，每根 K 线一次
  - { key: NVDA, label: 跌破 200 日线, when: "close < sma(close, 200)" }   # 自定义公式；tf 默认 D
  - { key: GPU4090, label: 4090 咸鱼跌破 1.1 万, cond: less, value: 11000, enabled: false }  # 暂停中

datasets:                      # 自定义数据集（§2.4）：名字 → git 地址或本机目录
  gpu: https://github.com/dreaife/gpu-prices

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
- `key` 格式：`yahoo:AAPL`、`yahoo:0700.HK`、`yahoo:^GSPC`、`binance:BTCUSDT`、`tv:TVC:US10Y`、`tv:FX_IDC:USDCNH`、`data:gpu/4090-xianyu`，或 `=表达式`。`data:` 的 key 区分大小写，在合成表达式和 `close(...)` 里要用别名或带引号。
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
  vault TEXT NOT NULL,                      -- §1.6：'' 是根 vault，其他是 GitHub login（小写）
  key TEXT NOT NULL,                        -- 含合成标的
  computed_at INTEGER NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY (vault, key)                  -- 按 vault 存：条件、prices 模式都是各人的
);
CREATE TABLE alert_state (                  -- §2.5；删库后第一次同步只记录、不推送
  vault TEXT NOT NULL,
  rule TEXT NOT NULL, key TEXT NOT NULL,    -- rule：cond:<id> 或 alert:<hash>
  state INTEGER,                            -- 上次同步看到的结果 0/1
  fired_bar INTEGER,                        -- 上次推送时那根 K 线的 t，同一根只推一次
  fired_at INTEGER,
  PRIMARY KEY (vault, rule, key)
) WITHOUT ROWID;
CREATE TABLE quotes (                       -- §2.6：盘中轮询拿到的最新价，所有人共用；不是 K 线
  key TEXT PRIMARY KEY,
  price REAL NOT NULL, time INTEGER NOT NULL,          -- 数据源报的成交时间（unix 秒）
  day_high REAL, day_low REAL,                          -- 当天的高低，有就记
  session TEXT NOT NULL,                                -- open | closed | pre | post | always
  fetched_at INTEGER NOT NULL
);
```

`symbols` 和 `bars` 里只有缓存和元数据，**没有任何用户字段**（名字、分组、基准、排序都在 yaml），所有人共用；`stats` 和 `alert_state` 按 vault 分开。两表加 `vault` 列的迁移直接删表重建，下次同步重算。

### 1.5 用户配置目录（`HEBI8_SECRETS`，默认 `~/.config/hebi8/market`，目录 700、文件 600）

不在 vault、不在 data、不进 git：`sessions.json`（GitHub 登录，§5.8）、`notify.json`（实例的通知设置，§2.5）、`notify-users.json`（每个人绑定的通道，§2.5）。

### 1.6 多人共用一台实例

局域网里几个人共用一台 hebi8：K 线缓存、同步、数据集是共享的；**自选、别名、公式指标、条件、告警、图表偏好、笔记、复盘、画线和通知都是各人的**。

**开关**：根 vault 的 `hebi8.yaml` 写 `owner: <GitHub login>`，或者一个列表 `owner: [dreaife, dreaifekks]`（同一个人的几个账号）。列表里任何一个账号登录都用根 vault，页面上称呼第一个。没写就是单用户模式，行为和现在完全一样（不用登录，谁都能改根 vault）。

**命名**：`hebi8` 以后是一组东西的总名，这个应用对外叫 **hebi8/market**（页面标题、通知标题、Telegram 确认消息、webhook 的 `Title` 头），不能带斜杠的地方用 **hebi8m**（会话 cookie `hebi8m_session`、日志前缀 `[hebi8m]`）。cookie 不分端口，同一台机器上别的 hebi8 应用不会和它抢；配置目录也放在 `~/.config/hebi8/market/` 下。

**谁看哪个 vault**（每个请求从 `hebi8m_session` cookie 解析出 viewer，`src/lib/viewer.ts`）：

| 访问者 | 看到 | 能改 |
|---|---|---|
| 单用户模式，任何人 | 根 vault | 根 vault |
| owner 登录 | 根 vault | 根 vault，含实例设置 |
| 其他人登录 | `vault/users/<login>/` | 自己的 vault |
| 未登录 | 根 vault 的总览和图表（含画线） | 不能改；笔记、复盘页提示「登录后看自己的」 |

- login 一律转小写作为目录名和 `vault` 列的值（GitHub login 只有字母数字和 `-`，大小写不敏感）。根 vault 的 `vault` 值是 `''`。
- **实例级设置只认根 vault**：`owner`、`sync`、`datasets`。用户 yaml 里写了也忽略（页面上提示一次）。
- **第一次登录**的非 owner：复制根 vault 的 `hebi8.yaml` 作为起点，去掉 `owner`、`sync`、`datasets`、`alerts`；notes / journal / charts 为空。之后两边互不影响。
- **所有写操作**（Server Actions、写文件的 Route Handler）都先取 viewer，`canWrite` 为假就返回「请先登录」；写入路径只来自 viewer 的 vault 目录，不接受客户端传来的目录或 login。读操作同样只读 viewer 的 vault。
- **同步**：要同步的 key 是所有 vault 的并集（各自的 groups、bench、公式引用、告警、charts 对比列表）。同步后对每个 vault 算一遍 stats 和告警。
- **页头**：右侧显示当前身份。未登录是「登录」按钮（打开帮助抽屉里同一套 device flow）；登录后是头像 + login，菜单里有「通知设置」和「退出」。owner 模式下未登录时，总览顶部一行 muted 文字「正在看 <owner> 的列表 · 登录后用自己的」。
- 登录会话和反馈共用（§5.8），30 天有效；退出只删会话，不动 vault。

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
| `data` | 数据集仓库里的 CSV（§2.4） | 1 | 全量 replace | 列出 yaml 里各数据集清单中的序列 | 日期直接是 UTC 零点，不经 `tradingDay` |

- 时间戳 → 交易日的映射沿用 v1 的 `tradingDay(tsSec, timeZone)`（+12h 后取交易所时区的日期）和 `tests/time.test.ts`，原样保留。各源的约定：美股记在开盘 13:30 UTC，亚洲记在 01:30 UTC，FX/TVC 记在前一晚的开盘。
- 已知数据事实：现库 12 个标的 73,543 根日线；`tv:TVC:US10Y` 2013 年以前没有周一的数据（源本身缺），周线合成能正常处理。

### 2.2 调度器（应用内，不依赖 systemd timer）

- `src/instrumentation.ts` 导出 `register()`，仅在 `process.env.NEXT_RUNTIME === "nodejs"` 时启动调度；用 `globalThis` 守卫防止 dev 模式重复启动。
- 按 `sync.at × sync.tz` 算下一个时刻（用 `Intl.DateTimeFormat` 处理时区与夏令时，不引入日期库），`setTimeout` 链式调度。
- 启动时：若 `max(symbols.synced_at)` 早于最近一个已过去的时刻，延迟 5s 后补跑一次（等价 systemd 的 `Persistent=true`）。
- 日志打到 stdout（journalctl 能看）。

### 2.3 `syncAll(force?)` / `syncOne(key, force?)`

- 要同步的 key 集合 = groups 里的 + 所有 `bench` + 公式/条件/告警/合成表达式/各 `charts/*.json` 对比列表引用到的；共用实例时取所有 vault 的并集（§1.6）。别名本身不触发同步。
- 并发 4，同 key 去重，单个失败不影响其他；失败写 `sync_error`，页面上显示。
- 同步完成后立刻对**每个标的（含合成）**计算 `stats` 并写表（§3.4）。
- 读取路径（页面、API）**只读库**。首次运行库为空时，总览显示「首次拉取中…」并每 3s 刷新一次，同时后台触发 `syncAll`。
- 「刷新」按钮是 Server Action：`await syncAll(true)` 后 `revalidatePath`，按钮期间显示 pending（手动动作，阻塞 3–30s 可以接受）。
- 新增标的时立即 `syncOne(key, true)`，失败则不写入 yaml 并报错（首次拉取兼做校验）。
- `syncAll` 算完 stats 后跑一次通知（§2.5）；`syncOne` 不通知。

### 2.4 自定义数据集（`data` 源）

任何按约定放日线 CSV 的 git 仓库或本机目录都是一个数据源，比如爬虫每天推送的显卡二手价。**hebi8 只读，不爬。** 仓库就是两边的契约。

```yaml
# 仓库根目录 hebi8-dataset.yaml
name: 显卡二手与零售价
series:
  - { id: 4090-xianyu, name: RTX 4090 咸鱼, currency: CNY, file: series/4090-xianyu.csv }
  - { id: 4090-jd,     name: RTX 4090 京东, currency: CNY, file: series/4090-jd.csv }
```

```csv
date,open,high,low,close,volume
2026-10-05,,15800,11200,12900,184
2026-10-06,,15500,11000,12650,171
```

- key：`data:<数据集>/<序列 id>`。数据集名在 yaml 的 `datasets` 里映射到地址，key 里不写地址，仓库搬家不影响图表和笔记。数据集名和序列 id 只能用 `[A-Za-z0-9._-]`，并以字母或数字开头。
- 地址是 `https://`、`git@`、`ssh://`、`file://` 时浅克隆到 `data/datasets/<name>/`，之后每次同步 `git fetch --depth 1` 再 `reset --hard`；私有仓库直接用机器上的 SSH key。以 `/`、`~/`、`./`、`../` 开头时当本机目录直接读，相对路径相对于 vault 目录。同一次同步里一个数据集只拉一次。
- CSV：表头必须有 `date` 和 `close`，其余列可选、可留空。`open` 空时用 `close`；`high`/`low` 空时取 `open`/`close` 的较大/较小值；`volume` 空为 null。`date` 是 `YYYY-MM-DD`，映射到当天 UTC 零点。同一天出现两次取后一行；空行和 `#` 开头的行跳过。格式错误报行号，只记在这个标的上。
- 元数据：`name`、`currency` 来自清单，`exchange` 是清单的 `name`，`kind` 是 `dataset`。
- 比价数据的用法建议：`close` 放当天中位价，`high`/`low` 放区间，`volume` 放有效挂单数。

### 2.5 同步后通知

只在 `syncAll` 收尾、stats 写完之后跑。**规则**有两种：

- `conditions` 里带 `notify: true` 的条件，对每个自选标的（含合成）求值，tf 同条件。
- `alerts` 里的价位规则：`{ key, when, label?, tf? }`，只对这一个标的求值，tf 默认 D。`when` 就是条件公式，能用别名、`close(X)`、`bench`。

**判定**：每条规则、每个标的在 `alert_state` 里记上次同步看到的布尔值。

1. 第一次见到（新规则、新标的、删过库）：只记录，不推送。
2. 这次为真、上次不为真、且最后一根 K 线的 `t` 不等于 `fired_bar`：推送，`fired_bar` 记成这根的 `t`。周线条件在本周反复真假时只推一次。
3. 结果为 null（数据不够、公式出错）：不改状态。

**按人**：每个 vault 各自判定、各自投递，状态表按 `vault` 分开。

**投递**：一个 vault 一次同步的所有事件合成一条纯文本摘要，同时发到这个人的每个通道；有一个通道成功就提交状态，全部失败则不提交，下次同步再试。没有配置通道时只打日志、照常提交。

```json
{
  "telegram": { "token": "123:abc", "chat": "123456789", "api": "https://api.telegram.org" },
  "webhook": { "url": "https://ntfy.sh/hebi8-xxxx", "format": "text" },
  "link": "http://100.92.194.31:8808"
}
```

- `notify.json` 是**实例**的设置，由部署的人手写：bot 的 `token`、`api`，以及 `link`。其中 `telegram.chat` 和 `webhook` 是根 vault（单用户模式或 owner）的通道，和以前兼容。
- owner 有几个账号时，根 vault 的通道记在第一个 owner 名下，用哪个账号登录绑定都是同一份。
- 其他人的通道在 `notify-users.json`：`{ "<login>": { "telegram": { "chat": "..." }, "webhook": { "url": "...", "format": "text" } } }`，由页面写入（原子写、600），不手改。owner 也可以在页面上绑定，写进这里时优先于 `notify.json` 里的 chat / webhook。
- `telegram.api` 可省，指向自建 Bot API 服务时改它。
- `webhook.format`：`text`（默认，正文就是摘要，带 `Title` 头，适合 ntfy）或 `json`（`{ title, text, events }`）。
- `link` 可省；有的话每条事件后面带图表页链接。
- `npm run notify:test` 往 `notify.json` 里的通道发一条测试消息。
- **owner 在页面上设置 bot**：「通知」页签里，owner（单用户模式下是任何人）多一块「实例的 Telegram bot」：显示「未配置」或 `@<bot 用户名>`；粘贴 token 后服务端先用 `getMe` 校验，通过才写进 `notify.json`（保留文件里的其他字段，原子写、600），「移除」删掉 telegram 段。token 写进去以后不再回显，只显示 bot 用户名。接口 `PUT /api/notify/bot`、`DELETE /api/notify/bot`，非 owner 返回 403。

**通知设置页面**（登录后，页头菜单「通知设置」打开帮助抽屉的「通知」页签；未登录或单用户模式下页签提示改 `notify.json`）：

- **绑定 Telegram**：服务端生成一次性码（10 分钟有效，内存里），用 `getMe` 拿 bot 用户名，返回 `https://t.me/<bot>?start=<码>`；面板显示「打开 Telegram 点 Start」和等待状态。有待绑定的码时，服务端用 `getUpdates` 长轮询（timeout 25 秒，只往外连）读 bot 收到的消息；私聊里收到 `/start <码>` 就把这个 chat id 记到对应 login，回一句「已绑定 hebi8：<login>」，确认 update 的 offset。没有待绑定的码时不轮询。
- 实例的 bot 必须是 hebi8 专用的：同一个 token 被别的程序（比如 Hermes 网关）`getUpdates` 时两边会抢消息。
- **webhook**：输入地址和格式，保存前校验 http(s)。
- **发测试消息**、**解除绑定**。状态行显示已绑定的通道（chat id 只显示后 4 位，webhook 只显示主机名）。
- 接口：`GET /api/notify`（当前 viewer 的通道摘要）、`POST /api/notify/telegram`（开始绑定，返回链接）、`POST /api/notify/telegram/poll`（查绑定结果）、`PUT /api/notify/webhook`、`DELETE /api/notify/<channel>`、`POST /api/notify/test`。都要求登录，只作用于 viewer 自己。

### 2.6 价格警报与盘中轮询

照搬 TradingView 的警报模型，但只看日线：判断时把最新价当作今天这根还没收完的日线（股票按交易所当地日期归日，加密按 UTC 日，跨夜品种按交易时段归日）（`o` 是当天第一个价，`h`/`l` 取轮询见过的最高最低和数据源报的日内高低，`c` 是最新价），接在库里的日线后面。**这根 K 线只在内存里，绝不写进 `bars`**；下一次日线同步拿到真正的日线后自然替换。

**警报的写法**（`alerts` 里每一项二选一）：

| 字段 | 说明 |
|---|---|
| `key` | 标的（别名或完整 key，合成标的也行） |
| `cond` + `value` | 图表上建的结构化条件，见下表 |
| `when` | 自定义公式（布尔），和条件公式一样；`tf` 默认 D |
| `trigger` | `once`（仅一次，默认）或 `bar`（每根 K 线一次） |
| `label` | 可省，省了按条件自动生成，比如「BTC 上穿 130,000」 |
| `enabled` | 可省，默认 true；`false` 是已停止 |
| `id` | 可省，见 §2.5 |

| `cond` | TradingView 叫法 | `value` | 类型 |
|---|---|---|---|
| `crossing` | 穿过 | 价格 | 事件 |
| `crossing_up` / `crossing_down` | 上穿 / 下穿 | 价格 | 事件 |
| `greater` / `less` | 大于 / 小于 | 价格 | 状态 |
| `entering` / `exiting` | 进入通道 / 离开通道 | `[低, 高]` | 事件 |
| `inside` / `outside` | 在通道内 / 在通道外 | `[低, 高]` | 状态 |
| `moving_up_pct` / `moving_down_pct` | 上涨 % / 下跌 % | `{ pct, bars }`：最近 `bars` 根日线内涨跌超过 `pct`% | 状态 |

- **事件**类比较的是相邻两次检查，定义和公式的 `cross()` 一样严格：上穿是这次 > 线、上次 ≤ 线；下穿是这次 < 线、上次 ≥ 线；穿过是二者之一。进入通道是这次严格在通道内（低 < 价 < 高）、上次不是；离开通道是这次严格在通道外（价 < 低 或 价 > 高）、上次不是。停在线上或通道边上什么都不触发。第一次检查只记录，不触发。
- **状态**类只要条件成立就触发；新建的警报如果当时已经成立，第一次检查就会触发，和 TradingView 一样。
- **`when` 公式**沿用 §2.5 的「新成立才推送」，所以 `close > X` 的效果接近上穿；要明确的上穿下穿可以写 `cross(close, X)` / `cross(X, close)`。
- **触发方式**：`once` 触发后把这条警报写成 `enabled: false`（写回对应的人的 yaml，注释保留），列表里显示「已触发」；`bar` 同一根日线最多触发一次（`alert_state.fired_bar`）。
  已触发的 `once` 手改 yaml 的 `enabled: true` 不会重新启用；重新启用请用界面上的恢复。
- 状态记在 `alert_state`（§1.4），事件类的上一次结果也在这里。

**谁被轮询**：所有 vault 里 `enabled` 的警报的标的，加上 `when` 公式引用到的标的；合成标的展开成操作数；`data:` 标的只有日线，不轮询，跟着日线同步判断。

**节奏**（`src/lib/quotes.ts` 的轮询器，和调度器一样从 `instrumentation` 启动、`globalThis` 防重复）：每 5 分钟醒一次，每个标的按上一次拿到的 `session` 决定这次要不要取：

- `always`（加密）和 `open`（交易所在常规交易时段）：每 5 分钟。
- `pre` / `post` / `closed`：每小时。
- 新加进来的标的立刻取一次。连续失败的源退避到每小时，日志里记一次，不刷屏。
- 同一个源的标的一次批量请求：Yahoo 用 `quote()`，Binance 用 `/api/v3/ticker/24hr?symbols=…`，TradingView 用库的 quote 会话（一轮开一个客户端，取完就关）。源报不出交易时段时，工作日按 `open`、周末按 `closed`。

**适配器接口**加一个可选方法：

```ts
interface Quote { price: number; time: number; dayHigh?: number; dayLow?: number; session: "open" | "closed" | "pre" | "post" | "always" }
interface SourceAdapter {
  // …
  quotes?(tickers: string[]): Promise<Record<string, Quote>>;
}
```

**每轮之后**：最新价写 `quotes` 表，然后对每个 vault 判断它的警报，事件按 vault 合成一条摘要投递（§2.5 的投递规则：全部通道失败不提交，下一轮再试）。日线同步收尾时也照常判断一遍，用的是真实日线。

**页面读 `quotes`**，不碰网络：图表上的警报线、警报列表里的「当前价 · 3 分钟前」都从这张表来。

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
  conditions: { [id]: { now: boolean | null, prev: boolean | null, t?: number } }  // 最后一根周线、上一根周线；t 是最后一根的时间
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

**用在三处**：图表指标（客户端，KLineChart 模板）、总览条件（服务端，同步时按周线）、对比（客户端）。引擎是纯 TS，没有环境依赖。

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

**原则：照搬 TradingView 的操作模型。** 有 TV 肌肉记忆的人不用学；界面文字尽量用 TV 中文版的说法（指标、比较商品、自选列表、十字光标……）。页面占满页头以下的视口（`height: calc(100dvh - var(--site-header-h))`），最小高度随副图数量增长（见下文布局）。

**布局（TV 桌面版）**

- **顶部工具栏**（一行，38px，按钮 30px 热区，组间 1px 竖分隔线）：`‹ 总览` · **商品按钮**（放大镜 + 代码 + 名称，点开全局搜索换标的）· `+` **比较商品** · 周期快捷按钮 `日 周 月 季` · **图表类型**（图标 + 下拉：实心 K 线 / 空心阳线 / 美国线 / 面积）· `fx 指标` · ……右端 **刷新**（tooltip 显示同步时间，加载时图标转动）· **全屏**（`document.documentElement.requestFullscreen()`，全屏时隐藏站点页头，弹窗和搜索浮层照常可用）。
- **左侧画线工具栏**（42px 竖条，图标按钮，tooltip「名称 · 快捷键」）：十字光标（= 退出画线）· 趋势线 `segment` · 射线 `rayLine` · 延长线 `straightLine` · 水平线 `horizontalStraightLine` · 水平射线 `horizontalRayLine` · 垂直线 `verticalStraightLine` · 斐波那契回撤 `fibonacciLine` · 文字 `simpleAnnotation` ｜ 磁铁模式（overlay `mode: weak_magnet`）· 锁定所有绘图 · 隐藏所有绘图 · 删除所有绘图（确认）。当前工具高亮；画完一条自动回到十字光标（TV 默认）；开始画线时若「隐藏所有绘图」开着会先显示出来。磁铁 / 锁定 / 隐藏是纯界面偏好，存 localStorage（`hebi8:chart:drawing`），作用于所有画线和之后新画的。
- **图内图例（左上角，TV 样式，React 覆盖层 `ChartLegend`）**：第一行 `名称 周期 · 源 · 币种 · 基准` + `开 高 低 收` + 涨跌（相对上一根收盘，十字线处或最后一根）；然后每个百分比对比一行、每个主图指标一行（名称 + 参数 + 各条线的值，颜色同线）；副图指标 / 新窗格对比的行放在各自窗格左上角（`chart.getSize(paneId).top`）。行上悬停（鼠标指针事件，不用 CSS `:hover`，触屏上点一下）出现 **眼睛**（隐藏 / 显示，会话内）· **设置**（内置指标 = 参数弹窗，按当前周期保存；公式指标 = 公式编辑器）· **×**（移除）；双击行 = 设置。KLineChart 自己的蜡烛与指标 tooltip 关闭（`showRule: "none"`），数值由 `indicator.result` 和图形样式按 KLineChart 同样的规则取（线色按 `lines[i]`，柱按 `figure.styles` 动态色）。
- **右侧边栏**：最右 42px 图标条（自选列表 · 笔记），面板 280px，同一时间只开一个，上次打开的记在 localStorage（`hebi8:chart:panel`；没记过时有笔记就默认开笔记）。**自选列表**按 yaml 分组，每行名称 · 最新价 · 总览第一个周期的涨跌（`stats`），当前标的高亮，点击客户端切换（偏好不变）。**笔记**即原来的笔记面板。
- **底部栏**（32px）：左边日期范围 `1年 3年 5年 10年 全部`——按当前周期算出这段有多少根，`setBarSpace(可用宽度 / 根数)` 后 `scrollToRealTime()`；若每根不足 1px（例如日线 10 年），像 TV 一样自动升到下一个周期（日 → 周 → 月）再适配。右边 `ADJ`（含分红，总回报）· `%`（百分比坐标，localStorage）· `log` · `自动`（重新启用价格轴自动缩放；拖动价格轴后它会熄灭）。`%` 与 `log` 互斥；有百分比对比时 `%` 显示为按下且锁定，tooltip「比较模式下使用百分比坐标」，`log` 禁用。
- **窄屏（≤768px，TV 移动版）**：顶部工具栏一行横向滚动；左侧画线栏隐藏，改为顶栏里的「画线」下拉（工具 + 磁铁 / 锁定 / 隐藏 / 删除）；右侧图标条隐藏，自选 / 笔记按钮进顶栏，面板变成底部抽屉（60vh，默认关闭）；底部栏仍是一行。390px 宽无横向溢出。下拉菜单用 `position: fixed` 按按钮位置弹出，不被滚动的工具栏裁掉。

**快捷键（TV 默认；焦点在输入框里时不响应，`Esc` 除外）**

| 键 | 作用 |
|---|---|
| 字母 / 数字 | 打开搜索并带入该字符（换标的） |
| `/`、`Ctrl/Cmd+K` | 打开搜索 |
| `Alt+T` / `Alt+H` / `Alt+J` / `Alt+V` / `Alt+F` | 趋势线 / 水平线 / 水平射线 / 垂直线 / 斐波那契回撤 |
| `Esc` | 退出画线、关闭弹窗和菜单 |
| `Delete` / `Backspace` | 删除选中的画线（KLineChart `onSelected` / `onDeselected` 跟踪选中）；右键画线弹出「删除」菜单（TV 样式，不再右键直接删） |
| `Alt+R` | 重置图表：回到最新、默认缩放、价格轴自动 |
| `←` / `→` | 向更早 / 更新滚动可见宽度的 10% |
| `↑` / `↓` | 放大 / 缩小 |
| `Space` / `Shift+Space` | 自选列表下一只 / 上一只（跨分组循环，客户端路由；下一只的 `/api/bars` 低优先级预取） |

KLineChart 自带的 `Shift+←/→` 滚动和 `Shift+= / -` 缩放保留。

**弹窗**

- **指标**（TV「指标、度量和策略」）：顶部搜索框（同时搜内置与公式），左栏分类「内置 / 我的公式」，列表点一下添加，已添加的打勾、再点移除；需要基准而标的没有 `bench` 的灰掉。「我的公式」里每行有编辑按钮，末尾「新建公式」，都在弹窗内打开公式编辑器。开关照旧写回 yaml `chart.indicators`。
- **设置**（图例齿轮）：参数输入框（逗号分隔，聚焦全选），说明「只对周线生效」，恢复默认 / 取消 / 确定；参数按周期写回 `chart.params`（去抖）。
- **比较商品**：见下文对比。

**布局细节**：副图（指标、新窗格对比）每个固定 100px，指标窗格排在对比窗格上面（`setPaneOptions({ order })`）；图表最小高度 `max(520, (101 × 副图数 + 25) / 0.54)`，保证主图至少占 45%。主图上方留给图例的空白 = 图例实测高度 + 12px：KLineChart 的 `gap.top` 是把值域按比例放大（像素值先除以窗格高度），实际留白会偏小，所以按 `top = px × (1 + bottom) / (H − px)` 反解成比例传入，窗格高度变化时重算（仅在自动缩放时）。画布字体：刻度与十字线 mono，标注 sans。

**对比（和 TradingView 一致的显示）**

- 顶栏 `+` 打开「比较商品」弹窗：可输别名、完整 key，或搜索（§5.4 的搜索接口）；高亮行上两个按钮「同百分比坐标」（Enter，默认）/「新窗格」，和 TV 一样；下方列出已添加的对比，可移除。添加后写入 `charts/<fileKey>.json`。
- `percent` 模式（默认）：主图叠加。主图 y 轴切到 KLineChart 的 `percentage`（`overrideYAxis({ paneId: "candle_pane", name: "percentage" })`；百分比轴与对数轴互斥，开对比时对数自动关闭，关掉所有对比后恢复）。每个对比标的是叠在 `candle_pane` 上的一个 indicator（`createIndicator({...}, true)`，`series: "price"`，一条线），值 = `mainClose[base] × cmpClose[i] / cmpClose[base]`，`base` 是**可见区间左边缘**那根（`getVisibleRange().realFrom`，若该处对比标的无数据则向右找第一根有数据的）。订阅 `subscribeAction("onVisibleRangeChange")`，去抖 ~80ms 后用 `overrideIndicator` 更新 base 重算——这样滚动、缩放时所有线都从左边缘重新归零，和 TV 的「同百分比坐标」行为一致。
- `pane` 模式：对比标的放独立副图（`series: "normal"`，画原始收盘价，自己的坐标轴），用于美债收益率这类单位不同的叠加。
- 图例：每个对比标的一行（名称用线的颜色）· 十字线处的收盘价 · 相对 base 的 %；悬停出现眼睛（隐藏 / 显示）和 ×（移除）。百分比对比在主图图例里，新窗格对比在自己窗格的左上角。
- 调色板（明暗模式都可读，且不与 KLineChart 默认指标色 `#FF9600 #935EBD #2196F3 #E11D74 #01C5C4` 撞色）：`#0e9aa7 #c2410c #2f6fde #a21caf #65a30d #4b5563`，按添加顺序取；线宽 2px。青和锈色排在前面，常见的一两条对比不会和均线同色。
- 比较商品弹窗用全局搜索组件的 `pick` 模式（§5.4，`pickActions` 给出两个按钮）：别名不区分大小写，自选 / 常用 / 搜索三段，Enter = 同百分比坐标，加入后输入框清空。`pane` 模式的图例同样显示相对可见区间起点的 %。

**画线**：KLineChart 内置 overlay，工具见左侧画线栏（TV 的「趋势线」是有限线段，对应 `segment`；无限延伸的 `straightLine` 叫「延长线」）。画完 / 拖动结束 / 删除即序列化 `getOverlays()` 写回 `charts/<fileKey>.json`；加载时 `createOverlay` 恢复。**删除必须写回**：KLineChart 在把 overlay 从列表移除之前就调用 `onRemoved`，所以序列化时按 id 排除正在删除的那条。只保存主图（`candle_pane`）上的画线；在副图上点击会被丢弃并重新开始同一个工具（10.0.3 的 `paneId` 并不能把绘制钉在某个 pane）。「锁定所有绘图」是界面模式，不写进每条画线的 `lock`。

**警报**（TV 的「警报」，§2.6）：

- **入口**：顶栏闹钟按钮「警报」和 `Alt+A`，价格默认填最新价；在主图上右键出现「在 12,345.00 添加警报」（十字线所在价格）；选中水平线 / 水平射线后，浮动工具条多一个闹钟按钮，价格取这条线的价格（只是复制价格，之后挪线不会改警报）。
- **对话框**（「新建警报」/「编辑警报」）：第一行是标的（当前图表，不可改）；「条件」下拉是 §2.6 表里的九种叫法加「自定义公式」；值的输入随条件变化（一个价格 / 通道的上下沿 / 百分比和 K 线数 / 公式编辑器）；「触发」分段「仅一次 | 每根 K 线一次」；「名称」占位是自动生成的名字。底部「取消」「创建」。数值输入框聚焦全选，回车提交。
- **图上的警报线**：当前标的每条启用的价格类警报画一条虚线（通道画两条），右端价格轴上有闹钟标签；点标签打开编辑。已停止的不画。
- **警报列表**：右侧边栏在「自选」「笔记」旁边多一个「警报」页签，列出当前 vault 的全部警报：标的名、条件、触发方式、状态（活动 / 已触发 / 已停止）、当前价和取价时间；每行有「编辑」「暂停 / 恢复」「删除」，点行打开那个标的的图表。
- **写回**：Server Actions `saveAlert(def)`、`deleteAlert(id)`、`setAlertEnabled(id, enabled)`，和别的写操作一样先过 viewer 写权限，写当前 viewer 的 yaml，注释保留。只读访客看到入口，点开是登录提示。

**笔记**：右侧边栏的「笔记」面板，显示 `notes/<fileKey>.md` 的渲染结果，「编辑」切换 textarea，自动保存走 Server Action。没有笔记时显示「写下为什么看它」。

**数据流**：客户端组件请求 `GET /api/bars?key=&tf=&prices=&with=k1,k2`，`with` = 对比列表 ∪ 已开启公式指标的 `refs` ∪ bench；响应里带对齐好的 `refs`，公式模板通过闭包拿到。`tf`/`log`/`style`/指标开关/参数变化写回 yaml `chart:`（参数编辑去抖），`ADJ` 写回 `prices`；`%` 坐标、画线模式、侧栏面板只存 localStorage。图例的眼睛（隐藏指标 / 对比）只在当前页面有效。

### 5.3 复盘 `/review`

- 本周 journal：textarea 自动聚焦，**自动保存**（§5.6）；为空时填模板。
- 上周 journal：渲染展示。
- 本周变化：遍历 stats，列出所有 `prev != now` 的 (标的, 条件)，按组排列，用同一个 `Badge`（新触发 = 淡高亮，失效 = 虚线），点击进图表。
- 有笔记的标的：名称 + 笔记首行**纯文本**（`plainFirstLine`：跳过标题和分隔线，去掉强调、代码、链接、图片、列表与引用标记）。

### 5.4 全局搜索（找标的 / 切标的 / 加标的 / 对比，同一个组件 `SymbolSearch`）

**入口**：页头中间的搜索框（占位「搜索标的 · 按 /」）；任何页面焦点不在输入框时按 `/` 或 `Ctrl/Cmd+K`；图表页直接敲字母 / 数字（带入该字符）；图表页顶栏的商品按钮；总览「+ 添加」；比较商品弹窗（`pick` 模式）。`Esc` 关闭。

**结果三段**（`role="combobox"` / `listbox` / `aria-activedescendant`，默认高亮第一行，↑↓ 移动，Enter 主动作，Tab 在高亮行的分组芯片间切换，鼠标点击 = Enter）：

1. 「使用 `<key>`」：输入本身是合法 key（`yahoo:XXX`、`binance:XXX`、`tv:EX:SYM`、`=A/B`）或别名（不区分大小写）时永远是第一行。
2. 「自选」：本地即时匹配，不区分大小写，匹配 name、ticker、key、yaml 别名、分组名、内置字典的中文名和拼音（全拼 / 首字母）；每行「名称 · 代码 · 分组」；Enter = 打开（图表页 = 客户端切换）。
3. 「常用」：yaml `aliases` 与内置字典里尚未在自选的条目；Enter = 添加并打开。
4. 「搜索」：外部结果，300ms 防抖（ASCII ≥2 字符，CJK ≥1）；状态「搜索中…」/「无结果，可直接输入 source:ticker 或 =表达式」；已在自选的行尾标「已在自选 · 分组」且 Enter = 打开。

**添加**（`navigate` 模式，行不在自选时）：行尾显示推断的分组芯片——`binance` / 加密类 → 加密；`.HK/.SS/.SZ` 或 `tv:SSE/SZSE/HKEX` → 港 A；`tv:TVC/FX_IDC/OANDA` 或 kind ∈ index/bond/commodity/forex/cfd/currency/economic → 宏观；`=` → 比价；其余 → 美股。按组名（含同义词）匹配 yaml 里现有的组，没有就落到第一个组；高亮行展开全部芯片 + 「新建分组…」（内联输入）。Enter = `addSymbol` 到该组 + 立即开图；名称写 yaml 时取字典中文名；若输入的是中文搜索词且添加成功，把「搜索词 → key」写进 `aliases`；成功 toast「已添加到 港 A · 撤销」（撤销 = `removeSymbol`）；已存在 → 直接打开。

**`pick` 模式**（比较商品弹窗）：主动作由 `pickActions` 给出（「同百分比坐标」/「新窗格」，高亮行上显示为按钮，Enter = 第一个），自选段也是；排除当前标的与已对比的 key。

**后端**（纯函数在 `src/lib/search.ts`，可测试；路由只做编排）：规范化 query → 合法 key 直接返回 → 本地层（在浏览器里跑：自选 + aliases + 字典 `src/lib/wellknown.ts`，约 65 条 `{ key, zh, en, aliases }`，拼音直接写在 aliases 里，不引入拼音库）→ 外部层并行：

- Binance：`/api/v3/ticker/price` 内存缓存 24h，取 `*USDT`，按币名前缀匹配，`<base>USDT` 完全匹配排最前。
- Yahoo：仅 ASCII 查询（含 CJK 直接抛 `Invalid Search Query`）；过滤 FUTURE / OPTION / MUTUALFUND；外地挂牌（`.TO/.DU/.F/.DE/.L/.MX…`，`.HK/.SS/.SZ` 除外）只在查询本身含 `.` 时保留；同一公司只留主上市。
- TradingView：查询含 CJK、或含 `:`、或 Yahoo 命中 < 3 时调用；含 `:` 时直接按交易所查，否则并行 `index`、`cfd`、`stock`（像收益率的查询再加 `bond`）各取前几条合并；丢 bond（除非查询像 `US10Y` / 收益率 / 国债）、structured、swap、dr、warrant、futures（除非查询含 `!` / 期货）、FINRA 等数据商序列；`<em>` 高亮去掉；大交易所的股票 / ETF 改写成 Yahoo key（`HKEX:700 → yahoo:0700.HK`、`SSE:600519 → yahoo:600519.SS`、`NASDAQ:AAPL → yahoo:AAPL`），`BINANCE:XXXUSDT → binance:XXXUSDT`。

排序：精确代码匹配 > 自选 > 字典 > 来源偏好（股票 yahoo > tv；币 binance > yahoo；宏观 / 指数 / 汇率 tv:TVC/HSI/FX_IDC/OANDA > yahoo）> 名称前缀 > 交易所白名单（TVC、HSI、SSE、SZSE、HKEX、NASDAQ、NYSE、BINANCE、FX_IDC、OANDA）> 其余按到达顺序。同一标的多源去重（`yahoo:BTC-USD` 与 `binance:BTCUSDT` 算同一个，币优先 binance）。返回 `{ key, name, exchange?, kind?, source, inWatchlist?, suggestedGroup }`，最多 12 条。

### 5.5 设置

不做单独页面。周期选择、涨跌色、图表偏好由各处 UI 写回 yaml；分组、名称、基准由总览行菜单写回；其余（同步时间、别名、条件、告警、数据集）直接改 yaml，页面上给出 vault 相对路径提示。通知通道写在 `~/.config/hebi8/market/notify.json`（§2.5）。反馈用的 GitHub App 只有一个 client id，写在源码里（§5.8），不需要设置页。

### 5.6 自动保存（笔记与复盘日志）

`useAutosave`：输入停止 1s 后保存（Server Action）；`Ctrl/Cmd+S` 立即保存；保存中又有输入则保存完再发最新的；dirty 时 `beforeunload` 拦截；状态文字用 muted 色：「已保存 12:03」/「保存中…」/「未保存」/「保存失败：…」。localStorage 草稿兜底：key 含文件名（`hebi8:draft:notes/<fileKey>.md`、`hebi8:draft:journal/<week>.md`），每次输入写入，保存成功即清；打开时若有草稿、内容与文件不同且比文件的 mtime 新，横幅提示「有 12:03 的未保存草稿 · 恢复 / 丢弃」。笔记面板保留「编辑 / 完成」切换，没有保存按钮。

### 5.7 视觉规范（客观项）

- 次要文字最小 11px；浅色 `--green: #138a4b`（白底 ≥ 4.5:1），深色不变。
- 所有可聚焦元素统一 `:focus-visible` 2px accent 外框。
- 状态文字（已保存等）用 muted，不用 accent。
- 全站按钮：`.btn` 纯文本（hover 底色）、`.btn-primary`（实心 fg 底 + bg 字）、`.btn-secondary`（1px line 描边）；分段 `.seg`；输入 `.input`；徽标 `.badge`；菜单 `.menu`。
- 图表页工具栏：`.tb-btn`（30px 热区、fg 色图标或图标 + 短文字、hover 浅底，按下 / 展开时 fg 11% 实底）、`.tb-sep` / `.tb-sep-h` 1px 分隔；图标是 `chart-icons.tsx` 里的 18px 线性 SVG，不引入图标库。

### 5.8 帮助面板与应用内反馈

**目标**：几秒钟内在应用里把问题报给 GitHub，issue 的作者是报告的人自己，且带机器可读的上下文，以后让自动化识别并修复简单问题。任何人自己部署的 hebi8 都能把问题报到 `dreaite/hebi8-market`：实例里不放、也不存任何 App 密钥。

**入口**：页头最右的圆形「?」，或焦点不在输入框时按 `?`（Shift+/）；图表页全屏时页头隐藏，顶栏全屏按钮旁出现同样的「?」。右侧抽屉 380px（≤768px 为底部抽屉 85dvh），两个页签「项目 / 反馈」，上次的页签记在 localStorage（`hebi8:help:tab`）。Esc、点外面、再按 `?` 关闭；抽屉内的按键不冒泡到页面（图表的 Space / 方向键 / 字母搜索不会在背后触发）。`?help=feedback|project` 打开抽屉并从地址栏去掉这个参数。全程不用原生 alert / confirm / prompt（会退出全屏）。

**项目页签**（`GET /api/help`，只读本地）：名称与含义；版本 = `package.json` version + 构建时的 `git rev-parse --short HEAD` + 构建时间（`next.config.ts` 的 `env` 注入 `HEBI8_VERSION / HEBI8_COMMIT / HEBI8_BUILT_AT`，取不到 commit 时为 `unknown`）；数据状态：自选数、缓存标的数、上次同步、下次同步（调度器 `scheduledNextSync()`，没启动时按 `sync.at` 推算）、同步出错的标的与错误、vault 相对路径；快捷键表；仓库、设计文档、反馈仓库 `from-app` issue 列表的链接。

**配置**（`src/lib/app-info.ts`，服务端读，环境变量可覆盖，供 fork 用自己的 App / 仓库）：

| 常量 | 默认 | 环境变量 |
|---|---|---|
| `FEEDBACK_REPO` | `dreaite/hebi8-market` | `HEBI8_FEEDBACK_REPO`（须形如 `owner/name`，否则用默认） |
| `GITHUB_APP_CLIENT_ID` | `"Iv23liCniWEUtlDruFJa"`（dreaite 组织的 hebi8-market App） | `HEBI8_GITHUB_CLIENT_ID`（`off` 关闭应用内登录） |
| `GITHUB_APP_SLUG` | `hebi8-market`（只用于 `github.com/apps/<slug>` 链接） | `HEBI8_GITHUB_APP_SLUG` |

client id 不是秘密（device flow 的设计就是给拿不住密钥的客户端用的），写在源码里即可。

**反馈页签**的四种状态，表单（类型分段 问题 bug / 体验 ux / 数据 data / 想法 idea、标题、描述、「附带页面信息」、「可以自动修复」、可展开的「预览将附带的信息」= 实际发送的 JSON）在每种状态下都在，未发送的内容在本标签页内关掉抽屉也保留：

- **未启用**（client id 为空）：「反馈未启用」说明；表单下方主按钮是「在 GitHub 网页上提交」。
- **未登录**：「用 GitHub 登录」+ 说明会以你的名义提交到哪个仓库；表单下方是次要按钮「在 GitHub 网页上提交」。
- **登录中**：大号、可复制的 user code（复制不用 async clipboard——内网是 http，没有安全上下文——而是隐藏 textarea + `execCommand("copy")`，焦点留在抽屉里）、「打开 github.com/login/device」（新标签页，地址来自 GitHub 的 `verification_uri`，只接受 `https://github.com/…`）、状态行（等待授权 / GitHub 要求放慢）+ 倒计时、「取消」。进行中的登录记在模块变量里，关掉再打开抽屉会接着轮询。
- **已登录**：头像 + 用户名 +「退出」；「提交」按钮下注明「以你的 GitHub 账号提交到 <repo>」。`Ctrl/Cmd+Enter` 提交，成功 toast「已提交 #123」（链到 issue）并清空；GitHub 返回 403 / 404 / 410 时显示中文原因并给出「在 GitHub 网页上提交」。未登录 / 未启用时 `Ctrl/Cmd+Enter` 打开网页版。

下方列出最近 5 条 `from-app` issue。

**登录：GitHub App 的 device flow**（所有 GitHub 调用都在 `src/lib/github.ts`，错误是带中文消息的 `GitHubError`；token 和 device code 只在服务端，不进浏览器、不写日志）：

1. `POST /api/github/device` → 服务端 `POST https://github.com/login/device/code`（只带 `client_id`）→ device code 留在服务端内存（`globalThis` 上的 Map，键是 32 字节随机 flowId，按 `expires_in` 过期，最多 20 个并发）→ 返回 `{ flowId, user_code, verification_uri, expires_in, interval }`。`device_flow_disabled` → 「GitHub App 没有开启 Device Flow」；不认识的 client id（GitHub 回 404）→ 「GitHub 不认识这个 client id」。
2. 面板每 `interval` 秒 `POST /api/github/device/poll { flowId }`。服务端每次最多向 GitHub 发一次 `POST https://github.com/login/oauth/access_token`（`client_id`、`device_code`、`grant_type=urn:ietf:params:oauth:grant-type:device_code`，没有 client_secret），且自己也卡住间隔：没到时间直接回 `pending`。`authorization_pending` → 继续；`slow_down` → 间隔 +5 秒（GitHub 给了新 `interval` 就取较大者）；`expired_token` / 超时 → `expired`；`access_denied` → `denied`；其它错误结束本次登录。
3. 拿到 token → `GET /user` → 建会话（32 字节随机 id，cookie `hebi8m_session` HttpOnly、SameSite=Lax、30 天；内网没有 HTTPS，所以不设 Secure）。
4. 用户 token 8 小时过期；离过期不到 5 分钟时用 `grant_type=refresh_token` + `client_id` + `refresh_token` 续（device flow 拿到的 token 续期不需要 client_secret）。续不上（或 GitHub 对用户 token 返回 401）就删会话，面板显示原因和登录按钮。`POST /api/github/logout` 删会话。
5. 写操作的接口都拒绝跨站 `Origin`。

**提交**：`POST /api/github/issues` → 用**用户** token `POST /repos/<repo>/issues`，只有 title + body，不带标签（非协作者带的标签会被 GitHub 静默丢掉）。用户 token 只能访问用户和 App 都能访问的资源，所以 App 必须安装在反馈仓库上；没装（404）、账号被仓库限制（403）、仓库关了 issue（410）都映射成中文说明并提供网页版。`GET /api/github/issues`：`from-app` 标签、`state=all`、去掉 PR、前 5 条；登录时用用户 token（被拒就匿名重试），否则匿名（公开仓库）；服务端按仓库缓存 60 秒，提交成功后清缓存。

**网页版**（`webIssueUrl()`，纯函数，浏览器里算）：`https://github.com/<repo>/issues/new?title=…&body=…`，body 与应用内提交的完全一样（含 context 块）。URL 上限 7000 字符（GitHub 约 8 KB 起报 414）：超了先把 JSON 压成一行，再去掉 `errors`、`userAgent`，再只留 `{ v, type, autoFix }`，最后才从尾部截断描述并注明「网页版已截断」。

**会话存储**：不在仓库、vault、data 里。目录 `HEBI8_SECRETS`（默认 `~/.config/hebi8/market`，权限 700），只有 `sessions.json`（原子写入，权限 600）：会话 id → login、avatar_url、access_token、access_expires_at、refresh_token、refresh_expires_at、created_at。超过 30 天或 refresh token 也过期的会话在每次写入时清掉。

**issue 格式**：标题是用户填的；正文

````markdown
<描述>

---

<details><summary>页面信息</summary>        （没勾「附带页面信息」时是「反馈信息」）

```json hebi8-context
{ ... }
```
</details>

<sub>来自 hebi8 market 应用内反馈</sub>
````

`hebi8-context`（`src/lib/feedback.ts` 的 `FeedbackContext`，`parseIssueContext()` 可读回）。`v`、`type`、`autoFix` 总是在（打标签要用），其余只在勾了「附带页面信息」时出现；`type` 和 `autoFix` 由服务端按表单字段重写：

```ts
{
  v: 1,                                   // 字段含义变了就加一；未知字段忽略
  type: "bug" | "ux" | "data" | "idea",
  autoFix: boolean,                       // 「可以自动修复」：只是报告人的意愿，授权看下面的标签
  app?: { version, commit, builtAt },
  page?: "/chart/yahoo%3ASPY",            // 路径 + 查询，不含 origin
  chart?: { symbol, tf, style, log, prices, indicators: string[], compares: { key, mode }[] },  // 只在图表页
  viewport?: { width, height, dpr },
  colorScheme?: "light" | "dark",
  fullscreen?: boolean,
  userAgent?: string,
  errors?: { t, kind: "error" | "rejection", message, source? }[],  // 本标签页最近 ≤10 个未捕获错误（ErrorCapture 尽早安装）
  at?: string                             // ISO 时间
}
```

**标签：GitHub Actions**（`.github/workflows/app-feedback.yml`，逻辑在 `.github/scripts/feedback-labels.js`，有单元测试）。`issues: [opened, edited]`，权限 `contents: read` + `issues: write`，`actions/checkout@v5`（只稀疏检出 `.github/scripts`，不留凭据）+ `actions/github-script@v8`。正文只当数据：用正则取出 ```` ```json hebi8-context ```` 块，`JSON.parse` 包在 try/catch 里，只认白名单里的 `type`（`bug` / `ux` / `data` / `idea`）和 `autoFix === true`，事件里的内容不拼进脚本或 shell。有块就确保标签存在（缺的按颜色和说明创建）并加上 `from-app` + 类型标签；`autoFix` 为真时，作者的 `author_association` 是 `OWNER` / `MEMBER` / `COLLABORATOR` 才加 `auto-fix-ok`，否则加 `auto-fix-requested`。只加不删。所有人的 issue 都适用，实例里不需要任何密钥。

**给以后的自动化**：只有带 `auto-fix-ok` 且作者是仓库 owner / 成员 / 协作者的 issue 才算自动修复候选（标签任何有写权限的人都能加，作者关联才是授权依据，自动化应再核对一次）；上下文从 ```` ```json hebi8-context ```` 块里解析，`v` 不认识就跳过。

**仓库 owner 的一次性设置**：

1. 用预填好的链接在 dreaite 组织下注册 App（名字、描述、主页、公开、关闭 webhook、Issues 读写；Metadata 只读是自动带的）：
   `https://github.com/organizations/dreaite/settings/apps/new?name=hebi8-market&description=hebi8%20market%20%E7%9A%84%E5%BA%94%E7%94%A8%E5%86%85%E5%8F%8D%E9%A6%88%EF%BC%9A%E7%94%A8%E4%BD%A0%E8%87%AA%E5%B7%B1%E7%9A%84%20GitHub%20%E8%B4%A6%E5%8F%B7%E5%9C%A8%20dreaite%2Fhebi8-market%20%E4%B8%8A%E6%8F%90%E4%BA%A4%20issue&url=https%3A%2F%2Fgithub.com%2Fdreaite%2Fhebi8-market&public=true&webhook_active=false&issues=write`
   核对：**Any account** 可安装（公开——私有 App 只有组织成员能授权）；Webhook 不勾 Active；Repository permissions 只有 Issues: Read and write 和 Metadata: Read-only；Callback URL 留空（device flow 不需要）；**Expire user authorization tokens** 保持勾选（8 小时 + refresh）。不要生成 client secret 或私钥，用不到。
2. 建好后在 App 的 General 设置里勾选 **Enable Device Flow** 并保存（URL 参数不能设这一项）。
3. Install App → dreaite → **Only select repositories → hebi8-market** → Install。
4. 把 App 页面上的 **Client ID**（`Iv23…`）填进 `src/lib/app-info.ts` 的 `GITHUB_APP_CLIENT_ID`，提交。
5. 确认仓库开着 Issues，Actions 允许运行（Settings → Actions → General：允许 `actions/*`；Workflow permissions 用默认即可，工作流自己声明了 `issues: write`）。

fork：建自己的公开 App（同样的权限、开 Device Flow、装在自己的仓库），设 `HEBI8_GITHUB_CLIENT_ID` 和 `HEBI8_FEEDBACK_REPO`；把 `.github/workflows/app-feedback.yml` 留在自己的仓库里就有同样的标签。

---

## 6. 接口

**Route Handlers（只读 JSON）**

- `GET /api/bars?key=&tf=D|W|M|Q&prices=split|total&with=k1,k2`
  → `{ symbol: {key, name, source, ticker, currency, bench, syncedAt, syncError}, pricePrecision, bars: [{timestamp, open, high, low, close, volume}], refs: { [key]: { c: (number|null)[], o?, h?, l?, v? } } }`，`refs` 与 `bars` 等长对齐。响应按 viewer 的 yaml 解析名字、基准和合成别名，`Cache-Control: no-store`，不做条件请求。
- `GET /api/search?q=` → 外部结果 `SearchResult[]`（§5.4；本地层在浏览器里算）。
- `GET /api/help` → 帮助面板数据（§5.8，只读本地）。
- `/api/github/device`（POST 开始 device flow / DELETE 取消）、`/api/github/device/poll`（POST）、`/api/github/logout`（POST）、`/api/github/issues`（GET 最近反馈 / POST 提交）：§5.8，唯一会碰 GitHub 网络的接口，都是打开反馈页签或用户动作触发。

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

对外网开放的登录鉴权（GitHub 登录只用来区分局域网里共用实例的人和提交反馈，不防恶意访问者，§1.6）；vault 之间的共享和协作编辑；日内 K 线（盘中只取最新价判断警报，§2.6，不存也不画日内 K 线）；比 5 分钟更快的价格警报（WebSocket、逐笔）；入站 webhook；数据集爬虫（hebi8 只读仓库）；Pine Script 兼容；拖拽排序（改 yaml）。
