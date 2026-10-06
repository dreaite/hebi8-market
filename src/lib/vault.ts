/**
 * The vault is the user's content: `hebi8.yaml`, notes, journal, chart state. Writes go through
 * temp file + rename; yaml edits keep comments and order by mutating the parsed document.
 */
import fs from "node:fs";
import path from "node:path";
import { isScalar, isSeq, parse, parseDocument, type Document } from "yaml";
import { ConfigError, normalizeConfig, type Config } from "./config";
import { fileKey, hash6, isValidKey } from "./symbols";
import { isWeekId } from "./week";

export function vaultDir(): string {
  return process.env.HEBI8_VAULT ?? path.join(process.cwd(), "vault");
}

const yamlPath = () => path.join(vaultDir(), "hebi8.yaml");
const sub = (name: string) => path.join(vaultDir(), name);

/** First run: start from the example config so the sample groups show up. */
export function ensureVault(): void {
  if (fs.existsSync(yamlPath())) return;
  for (const d of ["notes", "journal", "charts"]) fs.mkdirSync(sub(d), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), "vault.example", "hebi8.yaml"), yamlPath());
}

function atomicWrite(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------- hebi8.yaml

let cached: { mtimeMs: number; size: number; config: Config } | null = null;

function parseYaml(text: string): Document {
  const doc = parseDocument(text);
  const err = doc.errors[0];
  if (err) {
    const line = err.linePos?.[0]?.line;
    throw new ConfigError(`hebi8.yaml${line ? ` 第 ${line} 行` : ""}：${err.message.split("\n")[0]}`);
  }
  return doc;
}

export function readConfig(): Config {
  const file = yamlPath();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new ConfigError(`找不到 ${file}`);
  }
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.config;
  const config = normalizeConfig(parseYaml(fs.readFileSync(file, "utf8")).toJS());
  cached = { mtimeMs: stat.mtimeMs, size: stat.size, config };
  return config;
}

export function readConfigSafe(): { config: Config | null; error: string | null } {
  try {
    return { config: readConfig(), error: null };
  } catch (err) {
    return { config: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Edit the yaml in place; the result is validated before it is written. */
export function updateConfig(mutate: (doc: Document) => void): Config {
  const doc = parseYaml(fs.readFileSync(yamlPath(), "utf8"));
  mutate(doc);
  const config = normalizeConfig(doc.toJS());
  // Comments and order survive; the library re-spaces inline comments, which is as close as it gets.
  atomicWrite(yamlPath(), doc.toString({ lineWidth: 0 }));
  cached = null;
  return config;
}

/** Replace a scalar's value, keeping the comment on its line. */
export function setScalar(doc: Document, keyPath: (string | number)[], value: unknown): void {
  const node = doc.getIn(keyPath, true);
  if (isScalar(node)) node.value = value;
  else doc.setIn(keyPath, value);
}

/** Replace a list's items, keeping its flow style and comment. */
export function setList(doc: Document, keyPath: (string | number)[], values: unknown[]): void {
  const node = doc.getIn(keyPath, true);
  if (isSeq(node)) node.items = values.map((v) => doc.createNode(v));
  else doc.setIn(keyPath, doc.createNode(values, { flow: true }));
}

export function flowNode(doc: Document, value: unknown) {
  return doc.createNode(value, { flow: true });
}

// ---------------------------------------------------------------------------- per-key files

/**
 * The frontmatter key (or json `key`) owns the file; when two keys sanitize to the same name
 * the later one gets a hash suffix.
 */
function ownedPath(dir: string, key: string, ext: string, keyOf: (text: string) => string | null): string {
  const plain = path.join(dir, fileKey(key) + ext);
  if (!fs.existsSync(plain)) return plain;
  const owner = keyOf(fs.readFileSync(plain, "utf8"));
  return owner === null || owner === key ? plain : path.join(dir, `${fileKey(key)}_${hash6(key)}${ext}`);
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

function frontKey(text: string): string | null {
  const m = FRONTMATTER.exec(text);
  if (!m) return null;
  try {
    const key = (parse(m[1]) as { key?: unknown })?.key;
    return typeof key === "string" ? key : null;
  } catch {
    return null;
  }
}

function jsonKey(text: string): string | null {
  try {
    const key = (JSON.parse(text) as { key?: unknown })?.key;
    return typeof key === "string" ? key : null;
  } catch {
    return null;
  }
}

const notePath = (key: string) => ownedPath(sub("notes"), key, ".md", frontKey);

export function readNote(key: string): string | null {
  const file = notePath(key);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8").replace(FRONTMATTER, "");
}

export function writeNote(key: string, body: string): void {
  const file = notePath(key);
  const trimmed = body.replace(/\s+$/, "");
  if (!trimmed) {
    fs.rmSync(file, { force: true });
    return;
  }
  atomicWrite(file, `---\nkey: ${key}\n---\n${trimmed}\n`);
}

export function listNotes(): { key: string; body: string }[] {
  const dir = sub("notes");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .flatMap((f) => {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const key = frontKey(text);
      return key && isValidKey(key) ? [{ key, body: text.replace(FRONTMATTER, "") }] : [];
    });
}

// ---------------------------------------------------------------------------- journal

export const JOURNAL_TEMPLATE = "## 市场\n\n\n## 持仓与自选\n\n\n## 变动\n\n\n## 下周看什么\n\n";

const journalPath = (week: string) => {
  if (!isWeekId(week)) throw new Error(`无效的周「${week}」`);
  return path.join(sub("journal"), `${week}.md`);
};

export function readJournal(week: string): string | null {
  const file = journalPath(week);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

export function writeJournal(week: string, body: string): void {
  atomicWrite(journalPath(week), body.replace(/\s+$/, "") + "\n");
}

/** Newest first. */
export function listJournals(): { week: string; mtimeMs: number }[] {
  const dir = sub("journal");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .flatMap((f) => {
      const week = f.replace(/\.md$/, "");
      return f.endsWith(".md") && isWeekId(week) ? [{ week, mtimeMs: fs.statSync(path.join(dir, f)).mtimeMs }] : [];
    })
    .sort((a, b) => (a.week < b.week ? 1 : -1));
}

// ---------------------------------------------------------------------------- charts/<fileKey>.json

export interface CompareEntry {
  key: string;
  mode: "percent" | "pane";
  color: string;
}

export interface OverlaySpec {
  name: string;
  points: { timestamp: number; value: number }[];
  styles?: unknown;
  lock?: boolean;
  extendData?: unknown;
}

export interface ChartState {
  compare: CompareEntry[];
  overlays: OverlaySpec[];
}

export const EMPTY_CHART_STATE: ChartState = { compare: [], overlays: [] };

const chartPath = (key: string) => ownedPath(sub("charts"), key, ".json", jsonKey);

function parseChartState(text: string): ChartState {
  try {
    const raw = JSON.parse(text) as Partial<ChartState>;
    return {
      compare: Array.isArray(raw.compare) ? raw.compare.filter((c) => isValidKey(c?.key)) : [],
      overlays: Array.isArray(raw.overlays) ? raw.overlays.filter((o) => typeof o?.name === "string") : [],
    };
  } catch {
    return EMPTY_CHART_STATE;
  }
}

export function readChartState(key: string): ChartState {
  const file = chartPath(key);
  return fs.existsSync(file) ? parseChartState(fs.readFileSync(file, "utf8")) : EMPTY_CHART_STATE;
}

export function writeChartState(key: string, state: ChartState): void {
  atomicWrite(chartPath(key), JSON.stringify({ key, ...state }, null, 2) + "\n");
}

/** Compare targets across every chart, so they get synced too. */
export function compareKeys(): string[] {
  const dir = sub("charts");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => parseChartState(fs.readFileSync(path.join(dir, f), "utf8")).compare.map((c) => c.key));
}
