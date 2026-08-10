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

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
