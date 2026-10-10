"use server";

/**
 * Personal tokens for agents (design §1.6, §5.5): made, listed and revoked on the settings page by
 * whoever may change the vault the token opens. On a shared instance that is the logged-in person;
 * in single-user mode, anyone who can change the page.
 */
import { revalidatePath } from "next/cache";
import { MAX_TOKENS, createToken, listTokens, revokeToken } from "@/lib/secrets";
import { getViewer, requireWriter, tokenOwner } from "@/lib/viewer";

export type TokenResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) });

/** The token is in the result once and nowhere after: only its hash is stored. */
export async function createAgentToken(input: { name: string; write: boolean }): Promise<TokenResult<{ token: string }>> {
  try {
    const login = tokenOwner(requireWriter(await getViewer()));
    const name = typeof input?.name === "string" ? input.name.trim() : "";
    if (!name) throw new Error("给令牌起个名字，比如用它的 agent");
    if (name.length > 40) throw new Error("名字最多 40 个字");
    if (listTokens(login).length >= MAX_TOKENS) throw new Error(`最多 ${MAX_TOKENS} 个令牌，先吊销不用的`);
    const token = createToken({ name, login, write: input.write === true });
    revalidatePath("/settings");
    return { ok: true, token };
  } catch (err) {
    return fail(err);
  }
}

export async function revokeAgentToken(id: string): Promise<TokenResult> {
  try {
    const login = tokenOwner(requireWriter(await getViewer()));
    if (!revokeToken(login, String(id))) throw new Error("这个令牌已经不在了");
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
