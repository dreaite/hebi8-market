/** Display names on top of the yaml, the dictionary and what the source reported. */
import { findItem, type Config } from "./config";
import { displayName } from "./wellknown";

export function nameOf(cfg: Config, key: string, sourceName?: string | null): string {
  return displayName(key, findItem(cfg, key)?.name, sourceName);
}

/** The alias a benchmark was written with (`QQQ`), else its short name; never the long source name. */
export function benchLabel(cfg: Config, key: string, sourceName?: string | null): string {
  const alias = Object.entries(cfg.aliases).find(([, k]) => k === key)?.[0];
  return alias ?? nameOf(cfg, key, sourceName);
}
