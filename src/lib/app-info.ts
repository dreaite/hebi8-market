/**
 * Who this app is and where it lives on GitHub. Safe on both server and client: the version,
 * commit and build time are inlined at build time by `next.config.ts`.
 */

/** The one place the source repository is named; everything else derives from it. */
export const REPO = { owner: "Hebi8", name: "hebi8-market" } as const;

export const REPO_FULL_NAME = `${REPO.owner}/${REPO.name}`;
export const REPO_URL = `https://github.com/${REPO_FULL_NAME}`;

/**
 * In-app feedback goes to this repo, as an issue authored by whoever reports it. A fork that
 * wants reports in its own repo sets `HEBI8_FEEDBACK_REPO=owner/name` (read on the server).
 */
export const FEEDBACK_REPO = REPO_FULL_NAME;

/**
 * Client id of the public GitHub App "hebi8-market" (owned by the Hebi8 org, installed on
 * hebi8-market only). The device-flow login needs nothing but this id, so no secret is shipped
 * (an instance that also holds the App's client secret, in `github-oauth.json`, offers the web
 * login, see `src/lib/github.ts`). Empty = in-app login disabled (the 反馈 tab still offers the github.com
 * form). A fork with its own App sets `HEBI8_GITHUB_CLIENT_ID`; `HEBI8_GITHUB_CLIENT_ID=off` turns
 * in-app login off.
 */
export const GITHUB_APP_CLIENT_ID = "Iv23liCniWEUtlDruFJa";

/**
 * Where the instance is public (the Cloudflare tunnel, design §1.6). Metadata, the social images,
 * robots.txt, the sitemap and shared chart links point here even when the page was opened on the
 * tailnet. A fork or another instance sets `HEBI8_PUBLIC_URL`.
 */
export const PUBLIC_URL = "https://market-hebi8.dreaife.tokyo";

/** Label every in-app report carries (added by `.github/workflows/app-feedback.yml`). */
export const FROM_APP_LABEL = "from-app";

const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;

const env = (name: string) => (typeof process === "undefined" ? undefined : process.env[name]?.trim()) || undefined;

/** Where feedback goes: `HEBI8_FEEDBACK_REPO` when it looks like `owner/name`, else `FEEDBACK_REPO`. Server only. */
export function feedbackRepo(): string {
  const v = env("HEBI8_FEEDBACK_REPO");
  return v && REPO_RE.test(v) ? v : FEEDBACK_REPO;
}

/** The GitHub App's client id (`HEBI8_GITHUB_CLIENT_ID` or the constant); empty when not configured or `off`. Server only. */
export function githubClientId(): string {
  const v = env("HEBI8_GITHUB_CLIENT_ID");
  if (v?.toLowerCase() === "off") return "";
  if (v && CLIENT_ID_RE.test(v)) return v;
  return CLIENT_ID_RE.test(GITHUB_APP_CLIENT_ID) ? GITHUB_APP_CLIENT_ID : "";
}

/** `HEBI8_PUBLIC_URL` when it is an http(s) URL, else `PUBLIC_URL`; no trailing slash. Server only. */
export function publicUrl(): string {
  const v = env("HEBI8_PUBLIC_URL");
  return (v && /^https?:\/\/[^/\s]+/.test(v) ? v : PUBLIC_URL).replace(/\/+$/, "");
}

/** The repo's in-app reports on github.com. */
export const fromAppIssuesUrl = (repo: string) => `https://github.com/${repo}/issues?q=${encodeURIComponent(`is:issue label:${FROM_APP_LABEL}`)}`;

/** Attached to feedback and shown to the owner on /usage. */
export const APP_INFO = {
  version: process.env.HEBI8_VERSION ?? "0.0.0",
  commit: process.env.HEBI8_COMMIT ?? "unknown",
  builtAt: process.env.HEBI8_BUILT_AT ?? null,
};
