"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * A JSON value in localStorage for purely-UI preferences (panels, drawing modes). The fallback is
 * used during server rendering and hydration, so the stored value appears on the next render.
 */
export function useLocalStorage<T>(key: string, fallback: T): [T, (value: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  let value = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  const set = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage full or disabled: the preference just does not stick
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
