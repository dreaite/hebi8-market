"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { APP_INFO, REPO_URL } from "@/lib/app-info";
import { recentErrors } from "@/lib/client-errors";
import { FEEDBACK_TYPES, feedbackContext, webIssueUrl, type FeedbackType, type PageInfo } from "@/lib/feedback";
import type { IssueSummary } from "@/lib/github";
import type { HelpInfo } from "@/lib/help-info";
import { getChartContext } from "@/lib/page-context";
import { useLocalStorage } from "@/lib/use-local-storage";
import { IconExternal } from "./chart-icons";
import { Drawer, ExtLink, Section, useHelpInfo } from "./Drawer";
import { AccountBlock, postJson } from "./GitHubLogin";
import { useUi, type ToastOptions } from "./UiProvider";

/** `project` is the 使用 tab (its id predates the rename and is in people's localStorage). */
export type HelpTab = "project" | "feedback";

const SHORTCUTS: { group: string; rows: [string, string][] }[] = [
  {
    group: "全局",
    rows: [
      ["/  ·  Ctrl/Cmd+K", "打开搜索"],
      ["?", "打开 / 关闭帮助"],
      ["↑ ↓  Enter", "搜索里移动、打开图表"],
      ["Shift+Enter  Tab", "搜索里加入自选、换分组"],
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
  onClose,
  toast,
}: {
  tab: HelpTab | null;
  /** Shown above the feedback form when the drawer opens */
  notice: string | null;
  onClose: () => void;
  toast: (message: string, opts?: ToastOptions) => void;
}) {
  const [storedTab, setStoredTab] = useLocalStorage<HelpTab>("hebi8:help:tab", "project");
  const [override, setOverride] = useState<HelpTab | null>(initialTab);
  const [notice, setNotice] = useState(initialNotice);
  // a stored tab that no longer exists (the old 通知) falls back to 使用
  const tab = override ?? (storedTab === "feedback" ? "feedback" : "project");
  const chooseTab = (t: HelpTab) => {
    setOverride(null);
    setStoredTab(t);
  };
  useEffect(() => {
    if (initialTab) setStoredTab(initialTab);
  }, [initialTab, setStoredTab]);

  const { info, error, reload } = useHelpInfo();

  const tabs = (
    <div role="tablist" aria-label="帮助" className="flex h-full items-stretch gap-1">
      {(
        [
          ["project", "使用"],
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
  );

  return (
    <Drawer label="帮助与反馈" header={tabs} onClose={onClose}>
      <div role="tabpanel">
        {tab === "project" ? (
          <UsageTab />
        ) : (
          <>
            {error && <p className="mb-3 text-down">读取失败：{error}</p>}
            <FeedbackTab info={info} notice={notice} setNotice={setNotice} reload={reload} toast={toast} />
          </>
        )}
      </div>
    </Drawer>
  );
}

/** What someone using the app needs: the how-to, the keys, and where the docs and privacy notice are. */
function UsageTab() {
  const { openGuide } = useUi();
  return (
    <>
      <Section title="怎么用">
        <p className="leading-relaxed text-muted">扫描总览，深看图表，在复盘页写下这周的想法。</p>
        <button type="button" onClick={openGuide} className="btn btn-secondary mt-2">
          打开三步引导
        </button>
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

      <Section title="更多">
        <ul className="space-y-1">
          <li>
            <ExtLink href={REPO_URL}>项目文档</ExtLink>
          </li>
          <li>
            <Link href="/privacy" className="text-accent hover:underline">
              隐私说明
            </Link>
          </li>
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
}: {
  info: HelpInfo | null;
  notice: string | null;
  setNotice: (message: string | null) => void;
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
            这台 hebi8/market 不能在应用里直接提交。填好下面的内容，点「在 GitHub 网页上提交」，会在 github.com 打开预填好的 issue。
          </p>
        </div>
      ) : (
        <AccountBlock
          info={info}
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
      <RecentIssues key={issuesVersion} issuesUrl={info.issuesUrl} />
    </>
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
            以你的 GitHub 账号提交到 <span className="font-mono">{repo}</span>
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