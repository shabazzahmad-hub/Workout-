/* Suite 13 — the four feedback loops.

   Each of these exists because the app was confidently doing something without
   ever checking the result: prescribing calories it never verified against the
   scale, prescribing movements with no way to say one hurt, rewriting six weeks
   of targets from a single bad morning, and advancing a 378-session pointer on
   a tap that could not be taken back. */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

export default async function run() {
  const t = suite('feedback loops');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  /* ============ 1. does the calorie target actually work? ================= */
  {
    const r = await page.evaluate(() => {
      const out = {};
      const iso = d => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
      const setup = (startKg, perWeek, weeks, every) => {
        STATE.measurements = [];
        for (let d = weeks * 7; d >= 0; d -= (every || 7))
          STATE.measurements.push({ date: iso(d), weight: +(startKg - perWeek * ((weeks * 7 - d) / 7)).toFixed(2) });
        const n = nut();
        n.sex = 'male'; n.age = 38; n.heightCm = 178; n.weightKg = startKg; n.activity = 1.45;
        n.goal = 'lose'; n.kcalAdj = 0; delete n.kcalAdjAt;
        recalcKcalFromStored();
      };

      // too little data
      setup(88, 0.5, 2); out.twoWeeks = calorieCheck();
      STATE.measurements = STATE.measurements.slice(0, 2); out.twoPoints = calorieCheck();

      // losing at roughly the planned rate
      setup(88, 0, 8);
      const n = nut();
      const planned = (n.tdee - n.kcalTarget) * 7 / 7700;   // kg/week the plan expects
      setup(88, planned, 8);
      out.onTrack = (c => c && c.verdict)(calorieCheck());

      // not moving at all
      setup(88, 0, 8);
      const stalled = calorieCheck();
      out.stalled = stalled && stalled.verdict;
      out.stalledStep = stalled && stalled.step;
      out.targetBefore = nut().kcalTarget;
      if (stalled) applyKcalAdj(stalled.step);
      out.targetAfter = nut().kcalTarget;
      out.adjStored = nut().kcalAdj;

      // and it must not ask again straight away
      out.dueRightAfter = calorieCheckDue();

      // dropping like a stone
      setup(88, planned * 3, 8);
      const fast = calorieCheck();
      out.fast = fast && fast.verdict;
      out.fastStepPositive = fast && fast.step > 0;

      // no deficit prescribed → nothing to verify
      setup(88, 0, 8); nut().goal = 'maintain'; recalcKcalFromStored();
      out.maintain = calorieCheck();

      // the floor still wins
      setup(50, 0, 8);
      nut().goal = 'shred'; nut().kcalAdj = -500; recalcKcalFromStored();
      const bmr = mifflinBMR('male', 50, 178, 38);
      out.floorHeld = nut().kcalTarget >= Math.min(1500, Math.round(Math.max(bmr * 1.1, 1500) / 10) * 10) - 1;
      out.flooredFlag = !!nut().kcalFloored;

      // and the adjustment cannot run away
      nut().kcalAdj = 0;
      for (let i = 0; i < 10; i++) applyKcalAdj(-300);
      out.adjClamped = nut().kcalAdj;
      nut().kcalAdj = 0; delete nut().kcalAdjAt; recalcKcalFromStored();
      return out;
    });
    t.eq('two weeks of data is not a trend', r.twoWeeks, null);
    t.eq('two readings is not a trend', r.twoPoints, null);
    t.eq('losing at the planned rate reads as on track', r.onTrack, 'ontrack');
    t.eq('a stalled scale is detected', r.stalled, 'stalled');
    t.ok('and the suggestion is to eat less', r.stalledStep < 0, r);
    t.ok('applying it lowers the target', r.targetAfter < r.targetBefore, r);
    t.ok('the adjustment is recorded', r.adjStored < 0, r);
    t.ok('it does not ask again immediately', r.dueRightAfter === false, r);
    t.eq('losing far too fast is detected', r.fast, 'fast');
    t.ok('and the suggestion is to eat more', r.fastStepPositive, r);
    t.eq('no deficit prescribed means nothing to check', r.maintain, null);
    t.ok('the safety floor still wins over an adjustment', r.floorHeld, r);
    t.ok('and the floor is reported', r.flooredFlag, r);
    t.eq('the adjustment is clamped', r.adjClamped, -500);

    /* applyKcalAdj clamps on the way in, so that check alone cannot see the
       clamp inside recalcKcalFromStored — removing it survived a mutation.
       A restored backup writes kcalAdj directly, with no clamp in the way. */
    const corrupt = await page.evaluate(() => {
      const n = nut();
      n.sex = 'male'; n.age = 38; n.heightCm = 178; n.weightKg = 88; n.activity = 1.45; n.goal = 'lose';
      n.kcalAdj = 0; recalcKcalFromStored();
      const base = n.kcalTarget;
      n.kcalAdj = 50000; recalcKcalFromStored();
      const huge = n.kcalTarget;
      n.kcalAdj = -50000; recalcKcalFromStored();
      const tiny = n.kcalTarget;
      n.kcalAdj = 0; recalcKcalFromStored();
      return { base, huge, tiny, storedAfterHuge: huge, floorFlag: !!n.kcalFloored };
    });
    t.ok('an absurd stored adjustment cannot inflate the target',
      corrupt.huge <= corrupt.base + 510, corrupt);
    t.ok('nor starve it', corrupt.tiny >= 1200, corrupt);
  }

  /* ==== 1b. a goal whose success looks like a FLAT scale ==================
     'recomp' prescribed 0.9x maintenance while its own note promised fat loss
     "at the same time" and the picker called it Tone up. The contradiction
     reached the athlete three ways: a ~250 kcal deficit they never chose,
     calorieCheck() reading a held line as stalled and advising a FURTHER cut,
     and the weight chart painting a flat line grey because "good" was
     hardcoded to down for every goal but gain. */
  {
    const r = await page.evaluate(() => {
      const out = {};
      const iso = d => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
      const setup = (goal, perWeek) => {
        STATE.measurements = [];
        for (let d = 56; d >= 0; d -= 4)
          STATE.measurements.push({ date: iso(d), weight: +(86 - perWeek * ((56 - d) / 7)).toFixed(2) });
        const n = nut();
        n.sex = 'male'; n.age = 52; n.heightCm = 178; n.weightKg = 86; n.activity = 1.45;
        n.kcalAdj = 0; delete n.kcalAdjAt;
        setNutGoal(goal);            // writes BOTH goal fields, the way the picker does
        recalcKcalFromStored();
      };
      /* The target itself. Recomposition means the scale holds, so the number
         it prescribes has to BE maintenance — anything else and the other two
         fixes are papering over a deficit the athlete never asked for. */
      setup('recomp', 0);
      out.tdee = nut().tdee;
      out.recompTarget = nut().kcalTarget;
      setup('lose', 0); out.loseTarget = nut().kcalTarget;
      setup('maintain', 0); out.maintainTarget = nut().kcalTarget;
      setup('gain', 0); out.gainTarget = nut().kcalTarget;

      /* THE reported defect: a held scale on a stable goal is the goal being
         met, and must not produce advice to eat less. */
      setup('recomp', 0);
      out.held = calorieCheck();
      setup('recomp', 0.05);           // inside the deadband — a scale never lands on zero
      out.noise = calorieCheck();
      /* ...but silence in BOTH directions is a disable, not a fix. A stable
         goal has an intended rate and it is zero, which is measurable. */
      setup('recomp', -0.3);           // drifting UP
      const up = calorieCheck();
      out.up = up && { v: up.verdict, cut: up.step < 0 };
      out.upHTML = up ? calorieCheckHTML() : '';
      setup('recomp', 0.3);            // drifting DOWN
      const down = calorieCheck();
      out.down = down && { v: down.verdict, raise: down.step > 0 };
      /* The floor: an ordinary cut must still be checked exactly as before. */
      setup('lose', 0);
      const stalled = calorieCheck();
      out.loseStalled = stalled && stalled.verdict;

      /* The chart's colour, read off the painted markup. */
      const chart = (goal, deltaKg) => {
        setup(goal, -deltaKg / 8);     // perWeek over the 8-week window
        const h = weightChartHTML();
        return { green: /var\(--green\)/.test(h), held: /· held/.test(h), drift: /· drifting/.test(h) };
      };
      out.chart = {
        recompHeld: chart('recomp', 0), recompUp: chart('recomp', 3), recompDown: chart('recomp', -3),
        recompNoise: chart('recomp', 0.4),
        loseDown: chart('lose', -3), loseUp: chart('lose', 3),
        gainUp: chart('gain', 3), gainDown: chart('gain', -3),
      };
      nut().kcalAdj = 0; delete nut().kcalAdjAt; setNutGoal('recomp'); recalcKcalFromStored();
      return out;
    });
    /* The target. Pinned against TDEE itself, not a number, so it cannot drift. */
    t.eq('recomposition eats at maintenance, not in a deficit', r.recompTarget, r.tdee);
    t.eq('and so does maintain', r.maintainTarget, r.tdee);
    t.ok('while fat loss is still a real deficit', r.loseTarget < r.tdee - 250, r);
    t.ok('and building is still a real surplus', r.gainTarget > r.tdee + 100, r);
    /* The reported defect. */
    t.eq('a held scale on a stable goal produces no advice to cut', r.held, null);
    t.eq('and neither does ordinary scale noise', r.noise, null);
    /* The other half — without this the check is simply switched off. */
    t.eq('but drifting UP is caught', r.up && r.up.v, 'drift');
    t.ok('and the offer is to eat less', r.up && r.up.cut, r.up);
    t.eq('drifting DOWN is caught too', r.down && r.down.v, 'drift');
    t.ok('and there the offer is to eat more', r.down && r.down.raise, r.down);
    /* The copy has to be the stable-goal copy. "The scale is barely moving" is
       praise on this goal, so the stalled wording would say the opposite of
       what it means. */
    t.ok('drift gets its own wording, not the stalled copy',
      /drifting up/.test(r.upHTML) && !/barely moving/.test(r.upHTML), r.upHTML.slice(0, 160));
    /* The floor: the goals that were already right must stay right. */
    t.eq('an ordinary cut that stalls is still caught', r.loseStalled, 'stalled');
    /* The chart. A flat line is the WIN on this goal and read grey. */
    t.ok('a held line is green on a stable goal', r.chart.recompHeld.green, r.chart);
    t.ok('and says so in words, not only in colour', r.chart.recompHeld.held, r.chart);
    t.ok('scale noise still reads as held', r.chart.recompNoise.green, r.chart);
    /* Symmetric on purpose: a sustained drop is an accidental cut, not a
       recomposition, and the athlete is better off knowing. */
    t.ok('drifting up is not green', !r.chart.recompUp.green, r.chart);
    t.ok('and neither is drifting down', !r.chart.recompDown.green, r.chart);
    t.ok('both are named as drift', r.chart.recompUp.drift && r.chart.recompDown.drift, r.chart);
    /* And the goals that were already right. A mutant that made every goal
       stable satisfies every assertion above and fails these. */
    t.ok('a cutting athlete losing weight is still green', r.chart.loseDown.green, r.chart);
    t.ok('a cutting athlete gaining weight is still grey', !r.chart.loseUp.green, r.chart);
    t.ok('a bulking athlete gaining weight is still green', r.chart.gainUp.green, r.chart);
    t.ok('a bulking athlete losing weight is still grey', !r.chart.gainDown.green, r.chart);
    t.ok('and neither goal borrows the stable wording',
      !r.chart.loseDown.held && !r.chart.gainUp.held, r.chart);
  }

  /* ============ 2. "that hurt" =========================================== */
  {
    const r = await page.evaluate(async () => {
      const out = {};
      STATE.pain = []; STATE.profile.limitations = [];
      openPlayer(); await new Promise(z => setTimeout(z, 200));
      const html = document.querySelector('#player').innerHTML;
      out.buttonPresent = /That hurt/.test(html);
      playerHurt(); await new Promise(z => setTimeout(z, 100));
      const menu = document.querySelector('#plHurtMenu');
      out.panelOpen = menu && menu.style.display !== 'none';
      const txt = menu ? menu.textContent : '';
      out.offersSkip = /Skip it/.test(txt);
      out.offersStop = /End the session/.test(txt);
      /* There must be no "carry on through it" option — an app cannot tell a
         tweak from a tear, and offering to continue is the one thing it must
         never do. "Never mind" closes the panel; it does not endorse anything. */
      out.noPushThrough = !/push through|work through|carry on through|it.s fine, continue/i.test(txt);
      out.paused = !PLAYER.running;
      const exId = plCur().exId;
      hurtSkip(); await new Promise(z => setTimeout(z, 150));
      out.recorded = STATE.pain.length === 1 && STATE.pain[0].exId === exId;
      out.hasRegion = !!(STATE.pain[0] && STATE.pain[0].region);
      out.menuClosed = document.querySelector('#plHurtMenu').style.display === 'none';
      return out;
    });
    t.ok('the player offers "That hurt"', r.buttonPresent, r);
    t.ok('the panel opens', r.panelOpen, r);
    t.ok('it pauses the clock the moment they say so', r.paused, r);
    t.ok('it offers to skip', r.offersSkip, r);
    t.ok('it offers to stop', r.offersStop, r);
    t.ok('it never offers to push through', r.noPushThrough, r);
    t.ok('the report is recorded against the exercise', r.recorded, r);
    t.ok('and against the body region', r.hasRegion, r);

    /* Stopping early must never cost the athlete anything — a button that
       punishes you for pressing it does not get pressed. The pointer still
       moves, so nobody repeats the session that hurt them. But since v210 a
       stop before ANY set was logged is recorded as stoppedForPain rather than
       done: it must not claim a workout that did not happen. Stopping AFTER
       real work still commits as a partial session (covered below). */
    const stop = await page.evaluate(async () => {
      try { playerQuit(); } catch (e) {}
      STATE.progressPtr = 3; STATE.pain = [];
      openPlayer(); await new Promise(z => setTimeout(z, 200));
      const before = STATE.progressPtr;
      hurtStop(); await new Promise(z => setTimeout(z, 300));
      const l = STATE.logs[before] || {};
      return { before, after: STATE.progressPtr, done: !!l.done, painStop: !!l.stoppedForPain,
        pain: STATE.pain.length, counted: sessionsDoneCount() };
    });
    t.eq('stopping because of pain still advances the programme', stop.after, stop.before + 1);
    t.ok('the stop is recorded against the session', stop.painStop, stop);
    t.ok('a stop with no work done is not banked as a completed session', !stop.done, stop);
    t.eq('so it never inflates the sessions-done count', stop.counted, 0);
    t.ok('and the pain report is still filed', stop.pain >= 1, stop);
    t.eq('and the pain is recorded', stop.pain, 1);

    const pattern = await page.evaluate(() => {
      const iso = d => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
      STATE.profile.limitations = [];
      STATE.pain = [
        { exId: 'pikepushup', region: 'shoulders', date: iso(3), ptr: 1 },
        { exId: 'dips', region: 'shoulders', date: iso(1), ptr: 2 },
      ];
      const o = { count: painCount('shoulders'), prompt: painPromptHTML() };
      o.offers = /Work around my shoulder/.test(o.prompt);
      /* The copy NAMES the threshold — "Twice is a pattern, not a bad day" —
         so the word and the constant are two copies of one number. The rule
         itself now lives in painPattern(), read by the prompt and by the
         day-90 board; raising PAIN_PATTERN_MIN without rewriting the sentence
         would leave the screen claiming something the code no longer does. */
      o.min = PAIN_PATTERN_MIN;
      o.copySaysTwice = /Twice is a pattern/.test(o.prompt);
      // one report is a bad day, not a pattern
      STATE.pain = [{ exId: 'dips', region: 'shoulders', date: iso(1), ptr: 2 }];
      o.singleReportSilent = painPromptHTML() === '';
      // two reports in the SAME session is still one session
      STATE.pain = [
        { exId: 'dips', region: 'shoulders', date: iso(1), ptr: 2 },
        { exId: 'pikepushup', region: 'shoulders', date: iso(1), ptr: 2 },
      ];
      o.sameSessionCountsOnce = painCount('shoulders') === 1 && painPromptHTML() === '';
      // and something reported eight months ago is not current
      STATE.pain = [
        { exId: 'dips', region: 'shoulders', date: iso(300), ptr: 1 },
        { exId: 'pikepushup', region: 'shoulders', date: iso(280), ptr: 2 },
      ];
      o.oldIgnored = painCount('shoulders') === 0;
      return o;
    });
    t.eq('two separate sessions is a pattern', pattern.count, 2);
    t.ok('and the app offers to work around the joint', pattern.offers, pattern);
    t.ok('and the sentence naming the threshold still matches the constant behind it',
      pattern.min === 2 && pattern.copySaysTwice === true,
      JSON.stringify({ min: pattern.min, saysTwice: pattern.copySaysTwice }));
    t.ok('one report stays quiet', pattern.singleReportSilent, pattern);
    t.ok('twice in one session is still one session', pattern.sameSessionCountsOnce, pattern);
    t.ok('reports from months ago do not count', pattern.oldIgnored, pattern);

    const adopt = await page.evaluate(() => {
      const iso = d => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
      STATE.profile.limitations = [];
      STATE.pain = [
        { exId: 'pikepushup', region: 'shoulders', date: iso(3), ptr: 1 },
        { exId: 'dips', region: 'shoulders', date: iso(1), ptr: 2 },
      ];
      const risky = JOINT_RISK.shoulder || [];
      let before = 0;
      for (let p = 0; p < 30; p++) { const s = buildSession(p); [...s.main, s.finisher].filter(Boolean).forEach(m => { if (risky.includes(m.exId)) before++; }); }
      adoptPainLimit('shoulder');
      let after = 0;
      for (let p = 0; p < 30; p++) { const s = buildSession(p); [...s.main, s.finisher].filter(Boolean).forEach(m => { if (risky.includes(m.exId)) after++; }); }
      const o = { before, after, flagged: STATE.profile.limitations.includes('shoulder'), promptGone: painPromptHTML() === '' };
      STATE.profile.limitations = []; STATE.pain = [];
      return o;
    });
    t.ok('the flag is stored', adopt.flagged, adopt);
    t.ok('the risky movements were being programmed', adopt.before > 0, adopt);
    t.eq('and afterwards they are not', adopt.after, 0);
    t.ok('the prompt stops once it is acted on', adopt.promptGone, adopt);
  }

  /* ============ 3. a bad day is not a new baseline ======================= */
  {
    const r = await page.evaluate(() => {
      const out = {};
      const strong = { plank: 150, side: 95, hollow: 70, lower: 30, push: 48, pull: 22, squat: 62, dyn: 55 };
      const setPrev = () => {
        STATE.baseline = { date: todayISO(), score: 97, level: 'Advanced', testCount: TESTS.length,
          results: Object.assign({}, strong), maxes: Object.assign({}, strong) };
        STATE.reassess = {}; STATE.scoreHistory = [{ date: todayISO(), score: 97, level: 'Advanced', testCount: TESTS.length }];
      };
      // a catastrophic day: everything at a third
      setPrev();
      const bad = {}; Object.keys(strong).forEach(k => bad[k] = Math.round(strong[k] / 3));
      assessState = { idx: 0, results: bad, reassess: 1 };
      finishAssessment();
      out.askedBeforeWriting = !STATE.reassess[1] && !!(assessState && assessState._pending);
      out.sheetAsks = /off day/i.test(document.body.textContent || '');

      // keeping the old numbers must still close the block out
      discardRetest();
      out.keptMaxes = JSON.stringify(STATE.reassess[1] && STATE.reassess[1].maxes) === JSON.stringify(strong);
      out.markedDone = !!(STATE.reassess[1] && STATE.reassess[1].deferred);
      out.blockClosed = reassessGate() !== 1;

      // ...and confirming must genuinely commit the low numbers
      setPrev();
      assessState = { idx: 0, results: bad, reassess: 1 };
      finishAssessment();
      confirmRetest();
      out.committed = !!(STATE.reassess[1] && !STATE.reassess[1].deferred);
      out.committedLow = STATE.reassess[1] && STATE.reassess[1].maxes.plank === bad.plank;

      // a normal wobble commits with no interruption
      setPrev();
      const slight = {}; Object.keys(strong).forEach(k => slight[k] = Math.round(strong[k] * 0.92));
      assessState = { idx: 0, results: slight, reassess: 1 };
      finishAssessment();
      out.smallDropSilent = !!(STATE.reassess[1] && !STATE.reassess[1].deferred) && !(assessState && assessState._pending);

      // the very first baseline has nothing to compare against
      STATE.baseline = null; STATE.reassess = {}; STATE.scoreHistory = [];
      assessState = { idx: 0, results: bad, reassess: 0 };
      finishAssessment();
      out.firstBaselineNeverGated = !!STATE.baseline;

      // and a 5-test history is not comparable with an 8-test one
      STATE.baseline = { date: todayISO(), score: 97, level: 'Advanced', testCount: 5,
        results: Object.assign({}, strong), maxes: Object.assign({}, strong) };
      STATE.reassess = {};
      assessState = { idx: 0, results: bad, reassess: 1 };
      finishAssessment();
      out.mixedBatteryNotCompared = !!(STATE.reassess[1] && !STATE.reassess[1].deferred);
      try { closeSheet(); } catch (e) {}
      return out;
    });
    t.ok('a collapse is queried before anything is written', r.askedBeforeWriting, r);
    t.ok('and the question names it as a possible off day', r.sheetAsks, r);
    t.ok('keeping the old numbers preserves the previous maxes', r.keptMaxes, r);
    t.ok('and still closes the block out', r.markedDone && r.blockClosed, r);
    t.ok('confirming commits the new numbers', r.committed, r);
    t.ok('and they are genuinely the low ones', r.committedLow, r);
    t.ok('an ordinary small drop is not interrupted', r.smallDropSilent, r);
    t.ok('the first ever baseline is never gated', r.firstBaselineNeverGated, r);
    t.ok('a 5-test history is not compared against an 8-test one', r.mixedBatteryNotCompared, r);

    /* Deliberately NOT gated: re-taking the BASELINE (rather than a scheduled
       re-test) is something an athlete chooses to do, and the usual reason is a
       long layoff or an injury — precisely when much lower numbers are the
       truth and the whole point of redoing it. Gating that would argue with
       someone who already knows. */
    const retake = await page.evaluate(() => {
      const strong = { plank: 150, side: 95, hollow: 70, lower: 30, push: 48, pull: 22, squat: 62, dyn: 55 };
      STATE.baseline = { date: todayISO(), score: 97, level: 'Advanced', testCount: TESTS.length,
        results: Object.assign({}, strong), maxes: Object.assign({}, strong) };
      STATE.reassess = {}; STATE.scoreHistory = [];
      const bad = {}; Object.keys(strong).forEach(k => bad[k] = Math.round(strong[k] / 3));
      assessState = { idx: 0, results: bad, reassess: 0 };
      finishAssessment();
      const o = { committed: STATE.baseline.maxes.plank === bad.plank, pending: !!(assessState && assessState._pending) };
      try { closeSheet(); } catch (e) {}
      return o;
    });
    t.ok('re-taking the baseline itself is never gated', retake.committed && !retake.pending, retake);
  }

  /* ============ 4. undo a committed session ============================== */
  {
    await seedAthlete(page);
    const r = await page.evaluate(async () => {
      const out = {};
      STATE.progressPtr = 5; STATE.adapt = 1.05; STATE.logs = {}; STATE.achievements = {};
      const before = { ptr: STATE.progressPtr, adapt: STATE.adapt, logs: Object.keys(STATE.logs).length };
      /* A zero-work session is refused since v210 — skipping everything must
         not bank a session. These blocks are about the commit that FOLLOWS
         real work, so log a movement first, exactly as the athlete would. */
      { const _s = buildSession(STATE.progressPtr); if (_s.main[0]) toggleEx(_s.main[0].exId); }
      commitSession('easy');
      await new Promise(z => setTimeout(z, 400));
      out.advanced = STATE.progressPtr === before.ptr + 1;
      out.adaptMoved = STATE.adapt !== before.adapt;
      out.offered = /Undo/.test([...document.querySelectorAll('.view.active')].map(v => v.textContent).join(' '));
      undoSession();
      await new Promise(z => setTimeout(z, 200));
      out.ptrBack = STATE.progressPtr === before.ptr;
      out.adaptBack = Math.abs(STATE.adapt - before.adapt) < 1e-9;
      out.logGone = !(STATE.logs[before.ptr] && STATE.logs[before.ptr].done);
      out.undoCleared = !undoInfo();
      out.bannerGone = undoBannerHTML() === '';
      return out;
    });
    t.ok('committing advances the pointer', r.advanced, r);
    t.ok('and moves the adaptive load', r.adaptMoved, r);
    t.ok('undo is offered', r.offered, r);
    t.ok('undo puts the pointer back', r.ptrBack, r);
    t.ok('and restores the adaptive load exactly', r.adaptBack, r);
    t.ok('and un-marks the session', r.logGone, r);
    t.ok('and cannot be used twice', r.undoCleared && r.bannerGone, r);

    const scope = await page.evaluate(() => {
      const out = {};
      STATE.progressPtr = 9;
      STATE._undo = { ptr: 8, key: '1-1', at: Date.now(), date: todayISO(), log: null, adapt: 1, weekFeel: null, comeback: null, achievements: {} };
      out.validNow = !!undoInfo();
      STATE._undo.date = '2001-01-01';
      out.yesterdayRefused = !undoInfo();
      STATE._undo.date = todayISO(); STATE._undo.ptr = 3;
      out.olderSessionRefused = !undoInfo();
      STATE._undo = 'garbage'; normalizeState();
      out.junkDropped = STATE._undo === undefined && !undoInfo();
      return out;
    });
    t.ok('the last session today can be undone', scope.validNow, scope);
    t.ok('but not one from a previous day', scope.yesterdayRefused, scope);
    t.ok('and not one further back than the last', scope.olderSessionRefused, scope);
    t.ok('a junk undo record is dropped, not obeyed', scope.junkDropped, scope);

    const ach = await page.evaluate(async () => {
      STATE.progressPtr = 20; STATE.logs = {}; STATE.achievements = {};
      /* A zero-work session is refused since v210 — skipping everything must
         not bank a session. These blocks are about the commit that FOLLOWS
         real work, so log a movement first, exactly as the athlete would. */
      { const _s = buildSession(STATE.progressPtr); if (_s.main[0]) toggleEx(_s.main[0].exId); }
      const before = JSON.stringify(STATE.achievements);
      commitSession('ok');
      await new Promise(z => setTimeout(z, 800));   // checkAchievements runs on a timer
      const during = JSON.stringify(STATE.achievements);
      undoSession();
      await new Promise(z => setTimeout(z, 200));
      return { before, during, after: JSON.stringify(STATE.achievements) };
    });
    t.eq('an achievement unlocked by an undone session is rolled back too', ach.after, ach.before);
  }

  /* ============ 5. today's banners render on any day of the week ========= */
  {
    const r = await page.evaluate(async () => {
      const out = {};
      /* Pointer 0 is day zero of week one, which is where seedAthlete starts and
         where every earlier banner test happened to sit — so a once-a-week gate
         on these was invisible to the suite. Check a mid-week session. */
      const midweek = [];
      for (let p = 0; p < 14; p++) if (posOf(p).dayInWeek !== 0) midweek.push(p);
      out.midweekPtr = midweek[0];
      STATE.progressPtr = midweek[0];
      STATE.logs = {}; STATE.pain = []; delete STATE._undo;
      STATE.profile.limitations = [];

      // the resume breadcrumb
      STATE._plResume = { ptr: STATE.progressPtr, i: 1, s: 0, setsDone: 2, date: todayISO(), ts: Date.now() };
      go('today'); render(); await new Promise(z => setTimeout(z, 120));
      out.resume = /Pick up where I left off/.test(document.querySelector('#v-today').textContent);
      delete STATE._plResume;

      // the pain pattern
      const iso = d => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
      STATE.pain = [
        { exId: 'pikepushup', region: 'shoulders', date: iso(3), ptr: 1 },
        { exId: 'dips', region: 'shoulders', date: iso(1), ptr: 2 },
      ];
      render(); await new Promise(z => setTimeout(z, 120));
      out.pain = /Work around my shoulder/.test(document.querySelector('#v-today').textContent);
      STATE.pain = [];

      // and undo, after a real commit from a mid-week pointer
      const p0 = STATE.progressPtr;
      /* A zero-work session is refused since v210 — skipping everything must
         not bank a session. These blocks are about the commit that FOLLOWS
         real work, so log a movement first, exactly as the athlete would. */
      { const _s = buildSession(STATE.progressPtr); if (_s.main[0]) toggleEx(_s.main[0].exId); }
      commitSession('ok');
      await new Promise(z => setTimeout(z, 400));
      out.committedFrom = p0;
      out.stillMidweek = posOf(p0).dayInWeek !== 0;
      out.undo = /Undo/.test(document.querySelector('#v-today').textContent);
      undoSession();
      await new Promise(z => setTimeout(z, 150));
      return out;
    });
    t.ok('the resume offer shows mid-week, not only on day one', r.resume, r);
    t.ok('the pain pattern shows mid-week', r.pain, r);
    t.ok('the commit under test really was mid-week', r.stillMidweek, r);
    t.ok('undo shows mid-week', r.undo, r);
  }

  /* ============ 6. a backup describes the athlete, not the session ======== */
  {
    const r = await page.evaluate(async () => {
      STATE.progressPtr = 7; STATE.logs = {}; ensureLog();
      STATE._plResume = { ptr: 7, i: 1, s: 0, setsDone: 2, date: todayISO(), ts: Date.now() };
      STATE._undo = { ptr: 6, key: '0-0', at: Date.now(), date: todayISO(), log: null, adapt: 1, weekFeel: null, comeback: null, achievements: {} };
      STATE.pain = [{ exId: 'dips', region: 'shoulders', date: todayISO(), ptr: 1 }];
      STATE.settings = STATE.settings || {}; STATE.settings.azureKey = 'SECRET-A';
      save();
      let blob = null;
      const oc = URL.createObjectURL; URL.createObjectURL = b => { blob = b; return 'blob:x'; };
      const ck = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
      try { await exportData(); } catch (e) { return { err: String(e).slice(0, 150) }; }
      URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = ck;
      if (!blob) return { err: 'no blob' };
      const txt = await blob.text(); const parsed = JSON.parse(txt);
      const o = {
        hasUndo: '_undo' in parsed, hasResume: '_plResume' in parsed,
        leaksKey: txt.includes('SECRET-A'),
        // real history must still be there
        keepsPain: Array.isArray(parsed.pain) && parsed.pain.length === 1,
        keepsLogs: !!parsed.logs, keepsPtr: parsed.progressPtr === 7,
        // and the live session is untouched by having taken a backup
        liveUndoIntact: !!STATE._undo, liveResumeIntact: !!STATE._plResume,
      };
      /* An OLD backup — one written by v195-v198 — still carries them, and
         those files get restored long after this build. */
      const legacy = JSON.parse(JSON.stringify(parsed));
      legacy._undo = { ptr: 6, key: '0-0', at: Date.now(), date: todayISO(), log: null, adapt: 1, weekFeel: null, comeback: null, achievements: {} };
      legacy._plResume = { ptr: 7, i: 1, s: 0, setsDone: 2, date: todayISO(), ts: Date.now() };
      const file = new File([JSON.stringify(legacy)], 'b.json', { type: 'application/json' });
      // importData() now confirms before it commits — a real athlete decides;
      // this test is asserting what a CONFIRMED restore does, same as every
      // other confirm()-gated action in this suite (window.confirm stub).
      const realConfirm = window.confirm; window.confirm = () => true;
      await new Promise(res => {
        const orig = FileReader.prototype.readAsText;
        importData({ target: { files: [file] } });
        const iv = setInterval(() => { if (!('_undo' in STATE) || STATE._importDone) { clearInterval(iv); res(); } }, 60);
        setTimeout(() => { clearInterval(iv); res(); }, 3000);
      });
      window.confirm = realConfirm;
      o.afterLegacyImport = { undo: '_undo' in STATE, resume: '_plResume' in STATE,
        offersUndo: undoBannerHTML() !== '', offersResume: (() => { try { return !!resumeInfo(); } catch (e) { return 'threw'; } })() };
      return o;
    });
    t.ok('export does not write the undo record', r.hasUndo === false, r);
    t.ok('export does not write the resume breadcrumb', r.hasResume === false, r);
    t.ok('and still does not leak an API key', r.leaksKey === false, r);
    t.ok('real history survives the strip', r.keepsPain && r.keepsLogs && r.keepsPtr, r);
    t.ok('taking a backup does not disturb the live session', r.liveUndoIntact && r.liveResumeIntact, r);
    t.ok('a legacy backup carrying them is cleaned on import', r.afterLegacyImport.undo === false && r.afterLegacyImport.resume === false, r);
    t.ok('so a restore never offers to undo a session it did not log', r.afterLegacyImport.offersUndo === false, r);
    t.ok('nor to resume one', r.afterLegacyImport.offersResume === false, r);
  }

  // ---- toggleWeekly() must not report "on" until the permission is actually known
  {
    const r = await page.evaluate(async () => {
      const realNotif = window.Notification;
      const stub = (initial, resolved) => {
        function FakeNotification() {}
        FakeNotification.permission = initial;
        FakeNotification.requestPermission = () => Promise.resolve(resolved);
        window.Notification = FakeNotification;
      };
      const out = {};

      STATE.settings.weeklyOn = false; save();
      stub('default', 'denied');
      toggleWeekly();
      await new Promise(z => setTimeout(z, 50));
      out.deniedLeavesOff = STATE.settings.weeklyOn === false;

      STATE.settings.weeklyOn = false; save();
      stub('default', 'granted');
      toggleWeekly();
      await new Promise(z => setTimeout(z, 50));
      out.grantedTurnsOn = STATE.settings.weeklyOn === true;

      window.Notification = realNotif;
      STATE.settings.weeklyOn = undefined; save();
      return out;
    });
    t.ok('a denied permission leaves the Saturday check-in OFF, not silently stuck on', r.deniedLeavesOff, r);
    t.ok('a granted permission does turn it on', r.grantedTurnsOn, r);
  }

  srv.close();
  /* ---- The projection must name the constraint that actually set the date --
     Reported from the phone with a screenshot: a 190 lb athlete asking for
     165 lb in 24 weeks was told

       "Your 24-week target needs a faster pace than is safe —
        this is the quickest healthy route"

     and given January 2028, at 0.3 lb/week. That sentence is FALSE. 25 lb in
     24 weeks is ~1.0 lb/week — 0.55% of bodyweight — and this function's own
     safety cap allows 1.9 lb/week. Safety was never the binding limit. What
     bound was the calorie target: a ~170 kcal deficit supports 0.34 lb/week.

     Same class as v289: the app knew the real reason and printed a different
     one, leaving the athlete nothing to act on. */
  {
    const proj = await page.evaluate(() => {
      const LB = 0.453592;
      const strip = h => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const run = (goal, weeks) => {
        STATE.profile.unit = 'in'; STATE.profile.sex = 'male'; STATE.profile.age = 52;
        STATE.profile.goal = goal; STATE.nutrition.goal = goal;
        STATE.nutrition.sex = 'male'; STATE.nutrition.age = 52;
        STATE.nutrition.heightCm = 178; STATE.nutrition.activity = 1.45;
        STATE.profile.timelineWeeks = weeks;
        STATE.nutrition.weightKg = 190 * LB;
        STATE.measurements = [{ date: new Date().toISOString().slice(0, 10), weight: 190 * LB }];
        STATE.profile.goalWeightLb = 165;
        recalcKcalFromStored();
        const html = projectionHTML();
        return {
          wk: +(html.match(/~(\d+) wk/) || [])[1] || null,
          rate: +(html.match(/~([\d.]+)lb\/wk/) || [])[1] || null,
          text: strip(html),
        };
      };
      const o = {};
      /* THE REPORTED CASE, as it can still arise. The timeframe now SETS the
         deficit (v310), so picking 24 weeks makes 24 weeks — which is the
         point, and the original screenshot's exact state is no longer
         reachable. What remains is an athlete who has OVERRIDDEN their
         calories to something shallower than their own date needs: the
         explanation has to reach them too, and blaming safety would be just
         as false there. */
      o.underfed = (() => { const r = run('lose', 24);
        STATE.nutrition.kcalTarget = STATE.nutrition.tdee - 170;   // hand-set, too shallow
        const html = projectionHTML();
        return { wk: +(html.match(/~(\d+) wk/) || [])[1] || null,
          rate: +(html.match(/~([\d.]+)lb\/wk/) || [])[1] || null, text: strip(html) }; })();
      o.cutting = run('lose', 24);            // a real deficit makes the date
      o.tooFast = run('lose', 8);             // genuinely unsafe
      o.roomy = run('lose', 60);              // no complaint at all
      o.recomp = run('recomp', 24);           // weight-stable by design
      o.maintain = run('maintain', 24);
      /* The app's own safe cap, so the check cannot drift from the code. */
      o.safeCapLbWk = +((190 * LB * 0.01) / LB).toFixed(2);
      return o;
    });

    /* THE REPORTED CASE. The date really does slip — that part was right. */
    t.ok('an under-prescribed deficit still slides the date', proj.underfed.wk > 24, proj.underfed);
    /* And the timeframe, when it IS set, now makes the date instead. */
    t.ok('picking 24 weeks now actually lands on 24 weeks',
      proj.cutting.wk <= 25, proj.cutting);
    /* …but it must NOT be blamed on safety, because safety allows ~1.9 lb/wk
       and the date needs ~1.0. */
    t.ok('and it is no longer blamed on an unsafe pace',
      !/faster pace than is safe/.test(proj.underfed.text), proj.underfed.text.slice(0, 200));
    t.ok('the calorie target is named as the real reason',
      /calories are|below maintenance/i.test(proj.underfed.text), proj.underfed.text.slice(0, 200));
    t.ok('and the athlete is told the pace itself is safe',
      /is a safe pace/i.test(proj.underfed.text), proj.underfed.text.slice(0, 200));
    t.ok('with something to actually do about it',
      /Fat loss|lower your daily target/i.test(proj.underfed.text), proj.underfed.text.slice(0, 200));
    t.ok('guard: the safe cap really is well above the pace needed',
      proj.safeCapLbWk > 1.5, proj);

    /* THE FLOOR THAT KEEPS IT HONEST — a pace that IS unsafe must still say
       so. A fix that simply deleted the safety wording passes everything
       above. */
    t.ok('an 8-week crash target is still called unsafe',
      /faster than is safe/.test(proj.tooFast.text), proj.tooFast.text.slice(0, 200));
    t.ok('and does not blame the calories for it',
      !/calories are/i.test(proj.tooFast.text), proj.tooFast.text.slice(0, 200));

    /* A real deficit makes the date, and one week of Math.ceil rounding is not
       a missed date — complaining about that teaches the athlete to ignore
       this line. */
    t.ok('a real deficit is not complained about at all',
      /Paced to the ~24-week timeline/.test(proj.cutting.text), proj.cutting.text.slice(0, 200));
    t.ok('nor is a roomy timeline',
      /Paced to the ~60-week timeline/.test(proj.roomy.text), proj.roomy.text.slice(0, 200));

    /* A WEIGHT-STABLE GOAL IS NOT AN UNDER-PRESCRIBED CUT. Telling a recomp
       athlete to eat less contradicts the goal they chose (v298) — and the
       arithmetic produced "4158 wk" and a date in the year 2106, which reads
       as broken rather than deliberate. */
    ['recomp', 'maintain'].forEach(g => {
      const r = proj[g];
      t.eq(`${g} projects no date at all`, r.wk, null, r);
      t.ok(`${g} says the goal holds the weight on purpose`,
        /holds your weight steady/i.test(r.text), r.text.slice(0, 200));
      t.ok(`${g} is never told to cut harder`,
        !/lower your daily target/i.test(r.text), r.text.slice(0, 200));
      t.ok(`${g} still offers the switch if they want the scale to move`,
        /Fat loss/.test(r.text), r.text.slice(0, 200));
    });
  }

  /* ---- a bulk is not an under-prescribed cut either (v318) ----------------
     v298 gave recomp and maintain their own answer because the projection was
     telling a weight-stable athlete to eat less. GAIN was left reading the
     cut's copy — the "fixing one instance is not fixing the class" shape this
     repo keeps re-finding.

     Measured on a 190 lb athlete bulking toward 205 lb: the target is 2,740
     against a 2,490 TDEE — a 250 kcal SURPLUS — and the line under the chart
     read "A realistic pace at a moderate deficit."

     And the timeline claim was false on this goal. timelineRateKgWk() returns
     null for gain on purpose, so the target is 2,740 at 12 weeks, at 24 and at
     52 — yet the copy said "Paced to the ~24-week timeline you picked" because
     the projected weeks happened to land near the number. */
  {
    const r = await page.evaluate(() => {
      const set = (goal, goalLb, wk) => {
        Object.assign(STATE.nutrition, { weightKg: 86, goal, sex: 'male', age: 52,
          heightCm: 178, activity: 1.45 });
        Object.assign(STATE.profile, { goal, timelineWeeks: wk, goalWeightLb: goalLb, unit: 'in' });
        STATE.measurements = [{ date: todayISO(), weight: 86, waist: 96 }];
        try { recalcKcalFromStored(); } catch (e) {}
        save();
        const p = kcalTargetPreview();
        return {
          text: (projectionHTML() || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          surplus: p ? Math.round(p.target - p.tdee) : null,
          /* GUARD: on this goal the timeline genuinely does nothing, which is
             the whole reason the old sentence was a lie. */
          timelinePaced: (typeof timelineDeficit === 'function') ? timelineDeficit() : 'n/a',
          targetAt: p ? p.target : null,
        };
      };
      return {
        bulkNoTl: set('gain', 205, null),
        bulk24:   set('gain', 205, 24),
        bulk52:   set('gain', 205, 52),
        conflict: set('gain', 165, 24),   // Gain, with a goal weight BELOW current
        cut24:    set('lose', 165, 24),   // the floor: a real cut is unchanged
      };
    });

    t.ok('guard: the bulk really is eating a surplus', r.bulk24.surplus > 100, r.bulk24);
    t.eq('guard: and the timeline genuinely paces nothing on a bulk',
      r.bulk24.timelinePaced, null, r.bulk24);
    t.eq('guard: so the target is identical at 24 and 52 weeks',
      r.bulk24.targetAt, r.bulk52.targetAt, { a: r.bulk24.targetAt, b: r.bulk52.targetAt });

    t.ok('a bulk is never described as a deficit',
      !/deficit/i.test(r.bulkNoTl.text), r.bulkNoTl.text.slice(0, 200));
    t.ok('it is described as a surplus', /surplus/i.test(r.bulkNoTl.text), r.bulkNoTl.text.slice(0, 200));
    t.ok('and never claims a timeline paced it',
      !/Paced to the/.test(r.bulk24.text), r.bulk24.text.slice(0, 200));
    t.ok('it says plainly that the timeline drives a cut, not a bulk',
      /not a bulk/i.test(r.bulk24.text), r.bulk24.text.slice(0, 200));

    /* The two settings can disagree — the goal weight points the CHART and the
       Fuel goal points the FOOD. Name the contradiction rather than drawing a
       confident line through it. */
    t.ok('a Gain goal with a lower goal weight is called out',
      /settings disagree/i.test(r.conflict.text), r.conflict.text.slice(0, 200));
    t.ok('and it names both places to change it',
      /goal weight/i.test(r.conflict.text) && /Fuel goal/i.test(r.conflict.text),
      r.conflict.text.slice(0, 250));

    /* THE FLOOR. A change that simply muted the cut's copy passes every
       assertion above and breaks the goal most athletes are actually on. */
    t.ok('a real cut still says it was paced by its timeline',
      /Paced to the ~24-week timeline/.test(r.cut24.text), r.cut24.text.slice(0, 200));
    t.ok('and is still described as a deficit somewhere',
      r.cut24.surplus < 0, r.cut24);
  }

  /* ---- The timeframe is a PLAN, not a label ------------------------------
     "You should be able to dynamically adjust macros, goals, exercise among
      everything based on those questions of whether you're doing a 12 week
      program, 6 months or a 1 year program."

     `profile.timelineWeeks` had exactly ONE consumer in the whole app: the
     projection chart. It never reached the calorie target, the protein target,
     the conditioning volume or the step goal — so 12 weeks and a year were
     prescribed byte-identical nutrition, and the projection then blamed the
     athlete's own date for being unsafe.

     The check that finds this class is not "does the setting save" — it is
     SET A, fingerprint the plan, SET B, fingerprint again, assert they
     differ. */
  {
    const plan = await page.evaluate(() => {
      const LB = 0.453592;
      const setup = (wks, cond) => {
        STATE.profile.unit = 'in'; STATE.profile.sex = 'male'; STATE.profile.age = 52;
        STATE.profile.goal = 'lose'; STATE.nutrition.goal = 'lose';
        STATE.profile.conditioning = cond || 'moderate';
        STATE.nutrition.sex = 'male'; STATE.nutrition.age = 52;
        STATE.nutrition.heightCm = 178; STATE.nutrition.activity = 1.45;
        STATE.nutrition.weightKg = 190 * LB;
        STATE.profile.timelineWeeks = wks || null;
        STATE.measurements = [{ date: new Date().toISOString().slice(0, 10),
          weight: 190 * LB, bodyfat: 27 }];
        STATE.profile.goalWeightLb = 165;
        delete STATE.nutrition.proteinTarget; delete STATE.nutrition._protSeed;
        recalcKcalFromStored();
      };
      /* Fingerprint the CARDIO VOLUME of the real program, over a spread of
         sessions — a single session proves nothing about a multiplier. */
      const cardioVol = () => { let v = 0;
        for (let p = 0; p < 378; p += 9) { const s = buildSession(p);
          if (!s || !s.main) continue;
          [...s.main, s.finisher].filter(Boolean).forEach(m => { const e = EX[m.exId];
            if (e && (e.region === 'cardio' || e.region === 'dynamic')) v += m.sets * m.target; }); }
        return v; };
      const snap = (wks, cond) => { setup(wks, cond); const p = kcalTargetPreview();
        return { kcal: p.target, deficit: p.tdee - p.target, protein: proteinTargetCalc(),
          steps: stepTarget(), cond: condLevel(), vol: cardioVol() }; };
      const o = { short: snap(12), mid: snap(24), long: snap(52), none: snap(0) };
      /* THE FLOOR THAT MUST NOT MOVE: "just starting" is a statement about what
         this body can take, and a deadline does not change it. */
      o.beginner = snap(12, 'low');
      /* THE SAFETY CAP, and finding a case where it BINDS took work: the
         calorie floor (max(BMR x 1.1, 1500)) normally bites first, so at an
         ordinary activity level removing the 1%/week cap changes nothing and
         the mutant walks straight through. It is reachable on a very active
         athlete, where the floor sits far enough below TDEE to leave room. */
      setup(12); STATE.nutrition.activity = 1.75; recalcKcalFromStored();
      const kgNow = latestWeightKg();
      o.capped = { rate: timelineRateKgWk(), safe: kgNow * 0.01,
        raw: (kgNow - projTargetKg()) / 12,
        deficit: timelineDeficit(),
        kcal: kcalTargetPreview().target, floor: kcalTargetPreview().floor,
        tdee: kcalTargetPreview().tdee };
      /* A weight-stable goal is never paced by a date (v298). */
      setup(12); STATE.profile.goal = 'recomp'; STATE.nutrition.goal = 'recomp';
      recalcKcalFromStored();
      o.recompShort = { kcal: kcalTargetPreview().target, deficit: timelineDeficit(),
        steps: stepTarget(), cond: condLevel() };
      setup(52); STATE.profile.goal = 'recomp'; STATE.nutrition.goal = 'recomp';
      recalcKcalFromStored();
      o.recompLong = { kcal: kcalTargetPreview().target };
      return o;
    });

    /* CALORIES — the direct answer to "can I do this in 6 months". */
    t.ok('a 12-week plan eats less than a 6-month plan',
      plan.short.kcal < plan.mid.kcal, plan);
    t.ok('and a 6-month plan eats less than a year',
      plan.mid.kcal < plan.long.kcal, plan);
    t.ok('the year-long plan is a genuinely gentler cut',
      plan.long.deficit < plan.mid.deficit - 100, plan);

    /* PROTEIN — and asserted on the number that REACHES the athlete, because
       the lean-mass ceiling decides for most bodies (v299). */
    t.ok('a hard timeline raises the protein target', plan.short.protein > plan.long.protein, plan);
    t.eq('and a gentle one leaves it at the goal default',
      plan.long.protein, plan.none.protein, plan);

    /* STEPS and CONDITIONING. */
    t.ok('a hard timeline raises the step goal', plan.short.steps > plan.long.steps, plan);
    t.eq('a hard timeline raises conditioning one notch', plan.short.cond, 'high', plan);
    t.eq('a gentle one leaves it alone', plan.long.cond, 'moderate', plan);
    /* The training itself must actually differ — a setting that stores a value
       nothing reads is exactly the defect being fixed. */
    t.ok('and the real program carries more cardio volume',
      plan.short.vol > plan.long.vol, { short: plan.short.vol, long: plan.long.vol });

    /* THE SAFETY CAP. A date can never buy a faster cut than 1% of bodyweight
       a week — the same limit the projection uses, so the two can never
       disagree about what is possible. */
    t.ok('guard: the raw pace this date asks for really is above the cap',
      plan.capped.raw > plan.capped.safe, plan.capped);
    t.ok('guard: and the calorie floor is NOT what is binding here',
      plan.capped.kcal > plan.capped.floor, plan.capped);
    t.eq('the timeline rate is capped at 1% of bodyweight a week',
      Math.round(plan.capped.rate * 1000), Math.round(plan.capped.safe * 1000), plan.capped);
    t.eq('and the deficit that reaches the athlete is the capped one',
      plan.capped.deficit, Math.round(plan.capped.safe * 7700 / 7), plan.capped);

    /* THE FLOORS. */
    t.eq('"just starting" keeps its conditioning level even on a deadline',
      plan.beginner.cond, 'low', plan.beginner);
    t.ok('and its program stays lighter than a moderate athlete\'s',
      plan.beginner.vol < plan.short.vol, { beginner: plan.beginner.vol, short: plan.short.vol });
    t.eq('a weight-stable goal is never paced by a date', plan.recompShort.deficit, null, plan.recompShort);
    t.eq('so 12 weeks and a year prescribe the same calories on recomp',
      plan.recompShort.kcal, plan.recompLong.kcal, plan);
    t.eq('and it never raises conditioning either', plan.recompShort.cond, 'moderate', plan.recompShort);
  }

  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
