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
  // 不是 GET 请求不处理
  if (event.request.method !== 'GET') return;

  // 页面请求：完全不拦截，交给浏览器自己走网络
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    return;
  }

  // 静态资源：网络优先，网络挂了用缓存
  event.respondWith(
    fetch(event.request).then(response => {
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
