/**
 * A TradingView layout's drawings, fetched with the user's `sessionid` / `sessionid_sign` cookies
 * through the (reverse-engineered) library (design §5.5). The cookies only live for this call: they
 * are passed straight to tradingview.com, never stored, logged or put into an error message.
 */
import TradingView from "@mathieuc/tradingview";
import { dedupeDrawings, normalizeDrawing, type TvDrawing } from "./tv-drawings";

/**
 * Chart ids asked for. `_shared` holds the drawings synced across the layout's charts; each chart
 * of a multi-chart layout keeps its own under another id. The library has no way to list them,
 * and the ids seen in layouts are 1, 2, …, so the first eight are tried.
 */
export const CHART_IDS = ["_shared", "1", "2", "3", "4", "5", "6", "7", "8"];

export interface LayoutDrawings {
  drawings: TvDrawing[];
  /** Drawings found under each chart id that answered */
  perChart: { chartId: string; count: number }[];
}

const BAD_COOKIES = "TradingView 不认这组 sessionid / sessionid_sign（不对或已过期）";
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
/** The home page, which the library reads, answers 403 to some servers; the markets page carries the same user data. */
const USER_PAGES = ["https://www.tradingview.com/", "https://www.tradingview.com/markets/"];

/**
 * The user id the chart token is asked with. Not the library's `getUser`: when the page it reads
 * has no user (wrong cookies, or that 403) it calls itself again with no end. One request per page.
 */
async function userId(session: string, signature: string): Promise<string> {
  let status = 0;
  for (const page of USER_PAGES) {
    let res: Response;
    try {
      res = await fetch(page, { headers: { cookie: `sessionid=${session};sessionid_sign=${signature}`, "user-agent": BROWSER }, signal: AbortSignal.timeout(15_000) });
    } catch {
      continue;
    }
    status = res.status;
    if (!res.ok) continue;
    const html = await res.text();
    if (!html.includes("auth_token") && !html.includes('"is_authenticated":true')) throw new Error(BAD_COOKIES);
    const id = /"user":\{[^{}]*?"id":(\d+)/.exec(html)?.[1] ?? /"id":([0-9]{1,10}),/.exec(html)?.[1];
    if (id) return id;
  }
  throw new Error(`连不上 tradingview.com 取账号信息${status ? `（HTTP ${status}）` : ""}`);
}

export async function fetchLayoutDrawings(layout: string, session: string, signature: string): Promise<LayoutDrawings> {
  const id = await userId(session, signature);
  const credentials = { id, session, signature };
  const drawings: TvDrawing[] = [];
  const perChart: LayoutDrawings["perChart"] = [];
  for (const chartId of CHART_IDS) {
    try {
      const list = (await TradingView.getDrawings(layout, "", credentials, chartId)).map(normalizeDrawing).filter((d): d is TvDrawing => d !== null);
      drawings.push(...list);
      perChart.push({ chartId, count: list.length });
    } catch (err) {
      // the shared drawings are always there; failing on them means the layout or the access is wrong
      if (chartId === "_shared") throw new Error(`取不到布局 ${layout} 的画线：${/Wrong layout/.test(String((err as Error)?.message)) ? "布局不存在，或这个账号打不开它" : "连不上 TradingView"}`);
    }
  }
  return { drawings: dedupeDrawings(drawings), perChart };
}
