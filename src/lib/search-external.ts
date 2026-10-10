/**
 * The external layer of the symbol search (design §5.4): Yahoo, Binance, TradingView and the
 * datasets asked over the network, then filtered and ranked. Server only; `/api/search` and the
 * MCP tool share it.
 */
import { filterYahoo, isCJK, looksLikeYield, needsTv, rankExternal, type SearchContext, type SearchResult } from "./search";
import { adapters } from "./sources";
import type { SearchHit } from "./sources/types";

const safe = (p: Promise<SearchHit[]> | undefined) => (p ?? Promise.resolve([])).catch(() => [] as SearchHit[]);

/** TradingView by category in parallel; an `EXCHANGE:SYMBOL` query goes straight to that exchange. */
async function searchTv(q: string): Promise<SearchHit[]> {
  const tv = adapters.tv.search!;
  if (q.includes(":")) return safe(tv(q));
  const filters = ["index", "cfd", "stock", ...(looksLikeYield(q) ? ["bond"] : [])];
  const lists = await Promise.all(filters.map((f) => safe(tv(q, f))));
  return lists.flat();
}

/** External results for a normalized, non-empty query; a source that fails just has none. */
export async function searchExternal(q: string, ctx: SearchContext): Promise<SearchResult[]> {
  // Yahoo rejects CJK outright; Binance pairs are ASCII anyway. `data:` asks only the datasets.
  const ascii = !isCJK(q) && !/^data:/i.test(q);
  const [yahoo, binance, data] = await Promise.all([
    ascii ? safe(adapters.yahoo.search?.(q)) : [],
    ascii ? safe(adapters.binance.search?.(q)) : [],
    safe(adapters.data.search?.(q)),
  ]);
  // counted after filtering: COPPER finds only futures on Yahoo, which are all dropped
  const tv = needsTv(q, filterYahoo(q, yahoo).length) && !/^data:/i.test(q) ? await searchTv(q) : [];
  return rankExternal(q, { yahoo, binance, tv, data }, ctx);
}
