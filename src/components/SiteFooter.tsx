"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { REPO_URL } from "@/lib/app-info";

/** A quiet last line on every page: privacy and the docs. The chart fills the window, so it has none (its help drawer has both links). */
export function SiteFooter() {
  if (usePathname().startsWith("/chart/")) return null;
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-3 py-3 text-[11px] text-muted sm:px-5">
        <span className="font-mono">hebi8/market</span>
        <Link href="/privacy" className="hover:text-fg">
          隐私说明
        </Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-fg">
          项目文档
        </a>
      </div>
    </footer>
  );
}
