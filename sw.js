const CACHE_NAME = "webosu-cache-v1";

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

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== "GET") return;

  // Determine if the request is for an HTML document
  const isHtmlRequest = 
    request.mode === "navigate" || 
    (request.headers.get("accept")?.includes("text/html"));

  if (isHtmlRequest) {
    // --- NETWORK-FIRST STRATEGY (For HTML) ---
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        // 1. Try to fetch the latest HTML from the network
        const response = await fetch(request);

        // 2. If successful, update the cache so it's ready for next offline load
        if (response && (response.ok || response.type === "opaque")) {
          try {
            await cache.put(request, response.clone());
          } catch (e) {
            console.warn("Cache put failed for HTML:", request.url, e);
          }
        }

        return response;
      } catch (err) {
        // 3. If network fails (offline), try serving from cache
        const cached = await cache.match(request);
        if (cached) return cached;

        // 4. If not in cache either, return an error
        return Response.error();
      }
    })());
  } else {
    // --- CACHE-FIRST STRATEGY (For Assets: JS, CSS, Images, Audio) ---
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      // 1. Try cache first
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        // 2. If not in cache, fetch from network
        const response = await fetch(request);

        // 3. Cache valid or opaque responses for next time
        const canCache = response && (response.ok || response.type === "opaque");

        if (canCache) {
          try {
            await cache.put(request, response.clone());
          } catch (e) {
            console.warn("Cache put failed:", request.url, e);
          }
        }

        return response;
      } catch (err) {
        // 4. Network failed and not in cache
        return Response.error();
      }
    })());
  }
});
