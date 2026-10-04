import { NextResponse } from "next/server";
import { aggregate, alignCloses } from "@/lib/series";
import { pricePrecision } from "@/lib/stats";
import { ensureSymbol, getSymbol, readDaily } from "@/lib/store";
import { TIMEFRAMES, type Timeframe } from "@/lib/symbols";
import { syncSymbol } from "@/lib/sync";

export const dynamic = "force-dynamic";

/** Trim float noise from adjusted prices to keep the payload small. */
const round = (x: number) => Number(x.toPrecision(8));

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const key = params.get("key");
  const tf = (params.get("tf") ?? "W") as Timeframe;
  const force = params.get("refresh") === "1";

  if (!key || !TIMEFRAMES.includes(tf)) {
    return NextResponse.json({ error: "need ?key=<source:ticker>&tf=D|W|M" }, { status: 400 });
  }
  const meta = getSymbol(key);
  if (!meta) return NextResponse.json({ error: `unknown symbol ${key}` }, { status: 404 });

  const benchKey = meta.benchmark ? ensureSymbol(meta.benchmark).key : null;
  const [own] = await Promise.all([syncSymbol(key, force), benchKey ? syncSymbol(benchKey, force) : null]);

  const daily = readDaily(key);
  if (daily.length === 0) {
    return NextResponse.json({ error: own.error ?? "no data" }, { status: 502 });
  }
  const bars = aggregate(daily, tf);
  const bench = benchKey ? alignCloses(bars, aggregate(readDaily(benchKey), tf)) : null;

  return NextResponse.json({
    symbol: getSymbol(key),
    benchmark: benchKey ? getSymbol(benchKey) : null,
    pricePrecision: pricePrecision(daily[daily.length - 1].c),
    error: own.ok ? null : own.error,
    bars: bars.map((b, i) => ({
      timestamp: b.t * 1000,
      open: round(b.o),
      high: round(b.h),
      low: round(b.l),
      close: round(b.c),
      volume: b.v ?? undefined,
      bench: bench?.[i] !== undefined ? round(bench[i]!) : undefined,
    })),
  });
}
