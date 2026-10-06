import { NextResponse } from "next/server";
import type { SearchHit } from "@/lib/api-types";
import { adapters } from "@/lib/sources";

export const dynamic = "force-dynamic";

/** Yahoo first; TradingView when the query looks like EXCHANGE:SYMBOL or Yahoo finds little; Binance by pattern. */
export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json([]);

  const safe = (p: Promise<SearchHit[]> | undefined) => (p ?? Promise.resolve([])).catch(() => [] as SearchHit[]);
  const [yahoo, binance] = await Promise.all([safe(adapters.yahoo.search?.(q)), safe(adapters.binance.search?.(q))]);
  const tv = q.includes(":") || yahoo.length < 3 ? await safe(adapters.tv.search?.(q)) : [];

  const seen = new Set<string>();
  const hits = [...binance, ...yahoo, ...tv].filter((h) => !seen.has(h.key) && seen.add(h.key));
  return NextResponse.json(hits.slice(0, 20));
}
