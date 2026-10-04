import { NextResponse } from "next/server";
import { overviewStats } from "@/lib/stats";
import { listWatchlist, readDaily } from "@/lib/store";
import { syncMany } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  await syncMany(
    listWatchlist().map((s) => s.key),
    force,
  );
  const items = listWatchlist().map((meta) => ({ ...meta, stats: overviewStats(readDaily(meta.key)) }));
  return NextResponse.json({ items });
}
