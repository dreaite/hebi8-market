import { publicUrl } from "@/lib/app-info";
import { loadDaily } from "@/lib/bars";
import { DARK } from "@/lib/brand";
import { fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import { nameOf } from "@/lib/names";
import { BrandRow, OG_SIZE, ogImage, ogText } from "@/lib/og";
import type { Bar } from "@/lib/series";
import { pricePrecision } from "@/lib/stats";
import { listSymbols } from "@/lib/store";
import { SOURCE_LABELS, decodeChartKey, isSynthetic, isValidKey, tickerOf } from "@/lib/symbols";
import { readConfigSafe, vaultDir } from "@/lib/vault";
import { displayName } from "@/lib/wellknown";

export const dynamic = "force-dynamic";
export const alt = "hebi8/market 图表：近半年日线";
export const size = OG_SIZE;
export const contentType = "image/png";

/** About half a year of trading days */
const DAYS = 130;
const PLOT = { width: 1072, height: 290 };

/**
 * The card a link to a chart unfurls into: name, latest close, half a year of daily closes and the
 * brand row. A crawler has no session, so this reads only what every visitor sees, the root vault's
 * names and colors and the shared bar cache, never a user's vault, drawings or notes.
 */
export default async function Image({ params }: { params: Promise<{ key: string }> }) {
  const key = decodeChartKey((await params).key);
  const { config } = readConfigSafe(vaultDir());
  const symbols = listSymbols();
  const name = config ? nameOf(config, key, symbols[key]?.name) : displayName(key, null, symbols[key]?.name);
  let bars: Bar[] = [];
  if (config && isValidKey(key)) {
    try {
      bars = loadDaily(key, "split", config).slice(-DAYS);
    } catch {
      // a synthetic key with an alias the root vault does not know: no chart
    }
  }
  const redUp = config?.updown === "red-up";
  const tone = (v: number) => (v > 0 ? (redUp ? DARK.red : DARK.green) : v < 0 ? (redUp ? DARK.green : DARK.red) : DARK.muted);

  const last = bars.at(-1);
  const prev = bars.at(-2);
  const px = (v: number) => fmtPrice(v, pricePrecision(last?.c ?? v));
  const ticker = isValidKey(key) ? tickerOf(key) : key;
  const source = isSynthetic(key) ? "合成" : (symbols[key] && SOURCE_LABELS[symbols[key].source]);
  const span = bars.length > 1 ? bars[bars.length - 1].c / bars[0].c - 1 : null;
  const meta = [source, symbols[key]?.currency, bars.length > 1 && `近半年日线 ${fmtPct(span, 1)}`].filter(Boolean).join(" · ");

  return ogImage(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: DARK.card, color: DARK.fg, fontFamily: "sans", padding: "52px 64px 44px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 700 }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontSize: 60, lineHeight: 1.15 }}>{ogText(name) || ticker}</span>
            {ticker !== name && <span style={{ fontFamily: "mono", fontSize: 30, color: DARK.muted, marginLeft: 20 }}>{ogText(ticker)}</span>}
          </div>
          {meta && <span style={{ fontSize: 24, color: DARK.muted, marginTop: 8 }}>{ogText(meta)}</span>}
        </div>
        {last && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontFamily: "mono", fontSize: 56 }}>{px(last.c)}</span>
            <span style={{ fontFamily: "mono", fontSize: 24, color: prev ? tone(last.c - prev.c) : DARK.muted, marginTop: 4 }}>
              {prev ? `${last.c >= prev.c ? "+" : "−"}${px(Math.abs(last.c - prev.c))} (${fmtPct(last.c / prev.c - 1, 2)}) · ` : ""}
              {fmtDate(last.t)}
            </span>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", marginTop: 20 }}>
        {bars.length > 1 ? <Closes bars={bars} color={tone(span ?? 0)} /> : <span style={{ fontSize: 28, color: DARK.muted }}>暂无缓存的日线</span>}
      </div>
      <div style={{ display: "flex", borderTop: `1px solid ${DARK.line}`, paddingTop: 22 }}>
        <BrandRow url={`${publicUrl()}/chart/${encodeURIComponent(key)}`} slogan={false} />
      </div>
    </div>,
  );
}

/** Daily closes as a line over a fading fill, with the lowest and highest close marked. */
function Closes({ bars, color }: { bars: Bar[]; color: string }) {
  const { width, height } = PLOT;
  const closes = bars.map((b) => b.c);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const pad = 12;
  const x = (i: number) => (i / (closes.length - 1)) * width;
  const y = (c: number) => pad + (hi === lo ? 0.5 : (hi - c) / (hi - lo)) * (height - 2 * pad);
  const line = closes.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(c).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1={y(lo)} x2={width} y2={y(lo)} stroke={DARK.line} strokeDasharray="4 6" />
      <line x1="0" y1={y(hi)} x2={width} y2={y(hi)} stroke={DARK.line} strokeDasharray="4 6" />
      <path d={`${line}L${width},${height}L0,${height}Z`} fill="url(#fill)" />
      <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}
