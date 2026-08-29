/* THE CLOCK BASE. v380 moved every timer stamp — t0, pauseAt, deadline,
   phaseAt, lastTick — onto performance.now(), because Date.now() moves when
   the phone corrects itself and a 3-second hold was being recorded as 3,602.
   So a synthetic timestamp here must come from monoNow() too: feeding a
   wall-clock value to a monotonic reader compares two time bases twelve orders
   of magnitude apart, and every check in this file fails on correct code.
   `pausedMs` is a DURATION in milliseconds and is unaffected. */
/* The session clock.

   Two things are in tension here and both have to hold.

   Accountability: a session that should take 25 minutes and takes 55 should say
   so while there is still time to do something about it, not afterwards. The
   finish screen used to label time-under-tension as "Time", which flattered
   every session that had a ten-minute phone break in the middle of it.

   Fairness: pause has to stay available at every phase and must never be
   rationed or penalised, because a real interruption is not slacking. So paused
   time is excluded from the clock and banked separately, where it is visible
   but not held against the work.

   Time is faked by moving PLAYER.t0 and PLAYER.pauseAt rather than by sleeping,
   so these checks are deterministic and do not add a minute to the suite. */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

export default async function run() {
  const t = suite('session clock');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  // ---- the budget ----------------------------------------------------------
  const budget = await page.evaluate(() => {
    const o = {};
    openPlayer();
    o.set = PLAYER.budget;
    o.positive = PLAYER.budget > 0;
    // it must agree with the estimate the rest of the app already shows, or the
    // athlete is held to a number no other screen ever told them
    o.sessionVolume = sessionVolume(PLAYER.sess).minutes;
    o.agrees = PLAYER.budget === o.sessionVolume;
    o.plausible = PLAYER.budget >= 10 && PLAYER.budget <= 90;
    playerQuit();
    // a free session has no sess.main, and used to have no estimate anywhere
    openPlayer({ items: [
      { exId: 'pushup', unit: 'reps', target: 12, sets: 3, rest: 60 },
      { exId: 'plank', unit: 'time', target: 45, sets: 3, rest: 45 },
    ], free: true, title: 'Weights' });
    o.freeBudget = PLAYER.budget;
    o.freeHasOne = PLAYER.budget > 0;
    /* Worked by hand: 3×12 reps at the 3 s default tempo is 108 s, 3×45 s of
       plank is 135 s, rest is 3×60 + 3×45 = 315 s. 558 s is 9 min, plus the
       three for getting into position. */
    o.freeExpected = Math.round((3 * 12 * 3 + 3 * 45 + 3 * 60 + 3 * 45) / 60) + 3;
    o.freeMatches = PLAYER.budget === o.freeExpected;
    playerQuit();
    // a longer session must budget more than a shorter one
    openPlayer({ items: [{ exId: 'pushup', unit: 'reps', target: 12, sets: 8, rest: 90 }], free: true });
    o.longer = PLAYER.budget;
    playerQuit();
    openPlayer({ items: [{ exId: 'pushup', unit: 'reps', target: 12, sets: 2, rest: 30 }], free: true });
    o.shorter = PLAYER.budget;
    playerQuit();
    o.monotonic = o.longer > o.shorter;
    // an empty or nonsense item list must not produce a zero or NaN budget
    o.emptySafe = plBudgetMin([], 3) >= 5;
    o.junkSafe = plBudgetMin([{ exId: 'x', unit: 'reps' }], 3) >= 5
      && isFinite(plBudgetMin([{ exId: 'x', unit: 'reps' }], 3));
    return o;
  });
  t.ok('a session gets a time budget', budget.positive, budget);
  t.ok('and it agrees with the estimate the rest of the app shows', budget.agrees, budget);
  t.ok('the budget is a believable session length', budget.plausible, budget);
  t.ok('a bonus session gets a budget too, despite having no program session', budget.freeHasOne, budget);
  t.eq('and it is the hand-worked figure', budget.freeBudget, budget.freeExpected, budget);
  t.ok('more work budgets more time', budget.monotonic, budget);
  t.ok('an empty item list still yields a usable budget', budget.emptySafe, budget);
  t.ok('so does a malformed one', budget.junkSafe, budget);

  // ---- the clock runs ------------------------------------------------------
  const runs = await page.evaluate(() => {
    const o = {};
    openPlayer();
    o.mounted = !!document.querySelector('#plClock');
    o.startsAtZero = plWallSec() === 0;
    o.showsBudget = /~\d+m/.test(document.querySelector('#plClock').textContent);
    PLAYER.t0 = monoNow() - 185000;   // 3:05 in
    plClockTick();
    o.at3 = plWallSec();
    o.rendered = document.querySelector('#plClock').textContent;
    o.rendersMinutes = /3:0\d/.test(o.rendered);
    /* The clock must survive a phase change. It lives in the head, which
       plChrome() rebuilds on every exercise — an interval writing to a stale
       node would freeze the display while the session ran on. */
    plEnterReady(false);
    plClockTick();
    o.afterPhase = document.querySelector('#plClock').textContent;
    o.survivesPhaseChange = /3:0\d/.test(o.afterPhase);
    playerQuit();
    return o;
  });
  t.ok('the clock is on screen', runs.mounted, runs);
  t.ok('it starts at zero', runs.startsAtZero, runs);
  t.ok('it shows what the session should take', runs.showsBudget, runs);
  t.ok('it counts wall-clock time', runs.at3 >= 185 && runs.at3 <= 186, runs);
  t.ok('and renders it', runs.rendersMinutes, runs);
  t.ok('it survives a phase change rebuilding the header', runs.survivesPhaseChange, runs);

  // ---- pause is free, and visible ------------------------------------------
  const pause = await page.evaluate(() => {
    const o = {};
    openPlayer();
    PLAYER.t0 = monoNow() - 300000;         // five minutes in
    const before = plWallSec();
    playerToggle();
    o.paused = !PLAYER.running;
    /* Assert the toggle STARTED the pause before faking anything. Every check
       below sets pauseAt by hand to move time along, and that masked whether
       playerToggle() ever set it: deleting the line from the app left this
       whole block green. */
    o.toggleStartsPause = !!PLAYER.pauseAt;
    /* Two minutes go by WHILE PAUSED. Both have to move to model that: the
       session is now seven minutes old and two of them were paused. Only
       backdating pauseAt would have claimed two of the five working minutes
       were really paused, which is a different (and wrong) scenario — the
       first version of this check did exactly that and read the resulting
       drop as the clock failing. */
    PLAYER.t0 = monoNow() - 420000;
    PLAYER.pauseAt = monoNow() - 120000;
    plClockTick();
    o.wallFrozen = plWallSec() === before;   // the clock did NOT advance
    o.pausedCounted = plPausedSec() >= 120;
    o.bannerShown = /PAUSED 2:0\d/.test(document.querySelector('#plPaused').textContent);
    playerToggle();
    o.resumed = PLAYER.running;
    o.bankKept = Math.round(PLAYER.pausedMs / 1000) >= 120;
    o.bannerCleared = document.querySelector('#plPaused').textContent === '';
    // and the clock picks up exactly where it left off, not where it would have been
    o.wallAfterResume = plWallSec();
    o.noCatchUp = Math.abs(o.wallAfterResume - before) <= 1;
    // a second pause adds to the bank rather than replacing it
    playerToggle();
    PLAYER.pauseAt = monoNow() - 60000;
    playerToggle();
    o.banksCumulatively = Math.round(PLAYER.pausedMs / 1000) >= 180;
    playerQuit();
    return o;
  });
  t.ok('the Pause button itself starts the pause', pause.toggleStartsPause, pause);
  t.ok('pausing stops the session clock', pause.wallFrozen, pause);
  t.ok('the paused time is counted', pause.pausedCounted, pause);
  t.ok('and shown while it is happening', pause.bannerShown, pause);
  t.ok('resuming clears the banner', pause.bannerCleared, pause);
  t.ok('the clock resumes where it stopped, with no catch-up jump', pause.noCatchUp, pause);
  t.ok('a second pause adds to the total rather than replacing it', pause.banksCumulatively, pause);

  // ---- and the same thing with no faking at all ----------------------------
  /* Everything above moves PLAYER.t0 and PLAYER.pauseAt by hand, which is fast
     and deterministic and cannot see whether the app sets pauseAt itself —
     deleting that line from playerToggle() left the whole block green. This one
     pauses and waits on the actual clock. It costs the suite under two seconds
     and it is the only check that proves the promise end to end. */
  const held = await page.evaluate(() => {
    openPlayer();
    PLAYER.t0 = monoNow() - 300000;
    playerToggle();
    return { before: plWallSec(), started: !!PLAYER.pauseAt };
  });
  await page.waitForTimeout(1600);
  const held2 = await page.evaluate(() => {
    plClockTick();
    const during = plWallSec();
    playerToggle();
    const after = plWallSec(), banked = Math.round((PLAYER.pausedMs || 0) / 1000);
    playerQuit();
    return { during, after, banked };
  });
  t.ok('real time passing during a pause does not move the clock',
    held2.during === held.before, { ...held, ...held2 });
  t.ok('and it was banked as paused time instead', held2.banked >= 1, { ...held, ...held2 });
  t.ok('the clock is still correct after resuming', held2.after === held.before, { ...held, ...held2 });

  // ---- pause must work at every phase --------------------------------------
  /* The accountability is only fair if stopping is genuinely always available.
     A phase where Pause did nothing — or worse, broke the timer so the session
     could not continue — would make the clock a trap. */
  const phases = await page.evaluate(() => {
    const o = { broken: [] };
    ['ready', 'work', 'rest'].forEach(phase => {
      openPlayer();
      if (phase === 'work') plEnterWork();
      if (phase === 'rest') plEnterRest(60, 'set');
      const at = PLAYER.phase;
      const btn = document.querySelector('#plToggle');
      if (!btn) o.broken.push(phase + ': no pause button');
      playerToggle();
      if (PLAYER.running) o.broken.push(phase + ': did not pause');
      if (PLAYER.tid) o.broken.push(phase + ': left a timer running');
      const label = (document.querySelector('#plToggle') || {}).textContent;
      if (label !== 'Resume') o.broken.push(phase + ': button still says ' + label);
      playerToggle();
      if (!PLAYER.running) o.broken.push(phase + ': did not resume');
      if (!PLAYER.tid) o.broken.push(phase + ': did not restart its timer');
      if (PLAYER.phase !== at) o.broken.push(phase + ': changed phase to ' + PLAYER.phase);
      playerQuit();
    });
    return o;
  });
  t.ok('pause and resume work in every phase, without losing the timer',
    phases.broken.length === 0, phases.broken);

  // ---- the nudges ----------------------------------------------------------
  const nudge = await page.evaluate(() => {
    const o = {};
    openPlayer();
    // under budget: silence
    PLAYER.t0 = monoNow() - (PLAYER.budget * 60 - 120) * 1000;
    plClockTick();
    o.quietUnderBudget = !PLAYER.overNudged;
    // over budget: exactly one nudge, however many ticks go by
    PLAYER.t0 = monoNow() - (PLAYER.budget * 60 + 60) * 1000;
    plClockTick();
    o.nudgedOver = PLAYER.overNudged;
    plClockTick(); plClockTick();
    o.onlyOnce = PLAYER.overNudged === true;
    // the display shifts colour rather than only toasting once
    o.overColoured = /--red|--gold/.test(document.querySelector('#plClock').innerHTML);
    playerQuit();
    // a short pause is nobody's business
    openPlayer();
    playerToggle();
    PLAYER.pauseAt = monoNow() - 60000;
    plClockTick();
    o.quietShortPause = !PLAYER.lastPauseNudge;
    // a long one gets one prompt, and does not then nag every second
    PLAYER.pauseAt = monoNow() - 200000;
    plClockTick();
    o.nudgedLongPause = !!PLAYER.lastPauseNudge;
    const first = PLAYER.lastPauseNudge;
    plClockTick(); plClockTick();
    o.doesNotNag = PLAYER.lastPauseNudge === first;
    /* …but it does come back if the pause keeps going. Compared against a
       sentinel rather than against `first`: the nudge stamps Date.now(), and
       two calls inside the same millisecond made `now > first` false at random. */
    PLAYER.lastPauseNudge = 1000;
    plClockTick();
    o.repeatsEventually = PLAYER.lastPauseNudge > 1e6 && PLAYER.lastPauseNudge >= first;
    // resuming resets it, so the next pause starts from a clean slate
    playerToggle();
    o.resetOnResume = PLAYER.lastPauseNudge === 0;
    playerQuit();
    return o;
  });
  t.ok('under budget, the clock says nothing', nudge.quietUnderBudget, nudge);
  t.ok('going over the budget is called out', nudge.nudgedOver, nudge);
  t.ok('but only once, not on every tick', nudge.onlyOnce, nudge);
  t.ok('and the clock itself changes colour', nudge.overColoured, nudge);
  t.ok('a short pause is left alone', nudge.quietShortPause, nudge);
  t.ok('a long pause gets a prompt', nudge.nudgedLongPause, nudge);
  t.ok('which does not then nag every second', nudge.doesNotNag, nudge);
  t.ok('but does come back if the pause keeps going', nudge.repeatsEventually, nudge);
  t.ok('resuming resets the prompt for next time', nudge.resetOnResume, nudge);

  // ---- the finish screen ---------------------------------------------------
  const done = await page.evaluate(() => {
    const o = {};
    openPlayer();
    PLAYER.t0 = monoNow() - 2400000;      // 40 minutes on a ~23 minute session
    PLAYER.pausedMs = 300000;              // five of them paused
    PLAYER.elapsed = 900;                  // fifteen actually working
    PLAYER.setsDone = 12;
    const budget = PLAYER.budget;
    plEnterDone();
    const html = document.querySelector('#plBody').innerHTML;
    o.frozeWall = PLAYER.wall >= 2090 && PLAYER.wall <= 2105;   // 40 min less the 5 paused
    o.clockStopped = _plClock === null;
    o.headlineIsWallClock = /35:0\d/.test(html);
    o.labelHonest = /On the clock/.test(html) && !/>Time</.test(html);
    o.showsWorking = /15:00 of that was working/.test(html);
    o.showsPaused = /5:00 paused/.test(html);
    o.showsOver = /over/.test(html) && html.includes('~' + budget + ' min');
    o.shareUsesWallClock = /on the clock/.test((_share.l || []).join(' '));
    o.noNaN = !/NaN|undefined/.test(html);
    o.handedOver = !!_lastSessionClock && _lastSessionClock.wall === PLAYER.wall;
    playerQuit();
    return o;
  });
  t.ok('the finish screen freezes the clock rather than letting it climb', done.frozeWall, done);
  t.ok('and stops the interval', done.clockStopped, done);
  t.ok('the headline number is the wall clock', done.headlineIsWallClock, done);
  t.ok('it is no longer labelled just "Time"', done.labelHonest, done);
  t.ok('it says how much of that was working', done.showsWorking, done);
  t.ok('and how much was paused', done.showsPaused, done);
  t.ok('and how it compares to what the session should take', done.showsOver, done);
  t.ok('a shared card quotes the wall clock, not time under tension', done.shareUsesWallClock, done);
  t.ok('nothing renders as NaN', done.noNaN, done);
  t.ok('the figures are handed to the commit step', done.handedOver, done);

  // ---- an under-budget session is not scolded ------------------------------
  const under = await page.evaluate(() => {
    openPlayer();
    PLAYER.t0 = monoNow() - 600000;   // ten minutes on a ~23 minute session
    PLAYER.elapsed = 540; PLAYER.setsDone = 12;
    plEnterDone();
    const html = document.querySelector('#plBody').innerHTML;
    const o = { under: /under/.test(html), notOver: !/\d+ over/.test(html),
      noPausedLine: !/paused/.test(html), green: /--green/.test(html) };
    playerQuit();
    return o;
  });
  t.ok('a fast session is told it came in under', under.under, under);
  t.ok('and is not told it went over', under.notOver, under);
  t.ok('a session with no pauses does not mention pausing', under.noPausedLine, under);
  t.ok('and it reads as a good result, not a warning', under.green, under);

  // ---- it reaches the log --------------------------------------------------
  const logged = await page.evaluate(() => {
    const o = {};
    STATE.progressPtr = 0; STATE.logs = {};
    openPlayer();
    PLAYER.t0 = monoNow() - 1800000; PLAYER.pausedMs = 120000;
    PLAYER.elapsed = 800; PLAYER.setsDone = 10;
    plEnterDone();
    playerQuit();
    /* v210 refuses a session with no logged work; this block is about the
       CLOCK figures on a genuine commit, so record a movement first. */
    { const _s = buildSession(STATE.progressPtr); if (_s.main[0]) toggleEx(_s.main[0].exId); }
    commitSession('right');
    const l = Object.values(STATE.logs).find(x => x && x.done);
    o.log = l && { durSec: l.durSec, pausedSec: l.pausedSec, workSec: l.workSec, budgetMin: l.budgetMin };
    o.stored = !!(l && l.durSec > 0 && l.budgetMin > 0);
    o.durIsWallClock = l && l.durSec >= 1670 && l.durSec <= 1690;   // 30 min less the 2 paused
    o.pausedStored = l && l.pausedSec >= 119 && l.pausedSec <= 121;
    o.survivesSave = (() => { save(); normalizeState();
      const r = Object.values(STATE.logs).find(x => x && x.done);
      return r && r.durSec === l.durSec; })();
    // and it must not be re-applied to the next session that commits
    o.consumed = _lastSessionClock === null;
    STATE.logs = {}; STATE.progressPtr = 0; save();
    return o;
  });
  t.ok('the session duration is written to the log', logged.stored, logged.log);
  t.ok('and it is the wall clock, not the working time', logged.durIsWallClock, logged.log);
  t.ok('the paused total is kept too', logged.pausedStored, logged.log);
  t.ok('it survives a save and a normalize', logged.survivesSave, logged);
  t.ok('and is not re-applied to the next session', logged.consumed, logged);

  // ---- no leaked intervals -------------------------------------------------
  /* An orphaned interval is not hypothetical here: the comment in openPlayer
     records a previous one that made the clock run at double speed. */
  const leaks = await page.evaluate(() => {
    const o = {};
    openPlayer(); const first = _plClock;
    openPlayer();                       // opened again without quitting
    o.replaced = _plClock !== first && _plClock !== null;
    playerQuit();
    o.stoppedOnQuit = _plClock === null;
    openPlayer(); playerTeardown();
    o.stoppedOnTeardown = _plClock === null;
    // and a tick with no player must not throw
    let threw = false;
    try { plClockTick(); plNudge(); plWallSec(); plPausedSec(); } catch (e) { threw = true; }
    o.tickWithoutPlayerSafe = !threw;
    return o;
  });
  t.ok('opening the player twice does not leave two clocks running', leaks.replaced, leaks);
  t.ok('quitting stops the clock', leaks.stoppedOnQuit, leaks);
  t.ok('so does tearing the player down', leaks.stoppedOnTeardown, leaks);
  t.ok('a tick with no session running is harmless', leaks.tickWithoutPlayerSafe, leaks);

  /* ---- The pointer gate is a DEFERRAL, never a cancellation --------------
     whenPointerFree() holds a timer-driven DOM swap until the finger lifts, so
     a tap is never destroyed mid-press. It could hold it FOREVER.

     A touch takes implicit pointer capture on whatever it landed on. When a
     timer replaces that element — plAfterSet() rewrites #plBody with no gate
     of its own — the pointerup fires at a node that is no longer in the
     document and never reaches the listener. `_ptrDown` stuck true, and every
     later whenPointerFree() call queued a callback nothing would ever run.

     Reported from the phone: "after the rest period it just shuts off rather
     than going into the next set". It had not shut off. plRestDone() was in
     that queue, and so was every ivStep() after it. */
  {
    const gate = await page.evaluate(async () => {
      const o = {};
      const host = document.createElement('div'); document.body.appendChild(host);
      const orphan = () => {
        host.innerHTML = '<button id="pb">t</button>';
        const b = document.getElementById('pb');
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        host.innerHTML = '';                       // the swap the gate exists for
        b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        return b;                                  // detached: never reaches document
      };

      orphan();
      let ran = false; whenPointerFree('pl', () => { ran = true; });
      /* GUARD: the callback really was deferred, or every assertion below
         passes on a gate that was never armed at all. */
      o.wasDeferred = !ran;
      await new Promise(r => setTimeout(r, 1400));
      o.watchdogRan = ran;

      /* A NEW tap proves the old one is over, whatever became of its
         pointerup — so the queue must not have to wait out the watchdog. */
      orphan();
      let ran2 = false; whenPointerFree('pl', () => { ran2 = true; });
      o.stillDeferred = !ran2;
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await new Promise(r => setTimeout(r, 30));
      o.freshTapFlushed = ran2;
      document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

      /* THE FLOOR. With no finger down the callback runs at once — a gate that
         simply always deferred would satisfy everything above while adding
         most of a second to every phase change in the app. */
      let ran3 = false; whenPointerFree('pl', () => { ran3 = true; });
      o.freePointerIsImmediate = ran3;
      /* And an ordinary completed tap still defers, then runs on the pointerup
         rather than on the watchdog. */
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      let ran4 = false; whenPointerFree('pl', () => { ran4 = true; });
      o.normalTapDefers = !ran4;
      document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      await new Promise(r => setTimeout(r, 30));
      o.normalTapRuns = ran4;
      host.remove();
      return o;
    });
    t.ok('guard: a queued callback really is deferred while a finger is down', gate.wasDeferred, gate);
    t.ok('an orphaned pointerdown cannot strand the queue for ever', gate.watchdogRan, gate);
    t.ok('guard: the second case was deferred too', gate.stillDeferred, gate);
    t.ok('and a fresh tap flushes it without waiting for the watchdog', gate.freshTapFlushed, gate);
    t.ok('with no finger down the callback runs immediately', gate.freePointerIsImmediate, gate);
    t.ok('an ordinary tap still defers the swap', gate.normalTapDefers, gate);
    t.ok('and runs it the moment the finger lifts', gate.normalTapRuns, gate);
  }

  // ---- HIIT: the pause label is DERIVED, not hardcoded ---------------------
  /* ivRenderStep() rebuilds the whole body, and hiitSkip() reaches it while
     paused — so a hardcoded "Pause" told the athlete a frozen round was live.
     Both of the guided player's twins already fixed this (plEnterReady and
     plEnterRest each fall back to 'Resume'); the third surface never got it.
     Measured before the fix: after a paused skip the button read "Pause" with
     INTV.running false and no interval running, and tapping it RESUMED and
     re-labelled to "Pause" — the same word either side of the tap. */
  {
    const r = await page.evaluate(() => {
      const read = () => ({
        toggle: (document.querySelector('#ivToggle') || {}).textContent || null,
        bar: (document.querySelector('#ivPaused') || {}).textContent,
        running: INTV ? INTV.running : null,
        tid: INTV ? !!INTV.tid : null,
        i: INTV ? INTV.i : null });
      const o = {};
      startHiitSpecial('tabata'); ivClear();
      INTV.lead = 1; ivTickLead(); ivClear();          // -> the first work step
      o.work = read();
      hiitToggle(); o.paused = read();                 // pause
      hiitSkip();   o.skipped = read();                // rebuild the body WHILE paused
      hiitToggle(); o.resumed = read();                // and the tap must resume
      hiitQuit();
      // THE FLOOR: a skip that was never paused still reads Pause and runs.
      startHiitSpecial('tabata'); ivClear();
      INTV.lead = 1; ivTickLead(); ivClear();
      hiitSkip(); o.liveSkip = read();
      hiitQuit();
      return o;
    });
    t.eq('guard: the HIIT round starts live and labelled Pause', r.work.toggle, 'Pause', r.work);
    t.eq('guard: and it starts with no paused line', r.work.bar, '', r.work);
    t.eq('pausing HIIT labels the button Resume', r.paused.toggle, 'Resume', r.paused);
    t.eq('and says PAUSED on the glass', r.paused.bar, 'PAUSED', r.paused);
    t.eq('guard: skipping while paused really advanced the step', r.skipped.i, r.paused.i + 1, r);
    t.eq('guard: and left the round genuinely frozen', r.skipped.tid, false, r.skipped);
    t.eq('a rebuilt body still says Resume, not Pause', r.skipped.toggle, 'Resume', r.skipped);
    t.eq('and still says PAUSED', r.skipped.bar, 'PAUSED', r.skipped);
    t.eq('tapping it then resumes', r.resumed.toggle, 'Pause', r.resumed);
    t.eq('and the clock really starts again', r.resumed.tid, true, r.resumed);
    t.eq('and the paused line clears', r.resumed.bar, '', r.resumed);
    /* THE FLOOR. A label that always read Resume, or a PAUSED line that always
       showed, satisfies every assertion above and is worse than the defect. */
    t.eq('a skip on a RUNNING round still reads Pause', r.liveSkip.toggle, 'Pause', r.liveSkip);
    t.eq('and shows no paused line', r.liveSkip.bar, '', r.liveSkip);
    t.eq('and is still ticking', r.liveSkip.tid, true, r.liveSkip);
  }


  /* ---- a rest that expired off-screen must not need a TAP (v350) ----------
     Reported from the phone: "the rest timer comes down and the exercise does
     not start the second set, you manually have to press to start the second
     set." NOT reproduced by driving the chain — work -> rest -> ready -> work
     completes with no tap, and the v307 stuck-pointer case is rescued by its
     watchdog. What the player DID depend on was its interval continuing to
     fire, which a backgrounded tab or a locked screen does not guarantee. Every
     phase is anchored to a wall-clock deadline, so a tick that fires late
     catches up; a tick that never fires again catches up never. */
  {
    const rs = await page.evaluate(async () => {
      const keep = { si: window.setInterval, ci: window.clearInterval, now: Date.now,
                     perf: performance.now.bind(performance),
                     speak: window.coachSpeak, beep: window.beep, go: window.beepGo };
      let fn = null, id = 0;
      window.setInterval = (f, ms) => (ms === 1000 || ms === 100)
        ? (fn = f, ++id) : keep.si.call(window, f, ms);
      window.clearInterval = i => { if (i && i <= id) fn = null; else keep.ci.call(window, i); };
      /* THE VIRTUAL CLOCK MUST COVER BOTH. v380 moved every timer stamp onto
         performance.now(), so faking only Date.now() no longer advances a
         deadline — the block's whole technique stopped driving the code it
         tests. One `virt` behind both keeps the two bases consistent. */
      let virt = 5000000; Date.now = () => virt; performance.now = () => virt;
      window.coachSpeak = () => true; window.beep = () => {}; window.beepGo = () => {};
      const tick = n => { for (let i = 0; i < n; i++) { virt += 1000; if (fn) fn(); } };
      const o = {};
      const toRest = () => { openPlayer(); tick(6); tick(PLAYER.total + 2); };

      /* 1. The reported case: the interval is killed outright while the screen
            is off, and the rest deadline passes with nothing to advance it. */
      toRest();
      o.reachedRest = PLAYER.phase === 'rest';
      const restLen = PLAYER.remain;
      plClear(); fn = null;                        // the OS reclaims the timer
      virt += (restLen + 20) * 1000;               // 20s past the end of the rest
      o.stuckWhileAway = PLAYER.phase === 'rest' && !fn;   // guard: really stuck
      document.dispatchEvent(new Event('visibilitychange'));
      o.movedOnReturn = PLAYER.phase === 'ready';
      o.tickIsAliveAgain = !!fn;
      tick(4);
      o.secondSetStarted = PLAYER.phase === 'work' && PLAYER.s === 1;
      try { plQuit(true); } catch (e) { try { plClear(); } catch (e2) {} }

      /* 2. FLOOR: a rest with time still on it must NOT be cut short. Coming
            back to the phone is not the same as skipping the rest. */
      toRest();
      const left = PLAYER.remain;
      plClear(); fn = null;
      virt += 5000;                                // only five of forty-odd seconds
      document.dispatchEvent(new Event('visibilitychange'));
      o.stillResting = PLAYER.phase === 'rest';
      o.restCountedRealTimeOnly = left - PLAYER.remain;   // 5, not the whole rest
      try { plQuit(true); } catch (e) { try { plClear(); } catch (e2) {} }

      /* 3. FLOOR: a PAUSED player stays paused. Re-arming a paused session
            would restart a workout the athlete deliberately stopped. */
      toRest();
      playerToggle();                              // pause
      o.paused = PLAYER.running === false;
      const wasRemain = PLAYER.remain;
      virt += 60000;
      document.dispatchEvent(new Event('visibilitychange'));
      o.stayedPaused = PLAYER.running === false && PLAYER.phase === 'rest';
      o.pausedClockDidNotMove = PLAYER.remain === wasRemain;
      try { plQuit(true); } catch (e) { try { plClear(); } catch (e2) {} }

      /* 3b. plArmTick()'s own running guard is reachable only THROUGH another
             running check — plResync() returns early and playerToggle() only
             calls it on the resume branch — so removing it escaped every check
             above. Pin the function's own contract directly rather than
             recording it as equivalent: whoever calls it, it must not start a
             timer on a player that is not running. */
      toRest();
      playerToggle();                              // pause
      plClear(); fn = null;
      plArmTick();
      o.armTickRefusesAPausedPlayer = !fn;
      playerToggle();                              // resume
      o.armTickArmsARunningPlayer = !!fn;
      try { plQuit(true); } catch (e) { try { plClear(); } catch (e2) {} }

      /* 4. FLOOR: with no player at all, a tab switch must do nothing. */
      PLAYER = null;
      let threw = false;
      try { document.dispatchEvent(new Event('visibilitychange')); } catch (e) { threw = true; }
      o.noPlayerNoThrow = !threw;

      /* 5. The ready countdown counts TICKS and the rep cadence accumulates
            elapsed ms — forcing either steals time the athlete has not had. */
      o.resyncSrc = plResync.toString();
      Object.assign(window, { setInterval: keep.si, clearInterval: keep.ci,
                              coachSpeak: keep.speak, beep: keep.beep, beepGo: keep.go });
      Date.now = keep.now; performance.now = keep.perf;
      return o;
    });
    t.ok('guard: the player really reached a rest', rs.reachedRest, rs);
    t.ok('guard: and killing the tick really did strand it there', rs.stuckWhileAway, rs);
    t.ok('coming back to the phone moves an expired rest on', rs.movedOnReturn, rs);
    t.ok('and the tick is running again', rs.tickIsAliveAgain, rs);
    t.ok('so the second set starts with no tap', rs.secondSetStarted, rs);
    t.ok('floor: a rest with time left is NOT cut short', rs.stillResting, rs);
    t.eq('and it only counts the real seconds that passed', rs.restCountedRealTimeOnly, 5, rs);
    t.ok('guard: the pause case really paused', rs.paused, rs);
    t.ok('floor: a paused player stays paused on return', rs.stayedPaused, rs);
    t.ok('and its clock does not move', rs.pausedClockDidNotMove, rs);
    t.ok('floor: no player, no throw', rs.noPlayerNoThrow, rs);
    t.ok('arming the tick refuses a paused player', rs.armTickRefusesAPausedPlayer, rs);
    t.ok('and still arms a running one', rs.armTickArmsARunningPlayer, rs);
    t.ok('the ready countdown is never force-ticked', !/plTickReady\(\)/.test(rs.resyncSrc), rs);
    t.ok('and neither is the rep cadence', !/plTickRep\(\)/.test(rs.resyncSrc), rs);
  }

  await browser.close(); srv.close();
  return t.finish(errors);
}
