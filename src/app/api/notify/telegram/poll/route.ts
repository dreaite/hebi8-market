import { NextResponse, type NextRequest } from "next/server";
import { notifyCaller } from "@/lib/notify-caller";
import { bindingStatus } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Whether the viewer's `/start` has reached the bot yet; the panel asks every few seconds. */
export async function POST(request: NextRequest) {
  const caller = notifyCaller(request);
  if (caller instanceof NextResponse) return caller;
  const result = bindingStatus(caller.login);
  // the chat id stays on the server; the panel re-reads the masked summary
  return NextResponse.json(result.status === "bound" ? { status: "bound" } : result, { headers: { "Cache-Control": "no-store" } });
}
