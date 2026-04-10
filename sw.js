const CACHE_NAME = 'vitalwatch-v2.4.1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/data.js',
  '/js/vitals.js',
  '/js/charts.js',
  '/js/app.js',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// Background sync for alerts (placeholder for real backend)
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'VitalWatch Alert', {
      body: data.body || 'Critical patient alert — check dashboard',
      icon: '/manifest.json',
      badge: '/manifest.json',
      tag: data.tag || 'alert',
      requireInteraction: data.critical || false,
      data: { url: '/?page=alerts' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.openWindow(e.notification.data?.url || '/')
  );
});
