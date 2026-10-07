import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const triage = require(path.join(root, ".github/scripts/issue-triage.js"));

const answer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "bug", areas: ["chart"], difficulty: "simple", duplicateOf: null, reason: "按钮没反应", ...over });

describe("issue-triage.js parseDecision", () => {
  it("reads a plain or fenced JSON answer", () => {
    expect(triage.parseDecision(answer())).toEqual({ type: "bug", areas: ["chart"], difficulty: "simple", duplicateOf: null, reason: "按钮没反应" });
    expect(triage.parseDecision("```json\n" + answer({ type: "ux" }) + "\n```")?.type).toBe("ux");
  });

  it("rejects answers outside the allowlists", () => {
    expect(triage.parseDecision("no json here")).toBeNull();
    expect(triage.parseDecision("{broken")).toBeNull();
    expect(triage.parseDecision(answer({ type: "admin" }))).toBeNull();
    expect(triage.parseDecision(answer({ difficulty: "trivial" }))).toBeNull();
  });

  it("keeps known areas only, at most two, and duplicates of open issues only", () => {
    const d = triage.parseDecision(answer({ areas: ["chart", "../../x", "chart", "alerts", "data"], duplicateOf: 7 }), [3, 7]);
    expect(d.areas).toEqual(["chart", "alerts"]);
    expect(d.duplicateOf).toBe(7);
    expect(triage.parseDecision(answer({ duplicateOf: 99 }), [3]).duplicateOf).toBeNull();
  });
});

describe("issue-triage.js decideLabels", () => {
  const decision = triage.parseDecision(answer());

  it("gives triage:simple only to trusted authors", () => {
    for (const a of ["OWNER", "MEMBER", "COLLABORATOR"]) {
      expect(triage.decideLabels({ decision, authorAssociation: a })).toEqual(["bug", "area:chart", "triage:simple"]);
    }
    for (const a of ["CONTRIBUTOR", "NONE", undefined]) {
      expect(triage.decideLabels({ decision, authorAssociation: a })).toEqual(["bug", "area:chart", "triage:judgment"]);
    }
  });

  it("keeps the type in-app feedback already set and skips labels already there", () => {
    expect(triage.decideLabels({ decision, existing: ["from-app", "ux", "area:chart"], authorAssociation: "OWNER" })).toEqual(["triage:simple"]);
  });

  it("sends duplicates and unusable answers to the maintainer", () => {
    const dup = triage.parseDecision(answer({ duplicateOf: 3 }), [3]);
    expect(triage.decideLabels({ decision: dup, authorAssociation: "OWNER" })).toEqual(["bug", "area:chart", "duplicate", "triage:judgment"]);
    expect(triage.decideLabels({ decision: null, authorAssociation: "OWNER" })).toEqual(["triage:judgment"]);
  });

  it("only ever produces labels it knows how to create", () => {
    for (const type of triage.TYPES) expect(triage.LABELS[type]).toBeDefined();
    for (const area of triage.AREAS) expect(triage.LABELS[`area:${area}`]).toBeDefined();
  });
});

describe("issue-triage.js run", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const setup = (issue: Record<string, unknown>) => {
    const added: string[][] = [];
    const created: string[] = [];
    const github = {
      paginate: async () => [{ number: 3, title: "旧的问题" }, { number: 5, title: "自己" }],
      rest: {
        issues: {
          listForRepo: () => {},
          get: async () => ({ data: { number: 5, title: "自动按钮没反应", body: "点了没用", author_association: "OWNER", labels: [], ...issue } }),
          getLabel: async ({ name }: { name: string }) => {
            if (name.startsWith("area:") || name.startsWith("triage:")) throw Object.assign(new Error("nf"), { status: 404 });
          },
          createLabel: async ({ name }: { name: string }) => void created.push(name),
          addLabels: async ({ labels }: { labels: string[] }) => void added.push(labels),
        },
      },
    };
    const core = { info: vi.fn(), notice: vi.fn(), warning: vi.fn(), summary: { addRaw: () => ({ write: async () => {} }) } };
    const context = { repo: { owner: "o", repo: "r" }, payload: { issue: { number: 5 } } };
    return { github, core, context, added, created };
  };

  it("asks the model with the project context and adds the labels", async () => {
    vi.stubEnv("TRIAGE_API_BASE", "https://api.example.com/v1/");
    vi.stubEnv("TRIAGE_MODEL", "m");
    vi.stubEnv("TRIAGE_API_KEY", "k");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: answer() } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const { github, core, context, added, created } = setup({});

    const labels = await triage.run({ github, context, core, fs: { readFileSync: () => "CONTEXT" } });

    expect(labels).toEqual(["bug", "area:chart", "triage:simple"]);
    expect(added).toEqual([["bug", "area:chart", "triage:simple"]]);
    expect(created).toEqual(["area:chart", "triage:simple"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).toContain("CONTEXT");
    expect(body.messages[1].content).toContain("#3 旧的问题");
    expect(body.messages[1].content).not.toContain("#5 自己");
  });

  it("labels triage:judgment when the model call fails", async () => {
    vi.stubEnv("TRIAGE_API_BASE", "https://api.example.com/v1");
    vi.stubEnv("TRIAGE_MODEL", "m");
    vi.stubEnv("TRIAGE_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const { github, core, context, added } = setup({});
    await triage.run({ github, context, core, fs: { readFileSync: () => "" } });
    expect(added).toEqual([["triage:judgment"]]);
    expect(core.warning).toHaveBeenCalled();
  });

  it("skips issues already triaged, and everything when the API is not configured", async () => {
    vi.stubEnv("TRIAGE_API_BASE", "https://api.example.com/v1");
    vi.stubEnv("TRIAGE_MODEL", "m");
    vi.stubEnv("TRIAGE_API_KEY", "k");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const done = setup({ labels: [{ name: "triage:judgment" }] });
    expect(await triage.run({ github: done.github, context: done.context, core: done.core, fs: { readFileSync: () => "" } })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("TRIAGE_API_KEY", "");
    const bare = setup({});
    expect(await triage.run({ github: bare.github, context: bare.context, core: bare.core, fs: { readFileSync: () => "" } })).toEqual([]);
    expect(bare.core.notice).toHaveBeenCalled();
  });
});

describe("issue-triage workflow", () => {
  it("passes the API settings and only checks out .github", () => {
    const wf = parse(fs.readFileSync(path.join(root, ".github/workflows/issue-triage.yml"), "utf8"));
    expect(wf.permissions).toEqual({ contents: "read", issues: "write" });
    const steps = wf.jobs.label.steps;
    expect(steps[0].with["sparse-checkout"]).toBe(".github");
    expect(Object.keys(steps[1].env)).toEqual(["TRIAGE_API_BASE", "TRIAGE_MODEL", "TRIAGE_API_KEY"]);
    expect(fs.existsSync(path.join(root, ".github/triage-context.md"))).toBe(true);
  });
});
