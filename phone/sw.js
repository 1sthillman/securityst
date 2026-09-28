/* Basit çevrimdışı service worker: uygulama kabuğunu önbelleğe alır.
 * Kayıt verisi zaten IndexedDB'de — SW yalnızca HTML/CSS/JS'in
 * internetsiz açılmasını garanti eder. İlk ziyarette kaydolur.
 */
const CACHE = 'kapikayit-v1';
const ASSETS = ['./', './index.html', './css/style.css', './js/app.js', './js/db.js', './js/sync.js', './js/config.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match('./index.html'))));
});
