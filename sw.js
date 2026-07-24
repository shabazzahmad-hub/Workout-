/* Military Calisthenics Command — offline service worker (V3.4) */
const CACHE = 'milcal-v4.0.1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './img-pushup.jpg', './img-pullup.jpg', './img-squat.jpg', './img-lunge.jpg',
  './ex-pushup.jpg','./ex-diamond-pushup.jpg','./ex-archer-pushup.jpg','./ex-pike-pushup.jpg',
  './ex-pullup.jpg','./ex-deadhang.jpg','./ex-kneeraise.jpg','./ex-legraise.jpg',
  './ex-dip.jpg','./ex-support-hold.jpg','./ex-handstand.jpg','./ex-pike-elevated.jpg',
  './ex-squat.jpg','./ex-lunge.jpg','./ex-splitsquat.jpg','./ex-glutebridge.jpg',
  './ex-plank.jpg','./ex-sideplank.jpg','./ex-hollow.jpg','./ex-deadbug.jpg',
  './ex-revcrunch.jpg','./ex-birddog.jpg','./ex-superman.jpg','./ex-ytw.jpg',
  './ex-bearcrawl.jpg','./ex-mountainclimber.jpg','./ex-burpee.jpg','./ex-march.jpg'];

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
   Cache-first for static assets (icons/manifest). */
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
