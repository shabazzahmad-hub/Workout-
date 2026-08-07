/* CoreForge — offline service worker */
const CACHE = 'coreforge-v181';
const SHELL = ['./', './index.html', './manifest.webmanifest', './archivo.woff2', './icon-192-v2.png', './icon-512-v2.png', './hero.jpg', './coach-sarge.jpg',
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
  './ex-dbgoblet.jpg','./ex-dbrdl.jpg','./ex-dbrow.jpg','./ex-dbpress.jpg','./ex-dbfloor.jpg','./ex-dblunge.jpg','./ex-dbthruster.jpg','./ex-dbcurl.jpg','./ex-dbrenegade.jpg','./ex-dbtwist.jpg','./ex-kbcarry.jpg','./ex-asiansquat.jpg','./ex-bike.jpg','./ex-sprint.jpg','./ex-skip.jpg',
  './ex-standingoblique.jpg','./ex-squatjack.jpg','./ex-halfburpee.jpg','./ex-atomicpushup.jpg',
  './ex-hanglegraise.jpg','./notif-hlr.jpg','./ex-lsit.jpg','./ex-windshield.jpg','./ex-wallsit.jpg','./ex-heeltouch.jpg','./ex-dragonflag.jpg',
  './ex-kbhalo.jpg','./ex-kbheli.jpg',
  './ex-situp.jpg','./ex-vertcrunch.jpg','./ex-plankleg.jpg','./ex-plankrot.jpg','./ex-ruck.jpg','./ex-shadowbox.jpg',
  './ex-sealjack.jpg','./ex-fastfeet.jpg','./ex-latshuffle.jpg','./ex-plankjack.jpg','./ex-crossclimber.jpg','./ex-sprawl.jpg','./ex-bearcrawl.jpg','./ex-crabwalk.jpg','./ex-inchworm.jpg','./ex-tempopushup.jpg','./ex-hindupushup.jpg','./ex-typewriter.jpg','./ex-pseudoplanche.jpg','./ex-cossack.jpg','./ex-sissysquat.jpg','./ex-slrdl.jpg','./ex-wallwalk.jpg','./ex-swimmer.jpg','./ex-towelrow.jpg','./ex-tablerow.jpg','./ex-fistpushup.jpg','./ex-isoclimber.jpg','./ex-bearhold.jpg','./ex-hollowflutter.jpg','./ex-vsit.jpg','./ex-hiplift.jpg','./ex-sideplankreach.jpg','./ex-situptwist.jpg',
  './phys-1.jpg','./phys-2.jpg','./phys-3.jpg','./phys-4.jpg','./phys-5.jpg',
  './ex-birddog.mp4','./ex-halfburpee.mp4','./ex-burpee.mp4','./ex-jumpsquat.mp4','./ex-nordic.mp4','./ex-atomicpushup.mp4','./ex-kbhalo.mp4','./ex-kbheli.mp4',
  './ex-pistol.mp4','./ex-superpushup.mp4',
  './wu-march.mp4'];

/* The app cannot run without these; everything else is a nice-to-have that must
   never be able to break the install. */
/* Only what the app genuinely cannot run without. The font and the manifest are
   cosmetic — including them made a single failed font fetch abort the atomic
   addAll and leave the app with NO offline cache, which is the exact failure this
   split was meant to remove. They still get cached, just not atomically. */
const CORE = ['./', './index.html'];

/* cache.addAll() is atomic: one 404 anywhere in a 160-entry list rejects the
   whole promise and the app installs with NO offline cache at all. That made
   every added image a release hazard. Core assets are still required, but the
   rest are fetched independently with allSettled, so a single missing file
   costs exactly that one file. */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    const rest = SHELL.filter(u => !CORE.includes(u));
    const results = await Promise.allSettled(rest.map(u => c.add(u)));
    const failed = results.reduce((n, r) => n + (r.status === 'rejected' ? 1 : 0), 0);
    if (failed) console.warn('[sw] ' + failed + ' of ' + rest.length + ' optional assets missing; app still installed');
    await self.skipWaiting();
  })());
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
          // Never overwrite a good offline page with a 500/404 — doing so bricked
          // the app offline and stayed broken after the origin recovered.
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
