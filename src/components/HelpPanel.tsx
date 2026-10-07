"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { APP_INFO } from "@/lib/app-info";
import { recentErrors } from "@/lib/client-errors";
import { FEEDBACK_TYPES, feedbackContext, webIssueUrl, type FeedbackType, type PageInfo } from "@/lib/feedback";
import { fmtAgo } from "@/lib/format";
import type { IssueSummary } from "@/lib/github";
import type { ChannelSummary } from "@/lib/notify";
import type { HelpInfo } from "@/lib/help-info";
import { getChartContext } from "@/lib/page-context";
import { useLocalStorage } from "@/lib/use-local-storage";
import { IconClose, IconExternal } from "./chart-icons";
import { isEditable, type ToastOptions } from "./UiProvider";

export type HelpTab = "project" | "feedback" | "notify";

const SHORTCUTS: { group: string; rows: [string, string][] }[] = [
  {
    group: "全局",
    rows: [
      ["/  ·  Ctrl/Cmd+K", "打开搜索"],
      ["?", "打开 / 关闭帮助"],
      ["↑ ↓  Enter  Tab", "搜索里移动、打开 / 添加、换分组"],
      ["Esc", "关闭搜索、弹窗、菜单和本面板"],
      ["Ctrl/Cmd+S", "立即保存笔记 / 复盘"],
    ],
  },
  {
    group: "图表",
    rows: [
      ["字母 / 数字", "打开搜索并带入该字符"],
      ["← →", "向更早 / 更新滚动"],
      ["↑ ↓", "放大 / 缩小"],
      ["Space  ·  Shift+Space", "自选列表下一只 / 上一只"],
      ["Alt+T", "趋势线"],
      ["Alt+H", "水平线"],
      ["Alt+J", "水平射线"],
      ["Alt+V", "垂直线"],
      ["Alt+F", "斐波那契回撤"],
      ["Delete  ·  Backspace", "删除选中的画线"],
      ["Alt+A", "新建警报（右键主图：在该价位添加）"],
      ["Alt+R", "重置图表视图"],
      ["Esc", "退出画线、关闭弹窗"],
    ],
  },
  { group: "反馈", rows: [["Ctrl/Cmd+Enter", "提交"]] },
];

const fmtTime = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";

/** Current URL minus the panel's own query parameters. */
function pagePath(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("help");
  return `${url.pathname}${url.search}`;
}

/** Everything attached under 页面信息; collected in the browser at the moment the form opens. */
function collectPageInfo(): PageInfo {
  const chart = getChartContext();
  return {
    app: { version: APP_INFO.version, commit: APP_INFO.commit, builtAt: APP_INFO.builtAt },
    page: pagePath(),
    ...(chart && window.location.pathname.startsWith("/chart/") ? { chart } : {}),
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    fullscreen: Boolean(document.fullscreenElement),
    userAgent: navigator.userAgent,
    errors: recentErrors(),
    at: new Date().toISOString(),
  };
}

/** The unsent form survives closing the panel (for this tab's lifetime). */
const draft = { type: "bug" as FeedbackType, title: "", description: "", attach: true, autoFix: false };

export function HelpPanel({
  tab: initialTab,
  notice: initialNotice,
  autoLogin,
  onClose,
  toast,
}: {
  tab: HelpTab | null;
  /** Shown above the feedback form when the drawer opens */
  notice: string | null;
  /** Opened by 登录: start the device flow right away */
  autoLogin: boolean;
  onClose: () => void;
  toast: (message: string, opts?: ToastOptions) => void;
}) {
  const [storedTab, setStoredTab] = useLocalStorage<HelpTab>("hebi8:help:tab", "project");
  const [override, setOverride] = useState<HelpTab | null>(initialTab);
  const [notice, setNotice] = useState(initialNotice);
  const tab = override ?? storedTab;
  const chooseTab = (t: HelpTab) => {
    setOverride(null);
    setStoredTab(t);
  };
  useEffect(() => {
    if (initialTab) setStoredTab(initialTab);
  }, [initialTab, setStoredTab]);

  const [info, setInfo] = useState<HelpInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/help", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setInfo(json as HelpInfo);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves
    void load();
  }, [load]);

  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // keys stay inside the panel: the chart's Space / arrows / letters must not fire behind it
  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "?" && !isEditable(e.target)) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/25" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="帮助与反馈"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="help-panel absolute flex flex-col overflow-hidden border-line bg-card shadow-xl outline-none"
      >
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pr-2 pl-3">
          <div role="tablist" aria-label="帮助" className="flex h-full items-stretch gap-1">
            {(
              [
                ["project", "项目"],
                ["feedback", "反馈"],
                ["notify", "通知"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => chooseTab(id)}
                className={`-mb-px border-b-2 px-2 text-sm ${tab === id ? "border-fg font-medium text-fg" : "border-transparent text-muted hover:text-fg"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="tb-btn" aria-label="关闭" title="关闭 (Esc)">
            <IconClose />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs" role="tabpanel">
          {loadError && <p className="mb-3 text-down">读取失败：{loadError}</p>}
          {tab === "project" ? (
            <ProjectTab info={info} />
          ) : tab === "notify" ? (
            <NotifyTab info={info} autoLogin={autoLogin} reload={load} toast={toast} />
          ) : (
            <FeedbackTab info={info} notice={notice} setNotice={setNotice} autoLogin={autoLogin} reload={load} toast={toast} />
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-16 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
      {children}
      <IconExternal size={12} />
    </a>
  );
}

function ProjectTab({ info }: { info: HelpInfo | null }) {
  const app = info?.app ?? APP_INFO;
  return (
    <>
      <Section title="项目">
        <p className="font-mono text-sm">{app.name}</p>
        <p className="mt-1 leading-relaxed text-muted">{app.meaning}</p>
        <p className="mt-2 font-mono text-[11px] text-muted">
          v{app.version} · {app.commit}
          {app.builtAt && ` · 构建于 ${fmtTime(Date.parse(app.builtAt))}`}
        </p>
      </Section>

      <Section title="数据">
        {!info ? (
          <p className="text-muted">读取中…</p>
        ) : (
          <>
            {info.data.configError && <p className="mb-1 text-down">配置有问题：{info.data.configError}</p>}
            <Row label="标的">
              自选 {info.data.watched} 个 · 缓存 {info.data.cached} 个
            </Row>
            <Row label="上次同步">
              {info.data.lastSync ? `${fmtTime(info.data.lastSync)}（${fmtAgo(info.data.lastSync)}）` : "从未同步"}
            </Row>
            <Row label="下次同步">
              {fmtTime(info.data.nextSync)}
              {info.data.schedule && <span className="text-muted">（每天 {info.data.schedule}）</span>}
            </Row>
            <Row label="vault">
              <code className="font-mono">{info.data.vaultPath}/hebi8.yaml</code>
            </Row>
            {info.data.errors.length > 0 && (
              <div className="mt-2 rounded border border-line p-2">
                <p className="mb-1 text-down">同步出错 {info.data.errors.length} 个</p>
                <ul className="space-y-1">
                  {info.data.errors.map((e) => (
                    <li key={e.key} className="break-words">
                      <span className="font-mono">{e.key}</span>
                      {e.name !== e.key && <span className="text-muted"> {e.name}</span>}
                      <span className="block text-muted">{e.error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="快捷键（焦点在输入框里时不响应，Esc 除外）">
        <table className="w-full">
          <tbody>
            {SHORTCUTS.map(({ group, rows }) => (
              <ShortcutGroup key={group} group={group} rows={rows} />
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="链接">
        <ul className="space-y-1">
          <li>
            <ExtLink href={info?.repo.url ?? "https://github.com/dreaite/hebi8-market"}>GitHub 仓库 {info?.repo.fullName}</ExtLink>
          </li>
          {info && (
            <>
              <li>
                <ExtLink href={info.repo.designUrl}>设计文档 docs/design.md</ExtLink>
              </li>
              <li>
                <ExtLink href={info.repo.issuesUrl}>应用内反馈的 issue（from-app）</ExtLink>
              </li>
            </>
          )}
        </ul>
      </Section>
    </>
  );
}

function ShortcutGroup({ group, rows }: { group: string; rows: [string, string][] }) {
  return (
    <>
      <tr>
        <th colSpan={2} className="pt-2 pb-1 text-left text-[11px] font-normal text-muted">
          {group}
        </th>
      </tr>
      {rows.map(([keys, action]) => (
        <tr key={group + keys} className="border-t border-line/60">
          <td className="py-1 pr-3 align-top whitespace-nowrap">
            <kbd className="font-mono text-[11px]">{keys}</kbd>
          </td>
          <td className="py-1 text-muted">{action}</td>
        </tr>
      ))}
    </>
  );
}

/** A device-flow login in progress. Module-level so closing and reopening the drawer resumes it. */
interface PendingLogin {
  flowId: string;
  userCode: string;
  verificationUri: string;
  /** ms */
  expiresAt: number;
  /** seconds between polls */
  interval: number;
}

let pendingLogin: PendingLogin | null = null;

const currentLogin = () => (pendingLogin && pendingLogin.expiresAt > Date.now() ? pendingLogin : null);

/** Copy without the async clipboard API, which plain-http origins (the tailnet) do not get. */
function copyText(text: string): boolean {
  const previous = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  // next to the focused control, so it is inside the fullscreen element when there is one
  (previous?.parentElement ?? document.body).appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  // focus goes back into the drawer, so its keys (Esc, ?) keep working
  previous?.focus();
  if (!ok && navigator.clipboard) {
    void navigator.clipboard.writeText(text);
    return true;
  }
  return ok;
}

const postJson = (url: string, body: unknown, method = "POST") =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });

function FeedbackTab({
  info,
  notice,
  setNotice,
  autoLogin,
  reload,
  toast,
}: {
  info: HelpInfo | null;
  notice: string | null;
  setNotice: (message: string | null) => void;
  autoLogin: boolean;
  reload: () => Promise<void>;
  toast: (message: string, opts?: ToastOptions) => void;
}) {
  const [issuesVersion, setIssuesVersion] = useState(0);

  if (!info) return <p className="text-muted">读取中…</p>;
  const gh = info.github;

  return (
    <>
      {notice && <p className="mb-3 rounded border border-down/40 px-2 py-1.5 text-down">{notice}</p>}
      {!gh.enabled ? (
        <div className="mb-3 rounded border border-line px-3 py-2 leading-relaxed">
          <p className="mb-1 font-medium">反馈未启用</p>
          <p className="text-muted">
            这个 hebi8/market 没有配置 GitHub App（app-info.ts 的 GITHUB_APP_CLIENT_ID 或环境变量 HEBI8_GITHUB_CLIENT_ID），不能在应用里直接提交。填好下面的内容，点「在 GitHub
            网页上提交」，会在 github.com 打开预填好的 issue。
          </p>
        </div>
      ) : (
        <AccountBlock
          info={info}
          autoLogin={autoLogin}
          onStart={() => setNotice(null)}
          reload={reload}
          toast={toast}
          intro={
            <>
              用你的 GitHub 账号登录，反馈会以你的名义提交到 <span className="font-mono">{gh.feedbackRepo}</span>。
              {info.shared && "共用这台 hebi8/market 时，登录后用的是你自己的自选、笔记和通知。"}
            </>
          }
          aside="不想登录也可以在 GitHub 网页上提交（表单下方）"
        />
      )}
      <FeedbackForm
        info={info}
        canSubmit={gh.enabled && Boolean(gh.user)}
        toast={toast}
        onSubmitted={() => setIssuesVersion((n) => n + 1)}
        onLoggedOut={(message) => {
          setNotice(message);
          void reload();
        }}
      />
      <RecentIssues key={issuesVersion} issuesUrl={info.repo.issuesUrl} />
    </>
  );
}

/**
 * Who is logged in, or 用 GitHub 登录 and the device flow in progress. Logging in or out changes
 * which vault the pages show on a shared instance, so both refresh the page behind the drawer.
 */
function AccountBlock({
  info,
  intro,
  aside,
  autoLogin,
  onStart,
  reload,
  toast,
}: {
  info: HelpInfo;
  intro: ReactNode;
  aside?: string;
  autoLogin: boolean;
  onStart?: () => void;
  reload: () => Promise<void>;
  toast: (message: string, opts?: ToastOptions) => void;
}) {
  const router = useRouter();
  const [login, setLogin] = useState<PendingLogin | null>(currentLogin);
  const [starting, setStarting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const user = info.github.user;

  const startLogin = useCallback(async () => {
    setStarting(true);
    setLoginError(null);
    onStart?.();
    try {
      const res = await postJson("/api/github/device", {});
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      pendingLogin = {
        flowId: json.flowId,
        userCode: json.user_code,
        verificationUri: json.verification_uri,
        expiresAt: Date.now() + json.expires_in * 1000,
        interval: json.interval,
      };
      setLogin(pendingLogin);
    } catch (err) {
      setLoginError(`登录没能开始：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setStarting(false);
    }
  }, [onStart]);

  // 登录 in the header: show the code at once instead of another button to press
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoLogin || autoStarted.current || user || currentLogin()) return;
    autoStarted.current = true;
    void startLogin();
  }, [autoLogin, user, startLogin]);

  const endLogin = (error: string | null) => {
    pendingLogin = null;
    setLogin(null);
    setLoginError(error);
  };

  const cancelLogin = () => {
    if (login) void postJson("/api/github/device", { flowId: login.flowId }, "DELETE").catch(() => undefined);
    endLogin(null);
  };

  const logout = async () => {
    await fetch("/api/github/logout", { method: "POST" }).catch(() => undefined);
    router.refresh();
    await reload();
  };

  if (user) {
    return (
      <div className="mb-3 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- GitHub avatar, no optimisation wanted */}
        <img src={`${user.avatarUrl}${user.avatarUrl.includes("?") ? "&" : "?"}s=48`} alt="" width={20} height={20} className="rounded-full" />
        <span className="font-medium">{user.login}</span>
        <span className="flex-1" />
        <button type="button" className="btn" onClick={() => void logout()}>
          退出
        </button>
      </div>
    );
  }
  if (login) {
    return (
      <DeviceLogin
        key={login.flowId}
        login={login}
        shared={info.shared}
        toast={toast}
        onCancel={cancelLogin}
        onFailed={endLogin}
        onDone={(who) => {
          endLogin(null);
          toast(`已登录为 ${who}`);
          router.refresh();
          void reload();
        }}
      />
    );
  }
  return (
    <div className="mb-3 flex flex-col gap-2 rounded border border-line px-3 py-2">
      <p className="leading-relaxed">{intro}</p>
      {loginError && <p className="text-down">{loginError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={starting} onClick={() => void startLogin()}>
          {starting ? "正在联系 GitHub…" : "用 GitHub 登录"}
        </button>
        {aside && <span className="text-[11px] text-muted">{aside}</span>}
      </div>
    </div>
  );
}

/**
 * Each person's channels on a shared instance (design §2.5). In single-user mode the channels
 * are notify.json's, which only the person who runs the instance edits.
 */
function NotifyTab({
  info,
  autoLogin,
  reload,
  toast,
}: {
  info: HelpInfo | null;
  autoLogin: boolean;
  reload: () => Promise<void>;
  toast: (message: string, opts?: ToastOptions) => void;
}) {
  if (!info) return <p className="text-muted">读取中…</p>;
  const notifyJson = <code className="font-mono">~/.config/hebi8/market/notify.json</code>;
  if (!info.shared) {
    return (
      <Section title="通知">
        <p className="leading-relaxed">
          标了 <code className="font-mono">notify</code> 的条件和 <code className="font-mono">alerts</code> 规则在同步后新成立时推一条摘要。单用户模式下通道写在服务器的 {notifyJson}
          （Telegram bot 和 chat、webhook），改完运行 <code className="font-mono">npm run notify:test</code> 发一条试试。
        </p>
        <p className="mt-2 leading-relaxed text-muted">在 hebi8.yaml 里写了 owner 的共用实例，每个人登录后在这里绑定自己的通道。</p>
      </Section>
    );
  }
  if (!info.github.enabled) {
    return <p className="leading-relaxed text-muted">这台 hebi8/market 没有配置 GitHub App，不能登录，也就不能按人设置通知；通道写在 {notifyJson}。</p>;
  }
  const user = info.github.user;
  return (
    <>
      <AccountBlock
        info={info}
        autoLogin={autoLogin}
        reload={reload}
        toast={toast}
        intro="登录后用你自己的自选、笔记和复盘，并设置你自己的通知：你标了 notify 的条件和 alerts 规则新成立时，推到你绑定的 Telegram 或 webhook。"
      />
      {user && <NotifySettings key={user.login} toast={toast} />}
    </>
  );
}

async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

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
          <p className="leading-relaxed text-muted">这台 hebi8/market 没有配置 Telegram bot（notify.json 的 telegram.token），请找部署的人。</p>
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

/** 登录中: the user code, a link to github.com/login/device, a countdown; polls our server every `interval` s. */
function DeviceLogin({
  login,
  shared,
  toast,
  onCancel,
  onFailed,
  onDone,
}: {
  login: PendingLogin;
  /** On a shared instance the login is mainly about whose list you see */
  shared: boolean;
  toast: (message: string, opts?: ToastOptions) => void;
  onCancel: () => void;
  onFailed: (message: string) => void;
  onDone: (login: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState("等你在 GitHub 上输入这个代码并授权…");
  const left = Math.max(0, Math.round((login.expiresAt - now) / 1000));

  const callbacks = useRef({ onFailed, onDone });
  useEffect(() => {
    callbacks.current = { onFailed, onDone };
  });

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    let interval = login.interval;
    const schedule = () => {
      timer = window.setTimeout(() => void poll(), interval * 1000);
    };
    const poll = async () => {
      if (stopped) return;
      if (Date.now() >= login.expiresAt) {
        callbacks.current.onFailed("登录代码已过期，请重新点「用 GitHub 登录」");
        return;
      }
      let res: Response;
      let json: { status?: string; interval?: number; slowDown?: boolean; error?: string; user?: { login: string } };
      try {
        res = await postJson("/api/github/device/poll", { flowId: login.flowId });
        json = await res.json().catch(() => ({}));
      } catch {
        if (!stopped) {
          setStatus("暂时连不上服务器，稍后重试…");
          schedule();
        }
        return;
      }
      if (stopped) return;
      if (!res.ok || json.status === "error") callbacks.current.onFailed(`登录失败：${json.error ?? `HTTP ${res.status}`}`);
      else if (json.status === "done") callbacks.current.onDone(json.user?.login ?? "");
      else if (json.status === "expired") callbacks.current.onFailed("登录代码已过期，请重新点「用 GitHub 登录」");
      else if (json.status === "denied") callbacks.current.onFailed("你在 GitHub 上取消了授权");
      else {
        if (json.slowDown) setStatus("GitHub 要求放慢查询，继续等待授权…");
        if (json.interval) interval = json.interval;
        schedule();
      }
    };
    schedule();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [login]);

  const copy = () => toast(copyText(login.userCode) ? `已复制 ${login.userCode}` : "复制失败，请手动选中代码", { duration: 2500 });
  const label = login.verificationUri.replace(/^https:\/\//, "");

  return (
    <div className="mb-3 flex flex-col gap-2 rounded border border-line px-3 py-2.5" aria-live="polite">
      <p className="leading-relaxed">
        {shared
          ? "在 GitHub 上输入下面的代码登录。登录后用你自己的列表、画线、笔记和通知，反馈也会以你的名义提交："
          : "在 GitHub 上输入下面的代码，授权 hebi8/market 以你的名义提交 issue："}
      </p>
      <div className="flex items-center gap-2">
        <code className="rounded bg-fg/5 px-2 py-1 font-mono text-xl tracking-widest select-all" aria-label="登录代码">
          {login.userCode}
        </code>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          复制
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a href={login.verificationUri} target="_blank" rel="noreferrer" className="btn btn-primary inline-flex items-center gap-1">
          打开 {label}
          <IconExternal size={12} />
        </a>
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
      </div>
      <p className="text-[11px] text-muted">
        {status} · 剩余 {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </p>
    </div>
  );
}

function FeedbackForm({
  info,
  canSubmit,
  toast,
  onSubmitted,
  onLoggedOut,
}: {
  info: HelpInfo;
  /** Logged in with a configured App: 提交 creates the issue; otherwise only the github.com form */
  canSubmit: boolean;
  toast: (message: string, opts?: ToastOptions) => void;
  onSubmitted: () => void;
  /** The server dropped the session (401): show why above the login button */
  onLoggedOut: (message: string) => void;
}) {
  const repo = info.github.feedbackRepo;
  const [type, setType] = useState<FeedbackType>(draft.type);
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);
  const [attach, setAttach] = useState(draft.attach);
  const [autoFix, setAutoFix] = useState(draft.autoFix);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; webFallback: boolean } | null>(null);
  const [snapshot, setSnapshot] = useState(0);

  useEffect(() => {
    Object.assign(draft, { type, title, description, attach, autoFix });
  }, [type, title, description, attach, autoFix]);

  // taken once per form (and after each submit), so the preview is exactly what gets sent
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `snapshot` re-collects on purpose
  const page = useMemo(() => collectPageInfo(), [snapshot]);
  const context = useMemo(() => feedbackContext(type, autoFix, attach ? page : null), [type, autoFix, attach, page]);
  const webUrl = useMemo(() => webIssueUrl(repo, title, description, context), [repo, title, description, context]);

  const openWeb = () => window.open(webUrl, "_blank", "noopener,noreferrer");

  const submit = async () => {
    if (busy) return;
    if (!canSubmit) {
      openWeb();
      return;
    }
    if (!title.trim()) {
      setError({ message: "标题不能为空", webFallback: false });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await postJson("/api/github/issues", { type, title, description, context, autoFix });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = json.error ?? `提交失败：HTTP ${res.status}`;
        if (res.status === 401) onLoggedOut(message);
        else setError({ message, webFallback: Boolean(json.webFallback) });
        return;
      }
      toast(`已提交 #${json.number}`, { href: json.html_url });
      setTitle("");
      setDescription("");
      setAutoFix(false);
      setSnapshot((n) => n + 1);
      onSubmitted();
    } catch (err) {
      setError({ message: `提交失败：${err instanceof Error ? err.message : String(err)}`, webFallback: true });
    } finally {
      setBusy(false);
    }
  };

  const webLink = (primary: boolean) => (
    <a href={webUrl} target="_blank" rel="noreferrer" className={`btn ${primary ? "btn-primary" : "btn-secondary"} inline-flex items-center gap-1`} data-testid="web-fallback">
      在 GitHub 网页上提交
      <IconExternal size={12} />
    </a>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void submit();
        }
      }}
      className="flex flex-col gap-2.5"
    >
      <div className="seg self-start" role="group" aria-label="类型">
        {FEEDBACK_TYPES.map((t) => (
          <button key={t.id} type="button" aria-pressed={type === t.id} onClick={() => setType(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <input
        className="input w-full"
        placeholder="标题（必填）"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="标题"
        aria-invalid={error?.message === "标题不能为空" ? true : undefined}
      />
      <textarea
        className="input h-32 w-full resize-y py-1.5 leading-relaxed"
        placeholder="发生了什么？期望是什么？（支持 markdown）"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        aria-label="描述"
      />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
        附带页面信息
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={autoFix} onChange={(e) => setAutoFix(e.target.checked)} />
        可以自动修复
        <span className="text-muted">（仓库成员提的会加 auto-fix-ok）</span>
      </label>
      <details className="rounded border border-line">
        <summary className="cursor-pointer px-2 py-1 text-muted">
          预览将附带的信息
          {attach ? `${context.chart ? ` · ${context.chart.symbol}` : ""} · ${context.errors?.length ?? 0} 条前端错误` : " · 只有类型和自动修复"}
        </summary>
        <pre className="max-h-60 overflow-auto border-t border-line px-2 py-1.5 font-mono text-[11px] leading-snug break-all whitespace-pre-wrap">
          {JSON.stringify(context, null, 2)}
        </pre>
      </details>
      {error && (
        <div className="text-down">
          <p>{error.message}</p>
          {error.webFallback && canSubmit && <div className="mt-1.5">{webLink(false)}</div>}
        </div>
      )}
      {canSubmit ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "提交中…" : "提交"}
            </button>
            <span className="text-[11px] text-muted">Ctrl/Cmd+Enter</span>
          </div>
          <p className="text-[11px] text-muted">
            以你的 GitHub 账号提交到 <span className="font-mono">{repo}</span>；标签由仓库的 Actions 自动加
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {webLink(!info.github.enabled)}
            <span className="text-[11px] text-muted">Ctrl/Cmd+Enter</span>
          </div>
          <p className="text-[11px] text-muted">
            在 github.com 打开预填好的 issue（{repo}），确认后在那里提交
          </p>
        </div>
      )}
    </form>
  );
}

/** The latest from-app issues (the server caches them 60 s). */
function RecentIssues({ issuesUrl }: { issuesUrl: string }) {
  const [issues, setIssues] = useState<IssueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/github/issues", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (alive) setIssues(json.issues as IssueSummary[]);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="mt-5">
      <h3 className="mb-1.5 text-[11px] font-medium text-muted">最近的应用内反馈</h3>
      {error ? (
        <p className="text-down">{error}</p>
      ) : !issues ? (
        <p className="text-muted">读取中…</p>
      ) : issues.length === 0 ? (
        <p className="text-muted">还没有</p>
      ) : (
        <ul className="space-y-1">
          {issues.map((i) => (
            <li key={i.number} className="flex items-baseline gap-2">
              <span className={`shrink-0 text-[11px] ${i.state === "open" ? "text-up" : "text-muted"}`}>{i.state === "open" ? "开" : "关"}</span>
              <a href={i.html_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline" title={i.title}>
                {i.title}
              </a>
              <span className="shrink-0 font-mono text-[11px] text-muted">#{i.number}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2">
        <ExtLink href={issuesUrl}>全部</ExtLink>
      </p>
    </section>
  );
}
