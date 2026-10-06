/** Inline 18px stroke icons for the chart toolbars, drawn after TradingView's glyphs. */
import type { ReactNode, SVGProps } from "react";

function Svg({ children, size = 18, ...rest }: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number; className?: string };

export const IconCursor = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 2.5v13M2.5 9h13" />
  </Svg>
);

export const IconTrendLine = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.6 13.4 13.4 4.6" />
    <circle cx="3.5" cy="14.5" r="1.5" />
    <circle cx="14.5" cy="3.5" r="1.5" />
  </Svg>
);

export const IconRay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.1 12.9 16 2" />
    <circle cx="4" cy="14" r="1.5" />
  </Svg>
);

export const IconExtendedLine = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 16.5 16.5 1.5" />
    <circle cx="6.5" cy="11.5" r="1.4" />
    <circle cx="11.5" cy="6.5" r="1.4" />
  </Svg>
);

export const IconHorizontalLine = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 9h5.5M11 9h5.5" />
    <circle cx="9" cy="9" r="1.6" />
  </Svg>
);

export const IconHorizontalRay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.6 9h9.9" />
    <circle cx="5" cy="9" r="1.6" />
  </Svg>
);

export const IconVerticalLine = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 1.5V7M9 11v5.5" />
    <circle cx="9" cy="9" r="1.6" />
  </Svg>
);

export const IconFib = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 3.5h14M2 7.2h14M2 10.8h14M2 14.5h14" />
    <circle cx="4" cy="14.5" r="1.3" fill="currentColor" />
    <circle cx="14" cy="3.5" r="1.3" fill="currentColor" />
  </Svg>
);

export const IconText = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 4V2.8h11V4M9 2.8v12.4M6.8 15.2h4.4" />
  </Svg>
);

export const IconMagnet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 3v6a5 5 0 0 0 10 0V3h-3v6a2 2 0 0 1-4 0V3z" />
    <path d="M4 5.5h3M11 5.5h3" />
  </Svg>
);

export const IconLock = ({ open, ...p }: IconProps & { open?: boolean }) => (
  <Svg {...p}>
    <rect x="3.5" y="8" width="11" height="8" rx="1.5" />
    <path d={open ? "M6 8V5.5a3 3 0 0 1 5.8-1" : "M6 8V5.5a3 3 0 0 1 6 0V8"} />
  </Svg>
);

export const IconEye = ({ off, ...p }: IconProps & { off?: boolean }) => (
  <Svg {...p}>
    <path d="M1.5 9S4.2 4 9 4s7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5z" />
    <circle cx="9" cy="9" r="2.2" />
    {off && <path d="M2.5 15.5 15.5 2.5" />}
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4.5h13M7 4.5V2.8h4v1.7M4.2 4.5l.8 11h8l.8-11M7.3 7.5v5.5M10.7 7.5v5.5" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.8" cy="7.8" r="5" />
    <path d="m11.5 11.5 4.5 4.5" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="7" />
    <path d="M9 5.5v7M5.5 9h7" />
  </Svg>
);

export const IconCandles = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 2v3M5.5 13v3M12.5 1.5v3.5M12.5 11v3.5" />
    <rect x="3.5" y="5" width="4" height="8" rx=".5" fill="currentColor" />
    <rect x="10.5" y="5" width="4" height="6" rx=".5" />
  </Svg>
);

export const IconHollowCandles = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 2v3M5.5 13v3M12.5 1.5v3.5M12.5 11v3.5" />
    <rect x="3.5" y="5" width="4" height="8" rx=".5" />
    <rect x="10.5" y="5" width="4" height="6" rx=".5" fill="currentColor" />
  </Svg>
);

export const IconBars = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 2.5v12M3 6h2.5M5.5 11.5H8M12.5 3.5v12M10 13h2.5M12.5 6H15" />
  </Svg>
);

export const IconArea = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 14 6 8l3.5 3L16.5 3.5" />
    <path d="M1.5 14 6 8l3.5 3 7-7.5V16h-15z" fill="currentColor" fillOpacity=".18" stroke="none" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 9a6 6 0 1 1-1.8-4.3" />
    <path d="M15 2.5v3.2h-3.2" />
  </Svg>
);

export const IconFullscreen = ({ exit, ...p }: IconProps & { exit?: boolean }) => (
  <Svg {...p}>
    {exit ? (
      <path d="M6.5 2v4.5H2M11.5 2v4.5H16M6.5 16v-4.5H2M11.5 16v-4.5H16" />
    ) : (
      <path d="M2 6.5V2h4.5M16 6.5V2h-4.5M2 11.5V16h4.5M16 11.5V16h-4.5" />
    )}
  </Svg>
);

export const IconWatchlist = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4h10M6 9h10M6 14h10" />
    <circle cx="2.8" cy="4" r=".8" fill="currentColor" />
    <circle cx="2.8" cy="9" r=".8" fill="currentColor" />
    <circle cx="2.8" cy="14" r=".8" fill="currentColor" />
  </Svg>
);

export const IconNotes = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 2.5h8l3 3v10h-11z" />
    <path d="M11.5 2.5v3h3M6 9h6M6 12h4" />
  </Svg>
);

export const IconGear = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="2.3" />
    <path d="M9 1.8v2M9 14.2v2M1.8 9h2M14.2 9h2M3.9 3.9l1.4 1.4M12.7 12.7l1.4 1.4M3.9 14.1l1.4-1.4M12.7 5.3l1.4-1.4" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 4.5 9 9M13.5 4.5l-9 9" />
  </Svg>
);

export const IconBack = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 3.5 5.5 9l5.5 5.5" />
  </Svg>
);

export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.3 2.7a1.6 1.6 0 0 1 2.3 0l.7.7a1.6 1.6 0 0 1 0 2.3L6 15H3v-3z" />
    <path d="m10.8 4.2 3 3" />
  </Svg>
);

export const IconCaret = (p: IconProps) => (
  <Svg size={10} {...p}>
    <path d="m5 7 4 4 4-4" strokeWidth={1.6} />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3.5 9.5 3.5 3.5 7.5-8" />
  </Svg>
);

export const IconHelp = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="7" />
    <path d="M7 7.2a2 2 0 1 1 2.9 1.8c-.6.3-.9.8-.9 1.4v.4" />
    <circle cx="9" cy="12.9" r=".5" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.5 3.5h4v4M14.5 3.5 8 10M12.5 10.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
  </Svg>
);
