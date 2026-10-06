import { NextResponse, type NextRequest } from "next/server";
import { COOKIES, crossSite } from "@/lib/github";
import { deleteSession } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/** 退出: forget the session here (the GitHub authorization itself stays). */
export async function POST(request: NextRequest) {
  if (crossSite(request.headers)) return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  deleteSession(request.cookies.get(COOKIES.session)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIES.session);
  return res;
}
