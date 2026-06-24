const CACHE_NAME = "webosu-cache-v1";

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only cache GET requests
  if (request.method !== "GET") return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Try cache first
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);

      // IMPORTANT: only cache valid responses OR opaque cross-origin ones
      const canCache =
        response &&
        (response.ok || response.type === "opaque");

      if (canCache) {
        try {
          await cache.put(request, response.clone());
        } catch (e) {
          // Some cross-origin responses may still fail silently in cache.put
          // so we ignore errors intentionally
          console.warn("Cache put failed:", request.url, e);
        }
      }

      return response;
    } catch (err) {
      // Optional: offline fallback could go here
      return cached || Response.error();
    }
  })());
});
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});
