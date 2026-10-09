import type { Metadata } from "next";
import Link from "next/link";
import { ErrorCapture } from "@/components/ErrorCapture";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Account, HelpButton, SearchTrigger, UiProvider } from "@/components/UiProvider";
import { githubClientId } from "@/lib/app-info";
import type { SearchContext } from "@/lib/search";
import { searchContextFor } from "@/lib/search-context";
import { readConfigSafe } from "@/lib/vault";
import { getViewer, type Viewer } from "@/lib/viewer";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "hebi8/market",
  description: "七天一个轮回，第八天观测市场。周度复盘：总览、长期图表、对比、笔记。",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let updown = "green-up";
  let searchCtx: SearchContext = { watchlist: [], aliases: {}, groups: [] };
  let viewer: Viewer | null = null;
  try {
    viewer = await getViewer();
    const config = readConfigSafe(viewer.dir).config;
    updown = config?.updown ?? "green-up";
    searchCtx = searchContextFor(config);
  } catch {
    // a broken vault is reported by the page itself
  }
  return (
    <html lang="zh-CN" data-updown={updown === "red-up" ? "red-up" : undefined}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <ErrorCapture />
        <UiProvider ctx={searchCtx} readOnly={!viewer?.canWrite}>
          <SiteHeader>
            <Link href="/" className="flex shrink-0 items-baseline gap-3" title="hebi（蛇）首尾相衔，七天一个轮回；多出来的第八天，用来观测市场">
              <span className="font-mono text-sm tracking-tight">hebi8/market</span>
              <span className="hidden text-[11px] text-muted lg:inline">第八天，观测市场</span>
            </Link>
            <div className="flex min-w-0 flex-1 justify-center">
              <SearchTrigger />
            </div>
            <nav className="flex shrink-0 items-center gap-3 text-xs text-muted sm:gap-4">
              <Link href="/" className="hover:text-fg">
                总览
              </Link>
              <Link href="/review" className="hover:text-fg">
                复盘
              </Link>
              <Link href="/settings" className="hover:text-fg">
                设置
              </Link>
              {viewer?.shared && (
                <Account user={viewer.login ? { login: viewer.login, avatarUrl: viewer.avatarUrl ?? "" } : null} enabled={Boolean(githubClientId())} owner={viewer.isOwner} />
              )}
              <HelpButton />
            </nav>
          </SiteHeader>
          {children}
          <SiteFooter />
        </UiProvider>
      </body>
    </html>
  );
}
