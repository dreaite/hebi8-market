/** What the global search needs from the vault and the cache; built on the server, shipped to the client. */
import { allItems, type Config } from "./config";
import type { SearchContext } from "./search";
import { listSymbols } from "./store";
import { tickerOf } from "./symbols";
import { displayName } from "./wellknown";

export function searchContextFor(cfg: Config | null): SearchContext {
  if (!cfg) return { watchlist: [], aliases: {}, groups: [] };
  const names = listSymbols();
  return {
    watchlist: allItems(cfg).map((i) => ({ key: i.key, name: displayName(i.key, i.name, names[i.key]?.name), ticker: tickerOf(i.key), group: i.group })),
    aliases: cfg.aliases,
    groups: cfg.groups.map((g) => g.name),
  };
}
