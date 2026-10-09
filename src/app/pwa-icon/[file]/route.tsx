import { ImageResponse } from "next/og";
import { DARK } from "@/lib/brand";
import { Logo } from "@/lib/og";

/**
 * The manifest's PNG icons, drawn at build time: Android wants 192 and 512 before it offers to
 * install. `<size>.png` is icon.svg as it is (its own rounded corners); `maskable-<size>.png` is a
 * full dark square with the logo inside the central 80% circle the launcher may cut out.
 */
const FILES: Record<string, { size: number; maskable: boolean }> = {
  "192.png": { size: 192, maskable: false },
  "512.png": { size: 512, maskable: false },
  "maskable-192.png": { size: 192, maskable: true },
  "maskable-512.png": { size: 512, maskable: true },
};

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(FILES).map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { size, maskable } = FILES[(await params).file];
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: maskable ? DARK.card : "transparent" }}>
      <Logo size={maskable ? Math.round(size * 0.8) : size} />
    </div>,
    { width: size, height: size },
  );
}
