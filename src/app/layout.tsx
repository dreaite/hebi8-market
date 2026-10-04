import type { Metadata } from "next";
import Link from "next/link";
import { UpDownToggle } from "@/components/UpDownToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "hebi8 market",
  description: "七天一个轮回，第八天观测市场。长线看盘：自选总览、周/月线、自定义指标。",
};

// Apply the saved up/down color convention before first paint.
const prefsScript = `try{if(localStorage.getItem("hebi8:updown")==="red-up")document.documentElement.dataset.updown="red-up"}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: prefsScript }} />
      </head>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <header className="border-b border-line">
          <div className="mx-auto flex h-12 max-w-[1400px] items-center justify-between px-5">
            <Link href="/" className="flex items-baseline gap-3" title="hebi（蛇）首尾相衔，七天一个轮回；多出来的第八天，用来观测市场">
              <span className="font-mono text-sm tracking-tight">hebi8 market</span>
              <span className="hidden text-[11px] text-muted sm:inline">第八天，观测市场</span>
            </Link>
            <UpDownToggle />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
