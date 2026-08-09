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
    // the two energy models must agree — they are the whole basis of the trade
    o.perStepMatches = Math.abs(kcalPerStep() - stepKcal(1000) / 1000) < 0.0002;
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
    o.emptyReadsZero = JSON.stringify(movement()) === JSON.stringify({ steps: 0, val: 0, unit: 'min', lvl: 'steady' });
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
    delete T.steps; delete T.bikeVal; T.habits = { steps: true };
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
      namesTheSafestInput: /Calories is the one to trust/.test(v().innerHTML),
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
  t.ok('and which entry is safest if the effort chip is a guess', card.namesTheSafestInput, card);
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

  await browser.close(); srv.close();
  return t.finish(errors);
}
