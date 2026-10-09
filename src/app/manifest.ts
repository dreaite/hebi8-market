import type { MetadataRoute } from "next";
import { BRAND, DARK, DESCRIPTION } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND,
    short_name: BRAND,
    description: DESCRIPTION,
    lang: "zh-CN",
    start_url: "/",
    display: "standalone",
    background_color: DARK.card,
    theme_color: DARK.card,
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
