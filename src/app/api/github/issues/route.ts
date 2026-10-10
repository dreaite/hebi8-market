import { NextResponse, type NextRequest } from "next/server";
import { feedbackRepo, githubClientId } from "@/lib/app-info";
import { buildIssueBody, parseFeedbackInput } from "@/lib/feedback";
import { GitHubError, SESSION_COOKIE, createIssue, crossSite, forgetRecentIssues, recentFromAppIssues, userToken } from "@/lib/github";
import { deleteSession, getSession } from "@/lib/secrets";

export const dynamic = "force-dynamic";

const failure = (err: unknown) => {
  // input errors are 400; GitHub's own status passes through (401 tells the panel to log in again)
  const status = !(err instanceof GitHubError) ? 400 : err.status >= 400 && err.status < 600 ? err.status : 502;
  const webFallback = err instanceof GitHubError && err.webFallback;
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err), ...(webFallback ? { webFallback: true } : {}) }, { status });
};

/**
 * The latest in-app reports (cached 60 s): with the user's token when logged in, else anonymously.
 * The stored token is used as is here (no refresh), and a failure with it falls back to anonymous.
 */
export async function GET(request: NextRequest) {
  const session = getSession(request.cookies.get(SESSION_COOKIE)?.value);
  const token = session?.access_token && (!session.access_expires_at || session.access_expires_at > Date.now()) ? session.access_token : null;
  try {
    return NextResponse.json({ issues: await recentFromAppIssues(feedbackRepo(), token) });
  } catch (err) {
    return failure(err);
  }
}

/** Submit feedback as the logged-in user: they are the issue's author; labels come from the repo's workflow. */
export async function POST(request: NextRequest) {
  if (crossSite(request.headers)) return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const clientId = githubClientId();
  if (!clientId) return NextResponse.json({ error: "反馈未启用：没有配置 GitHub App 的 client id", webFallback: true }, { status: 409 });
  let input;
  try {
    input = parseFeedbackInput(await request.json());
  } catch (err) {
    return failure(err);
  }
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  const repo = feedbackRepo();
  try {
    const { token, session } = await userToken(clientId, sessionId);
    // a refusal reads differently when the token is not the feedback App's (a web login through another client)
    const otherClient = Boolean(session.web_client) && session.web_client !== clientId;
    const issue = await createIssue(token, repo, { title: input.title, body: buildIssueBody(input.description, input.context) }, otherClient);
    forgetRecentIssues(repo);
    return NextResponse.json({ number: issue.number, html_url: issue.html_url });
  } catch (err) {
    const res = failure(err);
    // the user's token is gone (revoked, expired refresh): drop the session so the panel offers login again
    if (res.status === 401) {
      deleteSession(sessionId);
      res.cookies.delete(SESSION_COOKIE);
    }
    return res;
  }
}
