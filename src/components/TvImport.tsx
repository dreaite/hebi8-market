"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { importTvDrawings, importTvList, previewTvDrawings, type DrawingsPreview, type DrawingsImported } from "@/app/tv-actions";
import { parseTvSources } from "@/lib/tv-drawings";
import { parseTvList, planTvImport, type ExportResult, type ImportMode } from "@/lib/tv-import";
import { chartHref } from "./UiProvider";

const body = "flex flex-col gap-3 px-4 py-3 text-xs";
const th = "px-2 py-1 text-left text-[11px] font-normal text-muted";
const td = "border-t border-line px-2 py-1";

const STATUS = { new: "新增", exists: "已在自选", duplicate: "重复，跳过" } as const;

const fileStem = (name: string) => name.replace(/\.[^.]*$/, "").trim();

// ---------------------------------------------------------------------------- watchlist in

/** Upload or paste TradingView's exported list, check the plan, then write it. */
export function TvListImport({ watched, canWrite }: { watched: { name: string; keys: string[] }[]; canWrite: boolean }) {
  const [text, setText] = useState("");
  const [fallback, setFallback] = useState("TradingView");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const plan = useMemo(() => planTvImport(parseTvList(text, fallback.trim() || "TradingView"), watched, mode), [text, fallback, watched, mode]);
  const rows = plan.flatMap((g) => g.rows);
  const added = rows.filter((r) => r.status === "new").length;
  const kept = rows.filter((r) => r.status === "exists").length;

  const reset = () => {
    setConfirming(false);
    setStatus(null);
  };

  const submit = () => {
    if (mode === "replace" && !confirming) return setConfirming(true);
    startTransition(async () => {
      const result = await importTvList({ text, fallback, mode });
      setConfirming(false);
      if (!result.ok) return setStatus(`导入失败：${result.error}`);
      setStatus(`已导入：新增 ${result.added} 个标的。新标的正在后台拉取日线，总览上会陆续出现。`);
      setText("");
    });
  };

  return (
    <div className={body}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn btn-secondary cursor-pointer">
          选择 .txt 文件
          <input
            type="file"
            accept=".txt,text/plain"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setText(await file.text());
              setFallback(fileStem(file.name) || "TradingView");
              reset();
              e.target.value = "";
            }}
          />
        </label>
        <span className="text-muted">或者把内容贴到下面</span>
      </div>
      <textarea
        className="input h-24 py-1.5 font-mono"
        placeholder="###美股,NASDAQ:NVDA,AMEX:SPY,###加密,BINANCE:BTCUSDT"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          reset();
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-muted">第一节之前的标的放进</span>
          <input className="input w-36" value={fallback} onChange={(e) => setFallback(e.target.value)} />
        </label>
        <div className="seg" role="group" aria-label="导入方式">
          {(["merge", "replace"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                reset();
              }}
            >
              {m === "merge" ? "合并" : "替换"}
            </button>
          ))}
        </div>
        <span className="text-muted">{mode === "merge" ? "加到同名分组，没有就在最后新建；已在自选的不动" : "整个自选列表换成文件里的；已在自选的标的沿用原来的名字和基准"}</span>
      </div>

      {plan.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>TradingView 代码</th>
                <th className={th}>写入的 key</th>
                <th className={th}>状态</th>
              </tr>
            </thead>
            {plan.map((g) => (
              <tbody key={g.name}>
                <tr>
                  <td colSpan={3} className={`${td} bg-bg font-medium`}>
                    {g.name}
                    <span className="ml-2 font-normal text-muted">{mode === "merge" ? (g.existing ? "加到现有分组" : "新建分组") : ""}</span>
                  </td>
                </tr>
                {g.rows.map((r, i) => (
                  <tr key={`${r.symbol}-${i}`} className={r.status === "new" ? "" : "text-muted"}>
                    <td className={`${td} font-mono`}>{r.symbol}</td>
                    <td className={`${td} font-mono`}>{r.status === "duplicate" ? "—" : r.key}</td>
                    <td className={td}>
                      {r.status === "exists" ? (mode === "merge" ? `已在「${r.group}」` : `沿用（原在「${r.group}」）`) : r.status === "duplicate" ? `重复，已在「${r.group}」节` : STATUS[r.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={!canWrite || pending || !plan.length || (mode === "merge" && !added)} onClick={submit}>
          {confirming ? "确认替换整个自选列表" : mode === "merge" ? `导入 ${added} 个新标的` : `替换为 ${added + kept} 个标的`}
        </button>
        {confirming && (
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            取消
          </button>
        )}
        <span className="text-muted">{pending ? "导入中…" : confirming ? "现有分组会被整个换掉，文件里没有的标的会从自选里移除。" : status}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- watchlist out

export function TvExport({ text, count, skipped }: Pick<ExportResult, "text" | "count" | "skipped">) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "hebi8-watchlist.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className={body}>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-secondary" disabled={!count} onClick={download}>
          下载 .txt
        </button>
        <span className="text-muted">{count} 个标的{skipped.length ? `，跳过 ${skipped.length} 个` : ""}</span>
      </div>
      {skipped.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[11px] text-muted">
          {skipped.map((s) => (
            <li key={s.key}>
              <span className="font-mono">{s.key}</span>（{s.group}）：{s.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- drawings

type Source = "layout" | "json";
const SKIP = "";
const NEW_GROUP = "TradingView";

const reasons = (skipped: Record<string, number>) =>
  Object.entries(skipped)
    .map(([reason, n]) => `${reason} ×${n}`)
    .join("；");

/** Fetch a layout's drawings (or read pasted JSON), show what goes where, then append them. */
export function TvDrawingsImport({ groups, canWrite }: { groups: string[]; canWrite: boolean }) {
  const [source, setSource] = useState<Source>("layout");
  const [layout, setLayout] = useState("");
  const [sessionid, setSessionid] = useState("");
  const [sign, setSign] = useState("");
  const [json, setJson] = useState("");
  const [preview, setPreview] = useState<DrawingsPreview | null>(null);
  const [add, setAdd] = useState<Record<string, string>>({});
  const [done, setDone] = useState<DrawingsImported | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () =>
    startTransition(async () => {
      setError(null);
      setDone(null);
      let result;
      if (source === "layout") {
        result = await previewTvDrawings({ layout, sessionid, sign });
        // the cookies are not kept any longer than this one request
        setSessionid("");
        setSign("");
      } else {
        try {
          result = await previewTvDrawings({ drawings: parseTvSources(json) });
        } catch (err) {
          return setError(err instanceof Error ? err.message : String(err));
        }
      }
      if (!result.ok) {
        setPreview(null);
        return setError(result.error);
      }
      setPreview(result);
      setAdd({});
    });

  const commit = () =>
    startTransition(async () => {
      if (!preview) return;
      const result = await importTvDrawings({ drawings: preview.drawings, add: Object.fromEntries(Object.entries(add).filter(([, g]) => g !== SKIP)) });
      if (!result.ok) return setError(result.error);
      setDone(result);
      setPreview(null);
    });

  const count = preview?.symbols.reduce((n, s) => n + (s.key || (add[s.symbol] ?? SKIP) !== SKIP ? s.ready : 0), 0) ?? 0;

  return (
    <div className={body}>
      <div className="seg self-start" role="group" aria-label="画线从哪来">
        <button type="button" aria-pressed={source === "layout"} onClick={() => setSource("layout")}>
          从布局取
        </button>
        <button type="button" aria-pressed={source === "json"} onClick={() => setSource("json")}>
          粘贴 JSON
        </button>
      </div>

      {source === "layout" ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-muted">布局链接或 ID</span>
            <input className="input" placeholder="https://www.tradingview.com/chart/AbCd1234/" value={layout} onChange={(e) => setLayout(e.target.value)} />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-muted">sessionid</span>
              <input className="input font-mono" type="password" autoComplete="off" value={sessionid} onChange={(e) => setSessionid(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">sessionid_sign</span>
              <input className="input font-mono" type="password" autoComplete="off" value={sign} onChange={(e) => setSign(e.target.value)} />
            </label>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            两个 cookie 在已登录 tradingview.com 的浏览器里找：开发者工具 → Application（应用）→ Cookies → https://www.tradingview.com。它们只随这一次请求发到本服务器，再由服务器发给
            tradingview.com，不保存、不写日志，取完就从这里清掉。会取共享画线（_shared）和布局里 1–8 号图表各自的画线；多于 8 个图表的布局，其余的用「粘贴 JSON」。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea className="input h-28 py-1.5 font-mono" placeholder='{"success":true,"payload":{"sources":{…}}}' value={json} onChange={(e) => setJson(e.target.value)} />
          <p className="text-[11px] leading-relaxed text-muted">
            在 TradingView 打开那个布局，开发者工具的 Network（网络）面板里搜 <code>sources</code>，找到 charts-storage.tradingview.com 的请求（每个图表一个，开了同步画线的是 chart_id=_shared）。
            把 Response（响应）整段复制过来；只复制里面的 sources 对象或画线数组也行。多个图表就分几次导入，重复的不会多出来。
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-secondary" disabled={!canWrite || pending || (source === "layout" ? !layout.trim() || !sessionid.trim() || !sign.trim() : !json.trim())} onClick={load}>
          {source === "layout" ? "取画线并预览" : "预览"}
        </button>
        <span className="text-muted">{pending ? "处理中…" : error && <span className="text-down">{error}</span>}</span>
      </div>

      {preview && (
        <>
          {preview.perChart && <p className="text-[11px] text-muted">取到：{preview.perChart.map((c) => `${c.chartId} ${c.count} 条`).join("，")}</p>}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>TradingView 代码</th>
                  <th className={th}>自选里的标的</th>
                  <th className={`${th} text-right`}>可导入</th>
                  <th className={`${th} text-right`}>已导入过</th>
                  <th className={th}>跳过</th>
                </tr>
              </thead>
              <tbody>
                {preview.symbols.map((s) => (
                  <tr key={s.symbol}>
                    <td className={`${td} font-mono`}>{s.symbol}</td>
                    <td className={td}>
                      {s.key ? (
                        <Link href={chartHref(s.key)} className="font-mono hover:underline">
                          {s.key}
                        </Link>
                      ) : (
                        <label className="flex items-center gap-1.5">
                          <span className="text-muted">不在自选</span>
                          <select className="input" value={add[s.symbol] ?? SKIP} onChange={(e) => setAdd((a) => ({ ...a, [s.symbol]: e.target.value }))}>
                            <option value={SKIP}>跳过</option>
                            {[...groups, ...(groups.includes(NEW_GROUP) ? [] : [NEW_GROUP])].map((g) => (
                              <option key={g} value={g}>
                                加入「{g}」{groups.includes(g) ? "" : "（新分组）"}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </td>
                    <td className={`${td} tabular text-right`}>{s.ready}</td>
                    <td className={`${td} tabular text-right text-muted`}>{s.already || ""}</td>
                    <td className={`${td} text-[11px] text-muted`}>{reasons(s.skipped)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className="btn btn-primary" disabled={!canWrite || pending || !count} onClick={commit}>
              导入 {count} 条画线
            </button>
            <span className="text-[11px] text-muted">加入自选的标的先拉一次日线，再按它的 K 线对齐画线。</span>
          </div>
        </>
      )}

      {done && (
        <div className="flex flex-col gap-1">
          <p>
            已导入 {done.symbols.reduce((n, s) => n + s.imported, 0)} 条画线
            {done.symbols.some((s) => s.already) ? `，${done.symbols.reduce((n, s) => n + s.already, 0)} 条以前导入过` : ""}。
          </p>
          <ul className="flex flex-col gap-0.5 text-[11px] text-muted">
            {done.symbols.map((s) => (
              <li key={s.symbol}>
                <Link href={chartHref(s.key)} className="font-mono text-fg hover:underline">
                  {s.key}
                </Link>
                ：{s.imported} 条{s.already ? `，以前导入过 ${s.already} 条` : ""}
                {Object.keys(s.skipped).length ? `；跳过 ${reasons(s.skipped)}` : ""}
              </li>
            ))}
            {done.failed.map((f) => (
              <li key={f.symbol} className="text-down">
                {f.symbol} 没能加入自选：{f.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
