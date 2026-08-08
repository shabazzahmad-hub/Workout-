/* Safety gating. Every check here maps to a defect that actually shipped: an
   unscreened athlete handed a maximal test battery, a flagged low back routed
   into loaded lumbar flexion, a declared allergy that filtered nothing, and a
   crafted backup executing script in the origin that holds the API keys. */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

export default async function run() {
  const t = suite('safety gating');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  // ---- pre-participation screening ----------------------------------------
  const parq = await page.evaluate(() => {
    const o = {};
    // Never answered: unanswered is NOT the same as clean.
    STATE.profile.parq = []; STATE.profile.parqDone = false; STATE.profile.medCleared = false;
    o.unansweredLocks = safeMode();
    o.offersCheckInline = /openHealthCheck/.test(baselineIntroHTML());
    o.hidesStart = !/id="startAssess"/.test(baselineIntroHTML());
    o.retestAlsoLocks = /openHealthCheck/.test(reassessIntroHTML(1));
    // Answered clean: unlocked.
    STATE.profile.parqDone = true;
    o.cleanUnlocks = !safeMode() && /id="startAssess"/.test(baselineIntroHTML());
    // Flagged: locked until cleared.
    STATE.profile.parq = ['heart'];
    o.flaggedLocks = safeMode();
    STATE.profile.medCleared = true;
    o.clearanceUnlocks = !safeMode();
    // A NEW flag after clearance must re-arm the gate.
    const older = STATE.profile.parq.slice();
    const picked = ['heart', 'preg'];
    if (picked.some(q => !older.includes(q))) STATE.profile.medCleared = false;
    STATE.profile.parq = picked;
    o.newFlagReArms = safeMode();
    // The battery must refuse to open even if a stale render left a button behind.
    let opened = true;
    try { assessState = null; openAssessment(false); opened = !!assessState; } catch (e) { opened = false; }
    o.openAssessmentRefuses = !opened;
    try { closeSheet(); } catch (e) {}   // it opens the health check — do not leave it covering the UI
    // A non-array parq must fail CLOSED, not read as "nothing declared".
    STATE.profile.parq = 'heart'; STATE.profile.medCleared = false; STATE.profile.parqDone = true;
    normalizeState();
    o.corruptParqFailsClosed = safeMode();
    STATE.profile.parq = []; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
    // Skipping must still yield a trainable program with all eight anchors.
    skipBaseline();
    o.skipGivesAllAnchors = ['plank', 'side', 'hollow', 'lower', 'push', 'pull', 'squat', 'dyn']
      .every(k => STATE.baseline.maxes[k] > 0);
    o.skipScoreIsNull = STATE.baseline.score === null;
    return o;
  });
  t.ok('an unanswered health screen locks the max-effort battery', parq.unansweredLocks, parq);
  t.ok('the health check is reachable inline from the baseline gate', parq.offersCheckInline, parq);
  t.ok('the start button is hidden while unscreened', parq.hidesStart, parq);
  t.ok('the re-test gate screens too', parq.retestAlsoLocks, parq);
  t.ok('a clean screen unlocks the battery', parq.cleanUnlocks, parq);
  t.ok('a flagged athlete is locked out', parq.flaggedLocks, parq);
  t.ok('medical clearance unlocks it', parq.clearanceUnlocks, parq);
  t.ok('a NEW flag after clearance re-arms the gate', parq.newFlagReArms, parq);
  t.ok('openAssessment() itself refuses in safe mode', parq.openAssessmentRefuses, parq);
  t.ok('a corrupt parq field fails closed', parq.corruptParqFailsClosed, parq);
  t.ok('skipping the test still yields all 8 anchors', parq.skipGivesAllAnchors, parq);

  // ---- injury gating -------------------------------------------------------
  const inj = await page.evaluate(() => {
    const JOINTS = Object.keys(JOINT_RISK);
    const stillRisky = [], offRegion = [];
    for (let mask = 1; mask < (1 << JOINTS.length); mask++) {
      const lims = JOINTS.filter((_, i) => mask & (1 << i));
      STATE.profile.limitations = lims;
      const risky = k => lims.some(j => (JOINT_RISK[j] || []).includes(k));
      Object.keys(EX).forEach(k => {
        const out = safeSwap(k);
        if (!EX[out] || risky(out)) stillRisky.push(lims.join('+') + '/' + k + '->' + out);
      });
    }
    // a flagged low back must never land in loaded lumbar flexion
    const FLEX = ['revcrunch', 'crunch', 'situp', 'bicycle', 'vup', 'tuckvup', 'legraise',
      'kneeraise', 'vertcrunch', 'situptwist', 'heeltouch', 'flutter', 'scissors'];
    STATE.profile.limitations = ['lowback'];
    const lowbackFlex = Object.keys(EX).map(k => safeSwap(k)).filter(k => FLEX.includes(k));
    // a flagged wrist must still get a press, not a leg hold
    STATE.profile.limitations = ['wrist'];
    const wristPress = safeSwap('pushup');
    STATE.profile.limitations = [];
    return { stillRisky: [...new Set(stillRisky)], lowbackFlex: [...new Set(lowbackFlex)], wristPress };
  });
  t.ok('safeSwap always lands clear across all 31 joint combinations', inj.stillRisky.length === 0, inj.stillRisky.slice(0, 6));
  t.ok('a flagged low back never lands in lumbar flexion', inj.lowbackFlex.length === 0, inj.lowbackFlex);
  t.ok('a flagged wrist still gets a real press', inj.wristPress === 'fistpushup', inj);

  // ---- allergens -----------------------------------------------------------
  const alg = await page.evaluate(() => {
    const o = {}; const N = STATE.nutrition;
    N.diet = 'omnivore'; N.allergens = ['peanut', 'shellfish', 'dairy'];
    const served = RECIPES.filter(dietOk);
    o.leaks = served.filter(r => (r.alg || []).some(a => N.allergens.includes(a))).map(r => r.id);
    o.untaggedBlocked = !dietOk({ id: 'x', type: 'snack', ok: ['omnivore'], name: 'Untagged' });
    // a string where an array belongs must not silently disable filtering
    N.allergens = 'peanut,dairy'; normalizeState();
    o.stringRepaired = Array.isArray(N.allergens) && N.allergens.length === 2;
    N.allergens = []; N.plan = null;
    // no diet+allergen combination may ship a plan with a silent hole
    const holes = [];
    [['vegan', ['soy']], ['omnivore', ['soy', 'gluten']], ['vegetarian', ['dairy', 'egg']],
     ['pescatarian', ['fish', 'shellfish']], ['halal', ['gluten']]].forEach(([d, a]) => {
      N.diet = d; N.allergens = a; N.plan = null;
      const p = generateMealPlan();
      const html = mealPlanHTML();
      if (p.meals.length < mealSlots().length && !/No safe/.test(html)) holes.push(d + '+' + a.join('+'));
    });
    N.diet = 'omnivore'; N.allergens = []; N.plan = null;
    o.holes = holes;
    return o;
  });
  t.ok('no flagged allergen is ever served', alg.leaks.length === 0, alg.leaks);
  t.ok('an untagged recipe fails closed', alg.untaggedBlocked, alg);
  t.ok('a string allergen list is repaired, not discarded', alg.stringRepaired, alg);
  t.ok('a meal-plan gap is always reported, never silent', alg.holes.length === 0, alg.holes);

  // ---- eating window must never quietly change the diet ---------------------
  /* Time-restricted eating is an adherence tool, not a metabolic one. If turning
     it on ever moved kcalTarget or the protein target, the app would be handing
     the athlete a deficit they did not choose. */
  const win = await page.evaluate(() => {
    const o = {};
    STATE.nutrition.eatWindow = null;
    recalcKcalFromStored();
    const before = { kcal: nut().kcalTarget, p: proteinTargetG() };
    o.defaultOff = eatWin().on === false;
    toggleEatWindow();
    const after = { kcal: nut().kcalTarget, p: proteinTargetG() };
    o.unchanged = before.kcal === after.kcal && before.p === after.p;
    o.saysUnchanged = /unchanged/.test(eatWindowHTML());
    // meals land inside the window, in order, last one before it shuts
    const t = mealTimes();
    o.meals = t && t.length === mealSlots().length;
    const mins = l => { const m = /^(\d+):(\d+)(am|pm)$/.exec(l); let h = +m[1] % 12;
      if (m[3] === 'pm') h += 12; return h * 60 + (+m[2]); };
    const w = eatWin();
    o.inside = t.every(x => mins(x.label) >= w.start * 60 && mins(x.label) <= (w.start + w.hours) * 60);
    o.ordered = t.every((x, i) => i === 0 || mins(x.label) > mins(t[i - 1].label));
    // the state machine reads correctly around the clock
    setEatWindow({ start: 12, hours: 8 });
    o.fastingAt9 = eatWindowState(new Date(2026, 7, 8, 9, 0)).inWindow === false;
    o.openAt14 = eatWindowState(new Date(2026, 7, 8, 14, 0)).inWindow === true;
    o.fastingAt21 = eatWindowState(new Date(2026, 7, 8, 21, 0)).inWindow === false;
    // a very short window must warn about protein rather than silently accept less
    setEatWindow({ hours: 6 });
    o.warnsShort = /struggle to fit/.test(eatWindowHTML());
    setEatWindow({ hours: 8 });
    // a corrupt stored value must be repaired, not crash the Fuel tab
    STATE.nutrition.eatWindow = '16:8';
    normalizeState();
    o.corruptRepaired = eatWin().on === false;
    let rendered = true;
    try { eatWindowHTML(); mealPlanHTML(); } catch (e) { rendered = false; }
    o.rendersAfterCorrupt = rendered;
    STATE.nutrition.eatWindow = null;
    return o;
  });
  t.ok('the eating window is off by default', win.defaultOff, win);
  t.ok('turning it on changes NOTHING about calories or protein', win.unchanged, win);
  t.ok('the card states plainly that calories are unchanged', win.saysUnchanged, win);
  t.ok('every meal is retimed into the window', win.meals && win.inside, win);
  t.ok('the meals stay in order', win.ordered, win);
  t.ok('it reads as fasting before the window opens', win.fastingAt9, win);
  t.ok('it reads as open inside the window', win.openAt14, win);
  t.ok('it reads as fasting after the window shuts', win.fastingAt21, win);
  t.ok('a very short window warns about protein', win.warnsShort, win);
  t.ok('a corrupt window value is repaired', win.corruptRepaired, win);
  t.ok('Fuel still renders after a corrupt window value', win.rendersAfterCorrupt, win);

  // ---- stored XSS ----------------------------------------------------------
  await page.evaluate(() => {
    const P = '<img src=/nope onerror="window.__PWN=1">';
    STATE.profile.name = P;
    STATE.baseline.level = P;
    STATE.scoreHistory = [{ date: '2026-01-01', score: 50, level: P, testCount: 8 }];
    try { nut().foods = [{ name: P, kcal: 300, p: 20, c: 30, f: 10, fav: true }]; } catch (e) {}
    try { nutToday().food = [{ name: P, kcal: 300, p: 20, c: 30, f: 10, meal: 'lunch' }]; } catch (e) {}
    try { STATE.favs = [{ name: P, items: [{ exId: 'pushup', unit: 'reps', target: 10, sets: 3, rest: 45 }] }]; } catch (e) {}
    save();
  });
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
  for (const tab of ['today', 'program', 'fuel', 'progress', 'guide']) {
    await page.evaluate(t => { try { go(t); } catch (e) {} }, tab);
    await page.waitForTimeout(120);
  }
  const xss = await page.evaluate(() => ({
    executed: !!window.__PWN,
    rawTag: /<img src=\/nope/.test(document.body.innerHTML),
  }));
  t.ok('a stored payload never executes', !xss.executed, xss);
  t.ok('a stored payload never reaches the DOM as live markup', !xss.rawTag, xss);

  await browser.close(); srv.close();
  return t.finish(errors);
}
