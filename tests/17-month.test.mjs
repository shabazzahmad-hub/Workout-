/* Suite 17 — the month of worked days and the one shop that buys it.

   The reference plan was seven days with a single fruit in it — a banana,
   filed under the cupboard. It is now twenty-eight days, no pork anywhere,
   gluten-free throughout, fruit on every day, and one aggregated list.

   The load-bearing property is not the menu, it is that every day still lands
   on whatever target it is scaled to. A day that reads well and scales to
   1,900 kcal against a 1,700 kcal target is lying about its amounts. */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

const PORK = /pork|bacon|\bham\b|gammon|chorizo|prosciutto|pancetta|salami|lard/i;
/* The athlete does not tolerate wheat, so the plan is gluten-free by
   construction — including the near-misses that look innocent on a menu. */
const GLUTEN = /wheat|seitan|bread|pasta|couscous|bulgur|barley|\brye\b|noodle|tortilla|cracker|cereal|granola|soy sauce/i;

export default async function run() {
  const t = suite('month plan');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  /* ---- a month, not a week --------------------------------------------- */
  {
    const r = await page.evaluate(() => ({
      days: REF_DAYS.length,
      names: REF_DAYS.map(d => d.name),
      dupes: REF_DAYS.map(d => d.name).filter((n, i, a) => a.indexOf(n) !== i),
      thin: REF_DAYS.filter(d => d.meals.length < 3).map(d => d.name),
      unknown: REF_DAYS.flatMap(d => d.meals.flatMap(m => m.items
        .filter(([n]) => FOOD_BY_NAME[n] === undefined).map(([n]) => d.name + ': ' + n))),
    }));
    t.eq('twenty-eight worked days', r.days, 28);
    t.eq('every day has its own name', r.dupes, []);
    t.eq('and at least three eating occasions', r.thin, []);
    t.eq('every food on every day resolves', r.unknown, []);
  }

  /* ---- no pork, no wheat ------------------------------------------------ */
  {
    const r = await page.evaluate(([pork, gluten]) => {
      const P = new RegExp(pork, 'i'), G = new RegExp(gluten, 'i');
      const hits = re => REF_DAYS.flatMap(d => d.meals.flatMap(m => m.items
        .filter(([n]) => re.test(n)).map(([n]) => d.name + ': ' + n)));
      return { pork: hits(P), gluten: hits(G),
        // and the shop cannot buy what the days do not serve, but check anyway
        shopPork: shopList().flatMap(([, items]) => items.filter(i => P.test(i.name)).map(i => i.name)),
        shopGluten: shopList().flatMap(([, items]) => items.filter(i => G.test(i.name)).map(i => i.name)) };
    }, [PORK.source, GLUTEN.source]);
    t.eq('no pork on any day', r.pork, []);
    t.eq('and none in the shop', r.shopPork, []);
    t.eq('nothing containing wheat on any day', r.gluten, []);
    t.eq('and none in the shop', r.shopGluten, []);
  }

  /* ---- fruit is real food here now, not one banana in the cupboard ------ */
  {
    const r = await page.evaluate(() => {
      const fruitCat = n => (FOODS[FOOD_BY_NAME[n]] || [])[4] === 'fruit';
      const without = REF_DAYS.filter(d => !d.meals.some(m => m.items.some(([n]) => fruitCat(n)))).map(d => d.name);
      const shop = shopList();
      const fruitAisle = shop.find(([g]) => /fruit/i.test(g));
      return { kinds: FOODS.filter(f => f[4] === 'fruit').map(f => f[0]),
        without, aisle: fruitAisle ? fruitAisle[1].map(i => i.name) : null,
        tabbed: FOOD_CATS.some(c => c[0] === 'fruit'),
        banana: (FOODS[FOOD_BY_NAME['Banana']] || [])[4] };
    });
    t.ok('the food list carries a real spread of fruit', r.kinds.length >= 12, r.kinds);
    t.eq('every day includes some', r.without, []);
    t.ok('the shop has a fruit aisle', Array.isArray(r.aisle) && r.aisle.length >= 10, r.aisle);
    t.ok('and it is a filter tab like any other category', r.tabbed, r);
    t.eq('the banana moved out of the cupboard', r.banana, 'fruit');
  }

  /* ---- one list, and it buys everything the month serves ---------------- */
  {
    const r = await page.evaluate(() => {
      const shop = shopList();
      const names = {}; const dupes = [];
      shop.forEach(([, items]) => items.forEach(i => { if (names[i.name]) dupes.push(i.name); names[i.name] = 1; }));
      const served = {};
      scaledDays().forEach(d => d.meals.forEach(m => m.items.forEach(x => { served[x.name] = 1; })));
      return { groups: shop.map(([g]) => g), dupes,
        missing: Object.keys(served).filter(n => !names[n]),
        noQty: shop.flatMap(([, items]) => items.filter(i => !(i.raw > 0)).map(i => i.name)),
        lines: Object.keys(names).length };
    });
    t.eq('nothing is listed twice — one tick must not strike two things', r.dupes, []);
    t.eq('everything the month serves is bought', r.missing, []);
    t.eq('and every line has a quantity', r.noQty, []);
    t.ok('it is a single aggregated list', r.lines >= 60, r);
    t.ok('with fruit as its own aisle', r.groups.some(g => /fruit/i.test(g)), r.groups);
  }

  /* ---- the amounts have to be true at every target ---------------------- */
  {
    /* This is the check the menu rests on. Scaling moves the protein anchors
       and the starches; nuts, oil, avocado and fruit are fixed, so a day that
       stacks them sets a calorie floor the scaler cannot get under — which is
       exactly how three of these days failed the first time they were written. */
    const r = await page.evaluate(() => {
      const out = [];
      [[150, 2170], [190, 2600], [120, 1700]].forEach(([tp, tk]) => {
        REF_DAYS.forEach(d => {
          const sc = scaleDay(d, tp, tk);
          if (Math.abs(sc.p - tp) > 12) out.push(`${d.name} @${tp}g: ${sc.p}g`);
          if (Math.abs(sc.kcal - tk) > 150) out.push(`${d.name} @${tk}kcal: ${sc.kcal}`);
          if (sc.meals.some(m => m.items.some(x => !(x.amt > 0)))) out.push(`${d.name} @${tp}/${tk}: an item scaled to zero`);
        });
      });
      return out;
    });
    t.eq('every day lands on every target it is scaled to', r, []);
  }

  /* ---- and the validator agrees ----------------------------------------- */
  {
    const r = await page.evaluate(() => {
      const e = console.error; console.error = () => {};
      const errs = validateData(); console.error = e;
      return errs;
    });
    t.eq('validateData is clean', r, []);
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
