import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/github";
import { normalizeQuery } from "@/lib/search";
import { searchContextFor } from "@/lib/search-context";
import { searchExternal } from "@/lib/search-external";
import { readConfigSafe } from "@/lib/vault";
import { resolveViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** External results only; the watchlist, aliases and dictionary are matched in the browser. */
export async function GET(request: NextRequest) {
  const q = normalizeQuery(request.nextUrl.searchParams.get("q") ?? "");
  if (!q) return NextResponse.json([]);
  const ctx = searchContextFor(readConfigSafe(resolveViewer(request.cookies.get(SESSION_COOKIE)?.value).dir).config);
  return NextResponse.json(await searchExternal(q, ctx));
}
