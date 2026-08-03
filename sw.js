/* CoreForge — offline service worker */
const CACHE = 'coreforge-v102';
const SHELL = ['./', './index.html', './manifest.webmanifest', './archivo.woff2', './icon-192.png', './icon-512.png', './hero.jpg', './coach-sarge.jpg',
  './ex-kneeplank.jpg','./ex-plank.jpg','./ex-longplank.jpg','./ex-planktap.jpg',
  './ex-tuckhollow.jpg','./ex-hollow.jpg','./ex-hollowrock.jpg','./ex-reverseplank.jpg',
  './ex-deadbug.jpg','./ex-revcrunch.jpg','./ex-legraise.jpg','./ex-kneeraise.jpg',
  './ex-crunch.jpg','./ex-bicycle.jpg','./ex-tuckvup.jpg','./ex-vup.jpg',
  './ex-kneeside.jpg','./ex-sideplank.jpg','./ex-sidedip.jpg','./ex-copenhagen.jpg',
  './ex-seatedtwist.jpg','./ex-russiantwist.jpg','./ex-weightedtwist.jpg',
  './ex-glutebridge.jpg','./ex-birddog.jpg','./ex-march.jpg','./ex-superman.jpg',
  './ex-marchplace.jpg','./ex-mountainclimber.jpg','./ex-flutter.jpg','./ex-scissors.jpg',
  './ex-squat.jpg','./ex-reverselunge.jpg','./ex-kneepushup.jpg','./ex-pushup.jpg',
  './ex-jumpingjack.jpg','./ex-highknees.jpg','./ex-buttkick.jpg','./ex-skater.jpg',
  './ex-squatthrust.jpg','./ex-burpee.jpg',
  './ex-archerpushup.jpg','./ex-spidermanpushup.jpg','./ex-wallhandstand.jpg',
  './ex-broadjump.jpg','./ex-bulgarian.jpg','./ex-calfraise.jpg','./ex-chinup.jpg','./ex-closepushup.jpg','./ex-deadhang.jpg','./ex-declinepushup.jpg','./ex-diamondpushup.jpg','./ex-elevatedpike.jpg','./ex-hipthrust.jpg','./ex-hspushup.jpg','./ex-inclinepushup.jpg','./ex-invertedrow.jpg','./ex-jumpsquat.jpg','./ex-nordic.jpg','./ex-pikepushup.jpg','./ex-pistol.jpg','./ex-pullup.jpg','./ex-scappull.jpg','./ex-singlecalf.jpg','./ex-splitsquat.jpg','./ex-superpushup.jpg','./ex-tuckjump.jpg','./ex-walkinglunge.jpg',
  './wu-march.jpg','./wu-armcircles.jpg','./wu-torsotwist.jpg','./wu-hipcircles.jpg','./wu-glutebridge.jpg','./wu-birddog.jpg','./wu-catcow.jpg','./wu-kneehug.jpg',
  './cd-childs.jpg','./cd-cobra.jpg','./cd-twistleft.jpg','./cd-twistright.jpg','./cd-catcow.jpg','./cd-knees.jpg','./cd-breathing.jpg',
  './ex-negpullup.jpg','./ex-widepullup.jpg','./ex-invertedrowelev.jpg','./ex-benchdip.jpg','./ex-dips.jpg','./ex-boxpistol.jpg','./ex-singlebridge.jpg','./ex-splitjump.jpg','./ex-burpeetuck.jpg',
  './ex-abroll.jpg','./ex-mbslam.jpg','./ex-mbtwist.jpg','./ex-mbsitup.jpg','./ex-kbswing.jpg','./ex-kbgoblet.jpg','./ex-kbcp.jpg','./ex-kbrow.jpg','./ex-kbrdl.jpg','./ex-kblunge.jpg','./ex-ropewave.jpg','./ex-ropeslam.jpg','./ex-dipknee.jpg',
  './ex-dbgoblet.jpg','./ex-dbrdl.jpg','./ex-dbrow.jpg','./ex-dbpress.jpg','./ex-dbfloor.jpg','./ex-dblunge.jpg','./ex-dbthruster.jpg','./ex-dbcurl.jpg','./ex-dbrenegade.jpg','./ex-dbtwist.jpg','./ex-kbcarry.jpg','./ex-barhang.jpg','./ex-asiansquat.jpg','./ex-bike.jpg','./ex-sprint.jpg',
  './ex-standingoblique.jpg','./ex-squatjack.jpg','./ex-halfburpee.jpg','./ex-atomicpushup.jpg'];

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
