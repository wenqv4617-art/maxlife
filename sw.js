const CACHE_NAME = 'haloes-app-v3';
const urlsToCache = [
  './manifest.json'
];

// 安装事件
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// 请求拦截
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // HTML页面请求：永远走网络，绝不缓存
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('./index.html') || new Response('离线无法访问', { status: 503 });
      })
    );
    return;
  }

  // JS/CSS等静态资源：网络优先，3秒超时后用缓存
  event.respondWith(
    Promise.race([
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }),
      new Promise(resolve => setTimeout(() => resolve(null), 3000))
    ]).then(response => {
      if (response) return response;
      return caches.match(event.request).then(cached => {
        return cached || fetch(event.request);
      });
    }).catch(() => {
      return caches.match(event.request).then(cached => {
        return cached || new Response('', { status: 503 });
      });
    })
  );
});