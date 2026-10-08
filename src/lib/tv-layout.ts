/**
 * A TradingView layout's drawings, fetched with the user's `sessionid` / `sessionid_sign` cookies
 * the way TradingView's own chart page loads them (design §5.5). The cookies only live for this
 * call: they are passed straight to tradingview.com, never stored, logged or put into an error message.
 */
import TradingView from "@mathieuc/tradingview";
import { normalizeDrawing, type TvDrawing } from "./tv-drawings";

const STORAGE = "https://charts-storage.tradingview.com/charts-storage";
const MARKETS = "https://www.tradingview.com/markets/";
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
