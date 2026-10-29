/* Securechat : service worker (v4.1.0)
   - Ouvre l'appli instantanément : la page et les bibliothèques viennent du cache.
   - Mises à jour rapides : à chaque ouverture, la page est re-téléchargée en contournant tous les caches ;
     si elle a changé, l'appli est prévenue et se recharge toute seule (dès que tu n'es pas en train d'écrire).
   - Les appels Firebase / notifications ne sont jamais mis en cache (aucun message n'est stocké ici).
   - Ouvre l'appli au clic sur une notification. */
const VERSION = 'securechat-v4.1.0';
const SHELL = 'shell-' + VERSION;
const LIBS = 'libs-' + VERSION;
const LIB_HOSTS = ['cdn.tailwindcss.com', 'unpkg.com', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      // Chaque fichier est ajouté séparément : s'il en manque un, l'installation continue quand même
      .then((c) => Promise.all(['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'].map((f) => c.add(new Request(f, { cache: 'reload' })).catch(() => {}))))
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

function notifyClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => list.forEach((c) => c.postMessage({ type: 'sw-update' })));
}

// Re-télécharge la page en contournant le cache HTTP (GitHub Pages garde 10 min), compare, met à jour le cache, prévient si elle a changé
async function revalidateShell(req) {
  try {
    const cache = await caches.open(SHELL);
    const cached = await cache.match(req);
    const res = await fetch(req, { cache: 'reload' });
    if (!cacheable(res)) return;
    let changed = false;
    if (cached && res.type !== 'opaque') {
      const [a, b] = await Promise.all([cached.clone().text(), res.clone().text()]);
      changed = a !== b;
    }
    await cache.put(req, res.clone());
    if (changed) await notifyClients();
  } catch (err) { /* hors ligne : on garde la version en cache */ }
}

function isShell(url) {
  return url.origin === self.location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
}

// Répond tout de suite avec le cache s'il existe, et rafraîchit en arrière-plan
function staleWhileRevalidate(event, cacheName, shell) {
  const req = event.request;
  event.respondWith(
    caches.open(cacheName).then(async (cache) => {
      const cached = await cache.match(req);
      if (shell) {
        const refresh = revalidateShell(req);
        if (cached) { event.waitUntil(refresh); return cached; }
        await refresh;
        return (await cache.match(req)) || fetch(req).catch(() => Response.error());
      }
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
    staleWhileRevalidate(event, SHELL, isShell(url));
    return;
  }
  if (LIB_HOSTS.includes(url.hostname)) {
    if (/\/\d+\.\d+\.\d+\/|@\d+\.\d+/.test(url.pathname) || url.hostname === 'fonts.gstatic.com') cacheFirst(event, LIBS);
    else staleWhileRevalidate(event, LIBS, false);
  }
  // tout le reste (Firebase, ntfy, …) passe directement par le réseau
});

// La page peut demander une vérification (retour au premier plan, vérification périodique)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'check') {
    event.waitUntil(Promise.all([
      revalidateShell(new Request(new URL('./', self.registration.scope).href)),
      revalidateShell(new Request(new URL('index.html', self.registration.scope).href))
    ]));
  }
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
