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

/** Inline markdown stripped: emphasis, code, links, images, list and quote markers, tags. */
export function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/^\s*>+\s?/, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?!\s)(.+?)[*_](?!\w)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first line of body text as plain text; the first heading when there is nothing else. */
export function plainFirstLine(source: string): string {
  const lines = source.split("\n").map((l) => l.trim());
  const body = lines.find((l) => l && !l.startsWith("#") && !/^-{3,}$/.test(l) && !/^(?:[-*_]\s*){3,}$/.test(l));
  const heading = lines.find((l) => /^#{1,6}\s/.test(l));
  return stripMarkdown(body ?? heading ?? "");
}
