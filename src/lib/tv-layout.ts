/**
 * The account's layouts and a layout's drawings, fetched with the user's `sessionid` /
 * `sessionid_sign` cookies the way TradingView's own pages load them (design §5.5). The cookies
 * only live for this call: they are passed straight to tradingview.com, never stored, logged or
 * put into an error message.
 */
import TradingView from "@mathieuc/tradingview";
import { layoutId, normalizeDrawing, type TvDrawing } from "./tv-drawings";

const STORAGE = "https://charts-storage.tradingview.com/charts-storage";
const MARKETS = "https://www.tradingview.com/markets/";
const MY_CHARTS = "https://www.tradingview.com/my-charts/";
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const BAD_COOKIES = "TradingView 不认这组 sessionid / sessionid_sign（不对或已过期）";
/** Symbols fetched at once */
const CONCURRENCY = 4;

/** Where drawings were stored and how many came: a chart of the layout (`_shared` = synced across its charts), or synced across all layouts. */
export interface DrawingOrigin {
  source: "layout" | "user";
  /** `_shared`, a chart id, or `UserSync` */
  chartId: string;
  count: number;
  /** What TradingView's size listing says is there */
  expected: number;
}

export interface LayoutDrawings {
  drawings: TvDrawing[];
  origins: DrawingOrigin[];
}

const cookieOf = (session: string, signature: string) => `sessionid=${session};sessionid_sign=${signature}`;

/**
 * The user id the chart token is asked with, from the markets page. Not the home page: logged in,
 * it redirects to the account's language site (cn.tradingview.com…), and the cookie does not
 * follow a redirect to another host. Not the library's `getUser` either, which reads the home page
 * and calls itself with no end when the page has no user.
 */
async function userId(cookie: string): Promise<string> {
  const res = await fetch(MARKETS, { headers: { cookie, "user-agent": BROWSER }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (res.status !== 200) throw new Error(`连不上 tradingview.com 取账号信息（HTTP ${res.status}）`);
  const html = await res.text();
  if (!html.includes("var is_authenticated = true")) throw new Error(BAD_COOKIES);
  const id = /var user = \{"id":(\d+)/.exec(html)?.[1];
  if (!id) throw new Error("tradingview.com 的页面里没找到账号 id");
  return id;
}

/** A layout of the account, as the 「打开布局」 dialog lists it. */
export interface TvLayout {
  /** The short id in `/chart/<id>/`, what `fetchLayoutDrawings` takes */
  id: string;
  /** Empty when the listing does not say */
  name: string;
  symbol: string;
  interval: string;
  /** Unix seconds; null when the listing does not say */
  modified: number | null;
}

const text = (...values: unknown[]) => String(values.find((v) => typeof v === "string" || typeof v === "number") ?? "");

/** Unix seconds from seconds, milliseconds or an ISO string. */
function seconds(value: unknown): number | null {
  if (typeof value === "number") return value > 1e11 ? Math.round(value / 1000) : value;
  const t = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(t) ? null : t / 1000;
}

/**
 * The layouts of the account, last modified first, from the `/my-charts/` listing the 「打开布局」
 * dialog reads. Only the short id is relied on (`image_url`, else the chart link in `url`); name,
 * symbol, interval and time are shown when the listing has them. Not following redirects for the
 * same reason as `userId`.
 */
export async function fetchLayouts(session: string, signature: string): Promise<TvLayout[]> {
  const res = await fetch(MY_CHARTS, { headers: { cookie: cookieOf(session, signature), "user-agent": BROWSER, accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) throw new Error(BAD_COOKIES);
  if (res.status !== 200) throw new Error(`连不上 tradingview.com 取布局列表（HTTP ${res.status}）`);
  let list: unknown;
  try {
    list = JSON.parse(await res.text());
  } catch {
    // a page instead of the listing: not logged in
    throw new Error(BAD_COOKIES);
  }
  if (!Array.isArray(list)) throw new Error(`tradingview.com 回的布局列表不是数组（${list === null ? "null" : typeof list === "object" ? `字段：${Object.keys(list).slice(0, 8).join(", ")}` : typeof list}）`);
  const items = list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  const layouts = items.flatMap((item): TvLayout[] => {
    const id = layoutId(text(item.image_url)) ?? layoutId(text(item.url));
    if (!id) return [];
    return [{ id, name: text(item.name), symbol: text(item.short_symbol, item.symbol), interval: text(item.interval, item.resolution), modified: seconds(item.modified ?? item.created) }];
  });
  if (items.length && !layouts.length) throw new Error(`tradingview.com 的布局列表里认不出布局 ID（字段：${Object.keys(items[0]).slice(0, 12).join(", ")}）`);
  return layouts.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
}

/** One charts-storage request; every one needs the cookies as well as the token. */
async function storage<T>(path: string, params: Record<string, string>, cookie: string): Promise<T> {
  const res = await fetch(`${STORAGE}/${path}?${new URLSearchParams(params)}`, { headers: { cookie, "user-agent": BROWSER }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`TradingView 画线存储回 HTTP ${res.status}`);
  return ((await res.json()) as { payload: T }).payload;
}

interface Sizes {
  charts?: Record<string, { countSourcesChart?: number; symbols?: Record<string, { countSources?: number }> }>;
}

/** `map` over `items`, a few at a time. */
async function pooled<T, R>(items: T[], map: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await map(items[i]);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

/**
 * Every drawing of a layout: the size listings say which charts and symbols have some (the layout's
 * charts, and the drawings synced across all layouts), then each symbol's are fetched, since the
 * sources call returns nothing without a symbol.
 */
export async function fetchLayoutDrawings(layout: string, session: string, signature: string): Promise<LayoutDrawings> {
  const cookie = cookieOf(session, signature);
  const id = await userId(cookie);
  let jwt: string;
  try {
    jwt = await TradingView.getChartToken(layout, { id, session, signature });
  } catch {
    throw new Error(`取不到布局 ${layout}：布局不存在，或这个账号打不开它`);
  }
  const base = { layout_id: layout, jwt };
  const [layoutSizes, userSizes] = await Promise.all([storage<Sizes>(`layout/${layout}/sizes`, base, cookie), storage<Sizes>("user/sizes", base, cookie)]);

  const jobs: { source: DrawingOrigin["source"]; chartId: string; symbol: string }[] = [];
  const origins: DrawingOrigin[] = [];
  for (const [source, sizes] of [
    ["layout", layoutSizes],
    ["user", userSizes],
  ] as const) {
    for (const [chartId, chart] of Object.entries(sizes?.charts ?? {})) {
      origins.push({ source, chartId, count: 0, expected: chart.countSourcesChart ?? 0 });
      for (const symbol of Object.keys(chart.symbols ?? {})) jobs.push({ source, chartId, symbol });
    }
  }
  const lists = await pooled(jobs, async ({ source, chartId, symbol }) => {
    const payload =
      source === "layout"
        ? await storage<{ sources?: Record<string, unknown> }>(`get/layout/${layout}/sources`, { chart_id: chartId, ...base, symbol }, cookie)
        : await storage<{ sources?: Record<string, unknown> }>("get/user/sources", { ...base, symbol }, cookie);
    return Object.values(payload?.sources ?? {})
      .map(normalizeDrawing)
      .filter((d): d is TvDrawing => d !== null);
  });

  const drawings: TvDrawing[] = [];
  const seen = new Set<string>();
  jobs.forEach((job, i) => {
    const origin = origins.find((o) => o.source === job.source && o.chartId === job.chartId)!;
    origin.count += lists[i].length;
    // a drawing in two places (a chart and the shared set) is imported once
    for (const d of lists[i]) if (!seen.has(d.id) && seen.add(d.id)) drawings.push(d);
  });
  return { drawings, origins };
}
