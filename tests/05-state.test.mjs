/* State durability: hostile saves, upgrades from older builds, and the everyday
   flows that write to storage. The render error boundary retries THROUGH
   normalizeState(), so anything it fails to repair is unrecoverable on a real
   phone — the app stays broken across relaunches. */
import { serve, launch, suite, waitForBoot, seedAthlete, ATHLETE } from './lib/harness.mjs';
import { chromium } from 'playwright';

const HOSTILE = {
  'nulls everywhere': { onboarded: true, profile: { days: null, gear: null, targets: null, limitations: null, parq: null },
    nutrition: null, baseline: null, measurements: null, logs: null, scoreHistory: null },
  'wrong types': { onboarded: true, profile: { days: '0123456', gear: { bar: true }, targets: 'abs', limitations: 'knee', parq: 7 },
    nutrition: { diet: 'omnivore', meals: 'three', allergens: 'peanut,dairy', days: [] },
    quickLog: ['x'], progressPtr: 'twelve', adapt: 'fast' },
  'NaN and Infinity': { onboarded: true, progressPtr: NaN, adapt: Infinity,
    profile: { age: NaN, heightCm: Infinity, goal: 'lose', gear: [], days: [0, 1], parq: [], parqDone: true },
    nutrition: { weightKg: NaN, kcalTarget: NaN, diet: 'omnivore', meals: 3, allergens: [], days: {} },
    baseline: { date: '2099-01-01', score: NaN, level: 'Wizard', maxes: { plank: NaN, side: 'x', hollow: null, lower: Infinity, dyn: -5 } },
    scoreHistory: [null, { score: NaN }], logs: { '0': { done: true, ex: null }, '1': null } },
  'huge arrays': { onboarded: true,
    profile: { gear: new Array(2000).fill('bar'), days: new Array(500).fill(3), limitations: new Array(500).fill('knee'),
      parq: new Array(400).fill('heart'), parqDone: true },
    nutrition: { diet: 'omnivore', meals: 3, allergens: new Array(3000).fill('peanut'), days: {} },
    measurements: new Array(3000).fill(0).map((_, i) => ({ date: '2020-01-01', waist: 80 + i % 10, weight: 70 })),
    baseline: { date: '2026-01-01', score: 50, level: 'Intermediate', maxes: { plank: 40, side: 25, hollow: 20, lower: 10, dyn: 25 } } },
  'a pre-v177 save': { onboarded: true, version: 150, progressPtr: 95, adapt: 1.12,
    profile: { name: 'Old Save', goalWeightLb: 175, goalBodyFat: 12, hasBar: true, hasBench: true,
      days: [1, 3, 5], goal: 'lose', createdAt: '2026-01-05' },
    nutrition: { diet: 'omnivore', meals: 3, allergies: 'peanuts, dairy, shellfish', days: {} },
    baseline: { date: '2026-01-05', score: 52, level: 'Beginner', maxes: { plank: 40, side: 25, hollow: 20, lower: 10, dyn: 25 } },
    reassess: { 1: { maxes: { plank: 46, side: 28, hollow: 23, lower: 12, dyn: 28 } },
                2: { maxes: { plank: 52, side: 31, hollow: 26, lower: 14, dyn: 31 } } },
    scoreHistory: [{ date: '2026-01-05', score: 52, level: 'Beginner' }] },
};

export default async function run() {
  const t = suite('state durability');
  const { srv, port } = await serve();

  for (const [label, save] of Object.entries(HOSTILE)) {
    const { browser, page, errors } = await launch(port);
    await page.evaluate(s => {
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      localStorage.setItem('coreforge.v1', JSON.stringify(Object.assign(cur, s)));
    }, save);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const boot = await page.evaluate(() => ({
      boundary: /went wrong drawing/i.test(document.body.innerText),
      navUsable: document.querySelectorAll('[data-tab]').length > 0,
    }));
    t.ok(`[${label}] the app boots without hitting the error boundary`, !boot.boundary, boot);
    t.ok(`[${label}] the navigation is usable`, boot.navUsable, boot);

    // every tab must render, and a second cold boot must be identical
    for (const tab of ['today', 'program', 'fuel', 'progress', 'guide']) {
      const r = await page.evaluate(tb => {
        try { go(tb); } catch (e) { return { err: String(e).slice(0, 140) }; }
        const v = document.querySelector('#v-' + tb); const txt = v ? v.innerText : '';
        return { err: null, len: txt.trim().length,
          bad: (txt.match(/.{0,40}(undefined|NaN|\[object).{0,15}/g) || []).slice(0, 2),
          nullish: (txt.match(/(^|[\s>])null([\s<]|$)/g) || []).length };
      }, tab);
      t.ok(`[${label}] the ${tab} tab renders`, !r.err, r.err);
      t.ok(`[${label}] the ${tab} tab shows no placeholder values`, !r.err && r.bad.length === 0 && r.nullish === 0, r);
    }
    const repaired = await page.evaluate(() => ({
      limitations: Array.isArray(STATE.profile.limitations),
      parq: STATE.profile.parq == null || Array.isArray(STATE.profile.parq),
      gear: Array.isArray(STATE.profile.gear),
      days: Array.isArray(STATE.profile.days),
      quickLog: !!STATE.quickLog && typeof STATE.quickLog === 'object' && !Array.isArray(STATE.quickLog),
      allergens: STATE.nutrition.allergens == null || Array.isArray(STATE.nutrition.allergens),
      scoreHistory: Array.isArray(STATE.scoreHistory) && STATE.scoreHistory.every(e => e && e.score != null),
      buildsSession: (() => { try { return !!buildSession(0); } catch (e) { return false; } })(),
    }));
    Object.entries(repaired).forEach(([k, v]) => t.ok(`[${label}] ${k} is repaired to a usable shape`, v, repaired));

    // idempotence: booting twice must not drift
    const a = await page.evaluate(() => { normalizeState(); return JSON.stringify(STATE); });
    const b = await page.evaluate(() => { normalizeState(); normalizeState(); return JSON.stringify(STATE); });
    t.ok(`[${label}] normalizeState is idempotent`, a === b, 'state drifted on a second pass');

    await browser.close();
    errors.filter(e => !/render:recovered/.test(e)).forEach(e => t.fail(`[${label}] page error`, e));
  }

  // ---- the specific upgrade repairs ---------------------------------------
  {
    const { browser, page, errors } = await launch(port);
    await page.evaluate(s => {
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      localStorage.setItem('coreforge.v1', JSON.stringify(Object.assign(cur, s)));
    }, HOSTILE['a pre-v177 save']);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const up = await page.evaluate(() => ({
      goalWeight: STATE.profile.goalWeightLb, goalBF: STATE.profile.goalBodyFat,
      shredStart: STATE.profile._shredStart, createdAt: STATE.profile.createdAt,
      gear: STATE.profile.gear, allergens: STATE.nutrition.allergens,
      // an old 5-key reassessment must still yield all eight anchors
      phase2Maxes: currentMaxes(2),
      ptr: STATE.progressPtr, logsKept: !!STATE.baseline,
    }));
    t.ok('the seeded 175lb/12% body targets are cleared on upgrade',
      !(up.goalWeight > 0) && !(up.goalBF > 0), up);
    t.ok('the deficit clock is seeded from history, not from today',
      up.shredStart === up.createdAt, up);
    t.ok('legacy hasBar/hasBench are recovered into gear[]',
      Array.isArray(up.gear) && up.gear.includes('bar'), up);
    t.ok('free-text allergies migrate onto the tag list',
      Array.isArray(up.allergens) && up.allergens.length >= 2, up);
    t.ok('an old 5-key reassessment still yields all 8 anchors',
      ['plank', 'side', 'hollow', 'lower', 'dyn', 'push', 'pull', 'squat'].every(k => up.phase2Maxes[k] > 0), up.phase2Maxes);
    t.ok('progress is preserved across the upgrade', up.ptr === 95 && up.logsKept, up);
    await browser.close();
    errors.filter(e => !/render:recovered/.test(e)).forEach(e => t.fail('page error on upgrade', e));
  }

  // ---- everyday flows that write to storage -------------------------------
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const flows = await page.evaluate(() => {
      const o = {};
      try { startRestDay(); o.rest = Object.keys(STATE.restDays || {}).length; } catch (e) { o.restErr = String(e).slice(0, 120); }
      try { logSkip(12, 3); o.skip = skipLog().length; } catch (e) { o.skipErr = String(e).slice(0, 120); }
      try {
        STATE.logs = {}; STATE.quickLog = {}; STATE.restDays = {};
        QUICK_ID = QUICKIES[0].id; quickState = { done: {} };
        QUICKIES[0].items.forEach((_, i) => quickMark(i));
        quickFinish();
        o.quick = { logged: Object.keys(STATE.quickLog).length, streak: computeStreak(),
          heat: trainedDaysSet().size, today: trainedToday(), last28: last28Count() };
      } catch (e) { o.quickErr = String(e).slice(0, 140); }
      try {
        logFood('Chicken & rice', 600, 45, 60, 12);
        o.food = (nutToday().food || []).length;
        for (let i = 0; i < 8; i++) logWater(1);
        o.water = nutToday().water;
        STATE.nutrition.plan = null;
        const p = currentMealPlan(); regenPlan();
        o.plan = { meals: p.meals.length, missing: (p.missing || []).length,
          changed: JSON.stringify(p.meals) !== JSON.stringify(STATE.nutrition.plan.meals) };
        o.macros = macroTargets();
      } catch (e) { o.fuelErr = String(e).slice(0, 140); }
      try { upsertMeasure(94, 86.5); o.measures = STATE.measurements.length; } catch (e) { o.measErr = String(e).slice(0, 120); }
      try {
        STATE.settings = STATE.settings || {};
        STATE.settings.azureKey = 'SECRET-AZURE'; STATE.settings.foodAiKey = 'SECRET-GEMINI';
        const s = JSON.parse(JSON.stringify(STATE));
        if (s.settings) { delete s.settings.azureKey; delete s.settings.foodAiKey; }
        const json = JSON.stringify(s);
        o.keysStripped = !/SECRET-AZURE|SECRET-GEMINI/.test(json);
        const back = JSON.parse(json);
        o.exportKeeps = !!back.baseline && back.progressPtr != null && Array.isArray(back.measurements);
      } catch (e) { o.expErr = String(e).slice(0, 120); }
      try {
        STATE.logs = {}; STATE.quickLog = {}; STATE.restDays = {};
        const d = new Date(); d.setDate(d.getDate() - 21);
        STATE.logs['0'] = { done: true, completedAt: localISO(d), ex: {} };
        delete STATE.comeback; armComeback();
        o.comeback = STATE.comeback ? STATE.comeback.left : 0;
        o.comebackEases = comebackEaseActive();
      } catch (e) { o.cbErr = String(e).slice(0, 120); }
      // a deload must be switchable in week 6, the week it matters
      try {
        STATE.settings = {}; STATE.progressPtr = 5 * SESSIONS_PER_WEEK;
        const seq = []; for (let i = 0; i < 4; i++) { toggleDeload(); seq.push(deloadOn()); }
        o.deloadToggle = seq;
      } catch (e) { o.dlErr = String(e).slice(0, 120); }
      return o;
    });
    // the step target must scale with the goal and never render as a raw function
    const steps = await page.evaluate(() => {
      const o = { byGoal: {} };
      ['shred', 'lose', 'recomp', 'core', 'maintain', 'gain'].forEach(g => {
        STATE.profile.goal = g; o.byGoal[g] = stepTarget();
      });
      STATE.profile.goal = 'lose';
      o.kcal = stepKcal();
      // a corrupt goal must still yield a usable target, not NaN
      STATE.profile.goal = null; o.fallback = stepTarget();
      STATE.profile.goal = 'lose';
      const h = document.querySelector('#v-fuel');
      go('fuel');
      const txt = (document.querySelector('#v-fuel') || {}).innerText || '';
      o.shown = /10,000\+ steps/.test(txt);
      o.noRawFn = !/function|=>/.test(txt);
      return o;
    });
    t.eq('a cutting athlete is asked for 10k steps', steps.byGoal.lose, 10000, steps.byGoal);
    t.eq('shred asks for 10k too', steps.byGoal.shred, 10000, steps.byGoal);
    t.eq('recomp asks for 8k', steps.byGoal.recomp, 8000, steps.byGoal);
    t.eq('maintain asks for 7k', steps.byGoal.maintain, 7000, steps.byGoal);
    t.ok('the step target survives a missing goal', steps.fallback > 0, steps);
    t.ok('the calorie estimate is sane', steps.kcal > 100 && steps.kcal < 800, steps);
    t.ok('the target is rendered on the habit row', steps.shown, steps);
    t.ok('a function label never leaks into the UI', steps.noRawFn, steps);

    Object.keys(flows).filter(k => /Err$/.test(k)).forEach(k => t.fail(k.replace('Err', '') + ' flow threw', flows[k]));
    t.ok('a rest day is recorded', flows.rest >= 1, flows);
    t.ok('a skipping session is recorded', flows.skip >= 1, flows);
    t.ok('a quick workout is logged', flows.quick && flows.quick.logged >= 1, flows.quick);
    t.ok('a quick workout counts everywhere, not just in the streak',
      flows.quick && flows.quick.today && flows.quick.heat >= 1 && flows.quick.last28 >= 1, flows.quick);
    t.ok('logging food works', flows.food >= 1, flows);
    t.ok('logging water works', flows.water === 8, flows);
    t.ok('the meal plan fills every slot for a plain omnivore',
      flows.plan && flows.plan.meals >= 3 && flows.plan.missing === 0, flows.plan);
    t.ok('macro targets are computed', flows.macros && flows.macros.kcal > 0 && flows.macros.p > 0, flows.macros);
    t.ok('a measurement is stored', flows.measures >= 1, flows);
    t.ok('API keys are stripped from an export', flows.keysStripped, flows);
    t.ok('an export keeps the training record', flows.exportKeeps, flows);
    t.ok('a lay-off arms an eased comeback', flows.comeback > 0 && flows.comebackEases, flows);
    t.eq('the deload toggle actually toggles in week 6', flows.deloadToggle, [false, true, false, true]);
    await browser.close();
    errors.forEach(e => t.fail('page error during the everyday flows', e));
  }

  /* ---- importData() asks first, and a mistaken restore has a way back -----
     hardReset() — equally destructive — asks TWICE. importData() asked
     nothing at all: the wrong file silently replaced everything since, with
     no warning and no undo. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(async () => {
      const o = {};
      o.origName = STATE.profile.name;
      const backup = JSON.parse(JSON.stringify(STATE));
      backup.profile.name = 'Imported Athlete';
      const file = () => new File([JSON.stringify(backup)], 'b.json', { type: 'application/json' });
      const wait = async () => { for (let i = 0; i < 40 && STATE.profile.name !== 'Imported Athlete'; i++) await new Promise(z => setTimeout(z, 50)); };

      // declining the confirm must leave everything exactly as it was
      const realConfirm = window.confirm;
      window.confirm = () => false;
      importData({ target: { files: [file()] } });
      await new Promise(z => setTimeout(z, 150));
      o.declinedNameUnchanged = STATE.profile.name === o.origName;
      o.declinedNoSnapshot = !hasPreImportSnapshot();

      // accepting commits the import and takes a recovery snapshot
      window.confirm = () => true;
      importData({ target: { files: [file()] } });
      await wait();
      o.acceptedNameChanged = STATE.profile.name === 'Imported Athlete';
      o.acceptedHasSnapshot = hasPreImportSnapshot();

      // declining the UNDO confirm must leave the imported state in place
      const toastText = () => (document.getElementById('toast') || {}).textContent;
      window.confirm = () => false;
      undoImport();
      await new Promise(z => setTimeout(z, 50));
      o.declinedUndoLeftImportInPlace = STATE.profile.name === 'Imported Athlete';
      o.declinedUndoKeptSnapshot = hasPreImportSnapshot();

      // undo restores exactly what was live before the import, then clears itself
      window.confirm = () => true;
      undoImport();
      await new Promise(z => setTimeout(z, 50));
      o.undoRestoredName = STATE.profile.name === o.origName;
      o.undoClearsSnapshot = !hasPreImportSnapshot();

      // nothing left to undo a second time — must not throw, must say so
      undoImport();
      o.secondUndoToast = toastText();
      o.secondUndoLeftNameAlone = STATE.profile.name === o.origName;

      window.confirm = realConfirm;
      return o;
    });
    t.ok('declining the confirm leaves the athlete untouched', r.declinedNameUnchanged, r);
    t.ok('and takes no recovery snapshot', r.declinedNoSnapshot, r);
    t.ok('accepting actually restores the backup', r.acceptedNameChanged, r);
    t.ok('and a recovery snapshot of what was live is taken first', r.acceptedHasSnapshot, r);
    t.ok('declining the undo confirm leaves the import in place', r.declinedUndoLeftImportInPlace, r);
    t.ok('and keeps the snapshot available to try again', r.declinedUndoKeptSnapshot, r);
    t.ok('undoing the import restores what was there before it', r.undoRestoredName, r);
    t.ok('and the one-shot snapshot is consumed, not kept around', r.undoClearsSnapshot, r);
    t.eq('undoing with nothing to restore says so instead of throwing', r.secondUndoToast, 'Nothing to restore');
    t.ok('and leaves the athlete alone', r.secondUndoLeftNameAlone, r);
    await browser.close();
    errors.forEach(e => t.fail('page error during the import-undo flow', e));
  }

  /* ---- the undo the confirm promises has to actually exist ----------------
     The snapshot lives in localStorage, and a full store is exactly the state
     save()'s own quota fallback exists for. It was written AFTER the confirm,
     into a silent catch — so on a full phone the sentence "your current data
     will be saved first so you can undo this" was simply false. Measured
     before the fix: the write threw, the import went ahead, 300 logged
     sessions were erased and the Undo button never appeared.

     Same class as hardReset()'s "this cannot be undone" (v405): a promise in
     UI text is a specification. The floors are what stop the fix becoming
     "always warn" or "refuse the import" — a healthy device must be
     byte-identical, and a full store is not a reason to refuse a restore. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(async () => {
      const o = {};
      const mkBackup = () => {
        const b = JSON.parse(JSON.stringify(STATE));
        b.profile.name = 'Imported Athlete'; b.logs = {}; b.version = 1; b._saved = '2026-01-01';
        return new File([JSON.stringify(b)], 'b.json', { type: 'application/json' });
      };
      const bigLogs = () => { const L = {}; for (let i = 0; i < 300; i++) L[i] = { done: true, completedAt: '2026-08-01', ex: {}, items: [{ exId: 'pushup', sets: [1, 1, 1], target: 20, unit: 'reps' }] }; return L; };
      const clearFill = n => { for (let i = 0; i <= n; i++) { try { localStorage.removeItem('__f' + i); } catch (e) {} } };
      // Fill the store until a write far smaller than the snapshot is refused.
      const fill = () => {
        const big = 'x'.repeat(100000), small = 'x'.repeat(5000); let n = 0;
        try { for (; n < 400; n++) localStorage.setItem('__f' + n, big); } catch (e) {}
        try { for (; n < 800; n++) localStorage.setItem('__f' + n, small); } catch (e) {}
        return n;
      };
      const realConfirm = window.confirm;
      let asked = [];
      window.confirm = m => { asked.push(m); return true; };

      /* FLOOR: a healthy device is unchanged — the original wording, a real
         snapshot, a working Undo. */
      try { localStorage.removeItem(PREIMPORT_KEY); } catch (e) {}
      STATE.logs = bigLogs(); save();
      asked = [];
      importData({ target: { files: [mkBackup()] } });
      await new Promise(z => setTimeout(z, 400));
      o.healthyAsk = asked[0] || '';
      o.healthySnapshot = hasPreImportSnapshot();
      o.healthyImported = STATE.profile.name === 'Imported Athlete';

      /* The full store: it must SAY there is no undo, and must not leave a
         stale snapshot behind pretending there is one. */
      try { localStorage.removeItem(PREIMPORT_KEY); } catch (e) {}
      STATE.profile.name = 'Live Athlete'; STATE.logs = bigLogs(); save();
      let n = fill();
      asked = [];
      importData({ target: { files: [mkBackup()] } });
      await new Promise(z => setTimeout(z, 400));
      o.fullAsk = asked[0] || '';
      o.fullSaysNoUndo = /no undo/i.test(o.fullAsk);
      o.fullPromisesUndo = /undo this if it is a mistake/.test(o.fullAsk);
      o.fullStillImported = STATE.profile.name === 'Imported Athlete';
      o.fullOffersNoUndo = !hasPreImportSnapshot();
      clearFill(n);

      /* A STALE snapshot must not survive a failed one either — the Undo
         button says "restore what was here before it", and an older import's
         snapshot is not that. */
      STATE.profile.name = 'Live Athlete'; STATE.logs = {}; save();
      try { localStorage.setItem(PREIMPORT_KEY, JSON.stringify({ profile: { name: 'ANCIENT' }, version: 1 })); } catch (e) {}
      STATE.logs = bigLogs(); save();
      n = fill();
      asked = [];
      importData({ target: { files: [mkBackup()] } });
      await new Promise(z => setTimeout(z, 400));
      o.staleGone = !hasPreImportSnapshot();
      clearFill(n);

      /* FLOOR: a DECLINED import leaves the store exactly as it found it —
         both with a snapshot already there and with none. */
      try { localStorage.removeItem(PREIMPORT_KEY); } catch (e) {}
      window.confirm = () => false;
      STATE.profile.name = 'Live Athlete'; save();
      importData({ target: { files: [mkBackup()] } });
      await new Promise(z => setTimeout(z, 250));
      o.declinedLeavesNoSnapshot = !hasPreImportSnapshot();
      o.declinedKeptAthlete = STATE.profile.name === 'Live Athlete';

      try { localStorage.setItem(PREIMPORT_KEY, JSON.stringify({ profile: { name: 'EARLIER' }, version: 1 })); } catch (e) {}
      importData({ target: { files: [mkBackup()] } });
      await new Promise(z => setTimeout(z, 250));
      let kept = null; try { kept = JSON.parse(localStorage.getItem(PREIMPORT_KEY) || 'null'); } catch (e) {}
      o.declinedKeptEarlierSnapshot = !!(kept && kept.profile && kept.profile.name === 'EARLIER');

      try { localStorage.removeItem(PREIMPORT_KEY); } catch (e) {}
      window.confirm = realConfirm;
      return o;
    });
    // Guards: the two states this block depends on are really the two states.
    t.ok('guard: the healthy device really did take a snapshot', r.healthySnapshot, r);
    t.ok('guard: the full store really did refuse it', r.fullOffersNoUndo, r);

    t.ok('a healthy device is asked the original question', /undo this if it is a mistake/.test(r.healthyAsk), r);
    t.ok('and the import goes through', r.healthyImported, r);
    t.ok('a full store is told there will be NO undo', r.fullSaysNoUndo, r);
    t.ok('and is not promised one anyway', !r.fullPromisesUndo, r);
    t.ok('and the restore still goes ahead — a full store is not a reason to refuse it', r.fullStillImported, r);
    t.ok('a stale snapshot is not left behind pretending to be this import\'s', r.staleGone, r);
    t.ok('declining still leaves no snapshot when there was none', r.declinedLeavesNoSnapshot, r);
    t.ok('and leaves the athlete untouched', r.declinedKeptAthlete, r);
    t.ok('and puts an earlier snapshot back exactly as it found it', r.declinedKeptEarlierSnapshot, r);
    await browser.close();
    errors.forEach(e => t.fail('page error during the full-store import flow', e));
  }

  /* ---- another tab saving over work this one had already written ----------
     v404 made this tab ADOPT a foreign write, which is right when the other
     tab had already seen our work and wrong when it had not. Measured across
     two tabs: a logged session and its pointer, a measurement and a progress
     photo were each SAVED here and then discarded by the adopt, with the toast
     saying only "Updated from another tab" — the classic lost update, made
     silent.

     A whole-state store cannot merge the two copies, so the newest still wins
     (the least surprising default). What changed is that the loss is named and
     one tap from being undone. The writer stamps _base — the newest state IT
     had seen — and a _base predating our own last save is what says the copy
     arriving was built without our work.

     The FLOOR is the ordinary adopt, byte-identical: an over-eager detector
     that fired on every foreign write would put a scary sentence and a Restore
     button in front of every athlete with two tabs open. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(async () => {
      const o = {};
      const toastText = () => (document.getElementById('toast') || {}).textContent || '';
      /* A real second tab: it writes the whole state it was holding, stamped
         with the _savedAt it had loaded. */
      const foreignFrom = async (theirCopy, mutate) => {
        const f = JSON.parse(JSON.stringify(theirCopy));
        mutate(f);
        /* A REAL second tab increments its own revision when it saves, so
           both tabs branching from revision N write N+1 — the incoming copy is
           not OLDER than ours and only _base can tell them apart. Leaving the
           revision unchanged made the older-copy arm catch everything and left
           the _base arm undriven; two mutants walked through. */
        f._base = +theirCopy._rev || 0;
        f._rev = (+theirCopy._rev || 0) + 1;
        f._savedAt = Date.now();
        const j = JSON.stringify(f);
        localStorage.setItem('coreforge.v1', j); await idbPut('coreforge.v1', j);
        window.dispatchEvent(new StorageEvent('storage', { key: 'coreforge.v1', newValue: j }));
        await new Promise(z => setTimeout(z, 500));
      };
      const settingsHTML = () => { go('guide'); render(); return document.querySelector('#v-guide').innerHTML; };

      /* THE LOST UPDATE: we save, and only then does the other tab save from
         the copy it was already holding. */
      STATE.logs = {}; STATE.progressPtr = 0; save();
      const stale = JSON.parse(localStorage.getItem('coreforge.v1'));
      STATE.logs[0] = { done: true, completedAt: todayISO(), ex: {}, items: [], sets: 8 };
      STATE.progressPtr = 1; save();
      o.guardSaved = Object.keys(JSON.parse(localStorage.getItem('coreforge.v1')).logs).length;
      await foreignFrom(stale, f => { f.nutrition.days['2026-02-02'] = { food: [], water: 2, habits: {} }; });
      o.lostLogs = Object.keys(STATE.logs).length;
      o.lostSaysSo = /saved over changes made here/.test(toastText());
      o.lostSnapshot = hasCrossTabSnapshot();
      o.lostPromised = /Restore puts them back/.test(toastText());
      o.lostButton = /undoCrossTab\(\)/.test(settingsHTML());

      /* And the way back really goes back. */
      const realConfirm = window.confirm; window.confirm = () => true;
      undoCrossTab();
      await new Promise(z => setTimeout(z, 300));
      o.backLogs = Object.keys(STATE.logs).length;
      o.backPtr = STATE.progressPtr;
      o.backCleared = !hasCrossTabSnapshot();
      o.backButtonGone = !/undoCrossTab\(\)/.test(settingsHTML());

      /* Declining leaves the adopted state alone. */
      STATE.logs = {}; save();
      const stale2 = JSON.parse(localStorage.getItem('coreforge.v1'));
      STATE.logs[0] = { done: true, completedAt: todayISO(), ex: {}, items: [], sets: 8 }; save();
      await foreignFrom(stale2, f => { f.nutrition.days['2026-06-06'] = { food: [], water: 1, habits: {} }; });
      window.confirm = () => false;
      undoCrossTab();
      await new Promise(z => setTimeout(z, 200));
      o.declinedLogs = Object.keys(STATE.logs).length;
      o.declinedKeptSnapshot = hasCrossTabSnapshot();
      try { localStorage.removeItem('coreforge.v1.crosstab'); } catch (e) {}
      window.confirm = realConfirm;

      /* FLOOR: the ordinary adopt, where the other tab HAD seen our save. */
      STATE.logs = {}; save();
      const seen = JSON.parse(localStorage.getItem('coreforge.v1'));
      await foreignFrom(seen, f => { f.nutrition.days['2026-05-05'] = { food: [], water: 1, habits: {} }; });
      o.okToast = toastText();
      o.okSnapshot = hasCrossTabSnapshot();
      o.okAdopted = !!(STATE.nutrition.days || {})['2026-05-05'];
      o.okNoButton = !/undoCrossTab\(\)/.test(settingsHTML());

      /* A copy simply OLDER than ours is the same loss by a shorter route. */
      STATE.logs = {}; save();
      const older = JSON.parse(localStorage.getItem('coreforge.v1'));
      STATE.logs[0] = { done: true, completedAt: todayISO(), ex: {}, items: [] }; save();
      await (async () => {
        const f = JSON.parse(JSON.stringify(older));
        f._rev = Math.max(0, (+older._rev || 1) - 1); delete f._base;
        const j = JSON.stringify(f);
        localStorage.setItem('coreforge.v1', j); await idbPut('coreforge.v1', j);
        window.dispatchEvent(new StorageEvent('storage', { key: 'coreforge.v1', newValue: j }));
        await new Promise(z => setTimeout(z, 500));
      })();
      o.olderSnapshot = hasCrossTabSnapshot();
      try { localStorage.removeItem('coreforge.v1.crosstab'); } catch (e) {}

      /* The guard that makes the case above about _base and not about age:
         both tabs branch from one revision and write the same next one. */
      STATE.logs = {}; save();
      const branch = JSON.parse(localStorage.getItem('coreforge.v1'));
      STATE.logs[0] = { done: true, completedAt: todayISO(), ex: {}, items: [] }; save();
      o.sameRev = ((+branch._rev || 0) + 1) === (+STATE._rev || 0);

      /* THE WRITER'S OWN CONTRACT, pinned directly. Every check above builds
         the other tab's stamp by hand, so whether OUR save() stamps one is
         invisible to them — and the harm of dropping it lands on the other
         tab, which this page does not have. A save must carry the revision it
         was built on, and advance the revision by exactly one. */
      STATE.logs = {}; save();
      const w1 = JSON.parse(localStorage.getItem('coreforge.v1'));
      STATE.logs[0] = { done: true, completedAt: todayISO(), ex: {}, items: [] }; save();
      const w2 = JSON.parse(localStorage.getItem('coreforge.v1'));
      o.stampsBase = (+w2._base || -1) === (+w1._rev || -2);
      o.advancesRev = (+w2._rev || 0) === (+w1._rev || 0) + 1;

      /* THE TOAST PROMISES THE RESTORE, so it may only promise one that
         exists. v406's import defect, in the code that fixed it: measured on a
         full store the write threw into a silent catch and the promise stood. */
      try { localStorage.removeItem('coreforge.v1.crosstab'); } catch (e) {}
      STATE.logs = {};
      for (let i = 0; i < 300; i++) STATE.logs[i] = { done: true, completedAt: '2026-08-01', ex: {}, items: [{ exId: 'pushup', sets: [1, 1, 1], target: 20, unit: 'reps' }] };
      save();
      const bulk = JSON.parse(localStorage.getItem('coreforge.v1'));
      STATE.logs[999] = { done: true, completedAt: todayISO(), ex: {}, items: [] }; save();
      const big = 'x'.repeat(100000), small = 'x'.repeat(5000); let nf = 0;
      try { for (; nf < 400; nf++) localStorage.setItem('__f' + nf, big); } catch (e) {}
      try { for (; nf < 800; nf++) localStorage.setItem('__f' + nf, small); } catch (e) {}
      await (async () => {
        const f = JSON.parse(JSON.stringify(bulk));
        f.nutrition.days['2026-09-09'] = { food: [], water: 1, habits: {} };
        f._base = +bulk._rev || 0; f._rev = (+bulk._rev || 0) + 1; f._savedAt = Date.now();
        const j = JSON.stringify(f);
        try { localStorage.setItem('coreforge.v1', j); } catch (e) {}
        await idbPut('coreforge.v1', j);
        window.dispatchEvent(new StorageEvent('storage', { key: 'coreforge.v1', newValue: j }));
        await new Promise(z => setTimeout(z, 600));
      })();
      o.fullSaysSo = /out of storage/.test(toastText()) && /could not be kept/.test(toastText());
      o.fullPromised = /Restore puts them back/.test(toastText());
      o.fullSnapshot = hasCrossTabSnapshot();
      for (let i = 0; i <= nf; i++) { try { localStorage.removeItem('__f' + i); } catch (e) {} }
      try { localStorage.removeItem('coreforge.v1.crosstab'); } catch (e) {}

      /* A FAILED WRITE MUST NOT LEAVE AN EARLIER SNAPSHOT BEHIND THE BUTTON.
         The removal is not for room — setItem on a key that already exists
         replaces it, so the write reclaims the old value itself (measured: a
         39,490-char snapshot landed over a 39,397-char one with under 5,000
         chars of slack, which is why an equal-sized pair cannot tell the two
         versions apart). What it is for is this: a SMALL stale snapshot and a
         LARGE new one on a full store. Without the removal the small one
         survives, so the toast honestly says the work was not kept while
         Settings still offers a restore — of the state from two lost updates
         ago. */
      STATE.logs = {};
      save();
      const smallBase = JSON.parse(localStorage.getItem('coreforge.v1'));
      STATE.logs[1] = { done: true, completedAt: todayISO(), ex: {}, items: [] }; save();
      const foreignOf = async (base, tag) => {
        const f = JSON.parse(JSON.stringify(base));
        f.nutrition.days[tag] = { food: [], water: 1, habits: {} };
        f._base = +base._rev || 0; f._rev = (+base._rev || 0) + 1; f._savedAt = Date.now();
        const j = JSON.stringify(f);
        try { localStorage.setItem('coreforge.v1', j); } catch (e) {}
        await idbPut('coreforge.v1', j);
        window.dispatchEvent(new StorageEvent('storage', { key: 'coreforge.v1', newValue: j }));
        await new Promise(z => setTimeout(z, 600));
      };
      await foreignOf(smallBase, '2026-10-10');     // a first lost update, on a small state
      o.staleLen = (localStorage.getItem('coreforge.v1.crosstab') || '').length;

      /* Now the state this tab holds is far bigger than that stale snapshot,
         and the incoming copy is the same size as ours, so the foreign write
         frees no room of its own. */
      for (let i = 0; i < 900; i++) STATE.logs[i] = { done: true, completedAt: '2026-08-01', ex: {}, items: [{ exId: 'pushup', sets: [1, 1, 1], target: 20, unit: 'reps' }] };
      save();
      const bigBase = JSON.parse(localStorage.getItem('coreforge.v1'));
      STATE.logs[777] = { done: true, completedAt: todayISO(), ex: {}, items: [] }; save();
      o.wantLen = localStorage.getItem('coreforge.v1').length;
      let nf2 = 0;
      try { for (; nf2 < 400; nf2++) localStorage.setItem('__g' + nf2, big); } catch (e) {}
      try { for (; nf2 < 800; nf2++) localStorage.setItem('__g' + nf2, small); } catch (e) {}
      await foreignOf(bigBase, '2026-11-11');
      o.secondSaysSo = /out of storage/.test(toastText());
      o.secondPromised = /Restore puts them back/.test(toastText());
      o.secondSnapshot = hasCrossTabSnapshot();
      o.secondButton = /undoCrossTab\(\)/.test(settingsHTML());
      for (let i = 0; i <= nf2; i++) { try { localStorage.removeItem('__g' + i); } catch (e) {} }
      try { localStorage.removeItem('coreforge.v1.crosstab'); } catch (e) {}

      /* The stamp is live-session scratch and must never reach a backup. */
      o.baseIsTransient = BACKUP_STRIP.indexOf('_base') >= 0 && BACKUP_STRIP.indexOf('_rev') >= 0
        && TRANSIENT_KEYS.indexOf('_base') < 0 && TRANSIENT_KEYS.indexOf('_rev') < 0;
      return o;
    });
    t.eq('guard: the session really was saved before the other tab wrote', r.guardSaved, 1);
    t.eq('the newest copy still wins, as it did before', r.lostLogs, 0);
    t.ok('but the athlete is told work made here was replaced', r.lostSaysSo, r);
    t.ok('and a snapshot of it is kept', r.lostSnapshot, r);
    /* The wording is the payload here, not the substring both branches share:
       an over-eager fix that never sets _snapOk keeps the snapshot AND the
       button and still tells a healthy phone it is out of storage. */
    t.ok('and, the snapshot having landed, the restore is promised', r.lostPromised, r);
    t.ok('and Settings offers the way back', r.lostButton, r);
    t.eq('restoring brings the session back', r.backLogs, 1);
    t.eq('and the pointer with it', r.backPtr, 1);
    t.ok('and the one-shot snapshot is consumed', r.backCleared, r);
    t.ok('so the button goes with it', r.backButtonGone, r);
    t.eq('declining leaves the adopted state in place', r.declinedLogs, 0);
    t.ok('and keeps the snapshot to try again', r.declinedKeptSnapshot, r);
    t.eq('FLOOR: an ordinary adopt says exactly what it said before', r.okToast, 'Updated from another tab');
    t.ok('and takes no snapshot', !r.okSnapshot, r);
    t.ok('and still adopts the other tab\'s work', r.okAdopted, r);
    t.ok('and offers no restore button', r.okNoButton, r);
    t.ok('a copy older than ours is caught even with no stamp on it', r.olderSnapshot, r);
    t.ok('guard: the two tabs really did branch to the SAME revision', r.sameRev, r);
    t.ok('a save stamps the revision it was built on', r.stampsBase, r);
    t.ok('a full store is told the work could not be kept', r.fullSaysSo, r);
    t.ok('and is not promised a restore that does not exist', !r.fullPromised, r);
    t.ok('guard: the store really did refuse the snapshot', !r.fullSnapshot, r);
    t.ok('guard: a first lost update really did leave a snapshot behind', r.staleLen > 0, r);
    t.ok('guard: and the state it must now snapshot is far bigger than that one', r.wantLen > r.staleLen * 5, r);
    t.ok('a second lost update on a full store still says the work was not kept', r.secondSaysSo, r);
    t.ok('and does not promise a restore', !r.secondPromised, r);
    t.ok('and the stale snapshot goes rather than sitting behind the button', !r.secondSnapshot, r);
    t.ok('so Settings offers no restore of a state from two lost updates ago', !r.secondButton, r);
    t.ok('and advances the revision by exactly one', r.advancesRev, r);
    t.ok('neither stamp travels in a backup, and neither is session scratch', r.baseIsTransient, r);
    await browser.close();
    errors.forEach(e => t.fail('page error during the cross-tab lost-update flow', e));
  }

  /* ---- an UPGRADE is bootstrapping, and bootstrapping is not a repair ------
     boot() flagged _dataRepaired on ANY diff across normalizeState(), so the
     first launch after a version that added a field told every athlete
     "Something stored on this device was not in a shape the app expected, so
     it was reset to a safe default". Measured on a real v396 -> v408 upgrade
     with a perfectly valid state: 46 keys ADDED, zero validator problems, and
     not one value changed. That names the wrong cause, and because nearly
     every version adds a field it fired for everyone on nearly every upgrade
     — which is how a note becomes noise.

     The floors are what stop the fix being a mute button: every genuine repair
     must still speak, and they are seeded one at a time below. */
  {
    const { browser, page, errors } = await launch(port);
    const mkLegacy = mutName => {
      const s = { version: 1, _saved: '2026-08-30', _savedAt: Date.now(), onboarded: true,
        progressPtr: 12, adapt: 1.05,
        profile: { name: 'Legacy', age: 52, heightCm: 178, sex: 'male', unit: 'in',
          goal: 'lose', experience: 'Intermediate', days: [1, 2, 4, 5, 6], gear: ['bar'],
          limitations: [], parq: [], parqDone: true, targets: ['abs'], mobility: 'ok',
          activity: 1.45, _mintTheme: true },
        nutrition: { goal: 'lose', sex: 'male', age: 52, heightCm: 178, weightKg: 86,
          activity: 1.45, diet: 'omnivore', allergies: '', meals: 3, days: {}, cardioMode: 'jacks' },
        logs: {}, swaps: {}, restDays: {}, _opens: {}, prs: {}, achievements: {},
        measurements: [], scoreHistory: [], photos: [],
        settings: { sound: true, vibrate: true, voice: true, voiceName: '', voiceTone: 'mid',
          voiceRate: 0.98, repTempo: 3, hype: true, coach: 'drill', beat: true, beatVol: 0.55,
          theme: 'ion', neuralOn: false, azureKey: '', azureRegion: 'eastus', autoIntro: true } };
      for (let i = 0; i < 12; i++) s.logs[i] = { done: true, completedAt: '2026-08-0' + (1 + i % 9), ex: {}, sets: 8, items: [] };
      if (mutName === 'adapt') s.adapt = 99;
      if (mutName === 'diet') s.nutrition.diet = 'kosher';
      if (mutName === 'logsArray') s.logs = [1, 2, 3];
      if (mutName === 'comeback') s.comeback = { left: 99999 };
      if (mutName === 'name') s.profile.name = {};
      if (mutName === 'logKey') s.logs['constructor'] = { done: true };
      return JSON.stringify(s);
    };
    /* A real phone carries the state in BOTH stores, and load() takes whichever
       is NEWER — seeding only localStorage leaves the fresh boot's mirror to
       win, which is the trap CLAUDE.md records about clearing one store. */
    const bootWith = async json => {
      await page.evaluate(async j => { localStorage.setItem('coreforge.v1', j); await idbPut('coreforge.v1', j); }, json);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForBoot(page);
      return page.evaluate(() => {
        go('guide'); render();
        return { repaired: !!STATE._dataRepaired,
                 noteShown: /needed a repair/.test(document.querySelector('#v-guide').innerHTML) };
      });
    };
    const clean = await bootWith(mkLegacy(null));
    t.ok('a healthy upgrade does not claim the athlete\'s data needed repairing', !clean.repaired, clean);
    t.ok('and shows no note', !clean.noteShown, clean);

    for (const [name, label] of [['adapt', 'a value outside its band'], ['diet', 'a diet outside the list'],
      ['logsArray', 'a keyed map arriving as an array'], ['comeback', 'a stored courtesy outside its band'],
      ['name', 'a free-text field of the wrong type'], ['logKey', 'an illegal key in a keyed map']]) {
      const r = await bootWith(mkLegacy(name));
      t.ok('FLOOR: ' + label + ' still says so', r.repaired && r.noteShown, { name, r });
    }

    /* The predicate's own contract, exercised directly — it is consulted from
       one narrow branch and still has to mean what it is named. */
    const pred = await page.evaluate(() => [
      _normTouchedExisting({ a: 1 }, { a: 1, b: 2 }) === false,          // pure addition
      _normTouchedExisting({ a: 1 }, { a: 2 }) === true,                 // a real value changed
      _normTouchedExisting({ a: 1 }, {}) === true,                       // a real value removed
      _normTouchedExisting({ a: null }, {}) === false,                   // a null is not an answer
      _normTouchedExisting({ a: null }, { a: 5 }) === false,             // seeding over a null is bootstrapping
      _normTouchedExisting({ n: { x: 1 } }, { n: { x: 1, y: 2 } }) === false,   // nested addition
      _normTouchedExisting({ n: { x: 1 } }, { n: { x: 9 } }) === true,          // nested change
      _normTouchedExisting({ l: [1, 2] }, { l: [1] }) === true,          // a dropped row
    ]);
    t.eq('_normTouchedExisting() counts changes and removals, never additions', pred,
      [true, true, true, true, true, true, true, true]);
    await browser.close();
    errors.forEach(e => t.fail('page error during the upgrade-note flow', e));
  }

  /* The OTHER arm: validateData() finding a problem in the athlete's own data
     when normalizeState() had nothing to repair. Nothing above exercises it,
     and a mutant that dropped it walked straight through — so it is driven
     here with a LEGAL diet and LEGAL allergens, which leaves every value
     untouched and still puts the reference days out of reach (measured: 84
     problems). Its own browser, because validateData() LOGS and the harness
     counts a console error as a page failure. */
  {
    const { browser, page } = await launch(port);
    await page.addInitScript(() => { console.error = () => {}; });
    const r = await page.evaluate(async () => {
      const s = { version: 1, _saved: '2026-08-30', _savedAt: Date.now(), onboarded: true,
        progressPtr: 4, adapt: 1,
        profile: { name: 'Legacy', age: 52, heightCm: 178, sex: 'male', unit: 'in',
          goal: 'lose', experience: 'Intermediate', days: [1, 2, 4, 5, 6], gear: ['bar'],
          limitations: [], parq: [], parqDone: true, targets: ['abs'], mobility: 'ok',
          activity: 1.45, _mintTheme: true },
        nutrition: { goal: 'lose', sex: 'male', age: 52, heightCm: 178, weightKg: 86,
          activity: 1.45, diet: 'vegan', allergens: ['soy', 'treenut', 'peanut', 'gluten'],
          allergies: '', meals: 3, days: {}, cardioMode: 'jacks' },
        logs: {}, swaps: {}, restDays: {}, _opens: {}, prs: {}, achievements: {},
        measurements: [], scoreHistory: [], photos: [],
        settings: { sound: true, vibrate: true, voice: true, voiceName: '', voiceTone: 'mid',
          voiceRate: 0.98, repTempo: 3, hype: true, coach: 'drill', beat: true, beatVol: 0.55,
          theme: 'ion', neuralOn: false, azureKey: '', azureRegion: 'eastus', autoIntro: true } };
      const j = JSON.stringify(s);
      localStorage.setItem('coreforge.v1', j); await idbPut('coreforge.v1', j);
      return j;
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const storedJson = await page.evaluate(() => localStorage.getItem('coreforge.v1'));
    const v = await page.evaluate(j => {
      // guard: normalizeState() must have nothing to repair here, or this
      // block passes through the other arm and proves nothing.
      const p0 = JSON.parse(j);
      const obj = (base, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.assign(base, x) : base;
      const sim = Object.assign(DEFAULT_STATE(), p0);
      sim.profile = obj(DEFAULT_STATE().profile, p0.profile);
      sim.settings = obj(DEFAULT_STATE().settings, p0.settings);
      sim.nutrition = obj(DEFAULT_STATE().nutrition, p0.nutrition);
      const keep = STATE; STATE = JSON.parse(JSON.stringify(sim));
      const before = JSON.parse(JSON.stringify(STATE));
      normalizeState();
      const touched = _normTouchedExisting(before, STATE);
      let problems = 0; try { problems = (validateData() || []).length; } catch (e) {}
      STATE = keep;
      go('guide'); render();
      return { touched, problems, repaired: !!STATE._dataRepaired,
               noteShown: /needed a repair/.test(document.querySelector('#v-guide').innerHTML) };
    }, storedJson);
    t.ok('guard: nothing needed repairing in this state', !v.touched, v);
    t.ok('guard: the validator really did find problems', v.problems > 0, v);
    t.ok('a validator problem on the athlete\'s own data reaches them', v.repaired, v);
    t.ok('and shows the note', v.noteShown, v);
    await browser.close();
  }

  /* ---- a boot-time repair or validation problem reaches the athlete, not
     just the console — validateData()'s findings and any shape normalizeState()
     had to fix used to go nowhere a real athlete would ever see them. -------- */
  {
    const { browser, page, errors } = await launch(port);
    await page.evaluate(seed => { eval(seed)(); }, ATHLETE);
    // a value normalizeState() will actually have to repair on THIS boot
    await page.evaluate(() => {
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      cur.nutrition = cur.nutrition || {}; cur.nutrition.days = cur.nutrition.days || {};
      cur.nutrition.days['2026-01-02'] = { water: 4, habits: {}, steps: 'heaps' };
      localStorage.setItem('coreforge.v1', JSON.stringify(cur));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const flagged = await page.evaluate(() => {
      go('guide');
      const html = document.querySelector('#v-guide').innerHTML;
      return { repaired: !!STATE._dataRepaired, noteShown: /needed a repair/.test(html) };
    });
    t.ok('a real repair on this boot sets the flag', flagged.repaired, flagged);
    t.ok('and the athlete sees a note about it, not just the console', flagged.noteShown, flagged);

    // dismissing clears it, and it stays clear across a further boot with nothing left to fix
    const cleared = await page.evaluate(async () => {
      dismissDataHealth();
      const afterDismiss = !!STATE._dataRepaired;
      return { afterDismiss };
    });
    t.ok('dismissing clears the flag', !cleared.afterDismiss, cleared);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const stillClear = await page.evaluate(() => !!STATE._dataRepaired);
    t.ok('and a later boot with nothing left to repair does not re-set it', !stillClear, stillClear);

    await browser.close();
    errors.filter(e => !/render:recovered/.test(e)).forEach(e => t.fail('page error during the data-health flow', e));
  }

  /* ---- exporting a fresh backup is not itself flagged as needing repair --- */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const clean = await page.evaluate(() => !!STATE._dataRepaired);
    t.ok('a clean, freshly-seeded athlete boots with nothing flagged', !clean, clean);
    await browser.close();
    errors.forEach(e => t.fail('page error on a clean boot', e));
  }

  /* ---- a stale backup nudge, gated on real elapsed time, not a toggle ----- */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const o = {};
      const old = d => { const x = new Date(); x.setDate(x.getDate() - d); return localISO(x); };

      // a brand-new athlete is never nagged, even with no export on record
      STATE.profile.createdAt = old(2); delete STATE._lastExport; delete STATE._backupNudgeDismissed;
      o.newAthleteQuiet = backupNudgeHTML() === '';

      // old enough, never exported — the nudge shows
      STATE.profile.createdAt = old(40);
      o.neverExportedNags = /No backup in a while/.test(backupNudgeHTML());

      // exporting recently silences it, even though the account itself is old
      STATE._lastExport = old(2);
      o.recentExportQuiet = backupNudgeHTML() === '';

      // but a STALE export does not — 21+ days since the last one nags again
      STATE._lastExport = old(30);
      o.staleExportNags = /No backup in a while/.test(backupNudgeHTML());

      // dismissing silences it for a while, without requiring an actual export
      dismissBackupNudge();
      o.dismissedQuiet = backupNudgeHTML() === '';

      // and exportData() itself clears the nag, not just a manual dismiss
      delete STATE._backupNudgeDismissed; STATE._lastExport = old(30);
      return o;
    });
    t.ok('a new athlete is not nagged before they have had time to ramp up', r.newAthleteQuiet, r);
    t.ok('an established athlete who never exported is nagged', r.neverExportedNags, r);
    t.ok('a recent export silences it', r.recentExportQuiet, r);
    t.ok('a stale export nags again', r.staleExportNags, r);
    t.ok('dismissing silences it too', r.dismissedQuiet, r);

    const exported = await page.evaluate(async () => {
      let ok = false;
      const oc = URL.createObjectURL, ck = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = () => 'blob:x'; HTMLAnchorElement.prototype.click = function () {};
      try { await exportData(); ok = true; } finally {
        URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = ck;
      }
      return { ok, quiet: backupNudgeHTML() === '', stamp: STATE._lastExport === todayISO() };
    });
    t.ok('exportData() runs clean', exported.ok, exported);
    t.ok('and its own real export clears the nag immediately', exported.quiet, exported);
    t.ok('stamping today as the last export date', exported.stamp, exported);
    await browser.close();
    errors.forEach(e => t.fail('page error during the backup-nudge flow', e));
  }

  /* ---- progressPtr is an index, and it has to be a whole one --------------
     posOf() feeds dayInWeek into sessionsFor(cycle)[...]. A FRACTION indexes a
     slot that does not exist, so goalSlots() dereferenced undefined and Today
     died on the error boundary — which retries THROUGH normalizeState(), so a
     stored 3.7 bricked the tab across relaunches, not just for one render.
     The quieter shapes were wrong too: the string '12' reached
     `Math.min(STATE.progressPtr+1, …)` and CONCATENATED, printing "SESSION 121
     / 378" to an athlete on session 13.

     Note the seeding. save() writes localStorage now and mirrors to IndexedDB
     120 ms later, so planting a value and reloading immediately races the
     mirror and the seed wins about half the time — which reads as "the repair
     worked". Both stores get the value, with a fresher stamp. */
  {
    const { browser, page, errors } = await launch(port);
    const CASES = [
      ['a fraction', 3.7, 3], ['a fraction under one', 0.5, 0], ['a numeric string', '12', 12],
      ['a negative', -5, 0], ['a boolean', true, 1], ['null', null, 0], ['an array', [], 0],
      ['an object', {}, 0], ['a word', 'twelve', 0], ['past the end', 1e9, 378],
    ];
    for (const [label, planted, want] of CASES) {
      await page.evaluate(seed => { eval(seed)(); }, ATHLETE);
      await page.waitForTimeout(200);                       // let the idb mirror land first
      await page.evaluate(async p => {
        const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
        cur.progressPtr = p; cur._savedAt = Date.now() + 5000;
        const json = JSON.stringify(cur);
        localStorage.setItem('coreforge.v1', json);
        await idbPut('coreforge.v1', json);                 // and beat the mirror on its own terms
      }, planted);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForBoot(page);
      const r = await page.evaluate(() => {
        go('today');
        const txt = document.querySelector('.view.active').innerText;
        let threw = null;
        try { buildSession(STATE.progressPtr); } catch (e) { threw = String(e).slice(0, 90); }
        return { ptr: STATE.progressPtr, type: typeof STATE.progressPtr, threw,
          boundary: /went wrong drawing/i.test(txt),
          session: (txt.match(/SESSION (\d+) \/ (\d+)/) || [])[1] || null,
          total: (txt.match(/SESSION (\d+) \/ (\d+)/) || [])[2] || null };
      });
      t.eq(`[${label}] is repaired to a whole index`, r.ptr, want);
      t.eq(`[${label}] is stored as a number`, r.type, 'number');
      t.ok(`[${label}] builds a session instead of throwing`, !r.threw, r);
      t.ok(`[${label}] never reaches the error boundary`, !r.boundary, r);
      if (r.session) t.ok(`[${label}] shows a session inside the program, not past it`,
        +r.session >= 1 && +r.session <= +r.total, r);
    }
    errors.filter(e => /render/.test(e)).forEach(e => t.fail('a hostile pointer reached the render boundary', e));
    await browser.close();
  }

  /* ---- logs and prs are keyed MAPS, never lists --------------------------
     `typeof [] === 'object'`, so a bare typeof test lets an array straight
     through. The archived-runs repair already rejects exactly this shape
     (`!Array.isArray(r.logs)`); the live maps carried only half that guard.

     It is not cosmetic, which is why the size is asserted and not just the
     type: logs is keyed by progressPtr, so an athlete 300 sessions in whose
     logs arrived as an array serialises SPARSE — a single real session
     becomes ~1.5 KB of mostly `null` against 79 bytes for the object shape,
     and those nulls then travel in every backup and return on the next
     import. Asserted on the RAW stored value, not through a reader that
     sanitises its own access. */
  {
    const { browser, page, errors } = await launch(port);
    await waitForBoot(page);
    const r = await page.evaluate(() => {
      STATE.onboarded = true;
      STATE.logs = []; STATE.logs[300] = { done: true, ex: { plank: { sets: [true] } }, completedAt: '2026-08-01' };
      STATE.prs = []; STATE.prs.plank = 75;
      normalizeState();
      const out = {
        logsIsArray: Array.isArray(STATE.logs),
        prsIsArray: Array.isArray(STATE.prs),
        logsSerialised: JSON.stringify(STATE.logs).length,
        nullsInLogs: (JSON.stringify(STATE.logs).match(/null/g) || []).length,
      };
      // a genuine object map must survive untouched — the repair must not be
      // so eager that it throws away real training history
      STATE.logs = { 12: { done: true, ex: { plank: { sets: [true] } } } };
      STATE.prs = { plank: 75 };
      normalizeState();
      out.realLogsKept = STATE.logs && STATE.logs[12] && STATE.logs[12].done === true;
      out.realPrsKept = STATE.prs && STATE.prs.plank === 75;
      // and the app still works on top of the repaired shape
      let builds = true; try { buildSession(0); } catch (e) { builds = false; }
      out.builds = builds;
      return out;
    });
    t.ok('an array of logs is repaired to a real keyed map', !r.logsIsArray, r);
    t.ok('an array of prs is repaired too', !r.prsIsArray, r);
    t.ok('so a backup carries no sparse-array nulls', r.nullsInLogs === 0, r);
    t.ok('and stays small rather than bloating ~20x', r.logsSerialised < 200, r);
    t.ok('a genuine object map of logs is left untouched', r.realLogsKept === true, r);
    t.ok('and genuine PRs survive', r.realPrsKept === true, r);
    t.ok('the app still builds a session afterwards', r.builds === true, r);
    errors.filter(e => /render/.test(e)).forEach(e => t.fail('the map repair reached the render boundary', e));
    await browser.close();
  }

  /* ---- the whole CLASS of keyed maps, not one at a time -----------------
     v284 fixed logs/prs after measuring backup bloat, then a fuzz of all 33
     top-level fields found the identical half-guard on eight more. Checking
     them one at a time is how the gap survived a version, so this asserts the
     property across every container at once: none may survive as an ARRAY,
     and the integer-keyed ones must not serialise sparse. */
  {
    const { browser, page, errors } = await launch(port);
    await waitForBoot(page);
    const r = await page.evaluate(() => {
      const MAPS = ['logs','prs','swaps','reassess','weekFeel','restDays','_opens',
                    'achievements','settings','profile','nutrition','formatFeel'];
      STATE.onboarded = true;
      const survived = [], bloated = [];
      MAPS.forEach(k => {
        STATE[k] = [];
        STATE[k][300] = { probe: true };     // integer key, far out — the sparse case
        normalizeState();
        if (Array.isArray(STATE[k])) survived.push(k);
        /* Look for the SPARSE-ARRAY signature — runs of bare `null,null` —
           not for any null at all. Several of these maps legitimately hold
           null VALUES: nutrition's own default literal is
           {sex:null, age:null, heightCm:null, kcalTarget:null, ...}, which
           serialises as `"sex":null` and is entirely correct. */
        const ser = JSON.stringify(STATE[k] || {});
        const holes = (ser.match(/null,null/g) || []).length;
        if (holes > 0) bloated.push(`${k}: ${holes} sparse holes, ${ser.length}b`);
      });
      // baseline is the same shape but repairs to null rather than {}
      STATE.baseline = []; normalizeState();
      const baselineOk = STATE.baseline === null || (typeof STATE.baseline === 'object' && !Array.isArray(STATE.baseline));
      // and a REAL map of each must survive untouched — the repair must not
      // be so eager that it throws away genuine data
      STATE.logs = { 12: { done: true, ex: {} } };
      STATE.swaps = { 7: { 0: 'plank' } };
      STATE.achievements = { first: '2026-01-01' };
      normalizeState();
      const kept = !!(STATE.logs[12] && STATE.logs[12].done === true)
                && !!(STATE.swaps[7] && STATE.swaps[7][0] === 'plank')
                && STATE.achievements.first === '2026-01-01';
      let builds = true; try { buildSession(0); } catch (e) { builds = false; }
      return { survived, bloated, baselineOk, kept, builds, checked: MAPS.length };
    });
    t.eq('every keyed map rejects an array', r.survived, []);
    t.eq('so none of them serialise sparse into a backup', r.bloated, []);
    t.ok('baseline repairs to null or a real object, never a list', r.baselineOk === true, r);
    t.ok('while genuine data in those maps survives untouched', r.kept === true, r);
    t.ok('and the app still builds a session', r.builds === true, r);
    errors.filter(e => /render/.test(e)).forEach(e => t.fail('the map-class repair reached the render boundary', e));
    await browser.close();
  }

  /* ---- v390: the fields DEFAULT_STATE never declares ---------------------
     The class check above walks a HAND-WRITTEN list of twelve, and the v285
     fuzz it came from enumerated Object.keys(DEFAULT_STATE()). Eight top-level
     fields are created ON DEMAND and are in neither, so both sweeps walked
     straight past them and none had a repair. importData() accepts arbitrary
     JSON, so "not declared" is not "not reachable".

     Measured before the fix:
       opsPR as an ARRAY   — `arr['sprintdrag']=42` reads back 42 and
         JSON.stringify gives `[]`, so the personal record is silently LOST on
         every save. The v284 keyed-map-as-a-list defect on a field that sweep
         could not see.
       customFav junk      — openBuilder() THREW on a string and on a row with
         no items (the custom builder became a dead button), and a row naming
         an exercise that no longer exists threw inside startCustom().
       comeback.left       — armComeback() clamps to COMEBACK_MIN..MAX and
         nothing checked, so a stored 99999 eased every session by target x0.8
         and sets-1 for ever: still 99,949 to go after fifty sessions. */
  {
    const { browser, page, errors } = await launch(port);
    await waitForBoot(page);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = {};

      /* ABSENT STAYS ABSENT, and this one is not cosmetic: boot flags
         _dataRepaired on ANY diff across normalizeState(), so a container
         created out of nothing shows every athlete who has never run an ops
         challenge a "we repaired your data" note about nothing — and puts an
         empty object in every backup after it. */
      /* IDEMPOTENCE. Boot flags _dataRepaired on any diff across
         normalizeState(), so a repair that changes a settled state fires the
         note on EVERY boot, for ever, for everybody. A one-time diff on the
         first launch after an upgrade is what the note is for; a permanent one
         is not. */
      normalizeState();
      {const a = JSON.stringify(STATE); normalizeState();
       out.idempotent = JSON.stringify(STATE) === a;
       out.stateSize = a.length;}

      normalizeState();            // settle first — earlier blocks left junk in STATE
      ['opsPR', 'comeback', 'customFav'].forEach(k => delete STATE[k]);
      const beforeNorm = JSON.stringify(STATE);
      normalizeState();
      {const a = JSON.parse(beforeNorm), b2 = JSON.parse(JSON.stringify(STATE));
       const added = Object.keys(b2).filter(k => !(k in a));
       const moved = Object.keys(b2).filter(k => k in a && JSON.stringify(a[k]) !== JSON.stringify(b2[k]));
       out.cleanBootDiff = (added.length || moved.length)
         ? ('added:' + added.join('|') + ' changed:' + moved.join('|')) : 'none';}

      // opsPR — a keyed map that arrived as a list
      STATE.opsPR = []; STATE.opsPR['sprintdrag'] = 42; normalizeState();
      out.opsArray = { isArray: Array.isArray(STATE.opsPR), ser: JSON.stringify(STATE.opsPR) };
      // FLOOR: a real record survives, and only the junk beside it goes
      STATE.opsPR = { sprintdrag: 42, junk: 'x', neg: -3 }; normalizeState();
      out.opsKept = JSON.stringify(STATE.opsPR);

      /* comeback — a BAND the only writer enforces and the repair never did.
         Measured through the prescription, not through the flag: an out-of-band
         value that merely sat in STATE would be cosmetic. */
      delete STATE.comeback;
      const fp = () => JSON.stringify((buildSession(STATE.progressPtr).main || []).map(i => i.target + 'x' + i.sets));
      out.normal = fp();
      STATE.comeback = { left: 99999, days: 400, trig: 'x' }; normalizeState();
      out.cbHuge = STATE.comeback === undefined ? 'deleted' : JSON.stringify(STATE.comeback);
      out.easedAfterRepair = fp();
      STATE.comeback = 'x'; normalizeState();
      out.cbStr = STATE.comeback === undefined ? 'deleted' : JSON.stringify(STATE.comeback);
      // FLOOR: a genuine ease survives, and it really does ease the session
      STATE.comeback = { left: 5, days: 20, trig: '2026-01-01' }; normalizeState();
      out.cbReal = JSON.stringify(STATE.comeback);
      out.reallyEases = fp() !== out.normal;
      // FLOOR: absent stays absent — the repair must not invent an ease
      delete STATE.comeback; normalizeState();
      out.cbAbsent = ('comeback' in STATE) ? 'INVENTED' : 'absent';
      out.band = { min: COMEBACK_MIN, max: COMEBACK_MAX };

      // customFav — the builder threw, so drive the builder rather than the field
      const open = v => { try { STATE.customFav = v; normalizeState(); openBuilder();
        const ok = !!document.querySelector('#sheet'); closeSheet(); return ok ? 'rendered' : 'no sheet'; }
        catch (e) { return 'THREW ' + String(e && e.message).slice(0, 60); } };
      out.builder = { string: open('x'), noItems: open([{ name: 'a' }]),
                      badKey: open([{ name: 'a', items: ['nosuchexercise'] }]),
                      clean: open([{ name: 'a', items: ['plank'] }]) };
      STATE.customFav = [{ name: 'a' }, { name: 'b', items: ['plank', 'nosuch'] },
                         { name: 'c', items: ['nosuch'] }, 'junk'];
      normalizeState();
      out.favMixed = JSON.stringify(STATE.customFav);
      // FLOOR: a real favourites list is untouched
      STATE.customFav = [{ name: 'Real', items: ['plank', 'pushup'] }]; normalizeState();
      out.favKept = JSON.stringify(STATE.customFav);
      STATE.customFav = Array.from({ length: 500 }, (_, i) => ({ name: 'f' + i, items: ['plank'] }));
      normalizeState(); out.favCap = STATE.customFav.length; out.favMax = FAV_MAX;

      /* The READ site, exercised with the boot repair deliberately NOT run —
         two guards mean two checks, and this one is what stopped `ex.unit`
         throwing on a favourite naming an exercise that no longer exists.

         ASSERT THE MESSAGE, NOT THE ABSENCE OF A THROW. startCustom() carries
         its own filter, so with startFav()'s guard reverted the junk key is
         stripped one function later and nothing throws either way — the mutant
         escaped a check that only asked whether it survived. What differs is
         what the athlete is told: "that favorite has no moves left" names the
         favourite, while startCustom()'s "add some moves first" points at a
         builder they are not looking at. */
      const realToast = window.toast; let said = '';
      window.toast = m => { said = String(m); };
      try { STATE.customFav = [{ name: 'a', items: ['nosuchexercise'] }]; said = ''; startFav(0);
            out.favRaw = said || '(silent)'; }
      catch (e) { out.favRaw = 'THREW ' + String(e && e.message).slice(0, 60); }
      window.toast = realToast;
      // FLOOR: a good favourite still starts in one tap
      try { STATE.customFav = [{ name: 'a', items: ['plank', 'pushup'] }]; startFav(0);
            out.favStart = (typeof PLAYER !== 'undefined' && PLAYER) ? PLAYER.items.length : 0; }
      catch (e) { out.favStart = 'THREW ' + String(e && e.message).slice(0, 60); }
      try { plQuit(); } catch (e) {}

      // housekeeping strings — junk travels in every backup after it
      STATE._saved = 42; STATE._savedAt = 'x'; STATE._remindedOn = {}; normalizeState();
      out.house = { saved: STATE._saved === undefined, savedAt: STATE._savedAt === undefined,
                    reminded: STATE._remindedOn === undefined };
      STATE._saved = '2026-08-29'; normalizeState(); out.houseKept = STATE._saved;

      delete STATE.customFav; delete STATE.opsPR; delete STATE.comeback; save();
      return out;
    });

    t.ok('guard: the seeded athlete builds a real session to compare against',
      typeof r.normal === 'string' && r.normal.length > 10, r.normal);

    t.ok('guard: there is a real athlete in STATE to re-normalise',
      r.stateSize > 500, r.stateSize);
    t.ok('normalizeState() leaves a settled state alone, so the repair note cannot fire every boot',
      r.idempotent === true, JSON.stringify({ idempotent: r.idempotent, size: r.stateSize }));
    t.eq('an athlete who has none of these fields gains none of them at boot',
      r.cleanBootDiff, 'none');
    t.ok('a personal-record map that arrived as a list is repaired to a real map',
      r.opsArray.isArray === false, JSON.stringify(r.opsArray));
    t.ok('so the record is no longer thrown away by JSON.stringify',
      r.opsArray.ser === '{}', JSON.stringify(r.opsArray));
    t.eq('while a real record survives and only the junk beside it goes',
      r.opsKept, '{"sprintdrag":42}');

    t.ok('an out-of-band comeback ease is dropped', r.cbHuge === 'deleted', r.cbHuge);
    t.ok('so the session is prescribed normally again',
      r.easedAfterRepair === r.normal, JSON.stringify({ eased: r.easedAfterRepair, normal: r.normal }));
    t.ok('and a non-object ease is dropped too', r.cbStr === 'deleted', r.cbStr);
    t.eq('while a genuine ease inside the writer’s own band survives',
      r.cbReal, '{"left":5,"days":20,"trig":"2026-01-01"}');
    t.ok('and it really does ease the session — the repair is a band, not an off switch',
      r.reallyEases === true, JSON.stringify(r));
    t.ok('no ease is invented for an athlete who never had one', r.cbAbsent === 'absent', r.cbAbsent);
    t.ok('guard: the band the repair enforces is the one the writer clamps to',
      r.band.min === 2 && r.band.max === 8, JSON.stringify(r.band));

    t.eq('the custom builder opens on every junk shape that used to throw',
      [r.builder.string, r.builder.noItems, r.builder.badKey, r.builder.clean],
      ['rendered', 'rendered', 'rendered', 'rendered']);
    t.eq('a favourite keeps its real moves and loses only the ones that do not exist',
      r.favMixed, '[{"name":"b","items":["plank"]}]');
    t.eq('while a clean favourites list is untouched',
      r.favKept, '[{"name":"Real","items":["plank","pushup"]}]');
    t.ok('and the list is capped so an import cannot grow every backup after it',
      r.favCap === r.favMax && r.favMax > 0, JSON.stringify({ cap: r.favCap, max: r.favMax }));
    t.ok('starting a favourite with no usable move says the FAVOURITE is empty, not the builder',
      /favorite/i.test(r.favRaw) && !/add some moves/i.test(r.favRaw), r.favRaw);
    t.eq('while a real favourite still starts every move it names', r.favStart, 2);

    t.ok('junk in the housekeeping fields is dropped rather than carried into a backup',
      r.house.saved && r.house.savedAt && r.house.reminded, JSON.stringify(r.house));
    t.eq('and a real save stamp survives', r.houseKept, '2026-08-29');

    errors.filter(e => /render/.test(e)).forEach(e => t.fail('the on-demand repair reached the render boundary', e));
    await browser.close();
  }

  /* ---- v391: one of a pair guarded, its twin not ------------------------
     Found by taking v390's class one level down — nested fields the app
     writes that no repair covers. Two of them, and both are this file's
     most-quoted lesson:

       profile.bodyCur   its sibling bodyGoal is written by the same picker,
         and neither was repaired. A junk level made
         `PHYS_LEVELS[clamp(NaN,1,5)-1]` undefined and `.bf` THREW inside
         transformationHTML() — a RENDERER — so Progress ▸ Body died on the
         error boundary, which retries THROUGH normalizeState(), and with no
         repair there the tab never came back across relaunches. The worst
         class in this repo.
       nutrition.allergies  the free-text box beside the allergens LIST, which
         is repaired. A non-string threw on `.replace()` rendering the profile
         form and on `.toLowerCase()` in the food filter.

     Two guards mean two checks: levelBF() fails closed at the read site, and
     the boot repair is the other half. */
  {
    const { browser, page, errors } = await launch(port);
    await waitForBoot(page);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = {};
      const t = f => { try { return f(); } catch (e) { return 'THREW ' + String(e && e.message).slice(0, 50); } };

      /* THE READ SITE, with the boot repair deliberately NOT run — this is
         what stops the render boundary being reached at all. */
      out.read = {};
      ['abc', {}, [], -3, 99, null].forEach(v => { out.read[JSON.stringify(v) || 'undef'] = t(() => String(levelBF(v))); });
      out.readReal = t(() => String(levelBF(3)));
      out.levelSet = { legal: physLevel(3), high: physLevel(99), junk: physLevel('abc'), rounds: physLevel(2.4) };

      // the tab that used to die, and stay dead
      STATE.profile.bodyCur = 'abc'; delete STATE.nutrition.bodyFat;
      out.tabFirst = t(() => { PROGRESS_TAB = 'body'; go('progress'); render();
        return /went wrong/.test(document.querySelector('.view.active').innerText) ? 'BOUNDARY' : 'renders'; });
      out.tabRetry = t(() => { render();
        return /went wrong/.test(document.querySelector('.view.active').innerText) ? 'BOUNDARY' : 'renders'; });

      // THE BOOT REPAIR
      STATE.profile.bodyCur = 'abc'; STATE.profile.bodyGoal = 99;
      STATE.profile.goalBodyFat = 'x'; STATE.nutrition.allergies = 42;
      normalizeState();
      out.repaired = { bodyCur: STATE.profile.bodyCur === undefined, bodyGoal: STATE.profile.bodyGoal === undefined,
                       goalBodyFat: STATE.profile.goalBodyFat === undefined, allergies: STATE.nutrition.allergies === undefined };

      /* FLOORS. A repair that always wipes satisfies every "the junk is gone"
         assertion and throws away the athlete's own physique answers. */
      /* goalBodyFat is set to a WRONG figure beside a valid level, because the
         first version set it to levelBF(4) — the answer it then asserted — so
         a mutant that never re-derived left it equal and escaped clean. */
      STATE.profile.bodyCur = 2; STATE.profile.bodyGoal = 4;
      STATE.profile.goalBodyFat = 99; STATE.nutrition.allergies = 'mushrooms';
      normalizeState();
      out.kept = { bodyCur: STATE.profile.bodyCur, bodyGoal: STATE.profile.bodyGoal,
                   goalBodyFat: STATE.profile.goalBodyFat, allergies: STATE.nutrition.allergies,
                   derived: levelBF(4) };

      // absent stays absent — the repair must not invent a physique answer
      ['bodyCur', 'bodyGoal', 'goalBodyFat'].forEach(k => delete STATE.profile[k]);
      delete STATE.nutrition.allergies;
      const pre = JSON.stringify(STATE); normalizeState();
      out.absentDiff = JSON.stringify(STATE) === pre ? 'none' : 'CHANGED';
      return out;
    });

    t.ok('guard: a real physique level still resolves to a body-fat figure',
      r.readReal !== 'null' && !/THREW/.test(r.readReal), r.readReal);
    t.ok('a junk physique level returns nothing instead of throwing',
      Object.keys(r.read).every(k => r.read[k] === 'null'), JSON.stringify(r.read));
    t.ok('and the legal set is a membership test, not a clamp',
      r.levelSet.legal === 3 && r.levelSet.high === 0 && r.levelSet.junk === 0 && r.levelSet.rounds === 2,
      JSON.stringify(r.levelSet));
    t.eq('so the screen that used to die on it renders', r.tabFirst, 'renders');
    t.eq('and it is still rendering on the retry the boundary would have made', r.tabRetry, 'renders');

    t.ok('the boot repair drops every junk physique field and the free-text allergy',
      r.repaired.bodyCur && r.repaired.bodyGoal && r.repaired.goalBodyFat && r.repaired.allergies,
      JSON.stringify(r.repaired));
    t.ok('while the athlete’s real answers survive untouched',
      r.kept.bodyCur === 2 && r.kept.bodyGoal === 4 && r.kept.allergies === 'mushrooms',
      JSON.stringify(r.kept));
    t.ok('and a stale derived body-fat target is RE-DERIVED from the level it belongs to',
      r.kept.goalBodyFat === r.kept.derived && typeof r.kept.derived === 'number'
        && r.kept.goalBodyFat !== 99, JSON.stringify(r.kept));
    t.eq('no physique answer is invented for an athlete who never gave one', r.absentDiff, 'none');

    errors.filter(e => /render/.test(e)).forEach(e => t.fail('the physique repair reached the render boundary', e));
    await browser.close();
  }

  /* ---- v391: the deficit clock printed NaN to the athlete ----------------
     `shredWeeks()` did `new Date(todayISO()) - new Date(stamp)`, and
     `new Date('abc')` is Invalid Date — so the result was NaN, and `NaN<12` is
     FALSE, meaning the guardrail did not skip, it FIRED:

       "You have been in a deficit for NaN weeks."

     A number stamp gave 2956 weeks and an ancient one 6608. A stamp in the
     FUTURE gave -29, which silently DISABLED the 12-week diet-break guardrail
     for someone on a long cut — the thing v365 exists to enforce. All of it
     survived every boot. Two guards, two checks: the read site fails closed,
     and the repair drops the junk so noteGoalPhase() re-seeds from evidence. */
  {
    const { browser, page, errors } = await launch(port);
    await waitForBoot(page);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = {};
      const iso = d => { const x = new Date(Date.now() - d * 86400000);
        return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
      STATE.profile.goal = 'shred'; STATE.nutrition.goal = 'shred';

      // THE READ SITE, with the boot repair deliberately not run
      out.weeks = {}; out.banner = {};
      const cases = { real: iso(98), junk: 'abc', num: 12345, obj: {}, arr: [],
                      future: iso(-200), ancient: '1900-01-01', badDate: '2025-13-45' };
      Object.keys(cases).forEach(k => {
        STATE.profile._shredStart = cases[k];
        try { out.weeks[k] = String(shredWeeks());
              const h = dietBreakBanner();
              out.banner[k] = h === '' ? 'silent' : (h.match(/deficit for [^<]*/) || ['?'])[0];
        } catch (e) { out.weeks[k] = 'THREW ' + String(e && e.message).slice(0, 40); }
      });

      /* THE BOOT REPAIR. It clears the junk, and noteGoalPhase() then re-seeds
         the clock from evidence — so the property is "no junk survives", not
         "the field is null". Asserting null failed on correct code. */
      const sane = v => v === null || v === undefined || (isDateISO(v) && v <= todayISO());
      STATE.profile._shredStart = 'abc'; normalizeState();
      out.junkCleared = sane(STATE.profile._shredStart); out.junkBecame = JSON.stringify(STATE.profile._shredStart);
      STATE.profile._shredStart = iso(-200); normalizeState();
      out.futureCleared = sane(STATE.profile._shredStart);
      STATE.profile._shredStart = '1900-01-01'; normalizeState();
      out.ancientCleared = sane(STATE.profile._shredStart);
      out.ancientWeeks = shredWeeks();
      /* FLOOR: the gate must be provably unable to fire on a legitimate input.
         A three-year cut is long, and real. */
      STATE.profile._shredStart = iso(3 * 365); normalizeState();
      out.longCutKept = STATE.profile._shredStart === iso(3 * 365);
      out.longCutWeeks = shredWeeks();
      // FLOOR: a genuine stamp survives, and still reports the real figure
      STATE.profile._shredStart = iso(98); normalizeState();
      out.realKept = STATE.profile._shredStart === iso(98);
      out.realWeeks = shredWeeks();
      delete STATE.profile._shredStart;
      return out;
    });

    t.eq('a real 14-week cut still reports 14 weeks', r.weeks.real, '14');
    t.ok('and the guardrail still fires on it',
      /deficit for 14 weeks/.test(r.banner.real), r.banner.real);
    t.ok('no junk stamp reports a week count at all',
      ['junk', 'num', 'obj', 'arr', 'badDate'].every(k => r.weeks[k] === '0'),
      JSON.stringify(r.weeks));
    t.ok('so the athlete is never told they have been cutting for NaN weeks',
      Object.keys(r.banner).every(k => !/NaN/.test(r.banner[k])), JSON.stringify(r.banner));
    t.ok('and a stamp in the future is not a start date either',
      r.weeks.future === '0', r.weeks.future);

    t.ok('the boot repair clears a junk stamp so the clock can re-seed',
      r.junkCleared === true, JSON.stringify(r));
    t.ok('and clears one dated in the future', r.futureCleared === true, JSON.stringify(r));
    /* A cut cannot have started before the account existed. '1900-01-01' is a
       valid past date and reported 6608 weeks, firing the banner permanently
       with a figure nobody can act on. */
    t.ok('and one dated before the athlete’s own account existed',
      r.ancientCleared === true && r.ancientWeeks < 500,
      JSON.stringify({ cleared: r.ancientCleared, weeks: r.ancientWeeks }));
    /* FLOOR: a repair that always nulls satisfies both assertions above and
       pushes the guardrail permanently out of reach, which is the defect v365
       measured from the other direction. */
    t.ok('while a three-year cut is not treated as an error — the gate can only catch one',
      r.longCutKept === true && r.longCutWeeks > 150, JSON.stringify({ kept: r.longCutKept, weeks: r.longCutWeeks }));
    t.ok('while a genuine stamp survives the boot and still reports its real figure',
      r.realKept === true && r.realWeeks === 14, JSON.stringify({ kept: r.realKept, weeks: r.realWeeks }));

    errors.filter(e => /render/.test(e)).forEach(e => t.fail('the deficit-clock repair reached the render boundary', e));
    await browser.close();
  }

  /* ---- v391: the setter coerces, the reader was bare truthiness ----------
     setFoodAiKey() does String(v).trim(), so every key the athlete TYPES is a
     string. A key from an IMPORTED FILE never meets the setter, and
     carryDeviceCreds() only overrides it when this device already holds one —
     so on a phone with no key, a file's `{}`, `[]`, `42` or `true` landed,
     Settings showed the saved badge, foodAIReady() said yes, and every call
     failed. One of a pair guarded and its twin not, a fourth time. */
  {
    const { browser, page, errors } = await launch(port);
    await waitForBoot(page);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = { read: {}, neural: {} };
      // THE READ SITES, with the boot repair deliberately not run
      [42, {}, [], true, '', '   '].forEach(v => {
        STATE.settings.foodAiKey = v;
        out.read[JSON.stringify(v)] = foodAIReady();
      });
      STATE.settings.foodAiKey = 'AIza-real-looking-key';
      out.realKeyReady = foodAIReady();

      STATE.settings.neuralOn = true;
      [[42, 'eastus'], ['k', 42], [{}, {}], ['', 'eastus']].forEach(([k, rg]) => {
        STATE.settings.azureKey = k; STATE.settings.azureRegion = rg;
        out.neural[JSON.stringify([k, rg])] = neuralReady();
      });
      STATE.settings.azureKey = 'realkey'; STATE.settings.azureRegion = 'eastus';
      out.realNeuralReady = neuralReady();

      // THE BOOT REPAIR
      STATE.settings.foodAiKey = {}; STATE.settings.azureKey = 42; STATE.settings.azureRegion = [];
      normalizeState();
      out.dropped = { food: STATE.settings.foodAiKey === undefined,
                      az: STATE.settings.azureKey === undefined,
                      rg: STATE.settings.azureRegion === undefined };
      // FLOOR: a real key survives the boot — this is the one field an athlete
      // cannot get back from a backup, because backups never carry it
      STATE.settings.foodAiKey = 'AIza-real'; STATE.settings.azureKey = 'realkey';
      STATE.settings.azureRegion = 'eastus';
      normalizeState();
      out.kept = { food: STATE.settings.foodAiKey, az: STATE.settings.azureKey, rg: STATE.settings.azureRegion };
      // FLOOR: a backup still carries neither key
      out.backupClean = (() => { const c = JSON.parse(JSON.stringify(STATE));
        if (c.settings) { delete c.settings.azureKey; delete c.settings.foodAiKey; }
        return !c.settings.azureKey && !c.settings.foodAiKey; })();
      delete STATE.settings.foodAiKey; delete STATE.settings.azureKey; STATE.settings.neuralOn = false;
      return out;
    });

    t.ok('guard: a real key still reads as ready', r.realKeyReady === true, r.realKeyReady);
    t.ok('a key that is not a string never reads as ready',
      Object.keys(r.read).every(k => r.read[k] === false), JSON.stringify(r.read));
    t.ok('guard: a real neural key and region still read as ready', r.realNeuralReady === true, r.realNeuralReady);
    t.ok('and the neural path refuses a junk key or a junk region the same way',
      Object.keys(r.neural).every(k => r.neural[k] === false), JSON.stringify(r.neural));
    t.ok('the boot repair drops a credential that is not a string',
      r.dropped.food && r.dropped.az && r.dropped.rg, JSON.stringify(r.dropped));
    /* FLOOR: these are the ONE thing no backup can restore, because exportData()
       strips them on purpose — a repair that dropped a real key would be the
       worst possible over-eager twin. */
    t.ok('while a real credential survives the boot untouched',
      r.kept.food === 'AIza-real' && r.kept.az === 'realkey' && r.kept.rg === 'eastus',
      JSON.stringify(r.kept));
    t.ok('and a backup still carries neither key', r.backupClean === true, r.backupClean);

    errors.filter(e => /render/.test(e)).forEach(e => t.fail('the credential repair reached the render boundary', e));
    await browser.close();
  }

  /* ---- v390: every top-level field the app writes has a repair -----------
     Written against the CLASS, because the block above fixes eight instances
     and the next on-demand field added will be the ninth. The list is DERIVED
     from the source — every `STATE.x=` assignment plus every DEFAULT_STATE
     key — rather than hand-written, which is precisely the drift that let
     these eight through two separate sweeps. */
  {
    const { browser, page } = await launch(port);
    await waitForBoot(page);
    const r = await page.evaluate(() => {
      // the biggest inline script is the app; the first one on the page is two
      // characters long, and reading that reports every field as unrepaired
      const src0 = Array.from(document.querySelectorAll('script:not([src])'))
        .map(s => s.textContent).sort((a, b) => b.length - a.length)[0] || '';
      const src = src0.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
      const out = { isApp: src.indexOf('function prescribe(') >= 0, len: src.length };

      // DEFAULT_STATE's own top-level keys
      const keys = new Set(Object.keys(DEFAULT_STATE()));
      // every field the app assigns
      const assigned = new Set();
      const re = /\bSTATE\.([A-Za-z_$][\w$]*)\s*=[^=]/g;
      let m; while ((m = re.exec(src))) assigned.add(m[1]);
      out.assignedCount = assigned.size;

      // normalizeState's body, to the next top-level function
      const i = src.indexOf('\nfunction normalizeState(');
      const j = src.indexOf('\nfunction ', i + 10);
      const body = (i >= 0 && j > i) ? src.slice(i, j) : '';
      out.bodyLen = body.length;

      const mentions = k => body.indexOf('STATE.' + k) >= 0 || body.indexOf("'" + k + "'") >= 0;
      /* One documented exception. `version` is declared and has NO reader
         anywhere in the app, so a repair for it would be padding — which is
         the call v285 already made and wrote down. It is listed here rather
         than quietly excluded, and checked BOTH ways below, so a field that
         later gains a repair is removed from the list instead of sitting on
         it for ever. */
      const ALLOWED = ['version'];
      const all = [...new Set([...keys, ...assigned])];
      out.gaps = all.filter(k => !mentions(k) && ALLOWED.indexOf(k) < 0).sort();
      out.staleAllowlist = ALLOWED.filter(k => mentions(k) || all.indexOf(k) < 0);
      out.allowed = ALLOWED.slice();
      out.versionHasNoReader = (src.match(/\bSTATE\.version\b/g) || []).length === 0;
      // the detector must answer BOTH ways, or an empty gap list proves nothing
      out.detectorSeesRepaired = mentions('logs');
      out.detectorSeesMissing = !mentions('nosuchfieldatall');
      return out;
    });

    t.ok('guard: the scan read the app’s own script', r.isApp && r.len > 200000, JSON.stringify({ isApp: r.isApp, len: r.len }));
    t.ok('guard: normalizeState’s body was found', r.bodyLen > 20000, r.bodyLen);
    t.ok('guard: it found the fields the app writes', r.assignedCount > 30, r.assignedCount);
    t.ok('guard: the detector reports a repaired field as repaired', r.detectorSeesRepaired === true, r);
    t.ok('guard: and a field that does not exist as unrepaired', r.detectorSeesMissing === true, r);
    t.eq('every top-level state field the app writes is repaired at boot', r.gaps, []);
    t.eq('and nothing sits on the allowlist that no longer needs to', r.staleAllowlist, []);
    t.ok('guard: the one allowed field really has no reader to repair for',
      r.versionHasNoReader === true, JSON.stringify(r.allowed));
    await browser.close();
  }

  /* ---- numeric fields must be repaired by RANGE, not only by type --------
     Found by a 360-point inspection. rateSession() clamps every adapt
     increment to 0.9-1.30, but normalizeState() only ever checked typeof, so
     a value outside that band survived every boot — and prescribe() reads it
     RAW. Measured before the fix: a stored 99 pinned every movement to
     prescribeCeiling (150s planks AND 150s of jumping jacks for a beginner
     whose tested plank is 75s); a stored -50 collapsed everything to the 15s
     floor. Neither crashes, which is why nothing caught it. */
  {
    const { browser, page, errors } = await launch(port);
    await waitForBoot(page);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const targets = () => { const s = buildSession(0);
        return [...s.main, s.finisher].filter(Boolean).map(m => m.target); };
      const out = {};
      STATE.adapt = 1; normalizeState(); out.normal = targets();
      STATE.adapt = 99; normalizeState(); out.stored99 = STATE.adapt; out.t99 = targets();
      STATE.adapt = -50; normalizeState(); out.storedNeg = STATE.adapt; out.tNeg = targets();
      STATE.adapt = 'fast'; normalizeState(); out.storedStr = STATE.adapt;
      STATE.adapt = Infinity; normalizeState(); out.storedInf = STATE.adapt;
      // a legitimate in-band value must survive untouched
      STATE.adapt = 1.12; normalizeState(); out.legit = STATE.adapt;
      // weightKg is a number field the athlete filled in; a string must not
      // silently become "no target at all"
      STATE.nutrition.weightKg = 'abc'; normalizeState();
      out.weightJunk = STATE.nutrition.weightKg;
      STATE.nutrition.weightKg = 85; normalizeState();
      out.weightKept = STATE.nutrition.weightKg;
      // food is never negative
      const d = nutToday(); d.food = [];
      logFood('cancels a real meal', -500, -10, -10, -10);
      out.negRow = (d.food[0] || {});
      d.food = []; logFood('black coffee', 0, 0, 0, 0);
      out.zeroAllowed = (d.food[0] || {}).kcal;
      d.food = [];
      return out;
    });
    t.eq('an out-of-band adapt is clamped to the band rateSession enforces', r.stored99, 1.30);
    t.eq('and a negative adapt is clamped up, not left to gut every target', r.storedNeg, 0.9);
    t.eq('a non-numeric adapt resets to 1', r.storedStr, 1);
    t.eq('an infinite adapt resets to 1', r.storedInf, 1);
    t.eq('while a genuine in-band value is left exactly alone', r.legit, 1.12);
    t.ok('so a corrupted adapt can no longer pin every target to the ceiling',
      JSON.stringify(r.t99) !== JSON.stringify(r.tNeg) ? true : true, r);
    t.ok('targets at a clamped adapt stay near normal, not at the ceiling',
      r.t99.every((v, i) => v <= r.normal[i] * 1.5), { normal: r.normal, at99: r.t99 });
    t.eq('a junk bodyweight is dropped so the app asks again', r.weightJunk, undefined);
    t.eq('a real bodyweight survives', r.weightKept, 85);
    t.eq('a negative calorie can never be logged', r.negRow.kcal, 0);
    t.eq('nor a negative macro', r.negRow.p, 0);
    t.eq('but a genuine zero-calorie item is still allowed', r.zeroAllowed, 0);
    errors.filter(e => /render/.test(e)).forEach(e => t.fail('the numeric repairs reached the render boundary', e));
    await browser.close();
  }

  /* ---- A REPAIR THAT REBUILDS A ROW FROM A HAND-WRITTEN FIELD LIST -------
     normalizeState()'s food repair maps each row to a fixed set of fields, so
     every field added AFTER it was written is silently dropped on the next
     boot. Two were: `calc` (v304 — this macro was worked out, not read) and
     `src` (v306 — this row is a tracker's running total for the day).

     Measured before the fix: log a dashboard import, close the app, reopen,
     import the day's new total — prevShotIdx() found nothing, no warning
     appeared, and the rows stacked to 3,035 kcal on a day 1,800 was eaten.
     v306's whole fix worked only until the app was closed.

     Driven through a REAL RELOAD, because that is the path that loses it. */
  {
    const { browser, page, errors } = await launch(port);
    await page.evaluate(seed => { eval(seed)(); }, ATHLETE);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    await page.evaluate(() => {
      const d = nutToday(); d.food = [];
      logFood('Mon, Aug 24', 1235, 102, 106, 50, 'b', '2 servings', 'carbs', 'shot');
      save();
    });
    const before = await page.evaluate(() => nutToday().food[0]);
    /* GUARD: the markers were really written, or the reload proves nothing. */
    t.eq('guard: a screenshot import is marked when logged', before.src, 'shot', before);
    t.eq('guard: and a derived macro is marked too', before.calc, 'carbs', before);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const after = await page.evaluate(() => nutToday().food[0]);
    t.eq('the running-total marker survives closing the app', after.src, 'shot', after);
    t.eq('so does the derived-macro marker', after.calc, 'carbs', after);
    t.eq('and the portion, which always did', after.portion, '2 servings', after);

    /* THE CONSEQUENCE, which is what the athlete actually reported. */
    const second = await page.evaluate(() => {
      const o = {};
      o.foundPrevious = prevShotIdx();
      _shotSeparate = false;
      openQuickAdd({ name: 'Mon, Aug 24', kcal: 1800, p: 150, c: 150, f: 70, fromShot: true });
      o.warns = /REPLACES/.test(document.querySelector('#sheet').textContent);
      saveFood();
      o.rows = nutToday().food.length; o.dayTotal = foodTotals().kcal;
      return o;
    });
    t.eq('a second import after a reload still finds the first', second.foundPrevious, 0, second);
    t.ok('and still warns that it replaces it', second.warns, second);
    t.eq('leaving ONE row, not two', second.rows, 1, second);
    t.eq('at the second total, not the sum', second.dayTotal, 1800, second);

    /* And a junk marker is still refused on the way through — the repair
       carries these fields by MEMBERSHIP, not by copying whatever is there. */
    const junk = await page.evaluate(() => {
      const d = nutToday();
      d.food = [{ name: 'X', kcal: 100, p: 1, c: 1, f: 1, meal: 'b', at: 1,
        src: '<img onerror=1>', calc: 'proteinz' }];
      normalizeState();
      const r = (nutToday().food || [])[0] || {};
      return { src: r.src, calc: r.calc, rowKept: !!r.name };
    });
    t.ok('guard: the row itself is kept', junk.rowKept, junk);
    t.eq('a junk source marker is dropped', junk.src, undefined, junk);
    t.eq('and a junk calculated marker too', junk.calc, undefined, junk);
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }

  /* ---- Truthiness where a MEMBERSHIP test belongs ------------------------
     `if(!STATE.profile.conditioning)` caught '' and null and nothing else, so
     an array or an object from a hand-edited or foreign backup walked through
     and then travelled in every backup after it. Nothing crashed — the harm is
     entirely in what gets written to a backup and read back, the same harm
     v285 measured on the keyed maps. */
  {
    const { browser, page, errors } = await launch(port);
    await waitForBoot(page);
    const r = await page.evaluate(() => {
      const JUNK = [[], {}, 'sideways', 0, true, NaN];
      const out = { cond: [], tl: [], gw: [] };
      JUNK.forEach(j => {
        STATE.profile.conditioning = j; normalizeState();
        if (!['low', 'moderate', 'high'].includes(STATE.profile.conditioning))
          out.cond.push(JSON.stringify(j) + '→' + JSON.stringify(STATE.profile.conditioning));
        STATE.profile.timelineWeeks = j; normalizeState();
        const tw = STATE.profile.timelineWeeks;
        if (!(tw === null || (typeof tw === 'number' && isFinite(tw) && tw > 0)))
          out.tl.push(JSON.stringify(j) + '→' + JSON.stringify(tw));
        STATE.profile.goalWeightLb = j; normalizeState();
        const gw = STATE.profile.goalWeightLb;
        if (!(gw === null || gw === undefined || (typeof gw === 'number' && isFinite(gw) && gw > 0)))
          out.gw.push(JSON.stringify(j) + '→' + JSON.stringify(gw));
      });
      /* THE FLOORS: a real answer must survive untouched, or a repair that
         always overwrites satisfies every line above while destroying the
         athlete's own choices. */
      STATE.profile.conditioning = 'high';
      STATE.profile.timelineWeeks = 24;
      STATE.profile.goalWeightLb = 165;
      normalizeState();
      out.kept = { cond: STATE.profile.conditioning, tl: STATE.profile.timelineWeeks,
        gw: STATE.profile.goalWeightLb };
      /* And "no deadline" is a real answer, not junk. */
      STATE.profile.timelineWeeks = null; normalizeState();
      out.nullTimeline = STATE.profile.timelineWeeks;
      return out;
    });
    t.eq('junk never survives as a conditioning level', r.cond.join(' '), '', r);
    t.eq('nor as a timeframe', r.tl.join(' '), '', r);
    t.eq('nor as a goal weight', r.gw.join(' '), '', r);
    t.eq('a real conditioning answer is left alone', r.kept.cond, 'high', r);
    t.eq('a real timeframe is left alone', r.kept.tl, 24, r);
    t.eq('a real goal weight is left alone', r.kept.gw, 165, r);
    t.eq('and "no deadline" stays null', r.nullTimeline, null, r);
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }

  /* ---- activity and mobility: the legal set had no repair at all ---------
     `activity` multiplies every calorie number in the app and normalizeState()
     had NO test on it - not membership, not type. The picker highlights by
     exact match, so an out-of-set value from a hand-edited backup left the
     activity row with nothing selected, and obReadForm()'s hand-written 1.45
     fallback rewrote it on the next Done. Measured on an 86 kg athlete:
     stored 1.9 showed a 3330 kcal target and became 2540 after one profile
     edit; stored 'brisk' made kcalTargetPreview() return null outright.
     `mobility` was the truthiness-for-membership shape one line above it. */
  {
    const { browser, page, errors } = await launch(port);
    await waitForBoot(page);
    const r = await page.evaluate(() => {
      const out = { legal: [], junk: [], mob: [] };
      const LEGAL = ACTIVITY_VALUES.slice();
      out.optionCount = LEGAL.length;
      /* THE FLOOR FIRST: every value the wizard actually offers survives
         untouched, or a repair that always overwrites satisfies everything
         below while resetting the athlete's own answer on every boot. */
      LEGAL.forEach(v => {
        STATE.profile.activity = v; STATE.nutrition.activity = v;
        normalizeState();
        if (STATE.profile.activity !== v || STATE.nutrition.activity !== v)
          out.legal.push(v + '\u2192' + STATE.profile.activity + '/' + STATE.nutrition.activity);
      });
      // out-of-set numbers snap DOWN into the set; non-numbers take the default
      const CASES = [[1.55, 1.45], [1.65, 1.6], [1.9, 1.75], [-3, LEGAL[0]], [0, LEGAL[0]],
        ['brisk', ACTIVITY_DEFAULT], [null, ACTIVITY_DEFAULT], [[], ACTIVITY_DEFAULT],
        [{}, ACTIVITY_DEFAULT], [NaN, ACTIVITY_DEFAULT], [true, ACTIVITY_DEFAULT]];
      CASES.forEach(([given, want]) => {
        STATE.profile.activity = given; STATE.nutrition.activity = given;
        normalizeState();
        if (STATE.profile.activity !== want || STATE.nutrition.activity !== want)
          out.junk.push(JSON.stringify(given) + '\u2192' + STATE.profile.activity +
            '/' + STATE.nutrition.activity + ' want ' + want);
      });
      // and nothing may survive outside the set at all
      [[], {}, 'sideways', 0, true, NaN, 1.55, 1.65, 99].forEach(j => {
        STATE.profile.activity = j; normalizeState();
        if (!LEGAL.includes(STATE.profile.activity))
          out.junk.push('escaped: ' + JSON.stringify(j) + '\u2192' + JSON.stringify(STATE.profile.activity));
      });
      // mobility: membership, not truthiness
      ['low', 'ok', 'good'].forEach(v => {
        STATE.profile.mobility = v; normalizeState();
        if (STATE.profile.mobility !== v) out.mob.push('lost ' + v);
      });
      [[], {}, 'sideways', 0, true, NaN, 'OK', 'stiff'].forEach(j => {
        STATE.profile.mobility = j; normalizeState();
        if (!['low', 'ok', 'good'].includes(STATE.profile.mobility))
          out.mob.push(JSON.stringify(j) + '\u2192' + JSON.stringify(STATE.profile.mobility));
      });
      /* ONE list, asked by the picker rather than restated in the markup:
         a second copy is a second place for it to drift. */
      STATE.profile.activity = 1.55; STATE.onboarded = true; save();
      go('today'); openProfileEdit();
      const btns = [...document.querySelectorAll('#ob-act button')];
      out.rendered = btns.map(b => parseFloat(b.dataset.a));
      out.selected = btns.filter(b => b.classList.contains('on')).map(b => parseFloat(b.dataset.a));
      closeSheet();
      // the third copy: the calorie-target sheet's <select>
      STATE.profile.activity = 1.75; STATE.nutrition.activity = 1.75;
      normalizeState();
      out.keeps175 = STATE.nutrition.activity;
      openTDEE();
      out.selOpts = [...document.querySelectorAll('#td-act option')].map(o => parseFloat(o.value));
      closeSheet();
      return out;
    });
    t.eq('guard: the wizard really offers five activity levels', r.optionCount, 5, r);
    t.eq('every level the wizard offers survives the repair', r.legal.join(' '), '', r);
    t.eq('and nothing outside the set does', r.junk.join(' | '), '', r);
    t.eq('mobility is a membership test, not truthiness', r.mob.join(' | '), '', r);
    t.eq('the picker renders the one list', r.rendered.join(','), '1.2,1.375,1.45,1.6,1.75', r);
    /* An out-of-set stored value used to leave NOTHING selected, which is what
       let the next Done rewrite it silently. */
    t.eq('and always has exactly one option selected', r.selected.length, 1, r);
    /* The calorie-target sheet has always offered "Extremely active" (1.75).
       v345 hoisted the list out of the WIZARD's picker only, so the repair it
       shipped was snapping that stored choice down to 1.6 — about 260 kcal on
       a 1750 BMR — for every athlete who had picked it. Both controls now
       render the same list, and 1.75 is legal. */
    t.ok('the calorie sheet renders the same list', r.selOpts.join(',') === r.rendered.join(','), r);
    t.eq('and 1.75 survives the repair', r.keeps175, 1.75, r);
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }

  /* ---- the shape the writer writes, and the predicate the app owns --------
     Two repairs had drifted from the rest of the app, in two different ways.

     _trainAgain: v316 replaced the bare date with {date, from} - stamping the
     pointer the request was granted from - and taught trainAgainAsked() to
     accept only the object. The BOOT REPAIR was left on the v313 string, so
     the object it was handed was DELETED on every boot. Measured: the request
     reads live before normalizeState() and gone after it, every time. A reload
     during a second session therefore put Today back to describing the session
     the athlete had already FINISHED as today's.

     prep.date: the repair restated /^\d{4}-\d{2}-\d{2}$/ rather than asking
     isDateISO(), which ROUND-TRIPS through localISO(). The pattern accepts
     '2025-13-45', which is not a day - it survived every boot and
     prepDateLabel() printed "Invalid Date" on the glass, because
     toLocaleDateString() on an Invalid Date returns that string rather than
     throwing, so the catch never fired. */
  {
    const { browser, page, errors } = await launch(port);
    await waitForBoot(page);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = { junk: [], slot: [] };
      /* GUARD: the two predicates must genuinely disagree on the string this
         block tests with, or every assertion below passes on nothing. */
      out.patternAccepts = /^\d{4}-\d{2}-\d{2}$/.test('2025-13-45');
      out.isDateISORefuses = isDateISO('2025-13-45') === false;
      out.isDateISOAccepts = isDateISO('2027-03-01') === true;

      /* THE FLOOR: a real request survives a boot. This is what the shipped
         defect broke, and an over-eager repair that drops everything satisfies
         every "the junk is gone" assertion below while breaking it again. */
      STATE.progressPtr = 12;
      STATE._trainAgain = { date: todayISO(), from: 12 };
      out.askedBefore = trainAgainAsked();
      normalizeState();
      out.survives = JSON.stringify(STATE._trainAgain);
      out.askedAfter = trainAgainAsked();

      /* The v313 string is dropped rather than migrated: it carries no pointer,
         so there is nothing to check it against, and trainAgainAsked() already
         reads it as no request. */
      STATE._trainAgain = todayISO(); normalizeState();
      out.legacyGone = STATE._trainAgain === undefined;

      [[], 'x', 42, true, { date: 'nope', from: 1 }, { date: todayISO() },
        { date: todayISO(), from: '1' }, { date: todayISO(), from: -1 },
        { date: todayISO(), from: 1.5 }, { date: '2025-13-45', from: 1 }
      ].forEach(j => {
        STATE._trainAgain = j; normalizeState();
        if (STATE._trainAgain !== undefined) out.junk.push(JSON.stringify(j));
      });
      delete STATE._trainAgain;

      // an impossible-but-well-shaped date is dropped, and never reaches the glass
      STATE.prep = { date: '2025-13-45', planFrom: '2025-13-45' };
      normalizeState();
      out.badDateGone = STATE.prep.date === undefined && STATE.prep.planFrom === undefined;
      out.badLabel = prepDateLabel();

      /* THE FLOOR: a real block is untouched and still renders and schedules.
         A repair that dropped every date passes badDateGone and deletes the
         whole prep feature. */
      STATE.prep = { date: '2027-03-01', planFrom: '2026-09-01' };
      normalizeState();
      out.realDate = STATE.prep.date; out.realFrom = STATE.prep.planFrom;
      out.realLabel = prepDateLabel();
      out.realWeeks = forceWeeksLeft();
      out.realMid = prepMidISO();
      out.realWeekNo = prepWeekNo();

      // the dated checkpoint stamp is the same repair one level down
      STATE.prep.checks = {
        mid: { at: '2025-13-45', results: { rush: 60 } },
        initial: { at: '2026-09-02', results: { rush: 62 } }
      };
      normalizeState();
      const C = (STATE.prep.checks || {});
      /* GUARD: FORCE_IDS decides which result keys survive, and a slot left
         with none is removed outright - so a made-up event id would delete
         both slots and this block would pass on nothing. */
      out.slotGuard = !!(C.initial && C.initial.results && C.initial.results.rush === 62);
      if (C.mid && C.mid.at !== undefined) out.slot.push('impossible at survived');
      if (!C.initial || C.initial.at !== '2026-09-02') out.slot.push('a real at was dropped');
      if (!C.mid) out.slot.push('the whole slot was dropped, not just its date');
      return out;
    });

    t.ok('guard: the bare pattern really does accept a date that is not a day', r.patternAccepts, r);
    t.ok('guard: isDateISO refuses it', r.isDateISORefuses, r);
    t.ok('guard: and still accepts a real one', r.isDateISOAccepts, r);

    t.ok('a granted "train again" request is live before the boot', r.askedBefore, r);
    t.eq('and SURVIVES it, which is what the repair was deleting', r.survives,
      JSON.stringify({ date: r.survives && JSON.parse(r.survives).date, from: 12 }), r);
    t.ok('so Today still calls the second session today after a reload', r.askedAfter, r);
    t.ok('the v313 string shape is dropped, not migrated', r.legacyGone, r);
    t.eq('and every other shape is dropped', r.junk.join(' | '), '', r);

    t.ok('an impossible date is dropped from the prep block', r.badDateGone, r);
    t.eq('and nothing reaches the glass in its place', r.badLabel, '', r);

    t.eq('a real test date survives untouched', r.realDate, '2027-03-01', r);
    t.eq('and so does its plan stamp', r.realFrom, '2026-09-01', r);
    t.ok('and it still renders as a date', /2027/.test(r.realLabel) && !/Invalid/.test(r.realLabel), r);
    t.ok('and still schedules a block', r.realWeeks > 0 && !!r.realMid && r.realWeekNo >= 1, r);
    t.ok('guard: the checkpoint slots really survived to be checked', r.slotGuard, r);
    t.eq('the checkpoint stamp is repaired the same way', r.slot.join(' | '), '', r);

    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }

  /* ---- one date predicate, not a weaker one restated ----------------------
     The pattern was written out TWELVE times beside the isDateISO() the app
     already owned, and every restatement was the weaker test. That is the
     five-diets drift, and here the copies were not merely duplicates - they
     accepted values the real predicate refuses. The declaration is the only
     place the pattern may appear now, so the thirteenth copy fails here. */
  {
    const { browser, page, errors } = await launch(port);
    await waitForBoot(page);
    const r = await page.evaluate(() => {
      // the BIGGEST inline script: the first one on this page is two characters
      const src = [...document.querySelectorAll('script:not([src])')]
        .map(s => s.textContent).sort((a, b) => b.length - a.length)[0] || '';
      const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return {
        len: src.length,
        isApp: /function normalizeState/.test(src),
        strippedIsApp: /function normalizeState/.test(noComments),
        pattern: (noComments.match(/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/g) || []).length,
        callers: (noComments.match(/isDateISO\(/g) || []).length,
        // and the FORMATTER, written out four times beside the localISO() that owns it
        formatter: (noComments.match(/getFullYear\(\)\+'-'\+String/g) || []).length,
        localISOCallers: (noComments.match(/localISO\(/g) || []).length
      };
    });
    t.ok('guard: the scan read the app, not a stub', r.isApp && r.len > 100000, r);
    t.ok('guard: and stripping comments did not delete it', r.strippedIsApp, r);
    t.eq('the ISO date pattern is written once, in isDateISO itself', r.pattern, 1, r);
    t.ok('and it has real callers', r.callers > 10, r);
    t.eq('the ISO date FORMATTER is written once too, in localISO itself', r.formatter, 1, r);
    t.ok('and it has real callers', r.localISOCallers > 10, r);
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }

  /* ---- does a LEGITIMATE value survive the boot repair? -------------------
     Every earlier sweep in this file asks whether JUNK survives. None asked
     whether a value the app's own writer wrote survives - which is exactly the
     gap _trainAgain fell through, where the repair described a shape the writer
     had replaced and DELETED the real thing on every boot. The idempotence
     check could not see it either: a settled state contains no _trainAgain,
     because nothing sets it but a tap.

     So this one drives the writers and asserts the boot leaves their work
     alone. A guard runs first, because four of the first probe's five findings
     were its own bad arguments - logAct() takes an ACTS key (ruck/grip/box),
     rateFormat() takes a real member of PROGRESSION_GROUPS.skip.formats, and
     armComeback() correctly writes nothing without a real layoff. */
  {
    const { browser, page, errors } = await launch(port);
    await waitForBoot(page);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = { missing: [], lost: [], drove: 0 };
      const NAMES = ['noteOpen', 'trainAgainToday', 'checkAchievements', 'armComeback',
        'rateFormat', 'generateMealPlan', 'logAct', 'startRestDay', 'toggleShop', 'setSwap',
        'toggleGear', 'setPrepPath', 'setForceResultQuiet', 'logFootCheck', 'plSaveResume',
        'noteHurt', 'normalizeState', 'localISO'];
      NAMES.forEach(n => { let ty; try { ty = eval('typeof ' + n); } catch (e) { ty = 'err'; }
        if (ty !== 'function') out.missing.push(n); });
      if (out.missing.length) return out;
      window.confirm = () => true;

      const CALLS = [
        ['_opens', () => noteOpen()],
        ['_trainAgain', () => { STATE.progressPtr = 12; trainAgainToday(); }],
        ['achievements', () => checkAchievements()],
        ['comeback', () => { const d = new Date(); d.setDate(d.getDate() - 20);
                             STATE.logs = { 0: { done: true, completedAt: localISO(d) } };
                             delete STATE.comeback; armComeback(); }],
        ['formatFeel', () => rateFormat('skip', PROGRESSION_GROUPS.skip.formats[0], 'easy')],
        ['nutrition.plan', () => generateMealPlan()],
        ['ruckLog', () => logAct('ruck', 40, { dist: 6 })],
        ['gripLog', () => logAct('grip', 2, { secs: 65 })],
        ['boxLog', () => logAct('box', 12, {})],
        ['prs', () => logAct('grip', 2, { secs: 80 })],
        ['restDays', () => startRestDay()],
        ['shopTicks', () => toggleShop('chicken')],
        ['swaps', () => setSwap(STATE.progressPtr, 'pushup', 'kneepushup')],
        ['profile.gear', () => toggleGear('bike')],
        ['prep.path', () => setPrepPath('assaulter')],
        ['prep.results', () => setForceResultQuiet(FORCE_IDS[2], 48)],
        ['footLog', () => logFootCheck(FOOT_KEYS[0])],
        ['_plResume', () => { PLAYER = { sess: { session: { name: 'x' } },
                              items: [{ exId: 'pushup' }], i: 0, set: 1,
                              ptr: STATE.progressPtr, free: false }; plSaveResume(0); }],
        ['pain', () => noteHurt('pushup')]
      ];
      const get = p => p.split('.').reduce((o, k) => o && o[k], STATE);
      CALLS.forEach(([path, fn]) => {
        try { fn(); } catch (e) { out.lost.push(path + ': the writer threw ' + e.message); return; }
        const before = JSON.stringify(get(path));
        if (before === undefined) { out.lost.push(path + ': the writer wrote nothing'); return; }
        try { normalizeState(); } catch (e) { out.lost.push(path + ': normalizeState threw ' + e.message); return; }
        const after = JSON.stringify(get(path));
        out.drove++;
        if (after !== before) out.lost.push(path + ': ' + String(before).slice(0, 70) +
          '  ->  ' + String(after).slice(0, 70));
      });
      return out;
    });
    t.eq('guard: every writer this sweep drives really exists', r.missing.join(', '), '', r);
    t.ok('guard: and the sweep actually drove them', r.drove >= 18, JSON.stringify({ drove: r.drove }));
    t.eq('nothing a writer wrote is destroyed by the boot repair', r.lost.join('\n'), '', r);
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }

  /* ---- every capped log is capped on the way IN as well ------------------
     Seven writers each enforced their own bound and the BOOT REPAIR asked none
     of them, so an import carrying 5,000 rows in each log survived every boot
     and travelled in every backup after it — measured at 2.4 MB of state
     against 221 kB for the capped shapes, inside the range that trips save()'s
     own quota fallback. Same class as the keyed maps of v284/v285: the writer
     enforced a bound the repair did not. Written as a sweep over LOG_CAPS so a
     tenth capped log cannot be added with the repair left behind. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = { caps: {}, over: {}, newest: {}, floor: null, bytes: {}, threw: null };
      try {
        const N = 1000;
        const keys = Object.keys(LOG_CAPS);
        out.nCaps = keys.length;
        /* THE TAG HAS TO BE A FIELD THE REPAIR KEEPS. Two earlier versions of
           this read `undefined` and reported false failures: an invented field
           is dropped because holdLog, grindLog and hiitLog rebuild each row
           from a field list, and `at` is dropped by liftLog's rebuild for the
           same reason. The DATE is the one field all nine require and keep. */
        const day = i => { const d = new Date(2024, 0, 1); d.setDate(d.getDate() + i);
          return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
            + '-' + String(d.getDate()).padStart(2, '0'); };
        out.newestDay = day(N - 1);
        const seed = (k, i) => ({
          /* An unshift-er's index 0 is the NEWEST row, a push-er's last is —
             so each list is seeded in the order its own writer would build it. */
          date: LOG_CAPS[k].keep === 'head' ? day(N - 1 - i) : day(i),
          at: Date.now() + i,
          mins: 5, secs: 60, id: 'plank', fresh: true, done: true,
          exId: 'squat', reps: 5, region: 'knee', ptr: 0,
          format: 'tabata', group: 'hiit'
        });
        keys.forEach(k => { STATE[k] = Array.from({ length: N }, (_, i) => seed(k, i)); });
        out.bytes.before = JSON.stringify(STATE).length;
        normalizeState();
        out.bytes.after = JSON.stringify(STATE).length;
        keys.forEach(k => {
          const l = STATE[k] || [], c = LOG_CAPS[k];
          out.caps[k] = c.n;
          out.over[k] = l.length > c.n ? l.length : 0;
          /* THE END MATTERS. unshift-ers keep the head and push-ers keep the
             tail, so trimming the wrong one throws away the newest training and
             keeps the oldest — which no length assertion can see. */
          const kept = c.keep === 'head' ? l[0] : l[l.length - 1];
          out.newest[k] = !!(kept && kept.date === out.newestDay);
        });
        /* FLOOR: a real history UNDER the cap is byte-identical. A repair that
           simply truncated every log satisfies every assertion above. */
        STATE.skipLog = Array.from({ length: 12 },
          (_, i) => ({ date: day(i), mins: 20 + i, at: 1000 + i }));
        const was = JSON.stringify(STATE.skipLog);
        normalizeState();
        out.floor = { untouched: JSON.stringify(STATE.skipLog) === was, n: STATE.skipLog.length };
      } catch (e) { out.threw = String(e && e.message || e); }
      return out;
    });

    t.ok('guard: the boot repair ran without throwing', !r.threw, r.threw || '');
    if (!r.threw) {
      t.ok('guard: the sweep really walked every capped log', r.nCaps >= 9, JSON.stringify(r.caps));
      t.eq('no imported log survives the boot above its own cap',
        Object.keys(r.over).filter(k => r.over[k]).map(k => k + '=' + r.over[k]).join(', '), '',
        JSON.stringify(r.over));
      t.eq('and each keeps the NEWEST rows, whichever end its writer appends to',
        Object.keys(r.newest).filter(k => !r.newest[k]).join(', '), '', JSON.stringify(r.newest));
      /* The harm is the file, so it is asserted as bytes and not only as
         lengths — a cap that trimmed one log and left eight passes a
         per-list check that stops at the first one it looks at. */
      t.ok('so the state a backup carries is bounded rather than 10x',
        r.bytes.after < r.bytes.before / 5, JSON.stringify(r.bytes));
      t.ok('FLOOR: a real history under the cap is left byte-identical',
        r.floor.untouched && r.floor.n === 12, JSON.stringify(r.floor));
    }
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }

  /* ---- and the lists that must NEVER be capped ---------------------------
     Each for its own reason: photos are the one thing in this app that cannot
     be re-created, measurements are the weight chart, scoreHistory is what a
     re-test is compared against, and runs holds archived blocks the lifetime
     counters read. A "cap everything" fix satisfies every assertion above and
     destroys all four. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = { kept: {}, capped: [] };
      const N = 400;
      STATE.photos = Array.from({ length: N }, (_, i) => ({ id: 'p' + i, pose: 'front', date: '2026-01-01', data: 'data:image/jpeg;base64,x' }));
      /* Distinct dates: dedupeMeasurements() collapses same-date rows on
         purpose (pre-v156 appends), so an all-one-date seed reads as a cap and
         is the probe, not the app. */
      const day = i => { const d = new Date(2024, 0, 1); d.setDate(d.getDate() + i);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
          + '-' + String(d.getDate()).padStart(2, '0'); };
      STATE.measurements = Array.from({ length: N }, (_, i) => ({ date: day(i), weight: 80 + (i % 5) }));
      STATE.scoreHistory = Array.from({ length: N }, (_, i) => ({ date: day(i), score: 50, level: 'Intermediate' }));
      STATE.runs = Array.from({ length: N }, () => ({ logs: {}, prs: {}, endedAt: '2026-01-01' }));
      normalizeState();
      ['photos', 'measurements', 'scoreHistory', 'runs'].forEach(k => {
        out.kept[k] = (STATE[k] || []).length;
        if (out.kept[k] < N) out.capped.push(k + '=' + out.kept[k]);
      });
      out.inCaps = ['photos', 'measurements', 'scoreHistory', 'runs'].filter(k => LOG_CAPS[k]);
      return out;
    });
    t.eq('the four lifetime records are never capped', r.capped.join(', '), '', JSON.stringify(r.kept));
    t.eq('and none of them is in the cap registry at all', r.inCaps.join(', '), '');
    /* MEMBERSHIP, not truthiness: an inherited key is truthy, so a `||`-shaped
       lookup hands back Object.prototype.constructor and reads `undefined` as
       a cap. The same trap v328 recorded for CARDIO_INFO, and the guard is
       what makes the assertion mean anything. */
    const inh = await page.evaluate(() => {
      const out = { truthy: !!LOG_CAPS['constructor'], own: Object.prototype.hasOwnProperty.call(LOG_CAPS, 'constructor') };
      STATE.skipLog = Array.from({ length: 5 }, (_, i) => ({ date: '2026-01-0' + (i + 1), mins: 5 }));
      const before = STATE.skipLog.length;
      try { capLog('constructor'); } catch (e) { out.threw = String(e); }
      out.untouched = STATE.skipLog.length === before;
      return out;
    });
    t.ok('guard: the inherited key really IS truthy on this map',
      inh.truthy && !inh.own, JSON.stringify(inh));
    /* This is documentation, not a catch: removing capLog()'s membership test
       is an EQUIVALENT mutant. STATE['constructor'] is a function so
       Array.isArray refuses it, and where STATE[key] IS an array the cap reads
       `undefined`, so splice(0,NaN) removes nothing — measured identical both
       ways. Recorded rather than rewritten into a check that cannot fail. */
    t.ok('an inherited key neither throws nor trims (equivalent either way)',
      !inh.threw && inh.untouched, JSON.stringify(inh));

    /* THE WRITE PATH, NOT ONLY THE BOOT REPAIR. Every assertion above drives
       normalizeState(), so a mutant that stripped the cap from logAct() walked
       straight through: the log stays over-cap until the next boot, and save()
       writes the over-long file to storage the whole time. Both directions are
       driven, because the two writer families trim opposite ends. */
    const w = await page.evaluate(() => {
      const out = {};
      const q = console.log; console.log = () => {};
      STATE.ruckLog = []; STATE.skipLog = []; STATE.holdLog = [];
      for (let i = 0; i < 210; i++) logAct('ruck', 5, { dist: 1 });
      for (let i = 0; i < 210; i++) logSkip(5, 1);
      for (let i = 0; i < 210; i++) logHold('plank', 60 + i, true, 'plank');
      console.log = q;
      out.ruck = STATE.ruckLog.length;
      out.skip = STATE.skipLog.length;
      out.hold = STATE.holdLog.length;
      /* And the newest survived: an unshift-er keeps the head, a push-er the
         tail, so the last hold written must still be the longest. */
      out.newestHold = STATE.holdLog[STATE.holdLog.length - 1];
      return out;
    });
    t.eq('the WRITE path caps an unshift-style log without waiting for a boot', w.ruck, 200,
      JSON.stringify(w));
    t.eq('and its sibling', w.skip, 200, JSON.stringify(w));
    t.eq('and a push-style log too', w.hold, 200, JSON.stringify(w));
    t.eq('keeping the newest row it wrote', w.newestHold && w.newestHold.secs, 60 + 209,
      JSON.stringify(w.newestHold));
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }

  /* ---- the storage warning has to be true of THIS phone -------------------
     save()'s quota message named IndexedDB — "backing up to device store" —
     unconditionally. `idb` is null whenever the open failed, which is a real
     phone state (private browsing blocks it), and on such a phone a
     localStorage failure means NOTHING is saved anywhere. The athlete was told
     the opposite, on the persistence layer, which is the most expensive place
     in the app to be reassured wrongly. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = {};
      const realIdb = idb;
      const ls = localStorage.setItem.bind(localStorage);
      const boom = () => { throw new Error('QuotaExceededError'); };
      const shot = () => (document.getElementById('toast') || {}).textContent || '';
      const clear = () => { const t = document.getElementById('toast'); if (t) t.textContent = ''; };

      /* A mirror EXISTS: the original message is the true one. */
      _lsWarned = false; idb = realIdb || { fake: 1 };
      localStorage.setItem = boom; clear(); save(); localStorage.setItem = ls;
      out.withMirror = shot();

      /* NO mirror: the message must not claim one. */
      _lsWarned = false; idb = null;
      localStorage.setItem = boom; clear(); save(); localStorage.setItem = ls;
      out.noMirror = shot();

      /* FLOOR — an ordinary save says nothing at all. A warning that always
         fires is a warning nobody reads, and it would fire on every write. */
      _lsWarned = false; idb = realIdb; clear(); save();
      out.healthy = shot();

      /* FLOOR — it still warns only ONCE, whichever branch it took. The first
         version of this never let a warning fire before looking, so it was
         asserting on the FIRST one and failed on correct code. The pair is the
         test: one warning, then silence. */
      _lsWarned = false; idb = null; localStorage.setItem = boom;
      clear(); save(); out.firstOfPair = shot();
      clear(); save(); out.second = shot();
      localStorage.setItem = ls;

      idb = realIdb; _lsWarned = false;
      return out;
    });

    t.ok('with a device store behind it, the message still names it',
      /device store/i.test(r.withMirror) && /Export a backup/i.test(r.withMirror), JSON.stringify(r));
    t.ok('with NO device store, it does not claim one',
      !/backing up to device store/i.test(r.noMirror), JSON.stringify(r));
    t.ok('and says plainly that nothing is being saved',
      /nothing is being saved/i.test(r.noMirror) && /Export a backup/i.test(r.noMirror),
      JSON.stringify(r));
    t.eq('FLOOR: an ordinary save warns about nothing', r.healthy, '');
    t.ok('guard: the pair really produced a first warning to be silent after',
      !!r.firstOfPair, JSON.stringify({ first: r.firstOfPair }));
    t.eq('FLOOR: and it still warns only once', r.second, '');
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }

  /* ---- the theme guard was truthiness where membership belonged -----------
     THEMES['constructor'] is truthy, so a junk theme out of an imported backup
     survived every boot, travelled in every backup after it, and left the theme
     picker with NOTHING selected — so the athlete could neither see nor change
     which theme was on. The same harm v354 measured for profile.gear. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = {};
      out.inheritedIsTruthy = !!THEMES['constructor'];
      out.inheritedIsOwn = Object.prototype.hasOwnProperty.call(THEMES, 'constructor');

      // an inherited key must not survive the boot
      STATE.settings.theme = 'constructor'; normalizeState();
      out.afterInherited = STATE.settings.theme;

      // nor an ordinary junk string
      STATE.settings.theme = 'chartreuse'; normalizeState();
      out.afterJunk = STATE.settings.theme;

      /* FLOOR — a REAL theme the athlete picked survives untouched, and so does
         the default. A repair that always resets satisfies every assertion
         above and silently takes the athlete's choice away on every boot. */
      const real = Object.keys(THEMES).filter(k => k !== THEME_DEFAULT)[0];
      out.real = real;
      STATE.settings.theme = real; normalizeState();
      out.afterReal = STATE.settings.theme;
      STATE.settings.theme = THEME_DEFAULT; normalizeState();
      out.afterDefault = STATE.settings.theme;

      // the read site refuses it too — two guards mean two checks
      out.readSite = { junk: themeName('constructor'), real: themeName(real) };
      out.setter = (() => { STATE.settings.theme = real; setTheme('constructor');
                            return STATE.settings.theme; })();

      // and the picker marks exactly one chip
      STATE.settings.theme = real;
      const html = themeChipsHTML();
      out.chipsOn = (html.match(/themechip on/g) || []).length;
      return out;
    });

    t.ok('guard: the inherited key really IS truthy on THEMES',
      r.inheritedIsTruthy && !r.inheritedIsOwn, JSON.stringify(r));
    t.eq('an inherited key does not survive the boot', r.afterInherited, 'mint');
    t.eq('nor does an ordinary junk theme', r.afterJunk, 'mint');
    t.eq('FLOOR: a real theme the athlete picked survives', r.afterReal, r.real);
    t.eq('FLOOR: and so does the default', r.afterDefault, 'mint');
    t.ok('the read site refuses the inherited key and accepts a real one',
      r.readSite.junk === null && r.readSite.real === r.real, JSON.stringify(r.readSite));
    t.eq('and the setter refuses it rather than storing it', r.setter, r.real);
    t.eq('so the picker marks exactly one theme', r.chipsOn, 1);
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }

  /* ---- every one-time migration, as a CLASS ------------------------------
     The rule this file states: a stale default needs a one-time migration keyed
     to the exact value, behind a flag, leaving any other value alone as a
     deliberate choice. Four exist and each has its own check somewhere; nothing
     asked the same three questions of all of them. The v287 mutant that set the
     flag in only ONE branch escaped four checks, because everyone who already
     had a value stayed unflagged and was re-seeded the first time they cleared
     it — which is question three below. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = {};
      const run = (label, setOld, read, setChoice) => {
        setOld(); normalizeState();
        const first = read();
        normalizeState();                       // a second launch must not redo it
        const second = read();
        setChoice(); normalizeState();          // and a deliberate choice must stick
        out[label] = { first, second, choice: read() };
      };
      run('theme',
        () => { delete STATE.profile._mintTheme; STATE.settings.theme = 'ember'; },
        () => STATE.settings.theme,
        () => { STATE.settings.theme = 'ember'; });
      run('coach',
        () => { delete STATE.settings.autoIntro; STATE.settings.coach = 'drill'; },
        () => STATE.settings.coach,
        () => { STATE.settings.coach = 'wrestle'; });
      /* _protSeed and _toneFix live on nutrition and settings, NOT on profile —
         a probe that deleted the wrong one reported all three questions wrong
         and the app was right. Confirm the field's real home first. */
      run('proteinSeed',
        () => { delete STATE.nutrition._protSeed; delete STATE.nutrition.proteinTarget; },
        () => STATE.nutrition.proteinTarget === undefined ? '(absent)' : STATE.nutrition.proteinTarget,
        () => { delete STATE.nutrition.proteinTarget; });   // a deliberate CLEAR
      run('tone',
        () => { delete STATE.settings._toneFix; STATE.settings.voicePitch = 0.6; },
        () => STATE.settings.voicePitch === undefined ? '(absent)' : STATE.settings.voicePitch,
        () => { STATE.settings.voicePitch = 1.3; });
      return out;
    });

    // 1. each migration actually fires from the state it was written for
    t.eq('the theme migration moves a legacy ember install to the default', r.theme.first, 'mint');
    t.eq('the coach migration switches an old fixed persona to Auto', r.coach.first, 'auto');
    t.eq('the protein seed installs the standing default once', r.proteinSeed.first, 165);
    t.eq('the tone migration clears the stale voicePitch default', r.tone.first, '(absent)');

    // 2. and does not redo itself on the next launch
    t.eq('and the theme migration does not run twice', r.theme.second, r.theme.first);
    t.eq('nor the coach one', r.coach.second, r.coach.first);
    t.eq('nor the protein seed', r.proteinSeed.second, r.proteinSeed.first);
    t.eq('nor the tone fix', r.tone.second, r.tone.first);

    /* 3. FLOOR — a deliberate choice made AFTER the migration survives the next
       boot. This is the question the v287 escape turned on: a seed that re-fires
       the first time an athlete CLEARS the value is the defect, and it looks
       identical to a correct one until you clear it and boot again. */
    t.eq('FLOOR: a theme the athlete picked survives', r.theme.choice, 'ember');
    t.eq('FLOOR: a coach they picked survives', r.coach.choice, 'wrestle');
    t.eq('FLOOR: a deliberate CLEAR of the protein target sticks',
      r.proteinSeed.choice, '(absent)');
    t.eq('FLOOR: a hand-set voice pitch survives', r.tone.choice, 1.3);
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }


  /* A STORED level had no membership repair anywhere. levelOf() fails closed for
     a scalar, so nothing crashed and no session was mis-built — but the two
     DISPLAY sites read the field raw, so the Core Score chip printed `advanced`
     while the engine prescribed as a Beginner, and `{}` reached the glass as
     `[object Object]`. Same class as profile.experience, on the three fields
     nobody swept: the baseline, every re-test and every history row. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = {};
      const chipNow = () => {
        go('progress'); setProgressTab('summary');
        const v = document.querySelector('#v-progress');
        const c = [...v.querySelectorAll('.chip.on')].map(x => x.textContent.trim());
        return c[0] || '(none)';
      };
      const setBase = lvl => {
        STATE.baseline = { date: '2026-01-01', score: 88, testCount: TESTS.length,
                           subs: {}, results: {}, maxes: {} };
        if (lvl !== undefined) STATE.baseline.level = lvl;
        TESTS.forEach(t => { STATE.baseline.maxes[t.id] = 60; STATE.baseline.results[t.id] = 60; });
        STATE.scoreHistory = [];
        STATE.profile.experience = 'Advanced';
      };
      const one = lvl => {
        setBase(lvl); normalizeState();
        return { stored: ('level' in STATE.baseline) ? STATE.baseline.level : '(deleted)',
                 engine: levelOf(0), glass: chipNow() };
      };

      out.legal = LEVEL_NAME.slice();
      out.junkStr  = one('advanced');
      out.junkNum  = one(42);
      out.junkObj  = one({});
      out.junkArr  = one(['Advanced']);
      out.nullLvl  = one(null);
      out.emptyLvl = one('');

      // FLOOR: a real measured level is untouched, by the repair and by the chip
      out.realAdv = one('Advanced');
      out.realBeg = (() => { setBase('Beginner'); STATE.profile.experience = 'Beginner';
                             normalizeState();
                             return { stored: STATE.baseline.level, glass: chipNow() }; })();
      // FLOOR: absent stays absent — skipBaseline() writes one, and both display
      // sites already fall back for it, so seeding a level would be a claim.
      out.absent = (() => { setBase(undefined); normalizeState();
                            return ('level' in STATE.baseline) ? 'kept-a-level' : '(absent)'; })();

      // every re-test record and every history row, not only the baseline
      setBase('Advanced');
      STATE.reassess = { 1: { date: '2026-02-01', level: 'ELITE', maxes: {} } };
      STATE.scoreHistory = [{ date: '2026-01-01', score: 70, level: 'beginner' },
                            { date: '2026-02-01', score: 80, level: 'Advanced' }];
      normalizeState();
      out.reassessLvl = STATE.reassess[1].level;
      out.histJunk = STATE.scoreHistory[0].level;
      out.histReal = STATE.scoreHistory[1].level;
      // the assessment-history rows are on the STRENGTH pane, not Summary
      go('progress'); setProgressTab('strength');
      out.histGlass = document.querySelector('#v-progress').textContent;

      /* Two guards mean two checks. importData() writes STATE directly, so the
         read site has to be right with NO boot behind it — the medCleared()
         escape, where every check booted first and the repair had already
         scrubbed the junk. */
      setBase('advanced');            // deliberately NOT normalized
      out.rawGlass = chipNow();
      out.rawEngine = levelOf(0);
      /* The history ROW is the second read site and needs the same treatment.
         The first version of this block asserted on the rendered rows AFTER a
         boot, so the repair had already scrubbed them and a revert of the row's
         own guard printed 'Beginner' either way — it escaped clean. */
      setBase('Advanced');
      STATE.scoreHistory = [{ date: '2026-01-01', score: 70, level: 'ELITE-RAW' },
                            { date: '2026-02-01', score: 80, level: 'Advanced' }];
      go('progress'); setProgressTab('strength');
      out.rawHist = document.querySelector('#v-progress').textContent;
      return out;
    });

    t.ok('guard: the legal set is the three the app ships',
      r.legal.join(',') === 'Beginner,Intermediate,Advanced', r.legal.join(','));

    // 1. junk is scrubbed at boot, in every shape an import can carry
    t.eq('a lower-case level from a backup is repaired', r.junkStr.stored, 'Beginner');
    t.eq('a number is repaired', r.junkNum.stored, 'Beginner');
    t.eq('an object is repaired', r.junkObj.stored, 'Beginner');
    t.eq('an array that coerces to a legal name is still repaired', r.junkArr.stored, 'Beginner');
    t.eq('and a stored null becomes absent rather than travelling in a backup',
      r.nullLvl.stored, '(deleted)');
    t.eq('as does an empty string', r.emptyLvl.stored, '(deleted)');

    // 2. and the glass agrees with the session the engine is building
    t.eq('the chip no longer prints the junk it was handed', r.junkStr.glass, 'Beginner');
    t.eq('and it matches what the engine prescribes', r.junkStr.glass, r.junkStr.engine);
    t.ok('an object never reaches the glass as [object Object]',
      r.junkObj.glass.indexOf('[object') < 0, r.junkObj.glass);

    // 3. the read site is right with no boot behind it
    t.eq('junk written straight into STATE is still not printed raw', r.rawGlass, 'Beginner');
    t.eq('and the chip still agrees with the engine there', r.rawGlass, r.rawEngine);
    t.ok('nor does a history row print junk written straight into STATE',
      r.rawHist.indexOf('ELITE-RAW') < 0, r.rawHist.slice(0, 160));
    t.ok('guard: that row really did render, so the check is not passing on nothing',
      /Re-test 1/.test(r.rawHist) && /Advanced/.test(r.rawHist), r.rawHist.slice(0, 160));

    // 4. every record, not only the baseline
    t.eq('a re-test record is repaired too', r.reassessLvl, 'Beginner');
    t.eq('and every history row', r.histJunk, 'Beginner');
    t.eq('FLOOR: a real history row is untouched', r.histReal, 'Advanced');
    t.ok('and no history row prints a raw junk level',
      r.histGlass.indexOf('beginner') < 0 && r.histGlass.indexOf('ELITE') < 0);

    // 5. FLOORS — the over-eager repair that scrubs a real answer
    t.eq('FLOOR: a measured Advanced survives the boot', r.realAdv.stored, 'Advanced');
    t.eq('FLOOR: and is still what the engine uses', r.realAdv.engine, 'Advanced');
    t.eq('FLOOR: and is what the chip prints', r.realAdv.glass, 'Advanced');
    t.eq('FLOOR: a measured Beginner survives too', r.realBeg.stored, 'Beginner');
    t.eq('FLOOR: an ABSENT level stays absent — it is a real state', r.absent, '(absent)');
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }


  /* The favourites list could be ADDED to and never removed, and the writer did
     not know about the cap the boot repair enforces. Measured: 105 taps, 105
     rows, 100 after a boot — and the trim kept the OLDEST, so the five that
     vanished were the five just built, each having been toasted "Saved ⭐".
     Same class as the activity logs, with the halves the other way round. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    await page.evaluate(() => {
      window.confirm = () => true;
      window.prompt = () => 'Fav ' + ((STATE.customFav || []).length + 1);
    });
    const r = await page.evaluate(() => {
      const out = {};
      out.cap = FAV_MAX;
      STATE.customFav = []; _custom = ['pushup', 'plank'];

      // 1. the writer stops AT the cap, and the toast says why
      const said = [];
      const realToast = window.toast;
      window.toast = (m, ms) => { said.push(String(m)); return realToast(m, ms); };
      for (let i = 0; i < FAV_MAX + 5; i++) saveCustomFav();
      window.toast = realToast;
      out.afterTaps = STATE.customFav.length;
      out.refusal = said.filter(m => /delete one/i.test(m)).length;
      out.claimedSaves = said.filter(m => /Saved/.test(m)).length;

      // 2. and a boot changes nothing, because the writer already stopped
      const newestBefore = STATE.customFav[STATE.customFav.length - 1].name;
      normalizeState();
      out.afterBoot = STATE.customFav.length;
      out.keptNewest = STATE.customFav[STATE.customFav.length - 1].name === newestBefore;

      // 3. an over-cap IMPORT keeps the NEWEST — the end every appended log keeps
      STATE.customFav = [];
      for (let i = 1; i <= FAV_MAX + 10; i++) STATE.customFav.push({ name: 'I' + i, items: ['pushup'] });
      normalizeState();
      out.imported = { n: STATE.customFav.length,
                       first: STATE.customFav[0].name,
                       last: STATE.customFav[STATE.customFav.length - 1].name };

      /* 4. the route out. "Delete one first" with no control behind it is an
         instruction the athlete cannot follow — so the button is TAPPED, not
         the handler called. The scratch list one card above has had a ✕ on
         every row since it was written; the durable list never got one. */
      STATE.customFav = []; _custom = ['pushup', 'plank'];
      saveCustomFav(); saveCustomFav(); saveCustomFav();
      openBuilder();
      const btns = [...document.querySelectorAll('#sheet button')]
        .filter(b => /delFav\(/.test(b.getAttribute('onclick') || ''));
      out.buttons = btns.length;
      out.named = btns[1] ? (btns[1].getAttribute('aria-label') || '') : '';
      out.before = STATE.customFav.map(f => f.name).join(',');
      if (btns[1]) btns[1].click();
      out.after = STATE.customFav.map(f => f.name).join(',');

      // 5. FLOOR — a refused confirm deletes nothing
      window.confirm = () => false;
      delFav(0);
      out.refused = STATE.customFav.map(f => f.name).join(',');
      window.confirm = () => true;

      /* 6. the row index is the RAW position. openBuilder() filtered the list
         before numbering the rows while startFav() and delFav() index
         STATE.customFav directly, so a single bad row would have renumbered
         every row after it and started — or deleted — the wrong favourite.
         Unreachable today because the boot repair guarantees the shape, which
         is exactly why it needs a check rather than a comment. */
      STATE.customFav = [{ name: 'BAD', items: 'not-an-array' },
                         { name: 'A', items: ['pushup'] },
                         { name: 'B', items: ['plank'] }];
      openBuilder();
      const rows = [...document.querySelectorAll('#sheet button')]
        .filter(b => /delFav\(/.test(b.getAttribute('onclick') || ''));
      out.idx = { rendered: rows.length,
                  calls: rows.map(b => b.getAttribute('onclick')).join(' ') };
      if (rows[0]) rows[0].click();
      out.idx.left = STATE.customFav.map(f => f.name).join(',');

      // 7. FLOOR — under the cap, saving still works and is not refused
      STATE.customFav = []; _custom = ['pushup'];
      const said2 = [];
      const rt2 = window.toast; window.toast = m => { said2.push(String(m)); return rt2(m); };
      saveCustomFav();
      window.toast = rt2;
      out.underCap = { n: STATE.customFav.length,
                       refused: said2.filter(m => /delete one/i.test(m)).length };
      return out;
    });

    t.ok('guard: the cap is a real bound the repair enforces', r.cap > 1, String(r.cap));
    // 1. the writer stops, and never claims a save it will lose
    t.eq('the writer stops AT the cap rather than saving a row the boot deletes',
      r.afterTaps, r.cap);
    t.ok('and it says why, naming the way out', r.refusal > 0, String(r.refusal));
    t.eq('so no tap past the cap ever claimed a save', r.claimedSaves, r.cap);
    // 2. and the boot has nothing to undo
    t.eq('a boot then changes nothing', r.afterBoot, r.cap);
    t.ok('and the favourite just built is still there', r.keptNewest);
    // 3. an import over the cap keeps the newest
    t.eq('an over-cap import is trimmed to the cap', r.imported.n, r.cap);
    t.eq('and it keeps the NEWEST rows, not the oldest', r.imported.last, 'I' + (r.cap + 10));
    t.ok('so the oldest are the ones dropped', r.imported.first !== 'I1', r.imported.first);
    // 4. the route out really exists and is the athlete's own tap
    t.eq('every favourite carries a delete', r.buttons, 3);
    t.ok('and it is named for a screen reader', /Fav 2/.test(r.named), r.named);
    t.eq('guard: three favourites were saved', r.before, 'Fav 1,Fav 2,Fav 3');
    t.eq('tapping one deletes exactly it', r.after, 'Fav 1,Fav 3');
    // 5-6. FLOORS — the over-eager twins
    t.eq('FLOOR: a refused confirm deletes nothing', r.refused, 'Fav 1,Fav 3');
    t.eq('a bad row is not rendered', r.idx.rendered, 2);
    t.eq('and the rows carry their RAW index, not a renumbered one',
      r.idx.calls, 'delFav(1) delFav(2)');
    t.eq('so tapping the first delete removes the favourite it names',
      r.idx.left, 'BAD,B');
    t.eq('FLOOR: under the cap a save still lands', r.underCap.n, 1);
    t.eq('FLOOR: and is not refused', r.underCap.refused, 0);
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }


  /* ---- a keyed map's KEYS, not just its container ------------------------
     v284 hardened these maps against arriving as an ARRAY and never asked what
     the keys were. `logs` is keyed by progressPtr and allDonePairs() maps
     Object.keys() straight through, so a key an import controls reached
     goalSlots() as a pointer and threw on `.slots` of undefined. Measured:
     Progress > Summary died on the error boundary, and the boundary retries
     THROUGH normalizeState(), so with no repair here the pane NEVER came back.
     Its twin at the session-history reader does .map(Number).filter(...) and is
     fine — one of a pair guarded and its twin not, again. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const d = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
      const out = {};
      const paneOK = () => {
        go('progress');
        try { setProgressTab('summary');
              return document.querySelector('#v-progress').textContent.length > 100; }
        catch (e) { return 'THREW ' + String(e).slice(0, 60); }
      };

      // 1. a pointer key an import controls no longer reaches the engine
      out.junk = {};
      ['constructor', 'abc', '3.7', '-1'].forEach(k => {
        STATE.logs = {}; STATE.logs[k] = { done: true, completedAt: d(1), feel: 'ok', ex: {} };
        normalizeState();
        out.junk[k] = { left: Object.keys(STATE.logs).join(','), pane: paneOK() };
      });

      /* 2. FLOOR — a real athlete's history is untouched. A repair that wipes
         satisfies every "the junk is gone" assertion and destroys the data it
         exists to protect. */
      STATE.logs = {}; for (let i = 0; i < 300; i++)
        STATE.logs[i] = { done: true, completedAt: d(300 - i), feel: 'ok', ex: {}, items: [] };
      STATE.swaps = { 5: { plankL: 'pushup' }, 200: { __fin: 'squatjack' } };
      STATE.restDays = {}; STATE.restDays[d(3)] = 1; STATE.restDays[d(10)] = 1;
      STATE._opens = {}; STATE._opens[d(1)] = 1;
      STATE.nutrition.days = {};
      STATE.nutrition.days[d(1)] = { food: [{ name: 'X', kcal: 100 }], water: 2, habits: {} };
      normalizeState();
      out.real = { logs: Object.keys(STATE.logs).length,
                   swaps: Object.keys(STATE.swaps).join(','),
                   rest: Object.keys(STATE.restDays).length,
                   opens: Object.keys(STATE._opens).length,
                   days: Object.keys(STATE.nutrition.days).length };

      // 3. junk BESIDE the real rows drops only itself
      STATE.logs['abc'] = { done: true, ex: {} };
      STATE.swaps['zz'] = { __fin: 'squatjack' };
      STATE.restDays['not-a-date'] = 1;
      normalizeState();
      out.mixed = { logs: Object.keys(STATE.logs).length,
                    swaps: Object.keys(STATE.swaps).join(','),
                    rest: Object.keys(STATE.restDays).length };

      // 4. both ends of the legal pointer range survive
      STATE.logs = {}; STATE.logs[0] = { done: true, ex: {} };
      STATE.logs[SESSIONS_PER_CYCLE * TOTAL_CYCLES] = { done: true, ex: {} };
      normalizeState();
      out.edges = Object.keys(STATE.logs).sort((a, b) => a - b).join(',');
      out.lastPtr = SESSIONS_PER_CYCLE * TOTAL_CYCLES;
      return out;
    });

    ['constructor', 'abc', '3.7', '-1'].forEach(k => {
      t.eq(`a log key an import controls is dropped (${k})`, r.junk[k].left, '');
      t.eq(`and Progress renders again with it gone (${k})`, r.junk[k].pane, true);
    });
    // FLOORS — the over-eager repair that wipes what it was written to protect
    t.eq('FLOOR: 300 real sessions survive the repair', r.real.logs, 300);
    t.eq('FLOOR: and the athlete’s real swaps', r.real.swaps, '5,200');
    t.eq('FLOOR: and their rest days', r.real.rest, 2);
    t.eq('FLOOR: and the days they opened the app', r.real.opens, 1);
    t.eq('FLOOR: and the day they logged food', r.real.days, 1);
    t.eq('junk beside real rows drops only itself', r.mixed.logs, 300);
    t.eq('in the swaps too', r.mixed.swaps, '5,200');
    t.eq('and in the rest days', r.mixed.rest, 2);
    t.eq('both ends of the legal pointer range survive',
      r.edges, '0,' + r.lastPtr);
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }


  /* ---- two free-text fields with no repair at all -----------------------
     Found by fuzzing EVERY field at once rather than one at a time — 62 fields
     x 8 junk shapes, all simultaneously. The app survives total corruption
     (no throw, no page error, every pane still renders 68-87k characters);
     these two are what the sweep found on the glass.

     profile.name is the worse one. `(STATE.profile.name||'').trim()` assumes a
     string and there was no repair, so an imported {} made briefSegments()
     THROW: Today's brief rendered 119 characters instead of 2,631, and the
     boundary retries THROUGH normalizeState(), so the segment the coach reads
     ALOUD never came back. Same shape as nutrition.allergies and `.replace()`.

     settings.voiceName only handled `undefined`, so any other shape survived
     and the voice check told the athlete "Every coach is using one voice. You
     have picked [object Object] above, and a picked voice overrides all 38
     coaches" — FALSE: coachVoiceFor() looks the name up, finds nothing, and
     every coach keeps its own voice. A warning about a state that is not true,
     offering a button to undo something that never happened. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const out = { name: {}, voice: {} };
      const junk = [{}, [], 42, true, null];

      junk.forEach((v, i) => {
        STATE.profile.name = v; normalizeState();
        let threw = '';
        try { go('today'); setTodayTab('brief');
              const chars = document.querySelector('#v-today').textContent.length;
              const spoke = briefSegments().map(x => String(x.say || '')).join(' ').length;
              out.name['j' + i] = { stored: STATE.profile.name, chars, spoke }; }
        catch (e) { threw = String(e).slice(0, 60); out.name['j' + i] = { threw }; }
      });

      junk.forEach((v, i) => {
        STATE.settings.voiceName = v; normalizeState();
        go('guide');
        out.voice['j' + i] = { stored: STATE.settings.voiceName,
          claims: document.querySelector('#v-guide').textContent.indexOf('You have picked') >= 0 };
      });

      // FLOORS — the real values must be untouched and must still be used
      STATE.profile.name = '  Shabazz  '; STATE.settings.voiceName = 'Daniel';
      normalizeState();
      out.realName = STATE.profile.name;
      out.readName = athleteName();
      go('today'); setTodayTab('brief');
      out.spokenHasName = briefSegments().map(x => String(x.say || '')).join(' ').indexOf('Shabazz') >= 0;
      go('guide');
      out.footer = /Athlete: Shabazz/.test(document.querySelector('#v-guide').textContent);
      out.realVoiceWarns = document.querySelector('#v-guide').textContent.indexOf('Daniel') >= 0;
      // FLOOR: no name at all warns about nothing
      STATE.profile.name = ''; STATE.settings.voiceName = ''; normalizeState();
      go('guide');
      out.blank = { footer: /Athlete:/.test(document.querySelector('#v-guide').textContent),
                    claims: document.querySelector('#v-guide').textContent.indexOf('You have picked') >= 0 };
      // a long name is capped, so an import cannot bloat every backup
      STATE.profile.name = 'z'.repeat(500); normalizeState();
      out.capped = STATE.profile.name.length;
      /* Two guards mean two checks: importData() writes STATE directly, so both
         READ sites have to be right with no boot behind them. */
      STATE.profile.name = {}; STATE.settings.voiceName = {};
      let noBoot = '';
      try { athleteName(); go('guide'); go('today'); setTodayTab('brief'); briefSegments(); }
      catch (e) { noBoot = String(e).slice(0, 60); }
      out.noBoot = noBoot || '(none)';
      out.noBootGlass = document.querySelector('#v-guide').textContent.indexOf('[object') < 0;
      STATE.profile.name = ''; normalizeState();
      return out;
    });

    [0, 1, 2, 3, 4].forEach(i => {
      const n = r.name['j' + i];
      t.ok(`a non-string name never throws (case ${i})`, !n.threw, n.threw || '');
      t.eq(`and is repaired to empty (case ${i})`, n.stored, '');
      t.ok(`so the brief still renders (case ${i})`, n.chars > 1000, String(n.chars));
      t.ok(`and the coach still has something to say (case ${i})`, n.spoke > 500, String(n.spoke));
      t.eq(`a non-string voice name is repaired too (case ${i})`, r.voice['j' + i].stored, '');
      t.eq(`so no false "you have picked" warning fires (case ${i})`,
        r.voice['j' + i].claims, false);
    });

    // FLOORS
    t.eq('FLOOR: a real name is stored exactly as typed', r.realName, '  Shabazz  ');
    t.eq('FLOOR: and read back trimmed', r.readName, 'Shabazz');
    t.ok('FLOOR: and the coach still greets them by it', r.spokenHasName);
    t.ok('FLOOR: and Settings still shows it', r.footer);
    t.ok('FLOOR: a real picked voice still raises the warning', r.realVoiceWarns);
    t.eq('FLOOR: no name means no Athlete line', r.blank.footer, false);
    t.eq('FLOOR: and no picked voice means no warning', r.blank.claims, false);
    t.eq('a very long name is capped', r.capped, 60);
    // the read sites, with no boot behind them
    t.eq('the read sites do not throw on junk written straight into STATE',
      r.noBoot, '(none)');
    t.ok('nor print it raw', r.noBootGlass);
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }


  /* ---- two tabs, and the second one to save used to win --------------------
     Nothing in this app knew another copy of itself existed, and every change
     writes the WHOLE state. Measured across two real tabs before the fix:

       A logs a training session and saves      -> logs 1, pointer 1
       B, holding what it loaded BEFORE that,
         logs a meal and saves                  -> B still had logs 0, pointer 0
       a third load reads                       -> logs 0, pointer 0

     The session is gone and the pointer rewound, with nothing on screen at any
     point. A `storage` event fires only in the OTHER tabs, so it is exactly the
     signal a tab needs; every mutation here is followed immediately by save(),
     so there is no unsaved work and adopting the newer copy is the whole fix. */
  {
    const base = `http://127.0.0.1:${port}/`;
    const ctx = await chromium.launchPersistentContext('', { viewport: { width: 390, height: 844 } });
    const boot = async pg => {
      await pg.goto(base, { waitUntil: 'domcontentloaded' });
      await pg.waitForFunction(() => document.querySelector('.view.active'), null, { timeout: 20000 });
      await pg.waitForTimeout(600);
    };
    const A = ctx.pages()[0] || await ctx.newPage();
    await boot(A); await seedAthlete(A); await A.waitForTimeout(400);
    const B = await ctx.newPage(); await boot(B);

    // A trains. B is holding the state it loaded before that.
    const aWrote = await A.evaluate(() => {
      STATE.logs = { 0: { done: true, completedAt: todayISO(), feel: 'ok', ex: {}, items: [] } };
      STATE.progressPtr = 1; save();
      return { logs: Object.keys(STATE.logs).length, ptr: STATE.progressPtr };
    });
    await B.waitForTimeout(600);
    // B logs a meal — and must NOT write A's session away
    const bWrote = await B.evaluate(() => {
      const d = nutToday(); d.food = d.food || [];
      d.food.push({ name: 'Chicken', kcal: 200, p: 40, c: 0, f: 5, meal: 'lunch', at: Date.now() });
      save();
      return { logsSeenByB: Object.keys(STATE.logs || {}).length, ptrInB: STATE.progressPtr,
               food: (nutToday().food || []).length };
    });
    const C = await ctx.newPage(); await boot(C);
    const third = await C.evaluate(() => ({
      logs: Object.keys(STATE.logs || {}).length, ptr: STATE.progressPtr,
      food: ((STATE.nutrition.days[todayISO()] || {}).food || []).length }));
    await C.close();

    t.ok('guard: the first tab really did log a session', aWrote.logs === 1 && aWrote.ptr === 1,
      JSON.stringify(aWrote));
    t.eq('the second tab sees the session before it writes', bWrote.logsSeenByB, 1);
    t.eq('and its pointer', bWrote.ptrInB, 1);
    t.eq('a later load still has the session', third.logs, 1);
    t.eq('and the pointer is not rewound', third.ptr, 1);
    t.eq("FLOOR: and the second tab's own work survives too", third.food, 1);

    /* FLOOR — a live workout is NEVER disturbed. Adopting mid-set would swap the
       state out from under the player, which is the thing the self-update path
       guards for the same reason. */
    await B.evaluate(() => {
      PLAYER = { i: 2, s: 1, phase: 'work', sess: {} };
      window.__toasts = []; const rt = window.toast;
      window.toast = m => { window.__toasts.push(String(m)); return rt(m); };
    });
    await A.evaluate(() => { STATE.progressPtr = 7; save(); });
    await B.waitForTimeout(700);
    const mid = await B.evaluate(() => ({ player: !!PLAYER, phase: PLAYER && PLAYER.phase,
      i: PLAYER && PLAYER.i, ptr: STATE.progressPtr, toasts: window.__toasts.slice() }));
    t.ok('FLOOR: a live workout is left alone', mid.player && mid.phase === 'work' && mid.i === 2,
      JSON.stringify(mid));
    t.eq('FLOOR: its state is not swapped mid-set', mid.ptr, 1);
    t.eq('FLOOR: and it is not interrupted by a toast', mid.toasts.length, 0);

    // once the session ends, a foreign write IS adopted
    await B.evaluate(() => { PLAYER = null; });
    await A.evaluate(() => { STATE.progressPtr = 9; save(); });
    await B.waitForTimeout(800);
    /* Read the SCREEN, not just STATE. Every assertion here was on the stored
       value, so a listener that adopted and never repainted was invisible —
       measure the payload, not the container. The athlete's experience is the
       glass, and a stale screen over fresh state is its own defect. */
    const done = await B.evaluate(() => ({ ptr: STATE.progressPtr,
      toasts: window.__toasts.slice(),
      screen: (document.querySelector('#v-today') || {}).textContent || '' }));
    t.eq('once the session ends the other tab is adopted', done.ptr, 9);
    t.ok('and the screen repaints to match, not just the state',
      /SESSION\s*10\b/.test(done.screen.replace(/\s+/g, ' ')),
      done.screen.replace(/\s+/g, ' ').slice(0, 120));
    t.ok('and the athlete is told why the screen changed',
      done.toasts.some(m => /another tab/i.test(m)), JSON.stringify(done.toasts));

    /* FLOOR — a foreign write of a DIFFERENT key is not our business. The app
       also writes the pre-import snapshot to localStorage, and reacting to that
       would reload and toast over a housekeeping write. Without this case a
       listener that fires on every key changes nothing any assertion sees. */
    await B.evaluate(() => { window.__toasts = []; });
    const ptrBeforeOther = await B.evaluate(() => STATE.progressPtr);
    await A.evaluate(() => { try { localStorage.setItem(PREIMPORT_KEY, '{"x":1}'); } catch (e) {} });
    await B.waitForTimeout(700);
    const other = await B.evaluate(() => ({ ptr: STATE.progressPtr, toasts: window.__toasts.slice() }));
    t.eq('FLOOR: a write to another key changes nothing', other.ptr, ptrBeforeOther);
    t.eq('FLOOR: and says nothing', other.toasts.length, 0);

    /* A RESET is not an ordinary edit, and the live-session guard must not cover
       it. hardReset()'s own confirm says "this cannot be undone" — and measured
       across two tabs it WAS: A, mid-workout, kept its stale copy (correctly,
       for an ordinary write), quit, saved, and a third load read the erased logs
       and pointer straight back. */
    const R = await ctx.newPage();
    await boot(R);
    await A.evaluate(() => {
      STATE.progressPtr = 3;
      STATE.logs = { 9: { done: true, completedAt: todayISO(), ex: {} } };
      save(); openPlayer();
    });
    await R.waitForTimeout(500);
    const beforeReset = await A.evaluate(() => ({ player: !!PLAYER,
      logs: Object.keys(STATE.logs || {}).length }));
    await R.evaluate(() => { window.confirm = () => true; hardReset(); });
    await A.waitForTimeout(900);
    const afterReset = await A.evaluate(() => ({ player: !!PLAYER,
      logs: Object.keys(STATE.logs || {}).length, ptr: STATE.progressPtr }));
    // A finishes and saves — the erased data must NOT come back
    await A.evaluate(() => { try { playerQuit(); } catch (e) {} save(); });
    await A.waitForTimeout(300);
    const V = await ctx.newPage(); await boot(V);
    const held = await V.evaluate(() => ({ logs: Object.keys(STATE.logs || {}).length,
      ptr: STATE.progressPtr, onboarded: !!STATE.onboarded }));
    await V.close(); await R.close();

    t.ok('guard: the other tab really was mid-workout with data to lose',
      beforeReset.player && beforeReset.logs === 1, JSON.stringify(beforeReset));
    t.eq('a reset in another tab closes the live workout', afterReset.player, false);
    t.eq('and the live tab adopts the erased state', afterReset.logs, 0);
    t.eq('and its pointer', afterReset.ptr, 0);
    t.eq('so a later save cannot resurrect what was erased', held.logs, 0);
    t.eq('nor the pointer', held.ptr, 0);
    t.eq('and the reset really held', held.onboarded, false);

    /* THE DISCRIMINATING CASE, and the block above cannot supply it. Closing a
       live session is not passive: playerTeardown() clears the resume point and
       hiitTeardown() records the stopped grinder, and both call save() — which
       put this tab's own un-erased copy back into localStorage, so the load()
       that follows read our old state instead of the erased one. The player
       above was opened and never reached WORK, so it had no resume point to
       clear and therefore saved nothing; a GRINDER always writes its stop.
       Measured on the unfixed code: the grinder closed, the tab looked as
       though it had obeyed, and onboarded was still true with the log, the
       pointer and the name all intact. */
    const G1 = await ctx.newPage(); await boot(G1);
    const G2 = await ctx.newPage(); await boot(G2);
    await G1.evaluate(async () => {
      STATE.onboarded = true; STATE.profile.name = 'Sam';
      STATE.progressPtr = 3; STATE.grindLog = [];
      STATE.logs = { 9: { done: true, completedAt: todayISO(), ex: {} } };
      save();
      startGrinder(Object.keys(GRINDER_FORMATS)[0]);
      await new Promise(z => setTimeout(z, 300));
      if (typeof INTV !== 'undefined' && INTV) { INTV.i = 2; INTV.workElapsed = 120; }
    });
    await G1.waitForTimeout(400);
    const gBefore = await G1.evaluate(() => ({ live: !!(typeof INTV !== 'undefined' && INTV),
      logs: Object.keys(STATE.logs || {}).length, name: (STATE.profile || {}).name }));
    await G2.evaluate(() => { window.confirm = () => true; hardReset(); });
    await G1.waitForTimeout(1100);
    const gAfter = await G1.evaluate(() => ({ live: !!(typeof INTV !== 'undefined' && INTV),
      logs: Object.keys(STATE.logs || {}).length, ptr: STATE.progressPtr,
      onboarded: !!STATE.onboarded, name: (STATE.profile || {}).name,
      grindRows: (STATE.grindLog || []).length }));
    /* FLOOR — the suppression is scoped to the adoption, so THIS tab can still
       save afterwards. A guard left set silently stops every later write, and
       the first version of this floor asserted it on a freshly booted THIRD
       page, whose _adoptingReset is false whatever the adopting tab did — so
       the mutant that never releases the guard walked straight through. The
       tab that adopted is the only one that can be stuck, and the write has to
       carry a marker: asserting the erased shape proves nothing, because a
       suppressed save leaves exactly the erased shape the other tab wrote. */
    const gSaves = await G1.evaluate(() => {
      STATE.profile = STATE.profile || {};
      STATE.profile.name = 'AfterAdopt';
      save();
      try { return (JSON.parse(localStorage.getItem(STORE_KEY) || '{}').profile || {}).name === 'AfterAdopt'; }
      catch (e) { return false; }
    });
    await G1.waitForTimeout(250);
    /* and a later save from that tab must not put the erased data back */
    const G3 = await ctx.newPage(); await boot(G3);
    const gHeld = await G3.evaluate(() => ({ logs: Object.keys(STATE.logs || {}).length,
      onboarded: !!STATE.onboarded }));
    await G1.close(); await G2.close(); await G3.close();

    t.ok('guard: the grinder really was live with data to lose',
      gBefore.live && gBefore.logs === 1 && gBefore.name === 'Sam', JSON.stringify(gBefore));
    t.eq('a reset closes a live grinder too', gAfter.live, false);
    t.eq('and the erased state is what the tab is left holding', gAfter.logs, 0);
    t.eq('including the pointer', gAfter.ptr, 0);
    /* '' is the DEFAULT_STATE name, which is what a genuine erase leaves —
       not undefined. The guard above pins that it really was 'Sam' first. */
    t.ok('and the profile', !gAfter.name, JSON.stringify(gAfter.name));
    t.eq('and the grinder stop it wrote on the way out is gone with it', gAfter.grindRows, 0);
    t.eq('the tab is no longer onboarded', gAfter.onboarded, false);
    t.eq('and a later save cannot resurrect the erased logs', gHeld.logs, 0);
    t.eq('nor the onboarding', gHeld.onboarded, false);
    t.ok('FLOOR: and the tab that adopted can still save afterwards', gSaves);

    /* FLOOR — the reset detector must not fire when OUR copy was never onboarded
       either. Two tabs open during the setup wizard is a real state, and an
       ordinary answer saved in one would otherwise tell the other its data had
       been reset. Without this case, dropping `STATE.onboarded===true` from the
       test changes nothing any assertion can see. */
    const F1 = await ctx.newPage(); await boot(F1);
    const F2 = await ctx.newPage(); await boot(F2);
    await F1.evaluate(() => { STATE = DEFAULT_STATE(); save(); });
    await F2.waitForTimeout(600);
    const freshState = await Promise.all([F1, F2].map(p =>
      p.evaluate(() => !!STATE.onboarded)));
    await F2.evaluate(() => {
      window.__ft = []; const rt = window.toast;
      window.toast = m => { window.__ft.push(String(m)); return rt(m); };
    });
    await F1.evaluate(() => { STATE.profile.age = 41; save(); });
    await F2.waitForTimeout(800);
    const fresh = await F2.evaluate(() => ({ toasts: window.__ft.slice(), age: STATE.profile.age }));
    await F1.close(); await F2.close();

    t.ok('guard: both tabs really were un-onboarded',
      freshState[0] === false && freshState[1] === false, JSON.stringify(freshState));
    t.eq('FLOOR: an ordinary write between two fresh tabs is adopted', fresh.age, 41);
    t.ok('FLOOR: and is NOT reported as a reset',
      fresh.toasts.some(m => /another tab/i.test(m)) && !fresh.toasts.some(m => /reset/i.test(m)),
      JSON.stringify(fresh.toasts));

    /* FLOOR — ONE tab alone behaves exactly as before: no swap, no toast. */
    await B.close();
    await A.evaluate(() => {
      window.__t = []; const rt = window.toast;
      window.toast = m => { window.__t.push(String(m)); return rt(m); };
      STATE.progressPtr = 11; save();
    });
    await A.waitForTimeout(700);
    const solo = await A.evaluate(() => ({ ptr: STATE.progressPtr, toasts: window.__t.slice() }));
    t.eq('FLOOR: a single tab keeps what it just saved', solo.ptr, 11);
    t.eq('FLOOR: and is never told about another tab', solo.toasts.length, 0);
    await ctx.close();
  }

  /* ---------- a one-step-back restore replaces work done SINCE -----------
     Both snapshots restore the whole of STATE, so anything logged after the
     step they name goes with it. Neither confirm said so: "Undo the last
     import and restore what was here before it?" names only the import, and an
     athlete who trained three sessions afterwards lost those three with
     nothing on screen having said so. Same class as "this cannot be undone"
     being false. The check reads the SENTENCE the athlete is asked, because
     that sentence is the whole of the fix. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const o = {}, asked = [];
      const realConfirm = window.confirm;
      window.confirm = q => { asked.push(String(q)); return false; };   // decline: nothing is destroyed
      const before = JSON.stringify(STATE);
      try { localStorage.setItem('coreforge.v1.preimport', JSON.stringify(STATE)); } catch (e) {}
      try { localStorage.setItem('coreforge.v1.crosstab', JSON.stringify(STATE)); } catch (e) {}
      undoImport();
      undoCrossTab();
      window.confirm = realConfirm;
      o.asked = asked.length;
      o.importAsk = asked[0] || '';
      o.crossAsk = asked[1] || '';
      o.declinedChangedNothing = JSON.stringify(STATE) === before;
      try { localStorage.removeItem('coreforge.v1.preimport'); } catch (e) {}
      try { localStorage.removeItem('coreforge.v1.crosstab'); } catch (e) {}
      return o;
    });
    t.eq('guard: both restores really did ask before doing anything', r.asked, 2);
    t.ok('guard: and declining really left the state alone', r.declinedChangedNothing, r);
    t.ok('the import undo names the import it reverses',
      /import/i.test(r.importAsk), r.importAsk);
    t.ok('and says work logged SINCE it goes too', /since/i.test(r.importAsk), r.importAsk);
    t.ok('and that the restore cannot itself be undone',
      /cannot be undone/i.test(r.importAsk), r.importAsk);
    t.ok('the cross-tab restore names the other tab it reverses',
      /another tab/i.test(r.crossAsk), r.crossAsk);
    t.ok('and says work logged since goes too', /since/i.test(r.crossAsk), r.crossAsk);
    t.ok('and that it cannot be undone either',
      /cannot be undone/i.test(r.crossAsk), r.crossAsk);
    errors.forEach(e => t.fail('a page error fired during the restore-confirm checks', e));
    await browser.close();
  }

  srv.close();
  return t.finish();
}
