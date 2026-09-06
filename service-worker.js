// Service worker for the Alpaca Screener PWA.
//
// Scope is intentionally narrow: this only caches the static "app shell"
// (the HTML page, manifest, icons, and the charting library pulled from
// unpkg) so the app can install on a phone home screen and still open
// when offline or on a flaky connection. It deliberately does NOT cache
// Alpaca API responses — screener/chart data must always come from the
// network since stale prices are worse than no prices.

var CACHE_NAME = "alpaca-screener-shell-v1";

var SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./apple-touch-icon.png",
  "https://unpkg.com/lightweight-charts@4.1.1/dist/lightweight-charts.standalone.production.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Individual failures (e.g. the CDN request) shouldn't block
      // install of the rest of the shell.
      return Promise.all(
        SHELL_ASSETS.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn("Shell asset failed to cache:", url, err);
          });
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) {
            return key !== CACHE_NAME;
          })
          .map(function (key) {
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

function isAlpacaApiRequest(url) {
  return url.hostname.indexOf("alpaca.markets") !== -1;
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url = new URL(request.url);

  // Never intercept live market-data requests — always go to the network.
  if (isAlpacaApiRequest(url)) return;

  // Navigations (opening/reloading the app): try the network first so
  // users get the latest build when online, falling back to the cached
  // shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put("./index.html", copy);
          });
          return response;
        })
        .catch(function () {
          return caches.match("./index.html");
        })
    );
    return;
  }

  // Everything else in the shell (JS library, icons, manifest):
  // cache-first, refreshing the cache in the background when possible.
  event.respondWith(
    caches.match(request).then(function (cached) {
      var networkFetch = fetch(request)
        .then(function (response) {
          if (response && response.ok) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(request, copy);
            });
          }
          return response;
        })
        .catch(function () {
          return cached;
        });
      return cached || networkFetch;
    })
  );
});
