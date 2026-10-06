import { ChartView } from "@/components/ChartView";
import { ConfigErrorView } from "@/components/ConfigErrorView";
import { findItem } from "@/lib/config";
import { renderMarkdown } from "@/lib/markdown";
import { listSymbols } from "@/lib/store";
import { isSynthetic, isValidKey, parseKey } from "@/lib/symbols";
import { ensureVault, readChartState, readConfigSafe, readNote, vaultDir } from "@/lib/vault";

export const dynamic = "force-dynamic";

/** Keys are URL-encoded in links (`yahoo%3ASPY`, `%3DBTC%2FGOLD`); Next decodes most of it already. */
function decodeKey(raw: string): string {
  try {
    return raw.includes("%") ? decodeURIComponent(raw) : raw;
  } catch {
    return raw;
  }
}

export default async function ChartPage({ params }: { params: Promise<{ key: string }> }) {
  const key = decodeKey((await params).key);
  ensureVault();
  const { config, error } = readConfigSafe();
  if (!config) return <ConfigErrorView error={error} vaultPath={vaultDir()} />;
  if (!isValidKey(key)) return <main className="p-6 text-sm text-muted">无效的 key「{key}」，例如 /chart/yahoo%3ASPY</main>;

  const item = findItem(config, key);
  const symbols = listSymbols();
  const state = readChartState(key);
  const note = readNote(key);

  // display names for everything the chart may show
  const names: Record<string, string> = {};
  for (const [k, row] of Object.entries(symbols)) names[k] = row.name ?? row.ticker;
  for (const g of config.groups) for (const s of g.symbols) if (s.name) names[s.key] = s.name;
  for (const c of state.compare) names[c.key] ??= isSynthetic(c.key) ? c.key.slice(1) : parseKey(c.key).ticker;

  return (
    <ChartView
      key={key}
      symbolKey={key}
      prefs={config.chart}
      prices={config.prices}
      formulas={config.indicators}
      aliases={config.aliases}
      bench={item?.bench ?? null}
      names={names}
      chartState={state}
      note={note}
      noteHtml={note ? renderMarkdown(note) : null}
    />
  );
}
