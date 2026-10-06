/** What the help panel shows: project facts, data status and the feedback / login state. Local reads only. */
import path from "node:path";
import { APP_INFO, DESIGN_DOC_URL, REPO_FULL_NAME, REPO_URL, feedbackRepo, fromAppIssuesUrl, githubAppSlug, githubClientId } from "./app-info";
import { allItems } from "./config";
import { nameOf } from "./names";
import { nextRun, scheduledNextSync } from "./scheduler";
import { getSession } from "./secrets";
import { listSymbols, maxSyncedAt } from "./store";
import { ensureVault, readConfigSafe, vaultDir } from "./vault";

export interface HelpInfo {
  app: typeof APP_INFO;
  repo: { fullName: string; url: string; designUrl: string; issuesUrl: string };
  data: {
    watched: number;
    cached: number;
    lastSync: number | null;
    nextSync: number | null;
    schedule: string | null;
    errors: { key: string; name: string; error: string }[];
    vaultPath: string;
    configError: string | null;
  };
  github: {
    /** A GitHub App client id is configured, so 用 GitHub 登录 (device flow) is offered */
    enabled: boolean;
    /** Where feedback goes (`owner/name`) */
    feedbackRepo: string;
    /** github.com/apps/<slug> */
    appUrl: string;
    user: { login: string; avatarUrl: string } | null;
  };
}

export function helpInfo(sessionId: string | undefined): HelpInfo {
  let config = null;
  let configError: string | null = null;
  try {
    ensureVault();
    ({ config, error: configError } = readConfigSafe());
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }

  let symbols: ReturnType<typeof listSymbols> = {};
  let lastSync: number | null = null;
  try {
    symbols = listSymbols();
    lastSync = maxSyncedAt();
  } catch {
    // cache unavailable: the overview reports it
  }
  const watched = config ? allItems(config) : [];
  const nextSync = scheduledNextSync() ?? (config ? nextRun(new Date(), config.sync.at, config.sync.tz).getTime() : null);
  const errors = Object.values(symbols)
    .filter((s) => s.syncError)
    .map((s) => ({ key: s.key, name: config ? nameOf(config, s.key, s.name) : (s.name ?? s.key), error: s.syncError! }));

  const enabled = Boolean(githubClientId());
  const session = enabled ? getSession(sessionId) : null;
  const repo = feedbackRepo();
  return {
    app: APP_INFO,
    repo: { fullName: REPO_FULL_NAME, url: REPO_URL, designUrl: DESIGN_DOC_URL, issuesUrl: fromAppIssuesUrl(repo) },
    data: {
      watched: watched.length,
      cached: Object.keys(symbols).length,
      lastSync,
      nextSync,
      schedule: config ? `${config.sync.at.join(" ")} ${config.sync.tz}` : null,
      errors,
      vaultPath: path.relative(process.cwd(), vaultDir()) || ".",
      configError,
    },
    github: {
      enabled,
      feedbackRepo: repo,
      appUrl: `https://github.com/apps/${githubAppSlug()}`,
      user: session ? { login: session.login, avatarUrl: session.avatar_url } : null,
    },
  };
}
