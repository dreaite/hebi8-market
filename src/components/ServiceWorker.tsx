"use client";

import { useEffect } from "react";
import { registerWorker } from "@/lib/push-client";

/** Installs public/sw.js on every page that can have one (§2.7), so the offline page works before anyone turns push on. */
export function ServiceWorker() {
  useEffect(() => {
    if (window.isSecureContext && "serviceWorker" in navigator) void registerWorker();
  }, []);
  return null;
}
