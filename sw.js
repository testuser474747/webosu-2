const JS_CACHE_PREFIX = "webosu-js-";
const JS_CACHE = `${JS_CACHE_PREFIX}v1`;

const STATIC_CACHE = "webosu-static-v1";
const BEATMAP_CACHE = "webosu-beatmaps-v1";

/*
 * Older versions mixed JavaScript, images, audio, and beatmaps
 * together under names such as webosu-cache-v1.
 */
const LEGACY_MIXED_CACHE_PREFIX = "webosu-cache-";

function isAppJavaScript(request) {
  const url = new URL(request.url);

  return (
    url.origin === self.location.origin &&
    url.pathname.endsWith(".js")
  );
}

function isHtmlRequest(request) {
  const url = new URL(request.url);

  return (
    request.mode === "navigate" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith("/")
  );
}

function isBeatmapRequest(request) {
  const url = new URL(request.url);

  return (
    url.hostname === "txy1.sayobot.cn" &&
    url.pathname.startsWith("/beatmaps/download/mini/")
  );
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();

      /*
       * Delete only obsolete JavaScript-only caches.
       * Never delete BEATMAP_CACHE during a normal deployment.
       */
      await Promise.all(
        cacheNames
          .filter(
            (name) =>
              name.startsWith(JS_CACHE_PREFIX) &&
              name !== JS_CACHE
          )
          .map((name) => caches.delete(name))
      );

      /*
       * One-time cleanup for old mixed caches:
       *
       * 1. Copy cached beatmaps into the permanent beatmap cache.
       * 2. Delete only JavaScript entries from the old mixed cache.
       * 3. Preserve every non-JavaScript entry.
       */
      const beatmapCache = await caches.open(BEATMAP_CACHE);

      const legacyCacheNames = cacheNames.filter((name) =>
        name.startsWith(LEGACY_MIXED_CACHE_PREFIX)
      );

      for (const cacheName of legacyCacheNames) {
        const legacyCache = await caches.open(cacheName);
        const requests = await legacyCache.keys();

        for (const request of requests) {
          if (isBeatmapRequest(request)) {
            const alreadyMigrated =
              await beatmapCache.match(request);

            if (!alreadyMigrated) {
              const response =
                await legacyCache.match(request);

              if (response) {
                await beatmapCache.put(
                  request,
                  response.clone()
                );
              }
            }

            continue;
          }

          if (isAppJavaScript(request)) {
            await legacyCache.delete(request);
          }
        }
      }

      await self.clients.claim();
    })()
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request, {
      cache: "no-store",
    });

    if (
      response &&
      (response.ok || response.type === "opaque")
    ) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    const cached = await cache.match(request);

    return cached || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);

    if (
      response &&
      (response.ok || response.type === "opaque")
    ) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  /*
   * Downloaded beatmaps use a permanent, separately named cache.
   */
  if (isBeatmapRequest(request)) {
    event.respondWith(
      cacheFirst(request, BEATMAP_CACHE)
    );
    return;
  }

  /*
   * JavaScript always checks the network first and uses a
   * release-specific cache.
   */
  if (isAppJavaScript(request)) {
    event.respondWith(
      networkFirst(request, JS_CACHE)
    );
    return;
  }

  /*
   * HTML checks the network first so deployments are discovered.
   */
  if (isHtmlRequest(request)) {
    event.respondWith(
      networkFirst(request, STATIC_CACHE)
    );
    return;
  }

  /*
   * Cache same-origin images, CSS, fonts, and other static files.
   */
  if (url.origin === self.location.origin) {
    event.respondWith(
      cacheFirst(request, STATIC_CACHE)
    );
  }

  /*
   * Other cross-origin requests—API calls, previews and covers—are
   * not automatically cached here.
   */
});
