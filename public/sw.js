const CACHE = "robomission-junior-v54";
const RULES_PDF_CACHE = "robomission-rules-pdf-v1";
const PRECACHE = [
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/memo/junior-course.webp",
  "./assets/judging/visitors/full-upright.webp",
  "./assets/judging/visitors/partial.webp",
  "./assets/judging/visitors/fallen.webp",
  "./assets/judging/visitors/outside.webp",
  "./assets/judging/visitors/wrong-color.webp",
  "./assets/judging/red-towers/full.webp",
  "./assets/judging/red-towers/partial.webp",
  "./assets/judging/red-towers/outside.webp",
  "./assets/judging/red-towers/fallen.webp",
  "./assets/judging/yellow-towers/full.webp",
  "./assets/judging/yellow-towers/partial.webp",
  "./assets/judging/yellow-towers/outside.webp",
  "./assets/judging/yellow-towers/incorrect.webp",
  "./assets/judging/artifacts/full.webp",
  "./assets/judging/artifacts/partial.webp",
  "./assets/judging/artifacts/fallen.webp",
  "./assets/judging/artifacts/outside.webp",
  "./assets/judging/artifacts/wrong-color.webp",
  "./assets/judging/dirt/area.webp",
  "./assets/judging/dirt/clear.webp",
  "./assets/judging/dirt/touching.webp",
  "./assets/judging/dirt/visitor-area.webp",
  "./assets/judging/dirt/line.webp",
  "./assets/judging/bonus/red-ok.webp",
  "./assets/judging/bonus/red-moved.webp",
  "./assets/judging/bonus/red-damaged.webp",
  "./assets/judging/bonus/white-ok.webp",
  "./assets/judging/bonus/white-moved.webp",
  "./assets/judging/bonus/parrot-ok.webp",
  "./assets/judging/bonus/parrot-moved.webp",
];

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
    await Promise.all(keys.filter((key) => key.startsWith("robomission-junior-v") && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.headers.has("range")) {
    event.respondWith(rangeFromCachedPdf(event.request));
    return;
  }

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

async function rangeFromCachedPdf(request) {
  const range = request.headers.get("range") || "";
  const match = range.match(/bytes=(\d+)-(\d*)/);
  if (!match) return fetch(request);
  const cached = await (await caches.open(RULES_PDF_CACHE)).match(request) || await caches.match(request);
  if (!cached) return fetch(request);
  const blob = await cached.blob();
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : blob.size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= blob.size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${blob.size}` } });
  }
  const sliced = blob.slice(start, Math.min(end + 1, blob.size), cached.headers.get("content-type") || "application/pdf");
  return new Response(sliced, {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": cached.headers.get("content-type") || "application/pdf",
      "Content-Length": String(sliced.size),
      "Content-Range": `bytes ${start}-${Math.min(end, blob.size - 1)}/${blob.size}`,
      "Accept-Ranges": "bytes",
    },
  });
}
