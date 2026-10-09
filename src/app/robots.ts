import type { MetadataRoute } from "next";
import { publicUrl } from "@/lib/app-info";

export const dynamic = "force-dynamic";

/**
 * Everything but the JSON routes may be crawled: a person's own pages (settings, review, usage)
 * say noindex themselves, which a crawler only reads when it is allowed to fetch them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${publicUrl()}/sitemap.xml`,
  };
}
