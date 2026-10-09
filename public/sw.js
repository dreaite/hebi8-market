/*
 * hebi8/market's service worker (design §2.7). It caches nothing: pages are rendered on every
 * request and a cached one would show old prices. It shows pushed alerts, opens the chart a
 * notification links to, and answers a page load that cannot reach the server with a short page.
 */

const OFFLINE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#151517">
<title>连不上服务器 · hebi8/market</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0d0d0e; color: #e8e6e1; font: 14px/1.6 system-ui, sans-serif; }
  main { padding: 24px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 16px; font-weight: 500; }
  p { margin: 0 0 16px; color: #8b877f; }
  button { padding: 6px 16px; border: 1px solid #26262a; border-radius: 6px; background: #151517; color: inherit; font: inherit; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>连不上服务器</h1>
  <p>网络断了，或者 hebi8/market 暂时没有响应。</p>
  <button type="button" onclick="location.reload()">重试</button>
</main>
</body>
</html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } })));
});

// `{ title, body, url }` from src/lib/push.ts
self.addEventListener("push", (event) => {
  const { title, body, url } = event.data.json();
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/pwa-icon/192.png", data: { url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data.url, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window" });
      const same = windows.find((w) => w.url === url);
      if (same) return same.focus();
      if (windows[0]) return (await windows[0].focus()).navigate(url);
      return self.clients.openWindow(url);
    })(),
  );
});
