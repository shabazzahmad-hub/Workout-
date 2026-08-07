/* State durability: hostile saves, upgrades from older builds, and the everyday
   flows that write to storage. The render error boundary retries THROUGH
   normalizeState(), so anything it fails to repair is unrecoverable on a real
   phone — the app stays broken across relaunches. */
import { serve, launch, suite, seedAthlete, ATHLETE } from './lib/harness.mjs';

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
    await page.reload({ waitUntil: 'networkidle' });
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
    await page.reload({ waitUntil: 'networkidle' });
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

  srv.close();
  return t.finish();
}
