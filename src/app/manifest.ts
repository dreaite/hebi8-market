import type { MetadataRoute } from "next";
import { BRAND, DARK, DESCRIPTION } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: BRAND,
    short_name: BRAND,
    description: DESCRIPTION,
    lang: "zh-CN",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: DARK.card,
    theme_color: DARK.card,
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/pwa-icon/192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512.png", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/pwa-icon/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
