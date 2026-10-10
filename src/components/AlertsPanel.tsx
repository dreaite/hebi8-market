"use client";

import { useRouter } from "next/navigation";
import { deleteAlert, saveAlert, setAlertEnabled } from "@/app/actions";
import type { AlertView } from "@/lib/alert-view";
import { fmtAgo, fmtPrice } from "@/lib/format";
import { IconClose, IconPlus } from "./chart-icons";
import { LoginButton, chartHref, useUi } from "./UiProvider";

const STATUS: Record<AlertView["status"], { text: string; className: string }> = {
  active: { text: "活动", className: "border-accent/50 text-accent" },
  triggered: { text: "已触发", className: "border-line text-muted" },
  stopped: { text: "已停止", className: "border-dashed border-line text-muted" },
};

/**
 * TradingView's 警报 panel: every alert of this vault, whatever the symbol. A row opens its chart;
 * 编辑 / 暂停·恢复 / 删除 sit on the row. Prices come from the quotes table, read by the page.
 */
export function AlertsPanel({
  alerts,
  current,
  readOnly,
  onCreate,
  onEdit,
  onClose,
  className = "",
}: {
  alerts: AlertView[];
  current: string;
  readOnly: boolean;
  onCreate: () => void;
  onEdit: (alert: AlertView) => void;
  onClose: () => void;
  className?: string;
}) {
  const router = useRouter();
  const { toast } = useUi();
  const report = (result: { ok: boolean; error?: string }) => {
    if (!result.ok) toast(result.error ?? "操作失败", { kind: "error" });
  };

  const remove = async (a: AlertView) => {
    const result = await deleteAlert(a.id);
    if (!result.ok) return report(result);
    toast(`已删除警报「${a.label}」`, {
      action: {
        label: "撤销",
        onClick: () =>
          void saveAlert({
            key: a.key,
            cond: a.cond ?? "formula",
            ...(a.cond ? { value: a.value! } : { when: a.when!, tf: a.tf }),
            trigger: a.trigger,
            check: a.check,
            label: a.ownLabel ?? "",
            enabled: a.enabled,
            notify: a.notify,
          }).then(report),
      },
    });
  };

  return (
    <aside className={`flex flex-col bg-card text-xs ${className}`} aria-label="警报">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line pr-1 pl-3">
        <span className="flex-1 font-medium">警报</span>
        {!readOnly && (
          <button type="button" onClick={onCreate} className="tb-btn h-7 min-w-7" title="新建警报 · Alt+A" aria-label="新建警报">
            <IconPlus size={16} />
          </button>
        )}
        <button type="button" onClick={onClose} className="tb-btn h-7 min-w-7" title="收起" aria-label="收起警报">
          <IconClose size={16} />
        </button>
      </div>
      {readOnly ? (
        <div className="flex flex-col items-start gap-2 p-3 text-muted">
          <p>登录后设置自己的警报</p>
          <LoginButton />
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-start gap-2 p-3 text-muted">
          <p>还没有警报。点顶栏的「警报」或按 Alt+A，在图上右键也能在那个价位添加。</p>
          <button type="button" className="btn btn-secondary" onClick={onCreate}>
            新建警报
          </button>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {alerts.map((a) => {
            const status = STATUS[a.status];
            // an alert on the whole watchlist has no chart of its own
            const opens = a.key !== null && a.key !== current ? a.key : null;
            return (
              <li key={a.id} className={`group px-3 py-2 ${a.key === current ? "bg-fg/5" : ""}`}>
                <button type="button" className="block w-full text-left" onClick={() => opens && router.push(chartHref(opens))} title={opens ? `打开 ${a.name}` : undefined}>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={a.name}>
                      {a.name}
                    </span>
                    <span className={`shrink-0 rounded border px-1 text-[11px] ${status.className}`}>{status.text}</span>
                  </span>
                  <span className="mt-0.5 block truncate" title={a.label}>
                    {a.label}
                  </span>
                  {/* TradingView: the condition stays visible under any name */}
                  <span className="mt-0.5 block truncate text-[11px] text-muted" title={a.summary}>
                    {a.summary} · {a.key === null ? "每个标的每根 K 线最多一次" : a.trigger === "once" ? "仅一次" : "每根 K 线一次"}
                    {!a.notify && " · 不推送"}
                  </span>
                  {a.key !== null && (
                    <span className="mt-0.5 block text-[11px] text-muted">
                      当前 {a.price != null ? `${fmtPrice(a.price)}${a.priceAt ? ` · ${fmtAgo(a.priceAt, "")}` : ""}` : "暂无价格"}
                    </span>
                  )}
                </button>
                <span className="mt-1 flex gap-1">
                  <button type="button" className="btn h-6 px-1.5" onClick={() => onEdit(a)}>
                    编辑
                  </button>
                  <button type="button" className="btn h-6 px-1.5" onClick={() => void setAlertEnabled(a.id, !a.enabled).then(report)}>
                    {a.enabled ? "暂停" : "恢复"}
                  </button>
                  <button type="button" className="btn h-6 px-1.5 text-down" onClick={() => void remove(a)}>
                    删除
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
