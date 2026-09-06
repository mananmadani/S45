/* S45 Jeans Co — Order Form: Service Worker */

const CACHE_NAME = "s45-orderform-v8";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./s45.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cache each app-shell file individually instead of cache.addAll().
      // addAll() is all-or-nothing: if even ONE file 404s or the network
      // hiccups on a single request, the whole install silently fails and
      // NOTHING gets cached — which is exactly what breaks offline mode.
      // Promise.allSettled means one bad file can't sink the rest.
      Promise.allSettled(
        APP_SHELL.map((url) =>
          fetch(url, { cache: "reload" }).then((res) => {
            if (res && res.ok) return cache.put(url, res);
          }).catch(() => {})
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Full-page navigations (typing the URL, opening the home-screen icon,
  // reloading): always try the network first for the freshest app, and if
  // that fails for any reason, fall back to the cached app shell — never to
  // "undefined", which Chrome reports as ERR_FAILED instead of a real page.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() =>
          caches.match("./index.html").then((cached) => cached || caches.match("./"))
        )
    );
    return;
  }

  // App shell assets: cache-first, with a network fallback that can never
  // resolve to "undefined".
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
            return res;
          })
          .catch(() => cached || new Response("Offline", { status: 503, statusText: "Offline" }));
      })
    );
    return;
  }

  // Third-party libs (jsPDF / html2canvas from CDN): stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => cached || new Response("Offline", { status: 503, statusText: "Offline" }));
      return cached || fetchPromise;
    })
  );
});
