import type { Config } from "@/lib/config";
import type { Prices } from "@/lib/series";
import { isTimeframe, isValidKey, type Timeframe } from "@/lib/symbols";

/** `?key=&tf=&prices=&with=` as /api/bars and /api/status read it; null when it does not parse. */
export function chartQuery(params: URLSearchParams, config: Config): { key: string; tf: Timeframe; prices: Prices; withKeys: string[] } | null {
  const key = params.get("key") ?? "";
  const tf = params.get("tf") ?? config.chart.tf;
  const prices = params.get("prices") ?? config.prices;
  if (!isValidKey(key) || !isTimeframe(tf) || (prices !== "split" && prices !== "total")) return null;
  const withKeys = (params.get("with") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k && k !== key && isValidKey(k));
  return { key, tf, prices, withKeys };
}
