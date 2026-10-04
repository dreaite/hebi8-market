import { NextResponse } from "next/server";
import {
  addToWatchlist,
  deleteSymbol,
  ensureSymbol,
  getSymbol,
  listWatchlist,
  readDaily,
  removeFromWatchlist,
} from "@/lib/store";
import { isSource, makeKey, normalizeTicker, parseKey } from "@/lib/symbols";
import { syncSymbol } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ items: listWatchlist() });
}

/** Add or update a symbol: { source, ticker, name?, benchmark? }. The first sync doubles as validation. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { source } = body;
  const ticker = typeof body.ticker === "string" ? normalizeTicker(body.ticker) : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const benchmark = typeof body.benchmark === "string" ? body.benchmark.trim() : "";

  if (!isSource(source) || !ticker) {
    return NextResponse.json({ error: "需要 source（yahoo / binance / tv）和 ticker" }, { status: 400 });
  }
  if (benchmark) {
    try {
      parseKey(benchmark);
    } catch {
      return NextResponse.json({ error: "基准格式应为 source:ticker，例如 yahoo:SPY" }, { status: 400 });
    }
  }

  const key = makeKey(source, ticker);
  const existed = getSymbol(key) !== null;
  const meta = addToWatchlist({ source, ticker, name, benchmark: benchmark || null });

  const outcome = await syncSymbol(key, true);
  if (!outcome.ok && readDaily(key).length === 0) {
    if (existed) removeFromWatchlist(key);
    else deleteSymbol(key);
    return NextResponse.json({ error: `拉取 ${key} 失败：${outcome.error}` }, { status: 400 });
  }

  let warning: string | undefined;
  if (benchmark) {
    const benchOutcome = await syncSymbol(ensureSymbol(benchmark).key);
    if (!benchOutcome.ok) warning = `基准 ${benchmark} 拉取失败：${benchOutcome.error}`;
  }
  return NextResponse.json({ item: getSymbol(meta.key), warning }, { status: 201 });
}

export async function DELETE(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key || !getSymbol(key)) return NextResponse.json({ error: "unknown symbol" }, { status: 404 });
  removeFromWatchlist(key);
  return NextResponse.json({ ok: true });
}
