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
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  
  // Aggressive HTML check: Is it a navigation, does it end in .html, or is it the root /
  const isHtmlRequest = 
    request.mode === "navigate" || 
    url.pathname.endsWith(".html") || 
    url.pathname.endsWith("/");

  if (isHtmlRequest) {
    // --- FORCE NETWORK-FIRST FOR HTML ---
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        // We add {cache: 'reload'} to bypass the browser's HTTP cache
        // and fetch directly from the server.
        const networkResponse = await fetch(request, { cache: 'reload' });

        if (networkResponse && networkResponse.ok) {
          // Overwrite the old version in the cache immediately
          await cache.put(request, networkResponse.clone());
          return networkResponse;
        }
        
        throw new Error('Network response was not ok');
      } catch (err) {
        // Fallback to cache only if network fails
        const cachedResponse = await cache.match(request);
        if (cachedResponse) return cachedResponse;
        
        return Response.error();
      }
    })());
  } else {
    // --- CACHE-FIRST FOR ASSETS (Original logic) ---
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        if (response && (response.ok || response.type === "opaque")) {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        return Response.error();
      }
    })());
  }
});
