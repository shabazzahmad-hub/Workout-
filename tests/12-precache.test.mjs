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
    t.ok('video is deferred to the very end of the tail',
      EXTRA.filter(u => u.endsWith('.mp4')).every(u => EXTRA.indexOf(u) > EXTRA.length - 20),
      EXTRA.slice(-14));
    t.ok('the first-run tier covers the baseline tests and the flows',
      FIRST.includes('./ex-plank.jpg') && FIRST.includes('./wu-march.jpg') && FIRST.includes('./cd-childs.jpg'),
      FIRST.slice(0, 6));
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
  await ctx.setOffline(false);
  await ctx.close();

  srv.close();
  return t.finish([]);
}
