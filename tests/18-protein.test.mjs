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
      const read = () => {
        const v = document.querySelector('#v-fuel');
        return { html: v.innerHTML, stat: (v.querySelector('.stat .n') || {}).textContent };
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

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
