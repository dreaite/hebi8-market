import { NextResponse, type NextRequest } from "next/server";
import { COOKIES, requestOrigin } from "@/lib/github";
import { helpInfo } from "@/lib/help-info";

export const dynamic = "force-dynamic";

/** The help panel's data: project facts, sync status, GitHub setup and login. Never touches the network. */
export async function GET(request: NextRequest) {
  const info = helpInfo(requestOrigin(request.headers), request.cookies.get(COOKIES.session)?.value);
  return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
}
