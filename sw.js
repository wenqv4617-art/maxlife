const CACHE_NAME = 'haloes-v6';

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
  // 1. 明确不缓存 HTML 文档
  if (event.request.mode === 'navigate' || 
      event.request.destination === 'document' ||
      event.request.headers.get('Accept')?.includes('text/html')) {
    return;  // 直接走网络，不要缓存
  }

  // 2. 静态资源：网络优先，网络挂了用缓存
  event.respondWith(
    fetch(event.request).then(response => {
      // 只缓存成功的响应
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => {
      return caches.match(event.request);
    })
  );
});