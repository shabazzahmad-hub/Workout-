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
    /* Assert the PROPERTY, not an exact serialisation. This compared
       JSON.stringify(movement()) against a hardcoded literal, so it broke the
       moment a third cardio mode added three fields — and it compared key
       ORDER too. What it means to check is that nothing reads as undefined and
       every counter starts at a real zero, whatever fields exist. */
    {
      const mv = movement();
      const nums = ['steps', 'val', 'jval', 'rval'];
      const strs = ['unit', 'lvl', 'junit', 'jlvl', 'runit', 'rlvl'];
      o.emptyReadsZero =
        nums.every(k => mv[k] === 0) &&
        strs.every(k => typeof mv[k] === 'string' && mv[k].length > 0) &&
        Object.values(mv).every(v => v !== undefined && v !== null &&
          !(typeof v === 'number' && !isFinite(v)));
      o.emptyShape = mv;
    }
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
    /* The Movement card moved to Today ▸ Workout in v311 — it is work you DO.
       Scoped to the view that holds it, not the tab it was written for. */
    setTodayTab('workout'); renderToday();
    const v = () => document.querySelector('#v-today');
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
      /* This pinned "Fuel → Movement" — the destination Movement was on when
         the check was written. v311 moved the block to Today and left the two
         sentences behind, so the check was holding a pointer that had become
         false. It now asserts BOTH halves: it names where Movement actually
         is, and it no longer names where it is not. */
      pointsAtMovement: /Today ▸ Workout ▸ Movement/.test(v.innerHTML),
      noStalePointer: !/Fuel → Movement/.test(v.innerHTML),
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
  t.ok('and it says where to log the ride', ref.pointsAtMovement, ref);
  t.ok('and does not send the athlete to the tab it used to be on', ref.noStalePointer, ref);
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
      /* This block is about the FOOD card's live ring and carb bar, which are
         Fuel's own — only the Movement controls moved. */
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
      setTodayTab('workout'); renderToday(); renderFuel();
      return document.querySelector('#v-today').innerHTML;
    });
    t.ok('an athlete who has not moved sees no earned-calories note', !/earned from today's movement/.test(clean), clean.slice(0, 200));
  }

  // ---- the movement card itself explains the credit, steps-only included ---
  {
    const cardR = await page.evaluate(() => {
      const T = nutToday();
      T.steps = stepTarget() + 4000; T.jackVal = 0; T.bikeVal = 0; T.habits = {};
      save(); setTodayTab('workout'); renderToday(); renderFuel();
      return document.querySelector('#v-today').innerHTML;
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

  /* ---- progressive overload for skip/grip/box, and a record for the
     formats with no order at all -------------------------------------------
     Skip/grip/box already logged every session but never asked how it felt
     or suggested going harder, the way BIKE_LEVELS/bikeLevelSuggestion()
     already did for the bike. PROGRESSION_GROUPS generalises the same
     double-progression rule across the three groups that have a real
     volume order. HIIT_FORMATS/ENDURANCE_FORMATS (tabata/emom/amrap,
     vo2max*, sit6x30) are each documented as distinct stimuli with no
     natural harder/easier order — bonus HIIT and sprint sessions had NO
     completion record of any kind before this, so they get a plain
     time-at-format mirror instead of a suggestion. */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ ff: STATE.formatFeel, hl: STATE.hiitLog });
      const out = {};

      delete STATE.formatFeel; STATE.hiitLog = [];

      // box's real order is box3x3 < box6x2 < box5x3 by total work volume —
      // NOT object key order (box3x3, box5x3, box6x2) and not alphabetical.
      // Walking this ladder is the discriminating case: it only passes if
      // the order is really read from PROGRESSION_GROUPS.
      out.volumeOrder = ['skip', 'grip', 'box'].map(g => {
        const list = PROGRESSION_GROUPS[g].formats;
        const vol = k => { const f = SKIP_FORMATS[k] || SPECIAL_FORMATS[k]; return f.w * f.n; };
        return list.every((k, i) => !i || vol(k) > vol(list[i - 1]));
      });

      out.freshDefaultsToFirstRungZero = formatFeel('box');
      out.noSuggestionFresh = formatSuggestion('box', 'box3x3');

      rateFormat('box', 'box3x3', 'easy'); rateFormat('box', 'box3x3', 'easy');
      out.twoEasyNoSuggestionYet = { feel: formatFeel('box'), sugg: formatSuggestion('box', 'box3x3') };
      rateFormat('box', 'box3x3', 'easy');
      out.threeEasySuggestsNext = { feel: formatFeel('box'), sugg: formatSuggestion('box', 'box3x3') };

      rateFormat('box', 'box3x3', 'hard');
      out.hardResetsStreak = { feel: formatFeel('box'), sugg: formatSuggestion('box', 'box3x3') };

      // at the top rung, three easy still yields nothing to climb to
      STATE.formatFeel.box = { level: 'box5x3', streak: 0 };
      rateFormat('box', 'box5x3', 'easy'); rateFormat('box', 'box5x3', 'easy'); rateFormat('box', 'box5x3', 'easy');
      out.noSuggestionAtCeiling = formatSuggestion('box', 'box5x3');

      // Every walk above used group='box' throughout. A getter that quietly
      // ignores its own argument (always reads/writes one hardcoded group)
      // would pass every one of those checks by coincidence and only show
      // up on a SECOND, different group — so walk skip's own ladder too.
      STATE.formatFeel = {};
      rateFormat('skip', 'skip93x2', 'easy'); rateFormat('skip', 'skip93x2', 'easy'); rateFormat('skip', 'skip93x2', 'easy');
      out.skipAlsoProgressesOnItsOwn = { feel: formatFeel('skip'), sugg: formatSuggestion('skip', 'skip93x2') };

      // rating one group must not touch another's streak — a shared object
      // reference, or a write keyed to the wrong group, would leak box's
      // rating into grip. Read the RAW stored value, not through
      // formatFeel('grip') — that getter validates a format against grip's
      // own list and silently falls back, which would paper over a wrong
      // write just as easily as a correct one.
      STATE.formatFeel = {};
      rateFormat('box', 'box3x3', 'easy'); rateFormat('box', 'box3x3', 'easy'); rateFormat('box', 'box3x3', 'easy');
      out.gripRawUntouchedByBoxRatings = STATE.formatFeel.grip;
      out.boxRawGotTheRatings = STATE.formatFeel.box;

      // the completion record for formats with no order: first vs repeat
      STATE.hiitLog = [];
      out.freshFormatStats = hiitFormatStats('tabata');
      logHiitCompletion('hiit', 'tabata', 4);
      out.afterFirstTabata = hiitFormatStats('tabata');
      logHiitCompletion('hiit', 'tabata', 4);
      logHiitCompletion('endurance', 'sit6x30', 23);
      out.afterSecondTabataAndOneSprint = { tabata: hiitFormatStats('tabata'), sit6x30: hiitFormatStats('sit6x30') };

      const k = JSON.parse(keep);
      STATE.formatFeel = k.ff; STATE.hiitLog = k.hl;
      return out;
    });
    t.ok('box\'s real order is by work volume for every group, not object-key order', r.volumeOrder.every(Boolean), r.volumeOrder);
    t.eq('a fresh group starts at its own first rung with a zero streak', r.freshDefaultsToFirstRungZero, { level: 'box3x3', streak: 0 });
    t.eq('and gets no suggestion yet', r.noSuggestionFresh, null);
    t.eq('two easy sessions is not enough yet', r.twoEasyNoSuggestionYet.sugg, null);
    t.eq('the streak really is counting', r.twoEasyNoSuggestionYet.feel.streak, 2);
    t.eq('three easy in a row suggests the next rung up by volume, not by key order', r.threeEasySuggestsNext.sugg, 'box6x2');
    t.eq('a hard-rated session resets the streak to zero', r.hardResetsStreak.feel.streak, 0);
    t.eq('and withdraws the suggestion', r.hardResetsStreak.sugg, null);
    t.eq('the top rung never suggests a format beyond it', r.noSuggestionAtCeiling, null);
    t.eq('a second, different group progresses on its own too — not just box', r.skipAlsoProgressesOnItsOwn.sugg, 'skip52x4');
    t.eq('with its own real streak, not a default masking a hardcoded group', r.skipAlsoProgressesOnItsOwn.feel.streak, 3);
    t.eq('rating box leaves no trace at all in grip\'s raw stored entry', r.gripRawUntouchedByBoxRatings, undefined);
    t.eq('and box itself really did receive all three ratings', r.boxRawGotTheRatings, { level: 'box3x3', streak: 3 });
    t.eq('a format with no log yet reads as zero, not undefined', r.freshFormatStats, { n: 0, total: 0 });
    t.eq('the first completion of a format counts once', r.afterFirstTabata, { n: 1, total: 4 });
    t.eq('a second tabata adds to tabata, not to sit6x30', r.afterSecondTabataAndOneSprint.tabata, { n: 2, total: 8 });
    t.eq('and sit6x30 only counts its own completion', r.afterSecondTabataAndOneSprint.sit6x30, { n: 1, total: 23 });
  }

  /* ---- the same progression prompt, wired into a real completed session -- */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ ff: STATE.formatFeel, hl: STATE.hiitLog });
      delete STATE.formatFeel; STATE.hiitLog = [];
      const run = (start) => {
        try { closeSheet(); } catch (e) {}
        start();
        while (INTV && INTV.i < INTV.seq.length) { INTV.workElapsed += INTV.seq[INTV.i].secs; INTV.i++; }
        ivDone();
        const html = document.getElementById('ivBody').innerHTML;
        try { hiitQuit(); } catch (e) {}
        return html;
      };
      const boxHtml = run(() => startSpecialFormat('box3x3'));
      const skipHtml = run(() => startSkipping('skip93x2'));
      const bonusHiitHtml = run(() => startHiitSpecial('tabata'));
      const k = JSON.parse(keep);
      STATE.formatFeel = k.ff; STATE.hiitLog = k.hl;
      return { boxHtml, skipHtml, bonusHiitHtml };
    });
    t.ok('a completed box session offers the generic feel rating', /How did that feel\?/.test(r.boxHtml), r.boxHtml.slice(0, 600));
    t.ok('wired to rateActAndClose, not the plain log button', /rateActAndClose\('box','easy'/.test(r.boxHtml), r.boxHtml.slice(0, 800));
    t.ok('a completed skip session offers the same rating', /How did that feel\?/.test(r.skipHtml), r.skipHtml.slice(0, 600));
    t.ok('wired to rateSkipAndClose', /rateSkipAndClose\('easy'/.test(r.skipHtml), r.skipHtml.slice(0, 800));
    t.ok('bonus HIIT — no order behind it — gets no feel rating', !/How did that feel\?/.test(r.bonusHiitHtml), r.bonusHiitHtml.slice(0, 600));
    t.ok('and instead offers the plain completion-record button', /logHiitAndClose\('hiit','tabata'/.test(r.bonusHiitHtml), r.bonusHiitHtml.slice(0, 800));
  }

  /* ---- tapping the button actually persists, not just renders correctly --
     Matching what actually rendered is not the same as proving a tap does
     anything — CLAUDE.md's own "wiring gap" trap: a guard proven correct in
     isolation and then shipped never being called. Drive the real wrapper
     functions the onclick handlers above call, and read STATE back. */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ ff: STATE.formatFeel, hl: STATE.hiitLog, bx: STATE.boxLog, sk: STATE.skipLog });
      STATE.formatFeel = {}; STATE.hiitLog = []; STATE.boxLog = []; STATE.skipLog = [];

      startSpecialFormat('box3x3');
      while (INTV && INTV.i < INTV.seq.length) { INTV.workElapsed += INTV.seq[INTV.i].secs; INTV.i++; }
      ivDone();
      rateActAndClose('box', 'easy', 5, 3, 180);
      const afterBoxTap = { feel: STATE.formatFeel.box, logRows: STATE.boxLog.length, intvCleared: INTV === null };

      startSkipping('skip93x2');
      while (INTV && INTV.i < INTV.seq.length) { INTV.workElapsed += INTV.seq[INTV.i].secs; INTV.i++; }
      ivDone();
      rateSkipAndClose('easy', 18, 2);
      const afterSkipTap = { feel: STATE.formatFeel.skip, logRows: STATE.skipLog.length };

      startHiitSpecial('tabata');
      while (INTV && INTV.i < INTV.seq.length) { INTV.workElapsed += INTV.seq[INTV.i].secs; INTV.i++; }
      ivDone();
      logHiitAndClose('hiit', 'tabata', 4);
      const afterHiitTap = hiitFormatStats('tabata');

      const k = JSON.parse(keep);
      STATE.formatFeel = k.ff; STATE.hiitLog = k.hl; STATE.boxLog = k.bx; STATE.skipLog = k.sk;
      return { afterBoxTap, afterSkipTap, afterHiitTap };
    });
    t.eq('tapping Easy on a box finish rates the format for real', r.afterBoxTap.feel, { level: 'box3x3', streak: 1 });
    t.eq('and actually writes a row to boxLog, not just the streak', r.afterBoxTap.logRows, 1);
    t.ok('and the interval session is torn down afterward', r.afterBoxTap.intvCleared, r.afterBoxTap);
    t.eq('tapping Easy on a skip finish rates skip independently', r.afterSkipTap.feel, { level: 'skip93x2', streak: 1 });
    t.eq('and writes a row to skipLog', r.afterSkipTap.logRows, 1);
    t.eq('tapping the record button on bonus HIIT writes a real completion', r.afterHiitTap, { n: 1, total: 4 });
  }

  /* ---- normalizeState() repairs both new fields, per-group and per-row --- */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ ff: STATE.formatFeel, hl: STATE.hiitLog });
      // one valid group, one corrupt-shape group, one group naming a format
      // that no longer exists — the repair must fix only the bad ones
      STATE.formatFeel = {
        skip: { level: 'skip93x2', streak: 2 },
        grip: 'not an object',
        box: { level: 'box9x9', streak: 5 },
      };
      STATE.hiitLog = [
        { date: '2026-01-01', format: 'tabata', group: 'hiit', mins: 4, at: 1 },
        { date: '2026-01-02', format: 'emom', group: 'hiit', mins: 'lots', at: 2 },
        null,
      ];
      normalizeState();
      const out = {
        skipSurvived: STATE.formatFeel.skip,
        gripRepaired: STATE.formatFeel.grip,
        boxRepaired: STATE.formatFeel.box,
        logKept: STATE.hiitLog.length,
        goodRowSurvived: STATE.hiitLog.some(x => x.format === 'tabata' && x.mins === 4),
      };
      const k = JSON.parse(keep);
      STATE.formatFeel = k.ff; STATE.hiitLog = k.hl;
      return out;
    });
    t.eq('a genuinely valid group survives the repair untouched', r.skipSurvived, { level: 'skip93x2', streak: 2 });
    t.eq('a wrong-shape group is reset to its own first rung', r.gripRepaired, { level: 'grip30', streak: 0 });
    t.eq('a format that no longer exists is reset the same way', r.boxRepaired, { level: 'box3x3', streak: 0 });
    t.eq('only the malformed hiitLog rows are dropped', r.logKept, 1);
    t.ok('a well-formed row survives byte for byte', r.goodRowSurvived, r);
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
      setTodayTab('workout');
      setCardioMode('jacks'); go('today'); render();
      const jackHtml = document.querySelector('#v-today').innerHTML;
      setCardioMode('bike'); render();
      const bikeHtml = document.querySelector('#v-today').innerHTML;
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

  /* ---- One cadence for every movement was the whole problem -------------
     "It is clocked at the same pace for all exercises and many exercises
      require more than the same pace of doing... those movements are compound
      movements and therefore take more time."

     Measured before the fix: of 124 rep-based movements, 121 paced at exactly
     3.0 s and the other three at 2.0 s. A Turkish get-up and a crunch were the
     same rep. */
  {
    const cad = await page.evaluate(() => {
      const o = {};
      const secs = {};
      for (const k in EX) { if (EX[k].unit !== 'reps') continue; secs[k] = repSecondsFor(k, 3); }
      o.distinct = [...new Set(Object.values(secs))].sort((a, b) => a - b);
      o.n = Object.keys(secs).length;
      /* A sequence is not a slow rep. Each of these is several positions. */
      o.getup = secs.kbtgu; o.manmaker = secs.dbmanmaker; o.wallwalk = secs.wallwalk;
      o.pistol = secs.pistol; o.crunch = secs.crunch; o.plainSquat = secs.squat;
      /* THE FLOOR, and it is what a blanket bump would fail: an ordinary
         controlled rep is unchanged. A version that simply slowed everything
         down would satisfy every "compound is slower" assertion here. */
      o.ordinary = ['crunch', 'squat', 'pushup', 'situp', 'vup', 'glutebridge']
        .map(k => secs[k]);
      /* The dial reaches the player again — PLAYER.tempo was never assigned,
         so repSecondsFor() saw undefined and fell back to 3 for everybody. */
      o.dialMoves = { fast: repSecondsFor('pushup', 1.5), slow: repSecondsFor('pushup', 6) };
      /* …but it cannot undercut a declared floor. */
      o.floorHolds = { fast: repSecondsFor('kbtgu', 1.5), slow: repSecondsFor('kbtgu', 6) };
      /* And the player actually READS the setting rather than the dead field. */
      const src = plEnterWork.toString();
      o.readsSetting = /repSecondsFor\(m\.exId,\s*repTempoSetting\(\)\)/.test(src);
      o.deadFieldGone = !/PLAYER\.tempo/.test(src);
      /* A declared movement counts at its MIDPOINT, not at a 3:1 tempo split —
         a 22 s get-up called at second 16 then stands in silence. */
      o.share = { declared: repEccShare('kbtgu'), plain: repEccShare('crunch') };
      /* Every declared value must be a real positive number, or the floor
         silently does nothing. */
      o.bad = Object.keys(EX).filter(k => {
        const v = EX[k].repSec;
        return v !== undefined && !(typeof v === 'number' && isFinite(v) && v > 0);
      });
      /* A floor below the default is not a floor — it would be dead data. */
      o.pointless = Object.keys(EX).filter(k => typeof EX[k].repSec === 'number' && EX[k].repSec <= 3);
      return o;
    });
    t.ok('the cadence is no longer one number for everything',
      cad.distinct.length >= 5, cad.distinct);
    t.ok('a Turkish get-up takes far longer than a crunch',
      cad.getup >= 15 && cad.getup > cad.crunch * 4, cad);
    t.ok('a man-maker and a wall walk are sequences, not reps',
      cad.manmaker >= 6 && cad.wallwalk >= 6, cad);
    t.ok('a pistol squat is slower than a plain squat',
      cad.pistol > cad.plainSquat, cad);
    t.eq('an ordinary controlled rep is unchanged at 3 s',
      cad.ordinary.join(','), '3,3,3,3,3,3', cad);
    t.ok('the athlete\'s cadence dial reaches the player again',
      cad.dialMoves.fast === 1.5 && cad.dialMoves.slow === 6, cad.dialMoves);
    t.ok('and the player reads the SETTING, not the field that was never assigned',
      cad.readsSetting && cad.deadFieldGone, cad);
    t.ok('but the dial cannot rush a declared sequence',
      cad.floorHolds.fast === cad.floorHolds.slow && cad.floorHolds.fast >= 15, cad.floorHolds);
    t.eq('a declared movement is counted at its midpoint', cad.share.declared, 0.5, cad.share);
    t.eq('an ordinary rep keeps its tempo split', cad.share.plain, null, cad.share);
    t.eq('every declared cadence is a real positive number', cad.bad.join(','), '', cad);
    t.eq('and none of them sits at or below the default', cad.pointless.join(','), '', cad);
  }

  /* ---- A repair that names a legal value by hand drifts when the set grows -
     Found by a backup round-trip audit, not by any suite: set the cardio mode
     to Ruck, close the app, reopen — and it is Jumping jacks again.

       if(STATE.nutrition.cardioMode!=='bike' && ...!=null)
         STATE.nutrition.cardioMode='jacks';

     That was written when jacks and the bike were the only two modes. v294
     added rucking to CARDIO_MODES and never came back here, so 'ruck' failed
     the hand-written test and was rewritten on EVERY boot. It never survived a
     backup either, because the repair runs on the way in.

     Driven through the BOOT PATH, because planting a value into STATE proves
     nothing about a repair that only runs in normalizeState(). */
  {
    const modes = await page.evaluate(() => {
      const o = { survived: [], lost: [] };
      const keep = STATE.nutrition.cardioMode;
      CARDIO_MODES.forEach(m => {
        setCardioMode(m);
        normalizeState();
        (STATE.nutrition.cardioMode === m ? o.survived : o.lost).push(m);
      });
      /* THE FLOOR: an unrecognised value must still be repaired, and jacks is
         the safe landing place — a fix that simply deleted the repair passes
         every line above. */
      STATE.nutrition.cardioMode = 'helicopter';
      normalizeState();
      o.junkRepaired = STATE.nutrition.cardioMode;
      STATE.nutrition.cardioMode = null;
      normalizeState();
      o.nullLeftAlone = STATE.nutrition.cardioMode === null;
      STATE.nutrition.cardioMode = keep;
      o.all = CARDIO_MODES.slice();
      return o;
    });
    t.eq('every legal cardio mode survives a boot', modes.lost.join(','), '', modes);
    /* This asserted a hardcoded 3 — the very "a hand-written value goes stale
       when the set grows" defect the block was written to catch, in the check
       itself. v323 added a fourth mode and it failed on correct code. Compare
       against the list, which cannot drift, with a FLOOR under it so the check
       cannot pass on an empty one. */
    t.eq('and all of them are checked', modes.survived, modes.all, modes);
    t.ok('guard: there is a real set of modes to check', modes.all.length >= 4, modes);
    t.eq('an unrecognised mode still falls back to jacks', modes.junkRepaired, 'jacks', modes);
    t.ok('an absent mode is left absent', modes.nullLeftAlone, modes);

    /* And the same thing across a real reload, which is how it was found. */
    await page.evaluate(() => { setCardioMode('ruck'); save(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const afterReload = await page.evaluate(() => nut().cardioMode);
    t.eq('Ruck is still Ruck after closing and reopening the app', afterReload, 'ruck');
    await page.evaluate(() => { setCardioMode('jacks'); save(); });
  }

  /* ---- running, the fourth way to pay the target (v323) --------------------
     Modelled like the BIKE and not like the ruck, and for the mirror reason:
     under a pack the intensity is the load relative to the athlete so its MET
     must be computed, while on a run the intensity is PACE, which is a dial. */
  {
    const r = await page.evaluate(() => {
      const keep = { w: STATE.nutrition.weightKg, mode: nut().cardioMode,
                     pace: STATE.profile.runPace };
      STATE.nutrition.weightKg = 86;
      setCardioMode('run');
      const o = {};
      o.isAMode = CARDIO_MODES.indexOf('run') >= 0;

      /* THE SAME RUN IN THREE CURRENCIES. Switching the unit re-expresses one
         run rather than logging a second one — the trap setBikeUnit was
         written to avoid. */
      setRunPace('steady'); setRunUnit('min'); setRunVal(30);
      const byMin = runWork();
      setRunUnit('dist'); const byDist = runWork();
      setRunUnit('kcal'); const byKcal = runWork();
      setRunUnit('min');
      o.threeWays = { byMin, byDist, byKcal };

      /* SANITY AGAINST THE WORLD, which is what stops the arithmetic drifting.
         Running costs about 1 kcal per kg per km, so an 86 kg athlete covering
         4.85 km should land near 400 kcal net. */
      o.steady30 = { km: +byMin.km.toFixed(2), kcal: byMin.kcal };

      /* AND THE PROPERTY THAT MAKES DISTANCE THE RIGHT INPUT: running costs
         about the same per km however fast you go, so the same 5 km prices
         within a few percent at every pace. A fixed MET table that did not
         respect that would fan out badly here. */
      const same5k = RUN_PACES.map(p => { setRunPace(p.k); setRunUnit('dist'); setRunVal(5);
        return { pace: p.k, kcal: runWork().kcal, min: runWork().min }; });
      const kc = same5k.map(x => x.kcal);
      o.same5k = same5k;
      o.spreadPct = Math.round((Math.max.apply(null, kc) - Math.min.apply(null, kc)) / Math.min.apply(null, kc) * 100);
      /* The floor under it: the MINUTES must still differ, or the table has no
         pace in it at all and the spread is trivially zero. */
      o.minutesDiffer = same5k[0].min > same5k[3].min;

      // it adds to the day like every other mode
      setRunPace('steady'); setRunUnit('min'); setRunVal(30);
      o.runSteps = runWork().steps;
      o.stepEquivalentIncludesRun = stepEquivalent() >= runWork().steps;

      // junk fails safe, and the stored pace is a MEMBERSHIP test
      STATE.profile.runPace = 'Steady';
      normalizeState();
      o.capitalPaceDropped = STATE.profile.runPace === undefined;
      const t2 = nutToday();
      const kv = t2.runVal, kl = t2.runLvl;
      t2.runVal = 'abc'; t2.runLvl = 'helicopter';
      o.junkReadsAsNothing = runWork().min === 0;
      o.junkPaceFallsBack = movement().nlvl === 'steady';
      t2.runVal = kv; t2.runLvl = kl;

      STATE.nutrition.weightKg = keep.w;
      STATE.profile.runPace = keep.pace;
      setCardioMode(keep.mode || 'jacks');
      return o;
    });

    t.ok('running is a cardio mode', r.isAMode, r);
    t.eq('logging by distance describes the same run as logging by minutes',
      r.threeWays.byDist, r.threeWays.byMin, r.threeWays);
    t.eq('and so does logging by calories', r.threeWays.byKcal.min, r.threeWays.byMin.min, r.threeWays);
    /* Against the world, not against itself. */
    t.ok('30 min steady covers about 4.9 km',
      r.steady30.km > 4.6 && r.steady30.km < 5.1, r.steady30);
    t.ok('and prices near 1 kcal per kg per km — ~400 for an 86 kg athlete',
      r.steady30.kcal > 360 && r.steady30.kcal < 440, r.steady30);
    /* THE PROPERTY, and the floor that stops it passing on a table with no
       pace variation in it. */
    t.ok('guard: the paces really are different speeds', r.minutesDiffer, r.same5k);
    t.ok('the same 5 km costs within 15% at every pace — running is priced per km, not per minute',
      r.spreadPct <= 15, { spreadPct: r.spreadPct, same5k: r.same5k });
    t.ok('a run counts toward the day like every other mode', r.stepEquivalentIncludesRun, r);
    t.ok('and is worth real steps', r.runSteps > 0, r);
    /* Junk fails safe, and the repair is a membership test — the stored pace
       reaches innerHTML through the picker's selected state. */
    t.ok('a pace with the wrong case is dropped from the profile', r.capitalPaceDropped, r);
    t.ok('a junk value reads as nothing logged, never NaN', r.junkReadsAsNothing, r);
    t.ok('and a junk pace falls back rather than throwing', r.junkPaceFallsBack, r);
  }

  /* The run has to be REACHABLE and REVIEWABLE — v311 split the controls onto
     Today and the read-only review onto Progress, and a new mode has to land on
     both or it is half-added. */
  {
    const r = await page.evaluate(() => {
      const keep = { mode: nut().cardioMode, onb: STATE.onboarded };
      STATE.onboarded = true;
      setCardioMode('run'); setRunPace('steady'); setRunUnit('min'); setRunVal(30);
      go('today'); TODAY_TAB = 'workout'; render();
      const tv = document.querySelector('#v-today').innerHTML;
      go('progress'); PROGRESS_TAB = 'summary'; render();
      const pv = document.querySelector('#v-progress').innerHTML;
      const o = {
        picker: /setCardioMode\('run'\)/.test(tv),
        card: /id="mv-run"/.test(tv) && /setRunPace\('tempo'\)/.test(tv),
        saysEnergyEquivalent: /energy equivalent/.test(tv),
        saysLogDistance: /Log the distance if you know it/.test(tv),
        reviewRow: /data-act="run"/.test(pv),
        reviewHasNoControls: !/id="mv-run"/.test(pv) && !/setRunPace\(/.test(pv),
      };
      setCardioMode(keep.mode || 'jacks'); STATE.onboarded = keep.onb;
      return o;
    });
    t.ok('the mode picker offers Run', r.picker, r);
    t.ok('and the card renders its paces and its input', r.card, r);
    /* A runner seeing 9,240 "steps" for 30 minutes would rightly distrust it.
       The step figure is an energy equivalent and the card says so. */
    t.ok('the card says the step figure is an energy equivalent', r.saysEnergyEquivalent, r);
    t.ok('and points the athlete at distance as the input', r.saysLogDistance, r);
    t.ok('the run appears in the Progress review', r.reviewRow, r);
    /* THE FLOOR: the review is read-only. A mutant that mounts the real block
       on Progress as well is caught here, same as v311. */
    t.ok('and the review holds no controls of its own', r.reviewHasNoControls, r);
  }

  const CARDIO_MODES_FOR_TEST = await page.evaluate(() => CARDIO_MODES.slice());
  /* Pulled from the app's own table rather than restated here — a second copy
     of these four names in the suite is the drift the table exists to stop. */
  const CARDIO_SHORT = await page.evaluate(() => {
    const o = {}; CARDIO_MODES.forEach(m => o[m] = CARDIO_INFO[m].short); return o; });
  const CARDIO_DID = await page.evaluate(() => {
    const o = {}; CARDIO_MODES.forEach(m => o[m] = CARDIO_INFO[m].did); return o; });
  const CARDIO_VERB = await page.evaluate(() => {
    const o = {}; CARDIO_MODES.forEach(m => o[m] = CARDIO_INFO[m].verb); return o; });

  /* ---- the makeup timer knows all four cardio modes (v327) -----------------
     Reported from the phone: "is this timer linked to the exercises here?"
     It was not. openMakeupTimer, openMakeupStopwatch and creditMakeup were
     three `bike ? ... : jacks` branches whose ELSE swallowed everything, so a
     ruck or a run would have credited JUMPING JACKS. Measured before the fix:
     a 30-minute ruck under 30 lb is 154 kcal and read as 271 — a 76%
     over-credit going straight into the food budget.

     CARDIO_MODES' own comment predicted this: "the third mode is where a
     m==='bike'?'bike':'jacks' shape starts silently swallowing new values".
     The third AND fourth arrived without anyone coming back. */
  {
    const r = await page.evaluate(() => {
      const keep = { mode: nut().cardioMode, kg: STATE.nutrition.weightKg, onb: STATE.onboarded };
      STATE.nutrition.weightKg = 86; STATE.onboarded = true;
      const zero = () => { const t = nutToday(); t.jackVal = 0; t.bikeVal = 0; t.ruckVal = 0; t.runVal = 0; };
      const where = () => ({ jacks: jackWork().min, bike: bikeRide().min, ruck: ruckWork().min, run: runWork().min });
      const o = { credits: {}, cards: {}, sheets: {} };

      /* EVERY mode credits ITS OWN activity and NOTHING else. */
      CARDIO_MODES.forEach(m => { zero(); creditMakeup(m, 30); o.credits[m] = where(); });
      /* And junk falls back rather than throwing — it reaches a setter. */
      zero(); creditMakeup('helicopter', 30); o.junk = where();
      zero();

      /* Every card offers the button, and passes ITS OWN mode. A card that
         passed 'jacks' would render and credit the wrong activity. */
      CARDIO_MODES.forEach(m => { setCardioMode(m); go('today'); TODAY_TAB = 'workout'; render();
        const html = document.querySelector('#v-today').innerHTML;
        o.cards[m] = { own: html.indexOf("openMakeupTimer('" + m + "')") >= 0,
                       count: (html.match(/openMakeupTimer\(/g) || []).length }; });

      CARDIO_MODES.forEach(m => { openMakeupTimer(m);
        const txt = document.querySelector('#sheet').textContent.replace(/\s+/g, ' ');
        o.sheets[m] = { named: txt.indexOf(CARDIO_INFO[m].label.replace(/^\S+\s/, '')) >= 0,
                        stopwatch: /Stopwatch/.test(txt),
                        block: /Start block/.test(txt),
                        durations: /45 min/.test(txt),
                        continuous: /One continuous effort/.test(txt) };
        try { closeSheet(); } catch (e) {} });

      /* The stopwatch names the mode too — it used to say "Jumping jacks" for
         anything that was not the bike. */
      openMakeupStopwatch('ruck');
      o.stopwatchNamesRuck = /Ruck/.test(document.querySelector('#sheet').textContent);
      try { makeupStopwatchCancel(); } catch (e) {}

      /* One table, so a fifth mode is a row rather than a branch. */
      o.tableCoversEveryMode = CARDIO_MODES.every(m => !!CARDIO_INFO[m]);
      o.tableHasNoStrays = Object.keys(CARDIO_INFO).every(k => CARDIO_MODES.indexOf(k) >= 0);

      setCardioMode(keep.mode || 'jacks');
      STATE.nutrition.weightKg = keep.kg; STATE.onboarded = keep.onb;
      return o;
    });

    /* THE DEFECT. Each mode's minutes land on that mode and nowhere else. */
    CARDIO_MODES_FOR_TEST.forEach(m => {
      t.eq('timing a ' + m + ' session credits ' + m, r.credits[m][m], 30, r.credits[m]);
      t.ok('and credits nothing else',
        Object.keys(r.credits[m]).every(k => k === m || r.credits[m][k] === 0), r.credits[m]);
    });
    /* Junk reaches a setter, so it must land somewhere safe rather than throw
       or vanish — jacks is the same fallback cardioMode() uses. */
    t.eq('an unrecognised mode falls back to jacks rather than disappearing', r.junk.jacks, 30, r.junk);
    /* Every card, and each passing its OWN mode. */
    CARDIO_MODES_FOR_TEST.forEach(m => {
      t.ok('the ' + m + ' card offers the timer', r.cards[m].own, r.cards[m]);
      t.eq('and offers exactly one', r.cards[m].count, 1, r.cards[m]);
    });
    /* Named for the mode, on both surfaces. */
    CARDIO_MODES_FOR_TEST.forEach(m => t.ok('the ' + m + ' timer is named for it', r.sheets[m].named, r.sheets[m]));
    t.ok('and so is the stopwatch', r.stopwatchNamesRuck, r);
    /* The RIGHT tools, not just any tools. A work/rest block is what jacks
       need; a duration list is what a trainer needs; a ruck or a run is one
       continuous effort and gets the stopwatch alone. Offering a block for a
       ruck would be a control with nothing behind it. */
    t.ok('every mode gets the stopwatch', CARDIO_MODES_FOR_TEST.every(m => r.sheets[m].stopwatch), r.sheets);
    t.ok('only jacks get a work/rest block', r.sheets.jacks.block
      && !r.sheets.bike.block && !r.sheets.ruck.block && !r.sheets.run.block, r.sheets);
    t.ok('only the bike gets a duration list', r.sheets.bike.durations
      && !r.sheets.jacks.durations && !r.sheets.ruck.durations && !r.sheets.run.durations, r.sheets);
    t.ok('and the continuous efforts say so', r.sheets.ruck.continuous && r.sheets.run.continuous, r.sheets);
    t.ok('while the block-based ones do not',
      !r.sheets.jacks.continuous && !r.sheets.bike.continuous, r.sheets);
    /* One table. A fifth mode is a row, not a branch — which is the whole
       reason this defect existed. */
    t.ok('the credit table covers every cardio mode', r.tableCoversEveryMode, r);
    t.ok('and carries no strays', r.tableHasNoStrays, r);
  }

  /* ---- the Movement card's three notes know all four modes (v328) ---------

     Same defect as the timer above, one function over, three times. The card
     answers three questions and two of them were `bike ? ... : jacks`:

       - "N steps to go" advice        -> the ELSE told a ruck or run athlete
                                          to do jumping jacks, while their own
                                          block four lines down correctly named
                                          the minutes under the plate. Measured:
                                          "39 min of jacks" printed directly
                                          above "70 min under that plate", same
                                          card, same 8,000-step gap.
       - "Target met. X carried N"     -> gated on `work.min||ride.min`, so a
                                          120-minute ruck carrying 13,800 steps
                                          against an 8,000 target said nothing.
       - "Also logged today"           -> two hardcoded pairs out of twelve.

     The gap is now answered ONCE, at the top, for whichever mode is picked —
     the ruck and run blocks lost their duplicate sentence, because the same
     number under two labels is what v314 cleaned off Progress. */
  {
    const r = await page.evaluate(() => {
      const o = {};
      const strip = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      const clear = () => { const t = nutToday();
        ['steps','bikeVal','jackVal','ruckVal','runVal'].forEach(k => t[k] = 0); };
      const card = () => { try { return strip(movementHTML()); }
                           catch (e) { return 'THREW: ' + e.message; } };

      /* GUARDS. Half of the first probe written for this reported four defects
         that were all one missing function name — movementCardHTML() does not
         exist. Assert the fixture works before believing anything it says. */
      o.namesExist = ['movementHTML','cardioInfo','cardioDone','ruckNeed','runNeed']
        .every(n => typeof window[n] === 'function');
      clear();
      o.target = stepTarget();
      o.emptyEquiv = stepEquivalent();
      { const t = nutToday(); t.jackUnit = 'min'; t.jackVal = 20; }
      o.fixtureMoves = jackWork().min === 20 && jackWork().steps > 0;
      o.cardRenders = card().indexOf('Movement') >= 0;
      if (!o.namesExist || !o.fixtureMoves || !o.cardRenders || !(o.target > 0)) return o;

      // --- 1. the gap, per mode -------------------------------------------
      o.gap = {};
      CARDIO_MODES.forEach(m => {
        clear(); STATE.nutrition.cardioMode = m;
        const s = card(), i = s.indexOf('steps to go');
        o.gap[m] = {
          shown: i >= 0,
          /* Scoped to the NOTE. A fixed 200-character slice ran past it into
             the "Make it up with" picker, which names every mode on every
             card — so "the ruck advice does not mention jacks" failed on
             correct code. Cut where the note ends. */
          text: i < 0 ? '' : s.slice(i + 13, i + 13 + (() => {
            const rest = s.slice(i + 13), end = rest.indexOf('Make it up with');
            return end < 0 ? 200 : end; })()),
          // the gap must be answered ONCE on the whole card, not twice
          restatements: (s.match(/steps short|steps to go/g) || []).length,
        };
      });
      // the minutes each mode's own arithmetic says will close it
      /* Derived from steps-per-minute, NOT from the *Need() helpers the note
         itself calls. Reading r.mins out of ruckNeed() compares the app to
         itself: a mutant that made ruckNeed() return jacks minutes moved both
         sides of the assertion and escaped. Pin the value, not the identity. */
      { clear(); const m = movement();
        const up = (steps, per) => (per > 0 && steps > 0) ? Math.ceil(steps / per) : 0;
        o.mins = { jacks: up(o.target, jackStepsPerMin(m.jlvl)),
                   bike:  up(o.target, bikeStepsPerMin(m.lvl)),
                   ruck:  up(o.target, ruckStepsPerMin(m.rlvl)),
                   run:   up(o.target, runStepsPerMin(m.nlvl)) };
        // and the per-minute rates really do differ, or the check is trivial
        o.ratesDiffer = new Set([jackStepsPerMin(m.jlvl), bikeStepsPerMin(m.lvl),
          ruckStepsPerMin(m.rlvl), runStepsPerMin(m.nlvl)]).size >= 3; }

      // --- 2. "Target met", per mode --------------------------------------
      const met = (mode, setup) => { clear(); const t = nutToday(); setup(t);
        STATE.nutrition.cardioMode = mode;
        const s = card(), i = s.indexOf('Target met');
        return { shown: i >= 0, text: i < 0 ? '' : s.slice(i, i + 120),
                 equiv: stepEquivalent() }; };
      o.met = {
        jacks: met('jacks', t => { t.jackUnit = 'min'; t.jackVal = 200; }),
        bike:  met('bike',  t => { t.bikeUnit = 'min'; t.bikeVal = 200; }),
        ruck:  met('ruck',  t => { t.ruckUnit = 'min'; t.ruckVal = 120; }),
        run:   met('run',   t => { t.runUnit  = 'min'; t.runVal  = 60;  }),
        // two modes at once, and the mode on screen is not the bigger one
        two:   met('ruck',  t => { t.ruckUnit = 'min'; t.ruckVal = 120;
                                   t.jackUnit = 'min'; t.jackVal = 30; }),
        // FLOOR: walked on your own feet — no mode carried it, so no claim
        walked: met('jacks', t => { t.steps = 99999; }),
      };

      // --- 3. the cross-note ----------------------------------------------
      const cross = (logged, mode) => { clear(); const t = nutToday();
        ({ jacks: () => { t.jackUnit = 'min'; t.jackVal = 20; },
           bike:  () => { t.bikeUnit = 'min'; t.bikeVal = 20; },
           ruck:  () => { t.ruckUnit = 'min'; t.ruckVal = 40; },
           run:   () => { t.runUnit  = 'min'; t.runVal  = 30; } })[logged]();
        STATE.nutrition.cardioMode = mode;
        const s = card(), i = s.indexOf('Also logged today');
        return { shown: i >= 0, text: i < 0 ? '' : s.slice(i, i + 110) }; };
      o.cross = {};
      CARDIO_MODES.forEach(logged => CARDIO_MODES.forEach(mode => {
        o.cross[logged + '_on_' + mode] = cross(logged, mode);
      }));
      // two other modes at once, named together
      { clear(); const t = nutToday();
        t.ruckUnit = 'min'; t.ruckVal = 40; t.runUnit = 'min'; t.runVal = 30;
        STATE.nutrition.cardioMode = 'jacks';
        const s = card(), i = s.indexOf('Also logged today');
        o.crossBoth = i < 0 ? '' : s.slice(i, i + 140); }

      // --- the table is the one place these live --------------------------
      o.infoCoversEveryMode = CARDIO_MODES.every(m =>
        CARDIO_INFO[m] && CARDIO_INFO[m].short && CARDIO_INFO[m].did
        && typeof CARDIO_INFO[m].work === 'function'
        && typeof CARDIO_INFO[m].advice === 'function');
      o.infoHasNoStrays = Object.keys(CARDIO_INFO).every(k => CARDIO_MODES.indexOf(k) >= 0);
      o.shortsUnique = new Set(CARDIO_MODES.map(m => CARDIO_INFO[m].short)).size === CARDIO_MODES.length;
      o.didsUnique   = new Set(CARDIO_MODES.map(m => CARDIO_INFO[m].did)).size === CARDIO_MODES.length;
      // an unknown mode falls back rather than throwing — cardioMode()'s own rule
      o.fallback = cardioInfo('helicopter') === CARDIO_INFO.jacks;
      /* `CARDIO_INFO[mode]||CARDIO_INFO.jacks` looks equivalent and is not:
         an inherited key is truthy, so a `||` fallback hands back
         Object.prototype.constructor. Only a membership test refuses it. */
      o.fallbackInherited = cardioInfo('constructor') === CARDIO_INFO.jacks;
      o.fallbackProtoIsTruthy = !!CARDIO_INFO['constructor'];
      // cardioDone() reports nothing on an empty day
      clear(); o.doneEmpty = cardioDone().length;
      return o;
    });

    t.ok('guard: every name this block calls exists', r.namesExist, r);
    t.ok('guard: the fixture actually moves the numbers', r.fixtureMoves, r);
    t.ok('guard: the card renders', r.cardRenders, r);
    t.ok('guard: there is a real gap to close', r.target > 0 && r.emptyEquiv === 0, r);

    /* 1 — the gap. Each mode is told what closes it in ITS OWN terms. The
       discriminating assertion is the MINUTES: every mode named jumping jacks
       before, so "the note exists" passes on the defect. */
    CARDIO_MODES_FOR_TEST.forEach(m => {
      t.ok('the ' + m + ' athlete is told what closes the gap', r.gap[m].shown, r.gap[m]);
      t.ok('and it is quoted in ' + m + '’s own minutes (' + r.mins[m] + ')',
        r.gap[m].text.indexOf(r.mins[m] + ' min') >= 0, { text: r.gap[m].text, want: r.mins[m] });
      /* One figure, one home. The ruck and run blocks used to restate it, so
         the card carried two different answers to the same question. */
      t.eq('and the card answers the gap exactly once on ' + m, r.gap[m].restatements, 1);
    });
    /* FLOOR: the four are genuinely different answers. A fix that quoted the
       same number four times would satisfy every assertion above. */
    t.ok('guard: the four modes are paid at genuinely different rates', r.ratesDiffer, r.mins);
    t.ok('the four modes really do quote different minutes',
      new Set([r.mins.jacks, r.mins.bike, r.mins.ruck, r.mins.run]).size >= 3, r.mins);
    /* FLOOR: no mode's advice mentions another mode's kit. This is what makes
       "told to do jumping jacks while on ruck" fail rather than pass. */
    t.ok('and the ruck advice does not mention jumping jacks',
      !/jumping jacks/i.test(r.gap.ruck.text), r.gap.ruck);
    t.ok('and the run advice does not mention jumping jacks',
      !/jumping jacks/i.test(r.gap.run.text), r.gap.run);
    t.ok('while the jacks advice still does', /jumping jacks/i.test(r.gap.jacks.text), r.gap.jacks);
    t.ok('and the bike advice still names the trainer', /trainer/i.test(r.gap.bike.text), r.gap.bike);

    /* 2 — "Target met" fires for whatever carried the day. */
    CARDIO_MODES_FOR_TEST.forEach(m => {
      t.ok('a day carried by ' + m + ' is acknowledged', r.met[m].shown, r.met[m]);
      t.ok('and it names ' + m + ' rather than something else',
        r.met[m].text.toLowerCase().indexOf(CARDIO_SHORT[m]) >= 0,
        { text: r.met[m].text, want: CARDIO_SHORT[m] });
      t.ok('and it credits the steps ' + m + ' really carried',
        r.met[m].text.indexOf(r.met[m].equiv.toLocaleString()) >= 0,
        { text: r.met[m].text, equiv: r.met[m].equiv });
    });
    t.ok('two modes in one day are both named', r.met.two.shown
      && /jumping jacks/i.test(r.met.two.text) && /ruck/i.test(r.met.two.text), r.met.two);
    /* And the figure is the SUM. Naming both while crediting one satisfies
       every assertion above — `done[0].steps` escaped until this existed. */
    t.ok('and the steps credited are both modes added together',
      r.met.two.text.indexOf(r.met.two.equiv.toLocaleString()) >= 0
      && r.met.two.equiv > r.met.ruck.equiv,
      { text: r.met.two.text, sum: r.met.two.equiv, ruckAlone: r.met.ruck.equiv });
    /* FLOOR: a note that always fires is a note nobody reads. Walking the
       target off on your own feet is not "the ruck carried it". */
    t.ok('but a day walked on foot claims no mode carried it', !r.met.walked.shown, r.met.walked);

    /* 3 — the cross-note, every pair. */
    CARDIO_MODES_FOR_TEST.forEach(logged => CARDIO_MODES_FOR_TEST.forEach(mode => {
      const k = logged + '_on_' + mode, cell = r.cross[k];
      if (logged === mode) {
        // FLOOR: the mode you are looking at is not "also" logged
        t.ok('nothing is called "also logged" on its own card (' + k + ')', !cell.shown, cell);
      } else {
        t.ok('work under ' + logged + ' is still visible on the ' + mode + ' card', cell.shown, cell);
        t.ok('and it names ' + logged + ' (' + k + ')',
          cell.text.toLowerCase().indexOf(CARDIO_DID[logged]) >= 0,
          { text: cell.text, want: CARDIO_DID[logged] });
      }
    }));
    t.ok('two other modes are named together, not one of them',
      /ruck/i.test(r.crossBoth) && /run/i.test(r.crossBoth), { text: r.crossBoth });

    /* The one table. A fifth mode is a row; there is no branch left to forget. */
    t.ok('the cardio table carries a label, a phrase, work and advice for every mode',
      r.infoCoversEveryMode, r);
    t.ok('and no strays', r.infoHasNoStrays, r);
    t.ok('and no two modes share a name', r.shortsUnique && r.didsUnique, r);
    t.ok('an unknown mode falls back to jacks rather than throwing', r.fallback, r);
    t.ok('guard: an inherited key really is truthy', r.fallbackProtoIsTruthy, r);
    t.ok('and an inherited key is refused too, not passed through',
      r.fallbackInherited, r);
    t.eq('and an empty day reports no mode at all', r.doneEmpty, 0);
  }


  /* ---- Easy conditioning counts all four cardio modes (v329) --------------

     `ridesThisWeek()` read `day.bikeVal` and `day.jackVal` and nothing else.
     Its own comment records this being fixed once already — it counted rides
     only until an athlete doing the same work with jacks saw a permanently
     empty bar — and then the ruck (v294) and the run (v323) arrived and
     nobody came back. Measured before the fix, against a 2 x 35 min target:

       2 x 45 min rucking -> 0/2, 0 min      2 x 45 min riding -> 2/2, 90 min
       2 x 40 min running -> 0/2, 0 min      2 x 45 min jacks  -> 2/2, 90 min

     That is exactly the week the army-prep programme prescribes, so the one
     athlete this was built for was the one it reported nothing for.

     And the card promised "Jumping jacks, a walk or the bike all count".
     A walk counted for nothing: the function never read `day.steps` at all,
     so 24,000 steps over two days read 0/2. */
  {
    const r = await page.evaluate(() => {
      const o = {};
      const strip = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      const n = nut();
      const key = off => { const d = new Date(); d.setDate(d.getDate() - off); return localISO(d); };
      const seed = (off, f) => { n.days[key(off)] = Object.assign({ water: 0, habits: {} }, f); };
      const card = () => { try { return strip(rideTargetHTML()); }
                           catch (e) { return 'THREW: ' + e.message; } };

      /* GUARDS first — the last probe written for this file reported four
         defects that were all one wrong function name. */
      o.namesExist = ['ridesThisWeek', 'rideTargetHTML', 'localISO', 'cardioInfo']
        .every(x => typeof window[x] === 'function');
      o.rowsRead = CARDIO_MODES.every(m => typeof CARDIO_INFO[m].dayMin === 'function'
        && typeof CARDIO_INFO[m].dayKcal === 'function' && !!CARDIO_INFO[m].verb);
      n.days = {};
      o.emptyRides = ridesThisWeek().rides;
      o.cardRenders = card().indexOf('Easy conditioning') >= 0;
      if (!o.namesExist || !o.rowsRead || o.emptyRides !== 0 || !o.cardRenders) return o;

      /* Two sessions of 45 minutes, one mode at a time. The target is
         2 x 35 min, so every one of these is a met week. */
      const set = {
        jacks: f => { f.jackUnit = 'min'; f.jackVal = 45; },
        bike:  f => { f.bikeUnit = 'min'; f.bikeVal = 45; },
        ruck:  f => { f.ruckUnit = 'min'; f.ruckVal = 45; },
        run:   f => { f.runUnit  = 'min'; f.runVal  = 45; },
      };
      o.byMode = {};
      CARDIO_MODES.forEach(m => {
        n.days = {};
        const a = {}, b = {}; set[m](a); set[m](b);
        seed(1, a); seed(3, b);
        const w = ridesThisWeek();
        o.byMode[m] = { rides: w.rides, mins: w.mins, kcal: w.kcal,
                        mine: w.perMode[m], card: card() };
      });

      /* A mixed week adds rather than picking one. */
      n.days = {};
      seed(1, { ruckUnit: 'min', ruckVal: 45 });
      seed(3, { runUnit: 'min', runVal: 40 });
      { const w = ridesThisWeek();
        o.mixed = { rides: w.rides, mins: w.mins, per: w.perMode, card: card() }; }

      /* FLOOR: a plain step count is NOT an easy-cardio session, and the copy
         no longer claims it is. 24,000 steps over two days must still read
         zero — a fix that simply counted everything would pass every
         assertion above and make the target meaningless. */
      n.days = {}; seed(1, { steps: 12000 }); seed(3, { steps: 12000 });
      { const w = ridesThisWeek(); o.walked = { rides: w.rides, mins: w.mins }; }

      /* FLOOR: a short session is not a full one. The bar is 70% of 35 min. */
      n.days = {}; seed(1, { ruckUnit: 'min', ruckVal: 10 }); seed(3, { ruckUnit: 'min', ruckVal: 10 });
      { const w = ridesThisWeek(); o.tooShort = { rides: w.rides, mins: w.mins }; }

      /* The promise, and where it points instead. */
      n.days = {};
      const c = card();
      o.promise = (c.match(/[^.]*all count[^.]*/) || [''])[0];
      o.saysWalkPaysSteps = /step target/i.test(c);
      o.stillClaimsWalk = /a walk[ ,]/i.test(o.promise);

      /* Every unit converts, not just minutes — the table's day reader owns
         all three currencies for all four modes now. */
      n.days = {};
      seed(1, { ruckUnit: 'dist', ruckVal: 4 });
      o.ruckByDistance = ridesThisWeek().perMode.ruck;
      n.days = {}; seed(1, { runUnit: 'dist', runVal: 8 });
      o.runByDistance = ridesThisWeek().perMode.run;

      /* A stored day is read as STORED. movement() carries the athlete's
         current level forward as a default, which is right for today and
         wrong for a day already in the past. */
      n.days = {}; seed(2, { ruckUnit: 'min', ruckVal: 60, ruckLvl: 'easy' });
      const easyMin = ridesThisWeek().perMode.ruck;
      n.days = {}; seed(2, { ruckUnit: 'min', ruckVal: 60, ruckLvl: 'hills' });
      o.storedLevelRead = { easy: easyMin, hills: ridesThisWeek().perMode.ruck,
        easyKcal: 0 };
      // minutes are the same; the ENERGY is what the level changes
      n.days = {}; seed(2, { ruckUnit: 'min', ruckVal: 60, ruckLvl: 'easy' });
      o.storedLevelRead.easyKcal = ridesThisWeek().kcal;
      n.days = {}; seed(2, { ruckUnit: 'min', ruckVal: 60, ruckLvl: 'hills' });
      o.storedLevelRead.hillsKcal = ridesThisWeek().kcal;

      /* Junk in a stored day is dropped, not counted. importData() accepts
         arbitrary JSON and these rows travel in every backup.

         A NUMERIC STRING is the case that matters, and the first version of
         this check missed it. `+v||0` looks equivalent to the type test —
         'lots' is NaN either way, and a negative is refused downstream by the
         `m>0` guard — but '45' coerces to 45 and would be COUNTED. movement()
         reads today's number with `typeof v==='number'`, so the same stored
         row would then be worth 45 minutes in the weekly total and nothing on
         the card. The two readers must agree. */
      n.days = {};
      seed(1, { ruckUnit: 'min', ruckVal: 'lots' });
      seed(2, { runUnit: 'min', runVal: -50 });
      seed(3, { bikeUnit: 'min', bikeVal: NaN });
      o.junk = { rides: ridesThisWeek().rides, mins: ridesThisWeek().mins };
      n.days = {};
      seed(1, { ruckUnit: 'min', ruckVal: '45' });
      seed(3, { runUnit: 'min', runVal: '45' });
      o.numericString = { rides: ridesThisWeek().rides, mins: ridesThisWeek().mins,
                          per: ridesThisWeek().perMode };
      /* …and the guard: the same value really is refused by today's reader,
         so this is the two agreeing rather than one being arbitrarily strict. */
      { const tt = nutToday(); tt.ruckUnit = 'min'; tt.ruckVal = '45';
        o.todayAlsoRefuses = movement().rval === 0 && ruckWork().min === 0;
        tt.ruckVal = 45;
        o.todayAcceptsRealNumber = ruckWork().min === 45;
        tt.ruckVal = 0; }

      n.days = {};
      /* The validator covers all FOUR cardio ladders now, not two. */
      const v = validateData.toString();
      o.validator = { bike: /BIKE_LEVELS\.forEach/.test(v), jacks: /JACK_LEVELS\.forEach/.test(v),
                      ruck: /RUCK_PACES\.forEach/.test(v),  run: /RUN_PACES\.forEach/.test(v) };
      const ce = console.error; console.error = () => {};
      o.validatorClean = (validateData() || []).length;
      /* ruckMET() is computed from bodyweight, so the ruck rules have to hold
         across real bodies rather than at one seeded weight. */
      o.cleanByWeight = {};
      [55, 80, 110, 150].forEach(kg => { nut().weightKg = kg;
        o.cleanByWeight[kg] = (validateData() || []).length; });
      nut().weightKg = 86;
      /* And the new rules must actually FIRE on a broken ladder, or "the
         validator is clean" proves nothing about them. */
      const bump = (arr, k, field, val) => { const row = arr.find(x => x.k === k);
        const was = row[field]; row[field] = val;
        const hit = (validateData() || []).filter(e => e.indexOf(field === 'mph' ? 'mph' : '') >= 0);
        const all = validateData() || []; row[field] = was; return all; };
      o.ruckRuleBites = bump(RUCK_PACES, 'brisk', 'mph', 40)
        .some(e => /RUCK_PACES\.brisk/.test(e));
      o.runRuleBites = bump(RUN_PACES, 'steady', 'kmh', 90)
        .some(e => /RUN_PACES\.steady/.test(e));
      o.stillCleanAfter = (validateData() || []).length;
      console.error = ce;
      return o;
    });

    t.ok('guard: every name this block calls exists', r.namesExist, r);
    t.ok('guard: every mode has a stored-day reader and a verb', r.rowsRead, r);
    t.ok('guard: an empty week counts nothing', r.emptyRides === 0, r);
    t.ok('guard: the card renders', r.cardRenders, r);

    /* Two 45-minute sessions is a met week in ANY of the four modes. */
    CARDIO_MODES_FOR_TEST.forEach(m => {
      t.eq('two 45-minute sessions of ' + m + ' meet the weekly target', r.byMode[m].rides, 2);
      t.eq('and the minutes are counted (' + m + ')', r.byMode[m].mins, 90);
      t.eq('and they are credited to ' + m + ' itself', r.byMode[m].mine, 90);
      t.ok('and the card names ' + m + ' in the breakdown',
        r.byMode[m].card.indexOf('90 ' + CARDIO_VERB[m]) >= 0,
        { want: '90 ' + CARDIO_VERB[m], card: r.byMode[m].card.slice(0, 130) });
      /* Priced at the mode's own rate. Charging every minute at the jacks
         rate was the old behaviour and is the same defect one number over. */
      t.ok('and the calories are the mode’s own, not a flat rate',
        r.byMode[m].kcal > 0, r.byMode[m]);
    });
    /* FLOOR: the four modes really are priced differently, or "its own rate"
       is satisfied by any constant. */
    t.ok('and the four modes really are priced differently',
      new Set(CARDIO_MODES_FOR_TEST.map(m => r.byMode[m].kcal)).size >= 3,
      CARDIO_MODES_FOR_TEST.map(m => m + ':' + r.byMode[m].kcal).join(' '));

    /* A mixed week adds. */
    t.eq('a ruck and a run in one week both count', r.mixed.rides, 2);
    t.eq('and their minutes add', r.mixed.mins, 85);
    t.ok('and the breakdown names both',
      r.mixed.card.indexOf('45 rucking') >= 0 && r.mixed.card.indexOf('40 running') >= 0,
      r.mixed.card.slice(0, 150));

    /* FLOORS. A fix that counted everything would pass every check above. */
    t.eq('but 24,000 steps of ordinary walking is not two cardio sessions', r.walked.rides, 0);
    t.eq('and contributes no conditioning minutes', r.walked.mins, 0);
    t.eq('and two 10-minute efforts do not meet a 35-minute target', r.tooShort.rides, 0);

    /* The promise now matches the code, both ways round. */
    t.ok('the card names every mode that really counts',
      /jumping jacks/i.test(r.promise) && /bike/i.test(r.promise)
      && /ruck/i.test(r.promise) && /run/i.test(r.promise), { promise: r.promise });
    t.ok('and no longer claims a plain walk counts here', !r.stillClaimsWalk, { promise: r.promise });
    /* …and says where walking DOES count, rather than leaving it worthless. */
    t.ok('and points walking at the step target instead', r.saysWalkPaysSteps, r);

    /* Distance and calories convert too, for the two modes that never had a
       stored-day reader at all. */
    t.ok('a ruck logged in distance still counts', r.ruckByDistance > 0, r);
    t.ok('and a run logged in distance still counts', r.runByDistance > 0, r);

    /* The day is read as STORED. Same minutes, different energy. */
    t.eq('a stored pace does not change the minutes', r.storedLevelRead.easy, r.storedLevelRead.hills);
    t.ok('but it does change the energy', r.storedLevelRead.hillsKcal > r.storedLevelRead.easyKcal,
      r.storedLevelRead);

    /* A backup can carry anything. */
    t.eq('junk in a stored day counts as no sessions', r.junk.rides, 0);
    t.eq('and as no minutes', r.junk.mins, 0);
    /* The discriminating case: a numeric STRING coerces, so `+v||0` would
       count it while movement() would not. */
    t.ok('guard: today’s reader refuses a numeric string', r.todayAlsoRefuses, r);
    t.ok('guard: and accepts the same value as a real number', r.todayAcceptsRealNumber, r);
    t.eq('so the weekly count refuses it too — no sessions', r.numericString.rides, 0);
    t.eq('and no minutes', r.numericString.mins, 0);

    /* The validator covers four ladders, not two — and the new rules bite. */
    t.ok('the validator checks the bike ladder', r.validator.bike, r.validator);
    t.ok('and the jacks ladder', r.validator.jacks, r.validator);
    t.ok('and the ruck ladder', r.validator.ruck, r.validator);
    t.ok('and the run ladder', r.validator.run, r.validator);
    t.eq('and it is clean on the real data', r.validatorClean, 0);
    /* ruckMET() moves with bodyweight, so one seeded weight proves little. */
    Object.keys(r.cleanByWeight).forEach(kg =>
      t.eq('and clean at ' + kg + ' kg', r.cleanByWeight[kg], 0));
    /* "The validator is clean" stays true whether a rule exists or not. Break
       the data in front of it and require the specific complaint. */
    t.ok('a rucking pace of 40 mph is reported', r.ruckRuleBites, r);
    t.ok('a running speed of 90 km/h is reported', r.runRuleBites, r);
    t.eq('and the data is restored afterwards', r.stillCleanAfter, 0);
  }


  /* ---- reading a watch screenshot into Movement (v352) --------------------
     "I am not sure what activities I will do from day to day but I want the
     flexibility to upload a screenshot and allow that information to be
     received in our app."

     The network is mocked throughout — this sandbox cannot reach Gemini, so
     every check here proves the WIRING and the arithmetic, never the model. */
  {
    const act = await page.evaluate(() => {
      const o = {};
      STATE.profile.unit = 'in'; save();          // imperial athlete

      /* 1. His real Garmin screen: two runs and a jump rope, names that are
            PLACES ("Carstairs Running"), times as MM:SS, distance in miles. */
      const real = { activities: [
        { kind: 'Carstairs Running', distance: 2.23, distanceUnit: 'mi', duration: '25:44' },
        { kind: 'Jump Rope 34', duration: '35:21', kcal: 405 },
        { kind: 'Carstairs Running', distance: 1.07, distanceUnit: 'mi', duration: '10:42' } ] };
      const p = activityPlan(real);
      o.read = p.read;
      o.runMiles = Math.round(kmToShow(p.run.km) * 100) / 100;   // 2.23 + 1.07
      o.runMin = Math.round(p.run.min * 100) / 100;              // 25:44 + 10:42
      o.unplacedNames = p.unplaced.map(x => x.name);
      o.unplacedMin = p.unplaced.map(x => x.min);
      /* THE HONESTY CHECK. An activity with no slot must not be quietly filed
         under the nearest mode — that credits work in a currency which feeds
         the food budget. */
      o.jumpRopeWentNowhere = p.jacks.min === 0 && p.bike.min === 0 && p.ruck.min === 0;

      /* 2. Matched on the movement WORD, never the whole name. */
      o.kinds = ['Carstairs Running', 'Morning Ruck', 'Zwift Cycling', 'Jumping Jacks',
                 'Jump Rope 34', 'Pool Swim', 'Treadmill'].map(activityKind);

      /* 3. The duration is parsed in CODE, from the string the screen shows. */
      o.hms = [hmsToMin('25:44'), hmsToMin('1:05:20'), hmsToMin('45'),
               hmsToMin(12), hmsToMin('abc'), hmsToMin(''), hmsToMin('-3:00'),
               /* '3:-30' comes out POSITIVE (2.5) if the parts are not checked
                  individually, so the final min>0 guard cannot catch it. */
               hmsToMin('3:-30')]
                 .map(x => Math.round(x * 100) / 100);

      /* 4. Miles convert, kilometres do not. */
      const mi = activityPlan({ activities: [{ kind: 'Run', distance: 10, distanceUnit: 'mi', duration: '60:00' }] });
      const km = activityPlan({ activities: [{ kind: 'Run', distance: 10, distanceUnit: 'km', duration: '60:00' }] });
      o.tenMilesKm = Math.round(mi.run.km * 100) / 100;
      o.tenKmKm = Math.round(km.run.km * 100) / 100;

      /* 5. A distance is not a step count. */
      o.stepsAbsent = p.steps;
      o.stepsTaken = activityPlan({ activities: [{ kind: 'Walk', duration: '30:00' }], steps: 11200 }).steps;

      /* 6. NOTHING IS WRITTEN UNTIL SAVE. */
      nutToday().runVal = 0; nutToday().runUnit = 'min'; setSteps(0);
      _actRead = activityPlan(real); openActivityReview();
      o.sheetText = document.querySelector('#sheet').innerText;
      o.beforeSave = { runVal: nutToday().runVal || 0, steps: movement().steps };
      saveActivityRead();
      /* r1() rounds to ONE decimal — 5.31 would read as 5.3 and the check
         would be asserting the rounding, not the stored value. */
      o.afterSave = { runVal: Math.round(nutToday().runVal * 100) / 100, runUnit: nutToday().runUnit,
                      band: nutToday().runLvl };
      /* The read is CONSUMED. Leaving it in the buffer means a second tap of
         Save writes the same run again — the day credited twice. */
      o.bufferCleared = _actRead === null;
      nutToday().runVal = 0;
      saveActivityRead();                       // a second tap must do nothing
      o.secondSaveWrote = Math.round((nutToday().runVal || 0) * 100) / 100;

      /* 7. The pace band comes from the measured pace, and is left alone when
            there is nothing to measure. */
      o.bandFromPace = paceBandFor(5.31, 36.43);
      o.bandNoDistance = paceBandFor(0, 30);
      o.bandNoTime = paceBandFor(5, 0);
      o.bandFast = paceBandFor(5, 20);           // 15 km/h

      /* 8. "Count as jacks" is HIS tap, and it moves the minutes. */
      _actRead = activityPlan(real);
      openActivityReview();                     // merely LOOKING moves nothing
      o.jacksAfterOpen = Math.round(_actRead.jacks.min);
      o.unplacedAfterOpen = _actRead.unplaced.length;
      const beforeJacks = _actRead.jacks.min;
      actCountAsJacks();
      o.jacksAfterTap = Math.round(_actRead.jacks.min);
      o.jacksBeforeTap = beforeJacks;
      o.unplacedCleared = _actRead.unplaced.length;
      try { closeSheet(); } catch (e) {}

      /* 9. Save reports what it DID. v343: three savers on one screen claimed
            a write they had declined. */
      _actRead = { run: { min: 0, km: 0 }, ruck: { min: 0, km: 0 }, bike: { min: 0, km: 0 },
                   jacks: { min: 0, km: 0 }, steps: 0, unplaced: [], read: 0 };
      let said = ''; const realToast = window.toast; window.toast = m => { said = String(m); };
      saveActivityRead();
      window.toast = realToast;
      o.emptySaveSays = said;
      o.emptySaveKeptSheet = !!_actRead;         // it did NOT clear and claim success

      /* 10. An activity name reaches innerHTML — it must be escaped. */
      _actRead = activityPlan({ activities: [{ kind: '<img src=x onerror=alert(1)>', duration: '5:00' }] });
      openActivityReview();
      o.noInjectedNode = !document.querySelector('#sheet img[onerror]');
      try { closeSheet(); } catch (e) {}
      _actRead = null;

      /* 11. ONE vision path. The activity route passes a SCHEMA and reuses the
             shared caller — it must not re-implement the model list, the
             budget or the transient classifier. */
      const src = activityScreenshot.toString();
      o.usesSharedCaller = /_visionEstimate\(/.test(src);
      o.passesItsOwnSchema = /ACTIVITY_SCHEMA/.test(src);
      o.doesNotReinventModels = !/foodAIModels\(|AI_RETRY_BACKOFF_MS|_transientAIStatus/.test(src);
      o.keepsTheLighterRetry = /_connectionLevel/.test(src);
      o.schemaIsOverridable = /o0\.schema/.test(_visionEstimate.toString());
      return o;
    });
    t.eq('all three rows on the real screenshot are read', act.read, 3, act);
    t.eq('the two runs are summed', act.runMiles, 3.3, act);
    t.eq('and so are their times', act.runMin, 36.43, act);
    t.eq('a Garmin name is matched on the movement word, not the whole name', act.kinds,
      ['run', 'ruck', 'bike', 'jacks', null, null, 'run'], act);
    t.eq('the jump rope is named, with its minutes', act.unplacedNames, ['Jump Rope 34'], act);
    t.eq('35:21 reads as 35 minutes', act.unplacedMin, [35], act);
    t.ok('and it is NOT filed under the nearest mode', act.jumpRopeWentNowhere, act);
    t.eq('MM:SS and H:MM:SS are parsed in code, junk reads as nothing', act.hms,
      [25.73, 65.33, 45, 12, 0, 0, 0, 0], act);
    t.eq('ten miles is 16.09 km', act.tenMilesKm, 16.09, act);
    t.eq('floor: ten kilometres stays ten', act.tenKmKm, 10, act);
    t.eq('a distance is never read as a step count', act.stepsAbsent, 0, act);
    t.eq('but a real step figure is taken', act.stepsTaken, 11200, act);
    t.ok('the review sheet says nothing is logged yet', /nothing is logged until you do/i.test(act.sheetText), act);
    t.ok('and shows the summed run', /3\.3 mi/.test(act.sheetText), act);
    t.eq('opening the review writes NOTHING', act.beforeSave, { runVal: 0, steps: 0 }, act);
    t.eq('saving writes the distance', act.afterSave.runVal, 5.31, act);
    t.eq('as a distance, not minutes', act.afterSave.runUnit, 'dist', act);
    t.eq('and sets the pace band from the measured pace', act.afterSave.band, 'easy', act);
    t.ok('the read is consumed, not left in the buffer', act.bufferCleared, act);
    t.eq('so a second tap of Save credits nothing twice', act.secondSaveWrote, 0, act);
    t.eq('the band helper agrees', act.bandFromPace, 'easy', act);
    t.eq('a fast measured pace lands on a faster band', act.bandFast, 'intervals', act);
    t.eq('floor: no distance, no band', act.bandNoDistance, null, act);
    t.eq('floor: no time, no band', act.bandNoTime, null, act);
    t.eq('opening the review moves nothing into jacks', act.jacksAfterOpen, 0, act);
    t.eq('and leaves the unplaced row where it is', act.unplacedAfterOpen, 1, act);
    t.eq('guard: the unplaced minutes were not already in jacks', act.jacksBeforeTap, 0, act);
    t.eq('his tap moves them there', act.jacksAfterTap, 35, act);
    t.eq('and clears the unplaced list', act.unplacedCleared, 0, act);
    t.ok('a save with nothing in it says so', /nothing to save/i.test(act.emptySaveSays), act);
    t.ok('and does not claim a write', act.emptySaveKeptSheet, act);
    t.ok('an activity name is escaped before it reaches innerHTML', act.noInjectedNode, act);
    t.ok('the activity route uses the shared vision caller', act.usesSharedCaller, act);
    t.ok('passing its own schema', act.passesItsOwnSchema, act);
    t.ok('which the shared caller honours', act.schemaIsOverridable, act);
    t.ok('and does NOT re-implement the model list or retry policy', act.doesNotReinventModels, act);
    t.ok('while keeping the lighter-image fallback for a stalled connection', act.keepsTheLighterRetry, act);
  }

  await browser.close(); srv.close();
  return t.finish(errors);
}
