"use strict";

/*
 * WebOsu offline service worker
 *
 * Keeps the following available offline:
 *   - the application shell and game engine
 *   - downloaded .osz beatmaps
 *   - Sayobot beatmap metadata
 *   - an index of downloaded beatmap set IDs
 *
 * Increment APP_VERSION whenever application files change.
 *
 * The beatmap, API, media, and state cache names deliberately remain stable
 * so downloaded beatmaps survive deployments.
 */

const APP_VERSION = "app-v3";

const SHELL_CACHE = `webosu-shell-${APP_VERSION}`;
const RUNTIME_CACHE = `webosu-runtime-${APP_VERSION}`;

const BEATMAP_CACHE = "webosu-beatmaps-v1";
const API_CACHE = "webosu-api-v1";
const MEDIA_CACHE = "webosu-media-v1";
const STATE_CACHE = "webosu-offline-state-v1";

const JS_CACHE_PREFIX = "webosu-js-";
const STATIC_CACHE_PREFIX = "webosu-static-";
const LEGACY_MIXED_CACHE_PREFIX = "webosu-cache-";

const SCOPE_URL = self.registration.scope;

const scopedUrl = (path) => new URL(path, SCOPE_URL).href;

const DOWNLOADED_SIDS_KEY = scopedUrl(
  "__offline__/downloaded-sids.json"
);

const CATALOG_KEY = scopedUrl(
  "__offline__/catalog.json"
);

const LAST_LIST_KEY = scopedUrl(
  "__offline__/last-list.json"
);

/*
 * Files required to load the page, initialize the game, unpack beatmaps,
 * display the skin, and play hitsounds without a network connection.
 *
 * Each file is cached independently during installation, so an optional
 * missing file does not prevent the service worker from installing.
 */
const CORE_FILES = [
  "./",
  "./index.html",
  "./latest.html",
  "./popular.html",
  "./genres.html",
  "./favourites.html",
  "./search.html",
  "./settings.html",
  "./faq.html",
  "./navbar.html",
  "./footer.html",

  "./style/picnic.min.css",
  "./style/main.css",
  "./style/font.css",
  "./style/400.ttf",
  "./style/600i.ttf",
  "./style/fontello.ttf",
  "./style/cursor.cur",
  "./style/cursorsmall.cur",
  "./style/cursortiny.cur",

  "./favicon.png",
  "./research.svg",
  "./star.png",

  "./scripts/config.js",
  "./scripts/launchgame.js",
  "./scripts/downloader.js",
  "./scripts/addbeatmaplist.js",
  "./scripts/settings.js",
  "./scripts/jsloader.js",

  "./scripts/lib/localforage.min.js",
  "./scripts/lib/zip.js",
  "./scripts/lib/zip-fs.js",
  "./scripts/lib/z-worker.js",
  "./scripts/lib/inflate.js",
  "./scripts/lib/deflate.js",
  "./scripts/lib/pixi.min.js",
  "./scripts/lib/mp3parse.min.js",
  "./scripts/lib/require.js",
  "./scripts/lib/underscore.js",
  "./scripts/lib/sound.js",

  "./scripts/initgame.js",
  "./scripts/osu.js",
  "./scripts/osu-audio.js",
  "./scripts/playback.js",
  "./scripts/playerActions.js",
  "./scripts/SliderMesh.js",

  "./scripts/curves/Curve.js",
  "./scripts/curves/CurveType.js",
  "./scripts/curves/Bezier2.js",
  "./scripts/curves/EqualDistanceMultiCurve.js",
  "./scripts/curves/LinearBezier.js",
  "./scripts/curves/CircumscribedCircle.js",

  "./scripts/overlay/score.js",
  "./scripts/overlay/volume.js",
  "./scripts/overlay/loading.js",
  "./scripts/overlay/break.js",
  "./scripts/overlay/progress.js",
  "./scripts/overlay/hiterrormeter.js",

  "./fonts/venera.fnt",
  "./fonts/venera_0.png",

  "./sprites.json",
  "./sprites.png",
];

const HIT_SOUND_NAMES = [
  "normal-hitnormal",
  "normal-hitwhistle",
  "normal-hitfinish",
  "normal-hitclap",
  "normal-slidertick",

  "soft-hitnormal",
  "soft-hitwhistle",
  "soft-hitfinish",
  "soft-hitclap",
  "soft-slidertick",

  "drum-hitnormal",
  "drum-hitwhistle",
  "drum-hitfinish",
  "drum-hitclap",
  "drum-slidertick",

  "combobreak",
];

/*
 * The application uses OGG normally and WAV in Safari.
 */
for (const name of HIT_SOUND_NAMES) {
  CORE_FILES.push(`./hitsounds/${name}.ogg`);
  CORE_FILES.push(`./hitsounds/${name}.wav`);
}

function isCacheable(response) {
  return Boolean(
    response &&
      (response.ok || response.type === "opaque")
  );
}

function isNavigationRequest(request) {
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
    url.pathname.startsWith(
      "/beatmaps/download/mini/"
    )
  );
}

function isSayobotApiRequest(request) {
  const url = new URL(request.url);

  return (
    url.hostname === "api.sayobot.cn" &&
    (
      url.pathname.includes("beatmaplist") ||
      url.pathname.includes("beatmapinfo")
    )
  );
}

function isSayobotMediaRequest(request) {
  const url = new URL(request.url);

  return (
    url.hostname === "cdn.sayobot.cn" &&
    (
      url.pathname.startsWith("/preview/") ||
      url.pathname.startsWith("/beatmaps/")
    )
  );
}

function sidFromBeatmapUrl(urlValue) {
  const url = new URL(urlValue);

  const finalPart = url.pathname
    .split("/")
    .filter(Boolean)
    .pop();

  if (!finalPart || !/^\d+$/.test(finalPart)) {
    return null;
  }

  return finalPart;
}

function sidFromInfoUrl(urlValue) {
  const url = new URL(urlValue);

  return (
    url.searchParams.get("1") ||
    url.searchParams.get("0")
  );
}

function jsonResponse(value, extraHeaders = {}) {
  return new Response(
    JSON.stringify(value),
    {
      status: 200,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control": "no-store",

        ...extraHeaders,
      },
    }
  );
}

async function readJson(
  cache,
  key,
  fallback
) {
  const response = await cache.match(key);

  if (!response) {
    return fallback;
  }

  try {
    return await response.json();
  } catch (error) {
    console.warn(
      "Could not read offline state:",
      key,
      error
    );

    return fallback;
  }
}

async function putJson(
  cache,
  key,
  value
) {
  await cache.put(
    key,
    jsonResponse(value)
  );
}

/*
 * Serialize state updates so simultaneous API requests cannot overwrite
 * each other's catalog or downloaded-map changes.
 */
let stateWriteChain = Promise.resolve();

function withStateLock(task) {
  const operation = stateWriteChain.then(
    task,
    task
  );

  stateWriteChain = operation.catch(
    () => undefined
  );

  return operation;
}

function finiteNumber(
  value,
  fallback
) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function firstObject(value) {
  if (Array.isArray(value)) {
    return (
      value.find(
        (item) =>
          item &&
          typeof item === "object"
      ) || {}
    );
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return value;
  }

  return {};
}

function normalizeCatalogEntry(
  value,
  forcedSid
) {
  const entry =
    value &&
    typeof value === "object"
      ? value
      : {};

  const sidValue =
    forcedSid ||
    entry.sid ||
    entry.id;

  if (!sidValue) {
    return null;
  }

  const sid = String(sidValue);

  return {
    sid: /^\d+$/.test(sid)
      ? Number(sid)
      : sid,

    title:
      entry.title ||
      entry.titleU ||
      entry.title_unicode ||
      `Beatmap ${sid}`,

    artist:
      entry.artist ||
      entry.artistU ||
      entry.artist_unicode ||
      "Offline beatmap",

    creator:
      entry.creator ||
      entry.mapper ||
      "Unknown mapper",

    approved: finiteNumber(
      entry.approved ?? entry.ranked,
      0
    ),

    /*
     * The WebOsu list filter uses a bitmask and checks bit 0 for
     * standard-mode beatmaps.
     */
    modes: finiteNumber(
      entry.modes,
      1
    ),
  };
}

async function mergeCatalog(
  entries,
  lastListJson = null
) {
  const validEntries =
    entries.filter(Boolean);

  if (
    !validEntries.length &&
    !lastListJson
  ) {
    return;
  }

  await withStateLock(
    async () => {
      const stateCache =
        await caches.open(STATE_CACHE);

      const catalog =
        await readJson(
          stateCache,
          CATALOG_KEY,
          {}
        );

      for (const entry of validEntries) {
        const sid = String(entry.sid);

        const oldEntry =
          catalog[sid] || {};

        catalog[sid] = {
          ...oldEntry,
          ...entry,

          /*
           * Do not replace useful metadata with a generated fallback.
           */
          title:
            entry.title &&
            !entry.title.startsWith(
              "Beatmap "
            )
              ? entry.title
              : oldEntry.title ||
                entry.title,

          artist:
            entry.artist &&
            entry.artist !==
              "Offline beatmap"
              ? entry.artist
              : oldEntry.artist ||
                entry.artist,

          creator:
            entry.creator &&
            entry.creator !==
              "Unknown mapper"
              ? entry.creator
              : oldEntry.creator ||
                entry.creator,
        };
      }

      await putJson(
        stateCache,
        CATALOG_KEY,
        catalog
      );

      if (lastListJson) {
        await putJson(
          stateCache,
          LAST_LIST_KEY,
          lastListJson
        );
      }
    }
  );
}

async function markBeatmapDownloaded(
  sidValue
) {
  if (!sidValue) {
    return;
  }

  const sid = String(sidValue);

  await withStateLock(
    async () => {
      const stateCache =
        await caches.open(STATE_CACHE);

      const downloaded =
        await readJson(
          stateCache,
          DOWNLOADED_SIDS_KEY,
          []
        );

      /*
       * Move the SID to the end so the newest or most recently accessed
       * beatmap appears first in the offline list.
       */
      const next = downloaded
        .map(String)
        .filter(
          (value) => value !== sid
        );

      next.push(sid);

      /*
       * The beatmap cache itself is not limited here. This only limits
       * how many maps are shown in the generated offline list.
       */
      await putJson(
        stateCache,
        DOWNLOADED_SIDS_KEY,
        next.slice(-200)
      );
    }
  );
}

async function rememberApiResponse(
  url,
  response
) {
  if (
    !response ||
    response.type === "opaque"
  ) {
    return;
  }

  let payload;

  try {
    payload =
      await response.json();
  } catch (error) {
    return;
  }

  if (
    url.pathname.includes(
      "beatmaplist"
    )
  ) {
    const rawRows =
      Array.isArray(
        payload &&
          payload.data
      )
        ? payload.data
        : [];

    const entries = rawRows
      .map(
        (row) =>
          normalizeCatalogEntry(row)
      )
      .filter(Boolean);

    await mergeCatalog(
      entries,
      payload
    );

    return;
  }

  if (
    url.pathname.includes(
      "beatmapinfo"
    )
  ) {
    const sid =
      sidFromInfoUrl(url.href);

    const data =
      payload &&
      payload.data;

    const root =
      data &&
      typeof data === "object"
        ? data
        : {};

    const item =
      firstObject(data);

    const entry =
      normalizeCatalogEntry(
        {
          sid,

          title:
            root.title ||
            root.titleU ||
            item.title ||
            item.titleU,

          artist:
            root.artist ||
            root.artistU ||
            item.artist ||
            item.artistU,

          creator:
            root.creator ||
            item.creator,

          approved:
            root.approved ??
            item.approved,

          modes:
            root.modes ??
            item.modes ??
            1,
        },
        sid
      );

    await mergeCatalog(
      entry ? [entry] : []
    );
  }
}

async function buildOfflineBeatmapList() {
  const stateCache =
    await caches.open(STATE_CACHE);

  const downloaded =
    await readJson(
      stateCache,
      DOWNLOADED_SIDS_KEY,
      []
    );

  const catalog =
    await readJson(
      stateCache,
      CATALOG_KEY,
      {}
    );

  const data = downloaded
    .slice()
    .reverse()
    .map((sid) => {
      const stored =
        catalog[String(sid)] || {};

      return normalizeCatalogEntry(
        stored,
        sid
      );
    })
    .filter(Boolean)
    .map((entry) => ({
      ...entry,

      /*
       * Ensure the standard-mode filter permits this card.
       */
      modes:
        finiteNumber(
          entry.modes,
          1
        ) || 1,
    }));

  return {
    status: 0,
    data,
    offline: true,
  };
}

async function cacheApiResponse(
  request,
  response
) {
  const apiCache =
    await caches.open(API_CACHE);

  const cacheCopy =
    response.clone();

  const indexCopy =
    response.clone();

  await Promise.all([
    apiCache.put(
      request,
      cacheCopy
    ),

    rememberApiResponse(
      new URL(request.url),
      indexCopy
    ),
  ]);
}

async function warmMetadataForSid(
  sidValue
) {
  if (!sidValue) {
    return;
  }

  const sid = String(sidValue);

  /*
   * Cache both endpoint variants because the application uses one for
   * the difficulty list and another when reconstructing a map from its SID.
   */
  const urls = [
    "https://api.sayobot.cn/beatmapinfo?1=" +
      encodeURIComponent(sid),

    "https://api.sayobot.cn/v2/beatmapinfo?0=" +
      encodeURIComponent(sid),
  ];

  await Promise.allSettled(
    urls.map(
      async (url) => {
        const request =
          new Request(
            url,
            {
              mode: "cors",
              cache: "no-store",
            }
          );

        const response =
          await fetch(request);

        if (!isCacheable(response)) {
          return;
        }

        await cacheApiResponse(
          request,
          response
        );
      }
    )
  );

  /*
   * The cover is cosmetic, but warming it makes the generated offline
   * card look like its online equivalent.
   */
  try {
    const coverUrl =
      "https://cdn.sayobot.cn:25225/beatmaps/" +
      encodeURIComponent(sid) +
      "/covers/cover.webp";

    const request =
      new Request(
        coverUrl,
        {
          mode: "no-cors",
        }
      );

    const response =
      await fetch(request);

    if (isCacheable(response)) {
      const mediaCache =
        await caches.open(
          MEDIA_CACHE
        );

      await mediaCache.put(
        request,
        response
      );
    }
  } catch (error) {
    /*
     * A missing cover must never prevent the beatmap itself from
     * becoming available offline.
     */
  }
}

async function precacheApplication() {
  const cache =
    await caches.open(SHELL_CACHE);

  /*
   * Cache files independently. A missing optional or browser-specific
   * resource must not abort the complete service-worker installation.
   *
   * The default HTTP-cache mode lets browsers reuse resources that were
   * already downloaded during the initial online page load.
   */
  const results =
    await Promise.allSettled(
      CORE_FILES.map(
        async (path) => {
          const url =
            scopedUrl(path);

          const request =
            new Request(
              url,
              {
                cache: "default",
              }
            );

          const response =
            await fetch(request);

          if (!response.ok) {
            throw new Error(
              `${response.status} while precaching ${path}`
            );
          }

          await cache.put(
            url,
            response
          );
        }
      )
    );

  const failures =
    results.filter(
      (result) =>
        result.status === "rejected"
    );

  if (failures.length) {
    console.warn(
      `WebOsu precache completed with ${failures.length} missing file(s).`,
      failures
    );
  }
}

async function migrateLegacyBeatmaps() {
  const cacheNames =
    await caches.keys();

  const destination =
    await caches.open(
      BEATMAP_CACHE
    );

  for (
    const cacheName of cacheNames
  ) {
    if (
      !cacheName.startsWith(
        LEGACY_MIXED_CACHE_PREFIX
      )
    ) {
      continue;
    }

    const legacyCache =
      await caches.open(
        cacheName
      );

    const requests =
      await legacyCache.keys();

    for (
      const request of requests
    ) {
      if (
        !isBeatmapRequest(request)
      ) {
        continue;
      }

      const existing =
        await destination.match(
          request
        );

      if (existing) {
        continue;
      }

      const response =
        await legacyCache.match(
          request
        );

      if (response) {
        await destination.put(
          request,
          response.clone()
        );
      }
    }
  }
}

async function indexExistingBeatmaps() {
  const beatmapCache =
    await caches.open(
      BEATMAP_CACHE
    );

  const requests =
    await beatmapCache.keys();

  const sids = requests
    .map(
      (request) =>
        sidFromBeatmapUrl(
          request.url
        )
    )
    .filter(Boolean);

  for (const sid of sids) {
    await markBeatmapDownloaded(
      sid
    );
  }

  /*
   * If an older service worker already cached maps, retrieve their
   * metadata while this new worker is being installed online.
   */
  await Promise.allSettled(
    sids.map(
      warmMetadataForSid
    )
  );
}

self.addEventListener(
  "install",
  (event) => {
    event.waitUntil(
      (async () => {
        await precacheApplication();

        await self.skipWaiting();
      })()
    );
  }
);

self.addEventListener(
  "activate",
  (event) => {
    event.waitUntil(
      (async () => {
        await migrateLegacyBeatmaps();

        const cacheNames =
          await caches.keys();

        const permanentCaches =
          new Set([
            SHELL_CACHE,
            RUNTIME_CACHE,
            BEATMAP_CACHE,
            API_CACHE,
            MEDIA_CACHE,
            STATE_CACHE,
          ]);

        await Promise.all(
          cacheNames
            .filter((name) => {
              if (
                permanentCaches.has(name)
              ) {
                return false;
              }

              return (
                name.startsWith(
                  "webosu-shell-"
                ) ||
                name.startsWith(
                  "webosu-runtime-"
                ) ||
                name.startsWith(
                  JS_CACHE_PREFIX
                ) ||
                name.startsWith(
                  STATIC_CACHE_PREFIX
                )
              );
            })
            .map(
              (name) =>
                caches.delete(name)
            )
        );

        await indexExistingBeatmaps();

        await self.clients.claim();
      })()
    );
  }
);

async function matchStatic(
  request
) {
  const cacheNames = [
    SHELL_CACHE,
    RUNTIME_CACHE,
  ];

  for (
    const cacheName of cacheNames
  ) {
    const cache =
      await caches.open(
        cacheName
      );

    const exact =
      await cache.match(
        request
      );

    if (exact) {
      return exact;
    }

    /*
     * jsloader.js adds ?v=BUILD_ID. The installation cache stores the
     * underlying file without that query, so ignore it only when finding
     * a cached fallback.
     */
    const withoutQuery =
      await cache.match(
        request,
        {
          ignoreSearch: true,
        }
      );

    if (withoutQuery) {
      return withoutQuery;
    }
  }

  return null;
}

async function handleNavigation(
  request
) {
  try {
    const response =
      await fetch(request);

    if (isCacheable(response)) {
      const runtimeCache =
        await caches.open(
          RUNTIME_CACHE
        );

      await runtimeCache.put(
        request,
        response.clone()
      );
    }

    return response;
  } catch (error) {
    const cachedPage =
      await matchStatic(
        request
      );

    if (cachedPage) {
      return cachedPage;
    }

    /*
     * A reload of another page such as latest.html can still enter through
     * index.html. The generated offline map list will then expose all
     * downloaded maps.
     */
    const shellCache =
      await caches.open(
        SHELL_CACHE
      );

    const index =
      (
        await shellCache.match(
          scopedUrl("./index.html")
        )
      ) ||
      (
        await shellCache.match(
          scopedUrl("./")
        )
      );

    if (index) {
      return index;
    }

    return new Response(
      "WebOsu is offline, but its application shell is not cached yet.",
      {
        status: 503,
        headers: {
          "Content-Type":
            "text/plain; charset=utf-8",
        },
      }
    );
  }
}

function handleSameOriginStatic(
  event
) {
  const request =
    event.request;

  /*
   * Refresh static resources in the background. A cached resource is
   * returned immediately when one is available.
   */
  const networkPromise =
    fetch(request).then(
      async (response) => {
        if (
          isCacheable(response)
        ) {
          const runtimeCache =
            await caches.open(
              RUNTIME_CACHE
            );

          await runtimeCache.put(
            request,
            response.clone()
          );
        }

        return response;
      }
    );

  event.waitUntil(
    networkPromise
      .then(() => undefined)
      .catch(() => undefined)
  );

  event.respondWith(
    (async () => {
      const cached =
        await matchStatic(
          request
        );

      if (cached) {
        return cached;
      }

      try {
        return await networkPromise;
      } catch (error) {
        return Response.error();
      }
    })()
  );
}

async function handleSayobotApi(
  request
) {
  const apiCache =
    await caches.open(
      API_CACHE
    );

  try {
    const response =
      await fetch(request);

    if (isCacheable(response)) {
      await cacheApiResponse(
        request,
        response
      );
    }

    return response;
  } catch (error) {
    const cached =
      await apiCache.match(
        request
      );

    if (cached) {
      return cached;
    }

    const url =
      new URL(request.url);

    /*
     * The offline request will normally contain a new random offset, so
     * matching an old beatmaplist URL is insufficient. Generate a fresh
     * list containing the beatmaps that are actually present in the
     * persistent beatmap cache.
     */
    if (
      url.pathname.includes(
        "beatmaplist"
      )
    ) {
      return jsonResponse(
        await buildOfflineBeatmapList(),
        {
          "X-WebOsu-Offline": "1",
        }
      );
    }

    if (
      url.pathname.includes(
        "beatmapinfo"
      )
    ) {
      /*
       * Use the API's not-found shape rather than causing an unhandled
       * rejected fetch in application code.
       */
      return jsonResponse(
        {
          status: -1,
          data: [],
        },
        {
          "X-WebOsu-Offline": "1",
        }
      );
    }

    return Response.error();
  }
}

async function handleBeatmap(
  request
) {
  const beatmapCache =
    await caches.open(
      BEATMAP_CACHE
    );

  const cached =
    await beatmapCache.match(
      request
    );

  const sid =
    sidFromBeatmapUrl(
      request.url
    );

  if (cached) {
    await markBeatmapDownloaded(
      sid
    );

    return cached;
  }

  try {
    const response =
      await fetch(request);

    if (isCacheable(response)) {
      /*
       * Finish writing the .osz before reporting that the request is
       * complete. This guarantees that an immediate offline reload can
       * retrieve the whole beatmap rather than an incomplete stream.
       */
      await beatmapCache.put(
        request,
        response.clone()
      );

      await markBeatmapDownloaded(
        sid
      );

      /*
       * Explicitly retrieve the metadata now. This works even when the
       * original list and info requests happened before the first service
       * worker gained control of the page.
       */
      await warmMetadataForSid(
        sid
      );
    }

    return response;
  } catch (error) {
    return Response.error();
  }
}

async function handleSayobotMedia(
  request
) {
  const mediaCache =
    await caches.open(
      MEDIA_CACHE
    );

  const cached =
    await mediaCache.match(
      request
    );

  if (cached) {
    return cached;
  }

  try {
    const response =
      await fetch(request);

    if (isCacheable(response)) {
      await mediaCache.put(
        request,
        response.clone()
      );
    }

    return response;
  } catch (error) {
    return Response.error();
  }
}

self.addEventListener(
  "fetch",
  (event) => {
    const request =
      event.request;

    if (request.method !== "GET") {
      return;
    }

    /*
     * Permanent cache-first storage for downloaded .osz files.
     */
    if (
      isBeatmapRequest(request)
    ) {
      event.respondWith(
        handleBeatmap(request)
      );

      return;
    }

    /*
     * Network-first API responses, with exact cached metadata and a
     * generated downloaded-map list as offline fallbacks.
     */
    if (
      isSayobotApiRequest(request)
    ) {
      event.respondWith(
        handleSayobotApi(request)
      );

      return;
    }

    /*
     * Covers and previews are helpful offline but are not required for
     * launching a downloaded beatmap.
     */
    if (
      isSayobotMediaRequest(request)
    ) {
      event.respondWith(
        handleSayobotMedia(request)
      );

      return;
    }

    const url =
      new URL(request.url);

    if (
      url.origin ===
      self.location.origin
    ) {
      if (
        isNavigationRequest(request)
      ) {
        event.respondWith(
          handleNavigation(request)
        );

        return;
      }

      handleSameOriginStatic(event);
    }

    /*
     * Analytics and unrelated third-party requests keep the browser's
     * normal behavior and may fail harmlessly while offline.
     */
  }
);
