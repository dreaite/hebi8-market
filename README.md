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
- **图表**：基于 [KLineChart](https://github.com/klinecharts/KLineChart)，布局和快捷键照搬 TradingView：顶栏是商品搜索、`+` 比较商品、`日 周 月 季`、图表类型、`fx 指标`、刷新、全屏；左边画线工具栏；图内左上角图例（OHLC、各指标和对比的数值，悬停出现隐藏 / 设置 / 移除）；右边自选列表和笔记；底栏是 `1年 3年 5年 10年 全部` 范围按钮和 `ADJ`（含分红）、`%`、`log`、`自动`。内置指标、代码指标和公式指标都在「指标」弹窗里开关，参数在图例的设置里改，按周期保存。
- **对比**：把别的标的叠在主图上，用同百分比坐标——滚动、缩放时所有线从可见区间左边缘重新归零，和 TradingView 一致；单位不同的（比如美债收益率）放独立副图。
- **画线**：趋势线、射线、延长线、水平线、水平射线、垂直线、斐波那契回撤、文字，只画在主图上；磁铁模式、锁定 / 隐藏 / 删除所有绘图。按时间戳保存，周线上画的线切到日线还在。选中后 `Delete` 删除，或右键菜单「删除」；`Esc` 退出绘制。
- **笔记与复盘**：每个标的一篇 markdown 笔记（thesis）；每周一篇复盘日志。都是自动保存：停止输入 1 秒后写盘，`Ctrl/Cmd+S` 立即保存，浏览器里留一份草稿兜底。复盘页列出本周所有条件变化和有笔记的标的。
- **帮助与反馈**：页头最右的「?」（或按 `?`）打开帮助抽屉：项目信息、版本、同步状态、快捷键；「反馈」页签把问题直接提交成 GitHub issue，自动附带当前页面、图表状态和最近的前端错误。
- **合成标的**：`=BTC/GOLD` 这样的表达式当作标的看图、算统计、算条件，逐字段计算，和 TradingView 的 spread 一样。
- **同步后通知**：标了 `notify` 的条件和 `alerts` 里的价位规则，在某次同步后**新成立**时推一条摘要到 Telegram 或 webhook（ntfy、Discord 等）。只看日线，不做盘中实时。

约束：默认单用户、无登录、只在内网用（局域网里几个人共用一台见[下文](#共用一台实例)）；只存日线，周 / 月 / 季线读时合成；读取永远不碰网络；通知只往外发，不开任何入口。

### 应用内反馈

`?` → 反馈：填好标题和描述，点「用 GitHub 登录」，抽屉里会显示一串代码，到 github.com/login/device 输入并授权，回来就能提交——issue 以**你自己的** GitHub 账号开在 `dreaite/hebi8-market` 上。登录用的是公开 GitHub App「hebi8-market」的 device flow，只需要写在 `src/lib/app-info.ts` 里的 client id，任何人自己部署的 hebi8 都能用，不用配置任何密钥；登录会话存在服务器的 `~/.config/hebi8/sessions.json`（`HEBI8_SECRETS` 可改，权限 600）。不想登录、或者 App 还没配置（「反馈未启用」）时，「在 GitHub 网页上提交」会在 github.com 打开预填好同样内容的新 issue。

标签不由应用加（非协作者开 issue 时 GitHub 会丢掉标签），而是仓库里的 Actions 工作流 `.github/workflows/app-feedback.yml` 读 issue 正文里的 `hebi8-context` 块：加 `from-app` 和类型标签；勾了「可以自动修复」的，作者是仓库 owner / 组织成员 / 协作者才加 `auto-fix-ok`，其他人加 `auto-fix-requested`。

**仓库 owner 要做的一次性设置**（详见 [`docs/design.md`](docs/design.md) §5.8）：在 dreaite 组织下注册公开的 GitHub App（[预填好的注册链接](https://github.com/organizations/dreaite/settings/apps/new?name=hebi8-market&description=hebi8%20market%20%E7%9A%84%E5%BA%94%E7%94%A8%E5%86%85%E5%8F%8D%E9%A6%88%EF%BC%9A%E7%94%A8%E4%BD%A0%E8%87%AA%E5%B7%B1%E7%9A%84%20GitHub%20%E8%B4%A6%E5%8F%B7%E5%9C%A8%20dreaite%2Fhebi8-market%20%E4%B8%8A%E6%8F%90%E4%BA%A4%20issue&url=https%3A%2F%2Fgithub.com%2Fdreaite%2Fhebi8-market&public=true&webhook_active=false&issues=write)），在 App 设置里勾选 **Enable Device Flow**，只安装到 hebi8-market，把 client id 填进 `app-info.ts` 的 `GITHUB_APP_CLIENT_ID`。fork 想把反馈收到自己的仓库：建自己的 App，设环境变量 `HEBI8_GITHUB_CLIENT_ID` 和 `HEBI8_FEEDBACK_REPO`。

## 数据源

| source | 覆盖 | 说明 |
|---|---|---|
| `yahoo` | 美股、港股、A 股、指数、ETF | 经 [yahoo-finance2](https://github.com/gadicc/yahoo-finance2) 拉取完整日线历史。价格是拆股复权价，分红因子另存，`prices: total` 时折进价格。直接请求 Yahoo 接口会返回 429，所以必须走这个库。 |
| `binance` | 加密货币现货 | 公开 K 线接口，无需 key，增量拉取。 |
| `tv` | 指数、国债收益率、外汇、商品等 Yahoo 缺的品种 | 非官方的 [TradingView-API](https://github.com/Mathieu2301/TradingView-API)，无需登录，最多约 6000 根日线。属于逆向接口，TradingView 改动协议后可能失效。 |
| `data` | 自己的日线数据集，比如爬虫每天推送的显卡二手价 | 一个 git 仓库或本机目录，按下文的约定放 CSV。hebi8 只读不爬。 |

代码示例：`yahoo:AAPL`、`yahoo:0700.HK`、`yahoo:600519.SS`、`yahoo:^GSPC`、`binance:BTCUSDT`、`tv:TVC:US10Y`、`tv:HSI:HSTECH`、`tv:FX_IDC:USDCNH`、`data:gpu/4090-xianyu`、`=BTC/GOLD`。

各数据源的日线时间戳不同：美股记在开盘时刻，亚洲市场记在 01:30 UTC，外汇和 TVC 品种记在前一晚开盘时刻。入库前统一按交易所时区换算成交易日。

### 自定义数据集

任何按下面约定存放日线 CSV 的 git 仓库或本机目录，都能当数据源用。接进来以后，图表、公式、条件、对比、合成标的、同步后通知都和普通标的一样。

```yaml
# vault/hebi8.yaml
datasets:
  gpu: https://github.com/you/gpu-prices     # 也可以写 git@ / ssh:// / file:// 地址，或本机目录 ~/data/gpu-prices、./datasets/gpu
aliases:
  GPU4090: data:gpu/4090-xianyu
```

仓库根目录放清单 `hebi8-dataset.yaml`，每条序列一个 CSV：

```yaml
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

- key 是 `data:<数据集>/<序列 id>`，区分大小写。在合成表达式和 `close(...)` 里要用别名或带引号的 key，比如 `=GPU4090/"tv:FX_IDC:USDCNH"`。
- 远程仓库浅克隆到 `data/datasets/<name>/`，每次同步前拉一次。私有仓库用机器上的 SSH key。本机目录直接读，相对路径相对于 vault 目录。
- CSV 只要求 `date` 和 `close` 两列，日期写 `YYYY-MM-DD`。`open` 空着就用 `close`，`high`、`low` 空着就取开收的高低，`volume` 可以留空。格式错误会报行号，只影响这一个标的。
- 清单读到以后，搜索框输入序列名、id 或数据集名就能找到并加进自选；输入 `data:` 开头只查数据集。

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
| `?` | 帮助与反馈（反馈里 `Ctrl/Cmd+Enter` 提交） |
| `↑ ↓ Enter Tab Esc` | 搜索里移动、打开 / 添加、换分组、关闭 |
| `Space`、`Shift+Space` | 图表页切自选列表下一只 / 上一只 |
| `← →`、`↑ ↓` | 图表滚动、缩放 |
| `Alt+T` `Alt+H` `Alt+J` `Alt+V` `Alt+F` | 趋势线、水平线、水平射线、垂直线、斐波那契回撤 |
| `Delete`、`Backspace` | 删除选中的画线 |
| `Alt+R` | 重置图表视图 |
| `Esc` | 关闭弹窗、退出画线 |
| `Ctrl/Cmd+S` | 立即保存笔记 / 复盘 |

| 环境变量 | 默认值 | 作用 |
|---|---|---|
| `HEBI8_VAULT` | `./vault` | 用户内容目录 |
| `HEBI8_DB` | `./data/hebi8.db` | SQLite 缓存，删了会自动重建 |
| `BINANCE_API_URL` | `https://api.binance.com` | 换成 `https://data-api.binance.vision` 等镜像 |
| `HEBI8_SECRETS` | `~/.config/hebi8` | 反馈用的 GitHub 登录会话 `sessions.json` 和通知通道 `notify.json`，权限 700 / 600 |
| `HEBI8_GITHUB_CLIENT_ID` | `app-info.ts` 的 `GITHUB_APP_CLIENT_ID` | 反馈登录用的 GitHub App client id（fork 用自己的 App 时设）；设为 `off` 关闭应用内登录，反馈只走 GitHub 网页 |
| `HEBI8_FEEDBACK_REPO` | `dreaite/hebi8-market` | 反馈 issue 开在哪个仓库（`owner/name`） |
| `HEBI8_GITHUB_APP_SLUG` | `hebi8-market` | App 的 slug，只用于链接 |

## vault

**`vault/` 是我的，`data/hebi8.db` 是缓存。** vault 不进 git，放到自己的同步盘或者单独的仓库里。

```text
vault/
  hebi8.yaml                  自选分组、别名、公式指标、条件、同步时间表、图表偏好
  notes/<fileKey>.md          每个标的的笔记，frontmatter 里的 key 是权威
  journal/<YYYY>-W<ww>.md     每周复盘（ISO 周）
  charts/<fileKey>.json       每个标的的对比列表和画线
  users/<login>/              共用实例里其他人的 vault，结构同上
```

`hebi8.yaml` 的样子见 `vault.example/hebi8.yaml`。界面上改周期、涨跌色、图表偏好、添加 / 移除 / 移动 / 改名标的、设基准、编辑公式指标时会写回这个文件，注释和顺序都保留；同步时间、别名、条件直接改文件，不用重启。搜索时用中文词添加的标的，这个词会记进 `aliases`。

- 标的引用（分组、`bench`、公式里的 `close(X)`、合成表达式、对比、搜索）先查 `aliases`，查不到就当完整 key。
- 显示名：yaml 里的 `name` > 内置字典的中文名 > 数据源的名字。
- `bench` 是相对强弱和 `close(bench)` 的默认基准。
- `conditions` 在每次同步后按周线计算，`prev != now` 就是本周的变化。
- `fileKey`：`tv:TVC:US10Y → tv_TVC_US10Y`，`=BTC/GOLD → expr_BTC_GOLD`。

## 共用一台实例

在根 vault 的 `hebi8.yaml` 里写 `owner: <你的 GitHub 用户名>`，局域网里的几个人就能共用这台 hebi8：K 线缓存、同步和数据集是共享的，自选、别名、公式、条件、告警、图表偏好、笔记、复盘、画线和通知是各人的。不写 `owner` 就是单用户模式，和以前完全一样。

| 访问者 | 看到 | 能改 |
|---|---|---|
| owner 登录 | 根 vault | 根 vault，含实例设置 |
| 其他人登录 | `vault/users/<login>/` | 自己的 vault |
| 未登录 | owner 的总览和图表（含画线） | 不能改；笔记和复盘要登录后看自己的 |

- 页头右侧的「登录」走帮助抽屉里同一套 GitHub device flow（和反馈共用会话，30 天）；登录后显示头像和用户名，菜单里可以退出。退出只删会话，不动 vault。
- 第一次登录的人从根 vault 的 `hebi8.yaml` 复制一份起点，去掉 `owner`、`sync`、`datasets`、`alerts`；笔记、复盘、画线从空开始。之后两边互不影响。
- `owner`、`sync`、`datasets` 是实例设置，只认根 vault 的；写在自己 yaml 里会被忽略，总览上会提示。
- 同步拉的是所有人引用到的标的的并集；同步后每个人的统计和通知各算各的。
- GitHub 登录只用来区分局域网里的人，不防恶意访问者，不要把实例开到公网。

## 通知

每次定时同步或点「刷新」之后，hebi8 检查两种规则，**从不成立变成成立**的那一刻推一条摘要。加标的时的单个同步不推。

```yaml
conditions:
  - { id: below_200w, label: 破200周, formula: "close < sma(close, 200)", notify: true }   # 对每个自选标的检查

alerts:                                                    # 只对一个标的检查，tf 默认 D
  - { key: BTC, label: BTC 站上 13 万, when: "close > 130000" }
  - { key: NVDA, when: "close < sma(close, 200)", tf: W }
```

- 规则第一次出现（新加的规则、新加的标的、删过缓存库）只记下当前状态，不推送，所以不会一上来把所有已成立的条件推一遍。
- 同一根 K 线只推一次。周线条件在本周内来回真假，也只响一次。
- 所有通道都发送失败时不记账，下次同步再试；没配通道时只写日志。

通道写在 `~/.config/hebi8/notify.json`（不在 vault 里，权限设成 600），两种可以同时开：

```json
{
  "telegram": { "token": "123456:ABC...", "chat": "123456789" },
  "webhook": "https://ntfy.sh/your-secret-topic",
  "link": "http://100.92.194.31:8808"
}
```

- `telegram`：找 @BotFather 建一个 bot 拿 token，给 bot 发一句话后从 `https://api.telegram.org/bot<token>/getUpdates` 里读 `chat.id`。用自建 Bot API 服务时加 `"api": "http://..."`。
- `webhook`：字符串，或 `{ "url": ..., "format": "json" }`。默认 `text` 把摘要当正文 POST，带 `Title: hebi8` 头，ntfy 直接能用；`json` 发 `{ title, text, events }`。
- `link`：可选，有的话每条后面带图表页链接。

配好后用这条命令往每个通道发一条测试消息：

```bash
npm run notify:test
```

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
│       ├── search/           外部搜索（Yahoo / TradingView / Binance），本地匹配在浏览器里
│       ├── help/             帮助面板数据（只读本地）
│       └── github/           device flow 登录、退出、提交 / 列出反馈 issue
├── instrumentation.ts        启动应用内调度器
├── components/               UiProvider（搜索浮层、帮助抽屉、toast、快捷键）/ HelpPanel/ SymbolSearch / Overview / RowMenu / ChartView / KChart / ChartLegend / IndicatorDialog / CompareDialog / WatchlistPanel / FormulaEditor / NotesPanel …
├── indicators/               指标目录、代码指标、公式引擎（formula.ts）、纯计算函数
└── lib/
    ├── search.ts wellknown.ts 搜索的纯函数（匹配、过滤、去重、排序、分组推断）与内置字典
    ├── use-autosave.ts       笔记 / 复盘的自动保存
    ├── github.ts secrets.ts  GitHub 调用（device flow 登录、刷新、issue）与 ~/.config/hebi8 里的登录会话
    ├── feedback.ts           反馈 issue 的正文、hebi8-context 格式与 GitHub 网页预填链接
    ├── sources/              yahoo / binance / tradingview / dataset（自定义数据集）适配器
    ├── vault.ts config.ts    vault 的读写层（按目录，根 vault 或 users/<login>/）、hebi8.yaml 的类型与校验
    ├── viewer.ts             这次请求是谁、看哪个 vault、能不能写（共用实例）
    ├── db.ts store.ts        SQLite 缓存（symbols、bars、stats、alert_state）
    ├── sync.ts scheduler.ts  同步、同步后算 stats 和通知、每日定时
    ├── series.ts synth.ts    周/月/季线合成、对齐、合成标的
    ├── stats.ts conditions.ts 总览统计与条件
    ├── alerts.ts notify.ts   同步后通知：规则判定与状态、Telegram / webhook 投递
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
