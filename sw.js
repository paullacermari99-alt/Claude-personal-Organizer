/* Service worker: permite abrir la app sin conexión.
   Sube CACHE cuando cambien los archivos para forzar la actualización. */
const CACHE = 'organizador-v63';
const ASSETS = ['./', 'index.html', 'styles.css?v=63', 'config.js?v=63', 'core.js?v=63', 'smart.js?v=63', 'colors.js?v=63', 'ui.js?v=63', 'extcal.js?v=63', 'sync.js?v=63', 'onboarding.js?v=63', 'tour.js?v=63', 'calendar.js?v=63', 'gestures.js?v=63', 'extras.js?v=63', 'habits.js?v=63', 'planner.js?v=63', 'voice.js?v=63', 'pro.js?v=63', 'app.js?v=63', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* Archivos con ?v= (no cambian nunca: cada versión lleva otro número): de la caché al instante.
   La página y el resto: red primero (así llegan las versiones nuevas), pero si la red tarda
   más de 3 s se abre desde la caché para no dejarte esperando. */
const fromNet = req => fetch(req, { cache: 'no-cache' }).then(res => {
  if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
  return res;
});
const fromCache = req => caches.match(req, { ignoreSearch: !new URL(req.url).search.includes('v=') }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.search.includes('v=')) {
    e.respondWith(caches.match(req).then(r => r || fromNet(req)));
    return;
  }
  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => fromCache(req).then(finish), 3000);
    fromNet(req).then(r => { clearTimeout(timer); finish(r); })
      .catch(() => fromCache(req).then(r => { finish(r); if (!done) resolve(Response.error()); }));
  }));
});

/* Avisos push (recordatorios con la app cerrada) */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Boldup', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Boldup', { body: d.body || '', tag: d.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', renotify: !!d.tag, vibrate: d.tag === 'focus-live' ? [200, 100, 200] : undefined }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(x => 'focus' in x);
    return c ? c.focus() : self.clients.openWindow('./#hoy');
  }));
});
