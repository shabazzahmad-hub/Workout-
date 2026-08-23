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

  /* ---- rucking: the third way to pay the step target -------------------
     Deliberately NOT modelled like the bike. On a trainer intensity is a dial,
     so BIKE_LEVELS can be a fixed MET table. Under a ruck the intensity is the
     load RELATIVE TO the athlete, so the MET is computed from their own
     bodyweight — 45 lb is moderate for a 250 lb man and hard for a 150 lb one.
     If that arithmetic over-credits, a ruck quietly eats the deficit it is
     supposed to serve, which is this suite's whole reason for existing. */
  {
    const r = await page.evaluate(() => {
      STATE.nutrition.weightKg = 86.2;          // 190 lb
      STATE.profile.weightKg = 86.2;
      const o = {};
      setRuckLoad(25); setRuckPace('brisk');
      o.met25 = +ruckMET('brisk').toFixed(3);
      o.steps25 = ruckStepsPerMin('brisk');
      setRuckLoad(45);
      o.met45 = +ruckMET('brisk').toFixed(3);
      o.steps45 = ruckStepsPerMin('brisk');
      /* The SAME plate on a heavier athlete has to be worth LESS per minute —
         that is the whole reason this is computed rather than tabulated. */
      STATE.nutrition.weightKg = 130; STATE.profile.weightKg = 130;
      o.met45heavy = +ruckMET('brisk').toFixed(3);
      STATE.nutrition.weightKg = 86.2; STATE.profile.weightKg = 86.2;
      setRuckLoad(25);
      /* An unloaded walk is the floor: gross 3.8 minus 1.0 resting. */
      const kg = 86.2, unloadedNet = 3.8 - 1;
      o.unloadedNet = +unloadedNet.toFixed(3);
      o.pct25 = Math.round(ruckLoadPct() * 100);
      setRuckLoad(45); o.pct45 = Math.round(ruckLoadPct() * 100);
      setRuckLoad(25);
      return o;
    });
    /* Net, not gross. stepKcal() is calibrated net of resting, so a gross ruck
       figure would credit ~20% more than was earned — the exact mistake the
       bike's own comment exists to prevent. */
    t.ok('a loaded walk is worth more than an unloaded one', r.met25 > r.unloadedNet, r);
    t.ok('and a heavier plate is worth more again', r.met45 > r.met25, r);
    /* The property a fixed MET table cannot express. */
    t.ok('the same plate is worth LESS to a heavier athlete', r.met45heavy < r.met45, r);
    t.eq('the load share is reported as a percentage of bodyweight', r.pct25, 13);
    t.eq('and moves with the plate', r.pct45, 24);
    /* Sanity against the real world: brisk rucking is 110-120 steps a minute,
       and a figure well outside that means the arithmetic drifted. */
    t.ok('brisk under a 25 lb plate lands near real rucking cadence',
      r.steps25 >= 100 && r.steps25 <= 130, r);
    t.ok('and a 45 lb plate is higher but not absurd',
      r.steps45 > r.steps25 && r.steps45 <= 160, r);
  }
  {
    const r = await page.evaluate(() => {
      STATE.nutrition.weightKg = 86.2; STATE.profile.weightKg = 86.2;
      const o = {};
      setCardioMode('ruck');
      o.mode = cardioMode();
      setRuckLoad(25); setRuckPace('brisk'); setRuckUnit('min'); setRuckVal(45);
      const w = ruckWork();
      o.min = w.min; o.steps = w.steps; o.kcal = w.kcal;
      o.miles = +(w.km * 0.621371).toFixed(2);
      /* Every way of paying the target ADDS. An athlete who walked, rode and
         rucked in one day earned all three — a ruck that replaced the others
         in stepEquivalent() would silently delete work already done. */
      /* Zero the walked steps FIRST. The seeded athlete already has some, so
         SETTING them to 3000 was overwriting a larger number and the delta
         came back negative — the check was measuring its own bad setup. */
      const realSteps = nutToday().steps;
      nutToday().steps = 0;
      const only = stepEquivalent();
      nutToday().steps = 3000;
      o.addsToWalking = stepEquivalent() - only;
      nutToday().steps = realSteps;
      /* Switching currency re-expresses the SAME ruck, it does not
         reinterpret the number: 45 minutes must come back as ~2.4 miles. */
      setRuckUnit('dist');
      o.asDist = +(movement().rval * 0.621371).toFixed(1);
      setRuckUnit('min');
      o.backToMin = movement().rval;
      /* An unknown mode must not be STORED. Reading it back through
         cardioMode() proves nothing — that getter sanitises its own read, so
         it answers 'jacks' whether or not the junk went into STATE and would
         then travel in every backup. Assert on STATE. */
      setCardioMode('helicopter');
      o.junkStored = STATE.nutrition.cardioMode;
      o.junkMode = cardioMode();
      setCardioMode('ruck');
      return o;
    });
    t.eq('ruck is a real cardio mode', r.mode, 'ruck');
    t.eq('45 logged minutes stay 45', r.min, 45);
    /* 3.2 mph for 45 min is 2.4 miles — the pace table and the distance
       conversion have to agree, or the athlete is told a lie either way. */
    t.eq('and cover the distance that pace implies', r.miles, 2.4);
    t.ok('the ruck is worth real steps', r.steps > 4000 && r.steps < 6500, r);
    t.ok('and real calories', r.kcal > 150 && r.kcal < 320, r);
    t.eq('walked steps still count on top of it', r.addsToWalking, 3000);
    t.eq('switching to distance re-expresses the same ruck', r.asDist, 2.4);
    t.eq('and switching back returns the minutes', r.backToMin, 45);
    t.eq('an unknown mode is never written to STATE', r.junkStored, 'jacks');
    t.eq('and reads back as the fallback', r.junkMode, 'jacks');
  }
  {
    /* Junk in the stored plate must not travel in a backup. ruckLoadLb()
       clamps its own read, so asserting on the OUTPUT proves nothing — assert
       the junk is gone from STATE. */
    const r = await page.evaluate(() => {
      const o = {};
      STATE.profile.ruckLb = 9999; normalizeState();
      o.absurd = STATE.profile.ruckLb;
      STATE.profile.ruckLb = 'heavy'; normalizeState();
      o.stringy = STATE.profile.ruckLb;
      STATE.profile.ruckLb = -5; normalizeState();
      o.negative = STATE.profile.ruckLb;
      STATE.profile.ruckLb = 30; normalizeState();
      o.valid = STATE.profile.ruckLb;
      STATE.profile.ruckPace = 'Brisk'; normalizeState();   // capital B is not a pace
      o.badPace = STATE.profile.ruckPace;
      STATE.profile.ruckPace = 'hills'; normalizeState();
      o.goodPace = STATE.profile.ruckPace;
      return o;
    });
    t.eq('an absurd plate is dropped', r.absurd, undefined);
    t.eq('a string plate is dropped', r.stringy, undefined);
    t.eq('a negative plate is dropped', r.negative, undefined);
    t.eq('a real plate survives untouched', r.valid, 30);
    t.eq('a pace that is not in the list is dropped', r.badPace, undefined);
    t.eq('and a real one survives', r.goodPace, 'hills');
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
