import { NextResponse, type NextRequest } from "next/server";
import { COOKIES, convertManifest, decodeCookie, requestOrigin, sameSecret, type ManifestCookie } from "@/lib/github";
import { writeApp } from "@/lib/secrets";

export const dynamic = "force-dynamic";

const back = (request: NextRequest, error: string) => {
  const url = new URL("/settings/github", requestOrigin(request.headers));
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
};

/**
 * GitHub sends the browser here after "Create GitHub App": check the state from the settings
 * page, trade the code for the App's credentials, store them, then go install the App.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code) return back(request, "GitHub 没有带回 code");
  const saved = decodeCookie<ManifestCookie>(request.cookies.get(COOKIES.manifest)?.value);
  if (!sameSecret(state, saved.state)) {
    return back(request, "state 不匹配：请从本页重新点「在 GitHub 上创建 App」");
  }
  let slug: string;
  try {
    const conv = await convertManifest(code);
    writeApp({
      id: conv.id,
      slug: conv.slug,
      client_id: conv.client_id,
      client_secret: conv.client_secret,
      pem: conv.pem,
      webhook_secret: conv.webhook_secret ?? null,
      owner: conv.owner?.login ?? "",
      html_url: conv.html_url,
      callback_urls: Array.isArray(saved.callbackUrls) ? saved.callbackUrls : [],
      installation_id: null,
    });
    slug = conv.slug;
  } catch (err) {
    return back(request, err instanceof Error ? err.message : String(err));
  }
  const res = NextResponse.redirect(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`);
  res.cookies.delete(COOKIES.manifest);
  return res;
}
