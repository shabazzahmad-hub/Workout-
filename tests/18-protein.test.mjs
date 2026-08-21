/* Suite 18 — the athlete's own protein target.

   Calories have been settable since the TDEE calculator landed. Protein never
   was: it came out of bodyweight × a goal multiplier and that was final, so an
   athlete who wanted 165 g had no way to say so — and every amount on the
   Reference tab, all 28 days and the whole shopping list stayed sized to a
   number they disagreed with.

   The dangerous part is not the setter, it is what reads it. A junk value here
   flows straight into prescribed food amounts, so it is dropped rather than
   coerced, and absent means "use the calculation". */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

export default async function run() {
  const t = suite('protein target');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  /* ---- absent by default, calculated until told otherwise --------------- */
  {
    const r = await page.evaluate(() => {
      STATE.profile.weightKg = 86; delete STATE.nutrition.proteinTarget;
      /* Run the boot path. Deleting the field and reading it straight back
         proves nothing: a default installed by normalizeState() is exactly
         how voicePitch made its own override test true for everybody, and
         that mutant walks through a check that never calls this. */
      normalizeState();
      return { stored: STATE.nutrition.proteinTarget, set: proteinTargetSet(),
        calc: proteinTargetCalc(), used: proteinTargetG() };
    });
    /* CLAUDE.md, learned the hard way from voicePitch: a field meaning "the
       athlete changed this" must default to ABSENT, or the override test is
       true for everybody forever and the code it guards is dead. */
    t.eq('nothing is stored until the athlete sets one', r.stored, undefined);
    t.eq('and there is no override', r.set, null);
    t.ok('so the calculation is what gets used', r.used === r.calc && r.used > 0, r);
  }

  /* ---- setting one wins, everywhere ------------------------------------- */
  {
    const r = await page.evaluate(() => {
      setProteinTarget(165);
      const T = refTargets();
      const day = scaleDay(REF_DAYS[0], T.p, T.kcal);
      const shopChicken = shopList().flatMap(([, i]) => i).find(x => /Chicken breast/.test(x.name));
      return { used: proteinTargetG(), calc: proteinTargetCalc(), refP: T.p,
        dayP: day.p, chicken: shopChicken && shopChicken.raw };
    });
    t.eq('the number the athlete set is the number used', r.used, 165);
    t.ok('even though the calculation disagrees', r.calc !== 165, r);
    t.eq('the Reference tab works to it', r.refP, 165);
    t.ok('the worked days are re-weighed to it', Math.abs(r.dayP - 165) <= 12, r);
    t.ok('and the shopping list moves with it', r.chicken > 0, r);
  }

  /* ---- every day still lands on it -------------------------------------- */
  {
    /* A target the days cannot reach is worse than no target — the amounts
       printed on each day would be lying about what they add up to. */
    const r = await page.evaluate(() => {
      const bad = [];
      [1800, 2170, 2600].forEach(kcal => {
        REF_DAYS.forEach(d => {
          const sc = scaleDay(d, 165, kcal);
          if (Math.abs(sc.p - 165) > 12) bad.push(`${d.name} @${kcal}: ${sc.p}g`);
        });
      });
      return bad;
    });
    t.eq('all 28 days reach 165 g at every sensible calorie level', r, []);
  }

  /* ---- junk is dropped, not coerced ------------------------------------- */
  {
    const r = await page.evaluate(() => {
      const out = {};
      const junk = ['lots', null, NaN, Infinity, -20, 5, 10000, {}, []];
      out.survivors = junk.filter(v => {
        STATE.nutrition.proteinTarget = v; normalizeState();
        return STATE.nutrition.proteinTarget !== undefined;
      }).map(String);
      /* Assert on STATE, not on the getter — proteinTargetSet() sanitises its
         own read, so it would report "fine" whether or not the repair ran. */
      STATE.nutrition.proteinTarget = 'lots'; normalizeState();
      out.gone = STATE.nutrition.proteinTarget === undefined;
      out.fallsBack = proteinTargetG() === proteinTargetCalc();
      STATE.nutrition.proteinTarget = 165; normalizeState();
      out.validKept = STATE.nutrition.proteinTarget;
      return out;
    });
    t.eq('no junk value survives normalizeState', r.survivors, []);
    t.ok('the junk is gone from STATE itself', r.gone, r);
    t.ok('and the calculation takes over again', r.fallsBack, r);
    t.eq('a sane value is left alone', r.validKept, 165);
  }

  /* ---- the setter refuses to prescribe something absurd ----------------- */
  {
    const r = await page.evaluate(() => {
      setProteinTarget(9999); const hi = STATE.nutrition.proteinTarget;
      setProteinTarget(-40);  const lo = STATE.nutrition.proteinTarget;
      setProteinTarget(163);  const rounded = STATE.nutrition.proteinTarget;
      return { hi, lo, rounded };
    });
    t.eq('a wild high value is clamped', r.hi, 400);
    t.eq('and a negative one', r.lo, 40);
    t.eq('values land on a round 5 g', r.rounded, 165);
  }

  /* ---- it describes the athlete, so a backup carries it ----------------- */
  {
    const r = await page.evaluate(async () => {
      setProteinTarget(165);
      STATE._plResume = { ptr: 3, i: 1 };          // live scratch that must NOT travel
      /* Read the file exportData() actually writes, not a replica of it —
         a hand-rolled clone would pass whether or not the real path carries
         the field. Intercept the Blob on its way to the download. */
      let text = null;
      const realURL = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = b => { text = b; return 'blob:stub'; };
      HTMLAnchorElement.prototype.click = function () {};
      try { await exportData(); } finally {
        URL.createObjectURL = realURL; HTMLAnchorElement.prototype.click = realClick;
      }
      const backup = JSON.parse(await text.text());
      delete STATE._plResume;
      return { inBackup: backup.nutrition && backup.nutrition.proteinTarget,
        carriesScratch: '_plResume' in backup,
        keysStripped: !backup.settings || !('azureKey' in backup.settings) };
    });
    t.eq('a backup carries the target', r.inBackup, 165);
    t.ok('while live-session scratch still does not', !r.carriesScratch, r);
    t.ok('and the API keys still never leave the device', r.keysStripped, r);
  }

  /* ---- the control is on screen and repaints when tapped ---------------- */
  {
    const r = await page.evaluate(async () => {
      clearProteinTarget();
      go('fuel'); render();
      await new Promise(z => setTimeout(z, 200));
      /* Read the PROTEIN stat by its label, not the first .stat in the grid.
         Positional indexing broke silently the moment calories moved to the
         front of the targets block: the check went on reading a figure that
         correctly never changes, and would have passed with the repaint
         deleted. Same family as this suite's other rule — scope the assertion
         to the thing that was supposed to change. */
      const read = () => {
        const v = document.querySelector('#v-fuel');
        const stat = [...v.querySelectorAll('.stat')]
          .find(s => /^Protein/.test((s.querySelector('.l') || {}).textContent || ''));
        return { html: v.innerHTML, stat: stat && stat.querySelector('.n').textContent };
      };
      const before = read();
      const plus = [...document.querySelectorAll('#v-fuel button')]
        .find(b => b.textContent.trim() === '+5');
      if (!plus) return { noButton: true };
      /* Read back SYNCHRONOUSLY — a wait hands the assertion to whatever else
         is scheduled to repaint. */
      plus.click();
      const after = read();
      return { before: before.stat, after: after.stat,
        stored: STATE.nutrition.proteinTarget,
        offersReset: /Use calculated/.test(after.html),
        labelledYours: /Protein · yours/.test(after.html) };
    });
    t.ok('Fuel offers a protein stepper', !r.noButton, r);
    t.ok('tapping it stores a bigger number', r.stored > 0, r);
    t.ok('and the figure on screen changes with it', r.before !== r.after, r);
    t.ok('the tab says the target is the athlete\'s, not the calculator\'s', r.labelledYours, r);
    t.ok('and offers a way back to the calculated one', r.offersReset, r);
  }
  {
    const r = await page.evaluate(async () => {
      setProteinTarget(200);
      clearProteinTarget();
      await new Promise(z => setTimeout(z, 150));
      return { stored: STATE.nutrition.proteinTarget, used: proteinTargetG(),
        calc: proteinTargetCalc() };
    });
    t.eq('resetting removes the stored value entirely', r.stored, undefined);
    t.eq('and hands back to the calculation', r.used, r.calc);
  }

  /* ---- 165 g is the standing target, seeded once ------------------------
     The athlete asked for 165 g to be where the app starts. The tempting fix
     is a DEFAULT_STATE value, and it is wrong twice over: proteinTargetSet()
     reads absent as "not chosen", so a default makes that test true forever
     and kills proteinTargetCalc() (voicePitch, verbatim) — and loadState()
     merges stored nutrition OVER DEFAULT_STATE().nutrition, so the key deleted
     by clearProteinTarget() would come straight back on the next load. It is
     seeded once behind a flag instead. Each block below builds its own state:
     what the block before left behind is not a contract. */
  {
    const r = await page.evaluate(() => {
      /* A genuinely fresh install: no flag, no target, and a weight that makes
         the calculation land somewhere ELSE, so a seed that merely agreed with
         the calculator could not be mistaken for a working seed. */
      STATE.profile.weightKg = 86; STATE.profile.goal = 'lose';
      delete STATE.nutrition.proteinTarget; delete STATE.nutrition._protSeed;
      const calcBefore = proteinTargetCalc();
      normalizeState();                       // the boot path, not a hand-read
      return { stored: STATE.nutrition.proteinTarget, used: proteinTargetG(),
        flag: STATE.nutrition._protSeed, calc: calcBefore,
        inDefault: DEFAULT_STATE().nutrition.proteinTarget };
    });
    t.eq('a fresh install starts on 165 g', r.stored, 165);
    t.eq('and 165 g is the number everything reads', r.used, 165);
    t.ok('the calculation for this athlete says something else', r.calc !== 165, r);
    t.eq('the seed marks itself done', r.flag, true);
    /* The structural guard. This is what a later "simplification" into a
       DEFAULT_STATE field would break, and nothing else here would notice. */
    t.eq('165 is NOT a DEFAULT_STATE field', r.inDefault, undefined);
  }
  {
    const r = await page.evaluate(() => {
      STATE.profile.weightKg = 86;
      STATE.nutrition.proteinTarget = 200; delete STATE.nutrition._protSeed;
      normalizeState();
      const kept = STATE.nutrition.proteinTarget, flag = STATE.nutrition._protSeed;
      /* The flag has to be set on the boot path whether or not this boot
         actually seeded anything. Setting it only inside the branch that wrote
         a value leaves everyone who already had a target unflagged — so the
         first time THEY ask for the calculation back, the next boot re-seeds
         165 over it. Same shape as dietRepaired: set in one branch, and the
         other branches have to account for it too. */
      clearProteinTarget(); normalizeState();
      return { kept, flag, afterClear: STATE.nutrition.proteinTarget };
    });
    t.eq('a number the athlete already chose is left alone', r.kept, 200);
    t.eq('and the boot still marks the seed done', r.flag, true);
    t.eq('so clearing it later is not undone on the next boot', r.afterClear, undefined);
  }
  {
    const r = await page.evaluate(() => {
      STATE.profile.weightKg = 86;
      delete STATE.nutrition.proteinTarget; delete STATE.nutrition._protSeed;
      normalizeState();                       // seed it, as a fresh install would
      clearProteinTarget();                   // then ask for the calculation back
      normalizeState();                       // and reload
      return { stored: STATE.nutrition.proteinTarget, used: proteinTargetG(),
        calc: proteinTargetCalc() };
    });
    /* Without the flag this is the bug: "use calculated" works until you close
       the app, and the seed puts 165 back every single load. */
    t.eq('asking for the calculation back survives a reload', r.stored, undefined);
    t.eq('and the calculated number is what gets used', r.used, r.calc);
  }
  {
    const r = await page.evaluate(async () => {
      STATE.profile.weightKg = 86;
      delete STATE.nutrition.proteinTarget; delete STATE.nutrition._protSeed;
      normalizeState(); clearProteinTarget();
      let blob = null;
      const realURL = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = b => { blob = b; return 'blob:stub'; };
      HTMLAnchorElement.prototype.click = function () {};
      try { await exportData(); } finally {
        URL.createObjectURL = realURL; HTMLAnchorElement.prototype.click = realClick;
      }
      const backup = JSON.parse(await blob.text());
      return { flag: backup.nutrition && backup.nutrition._protSeed,
        target: backup.nutrition && backup.nutrition.proteinTarget };
    });
    /* If the flag did not travel, restoring this file would re-seed 165 over a
       clear the athlete made on purpose — the same bug, one import later. */
    t.eq('the backup carries the seed flag', r.flag, true);
    t.eq('with the cleared target still absent', r.target, undefined);
  }

  /* ---- all four targets are on the tab, not just two -------------------
     Carbs and fat existed only as bars inside the food card, which show what
     you have EATEN. Before anything is logged those read 0, so the numbers to
     aim for were nowhere on Fuel. Assert on the rendered TAB — the derived
     figures are what the athlete reads, and a check on macroTargets() alone
     would pass whether or not anything put them on screen. */
  {
    const r = await page.evaluate(async () => {
      STATE.profile.weightKg = 86; STATE.nutrition.weightKg = 86;
      STATE.nutrition.kcalTarget = 2400;
      setProteinTarget(165);
      go('fuel'); render();
      await new Promise(z => setTimeout(z, 200));
      const v = document.querySelector('#v-fuel');
      const txt = v.innerText;
      const mt = macroTargets();
      /* Scope to the targets grid, not the whole tab: the food card carries
         its own "Carbs"/"Fat" bars, so a page-wide search for the word passes
         whether or not the targets block gained anything. */
      const label = [...v.querySelectorAll('.section-label')]
        .find(e => /Today's targets/.test(e.textContent));
      const grid = label && label.nextElementSibling;
      const stats = grid ? [...grid.querySelectorAll('.stat')].map(s => ({
        n: (s.querySelector('.n') || {}).textContent,
        l: (s.querySelector('.l') || {}).textContent })) : [];
      return { mt, stats, hasMacroHeading: /MACROS EATEN TODAY/.test(txt),
        noNaN: !/NaN|undefined/.test(v.innerHTML) };
    });
    t.eq('the targets block carries four figures, not two', r.stats.length, 4);
    const by = n => r.stats.find(s => (s.l || '').startsWith(n));
    t.ok('calories are still there', !!by('Calories'), r.stats);
    t.ok('protein is still there', !!by('Protein'), r.stats);
    t.ok('carbs are on the tab now', !!by('Carbs'), r.stats);
    t.ok('and so is fat', !!by('Fat'), r.stats);
    /* The painted number must be the derived one, not a placeholder. */
    t.eq('the carb figure is the calculated one', by('Carbs') && by('Carbs').n, r.mt.c + 'g');
    t.eq('the fat figure is the calculated one', by('Fat') && by('Fat').n, r.mt.f + 'g');
    /* Only calories and protein are settable. Labelling a derived number as
       "yours" would advertise a control that does not exist. */
    t.ok('carbs and fat say they are calculated',
      /calculated/.test(by('Carbs').l) && /calculated/.test(by('Fat').l), r.stats);
    t.ok('the eaten-macros bars are named as a section', r.hasMacroHeading, r);
    t.ok('and nothing renders NaN or undefined', r.noNaN, r);
  }
  {
    /* Before a calorie target exists there is nothing to derive from. Show a
       dash, not a zero — a 0 g carb target is a prescription, not a blank. */
    const r = await page.evaluate(async () => {
      const kt = STATE.nutrition.kcalTarget;
      STATE.nutrition.kcalTarget = null;
      go('fuel'); render();
      await new Promise(z => setTimeout(z, 200));
      const v = document.querySelector('#v-fuel');
      const label = [...v.querySelectorAll('.section-label')]
        .find(e => /Today's targets/.test(e.textContent));
      const stats = [...label.nextElementSibling.querySelectorAll('.stat')]
        .map(s => ({ n: s.querySelector('.n').textContent, l: s.querySelector('.l').textContent }));
      STATE.nutrition.kcalTarget = kt;
      return { stats, noNaN: !/NaN|undefined/.test(v.innerHTML) };
    });
    const by = n => r.stats.find(s => (s.l || '').startsWith(n));
    t.eq('with no calorie target the carb figure is a dash', by('Carbs') && by('Carbs').n, '—');
    t.eq('and so is the fat figure', by('Fat') && by('Fat').n, '—');
    t.ok('still no NaN anywhere', r.noNaN, r);
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
