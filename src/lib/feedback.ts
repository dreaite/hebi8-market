/**
 * In-app feedback: the issue body, its machine-readable context block and the github.com
 * fallback link. Pure and shared by the client (preview, fallback link) and the server (the issue
 * that is actually created), so what the user sees is what gets attached.
 *
 * Labels are not set here: non-collaborators cannot label issues, so the repo's Actions workflow
 * (`.github/workflows/app-feedback.yml`) reads `type` / `autoFix` from the context block instead.
 */

export const FEEDBACK_TYPES = [
  { id: "bug", label: "问题" },
  { id: "ux", label: "体验" },
  { id: "data", label: "数据" },
  { id: "idea", label: "想法" },
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number]["id"];

export function isFeedbackType(value: unknown): value is FeedbackType {
  return FEEDBACK_TYPES.some((t) => t.id === value);
}

export interface ClientError {
  /** ISO time */
  t: string;
  kind: "error" | "rejection";
  message: string;
  /** `file:line:col` for window errors */
  source?: string;
}

/** The chart page's state at the time of the report. */
export interface ChartContext {
  symbol: string;
  tf: string;
  style: string;
  log: boolean;
  prices: string;
  indicators: string[];
  compares: { key: string; mode: string }[];
}

/** What 附带页面信息 adds; collected in the browser. */
export interface PageInfo {
  app: { version: string; commit: string; builtAt: string | null };
  page: string;
  chart?: ChartContext;
  viewport: { width: number; height: number; dpr: number };
  colorScheme: "light" | "dark";
  fullscreen: boolean;
  userAgent: string;
  errors: ClientError[];
  at: string;
}

/**
 * The machine-readable block at the end of every in-app issue (```json hebi8-context). `v`,
 * `type` and `autoFix` are always there (the labelling workflow needs them); the page info only
 * when 附带页面信息 is ticked. Bump `v` when a field changes meaning; automation should ignore
 * unknown fields.
 */
export type FeedbackContext = { v: 1; type: FeedbackType; autoFix: boolean } & Partial<PageInfo>;

export const CONTEXT_FENCE = "json hebi8-context";
const MAX_DESCRIPTION = 20000;
const MAX_CONTEXT = 20000;
export const FOOTER = "<sub>来自 hebi8/market 应用内反馈</sub>";

/**
 * The page address a report may carry: path and query, without the help drawer's own `help` and
 * without the one-time code of `/claim` (design §5.8). Issues are public, and that code would
 * still log in whoever read it there first.
 */
export function reportablePage(page: string): string {
  const at = page.indexOf("?");
  const path = at < 0 ? page : page.slice(0, at);
  const query = new URLSearchParams(at < 0 ? "" : page.slice(at + 1));
  query.delete("help");
  if (path.replace(/\/+$/, "") === "/claim") query.delete("c");
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

export function feedbackContext(type: FeedbackType, autoFix: boolean, page: PageInfo | null): FeedbackContext {
  return { v: 1, type, autoFix, ...(page ? { ...page, page: reportablePage(page.page) } : {}) };
}

/** The issue body: description, the context block in a `<details>`, the footer. */
export function buildIssueBody(description: string, context: FeedbackContext, { compact = false }: { compact?: boolean } = {}): string {
  const json = compact ? JSON.stringify(context) : JSON.stringify(context, null, 2);
  const summary = context.page !== undefined ? "页面信息" : "反馈信息";
  return [
    description.trim().slice(0, MAX_DESCRIPTION) || "（没有描述）",
    "---",
    [`<details><summary>${summary}</summary>`, "", "```" + CONTEXT_FENCE, json, "```", "</details>"].join("\n"),
    FOOTER,
  ].join("\n\n") + "\n";
}

/** Read the context block back out of an issue body (for automation and tests). */
export function parseIssueContext(body: string): FeedbackContext | null {
  const m = new RegExp("```" + CONTEXT_FENCE + "\\r?\\n([\\s\\S]*?)\\r?\\n```").exec(body);
  if (!m) return null;
  try {
    const value = JSON.parse(m[1]);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as FeedbackContext) : null;
  } catch {
    return null;
  }
}

/** GitHub answers 414 somewhere past 8 KB of URL; stay well below. */
export const MAX_WEB_URL = 7000;
export const TRUNCATED_NOTE = "\n\n…（内容太长，网页版已截断，请把剩下的部分粘贴到这里）";

/**
 * "在 GitHub 网页上提交": github.com's new-issue form, prefilled with the same title and body.
 * Too long for a URL → compact JSON, then drop the bulky context fields (errors, user agent,
 * then all page info), and only then truncate the description.
 */
export function webIssueUrl(repo: string, title: string, description: string, context: FeedbackContext, maxLength = MAX_WEB_URL): string {
  const base = `https://github.com/${repo}/issues/new?`;
  const url = (desc: string, ctx: FeedbackContext, compact: boolean) => base + new URLSearchParams({ title: title.trim().slice(0, 200), body: buildIssueBody(desc, ctx, { compact }) });
  const { errors: _errors, userAgent: _ua, ...slim } = context;
  void _errors;
  void _ua;
  const minimal: FeedbackContext = { v: context.v, type: context.type, autoFix: context.autoFix };
  const attempts: [FeedbackContext, boolean][] = [
    [context, false],
    [context, true],
    [slim, true],
    [minimal, true],
  ];
  for (const [ctx, compact] of attempts) {
    const u = url(description, ctx, compact);
    if (u.length <= maxLength) return u;
  }
  // keep as much of the description as fits (binary search on its length)
  const text = description.trim();
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (url(text.slice(0, mid) + TRUNCATED_NOTE, minimal, true).length <= maxLength) lo = mid;
    else hi = mid - 1;
  }
  return url(text.slice(0, lo) + TRUNCATED_NOTE, minimal, true);
}

export interface FeedbackInput {
  type: FeedbackType;
  title: string;
  description: string;
  autoFix: boolean;
  context: FeedbackContext;
}

/** Validate a submission from the client; throws a message suitable for the UI. */
export function parseFeedbackInput(raw: unknown): FeedbackInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!isFeedbackType(r.type)) throw new Error("反馈类型不对");
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) throw new Error("标题不能为空");
  if (title.length > 200) throw new Error("标题太长（最多 200 字）");
  const description = typeof r.description === "string" ? r.description : "";
  const autoFix = r.autoFix === true;
  let page: Partial<PageInfo> = {};
  if (r.context && typeof r.context === "object" && !Array.isArray(r.context)) {
    const { v: _v, type: _t, autoFix: _a, ...rest } = r.context as Record<string, unknown>;
    void _v;
    void _t;
    void _a;
    page = rest as Partial<PageInfo>;
    // whatever the client sent: a login code never goes into a public issue
    if (typeof page.page === "string") page.page = reportablePage(page.page);
  }
  // type and autoFix come from the form itself, whatever the client put in the context
  const context: FeedbackContext = { v: 1, type: r.type, autoFix, ...page };
  if (JSON.stringify(context).length > MAX_CONTEXT) throw new Error("附带的页面信息太大");
  return { type: r.type, title, description, autoFix, context };
}
