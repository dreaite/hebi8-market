/**
 * Secrets live outside the repo, the vault and the data dir, in `HEBI8_SECRETS` or
 * `~/.config/hebi8/market` (mode 700): GitHub login sessions in `sessions.json` and each person's
 * notification channels in `notify-users.json`, written atomically with mode 600, and the
 * instance's notification settings in `notify.json` and the web login's client in
 * `github-oauth.json`, written by hand. Nothing in here is ever logged or sent to the browser.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function secretsDir(): string {
  return process.env.HEBI8_SECRETS ?? path.join(os.homedir(), ".config", "hebi8", "market");
}

function ensureDir(): string {
  const dir = secretsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

export function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(secretsDir(), name), "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJson(name: string, value: unknown): void {
  const file = path.join(ensureDir(), name);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------- user sessions

export interface Session {
  login: string;
  avatar_url: string;
  /** null for a login carried over from another device (`src/lib/claim.ts`): who it is holds, in-app feedback needs a GitHub login */
  access_token: string | null;
  /** ms; null when the App does not expire user tokens */
  access_expires_at: number | null;
  refresh_token: string | null;
  refresh_expires_at: number | null;
  created_at: number;
  /** ms; the last use, moved at most once a day (`touchSession`). Sessions from before it existed go by `created_at` */
  seen_at?: number;
  /** Client id of the web login (`github-oauth.json`) that issued the tokens; absent = the device flow's client */
  web_client?: string;
}

const SESSIONS_FILE = "sessions.json";
/** A session lasts until it has gone unused this long */
export const SESSION_DAYS = 30;
const DAY_MS = 86400000;
const ID_RE = /^[A-Za-z0-9_-]{20,100}$/;

function readSessions(): Record<string, Session> {
  return readJson<Record<string, Session>>(SESSIONS_FILE) ?? {};
}

const seenAt = (s: Session) => s.seen_at ?? s.created_at;

/**
 * Sessions unused for 30 days are dropped on every write. The GitHub tokens do not count: who
 * someone is rests on the session alone, and a token that ran out only stops in-app feedback.
 */
function live(all: Record<string, Session>, now = Date.now()): Record<string, Session> {
  return Object.fromEntries(Object.entries(all).filter(([, s]) => now - seenAt(s) <= SESSION_DAYS * DAY_MS));
}

/** Every live session in one read of the file, for looking many ids up at once. */
export const liveSessions = (): Record<string, Session> => live(readSessions());

export function getSession(id: string | undefined): Session | null {
  if (!id || !ID_RE.test(id)) return null;
  const s = readSessions()[id];
  return s && live({ [id]: s })[id] ? s : null;
}

export function createSession(session: Omit<Session, "created_at" | "seen_at">): string {
  const id = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  writeJson(SESSIONS_FILE, { ...live(readSessions()), [id]: { ...session, created_at: now, seen_at: now } });
  return id;
}

/**
 * Sliding expiry: a live session last seen more than a day ago is seen now. True when it was
 * moved, which is when its cookie is due for another 30 days too; so one write a day per session.
 */
export function touchSession(id: string | undefined, now = Date.now()): boolean {
  if (!id || !ID_RE.test(id)) return false;
  const all = live(readSessions(), now);
  const s = all[id];
  if (!s || now - seenAt(s) < DAY_MS) return false;
  writeJson(SESSIONS_FILE, { ...all, [id]: { ...s, seen_at: now } });
  return true;
}

export function updateSession(id: string, patch: Partial<Session>): void {
  const all = readSessions();
  if (!all[id]) return;
  writeJson(SESSIONS_FILE, live({ ...all, [id]: { ...all[id], ...patch } }));
}

export function deleteSession(id: string | undefined): void {
  if (!id) return;
  const all = readSessions();
  if (!(id in all)) return;
  delete all[id];
  writeJson(SESSIONS_FILE, live(all));
}
