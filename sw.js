const CACHE = 'scripture-v1';
const BASE = self.location.pathname.replace('/sw.js', '');
const SHELL = [BASE + '/', BASE + '/index.html', BASE + '/style.css', BASE + '/app.js', BASE + '/config.js', BASE + '/manifest.json', BASE + '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Only cache same-origin shell files; pass Supabase requests through
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
