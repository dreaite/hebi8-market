/**
 * The last few uncaught errors in this tab (window errors and unhandled rejections), attached to
 * in-app feedback. Installed as early as the client bundle allows by `ErrorCapture`.
 */
import type { ClientError } from "./feedback";

const MAX = 10;
const buffer: ClientError[] = [];
let installed = false;

function push(entry: ClientError): void {
  const last = buffer[buffer.length - 1];
  // the same error firing in a loop (render, animation frame) is one entry
  if (last && last.message === entry.message && last.source === entry.source && Date.parse(entry.t) - Date.parse(last.t) < 2000) return;
  buffer.push({ ...entry, message: entry.message.slice(0, 500) });
  if (buffer.length > MAX) buffer.shift();
}

function describe(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    return String(reason);
  }
}

export function installErrorCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    push({
      t: new Date().toISOString(),
      kind: "error",
      message: e.error ? describe(e.error) : e.message || "Script error",
      source: e.filename ? `${e.filename.replace(window.location.origin, "")}:${e.lineno}:${e.colno}` : undefined,
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    push({ t: new Date().toISOString(), kind: "rejection", message: describe(e.reason) });
  });
}

export function recentErrors(): ClientError[] {
  return buffer.map((e) => ({ ...e }));
}
