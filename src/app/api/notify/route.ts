import { NextResponse, type NextRequest } from "next/server";
import { channelSummary } from "@/lib/notify";
import { notifyCaller } from "@/lib/notify-caller";

export const dynamic = "force-dynamic";

/** The viewer's own channels, masked: chat id's last 4 digits, webhook host. */
export async function GET(request: NextRequest) {
  const caller = notifyCaller(request);
  if (caller instanceof NextResponse) return caller;
  return NextResponse.json(channelSummary(caller.vault, caller.owner), { headers: { "Cache-Control": "no-store" } });
}
