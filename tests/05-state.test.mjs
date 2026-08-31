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

  srv.close();
  return t.finish();
}
