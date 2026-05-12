const CACHE_NAME = 'haloes-app-v1';
const urlsToCache = [
  '/maxlife/',
  '/maxlife/index.html',
  '/maxlife/manifest.json'
];

// 安装事件 - 缓存核心资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
  // 跳过等待，立即激活
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
  // 立即接管所有页面
  self.clients.claim();
});

// 请求拦截 - 缓存优先策略
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // 如果有缓存，返回缓存
      if (cachedResponse) {
        return cachedResponse;
      }
      // 否则走网络请求
      return fetch(event.request).then(response => {
        // 只缓存成功的 GET 请求
        if (
          !response ||
          response.status !== 200 ||
          response.type !== 'basic' ||
          event.request.method !== 'GET'
        ) {
          return response;
        }
        // 克隆响应存入缓存
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });
        return response;
      });
    })
  );
});