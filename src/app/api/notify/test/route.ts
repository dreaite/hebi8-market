import { NextResponse, type NextRequest } from "next/server";
import { channelNames, channelsFor, deliver, testDigest } from "@/lib/notify";
import { notifyCaller } from "@/lib/notify-caller";

export const dynamic = "force-dynamic";

/** 发测试消息 to every channel the viewer's alerts would go to. */
export async function POST(request: NextRequest) {
  const caller = notifyCaller(request);
  if (caller instanceof NextResponse) return caller;
  const { config } = channelsFor(caller.vault, caller.owner);
  if (channelNames(config).length === 0) return NextResponse.json({ error: "还没有可用的通知通道" }, { status: 409 });
  const { title, text } = testDigest(config.link);
  return NextResponse.json(await deliver(config, title, text));
}
