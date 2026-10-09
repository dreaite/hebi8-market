import { publicUrl } from "@/lib/app-info";
import { BRAND, DARK, DESCRIPTION, SLOGAN, TAGLINE, bareUrl } from "@/lib/brand";
import { Logo, OG_SIZE, ogImage, ogText } from "@/lib/og";

// the address comes from the environment of the running server, not of the build
export const dynamic = "force-dynamic";
export const alt = `${BRAND}：${SLOGAN}`;
export const size = OG_SIZE;
export const contentType = "image/png";

/** The site's card (every page without its own): the logo large, the name, the slogan and what it is for. */
export default function Image() {
  return ogImage(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: DARK.card, color: DARK.fg, fontFamily: "sans", padding: "88px 88px 64px" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Logo size={132} />
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 40 }}>
          <span style={{ fontFamily: "mono", fontSize: 84, lineHeight: 1.1 }}>{ogText(BRAND)}</span>
          <span style={{ fontSize: 40, color: DARK.muted, marginTop: 8 }}>{ogText(SLOGAN)}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 30, lineHeight: 1.5 }}>{ogText(TAGLINE)}</span>
        <span style={{ fontSize: 26, color: DARK.muted, marginTop: 12 }}>{ogText(DESCRIPTION.split("。")[1] ?? "")}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", borderTop: `1px solid ${DARK.line}`, paddingTop: 22 }}>
        <span style={{ fontFamily: "mono", fontSize: 24, color: DARK.muted }}>{ogText(bareUrl(publicUrl()))}</span>
      </div>
    </div>,
  );
}
