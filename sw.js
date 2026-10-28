/* Securechat : service worker (v4.0.0)
   - Ouvre l'appli instantanément : la page et les bibliothèques viennent du cache, puis se mettent à jour en arrière-plan.
   - Les appels Firebase / notifications ne sont jamais mis en cache (aucun message n'est stocké ici).
   - Ouvre l'appli au clic sur une notification. */
const VERSION = 'securechat-v4.0.0';
const SHELL = 'shell-' + VERSION;
const LIBS = 'libs-' + VERSION;
const LIB_HOSTS = ['cdn.tailwindcss.com', 'unpkg.com', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      // Chaque fichier est ajouté séparément : s'il en manque un, l'installation continue quand même
      .then((c) => Promise.all(['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'].map((f) => c.add(f).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== LIBS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const cacheable = (res) => res && (res.ok || res.type === 'opaque');

// Répond tout de suite avec le cache s'il existe, et rafraîchit en arrière-plan
function staleWhileRevalidate(event, cacheName) {
  const req = event.request;
  event.respondWith(
    caches.open(cacheName).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: false });
      const network = fetch(req).then((res) => { if (cacheable(res)) cache.put(req, res.clone()); return res; }).catch(() => null);
      if (cached) { event.waitUntil(network); return cached; }
      return (await network) || Response.error();
    })
  );
}

// Bibliothèques versionnées (…/9.23.0/…, …@0.469.0…) : le cache gagne toujours
function cacheFirst(event, cacheName) {
  const req = event.request;
  event.respondWith(
    caches.open(cacheName).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (cacheable(res)) cache.put(req, res.clone());
        return res;
      } catch (err) { return Response.error(); }
    })
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    staleWhileRevalidate(event, SHELL);
    return;
  }
  if (LIB_HOSTS.includes(url.hostname)) {
    if (/\/\d+\.\d+\.\d+\/|@\d+\.\d+/.test(url.pathname) || url.hostname === 'fonts.gstatic.com') cacheFirst(event, LIBS);
    else staleWhileRevalidate(event, LIBS);
  }
  // tout le reste (Firebase, ntfy, …) passe directement par le réseau
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow('./');
    })
  );
});
