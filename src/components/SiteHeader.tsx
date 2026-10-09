"use client";

import { usePathname } from "next/navigation";

/**
 * The header row. Other pages center their content at 1400px and the header follows them; the chart fills the
 * window, so there the header spans it too and its 12px inset lines up with the chart toolbar's first icon.
 */
export function SiteHeader({ children }: { children: React.ReactNode }) {
  const full = usePathname().startsWith("/chart/");
  return (
    <header className="site-header border-b border-line">
      <div className={`mx-auto flex h-12 items-center gap-3 px-3 sm:gap-4 ${full ? "" : "max-w-[1400px] sm:px-5"}`}>{children}</div>
    </header>
  );
}
