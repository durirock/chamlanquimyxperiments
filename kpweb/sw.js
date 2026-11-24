// Killer Pendiente · service worker
// Red primero (siempre la versión nueva si hay señal), caché como respaldo sin señal.
// También abre la app al tocar la notificación de fin del timer.
const CACHE = 'kp-web-v1';
const BASE = ['./', 'index.html', 'estilo.css', 'app.js', 'flotante.js', 'config.js', 'manifest.json', 'icono.svg', 'icono-192.png',
  'vendor/firebase-app-compat.js', 'vendor/firebase-auth-compat.js', 'vendor/firebase-firestore-compat.js'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).catch(() => { })); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then((resp) => {
    if (resp.ok) { const copia = resp.clone(); caches.open(CACHE).then((c) => c.put(r, copia)); }
    return resp;
  }).catch(() => caches.match(r).then((m) => m || caches.match('index.html'))));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) { c.postMessage('kp-foco'); return c.focus(); } }
    return self.clients.openWindow('./');
  }));
});
