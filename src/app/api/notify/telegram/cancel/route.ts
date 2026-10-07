import { NextResponse, type NextRequest } from "next/server";
import { notifyCaller } from "@/lib/notify-caller";
import { cancelBinding } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** 取消: the viewer's waiting code stops working; a chat already bound stays. */
export async function POST(request: NextRequest) {
  const caller = notifyCaller(request);
  if (caller instanceof NextResponse) return caller;
  cancelBinding(caller.login);
  return NextResponse.json({ ok: true });
}
