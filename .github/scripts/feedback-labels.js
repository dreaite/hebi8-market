/**
 * Labels for in-app feedback, run by .github/workflows/app-feedback.yml on issues opened or
 * edited. The app cannot label issues itself (non-collaborators' labels are dropped by GitHub),
 * so it writes `type` and `autoFix` into the ```json hebi8-context block of the body and this
 * script turns them into labels.
 *
 * The body is untrusted input and is only ever parsed as JSON data: nothing from it is evaluated,
 * interpolated into a shell or used as a label name unless it is on the allowlist below.
 * `auto-fix-ok` is only given to issues whose author is the owner, an org member or a
 * collaborator; anyone else who ticks 可以自动修复 gets `auto-fix-requested`.
 */

const FENCE_RE = /```json hebi8-context\r?\n([\s\S]*?)\r?\n```/;
const MAX_BODY = 65536;

const TYPES = ["bug", "ux", "data", "idea"];
const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

const LABELS = {
  "from-app": { color: "5319e7", description: "Reported from inside hebi8/market" },
  bug: { color: "d73a4a", description: "Something isn't working" },
  ux: { color: "0e8a16", description: "Feels wrong or awkward to use" },
  data: { color: "fbca04", description: "Market data, sync or calculation looks off" },
  idea: { color: "1d76db", description: "Something new to try" },
  "auto-fix-ok": { color: "c2e0c6", description: "A maintainer allows automation to attempt a fix" },
  "auto-fix-requested": { color: "f9d0c4", description: "The reporter would welcome an automated fix; needs a maintainer's OK" },
};

/** `{ type, autoFix }` from the context block, or null when there is no readable block. */
function readContext(body) {
  if (typeof body !== "string" || body.length > MAX_BODY) return null;
  const m = FENCE_RE.exec(body);
  if (!m) return null;
  let value;
  try {
    value = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    type: TYPES.includes(value.type) ? value.type : null,
    autoFix: value.autoFix === true,
  };
}

/** The labels an issue should carry; empty when it is not in-app feedback. */
function decideLabels({ body, authorAssociation }) {
  const ctx = readContext(body);
  if (!ctx) return [];
  const labels = ["from-app"];
  if (ctx.type) labels.push(ctx.type);
  if (ctx.autoFix) labels.push(TRUSTED_ASSOCIATIONS.includes(authorAssociation) ? "auto-fix-ok" : "auto-fix-requested");
  return labels;
}

/** Create the labels the repo lacks (422 = someone else just created it). */
async function ensureLabels(github, { owner, repo }, names, log = () => {}) {
  for (const name of names) {
    try {
      await github.rest.issues.getLabel({ owner, repo, name });
    } catch (err) {
      if (!err || err.status !== 404) throw err;
      try {
        await github.rest.issues.createLabel({ owner, repo, name, ...LABELS[name] });
        log(`created label ${name}`);
      } catch (createErr) {
        if (!createErr || createErr.status !== 422) throw createErr;
      }
    }
  }
}

/** Entry point for actions/github-script. Labels are only ever added, never removed. */
async function run({ github, context, core }) {
  const issue = context.payload && context.payload.issue;
  if (!issue || issue.pull_request) return [];
  const labels = decideLabels({ body: issue.body, authorAssociation: issue.author_association });
  if (labels.length === 0) {
    core.info(`#${issue.number}: no hebi8-context block, nothing to do`);
    return [];
  }
  const { owner, repo } = context.repo;
  await ensureLabels(github, { owner, repo }, labels, (m) => core.info(m));
  await github.rest.issues.addLabels({ owner, repo, issue_number: issue.number, labels });
  core.info(`#${issue.number}: ${labels.join(", ")}`);
  return labels;
}

module.exports = { LABELS, TRUSTED_ASSOCIATIONS, TYPES, decideLabels, ensureLabels, readContext, run };
