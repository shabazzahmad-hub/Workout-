/* Suite 12 — the tiered precache.

   The install used to await all 191 assets (~11 MB) inside waitUntil, so the
   worker stayed in `installing` for the whole download and offline capability
   arrived minutes late on a phone. These checks are about BYTES AND TIMING, not
   about whether the code looks right: the only thing that matters is how much
   the athlete waits for before the app can work offline. */
import { serve, suite, ROOT } from './lib/harness.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export default async function run() {
  const t = suite('tiered precache');
  const { srv, port } = await serve();
  const base = `http://127.0.0.1:${port}/`;

  /* ---- the tiers partition the shell: nothing lost, nothing duplicated ---- */
  {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const grab = name => {
      const m = new RegExp('const ' + name + ' = \\[(.*?)\\];', 's').exec(sw);
      return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null;
    };
    const CORE = grab('CORE'), MIN = grab('SHELL_MIN'), FIRST = grab('FIRST_RUN'), EXTRA = grab('EXTRA');
    t.ok('every tier is present in sw.js', !!(CORE && MIN && FIRST && EXTRA),
      { CORE: !!CORE, MIN: !!MIN, FIRST: !!FIRST, EXTRA: !!EXTRA });
    const all = [...CORE, ...MIN, ...FIRST, ...EXTRA];
    const dupes = all.filter((u, i) => all.indexOf(u) !== i);
    t.eq('no asset appears in two tiers', dupes, []);

    const onDisk = fs.readdirSync(ROOT).filter(f => /\.(jpg|mp4|png|woff2|webmanifest)$/.test(f)).map(f => './' + f);
    const missing = onDisk.filter(u => !all.includes(u));
    t.eq('every shipped asset is in some tier', missing, []);
    const ghosts = all.filter(u => u !== './' && u !== './index.html' && !fs.existsSync(path.join(ROOT, u.slice(2))));
    t.eq('no tier references a file that does not exist', ghosts, []);

    /* The point of the split: what the install blocks on has to be small. */
    const bytes = list => list.filter(u => u !== './').reduce((n, u) => {
      const f = path.join(ROOT, u.slice(2));
      return n + (fs.existsSync(f) ? fs.statSync(f).size : 0);
    }, 0);
    const installKB = Math.round(bytes([...CORE, ...MIN]) / 1024);
    const totalMB = +(bytes(all) / 1024 / 1024).toFixed(1);
    t.ok('the install tier is under 2 MB', installKB < 2048, { installKB, totalMB });
    t.ok('and is a small fraction of the whole', installKB / 1024 < totalMB * 0.25, { installKB, totalMB });
    t.ok('the deferred tail is the bulk of it', bytes(EXTRA) > bytes([...CORE, ...MIN]) * 2,
      { extraKB: Math.round(bytes(EXTRA) / 1024), installKB });
    /* Video is heaviest and least necessary, so it is topped up last. This used
       to be "within the last 20 entries", which is a magic number that drifts:
       adding a 17th clip pushed the FIRST video out of the window and the check
       went red on a correct change. Express the RULE instead — nothing that is
       not a video may follow a video — and it cannot drift as clips are added. */
    const firstVid = EXTRA.findIndex(u => u.endsWith('.mp4'));
    const afterFirstVid = firstVid < 0 ? [] : EXTRA.slice(firstVid).filter(u => !u.endsWith('.mp4'));
    t.ok('guard: there are videos in the tail to order', firstVid >= 0, { firstVid });
    t.eq('nothing but video follows the first video', afterFirstVid, [], EXTRA.slice(-6));
    /* The floor: "last" must still mean the END of the tail, not a video-only
       list that some other tier quietly precedes. */
    t.ok('and the videos really are at the end of the tail',
      EXTRA[EXTRA.length - 1].endsWith('.mp4'), EXTRA.slice(-3));
    t.ok('the first-run tier covers the baseline tests and the flows',
      FIRST.includes('./ex-plank.jpg') && FIRST.includes('./wu-march.jpg') && FIRST.includes('./cd-childs.jpg'),
      FIRST.slice(0, 6));

    /* ---- fire-and-forget cache.put() calls must not become unhandled
       rejections — a quota failure or an opaque/redirected response cache.put
       legitimately rejects on must stay a silent no-op inside the worker, not
       a rejection with nothing watching it. Static, not behavioural: there is
       no reliable way to force a real quota-exceeded from this harness, so this
       checks the SOURCE carries the guard rather than observing its effect. */
    /* Anchored on the real call shape (`c => c.put(`), not just `c.put(` — a
       bare substring match also hits an unrelated code COMMENT that mentions
       "c.put()" in prose, which has no .catch() to find and would false-fail. */
    const putSites = [...sw.matchAll(/c => c\.put\([^)]*\)([^;]*);/g)].map(m => m[0]);
    t.eq('exactly the two known cache.put() call sites are present', putSites.length, 2, putSites);
    const uncaught = putSites.filter(s => !/\.catch\(/.test(s));
    t.eq('every cache.put() chain has a .catch()', uncaught, []);
  }

  /* ---- the page's own serviceWorker.register() must not leave an unhandled
     rejection either — the outer try/catch only guards the SYNCHRONOUS call to
     register(), not a rejection of the promise it returns (private-browsing
     storage restrictions, a corrupted prior registration). Plain string search
     rather than a regex: the arrow function body has its own parens, which a
     naive [^)]* can't span. */
  {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const openIdx = html.indexOf("navigator.serviceWorker.register('sw.js').then(reg=>{");
    t.ok('the register().then() chain is found', openIdx >= 0, openIdx);
    const closeIdx = html.indexOf('\n  })', openIdx);
    t.ok('its closing brace is found', closeIdx >= 0, closeIdx);
    const tail = html.slice(closeIdx, closeIdx + 40);
    t.ok('and it ends in a .catch(), not just the outer try/catch', tail.includes('.catch('), tail);
  }

  /* ---- selfUpdate()'s own network call must be bounded too — it's the one
     remaining unbounded fetch after fetchWithTimeout() was introduced for the
     others (offSearch/offBarcode/_geminiCall). Static, not behavioural: this
     already has live behavioural coverage of fetchWithTimeout() itself via the
     hung-route check in 20-diet.test.mjs; this just confirms selfUpdate()
     actually calls it instead of a bare fetch. */
  {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const fnIdx = html.indexOf('async function selfUpdate()');
    t.ok('selfUpdate() is found', fnIdx >= 0, fnIdx);
    const bodyEnd = html.indexOf('\n}', fnIdx);
    const body = html.slice(fnIdx, bodyEnd);
    t.ok('it calls fetchWithTimeout, not a bare fetch', body.includes('fetchWithTimeout('), body.slice(0, 200));

    /* _sessionLive() was only checked once, at entry — several awaits and up
       to ~6.4s before the reload actually fires (the fetch alone allows up to
       6s). An athlete who started a set in that window still got yanked out.
       The entry check alone would make this assertion trivially true even on
       the buggy version, so this has to find _sessionLive() specifically
       inside the reload's own scheduling, not just anywhere in the function. */
    const reloadIdx = body.indexOf('location.reload()');
    t.ok('selfUpdate() schedules a reload', reloadIdx >= 0, reloadIdx);
    const justBefore = body.slice(Math.max(0, reloadIdx - 120), reloadIdx);
    t.ok('and re-checks _sessionLive() immediately before firing it, not only at entry', justBefore.includes('_sessionLive()'), justBefore);
  }

  /* ---- the cache-first static-asset fetch(req) must not leave an unhandled
     rejection either — the write side (c.put right next to it) already has a
     .catch(); the READ side didn't: caches.match(req).then(hit=>hit||fetch(req)...)
     rejected with nothing to catch it when an uncached asset's own network
     fetch fails outright (offline, DNS failure). Static, not behavioural, for
     the same reason as the cache.put()/register() checks above: there is no
     reliable way to force a genuine network-level (not HTTP-level) failure
     from this harness — a 500 response RESOLVES fetch() with res.ok===false
     (already handled without this fix), only a real connection failure
     REJECTS it, and this harness's fault injection only fakes HTTP status
     codes, not connection-level failures. */
  {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const openIdx = sw.indexOf('caches.match(req).then(hit => hit || fetch(req).then(res => {');
    t.ok('the cache-first static-asset fetch chain is found', openIdx >= 0, openIdx);
    const closeIdx = sw.indexOf('}).catch(() => undefined))', openIdx);
    t.ok('and fetch(req) itself ends in a .catch(), not left to reject unhandled',
      closeIdx >= 0 && closeIdx - openIdx < 800, { openIdx, closeIdx });
  }

  /* ---- cf-precache-status must be pinned with waitUntil, same as cf-topup
     right above it — an idle worker with nothing pinning it can be reclaimed
     mid-loop, and the requesting page would wait forever for a reply that
     never comes. Static: there is no reliable way to force the browser to
     reclaim a worker mid-task from this harness. */
  {
    const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const openIdx = swSrc.indexOf("d.type === 'cf-precache-status'");
    t.ok('the cf-precache-status branch is found', openIdx >= 0, openIdx);
    const after = swSrc.slice(openIdx, openIdx + 400);
    t.ok('its body is wrapped in e.waitUntil(', after.includes('e.waitUntil('), after);
  }

  /* ---- the worker activates without waiting for the tail ----------------- */
  const ctx = await chromium.launchPersistentContext('', { serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  const asked = [];
  page.on('request', r => { const u = new URL(r.url()); if (/\.(jpg|mp4|png|woff2)$/.test(u.pathname)) asked.push(u.pathname); });

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  /* `ready` resolves as soon as there IS an active worker, which can still be
     in the 'activating' state — a first pass asserted on that and failed on a
     race, not on a defect. Wait for the state itself. */
  const activatedIn = await page.evaluate(async () => {
    const t0 = performance.now();
    const reg = await navigator.serviceWorker.ready;
    const w = reg.active;
    if (w && w.state !== 'activated') {
      await new Promise(res => {
        const h = () => { if (w.state === 'activated') { w.removeEventListener('statechange', h); res(); } };
        w.addEventListener('statechange', h);
        setTimeout(res, 20000);
      });
    }
    return { ms: Math.round(performance.now() - t0), state: w ? w.state : null };
  });
  t.ok('the worker reaches "activated"', activatedIn.state === 'activated', activatedIn);
  t.ok('it activates in seconds, not after the whole library', activatedIn.ms < 20000, activatedIn);

  /* How much had it pulled by the time it was usable? The page itself requests
     images for the screen it is showing, so this is not zero — it just must not
     be the whole 191. */
  const atActivation = await page.evaluate(async () => {
    const c = await caches.open((await caches.keys()).find(k => k.startsWith('coreforge-')) || '');
    return (await c.keys()).length;
  });
  t.ok('the cache at activation holds the shell, not the library',
    atActivation < 60, { cachedAtActivation: atActivation });

  /* ---- ...and then quietly finishes the job ------------------------------ */
  const finished = await page.evaluate(() => new Promise(resolve => {
    let last = null;
    const done = d => resolve(d);
    navigator.serviceWorker.addEventListener('message', ev => {
      const d = ev.data || {};
      if (d.type !== 'cf-precache') return;
      last = d;
      if (d.phase === 'complete') done(d);
    });
    navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage({ type: 'cf-topup', force: true });
    setTimeout(() => resolve(last || { phase: 'timeout' }), 90000);
  }));
  t.ok('the background top-up reports completion', finished.phase === 'complete', finished);

  const after = await page.evaluate(async () => {
    const key = (await caches.keys()).find(k => k.startsWith('coreforge-'));
    const c = await caches.open(key);
    const keys = await c.keys();
    return { count: keys.length, key };
  });
  t.ok('everything ends up cached', after.count >= 185, after);
  t.ok('and it grew well past what the install held', after.count > atActivation + 100,
    { atActivation, after: after.count });

  /* ---- it resumes rather than starting over ------------------------------ */
  const resumed = await page.evaluate(async () => {
    const key = (await caches.keys()).find(k => k.startsWith('coreforge-'));
    const c = await caches.open(key);
    // evict a handful, as an eviction or an aborted install would
    const victims = ['./ex-burpee.jpg', './ex-pullup.jpg', './ex-dips.jpg', './ex-lsit.jpg'];
    for (const v of victims) await c.delete(v);
    const before = (await c.keys()).length;
    const status = await new Promise(res => {
      const h = ev => { const d = ev.data || {};
        if (d.type === 'cf-precache' && d.phase === 'complete') { navigator.serviceWorker.removeEventListener('message', h); res(d); } };
      navigator.serviceWorker.addEventListener('message', h);
      navigator.serviceWorker.controller.postMessage({ type: 'cf-topup', force: true });
      setTimeout(() => res({ phase: 'timeout' }), 60000);
    });
    const restored = [];
    for (const v of victims) restored.push(!!(await c.match(v)));
    return { before, status: status.phase, restored, after: (await c.keys()).length };
  });
  t.ok('a second run completes', resumed.status === 'complete', resumed);
  t.ok('evicted assets are re-fetched', resumed.restored.every(Boolean), resumed);

  /* Proving they come back is not the same as proving it SKIPS what it has —
     a top-up that blindly re-downloads all 183 every time also restores the
     four, and that mutant survived the check above. With the pack already
     complete a run must do no work at all: no 'start', no 'progress', just an
     immediate 'complete'. */
  const noWork = await page.evaluate(() => new Promise(resolve => {
    const seen = [];
    const h = ev => {
      const d = ev.data || {};
      if (d.type !== 'cf-precache') return;
      seen.push(d.phase);
      if (d.phase === 'complete') {
        navigator.serviceWorker.removeEventListener('message', h);
        resolve({ seen, progressed: seen.filter(x => x === 'progress').length, started: seen.includes('start') });
      }
    };
    navigator.serviceWorker.addEventListener('message', h);
    navigator.serviceWorker.controller.postMessage({ type: 'cf-topup', force: true });
    setTimeout(() => resolve({ seen, timedOut: true }), 60000);
  }));
  t.ok('a full pack reports complete without re-fetching', !noWork.timedOut && noWork.progressed === 0, noWork);
  t.ok('and does not even announce a start', noWork.started === false, noWork);

  /* ---- an asset the tail has not reached is still cached on first view --- */
  const onDemand = await page.evaluate(async () => {
    const key = (await caches.keys()).find(k => k.startsWith('coreforge-'));
    const c = await caches.open(key);
    await c.delete('./ex-cossack.jpg');
    const gone = !(await c.match('./ex-cossack.jpg'));
    await fetch('./ex-cossack.jpg');            // exactly what an <img> would do
    await new Promise(r => setTimeout(r, 500));
    return { gone, cachedAfterView: !!(await c.match('./ex-cossack.jpg')) };
  });
  t.ok('an uncached image is genuinely missing first', onDemand.gone, onDemand);
  t.ok('viewing it caches it, top-up or no top-up', onDemand.cachedAfterView, onDemand);

  /* ---- and the app still works with the network gone --------------------- */
  await ctx.setOffline(true);
  let offlineOk = true, detail = null;
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => { const v = document.querySelector('.view.active'); return !!v && v.innerHTML.length > 400; }, null, { timeout: 15000 });
  } catch (e) { offlineOk = false; detail = String(e).slice(0, 160); }
  t.ok('the app cold-starts offline once the pack is down', offlineOk, detail);
  if (offlineOk) {
    const broken = await page.evaluate(async () => {
      await new Promise(r => setTimeout(r, 600));
      return [...document.querySelectorAll('img')].filter(i => i.offsetParent !== null && i.complete && i.naturalWidth === 0).length;
    });
    t.eq('with no broken images', broken, 0);
  }
  /* Back online before the blocks below. Both need the network — one registers
     a new script URL to force a real activate, the other needs the origin to
     answer with a 500 — and the offline section above leaves the context
     disconnected. CI caught this and the local run did not: the offline read
     was served from cache locally, so the registration only failed on a clean
     runner. */
  await ctx.setOffline(false);

  /* ---- the worker cleans up after ITSELF, and nobody else ----------------
     CacheStorage is scoped to the ORIGIN, not to the scope the worker was
     registered under. `keys.filter(k => k !== CACHE)` therefore reached every
     other app published from the same GitHub Pages origin — the Command app
     under /command/ shares shabazzahmad-hub.github.io — and deleted its
     offline pack every time CoreForge updated. Seed both a stale CoreForge
     cache and a foreign one, then let activation run. */
  {
    const survivors = await page.evaluate(async () => {
      await caches.open('coreforge-v1');            // our own, stale
      await caches.open('command-v3');              // another app on this origin
      await caches.open('workbox-precache-v2');     // something else entirely
      /* Forcing a genuine activate is the whole difficulty here. update() on a
         byte-identical sw.js installs nothing, and unregister() does not stop
         the worker while a client is still controlled — both left the ORIGINAL
         activation (which happened before these caches existed) as the thing
         being measured, so the check passed on nothing. Registering a distinct
         script URL is a new registration: install and activate really run. */
      const reg = await navigator.serviceWorker.register('./sw.js?probe=1');
      const w = reg.installing || reg.waiting || reg.active;
      if (w && w.state !== 'activated') {
        await new Promise(res => {
          const h = () => { if (w.state === 'activated') { w.removeEventListener('statechange', h); res(); } };
          w.addEventListener('statechange', h); setTimeout(res, 8000);
        });
      }
      await new Promise(z => setTimeout(z, 600));
      return (await caches.keys()).sort();
    });
    t.ok('a foreign app cache is left alone', survivors.includes('command-v3'), survivors);
    t.ok('and so is an unrelated one', survivors.includes('workbox-precache-v2'), survivors);
    t.ok('while our own stale version is cleaned up', !survivors.includes('coreforge-v1'), survivors);
    t.ok('and the live CoreForge cache is still there',
      survivors.some(k => /^coreforge-v\d+$/.test(k)), survivors);
  }

  /* ---- another app on the same origin is not OUR shell -------------------
     CacheStorage and this worker's reach are scoped to the ORIGIN, which is the
     same fact behind the documented caches.keys() bug — pointed the other way.
     `req.mode === 'navigate'` is true for EVERY same-origin navigation, so
     opening a sibling app published from the same GitHub Pages origin wrote ITS
     page into './index.html', and CoreForge then served that other app offline.

     Forced with a real page that is not our shell rather than a fabricated one:
     under the old rule a navigation to /privacy.html was "a page", so the cached
     shell was overwritten with it. The assertion reads the CACHED BYTES back,
     not the rule that produced them. */
  {
    const ctx = await chromium.launchPersistentContext('', { serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.goto(base, { waitUntil: 'domcontentloaded' });
    await pg.evaluate(() => navigator.serviceWorker.ready);
    await pg.waitForTimeout(600);

    const before = await pg.evaluate(async () => {
      const hit = await caches.match('./index.html');
      return hit ? (await hit.text()).length : 0;
    });

    // A same-origin navigation to a page that is NOT the app shell.
    await pg.goto(base + 'privacy.html', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(600);
    await pg.goto(base + 'terms.html', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(400);

    const after = await pg.evaluate(async () => {
      // Absolute, so it cannot resolve relative to whatever page is open.
      const hit = await caches.match(new URL('/index.html', location.origin).href);
      const body = hit ? await hit.text() : '';
      return { len: body.length, isCoreForge: /APP_VERSION\s*=/.test(body) };
    });
    await ctx.close();

    // Guard: the shell really was cached before the sibling navigation.
    t.ok('guard: our own shell was cached to begin with', before > 100000, { before });
    t.ok('a sibling page does not replace the cached CoreForge shell', after.isCoreForge, after);
    t.eq('and the cached shell is byte-for-byte the same size', after.len, before, { before, after });
  }

  /* ---- SHELL_MIN is topped up, not installed once and abandoned ----------
     It went in only at install, through Promise.allSettled, whose rejections
     were logged and dropped — and the top-up queue never looked at that tier.
     So a font or an icon that failed at install was missing from the offline
     pack forever. Read off the real queue expression, since the failure is a
     tier being absent from it. */
  {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const queues = [...sw.matchAll(/const queue = \[([^\]]+)\]/g)].map(m => m[1]);
    t.ok('guard: both top-up queues were found', queues.length === 2, queues);
    queues.forEach((q, i) => {
      t.ok(`queue ${i + 1} tops up SHELL_MIN`, /\.\.\.SHELL_MIN/.test(q), q);
      t.ok(`queue ${i + 1} still tops up FIRST_RUN and EXTRA`,
        /\.\.\.FIRST_RUN/.test(q) && /\.\.\.EXTRA/.test(q), q);
    });
  }

  /* ---- a server error must not beat a cached page ------------------------
     The navigation handler raced fetch against the cache and returned whatever
     the fetch produced. It refused to CACHE a 500 — but still handed it to the
     browser, so a transient error showed an error page to someone holding a
     working copy of the app. */
  {
    /* The failing request is issued by the SERVICE WORKER, and Playwright's
       route interception never sees those — page.route and ctx.route both left
       the real 200 in place, so the first two versions of this block passed
       with the defect restored (boomHits was 0). The origin has to actually
       fail, so the harness server serves the 500 itself. */
    srv.fail500('/index.html');
    /* Check the origin from NODE, not from the page: a fetch made inside the
       page goes through the service worker too, so it returns the cached 200 —
       which is the fix working, not evidence the server is healthy. */
    const originStatus = (await fetch(`http://127.0.0.1:${port}/index.html`)).status;
    await page.reload({ waitUntil: 'domcontentloaded' });
    const served = await page.evaluate(() => ({
      boom: /upstream boom/.test(document.body.innerText),
      app: !!document.querySelector('[data-tab]') || /CoreForge/i.test(document.documentElement.innerHTML),
    }));
    srv.failClear();
    t.eq('guard: the origin really is failing', originStatus, 500);
    t.ok('a 500 does not reach the athlete when a cached page exists', !served.boom, served);
    t.ok('the cached app is served instead', served.app, served);
  }

  await ctx.close();

  srv.close();
  return t.finish([]);
}
