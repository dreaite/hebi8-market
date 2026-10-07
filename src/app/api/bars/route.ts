import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { BarsResponse } from "@/lib/api-types";
import { loadDaily, loadRefs } from "@/lib/bars";
import { findItem } from "@/lib/config";
import { aggregate } from "@/lib/series";
import { pricePrecision } from "@/lib/stats";
import { getSymbol, maxSyncedAt } from "@/lib/store";
import { isSynthetic, isTimeframe, isValidKey, parseKey } from "@/lib/symbols";
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

  let daily;
  try {
    daily = loadDaily(key, prices, config);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  if (daily.length === 0) {
    return NextResponse.json({ error: row?.syncError ?? "暂无数据，等待同步" }, { status: 404 });
  }

  const refKeys = [...withKeys, ...(bench && bench !== key ? [bench] : [])];
  const stamp = [key, tf, prices, refKeys.join(","), maxSyncedAt() ?? 0, daily.length].join("|");
  const etag = `"${createHash("sha1").update(stamp).digest("hex").slice(0, 16)}"`;
  const headers = { ETag: etag, "Cache-Control": "no-cache" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const bars = aggregate(daily, tf);
  const refs = loadRefs(bars, refKeys, tf, prices, config);
  const benchCloses = bench ? refs[bench]?.c : undefined;

  const body: BarsResponse = {
    symbol: {
      key,
      name: item?.name ?? row?.name ?? (isSynthetic(key) ? key.slice(1) : parseKey(key).ticker),
      source: isSynthetic(key) ? "expr" : parseKey(key).source,
      ticker: isSynthetic(key) ? key.slice(1) : parseKey(key).ticker,
      currency: row?.currency ?? null,
      bench,
      syncedAt: row?.syncedAt ?? null,
      syncError: row?.syncError ?? null,
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
  return NextResponse.json(body, { headers });
}
