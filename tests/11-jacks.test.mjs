/* Suite 11 — jumping jacks as the portable default, and training space.

   A bike on a trainer is the least portable thing an athlete owns. The step
   debt could only be paid on one, and the programme handed you the bike the
   moment you ticked the box for owning it. Jacks need a patch of floor, so they
   lead; the ride is what you switch to.

   The arithmetic matters more than the UI here: if jacks over-credit
   themselves, they quietly eat the calorie deficit they are supposed to serve. */
import { serve, launch, suite, seedAthlete, waitForBoot } from './lib/harness.mjs';

export default async function run() {
  const t = suite('jacks & space');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  /* ---- the model is honest and internally consistent --------------------- */
  {
    const r = await page.evaluate(() => {
      const o = {};
      o.default = cardioMode();
      // steps/min follows the SAME MET x 35 rule the bike uses
      o.sameRule = JACK_LEVELS.every(b => jackStepsPerMin(b.k) === Math.round(b.met * 35));
      // harder pays more, in every currency
      o.monotonic = JACK_LEVELS.every((b, i) => i === 0 ||
        (jackStepsPerMin(b.k) > jackStepsPerMin(JACK_LEVELS[i - 1].k) &&
         jackKcalPerMin(b.k) > jackKcalPerMin(JACK_LEVELS[i - 1].k)));
      // every quoted currency actually covers the debt it is quoted against
      o.covers = JACK_LEVELS.every(b => {
        const n = jackNeed(8000, b.k);
        return n.min * jackStepsPerMin(b.k) >= 8000
            && (n.reps / jackRepsPerMin(b.k)) * jackStepsPerMin(b.k) >= 8000
            && n.kcal >= 8000 * kcalPerStep();
      });
      // calories are the same energy however fast you go — pace changes the time, not the debt
      o.kcalPaceIndependent = new Set(JACK_LEVELS.map(b => jackNeed(8000, b.k).kcal)).size === 1;
      // and jacks must not out-earn the bike per minute at a comparable effort
      o.notInflated = jackStepsPerMin('steady') <= bikeStepsPerMin('hard');
      o.stepJacksLowest = jackStepsPerMin('step') === Math.min(...JACK_LEVELS.map(b => jackStepsPerMin(b.k)));
      o.validator = validateData().length;
      return o;
    });
    t.eq('jumping jacks are the default, not the bike', r.default, 'jacks');
    t.ok('jacks use the same MET×35 rule as the bike', r.sameRule, r);
    t.ok('a harder pace pays more in every currency', r.monotonic, r);
    t.ok('every quoted figure actually covers the debt', r.covers, r);
    t.ok('calories to close a gap do not depend on pace', r.kcalPaceIndependent, r);
    t.ok('jacks do not out-earn a hard ride per minute', r.notInflated, r);
    t.ok('step jacks are the lowest-paying, as the least effort should be', r.stepJacksLowest, r);
    t.eq('the validator stays clean', r.validator, 0);
  }

  /* ---- the three currencies describe the same work ----------------------- */
  {
    const r = await page.evaluate(() => {
      const T = nutToday();
      delete T.steps; delete T.jackVal; delete T.jackUnit; delete T.jackLvl;
      delete T.bikeVal; delete T.bikeUnit; delete T.bikeLvl;
      nut().cardioMode = 'jacks';
      setJackLvl('steady'); setJackUnit('min'); setJackVal(20);
      const inMin = jackWork();
      setJackUnit('reps');
      const asReps = { val: movement().jval, work: jackWork() };
      setJackUnit('kcal');
      const asKcal = { val: movement().jval, work: jackWork() };
      setJackUnit('min');
      const backToMin = { val: movement().jval, work: jackWork() };
      return { inMin, asReps, asKcal, backToMin };
    });
    t.ok('20 minutes converts to a sane rep count', Math.abs(r.asReps.val - 20 * 55) <= 2, r.asReps);
    t.ok('switching to reps re-expresses the same work',
      Math.abs(r.asReps.work.steps - r.inMin.steps) <= 15, r);
    t.ok('switching to calories re-expresses the same work',
      Math.abs(r.asKcal.work.steps - r.inMin.steps) <= 15, r);
    t.ok('switching back lands on the original minutes',
      Math.abs(r.backToMin.val - 20) <= 1, r.backToMin);
  }

  /* ---- jacks pay the step target, alongside walking and riding ----------- */
  {
    const r = await page.evaluate(() => {
      const T = nutToday();
      delete T.steps; delete T.jackVal; delete T.bikeVal;
      delete T.jackUnit; delete T.jackLvl; delete T.bikeUnit; delete T.bikeLvl;
      const o = {};
      o.emptyIsZero = stepEquivalent() === 0;
      setSteps(3000);
      o.walkOnly = stepEquivalent();
      setJackLvl('steady'); setJackUnit('min'); setJackVal(10);
      o.plusJacks = stepEquivalent();
      o.jackSteps = jackWork().steps;
      setBikeLvl('steady'); setBikeUnit('min'); setBikeVal(10);
      o.plusBoth = stepEquivalent();
      o.rideSteps = bikeRide().steps;
      o.addsUp = o.plusBoth === o.walkOnly + o.jackSteps + o.rideSteps;
      return o;
    });
    t.ok('an empty day is worth zero', r.emptyIsZero, r);
    t.eq('walking alone counts', r.walkOnly, 3000);
    t.ok('jacks add to the day', r.plusJacks > r.walkOnly, r);
    t.ok('walked, jumped and ridden simply add up', r.addsUp, r);
  }

  /* ---- the card leads with jacks and can switch ------------------------- */
  {
    const r = await page.evaluate(async () => {
      const T = nutToday();
      delete T.steps; delete T.jackVal; delete T.bikeVal;
      nut().cardioMode = 'jacks';
      setSteps(2000);
      go('fuel'); await new Promise(z => setTimeout(z, 120));
      const html = () => document.querySelector('#v-fuel').innerHTML;
      const o = {};
      o.jackInput = !!document.querySelector('#mv-jack');
      o.noBikeInput = !document.querySelector('#mv-bike');
      o.offersBothModes = /Jumping jacks/.test(html()) && /🚴 Bike/.test(html());
      o.quotesReps = /reps<\/b>/.test(html()) || /reps\b/.test(document.querySelector('#v-fuel').textContent);
      o.mentionsQuiet = /Step jacks/.test(document.querySelector('#v-fuel').textContent);
      o.noNaN = !/NaN|Infinity|undefined/.test(document.querySelector('#v-fuel').textContent);
      setCardioMode('bike'); await new Promise(z => setTimeout(z, 120));
      o.afterSwitchBike = !!document.querySelector('#mv-bike');
      o.afterSwitchNoJack = !document.querySelector('#mv-jack');
      setCardioMode('jacks'); await new Promise(z => setTimeout(z, 120));
      o.switchesBack = !!document.querySelector('#mv-jack');
      return o;
    });
    t.ok('the Movement card opens on jumping jacks', r.jackInput && r.noBikeInput, r);
    t.ok('both options are offered', r.offersBothModes, r);
    t.ok('it quotes a rep count, not a distance', r.quotesReps, r);
    t.ok('it points at the quiet, low-impact version', r.mentionsQuiet, r);
    t.ok('nothing renders as NaN', r.noNaN, r);
    t.ok('switching to the bike shows the ride card', r.afterSwitchBike && r.afterSwitchNoJack, r);
    t.ok('and switching back returns to jacks', r.switchesBack, r);
  }

  /* ---- work done in the OTHER mode is still acknowledged ----------------- */
  {
    const r = await page.evaluate(async () => {
      const T = nutToday();
      delete T.steps; delete T.jackVal; delete T.bikeVal;
      nut().cardioMode = 'jacks';
      setJackLvl('steady'); setJackUnit('min'); setJackVal(15);
      setCardioMode('bike'); await new Promise(z => setTimeout(z, 120));
      const txt = document.querySelector('#v-fuel').textContent;
      return { mentionsJacks: /Also logged today/.test(txt) && /jacks/.test(txt),
        weekly: ridesThisWeek() };
    });
    t.ok('jacks logged today are still shown when viewing the bike', r.mentionsJacks, r);
    t.ok('the weekly conditioning target counts jack minutes', r.weekly.jackMin >= 14, r.weekly);
  }

  /* ---- the programme no longer forces the bike on anyone ----------------- */
  {
    const r = await page.evaluate(() => {
      const realP = JSON.stringify(STATE.profile);
      const count = (gear, mode) => {
        STATE.profile.gear = gear; nut().cardioMode = mode;
        let bike = 0, jump = 0;
        for (let p = 0; p < 42; p++) {
          const s2 = buildSession(p);
          [...s2.main, s2.finisher].filter(Boolean).forEach(m => {
            if (m.exId === 'bike') bike += m.sets;
            else if ((EX[m.exId] || {}).region === 'cardio') jump += m.sets;
          });
        }
        return { bike, jump };
      };
      const o = {
        noTrainer: count(['bar', 'bench', 'dip'], 'jacks'),
        ownsJacksMode: count(['bar', 'bench', 'dip', 'bike'], 'jacks'),
        ownsBikeMode: count(['bar', 'bench', 'dip', 'bike'], 'bike'),
      };
      STATE.profile = JSON.parse(realP); nut().cardioMode = 'jacks';
      return o;
    });
    t.eq('no trainer, no bike in the programme', r.noTrainer.bike, 0);
    t.eq('owning a trainer alone does not program the bike', r.ownsJacksMode.bike, 0);
    t.eq('and the jumping is left alone', r.ownsJacksMode.jump, r.noTrainer.jump);
    t.ok('choosing the bike does program it', r.ownsBikeMode.bike > 0, r);
    t.ok('but only about half the conditioning',
      r.ownsBikeMode.jump > 0 && r.ownsBikeMode.jump < r.noTrainer.jump * 0.75, r);
  }

  /* ---- a corrupt or hostile jack field cannot poison the day ------------- */
  {
    const r = await page.evaluate(() => {
      const T = nutToday();
      T.jackVal = 'lots'; T.jackLvl = { evil: 1 }; T.jackUnit = 'furlongs'; T.steps = 4000;
      nut().cardioMode = 'sideways';
      normalizeState();
      const m = movement();
      return { mode: cardioMode(), m, work: jackWork(), equiv: stepEquivalent(),
        cleaned: T.jackVal === undefined && T.jackLvl === undefined && T.jackUnit === undefined };
    });
    t.eq('a junk cardio mode falls back to jacks', r.mode, 'jacks');
    t.ok('junk jack fields are dropped by normalizeState', r.cleaned, r);
    t.eq('a corrupt jack value is worth zero, not NaN', r.work.steps, 0);
    t.eq('and the day still totals the walking', r.equiv, 4000);
  }

  /* ---- training space is asked, not buried ------------------------------- */
  {
    const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await p2.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await waitForBoot(p2);
    const r = await p2.evaluate(() => {
      const grp = document.querySelector('#ob-space');
      const txt = document.querySelector('.view.active').textContent;
      const o = { asked: !!grp, buttons: grp ? grp.querySelectorAll('button').length : 0,
        statesClearance: /6\s*ft|2\s*m/.test(txt) };
      if (grp) {
        const tight = [...grp.querySelectorAll('button')].find(b => b.dataset.sp === 'tight');
        tight.click();
        obReadForm();
        o.tightSaved = STATE.profile.tightSpace === true;
        const full = [...grp.querySelectorAll('button')].find(b => b.dataset.sp === 'full');
        full.click(); obReadForm();
        o.fullSaved = STATE.profile.tightSpace === false;
        o.singleSelect = grp.querySelectorAll('button.on').length === 1;
      }
      return o;
    });
    t.ok('onboarding asks about training space', r.asked, r);
    t.eq('it is a two-way choice', r.buttons, 2);
    t.ok('it states the actual clearance a handstand needs', r.statesClearance, r);
    t.ok('choosing Tight is saved', r.tightSaved, r);
    t.ok('choosing full space is saved', r.fullSaved, r);
    t.ok('it behaves as a single-select', r.singleSelect, r);
    await p2.close();
  }

  /* ---- and Tight actually removes the wall work -------------------------- */
  {
    const r = await page.evaluate(() => {
      const realP = JSON.stringify(STATE.profile);
      const wall = ['hspushup', 'wallhandstand', 'wallwalk'];
      const scan = () => {
        let n = 0;
        for (let p = 0; p < 90; p++) {
          const s2 = buildSession(p);
          [...s2.main, s2.finisher].filter(Boolean).forEach(m => { if (wall.includes(m.exId)) n++; });
        }
        return n;
      };
      STATE.profile.tightSpace = false; const roomy = scan();
      STATE.profile.tightSpace = true; const tight = scan();
      const subs = wall.map(k => SPACE_SWAP[k]).filter(Boolean);
      const allExist = subs.every(k => !!EX[k]);
      STATE.profile = JSON.parse(realP);
      return { roomy, tight, subs, allExist };
    });
    t.ok('the wall work is programmed when there is room', r.roomy > 0, r);
    t.eq('and never when space is tight', r.tight, 0);
    t.ok('every space substitute is a real exercise', r.allExist, r);
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
