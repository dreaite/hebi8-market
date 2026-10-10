/**
 * 在其他设备上登录 (design §5.8): someone logged in makes a one-time code, another device opens its
 * link, confirms there, and gets a session of its own for the same person. The codes are kept in
 * memory only, for two minutes; on `globalThis` because the confirmation page and the routes are
 * separate bundles in the same process.
 */
import { randomToken } from "./github";

export interface Claim {
  login: string;
  avatarUrl: string;
  /** ms */
  expiresAt: number;
}

export const CLAIM_SECONDS = 120;
/** At most this many codes waiting at once; a person has one, a new one replaces it. */
const MAX_CLAIMS = 20;

const g = globalThis as unknown as { hebi8mClaims?: Map<string, Claim> };
const claims = (g.hebi8mClaims ??= new Map());

/** Forget every code (tests). */
export function resetClaims(): void {
  claims.clear();
}

/** 取消, or a new code: this person's earlier codes stop working. */
export function dropClaims(login: string): void {
  for (const [code, c] of claims) if (c.login === login) claims.delete(code);
}

/** A 32-byte random code for this person; null when too many are waiting. */
export function createClaim(who: { login: string; avatarUrl: string }, now = Date.now()): string | null {
  for (const [code, c] of claims) if (c.expiresAt <= now) claims.delete(code);
  dropClaims(who.login);
  if (claims.size >= MAX_CLAIMS) return null;
  const code = randomToken(32);
  claims.set(code, { ...who, expiresAt: now + CLAIM_SECONDS * 1000 });
  return code;
}

/** Who a code would log in, without using it up: what the confirmation page shows. */
export function peekClaim(code: string | undefined, now = Date.now()): Claim | null {
  const claim = code ? claims.get(code) : undefined;
  return claim && claim.expiresAt > now ? claim : null;
}

/** Use the code: it works once. */
export function takeClaim(code: string | undefined, now = Date.now()): Claim | null {
  const claim = peekClaim(code, now);
  if (code) claims.delete(code);
  return claim;
}
