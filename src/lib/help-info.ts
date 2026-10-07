/** What the help and account drawers need: the feedback setup and the login state. Local reads only. */
import { feedbackRepo, fromAppIssuesUrl, githubClientId } from "./app-info";
import { maySetBot, type Viewer } from "./viewer";

export interface HelpInfo {
  /** The instance is shared: logging in switches to your own vault */
  shared: boolean;
  /** This viewer may set the instance's Telegram bot (an owner, or anyone in single-user mode) */
  canSetBot: boolean;
  /** The feedback repo's in-app reports on github.com */
  issuesUrl: string;
  github: {
    /** A GitHub App client id is configured, so 用 GitHub 登录 (device flow) is offered */
    enabled: boolean;
    /** Where feedback goes (`owner/name`) */
    feedbackRepo: string;
    user: { login: string; avatarUrl: string } | null;
  };
}

export function helpInfo(viewer: Viewer): HelpInfo {
  const enabled = Boolean(githubClientId());
  const repo = feedbackRepo();
  return {
    shared: viewer.shared,
    canSetBot: maySetBot(viewer),
    issuesUrl: fromAppIssuesUrl(repo),
    github: {
      enabled,
      feedbackRepo: repo,
      user: enabled && viewer.login ? { login: viewer.login, avatarUrl: viewer.avatarUrl ?? "" } : null,
    },
  };
}
