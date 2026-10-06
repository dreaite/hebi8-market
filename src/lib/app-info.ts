/**
 * Who this app is and where it lives on GitHub. Safe on both server and client: the version,
 * commit and build time are inlined at build time by `next.config.ts`.
 */

/** The one place the source repository is named; everything else derives from it. */
export const REPO = { owner: "dreaite", name: "hebi8-market" } as const;

export const REPO_FULL_NAME = `${REPO.owner}/${REPO.name}`;
export const REPO_URL = `https://github.com/${REPO_FULL_NAME}`;
export const DESIGN_DOC_URL = `${REPO_URL}/blob/master/docs/design.md`;

/**
 * In-app feedback goes to this repo, as an issue authored by whoever reports it. A fork that
 * wants reports in its own repo sets `HEBI8_FEEDBACK_REPO=owner/name` (read on the server).
 */
export const FEEDBACK_REPO = REPO_FULL_NAME;

/**
 * Client id of the public GitHub App "hebi8-market" (owned by the dreaite org, installed on
 * hebi8-market only). Login uses the device flow, which needs nothing but this id, so no secret
 * is shipped or stored. Empty = in-app login disabled (the 反馈 tab still offers the github.com
 * form). A fork with its own App sets `HEBI8_GITHUB_CLIENT_ID`.
 */
export const GITHUB_APP_CLIENT_ID = "";

/** The App's slug, for links to github.com/apps/<slug>; `HEBI8_GITHUB_APP_SLUG` overrides. */
export const GITHUB_APP_SLUG = "hebi8-market";

/** Label every in-app report carries (added by `.github/workflows/app-feedback.yml`). */
export const FROM_APP_LABEL = "from-app";

const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SLUG_RE = /^[a-z0-9-]{1,100}$/;

const env = (name: string) => (typeof process === "undefined" ? undefined : process.env[name]?.trim()) || undefined;

/** Where feedback goes: `HEBI8_FEEDBACK_REPO` when it looks like `owner/name`, else `FEEDBACK_REPO`. Server only. */
export function feedbackRepo(): string {
  const v = env("HEBI8_FEEDBACK_REPO");
  return v && REPO_RE.test(v) ? v : FEEDBACK_REPO;
}

/** The GitHub App's client id (`HEBI8_GITHUB_CLIENT_ID` or the constant); empty when not configured. Server only. */
export function githubClientId(): string {
  const v = env("HEBI8_GITHUB_CLIENT_ID");
  if (v && CLIENT_ID_RE.test(v)) return v;
  return CLIENT_ID_RE.test(GITHUB_APP_CLIENT_ID) ? GITHUB_APP_CLIENT_ID : "";
}

/** The App's slug (`HEBI8_GITHUB_APP_SLUG` or the constant). Server only. */
export function githubAppSlug(): string {
  const v = env("HEBI8_GITHUB_APP_SLUG");
  return v && SLUG_RE.test(v) ? v : GITHUB_APP_SLUG;
}

/** The repo's in-app reports on github.com. */
export const fromAppIssuesUrl = (repo: string) => `https://github.com/${repo}/issues?q=${encodeURIComponent(`is:issue label:${FROM_APP_LABEL}`)}`;

export const APP_INFO = {
  name: "hebi8 market",
  meaning: "hebi（蛇）首尾相衔，七天一个轮回；多出来的第八天，用来观测市场。",
  version: process.env.HEBI8_VERSION ?? "0.0.0",
  commit: process.env.HEBI8_COMMIT ?? "unknown",
  builtAt: process.env.HEBI8_BUILT_AT ?? null,
};
