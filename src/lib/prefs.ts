"use client";

import { useCallback, useEffect, useState } from "react";

export const UPDOWN_EVENT = "hebi8:updown";

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`hebi8:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`hebi8:${key}`, JSON.stringify(value));
  } catch {
    // storage full or disabled; the preference just won't persist
  }
}

/** useState backed by localStorage; starts from `fallback` so SSR and first paint agree. */
export function usePref<T>(key: string, fallback: T): [T, (value: T) => void, boolean] {
  const [value, setValue] = useState(fallback);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from localStorage after mount
    setValue(readPref(key, fallback));
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per key
  }, [key]);
  const update = useCallback(
    (next: T) => {
      setValue(next);
      writePref(key, next);
    },
    [key],
  );
  return [value, update, loaded];
}
