import { ImageResponse } from "next/og";
import { DARK } from "@/lib/brand";
import { Logo } from "@/lib/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** icon.svg on a full square: iOS rounds the corners itself, so the svg's own corners must not show. */
export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: DARK.card }}>
      <Logo size={180} />
    </div>,
    size,
  );
}
