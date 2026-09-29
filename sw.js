// Kasa Cepte — çevrimdışı çalışma
const CACHE = "kasacepte-v2";
const SHELL = ["./", "index.html", "app.js", "store.js", "config.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Firebase veri ve giriş istekleri önbelleğe alınmaz (Firestore kendi çevrimdışı deposunu kullanır)
  if (/firestore\.googleapis|identitytoolkit|securetoken|googleapis\.com\/identity/.test(url.host + url.pathname)) return;
  const sameOrigin = url.origin === location.origin;
  const cacheable = sameOrigin || /gstatic\.com|fonts\.googleapis\.com/.test(url.host);
  if (!cacheable) return;
  // Önce ağ (en güncel sürüm), ağ yoksa önbellek
  e.respondWith(
    fetch(req).then(res => {
      if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === "navigate" ? caches.match("index.html") : undefined)))
  );
});
