import { NextResponse, type NextRequest } from "next/server";
import { channelSummary, setUserChannel } from "@/lib/notify";
import { notifyCaller } from "@/lib/notify-caller";
import { cancelBinding, instanceBot, startBinding } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** 绑定 Telegram: a one-time code for the viewer and the t.me link that hands it to the bot. */
export async function POST(request: NextRequest) {
  const caller = notifyCaller(request);
  if (caller instanceof NextResponse) return caller;
  if (!instanceBot()) return NextResponse.json({ error: "这台 hebi8/market 没有配置 Telegram bot（notify.json 的 telegram.token），请找部署的人" }, { status: 409 });
  try {
    return NextResponse.json(await startBinding(caller.login), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

/** 解除绑定, including a code still waiting to be used */
export async function DELETE(request: NextRequest) {
  const caller = notifyCaller(request);
  if (caller instanceof NextResponse) return caller;
  cancelBinding(caller.login);
  setUserChannel(caller.login, "telegram", null);
  return NextResponse.json(channelSummary(caller.vault, caller.owner));
}
