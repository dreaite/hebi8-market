import path from "node:path";
import { ConfigErrorView } from "@/components/ConfigErrorView";
import { Overview, type OverviewData, type OverviewRow } from "@/components/Overview";
import { benchLabel, nameOf } from "@/lib/names";
import { hasBars, listSymbols, maxSyncedAt, readAllStats } from "@/lib/store";
import { isSynthetic, parseKey, tickerOf } from "@/lib/symbols";
import { syncAll } from "@/lib/sync";
import { ensureVault, listJournals, readConfigSafe, vaultDir } from "@/lib/vault";

export const dynamic = "force-dynamic";

const daysAgo = (ms: number) => Math.floor((Date.now() - ms) / 86400000);

export default async function Home() {
  ensureVault();
  const { config, error } = readConfigSafe();
  if (!config) return <ConfigErrorView error={error} vaultPath={vaultDir()} />;

  const symbols = listSymbols();
  const stats = readAllStats();
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

  const journal = listJournals()[0];
  const data: OverviewData = {
    groups,
    periods: config.periods,
    updown: config.updown,
    conditions: config.conditions.map(({ id, label }) => ({ id, label })),
    lastReviewDays: journal ? daysAgo(journal.mtimeMs) : null,
    lastSync: maxSyncedAt(),
    firstRun,
    vaultPath: path.relative(process.cwd(), vaultDir()) || ".",
  };
  return <Overview data={data} />;
}
