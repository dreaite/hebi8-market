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
    /** A GitHub App client id is configured, so 用 GitHub 登录 is offered */
    enabled: boolean;
    /** This origin has the web login (a redirect to github.com); without it 用 GitHub 登录 is the device flow */
    webLogin: boolean;
    /** Where feedback goes (`owner/name`) */
    feedbackRepo: string;
    /** `token`: the session holds a GitHub token, so feedback can be submitted in the app (a login carried over from another device has none) */
    user: { login: string; avatarUrl: string; token: boolean } | null;
  };
}

export function helpInfo(viewer: Viewer, { webLogin, token }: { webLogin: boolean; token: boolean }): HelpInfo {
  const enabled = Boolean(githubClientId());
  const repo = feedbackRepo();
  return {
    shared: viewer.shared,
    canSetBot: maySetBot(viewer),
    issuesUrl: fromAppIssuesUrl(repo),
    github: {
      enabled,
      webLogin,
      feedbackRepo: repo,
      user: enabled && viewer.login ? { login: viewer.login, avatarUrl: viewer.avatarUrl ?? "", token } : null,
    },
  };
}
