"use client";

import { useEffect, useState } from "react";
import type { ChannelSummary } from "@/lib/notify";
import { currentSubscription, deviceId, pushBlocker, subscribe } from "@/lib/push-client";
import { Section, errorText, request } from "./Drawer";
import type { ToastOptions } from "./UiProvider";

/**
 * 推送 in the notification settings (§2.7): turn push on for this browser, and the devices that
 * have it, each removable. Where push cannot work here (plain http, iOS outside the home screen,
 * no support, permission denied) the box is grey with the reason beside it.
 */
export function PushSettings({
  push,
  onSummary,
  toast,
}: {
  push: ChannelSummary["push"];
  onSummary: (next: ChannelSummary) => void;
  toast: (message: string, opts?: ToastOptions) => void;
}) {
  // the drawer only renders in the browser, after /api/notify answered
  const [blocker, setBlocker] = useState(pushBlocker);
  /** This browser's subscription as the server names it */
  const [here, setHere] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (blocker) return;
    let alive = true;
    void currentSubscription().then(async (sub) => {
      const id = sub ? await deviceId(sub.endpoint) : null;
      if (alive) setHere(id);
    });
    return () => {
      alive = false;
    };
  }, [blocker]);

  const on = here !== null && push.devices.some((d) => d.id === here);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
      setBlocker(pushBlocker());
    } finally {
      setBusy(false);
    }
  };

  const turnOn = () =>
    act(async () => {
      const sub = await subscribe(push.key);
      onSummary(await request<ChannelSummary>("/api/notify/push", "PUT", sub.toJSON()));
      setHere(await deviceId(sub.endpoint));
      toast("此设备已开启推送");
    });

  const remove = (id: string) =>
    act(async () => {
      if (id === here) {
        await (await currentSubscription())?.unsubscribe();
        setHere(null);
      }
      onSummary(await request<ChannelSummary>(`/api/notify/push?id=${id}`, "DELETE"));
    });

  return (
    <Section title="推送">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className={`flex items-center gap-2 ${blocker ? "text-muted" : ""}`}>
          <input type="checkbox" checked={on} disabled={busy || Boolean(blocker)} onChange={() => void (on ? remove(here!) : turnOn())} />
          在此设备上接收推送
        </label>
        {blocker && (
          <span className="text-muted">
            {blocker.reason}
            {blocker.https && push.publicUrl.startsWith("https:") && (
              <>
                {"，"}
                <a href={push.publicUrl} className="text-accent hover:underline">
                  用 HTTPS 地址打开
                </a>
              </>
            )}
          </span>
        )}
      </div>
      {push.devices.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {push.devices.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {d.label}
                {d.id === here && <span className="text-muted">（此设备）</span>}
                <span className="ml-2 text-muted">{new Date(d.added).toLocaleDateString("zh-CN")} 开启</span>
              </span>
              <button type="button" className="btn" disabled={busy} onClick={() => void remove(d.id)}>
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted">还没有设备开启推送。</p>
      )}
      {error && <p className="mt-1 text-down">{error}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">每台手机或浏览器各开一次。推送服务说某台设备的订阅已失效（卸载了应用、清了网站数据）时，下次推送会自动把它移除。</p>
    </Section>
  );
}
