import { NextResponse } from "next/server";
import { isCJK, looksLikeYield, needsTv, normalizeQuery, rankExternal, type SearchResult } from "@/lib/search";
import { searchContextFor } from "@/lib/search-context";
import { adapters } from "@/lib/sources";
import type { SearchHit } from "@/lib/sources/types";
import { readConfigSafe } from "@/lib/vault";

export const dynamic = "force-dynamic";

const safe = (p: Promise<SearchHit[]> | undefined) => (p ?? Promise.resolve([])).catch(() => [] as SearchHit[]);

/** TradingView by category in parallel; an `EXCHANGE:SYMBOL` query goes straight to that exchange. */
async function searchTv(q: string): Promise<SearchHit[]> {
  const tv = adapters.tv.search!;
  if (q.includes(":")) return safe(tv(q));
  const filters = ["index", "cfd", "stock", ...(looksLikeYield(q) ? ["bond"] : [])];
  const lists = await Promise.all(filters.map((f) => safe(tv(q, f))));
  return lists.flat();
}

/** External results only; the watchlist, aliases and dictionary are matched in the browser. */
export async function GET(request: Request) {
  const q = normalizeQuery(new URL(request.url).searchParams.get("q") ?? "");
  if (!q) return NextResponse.json([]);
  const ctx = searchContextFor(readConfigSafe().config);

  // Yahoo rejects CJK outright; Binance pairs are ASCII anyway.
  const ascii = !isCJK(q);
  const [yahoo, binance] = await Promise.all([ascii ? safe(adapters.yahoo.search?.(q)) : [], ascii ? safe(adapters.binance.search?.(q)) : []]);
  const tv = needsTv(q, yahoo.length) ? await searchTv(q) : [];
  const results: SearchResult[] = rankExternal(q, { yahoo, binance, tv }, ctx);
  return NextResponse.json(results);
}
