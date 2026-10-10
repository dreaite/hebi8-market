/**
 * Who is asking and which vault they see (design §1.6). Single-user mode (no `owner` in the root
 * yaml): everyone reads and writes the root vault. Shared: the owner gets the root vault, anyone
 * else logged in gets `users/<login>/`, and visitors who are not logged in read the root vault.
 * Every page, route and action resolves this first; vault paths only ever come from here.
 * An agent has no cookie: its personal token resolves to the same viewer its owner gets when
 * logged in (`tokenViewer`), read only when the token is.
 */
import { cookies } from "next/headers";
import { isLogin } from "./config";
import { SESSION_COOKIE } from "./github";
import { checkToken, getSession } from "./secrets";
import { ensureUserVault, ensureVault, readConfigSafe, vaultDir } from "./vault";

export interface Viewer {
  /** '' for the root vault, else the login in lower case: the `vault` column in the cache */
  vault: string;
  dir: string;
  /** The logged-in GitHub user, as GitHub spells it */
  login: string | null;
  avatarUrl: string | null;
  canWrite: boolean;
  /** Logged in as one of the root yaml's `owner` logins */
  isOwner: boolean;
  /** The root yaml names an owner, so people log in to get their own vault */
  shared: boolean;
  owner: string | null;
}

/** What `user` (null: nobody logged in) sees and may change. */
function viewerFor(user: { login: string; avatarUrl: string | null } | null): Viewer {
  ensureVault();
  const root = vaultDir();
  const base = { login: user?.login ?? null, avatarUrl: user?.avatarUrl ?? null };
  const { config } = readConfigSafe(root);
  // a broken root yaml hides whether the instance is shared: read only until it is fixed
  if (!config) return { ...base, vault: "", dir: root, canWrite: false, isOwner: false, shared: false, owner: null };
  const owner = config.owner;
  if (!owner) return { ...base, vault: "", dir: root, canWrite: true, isOwner: false, shared: false, owner: null };
  const shared = { ...base, shared: true, owner };
  if (!user) return { ...shared, vault: "", dir: root, canWrite: false, isOwner: false };
  if (config.owners.some((o) => o.toLowerCase() === user.login.toLowerCase())) return { ...shared, vault: "", dir: root, canWrite: true, isOwner: true };
  return { ...shared, vault: user.login.toLowerCase(), dir: ensureUserVault(user.login), canWrite: true, isOwner: false };
}

export function resolveViewer(sessionId: string | undefined): Viewer {
  const session = getSession(sessionId);
  // a session file is hand-editable; a login that is not a GitHub login is nobody
  return viewerFor(session && isLogin(session.login) ? { login: session.login, avatarUrl: session.avatar_url } : null);
}

/**
 * The viewer a bearer token stands for, null when it is no token of this instance (missing,
 * unknown, revoked). The one place a token becomes a viewer: whoever made it, in the vault they
 * get when logged in (the root vault in single-user mode), and unable to write when the token is
 * read only. A token made before the instance was shared belongs to nobody.
 */
export function tokenViewer(token: string | undefined): Viewer | null {
  const record = checkToken(token);
  if (!record) return null;
  const viewer = viewerFor(isLogin(record.login) ? { login: record.login, avatarUrl: null } : null);
  if (viewer.shared && !viewer.login) return null;
  return { ...viewer, canWrite: viewer.canWrite && record.write };
}

/** The viewer of the current request (pages, layouts, Server Actions). */
export async function getViewer(): Promise<Viewer> {
  return resolveViewer((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Whoever may change the instance's settings from the page (the bot): an owner, or anyone in single-user mode. */
export const maySetBot = (viewer: Viewer) => viewer.isOwner || (!viewer.shared && viewer.canWrite);

/** Whose tokens a viewer makes and sees: their login on a shared instance, nobody's (null) in single-user mode. */
export const tokenOwner = (viewer: Viewer): string | null => (viewer.shared ? viewer.login : null);

/** The viewer, refused unless they may change their vault. */
export function requireWriter(viewer: Viewer): Viewer {
  if (!viewer.canWrite) throw new Error("请先登录");
  return viewer;
}
