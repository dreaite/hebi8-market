import { NextResponse, type NextRequest } from "next/server";
import { buildIssueBody, feedbackLabels, parseFeedbackInput } from "@/lib/feedback";
import { COOKIES, GitHubError, createIssue, crossSite, ensureLabels, recentFromAppIssues, userToken } from "@/lib/github";
import { deleteSession, readApp } from "@/lib/secrets";

export const dynamic = "force-dynamic";

const failure = (err: unknown) => {
  // input errors are 400; GitHub's own status passes through (401 tells the panel to log in again)
  const status = !(err instanceof GitHubError) ? 400 : err.status >= 400 && err.status < 600 ? err.status : 502;
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
};

/** The latest in-app reports, read with the installation token (the only network read in the help panel). */
export async function GET() {
  const app = readApp();
  if (!app?.installation_id) return NextResponse.json({ issues: [] });
  try {
    return NextResponse.json({ issues: await recentFromAppIssues(app) });
  } catch (err) {
    return failure(err);
  }
}

/** Submit feedback as the logged-in user: ensure the labels, then open the issue. */
export async function POST(request: NextRequest) {
  if (crossSite(request.headers)) return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const app = readApp();
  if (!app) return NextResponse.json({ error: "还没有配置 GitHub App" }, { status: 409 });
  let input;
  try {
    input = parseFeedbackInput(await request.json());
  } catch (err) {
    return failure(err);
  }
  const sessionId = request.cookies.get(COOKIES.session)?.value;
  try {
    const { token } = await userToken(app, sessionId);
    const labels = feedbackLabels(input.type, input.autoFix);
    await ensureLabels(app, labels);
    const issue = await createIssue(token, { title: input.title, body: buildIssueBody(input.description, input.context), labels });
    return NextResponse.json({ number: issue.number, html_url: issue.html_url });
  } catch (err) {
    const res = failure(err);
    // the user's token is gone (revoked, expired refresh): drop the session so the panel offers login again
    if (res.status === 401) {
      deleteSession(sessionId);
      res.cookies.delete(COOKIES.session);
    }
    return res;
  }
}
