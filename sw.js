/* CoreForge — offline service worker */
const CACHE = 'coreforge-v15';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './ex-kneeplank.jpg','./ex-plank.jpg','./ex-longplank.jpg','./ex-planktap.jpg',
  './ex-tuckhollow.jpg','./ex-hollow.jpg','./ex-hollowrock.jpg',
  './ex-deadbug.jpg','./ex-revcrunch.jpg','./ex-legraise.jpg','./ex-kneeraise.jpg',
  './ex-crunch.jpg','./ex-bicycle.jpg','./ex-tuckvup.jpg','./ex-vup.jpg',
  './ex-kneeside.jpg','./ex-sideplank.jpg','./ex-sidedip.jpg','./ex-copenhagen.jpg',
  './ex-seatedtwist.jpg','./ex-russiantwist.jpg','./ex-weightedtwist.jpg',
  './ex-glutebridge.jpg','./ex-birddog.jpg','./ex-march.jpg','./ex-superman.jpg',
  './ex-marchplace.jpg','./ex-mountainclimber.jpg','./ex-flutter.jpg','./ex-scissors.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network-first for the app page (so updates arrive), cache fallback for offline.
   Cache-first for static assets (icons/manifest/images). */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');
  if (isPage) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }))
  );
});
