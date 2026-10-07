/**
 * Who is asking and which vault they see (design §1.6). Single-user mode (no `owner` in the root
 * yaml): everyone reads and writes the root vault. Shared: the owner gets the root vault, anyone
 * else logged in gets `users/<login>/`, and visitors who are not logged in read the root vault.
 * Every page, route and action resolves this first; vault paths only ever come from here.
 */
import { cookies } from "next/headers";
import { isLogin } from "./config";
import { SESSION_COOKIE } from "./github";
import { getSession } from "./secrets";
import { ensureUserVault, ensureVault, readConfigSafe, vaultDir } from "./vault";

export interface Viewer {
  /** '' for the root vault, else the login in lower case: the `vault` column in the cache */
  vault: string;
  dir: string;
  /** The logged-in GitHub user, as GitHub spells it */
  login: string | null;
  avatarUrl: string | null;
  canWrite: boolean;
  /** Logged in as the root yaml's `owner` */
  isOwner: boolean;
  /** The root yaml names an owner, so people log in to get their own vault */
  shared: boolean;
  owner: string | null;
}

export function resolveViewer(sessionId: string | undefined): Viewer {
  ensureVault();
  const root = vaultDir();
  const session = getSession(sessionId);
  // a session file is hand-editable; a login that is not a GitHub login is nobody
  const user = session && isLogin(session.login) ? { login: session.login, avatarUrl: session.avatar_url } : null;
  const base = { login: user?.login ?? null, avatarUrl: user?.avatarUrl ?? null };
  const { config } = readConfigSafe(root);
  // a broken root yaml hides whether the instance is shared: read only until it is fixed
  if (!config) return { ...base, vault: "", dir: root, canWrite: false, isOwner: false, shared: false, owner: null };
  const owner = config.owner;
  if (!owner) return { ...base, vault: "", dir: root, canWrite: true, isOwner: false, shared: false, owner: null };
  const shared = { ...base, shared: true, owner };
  if (!user) return { ...shared, vault: "", dir: root, canWrite: false, isOwner: false };
  if (user.login.toLowerCase() === owner.toLowerCase()) return { ...shared, vault: "", dir: root, canWrite: true, isOwner: true };
  return { ...shared, vault: user.login.toLowerCase(), dir: ensureUserVault(user.login), canWrite: true, isOwner: false };
}

/** The viewer of the current request (pages, layouts, Server Actions). */
export async function getViewer(): Promise<Viewer> {
  return resolveViewer((await cookies()).get(SESSION_COOKIE)?.value);
}

/** The viewer, refused unless they may change their vault. */
export function requireWriter(viewer: Viewer): Viewer {
  if (!viewer.canWrite) throw new Error("请先登录");
  return viewer;
}
