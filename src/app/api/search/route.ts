import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/github";
import { isCJK, looksLikeYield, needsTv, normalizeQuery, rankExternal, type SearchResult } from "@/lib/search";
import { searchContextFor } from "@/lib/search-context";
import { adapters } from "@/lib/sources";
import type { SearchHit } from "@/lib/sources/types";
import { readConfigSafe } from "@/lib/vault";
import { resolveViewer } from "@/lib/viewer";

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
export async function GET(request: NextRequest) {
  const q = normalizeQuery(request.nextUrl.searchParams.get("q") ?? "");
  if (!q) return NextResponse.json([]);
  const ctx = searchContextFor(readConfigSafe(resolveViewer(request.cookies.get(SESSION_COOKIE)?.value).dir).config);

  // Yahoo rejects CJK outright; Binance pairs are ASCII anyway. `data:` asks only the datasets.
  const ascii = !isCJK(q) && !/^data:/i.test(q);
  const [yahoo, binance, data] = await Promise.all([
    ascii ? safe(adapters.yahoo.search?.(q)) : [],
    ascii ? safe(adapters.binance.search?.(q)) : [],
    safe(adapters.data.search?.(q)),
  ]);
  const tv = needsTv(q, yahoo.length) && !/^data:/i.test(q) ? await searchTv(q) : [];
  const results: SearchResult[] = rankExternal(q, { yahoo, binance, tv, data }, ctx);
  return NextResponse.json(results);
}
