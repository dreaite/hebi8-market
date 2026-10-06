import { ConfigErrorView } from "@/components/ConfigErrorView";
import { Overview, type OverviewData, type OverviewRow } from "@/components/Overview";
import { hasBars, listSymbols, maxSyncedAt, readAllStats } from "@/lib/store";
import { isSynthetic, parseKey } from "@/lib/symbols";
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
      const synthetic = isSynthetic(item.key);
      const ticker = synthetic ? item.key.slice(1) : parseKey(item.key).ticker;
      return {
        key: item.key,
        name: item.name ?? row?.name ?? ticker,
        ticker,
        source: synthetic ? "expr" : parseKey(item.key).source,
        currency: row?.currency ?? stats[item.key]?.currency ?? null,
        bench: item.bench,
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
    vaultPath: vaultDir(),
  };
  return <Overview data={data} />;
}
