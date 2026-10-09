/**
 * What the social images (`opengraph-image`, `apple-icon`) share: fonts, the logo and the brand
 * row, in the dark theme (a crawler has no color scheme). Fonts come from this machine, never
 * the network: next/og downloads Google Fonts for any glyph its fonts lack and twemoji for emoji,
 * so every string is cut down to what the loaded fonts cover (Latin only without a CJK font) and
 * emoji are dropped.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { BRAND, DARK, SLOGAN, bareUrl } from "./brand";
import { fitText, fontCoverage } from "./font-coverage";

export const OG_SIZE = { width: 1200, height: 630 };

/** Noto Sans CJK where Debian/Ubuntu, Fedora and Arch put it, or installed by hand; collections (.ttc) cannot be read. */
const CJK_FONTS = [
  process.env.HEBI8_OG_FONT,
  path.join(os.homedir(), ".local/share/fonts/NotoSansCJKsc-Regular.otf"),
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/google-noto-cjk/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/noto-cjk/NotoSansCJKsc-Regular.otf",
];
const MONO_FONTS = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono.ttf",
  "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
  "/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf",
];
/** Latin only; ships with next/og */
const LATIN_FONT = path.join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf");

type Font = { name: string; data: Buffer; weight: 400; style: "normal" };
// one array for the process: satori parses a font list once and keeps it by identity
let loaded: { fonts: Font[]; has: (cp: number) => boolean } | null = null;
function load() {
  if (loaded) return loaded;
  const find = (paths: (string | undefined)[]) => paths.find((p) => p && fs.existsSync(p));
  const cjk = find(CJK_FONTS);
  const mono = find(MONO_FONTS);
  // machine paths: nothing for the build to trace
  const fonts: Font[] = [{ name: "sans", data: fs.readFileSync(/*turbopackIgnore: true*/ cjk ?? LATIN_FONT), weight: 400, style: "normal" }];
  if (mono) fonts.push({ name: "mono", data: fs.readFileSync(/*turbopackIgnore: true*/ mono), weight: 400, style: "normal" });
  // satori draws a character with whichever loaded font has it
  const covers = fonts.map((f) => fontCoverage(f.data));
  return (loaded = { fonts, has: (cp) => covers.some((c) => c(cp)) });
}

/** Every string an image draws goes through here: what the loaded fonts cover, emoji removed. */
export const ogText = (text: string) => fitText(text, load().has);

export const ogImage = (element: ReactElement, size = OG_SIZE) => new ImageResponse(element, { ...size, fonts: load().fonts });

const LOGO = `data:image/svg+xml;base64,${fs.readFileSync(path.join(process.cwd(), "src/app/icon.svg")).toString("base64")}`;

export function Logo({ size }: { size: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- next/og draws plain <img>
  return <img src={LOGO} width={size} height={size} alt="" />;
}

/** The bottom row, as under an exported chart: logo, name and slogan, then the address (a long one leaves out the slogan). */
export function BrandRow({ url, slogan = true }: { url: string; slogan?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Logo size={44} />
        <span style={{ fontFamily: "mono", fontSize: 30, color: DARK.fg, marginLeft: 16 }}>{ogText(BRAND)}</span>
        {slogan && <span style={{ fontSize: 22, color: DARK.muted, marginLeft: 18 }}>{ogText(SLOGAN)}</span>}
      </div>
      <span style={{ fontFamily: "mono", fontSize: 22, color: DARK.muted }}>{ogText(bareUrl(url))}</span>
    </div>
  );
}
