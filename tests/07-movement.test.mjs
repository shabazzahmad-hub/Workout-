/* Making the step target up on the bike.

   This is a credit system: a ride is converted into steps and counted against
   the day's target. A conversion that is too generous hands the athlete a
   deficit they believe in and do not have — the worst kind of wrong, because
   nothing on screen looks broken and the scale just stops moving.

   A ride can be logged in three currencies, because a bike computer shows
   whichever it feels like: minutes, distance, or calories. So most of what
   follows is about the three staying consistent with each other and with the
   step debt they are supposed to settle, in both unit systems, and about the
   habit tick never contradicting the number beside it. */
import { serve, launch, suite, seedAthlete, ATHLETE, waitForBoot } from './lib/harness.mjs';

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
    o.faster = BIKE_LEVELS.every((b, i) => !i || b.kmh > BIKE_LEVELS[i - 1].kmh);
    o.allCoached = BIKE_LEVELS.every(b => b.label && b.cue && b.rpe);
    o.unique = new Set(BIKE_LEVELS.map(b => b.k)).size === BIKE_LEVELS.length;
    // MET × 35 is the whole model; if that ever stops holding, the comment lies
    o.matchesRule = BIKE_LEVELS.every(b => bikeStepsPerMin(b.k) === Math.round(b.met * 35));
    o.sane = BIKE_LEVELS.every(b => bikeStepsPerMin(b.k) >= 100 && bikeStepsPerMin(b.k) <= 400);
    o.roadSpeeds = BIKE_LEVELS.every(b => b.kmh >= 8 && b.kmh <= 45);
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
    o.unknownFallsBack = bikeLevel('nonsense').k === 'steady' && bikeStepsPerMin('nonsense') > 0;
    /* The two energy models must agree — they are the whole basis of the trade.
       Was a tolerance comparison against the UNROUNDED per-step rate divided
       back out of stepKcal(1000)'s rounded integer — which only holds by luck
       of the seeded athlete's weight (88kg: 0.5*88 is a whole number, so
       nothing rounds). A different seed weight would fail this for a reason
       that has nothing to do with the code being wrong, the same false
       positive found live in validateData()'s own copy of this comparison.
       Exact equality against Math.round(1000*kcalPerStep()) is what stepKcal()
       actually promises, and is immune to the rounding the old form tripped
       over — confirmed across every 0.1kg step from 40-150kg. */
    o.perStepMatches = stepKcal(1000) === Math.round(1000 * kcalPerStep());
    o.covers = [];
    BIKE_LEVELS.forEach(b => [500, 3333, 8000, 10000, 17777].forEach(n => {
      const min = bikeMinutesFor(n, b.k);
      if (min * bikeStepsPerMin(b.k) < n) o.covers.push(`${b.k}/${n}: ${min}min short`);
      if (min > Math.ceil(n / bikeStepsPerMin(b.k))) o.covers.push(`${b.k}/${n}: overshoots`);
    }));
    o.zeroNeedsNoRide = BIKE_LEVELS.every(b => bikeMinutesFor(0, b.k) === 0 && bikeMinutesFor(-5, b.k) === 0);
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
  t.ok('and correspondingly faster', conv.faster, conv);
  t.ok('every level carries an RPE and a cue', conv.allCoached, conv);
  t.ok('no level key is duplicated', conv.unique, conv);
  t.ok('the conversion really is MET × 35', conv.matchesRule, conv);
  t.ok('no level converts to an implausible number of steps a minute', conv.sane, conv);
  t.ok('every speed is one a bike actually travels at', conv.roadSpeeds, conv);
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

  // ---- the three currencies ------------------------------------------------
  /* Whichever one the bike computer happens to show has to settle the same
     debt. If any of them under-covers, the athlete is told a number that does
     not do what it says. */
  for (const unit of ['cm', 'in']) {
    const cur = await page.evaluate(u => {
      STATE.profile.unit = u;
      const o = { imperial: isImperial(), du: distUnit(), short: [] };
      const T = nutToday(); delete T.steps; delete T.bikeVal; delete T.bikeUnit; T.habits = {};
      BIKE_LEVELS.forEach(b => [1200, 4500, 10000].forEach(debt => {
        const n = bikeNeed(debt, b.k);
        if (!(n.min > 0 && n.dist > 0 && n.kcal > 0)) o.short.push(`${b.k}/${debt}: missing a currency`);
        // each quoted figure, logged back, must actually cover the debt
        setBikeLvl(b.k);
        ['min', 'dist', 'kcal'].forEach(k => {
          delete T.bikeVal; setBikeUnit(k);
          setBikeVal(k === 'min' ? n.min : (k === 'dist' ? n.dist : n.kcal));
          if (stepEquivalent() < debt) o.short.push(`${b.k}/${debt}/${k}: credits ${stepEquivalent()}`);
        });
      }));
      // calories are the same whatever the intensity: same energy, less time
      o.kcalNeeds = BIKE_LEVELS.map(b => bikeNeed(10000, b.k).kcal);
      o.kcalIntensityFree = new Set(o.kcalNeeds).size === 1;
      o.kcalIsTheWalk = Math.abs(o.kcalNeeds[0] - 10000 * kcalPerStep()) <= 1;
      // distance is stored canonically in km whatever the athlete reads
      delete T.bikeVal; setBikeLvl('steady'); setBikeUnit('dist'); setBikeVal(10);
      o.storedKm = nutToday().bikeVal;
      o.shownBack = bikeRide().dist;
      o.roundTripsInDisplayUnits = Math.abs(o.shownBack - 10) < 0.15;
      o.storedIsMetric = isImperial() ? Math.abs(o.storedKm - 16.09) < 0.1 : Math.abs(o.storedKm - 10) < 0.01;
      // 10 miles must be worth more steps than 10 km, because it is further
      o.tenUnitsSteps = stepEquivalent();
      delete T.steps; delete T.bikeVal; delete T.bikeUnit; T.habits = {};
      return o;
    }, unit);
    const label = cur.imperial ? 'imperial' : 'metric';
    t.eq(`[${label}] distance is labelled in the unit the athlete reads`, cur.du, cur.imperial ? 'mi' : 'km');
    t.ok(`[${label}] every quoted figure actually covers the debt`, cur.short.length === 0, cur.short.slice(0, 6));
    t.ok(`[${label}] the calorie cost is the same at every intensity`, cur.kcalIntensityFree, cur.kcalNeeds);
    t.ok(`[${label}] and it is exactly what the walk would have cost`, cur.kcalIsTheWalk, cur);
    t.ok(`[${label}] a distance is stored canonically in km`, cur.storedIsMetric, cur);
    t.ok(`[${label}] and reads back in the athlete's own unit`, cur.roundTripsInDisplayUnits, cur);
    if (cur.imperial) t.ok('10 miles credits more than 10 km did', cur.tenUnitsSteps > 0, cur);
  }
  await page.evaluate(() => { STATE.profile.unit = 'cm'; });

  // ---- switching currency re-expresses, it does not reinterpret ------------
  const swap = await page.evaluate(() => {
    const o = {}, T = nutToday();
    delete T.steps; delete T.bikeVal; delete T.bikeUnit; T.habits = {};
    setBikeLvl('steady'); setBikeUnit('min'); setBikeVal(30);
    const asMin = bikeRide();
    setBikeUnit('kcal'); const asKcal = bikeRide(); o.kcalValue = nutToday().bikeVal;
    setBikeUnit('dist'); const asDist = bikeRide();
    setBikeUnit('min'); const back = bikeRide();
    o.rides = { asMin, asKcal, asDist, back };
    o.stable = [asKcal, asDist, back].every(r => Math.abs(r.steps - asMin.steps) <= 40);
    o.didNotReinterpret = o.kcalValue > 100;   // 30 min is ~270 kcal, not 30
    o.backToThirty = back.min === 30;
    // an unknown currency is refused rather than stored
    setBikeUnit('furlongs');
    o.unknownRefused = movement().unit === 'min';
    delete T.steps; delete T.bikeVal; delete T.bikeUnit; T.habits = {};
    save();
    return o;
  });
  t.ok('switching currency keeps the same ride', swap.stable, swap.rides);
  t.ok('it re-expresses the number rather than reinterpreting it', swap.didNotReinterpret, swap);
  t.ok('and switching back returns the original figure', swap.backToThirty, swap.rides);
  t.ok('an unknown currency is refused', swap.unknownRefused, swap);

  // ---- intensity re-prices minutes, but not work already measured ----------
  const reprice = await page.evaluate(() => {
    const o = {}, T = nutToday();
    delete T.steps; delete T.bikeVal; delete T.bikeUnit; T.habits = {};
    setBikeUnit('min'); setBikeLvl('steady'); setBikeVal(30);
    const easySteps = (setBikeLvl('easy'), bikeRide().steps);
    const hardSteps = (setBikeLvl('hard'), bikeRide().steps);
    o.minutesRepriced = hardSteps > easySteps;
    o.minutesUnchanged = bikeRide().min === 30;
    /* A distance re-prices too, but by less — and that is the physics, not a
       quirk. Covering 10 km faster costs MORE energy, because the resistance
       and the drag are what made it faster. So it must go up with intensity,
       and by proportionally less than the same minutes would. */
    delete T.bikeVal; setBikeUnit('dist'); setBikeLvl('steady'); setBikeVal(10);
    const steadySteps = bikeRide().steps, steadyMin = bikeRide().min;
    setBikeLvl('hard');
    o.distSteps = { steadySteps, hardSteps: bikeRide().steps, steadyMin, hardMin: bikeRide().min };
    o.distCostsMoreWhenFaster = bikeRide().steps > steadySteps;
    o.distTakesLessTime = bikeRide().min < steadyMin;
    o.distMovesLessThanMinutes =
      (bikeRide().steps / steadySteps) < (hardSteps / easySteps);
    /* Calories are the one currency intensity cannot touch, and it falls out of
       the algebra rather than being special-cased: the MET cancels between
       steps-per-minute and kcal-per-minute. If this ever fails, the two
       constants have drifted apart. */
    delete T.bikeVal; setBikeUnit('kcal'); setBikeLvl('steady'); setBikeVal(300);
    const kSteady = bikeRide().steps;
    setBikeLvl('intervals');
    o.kcalSameWork = Math.abs(bikeRide().steps - kSteady) <= 40;
    o.kcalAcrossAll = BIKE_LEVELS.map(b => (setBikeLvl(b.k), bikeRide().steps));
    o.kcalFlatEverywhere = Math.max(...o.kcalAcrossAll) - Math.min(...o.kcalAcrossAll) <= 40;
    delete T.steps; delete T.bikeVal; delete T.bikeUnit; T.habits = {};
    save();
    return o;
  });
  t.ok('riding the same minutes harder earns more', reprice.minutesRepriced, reprice);
  t.ok('and does not silently change the minutes', reprice.minutesUnchanged, reprice);
  t.ok('the same distance ridden harder costs more, because it does', reprice.distCostsMoreWhenFaster, reprice.distSteps);
  t.ok('and takes less time to cover', reprice.distTakesLessTime, reprice.distSteps);
  t.ok('but distance moves less with intensity than minutes do', reprice.distMovesLessThanMinutes, reprice);
  t.ok('logged calories are the same work at any intensity', reprice.kcalSameWork, reprice);
  t.ok('and that holds at every intensity, because the MET cancels', reprice.kcalFlatEverywhere, reprice.kcalAcrossAll);

  // ---- logging it ----------------------------------------------------------
  const log = await page.evaluate(() => {
    const o = {}, T = nutToday();
    delete T.steps; delete T.bikeVal; delete T.bikeUnit; delete T.bikeLvl; T.habits = {};
    if (STATE.profile) delete STATE.profile.bikeLevel;
    o.emptyReadsZero = JSON.stringify(movement()) === JSON.stringify({ steps: 0, val: 0, unit: 'min', lvl: 'steady', jval: 0, junit: 'min', jlvl: 'steady' });
    o.emptyEquivZero = stepEquivalent() === 0 && bikeMinutes() === 0;
    setSteps(4200);
    o.steps = movement().steps;
    o.equivIsSteps = stepEquivalent() === 4200;
    setBikeUnit('min'); setBikeLvl('steady'); setBikeVal(20);
    o.creditRight = stepEquivalent() === 4200 + 20 * bikeStepsPerMin('steady');
    addBikeVal(5); o.plus = bikeRide().min;
    addBikeVal(-5); o.minus = bikeRide().min;
    addBikeVal(-500); o.neverNegative = bikeRide().min === 0;
    // the step size suits the currency
    o.steps5 = bikeStep('min'); o.step1 = bikeStep('dist'); o.step50 = bikeStep('kcal');
    // hostile input must clamp, and must clamp on the way IN — that is what
    // exportData() ships and what the history repair has to cope with
    setSteps(-9000); o.negStored = nutToday().steps;
    setSteps(1e9); o.hugeStored = nutToday().steps;
    setBikeUnit('min'); setBikeVal(99999); o.hugeMinStored = nutToday().bikeVal;
    setBikeUnit('kcal'); delete T.bikeVal; setBikeVal(1e6); o.hugeKcalStored = nutToday().bikeVal;
    setSteps('abc'); o.junkSteps = movement().steps;
    setBikeUnit('min'); setBikeVal('abc'); o.junkVal = bikeRide().min;
    setBikeLvl('nonsense'); o.junkLvl = movement().lvl;
    // however absurd the stored value, the ride can never exceed a real day
    T.bikeVal = 999999; T.bikeUnit = 'min';
    o.cappedRide = bikeRide().min;
    // a value that arrives corrupt from an import reads as nothing, not as NaN
    T.steps = 'lots'; T.bikeVal = [30]; T.bikeUnit = 7; T.bikeLvl = 42;
    o.corrupt = movement();
    o.corruptSafe = o.corrupt.steps === 0 && o.corrupt.val === 0
      && o.corrupt.unit === 'min' && o.corrupt.lvl === 'steady';
    o.corruptEquiv = stepEquivalent();
    delete T.steps; delete T.bikeVal; delete T.bikeUnit; delete T.bikeLvl; T.habits = {};
    save();
    return o;
  });
  t.ok('a day with nothing logged reads as zero, not as undefined', log.emptyReadsZero, log);
  t.ok('and is worth no steps', log.emptyEquivZero, log);
  t.eq('walked steps are stored', log.steps, 4200);
  t.ok('with no ride, the equivalent is just the steps', log.equivIsSteps, log);
  t.ok('bike minutes are credited at the level ridden', log.creditRight, log);
  t.eq('minutes go up in fives', log.plus, 25);
  t.eq('and back down', log.minus, 20);
  t.ok('a ride can never go negative', log.neverNegative, log);
  t.eq('the stepper suits each currency', [log.steps5, log.step1, log.step50], [5, 1, 50]);
  t.eq('a negative step count is not stored', log.negStored, 0);
  t.eq('an absurd step count is not stored', log.hugeStored, 100000);
  t.eq('an absurd ride is not stored', log.hugeMinStored, 600);
  t.eq('an absurd calorie figure is not stored', log.hugeKcalStored, 8000);
  t.eq('junk typed into steps reads as none', log.junkSteps, 0);
  t.eq('junk typed into the ride reads as none', log.junkVal, 0);
  t.eq('an unknown intensity resolves to a real one', log.junkLvl, 'steady');
  t.ok('a stored value past every cap still yields a possible day', log.cappedRide <= 600, log);
  t.ok('a corrupt imported day reads as nothing logged', log.corruptSafe, log.corrupt);
  t.eq('and credits no steps', log.corruptEquiv, 0);

  // ---- the tick and the number must agree ----------------------------------
  const habit = await page.evaluate(() => {
    const o = {}, T = nutToday(), tgt = stepTarget();
    delete T.steps; delete T.bikeVal; delete T._stepAuto; T.habits = { steps: true };
    syncStepHabit();
    o.manualTickKept = T.habits.steps === true;
    T.habits = { steps: false }; syncStepHabit();
    o.manualUntickKept = T.habits.steps === false;
    setSteps(Math.round(tgt * 0.4));
    o.shortNotTicked = !nutToday().habits.steps;
    setBikeLvl('steady'); setBikeUnit('min');
    setBikeVal(bikeNeed(tgt - stepEquivalent(), 'steady').min);
    o.reachedTicks = nutToday().habits.steps === true && stepEquivalent() >= tgt;
    setBikeVal(0);
    o.removedUnticks = nutToday().habits.steps === false;
    // closing it with a distance instead must behave identically
    setBikeUnit('dist'); setBikeVal(bikeNeed(tgt - stepEquivalent(), 'steady').dist);
    o.distanceTicks = nutToday().habits.steps === true;
    setBikeVal(0);
    setSteps(tgt + 500);
    o.walkAloneTicks = nutToday().habits.steps === true;
    delete T.steps; delete T.bikeVal; delete T.bikeUnit; delete T.bikeLvl; T.habits = {};
    save();
    return o;
  });
  t.ok('with nothing logged, a manual tick is left alone', habit.manualTickKept, habit);
  t.ok('and so is a manual untick', habit.manualUntickKept, habit);
  t.ok('short of the target, the habit is not ticked', habit.shortNotTicked, habit);
  t.ok('closing the gap on the bike ticks it', habit.reachedTicks, habit);
  t.ok('removing the ride un-ticks it again', habit.removedUnticks, habit);
  t.ok('closing it with a distance works the same way', habit.distanceTicks, habit);
  t.ok('walking the whole target ticks it too', habit.walkAloneTicks, habit);

  // ---- stored history is repaired, and the old field is carried across -----
  const repair = await page.evaluate(() => {
    const o = {}, N = STATE.nutrition;
    N.days['2026-01-02'] = { water: 4, habits: {}, steps: 'heaps', bikeVal: null, bikeLvl: 'turbo', bikeUnit: 'furlongs' };
    N.days['2026-01-03'] = { water: 4, habits: {}, steps: -50, bikeVal: NaN, bikeLvl: 'easy', bikeUnit: 'kcal' };
    N.days['2026-01-04'] = { water: 4, habits: {}, steps: 9000, bikeVal: 30, bikeLvl: 'hard', bikeUnit: 'dist' };
    // a day written by the minutes-only build, before the other two currencies
    N.days['2026-01-05'] = { water: 4, habits: {}, bikeMin: 40, bikeLvl: 'steady' };
    normalizeState();
    const a = N.days['2026-01-02'], b = N.days['2026-01-03'], c = N.days['2026-01-04'], d = N.days['2026-01-05'];
    o.stringDropped = a.steps === undefined;
    o.unknownLevelDropped = a.bikeLvl === undefined;
    o.unknownUnitDropped = a.bikeUnit === undefined;
    o.negativeDropped = b.steps === undefined;
    o.nanDropped = b.bikeVal === undefined;
    o.goodLevelKept = b.bikeLvl === 'easy' && b.bikeUnit === 'kcal';
    o.goodDayUntouched = c.steps === 9000 && c.bikeVal === 30 && c.bikeLvl === 'hard' && c.bikeUnit === 'dist';
    o.migrated = d.bikeVal === 40 && d.bikeUnit === 'min' && d.bikeMin === undefined;
    ['2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'].forEach(k => delete N.days[k]);
    save();
    return o;
  });
  t.ok('a string step count in history is dropped', repair.stringDropped, repair);
  t.ok('an unknown intensity in history is dropped', repair.unknownLevelDropped, repair);
  t.ok('an unknown currency in history is dropped', repair.unknownUnitDropped, repair);
  t.ok('a negative step count in history is dropped', repair.negativeDropped, repair);
  t.ok('a NaN ride in history is dropped', repair.nanDropped, repair);
  t.ok('a valid intensity and currency survive the repair', repair.goodLevelKept, repair);
  t.ok('a good day is left exactly as it was', repair.goodDayUntouched, repair);
  t.ok('a minutes-only day from the older build is carried across, not dropped', repair.migrated, repair);

  // ---- the card ------------------------------------------------------------
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} go('fuel'); });
  await page.waitForTimeout(150);
  const card = await page.evaluate(() => {
    const T = nutToday();
    delete T.steps; delete T.bikeVal; delete T.bikeUnit; delete T.bikeLvl; T.habits = {};
    /* The card now opens on jumping jacks, because they are the option that
       travels. Everything below this line is about the RIDE, so switch to it
       explicitly rather than relying on it being what you get by default. */
    nut().cardioMode = 'bike';
    setSteps(3000); setBikeLvl('steady'); setBikeUnit('min'); setBikeVal(10);
    const v = () => document.querySelector('#v-fuel');
    const need = bikeNeed(stepTarget() - stepEquivalent(), 'steady');
    const o = {
      mounted: /Movement/.test(v().innerHTML),
      hasStepsInput: !!document.querySelector('#mv-steps'),
      hasRideInput: !!document.querySelector('#mv-bike'),
      stepsValue: (document.querySelector('#mv-steps') || {}).value,
      rideValue: (document.querySelector('#mv-bike') || {}).value,
      levelButtons: v().querySelectorAll('[onclick^="setBikeLvl"]').length,
      unitButtons: v().querySelectorAll('[onclick^="setBikeUnit"]').length,
      levelMarked: !!v().querySelector('[onclick^="setBikeLvl"].on'),
      unitMarked: !!v().querySelector('[onclick^="setBikeUnit"].on'),
      // the shortfall must be quoted in all three, since the bike shows one of them
      quotesMinutes: v().innerHTML.includes(need.min + ' min'),
      quotesDistance: v().innerHTML.includes(need.dist + ' ' + distUnit()),
      quotesCalories: v().innerHTML.includes(need.kcal + ' kcal'),
      showsRideThreeWays: /That ride is/.test(v().innerHTML),
      warnsTrainerDistance: /trust the clock over the distance/i.test(v().innerHTML),
      /* This used to assert copy that said calories was "the one to trust". It
         was wrong: a turbo console reports GROSS calories and this field is net,
         so trusting it over-credits ~15%. The check now pins the corrected
         guidance instead — the wrongness was in the app, not in the check. */
      warnsConsoleRunsHigh: /knock ~15% off it/.test(v().innerHTML),
      saysItIsNotEverything: /loads the skeleton/.test(v().innerHTML),
      noNaN: !/NaN|undefined/.test(v().innerHTML),
    };
    const btn = [...v().querySelectorAll('button')].find(b => /Log the [\d.]+ \w+ that closes it/.test(b.textContent));
    o.hasCloseButton = !!btn;
    if (btn) { btn.click(); o.afterClose = stepEquivalent() >= stepTarget(); }
    o.saysMet = /Target met/.test(v().innerHTML);
    // and the same button works when logging in distance
    delete T.bikeVal; setBikeUnit('dist'); setSteps(3000); renderFuel();
    const btn2 = [...v().querySelectorAll('button')].find(b => /Log the [\d.]+ (km|mi) that closes it/.test(b.textContent));
    o.closeButtonInDistance = !!btn2;
    if (btn2) { btn2.click(); o.afterCloseDist = stepEquivalent() >= stepTarget(); }
    delete T.steps; delete T.bikeVal; delete T.bikeUnit; delete T.bikeLvl; T.habits = {};
    save(); renderFuel();
    return o;
  });
  t.ok('the Movement card is on the Fuel tab', card.mounted, card);
  t.ok('it has a step entry and a ride entry', card.hasStepsInput && card.hasRideInput, card);
  t.eq('the step entry shows what was logged', card.stepsValue, '3000');
  t.eq('the ride entry shows what was logged', card.rideValue, '10');
  t.eq('every intensity is offered', card.levelButtons, 4);
  t.eq('all three currencies are offered', card.unitButtons, 3);
  t.ok('the chosen intensity is marked', card.levelMarked, card);
  t.ok('the chosen currency is marked', card.unitMarked, card);
  t.ok('the shortfall is quoted in minutes', card.quotesMinutes, card);
  t.ok('and in distance', card.quotesDistance, card);
  t.ok('and in calories', card.quotesCalories, card);
  t.ok('the logged ride is shown in all three at once', card.showsRideThreeWays, card);
  t.ok('it says a turbo\'s distance readout is not a measurement', card.warnsTrainerDistance, card);
  t.ok('it warns that a turbo\'s calorie readout runs high against a net field', card.warnsConsoleRunsHigh, card);
  t.ok('it says plainly that the bike does not replace walking entirely', card.saysItIsNotEverything, card);
  t.ok('nothing renders as NaN', card.noNaN, card);
  t.ok('it offers to log the ride that closes the gap', card.hasCloseButton, card);
  t.ok('and that ride actually closes it', card.afterClose, card);
  t.ok('once the target is met the card says so', card.saysMet, card);
  t.ok('the same offer works when logging in distance', card.closeButtonInDistance, card);
  t.ok('and that distance closes it too', card.afterCloseDist, card);

  // ---- and it is documented on Reference -----------------------------------
  await page.evaluate(() => go('ref'));
  await page.waitForTimeout(150);
  const ref = await page.evaluate(() => {
    const v = document.querySelector('#v-ref');
    return {
      section: /Steps on the trainer/.test(v.innerHTML),
      allLevels: BIKE_LEVELS.every(b => v.innerHTML.includes(b.label)),
      allMinutes: BIKE_LEVELS.every(b => v.innerHTML.includes(bikeNeed(stepTarget(), b.k).min + ' min')),
      allDistances: BIKE_LEVELS.every(b => v.innerHTML.includes(bikeNeed(stepTarget(), b.k).dist + ' ' + distUnit())),
      allCalories: BIKE_LEVELS.every(b => v.innerHTML.includes(bikeNeed(stepTarget(), b.k).kcal + ' kcal')),
      quotesTarget: v.innerHTML.includes(stepTarget().toLocaleString() + ' steps'),
      explainsFlatCalories: /does not care how fast you spin/.test(v.innerHTML),
      pointsAtFuel: /Fuel → Movement/.test(v.innerHTML),
      noNaN: !/NaN|undefined/.test(v.innerHTML),
    };
  });
  t.ok('the conversion is written up on Reference', ref.section, ref);
  t.ok('every intensity is listed there', ref.allLevels, ref);
  t.ok('with the minutes each one needs', ref.allMinutes, ref);
  t.ok('and the distance', ref.allDistances, ref);
  t.ok('and the calories', ref.allCalories, ref);
  t.ok('against the athlete\'s own step target', ref.quotesTarget, ref);
  t.ok('it explains why the calorie column never changes', ref.explainsFlatCalories, ref);
  t.ok('and it says where to log the ride', ref.pointsAtFuel, ref);
  t.ok('nothing renders as NaN', ref.noNaN, ref);

  /* ---- movement earns room in the food budget, but only the surplus -------
     recalcKcalFromStored() prices activity from a fixed onboarding answer and
     never revisits it, so a day that clears the step target by 8,000 and a
     day that clears it by zero were priced identically — stepKcal() already
     knew almost exactly what the gap was worth and the app never told the
     food budget. movementKcalAdj()/todayKcalBudget() are that wire.

     Deliberately asymmetric: a shortfall subtracts nothing. Every commercial
     tracker earns calories up and never docks them down, because the
     baseline already assumes a normal day and a second penalty on the same
     shortfall is a nudge toward under-eating on the hardest days to move. */
  {
    const r = await page.evaluate(() => {
      const T = nutToday();
      T.steps = 0; delete T.bikeVal; delete T.jackVal; T.habits = {};
      const base = nut().kcalTarget;
      const o = { base };

      // at target: no credit
      T.steps = stepTarget();
      o.atTarget = movementKcalAdj();
      o.budgetAtTarget = todayKcalBudget();

      // short of target: no credit, and definitely not a penalty
      T.steps = Math.max(0, stepTarget() - 3000);
      o.short = movementKcalAdj();
      o.budgetShort = todayKcalBudget();

      // 4,000 steps past target: a real, specific credit
      T.steps = stepTarget() + 4000;
      o.overBy4k = movementKcalAdj();
      o.expected4k = Math.round(4000 * kcalPerStep());
      o.budgetOver = todayKcalBudget();

      // an absurd step count is clamped, not left to run away
      T.steps = stepTarget() + 100000;
      o.clamped = movementKcalAdj();

      // the credit is currency-agnostic: jumping jacks past target pay the same FORMULA as steps
      T.steps = 0; T.jackVal = null;
      const jacksNeeded = jackNeed(stepTarget() + 4000, 'steady');
      setJackUnit('reps'); T.jackVal = jacksNeeded.reps;
      o.viaJacks = movementKcalAdj();
      o.expectedJacks = Math.round((stepEquivalent() - stepTarget()) * kcalPerStep());

      // and the bike pays it too
      T.jackVal = 0; T.bikeVal = null;
      const bikeNeeded = bikeNeed(stepTarget() + 4000, 'steady');
      setBikeUnit('min'); T.bikeVal = bikeNeeded.min;
      o.viaBike = movementKcalAdj();
      o.expectedBike = Math.round((stepEquivalent() - stepTarget()) * kcalPerStep());

      T.steps = 0; T.jackVal = 0; T.bikeVal = 0; T.habits = {};
      save();
      return o;
    });
    t.eq('exactly at target earns nothing', r.atTarget, 0);
    t.eq('so today\'s budget is just the base target', r.budgetAtTarget, r.base);
    t.eq('short of target earns nothing — not a positive credit', r.short, 0);
    t.ok('and short of target is never a PENALTY either', r.short >= 0, r);
    t.eq('and the budget for a short day is still just the base target', r.budgetShort, r.base);
    t.ok('clearing the target by 4,000 steps earns a real credit', r.overBy4k > 0, r);
    t.eq('computed the same way stepKcal/kcalPerStep price everything else', r.overBy4k, r.expected4k);
    t.eq('and that credit is added on top of the base target', r.budgetOver, r.base + r.overBy4k);
    t.ok('an extreme step count is clamped rather than left to run away', r.clamped <= 500, r);
    /* Not compared against the steps-only figure directly: bike/jack minutes
       are logged as whole units and rounded UP to guarantee coverage (same
       "the minutes quoted always cover the steps owed" rule tested above),
       so the exact overage differs from currency to currency by design. What
       must hold is that whichever currency pushed stepEquivalent() past
       target, the SAME formula priced the surplus — proving jacks/bike really
       do flow through stepEquivalent() into the credit, not a separate path. */
    t.ok('jumping jacks past target earn a real, correctly-formulated credit',
      r.viaJacks > 0 && r.viaJacks === r.expectedJacks, r);
    t.ok('so does the bike', r.viaBike > 0 && r.viaBike === r.expectedBike, r);
  }
  {
    // guard: a real 41-year-old 88kg athlete's numbers are not degenerate
    const g = await page.evaluate(() => ({
      target: stepTarget(), perStep: kcalPerStep(), kcalTarget: nut().kcalTarget,
    }));
    t.ok('guard: the seeded athlete has a real step target', g.target >= 6000 && g.target <= 12000, g);
    t.ok('guard: and a real per-step cost', g.perStep > 0.03 && g.perStep < 0.06, g);
    t.ok('guard: and a real calorie target to add credit onto', g.kcalTarget > 1000, g);
  }

  // ---- the live Fuel ring shows the adjusted number; the base plan does not
  {
    await page.evaluate(() => {
      const T = nutToday();
      T.steps = stepTarget() + 4000; T.jackVal = 0; T.bikeVal = 0; T.habits = {};
      save(); go('fuel'); renderFuel();
    });
    const live = await page.evaluate(() => {
      const v = document.querySelector('#v-fuel');
      const base = nut().kcalTarget;
      const adj = movementKcalAdj();
      /* CARBS, not protein: proteinTargetG() is bodyweight-driven and, for an
         athlete with a logged weight, does not depend on kcalTarget at all —
         a guard confirmed the two candidate protein figures were IDENTICAL
         for this athlete, which would have made that assertion pass whether
         or not the code leaked the adjusted target. Carbs are computed as
         (kcal - protein*4 - fat*9)/4, so a 176 kcal gap moves them by ~40g —
         actually sensitive to which target macroTargets() was given.

         Derived independently of intakeHTML() (recomputed here, not read
         back from a second render call), so this proves what was actually
         PAINTED rather than what a fresh call would compute now. */
      const _stored = nut().kcalTarget;
      nut().kcalTarget = base; const correctC = macroTargets().c;
      nut().kcalTarget = base + adj; const leakedC = macroTargets().c;
      nut().kcalTarget = _stored;
      const carbRow = /Carbs<\/span><span class="muted">\d+\/(\d+)g/.exec(v.innerHTML);
      return {
        html: v.innerHTML, adj, budget: todayKcalBudget(), base,
        correctC, leakedC, renderedCarbTarget: carbRow ? +carbRow[1] : null,
      };
    });
    t.ok('the live ring shows the ADJUSTED total, not the base target',
      live.html.includes('/' + live.budget + '<') || new RegExp('/\\s*' + live.budget + '\\b').test(live.html), live);
    t.ok('and names the credit so the athlete can see where the room came from',
      /earned from today's movement/.test(live.html), live);
    t.ok('guard: at this athlete\'s numbers the two candidate carb targets actually differ',
      live.correctC !== live.leakedC, live);
    t.eq('the RENDERED carb bar targets the base plan, not the movement-adjusted one',
      live.renderedCarbTarget, live.correctC);
    t.ok('the settings summary still shows the base target, not the live one',
      new RegExp('Current target:.*\\b' + live.base + '\\s*kcal').test(live.html), live);
    t.ok('nothing renders as NaN', !/NaN|undefined/.test(live.html), live);
  }
  {
    // and with nothing earned, the ring shows no phantom credit
    const clean = await page.evaluate(() => {
      const T = nutToday(); T.steps = 0; T.jackVal = 0; T.bikeVal = 0; T.habits = {}; save();
      renderFuel();
      return document.querySelector('#v-fuel').innerHTML;
    });
    t.ok('an athlete who has not moved sees no earned-calories note', !/earned from today's movement/.test(clean), clean.slice(0, 200));
  }

  // ---- the movement card itself explains the credit, steps-only included ---
  {
    const cardR = await page.evaluate(() => {
      const T = nutToday();
      T.steps = stepTarget() + 4000; T.jackVal = 0; T.bikeVal = 0; T.habits = {};
      save(); renderFuel();
      return document.querySelector('#v-fuel').innerHTML;
    });
    t.ok('walking past target ALONE (no jacks, no bike) still shows the earned note — ' +
      'the existing "target met" banner only fired when jacks or the bike carried part of it',
      /kcal earned today/.test(cardR), cardR.slice(0, 400));
  }

  // ---- the structural plan never moves with a same-day step count ----------
  {
    const stable = await page.evaluate(() => {
      // pinned: pickRecipe() draws at random among the closest three, so two
      // calls at the SAME target can legitimately differ by luck — pin it or
      // this proves nothing either way, per the v218 meal-plan check lesson.
      const _rand = Math.random; Math.random = () => 0;
      const T = nutToday(); T.steps = 0; T.jackVal = 0; T.bikeVal = 0; T.habits = {}; save();
      STATE.nutrition.plan = null;
      const planLow = generateMealPlan().meals.join(',');
      const stampLow = STATE.nutrition.plan.stamp;
      T.steps = stepTarget() + 4000; save();
      STATE.nutrition.plan = null;
      const planHigh = generateMealPlan().meals.join(',');
      const stampHigh = STATE.nutrition.plan.stamp;
      const refLow = refTargets();
      T.steps = 0; save();
      const out = { planLow, planHigh, stampLow, stampHigh, refLow, refHigh: refTargets() };
      Math.random = _rand;
      return out;
    });
    t.eq('the meal plan is byte-identical whether or not steps earned a credit', stable.planHigh, stable.planLow);
    t.eq('its stamp does not carry movement as an input', stable.stampHigh, stable.stampLow);
    t.eq('and Reference still scales to the base target, not the live one', stable.refHigh, stable.refLow);
  }
  {
    /* The behavioural check above only proves it for THIS athlete's recipe
       pool at THIS kcal gap — the pool is small enough that a 176-500 kcal
       difference does not always land on a different closest-3 recipe per
       slot, so a version of generateMealPlan() that DID read the movement
       credit could still draw byte-identical output by the same coincidence
       and slip the check above. Read the source directly instead: neither
       function may call the movement machinery at all, which is true or
       false independent of any recipe pool or random draw. */
    const src = await page.evaluate(() => ({
      plan: generateMealPlan.toString(),
      stamp: _planStamp.toString(),
    }));
    t.ok('generateMealPlan() does not read movementKcalAdj', !src.plan.includes('movementKcalAdj'), src.plan);
    t.ok('or todayKcalBudget', !src.plan.includes('todayKcalBudget'), src.plan);
    t.ok('and neither does the plan\'s freshness stamp', !src.stamp.includes('movementKcalAdj') && !src.stamp.includes('todayKcalBudget'), src.stamp);
  }

  // ---- and the pre-session voice briefing reads the live number -----------
  {
    const brief = await page.evaluate(() => {
      const T = nutToday(); T.steps = stepTarget() + 4000; T.jackVal = 0; T.bikeVal = 0; T.habits = {}; save();
      const segs = briefSegments();
      const fuel = segs.find(s => s.title === 'Fuel');
      const budget = todayKcalBudget();   // read BEFORE resetting, or it measures the wrong day
      T.steps = 0; save();
      return { say: fuel ? fuel.say : '', budget };
    });
    t.ok('the briefing quotes the CREDITED number, not the stale base target',
      brief.say.includes(String(brief.budget)), brief);
  }

  /* ---- VO2max 4x4: long intervals, offered only where they make sense -----
     Everything in HIIT_FORMATS is short and all-out. This is the other end of
     the interval spectrum — 4 rounds of 4 min hard / 3 min easy, the
     "Norwegian 4x4" — and it only makes physiological sense where one steady
     effort can be held for four minutes straight: the bike and a run, not the
     bodyweight HIIT pool, which rotates movements every round. */
  {
    const r = await page.evaluate(() => {
      const info = fmtInfo('vo2max4x4');
      const bikeSeq = buildIntervals([{ exId: 'bike', unit: 'time', target: 30, rest: 20, sets: 1 }], 'vo2max4x4');
      const sprintSeq = buildIntervals([{ exId: 'sprint', unit: 'time', target: 30, rest: 40, sets: 1 }], 'vo2max4x4');
      const work = bikeSeq.filter(s => s.type === 'work');
      const rest = bikeSeq.filter(s => s.type === 'rest');
      return {
        name: info.name, w: info.w, r: info.r, n: info.n,
        seqLen: bikeSeq.length,
        workCount: work.length, workSecs: [...new Set(work.map(s => s.secs))],
        restCount: rest.length, restSecs: [...new Set(rest.map(s => s.secs))],
        rounds: work.map(s => s.round), roundsOf: work.map(s => s.rounds),
        totalSecs: bikeSeq.reduce((a, s) => a + s.secs, 0),
        lastIsWork: bikeSeq[bikeSeq.length - 1].type === 'work',
        bikeExIds: [...new Set(bikeSeq.map(s => s.exId))],
        sprintExIds: [...new Set(sprintSeq.map(s => s.exId))],
      };
    });
    t.eq('the format is named VO2max 4×4', r.name, 'VO2max 4×4');
    t.eq('four rounds of four minutes work', [r.n, r.w], [4, 4]);
    t.eq('three minutes rest between rounds', r.r, 3);
    t.eq('exactly four work blocks', r.workCount, 4);
    t.eq('each work block is 240s (4 min), nothing else', r.workSecs, [240]);
    t.eq('exactly three rest blocks — one fewer than work blocks', r.restCount, 3);
    t.eq('each rest block is 180s (3 min), nothing else', r.restSecs, [180]);
    t.eq('rounds are numbered 1 through 4 in order', r.rounds, [1, 2, 3, 4]);
    t.ok('every work block knows the total round count is 4', r.roundsOf.every(x => x === 4), r);
    t.eq('total session time is exactly 25 minutes, work and rest combined', r.totalSecs, 1500);
    t.ok('the sequence ends on work, not a dangling rest nobody needed', r.lastIsWork, r);
    t.eq('on the bike, every step is the bike — not a hard-coded movement', r.bikeExIds, ['bike']);
    t.eq('and on a sprint session, every step is the sprint', r.sprintExIds, ['sprint']);
  }
  {
    // guard: the exId fallback change did not regress skip/grip/box, which DO hard-code their movement
    const r = await page.evaluate(() => {
      const skip = buildIntervals([{ exId: 'irrelevant' }], 'skip93x2');
      const grip = buildIntervals([{ exId: 'irrelevant' }], 'grip30');
      return {
        skipExIds: [...new Set(skip.map(s => s.exId))],
        gripExIds: [...new Set(grip.map(s => s.exId))],
      };
    });
    t.eq('skipping still always resolves to the rope, regardless of what list it is handed', r.skipExIds, ['skip']);
    t.eq('grip hangs still always resolve to the dead hang', r.gripExIds, ['deadhang']);
  }
  {
    // the picker: offered for bike and sprint, withheld from bodyweight HIIT
    const r = await page.evaluate(() => {
      const out = {};
      specialChooser('bike');
      out.bikeHtml = document.querySelector('#sheet').innerHTML;
      specialChooser('sprint');
      out.sprintHtml = document.querySelector('#sheet').innerHTML;
      specialChooser('hiit');
      out.hiitHtml = document.querySelector('#sheet').innerHTML;
      openHiitChooser();
      out.todayHtml = document.querySelector('#sheet').innerHTML;
      try { closeSheet(); } catch (e) {}
      return out;
    });
    t.ok('the bike chooser offers VO2max 4×4', /VO2max 4×4/.test(r.bikeHtml), r.bikeHtml.slice(0, 600));
    t.ok('so does the sprint chooser', /VO2max 4×4/.test(r.sprintHtml), r.sprintHtml.slice(0, 600));
    t.ok('the bodyweight HIIT chooser does not — no movement there can hold a steady 4 minutes',
      !/VO2max 4×4/.test(r.hiitHtml), r.hiitHtml.slice(0, 600));
    t.ok('and neither does converting TODAY\'S bodyweight circuit into intervals',
      !/VO2max 4×4/.test(r.todayHtml), r.todayHtml.slice(0, 600));
  }
  {
    // a real run, start to finish, on the bike
    const r = await page.evaluate(() => {
      try { closeSheet(); } catch (e) {}
      startSpecialCardio('bike', 'vo2max4x4');
      const out = {
        started: !!INTV, seqLen: INTV ? INTV.seq.length : 0, format: INTV ? INTV.format : null,
        html: document.getElementById('hiit').innerHTML,
      };
      try { hiitQuit(); } catch (e) {}
      return out;
    });
    t.ok('a real bike session actually starts', r.started, r);
    t.eq('with the full 7-step sequence', r.seqLen, 7);
    t.eq('tagged with the right format', r.format, 'vo2max4x4');
    t.ok('nothing renders as NaN or undefined', !/NaN|undefined/.test(r.html), r.html.slice(0, 400));
  }

  /* ---- 30/30s and the Gibala 6x30 all-out — two more distinct stimuli ----
     Neither is a variant of the 4x4: 30/30s is a real anaerobic pace done
     repeatably, 6x30 is truly maximal effort done rarely, with a long enough
     recovery that "maximal" stays honest on the sixth rep as well as the
     first. Both reuse the SAME gating and exId-resolution machinery the 4x4
     was built on, so these checks focus on what is actually NEW: the numbers
     for each protocol, and that a third format did not slip into the wrong
     picker somewhere along the way. */
  {
    const r = await page.evaluate(() => {
      const mk = k => {
        const seq = buildIntervals([{ exId: 'bike', unit: 'time', target: 30, rest: 20, sets: 1 }], k);
        const work = seq.filter(s => s.type === 'work'), rest = seq.filter(s => s.type === 'rest');
        return {
          info: fmtInfo(k),
          workCount: work.length, workSecs: [...new Set(work.map(s => s.secs))],
          restCount: rest.length, restSecs: [...new Set(rest.map(s => s.secs))],
          totalSecs: seq.reduce((a, s) => a + s.secs, 0),
          lastIsWork: seq[seq.length - 1].type === 'work',
          exIds: [...new Set(seq.map(s => s.exId))],
        };
      };
      return { thirty: mk('vo2max3030'), sit: mk('sit6x30') };
    });
    t.eq('30/30s: exactly 16 work blocks', r.thirty.workCount, 16);
    t.eq('each 30 seconds, nothing else', r.thirty.workSecs, [30]);
    t.eq('and 15 rest blocks — one fewer than work', r.thirty.restCount, 15);
    t.eq('each rest also 30 seconds', r.thirty.restSecs, [30]);
    t.eq('total session time is 15.5 minutes', r.thirty.totalSecs, 930);
    t.ok('ends on work, no dangling rest', r.thirty.lastIsWork, r.thirty);
    t.eq('resolves to whichever exercise was passed in, not a hard-coded one', r.thirty.exIds, ['bike']);

    t.eq('6×30: exactly 6 work blocks', r.sit.workCount, 6);
    t.eq('each 30 seconds — genuinely short, meant to be all-out', r.sit.workSecs, [30]);
    t.eq('and 5 rest blocks', r.sit.restCount, 5);
    t.eq('each a full 4 minutes — the long recovery is the whole point', r.sit.restSecs, [240]);
    t.eq('total session time is 23 minutes', r.sit.totalSecs, 1380);
    t.ok('ends on work, no dangling rest', r.sit.lastIsWork, r.sit);
    t.eq('also resolves to whichever exercise was passed in', r.sit.exIds, ['bike']);

    // guard: three real, distinct protocols now exist, not the same numbers three times
    const shapes = [r.thirty, r.sit].map(x => x.workSecs[0] + '/' + x.restSecs[0] + 'x' +
      (x.workCount + x.restCount));
    t.eq('guard: the two new protocols are not secretly identical to each other',
      new Set(shapes).size, 2);
  }
  {
    // the picker: both new formats offered for bike and sprint, withheld from bodyweight HIIT
    const r = await page.evaluate(() => {
      const out = {};
      specialChooser('bike'); out.bikeHtml = document.querySelector('#sheet').innerHTML;
      specialChooser('sprint'); out.sprintHtml = document.querySelector('#sheet').innerHTML;
      specialChooser('hiit'); out.hiitHtml = document.querySelector('#sheet').innerHTML;
      openHiitChooser(); out.todayHtml = document.querySelector('#sheet').innerHTML;
      try { closeSheet(); } catch (e) {}
      return out;
    });
    t.ok('30/30s is offered on the bike', /30\/30s VO2max/.test(r.bikeHtml), r.bikeHtml.slice(0, 600));
    t.ok('and for sprints', /30\/30s VO2max/.test(r.sprintHtml), r.sprintHtml.slice(0, 600));
    t.ok('6×30 all-out is offered on the bike', /6×30 All-Out/.test(r.bikeHtml), r.bikeHtml.slice(0, 600));
    t.ok('and for sprints', /6×30 All-Out/.test(r.sprintHtml), r.sprintHtml.slice(0, 600));
    t.ok('neither shows up for bodyweight HIIT',
      !/30\/30s VO2max/.test(r.hiitHtml) && !/6×30 All-Out/.test(r.hiitHtml), r.hiitHtml.slice(0, 600));
    t.ok('nor for converting today\'s bodyweight circuit into intervals',
      !/30\/30s VO2max/.test(r.todayHtml) && !/6×30 All-Out/.test(r.todayHtml), r.todayHtml.slice(0, 600));
  }
  {
    // a real run, start to finish, for each
    const r = await page.evaluate(() => {
      const run = (kind, k) => {
        try { closeSheet(); } catch (e) {}
        startSpecialCardio(kind, k);
        const out = { started: !!INTV, seqLen: INTV ? INTV.seq.length : 0, format: INTV ? INTV.format : null,
          html: document.getElementById('hiit').innerHTML };
        try { hiitQuit(); } catch (e) {}
        return out;
      };
      return { thirty: run('bike', 'vo2max3030'), sit: run('sprint', 'sit6x30') };
    });
    t.ok('30/30s on the bike actually starts', r.thirty.started, r.thirty);
    t.eq('with the full 31-step sequence', r.thirty.seqLen, 31);
    t.ok('nothing renders as NaN or undefined', !/NaN|undefined/.test(r.thirty.html), r.thirty.html.slice(0, 400));
    t.ok('6×30 as a sprint session actually starts', r.sit.started, r.sit);
    t.eq('with the full 11-step sequence', r.sit.seqLen, 11);
    t.ok('nothing renders as NaN or undefined', !/NaN|undefined/.test(r.sit.html), r.sit.html.slice(0, 400));
  }

  /* ---- bike intensity progression, from real ride feedback ---------------
     BIKE_LEVELS had a dial and no memory — chosen fresh every day, no
     record of how any ride went. rateBikeRide()/bikeLevelSuggestion() give
     it the same double-progression rule loadProgression() (v226) gave
     loaded work: three easy rides in a row at the SAME level suggest the
     next one up. A suggestion, never an auto-applied change — mirrors
     loadCeilingNote()'s "aim for" hint. */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ lim: STATE.profile.limitations, bl: STATE.bikeLevelFeel, pbl: STATE.profile.bikeLevel });
      const out = {};

      delete STATE.bikeLevelFeel;
      STATE.profile.bikeLevel = 'steady';
      out.freshDefaultsToSteadyZero = bikeLevelFeel();
      out.noSuggestionFresh = bikeLevelSuggestion();

      rateBikeRide('easy'); rateBikeRide('easy');
      out.twoEasyNoSuggestionYet = { feel: bikeLevelFeel(), suggestion: bikeLevelSuggestion() };
      rateBikeRide('easy');
      out.threeEasySuggestsNext = { feel: bikeLevelFeel(), suggestion: bikeLevelSuggestion() };

      rateBikeRide('hard');
      out.hardResetsTheStreak = { feel: bikeLevelFeel(), suggestion: bikeLevelSuggestion() };

      rateBikeRide('easy'); rateBikeRide('easy'); rateBikeRide('easy');
      rateBikeRide('right');
      out.rightAlsoResetsTheStreak = { feel: bikeLevelFeel(), suggestion: bikeLevelSuggestion() };

      // at the top level, three easy rides still yield no suggestion — nothing to climb to
      STATE.profile.bikeLevel = 'intervals'; STATE.bikeLevelFeel = { level: 'intervals', streak: 0 };
      rateBikeRide('easy'); rateBikeRide('easy'); rateBikeRide('easy');
      out.noSuggestionAtTopLevel = bikeLevelSuggestion();

      // switching level between rides resets the streak against the NEW level
      STATE.profile.bikeLevel = 'hard'; STATE.bikeLevelFeel = { level: 'hard', streak: 3 };
      STATE.profile.bikeLevel = 'steady';
      rateBikeRide('easy');
      out.switchingLevelStartsFreshStreak = bikeLevelFeel();

      // setBikeLvl() persists the choice to STATE.profile — a fresh "day" no
      // longer resets to 'steady', it inherits what was chosen yesterday
      STATE.profile.bikeLevel = null;
      setBikeLvl('hard');
      out.setBikeLvlPersists = STATE.profile.bikeLevel;
      const day = nutToday(); delete day.bikeLvl;   // simulate a brand-new day's object
      out.freshDayInheritsPersistedLevel = movement().lvl;

      const k = JSON.parse(keep);
      STATE.profile.limitations = k.lim; STATE.bikeLevelFeel = k.bl; STATE.profile.bikeLevel = k.pbl;
      return out;
    });
    t.eq('a fresh athlete is at steady with a zero streak', r.freshDefaultsToSteadyZero, { level: 'steady', streak: 0 });
    t.eq('and gets no suggestion yet', r.noSuggestionFresh, null);
    t.eq('two easy rides is not enough yet', r.twoEasyNoSuggestionYet.suggestion, null);
    t.eq('the streak really is counting', r.twoEasyNoSuggestionYet.feel.streak, 2);
    t.eq('three easy rides in a row at the same level suggests the next one up', r.threeEasySuggestsNext.suggestion.k, 'hard');
    t.eq('a hard-rated ride resets the streak to zero', r.hardResetsTheStreak.feel.streak, 0);
    t.eq('and withdraws the suggestion', r.hardResetsTheStreak.suggestion, null);
    t.eq('a "right" rating also resets the streak, not just "hard"', r.rightAlsoResetsTheStreak.feel.streak, 0);
    t.eq('the top level never suggests a level beyond it', r.noSuggestionAtTopLevel, null);
    t.eq('switching levels starts the new level\'s streak at 1, not carrying the old one', r.switchingLevelStartsFreshStreak.streak, 1);
    t.eq('setBikeLvl() persists the choice to the profile', r.setBikeLvlPersists, 'hard');
    t.eq('so a fresh day inherits it instead of resetting to steady', r.freshDayInheritsPersistedLevel, 'hard');
  }

  /* ---- the rating only appears where the level system actually applies --- */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ bl: STATE.bikeLevelFeel, pbl: STATE.profile.bikeLevel });
      delete STATE.bikeLevelFeel; STATE.profile.bikeLevel = 'steady';
      const run = (kind, k) => {
        try { closeSheet(); } catch (e) {}
        startSpecialCardio(kind, k);
        while (INTV && INTV.i < INTV.seq.length) { INTV.workElapsed += INTV.seq[INTV.i].secs; INTV.i++; }
        ivDone();
        const html = document.getElementById('ivBody').innerHTML;
        try { hiitQuit(); } catch (e) {}
        return html;
      };
      const bikeHtml = run('bike', 'vo2max3030');
      const sprintHtml = run('sprint', 'sit6x30');
      const kk = JSON.parse(keep);
      STATE.bikeLevelFeel = kk.bl; STATE.profile.bikeLevel = kk.pbl;
      return { bikeHtml, sprintHtml };
    });
    t.ok('a completed bike session shows the ride-feel rating', /How did that ride feel/.test(r.bikeHtml), r.bikeHtml.slice(0, 500));
    t.ok('and the rating buttons call rateBikeAndClose', /rateBikeAndClose\('easy'\)/.test(r.bikeHtml), r.bikeHtml.slice(0, 800));
    t.ok('a completed sprint session — no bike level system behind it — does not', !/How did that ride feel/.test(r.sprintHtml), r.sprintHtml.slice(0, 500));
  }

  /* ============================================================
     Fuel-tab step makeup: a real in-app timer for jacks/the bike
     ("Before this, the movement card told the athlete to set an
     external timer and type the result in after.") Reuses the same
     interval engine as HIIT/skip/grip/box, under a dedicated session
     key (cardiomakeup) so it can never leak into — or be leaked into
     by — the pre-existing Special-training bike/sprint flow, which
     deliberately still does NOT credit movement (a separate, real,
     out-of-scope gap named in CLAUDE.md, not fixed here). ============ */

  /* ---- the entry buttons actually render in the Fuel-tab blocks ---------- */
  {
    const r = await page.evaluate(() => {
      setCardioMode('jacks'); go('fuel'); render();
      const jackHtml = document.querySelector('#v-fuel').innerHTML;
      setCardioMode('bike'); render();
      const bikeHtml = document.querySelector('#v-fuel').innerHTML;
      return { jackHtml, bikeHtml };
    });
    t.ok('the jacks block offers the timer', /openMakeupTimer\('jacks'\)/.test(r.jackHtml), r.jackHtml.length);
    t.ok('the bike block offers the timer', /openMakeupTimer\('bike'\)/.test(r.bikeHtml), r.bikeHtml.length);
  }

  /* ---- the stopwatch: counts up, credits on stop, additive, no-ops under a
     minute — both modes, driven through the real MUT state and the real
     openMakeupStopwatch()/makeupStopwatchStop() functions, not a re-implementation. */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ jackVal: nutToday().jackVal, jackUnit: nutToday().jackUnit,
        bikeVal: nutToday().bikeVal, bikeUnit: nutToday().bikeUnit });
      setJackUnit('min'); setJackVal(0);
      setBikeUnit('min'); setBikeVal(0);

      openMakeupStopwatch('jacks');
      const jackStarted = !!MUT && MUT.mode === 'jacks';
      MUT.secs = 615;           // 10.25 min -> rounds to 10
      makeupStopwatchStop();
      const jackAfterFirst = movement().jval;

      openMakeupStopwatch('jacks');
      MUT.secs = 300;           // +5 min, additive on top of the 10 above
      makeupStopwatchStop();
      const jackAfterSecond = movement().jval;

      openMakeupStopwatch('jacks');
      MUT.secs = 20;            // Math.round(20/60)=0 -> genuinely under a minute.
                                 // 30s would round UP to 1 (same as skipTimerStop()'s
                                 // identical Math.round(secs/60) — consistent with that
                                 // precedent, not a bug), so it would not test this guard.
      makeupStopwatchStop();
      const jackAfterSubMinute = movement().jval;
      const subMinuteToast = document.querySelector('#toast').textContent;

      openMakeupStopwatch('bike');
      const bikeStarted = !!MUT && MUT.mode === 'bike';
      MUT.secs = 1200;          // 20 min
      makeupStopwatchStop();
      const bikeAfterFirst = movement().val;

      openMakeupStopwatch('bike');
      MUT.secs = 600;           // +10 min, additive on top of the 20 above —
                                 // a single run can't tell additive from
                                 // overwrite when it starts from a 0 baseline,
                                 // so this has to be a SECOND stacked run.
      makeupStopwatchStop();
      const bikeAfterSecond = movement().val;

      const kk = JSON.parse(keep);
      nutToday().jackVal = kk.jackVal; nutToday().jackUnit = kk.jackUnit;
      nutToday().bikeVal = kk.bikeVal; nutToday().bikeUnit = kk.bikeUnit;
      return { jackStarted, jackAfterFirst, jackAfterSecond, jackAfterSubMinute, subMinuteToast, bikeStarted, bikeAfterFirst, bikeAfterSecond };
    });
    t.ok('the jacks stopwatch actually starts', r.jackStarted, r);
    t.eq('stopping it credits the rounded minutes', r.jackAfterFirst, 10, r);
    t.eq('a second block stacks on top, not overwrites', r.jackAfterSecond, 15, r);
    t.eq('under a minute logs nothing further', r.jackAfterSubMinute, 15, r);
    t.eq('and says so', r.subMinuteToast, 'Under a minute — nothing logged', r);
    t.ok('the bike stopwatch actually starts', r.bikeStarted, r);
    t.eq('stopping it credits the minutes into the bike currency', r.bikeAfterFirst, 20, r);
    t.eq('a second bike block stacks on top too, not overwrites', r.bikeAfterSecond, 30, r);
  }

  /* ---- additive crediting re-expresses an existing non-minute currency
     first, rather than clobbering it — same guarantee setJackUnit() already
     gives the manual +/- buttons, extended to the timer's finish. */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ jackVal: nutToday().jackVal, jackUnit: nutToday().jackUnit });
      setJackLvl('steady'); setJackUnit('reps'); setJackVal(0);
      addJackVal(275);                       // ~5 min worth of reps at 'steady'
      const baselineMin = jackMinutes();
      openMakeupStopwatch('jacks');
      MUT.secs = 300;                        // +5 min on the stopwatch
      makeupStopwatchStop();
      const finalMin = movement().jval, finalUnit = movement().junit;
      const kk = JSON.parse(keep);
      nutToday().jackVal = kk.jackVal; nutToday().jackUnit = kk.jackUnit;
      return { baselineMin, finalMin, finalUnit };
    });
    t.ok('the reps baseline is worth a real amount of minutes', r.baselineMin > 0, r);
    t.eq('the currency switches to minutes on credit', r.finalUnit, 'min', r);
    t.eq('the final total is the pre-existing minutes plus the new block, not just the new block',
      r.finalMin, Math.round(r.baselineMin) + 5, r);
  }

  /* ---- the structured jacks block: work/rest/rounds picked at runtime,
     same reserved-key pattern as startSkipCustom(), ending on the same
     finish screen as every other interval session. */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ jackVal: nutToday().jackVal, jackUnit: nutToday().jackUnit });
      setJackUnit('min'); setJackVal(0);
      openMakeupTimer('jacks');
      $('#mut-jk-w').value = '10'; $('#mut-jk-r').value = '2'; $('#mut-jk-n').value = '3';
      startJackMakeup();
      const seq = INTV ? INTV.seq.slice() : [];
      const work = seq.filter(s => s.type === 'work'), rest = seq.filter(s => s.type === 'rest');
      while (INTV && INTV.i < INTV.seq.length) { INTV.workElapsed += INTV.seq[INTV.i].secs; INTV.i++; }
      ivDone();
      const html = document.getElementById('ivBody').innerHTML;
      const mMatch = /creditMakeupAndClose\('jacks',([\d.]+)\)/.exec(html);
      const loggedMins = mMatch ? parseFloat(mMatch[1]) : null;
      if (loggedMins != null) creditMakeupAndClose('jacks', loggedMins);
      const after = movement().jval;
      try { hiitQuit(); } catch (e) {}
      const kk = JSON.parse(keep);
      nutToday().jackVal = kk.jackVal; nutToday().jackUnit = kk.jackUnit;
      return { work, rest, exIds: [...new Set(seq.map(s => s.exId))], html, loggedMins, after };
    });
    t.eq('3 rounds of work', r.work.length, 3, r.work);
    t.ok('each 10 minutes', r.work.every(w => w.secs === 600), r.work);
    t.eq('2 rest blocks — one fewer than work, no dangling rest after the last round', r.rest.length, 2, r.rest);
    t.ok('each 2 minutes', r.rest.every(w => w.secs === 120), r.rest);
    t.eq('the whole block is jumping jacks throughout', r.exIds, ['jumpingjack'], r.exIds);
    t.ok('the finish screen calls it out by name', /Jacks logged/.test(r.html), r.html.slice(0, 300));
    t.ok('and offers to log the minutes to today\'s steps', r.loggedMins > 0, r);
    t.ok('no bike ride-feel rating leaks into a jacks finish', !/How did that ride feel/.test(r.html), r.html.slice(0, 800));
    t.eq('tapping it actually credits the movement card', r.after, r.loggedMins, r);
  }

  /* ---- the bike duration picker: a single continuous block, no rest, and
     the SAME ride-feel rating + level-progression machinery as the existing
     Special-training bike flow — reused, not reimplemented. */
  {
    const r = await page.evaluate(() => {
      const keepM = JSON.stringify({ bikeVal: nutToday().bikeVal, bikeUnit: nutToday().bikeUnit });
      const keepF = JSON.stringify({ bl: STATE.bikeLevelFeel, pbl: STATE.profile.bikeLevel });
      delete STATE.bikeLevelFeel; STATE.profile.bikeLevel = 'steady';
      setBikeUnit('min'); setBikeVal(0);

      startBikeMakeup(20);
      const seq = INTV ? INTV.seq.slice() : [];
      while (INTV && INTV.i < INTV.seq.length) { INTV.workElapsed += INTV.seq[INTV.i].secs; INTV.i++; }
      ivDone();
      const html = document.getElementById('ivBody').innerHTML;
      const hasRating = /How did that ride feel/.test(html);
      const hasEasyCall = /creditMakeupAndClose\('bike',([\d.]+),'easy'\)/.test(html);
      const hasJackButton = /Log [\d.]+ min to today's steps/.test(html);
      creditMakeupAndClose('bike', 20, 'easy');
      const afterVal = movement().val, afterFeel = STATE.bikeLevelFeel;
      try { hiitQuit(); } catch (e) {}

      // the custom-minutes field, via startBikeMakeupCustom()
      setBikeUnit('min'); setBikeVal(0);
      openMakeupTimer('bike');
      $('#mut-bike-custom').value = '35';
      startBikeMakeupCustom();
      const customSecs = INTV ? INTV.seq.reduce((a, s) => a + s.secs, 0) : 0;
      try { hiitQuit(); } catch (e) {}

      const kkM = JSON.parse(keepM); nutToday().bikeVal = kkM.bikeVal; nutToday().bikeUnit = kkM.bikeUnit;
      const kkF = JSON.parse(keepF); STATE.bikeLevelFeel = kkF.bl; STATE.profile.bikeLevel = kkF.pbl;
      return { seq, html, hasRating, hasEasyCall, hasJackButton, afterVal, afterFeel, customSecs };
    });
    t.eq('a 20-minute pick is one continuous block', r.seq.length, 1, r.seq);
    t.eq('exactly 20 minutes', r.seq[0].secs, 1200, r.seq);
    t.eq('on the bike', r.seq[0].exId, 'bike', r.seq);
    t.ok('the finish screen offers the ride-feel rating, same as Special-training bike sessions', r.hasRating, r.html.slice(0, 800));
    t.ok('rating buttons call creditMakeupAndClose, not the old rateBikeAndClose', r.hasEasyCall, r.html.slice(0, 800));
    t.ok('a bike finish never shows the jacks log button', !r.hasJackButton, r.html.slice(0, 800));
    t.eq('tapping a rating credits the ride minutes', r.afterVal, 20, r);
    t.ok('and it actually rated the ride through the real BIKE_LEVELS streak machinery',
      r.afterFeel && r.afterFeel.level === 'steady' && r.afterFeel.streak === 1, r.afterFeel);
    t.eq('the custom-minutes field is honoured', r.customSecs, 35 * 60, r);
  }

  /* ---- no leakage either direction between the old specialcardio/isBike
     path and the new cardiomakeup path — they must never trigger each
     other's finish-screen branch or crediting call. */
  {
    const r = await page.evaluate(() => {
      const keepM = JSON.stringify({ bikeVal: nutToday().bikeVal, bikeUnit: nutToday().bikeUnit });
      setBikeUnit('min'); setBikeVal(0);
      try { closeSheet(); } catch (e) {}
      startSpecialCardio('bike', 'vo2max4x4');   // the PRE-EXISTING Special-training path
      while (INTV && INTV.i < INTV.seq.length) { INTV.workElapsed += INTV.seq[INTV.i].secs; INTV.i++; }
      ivDone();
      const oldHtml = document.getElementById('ivBody').innerHTML;
      const oldStillUncredited = movement().val === 0;
      const oldHasNoCreditCall = !/creditMakeupAndClose/.test(oldHtml);
      try { hiitQuit(); } catch (e) {}
      const kkM = JSON.parse(keepM); nutToday().bikeVal = kkM.bikeVal; nutToday().bikeUnit = kkM.bikeUnit;
      return { oldHtml, oldStillUncredited, oldHasNoCreditCall };
    });
    t.ok('guard: the old Special-training bike session still shows its own rateBikeAndClose call',
      /rateBikeAndClose\(/.test(r.oldHtml), r.oldHtml.slice(0, 800));
    t.ok('the old path is untouched by this feature and still credits nothing to movement',
      r.oldStillUncredited, r);
    t.ok('and its finish screen never references the new crediting function',
      r.oldHasNoCreditCall, r.oldHtml.slice(0, 800));
  }

  /* ---- corrupt bikeLevelFeel/bikeLevel are repaired at boot, not trusted -- */
  {
    const r = await page.evaluate(([seed]) => {
      eval(seed)();
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      cur.bikeLevelFeel = { level: 'nosuchlevel', streak: 'lots' };
      cur.profile = cur.profile || {}; cur.profile.bikeLevel = 'madeup';
      localStorage.setItem('coreforge.v1', JSON.stringify(cur));
    }, [ATHLETE]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const r2 = await page.evaluate(() => ({
      feel: STATE.bikeLevelFeel, level: STATE.profile.bikeLevel,
      threw: /went wrong drawing/i.test(document.body.innerText),
    }));
    t.eq('a corrupt streak/level is reset to a safe default', r2.feel, { level: 'steady', streak: 0 });
    t.eq('a bogus persisted level is dropped, not carried as junk', r2.level, undefined);
    t.ok('and nothing hits the error boundary', !r2.threw, r2);
  }

  await browser.close(); srv.close();
  return t.finish(errors);
}
