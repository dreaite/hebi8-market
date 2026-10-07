import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { buildIssueBody, feedbackContext } from "@/lib/feedback";

const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const labels = require(path.join(root, ".github/scripts/feedback-labels.js"));

const body = (type: "bug" | "ux" | "data" | "idea", autoFix: boolean) => buildIssueBody("描述", feedbackContext(type, autoFix, null));

describe("feedback-labels.js", () => {
  it("labels in-app feedback with from-app and its type", () => {
    expect(labels.decideLabels({ body: body("data", false), authorAssociation: "NONE" })).toEqual(["from-app", "data"]);
    expect(labels.decideLabels({ body: buildIssueBody("x", feedbackContext("ux", false, null), { compact: true }), authorAssociation: "NONE" })).toEqual(["from-app", "ux"]);
  });

  it("gives auto-fix-ok only to the owner, members and collaborators", () => {
    for (const a of ["OWNER", "MEMBER", "COLLABORATOR"]) {
      expect(labels.decideLabels({ body: body("bug", true), authorAssociation: a })).toEqual(["from-app", "bug", "auto-fix-ok"]);
    }
    for (const a of ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE", "MANNEQUIN", undefined]) {
      expect(labels.decideLabels({ body: body("bug", true), authorAssociation: a })).toEqual(["from-app", "bug", "auto-fix-requested"]);
    }
  });

  it("treats the body as data: no block, broken JSON, odd values and unknown types", () => {
    expect(labels.decideLabels({ body: "just text", authorAssociation: "OWNER" })).toEqual([]);
    expect(labels.decideLabels({ body: null, authorAssociation: "OWNER" })).toEqual([]);
    expect(labels.decideLabels({ body: "```json hebi8-context\n{not json\n```", authorAssociation: "OWNER" })).toEqual([]);
    expect(labels.decideLabels({ body: "```json hebi8-context\n[1]\n```", authorAssociation: "OWNER" })).toEqual([]);
    const evil = '```json hebi8-context\n{"type":"wontfix\\",\\"x","autoFix":"true","__proto__":{"autoFix":true}}\n```';
    expect(labels.decideLabels({ body: evil, authorAssociation: "OWNER" })).toEqual(["from-app"]);
    expect(labels.decideLabels({ body: body("bug", true) + "x".repeat(70000), authorAssociation: "OWNER" })).toEqual([]);
  });

  it("every label it can add has a colour and description", () => {
    for (const t of labels.TYPES) expect(labels.LABELS[t]).toBeDefined();
    for (const name of ["from-app", "auto-fix-ok", "auto-fix-requested"]) expect(labels.LABELS[name].color).toMatch(/^[0-9a-f]{6}$/);
  });

  it("run creates missing labels, then adds them to the issue", async () => {
    const existing = new Set(["bug"]);
    const github = {
      rest: {
        issues: {
          getLabel: vi.fn(async ({ name }: { name: string }) => {
            if (!existing.has(name)) throw Object.assign(new Error("Not Found"), { status: 404 });
            return { data: { name } };
          }),
          createLabel: vi.fn(async () => ({})),
          addLabels: vi.fn(async () => ({})),
        },
      },
    };
    const core = { info: vi.fn() };
    const context = { repo: { owner: "dreaite", repo: "hebi8-market" }, payload: { issue: { number: 7, body: body("bug", true), author_association: "NONE" } } };
    expect(await labels.run({ github, context, core })).toEqual(["from-app", "bug", "auto-fix-requested"]);
    expect(github.rest.issues.createLabel.mock.calls.map((c: unknown[]) => (c[0] as { name: string }).name)).toEqual(["from-app", "auto-fix-requested"]);
    expect(github.rest.issues.createLabel).toHaveBeenCalledWith({ owner: "dreaite", repo: "hebi8-market", name: "from-app", color: "5319e7", description: "Reported from inside hebi8/market" });
    expect(github.rest.issues.addLabels).toHaveBeenCalledWith({ owner: "dreaite", repo: "hebi8-market", issue_number: 7, labels: ["from-app", "bug", "auto-fix-requested"] });

    github.rest.issues.addLabels.mockClear();
    context.payload.issue.body = "plain issue";
    expect(await labels.run({ github, context, core })).toEqual([]);
    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
  });
});

describe("app-feedback.yml", () => {
  const wf = parse(fs.readFileSync(path.join(root, ".github/workflows/app-feedback.yml"), "utf8"));

  it("runs on issues opened / edited with only issues: write", () => {
    expect(wf.on).toEqual({ issues: { types: ["opened", "edited"] } });
    expect(wf.permissions).toEqual({ contents: "read", issues: "write" });
  });

  it("pins action major versions and loads the script from the checkout", () => {
    const steps = wf.jobs.label.steps as { uses: string; with?: Record<string, string> }[];
    for (const s of steps) expect(s.uses).toMatch(/^actions\/[a-z-]+@v\d+$/);
    expect(steps.map((s) => s.uses.split("@")[0])).toEqual(["actions/checkout", "actions/github-script"]);
    expect(steps[1].with!.script).toContain(".github/scripts/feedback-labels.js");
    // nothing from the event is interpolated into the script
    expect(steps[1].with!.script).not.toContain("${{");
  });
});
