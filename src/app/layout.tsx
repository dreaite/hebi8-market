import type { Metadata } from "next";
import Link from "next/link";
import { UpDownToggle } from "@/components/UpDownToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "hebi8 market",
  description: "长线看盘：自选总览、周/月线、自定义指标",
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
            <Link href="/" className="font-mono text-sm tracking-tight">
              hebi8 market
            </Link>
            <UpDownToggle />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
