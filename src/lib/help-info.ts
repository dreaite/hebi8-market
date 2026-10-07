/** What the help panel shows: project facts, data status and the feedback / login state. Local reads only. */
import path from "node:path";
import { APP_INFO, DESIGN_DOC_URL, REPO_FULL_NAME, REPO_URL, feedbackRepo, fromAppIssuesUrl, githubAppSlug, githubClientId } from "./app-info";
import { allItems } from "./config";
import { nameOf } from "./names";
import { nextRun, scheduledNextSync } from "./scheduler";
import { listSymbols, maxSyncedAt } from "./store";
import { readConfigSafe, vaultDir } from "./vault";
import { maySetBot, type Viewer } from "./viewer";

export interface HelpInfo {
  app: typeof APP_INFO;
  /** The instance is shared: logging in switches to your own vault */
  shared: boolean;
  /** This viewer may set the instance's Telegram bot (an owner, or anyone in single-user mode) */
  canSetBot: boolean;
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

export function helpInfo(viewer: Viewer): HelpInfo {
  const { config, error: configError } = readConfigSafe(viewer.dir);
  const schedule = readConfigSafe(vaultDir()).config?.sync ?? null;

  let symbols: ReturnType<typeof listSymbols> = {};
  let lastSync: number | null = null;
  try {
    symbols = listSymbols();
    lastSync = maxSyncedAt();
  } catch {
    // cache unavailable: the overview reports it
  }
  const watched = config ? allItems(config) : [];
  const nextSync = scheduledNextSync() ?? (schedule ? nextRun(new Date(), schedule.at, schedule.tz).getTime() : null);
  const errors = Object.values(symbols)
    .filter((s) => s.syncError)
    .map((s) => ({ key: s.key, name: config ? nameOf(config, s.key, s.name) : (s.name ?? s.key), error: s.syncError! }));

  const enabled = Boolean(githubClientId());
  const repo = feedbackRepo();
  return {
    app: APP_INFO,
    shared: viewer.shared,
    canSetBot: maySetBot(viewer),
    repo: { fullName: REPO_FULL_NAME, url: REPO_URL, designUrl: DESIGN_DOC_URL, issuesUrl: fromAppIssuesUrl(repo) },
    data: {
      watched: watched.length,
      cached: Object.keys(symbols).length,
      lastSync,
      nextSync,
      schedule: schedule ? `${schedule.at.join(" ")} ${schedule.tz}` : null,
      errors,
      vaultPath: path.relative(process.cwd(), viewer.dir) || ".",
      configError,
    },
    github: {
      enabled,
      feedbackRepo: repo,
      appUrl: `https://github.com/apps/${githubAppSlug()}`,
      user: enabled && viewer.login ? { login: viewer.login, avatarUrl: viewer.avatarUrl ?? "" } : null,
    },
  };
}
