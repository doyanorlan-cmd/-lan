// Service worker Élan : l'appli s'ouvre hors-ligne ; l'IA (/api) exige le réseau.
const V = 'elan-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  if (r.mode === 'navigate') { // réseau d'abord, cache en secours
    e.respondWith(fetch(r).then(x => { caches.open(V).then(c => c.put('/', x.clone())); return x; }).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(x => { if (x.ok && (u.origin === location.origin || u.host.includes('gstatic') || u.host.includes('googleapis'))) { const cp = x.clone(); caches.open(V).then(c => c.put(r, cp)); } return x; }).catch(() => hit)));
});
