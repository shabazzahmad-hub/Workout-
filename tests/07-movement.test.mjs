/* Making the step target up on the bike.

   This is a credit system: minutes on a trainer are converted into steps and
   counted against the day's target. A conversion that is too generous hands the
   athlete a deficit they believe in and do not have — the worst kind of wrong,
   because nothing on screen looks broken and the scale just stops moving.

   So the checks here are mostly about the arithmetic being honest in both
   directions, and about the number and the habit tick never contradicting each
   other. */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

export default async function run() {
  const t = suite('movement & the bike');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  // ---- the conversion ------------------------------------------------------
  const conv = await page.evaluate(() => {
    const o = {};
    o.levels = BIKE_LEVELS.map(b => b.k);
    o.monotonic = BIKE_LEVELS.every((b, i) => !i || b.met > BIKE_LEVELS[i - 1].met);
    o.allCoached = BIKE_LEVELS.every(b => b.label && b.cue && b.rpe);
    o.unique = new Set(BIKE_LEVELS.map(b => b.k)).size === BIKE_LEVELS.length;
    // MET × 35 is the whole model; if that ever stops holding, the comment lies
    o.matchesRule = BIKE_LEVELS.every(b => bikeStepsPerMin(b.k) === Math.round(b.met * 35));
    // both sides are net of resting, so a minute of riding must never be worth
    // more than a minute of hard walking-equivalent effort
    o.sane = BIKE_LEVELS.every(b => bikeStepsPerMin(b.k) >= 100 && bikeStepsPerMin(b.k) <= 400);
    // the step conversion cannot depend on bodyweight — the calories do
    const w = STATE.nutrition.weightKg, ms = STATE.measurements;
    STATE.measurements = [];
    STATE.nutrition.weightKg = 55; const light = BIKE_LEVELS.map(b => bikeStepsPerMin(b.k));
    const kLight = bikeKcalPerMin('steady'), sLight = kcalPerStep();
    STATE.nutrition.weightKg = 130; const heavy = BIKE_LEVELS.map(b => bikeStepsPerMin(b.k));
    const kHeavy = bikeKcalPerMin('steady'), sHeavy = kcalPerStep();
    STATE.nutrition.weightKg = w; STATE.measurements = ms;
    o.weightIndependent = JSON.stringify(light) === JSON.stringify(heavy);
    o.kcalScalesWithWeight = Math.abs(kHeavy / kLight - 130 / 55) < 0.01;
    o.stepKcalScalesToo = Math.abs(sHeavy / sLight - 130 / 55) < 0.01;
    // an unknown level must fall back to a real one, not to undefined
    o.unknownFallsBack = bikeLevel('nonsense').k === 'steady' && bikeStepsPerMin('nonsense') > 0;
    // the two energy models must agree — they are the whole basis of the trade
    o.perStepMatches = Math.abs(kcalPerStep() - stepKcal(1000) / 1000) < 0.0002;
    // minutes-for-steps has to actually cover the steps, never fall a rounding short
    o.covers = [];
    BIKE_LEVELS.forEach(b => [500, 3333, 8000, 10000, 17777].forEach(n => {
      const min = bikeMinutesFor(n, b.k);
      if (min * bikeStepsPerMin(b.k) < n) o.covers.push(`${b.k}/${n}: ${min}min short`);
      if (min > Math.ceil(n / bikeStepsPerMin(b.k))) o.covers.push(`${b.k}/${n}: overshoots`);
    }));
    o.zeroNeedsNoRide = BIKE_LEVELS.every(b => bikeMinutesFor(0, b.k) === 0 && bikeMinutesFor(-5, b.k) === 0);
    // and each intensity must cost roughly the same energy for the same job —
    // that is what makes them alternatives rather than different deals
    const costs = BIKE_LEVELS.map(b => bikeMinutesFor(10000, b.k) * bikeKcalPerMin(b.k));
    o.costs = costs.map(c => Math.round(c));
    o.sameEnergy = Math.max(...costs) - Math.min(...costs) < 40;
    o.matchesWalking = Math.abs(Math.min(...costs) - stepKcal(10000)) < 60;
    o.tenK = BIKE_LEVELS.map(b => bikeMinutesFor(10000, b.k));
    /* Bands, not a single number, because the failure this guards against is
       quiet: swapping a NET MET for the gross compendium value looks perfectly
       reasonable in the table, keeps MET × 35 true, keeps every intensity
       costing the same energy — and hands over ~20% more credit than was
       earned. Only the wall-clock time gives it away. 10,000 steps is about
       100 minutes of walking; steady riding should take roughly half of that,
       and an easy spin most of it. */
    const BANDS = { easy: [62, 80], steady: [45, 58], hard: [33, 43], intervals: [26, 36] };
    o.outOfBand = BIKE_LEVELS.filter(b => {
      const m = bikeMinutesFor(10000, b.k), [lo, hi] = BANDS[b.k];
      return m < lo || m > hi;
    }).map(b => b.k + ':' + bikeMinutesFor(10000, b.k) + 'min');
    o.validatorClean = validateData().length === 0;
    return o;
  });
  t.eq('the four intensities are the ones the copy describes', conv.levels,
    ['easy', 'steady', 'hard', 'intervals']);
  t.ok('each level is harder than the one before it', conv.monotonic, conv);
  t.ok('every level carries an RPE and a cue', conv.allCoached, conv);
  t.ok('no level key is duplicated', conv.unique, conv);
  t.ok('the conversion really is MET × 35', conv.matchesRule, conv);
  t.ok('no level converts to an implausible number of steps a minute', conv.sane, conv);
  t.ok('the step conversion does not depend on bodyweight', conv.weightIndependent, conv);
  t.ok('the calories do scale with bodyweight', conv.kcalScalesWithWeight, conv);
  t.ok('and so does the cost of a step', conv.stepKcalScalesToo, conv);
  t.ok('an unknown intensity falls back to a real one', conv.unknownFallsBack, conv);
  t.ok('kcalPerStep() has not drifted from stepKcal()', conv.perStepMatches, conv);
  t.ok('the minutes quoted always cover the steps owed', conv.covers.length === 0, conv.covers);
  t.ok('no steps owed means no ride owed', conv.zeroNeedsNoRide, conv);
  t.ok('every intensity costs the same energy for the same job', conv.sameEnergy, conv.costs);
  t.ok('and that energy is what the walk would have cost', conv.matchesWalking, conv);
  t.ok('every intensity takes a believable amount of wall-clock time for 10,000 steps',
    conv.outOfBand.length === 0, { outOfBand: conv.outOfBand, tenK: conv.tenK });
  t.ok('validateData stays clean with the bike model in it', conv.validatorClean, conv);

  // ---- logging it ----------------------------------------------------------
  const log = await page.evaluate(() => {
    const o = {}, T = nutToday();
    delete T.steps; delete T.bikeMin; delete T.bikeLvl; T.habits = {};
    o.emptyReadsZero = JSON.stringify(movement()) === JSON.stringify({ steps: 0, min: 0, lvl: 'steady' });
    o.emptyEquivZero = stepEquivalent() === 0;
    setSteps(4200);
    o.steps = movement().steps;
    o.equivIsSteps = stepEquivalent() === 4200;
    setBikeLvl('steady');
    setBikeMin(20);
    o.credited = stepEquivalent();
    o.creditRight = o.credited === 4200 + 20 * bikeStepsPerMin('steady');
    // changing intensity re-prices the SAME minutes, it does not add any
    setBikeLvl('hard');
    o.repriced = stepEquivalent() === 4200 + 20 * bikeStepsPerMin('hard');
    o.minutesUnchanged = movement().min === 20;
    setBikeLvl('steady');
    addBikeMin(5); o.plus = movement().min;
    addBikeMin(-5); o.minus = movement().min;
    addBikeMin(-500);
    o.neverNegative = movement().min === 0;
    // hostile input must clamp, not corrupt the day
    setSteps(-9000); o.negSteps = movement().steps; o.negStored = T.steps;
    setSteps(1e9); o.hugeSteps = movement().steps; o.hugeStored = T.steps;
    setBikeMin(99999); o.hugeMin = movement().min; o.hugeMinStored = T.bikeMin;
    setSteps('abc'); o.junkSteps = movement().steps;
    setBikeMin('abc'); o.junkMin = movement().min;
    setBikeLvl('nonsense'); o.junkLvl = movement().lvl;
    // a value that arrives corrupt from an import reads as nothing, not as NaN
    T.steps = 'lots'; T.bikeMin = [30]; T.bikeLvl = 42;
    o.corrupt = movement();
    o.corruptSafe = o.corrupt.steps === 0 && o.corrupt.min === 0 && o.corrupt.lvl === 'steady';
    o.corruptEquiv = stepEquivalent();
    delete T.steps; delete T.bikeMin; delete T.bikeLvl; T.habits = {};
    save();
    return o;
  });
  t.ok('a day with nothing logged reads as zero, not as undefined', log.emptyReadsZero, log);
  t.ok('and is worth no steps', log.emptyEquivZero, log);
  t.eq('walked steps are stored', log.steps, 4200);
  t.ok('with no ride, the equivalent is just the steps', log.equivIsSteps, log);
  t.ok('bike minutes are credited at the level ridden', log.creditRight, log);
  t.ok('changing the intensity re-prices the same minutes', log.repriced, log);
  t.ok('and does not silently add minutes', log.minutesUnchanged, log);
  t.eq('minutes go up in fives', log.plus, 25);
  t.eq('and back down', log.minus, 20);
  t.ok('minutes can never go negative', log.neverNegative, log);
  t.eq('a negative step count clamps to zero', log.negSteps, 0);
  t.eq('an absurd step count clamps', log.hugeSteps, 100000);
  t.eq('an absurd ride clamps', log.hugeMin, 600);
  /* movement() clamps on the way out too, so these three are the only checks
     that can see a missing clamp on the way IN — and what gets written is what
     exportData() ships and what the history repair has to cope with. */
  t.eq('a negative step count is not stored', log.negStored, 0);
  t.eq('an absurd step count is not stored', log.hugeStored, 100000);
  t.eq('an absurd ride is not stored', log.hugeMinStored, 600);
  t.eq('junk typed into steps reads as none', log.junkSteps, 0);
  t.eq('junk typed into minutes reads as none', log.junkMin, 0);
  t.eq('an unknown intensity resolves to a real one', log.junkLvl, 'steady');
  t.ok('a corrupt imported day reads as nothing logged', log.corruptSafe, log.corrupt);
  t.eq('and credits no steps', log.corruptEquiv, 0);

  // ---- the tick and the number must agree ----------------------------------
  const habit = await page.evaluate(() => {
    const o = {}, T = nutToday(), tgt = stepTarget();
    // nothing logged: a manual tick is the athlete's business, leave it alone
    delete T.steps; delete T.bikeMin; T.habits = { steps: true };
    syncStepHabit();
    o.manualTickKept = T.habits.steps === true;
    T.habits = { steps: false }; syncStepHabit();
    o.manualUntickKept = T.habits.steps === false;
    // short of the target
    setSteps(Math.round(tgt * 0.4));
    o.shortNotTicked = !nutToday().habits.steps;
    // the bike closes it
    setBikeLvl('steady');
    setBikeMin(bikeMinutesFor(tgt - stepEquivalent(), 'steady'));
    o.equivAfter = stepEquivalent();
    o.reachedTicks = nutToday().habits.steps === true && o.equivAfter >= tgt;
    // and taking the ride back off un-ticks it, so the two never disagree
    setBikeMin(0);
    o.removedUnticks = nutToday().habits.steps === false;
    // walking alone can do it too
    setSteps(tgt + 500);
    o.walkAloneTicks = nutToday().habits.steps === true;
    delete T.steps; delete T.bikeMin; delete T.bikeLvl; T.habits = {};
    save();
    return o;
  });
  t.ok('with nothing logged, a manual tick is left alone', habit.manualTickKept, habit);
  t.ok('and so is a manual untick', habit.manualUntickKept, habit);
  t.ok('short of the target, the habit is not ticked', habit.shortNotTicked, habit);
  t.ok('closing the gap on the bike ticks it', habit.reachedTicks, habit);
  t.ok('removing the ride un-ticks it again', habit.removedUnticks, habit);
  t.ok('walking the whole target ticks it too', habit.walkAloneTicks, habit);

  // ---- stored history is repaired ------------------------------------------
  const repair = await page.evaluate(() => {
    const o = {}, N = STATE.nutrition;
    N.days['2026-01-02'] = { water: 4, habits: {}, steps: 'heaps', bikeMin: null, bikeLvl: 'turbo' };
    N.days['2026-01-03'] = { water: 4, habits: {}, steps: -50, bikeMin: NaN, bikeLvl: 'easy' };
    N.days['2026-01-04'] = { water: 4, habits: {}, steps: 9000, bikeMin: 30, bikeLvl: 'hard' };
    normalizeState();
    const a = N.days['2026-01-02'], b = N.days['2026-01-03'], c = N.days['2026-01-04'];
    o.stringDropped = a.steps === undefined;
    o.unknownLevelDropped = a.bikeLvl === undefined;
    o.negativeDropped = b.steps === undefined;
    o.nanDropped = b.bikeMin === undefined;
    o.goodLevelKept = b.bikeLvl === 'easy';
    o.goodDayUntouched = c.steps === 9000 && c.bikeMin === 30 && c.bikeLvl === 'hard';
    delete N.days['2026-01-02']; delete N.days['2026-01-03']; delete N.days['2026-01-04'];
    save();
    return o;
  });
  t.ok('a string step count in history is dropped', repair.stringDropped, repair);
  t.ok('an unknown intensity in history is dropped', repair.unknownLevelDropped, repair);
  t.ok('a negative step count in history is dropped', repair.negativeDropped, repair);
  t.ok('a NaN ride in history is dropped', repair.nanDropped, repair);
  t.ok('a valid intensity survives the repair', repair.goodLevelKept, repair);
  t.ok('a good day is left exactly as it was', repair.goodDayUntouched, repair);

  // ---- the card ------------------------------------------------------------
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} go('fuel'); });
  await page.waitForTimeout(150);
  const card = await page.evaluate(() => {
    const T = nutToday();
    delete T.steps; delete T.bikeMin; delete T.bikeLvl; T.habits = {};
    setSteps(3000); setBikeLvl('steady'); setBikeMin(10);
    const v = document.querySelector('#v-fuel');
    const o = {
      mounted: /Movement/.test(v.innerHTML),
      hasStepsInput: !!document.querySelector('#mv-steps'),
      stepsValue: (document.querySelector('#mv-steps') || {}).value,
      levelButtons: [...v.querySelectorAll('[onclick^="setBikeLvl"]')].length,
      levelMarked: !!v.querySelector('[onclick^="setBikeLvl"].on'),
      showsShortfall: new RegExp((stepTarget() - stepEquivalent()).toLocaleString() + ' steps to go').test(v.innerHTML),
      quotesMinutes: new RegExp(bikeMinutesFor(stepTarget() - stepEquivalent(), 'steady') + ' min').test(v.innerHTML),
      showsCredit: new RegExp((10 * bikeStepsPerMin('steady')).toLocaleString()).test(v.innerHTML),
      saysItIsNotEverything: /loads the skeleton/.test(v.innerHTML),
      noNaN: !/NaN|undefined/.test(v.innerHTML),
    };
    // the one-tap close button must actually close the gap
    const btn = [...v.querySelectorAll('button')].find(b => /Log the \d+ min/.test(b.textContent));
    o.hasCloseButton = !!btn;
    if (btn) { btn.click(); o.afterClose = stepEquivalent() >= stepTarget(); }
    // and once met, the card says so instead of still nagging
    o.saysMet = /Target met/.test(document.querySelector('#v-fuel').innerHTML);
    delete T.steps; delete T.bikeMin; delete T.bikeLvl; T.habits = {};
    save(); renderFuel();
    return o;
  });
  t.ok('the Movement card is on the Fuel tab', card.mounted, card);
  t.ok('it has a step entry', card.hasStepsInput, card);
  t.eq('the entry shows what was logged', card.stepsValue, '3000');
  t.eq('every intensity is offered', card.levelButtons, 4);
  t.ok('the chosen intensity is marked', card.levelMarked, card);
  t.ok('it states the shortfall in steps', card.showsShortfall, card);
  t.ok('and what that is in minutes on the bike', card.quotesMinutes, card);
  t.ok('it shows what the ride already earned', card.showsCredit, card);
  t.ok('it says plainly that the bike does not replace walking entirely', card.saysItIsNotEverything, card);
  t.ok('nothing renders as NaN', card.noNaN, card);
  t.ok('it offers to log the ride that closes the gap', card.hasCloseButton, card);
  t.ok('and that ride actually closes it', card.afterClose, card);
  t.ok('once the target is met the card says so', card.saysMet, card);

  // ---- and it is documented on Reference -----------------------------------
  await page.evaluate(() => go('ref'));
  await page.waitForTimeout(150);
  const ref = await page.evaluate(() => {
    const v = document.querySelector('#v-ref');
    return {
      section: /Steps on the trainer/.test(v.innerHTML),
      allLevels: BIKE_LEVELS.every(b => v.innerHTML.includes(b.label)),
      allMinutes: BIKE_LEVELS.every(b => v.innerHTML.includes(bikeMinutesFor(stepTarget(), b.k) + ' min')),
      quotesTarget: v.innerHTML.includes(stepTarget().toLocaleString() + ' steps'),
      pointsAtFuel: /Fuel → Movement/.test(v.innerHTML),
      noNaN: !/NaN|undefined/.test(v.innerHTML),
    };
  });
  t.ok('the conversion is written up on Reference', ref.section, ref);
  t.ok('every intensity is listed there', ref.allLevels, ref);
  t.ok('with the minutes each one needs', ref.allMinutes, ref);
  t.ok('against the athlete\'s own step target', ref.quotesTarget, ref);
  t.ok('and it says where to log the ride', ref.pointsAtFuel, ref);
  t.ok('nothing renders as NaN', ref.noNaN, ref);

  await browser.close(); srv.close();
  return t.finish(errors);
}
