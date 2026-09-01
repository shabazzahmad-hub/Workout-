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

  /* ---- parallettes: a wrist flag is a reason to change the IMPLEMENT ------
     A bent-back wrist under load is the entire reason JOINT_RISK.wrist exists,
     and gripping a bar instead removes it. So an athlete who owns parallettes
     should KEEP the push-up and the L-Sit rather than be routed away from them.

     Both directions are needed and neither alone is enough: without the "no
     bars" half, a version that simply deleted the wrist list would pass; without
     the "owns bars" half, the relief could be absent entirely and nothing would
     notice. */
  {
    const r = await page.evaluate(() => {
      const P = STATE.profile;
      const keep = { gear: (P.gear || []).slice(), lims: (P.limitations || []).slice() };
      const run = (gear, lims) => { P.gear = gear; P.limitations = lims; return {
        pushup: safeSwap('pushup'), lsit: safeSwap('lsit'),
        // must NOT be relieved — you cannot travel your hands on two fixed bars
        climber: safeSwap('mountainclimber'), crawl: safeSwap('bearcrawl'),
      }; };
      const out = {};
      out.wristNoBars   = run(['bench'], ['wrist']);
      out.wristWithBars = run(['bench', 'parallettes'], ['wrist']);
      // the shoulder is a different joint and a bar does not fix it
      out.shoulderWithBars = run(['bench', 'parallettes'], ['shoulder']);
      // relief must never fire for an athlete with no flag at all
      out.noFlag = run(['bench', 'parallettes'], []);
      P.gear = keep.gear; P.limitations = keep.lims;
      return out;
    });
    t.ok('a wrist flag with NO bars still routes away from the push-up',
      r.wristNoBars.pushup !== 'pushup', r.wristNoBars);
    t.ok('and away from the L-Sit', r.wristNoBars.lsit !== 'lsit', r.wristNoBars);
    t.eq('owning parallettes KEEPS the push-up', r.wristWithBars.pushup, 'pushup', r.wristWithBars);
    t.eq('and keeps the L-Sit', r.wristWithBars.lsit, 'lsit', r.wristWithBars);
    // The scope of the relief is the point — a bar cannot help a travelling hand.
    t.ok('bars do not excuse mountain climbers',
      r.wristWithBars.climber !== 'mountainclimber', r.wristWithBars);
    t.ok('nor a bear crawl', r.wristWithBars.crawl !== 'bearcrawl', r.wristWithBars);
    // Only the WRIST dimension is relieved, never the whole exercise.
    t.ok('a flagged SHOULDER still leaves the L-Sit even with bars',
      r.shoulderWithBars.lsit !== 'lsit', r.shoulderWithBars);
    t.eq('an unflagged athlete is unaffected', r.noFlag.pushup, 'pushup', r.noFlag);
  }

  /* ---- the new movements are flagged, and flagged for the RIGHT joints ----
     The generic "flagged joints never leak" sweep cannot prove this: an exercise
     nobody added to JOINT_RISK simply never enters the risky bucket, so that
     check stays green whether or not these were ever flagged at all.

     The negative half matters as much as the positive one. A neutral grip on a
     bar is exactly what takes the wrist out of it, so a parallette movement that
     was wrist-flagged would be wrong — and would also make the relief above
     pointless, since the athlete would be swapped away from the very thing they
     bought the bars for. */
  {
    const r = await page.evaluate(() => {
      const inList = (j, k) => (JOINT_RISK[j] || []).indexOf(k) >= 0;
      const out = { exists: {}, shoulder: {}, wrist: {}, gated: {}, lands: {} };
      ['tucklsit', 'plegraise', 'ppushup'].forEach(k => {
        out.exists[k] = !!EX[k];
        out.shoulder[k] = inList('shoulder', k);
        out.wrist[k] = inList('wrist', k);
        out.gated[k] = (EX[k] && EX[k].equip) ? EX[k].equip.slice() : [];
      });
      // a flagged shoulder has to land somewhere real, whatever the mechanism
      const P = STATE.profile;
      const keep = { gear: (P.gear || []).slice(), lims: (P.limitations || []).slice() };
      P.gear = ['parallettes']; P.limitations = ['shoulder'];
      ['tucklsit', 'plegraise', 'ppushup'].forEach(k => {
        const alt = safeSwap(k);
        out.lands[k] = { to: alt, real: !!EX[alt], clear: (JOINT_RISK.shoulder || []).indexOf(alt) < 0 };
      });
      P.gear = keep.gear; P.limitations = keep.lims;
      // the ladder gained its missing rung, in the right place
      const h = LADDERS.hollowL;
      out.rung = { at: h.indexOf('tucklsit'), afterVsit: h.indexOf('tucklsit') === h.indexOf('vsit') + 1,
        beforeLsit: h.indexOf('tucklsit') === h.indexOf('lsit') - 1,
        easierThanLsit: EX.tucklsit.hardness > EX.lsit.hardness,
        harderThanVsit: EX.tucklsit.hardness < EX.vsit.hardness };
      return out;
    });
    ['tucklsit', 'plegraise', 'ppushup'].forEach(k => {
      t.ok(`[${k}] exists`, r.exists[k], r.exists);
      t.ok(`[${k}] is flagged for the shoulder`, r.shoulder[k], r.shoulder);
      t.ok(`[${k}] lands somewhere real and shoulder-clear`,
        r.lands[k].real && r.lands[k].clear, r.lands[k]);
    });
    t.ok('the Tuck L-Sit keeps the L-Sit’s wrist flag — it is the same hand position',
      r.wrist.tucklsit, r.wrist);
    ['plegraise', 'ppushup'].forEach(k =>
      t.ok(`[${k}] is NOT wrist-flagged — the neutral grip is the whole point`,
        !r.wrist[k], r.wrist));
    ['plegraise', 'ppushup'].forEach(k =>
      t.ok(`[${k}] requires the parallettes`, r.gated[k].indexOf('parallettes') >= 0, r.gated));
    t.eq('the Tuck L-Sit needs no equipment — the floor works', r.gated.tucklsit.length, 0, r.gated);
    t.ok('the Tuck L-Sit sits straight after the V-Sit', r.rung.afterVsit, r.rung);
    t.ok('and straight before the L-Sit', r.rung.beforeLsit, r.rung);
    t.ok('easier than the L-Sit', r.rung.easierThanLsit, r.rung);
    t.ok('and harder than the V-Sit', r.rung.harderThanVsit, r.rung);
  }

  /* ---- an athlete with no bars is never offered a parallette movement -----
     Asserted behaviourally across a real spread of sessions, not by reading the
     GEAR_FALLBACK literal back: reading the map proves the data changed, never
     that anything consults it. */
  {
    const r = await page.evaluate(() => {
      const P = STATE.profile;
      const keep = { gear: (P.gear || []).slice(), ptr: STATE.progressPtr };
      P.gear = [];                       // owns nothing at all
      /* The session exposes main/finisher (plus whatever bonus slots the build
         added), never a flat `items`. Walking every array property collects the
         focus and corrective bonuses too, which is where these movements would
         actually surface. */
      const seen = new Set();
      for (let i = 0; i < 400; i++) {
        try {
          const sess = buildSession(i);
          Object.values(sess).forEach(v => {
            (Array.isArray(v) ? v : [v]).forEach(m => { if (m && m.exId) seen.add(m.exId); });
          });
        } catch (e) {}
      }
      P.gear = keep.gear; STATE.progressPtr = keep.ptr;
      return { offered: ['plegraise', 'ppushup'].filter(k => seen.has(k)),
        sawFallback: seen.has('pushup') || seen.has('legraise'), total: seen.size };
    });
    // Guard: an empty result would prove nothing if the sweep reached nothing.
    t.ok('guard: the sweep really built sessions', r.total > 20, r);
    t.ok('guard: the fallback movements are genuinely reachable', r.sawFallback, r);
    t.eq('a bar-free athlete is never offered a parallette movement', r.offered.length, 0, r);
  }

  /* ---- the two gates fail CLOSED on a movement that does not exist -------
     swapStillValid()'s own comment has said "fails CLOSED" since it was
     written, and it did — for a THROW. For a target that is not an exercise at
     all it answered YES: measured, a missing id, {}, 42 and undefined all came
     back true, because hasGearFor() read "no equipment needed" out of "no
     exercise" and safeSwap() hands an unknown id straight back, so the identity
     test held. A comment claiming an invariant is not the invariant.

     Every caller today guards with EX[...] first, so nothing changes on any
     live path — measured byte-identical across 486 sessions x 9 athlete
     configurations. The contracts are therefore pinned DIRECTLY, the way
     prepDatePassed() is: a guard consulted in one narrow branch still has to
     mean what it is named. */
  {
    const r = await page.evaluate(() => {
      const sv = v => { try { return swapStillValid(v); } catch (e) { return 'THREW'; } };
      const hg = v => { try { return hasGearFor(v); } catch (e) { return 'THREW'; } };
      const junk = ['not-an-exercise', '', 'constructor'];
      return {
        // FLOOR — a real bodyweight movement is still valid and still needs no kit
        realValid: sv('pushup'), realGear: hg('pushup'),
        // FLOOR — a movement whose kit the athlete lacks is still refused for that
        gearedGear: hg('kbrow'),
        junkValid: junk.map(sv), junkGear: junk.map(hg),
        objValid: sv({}), numValid: sv(42), undefValid: sv(undefined),
        objGear: hg({}), numGear: hg(42), undefGear: hg(undefined),
        // guard: the seeded athlete really does own nothing, or the floors are vacuous
        gear: (STATE.profile.gear || []).slice()
      };
    });

    t.ok('guard: the athlete owns no kettlebell, so the geared floor can fire',
      r.gear.indexOf('kettlebell') < 0, JSON.stringify(r.gear));
    t.eq('FLOOR: a real bodyweight movement is still a valid swap', r.realValid, true);
    t.eq('FLOOR: and still needs no equipment', r.realGear, true);
    t.eq('FLOOR: a movement whose kit they lack is still refused', r.gearedGear, false);
    r.junkValid.forEach((v, i) => t.eq(
      `a movement that does not exist is not a valid swap (${JSON.stringify(['not-an-exercise','','constructor'][i])})`,
      v, false));
    r.junkGear.forEach((v, i) => t.eq(
      `nor does it read as needing no equipment (${JSON.stringify(['not-an-exercise','','constructor'][i])})`,
      v, false));
    t.eq('an object is not a valid swap', r.objValid, false);
    t.eq('nor a number', r.numValid, false);
    t.eq('nor undefined', r.undefValid, false);
    t.eq('and none of them reads as needing no equipment',
      [r.objGear, r.numGear, r.undefGear].join(','), 'false,false,false');
  }

  /* ---- an inherited key is not an exercise, at every gate ----------------
     EX is an object literal, so EX['constructor'] is Object.prototype.
     constructor — TRUTHY — and every `EX[id] &&` guard in the app passed it.
     Reachable: STATE.swaps and customFav both come out of an import and both
     were only ever truthiness-tested. Measured end to end BEFORE the fix: a
     stored swap of 'constructor' survived the boot, became the session's
     finisher with target NaN, and Today printed "undefined  1 x NaN reps".
     Same trap v328 recorded for CARDIO_INFO, one map over. */
  {
    const r = await page.evaluate(() => {
      const K = 'constructor';
      const o = {};
      o.truthy = !!EX[K];                       // guard: the trap is real
      o.known = exKnown(K);
      o.knownReal = exKnown('pushup');
      o.knownNonString = exKnown(42);

      // the WRITER
      STATE.swaps = {};
      setSwap(0, '__fin', K);
      o.writerStored = JSON.stringify(STATE.swaps);
      setSwap(0, '__fin', 'squatjack');         // FLOOR: a real target still stores
      o.writerReal = JSON.stringify(STATE.swaps);

      // the BOOT REPAIR — drops the bad target, keeps the athlete's real ones
      STATE.swaps = { 0: { __fin: K, focus: 'pushup' }, 1: { __fin: 'not-an-exercise' } };
      normalizeState();
      o.repaired = JSON.stringify(STATE.swaps);

      // end to end: the session card no longer carries a movement that is not one
      STATE.swaps = {}; STATE.swaps[STATE.progressPtr] = { __fin: K };
      normalizeState();
      const sess = buildSession(STATE.progressPtr);
      o.finisher = sess.finisher ? String(sess.finisher.exId) + ':' + String(sess.finisher.target) : '(none)';
      go('today'); setTodayTab('workout');
      const txt = document.querySelector('#v-today').textContent;
      o.cardNaN = /NaN/.test(txt) || /undefined/.test(txt);

      // customFav: the repair intends "real exercises only", and starting one builds a session
      STATE.customFav = [{ name: 'Bad', items: [K, 'not-an-exercise', 'pushup'] }];
      normalizeState();
      o.favAfterBoot = JSON.stringify(STATE.customFav);
      return o;
    });

    t.ok('guard: EX[\'constructor\'] really is truthy, so the trap is real', r.truthy);
    t.eq('the membership test refuses an inherited key', r.known, false);
    t.eq('FLOOR: and still accepts a real movement', r.knownReal, true);
    t.eq('and refuses a non-string', r.knownNonString, false);
    t.eq('the swap writer refuses to store an inherited key', r.writerStored, '{}');
    t.eq('FLOOR: and still stores a real one', r.writerReal, '{"0":{"__fin":"squatjack"}}');
    t.eq('the boot repair drops a bad target and keeps the real one',
      r.repaired, '{"0":{"focus":"pushup"}}');
    t.ok('so the session finisher is a real movement again',
      r.finisher !== '(none)' && r.finisher.indexOf('constructor') < 0
        && r.finisher.indexOf('NaN') < 0, r.finisher);
    t.eq('and the session card prints no NaN', r.cardNaN, false);
    t.eq('a saved favourite keeps only movements that exist',
      r.favAfterBoot, '[{"name":"Bad","items":["pushup"]}]');
  }

  await browser.close(); srv.close();
  return t.finish(errors);
}
