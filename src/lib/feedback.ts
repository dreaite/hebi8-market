/**
 * In-app feedback: the issue body and labels. Pure and shared by the client (preview) and the
 * server (the issue that is actually created), so what the user sees is what gets attached.
 */
import { FROM_APP_LABEL } from "./app-info";

export const FEEDBACK_TYPES = [
  { id: "bug", label: "问题", issueLabel: "bug" },
  { id: "ux", label: "体验", issueLabel: "ux" },
  { id: "data", label: "数据", issueLabel: "data" },
  { id: "idea", label: "想法", issueLabel: "idea" },
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number]["id"];

export const AUTO_FIX_LABEL = "auto-fix-ok";

/** Labels the app creates on first use when the repo does not have them (`bug` already exists on GitHub). */
export const LABEL_SPECS: Record<string, { color: string; description: string }> = {
  [FROM_APP_LABEL]: { color: "5319e7", description: "Reported from inside hebi8 market" },
  bug: { color: "d73a4a", description: "Something isn't working" },
  ux: { color: "0e8a16", description: "Feels wrong or awkward to use" },
  data: { color: "fbca04", description: "Market data, sync or calculation looks off" },
  idea: { color: "1d76db", description: "Something new to try" },
  [AUTO_FIX_LABEL]: { color: "c2e0c6", description: "Owner allows automation to attempt a fix" },
};

export function isFeedbackType(value: unknown): value is FeedbackType {
  return FEEDBACK_TYPES.some((t) => t.id === value);
}

export function feedbackLabels(type: FeedbackType, autoFix: boolean): string[] {
  const typeLabel = FEEDBACK_TYPES.find((t) => t.id === type)!.issueLabel;
  return [FROM_APP_LABEL, typeLabel, ...(autoFix ? [AUTO_FIX_LABEL] : [])];
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

/**
 * The machine-readable block at the end of every in-app issue (```json hebi8-context). Bump `v`
 * when a field changes meaning; automation should ignore unknown fields.
 */
export interface FeedbackContext {
  v: 1;
  type: FeedbackType;
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

export const CONTEXT_FENCE = "json hebi8-context";
const MAX_DESCRIPTION = 20000;

/** The issue body; `context` is omitted when the user unticks 附带页面信息. */
export function buildIssueBody(description: string, context: FeedbackContext | null): string {
  const parts = [description.trim().slice(0, MAX_DESCRIPTION) || "（没有描述）"];
  if (context) {
    parts.push(
      "---",
      ["<details><summary>页面信息</summary>", "", "```" + CONTEXT_FENCE, JSON.stringify(context, null, 2), "```", "</details>"].join("\n"),
    );
  }
  parts.push("<sub>来自 hebi8 market 应用内反馈</sub>");
  return parts.join("\n\n") + "\n";
}

/** Read the context block back out of an issue body (for automation and tests). */
export function parseIssueContext(body: string): FeedbackContext | null {
  const m = new RegExp("```" + CONTEXT_FENCE + "\\n([\\s\\S]*?)\\n```").exec(body);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as FeedbackContext;
  } catch {
    return null;
  }
}

export interface FeedbackInput {
  type: FeedbackType;
  title: string;
  description: string;
  context: FeedbackContext | null;
  autoFix: boolean;
}

/** Validate a submission from the client; throws a message suitable for the UI. */
export function parseFeedbackInput(raw: unknown): FeedbackInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!isFeedbackType(r.type)) throw new Error("反馈类型不对");
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) throw new Error("标题不能为空");
  if (title.length > 200) throw new Error("标题太长（最多 200 字）");
  const description = typeof r.description === "string" ? r.description : "";
  const context = r.context && typeof r.context === "object" ? ({ ...(r.context as FeedbackContext), type: r.type } as FeedbackContext) : null;
  return { type: r.type, title, description, context, autoFix: r.autoFix === true };
}
