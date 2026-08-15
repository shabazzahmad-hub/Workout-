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

      /* Driven through currentMealPlan() directly, not `go('fuel'); renderFuel()`.
         Fuel used to prime the generator before building its plan card; v245
         removed the card and v246 removed the now-pointless priming call, so the
         render path no longer touches STATE.nutrition.plan at all and reading it
         back after a render finds null. The invariant under test is unchanged and
         still worth having — a stale plan rebuilds, a fresh one does not — it just
         belongs to the generator rather than to a renderer that no longer calls
         it. Asserting it through Fuel now would be asserting it through nothing. */
      STATE.nutrition.kcalTarget = 1600; STATE.nutrition.plan = null;
      o.rendered = currentMealPlan().meals.join(',');
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

  // ---- a hung Open Food Facts connection must give up, not hang forever -----
  /* A connection that ASSOCIATES and then never responds (gym wifi, a dead
     hotspot) never rejects on its own — sw.js already races page navigation
     against a timer for exactly this reason, but offSearch()/offBarcode() had
     no equivalent bound. `ms` is a real parameter (not a hardcoded 8000), so
     this test can pass a short one instead of waiting out the real default. */
  {
    await page.route('https://world.openfoodfacts.org/**', () => {});   // never fulfilled — a true hang, not a fast rejection
    const r = await page.evaluate(async () => {
      const t0 = Date.now();
      try { await offSearch('chicken', 300); return { threw: false }; }
      catch (e) { return { threw: true, ms: Date.now() - t0, msg: String(e.message || e) }; }
    });
    await page.unroute('https://world.openfoodfacts.org/**');
    t.ok('a hung request eventually rejects instead of hanging forever', r.threw, r);
    t.ok('and it gives up close to the requested timeout, not the browser\'s own TCP timeout', r.ms < 2000, r);
    t.ok('with a message that reads as a timeout, not a generic failure', /time/i.test(r.msg || ''), r);
  }

  /* ---- a hung Gemini connection must also give up, not hang forever (v253) -
     _geminiCall() reused fetchWithTimeout()'s bare 8000ms default — sized for
     a small JSON request, not an image upload plus model inference. Real,
     found by an athlete hitting "Screenshot import failed — timed out" on the
     very first live use of v253's larger, slower-to-upload screenshot path,
     though the same undersized bound already applied to the food-photo
     estimate too. Same hang-test technique as offSearch() above, with the
     same reasoning for why `ms` has to be a real parameter. */
  {
    await page.route('https://generativelanguage.googleapis.com/**', () => {});   // never fulfilled
    const r = await page.evaluate(async () => {
      const t0 = Date.now();
      try { await _geminiCall('gemini-2.5-flash', {}, 300); return { threw: false }; }
      catch (e) { return { threw: true, ms: Date.now() - t0, msg: String(e.message || e) }; }
    });
    await page.unroute('https://generativelanguage.googleapis.com/**');
    t.ok('a hung Gemini call eventually rejects instead of hanging forever', r.threw, r);
    t.ok('and gives up close to the requested timeout, not fetchWithTimeout\'s 8000ms default', r.ms < 2000, r);
    t.ok('with a message that reads as a timeout', /time/i.test(r.msg || ''), r);
  }
  {
    // the production default is real headroom (25s), not left at the 8s that
    // just failed in practice — checked as a value, not merely "is a number"
    const ms = await page.evaluate(() => {
      const src = _geminiCall.toString();
      const m = src.match(/ms\|\|(\d+)/);
      return m ? +m[1] : null;
    });
    t.ok('the production default is materially longer than the 8000ms that just failed', ms >= 20000, ms);
  }

  /* ---- the photo estimate's portion note (v245) ---------------------------
     The AI food photo now also returns a portion size ("about 6 oz (170 g)",
     "1 cup cooked", "2 slices"). It is free text a language model wrote, so it
     is both an injection path (importData accepts arbitrary JSON) and a shape
     hazard, and it must never cost the athlete the calorie estimate itself. */
  {
    const r = await page.evaluate(() => {
      const o = {};
      // the schema asks for it but does NOT require it — an estimate must still
      // land when the model omits the portion entirely. Lives in the SHARED
      // _visionEstimate() pipeline now (v253), not in estimateFoodFromImage
      // itself — both it and estimateFoodFromScreenshot route through it.
      const src = _visionEstimate.toString();
      o.inSchema = /portion:\{type:'STRING'\}/.test(src);
      /* The property is that PORTION is not required — not the exact
         contents of the list. v262 dropped 'protein' from required too:
         forcing it made the model refuse a percentage-only screenshot
         rather than answer in the form actually shown. */
      o.notRequired = /required:\[[^\]]*\]/.test(src) && !/required:\[[^\]]*portion/.test(src);

      // cleanPortion is the ONE copy of the rule; every site calls it
      o.clean = {
        str: cleanPortion('about 6 oz (170 g)'),
        obj: cleanPortion({}),          // String({}) would be "[object Object]"
        arr: cleanPortion(['6 oz']),
        num: cleanPortion(170),
        nul: cleanPortion(null),
        undef: cleanPortion(undefined),
        multiline: cleanPortion('about 6 oz\n(170 g)'),
        long: cleanPortion('x'.repeat(200)).length,
      };
      return o;
    });
    t.ok('the response schema asks the model for a portion', r.inSchema, r);
    t.ok('but does not require it — an omitted portion must not lose the whole estimate', r.notRequired, r);
    t.eq('a real portion string passes through intact', r.clean.str, 'about 6 oz (170 g)');
    t.eq('an object becomes empty, never the literal "[object Object]"', r.clean.obj, '');
    t.eq('and so does an array', r.clean.arr, '');
    t.eq('and a number — a portion is text, not a quantity to coerce', r.clean.num, '');
    t.eq('null is empty', r.clean.nul, '');
    t.eq('undefined is empty', r.clean.undef, '');
    t.eq('a newline collapses, so it cannot break the one-line diary row', r.clean.multiline, 'about 6 oz (170 g)');
    t.eq('and it is bounded', r.clean.long, 40);
  }
  {
    // it survives a real log → render → repair round trip, and is ESCAPED on the
    // way to innerHTML: importData() accepts arbitrary JSON, so a portion is
    // user-controlled content exactly like profile.name is
    const r = await page.evaluate(() => {
      const o = {};
      const day = nutToday(); day.food = [];
      logFood('Salmon', 340, 40, 0, 20, 'd', 'about 6 oz (170 g)');
      const row = nutToday().food[nutToday().food.length - 1];
      o.stored = row.portion;
      // a manual add writes NO portion key at all — an empty one on every row
      // would grow every backup for nothing
      logFood('Plain toast', 90, 3, 17, 1, 'b');
      o.manualHasKey = 'portion' in nutToday().food[nutToday().food.length - 1];

      go('fuel'); renderFuel();
      const txt = (document.querySelector('.view.active') || {}).innerText || '';
      o.onScreen = txt.includes('about 6 oz (170 g)');

      /* The sheet the athlete actually confirms against, driven exactly the way
         foodPhoto() drives it — the estimate object straight into openQuickAdd. */
      openQuickAdd({ name: 'Salmon', kcal: 340, p: 40, c: 0, f: 20, portion: 'about 6 oz (170 g)' });
      o.sheetShows = (document.querySelector('#sheet') || {}).innerText.includes('about 6 oz (170 g)');
      closeSheet();
      openQuickAdd({ name: 'Bad', kcal: 10, p: 1, c: 0, f: 0, portion: '<img src=y onerror=window.__pwn2=1>' });
      o.sheetInjected = !!document.querySelector('#sheet img[src="y"]');
      closeSheet();
      /* A plain manual add opened right after a photo estimate must not inherit
         the last one's portion — saveFood._portion is set on EVERY open for this
         reason, not only when a portion is present. */
      openQuickAdd();
      o.staleSheet = !!saveFood._portion;
      closeSheet();

      // XSS: a crafted portion must render as text, not as an element
      nutToday().food = [{ name: 'X', kcal: 10, p: 1, c: 0, f: 0, meal: 'b', at: Date.now(),
        portion: '<img src=x onerror=window.__pwn=1>' }];
      renderFuel();
      o.injected = !!document.querySelector('.view.active img[src="x"]');
      o.pwned = !!window.__pwn;
      return o;
    });
    t.eq('a photo-logged portion is stored on the entry', r.stored, 'about 6 oz (170 g)');
    t.ok('the log sheet shows it before the athlete saves — the first surface after a snap', r.sheetShows, r);
    t.ok('and escapes it there too', !r.sheetInjected, r);
    t.ok('a sheet opened without one does not carry a stale portion from the last snap', !r.staleSheet, r);
    t.eq('a manual add writes no portion key at all', r.manualHasKey, false);
    t.ok('the portion shows in the food diary', r.onScreen, r);
    t.ok('a crafted portion never becomes a real element', !r.injected, r);
    t.ok('and its payload never runs', !r.pwned, r);
  }
  {
    // normalizeState repairs it across a real boot, like every other field in
    // the row — and a junk portion must not cost the athlete the meal
    await page.evaluate(([seed]) => {
      eval(seed)();
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      cur.nutrition.days = { '2026-02-02': { water: 3, habits: {},
        food: [{ name: 'Steak', kcal: 500, p: 50, c: 0, f: 30, meal: 'd', at: 1770000000000, portion: { oz: 8 } },
               { name: 'Rice', kcal: 200, p: 4, c: 45, f: 0, meal: 'd', at: 1770000000000, portion: '  1 cup\n cooked  ' }] } };
      localStorage.setItem('coreforge.v1', JSON.stringify(cur));
    }, [ATHLETE]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const r = await page.evaluate(() => {
      const f = (STATE.nutrition.days['2026-02-02'] || {}).food || [];
      return { n: f.length, first: f[0], second: f[1] };
    });
    t.eq('a junk portion does not drop the row — the meal is the record, not the note', r.n, 2);
    t.eq('the bad portion is gone rather than stringified', 'portion' in (r.first || {}), false);
    t.eq('and the rest of that row is untouched', r.first && r.first.kcal, 500);
    t.eq('a messy but real portion is cleaned, not discarded', r.second && r.second.portion, '1 cup cooked');
  }

  /* ---- importing a screenshot from another tracker (v253) -----------------
     Requested directly: the athlete tracks macros in a separate app (Lose It)
     and wants that number carried into CoreForge without retyping it.
     foodPhoto() ESTIMATES from a photo of food; foodScreenshot() TRANSCRIBES
     numbers already on screen — same Gemini plumbing (_visionEstimate), a
     different prompt, and it must not force the camera open the way a food
     photo does, since the screenshot already exists in the photo library. */
  {
    const r = await page.evaluate(() => {
      const o = {};
      const imgSrc = estimateFoodFromImage.toString();
      const shotSrc = estimateFoodFromScreenshot.toString();
      // both route through the ONE shared pipeline — drift protection, not two
      // copies of the model-fallback/JSON-parse/clamp logic
      o.imgSharesPipeline = /_visionEstimate\(/.test(imgSrc);
      o.shotSharesPipeline = /_visionEstimate\(/.test(shotSrc);
      // but the prompts are genuinely different — an estimate task vs a read task
      o.imgSaysEstimate = /Estimate the nutrition/i.test(imgSrc);
      /* The property, not one exact sentence: the screenshot prompt must tell
         the model to READ and must forbid estimating. Pinned to a single
         phrase before, which broke when the prompt was reworded in v255 for
         a reason that had nothing to do with this rule still holding. */
      o.shotSaysRead = /\bREAD\b/.test(shotSrc) &&
        /not to estimate|do NOT estimate|do NOT recalculate/i.test(shotSrc);
      o.shotMentionsTrackers = /nutrition-tracking app/i.test(shotSrc);

      // the file-picker wiring: foodPhoto() forces the camera, foodScreenshot()
      // must not — the screenshot already exists in the photo library
      const photoSrc = foodPhoto.toString();
      const shotFnSrc = foodScreenshot.toString();
      o.photoForcesCamera = /capture['"]?,\s*['"]environment/.test(photoSrc) || /setAttribute\('capture','environment'\)/.test(photoSrc);
      o.screenshotDoesNotForceCamera = !/capture/.test(shotFnSrc);

      return o;
    });
    t.ok('estimateFoodFromImage and estimateFoodFromScreenshot share one pipeline', r.imgSharesPipeline && r.shotSharesPipeline, r);
    t.ok('the food-photo prompt asks the model to estimate', r.imgSaysEstimate, r);
    t.ok('the screenshot prompt asks the model to read, not estimate', r.shotSaysRead, r);
    t.ok('and names what kind of screenshot it expects', r.shotMentionsTrackers, r);
    t.ok('foodPhoto() opens the camera directly', r.photoForcesCamera, r);
    t.ok('foodScreenshot() does not — it needs the photo library, not the camera', r.screenshotDoesNotForceCamera, r);
    /* The behavioural checks below prove _screenshotUnusable() itself is
       correct in isolation — they cannot prove foodScreenshot() actually
       CALLS it before opening the sheet, since driving a real file-picker
       through a dynamically-created, never-attached <input type=file> has no
       established pattern in this suite. A source check on the wiring closes
       that gap; confirmed it can fail by deleting the guard call and rerunning. */
    const wired = await page.evaluate(() => /_screenshotUnusable\(est\)/.test(foodScreenshot.toString()));
    t.ok('foodScreenshot() actually calls the guard on the estimate it received', wired);
  }
  /* ---- a screenshot must reach the model still legible (v255) -------------
     Reported live: the import got past v254's timeout and then failed with
     "could not find clear numbers." The cause was in image PREPARATION, not
     the model — _downscale() bounds the LONG edge, so a portrait phone
     capture (1179x2556) sent at max 1280 arrived 590 wide, halving the
     horizontal resolution the text lives in, and JPEG q0.8 lays its ringing
     artifacts exactly on the sharp edges that make a digit a digit. Measured
     on a real canvas, not asserted from the source. */
  {
    const r = await page.evaluate(async () => {
      const o = {};
      // a portrait "screenshot" with real text on it — a flat fill would
      // compress identically at any quality and prove nothing about q
      const c = document.createElement('canvas');
      c.width = 1179; c.height = 2556;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#000'; x.font = '28px sans-serif';
      for (let i = 0; i < 40; i++) x.fillText('Protein 41 g · Carbs 58 g · 620 kcal', 40, 80 + i * 60);
      const src = c.toDataURL('image/png');
      const dims = async (max, q) => {
        const du = await _downscale(src, max, q);
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = du; });
        return { w: img.width, h: img.height, bytes: du.length };
      };
      o.old = await dims(1280);          // what the screenshot path used to send
      o.now = await dims(2048, 0.92);    // what it sends after the fix
      o.photo = await dims(768);         // the food-photo path, unchanged
      // quality is a real knob, not an ignored argument
      const lo = await dims(2048, 0.4);
      o.qualityMatters = o.now.bytes > lo.bytes * 1.3;
      // the default must stay 0.8 so the food-photo path is byte-identical
      const defaulted = await dims(2048);
      const explicit = await dims(2048, 0.8);
      o.defaultIsStill08 = defaulted.bytes === explicit.bytes;
      return o;
    });
    t.ok('the old 1280 long-edge cap really did crush a portrait screenshot\'s width', r.old.w < 640, r.old);
    t.ok('the screenshot path now keeps materially more horizontal resolution', r.now.w > r.old.w * 1.5, r);
    t.ok('and that is where the text lives, so it is the number that matters', r.now.w >= 900, r.now);
    t.ok('quality is honoured, not an ignored parameter', r.qualityMatters, r);
    t.ok('the default stays 0.8 — the food-photo path must be unchanged', r.defaultIsStill08, r);
    t.eq('and the food photo still goes at its own 768 cap', r.photo.h, 768);
    const wiring = await page.evaluate(() => ({
      shot: /_downscale\(rd\.result,2048,0\.92\)/.test(foodScreenshot.toString()),
      photo: /_downscale\(rd\.result,768\)/.test(foodPhoto.toString()),
    }));
    t.ok('foodScreenshot() actually asks for the higher-fidelity encode', wiring.shot, wiring);
    t.ok('and foodPhoto() is left exactly as it was', wiring.photo, wiring);
  }
  {
    // the shared clamp and the "don't guess" honesty case, driven through the
    // REAL pipeline with only the network call mocked — same technique this
    // file already uses nowhere else because nothing before this touched
    // _geminiCall, so the mock is scoped to this one block and restored after
    const r = await page.evaluate(async () => {
      const o = {}, real = window._geminiCall;
      const reply = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] });

      window._geminiCall = async () => reply({ name: 'Chicken bowl', kcal: 450, protein: 40, carbs: 35, fat: 12, portion: '1 bowl' });
      const clean = await estimateFoodFromScreenshot('data:image/png;base64,AA==');
      o.cleanPassesThrough = clean.kcal === 450 && clean.p === 40 && clean.c === 35 && clean.f === 12;
      o.cleanUsable = !_screenshotUnusable(clean);

      // a macro that would out-calorie the food (protein*4 > kcal) is still
      // clamped on the screenshot path — proving the guard is genuinely
      // SHARED code, not a copy that only the photo path exercises
      window._geminiCall = async () => reply({ name: 'Odd reading', kcal: 100, protein: 100, carbs: 0, fat: 0 });
      const clamped = await estimateFoodFromScreenshot('data:image/png;base64,AA==');
      o.clampedOnScreenshotPath = clamped.p === 25;   // Math.round(100/4)

      // the model doing exactly what it was told — no clear numbers found
      window._geminiCall = async () => reply({ name: 'Unclear', kcal: 0, protein: 0, carbs: 0, fat: 0 });
      const blank = await estimateFoodFromScreenshot('data:image/png;base64,AA==');
      o.blankIsUnusable = _screenshotUnusable(blank);

      // the guard itself, directly — the real claim, not just "the pipeline
      // returned zeros", since a false positive here would open the log sheet
      // pre-filled with zeros that read as a deliberate zero-calorie entry
      o.guardTrueOnBothZero = _screenshotUnusable({ kcal: 0, p: 0 });
      o.guardFalseWithKcal = !_screenshotUnusable({ kcal: 120, p: 0 });
      o.guardFalseWithProtein = !_screenshotUnusable({ kcal: 0, p: 8 });

      window._geminiCall = real;
      return o;
    });
    t.ok('a well-formed screenshot reading passes through unchanged', r.cleanPassesThrough, r);
    t.ok('and is treated as usable', r.cleanUsable, r);
    t.ok('an impossible macro is clamped on the screenshot path too — shared code, not a fork', r.clampedOnScreenshotPath, r);
    t.ok('a kcal:0/protein:0 reply is treated as unusable, not a real zero-calorie food', r.blankIsUnusable, r);
    t.ok('the guard fires on both zero', r.guardTrueOnBothZero, r);
    t.ok('but not when either number is real', r.guardFalseWithKcal && r.guardFalseWithProtein, r);
  }
  {
    // the entry point actually reaches the athlete, on the real Fuel tab
    const r = await page.evaluate(() => {
      go('fuel'); renderFuel();
      const view = document.querySelector('#view-fuel') || document.querySelector('.view.active');
      return { hasImportButton: !!view.querySelector('[onclick^="foodScreenshot"]'),
        privacyMentionsScreenshot: /screenshot/i.test(privacyNoteHTML()) };
    });
    t.ok('a screenshot-import button is on the Fuel tab', r.hasImportButton, r);
    t.ok('the privacy note names the new outbound photo path, not just the old one', r.privacyMentionsScreenshot, r);
  }

  /* ---- a transient 503 must not cost the athlete the import (v257) -------
     Reported live, third distinct failure of the same feature: Google
     returned 503 "Spikes in demand are usually temporary. Please try again
     later" and the app gave up after one attempt per model — not taking
     advice the response body was literally giving it. Earlier in this session
     that was waved off as "nothing to fix, it is Google being busy," which
     was the wrong call: a 503 is the definition of retryable. */
  {
    const r = await page.evaluate(async () => {
      const o = {}, real = window._geminiCall;
      const good = { candidates: [{ content: { parts: [{ text: JSON.stringify(
        { name: 'Lunch', kcal: 620, protein: 41, carbs: 58, fat: 19 }) }] }, finishReason: 'STOP' }] };
      const boom = st => { const e = new Error('AI ' + st); e.status = st; throw e; };

      // 1. overloaded on every model for the first pass, fine on the second
      let calls = 0;
      window._geminiCall = async () => { calls++; if (calls <= 3) boom(503); return good; };
      let retried = 0;
      /* Caught rather than allowed to propagate: without the retry this
         rejects, and an uncaught rejection here fails the whole FILE with a
         stack instead of failing this check by name — a worse signal, and one
         that hides every assertion after it. Seeded and confirmed. */
      let est = null;
      try {
        est = await _visionEstimate('data:image/png;base64,AA==', 'p',
          { backoff: [0, 10, 20], onRetry: () => { retried++; } });
      } catch (e) { o.recoveryThrew = String(e.message || e); }
      o.recovered = !!est && est.kcal === 620;
      o.calls = calls;
      o.toldTheAthlete = retried > 0;

      // 2. a permanent error must NOT be retried — same message, three times
      //    slower, is worse than failing fast
      calls = 0;
      window._geminiCall = async () => { calls++; boom(404); };
      try { await _visionEstimate('data:image/png;base64,AA==', 'p', { backoff: [0, 10, 20] }); }
      catch (e) { o.permanentMsg = String(e.message || e); }
      o.permanentCalls = calls;   // 3 models x 1 pass, not x3 passes

      // 3. a key problem still fails immediately, before even finishing the list
      calls = 0;
      window._geminiCall = async () => { calls++; boom(403); };
      try { await _visionEstimate('data:image/png;base64,AA==', 'p', { backoff: [0, 10, 20] }); }
      catch (e) { o.keyMsg = String(e.message || e); }
      o.keyCalls = calls;

      // 4. genuinely persistent 503 gives up rather than looping forever
      calls = 0;
      window._geminiCall = async () => { calls++; boom(503); };
      try { await _visionEstimate('data:image/png;base64,AA==', 'p', { backoff: [0, 10, 20] }); }
      catch (e) { o.downStatus = e.status; }
      o.downCalls = calls;

      window._geminiCall = real;
      return o;
    });
    t.ok('a 503 that clears on the next pass produces a real estimate instead of an error', r.recovered, r);
    t.ok('and the athlete is told it is retrying rather than left staring at a pause', r.toldTheAthlete, r);
    t.eq('it retried the whole model list, not just one model', r.calls, 4);
    t.eq('a permanent 404 is tried once per model and not retried', r.permanentCalls, 3);
    t.eq('a key error fails on the first call, without trying the rest', r.keyCalls, 1);
    t.eq('a persistent outage gives up after the last pass', r.downCalls, 9);
    t.eq('and surfaces the transient status rather than swallowing it', r.downStatus, 503);
  }
  {
    // the message the athlete actually reads
    const r = await page.evaluate(() => {
      const mk = (st, msg) => { const e = new Error(msg || ('AI ' + st)); e.status = st; return e; };
      return {
        overloaded: _aiErrText(mk(503, 'AI 503 — This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.')),
        quota: _aiErrText(mk(429, 'AI 429')),
        plain: _aiErrText(new Error('no numbers found — try a screenshot showing the totals')),
        longNonTransient: _aiErrText(new Error('x'.repeat(400))),
      };
    });
    t.ok('an overload says what to do now, not Google\'s paragraph cut mid-word',
      /overloaded/i.test(r.overloaded) && !/Please try again late$/.test(r.overloaded), r);
    t.ok('and does not claim a quota problem it cannot know about', !/quota/i.test(r.overloaded), r);
    t.ok('a 429 is named as a quota problem, which is a different fix', /quota/i.test(r.quota), r);
    t.ok('a real diagnosable error keeps its own text', /no numbers found/.test(r.plain), r);
    t.ok('and a very long one is trimmed at a word boundary, not mid-word',
      r.longNonTransient.length <= 125 && r.longNonTransient.endsWith('…'), r);
  }

  /* ---- a timeout is retryable, and the TOTAL wait is bounded (v258) ------
     Fourth failure of the same feature on a real phone, and the fourth
     distinct cause: "timed out — check your connection". Two defects behind
     it. (a) fetchWithTimeout stamps status 0, which v257 did not count as
     transient — so the retry it had just added never fired for the single
     most common real failure. (b) With 3 models at 25s each and no overall
     budget, a stalled connection burned up to 75s before showing anything,
     and simply making timeouts retryable would have multiplied that instead
     of bounding it. Measured first rather than guessed: the screenshot
     payload is only ~197KB, so upload size was NOT the cause. */
  {
    const r = await page.evaluate(async () => {
      const o = {}, real = window._geminiCall;
      const good = { candidates: [{ content: { parts: [{ text: JSON.stringify(
        { name: 'Lunch', kcal: 620, protein: 41 }) }] }, finishReason: 'STOP' }] };
      const timeoutErr = () => { const e = new Error('timed out — check your connection'); e.status = 0; throw e; };

      o.timeoutIsTransient = _transientAIStatus(0);
      o.timeoutIsConnectionLevel = _connectionLevel(0);
      o.overloadIsNotConnectionLevel = !_connectionLevel(503);

      // a connection blip that clears on the retry must produce a real result
      let calls = 0;
      window._geminiCall = async () => { calls++; if (calls === 1) timeoutErr(); return good; };
      let est = null;
      try {
        est = await _visionEstimate('data:image/png;base64,AA==', 'p', { backoff: [0, 10, 20], ms: 50 });
      } catch (e) { o.blipThrew = String(e.message || e); }
      o.blipRecovered = !!est && est.kcal === 620;
      /* And it must NOT have burned the other two models first: a stalled
         connection is not a model problem, so the pass short-circuits. Call 1
         is the timeout, call 2 is the first model of the NEXT pass. */
      o.blipCalls = calls;

      // a persistently dead connection: bounded total, not 3 models x 3 passes
      calls = 0;
      window._geminiCall = async () => { calls++; timeoutErr(); };
      const t0 = Date.now();
      try { await _visionEstimate('data:image/png;base64,AA==', 'p', { backoff: [0, 10, 20], ms: 50, budget: 3000 }); }
      catch (e) { o.deadStatus = e.status; }
      o.deadMs = Date.now() - t0;
      o.deadCalls = calls;

      // the budget is a real ceiling even when every call is slow
      calls = 0;
      /* The mock must HONOUR the timeout it is handed, or the budget never
         bites: a mock that fails in 60ms finishes well inside any budget, so
         removing the budget entirely changes nothing and the check passes on
         a defect. Sleeping for the granted slice is what makes the clamp
         observable — without it slice is the full 3000ms ms, with it the
         slice is capped to what is left of the 500ms budget. */
      window._geminiCall = async (m, b, ms) => { calls++; await new Promise(r2 => setTimeout(r2, ms)); timeoutErr(); };
      const t1 = Date.now();
      try { await _visionEstimate('data:image/png;base64,AA==', 'p', { backoff: [0, 20, 40], ms: 3000, budget: 500 }); }
      catch (e) {}
      o.budgetedMs = Date.now() - t1;
      o.budgetedCalls = calls;

      window._geminiCall = real;
      return o;
    });
    t.ok('a timeout counts as transient, so the retry actually fires for it', r.timeoutIsTransient, r);
    t.ok('and is recognised as connection-level, not a model problem', r.timeoutIsConnectionLevel, r);
    t.ok('while a 503 is NOT connection-level — that one should try other models', r.overloadIsNotConnectionLevel, r);
    t.ok('a connection blip that clears on retry yields a real estimate', r.blipRecovered, r);
    t.eq('and it did not burn the other models on a connection failure', r.blipCalls, 2);
    t.eq('a dead connection still surfaces as a timeout', r.deadStatus, 0);
    t.ok('a dead connection is bounded by the budget, not 3 models x 3 passes',
      r.deadMs < 2500, r);
    t.eq('and makes ONE attempt per pass, not one per model per pass', r.deadCalls, 3);
    t.ok('a slow call is clamped to the remaining budget, not its own timeout',
      r.budgetedMs < 1500, r);
    t.ok('and it really did attempt the call rather than skipping it', r.budgetedCalls >= 1, r);
  }
  {
    // the message must not blame the athlete's wifi for Google being slow
    const r = await page.evaluate(() => {
      const e = new Error('timed out — check your connection'); e.status = 0;
      return { txt: _aiErrText(e) };
    });
    t.ok('a timeout message allows that the AI may simply be busy', /busy/i.test(r.txt), r);
    t.ok('and says it already retried', /retried/i.test(r.txt), r);
  }

  /* ---- the diagnostic, and a lighter-image fallback (v259) ---------------
     Fifth failure of the same feature, and the point at which patching blind
     stopped being defensible: four fixes were each diagnosed from ONE line of
     toast text, because nothing in the app reports what actually happened and
     the dev sandbox cannot reach Google at all. runAIDiagnostic() turns that
     into real numbers; the screenshot path also stops retrying the identical
     197KB payload when the failure is connection-level. */
  {
    const r = await page.evaluate(async () => {
      const o = {}, real = window._geminiCall;
      const keep = STATE.settings.foodAiKey;
      STATE.settings.foodAiKey = 'test-key';
      const okReply = t => ({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] });
      const boom = st => { const e = new Error('AI ' + st); e.status = st; throw e; };
      const read = () => (document.querySelector('#diagOut') || {}).innerText || '';

      // a dead connection must be named as the connection, not the key
      window._geminiCall = async () => boom(0);
      await runAIDiagnostic();
      o.dead = read();

      // a rejected key must be named as the key
      window._geminiCall = async () => boom(403);
      await runAIDiagnostic();
      o.badKey = read();

      // exhausted quota is its own diagnosis
      window._geminiCall = async () => boom(429);
      await runAIDiagnostic();
      o.quota = read();

      // text fine, image times out — the case the athlete actually hit
      let n = 0;
      window._geminiCall = async (m, b) => {
        const hasImage = JSON.stringify(b).includes('inline_data');
        n++; if (hasImage) boom(0); return okReply('OK');
      };
      await runAIDiagnostic();
      o.imageOnly = read();

      /* Everything healthy. The mock has to answer all THREE shapes the
         diagnostic now sends: a text ping, the tiny "what number is this"
         vision ping, and — since v263 — the real import self-test, which
         pushes a synthetic tracker card through estimateFoodFromScreenshot()
         and expects a parseable estimate back. A mock that returns "42" to
         every image made the self-test fail and the report say "something
         failed", which is the check doing its job on an incomplete fixture. */
      window._geminiCall = async (m, b) => {
        const body = JSON.stringify(b);
        if (!body.includes('inline_data')) return okReply('OK');
        if (/nutrition-tracking app/i.test(body))
          return okReply(JSON.stringify({ name: 'Today', kcal: 900, protein: 92, carbs: 76, fat: 25 }));
        return okReply('42');
      };
      await runAIDiagnostic();
      o.healthy = read();

      try { closeSheet(); } catch (e) {}
      window._geminiCall = real; STATE.settings.foodAiKey = keep;
      return o;
    });
    t.ok('a dead connection is diagnosed as the connection, not the key', /connection/i.test(r.dead) && !/key/i.test(r.dead.split('connection')[0] || ''), r.dead.slice(0, 200));
    /* NOT a bare /key/ test: the generic "every model is refusing" fallback
       also contains the word key ("not your phone or your key"), so a loose
       match passed against a mutant with the 403 branch deleted entirely.
       Assert the SPECIFIC diagnosis and that the wrong one is absent. */
    t.ok('a rejected key is diagnosed as the key, with the action to take',
      /rejected the/i.test(r.badKey) && /aistudio/i.test(r.badKey), r.badKey.slice(0, 250));
    t.ok('and is not mistaken for Google being overloaded', !/overloaded/i.test(r.badKey), r.badKey.slice(0, 250));
    t.ok('and names the status so it can be looked up', /403/.test(r.badKey), r.badKey.slice(0, 200));
    t.ok('an exhausted quota is called out as quota, not a broken key', /quota/i.test(r.quota), r.quota.slice(0, 200));
    t.ok('text-works-but-images-fail is distinguished from a total outage',
      /images? time out|too slow to upload/i.test(r.imageOnly), r.imageOnly.slice(0, 250));
    t.ok('and a healthy setup says so plainly', /Everything works/i.test(r.healthy), r.healthy.slice(0, 200));
    t.ok('the healthy report includes real timings, not just a verdict', /\d+\s*ms/.test(r.healthy), r.healthy.slice(0, 250));
  }
  {
    // the lighter-image fallback: a connection failure must change the PAYLOAD,
    // not just try the same bytes again
    const r = await page.evaluate(() => {
      const src = foodScreenshot.toString();
      return {
        firstIsHiFi: /_downscale\(rd\.result,2048,0\.92\)/.test(src),
        fallbackIsLighter: /_downscale\(rd\.result,1400,0\.85\)/.test(src),
        onlyOnConnectionFailure: /_connectionLevel\(e1&&e1\.status\)/.test(src),
        tellsTheAthlete: /lighter image/i.test(src),
      };
    });
    t.ok('the first attempt still uses the high-fidelity encode', r.firstIsHiFi, r);
    t.ok('a connection failure falls back to a genuinely smaller image', r.fallbackIsLighter, r);
    t.ok('and only for a connection failure — a 503 or a bad key must not shrink the image', r.onlyOnConnectionFailure, r);
    t.ok('the athlete is told why it is trying again', r.tellsTheAthlete, r);
  }
  {
    // and the fallback size is a real improvement on both axes: lighter than
    // the hi-fi encode, but still wider than the 590px that made v253 unreadable
    const r = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 1179; c.height = 2556;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#000'; x.font = '30px sans-serif';
      for (let i = 0; i < 30; i++) x.fillText('Protein 41 g · 620 kcal · Carbs 58 g', 40, 90 + i * 80);
      const src = c.toDataURL('image/png');
      const m = async (max, q) => {
        const du = await _downscale(src, max, q);
        const img = new Image(); await new Promise(res => { img.onload = res; img.src = du; });
        return { w: img.width, kb: Math.round(du.length / 1024) };
      };
      return { hifi: await m(2048, 0.92), light: await m(1400, 0.85), v253: await m(1280) };
    });
    t.ok('the fallback really is lighter than the first attempt', r.light.kb < r.hifi.kb * 0.75, r);
    t.ok('but still wider than the setting that made screenshots unreadable', r.light.w > r.v253.w, r);
  }

  /* ---- calories without macros is a MISSING answer, not a zero (v260) ----
     Reported live on the first successful import: it read "Breakfast · 897
     kcal" off a meal-summary row, where Lose It shows no macro breakdown at
     all, and logged protein/carbs/fat as 0. The protein bar then sat at
     0/165g against a real 897-kcal meal. This project already has the rule in
     the other direction — a measured zero is data and must be kept — and this
     is its mirror image: an absent answer recorded as a measured zero, landing
     on the one number the whole plan is built around. */
  {
    const r = await page.evaluate(() => ({
      // calories found, every macro absent -> flagged
      summaryRow: _macrosMissing({ kcal: 897, p: 0, c: 0, f: 0 }),
      // any real macro -> a complete reading, not flagged
      withProtein: _macrosMissing({ kcal: 897, p: 41, c: 0, f: 0 }),
      withCarbs: _macrosMissing({ kcal: 897, p: 0, c: 58, f: 0 }),
      withFat: _macrosMissing({ kcal: 897, p: 0, c: 0, f: 19 }),
      // no calories either is the OTHER failure, already handled upstream
      nothing: _macrosMissing({ kcal: 0, p: 0, c: 0, f: 0 }),
      // a genuinely zero-calorie entry is not this case
      zeroKcal: _macrosMissing({ kcal: 0, p: 0, c: 0, f: 0 }),
      junk: _macrosMissing(null),
    }));
    t.ok('a calories-only summary row is flagged as macros-missing', r.summaryRow, r);
    t.ok('a reading with real protein is not flagged', !r.withProtein, r);
    t.ok('nor one with carbs', !r.withCarbs, r);
    t.ok('nor one with fat', !r.withFat, r);
    t.ok('an empty reading is not this case — that is the unusable path', !r.nothing, r);
    t.ok('and it never throws on junk', r.junk === false, r);
  }
  {
    // the sheet the athlete confirms against must say so, and must NOT
    // pre-fill a protein number nobody measured
    const r = await page.evaluate(() => {
      const o = {};
      openQuickAdd({ name: 'Breakfast', kcal: 897, p: undefined, c: undefined, f: undefined, macrosMissing: true });
      const sheet = document.querySelector('#sheet');
      o.warns = /No macros found/i.test(sheet.innerText);
      o.saysBlankNotZero = /blank, not zero/i.test(sheet.innerText);
      o.keepsCalories = (document.querySelector('#fa-kcal') || {}).value === '897';
      o.proteinBlank = (document.querySelector('#fa-p') || {}).value === '';
      o.carbsBlank = (document.querySelector('#fa-c') || {}).value === '';
      o.fatBlank = (document.querySelector('#fa-f') || {}).value === '';
      closeSheet();
      // a complete reading keeps the ordinary confirmation, not the warning
      openQuickAdd({ name: 'Chicken salad', kcal: 620, p: 41, c: 58, f: 19, portion: '1 bowl' });
      const s2 = document.querySelector('#sheet');
      o.normalNoWarning = !/No macros found/i.test(s2.innerText);
      o.normalShowsPortion = /1 bowl/.test(s2.innerText);
      o.normalProteinFilled = (document.querySelector('#fa-p') || {}).value === '41';
      closeSheet();
      return o;
    });
    t.ok('the log sheet warns that no macros were found', r.warns, r);
    t.ok('and states plainly that the boxes are blank rather than zero', r.saysBlankNotZero, r);
    t.ok('the calories — the part that WAS read — are kept', r.keepsCalories, r);
    t.ok('protein is left blank, not pre-filled with a zero nobody measured', r.proteinBlank, r);
    t.ok('and so are carbs and fat', r.carbsBlank && r.fatBlank, r);
    t.ok('a complete reading shows no warning', r.normalNoWarning, r);
    t.ok('and still shows its portion note', r.normalShowsPortion, r);
    t.ok('and still pre-fills the macros it really did read', r.normalProteinFilled, r);
  }
  {
    // the import path itself blanks the macros and sets the flag
    const r = await page.evaluate(() => {
      const src = foodScreenshot.toString();
      return {
        checks: /_macrosMissing\(est\)/.test(src),
        blanks: /p:undefined,c:undefined,f:undefined/.test(src),
        flags: /macrosMissing:true/.test(src),
        tellsInToast: /no macros in that screenshot/i.test(src),
      };
    });
    t.ok('the import checks for the macros-missing case', r.checks, r);
    t.ok('blanks the macro fields rather than passing zeros through', r.blanks, r);
    t.ok('flags it for the sheet to render', r.flags, r);
    t.ok('and the toast says it too, for anyone who dismisses the sheet', r.tellsInToast, r);
  }

  /* ---- the model list had rotted, and the app kept paying for it (v261) --
     Root cause of several of the import failures, found by the v259
     diagnostic on a real phone rather than guessed: Google retired
     gemini-2.5-flash and gemini-2.0-flash for newer keys ("no longer
     available to new users", a hard 404), so the old order spent TWO dead
     round-trips before reaching gemini-flash-latest — the only model that
     answers — and handed it whatever was left of the budget. */
  {
    const r = await page.evaluate(() => {
      const o = {}, keep = { ok: STATE.settings.foodAiModelOk, m: STATE.settings.foodAiModel };
      delete STATE.settings.foodAiModelOk; delete STATE.settings.foodAiModel;
      o.first = foodAIModels()[0];
      o.all = foodAIModels();
      // an alias, not a pinned version — a pinned id is what rotted
      o.firstIsAlias = /latest/.test(o.first);
      // remembering a working model leads with it, without losing the others
      _rememberGoodModel('gemini-2.0-flash');
      o.afterRemember = foodAIModels();
      o.stillHasAll = o.afterRemember.length === o.all.length;
      // an explicit override still wins outright
      STATE.settings.foodAiModel = 'my-model';
      o.override = foodAIModels();
      delete STATE.settings.foodAiModel;
      // a remembered model that is not in the list is ignored rather than trusted
      STATE.settings.foodAiModelOk = 'something-retired-and-gone';
      o.junkRemembered = foodAIModels();
      STATE.settings.foodAiModelOk = keep.ok; if (keep.ok === undefined) delete STATE.settings.foodAiModelOk;
      if (keep.m === undefined) delete STATE.settings.foodAiModel; else STATE.settings.foodAiModel = keep.m;
      return o;
    });
    t.eq('the working alias is tried FIRST, not last', r.first, 'gemini-flash-latest');
    t.ok('and it is an alias rather than a pinned version, which is what rotted', r.firstIsAlias, r);
    t.eq('a remembered good model leads the list', r.afterRemember[0], 'gemini-2.0-flash');
    t.ok('without dropping the others as fallbacks', r.stillHasAll, r);
    t.eq('an explicit override still wins outright', r.override.length, 1);
    t.eq('and a remembered model that is no longer in the list is ignored', r.junkRemembered[0], 'gemini-flash-latest');
  }
  {
    // a successful call records the model, so a retired one is not retried forever
    const r = await page.evaluate(async () => {
      const o = {}, real = window._geminiCall;
      const keep = STATE.settings.foodAiModelOk;
      delete STATE.settings.foodAiModelOk;
      const good = { candidates: [{ content: { parts: [{ text: JSON.stringify({ name: 'X', kcal: 100, protein: 9 }) }] }, finishReason: 'STOP' }] };
      const tried = [];
      // first two 404 exactly as Google now does for a new key
      window._geminiCall = async (m) => {
        tried.push(m);
        if (m !== 'gemini-flash-latest') { const e = new Error('AI 404'); e.status = 404; throw e; }
        return good;
      };
      await _visionEstimate('data:image/png;base64,AA==', 'p', { backoff: [0, 10] });
      o.remembered = STATE.settings.foodAiModelOk;
      o.firstTried = tried[0];
      // a second run must lead with the remembered one and not re-pay for the dead ids
      tried.length = 0;
      await _visionEstimate('data:image/png;base64,AA==', 'p', { backoff: [0, 10] });
      o.secondRunCalls = tried.length;
      o.secondRunFirst = tried[0];
      window._geminiCall = real;
      if (keep === undefined) delete STATE.settings.foodAiModelOk; else STATE.settings.foodAiModelOk = keep;
      return o;
    });
    t.eq('the model that actually answered is remembered', r.remembered, 'gemini-flash-latest');
    t.eq('the very first attempt already uses the working alias', r.firstTried, 'gemini-flash-latest');
    t.eq('and a later import spends ONE call, not three', r.secondRunCalls, 1);
    t.eq('leading with the remembered model', r.secondRunFirst, 'gemini-flash-latest');
  }

  /* ---- macros shown as PERCENTAGES, not grams (v262) ---------------------
     The real reason the import kept logging 0 g protein, found only by
     looking at the athlete's actual screenshot: Lose It's daily summary shows
     "25% Fat · 34% Carbs · 41% Protein" in a coloured bar, with no grams
     anywhere on screen. The prompt demanded grams, so the model correctly
     refused to invent them — and a real 897-kcal day was logged with no
     protein. The conversion is done in CODE, not asked of the model: 4/4/9 is
     exact arithmetic here and a coin flip in a language model. */
  {
    const r = await page.evaluate(() => {
      const o = {};
      // the athlete's own numbers
      o.real = _macrosFromPct(897, 41, 34, 25);
      // and they must reconcile back to the calories they came from
      const g = o.real;
      o.reconciles = g ? Math.abs((g.p * 4 + g.c * 4 + g.f * 9) - 897) <= 6 : false;
      // rounding slop in the tracker's own printed numbers is fine
      o.sums99 = !!_macrosFromPct(1000, 40, 34, 25);
      o.sums101 = !!_macrosFromPct(1000, 41, 35, 25);
      // a half-read ring must NOT invent the rest
      o.partial = _macrosFromPct(897, 41, null, null);
      o.oneMissing = _macrosFromPct(897, 41, 34, undefined);
      /* The cases above are ALSO refused by the sum guard (41 alone is under
         80), so they pass whether or not the missing-slice check exists —
         confirmed by a mutant that only validated protein. These two read a
         partial ring whose visible slices happen to land in range, so the
         null check is the only thing that can refuse them. */
      o.onlyProteinButSums = _macrosFromPct(897, 100, null, null);
      o.fatMissingButSums = _macrosFromPct(897, 50, 50, null);
      // nonsense splits are refused rather than scaled
      o.wayOff = _macrosFromPct(897, 10, 10, 10);
      o.over = _macrosFromPct(897, 90, 90, 90);
      o.negative = _macrosFromPct(897, -5, 60, 45);
      o.junk = _macrosFromPct(897, 'a lot', 34, 25);
      return o;
    });
    t.eq('41% protein of 897 kcal is 92 g', r.real && r.real.p, 92);
    t.eq('34% carbs is 76 g', r.real && r.real.c, 76);
    t.eq('25% fat is 25 g', r.real && r.real.f, 25);
    t.ok('and the grams add back up to the calories they came from', r.reconciles, r);
    t.ok('a split summing to 99 is accepted — trackers round each slice', r.sums99, r);
    t.ok('and so is one summing to 101', r.sums101, r);
    t.eq('a partly-read ring invents nothing', r.partial, null);
    t.eq('even when only one slice is missing', r.oneMissing, null);
    t.eq('a lone 100% slice is refused, not scaled into a whole meal', r.onlyProteinButSums, null);
    t.eq('and a missing fat slice is refused even when the rest sums to 100', r.fatMissingButSums, null);
    t.eq('a split that is nowhere near 100 is refused', r.wayOff, null);
    t.eq('and so is one far over', r.over, null);
    t.eq('a negative slice is refused', r.negative, null);
    t.eq('and junk is refused rather than coerced', r.junk, null);
  }
  {
    // end to end through the real pipeline, with the reply shaped exactly as
    // the model now returns it for a percentage-only screenshot
    const r = await page.evaluate(async () => {
      const o = {}, real = window._geminiCall;
      const reply = obj => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] });

      window._geminiCall = async () => reply({ name: 'Today', kcal: 897, proteinPct: 41, carbsPct: 34, fatPct: 25 });
      const est = await _visionEstimate('data:image/png;base64,AA==', 'p', { backoff: [0] });
      o.p = est.p; o.c = est.c; o.f = est.f; o.kcal = est.kcal;
      // and it must NOT then be treated as a macros-missing reading
      o.notFlaggedMissing = !_macrosMissing(est);

      // grams win when both are present — no double conversion
      window._geminiCall = async () => reply({ name: 'X', kcal: 897, protein: 50, carbs: 60, fat: 20, proteinPct: 41, carbsPct: 34, fatPct: 25 });
      const both = await _visionEstimate('data:image/png;base64,AA==', 'p', { backoff: [0] });
      o.gramsWin = both.p === 50 && both.c === 60 && both.f === 20;

      // percentages absent AND grams absent still reads as macros-missing
      window._geminiCall = async () => reply({ name: 'Breakfast', kcal: 897 });
      const bare = await _visionEstimate('data:image/png;base64,AA==', 'p', { backoff: [0] });
      o.bareStillMissing = _macrosMissing(bare);

      window._geminiCall = real;
      return o;
    });
    t.eq('a percentage-only screenshot yields real protein grams', r.p, 92);
    t.eq('real carb grams', r.c, 76);
    t.eq('real fat grams', r.f, 25);
    t.eq('with the calories untouched', r.kcal, 897);
    t.ok('and it is no longer treated as a macros-missing reading', r.notFlaggedMissing, r);
    t.ok('explicit grams still win over percentages when both are shown', r.gramsWin, r);
    t.ok('a reading with neither still falls back to the macros-missing warning', r.bareStillMissing, r);
  }
  {
    // the prompt has to actually ask for the percentages, or the fields stay empty
    const r = await page.evaluate(() => {
      const shot = estimateFoodFromScreenshot.toString();
      const shared = _visionEstimate.toString();
      return {
        promptMentionsPct: /percentage/i.test(shot) && /proteinPct/.test(shot),
        promptSaysDontConvert: /do NOT try to convert/i.test(shot),
        schemaHasPct: /proteinPct:\{type:'NUMBER'\}/.test(shared),
        proteinNoLongerRequired: /required:\['name','kcal'\]/.test(shared),
      };
    });
    t.ok('the prompt tells the model percentages are a valid answer', r.promptMentionsPct, r);
    t.ok('and tells it not to do the arithmetic itself', r.promptSaysDontConvert, r);
    t.ok('the schema accepts the percentage fields', r.schemaHasPct, r);
    t.ok('and protein is no longer REQUIRED in grams, which is what forced the refusal', r.proteinNoLongerRequired, r);
  }

  /* ---- the suggested meal plan no longer greets the athlete on Fuel (v245) --
     Removed at the athlete's request: they log what they actually ate, by photo
     or by hand. Nothing was ever auto-logged (every meal needed a deliberate
     tap on "Log this meal"), but a prescribed menu sitting above their own diary
     was unwanted. The GENERATOR is deliberately kept — suite 20 above still
     covers it directly, and the same days still power the Reference tab. */
  {
    const r = await page.evaluate(() => {
      const o = {};
      go('fuel'); renderFuel();
      const view = document.querySelector('#view-fuel') || document.querySelector('.view.active');
      o.logMealButtons = view.querySelectorAll('[onclick^="logRefMeal"]').length;
      o.planAnchor = !!view.querySelector('#mealplan');
      /* Comments STRIPPED before the source is searched. The block comment left
         where the call used to be names mealPlanHTML() in prose to explain why it
         is gone, and a naive substring scan reads that explanation as a live call
         site — the same false positive a comment mentioning c.put() once produced
         in the sw.js check. */
      o.renderFuelCalls = /mealPlanHTML\(\)/.test(renderFuel.toString().replace(/\/\*[\s\S]*?\*\//g, ''));
      // the machinery itself is untouched and still works
      o.generatorLives = typeof currentMealPlan === 'function' && !!currentMealPlan().meals.length;
      // and the athlete's own log is still fully there
      o.stillHasIntake = !!view.querySelector('[onclick^="foodPhoto"]') && !!view.querySelector('[onclick^="openQuickAdd"]');
      return o;
    });
    t.eq('no "Log this meal" buttons remain on the Fuel tab', r.logMealButtons, 0);
    t.eq('and the plan card itself is gone', r.planAnchor, false);
    t.eq('renderFuel no longer calls the plan builder at all', r.renderFuelCalls, false);
    t.ok('the meal-plan generator is still intact behind it', r.generatorLives, r);
    t.ok('and the athlete\'s own logging controls are untouched', r.stillHasIntake, r);
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
