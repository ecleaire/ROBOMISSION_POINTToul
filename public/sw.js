const CACHE = "robomission-junior-v9";
const PHOTOS = [
  "visitors/full-upright", "visitors/partial", "visitors/fallen", "visitors/outside", "visitors/wrong-color",
  "red-towers/full", "red-towers/partial", "red-towers/outside", "red-towers/fallen",
  "yellow-towers/full", "yellow-towers/partial", "yellow-towers/outside", "yellow-towers/incorrect",
  "artifacts/full", "artifacts/partial", "artifacts/fallen", "artifacts/outside", "artifacts/wrong-color",
  "dirt/area", "dirt/clear", "dirt/touching", "dirt/visitor-area", "dirt/line",
  "bonus/red-ok", "bonus/red-moved", "bonus/red-damaged", "bonus/white-ok", "bonus/white-moved", "bonus/parrot-ok", "bonus/parrot-moved"
].map((path) => `./assets/judging/${path}.webp`);
const PRECACHE = ["./", "./index.html", "./manifest.webmanifest", "./assets/icons/icon-192.png", "./assets/icons/icon-512.png", "./assets/robomission-public-url-qr.png", "./assets/rules/WRO-2026-Junior-Google-Translate-JA.pdf", ...PHOTOS];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    const response = await fetch("./index.html", { cache: "no-store" });
    const html = await response.text();
    const bundles = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
    if (bundles.length) await cache.addAll(bundles);
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
