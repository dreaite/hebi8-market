import { NextResponse, type NextRequest } from "next/server";
import type { BarsResponse } from "@/lib/api-types";
import { loadDaily, loadRefs, synthNoData } from "@/lib/bars";
import { findItem } from "@/lib/config";
import { aggregate } from "@/lib/series";
import { pricePrecision } from "@/lib/stats";
import { getSymbol, readQuotes } from "@/lib/store";
import { isSynthetic, isTimeframe, isValidKey, parseKey } from "@/lib/symbols";
import { synthName } from "@/lib/synth";
import { SESSION_COOKIE } from "@/lib/github";
import { readConfigSafe } from "@/lib/vault";
import { resolveViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** Trim float noise from adjusted prices to keep the payload small. */
const round = (x: number) => Number(x.toPrecision(8));

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // names, benchmarks and synthetic aliases come from the viewer's own yaml
  const { config, error } = readConfigSafe(resolveViewer(request.cookies.get(SESSION_COOKIE)?.value).dir);
  if (!config) return NextResponse.json({ error }, { status: 500 });

  const key = params.get("key") ?? "";
  const tf = params.get("tf") ?? config.chart.tf;
  const prices = params.get("prices") ?? config.prices;
  if (!isValidKey(key) || !isTimeframe(tf) || (prices !== "split" && prices !== "total")) {
    return NextResponse.json({ error: "need ?key=<source:ticker>&tf=D|W|M|Q&prices=split|total" }, { status: 400 });
  }
  const withKeys = (params.get("with") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k && k !== key && isValidKey(k));

  const item = findItem(config, key);
  const bench = item?.bench ?? null;
  const row = isSynthetic(key) ? null : getSymbol(key);
  const quote = row ? readQuotes()[key] : undefined;

  let daily;
  try {
    daily = loadDaily(key, prices, config);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  if (daily.length === 0) {
    const why = isSynthetic(key) ? synthNoData(key, config, (k) => getSymbol(k)?.syncError ?? null) : (row?.syncError ?? "暂无数据，等待同步");
    return NextResponse.json({ error: why }, { status: 404 });
  }

  const refKeys = [...withKeys, ...(bench && bench !== key ? [bench] : [])];

  const bars = aggregate(daily, tf);
  const refs = loadRefs(bars, refKeys, tf, prices, config);
  const benchCloses = bench ? refs[bench]?.c : undefined;

  const body: BarsResponse = {
    symbol: {
      key,
      name: item?.name ?? row?.name ?? (isSynthetic(key) ? synthName(key) : parseKey(key).ticker),
      source: isSynthetic(key) ? "expr" : parseKey(key).source,
      ticker: isSynthetic(key) ? synthName(key) : parseKey(key).ticker,
      currency: row?.currency ?? null,
      exchange: row?.exchange ?? null,
      bench,
      syncedAt: row?.syncedAt ?? null,
      syncError: row?.syncError ?? null,
      quote: quote && quote.fetchedAt > (row?.syncedAt ?? 0) ? { session: quote.session, fetchedAt: quote.fetchedAt } : null,
      lastDay: daily[daily.length - 1].t * 1000,
    },
    pricePrecision: pricePrecision(daily[daily.length - 1].c),
    bars: bars.map((b, i) => ({
      timestamp: b.t * 1000,
      open: round(b.o),
      high: round(b.h),
      low: round(b.l),
      close: round(b.c),
      volume: b.v ?? undefined,
      bench: benchCloses?.[i] != null ? round(benchCloses[i]!) : undefined,
    })),
    refs,
  };
  // per person (names, benchmarks and synthetic aliases come from their yaml), so never reused
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
