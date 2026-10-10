import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UsageLimitsForm } from "@/components/UsageLimitsForm";
import { APP_INFO } from "@/lib/app-info";
import { allItems, isLive } from "@/lib/config";
import { fmtAgo } from "@/lib/format";
import { nameOf } from "@/lib/names";
import { nextRun, scheduledNextSync } from "@/lib/scheduler";
import { listSymbols, maxSyncedAt } from "@/lib/store";
import type { Source } from "@/lib/symbols";
import { OTHER, type Kind } from "@/lib/traffic";
import { dailyTraffic, dailyUpstream, flushUsage, KEEP_DAYS, MAX_VISITORS, lastSeen, topPaths, topVisitors, usageDay, type UpstreamRow } from "@/lib/usage";
import { listVaults, readConfigSafe } from "@/lib/vault";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
// a person's own page: not for search engines (robots.ts keeps crawlers out as well)
export const metadata: Metadata = { title: "使用情况", robots: { index: false, follow: false } };

const DAYS = 30;
const SOURCES: [Source, string][] = [
  ["yahoo", "Yahoo"],
  ["tv", "TradingView"],
  ["binance", "Binance"],
  ["data", "数据集 git"],
];
const KIND_LABELS: Record<Kind, string> = { page: "页面", prefetch: "预取", action: "Action", api: "API" };
const WEEKDAYS = "日一二三四五六";

const dayLabel = (day: number) => {
  const d = new Date(day * 1000);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} 周${WEEKDAYS[d.getUTCDay()]}`;
};

const num = (n: number) => (n ? n.toLocaleString("en-US") : <span className="text-muted">0</span>);

const card = "rounded-lg border border-line bg-card";
const head = "border-b border-line px-3 py-2 text-xs font-medium";
const cell = "px-3 py-1.5 text-[11px] font-normal text-muted";
const th = `${cell} text-left`;
const thr = `${cell} text-right`;
const td = "border-t border-line px-3 py-1.5";
const tdr = `${td} tabular text-right`;

/** Who uses the instance and how hard the sources are asked (design §1.7); the owner only, 404 for anyone else. */
export default async function UsagePage() {
  const viewer = await getViewer();
  if (!viewer.isOwner) notFound();
  const { config } = readConfigSafe(viewer.dir);
  if (!config) notFound();

  // the last half minute too
  flushUsage();
  const today = usageDay();
  const days = dailyTraffic(today, DAYS);
  const paths = topPaths(today);
  const visitors = topVisitors(today, DAYS);
  const seen = lastSeen();
  const time = new Intl.DateTimeFormat("zh-CN", { timeZone: config.sync.tz, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const when = (sec: number | undefined) => (sec ? time.format(new Date(sec * 1000)) : "—");

  // the instance: build, sync schedule, cache and the symbols whose last sync failed
  const symbols = Object.values(listSymbols());
  const failed = symbols.filter((s) => s.syncError).map((s) => ({ key: s.key, name: nameOf(config, s.key, s.name), error: s.syncError }));
  const lastSync = maxSyncedAt();
  const nextSync = scheduledNextSync() ?? nextRun(new Date(), config.sync.at, config.sync.tz).getTime();

  const vaults = listVaults(config.owners).map((v) => {
    const cfg = v.id ? readConfigSafe(v.dir).config : config;
    const logins = v.id ? [v.id] : config.owners.map((o) => o.toLowerCase());
    const last = Math.max(0, ...logins.map((l) => seen.get(l) ?? 0));
    return {
      name: v.id ? v.id : `${config.owners.join(" / ")}（根 vault）`,
      symbols: cfg ? allItems(cfg).length : null,
      alerts: cfg ? cfg.alerts.length : null,
      enabled: cfg ? cfg.alerts.filter(isLive).length : null,
      last: last || undefined,
    };
  });

  const upstream = new Map<number, Map<Source, UpstreamRow>>();
  for (const r of dailyUpstream(today, DAYS)) {
    if (!upstream.has(r.day)) upstream.set(r.day, new Map());
    upstream.get(r.day)!.set(r.source, r);
  }
  const upstreamDays = days.map((d) => d.day);

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-5 py-5">
      <div className="flex items-baseline gap-3">
        <h1 className="text-sm font-medium">使用情况</h1>
        <span className="text-[11px] text-muted">
          只有 owner 能看 · 按 {config.sync.tz} 的日期 · 明细保留 {KEEP_DAYS} 天 · 访客是 IP 的加盐哈希
        </span>
      </div>

      <section className={card}>
        <div className={head}>实例</div>
        <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 px-3 py-2 text-xs">
          <dt className="text-muted">版本</dt>
          <dd className="font-mono">
            v{APP_INFO.version} · {APP_INFO.commit}
            {APP_INFO.builtAt && <span className="text-muted"> · 构建于 {time.format(new Date(APP_INFO.builtAt))}</span>}
          </dd>
          <dt className="text-muted">同步</dt>
          <dd>
            上次 {lastSync ? `${time.format(new Date(lastSync))}（${fmtAgo(lastSync)}）` : "从未同步"} · 下次 {time.format(new Date(nextSync))}
            <span className="text-muted">
              {" "}
              · 每天 {config.sync.at.join(" ")} {config.sync.tz}
            </span>
          </dd>
          <dt className="text-muted">缓存</dt>
          <dd>
            {symbols.length} 个标的
            {failed.length > 0 && <span className="text-down"> · 上次同步出错 {failed.length} 个</span>}
          </dd>
          <dt className="text-muted">vault</dt>
          <dd className="font-mono break-all">{viewer.dir}/hebi8.yaml</dd>
        </dl>
        {failed.length > 0 && (
          <table className="w-full table-fixed text-xs">
            <thead>
              <tr>
                <th className={`${th} w-56`}>标的</th>
                <th className={th}>错误</th>
              </tr>
            </thead>
            <tbody>
              {failed.map((s) => (
                <tr key={s.key}>
                  <td className={`${td} truncate`} title={s.key}>
                    <span className="font-mono">{s.key}</span>
                    {s.name !== s.key && <span className="text-muted"> {s.name}</span>}
                  </td>
                  <td className={`${td} break-words text-muted`}>{s.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={card}>
        <div className={head}>每日请求 · 最近 {DAYS} 天</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={th}>日期</th>
                <th className={thr}>请求</th>
                <th className={thr}>页面</th>
                <th className={thr}>预取</th>
                <th className={thr}>Action</th>
                <th className={thr}>API</th>
                <th className={thr}>公网访客</th>
                <th className={thr}>Tailscale 访客</th>
                <th className={thr}>登录用户</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <td className={`${td} tabular whitespace-nowrap`}>{d.day === today ? "今天" : dayLabel(d.day)}</td>
                  <td className={tdr}>{num(d.requests)}</td>
                  <td className={tdr}>{num(d.page)}</td>
                  <td className={tdr}>{num(d.prefetch)}</td>
                  <td className={tdr}>{num(d.action)}</td>
                  <td className={tdr}>{num(d.api)}</td>
                  <td className={tdr} title={d.publicFull ? `到了每天 ${MAX_VISITORS} 个的上限，之后的访客合在一起计` : undefined}>
                    {num(d.publicVisitors)}
                    {d.publicFull ? "+" : ""}
                  </td>
                  <td className={tdr} title={d.tailnetFull ? `到了每天 ${MAX_VISITORS} 个的上限，之后的访客合在一起计` : undefined}>
                    {num(d.tailnetVisitors)}
                    {d.tailnetFull ? "+" : ""}
                  </td>
                  <td className={tdr}>{num(d.logins)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={card}>
          <div className={head}>今天的热门路径</div>
          {paths.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted">今天还没有请求。</p>
          ) : (
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr>
                  <th className={th}>路径</th>
                  <th className={`${th} w-16`}>类型</th>
                  <th className={`${thr} w-16`}>请求</th>
                </tr>
              </thead>
              <tbody>
                {paths.map((p) => (
                  <tr key={`${p.kind}:${p.path}`}>
                    <td className={`${td} truncate font-mono`} title={safeDecode(p.path)}>
                      {safeDecode(p.path)}
                    </td>
                    <td className={`${td} text-muted`}>{KIND_LABELS[p.kind]}</td>
                    <td className={tdr}>{num(p.requests)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={card}>
          <div className={head}>访客排行 · 最近 {DAYS} 天</div>
          {visitors.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted">还没有访客。</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className={th}>访客</th>
                  <th className={th}>来源</th>
                  <th className={thr}>请求</th>
                  <th className={thr}>天数</th>
                  <th className={th}>登录</th>
                  <th className={thr}>最近一次</th>
                </tr>
              </thead>
              <tbody>
                {visitors.map((v) => (
                  <tr key={`${v.origin}:${v.visitor}`}>
                    <td className={`${td} font-mono`}>{v.visitor === OTHER ? "(上限外)" : v.visitor.slice(0, 8)}</td>
                    <td className={`${td} text-muted`}>{v.origin === "public" ? "公网" : "Tailscale"}</td>
                    <td className={tdr}>{num(v.requests)}</td>
                    <td className={tdr}>{v.days}</td>
                    <td className={`${td} ${v.logins ? "" : "text-muted"}`}>{v.logins ? v.logins.split(",").join("、") : "—"}</td>
                    <td className={`${tdr} whitespace-nowrap`}>{when(v.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className={card}>
        <div className={head}>用户 vault · {vaults.length} 个</div>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={th}>用户</th>
              <th className={thr}>品种</th>
              <th className={thr}>告警（启用 / 全部）</th>
              <th className={thr}>最近活跃</th>
            </tr>
          </thead>
          <tbody>
            {vaults.map((v) => (
              <tr key={v.name}>
                <td className={td}>{v.name}</td>
                <td className={tdr}>{v.symbols ?? <span className="text-down">yaml 有错</span>}</td>
                <td className={tdr}>{v.alerts === null ? "—" : `${v.enabled} / ${v.alerts}`}</td>
                <td className={`${tdr} whitespace-nowrap`}>{when(v.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={card}>
        <div className={head}>上游数据源 · 最近 {DAYS} 天 · 请求 / 失败 / 疑似限流</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={th}>日期</th>
                {SOURCES.map(([s, label]) => (
                  <th key={s} className={thr}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {upstreamDays.map((day) => (
                <tr key={day}>
                  <td className={`${td} tabular whitespace-nowrap`}>{day === today ? "今天" : dayLabel(day)}</td>
                  {SOURCES.map(([s]) => {
                    const r = upstream.get(day)?.get(s);
                    return (
                      <td key={s} className={`${tdr} whitespace-nowrap`}>
                        {r ? (
                          <>
                            {r.requests} <span className="text-muted">/</span> <span className={r.failures ? "" : "text-muted"}>{r.failures}</span> <span className="text-muted">/</span>{" "}
                            <span className={r.limited ? "text-down" : "text-muted"}>{r.limited}</span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <div className={head}>提醒阈值</div>
        <p className="px-3 pt-3 text-[11px] text-muted">
          写在根 vault 的 hebi8.yaml 的 usage 下。超过时给 owner 的通知渠道发一条，每天每种最多一次；留空不提醒。只提醒，不限流。
        </p>
        <UsageLimitsForm initial={config.usage} />
      </section>
    </main>
  );
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
