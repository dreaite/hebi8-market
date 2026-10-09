"use client";

/**
 * 拍快照 (design §5.2): the chart laid out like TradingView's snapshot and signed hebi8/market.
 * A bar on top names the symbol and gives the last bar's OHLC and change (it stands in for the
 * legend's symbol row); the chart keeps its drawings and the legend rows of indicators and
 * compares; a strip at the bottom carries the logo, the name and the public address. Colors are
 * read from the page, so the picture follows the color scheme and the up/down convention. Only
 * the picture is signed, never the chart on the page.
 */
import { BRAND, SLOGAN, bareUrl } from "@/lib/brand";
import { fmtPct, fmtPrice } from "@/lib/format";
import type { Timeframe } from "@/lib/symbols";
import type { CompareEntry } from "@/lib/vault";
import { MONO, SANS, type ChartCapture, type LegendIndicator } from "./chart-types";

const HEADER = 56;
const FOOTER = 34;
const PAD = 12;
const ROW = 20;
const CANDLE_PANE = "candle_pane";

export interface SnapshotInfo {
  title: string;
  ticker: string;
  /** Interval · source · currency · benchmark, as in the legend */
  subtitle: string[];
  tf: Timeframe;
  last: { timestamp: number; open: number; high: number; low: number; close: number } | null;
  prevClose: number | null;
  pricePrecision: number;
  /** The chart's public address, printed at the bottom */
  url: string;
  compare: (CompareEntry & { hidden?: boolean })[];
  names: Record<string, string>;
  labels: Record<string, string>;
  hiddenIndicators: string[];
}

type Colors = Record<"card" | "fg" | "muted" | "line" | "up" | "down", string>;

export async function renderSnapshot(capture: ChartCapture, info: SnapshotInfo): Promise<Blob> {
  const [chart, logo] = await Promise.all([loadImage(capture.url), loadImage("/icon.svg")]);
  const scale = chart.naturalWidth / capture.width;
  const width = capture.width;
  const height = HEADER + capture.height + FOOTER;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  const style = getComputedStyle(document.documentElement);
  const c = Object.fromEntries(["card", "fg", "muted", "line", "up", "down"].map((k) => [k, style.getPropertyValue(`--${k}`).trim()])) as Colors;

  ctx.fillStyle = c.card;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(chart, 0, HEADER, capture.width, capture.height);
  drawLegend(ctx, capture, info, c);
  drawHeader(ctx, info, c, width);
  drawFooter(ctx, logo, info.url, c, width, height);
  ctx.fillStyle = c.line;
  ctx.fillRect(0, HEADER - 1, width, 1);
  ctx.fillRect(0, HEADER + capture.height, width, 1);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("生成图片失败"))), "image/png"));
}

/** TradingView names a snapshot after the symbol and the moment: `NVDA_2026-10-09_10-30-00.png`. */
export function snapshotFileName(ticker: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ticker.replace(/[^A-Za-z0-9.-]+/g, "_")}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.png`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("生成图片失败"));
    img.src = src;
  });
}

/** Text on a baseline; returns where it ends. */
function put(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string): number {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  return x + ctx.measureText(text).width;
}

function measure(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** The last bar's day, or the week / month / quarter it covers. */
function barDate(timestamp: number, tf: Timeframe): string {
  const iso = new Date(timestamp).toISOString();
  if (tf === "W") return `${iso.slice(0, 10)} 当周`;
  if (tf === "M") return iso.slice(0, 7);
  if (tf === "Q") return `${iso.slice(0, 4)} Q${Math.ceil(Number(iso.slice(5, 7)) / 3)}`;
  return iso.slice(0, 10);
}

function drawHeader(ctx: CanvasRenderingContext2D, info: SnapshotInfo, c: Colors, width: number) {
  const { last } = info;
  const date = last ? barDate(last.timestamp, info.tf) : "";
  const dateFont = `12px ${MONO}`;
  const dateWidth = measure(ctx, date, dateFont);
  put(ctx, date, width - PAD - dateWidth, 23, dateFont, c.muted);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width - PAD - dateWidth - 16, HEADER);
  ctx.clip();
  let x = put(ctx, info.title, PAD, 23, `600 15px ${SANS}`, c.fg);
  if (info.ticker !== info.title) x = put(ctx, info.ticker, x + 8, 23, `12px ${MONO}`, c.muted);
  put(ctx, info.subtitle.join(" · "), x + 10, 23, `12px ${SANS}`, c.muted);
  ctx.restore();

  if (!last) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width - PAD, HEADER);
  ctx.clip();
  const tone = (v: number) => (v > 0 ? c.up : v < 0 ? c.down : c.muted);
  const px = (v: number) => fmtPrice(v, info.pricePrecision);
  x = PAD;
  for (const [label, value] of [["开", last.open], ["高", last.high], ["低", last.low], ["收", last.close]] as const) {
    x = put(ctx, label, x, 44, `12px ${SANS}`, c.muted);
    x = put(ctx, px(value), x + 3, 44, `12px ${MONO}`, tone(last.close - last.open)) + 10;
  }
  if (info.prevClose) {
    const change = last.close - info.prevClose;
    const sign = change > 0 ? "+" : change < 0 ? "−" : "";
    const pct = fmtPct(last.close / info.prevClose - 1, 2);
    const full = `${sign}${px(Math.abs(change))} (${pct})`;
    // a narrow picture keeps the percentage
    put(ctx, x + measure(ctx, full, `12px ${MONO}`) <= width - PAD ? full : pct, x, 44, `12px ${MONO}`, tone(change));
  }
  ctx.restore();
}

/** The legend's indicator and compare rows where the page shows them; the symbol row is the header now. */
function drawLegend(ctx: CanvasRenderingContext2D, capture: ChartCapture, info: SnapshotInfo, c: Colors) {
  const snap = capture.legend;
  const left = snap.left + 10;
  const row = (y: number, title: string, color: string, params: string, values: [string, string][]) => {
    let x = put(ctx, title, left, y + 14, `12px ${SANS}`, color);
    if (params) x = put(ctx, params, x + 4, y + 14, `12px ${SANS}`, c.muted);
    for (const [text, tone] of values) x = put(ctx, text, x + 6, y + 14, `12px ${MONO}`, tone);
  };
  const indicatorRow = (ind: LegendIndicator, y: number) => {
    const hidden = info.hiddenIndicators.includes(ind.name);
    row(y, info.labels[ind.name] ?? ind.name, hidden ? c.muted : c.fg, ind.params.join(" "), hidden ? [] : ind.values.map((v) => [v.text, v.color]));
  };
  const compareRow = (slot: number, y: number) => {
    const entry = info.compare[slot];
    const live = snap.compares[slot];
    const values: [string, string][] = [];
    if (!entry.hidden && live?.value != null) values.push([fmtPrice(live.value), entry.color]);
    if (!entry.hidden && live?.pct != null) values.push([fmtPct(live.pct, 2), live.pct > 0 ? c.up : live.pct < 0 ? c.down : c.muted]);
    row(y, info.names[entry.key] ?? entry.key, entry.hidden ? c.muted : entry.color, "", values);
  };

  // the main pane's rows, unless folded away under the legend's arrow
  if (localStorage.getItem("hebi8:chart:legend-collapsed") !== "true") {
    let y = HEADER + 4;
    info.compare.forEach((entry, slot) => {
      if (entry.mode !== "percent") return;
      compareRow(slot, y);
      y += ROW;
    });
    for (const ind of snap.indicators.filter((i) => i.paneId === CANDLE_PANE)) {
      indicatorRow(ind, y);
      y += ROW;
    }
  }
  for (const [paneId, top] of Object.entries(snap.paneTops)) {
    if (paneId === CANDLE_PANE) continue;
    let y = HEADER + top + 2;
    const slot = /^pane_cmp_(\d+)$/.exec(paneId)?.[1];
    if (slot !== undefined && info.compare[Number(slot)]) {
      compareRow(Number(slot), y);
      y += ROW;
    }
    for (const ind of snap.indicators.filter((i) => i.paneId === paneId)) {
      indicatorRow(ind, y);
      y += ROW;
    }
  }
}

/** Logo, name and slogan on the left, the address on the right; a narrow picture drops the slogan, then the path. */
function drawFooter(ctx: CanvasRenderingContext2D, logo: HTMLImageElement, url: string, c: Colors, width: number, height: number) {
  const mid = height - FOOTER / 2;
  ctx.drawImage(logo, PAD, mid - 9, 18, 18);
  const x = put(ctx, BRAND, PAD + 26, mid + 4.5, `13px ${MONO}`, c.fg);
  const urlFont = `11px ${MONO}`;
  const sloganFont = `11px ${SANS}`;
  const address = bareUrl(url);
  const room = width - PAD - x - 16;
  const shown = [address, address.split("/")[0]].find((t) => measure(ctx, t, urlFont) <= room);
  const urlWidth = shown ? measure(ctx, shown, urlFont) : 0;
  if (measure(ctx, SLOGAN, sloganFont) + 10 + urlWidth <= room) put(ctx, SLOGAN, x + 10, mid + 4, sloganFont, c.muted);
  if (shown) put(ctx, shown, width - PAD - urlWidth, mid + 4, urlFont, c.muted);
}
