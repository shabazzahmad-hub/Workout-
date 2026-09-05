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

  /* ---- and it REACHES THE ATHLETE ---------------------------------------
     The block above pins that the four figures are STORED and survive a save.
     Nothing ever read them. Both surfaces that print a session's minutes — the
     history row on Progress > Strength and the detail sheet — showed
     `~estMin`, which sessionStats() builds from targets x tempo plus
     PRESCRIBED rest, so it knows nothing about transitions, pauses or how long
     the athlete took. Measured on a real 39-minute session: `~27 MINUTES`,
     44% under, with durSec 2340 sitting on the same row.

     A check that the measurement is KEPT is the container. What the athlete
     sees is the payload. */
  const shown = await page.evaluate(() => {
    const o = {};
    const finish = (ptr, mins, paused) => {
      STATE.progressPtr = ptr; _lastSessionClock = null;
      openPlayer();
      PLAYER.t0 = monoNow() - mins * 60000; PLAYER.pausedMs = paused * 60000;
      PLAYER.elapsed = 1500; PLAYER.setsDone = 11;
      plEnterDone(); playerQuit();
      const s = buildSession(ptr);
      [...s.main, s.finisher].filter(Boolean)
        .forEach(m => { for (let i = 0; i < m.sets; i++) toggleSet(m.exId, i); });
      commitSession('right');
      return ptr;
    };
    const sheetOf = p => { openSessionDetail(p); const sh = document.querySelector('#sheet');
      const t = sh ? sh.innerText.replace(/\s+/g, ' ') : ''; closeSheet(); return t; };
    const rowOf = () => { go('progress'); setProgressTab('strength'); render();
      const v = document.querySelector('#v-progress');
      return v ? ((v.innerText.match(/moves · \d+ sets · ~?\d+ min/) || [null])[0]) : null; };

    STATE.logs = {}; STATE.runs = [];
    const p = finish(5, 42, 3);
    const l = STATE.logs[p];
    o.stored = { durSec: l.durSec, pausedSec: l.pausedSec, workSec: l.workSec, budgetMin: l.budgetMin };
    o.realMin = Math.round(l.durSec / 60);
    o.estMin = sessionStats(p, true).estMin;
    o.estMinRow = sessionStats(p).estMin;   // the row calls it without `full`, so it omits the warm-up and cool-down allowance
    o.sheet = sheetOf(p);
    o.row = rowOf();

    /* FLOOR: a log with NO clock — every session written before the clock
       shipped, and every session marked complete off the Today card rather
       than run in the player — must still show the estimate, and must SAY it
       is one. */
    delete l.durSec; delete l.pausedSec; delete l.workSec; delete l.budgetMin;
    o.noClockSheet = sheetOf(p);
    o.noClockRow = rowOf();

    /* THE LEAK. A bonus session set the clock and returned without ever
       committing, so it sat there until the NEXT program session committed.
       Measured before the fix: a 9-minute bonus session, then "Mark session
       complete" on the Today card, recorded durSec 540 and budgetMin 7. */
    STATE.progressPtr = 6; STATE.logs = {}; _lastSessionClock = null;
    const s6 = buildSession(6); const it6 = [...s6.main, s6.finisher].filter(Boolean);
    openPlayer({ items: [{ exId: it6[0].exId, sets: 2, target: 20, unit: 'reps', rest: 45 }],
      free: true, title: 'Bonus' });
    PLAYER.t0 = monoNow() - 9 * 60000; PLAYER.pausedMs = 0;
    PLAYER.elapsed = 400; PLAYER.setsDone = 2;
    o.wasFree = PLAYER.free;
    plEnterDone();
    o.clockAfterBonus = _lastSessionClock;
    playerQuit();
    it6.forEach(m => { for (let i = 0; i < m.sets; i++) toggleSet(m.exId, i); });
    commitSession('right');
    o.leakStamped = STATE.logs[6] ? STATE.logs[6].durSec : 'no log';

    /* AND A CLOCK TAKEN ON ANOTHER SESSION. A player session quit without a
       feel chip leaves the stamp behind exactly as a bonus session used to;
       the pointer is what stops it being applied to a different session. */
    STATE.progressPtr = 7; STATE.logs = {}; _lastSessionClock = null;
    openPlayer();
    PLAYER.t0 = monoNow() - 30 * 60000; PLAYER.pausedMs = 0;
    PLAYER.elapsed = 900; PLAYER.setsDone = 8;
    plEnterDone(); playerQuit();          // finished, never committed
    o.stampPtr = _lastSessionClock ? _lastSessionClock.ptr : null;
    STATE.progressPtr = 9;                 // a DIFFERENT session is committed
    const s9 = buildSession(9);
    [...s9.main, s9.finisher].filter(Boolean)
      .forEach(m => { for (let i = 0; i < m.sets; i++) toggleSet(m.exId, i); });
    commitSession('right');
    o.wrongPtrStamped = STATE.logs[9] ? STATE.logs[9].durSec : 'no log';
    o.clockConsumed = _lastSessionClock;

    /* THE BOOT REPAIR, and the band that must not fire on a real session. */
    const boot = v => { STATE.logs = { 0: { date: todayISO(), completedAt: todayISO(),
      done: true, ex: {}, durSec: v } }; STATE.runs = []; normalizeState();
      return STATE.logs[0].durSec; };
    o.junkDur = ['abc', -1, 1e12, {}, null].map(boot);
    o.realThreeHour = boot(3 * 3600);
    /* A PART CANNOT EXCEED THE WHOLE, read with NO boot behind it — a
       cross-tab adopt replaces STATE and never boots. */
    o.partOverWhole = sessionClockOf({ durSec: 1800, pausedSec: 1e9, workSec: 1e9 });
    STATE.logs = {}; STATE.progressPtr = 0; save();
    return o;
  });

  // Guards: the two numbers have to genuinely differ, or the check is vacuous.
  t.ok('guard: a committed player session really stores a clock',
    shown.stored.durSec > 0 && shown.stored.budgetMin > 0, JSON.stringify(shown.stored));
  t.ok('guard: the measured minutes and the estimate genuinely differ',
    Math.abs(shown.realMin - shown.estMin) >= 5,
    JSON.stringify({ real: shown.realMin, est: shown.estMin }));

  t.ok('the detail sheet prints the minutes that were MEASURED, not the estimate',
    new RegExp('\\b' + shown.realMin + '\\s+MINUTES\\b', 'i').test(shown.sheet),
    shown.sheet.slice(0, 260));
  t.ok('and says what was measured — the clock, the working time and the pause',
    /Measured:/.test(shown.sheet) && /working/.test(shown.sheet) && /paused/.test(shown.sheet),
    shown.sheet.slice(0, 400));
  t.ok('the history row drops the tilde once there is a real figure',
    !!shown.row && shown.row.indexOf('~') < 0 && shown.row.indexOf(shown.realMin + ' min') >= 0,
    JSON.stringify({ row: shown.row, real: shown.realMin }));

  t.ok('FLOOR: a log with no clock still shows the estimate, and says it is one',
    new RegExp('~' + shown.estMin + '\\s+EST\\. MINUTES', 'i').test(shown.noClockSheet),
    shown.noClockSheet.slice(0, 260));
  t.ok('FLOOR: and the row says it is an estimate',
    !!shown.noClockRow && shown.noClockRow.indexOf('~' + shown.estMinRow + ' min') >= 0,
    JSON.stringify({ row: shown.noClockRow, est: shown.estMinRow }));
  t.ok('FLOOR: and it does not claim a measurement it does not have',
    !/Measured:/.test(shown.noClockSheet), shown.noClockSheet.slice(0, 260));

  t.ok('guard: the bonus session really ran as a bonus session', shown.wasFree === true, shown);
  t.eq('a bonus session leaves no clock behind for the next commit',
    shown.clockAfterBonus, null, shown);
  t.eq('so the program session it never ran is not stamped with its 9 minutes',
    shown.leakStamped, undefined, JSON.stringify(shown.leakStamped));

  t.ok('guard: a finished player session stamps the pointer it was taken on',
    shown.stampPtr === 7, JSON.stringify({ ptr: shown.stampPtr }));
  t.eq('and a clock taken on another session is not applied to this one',
    shown.wrongPtrStamped, undefined, JSON.stringify(shown.wrongPtrStamped));
  t.eq('and it is dropped either way, so it cannot travel further',
    shown.clockConsumed, null, JSON.stringify(shown.clockConsumed));

  t.eq('junk in the stored duration is dropped at the boot',
    shown.junkDur, [undefined, undefined, undefined, undefined, undefined],
    JSON.stringify(shown.junkDur));
  t.eq('FLOOR: a real three-hour session survives the band untouched',
    shown.realThreeHour, 3 * 3600, JSON.stringify(shown.realThreeHour));
  t.eq('a part larger than the whole is refused at the read, with no boot behind it',
    shown.partOverWhole && [shown.partOverWhole.paused, shown.partOverWhole.work], [0, 0],
    JSON.stringify(shown.partOverWhole));
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

      /* 2b. TWO RESCUES IN ONE INSTANT COST ONE SECOND, NOT TWO.
             visibilitychange calls plGuardEnsure() and then plResync(), so a
             return that ALSO finds the heartbeat dead runs the guard's own
             pass first and the handler's second. Each forced tick takes
             min(one tick, what the clock says is left), so an extra one always
             removes a second whether or not any real time has passed.

             The two callers are not symmetrical: the guard's is gated on
             timerStalled(), the handler's deliberately is not, because it also
             covers a THROTTLED tick, which is alive rather than stalled. So
             the count of rescues is the thing to pin, not either caller. */
      toRest();
      const left2 = PLAYER.remain;
      plClear(); fn = null;
      _plGuardBeat = performance.now() - 60000;   // the heartbeat is dead too
      const keepResync = plResync;
      let calls = 0;
      plResync = function () { calls++; return keepResync.apply(this, arguments); };
      virt += 5000;
      document.dispatchEvent(new Event('visibilitychange'));
      plResync = keepResync;
      o.rescuesInOneReturn = calls;                        // 2 — guard's, then handler's
      o.twoRescuesStillResting = PLAYER.phase === 'rest';
      o.twoRescuesCostOneSecond = left2 - PLAYER.remain;   // 5, not 10
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
    /* GUARD: the double path really was taken. With one rescue this case is
       the same as the one above and proves nothing about the second. */
    t.eq('guard: a return with a dead heartbeat really runs TWO rescues', rs.rescuesInOneReturn, 2, rs);
    t.ok('and the rest is still running after both', rs.twoRescuesStillResting, rs);
    t.eq('two rescues in one instant still cost only the real seconds', rs.twoRescuesCostOneSecond, 5, rs);
    t.ok('guard: the pause case really paused', rs.paused, rs);
    t.ok('floor: a paused player stays paused on return', rs.stayedPaused, rs);
    t.ok('and its clock does not move', rs.pausedClockDidNotMove, rs);
    t.ok('floor: no player, no throw', rs.noPlayerNoThrow, rs);
    t.ok('arming the tick refuses a paused player', rs.armTickRefusesAPausedPlayer, rs);
    t.ok('and still arms a running one', rs.armTickArmsARunningPlayer, rs);
    t.ok('the ready countdown is never force-ticked', !/plTickReady\(\)/.test(rs.resyncSrc), rs);
    t.ok('and neither is the rep cadence', !/plTickRep\(\)/.test(rs.resyncSrc), rs);
  }

  /* ---------------------------------------------------------------------
     "MIN TRAINED" IS A CALENDAR QUANTITY, AND IT WAS SHOWING TIME UNDER
     TENSION. totalTUT() sums work plus PRESCRIBED rest, so it knows nothing
     about transitions, the walk to the mat, or a pause. Measured across eight
     clocked sessions worth 314 real minutes, the lifetime tile read 152 - 52%
     under, with every one of those sessions carrying a real clock.

     The floor is what keeps the fix honest: a log with NO clock must still
     contribute exactly what it always did, so the figure can only get closer.
     And estCalories() must not move at all - calories count the work, not the
     standing around, so those are two questions and two readers. */
  {
    const lm = await page.evaluate(() => {
      const o = {}, real = JSON.stringify(STATE.logs), ptr = STATE.progressPtr;
      const mins = [42, 38, 45, 33, 40, 36, 44, 36];   // 314 minutes of training
      const build = clocked => {
        STATE.logs = {};
        for (let i = 0; i < 8; i++) {
          const s = buildSession(i);
          const items = s.main.map(m => ({ exId: m.exId, unit: m.unit,
            target: m.target, sets: m.sets, rest: m.rest || 45 }));
          const ex = {};
          items.forEach(m => { ex[m.exId] = { sets: new Array(m.sets).fill(true), done: true }; });
          const row = { done: true, at: Date.now(), completedAt: todayISO(), items, ex };
          if (clocked) {
            row.durSec = mins[i] * 60; row.pausedSec = 0;
            row.workSec = Math.round(mins[i] * 60 * 0.6); row.budgetMin = 25;
          }
          STATE.logs[i] = row;
        }
        STATE.runs = []; STATE.progressPtr = 8;
      };
      o.realMin = mins.reduce((a, b) => a + b, 0);

      build(true);
      o.clocked = totalMinutes();
      o.clockedTUT = totalTUT();
      o.clockedKcal = estCalories();

      build(false);
      o.legacy = totalMinutes();
      o.legacyTUT = totalTUT();
      o.legacyKcal = estCalories();

      /* Half clocked, half not - which is every real athlete for a long time
         after the clock ships, and the case a fix that only ever reads one of
         the two would get wrong. */
      build(true);
      for (let i = 0; i < 4; i++) {
        delete STATE.logs[i].durSec; delete STATE.logs[i].workSec; delete STATE.logs[i].pausedSec;
      }
      o.mixed = totalMinutes();
      o.mixedExpected = Math.round(mins.slice(4).reduce((a, b) => a + b, 0)
        + [0, 1, 2, 3].reduce((a, i) => { const tt = sessionTUT(i, STATE.logs[i]); return a + (tt.work + tt.rest) / 60; }, 0));

      /* THE GLASS. Asserting the helper is the container; the tile is what the
         athlete reads. */
      build(true);
      setProgressTab('summary'); go('progress');
      const v = document.querySelector('#v-progress');
      const cell = [...v.querySelectorAll('.stat')]
        .find(x => /Min trained/i.test((x.querySelector('.l') || {}).textContent || ''));
      o.tile = cell ? (cell.querySelector('.n') || {}).textContent : null;

      STATE.logs = JSON.parse(real); STATE.progressPtr = ptr;
      return o;
    });
    /* GUARD: the two figures must genuinely disagree on this data, or every
       assertion below passes on two numbers that happen to be equal. */
    t.ok('guard: time under tension really differs from the measured duration',
      lm.clockedTUT > 0 && Math.abs(lm.clockedTUT - lm.realMin) > 60, lm);
    t.eq('the lifetime minutes are what the sessions MEASURED', lm.clocked.min, lm.realMin, lm);
    t.eq('and every one of them counted as measured', lm.clocked.measured, 8, lm);
    t.eq('FLOOR: a run with no clock still contributes its own estimate',
      lm.legacy.min, lm.legacyTUT, lm);
    t.eq('and none of those counts as measured', lm.legacy.measured, 0, lm);
    t.eq('a mix of both adds each session by what it knows', lm.mixed.min, lm.mixedExpected, lm);
    t.eq('guard: the mix really was a mix', lm.mixed.measured + '/' + lm.mixed.estimated, '4/4', lm);
    t.ok('and it lands between the two extremes',
      lm.mixed.min > lm.legacy.min && lm.mixed.min < lm.clocked.min, lm);
    t.eq('FLOOR: calories stay on time under tension, clock or no clock',
      lm.clockedKcal, lm.legacyKcal, lm);
    t.eq('FLOOR: and totalTUT() itself is unmoved by a clock', lm.clockedTUT, lm.legacyTUT, lm);
    t.eq('the tile on the glass prints the measured figure', lm.tile, String(lm.realMin), lm);

    /* AND AN ARCHIVED RUN CARRIES ITS OWN CLOCKS. allDonePairs() spans archived
       runs on purpose - restartProgram() moves the whole run into STATE.runs and
       every lifetime counter must still read it - so a reader that walked
       STATE.logs alone would silently drop every session before the last
       restart. Nothing pinned that, and the boot repair walks both lists too. */
    const arch = await page.evaluate(() => {
      const o = {}, real = JSON.stringify(STATE.logs), runs = JSON.stringify(STATE.runs || []), ptr = STATE.progressPtr;
      const mk = n => {
        const logs = {};
        for (let i = 0; i < n; i++) {
          const s = buildSession(i);
          const items = s.main.map(m => ({ exId: m.exId, unit: m.unit,
            target: m.target, sets: m.sets, rest: m.rest || 45 }));
          const ex = {};
          items.forEach(m => { ex[m.exId] = { sets: new Array(m.sets).fill(true), done: true }; });
          logs[i] = { done: true, at: Date.now(), completedAt: todayISO(), items, ex,
            durSec: 40 * 60, pausedSec: 0, workSec: 1400, budgetMin: 25 };
        }
        return logs;
      };
      STATE.runs = [{ sessions: 5, logs: mk(5), endedAt: todayISO() }];
      STATE.logs = mk(3);
      STATE.progressPtr = 3;
      o.live = 3; o.archived = 5;
      o.before = totalMinutes();
      normalizeState();
      o.after = totalMinutes();
      o.archivedStillClocked = !!(STATE.runs[0] && STATE.runs[0].logs
        && STATE.runs[0].logs[0] && STATE.runs[0].logs[0].durSec === 2400);
      STATE.logs = JSON.parse(real); STATE.runs = JSON.parse(runs); STATE.progressPtr = ptr;
      return o;
    });
    /* GUARD: the archived run must be the bigger half, or a live-only reader
       lands close enough that the assertion below proves nothing. */
    t.ok('guard: most of the history is in the archived run',
      arch.archived > arch.live, arch);
    t.eq('the lifetime minutes span archived runs as well as the live one',
      arch.before.min, (arch.live + arch.archived) * 40, arch);
    t.eq('and every one of them counts as measured',
      arch.before.measured, arch.live + arch.archived, arch);
    t.ok('FLOOR: the boot repair leaves an archived clock alone',
      arch.archivedStillClocked, arch);
    t.eq('so the figure is the same after a boot', arch.after.min, arch.before.min, arch);
  }

  await browser.close(); srv.close();
  return t.finish(errors);
}
