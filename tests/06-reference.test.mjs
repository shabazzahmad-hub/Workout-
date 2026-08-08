/* The Reference tab.

   This tab is different from the rest of the app in one way that matters: its
   food list is a *write* surface. Tapping a row pre-fills the log sheet, so a
   wrong number here does not just read badly, it lands in the day's macro
   totals and then in the weekly averages. The first block below exists because
   the category-ratio estimate shipped logging olive oil as 20 g of carbs.

   The rest covers the things that broke in this app before, in this shape:
   a view that renders from live state before that state exists, a persisted
   object that arrives the wrong type, and a printed constant that silently
   stops matching the athlete's own target. */
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
    o.badShape = FOODS.filter(f => !Array.isArray(f) || f.length < 5 || typeof f[0] !== 'string'
      || typeof f[3] !== 'string').map(f => f && f[0]);
    o.dupes = FOODS.map(f => f[0]).filter((n, i, a) => a.indexOf(n) !== i);
    o.orphanCat = FOODS.filter(f => !cats.includes(f[4])).map(f => f[0]);
    o.everyTabHasFood = cats.every(c => FOODS.some(f => f[4] === c));
    o.noFat = FOODS.filter(f => typeof f[5] !== 'number').map(f => f[0]);
    // every row must reconcile: protein + derived carbs + fat ≈ its own calories
    o.negative = [], o.drift = [];
    FOODS.forEach(f => {
      const m = foodMacros(f);
      if (m.c < 0 || m.f < 0) o.negative.push(f[0]);
      const recon = f[1] * 4 + m.c * 4 + m.f * 9;
      if (Math.abs(recon - f[2]) > 12) o.drift.push(f[0] + ':' + recon + '/' + f[2]);
    });
    // the specific rows the old category split got wrong
    o.oil = foodMacros(FOODS.find(f => f[0] === 'Olive oil'));
    o.banana = foodMacros(FOODS.find(f => f[0] === 'Banana'));
    o.rice = foodMacros(FOODS.find(f => f[0] === 'White rice, cooked'));
    o.eggs = foodMacros(FOODS.find(f => f[0] === '3 whole eggs'));
    o.chicken = foodMacros(FOODS.find(f => f[0] === 'Chicken breast'));
    // efficiency is the number the tab tells the athlete to read
    o.effCod = +foodEfficiency(FOODS.find(f => f[0] === 'Cod')).toFixed(1);
    o.effSalmon = +foodEfficiency(FOODS.find(f => f[0] === 'Salmon fillet')).toFixed(1);
    o.effLeanBeatsFatty = o.effCod > o.effSalmon;
    o.effZeroKcalSafe = foodEfficiency(['x', 10, 0, 'y', 'meat']) === 0;
    // a food added with no fat figure must still produce sane macros
    const fallback = foodMacros(['Test', 20, 300, '1', 'meat']);
    o.fallbackSane = fallback.c >= 0 && fallback.f >= 0;
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
  t.ok('no food ever logs a negative macro', food.negative.length === 0, food.negative);
  t.ok('every food reconciles to its own calorie count', food.drift.length === 0, food.drift);
  t.ok('olive oil logs as fat, not as carbs', food.oil.f >= 12 && food.oil.c <= 2, food.oil);
  t.ok('a banana logs as carbs, not as fat', food.banana.c >= 20 && food.banana.f <= 2, food.banana);
  t.ok('rice logs as carbs', food.rice.c >= 70 && food.rice.f <= 2, food.rice);
  t.ok('three eggs log ~15 g fat and almost no carbs', food.eggs.f === 15 && food.eggs.c <= 2, food.eggs);
  t.ok('chicken breast logs no meaningful carbs', food.chicken.c <= 2, food.chicken);
  t.ok('protein-per-100kcal ranks lean fish above fatty fish', food.effLeanBeatsFatty, food);
  t.ok('efficiency does not divide by zero', food.effZeroKcalSafe, food);
  t.ok('a food with no fat figure still logs sane macros', food.fallbackSane, food);
  t.ok('validateData stays clean with the Reference tables in it', food.validatorClean, food);

  // ---- the seven days and the shop ----------------------------------------
  const days = await page.evaluate(() => {
    const o = {};
    o.n = REF_DAYS.length;
    o.mismatched = REF_DAYS.filter(d => d[3].reduce((a, m) => a + m[2], 0) !== d[1]).map(d => d[0]);
    o.short = REF_DAYS.filter(d => d[1] < 145).map(d => d[0] + ':' + d[1]);
    // a protein-led day that comes in 500 kcal light is the exact failure the
    // fourth build rule warns about — the tab must not ship one
    o.underfed = REF_DAYS.filter(d => d[2] < 1800).map(d => d[0] + ':' + d[2]);
    o.thin = REF_DAYS.filter(d => d[3].length < 3).map(d => d[0]);
    o.hasFasting = REF_DAYS.some(d => /16:8/.test(d[0]));
    o.hasNoCook = REF_DAYS.some(d => /no-cook/i.test(d[0]));
    o.shopItems = REF_SHOP.reduce((a, s) => a + s[1].length, 0);
    const keys = REF_SHOP.flatMap(([g, i]) => i.map(([n]) => g + '|' + n));
    o.shopDupes = keys.filter((k, i, a) => a.indexOf(k) !== i);
    o.shopBlank = keys.filter(k => /\|\s*$/.test(k));
    return o;
  });
  t.eq('there are seven worked days', days.n, 7);
  t.ok('every day header matches the sum of its meals', days.mismatched.length === 0, days.mismatched);
  t.ok('no day misses the protein target', days.short.length === 0, days.short);
  t.ok('no day is padded short on calories', days.underfed.length === 0, days.underfed);
  t.ok('every day has at least three eating occasions', days.thin.length === 0, days.thin);
  t.ok('one day is written for the 16:8 window', days.hasFasting, days);
  t.ok('one day needs no cooking', days.hasNoCook, days);
  t.ok('the shop covers the week', days.shopItems >= 35, days.shopItems);
  t.ok('no shopping line shares a tick key with another', days.shopDupes.length === 0, days.shopDupes);
  t.ok('no shopping line is blank', days.shopBlank.length === 0, days.shopBlank);

  // ---- the tab itself ------------------------------------------------------
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} go('ref'); });
  await page.waitForTimeout(150);
  const view = await page.evaluate(() => {
    const v = document.querySelector('#v-ref');
    return {
      exists: !!v,
      active: !!v && v.classList.contains('active'),
      onlyOneActive: document.querySelectorAll('.view.active').length === 1,
      hasFoodRows: !!v && v.querySelectorAll('[onclick^="logFoodFromList"]').length === FOODS.length,
      hasDays: !!v && /Seven worked days/.test(v.innerHTML),
      hasShop: !!v && /Weekly shop/.test(v.innerHTML),
      hasRules: !!v && /Getting to 150 g/.test(v.innerHTML),
      navHasRef: !!document.querySelector('.nav button[data-tab="ref"]'),
      navCount: document.querySelectorAll('.nav button').length,
      tabVar: TAB,
    };
  });
  t.ok('the Reference view is mounted', view.exists, view);
  t.ok('it becomes the active view', view.active && view.tabVar === 'ref', view);
  t.ok('no other view is left active alongside it', view.onlyOneActive, view);
  t.ok('every food renders as a tappable row', view.hasFoodRows, view);
  t.ok('the seven days render', view.hasDays, view);
  t.ok('the shopping list renders', view.hasShop, view);
  t.ok('the build rules render', view.hasRules, view);
  t.ok('the nav carries a Reference button', view.navHasRef, view);
  t.eq('the nav has six tabs', view.navCount, 6);

  // ---- filtering -----------------------------------------------------------
  const filt = await page.evaluate(() => {
    const o = {}, count = () => document.querySelectorAll('#v-ref [onclick^="logFoodFromList"]').length;
    setRefCat('fish');
    o.fishRows = count();
    o.fishExpected = FOODS.filter(f => f[4] === 'fish').length;
    /* Scoped to the rendered rows, not to the whole view — the shopping list
       further down legitimately names chicken whatever filter is selected. */
    const shown = () => [...document.querySelectorAll('#v-ref [onclick^="logFoodFromList"]')]
      .map(b => FOODS[+/logFoodFromList\((\d+)\)/.exec(b.getAttribute('onclick'))[1]]);
    o.fishOnly = shown().every(f => f[4] === 'fish');
    o.tabMarkedOn = !!document.querySelector('#ref-cats button.on');
    setRefCat('veg');
    o.vegRows = count();
    o.vegExpected = FOODS.filter(f => f[4] === 'veg').length;
    setRefCat('all');
    o.allRows = count();
    // the index passed to logFoodFromList must index FOODS, not the filtered view
    setRefCat('pad');
    const first = document.querySelector('#v-ref [onclick^="logFoodFromList"]');
    const idx = +/logFoodFromList\((\d+)\)/.exec(first.getAttribute('onclick'))[1];
    o.indexIsGlobal = FOODS[idx][4] === 'pad';
    o.labelMatches = first.textContent.includes(FOODS[idx][0]);
    setRefCat('all');
    return o;
  });
  t.eq('the fish filter shows exactly the fish', filt.fishRows, filt.fishExpected, filt);
  t.ok('the fish filter hides the meat', filt.fishOnly, filt);
  t.ok('the selected filter is marked', filt.tabMarkedOn, filt);
  t.eq('the veg filter shows exactly the veg', filt.vegRows, filt.vegExpected, filt);
  t.eq('clearing the filter restores every food', filt.allRows, food.count, filt);
  t.ok('a filtered row still carries its index into the full list', filt.indexIsGlobal, filt);
  t.ok('a filtered row is labelled with the food it will log', filt.labelMatches, filt);

  // ---- tapping a food logs it ---------------------------------------------
  const tap = await page.evaluate(() => {
    const i = FOODS.findIndex(f => f[0] === 'Cod');
    logFoodFromList(i);
    const val = id => { const el = document.querySelector(id); return el ? el.value : null; };
    const o = {
      name: val('#fa-name'), kcal: val('#fa-kcal'), p: val('#fa-p'),
      c: val('#fa-c'), f: val('#fa-f'),
      expected: FOODS[i],
    };
    o.carriesPortion = /150 g/.test(o.name || '');
    try { closeSheet(); } catch (e) {}
    // an index that is not a food must be a no-op, not a thrown render
    let threw = false;
    try { logFoodFromList(9999); logFoodFromList(-1); } catch (e) { threw = true; }
    o.badIndexSafe = !threw;
    try { closeSheet(); } catch (e) {}
    return o;
  });
  t.eq('tapping a food pre-fills its calories', tap.kcal, '140', tap);
  t.eq('tapping a food pre-fills its protein', tap.p, '33', tap);
  t.ok('tapping a food pre-fills carbs and fat too', tap.c !== '' && tap.f !== '', tap);
  t.ok('the pre-filled name carries the portion it was costed at', tap.carriesPortion, tap);
  t.ok('an index that is not a food is a no-op', tap.badIndexSafe, tap);

  // ---- the shopping ticks persist -----------------------------------------
  const shop = await page.evaluate(() => {
    const o = {};
    STATE.shopTicks = {};
    const key = REF_SHOP[0][0] + '|' + REF_SHOP[0][1][0][0];
    toggleShop(key);
    o.set = !!shopTicks()[key];
    o.saved = !!JSON.parse(localStorage.getItem('coreforge.v1')).shopTicks[key];
    o.countShown = /1\/\d+/.test(document.querySelector('#v-ref').innerHTML);
    o.resetOffered = /clearShop\(\)/.test(document.querySelector('#v-ref').innerHTML);
    toggleShop(key);
    o.unset = !shopTicks()[key];
    o.resetHiddenWhenEmpty = !/clearShop\(\)/.test(document.querySelector('#v-ref').innerHTML);
    toggleShop(key); toggleShop(REF_SHOP[1][0] + '|' + REF_SHOP[1][1][0][0]);
    clearShop();
    o.cleared = Object.keys(shopTicks()).length === 0;
    // the wrong type must be repaired, not crash the tab
    STATE.shopTicks = ['Chicken breast'];
    normalizeState();
    o.arrayRepaired = !Array.isArray(STATE.shopTicks) && typeof STATE.shopTicks === 'object';
    STATE.shopTicks = 'nope';
    normalizeState();
    o.stringRepaired = typeof STATE.shopTicks === 'object' && !Array.isArray(STATE.shopTicks);
    // shopTicks() itself must fail to {} rather than hand a string to the renderer
    STATE.shopTicks = 'nope';
    o.readerFailsSafe = JSON.stringify(shopTicks()) === '{}';
    let rendered = true;
    try { renderRef(); } catch (e) { rendered = false; }
    o.rendersAfterCorrupt = rendered;
    normalizeState();
    return o;
  });
  t.ok('a tick registers', shop.set, shop);
  t.ok('a tick is written to storage, not just to the screen', shop.saved, shop);
  t.ok('the header counts what is ticked', shop.countShown, shop);
  t.ok('a reset is offered once something is ticked', shop.resetOffered, shop);
  t.ok('tapping again unticks it', shop.unset, shop);
  t.ok('no reset button is offered on an empty list', shop.resetHiddenWhenEmpty, shop);
  t.ok('reset clears every tick', shop.cleared, shop);
  t.ok('an array where the ticks belong is repaired', shop.arrayRepaired, shop);
  t.ok('a string where the ticks belong is repaired', shop.stringRepaired, shop);
  t.ok('the tick reader fails to empty, never to a string', shop.readerFailsSafe, shop);
  t.ok('the tab still renders after a corrupt tick value', shop.rendersAfterCorrupt, shop);

  // ---- live targets and the drift warning ----------------------------------
  const live = await page.evaluate(() => {
    const o = {};
    recalcKcalFromStored();
    const html = () => { renderRef(); return document.querySelector('#v-ref').innerHTML; };
    STATE.nutrition.kcalTarget = 2170;
    o.noWarnOnTarget = !/scale the carb portions/.test(html());
    STATE.nutrition.kcalTarget = 2250;
    o.noWarnNear = !/scale the carb portions/.test(html());
    STATE.nutrition.kcalTarget = 2800;
    o.warnsHigh = /scale the carb portions/.test(html());
    STATE.nutrition.kcalTarget = 1600;
    o.warnsLow = /scale the carb portions/.test(html());
    o.quotesOwnTarget = /1600 kcal/.test(html());
    // before targets exist the tab must say how to get them, not print a dash and stop
    STATE.nutrition.kcalTarget = 0;
    const h0 = html();
    o.promptsSetup = /Calculate my targets/.test(h0);
    o.noNegativeLeft = !/-\d+g<\/div>/.test(h0);
    // remaining protein counts down as food is logged and never goes below zero
    recalcKcalFromStored();
    const t0 = nutToday();
    t0.food = [];
    const before = proteinTargetG();
    t0.food = [{ name: 'x', kcal: 300, p: 40, c: 10, f: 5, meal: 'lunch' }];
    renderRef();
    o.countsDown = new RegExp('>' + (before - 40) + 'g<').test(document.querySelector('#v-ref').innerHTML);
    t0.food = [{ name: 'x', kcal: 9000, p: 900, c: 10, f: 5, meal: 'lunch' }];
    renderRef();
    o.floorsAtZero = />0g</.test(document.querySelector('#v-ref').innerHTML)
      && !/>-\d+g</.test(document.querySelector('#v-ref').innerHTML);
    t0.food = [];
    return o;
  });
  t.ok('no drift warning when the target still matches the sheets', live.noWarnOnTarget, live);
  t.ok('no drift warning for a small difference', live.noWarnNear, live);
  t.ok('a target well above the sheets warns', live.warnsHigh, live);
  t.ok('a target well below the sheets warns', live.warnsLow, live);
  t.ok('the warning quotes the athlete\'s own number', live.quotesOwnTarget, live);
  t.ok('with no target set it says how to get one', live.promptsSetup, live);
  t.ok('with no target set it never shows a negative', live.noNegativeLeft, live);
  t.ok('protein remaining counts down as food is logged', live.countsDown, live);
  t.ok('protein remaining floors at zero', live.floorsAtZero, live);

  // ---- routing and durability ---------------------------------------------
  /* A hash-only goto is a same-document navigation — the page would never
     reload and boot() would never re-read the hash, so the check would pass
     against the tab that was already open. Reload for real. */
  await page.evaluate(() => { STATE.nutrition.kcalTarget = 2170; save(); go('today'); location.hash = 'ref'; });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const routed = await page.evaluate(() => ({
    tab: TAB,
    active: !!document.querySelector('#v-ref.active'),
    rendered: (document.querySelector('#v-ref') || {}).innerHTML.length > 2000,
  }));
  t.ok('a #ref home-screen shortcut opens on the Reference tab', routed.tab === 'ref' && routed.active, routed);
  t.ok('it is rendered by the time it is shown', routed.rendered, routed);

  // ---- the tab is not an injection path ------------------------------------
  /* importData() accepts arbitrary JSON, and shopTicks is now part of that
     payload — a crafted key is a stored-XSS attempt against the origin that
     holds the API keys. */
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
