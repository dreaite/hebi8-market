import { NextResponse, type NextRequest } from "next/server";
import { symbolStatus } from "@/lib/quotes";
import { isValidKey } from "@/lib/symbols";

export const dynamic = "force-dynamic";

/** The chart's status strip between bar loads: sync time and error, the latest quote. Never touches the network. */
export function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (!isValidKey(key)) return NextResponse.json({ error: "need ?key=<source:ticker>" }, { status: 400 });
  return NextResponse.json(symbolStatus(key), { headers: { "Cache-Control": "no-store" } });
}
