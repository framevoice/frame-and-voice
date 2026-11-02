// Frame & Voice service worker: keeps the app working offline.
// Bump VERSION whenever you change files so users get the update.
const VERSION = "fv-v5";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/transcribe-worker.js",
  "/vendor/jspdf.umd.min.js",
  "/vendor/ffmpeg/index.js",
  "/vendor/ffmpeg/classes.js",
  "/vendor/ffmpeg/const.js",
  "/vendor/ffmpeg/errors.js",
  "/vendor/ffmpeg/types.js",
  "/vendor/ffmpeg/utils.js",
  "/vendor/ffmpeg/worker.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/favicon-32.png",
  "/icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("fv-") && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Large, version-pinned files: download once, then always serve from the cache.
const PINNED_HOSTS = ["cdn.jsdelivr.net", "unpkg.com"];
const isPinned = url => PINNED_HOSTS.includes(url.hostname) || (url.origin === location.origin && url.pathname.startsWith("/vendor/"));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Pages: try the network first so updates show up, fall back to the cached copy offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put("/", copy)); return res; })
        .catch(() => caches.match("/"))
    );
    return;
  }

  if (isPinned(url)) {
    e.respondWith(
      caches.open(VERSION).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // Other own files and Google Fonts: serve from cache, refresh in the background.
  // (Speech model files from huggingface.co are cached by the transcriber itself.)
  const cacheable = url.origin === location.origin ||
    url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!cacheable) return;
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const hit = await cache.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })
  );
});
