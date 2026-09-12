/* sw.js — офлайн-кэш приложения и тайлов карты */
const APP_CACHE = 'ritm-app-v5';
const TILE_CACHE = 'ritm-tiles-v1';
const APP_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './lib/leaflet.js',
  './lib/leaflet.css',
  './lib/marker-icon.png',
  './lib/marker-icon-2x.png',
  './lib/marker-shadow.png',
  './js/geo.js',
  './js/stats.js',
  './js/db.js',
  './js/efforts.js',
  './js/training.js',
  './js/tracker.js',
  './js/ui.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== APP_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Тайлы карт (OSM / CARTO / Esri): cache-first с ограничением
  const isTile = url.hostname.endsWith('tile.openstreetmap.org')
    || url.hostname.endsWith('basemaps.cartocdn.com')
    || url.hostname.endsWith('arcgisonline.com');
  if (isTile) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) { cache.put(req, res.clone()); trimCache(TILE_CACHE, 400); }
          return res;
        } catch { return hit || Response.error(); }
      })
    );
    return;
  }

  // Приложение: cache-first, обновляем в фоне
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res.ok && url.origin === location.origin) {
          caches.open(APP_CACHE).then(c => c.put(req, res.clone()));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > max) {
    for (let i = 0; i < keys.length - max; i++) cache.delete(keys[i]);
  }
}
