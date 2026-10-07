"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { IconClose } from "./chart-icons";

/** Small looping pictures of each step; pure CSS (globals.css `.guide-*`), still under reduced motion. */
function ScanPicture() {
  const rows = [
    { w: 52, chg: "up", badges: ["on"] },
    { w: 40, chg: "up", badges: ["on", "fresh"] },
    { w: 60, chg: "down", badges: ["off"] },
    { w: 46, chg: "up", badges: ["on", "on"] },
  ];
  return (
    <div className="guide-pic relative flex flex-col justify-center gap-1.5 px-5">
      {rows.map((r, i) => (
        <div key={i} className="flex h-6 items-center gap-3 rounded bg-card px-2">
          <span className="h-2 rounded bg-fg/70" style={{ width: r.w }} />
          <span className="flex-1" />
          <span className={`h-2 w-8 rounded ${r.chg === "up" ? "bg-up/70" : "bg-down/70"}`} />
          <span className="flex w-24 gap-1">
            {r.badges.map((b, j) =>
              b === "fresh" ? (
                <span key={j} className="guide-fresh flex h-3.5 w-10 items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-1">
                  <span className="guide-dot h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
              ) : (
                <span key={j} className={`h-3.5 w-8 rounded-full border border-line ${b === "off" ? "border-dashed opacity-50" : ""}`} />
              ),
            )}
          </span>
        </div>
      ))}
      <div className="guide-scan pointer-events-none absolute inset-x-3 h-7 rounded border border-accent/40 bg-accent/5" />
    </div>
  );
}

function ChartPicture() {
  // a rising run of weekly candles, a moving average that draws itself, then a horizontal line
  const candles = [70, 64, 66, 58, 60, 52, 55, 47, 50, 42, 45, 38, 40, 33, 36, 30];
  return (
    <div className="guide-pic px-5">
      <svg viewBox="0 0 300 140" className="h-full w-full" aria-hidden>
        {candles.map((y, i) => {
          const up = i % 3 !== 1;
          const x = 18 + i * 17;
          return (
            <g key={i} className={up ? "text-up" : "text-down"}>
              <line x1={x} x2={x} y1={y + 4} y2={y + 30} stroke="currentColor" strokeWidth="1" />
              <rect x={x - 4} y={y + 10} width="8" height="14" fill="currentColor" rx="1" />
            </g>
          );
        })}
        <polyline className="guide-ma" points="18,96 69,86 120,76 171,66 222,56 290,46" fill="none" stroke="var(--accent)" strokeWidth="2" pathLength={1} />
        <line className="guide-hline" x1="10" x2="292" y1="44" y2="44" stroke="var(--fg)" strokeWidth="1" strokeDasharray="4 3" />
      </svg>
    </div>
  );
}

function JournalPicture() {
  return (
    <div className="guide-pic grid grid-cols-2 gap-3 px-5 py-4">
      <div className="flex flex-col gap-2 rounded bg-card p-3">
        <span className="h-2 w-12 rounded bg-fg/70" />
        {[85, 70, 92, 55].map((w, i) => (
          <span key={i} className="guide-type h-1.5 rounded bg-fg/40" style={{ width: `${w}%`, animationDelay: `${i * 0.6}s` }} />
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded bg-card p-3 opacity-60">
        <span className="h-2 w-10 rounded bg-muted/70" />
        {[80, 64, 72].map((w, i) => (
          <span key={i} className="h-1.5 rounded bg-muted/40" style={{ width: `${w}%` }} />
        ))}
        <span className="mt-1 flex gap-1">
          <span className="h-3.5 w-8 rounded-full border border-accent/50 bg-accent/10" />
          <span className="h-3.5 w-8 rounded-full border border-dashed border-line" />
        </span>
      </div>
    </div>
  );
}

const STEPS: { title: string; text: string; picture: ReactNode }[] = [
  {
    title: "扫描：这周变了什么",
    text: "总览把自选按组排成一张表：各周期涨跌、离高点多远，以及你自己建的警报，用你起的名字显示。带蓝点的是本周新触发的，先看这些。",
    picture: <ScanPicture />,
  },
  {
    title: "深看：挑几只点进去",
    text: "点一行打开周线图，画线、加指标、和别的标的对比，操作和 TradingView 一样。右侧写这只的笔记，也可以在价格上设警报。",
    picture: <ChartPicture />,
  },
  {
    title: "记录：写下这周的判断",
    text: "在「复盘」写本周日志，旁边摆着上周写的和本周触发的警报。下周打开时，先看看上周是怎么想的。",
    picture: <JournalPicture />,
  },
];

/**
 * The how-to on first visit (and from 帮助): three steps with a looping picture each. A visitor's last
 * step ends in 登录, since everything after scanning needs a vault of one's own.
 */
export function Guide({ visitor, onClose, onLogin }: { visitor: boolean; onClose: () => void; onLogin: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // keys stay inside: the page's / and ? must not open things behind the guide
  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, STEPS.length - 1));
    else if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
  };

  const s = STEPS[step];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-3" onMouseDown={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="怎么用"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="guide-panel w-full max-w-[460px] overflow-hidden rounded-xl border border-line bg-card shadow-xl"
      >
        <div className="flex h-11 items-center justify-between pr-2 pl-5">
          <span className="font-mono text-[11px] text-muted">
            第 {step + 1} 步 / 共 {STEPS.length} 步
          </span>
          <button type="button" onClick={onClose} className="tb-btn" aria-label="关闭" title="关闭 (Esc)">
            <IconClose />
          </button>
        </div>
        {/* keyed by step, so the picture's animation starts over and the step slides in */}
        <div key={step} className="guide-step">
          <div className="mx-5 overflow-hidden rounded-lg bg-bg">{s.picture}</div>
          <div className="px-5 pt-4">
            <h2 className="text-base font-medium">{s.title}</h2>
            <p className="mt-1.5 min-h-[4.5em] text-xs leading-relaxed text-muted">{s.text}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-5 pt-2 pb-5">
          <div className="flex gap-1.5" role="tablist" aria-label="步骤">
            {STEPS.map((x, i) => (
              <button
                key={x.title}
                type="button"
                role="tab"
                aria-selected={i === step}
                aria-label={`第 ${i + 1} 步`}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-fg" : "w-1.5 bg-line hover:bg-muted"}`}
              />
            ))}
          </div>
          <span className="flex-1" />
          {/* a visitor's last step already holds two buttons; the dots still go back */}
          {step > 0 && !(last && visitor) && (
            <button type="button" onClick={() => setStep(step - 1)} className="btn">
              上一步
            </button>
          )}
          {!last ? (
            <button type="button" onClick={() => setStep(step + 1)} className="btn btn-primary">
              下一步
            </button>
          ) : visitor ? (
            <>
              <button type="button" onClick={onClose} className="btn">
                先看看示例
              </button>
              <button type="button" onClick={onLogin} className="btn btn-primary">
                用 GitHub 登录
              </button>
            </>
          ) : (
            <button type="button" onClick={onClose} className="btn btn-primary">
              开始
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
