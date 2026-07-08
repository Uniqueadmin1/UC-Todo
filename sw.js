// Minimal PWA app-shell cache. Data always comes from Supabase over the network —
// this only makes the shell itself installable and openable while offline.
const CACHE_NAME = "todo-app-shell-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/js/main.js",
  "/js/app.js",
  "/js/teamView.js",
  "/js/identity.js",
  "/js/sync.js",
  "/js/renderer.js",
  "/js/config.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first for the app shell, so a redeploy is picked up on next load when
// online; falls back to the cached shell so the app still opens while offline.
// Requests to Supabase/CDNs (a different origin) pass through untouched.
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
