/* Diet and meal-count repair.

   `if(!STATE.nutrition.diet)` was a truthiness test standing in for a
   membership test. It caught '' and null and undefined and nothing else, so
   any other string survived — and dietOk() asks `r.ok.includes(d)`, which no
   recipe answers for a diet that is not in the list. An unrecognised diet
   therefore made every food in the library forbidden: zero recipes passed the
   filter, dietLabel() rendered "undefined", and validateData() reported 168
   problems, every reference day scaling to 0 g and 0 kcal. Nothing threw.

   `if(!STATE.nutrition.meals)` was the same mistake with a quieter symptom:
   the string '4' walked through, mealSlots() compares `=== 4`, and the athlete
   silently lost their snack slot.

   Everything here runs the BOOT path — planting a value straight into STATE
   proves nothing about a repair that only runs in normalizeState(). */
import { serve, launch, suite, waitForBoot, ATHLETE } from './lib/harness.mjs';

const JUNK = ['kosher', 'Vegan', 'veg', 'omnivore ', 'true', '{}', '7'];
const ABSENT = [['empty string', ''], ['null', null], ['undefined', undefined]];

export default async function run() {
  const t = suite('diet & meal repair');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);

  /* ---- an unrecognised diet is repaired, flagged, and leaves food edible -- */
  for (const junk of JUNK) {
    await page.evaluate(([d, seed]) => {
      eval(seed)();
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      cur.nutrition = cur.nutrition || {}; cur.nutrition.diet = d;
      localStorage.setItem('coreforge.v1', JSON.stringify(cur));
    }, [junk, ATHLETE]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const r = await page.evaluate(() => {
      const logs = []; const orig = console.error;
      console.error = (...a) => logs.push(a.join(' ').slice(0, 120));
      try { validateData(); } catch (e) { logs.push('THREW ' + e); }
      console.error = orig;
      return { diet: STATE.nutrition.diet, flag: STATE.nutrition.dietRepaired === true,
        label: String(dietLabel()), allowed: (RECIPES || []).filter(x => dietOk(x)).length,
        validator: logs };
    });
    t.eq(`[${junk}] is repaired to a diet the food list knows`, r.diet, 'vegan');
    t.ok(`[${junk}] leaves the athlete with food they can actually eat`, r.allowed > 0, r);
    t.ok(`[${junk}] never renders as "undefined"`, r.label !== 'undefined', r);
    t.ok(`[${junk}] keeps the validator at zero problems`, r.validator.length === 0, r.validator);
    t.ok(`[${junk}] is flagged so the athlete is asked to re-pick`, r.flag, r);
  }

  /* ---- an ABSENT diet is the ordinary fresh install, not a repair -------- */
  for (const [label, v] of ABSENT) {
    await page.evaluate(([d, seed]) => {
      eval(seed)();
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      cur.nutrition = cur.nutrition || {};
      if (d === '__undef__') delete cur.nutrition.diet; else cur.nutrition.diet = d;
      localStorage.setItem('coreforge.v1', JSON.stringify(cur));
    }, [v === undefined ? '__undef__' : v, ATHLETE]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const r = await page.evaluate(() => {
      go('fuel'); renderFuel(); go('guide'); renderGuide();
      return { diet: STATE.nutrition.diet, flag: STATE.nutrition.dietRepaired,
        warns: /Check your diet setting/.test(document.querySelector('#v-fuel').innerText)
            || /Check your diet setting/.test(document.querySelector('#v-guide').innerText) };
    });
    t.eq(`[diet ${label}] falls back to omnivore`, r.diet, 'omnivore');
    t.eq(`[diet ${label}] is NOT flagged — nothing was guessed at`, r.flag, undefined);
    t.ok(`[diet ${label}] shows no warning to a fresh athlete`, !r.warns, r);
  }

  /* ---- the prompt appears where the athlete can act on it ---------------- */
  {
    await page.evaluate(([seed]) => {
      eval(seed)();
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      cur.nutrition.diet = 'kosher';
      localStorage.setItem('coreforge.v1', JSON.stringify(cur));
    }, [ATHLETE]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const r = await page.evaluate(() => {
      go('fuel'); renderFuel(); go('guide'); renderGuide();
      return { fuel: /Check your diet setting/.test(document.querySelector('#v-fuel').innerText),
        settings: /Check your diet setting/.test(document.querySelector('#v-guide').innerText) };
    });
    t.ok('the Fuel tab says the diet was not recognised', r.fuel, r);
    t.ok('and so does the picker in Settings', r.settings, r);
    const after = await page.evaluate(() => {
      setDiet('halal');
      const o = { diet: STATE.nutrition.diet, flag: STATE.nutrition.dietRepaired };
      go('guide'); renderGuide();
      o.stillWarns = /Check your diet setting/.test(document.querySelector('#v-guide').innerText);
      setDiet('kosher');              // the picker is the only writer — junk must bounce
      o.afterJunk = STATE.nutrition.diet;
      return o;
    });
    t.eq('picking a real diet stores it', after.diet, 'halal');
    t.eq('and clears the flag entirely', after.flag, undefined);
    t.ok('so the prompt stops showing', !after.stillWarns, after);
    t.eq('setDiet refuses a key that is not a diet', after.afterJunk, 'halal');
  }

  /* ---- a stale flag riding in on a backup must clear at boot -------------
     The other flag checks all go through a branch that clears it for its own
     reasons — the absent-diet default, or setDiet(). Neither exercises the
     one that matters in practice: an old backup carrying dietRepaired:true
     next to a diet that is perfectly valid. Without this block, deleting the
     clear-on-valid branch entirely left the suite green. */
  for (const diet of ['halal', 'omnivore', 'vegan']) {
    await page.evaluate(([d, seed]) => {
      eval(seed)();
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      cur.nutrition.diet = d; cur.nutrition.dietRepaired = true;   // stale, from an older save
      localStorage.setItem('coreforge.v1', JSON.stringify(cur));
    }, [diet, ATHLETE]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const r = await page.evaluate(() => {
      go('fuel'); renderFuel(); go('guide'); renderGuide();
      return { diet: STATE.nutrition.diet, flag: STATE.nutrition.dietRepaired,
        warns: /Check your diet setting/.test(document.querySelector('#v-fuel').innerText)
            || /Check your diet setting/.test(document.querySelector('#v-guide').innerText) };
    });
    t.eq(`[stale flag on ${diet}] the athlete's real diet is left alone`, r.diet, diet);
    t.eq(`[stale flag on ${diet}] the stale flag is gone from STATE`, r.flag, undefined);
    t.ok(`[stale flag on ${diet}] and no warning is shown`, !r.warns, r);
  }

  /* ---- no diet the picker offers may starve the athlete ------------------ */
  {
    const r = await page.evaluate(() => DIET_OPTS.map(([k, label]) => {
      STATE.nutrition.diet = k;
      return { k, label, allowed: (RECIPES || []).filter(x => dietOk(x)).length };
    }));
    await page.evaluate(() => { STATE.nutrition.diet = 'omnivore'; });
    r.forEach(d => t.ok(`${d.label} has food in the library (${d.allowed} recipes)`, d.allowed > 0, d));
    t.eq('the picker offers exactly the diets the validator knows', r.length, 5);
  }

  /* ---- meals is a count, not a truthy value ------------------------------ */
  for (const [stored, want] of [['4', 4], [4, 4], ['three', 3], [3, 3], [0, 3], [null, 3], [9, 4], [-1, 3]]) {
    await page.evaluate(([m, seed]) => {
      eval(seed)();
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      cur.nutrition.meals = m;
      localStorage.setItem('coreforge.v1', JSON.stringify(cur));
    }, [stored, ATHLETE]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const r = await page.evaluate(() => ({ stored: STATE.nutrition.meals,
      type: typeof STATE.nutrition.meals, slots: mealSlots().length }));
    t.eq(`meals ${JSON.stringify(stored)} becomes ${want}`, r.stored, want);
    t.eq(`meals ${JSON.stringify(stored)} is stored as a number`, r.type, 'number');
    t.eq(`meals ${JSON.stringify(stored)} plans ${want} slots`, r.slots, want);
  }

  /* ---- the meal plan is sized to the target, and follows when it moves ----
     dietOk() catches a diet or an allergen change because those make the stored
     recipes themselves illegal. A calorie target does not: the recipes stay
     edible, they are just sized to a number the athlete has replaced. So
     "Calculate my targets" moved the header +750 kcal and left the same three
     meals under it. Asserted on the PLAN — the recipe ids actually rendered —
     not on the stamp that drives the rebuild. */
  {
    await page.evaluate(([seed]) => {
      eval(seed)();
      Object.assign(STATE.nutrition, { sex: 'male', age: 44, heightCm: 178, weightKg: 84,
        activity: 1.45, goal: 'shred', diet: 'omnivore', allergens: [], meals: 3 });
      delete STATE.nutrition.kcalAdj;
      recalcKcalFromStored(); STATE.nutrition.plan = null; save();
    }, [ATHLETE]);
    const r = await page.evaluate(() => {
      const o = {};
      /* Pinned while two DIFFERENT targets are compared: pickRecipe() draws at
         random from the closest three, so an unpinned comparison can find the
         same plan twice by luck and go green on a coin flip. Restored for the
         same-target read below, where the randomness is the point. */
      const _rand = Math.random; Math.random = () => 0;
      o.cutKcal = STATE.nutrition.kcalTarget;
      o.cutPlan = currentMealPlan().meals.join(',');
      setNutGoal('gain');                        // through the real control
      o.gainKcal = STATE.nutrition.kcalTarget;
      o.gainPlan = currentMealPlan().meals.join(',');
      STATE.nutrition.kcalTarget = o.cutKcal; STATE.nutrition.plan = null;
      o.freshCut = generateMealPlan().meals.join(',');
      STATE.nutrition.kcalTarget = o.gainKcal; STATE.nutrition.plan = null;
      o.freshGain = generateMealPlan().meals.join(',');

      /* A DISCRIMINATING pair, chosen because most pairs are not one. The
         whole-food pool is small, so with the draw pinned the closest recipe is
         the same across a wide calorie band: lose (2020), shred (1910) and gain
         (2770) all draw an identical plan. A stale-plan bug is invisible
         between any two of those. 1600 against 2770 moves the dinner slot, and
         the guard below fails loudly if that ever stops being true. */
      const draw = k => { STATE.nutrition.kcalTarget = k; STATE.nutrition.plan = null;
        return generateMealPlan().meals.join(','); };
      o.lowFresh = draw(1600); o.highFresh = draw(2770);
      STATE.nutrition.kcalTarget = 1600;     // moved UNDER a plan built for 2770
      o.afterDrop = currentMealPlan().meals.join(',');

      /* Slot count, with the CALORIE TARGET HELD STILL. Changing both at once
         confounds them: a stamp that had dropped mealSlots() still rebuilt on
         the calorie change, produced four slots, and the mutant walked through.
         One variable at a time, or the check measures the other one. */
      STATE.nutrition.kcalTarget = 2200; STATE.nutrition.plan = null;
      o.threeSlots = currentMealPlan().meals.length;
      STATE.nutrition.meals = 4;                  // and NOTHING else
      o.fourSlots = currentMealPlan().meals.length;
      STATE.nutrition.meals = 3;

      /* Whole-food-only, likewise alone. toggleWholeFood() regenerates the plan
         itself, so the only way this reaches a stored plan is a route that does
         not — a restored backup, which is exactly what importData() accepts.

         The library holds exactly two non-whole recipes, a breakfast smoothie
         and a protein shake, and with the draw pinned neither is the closest
         option at an ordinary target: swept across 1100-3400 kcal on three
         diets, a THREE-meal day never differs at all. It takes the snack slot
         at 1400 kcal to separate the two pools, so that is where this runs. */
      STATE.nutrition.meals = 4; STATE.nutrition.kcalTarget = 1400;
      STATE.nutrition.wholeFoodOnly = false; STATE.nutrition.plan = null;
      o.looseFresh = currentMealPlan().meals.join(',');
      STATE.nutrition.wholeFoodOnly = true;       // as an import would leave it
      o.afterWhole = currentMealPlan().meals.join(',');
      STATE.nutrition.plan = null;
      o.wholeFresh = currentMealPlan().meals.join(',');
      STATE.nutrition.meals = 3;

      STATE.nutrition.kcalTarget = 1600; STATE.nutrition.plan = null;
      go('fuel'); renderFuel();
      o.rendered = STATE.nutrition.plan.meals.join(',');
      o.renderedStamp = STATE.nutrition.plan.stamp;
      Math.random = _rand;
      /* Twice through with NOTHING changed between: a plan that rebuilds on
         every read is not a fix, it is a different bug — the athlete would get
         new meals on every repaint. Unpinned, so a rebuild shows up as a
         different draw rather than the same one. */
      o.stored = STATE.nutrition.plan.meals.join(',');   // read BEFORE, or a rebuild hides itself
      o.again = currentMealPlan().meals.join(',');
      return o;
    });
    t.ok('the goal switch really moved the target', r.gainKcal - r.cutKcal > 500, r);
    t.eq('the plan on the cut is the one that target builds', r.cutPlan, r.freshCut);
    t.eq('and after the switch it is the one the NEW target builds', r.gainPlan, r.freshGain);
    t.ok('guard: 1600 and 2770 really do draw different plans — most pairs do not',
      r.lowFresh !== r.highFresh, r);
    t.eq('a target dropped under a built plan replaces it', r.afterDrop, r.lowFresh);
    t.eq('a second read of an unchanged plan returns the same meals',
      r.again, r.stored);
    t.eq('guard: three meals a day plans three slots', r.threeSlots, 3);
    t.eq('switching to 4 meals a day plans 4 slots today, not tomorrow', r.fourSlots, 4);
    t.ok('guard: the whole-food filter really changes the draw at this target',
      r.looseFresh !== r.wholeFresh, r);
    t.eq('a whole-food flag restored from a backup rebuilds the plan',
      r.afterWhole, r.wholeFresh);
    t.ok('the Fuel tab rebuilds against a target changed under it', r.rendered !== r.gainPlan, r);
    t.ok('and stamps what it was built from', /^1600\|/.test(r.renderedStamp || ''), r);
  }
  {
    /* _recipePlanHTML() kept its own copy of the freshness rule, and the copy
       had drifted — date and non-empty only, no _planStillValid(). renderFuel()
       primes with currentMealPlan() before building any markup, so the copy is
       unreachable from there, which is exactly why nobody noticed. Call the
       builder DIRECTLY, the way the next caller will.

       Math.random is pinned so pickRecipe() takes the closest recipe rather
       than one of the closest three: without that, two different targets can
       draw the same plan by luck and the check passes on a coin flip. */
    const r = await page.evaluate(() => {
      const _rand = Math.random; Math.random = () => 0;
      try {
        STATE.nutrition.meals = 3; STATE.nutrition.kcalTarget = 1500;
        STATE.nutrition.plan = null;
        const built = currentMealPlan().meals.join(',');
        STATE.nutrition.kcalTarget = 3200;      // moved, and the plan NOT nulled
        const html = _recipePlanHTML();
        const after = STATE.nutrition.plan.meals.join(',');
        const kcalOf = ids => ids.split(',').map(i => (recipeById(i) || {}).kcal || 0)
          .reduce((a, b) => a + b, 0);
        return { built, after, builtK: kcalOf(built), afterK: kcalOf(after),
          drawn: (html.match(/id="mealplan"/g) || []).length };
      } finally { Math.random = _rand; }
    });
    t.ok('the plan markup builder rebuilds a plan sized to a replaced target',
      r.after !== r.built, r);
    t.ok('and the meals it draws are bigger, not merely different',
      r.afterK > r.builtK, r);
    t.eq('it still draws exactly one plan block', r.drawn, 1);
  }
  {
    // a pre-v218 plan carries no stamp: rebuilt once, not trusted forever
    const r = await page.evaluate(() => {
      const p = currentMealPlan();
      delete STATE.nutrition.plan.stamp;
      const before = p.meals.join(',');
      return { valid: _planStillValid(STATE.nutrition.plan), before,
        after: currentMealPlan().stamp };
    });
    t.ok('an unstamped plan left by an older build is not treated as fresh', !r.valid, r);
    t.ok('and reading it produces a stamped one', !!r.after, r);
  }

  /* ---- nutrition.days is three inputs, and had no type repair at all ------
     The food log, the water count and the habit ticks all live in this map. A
     backup with food:'chicken' threw inside foodTotals(), which is on the Fuel
     render path — and the error boundary retries THROUGH normalizeState(), so
     with no repair here the tab never came back. Every case below is asserted
     from the BOOT path, and on STATE rather than through a getter. */
  for (const [label, day, want] of [
    ['food is a string', { food: 'chicken' }, { food: 0 }],
    ['food is an object', { food: { a: 1 } }, { food: 0 }],
    ['food is an array holding null', { food: [null, { name: 'X', kcal: 10, p: 2 }] }, { food: 1 }],
    ['a food row has junk macros', { food: [{ name: 'X', kcal: 'lots', p: null, c: NaN }] }, { food: 1 }],
    ['a food row has a negative kcal', { food: [{ name: 'X', kcal: -500, p: 10 }] }, { food: 1 }],
    ['habits is a string', { habits: 'all', food: [] }, { food: 0 }],
    ['habits is an array', { habits: ['water'], food: [] }, { food: 0 }],
    ['water is a string', { water: '5', food: [] }, { food: 0 }],
    ['water is negative', { water: -3, food: [] }, { food: 0 }],
  ]) {
    await page.evaluate(([d, seed]) => {
      eval(seed)();
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      const today = new Date().toISOString().slice(0, 10);
      cur.nutrition.days = { [today]: d };
      localStorage.setItem('coreforge.v1', JSON.stringify(cur));
    }, [day, ATHLETE]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const r = await page.evaluate(() => {
      const o = {};
      const d = STATE.nutrition.days[new Date().toISOString().slice(0, 10)] || {};
      o.foodIsArray = Array.isArray(d.food);
      o.foodN = Array.isArray(d.food) ? d.food.length : -1;
      o.macrosFinite = Array.isArray(d.food) &&
        d.food.every(x => ['kcal', 'p', 'c', 'f'].every(k => typeof x[k] === 'number' && isFinite(x[k]) && x[k] >= 0));
      o.habitsObj = !!d.habits && typeof d.habits === 'object' && !Array.isArray(d.habits);
      o.waterNum = typeof d.water === 'number' && isFinite(d.water) && d.water >= 0;
      try { const tt = foodTotals(); o.totals = `${tt.kcal}/${tt.p}`; } catch (e) { o.totals = 'THREW ' + e.message; }
      try { go('fuel'); renderFuel(); o.fuel = 'ok'; } catch (e) { o.fuel = 'THREW ' + e.message; }
      o.boundary = /went wrong drawing/i.test(document.body.innerText);
      o.screen = /NaN|undefined/.test((document.querySelector('.view.active') || {}).innerText || '');
      // the three inputs, exercised for real
      try { toggleHabit('protein'); o.habitTook = STATE.nutrition.days[new Date().toISOString().slice(0, 10)].habits.protein === true; }
      catch (e) { o.habitTook = 'THREW ' + e.message; }
      try { const w0 = nutToday().water; logWater(1); o.waterStep = nutToday().water - w0; }
      catch (e) { o.waterStep = 'THREW ' + e.message; }
      try { const n0 = foodTotals().n; logFood('Probe', 100, 10, 0, 0, 'l'); o.logStep = foodTotals().n - n0; }
      catch (e) { o.logStep = 'THREW ' + e.message; }
      return o;
    });
    t.ok(`[${label}] the food log is an array`, r.foodIsArray, r);
    t.eq(`[${label}] ${want.food} row(s) survive`, r.foodN, want.food);
    t.ok(`[${label}] every macro is a finite number ≥ 0`, r.macrosFinite, r);
    t.ok(`[${label}] habits is a plain object`, r.habitsObj, r);
    t.ok(`[${label}] water is a number`, r.waterNum, r);
    t.eq(`[${label}] Fuel renders`, r.fuel, 'ok');
    t.ok(`[${label}] and not on the error boundary`, !r.boundary, r);
    t.ok(`[${label}] with no NaN on screen`, !r.screen, r);
    t.ok(`[${label}] ticking a habit still works`, r.habitTook === true, r);
    t.eq(`[${label}] one cup of water adds one cup`, r.waterStep, 1);
    t.eq(`[${label}] logging a food adds one row`, r.logStep, 1);
  }
  {
    // the container itself, and an entry that is not a day at all
    for (const [label, days] of [['days is an array', []], ['days is a string', 'none'],
      ['a day is a string', { '2026-01-01': 'rest' }], ['a day is null', { '2026-01-01': null }]]) {
      await page.evaluate(([d, seed]) => {
        eval(seed)();
        const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
        cur.nutrition.days = d;
        localStorage.setItem('coreforge.v1', JSON.stringify(cur));
      }, [days, ATHLETE]);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForBoot(page);
      const r = await page.evaluate(() => {
        const d = STATE.nutrition.days;
        let fuel = 'ok'; try { go('fuel'); renderFuel(); } catch (e) { fuel = 'THREW ' + e.message; }
        return { obj: !!d && typeof d === 'object' && !Array.isArray(d),
          entries: Object.values(d || {}).every(x => x && typeof x === 'object' && !Array.isArray(x)),
          fuel, boundary: /went wrong drawing/i.test(document.body.innerText) };
      });
      t.ok(`[${label}] days is a plain object`, r.obj, r);
      t.ok(`[${label}] and every entry left in it is a day`, r.entries, r);
      t.eq(`[${label}] Fuel renders`, r.fuel, 'ok');
      t.ok(`[${label}] not on the error boundary`, !r.boundary, r);
    }
  }
  {
    // a real day is left completely alone — a repair that eats good data is worse
    await page.evaluate(([seed]) => {
      eval(seed)();
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      cur.nutrition.days = { '2026-01-01': { water: 6, habits: { water: true, protein: false },
        food: [{ name: 'Chicken 200 g', kcal: 330, p: 62, c: 0, f: 7, meal: 'd', at: 1767225600000 }] } };
      localStorage.setItem('coreforge.v1', JSON.stringify(cur));
    }, [ATHLETE]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const r = await page.evaluate(() => STATE.nutrition.days['2026-01-01']);
    t.eq('a well-formed day survives the repair byte for byte', r,
      { water: 6, habits: { water: true, protein: false },
        food: [{ name: 'Chicken 200 g', kcal: 330, p: 62, c: 0, f: 7, meal: 'd', at: 1767225600000 }] });
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
