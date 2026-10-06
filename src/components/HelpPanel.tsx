"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { APP_INFO } from "@/lib/app-info";
import { recentErrors } from "@/lib/client-errors";
import { FEEDBACK_TYPES, feedbackLabels, type FeedbackContext, type FeedbackType } from "@/lib/feedback";
import { fmtAgo } from "@/lib/format";
import type { IssueSummary } from "@/lib/github";
import type { HelpInfo } from "@/lib/help-info";
import { getChartContext } from "@/lib/page-context";
import { useLocalStorage } from "@/lib/use-local-storage";
import { IconClose, IconExternal } from "./chart-icons";
import { isEditable, type ToastOptions } from "./UiProvider";

export type HelpTab = "project" | "feedback";

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
  url.searchParams.delete("error");
  return `${url.pathname}${url.search}`;
}

/** Everything attached under 页面信息; collected in the browser at the moment the form opens. */
function collectContext(type: FeedbackType): FeedbackContext {
  const chart = getChartContext();
  return {
    v: 1,
    type,
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
  onClose,
  toast,
}: {
  tab: HelpTab | null;
  /** An error passed back by the login / setup redirects */
  notice: string | null;
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
          {tab === "project" ? <ProjectTab info={info} /> : <FeedbackTab info={info} notice={notice} setNotice={setNotice} reload={load} toast={toast} onNavigate={onClose} />}
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

function FeedbackTab({
  info,
  notice,
  setNotice,
  reload,
  toast,
  onNavigate,
}: {
  info: HelpInfo | null;
  notice: string | null;
  setNotice: (message: string | null) => void;
  reload: () => Promise<void>;
  toast: (message: string, opts?: ToastOptions) => void;
  onNavigate: () => void;
}) {
  if (!info) return <p className="text-muted">读取中…</p>;
  const gh = info.github;
  const banner = notice && <p className="mb-3 rounded border border-down/40 px-2 py-1.5 text-down">{notice}</p>;

  if (gh.setup !== "installed") {
    return (
      <>
        {banner}
        <p className="mb-3 leading-relaxed">
          {gh.setup === "none"
            ? `反馈会直接变成 ${info.repo.fullName} 的 GitHub issue，带上当前页面的信息，方便以后自动识别和修复。需要先在 GitHub 上建一个只属于本应用的 GitHub App（只有这个仓库的 Issues 读写权限），点两下就好，凭据保存在服务器的 ~/.config/hebi8，不进仓库。`
            : `GitHub App ${gh.appName ?? ""} 已创建，但还没有安装到 ${info.repo.fullName}。`}
        </p>
        <Link href="/settings/github" onClick={onNavigate} className="btn btn-primary">
          {gh.setup === "none" ? "配置 GitHub App" : "继续配置"}
        </Link>
      </>
    );
  }

  if (!gh.user) {
    const href = `/api/github/login?return=${encodeURIComponent(pagePath())}`;
    return (
      <>
        {banner}
        <p className="mb-3 leading-relaxed">用你的 GitHub 账号登录，反馈会以你的名义提交到 {info.repo.fullName}。</p>
        {gh.loginProblem && <p className="mb-3 text-down">{gh.loginProblem}</p>}
        <a href={href} className="btn btn-primary">
          用 GitHub 登录
        </a>
      </>
    );
  }

  return (
    <>
      {banner}
      <FeedbackForm
        info={info}
        toast={toast}
        onLoggedOut={(message) => {
          setNotice(message);
          void reload();
        }}
        reload={reload}
      />
    </>
  );
}

function FeedbackForm({
  info,
  reload,
  toast,
  onLoggedOut,
}: {
  info: HelpInfo;
  reload: () => Promise<void>;
  toast: (message: string, opts?: ToastOptions) => void;
  /** The server dropped the session (401): show why above the login button */
  onLoggedOut: (message: string) => void;
}) {
  const user = info.github.user!;
  const [type, setType] = useState<FeedbackType>(draft.type);
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);
  const [attach, setAttach] = useState(draft.attach);
  const [autoFix, setAutoFix] = useState(draft.autoFix);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState(0);
  const [issues, setIssues] = useState<IssueSummary[] | null>(null);
  const [issuesError, setIssuesError] = useState<string | null>(null);

  useEffect(() => {
    Object.assign(draft, { type, title, description, attach, autoFix });
  }, [type, title, description, attach, autoFix]);

  // taken once per form (and after each submit), so the preview is exactly what gets sent
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `snapshot` re-collects on purpose
  const base = useMemo(() => collectContext("bug"), [snapshot]);
  const context = useMemo<FeedbackContext>(() => ({ ...base, type }), [base, type]);

  const loadIssues = useCallback(async () => {
    try {
      const res = await fetch("/api/github/issues", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setIssues(json.issues as IssueSummary[]);
      setIssuesError(null);
    } catch (err) {
      setIssuesError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves
    void loadIssues();
  }, [loadIssues]);

  const submit = async () => {
    if (busy) return;
    if (!title.trim()) {
      setError("标题不能为空");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/github/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, title, description, context: attach ? context : null, autoFix }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = json.error ?? `提交失败：HTTP ${res.status}`;
        if (res.status === 401) onLoggedOut(message);
        else setError(message);
        return;
      }
      toast(`已提交 #${json.number}`, { href: json.html_url });
      setTitle("");
      setDescription("");
      setAutoFix(false);
      setSnapshot((n) => n + 1);
      void loadIssues();
    } catch (err) {
      setError(`提交失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/github/logout", { method: "POST" }).catch(() => undefined);
    await reload();
  };

  const labels = feedbackLabels(type, autoFix);

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- GitHub avatar, no optimisation wanted */}
        <img src={`${user.avatarUrl}${user.avatarUrl.includes("?") ? "&" : "?"}s=48`} alt="" width={20} height={20} className="rounded-full" />
        <span className="font-medium">{user.login}</span>
        <span className="flex-1" />
        <button type="button" className="btn" onClick={() => void logout()}>
          退出
        </button>
      </div>

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
          aria-invalid={error === "标题不能为空" ? true : undefined}
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
        {attach && (
          <details className="rounded border border-line">
            <summary className="cursor-pointer px-2 py-1 text-muted">
              预览将附带的信息{context.chart ? ` · ${context.chart.symbol}` : ""} · {context.errors.length} 条前端错误
            </summary>
            <pre className="max-h-60 overflow-auto border-t border-line px-2 py-1.5 font-mono text-[11px] leading-snug whitespace-pre-wrap break-all">
              {JSON.stringify(context, null, 2)}
            </pre>
          </details>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={autoFix} onChange={(e) => setAutoFix(e.target.checked)} />
          可以自动修复
          <span className="text-muted">（加标签 auto-fix-ok）</span>
        </label>
        {error && <p className="text-down">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "提交中…" : "提交"}
          </button>
          <span className="text-[11px] text-muted">Ctrl/Cmd+Enter · 标签 {labels.join(" ")}</span>
        </div>
      </form>

      <section className="mt-5">
        <h3 className="mb-1.5 text-[11px] font-medium text-muted">最近的应用内反馈</h3>
        {issuesError ? (
          <p className="text-down">{issuesError}</p>
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
          <ExtLink href={info.repo.issuesUrl}>全部</ExtLink>
        </p>
      </section>
    </>
  );
}
