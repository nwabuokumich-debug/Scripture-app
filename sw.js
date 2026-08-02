const CACHE = 'scripture-v120';

// Rendered verse audio is immutable and expensive to fetch, so it lives in its
// own deliberately UNVERSIONED cache. The app-shell cache is wiped on every
// deploy (that's how new CSS/JS reaches devices); audio must survive that, or
// every deploy would silently re-download the user's whole library.
const AUDIO_CACHE = 'scripture-audio';
const AUDIO_PATH = '/storage/v1/object/public/scripture-audio/';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE && k !== AUDIO_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Audio: cache-first. A rendered verse never changes, so once it's stored
  // there is no reason to hit the network again — offline or not.
  if (e.request.url.includes(AUDIO_PATH)) {
    e.respondWith(
      caches.open(AUDIO_CACHE).then(c =>
        c.match(e.request).then(hit =>
          hit || fetch(e.request).then(res => {
            if (res.ok) c.put(e.request, res.clone());
            return res;
          })
        )
      )
    );
    return;
  }

  // Everything else: network-first — always try fresh, fall back to cache offline.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
