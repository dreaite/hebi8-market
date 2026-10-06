import { ChartView } from "@/components/ChartView";
import { ConfigErrorView } from "@/components/ConfigErrorView";
import { allItems, findItem } from "@/lib/config";
import { renderMarkdown } from "@/lib/markdown";
import { benchLabel, nameOf } from "@/lib/names";
import { CHANGE_PERIODS } from "@/lib/periods";
import { listSymbols, readAllStats } from "@/lib/store";
import { isValidKey } from "@/lib/symbols";
import { ensureVault, noteMtime, readChartState, readConfigSafe, readNote, vaultDir } from "@/lib/vault";

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

  // display names for everything the chart may show: yaml name > dictionary > source
  const names: Record<string, string> = {};
  for (const k of [...Object.keys(symbols), ...allItems(config).map((i) => i.key), ...state.compare.map((c) => c.key), key]) {
    names[k] = nameOf(config, k, symbols[k]?.name);
  }
  // the watchlist in yaml order and groups, for the side panel and Space / Shift+Space
  const stats = readAllStats();
  const period = config.periods[0] ?? "1W";
  const watchlist = config.groups.map((g) => ({
    name: g.name,
    items: g.symbols.map((i) => ({ key: i.key, name: names[i.key], last: stats[i.key]?.last ?? null, change: stats[i.key]?.changes[period] ?? null })),
  }));

  return (
    <ChartView
      key={key}
      symbolKey={key}
      prefs={config.chart}
      prices={config.prices}
      formulas={config.indicators}
      aliases={config.aliases}
      bench={item?.bench ?? null}
      benchLabel={item?.bench ? benchLabel(config, item.bench, symbols[item.bench]?.name) : null}
      names={names}
      watchlist={watchlist}
      changeLabel={CHANGE_PERIODS.find((p) => p.key === period)?.label ?? period}
      chartState={state}
      note={note}
      noteHtml={note ? renderMarkdown(note) : null}
      noteSavedAt={noteMtime(key)}
    />
  );
}
