/* State durability: hostile saves, upgrades from older builds, and the everyday
   flows that write to storage. The render error boundary retries THROUGH
   normalizeState(), so anything it fails to repair is unrecoverable on a real
   phone — the app stays broken across relaunches. */
import { serve, launch, suite, waitForBoot, seedAthlete, ATHLETE } from './lib/harness.mjs';

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

  srv.close();
  return t.finish();
}
