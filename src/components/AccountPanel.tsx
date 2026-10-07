"use client";

import { useCallback, useEffect, useState } from "react";
import type { BotSummary, ChannelSummary } from "@/lib/notify";
import { IconExternal } from "./chart-icons";
import { Drawer, Row, Section, errorText, request, useHelpInfo } from "./Drawer";
import { AccountBlock } from "./GitHubLogin";
import type { ToastOptions } from "./UiProvider";

/**
 * 登录 and 通知设置 (design §2.5), the one place for both: the header's 登录 and the account
 * menu's 通知设置 open it. Logged out it is the GitHub device flow; logged in it is this person's
 * channels, plus the instance's bot for an owner. Only a shared instance has logins.
 */
export function AccountPanel({ autoLogin, onClose, toast }: { autoLogin: boolean; onClose: () => void; toast: (message: string, opts?: ToastOptions) => void }) {
  const { info, error, reload } = useHelpInfo();
  // a new bot changes what the channel settings can offer, so they reload
  const [botVersion, setBotVersion] = useState(0);
  const user = info?.github.user ?? null;
  const title = user ? "通知设置" : "登录";

  return (
    <Drawer label={title} header={<h2 className="text-sm font-medium">{title}</h2>} onClose={onClose}>
      {error && <p className="mb-3 text-down">读取失败：{error}</p>}
      {!info ? (
        <p className="text-muted">读取中…</p>
      ) : !info.github.enabled ? (
        <p className="leading-relaxed text-muted">这台 hebi8/market 没有开启 GitHub 登录。</p>
      ) : (
        <>
          <AccountBlock
            info={info}
            autoLogin={autoLogin}
            reload={reload}
            toast={toast}
            intro="登录后用你自己的自选、笔记和复盘，并设置你自己的通知：你的警报触发时，推到你绑定的 Telegram 或 webhook。"
          />
          {user && <NotifySettings key={`${user.login}:${botVersion}`} toast={toast} />}
          {user && info.canSetBot && (
            <div className="mt-5">
              <InstanceBot toast={toast} onChange={() => setBotVersion((n) => n + 1)} />
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

/**
 * 实例的 Telegram bot (§2.5), owner only: paste the token; the server
 * checks it with getMe before writing notify.json and never shows it again, only the bot's name.
 */
function InstanceBot({ toast, onChange }: { toast: (message: string, opts?: ToastOptions) => void; onChange: () => void }) {
  const [bot, setBot] = useState<BotSummary | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    request<BotSummary>("/api/notify/bot", "GET")
      .then((b) => alive && setBot(b))
      .catch((err) => alive && setError(errorText(err)));
    return () => {
      alive = false;
    };
  }, []);

  const change = async (method: "PUT" | "DELETE") => {
    setBusy(true);
    setError(null);
    try {
      const next = await request<BotSummary>("/api/notify/bot", method, method === "PUT" ? { token } : undefined);
      setBot(next);
      setToken("");
      setConfirming(false);
      toast(next.configured ? `已设置 bot @${next.username}` : "已移除 bot");
      onChange();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="实例的 Telegram bot">
      <Row label="bot">
        {!bot ? (
          <span className="text-muted">读取中…</span>
        ) : !bot.configured ? (
          <span className="text-muted">未配置</span>
        ) : bot.username ? (
          <span className="font-mono">@{bot.username}</span>
        ) : (
          <span className="text-down">已配置，但 getMe 失败：{bot.error}</span>
        )}
      </Row>
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void change("PUT");
        }}
      >
        <input
          type="password"
          autoComplete="off"
          className="input min-w-0 flex-1 font-mono"
          placeholder={bot?.configured ? "粘贴新的 token 替换" : "粘贴 @BotFather 给的 token"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-label="bot token"
        />
        <button type="submit" className="btn btn-secondary" disabled={busy || !token.trim()}>
          {busy ? "校验中…" : "保存"}
        </button>
      </form>
      {bot?.configured &&
        (confirming ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-down">移除会删掉 notify.json 的 telegram 段（含主人的 chat），大家的 Telegram 通知都会停。</span>
            <button type="button" className="btn btn-secondary text-down" disabled={busy} onClick={() => void change("DELETE")}>
              确认移除
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              取消
            </button>
          </div>
        ) : (
          <button type="button" className="btn mt-2" onClick={() => setConfirming(true)}>
            移除
          </button>
        ))}
      {error && <p className="mt-1 text-down">{error}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        保存前先用 getMe 校验，通过才写进服务器的 notify.json，之后只显示 bot 用户名，不再显示 token。这个 bot 要给 hebi8/market 专用：别的程序也读它的消息时，绑定会抢不到。
      </p>
    </Section>
  );
}

function NotifySettings({ toast }: { toast: (message: string, opts?: ToastOptions) => void }) {
  const [summary, setSummary] = useState<ChannelSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [binding, setBinding] = useState<{ url: string; expiresAt: number } | null>(null);
  const [bindStatus, setBindStatus] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<"text" | "json">("text");

  const load = useCallback(async () => {
    try {
      setSummary(await request<ChannelSummary>("/api/notify", "GET"));
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves
    void load();
  }, [load]);

  /** Run one action; its result, when it is the new summary, replaces the old one. */
  const act = async <T,>(fn: () => Promise<T>, done?: (result: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      done?.(result);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // the server long-polls the bot; this only asks it whether the /start has arrived
  useEffect(() => {
    if (!binding) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      let result: { status: string; error?: string };
      try {
        result = await request("/api/notify/telegram/poll", "POST", {});
      } catch (err) {
        result = { status: "pending", error: errorText(err) };
      }
      if (stopped) return;
      if (result.status === "bound") {
        setBinding(null);
        toast("已绑定 Telegram");
        void load();
      } else if (result.status === "expired") {
        setBinding(null);
        setError("绑定码已过期，请重新点「绑定 Telegram」");
      } else {
        setBindStatus(result.error ? `等待中 · ${result.error}` : null);
        timer = window.setTimeout(() => void poll(), 3000);
      }
    };
    timer = window.setTimeout(() => void poll(), 3000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [binding, load, toast]);

  if (!summary) return error ? <p className="text-down">{error}</p> : <p className="text-muted">读取中…</p>;
  const { telegram, webhook } = summary;
  const fromFile = <span className="text-muted">（notify.json，在这里设置会替代它）</span>;

  return (
    <>
      <Section title="通道">
        <Row label="Telegram">
          {telegram ? (
            <>
              已绑定 <span className="font-mono">{telegram.chat}</span>
              {telegram.fromFile && fromFile}
            </>
          ) : (
            <span className="text-muted">未绑定</span>
          )}
        </Row>
        <Row label="webhook">
          {webhook ? (
            <>
              <span className="font-mono">{webhook.host}</span> · {webhook.format}
              {webhook.fromFile && fromFile}
            </>
          ) : (
            <span className="text-muted">未设置</span>
          )}
        </Row>
        {error && <p className="mt-1 text-down">{error}</p>}
      </Section>

      <Section title="Telegram">
        {!summary.bot ? (
          <p className="leading-relaxed text-muted">这台 hebi8/market 还没有设置 Telegram bot，请找部署的人。</p>
        ) : binding ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <p className="leading-relaxed">在 Telegram 里打开 bot，点 Start，这里会自动完成绑定（10 分钟内有效）。</p>
            <div className="flex flex-wrap items-center gap-2">
              <a href={binding.url} target="_blank" rel="noreferrer" className="btn btn-primary inline-flex items-center gap-1">
                打开 Telegram 点 Start
                <IconExternal size={12} />
              </a>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setBinding(null);
                  // the link must stop working too, not just the waiting here
                  void act(() => request("/api/notify/telegram/cancel", "POST", {}));
                }}
              >
                取消
              </button>
            </div>
            <p className="text-[11px] text-muted">{bindStatus ?? "等待中…"}</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`btn ${telegram && !telegram.fromFile ? "btn-secondary" : "btn-primary"}`}
              disabled={busy}
              onClick={() =>
                void act(
                  () => request<{ url: string; expiresAt: number }>("/api/notify/telegram", "POST", {}),
                  (b) => {
                    setBindStatus(null);
                    setBinding(b);
                  },
                )
              }
            >
              {telegram && !telegram.fromFile ? "重新绑定" : "绑定 Telegram"}
            </button>
            {telegram && !telegram.fromFile && (
              <button type="button" className="btn" disabled={busy} onClick={() => void act(() => request<ChannelSummary>("/api/notify/telegram", "DELETE"), setSummary)}>
                解除绑定
              </button>
            )}
          </div>
        )}
      </Section>

      <Section title="webhook">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => request<ChannelSummary>("/api/notify/webhook", "PUT", { url, format }),
              (next) => {
                setSummary(next);
                setUrl("");
              },
            );
          }}
        >
          <input className="input w-full font-mono" placeholder="https://ntfy.sh/你的主题" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="webhook 地址" />
          <div className="flex flex-wrap items-center gap-2">
            <div className="seg" role="group" aria-label="格式">
              {(["text", "json"] as const).map((f) => (
                <button key={f} type="button" aria-pressed={format === f} onClick={() => setFormat(f)}>
                  {f}
                </button>
              ))}
            </div>
            <button type="submit" className="btn btn-secondary" disabled={busy || !url.trim()}>
              保存
            </button>
            {webhook && !webhook.fromFile && (
              <button type="button" className="btn" disabled={busy} onClick={() => void act(() => request<ChannelSummary>("/api/notify/webhook", "DELETE"), setSummary)}>
                删除
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted">text：摘要作为正文（ntfy 直接能用）；json：{"{ title, text, events }"}</p>
        </form>
      </Section>

      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy || (!telegram && !webhook)}
        onClick={() =>
          void act(
            () => request<{ sent: string[]; failed: { channel: string; error: string }[] }>("/api/notify/test", "POST", {}),
            ({ sent, failed }) => {
              if (sent.length) toast(`已发送到 ${sent.join("、")}`);
              if (failed.length) setError(failed.map((f) => `${f.channel}：${f.error}`).join("；"));
            },
          )
        }
      >
        发测试消息
      </button>
    </>
  );
}
