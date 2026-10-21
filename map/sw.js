// Офлайн-режим: в парке связь бывает плохой, поэтому карта и данные кешируются при первом открытии
const CACHE = 'skazka-v3';
const CORE = [
  './', 'index.html', 'style.css', 'app.js', 'data.js', 'manifest.webmanifest',
  'assets/map.webp', 'assets/icon-192.png', 'assets/icon-512.png',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Сначала сеть (чтобы видеть свежие правки), при её отсутствии — кеш; фото кешируются по мере просмотра
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
