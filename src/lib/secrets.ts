/**
 * GitHub login sessions (the only secrets this app keeps) live outside the repo, the vault and
 * the data dir: `sessions.json` in `HEBI8_SECRETS` or `~/.config/hebi8` (mode 700), written
 * atomically with mode 600. Nothing in here is ever logged or sent to the browser.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function secretsDir(): string {
  return process.env.HEBI8_SECRETS ?? path.join(os.homedir(), ".config", "hebi8");
}

function ensureDir(): string {
  const dir = secretsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(secretsDir(), name), "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(name: string, value: unknown): void {
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
  access_token: string;
  /** ms; null when the App does not expire user tokens */
  access_expires_at: number | null;
  refresh_token: string | null;
  refresh_expires_at: number | null;
  created_at: number;
}

const SESSIONS_FILE = "sessions.json";
export const SESSION_DAYS = 30;

function readSessions(): Record<string, Session> {
  return readJson<Record<string, Session>>(SESSIONS_FILE) ?? {};
}

/** Sessions past their 30 days, or whose refresh token has run out, are dropped on every write. */
function live(all: Record<string, Session>, now = Date.now()): Record<string, Session> {
  return Object.fromEntries(
    Object.entries(all).filter(([, s]) => {
      if (now - s.created_at > SESSION_DAYS * 86400000) return false;
      if (s.access_expires_at && s.access_expires_at < now && (!s.refresh_expires_at || s.refresh_expires_at < now)) return false;
      return true;
    }),
  );
}

export function getSession(id: string | undefined): Session | null {
  if (!id || !/^[A-Za-z0-9_-]{20,100}$/.test(id)) return null;
  const s = readSessions()[id];
  return s && live({ [id]: s })[id] ? s : null;
}

export function createSession(session: Omit<Session, "created_at">): string {
  const id = crypto.randomBytes(32).toString("base64url");
  writeJson(SESSIONS_FILE, { ...live(readSessions()), [id]: { ...session, created_at: Date.now() } });
  return id;
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
