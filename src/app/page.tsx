import path from "node:path";
import { ConfigErrorView } from "@/components/ConfigErrorView";
import { Overview, type OverviewData, type OverviewRow } from "@/components/Overview";
import { benchLabel, nameOf } from "@/lib/names";
import { hasBars, listSymbols, maxSyncedAt } from "@/lib/store";
import { isSynthetic, parseKey, tickerOf } from "@/lib/symbols";
import { statsFor, syncAll } from "@/lib/sync";
import { listJournals, readConfigSafe } from "@/lib/vault";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const daysAgo = (ms: number) => Math.floor((Date.now() - ms) / 86400000);

export default async function Home() {
  const viewer = await getViewer();
  const { config, error } = readConfigSafe(viewer.dir);
  if (!config) return <ConfigErrorView error={error} vaultPath={viewer.dir} />;

  const symbols = listSymbols();
  const stats = statsFor(viewer.vault, config);
  const firstRun = !hasBars();
  if (firstRun) void syncAll().catch(() => undefined);

  const groups = config.groups.map((g) => ({
    name: g.name,
    rows: g.symbols.map((item): OverviewRow => {
      const row = symbols[item.key];
      return {
        key: item.key,
        name: nameOf(config, item.key, row?.name),
        yamlName: item.name,
        ticker: tickerOf(item.key),
        source: isSynthetic(item.key) ? "expr" : parseKey(item.key).source,
        currency: row?.currency ?? stats[item.key]?.currency ?? null,
        bench: item.bench,
        benchLabel: item.bench ? benchLabel(config, item.bench, symbols[item.bench]?.name) : null,
        stats: stats[item.key] ?? null,
        syncError: row?.syncError ?? null,
      };
    }),
  }));

  const journal = listJournals(viewer.dir)[0];
  const notices = [
    viewer.shared && !viewer.login ? `正在看 ${viewer.owner} 的列表 · 登录后用自己的` : null,
    config.ignored.length ? `hebi8.yaml 里的 ${config.ignored.join("、")} 是实例设置，只有 ${viewer.owner} 的 vault 里写的生效，这里忽略` : null,
  ].filter((n): n is string => n !== null);
  const data: OverviewData = {
    groups,
    periods: config.periods,
    updown: config.updown,
    conditions: config.conditions.map(({ id, label }) => ({ id, label })),
    lastReviewDays: journal ? daysAgo(journal.mtimeMs) : null,
    lastSync: maxSyncedAt(),
    firstRun,
    vaultPath: path.relative(process.cwd(), viewer.dir) || ".",
    notices,
  };
  return <Overview data={data} />;
}
