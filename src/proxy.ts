import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/github";
import { recordRequest } from "./lib/traffic";

/**
 * Counts every request that is not a static file (design §1.7) and lets it through untouched.
 * Proxy runs before routing on the Node.js runtime in this process, so it sees pages, Server
 * Actions (POSTs to a page) and API routes alike; the counters are flushed by `src/lib/usage.ts`.
 * Static files and the generated metadata files (icons, the manifest, social images, robots.txt,
 * the sitemap) are not counted.
 */
export function proxy(request: NextRequest) {
  recordRequest({ pathname: request.nextUrl.pathname, headers: request.headers, session: request.cookies.get(SESSION_COOKIE)?.value });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon|manifest\\.webmanifest|.*opengraph-image|.*\\.(?:svg|png|jpe?g|gif|webp|ico|css|js|map|txt|xml|woff2?)$).*)"],
};
