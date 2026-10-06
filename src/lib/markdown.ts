import { marked } from "marked";

/** Notes and journals are the owner's own text, so the HTML goes straight into the page. */
export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false, gfm: true, breaks: true });
}

/** First non-empty, non-heading line, for compact listings. */
export function firstLine(source: string): string {
  return source
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith("---")) ?? "";
}
