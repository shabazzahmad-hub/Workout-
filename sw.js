/* CoreForge — offline service worker */
const CACHE = 'coreforge-v428';
/* Which caches on this origin belong to CoreForge. CacheStorage is shared by
   every app published from the same GitHub Pages origin, so cleanup must match
   on our own name and never enumerate-and-delete everything it finds. */
const MINE = /^coreforge-v\d+$/;

/* ---- Why the precache is in tiers ----------------------------------------
   The install used to await all 191 assets — about 11 MB — inside
   event.waitUntil. Nothing rendered any slower, because the page does not wait
   on the worker, but three real things went wrong:

     - the worker sat in `installing` for the whole download, so skipWaiting()
       and therefore offline capability arrived minutes late on a phone;
     - those 11 MB competed with the page's OWN image fetches during the one
       session where the athlete is actually looking at pictures;
     - closing the tab part-way through aborted the install, and the next visit
       started again from nothing.

   So: install what the app cannot start without, become active immediately,
   then top the rest up in small batches in the background, skipping anything
   already cached — which makes the whole thing resumable for free. Anything the
   athlete reaches before the top-up gets to it is cached on first view by the
   fetch handler anyway.

   Order is deliberate. FIRST_RUN is derived from what a brand-new athlete
   actually sees — the nine baseline tests, every warm-up and cool-down (they
   run in EVERY session), and the first two weeks of a beginner's programme. The
   long tail is stills first and video last, because the thirteen .mp4 files
   are the heaviest and the least necessary things here. */

/* Atomic. If these fail there is no app, so the install SHOULD reject. */
const CORE = ['./', './index.html'];

/* Everything the first screen needs. Cached during install but not atomically:
   a missing font must never cost the athlete the whole offline cache. */
const SHELL_MIN = [
  './manifest.webmanifest','./archivo.woff2','./icon-192-v2.png',
  './hero.jpg','./coach-sarge.jpg',
  './icon-192-maskable.png','./icon-180-apple.png',
  './privacy.html','./terms.html'
];

/* What a new athlete meets in their first fortnight. */
/* What a NEW athlete meets before the background top-up reaches EXTRA: every
   baseline test, every SAFE_SWAP substitute those tests can hand a flagged
   athlete, the warm-up and cool-down, and a beginner's first fortnight.

   This is a FIFTH hand-kept place that has to move when a test is added, and it
   had drifted exactly the way the other four did: Burpees arrived as the tenth
   test in v252 and its photo stayed at the back of a 144-file queue, along with
   three of the five substitutes — so a WRIST- or SHOULDER-flagged athlete, the
   one the app takes the most care with, met more missing photos than an
   unflagged one. Suite 12 now derives the requirement from TESTS, SAFE_SWAP and
   a real beginner's first fourteen sessions rather than trusting this list.

   Moving a file here costs no download: the same pack is fetched either way,
   this only decides what arrives first. */
/* The 512px launcher icon sits at the head of this tier rather than in the
   install tier. It is an INSTALL-time asset — the splash and the store listing
   — not a first-paint one; the 192px icons draw the tab and the home screen.
   Moving it here keeps the install tier under its 2 MB budget as the code
   grows, and costs no download: the same pack is fetched either way, and this
   tier is topped up in batches of six the moment the worker activates.

   Keep prose OUT of the array itself. These lists are parsed by pulling every
   quoted string between the brackets, so one apostrophe in a comment inside
   them opens a quote and swallows the whole tier. */
const FIRST_RUN = [
  './icon-512-maskable.png',   // the OS launcher wants it after install, not for the first paint
  './icon-512-v2.png',
  './cd-breathing.jpg','./cd-catcow.jpg','./cd-childs.jpg','./cd-cobra.jpg',
  './cd-knees.jpg','./cd-twistleft.jpg','./cd-twistright.jpg','./ex-bicycle.jpg',
  './ex-burpee.jpg','./ex-buttkick.jpg','./ex-crunch.jpg','./ex-deadbug.jpg',
  './ex-fistpushup.jpg','./ex-glutebridge.jpg','./ex-heeltouch.jpg','./ex-hollow.jpg',
  './ex-inchworm.jpg','./ex-invertedrow.jpg','./ex-jumpingjack.jpg','./ex-jumpsquat.jpg',
  './ex-kneekick.jpg','./ex-kneeplank.jpg','./ex-kneepushup.jpg','./ex-kneeside.jpg',
  './ex-legraise.jpg','./ex-marchplace.jpg','./ex-mountainclimber.jpg','./ex-plank.jpg',
  './ex-pushup.jpg','./ex-quickpunch.jpg','./ex-revcrunch.jpg','./ex-sealjack.jpg',
  './ex-sideplank.jpg','./ex-situp.jpg','./ex-squat.jpg','./ex-squatthrust.jpg',
  './ex-swimmer.jpg','./ex-toetouch.jpg','./ex-towelrow.jpg','./ex-tuckhollow.jpg',
  './ex-wallsit.jpg','./wu-armcircles.jpg','./wu-birddog.jpg','./wu-catcow.jpg',
  './wu-glutebridge.jpg','./wu-hipcircles.jpg','./wu-kneehug.jpg','./wu-march.jpg',
  './wu-torsotwist.jpg'
];

/* The other 144. Stills, then video. The three screenshot-*.png files at the
   end are only ever read by the browser's OWN install-prompt UI, never
   fetched by the running app — least essential, hence EXTRA. */
const EXTRA = [
  './ex-abroll.jpg','./ex-abrollstand.jpg','./ex-archerpushup.jpg','./ex-asiansquat.jpg',
  './ex-atomicpushup.jpg','./ex-bearcrawl.jpg','./ex-bearhold.jpg','./ex-benchdip.jpg',
  './ex-bike.jpg','./ex-birddog.jpg','./ex-boxpistol.jpg','./ex-broadjump.jpg',
  './ex-bulgarian.jpg','./ex-btbalance.jpg','./ex-btpushup.jpg','./ex-btsideplank.jpg',
  './ex-btsquat.jpg','./ex-ruckstepup.jpg','./ex-rucksquat.jpg','./ex-ruckgm.jpg',
  './ex-ruckcarry.jpg','./ex-sbaglift.jpg','./ex-sbagshuttle.jpg','./ex-rushes.jpg',
  './ex-sbagdrag.jpg','./ex-burpeetuck.jpg','./ex-count8.jpg','./ex-calfraise.jpg',
  './ex-chinup.jpg','./ex-closepushup.jpg','./ex-copenhagen.jpg','./ex-cossack.jpg',
  './ex-crabwalk.jpg','./ex-crossclimber.jpg','./ex-dbbench.jpg','./ex-dbcarry.jpg',
  './ex-dbcp.jpg','./ex-dbcurl.jpg','./ex-dbdevil.jpg','./ex-dbfloor.jpg',
  './ex-dbgoblet.jpg','./ex-dblunge.jpg','./ex-dbmanmaker.jpg','./ex-dbpress.jpg',
  './ex-dbrdl.jpg','./ex-dbrenegade.jpg','./ex-dbrow.jpg','./ex-dbthruster.jpg',
  './ex-dbtwist.jpg','./ex-dbpallof.jpg','./ex-deadhang.jpg','./ex-declinepushup.jpg',
  './ex-diamondpushup.jpg','./ex-dipknee.jpg','./ex-dips.jpg','./ex-dragonflag.jpg',
  './ex-dragonflagfull.jpg','./ex-elevatedpike.jpg','./ex-extplank.jpg','./ex-fastfeet.jpg',
  './ex-flutter.jpg','./ex-halfburpee.jpg','./ex-hanglegraise.jpg','./ex-highknees.jpg',
  './ex-hindupushup.jpg','./ex-hiplift.jpg','./ex-hipthrust.jpg','./ex-hollowflutter.jpg',
  './ex-hollowrock.jpg','./ex-hspushup.jpg','./ex-inclinepushup.jpg','./ex-invertedrowelev.jpg',
  './ex-isoclimber.jpg','./ex-kbcarry.jpg','./ex-kbcp.jpg','./ex-kbgoblet.jpg',
  './ex-kbhalo.jpg','./ex-kbheli.jpg','./ex-kblunge.jpg','./ex-kbrdl.jpg',
  './ex-kbrow.jpg','./ex-kbsnatch.jpg','./ex-kbswing.jpg','./ex-kbtgu.jpg',
  './ex-kbthruster.jpg','./ex-kbwindmill.jpg','./ex-kbsuitcase.jpg','./ex-kbfigure8.jpg',
  './ex-kbrenegade.jpg','./ex-kbhighpull.jpg','./ex-kneeraise.jpg','./ex-kneetoelbow.jpg',
  './ex-latshuffle.jpg','./ex-legcircle.jpg','./ex-longplank.jpg','./ex-lsit.jpg',
  './ex-march.jpg','./ex-mbsitup.jpg','./ex-mbslam.jpg','./ex-mbtwist.jpg',
  './ex-mbchop.jpg','./ex-negpullup.jpg','./ex-nordic.jpg','./ex-pikepushup.jpg',
  './ex-pistol.jpg','./ex-plegraise.jpg','./ex-ppushup.jpg','./ex-tucklsit.jpg',
  './ex-plankjack.jpg','./ex-plankleg.jpg','./ex-plankrot.jpg','./ex-planktap.jpg',
  './ex-pseudoplanche.jpg','./ex-pullup.jpg','./ex-reverselunge.jpg','./ex-reverseplank.jpg',
  './ex-ropeslam.jpg','./ex-ropewave.jpg','./ex-ropeplank.jpg','./ex-ruck.jpg',
  './ex-russiantwist.jpg','./ex-sbhamcurl.jpg','./ex-sbrollout.jpg','./ex-sbstir.jpg',
  './ex-scappull.jpg','./ex-scissors.jpg','./ex-seatedtwist.jpg','./ex-shadowbox.jpg',
  './ex-sidedip.jpg','./ex-sideplankreach.jpg','./ex-singlebridge.jpg','./ex-singlecalf.jpg',
  './ex-sissysquat.jpg','./ex-sitthrust.jpg','./ex-situptwist.jpg','./ex-skater.jpg',
  './ex-skaterground.jpg','./ex-skip.jpg','./ex-slrdl.jpg','./ex-spidermanpushup.jpg',
  './ex-splitjump.jpg','./ex-splitsquat.jpg','./ex-sprawl.jpg','./ex-sprint.jpg',
  './ex-squatjack.jpg','./ex-standingoblique.jpg','./ex-superman.jpg','./ex-superpushup.jpg',
  './ex-tablerow.jpg','./ex-tempopushup.jpg','./ex-tuckjump.jpg',
  './ex-tuckvup.jpg','./ex-typewriter.jpg','./ex-vertcrunch.jpg','./ex-vsit.jpg',
  './ex-vup.jpg','./ex-walkinglunge.jpg','./ex-wallhandstand.jpg','./ex-wallwalk.jpg',
  './ex-warriorthree.jpg','./ex-weightedtwist.jpg','./ex-widepullup.jpg','./ex-windshield.jpg',
  './notif-hlr.jpg','./phys-1.jpg','./phys-2.jpg','./phys-3.jpg',
  './phys-4.jpg','./phys-5.jpg','./screenshot-today.png','./screenshot-fuel.png',
  './screenshot-progress.png','./ex-atomicpushup.mp4','./ex-birddog.mp4','./ex-burpee.mp4',
  './ex-squatthrust.mp4','./ex-inchworm.mp4','./ex-cossack.mp4','./ex-abroll.mp4',
  './ex-halfburpee.mp4','./ex-jumpingjack.mp4','./ex-jumpsquat.mp4','./ex-kbhalo.mp4',
  './ex-kbheli.mp4','./ex-kbtgu.mp4','./ex-nordic.mp4','./ex-pistol.mp4',
  './ex-superpushup.mp4','./wu-march.mp4'
];

/* The union, and still the single source of truth for "what ships offline". */
const SHELL = [...CORE, ...SHELL_MIN, ...FIRST_RUN, ...EXTRA];

/* Small batches with a breath between them. Six at a time is enough to keep a
   connection busy without monopolising it, and the pause hands bandwidth back
   to whatever the athlete is actually doing. */
const BATCH = 6;
const PAUSE_MS = 250;
const SETTLE_MS = 3000;   // let the page finish its own loading first

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tellClients(msg) {
  const cs = await self.clients.matchAll({ includeUncontrolled: true });
  cs.forEach(c => { try { c.postMessage(msg); } catch (e) {} });
}

let topUpRunning = false;

/* Resumable by construction: a URL already in the cache is skipped, so a
   worker killed half-way simply carries on from where it stopped next time. */
async function topUp(force) {
  if (topUpRunning) return;
  topUpRunning = true;
  try {
    /* Respect an explicit data-saver. The app still works — everything is
       fetched on demand and cached on first view — it just does not pull 9 MB
       down uninvited on somebody's metered connection. */
    const saveData = !!(self.navigator && self.navigator.connection && self.navigator.connection.saveData);
    if (saveData && !force) {
      await tellClients({ type: 'cf-precache', phase: 'skipped-savedata' });
      return;
    }
    await sleep(SETTLE_MS);
    const c = await caches.open(CACHE);
    /* SHELL_MIN is in here too, and first. It installs via Promise.allSettled,
       whose rejections are logged and then dropped — so anything that failed at
       install (the brand font, every icon, the manifest, privacy.html) was
       missing from the offline pack FOREVER, because the only retry mechanism
       in the worker never looked at that tier. Every entry is skip-if-cached,
       so a clean install pays one cache lookup each and nothing more. */
    const queue = [...SHELL_MIN, ...FIRST_RUN, ...EXTRA];
    const pending = [];
    for (const u of queue) if (!(await c.match(u))) pending.push(u);
    const total = queue.length;
    let done = total - pending.length;
    if (!pending.length) {
      await tellClients({ type: 'cf-precache', phase: 'complete', done: total, total });
      return;
    }
    await tellClients({ type: 'cf-precache', phase: 'start', done, total });
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      const res = await Promise.allSettled(batch.map(u => c.add(u)));
      done += res.length;
      const failed = res.filter(x => x.status === 'rejected').length;
      if (failed) console.warn('[sw] ' + failed + ' asset(s) in this batch failed; continuing');
      await tellClients({ type: 'cf-precache', phase: 'progress', done, total });
      if (i + BATCH < pending.length) await sleep(PAUSE_MS);
    }
    await tellClients({ type: 'cf-precache', phase: 'complete', done: total, total });
  } catch (e) {
    console.warn('[sw] top-up stopped: ' + e);
    await tellClients({ type: 'cf-precache', phase: 'error' });
  } finally {
    topUpRunning = false;
  }
}

/* Install is now small and quick: the shell only. cache.addAll() is still
   atomic for CORE — one 404 there means a broken app and the install should
   fail — while SHELL_MIN goes through allSettled so a single missing icon costs
   exactly that icon. */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    const res = await Promise.allSettled(SHELL_MIN.map(u => c.add(u)));
    const failed = res.filter(x => x.status === 'rejected').length;
    if (failed) console.warn('[sw] ' + failed + ' of ' + SHELL_MIN.length + ' shell assets missing; app still installed');
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    /* Delete only OUR OWN old versions. CacheStorage is scoped to the ORIGIN,
       not to the scope this worker was registered under, so
       `keys.filter(k => k !== CACHE)` reached every other app published from
       the same GitHub Pages origin — including the Command app under
       /command/ — and wiped its offline pack on every CoreForge update. The
       victim only finds out when they open it on a train with no signal.
       `refreshCacheVer()` in the page already matches on this exact prefix. */
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => MINE.test(k) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    /* NOT started here. Activation must finish promptly — the page waits on it
       — and a top-up detached from activate is unpinned and gets terminated
       when the worker next idles. The page asks for it instead, on load, which
       both keeps the worker alive and retries on every visit. */
  })());
});

self.addEventListener('message', e => {
  const d = e.data || {};
  /* waitUntil, deliberately. A worker with nothing in flight can be terminated
     at any moment, and a detached top-up dies with it — so the download is
     driven by a message from an OPEN PAGE and pinned to its lifetime. The page
     re-sends this on every load, which is what makes a part-finished pack
     finish eventually rather than restarting forever. */
  if (d.type === 'cf-topup') e.waitUntil(topUp(!!d.force));
  if (d.type === 'cf-precache-status') {
    // Same reasoning as cf-topup, two lines up: this loop awaits ~180 sequential
    // cache lookups, and a worker with nothing pinning it can be reclaimed
    // mid-loop — the requesting page would then wait forever for a reply.
    e.waitUntil((async () => {
      const c = await caches.open(CACHE);
      const queue = [...SHELL_MIN, ...FIRST_RUN, ...EXTRA];   // must match topUp()'s queue
      let have = 0;
      for (const u of queue) if (await c.match(u)) have++;
      const src = e.source || null;
      const msg = { type: 'cf-precache', phase: have >= queue.length ? 'complete' : 'idle', done: have, total: queue.length };
      if (src && src.postMessage) src.postMessage(msg); else tellClients(msg);
    })());
  }
});

/* OUR assets are flat files in OUR scope directory, and the test for that has to
   name the directory rather than measure how long it is. The old rule compared
   the POSITION of the final slash in the path against the length of the scope,
   which asks WHERE the last slash sits — a statement about how many characters
   another app's folder name has, not about whose folder it is. Measured against
   scope '/Workout-/': '/Fitness2/a.jpg' and '/commandx/a.jpg' both read as OURS,
   because those directory names are the same length. So a sibling app published
   from this same GitHub Pages origin was served from our cache and written into
   it — exactly what the comment above says this guard prevents, arriving through
   the guard itself.

   Two halves, and both are needed: the path must START in our directory, and it
   must have no further slash after it, because a deeper path is another app's.
   The test is a predicate with a name so the handler asks it rather than
   restating it — a rule restated at a call site is a rule that drifts. */
function inScopeDir(pathname, scope) {
  return pathname.startsWith(scope) && pathname.indexOf('/', scope.length) === -1;
}

/* Network-first for the app page (so updates arrive), cache fallback for offline.
   Cache-first for static assets (icons/manifest/images). */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  /* CacheStorage is scoped to the ORIGIN, and so is this worker's reach — the
     same fact that made `caches.keys()` delete the sibling app's offline pack.
     Pointed the other way it is worse: `req.mode === 'navigate'` is true for
     EVERY same-origin navigation, so opening the Command app published from
     this same GitHub Pages origin wrote ITS page into `./index.html`, and
     CoreForge then served that other app offline — measured, 1,050,064 bytes
     of CoreForge replaced by 286,583 bytes of Command. Its images landed in
     our cache through the static branch below by the same route.

     Identify our OWN shell and our OWN directory explicitly. Anything else on
     the origin is somebody else's app: do not serve it, do not cache it, let
     the browser fetch it exactly as if this worker did not exist. */
  const SCOPE = new URL(self.registration.scope).pathname;
  const isOurShell = url.pathname === SCOPE || url.pathname === SCOPE + 'index.html';
  const inOurDir = inScopeDir(url.pathname, SCOPE);
  const isNav = req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');
  if (isNav && !isOurShell) return;
  if (!isNav && !inOurDir) return;

  if (isOurShell) {
    /* Network-first, but RACED against the cache on a 2.5 s timer.
       Plain network-first only reaches the cache once the fetch REJECTS, so a
       connection that associates and then hangs — gym wifi that does not route,
       a dead hotspot, an LTE handover in a stairwell — left the athlete on the
       splash for as long as the TCP timeout took. Measured: airplane mode was
       usable in 115 ms, a hanging server took 26 seconds. Airplane mode was the
       better experience, which is the wrong way round.

       The fetch is still allowed to finish and refresh the cache either way, so
       a slow network costs one stale load, not a stale install. */
    e.respondWith(
      Promise.race([
        fetch(req)
          .then(async res => {
            // Never overwrite a good offline page with a 500/404 — doing so bricked
            // the app offline and stayed broken after the origin recovered.
            if (res && res.ok) {
              const copy = res.clone();
              // Best-effort refresh of the cached shell — a quota/storage failure here
              // must not surface as an unhandled rejection inside the worker.
              caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
              return res;
            }
            /* Refusing to CACHE the bad response was only half the job — it was
               still handed to the browser, so a transient 500 or a Pages deploy
               blip showed an error page to someone holding a phone with a
               perfectly good copy of the app already on it. A non-ok navigation
               is a failed navigation: fall back exactly as if the fetch threw,
               and only surface the error when there is nothing cached. */
            const hit = await caches.match('./index.html');
            return hit || res;
          }),
        new Promise(resolve => setTimeout(() => {
          caches.match('./index.html').then(hit => { if (hit) resolve(hit); });
        }, 2500)),
      ]).catch(() => caches.match('./index.html'))
    );
    return;
  }
  /* Cache-first, and a miss is cached on the way through — which is what makes
     it safe for the top-up to still be running: whatever the athlete opens
     first is saved whether or not the background job has reached it yet. */
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        // Same best-effort catch as the navigation path above — an opaque/redirected
        // response or a full quota can legitimately reject c.put(); that must stay
        // a silent no-op (the asset just isn't cached this time), not an unhandled
        // rejection.
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => undefined))
    // A miss that then fails to fetch (offline, DNS failure) rejected with
    // nothing to catch it — an unhandled rejection inside the worker instead
    // of a graceful failure. Resolving to undefined here lets the browser
    // handle the missing asset exactly as it already does for anything else
    // that comes back empty (e.g. an <img onerror> fallback), rather than an
    // unhandled promise rejection surfacing as a broken/blocked request.
  );
});
