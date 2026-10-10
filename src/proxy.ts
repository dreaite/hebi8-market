import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, cookieOptions } from "./lib/github";
import { SESSION_DAYS, touchSession } from "./lib/secrets";
import { recordRequest } from "./lib/traffic";

/**
 * Counts every request that is not a static file (design §1.7) and keeps a session that is in use
 * alive (§1.6); the request itself goes through untouched. Proxy runs before routing on the
 * Node.js runtime in this process, so it sees pages, Server Actions (POSTs to a page) and API
 * routes alike; the counters are flushed by `src/lib/usage.ts`. Static files and the generated
 * metadata files (icons, the manifest, social images, robots.txt, the sitemap) are not counted.
 */
export function proxy(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  recordRequest({ pathname: request.nextUrl.pathname, headers: request.headers, session });
  // sliding expiry: once a day a session in use is stamped and its cookie set for another 30 days.
  // The login routes set or clear the cookie themselves and are left alone.
  if (!session || request.nextUrl.pathname.startsWith("/api/github/") || !touchSession(session)) return;
  const res = NextResponse.next();
  res.cookies.set(SESSION_COOKIE, session, cookieOptions(SESSION_DAYS * 86400, request.headers));
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon|manifest\\.webmanifest|.*opengraph-image|.*\\.(?:svg|png|jpe?g|gif|webp|ico|css|js|map|txt|xml|woff2?)$).*)"],
};
