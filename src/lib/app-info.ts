/**
 * Who this app is and where it lives on GitHub. Safe on both server and client: the version,
 * commit and build time are inlined at build time by `next.config.ts`.
 */

/** The one place the GitHub repository is named; everything else derives from it. */
export const REPO = { owner: "dreaite", name: "hebi8-market" } as const;

export const REPO_FULL_NAME = `${REPO.owner}/${REPO.name}`;
export const REPO_URL = `https://github.com/${REPO_FULL_NAME}`;
export const DESIGN_DOC_URL = `${REPO_URL}/blob/master/docs/design.md`;

/** Label every in-app report carries; the issue list link filters by it. */
export const FROM_APP_LABEL = "from-app";
export const FROM_APP_ISSUES_URL = `${REPO_URL}/issues?q=${encodeURIComponent(`is:issue label:${FROM_APP_LABEL}`)}`;

export const APP_INFO = {
  name: "hebi8 market",
  meaning: "hebi（蛇）首尾相衔，七天一个轮回；多出来的第八天，用来观测市场。",
  version: process.env.HEBI8_VERSION ?? "0.0.0",
  commit: process.env.HEBI8_COMMIT ?? "unknown",
  builtAt: process.env.HEBI8_BUILT_AT ?? null,
};

/**
 * The addresses this app is served from (Tailscale IP and MagicDNS, live and preview). Each gets a
 * callback URL in the GitHub App so logging in works from any of them; `HEBI8_ORIGINS`
 * (comma-separated) replaces the list.
 */
export const DEFAULT_ORIGINS = [
  "http://100.92.194.31:8808",
  "http://homenucserver.taild8a15d.ts.net:8808",
  "http://100.92.194.31:8809",
  "http://homenucserver.taild8a15d.ts.net:8809",
];
