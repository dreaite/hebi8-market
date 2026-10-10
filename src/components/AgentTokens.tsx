"use client";

import { useState, useTransition } from "react";
import { createAgentToken, revokeAgentToken } from "@/app/token-actions";
import { copyText } from "@/lib/copy-text";
import { LoginButton } from "./UiProvider";

const body = "flex flex-col gap-3 px-4 py-3 text-xs";
const th = "whitespace-nowrap px-2 py-1 text-left text-[11px] font-normal text-muted";
const td = "border-t border-line px-2 py-1";

export interface AgentTokenRow {
  id: string;
  name: string;
  write: boolean;
  /** Dates as the page shows them, in the instance's time zone */
  created: string;
  used: string | null;
}

/** A line to copy: the text in a box that scrolls sideways, and 复制 beside it. */
function CopyLine({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded border border-line bg-bg px-2 py-1.5 font-mono whitespace-nowrap">{text}</code>
        <button type="button" className="btn btn-secondary shrink-0" onClick={() => setCopied(copyText(text))}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
    </div>
  );
}

/**
 * Personal tokens for agents (design §5.5): make one (a name, read only or writable), see them
 * with when each was last used, revoke one. A new token is shown once, with the command that
 * connects Claude Code; afterwards only its hash exists.
 */
export function AgentTokens({ tokens, endpoint, canWrite }: { tokens: AgentTokenRow[]; endpoint: string; canWrite: boolean }) {
  const [name, setName] = useState("");
  const [write, setWrite] = useState(false);
  const [made, setMade] = useState<{ name: string; token: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      const result = await createAgentToken({ name, write });
      if (!result.ok) return setError(result.error);
      setError(null);
      setMade({ name: name.trim(), token: result.token });
      setName("");
    });

  const revoke = (id: string) => {
    if (revoking !== id) return setRevoking(id);
    startTransition(async () => {
      const result = await revokeAgentToken(id);
      setRevoking(null);
      setError(result.ok ? null : result.error);
    });
  };

  return (
    <div className={body}>
      <p className="text-muted">
        MCP 地址 <code className="font-mono text-fg">{endpoint}</code>，每个请求带请求头 <code className="font-mono text-fg">Authorization: Bearer &lt;令牌&gt;</code>。
      </p>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input className="input w-48" value={name} onChange={(e) => setName(e.target.value)} placeholder="名字，比如 Claude Code" aria-label="令牌名字" maxLength={40} disabled={!canWrite} />
        <div className="seg" role="group" aria-label="权限">
          <button type="button" aria-pressed={!write} onClick={() => setWrite(false)} disabled={!canWrite}>
            只读
          </button>
          <button type="button" aria-pressed={write} onClick={() => setWrite(true)} disabled={!canWrite}>
            可写
          </button>
        </div>
        <button type="submit" className="btn btn-primary" disabled={!canWrite || pending || !name.trim()}>
          生成令牌
        </button>
        {canWrite ? (
          <span className="text-muted">{write ? "可写：还能加减自选、建警报、追加笔记和复盘。" : "只读：只能读行情、自选、警报、笔记和复盘。"}</span>
        ) : (
          <span className="flex items-center gap-2 text-muted">
            登录后才能生成
            <LoginButton />
          </span>
        )}
      </form>
      {error && <p className="text-down">{error}</p>}

      {made && (
        <div className="flex flex-col gap-3 rounded border border-line p-3">
          <p>
            「{made.name}」的令牌只显示这一次，这里存的只是它的哈希。离开这一页之前把它交给 agent。
            <button type="button" className="btn ml-2 h-6 px-1.5" onClick={() => setMade(null)}>
              收起
            </button>
          </p>
          <CopyLine label="令牌" text={made.token} />
          <CopyLine label="接入 Claude Code（在终端里运行）" text={`claude mcp add --transport http hebi8-market ${endpoint} --header "Authorization: Bearer ${made.token}"`} />
        </div>
      )}

      {tokens.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>名字</th>
                <th className={th}>权限</th>
                <th className={th}>创建</th>
                <th className={th} title="一天最多更新一次">
                  最后使用
                </th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td className={td}>{t.name}</td>
                  <td className={td}>{t.write ? "可写" : "只读"}</td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{t.created}</td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{t.used ?? "还没用过"}</td>
                  <td className={`${td} text-right`}>
                    <button type="button" className="btn h-6 px-1.5 text-down" disabled={pending} onClick={() => revoke(t.id)} onBlur={() => setRevoking(null)}>
                      {revoking === t.id ? "确认吊销" : "吊销"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
