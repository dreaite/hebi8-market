"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { COOKIES, buildManifest, cookieOptions, encodeCookie, findInstallation, manifestFormAction, normalizeCallbackUrls, randomToken, requestOrigin, type ManifestCookie } from "@/lib/github";
import { readApp, writeApp } from "@/lib/secrets";

export type StartManifestResult = { ok: true; action: string; manifest: string } | { ok: false; error: string };

/**
 * Prepare "在 GitHub 上创建 App": a fresh state in an HttpOnly cookie, and the manifest the
 * browser then POSTs to github.com itself (GitHub needs the user's own session to create it).
 */
export async function startManifest(callbackText: string): Promise<StartManifestResult> {
  try {
    if (readApp()) return { ok: false, error: "已经配置过 GitHub App 了" };
    const origin = requestOrigin(await headers());
    const callbackUrls = normalizeCallbackUrls(String(callbackText).split(/\r?\n/));
    const state = randomToken();
    const cookie: ManifestCookie = { state, callbackUrls };
    // the conversion code GitHub hands back is valid for an hour
    (await cookies()).set(COOKIES.manifest, encodeCookie(cookie), cookieOptions(3600));
    return { ok: true, action: manifestFormAction(state), manifest: JSON.stringify(buildManifest({ origin, callbackUrls })) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** "检查安装": find the installation on the repo with the App's JWT (when the setup redirect did not come back). */
export async function checkInstallation(): Promise<{ ok: boolean; error?: string }> {
  const app = readApp();
  if (!app) return { ok: false, error: "还没有创建 GitHub App" };
  try {
    const installationId = await findInstallation(app);
    writeApp({ ...app, installation_id: installationId });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath("/settings/github");
  return { ok: true };
}
