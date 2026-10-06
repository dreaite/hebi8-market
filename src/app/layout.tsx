import type { Metadata } from "next";
import Link from "next/link";
import { ensureVault, readConfigSafe } from "@/lib/vault";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "hebi8 market",
  description: "七天一个轮回，第八天观测市场。周度复盘：总览、长期图表、对比、笔记。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let updown = "green-up";
  try {
    ensureVault();
    updown = readConfigSafe().config?.updown ?? "green-up";
  } catch {
    // a broken vault is reported by the page itself
  }
  return (
    <html lang="zh-CN" data-updown={updown === "red-up" ? "red-up" : undefined}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <header className="border-b border-line">
          <div className="mx-auto flex h-12 max-w-[1400px] items-center justify-between px-5">
            <Link href="/" className="flex items-baseline gap-3" title="hebi（蛇）首尾相衔，七天一个轮回；多出来的第八天，用来观测市场">
              <span className="font-mono text-sm tracking-tight">hebi8 market</span>
              <span className="hidden text-[11px] text-muted sm:inline">第八天，观测市场</span>
            </Link>
            <nav className="flex items-center gap-4 text-xs text-muted">
              <Link href="/" className="hover:text-fg">
                总览
              </Link>
              <Link href="/review" className="hover:text-fg">
                复盘
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
