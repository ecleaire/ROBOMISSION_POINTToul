const CACHE = "robomission-junior-v19";
const PRECACHE = ["./manifest.webmanifest", "./assets/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch("./index.html", { cache: "no-store" });
    const html = await response.text();
    const bundles = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
    await cache.put("./index.html", new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
    await Promise.all([...PRECACHE, ...bundles].map(async (url) => {
      try { await cache.add(url); } catch { /* 必須でないファイルの失敗ではインストールを止めない */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const url = new URL(event.request.url);
    const cacheFirst = url.pathname.includes("/assets/");
    if (cacheFirst) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
    }
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    }
  })());
});
