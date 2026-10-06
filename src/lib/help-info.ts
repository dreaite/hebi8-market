/** What the help panel shows: project facts, data status and the GitHub setup state. Local reads only. */
import path from "node:path";
import { APP_INFO, DESIGN_DOC_URL, FROM_APP_ISSUES_URL, REPO_FULL_NAME, REPO_URL } from "./app-info";
import { allItems } from "./config";
import { CALLBACK_PATH } from "./github";
import { nameOf } from "./names";
import { nextRun, scheduledNextSync } from "./scheduler";
import { getSession, readApp } from "./secrets";
import { listSymbols, maxSyncedAt } from "./store";
import { ensureVault, readConfigSafe, vaultDir } from "./vault";

export type GitHubSetup = "none" | "created" | "installed";

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
    setup: GitHubSetup;
    appName: string | null;
    appUrl: string | null;
    user: { login: string; avatarUrl: string } | null;
    /** Why login would fail from this origin (its callback URL is not registered) */
    loginProblem: string | null;
  };
}

export function helpInfo(origin: string, sessionId: string | undefined): HelpInfo {
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

  const app = readApp();
  const session = app ? getSession(sessionId) : null;
  const callback = `${origin}${CALLBACK_PATH}`;
  return {
    app: APP_INFO,
    repo: { fullName: REPO_FULL_NAME, url: REPO_URL, designUrl: DESIGN_DOC_URL, issuesUrl: FROM_APP_ISSUES_URL },
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
      setup: !app ? "none" : app.installation_id ? "installed" : "created",
      appName: app?.slug ?? null,
      appUrl: app?.html_url ?? null,
      user: session ? { login: session.login, avatarUrl: session.avatar_url } : null,
      loginProblem: app && app.callback_urls.length && !app.callback_urls.includes(callback) ? `当前地址 ${origin} 不在创建 App 时登记的回调地址里；如果没在 GitHub 上补加 ${callback}，登录会失败` : null,
    },
  };
}
