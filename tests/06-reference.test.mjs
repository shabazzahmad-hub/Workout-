/* The Reference tab.

   This tab is different from the rest of the app in two ways that matter.

   It is a *write* surface: tapping a food pre-fills the log sheet and "Log this
   meal" writes several entries at once, so a wrong number here does not just
   read badly, it lands in the day's macro totals and then in the weekly
   averages. The first block below exists because a category-average estimate
   shipped logging olive oil as 20 g of carbohydrate.

   And nothing on it is hand-typed. Every gram and every calorie — the seven
   days, their meal subtotals, the shopping list — is computed from the food
   table against the athlete's own targets. That removes a whole class of
   drift, and replaces it with the risk that the arithmetic is confidently
   wrong. So these checks assert the *relationships*: that a day's header is
   its meals, that a day scaled to a target actually lands on it, that the shop
   is the days, and that no amount comes out of the scaler that nobody would
   put on a plate. */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

export default async function run() {
  const t = suite('reference tab');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  // ---- the food table ------------------------------------------------------
  const food = await page.evaluate(() => {
    const o = {}, cats = FOOD_CATS.map(c => c[0]).filter(c => c !== 'all');
    o.count = FOODS.length;
    o.fish = FOODS.filter(f => f[4] === 'fish').length;
    o.plant = FOODS.filter(f => f[4] === 'plant').length;
    o.veg = FOODS.filter(f => f[4] === 'veg').length;
    o.badShape = FOODS.filter(f => !Array.isArray(f) || f.length < 8 || typeof f[0] !== 'string'
      || typeof f[3] !== 'string').map(f => f && f[0]);
    o.dupes = FOODS.map(f => f[0]).filter((n, i, a) => a.indexOf(n) !== i);
    o.orphanCat = FOODS.filter(f => !cats.includes(f[4])).map(f => f[0]);
    o.everyTabHasFood = cats.every(c => FOODS.some(f => f[4] === c));
    o.noFat = FOODS.filter(f => typeof f[5] !== 'number').map(f => f[0]);
    o.noBase = FOODS.filter(f => !(f[6] > 0)).map(f => f[0]);
    o.badUnit = FOODS.filter(f => !['g', 'ml', 'ea'].includes(f[7])).map(f => f[0]);
    o.indexed = FOODS.every((f, i) => FOOD_BY_NAME[f[0]] === i);
    // every row must reconcile: protein + derived carbs + fat ≈ its own calories
    o.negative = [], o.drift = [];
    FOODS.forEach(f => {
      const m = foodMacros(f);
      if (m.c < 0 || m.f < 0) o.negative.push(f[0]);
      const recon = f[1] * 4 + m.c * 4 + m.f * 9;
      if (Math.abs(recon - f[2]) > 12) o.drift.push(f[0] + ':' + recon + '/' + f[2]);
    });
    // the specific rows the old category split got wrong
    o.oil = foodMacros(FOODS[FOOD_BY_NAME['Olive oil']]);
    o.banana = foodMacros(FOODS[FOOD_BY_NAME['Banana']]);
    o.rice = foodMacros(FOODS[FOOD_BY_NAME['White rice, cooked']]);
    o.egg = foodMacros(FOODS[FOOD_BY_NAME['Egg']]);
    o.chicken = foodMacros(FOODS[FOOD_BY_NAME['Chicken breast']]);
    o.effCod = +foodEfficiency(FOODS[FOOD_BY_NAME['Cod']]).toFixed(1);
    o.effSalmon = +foodEfficiency(FOODS[FOOD_BY_NAME['Salmon fillet']]).toFixed(1);
    o.effLeanBeatsFatty = o.effCod > o.effSalmon;
    o.effZeroKcalSafe = foodEfficiency(['x', 10, 0, 'y', 'meat', 0, 100, 'g']) === 0;
    o.validatorClean = validateData().length === 0;
    return o;
  });
  t.ok('the food list is substantial', food.count >= 80, food.count);
  t.ok('there are real fish options', food.fish >= 18, food);
  t.ok('there are real bean and plant options', food.plant >= 15, food);
  t.ok('there are real vegetable options', food.veg >= 15, food);
  t.ok('every row is the right shape', food.badShape.length === 0, food.badShape);
  t.ok('no food is listed twice', food.dupes.length === 0, food.dupes);
  t.ok('every food belongs to a filter tab that exists', food.orphanCat.length === 0, food.orphanCat);
  t.ok('every filter tab has something in it', food.everyTabHasFood, food);
  t.ok('every food carries a real fat figure', food.noFat.length === 0, food.noFat);
  t.ok('every food carries the amount its figures describe', food.noBase.length === 0, food.noBase);
  t.ok('every unit is one the sheet can format', food.badUnit.length === 0, food.badUnit);
  t.ok('the name index points at the right rows', food.indexed, food);
  t.ok('no food ever logs a negative macro', food.negative.length === 0, food.negative);
  t.ok('every food reconciles to its own calorie count', food.drift.length === 0, food.drift);
  t.ok('olive oil logs as fat, not as carbs', food.oil.f >= 12 && food.oil.c <= 2, food.oil);
  t.ok('a banana logs as carbs, not as fat', food.banana.c >= 20 && food.banana.f <= 2, food.banana);
  t.ok('rice logs as carbs', food.rice.c >= 70 && food.rice.f <= 2, food.rice);
  t.ok('an egg logs ~5 g fat and almost no carbs', food.egg.f === 5 && food.egg.c <= 2, food.egg);
  t.ok('chicken breast logs no meaningful carbs', food.chicken.c <= 2, food.chicken);
  t.ok('protein-per-100kcal ranks lean fish above fatty fish', food.effLeanBeatsFatty, food);
  t.ok('efficiency does not divide by zero', food.effZeroKcalSafe, food);
  t.ok('validateData stays clean with the Reference tables in it', food.validatorClean, food);

  // ---- costing an arbitrary amount -----------------------------------------
  /* This is the whole point of the rewrite: the tab has to answer "what is 200 g
     of this worth" and "how much do I need", not just "here is one portion". */
  const amt = await page.evaluate(() => {
    const o = {}, cod = FOODS[FOOD_BY_NAME['Cod']], egg = FOODS[FOOD_BY_NAME['Egg']];
    o.base = foodAt(cod, foodBase(cod));
    o.baseMatchesTable = o.base.p === cod[1] && o.base.kcal === cod[2];
    o.double = foodAt(cod, 300);
    o.doublesCleanly = o.double.p === cod[1] * 2 && o.double.kcal === cod[2] * 2;
    o.half = foodAt(cod, 75);
    o.halvesCleanly = o.half.p === Math.round(cod[1] / 2);
    o.zero = foodAt(cod, 0);
    o.zeroIsZero = o.zero.p === 0 && o.zero.kcal === 0 && o.zero.c === 0;
    o.junkSafe = (() => { const n = foodAt(cod, 'abc'); return n.p === 0 && n.kcal === 0; })();
    o.negSafe = (() => { const n = foodAt(cod, -200); return n.p <= 0 && n.kcal <= 0; })();
    // a costed amount must still reconcile to its own calories
    const n = foodAt(FOODS[FOOD_BY_NAME['Chicken breast']], 175);
    o.reconciles = Math.abs(n.p * 4 + n.c * 4 + n.f * 9 - n.kcal) <= 14;
    // "how much for N grams of protein" has to round-trip
    o.roundTrip = [20, 35, 50, 80].map(need => {
      const a = amountForProtein(cod, need);
      return { need, a, got: foodAt(cod, a).p };
    });
    o.roundTripsClose = o.roundTrip.every(r => Math.abs(r.got - r.need) <= 3);
    o.eggRoundsToHalves = amountForProtein(egg, 15) % 0.5 === 0;
    o.noProteinNoAnswer = amountForProtein(FOODS[FOOD_BY_NAME['Olive oil']], 30) === 0;
    o.zeroNeedNoAnswer = amountForProtein(cod, 0) === 0;
    // per-100 is the figure that lets you scale in your head
    o.per100Cod = foodPer100(cod);
    o.per100Right = Math.abs(o.per100Cod.p - cod[1] * 100 / 150) < 0.2;
    o.per100Egg = foodPer100(egg);
    o.per100EachForCounts = o.per100Egg.per === 'each' && o.per100Egg.p === egg[1];
    // amounts are rounded to something you could measure
    o.rounding = { g: roundAmount(cod, 137.4), small: roundAmount(FOODS[FOOD_BY_NAME['Olive oil']], 13.2), ea: roundAmount(egg, 2.3) };
    o.roundsSensibly = o.rounding.g % 10 === 0 && o.rounding.small % 5 === 0 && o.rounding.ea % 0.5 === 0;
    o.neverRoundsToNothing = roundAmount(cod, 0.4) > 0 && roundAmount(egg, 0.1) > 0;
    o.fmt = [fmtAmount(cod, 150), fmtAmount(egg, 3), fmtAmount(egg, 1.5), fmtAmount(FOODS[FOOD_BY_NAME['Potato']], 1700)];
    return o;
  });
  t.ok('the listed amount costs out to exactly the listed figures', amt.baseMatchesTable, amt.base);
  t.ok('twice the amount is twice the protein and calories', amt.doublesCleanly, amt.double);
  t.ok('half the amount is half the protein', amt.halvesCleanly, amt.half);
  t.ok('no amount is zero protein for zero food', amt.zeroIsZero, amt.zero);
  t.ok('a non-numeric amount costs out to nothing rather than NaN', amt.junkSafe, amt);
  t.ok('a negative amount cannot credit the day', amt.negSafe, amt);
  t.ok('a costed amount still reconciles to its own calories', amt.reconciles, amt);
  t.ok('"how much for N g of protein" round-trips', amt.roundTripsClose, amt.roundTrip);
  t.ok('a count-based food is answered in halves, not in grams', amt.eggRoundsToHalves, amt);
  t.ok('a food with no protein cannot fill a protein gap', amt.noProteinNoAnswer, amt);
  t.ok('no gap means no amount', amt.zeroNeedNoAnswer, amt);
  t.ok('protein per 100 g is right', amt.per100Right, amt.per100Cod);
  t.ok('a counted food is quoted per each, not per 100', amt.per100EachForCounts, amt.per100Egg);
  t.ok('amounts round to something you could measure', amt.roundsSensibly, amt.rounding);
  t.ok('rounding never wipes an amount out entirely', amt.neverRoundsToNothing, amt);
  t.eq('amounts are formatted for their unit', amt.fmt, ['150 g', '×3', '×1.5', '1.7 kg']);

  // ---- the seven days scale onto a real target -----------------------------
  const days = await page.evaluate(() => {
    const o = { n: REF_DAYS.length, bad: [], absurd: [], inconsistent: [], missing: [] };
    REF_DAYS.forEach(d => {
      if (d.meals.length < 3) o.bad.push(d.name + ': fewer than three sittings');
      d.meals.forEach(m => m.items.forEach(([n]) => {
        if (FOOD_BY_NAME[n] === undefined) o.missing.push(d.name + ': ' + n);
      }));
    });
    // the real guarantee: a day scaled to a target lands on that target, at
    // every target the app can produce — not just the one it was written for
    /* [140, 3500] is the bar that was missing. Every target above was at or
       below where the starch dial saturates, so the whole suite agreed the days
       worked while a 78 kg very-active athlete on a gain goal missed on all 28.
       A range only probed from the inside cannot be seen to shrink. */
    const TARGETS = [[120, 1700], [150, 2170], [155, 2280], [175, 2400], [200, 2800], [140, 3200]];
    TARGETS.forEach(([tp, tk]) => REF_DAYS.forEach(d => {
      const sc = scaleDay(d, tp, tk);
      if (Math.abs(sc.p - tp) > 12) o.bad.push(`${d.name}@${tp}: ${sc.p}g`);
      if (Math.abs(sc.kcal - tk) > 150) o.bad.push(`${d.name}@${tk}kcal: ${sc.kcal}`);
      // header == meals == items, always
      const mealSum = sc.meals.reduce((a, m) => a + m.p, 0);
      const itemSum = sc.meals.reduce((a, m) => a + m.items.reduce((b, x) => b + x.p, 0), 0);
      if (sc.p !== mealSum || sc.p !== itemSum) o.inconsistent.push(`${d.name}@${tp}: ${sc.p}/${mealSum}/${itemSum}`);
      const kMealSum = sc.meals.reduce((a, m) => a + m.kcal, 0);
      if (sc.kcal !== kMealSum) o.inconsistent.push(`${d.name}@${tp} kcal: ${sc.kcal}/${kMealSum}`);
      // nothing the scaler produces may be an amount nobody would plate
      sc.meals.forEach(m => m.items.forEach(x => {
        const f = FOODS[x.i];
        if (!(x.amt > 0)) o.absurd.push(`${d.name}@${tp}: ${x.name} scaled to ${x.amt}`);
        if (foodUnit(f) !== 'ea' && x.amt > 900) o.absurd.push(`${d.name}@${tp}: ${x.amt} g of ${x.name}`);
        if (foodUnit(f) === 'ea' && x.amt > 8) o.absurd.push(`${d.name}@${tp}: ${x.amt} of ${x.name}`);
      }));
    }));
    // a bigger athlete must be given more food, not the same food
    const lo = scaleDay(REF_DAYS[0], 120, 1700), hi = scaleDay(REF_DAYS[0], 200, 2800);
    o.monotonic = hi.p > lo.p && hi.kcal > lo.kcal;
    o.hasFasting = REF_DAYS.some(d => /16:8/.test(d.name));
    o.hasNoCook = REF_DAYS.some(d => /no-cook/i.test(d.name));
    // and every meal must be loggable in one tap
    const sc = scaledDays()[0];
    o.everyMealHasItems = sc.meals.every(m => m.items.length > 0);
    o.slots = ['Breakfast', 'Lunch', 'Dinner', 'Snack', '12:00', '16:00', '19:30', 'nonsense']
      .map(refSlotKey);
    return o;
  });
  t.eq('there are twenty-eight worked days — a month, not a week', days.n, 28);
  t.ok('every day is built from foods that exist', days.missing.length === 0, days.missing);
  t.ok('a day scaled to a target lands on that target', days.bad.length === 0, days.bad.slice(0, 8));
  t.ok('a day header is always the sum of its meals and its items', days.inconsistent.length === 0, days.inconsistent.slice(0, 6));
  t.ok('the scaler never produces an amount nobody would plate', days.absurd.length === 0, days.absurd.slice(0, 6));
  t.ok('a bigger target gets more food', days.monotonic, days);
  t.ok('one day is written for the 16:8 window', days.hasFasting, days);
  t.ok('one day needs no cooking', days.hasNoCook, days);
  t.ok('every meal can be logged in one tap', days.everyMealHasItems, days);
  t.eq('a slot name or a clock time both reach a real meal bucket', days.slots,
    ['b', 'l', 'd', 's', 'l', 'd', 'd', days.slots[7]]);

  // ---- the shop is the days ------------------------------------------------
  const shop = await page.evaluate(() => {
    const o = {};
    const flat = () => shopList().flatMap(([g, items]) => items.map(i => ({ ...i, g })));
    const used = new Set();
    scaledDays().forEach(d => d.meals.forEach(m => m.items.forEach(x => used.add(x.name))));
    const list = flat();
    o.covers = [...used].filter(n => !list.some(i => i.name === n));
    o.extra = list.filter(i => !used.has(i.name)).map(i => i.name);
    o.dupes = list.map(i => i.name).filter((n, i, a) => a.indexOf(n) !== i);
    o.noQty = list.filter(i => !(i.raw > 0)).map(i => i.name);
    // a shopping list has to be in the state the shop sells it in
    const rice = list.find(i => i.name === 'White rice, cooked');
    const cooked = scaledDays().reduce((a, d) => a + d.meals.reduce((b, m) =>
      b + m.items.filter(x => x.name === 'White rice, cooked').reduce((c, x) => c + x.amt, 0), 0), 0);
    o.riceIsDry = rice && rice.raw < cooked * 0.5 && /dry/.test(rice.qty);
    o.riceLabelDropsCooked = rice && !/cooked/i.test(rice.label);
    o.riceTickKeyIsFoodName = rice && rice.name === 'White rice, cooked';
    const chick = list.find(i => i.name === 'Chicken breast');
    o.chickenIsRaw = chick && /raw/.test(chick.qty) && chick.raw > cookedOf('Chicken breast');
    function cookedOf(n) {
      return scaledDays().reduce((a, d) => a + d.meals.reduce((b, m) =>
        b + m.items.filter(x => x.name === n).reduce((c, x) => c + x.amt, 0), 0), 0);
    }
    const spin = list.find(i => i.name === 'Spinach, cooked');
    o.spinachIsRaw = spin && /raw/.test(spin.qty) && spin.raw > cookedOf('Spinach, cooked');
    // an untouched food is bought as-is
    const cot = list.find(i => i.name === 'Cottage cheese');
    o.plainFoodUnconverted = cot && Math.abs(cot.raw - Math.ceil(cookedOf('Cottage cheese') / 10) * 10) < 1 && !cot.note;
    // and the whole list moves when the target does
    const before = flat().reduce((a, i) => a + i.raw, 0);
    const kt = STATE.nutrition.kcalTarget, w = STATE.nutrition.weightKg;
    STATE.nutrition.weightKg = 115; STATE.nutrition.kcalTarget = 3000;
    STATE.measurements = [{ date: todayISO(), weight: 115, waist: 110 }];
    const after = flat().reduce((a, i) => a + i.raw, 0);
    STATE.nutrition.weightKg = w; STATE.nutrition.kcalTarget = kt;
    STATE.measurements = [{ date: todayISO(), weight: 88, waist: 96 }];
    o.movesWithTarget = after > before;
    o.groups = shopList().map(g => g[0]);
    return o;
  });
  t.ok('the shop buys everything the days use', shop.covers.length === 0, shop.covers);
  t.ok('the shop buys nothing the days do not use', shop.extra.length === 0, shop.extra);
  t.ok('nothing is on the list twice', shop.dupes.length === 0, shop.dupes);
  t.ok('every line has a quantity', shop.noQty.length === 0, shop.noQty);
  t.ok('rice is bought dry, not as the cooked weight the days eat', shop.riceIsDry, shop);
  t.ok('a converted line drops the state it was costed in', shop.riceLabelDropsCooked, shop);
  t.ok('the tick key stays the food name, not the shop label', shop.riceTickKeyIsFoodName, shop);
  t.ok('chicken is bought raw', shop.chickenIsRaw, shop);
  t.ok('spinach is bought raw', shop.spinachIsRaw, shop);
  t.ok('a food that needs no conversion is bought as costed', shop.plainFoodUnconverted, shop);
  t.ok('the whole shop grows for a bigger athlete', shop.movesWithTarget, shop);
  t.eq('the shop is grouped by where you pick it up', shop.groups,
    ['Protein counter', 'Fresh', 'Fruit', 'Cupboard & freezer']);

  // ---- targets -------------------------------------------------------------
  const tgt = await page.evaluate(() => {
    const o = {};
    recalcKcalFromStored();
    const live = refTargets();
    o.usesLive = live.live && live.p === proteinTargetG() && live.kcal === STATE.nutrition.kcalTarget;
    const kt = STATE.nutrition.kcalTarget, ms = STATE.measurements;
    /* "Nothing known" now has to include the standing protein target as well.
       It is seeded once at boot, so clearing the weight alone no longer empties
       the protein side — proteinTargetG() answers from the stored number and
       refDefaults().p is never reached. The fallback is still live code (clear
       the target, log no weight); this block just has to build that state
       rather than assume it. */
    const pt = STATE.nutrition.proteinTarget;
    STATE.nutrition.kcalTarget = 0; STATE.measurements = []; STATE.nutrition.weightKg = 0;
    delete STATE.nutrition.proteinTarget;
    const fb = refTargets();
    o.fallsBack = !fb.live && fb.p === refDefaults().p && fb.kcal === refDefaults().kcal;
    let rendered = true;
    try { renderRef(); } catch (e) { rendered = false; }
    o.rendersWithNoTargets = rendered;
    o.saysHowToGetThem = /Calculate my targets/.test(document.querySelector('#v-ref').innerHTML);
    o.noNaN = !/NaN|undefined/.test(document.querySelector('#v-ref').innerHTML);
    STATE.nutrition.kcalTarget = kt; STATE.measurements = ms; STATE.nutrition.weightKg = 88;
    if (pt !== undefined) STATE.nutrition.proteinTarget = pt;
    recalcKcalFromStored();
    return o;
  });
  t.ok('the tab uses the athlete\'s live targets', tgt.usesLive, tgt);
  t.ok('with no targets set it falls back to the documented defaults', tgt.fallsBack, tgt);
  t.ok('it still renders with no targets at all', tgt.rendersWithNoTargets, tgt);
  t.ok('and says how to get them', tgt.saysHowToGetThem, tgt);
  t.ok('nothing renders as NaN or undefined', tgt.noNaN, tgt);

  // ---- the tab itself ------------------------------------------------------
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} go('ref'); });
  await page.waitForTimeout(150);
  const view = await page.evaluate(() => {
    const v = document.querySelector('#v-ref');
    return {
      exists: !!v,
      active: !!v && v.classList.contains('active'),
      onlyOneActive: document.querySelectorAll('.view.active').length === 1,
      foodRows: v.querySelectorAll('[onclick^="openFoodAmount"]').length,
      expectedRows: FOODS.length,
      mealButtons: v.querySelectorAll('[onclick^="logRefMeal"]').length,
      expectedMeals: REF_DAYS.reduce((a, d) => a + d.meals.length, 0),
      hasDays: /28 worked days/.test(v.innerHTML),
      hasShop: /The whole shop/.test(v.innerHTML),
      weekMarkers: (v.innerHTML.match(/>Week \d</g) || []).length,
      hasRules: /Getting to \d+ g/.test(v.innerHTML),
      quotesTarget: new RegExp(refTargets().p + ' g protein').test(v.innerHTML),
      navHasRef: !!document.querySelector('.nav button[data-tab="ref"]'),
      navCount: document.querySelectorAll('.nav button').length,
      tabVar: TAB,
    };
  });
  t.ok('the Reference view is mounted', view.exists, view);
  t.ok('it becomes the active view', view.active && view.tabVar === 'ref', view);
  t.ok('no other view is left active alongside it', view.onlyOneActive, view);
  t.eq('every food renders as a tappable row', view.foodRows, view.expectedRows);
  t.eq('every meal of every day gets a log button', view.mealButtons, view.expectedMeals);
  t.ok('the month of days renders', view.hasDays, view);
  t.ok('the shopping list renders', view.hasShop, view);
  /* Twenty-eight cards in a row is a wall. They are marked off in weeks so
     the tab stays navigable. */
  t.eq('and the days are marked off into four weeks', view.weekMarkers, 4);
  t.ok('the build rules render, headed by the athlete\'s own number', view.hasRules, view);
  t.ok('the tab states the target it is working to', view.quotesTarget, view);
  t.ok('the nav carries a Reference button', view.navHasRef, view);
  t.eq('the nav has six tabs', view.navCount, 6);

  // ---- filtering -----------------------------------------------------------
  const filt = await page.evaluate(() => {
    const o = {};
    /* Scoped to the rendered rows, not to the whole view — the shopping list
       further down legitimately names chicken whatever filter is selected. */
    const shown = () => [...document.querySelectorAll('#v-ref [onclick^="openFoodAmount"]')]
      .map(b => FOODS[+/openFoodAmount\((\d+)\)/.exec(b.getAttribute('onclick'))[1]]);
    setRefCat('fish');
    o.fishRows = shown().length;
    o.fishExpected = FOODS.filter(f => f[4] === 'fish').length;
    o.fishOnly = shown().every(f => f[4] === 'fish');
    o.tabMarkedOn = !!document.querySelector('#ref-cats button.on');
    setRefCat('veg');
    o.vegOnly = shown().every(f => f[4] === 'veg');
    o.vegRows = shown().length;
    o.vegExpected = FOODS.filter(f => f[4] === 'veg').length;
    setRefCat('all');
    o.allRows = shown().length;
    // the index in the handler must index FOODS, not the filtered view
    setRefCat('pad');
    const first = document.querySelector('#v-ref [onclick^="openFoodAmount"]');
    const idx = +/openFoodAmount\((\d+)\)/.exec(first.getAttribute('onclick'))[1];
    o.indexIsGlobal = FOODS[idx][4] === 'pad';
    o.labelMatches = first.textContent.includes(FOODS[idx][0]);
    setRefCat('all');
    return o;
  });
  t.eq('the fish filter shows exactly the fish', filt.fishRows, filt.fishExpected, filt);
  t.ok('the fish filter hides everything else', filt.fishOnly, filt);
  t.ok('the selected filter is marked', filt.tabMarkedOn, filt);
  t.eq('the veg filter shows exactly the veg', filt.vegRows, filt.vegExpected, filt);
  t.ok('the veg filter hides everything else', filt.vegOnly, filt);
  t.eq('clearing the filter restores every food', filt.allRows, food.count, filt);
  t.ok('a filtered row still carries its index into the full list', filt.indexIsGlobal, filt);
  t.ok('a filtered row is labelled with the food it will log', filt.labelMatches, filt);

  // ---- the amount sheet ----------------------------------------------------
  const sheet = await page.evaluate(() => {
    const o = {}, i = FOOD_BY_NAME['Cod'], cod = FOODS[i];
    nutToday().food = [];
    openFoodAmount(i);
    const inp = () => document.querySelector('#ref-amt');
    const out = () => document.querySelector('#ref-amt-out').textContent;
    o.opens = !!inp();
    o.defaultsToListedAmount = inp() && +inp().value === foodBase(cod);
    o.showsBaseProtein = /33g/.test(out());
    refSetAmt(300);
    o.recalcs = /66g/.test(out()) && /280/.test(out());
    o.showsAfterProtein = /still to eat after this/.test(out());
    o.showsAfterCalories = /Calories left after this/.test(out());
    // filling the gap must actually close it
    refSetAmt(foodBase(cod));
    refFillProtein();
    const need = proteinTargetG() - foodTotals().p;
    o.filled = +inp().value;
    o.fillCloses = Math.abs(foodAt(cod, o.filled).p - need) <= 3;
    // an amount that blows the calorie budget has to say so
    refSetAmt(3000);
    o.warnsOver = /over for the day/.test(out());
    // logging writes exactly what the sheet showed
    refSetAmt(200);
    const shown = foodAt(cod, 200);
    logFoodAmount();
    const last = nutToday().food[nutToday().food.length - 1];
    o.logged = last;
    o.logsWhatItShowed = last && last.p === shown.p && last.kcal === shown.kcal
      && last.c === shown.c && last.f === shown.f;
    o.logsTheAmount = last && /200 g/.test(last.name) && /Cod/.test(last.name);
    o.sheetClosed = !document.querySelector('#ref-amt');
    // and the tab's own "still to eat" moves because of it
    renderRef();
    o.remainingDropped = new RegExp('>' + (proteinTargetG() - shown.p) + 'g<')
      .test(document.querySelector('#v-ref').innerHTML);
    nutToday().food = [];
    // a food that cannot fill a gap says so rather than logging nothing
    openFoodAmount(FOOD_BY_NAME['Olive oil']);
    refFillProtein();
    o.oilRefuses = +document.querySelector('#ref-amt').value === foodBase(FOODS[FOOD_BY_NAME['Olive oil']]);
    try { closeSheet(); } catch (e) {}
    // an index that is not a food must be a no-op, not a thrown render
    let threw = false;
    try { openFoodAmount(9999); openFoodAmount(-1); logFoodFromList(9999); } catch (e) { threw = true; }
    o.badIndexSafe = !threw;
    try { closeSheet(); } catch (e) {}
    save();
    return o;
  });
  t.ok('tapping a food opens an amount sheet', sheet.opens, sheet);
  t.ok('it opens on the listed amount', sheet.defaultsToListedAmount, sheet);
  t.ok('it costs the listed amount correctly', sheet.showsBaseProtein, sheet);
  t.ok('changing the amount recalculates protein and calories', sheet.recalcs, sheet);
  t.ok('it says what is left to eat after this', sheet.showsAfterProtein && sheet.showsAfterCalories, sheet);
  t.ok('"fill my protein gap" actually closes the gap', sheet.fillCloses, sheet);
  t.ok('an amount that blows the calorie budget says so', sheet.warnsOver, sheet);
  t.ok('logging writes exactly the numbers the sheet showed', sheet.logsWhatItShowed, sheet);
  t.ok('the logged entry names the amount it was costed at', sheet.logsTheAmount, sheet);
  t.ok('the sheet closes once the food is logged', sheet.sheetClosed, sheet);
  t.ok('the tab\'s "still to eat" drops by what was logged', sheet.remainingDropped, sheet);
  t.ok('a food with no protein will not pretend to fill a protein gap', sheet.oilRefuses, sheet);
  t.ok('an index that is not a food is a no-op', sheet.badIndexSafe, sheet);

  // ---- logging a whole meal ------------------------------------------------
  const meal = await page.evaluate(() => {
    const o = {};
    nutToday().food = [];
    const d = scaledDays()[0], m = d.meals[0];
    logRefMeal(0, 0);
    const log = nutToday().food;
    o.count = log.length;
    o.expected = m.items.length;
    o.protein = log.reduce((a, x) => a + x.p, 0);
    o.expectedProtein = m.p;
    o.kcal = log.reduce((a, x) => a + x.kcal, 0);
    o.expectedKcal = m.kcal;
    o.slotIsBreakfast = log.every(x => x.meal === 'b');
    o.namesCarryAmounts = log.every(x => /\d/.test(x.name));
    o.separateLines = new Set(log.map(x => x.name)).size === log.length;
    // the dinner of a 16:8 day is timed, not named — it must still bucket right
    nutToday().food = [];
    logRefMeal(5, 2);
    o.timedSlot = nutToday().food.every(x => x.meal === 'd');
    nutToday().food = [];
    let threw = false;
    try { logRefMeal(99, 0); logRefMeal(0, 99); } catch (e) { threw = true; }
    o.badIndexSafe = !threw && nutToday().food.length === 0;
    save();
    return o;
  });
  t.eq('logging a meal writes one line per item', meal.count, meal.expected, meal);
  t.eq('the logged protein is what the meal claimed', meal.protein, meal.expectedProtein, meal);
  t.eq('the logged calories are what the meal claimed', meal.kcal, meal.expectedKcal, meal);
  t.ok('a named slot lands in the right meal bucket', meal.slotIsBreakfast, meal);
  t.ok('a clock-timed slot lands in the right meal bucket too', meal.timedSlot, meal);
  t.ok('each item stays its own editable line', meal.separateLines, meal);
  t.ok('every logged line names the amount', meal.namesCarryAmounts, meal);
  t.ok('a day or meal that does not exist logs nothing', meal.badIndexSafe, meal);

  // ---- the shopping ticks persist -----------------------------------------
  const ticks = await page.evaluate(() => {
    const o = {};
    STATE.shopTicks = {}; renderRef();
    const key = shopList()[0][1][0].name;
    toggleShop(key);
    o.set = !!shopTicks()[key];
    o.saved = !!JSON.parse(localStorage.getItem('coreforge.v1')).shopTicks[key];
    o.countShown = /1\/\d+/.test(document.querySelector('#v-ref').innerHTML);
    o.resetOffered = /clearShop\(\)/.test(document.querySelector('#v-ref').innerHTML);
    toggleShop(key);
    o.unset = !shopTicks()[key];
    o.resetHiddenWhenEmpty = !/clearShop\(\)/.test(document.querySelector('#v-ref').innerHTML);
    toggleShop(key); toggleShop(shopList()[1][1][0].name);
    clearShop();
    o.cleared = Object.keys(shopTicks()).length === 0;
    // the wrong type must be repaired, not crash the tab
    STATE.shopTicks = ['Chicken breast']; normalizeState();
    o.arrayRepaired = !Array.isArray(STATE.shopTicks) && typeof STATE.shopTicks === 'object';
    STATE.shopTicks = 'nope'; normalizeState();
    o.stringRepaired = typeof STATE.shopTicks === 'object' && !Array.isArray(STATE.shopTicks);
    STATE.shopTicks = 'nope';
    o.readerFailsSafe = JSON.stringify(shopTicks()) === '{}';
    let rendered = true;
    try { renderRef(); } catch (e) { rendered = false; }
    o.rendersAfterCorrupt = rendered;
    normalizeState(); save();
    return o;
  });
  t.ok('a tick registers', ticks.set, ticks);
  t.ok('a tick is written to storage, not just to the screen', ticks.saved, ticks);
  t.ok('the header counts what is ticked', ticks.countShown, ticks);
  t.ok('a reset is offered once something is ticked', ticks.resetOffered, ticks);
  t.ok('tapping again unticks it', ticks.unset, ticks);
  t.ok('no reset button is offered on an empty list', ticks.resetHiddenWhenEmpty, ticks);
  t.ok('reset clears every tick', ticks.cleared, ticks);
  t.ok('an array where the ticks belong is repaired', ticks.arrayRepaired, ticks);
  t.ok('a string where the ticks belong is repaired', ticks.stringRepaired, ticks);
  t.ok('the tick reader fails to empty, never to a string', ticks.readerFailsSafe, ticks);
  t.ok('the tab still renders after a corrupt tick value', ticks.rendersAfterCorrupt, ticks);

  // ---- routing -------------------------------------------------------------
  /* Getting a clean read on the deep link took three goes, and both dead ends
     are worth keeping written down.

     A hash-only goto is a same-document navigation: the page never reloads,
     boot() never re-reads the hash, and the check passes against whatever tab
     was already open. So it has to be a real navigation.

     But a reload is not enough either, because closeSheet() calls
     history.back() and history.back() is ASYNCHRONOUS. The sheet blocks above
     leave a back navigation queued; it lands after `location.hash = 'ref'` and
     reverts the URL, so the reload loads without the hash and the tab comes up
     on Today. That is a hazard of driving the app faster than a thumb can, not
     an app defect — but it made this check fail on CI while passing here.

     Navigating out to about:blank and back in makes the URL explicit and drops
     any queued history work. localStorage is per-origin, so the athlete
     survives the round trip. */
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} go('today'); save(); });
  await page.waitForTimeout(500);
  await page.goto('about:blank');
  await page.goto(`http://127.0.0.1:${port}/#ref`, { waitUntil: 'domcontentloaded' });
  /* And wait on the condition, not on a stopwatch: boot() awaits idbOpen() and
     load() before it reads the hash, so neither 'networkidle' nor a fixed sleep
     tells you it has finished. */
  let booted = true;
  try {
    await page.waitForFunction(
      () => typeof TAB !== 'undefined' && TAB === 'ref' && !!document.querySelector('#v-ref.active'),
      null, { timeout: 15000 });
  } catch (e) { booted = false; }
  const routed = await page.evaluate(() => ({
    tab: TAB,
    active: !!document.querySelector('#v-ref.active'),
    rendered: (document.querySelector('#v-ref') || {}).innerHTML.length > 2000,
  }));
  t.ok('a #ref home-screen shortcut opens on the Reference tab', booted && routed.tab === 'ref' && routed.active, routed);
  t.ok('it is rendered by the time it is shown', routed.rendered, routed);

  // ---- the tab is not an injection path ------------------------------------
  /* importData() accepts arbitrary JSON, and shopTicks is part of that payload —
     a crafted key is a stored-XSS attempt against the origin holding the API keys. */
  await page.evaluate(() => {
    STATE.shopTicks = { '<img src=/nope onerror="window.__PWN2=1">': 1 };
    STATE.profile.name = '<img src=/nope onerror="window.__PWN2=1">';
    save(); go('ref');
  });
  await page.waitForTimeout(200);
  const inj = await page.evaluate(() => ({
    executed: !!window.__PWN2,
    raw: /<img src=\/nope/.test(document.querySelector('#v-ref').innerHTML),
  }));
  t.ok('a crafted tick key never executes', !inj.executed, inj);
  t.ok('a crafted tick key never reaches the DOM as markup', !inj.raw, inj);

  await browser.close(); srv.close();
  return t.finish(errors);
}
