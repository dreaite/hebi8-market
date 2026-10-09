import type { MetadataRoute } from "next";
import { publicUrl } from "@/lib/app-info";

export const dynamic = "force-dynamic";

/** The overview and the charts are public; a person's own pages and the JSON routes are not for search engines. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/settings", "/usage", "/review", "/api/"] },
    sitemap: `${publicUrl()}/sitemap.xml`,
  };
}
