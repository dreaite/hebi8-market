"use client";

import { installErrorCapture } from "@/lib/client-errors";

// at module evaluation, i.e. as soon as the client bundle runs, before hydration finishes
installErrorCapture();

/** Rendered first in <body> so the error ring buffer for feedback is installed early. */
export function ErrorCapture() {
  return null;
}
