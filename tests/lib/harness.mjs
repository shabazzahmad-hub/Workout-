/* Shared test harness.
   Serves the app from the repo root over real HTTP and drives it in headless
   Chromium, because almost every defect this suite exists to catch only shows up
   once the whole page has booted: normalizeState has run, the service worker
   shell is reachable, and STATE is the shape a real device would have. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json',
  '.json': 'application/json', '.md': 'text/markdown',
};

/* Fault injection, for the checks that need the ORIGIN to misbehave rather than
   the client. Service-worker fetches are not visible to Playwright's route
   interception, so a test that wants the worker to see a 500 has to get it from
   a real server. srv.fail500(pathSuffix) turns it on; srv.failClear() off. */
export async function serve() {
  let fail = null;
  const srv = http.createServer((rq, rs) => {
    let p = rq.url.split('?')[0];
    if (p === '/') p = '/index.html';
    if (fail && p.endsWith(fail)) {
      rs.statusCode = 500; rs.setHeader('content-type', 'text/html');
      rs.end('upstream boom'); return;
    }
    // Never let a test reach outside the repo.
    const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) { rs.statusCode = 403; rs.end('no'); return; }
    fs.readFile(file, (e, d) => {
      if (e) { rs.statusCode = 404; rs.end('not found'); return; }
      rs.setHeader('content-type', TYPES[path.extname(file)] || 'text/plain');
      rs.end(d);
    });
  });
  srv.fail500 = suffix => { fail = suffix; };
  srv.failClear = () => { fail = null; };
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { srv, port: srv.address().port };
}

/* Console errors and uncaught exceptions are failures, not noise. The two
   filtered patterns are artefacts of running offline in a sandbox, not app bugs. */
const IGNORE = /ERR_INTERNET_DISCONNECTED|Failed to load resource|ServiceWorker|does not have a MIME type/;

export async function launch(port) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('uncaught: ' + String(e).slice(0, 300)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (!IGNORE.test(t)) errors.push('console: ' + t.slice(0, 300));
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await waitForBoot(page);   // the first load races exactly like a reload does
  return { browser, page, errors };
}

/* boot() awaits idbOpen() and load() before it normalises state and renders, so
   'domcontentloaded' and 'networkidle' both fire while STATE is still the empty
   default and TAB is still 'today'. Anything that reloads the page has to wait
   for the app, not for the network — a fixed sleep passes on a fast machine and
   fails on a slower CI runner, which reads as a broken app rather than as a
   check measuring the wrong thing. A rendered active view is the signal: it can
   only happen after load() has resolved.

   AND THE SPLASH HAS TO BE GONE. `.splash` is a full-screen `z-index:400`
   overlay dismissed 850ms after the first draw and removed 600ms after that;
   a rendered view resolves at about 626ms, so this used to hand back a page
   with an opaque sheet over the whole app and call it booted. Nothing that
   reads TEXT could tell, which is why it survived — but `elementFromPoint`
   returns the splash's own gradient, so every reachability check in the suite
   was racing a timer it did not know about. Suite 23's lift-input check lost
   that race about one run in three the moment an unrelated change shifted the
   timing by a few milliseconds, and read as a layering bug in the player.

   Waiting for it here rather than in the one check that noticed: the overlay
   covers every view, so any check that clicks, hit-tests or screenshots has
   the same exposure, and a fix in one of them leaves the class alive.

   The rendered-view test below is kept as intent, and NO CHECK CAN CATCH ITS
   REMOVAL: boot schedules `setTimeout(hideSplash,850)` on the line after
   render(), so a hidden splash already implies a drawn app and dropping the
   first condition is an equivalent mutant. Read the mutant back before
   rewriting the check that "missed" it. */
export function waitForBoot(page, timeout = 15000) {
  return page.waitForFunction(() => {
    const v = document.querySelector('.view.active');
    if (!v || v.innerHTML.length <= 400) return false;
    const sp = document.getElementById('splash');
    return !sp || sp.classList.contains('hide');
  }, null, { timeout });
}

/* A profile the engine can actually build a full program from. Tests that care
   about a specific shape override the bits they care about. */
export const ATHLETE = `(() => {
  STATE.onboarded = true;
  Object.assign(STATE.profile, {
    name: 'Test Athlete', age: 41, heightCm: 178, sex: 'male', goal: 'recomp',
    days: [1, 2, 4, 5, 6], gear: ['bar', 'bench', 'dip'], hasBar: true, hasBench: true,
    targets: ['abs', 'full'], limitations: [], parq: [], parqDone: true,
    medCleared: false, experience: 'Advanced', focusPrimary: 'abs',
    conditioning: 'high', mobility: 'ok', troubleZones: [], startWaist: 100,
  });
  Object.assign(STATE.nutrition, {
    weightKg: 88, sex: 'male', age: 41, heightCm: 178, activity: 1.55,
    diet: 'omnivore', meals: 3, allergens: [],
  });
  STATE.measurements = [{ date: todayISO(), weight: 88, waist: 96 }];
  STATE.baseline = {
    date: todayISO(), score: 97, level: 'Advanced', testCount: 8,
    maxes: { plank: 150, side: 95, hollow: 70, lower: 30, push: 48, pull: 22, squat: 62, dyn: 55 },
  };
  STATE.scoreHistory = [{ date: todayISO(), score: 97, level: 'Advanced', testCount: 8 }];
  STATE.progressPtr = 0; STATE.adapt = 1;
  STATE.logs = {}; STATE.quickLog = {}; STATE.prs = {}; STATE.achievements = {}; STATE.reassess = {};
  try { recalcKcalFromStored(); } catch (e) {}
  save();
})`;

export function seedAthlete(page, extra) {
  return page.evaluate(([base, over]) => {
    eval(base)();
    if (over) eval('(' + over + ')')();
    render();
  }, [ATHLETE, extra ? extra.toString() : null]);
}

/* ---- assertions ---------------------------------------------------------- */
export function suite(name) {
  const failures = [];
  let checks = 0;
  const api = {
    name,
    ok(label, cond, detail) {
      checks++;
      if (!cond) failures.push({ label, detail });
      return !!cond;
    },
    eq(label, actual, expected, detail) {
      return api.ok(label, JSON.stringify(actual) === JSON.stringify(expected),
        detail !== undefined ? detail : { actual, expected });
    },
    fail(label, detail) { checks++; failures.push({ label, detail }); },
    finish(extraErrors = []) {
      extraErrors.forEach(e => failures.push({ label: 'page produced an error', detail: e }));
      const passed = checks - failures.length;
      if (failures.length) {
        console.log(`\n✗ ${name} — ${failures.length} failed, ${passed} passed`);
        /* JSON.stringify(undefined) returns undefined, not a string, so a
           failing check called WITHOUT a detail argument crashed the reporter
           here — and the run was then reported as "the test file itself threw"
           rather than naming the check that failed. A mutant caught by such a
           check is still red, but you cannot see which one it was. */
        failures.forEach(f => {
          const d = typeof f.detail === 'string' ? f.detail
            : (f.detail === undefined ? '(no detail)' : String(JSON.stringify(f.detail)));
          console.log(`    ✗ ${f.label}\n      ${d.slice(0, 500)}`);
        });
      } else {
        console.log(`✓ ${name} — ${checks} checks`);
      }
      return failures.length;
    },
  };
  return api;
}
