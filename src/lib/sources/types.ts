import type { Bar } from "../series";

export interface FetchResult {
  bars: Bar[];
  /** Display name reported by the source, used when the user did not set one */
  name?: string;
  /**
   * `replace`: the result is the full history and supersedes stored bars
   * (adjusted prices shift the whole history whenever a dividend or split lands).
   * `merge`: the result only covers recent bars and is upserted.
   */
  mode: "replace" | "merge";
}

export interface SourceAdapter {
  /** @param since time of the latest stored bar, for incremental sources */
  fetchDaily(ticker: string, since: number | null): Promise<FetchResult>;
}
