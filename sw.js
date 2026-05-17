const CACHE_NAME = 'haloes-v5';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    fetch(event.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
      return r;
    }).catch(() => caches.match(event.request))
  );
});