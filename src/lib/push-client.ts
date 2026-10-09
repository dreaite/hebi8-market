/**
 * The browser half of Web Push (design §2.7): installing public/sw.js, whether this device can
 * subscribe at all and why not, and naming a subscription the way the server does.
 */

export const registerWorker = () => navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });

/** Why 在此设备上接收推送 is grey here; null when it can be turned on. `https`: open the public address instead. */
export function pushBlocker(): { reason: string; https?: boolean } | null {
  if (!window.isSecureContext) return { reason: "这个地址是 http（局域网或 Tailscale），浏览器只在 HTTPS 下允许推送", https: true };
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return { reason: "iPhone / iPad 上要先在 Safari 里点「分享 → 添加到主屏幕」，再从主屏幕的图标打开（iOS 16.4 及以上）" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { reason: ios ? "这台设备的 iOS 低于 16.4，不支持网页推送" : "这个浏览器不支持网页推送" };
  }
  if (Notification.permission === "denied") return { reason: "通知权限被拒绝了：在浏览器的网站设置里允许通知后再回来打开" };
  return null;
}

/** The same 16 hex digits `pushDeviceId` gives on the server. */
export async function deviceId(endpoint: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** This browser's subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Ask for permission (inside the click), then subscribe with the instance's VAPID key. */
export async function subscribe(key: string): Promise<PushSubscription> {
  if ((await Notification.requestPermission()) !== "granted") throw new Error("没有得到通知权限");
  await registerWorker();
  const reg = await navigator.serviceWorker.ready;
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
}
