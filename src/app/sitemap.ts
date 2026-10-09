import type { MetadataRoute } from "next";
import { publicUrl } from "@/lib/app-info";
import { allItems } from "@/lib/config";
import { listSymbols } from "@/lib/store";
import { readConfigSafe, vaultDir } from "@/lib/vault";

export const dynamic = "force-dynamic";

/** The overview and the chart of every symbol in the root vault's list: what a visitor sees. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicUrl();
  const { config } = readConfigSafe(vaultDir());
  const symbols = listSymbols();
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    ...(config ? allItems(config) : []).map((item) => ({
      url: `${base}/chart/${encodeURIComponent(item.key)}`,
      lastModified: symbols[item.key]?.syncedAt ? new Date(symbols[item.key].syncedAt!) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
