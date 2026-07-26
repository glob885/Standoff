/* ============================================================
   sw.js — сервис-воркер: игра работает офлайн после первого
   запуска (нужно для запуска с экрана «Домой» без интернета).
   ============================================================ */
'use strict';

const CACHE = 'siren-v3.0.1';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './main.js',
  './manifest.webmanifest',
  './vendor/three.min.js',
  './src/util.js',
  './src/textures.js',
  './src/sky.js',
  './src/postfx.js',
  './src/world.js',
  './src/models.js',
  './src/fx.js',
  './src/audio.js',
  './src/voice.js',
  './src/touch.js',
  './src/detail.js',
  './src/entities.js',
  './src/game.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).catch(() => {
        // если что-то одно не скачалось — кэшируем по одному, без падения установки
        return Promise.all(ASSETS.map(u => c.add(u).catch(() => null)));
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // навигация: сначала сеть (чтобы подхватывать обновления), потом кэш
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // остальное: сначала кэш (быстро и офлайн), фоном обновляем
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('message', e => {
  const msg = e.data;
  if (msg === 'skipWaiting') { self.skipWaiting(); return; }
  if (msg === 'clearCache') {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
  }
});
