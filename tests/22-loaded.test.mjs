/* Loaded progression past the bodyweight ceiling.

   A ladder runs out of rungs long before the program does — tempo (from
   cycle 5) is the only intensity axis a maxed movement had, and it stops
   changing after cycle 7. Cycles 8-9 (12 of the program's 54 weeks) had
   nothing left to add at all for any movement that topped its ladder early.
   External load — a weighted vest or pack — is the other axis a maxed
   bodyweight movement still has, and the app already had every piece of
   machinery to track it (liftLog, lastLift, loadToKg/loadShow) from the
   Weights track. This wires the SAME system into the bodyweight ladders.

   atLadderCeiling() is deliberately conjunctive, not a single check: top of
   its ladder, the calendar has actually scheduled them there, and the real
   prescription — safe mode, deload, readiness, everything prescribe()
   already applies — is landing AT the ceiling. Getting any one of the three
   wrong either offers load to someone who hasn't earned it yet, or silently
   withholds it from someone who has. */
import { serve, launch, suite, seedAthlete, ATHLETE } from './lib/harness.mjs';

export default async function run() {
  const t = suite('loaded progression');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  // ---- prescribeCeiling() is the SAME number prescribe() clamps to --------
  {
    const r = await page.evaluate(() => {
      const out = [];
      Object.keys(EX).forEach(exId => {
        const ex = EX[exId]; if (ex.unit !== 'reps' && ex.unit !== 'time') return;
        for (let week = 1; week <= 6; week++) {
          const p = prescribe(exId, { cycle: 8, week });
          if (p.target > prescribeCeiling(ex)) out.push(`${exId} w${week}: ${p.target} > ${prescribeCeiling(ex)}`);
        }
      });
      return out;
    });
    t.eq('no prescription, at any week, exceeds its own ceiling', r, []);
  }
  {
    /* The check above is necessary but not sufficient: prescribe() CLAMPS its
       own output to prescribeCeiling(), so "the output never exceeds the
       ceiling" holds whatever the ceiling function returns, including a
       version that quietly returns half the real number — the clamp just
       moves with it. Assert the actual VALUES against the documented
       formula (explicit repCap first, else a hardness tier, else 150 for a
       timed hold), independent of anything prescribe() does with them. */
    const r = await page.evaluate(() => {
      const timed = EX.plank;   // unit: time
      const capped = Object.keys(EX).find(k => EX[k].repCap > 0);   // explicit repCap wins
      const easy = Object.keys(EX).find(k => !EX[k].repCap && EX[k].unit === 'reps' && EX[k].hardness <= 0.6);
      const mid = Object.keys(EX).find(k => !EX[k].repCap && EX[k].unit === 'reps' && EX[k].hardness > 0.6 && EX[k].hardness <= 0.85);
      const hard = Object.keys(EX).find(k => !EX[k].repCap && EX[k].unit === 'reps' && EX[k].hardness > 0.85);
      return {
        timeIsFlat150: prescribeCeiling(timed) === 150,
        cappedMatchesRepCap: capped ? prescribeCeiling(EX[capped]) === EX[capped].repCap : null,
        easyTierIs12: easy ? prescribeCeiling(EX[easy]) === 12 : null,
        midTierIs20: mid ? prescribeCeiling(EX[mid]) === 20 : null,
        hardTierIs40: hard ? prescribeCeiling(EX[hard]) === 40 : null,
        haveAllFour: !!(capped && easy && mid && hard),
      };
    });
    t.ok('guard: real exercises exist in every one of the four ceiling cases', r.haveAllFour, r);
    t.ok('a timed hold ceilings at 150s flat', r.timeIsFlat150, r);
    t.ok('an exercise with an explicit repCap ceilings at exactly that', r.cappedMatchesRepCap, r);
    t.ok('an easy movement (hardness ≤ 0.6) ceilings at 12', r.easyTierIs12, r);
    t.ok('a mid movement (0.6 < hardness ≤ 0.85) ceilings at 20', r.midTierIs20, r);
    t.ok('a hard movement (hardness > 0.85) ceilings at 40', r.hardTierIs40, r);
  }

  // ---- ladderTopFor(): the final rung of a ladder, and only the final rung -
  {
    const r = await page.evaluate(() => {
      const out = {};
      out.plankTop = ladderTopFor('reverseplank');   // last entry of plankL
      out.plankNotTop = ladderTopFor('plank');        // 2nd entry — not a top
      out.notInAnyLadder = ladderTopFor('nonsense_id');
      // every ladder's OWN last entry names itself as a top
      out.selfConsistent = Object.keys(LADDERS).every(l => {
        const arr = LADDERS[l]; return ladderTopFor(arr[arr.length - 1]).includes(l);
      });
      // a movement that closes out more than one ladder is credited for all of them
      const multi = Object.keys(LADDERS).filter(l => {
        const arr = LADDERS[l]; return ladderTopFor(arr[arr.length - 1]).length > 1;
      });
      out.hasMultiLadderTop = multi.length > 0;
      return out;
    });
    t.ok('the last rung of plankL names plankL', r.plankTop.includes('plankL'), r);
    t.eq('a middle rung of the same ladder names nothing', r.plankNotTop, []);
    t.eq('an exId in no ladder at all names nothing', r.notInAnyLadder, []);
    t.ok('every ladder is internally consistent about its own top rung', r.selfConsistent, r);
    t.ok('at least one movement genuinely closes out more than one ladder', r.hasMultiLadderTop, r);
  }

  // ---- atLadderCeiling(): all three conditions have to hold, not just one -
  {
    const r = await page.evaluate(() => {
      const out = {};
      // guard: prove the flag can fire at all, or every false below is vacuous
      STATE.progressPtr = SESSIONS_PER_CYCLE * TOTAL_CYCLES - 1;
      const endPos = posOf(STATE.progressPtr);
      const maxedAtEnd = Object.keys(LADDERS).map(l => LADDERS[l][LADDERS[l].length - 1])
        .filter(exId => atLadderCeiling(exId, endPos));
      out.maxedAtEndCount = maxedAtEnd.length;
      out.totalLadders = Object.keys(LADDERS).length;

      /* condition 1: NOT yet scheduled at the top rung — must be false even
         when the RAW arithmetic already reaches the ceiling. A plain "week 1,
         default baseline" case does not discriminate this: prescribe()'s own
         numbers usually fall short of the ceiling early on regardless, so a
         version of atLadderCeiling with the scheduling gate deleted would
         still return false there by coincidence and the check would pass on
         nothing. Crank the anchor maxes up so an early, not-yet-scheduled
         rung's raw target hits its ceiling anyway — the only thing that can
         still say no at that point is the gate itself. */
      STATE.progressPtr = 0;
      const startPos = posOf(0);
      const savedMaxes = Object.assign({}, STATE.baseline.maxes);   // restored below —
      // this run's whole point is a scenario the LATER safe-mode check must not inherit
      Object.assign(STATE.baseline.maxes,
        { plank: 600, side: 600, hollow: 600, lower: 200, push: 200, pull: 100, squat: 200, dyn: 200 });
      const topId = LADDERS.pullL[LADDERS.pullL.length - 1];   // widepullup
      const rawTarget = prescribe(topId, startPos).target;
      out.rawAlreadyAtCeiling = rawTarget >= prescribeCeiling(EX[topId]);
      out.notYetScheduled = currentRung('pullL') < LADDERS.pullL.length - 1;
      out.notScheduledYet = atLadderCeiling(topId, startPos);
      STATE.baseline.maxes = savedMaxes;

      // condition 2: a MIDDLE rung, even one whose arithmetic happens to hit
      // its own rep cap on this athlete's numbers, is not "ladder maxed" —
      // EXCLUDING an exId that is a middle rung here but genuinely tops a
      // DIFFERENT ladder (burpee sits mid-ladder in hiitFinL but closes out
      // cardioBL and cardioFinL; atLadderCeiling is right to flag it there).
      // ladderTopFor().length===0 is the same "not a top of anything" gate
      // atLadderCeiling itself checks first, so this isolates condition 2.
      STATE.progressPtr = SESSIONS_PER_CYCLE * TOTAL_CYCLES - 1;
      const middleRungResults = Object.keys(LADDERS).map(l => {
        const arr = LADDERS[l];
        return arr.slice(0, -1).filter(exId => !ladderTopFor(exId).length)
          .map(exId => atLadderCeiling(exId, endPos));
      }).flat();
      out.anyMiddleRungFlagged = middleRungResults.some(Boolean);
      out.middleRungSampleSize = middleRungResults.length;

      // condition 3: safe mode eases the target below the ceiling
      const before = maxedAtEnd.length;
      STATE.profile.parq = ['heart']; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
      const afterSafe = Object.keys(LADDERS).map(l => LADDERS[l][LADDERS[l].length - 1])
        .filter(exId => atLadderCeiling(exId, endPos)).length;
      out.safeModeOn = safeMode();
      out.ceilingDropsUnderSafeMode = afterSafe < before;
      STATE.profile.parq = []; STATE.profile.medCleared = false;

      // exceptions fail closed
      out.badExId = atLadderCeiling(undefined, endPos);
      out.badUnit = atLadderCeiling('bike', endPos);   // cardio, not reps/time-ladder work

      return out;
    });
    t.ok('guard: some ladders really are ceiling-maxed at the end of the program',
      r.maxedAtEndCount > 0 && r.maxedAtEndCount < r.totalLadders, r);
    t.ok('guard: the raw arithmetic already reaches the ceiling on its own',
      r.rawAlreadyAtCeiling, r);
    t.ok('guard: and the calendar really has not scheduled them at the top yet',
      r.notYetScheduled, r);
    t.ok('a top rung not yet reached by the calendar is not "maxed", even when the raw numbers say it is',
      !r.notScheduledYet, r);
    t.ok('guard: there really are middle rungs to check that top nothing else',
      r.middleRungSampleSize > 20, r);
    t.ok('no middle rung is ever flagged, whatever its own arithmetic says', !r.anyMiddleRungFlagged, r);
    t.ok('guard: safe mode really was on for that check', r.safeModeOn, r);
    t.ok('safe mode easing the target drops it back under the ceiling', r.ceilingDropsUnderSafeMode, r);
    t.eq('a missing exId fails closed to false, not a throw', r.badExId, false);
    t.eq('a non-ladder movement is never flagged', r.badUnit, false);
  }

  // ---- the in-session note: shown only for a real ceiling item -------------
  {
    const r = await page.evaluate(() => {
      STATE.progressPtr = SESSIONS_PER_CYCLE * TOTAL_CYCLES - 1;
      openPlayer();
      const ceiling = PLAYER.items.filter(m => atLadderCeiling(m.exId, PLAYER.sess.pos));
      const clean = PLAYER.items.filter(m => !atLadderCeiling(m.exId, PLAYER.sess.pos));
      const out = { hasCeiling: ceiling.length > 0, hasClean: clean.length > 0 };
      if (ceiling.length) {
        PLAYER.i = PLAYER.items.indexOf(ceiling[0]); PLAYER.s = 0;
        plClear(); plEnterReady(false); plClear(); plEnterWork();
        out.ceilingNote = document.getElementById('plBody').innerHTML;
      }
      if (clean.length) {
        PLAYER.i = PLAYER.items.indexOf(clean[0]); PLAYER.s = 0;
        plClear(); plEnterReady(false); plClear(); plEnterWork();
        out.cleanNote = document.getElementById('plBody').innerHTML;
      }
      playerTeardown();
      return out;
    });
    t.ok('guard: this session has at least one ceiling item and one clean item',
      r.hasCeiling && r.hasClean, r);
    t.ok('the ceiling item shows the maxed-ladder note', /maxed the ladder/.test(r.ceilingNote || ''), r.ceilingNote);
    t.ok('a non-ceiling item in the SAME session shows no such note', !/maxed the ladder/.test(r.cleanNote || ''), r.cleanNote);
  }
  {
    // the note reflects a REAL logged load, not a generic prompt, once one exists
    const r = await page.evaluate(([seed]) => {
      eval(seed)();
      STATE.progressPtr = SESSIONS_PER_CYCLE * TOTAL_CYCLES - 1;
      openPlayer();
      const ceiling = PLAYER.items.find(m => atLadderCeiling(m.exId, PLAYER.sess.pos));
      const out = {};
      if (!ceiling) return { noCeilingItem: true };
      PLAYER.i = PLAYER.items.indexOf(ceiling); PLAYER.s = 0;
      plClear(); plEnterReady(false); plClear(); plEnterWork();
      out.beforeLog = document.getElementById('plBody').innerHTML;
      liftLog().push({ date: todayISO(), exId: ceiling.exId, loadKg: 9, reps: 8, rir: 1 });
      save();
      PLAYER.i = PLAYER.items.indexOf(ceiling); PLAYER.s = 0;
      plClear(); plEnterReady(false); plClear(); plEnterWork();
      out.afterLog = document.getElementById('plBody').innerHTML;
      playerTeardown();
      STATE.liftLog = [];
      return out;
    }, [ATHLETE]);
    t.ok('guard: found a ceiling item to log against', !r.noCeilingItem, r);
    t.ok('before logging anything, the note is a generic prompt', /try adding load/.test(r.beforeLog || ''), r.beforeLog);
    t.ok('after logging a load, the note names it specifically', /\+9(\.0)?\s*kg last|\+9(\.0)?kg/.test(r.afterLog || '') || /last \+9/.test(r.afterLog || ''), r.afterLog);
  }

  // ---- the end-of-session prompt: scoped to ceiling items only -------------
  {
    const r = await page.evaluate(() => {
      STATE.progressPtr = SESSIONS_PER_CYCLE * TOTAL_CYCLES - 1;
      openPlayer();
      const ceiling = PLAYER.items.filter(m => atLadderCeiling(m.exId, PLAYER.sess.pos));
      const allIds = PLAYER.items.map(m => m.exId);
      const ceilingIds = ceiling.map(m => m.exId);
      PLAYER.i = PLAYER.items.length - 1;
      plEnterDone();
      const html = document.getElementById('plBody').innerHTML;
      playerTeardown();
      return { hasCeiling: ceiling.length > 0, allIds, ceilingIds, html };
    });
    t.ok('guard: this session really does have a ceiling item', r.hasCeiling, r);
    t.ok('the completion screen offers to log added load', /Log your added load/.test(r.html), r.html.slice(0, 600));
    const jsonMatch = /openLiftLog\((\[.*?\])\)/.exec(r.html);
    const passed = jsonMatch ? JSON.parse(jsonMatch[1].replace(/&quot;/g, '"')) : null;
    t.ok('and the button actually parses a real item list', Array.isArray(passed) && passed.length > 0, r.html.slice(0, 600));
    if (Array.isArray(passed)) {
      const passedIds = passed.map(m => m.exId).sort();
      t.eq('scoped to exactly the ceiling items — not the whole session', passedIds, r.ceilingIds.slice().sort());
      t.ok('which is a real subset of the session, not all of it (or the guard above is moot)',
        r.allIds.length > r.ceilingIds.length, { allIds: r.allIds, ceilingIds: r.ceilingIds });
    }
  }
  {
    // no ceiling items at all -> no button, no noise on an ordinary session
    const r = await page.evaluate(() => {
      STATE.progressPtr = 0;
      openPlayer();
      const ceiling = PLAYER.items.filter(m => atLadderCeiling(m.exId, PLAYER.sess.pos));
      PLAYER.i = PLAYER.items.length - 1;
      plEnterDone();
      const html = document.getElementById('plBody').innerHTML;
      playerTeardown();
      return { hasCeiling: ceiling.length > 0, html };
    });
    t.ok('guard: week 1 genuinely has nothing ceiling-maxed', !r.hasCeiling, r);
    t.ok('so the completion screen offers no load-logging button at all', !/Log your added load/.test(r.html), r.html.slice(0, 600));
  }
  {
    // the free/weights branch keeps its own unconditional lift-log offer —
    // this feature must not have narrowed that existing behaviour
    const r = await page.evaluate(() => {
      openPlayer({ items: [{ exId: 'benchdip', unit: 'reps', target: 12, sets: 3, rest: 45 }], free: true, title: 'Weights' });
      PLAYER.i = 0;
      plEnterDone();
      const html = document.getElementById('plBody').innerHTML;
      playerTeardown();
      return html;
    });
    t.ok('a free/weights session still always offers to log what was lifted', /Log what you lifted/.test(r), r.slice(0, 400));
  }

  // ---- the skill-tree badge -------------------------------------------------
  {
    const r = await page.evaluate(() => {
      STATE.progressPtr = SESSIONS_PER_CYCLE * TOTAL_CYCLES - 1;
      const html = skillTreesHTML();
      const pos = posOf(STATE.progressPtr);
      const anyMaxed = SKILL_TREES.some(t => {
        const arr = LADDERS[t.lad]; return atLadderCeiling(arr[arr.length - 1], pos);
      });
      return { html, anyMaxed, noNaN: !/NaN|undefined/.test(html) };
    });
    t.ok('guard: at least one skill tree is ceiling-maxed at end of program', r.anyMaxed, r);
    t.ok('and the tree screen shows the vest badge for it', r.html.includes('🎒') && /add load/.test(r.html), r.html.slice(0, 400));
    t.ok('nothing renders as NaN', r.noNaN, r.html.slice(0, 200));
  }
  {
    // week 1: no ladder is maxed, so the badge must not appear at all
    const r = await page.evaluate(() => {
      STATE.progressPtr = 0;
      return skillTreesHTML();
    });
    t.ok('with nothing maxed, the vest badge does not appear anywhere', !r.includes('🎒'), r.slice(0, 400));
  }
  {
    /* At the top rung, calendar-scheduled, with nothing easing the target —
       badge shows. Flag a condition and leave it uncleared so safe mode eases
       the SAME rung below its ceiling: the athlete is still at the top rung,
       still calendar-scheduled there ("you are here" would still be earned),
       and a badge keyed only to ladder position (not the real prescription)
       would still show it. It must not.

       Scoped to hollowL/dragonflagfull specifically, not "any 🎒 on the page" —
       rotL and legL's top rungs happen to have enough headroom above their
       own ceiling that safe mode's 25% cut still clamps them at it, so a
       page-wide .includes('🎒') check stays true from THOSE regardless of
       whether dragonflagfull's own badge is correctly gated. Anchoring on its
       onclick target isolates the one row that was actually mutated.
       dragonflagfull, not dragonflag, is the top rung of hollowL as of the
       Full Dragon Flag addition — dragonflag is now a middle rung and is
       never itself ceiling-maxed for this seeded athlete. */
    const rowFor = (html, exId) => {
      const at = html.indexOf(`openExerciseInfo('${exId}')`);
      return at < 0 ? '' : html.slice(at, html.indexOf('</button>', at));
    };
    const r = await page.evaluate(() => {
      STATE.progressPtr = SESSIONS_PER_CYCLE * TOTAL_CYCLES - 1;
      const pos = posOf(STATE.progressPtr);
      const stillTopRung = currentRung('hollowL') >= LADDERS.hollowL.length - 1;
      const before = skillTreesHTML();
      STATE.profile.parq = ['heart']; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
      const after = skillTreesHTML();
      const safeModeOn = safeMode();
      STATE.profile.parq = []; STATE.profile.medCleared = false;
      return { stillTopRung, before, after, safeModeOn };
    });
    const beforeRow = rowFor(r.before, 'dragonflagfull'), afterRow = rowFor(r.after, 'dragonflagfull');
    t.ok('guard: the ladder position itself is unaffected by flagging a joint', r.stillTopRung, r);
    t.ok('guard: safe mode is really on', r.safeModeOn, r);
    t.ok('guard: dragonflagfull\'s row was showing the vest badge before the flag',
      beforeRow.includes('🎒') && /add load/.test(beforeRow), beforeRow);
    t.ok('an uncleared flag eases the real target below the ceiling, and dragonflagfull\'s badge follows it — not the ladder position',
      !afterRow.includes('🎒'), afterRow);
  }

  // ---- loadProgression(): double progression on the logged load -----------
  /* liftLog stored what you lifted and handed it back next time — a memory,
     not a program. Classic double progression: last set met the exercise's
     own rep ceiling with real room (2+ left) -> aim a small step heavier;
     anything short of that repeats. It must never auto-decrease — that is
     deload/readiness's job, not this one's — and it must respect BOTH
     easing signals, not just the one that happens to be live in a given
     scenario. */
  {
    const r = await page.evaluate(() => {
      const exId = 'dbcp';
      const ceiling = prescribeCeiling(EX[exId]);
      const keep = JSON.stringify(STATE.readiness || null);
      delete STATE.readiness;
      const out = {};

      STATE.liftLog = [];
      out.noHistory = loadProgression(exId, {});

      STATE.liftLog = [{ date: todayISO(), exId, loadKg: 10, reps: ceiling, rir: 3 }];
      out.climbsOnCeilingWithRoom = loadProgression(exId, {});

      STATE.liftLog = [{ date: todayISO(), exId, loadKg: 10, reps: ceiling - 1, rir: 3 }];
      out.repeatsShortOfCeiling = loadProgression(exId, {});

      STATE.liftLog = [{ date: todayISO(), exId, loadKg: 10, reps: ceiling, rir: 0 }];
      out.repeatsWithNoRoom = loadProgression(exId, {});

      STATE.liftLog = [{ date: todayISO(), exId, loadKg: 10, reps: ceiling, rir: null }];
      out.repeatsWithUnknownRoom = loadProgression(exId, {});

      // eased by TODAY's readiness alone, independent of the calendar
      STATE.liftLog = [{ date: todayISO(), exId, loadKg: 10, reps: ceiling, rir: 3 }];
      STATE.readiness = { [todayISO()]: { score: 25, sleep: 1, sore: 1, energy: 1 } };
      out.easedByReadiness = loadProgression(exId, {});
      delete STATE.readiness;

      // eased by the CALENDAR deload week, independent of readiness
      out.easedByCalendarDeload = loadProgression(exId, { week: WEEKS_PER_CYCLE });

      STATE.readiness = keep ? JSON.parse(keep) : undefined;
      return out;
    });
    t.eq('no history gives no recommendation', r.noHistory, { lastLoadKg: null, nextLoadKg: null, climbing: false });
    t.eq('ceiling reps + 2 left in the tank -> climb by the load step', r.climbsOnCeilingWithRoom,
      { lastLoadKg: 10, nextLoadKg: 11, climbing: true });
    t.eq('short of the ceiling -> repeat the same load', r.repeatsShortOfCeiling,
      { lastLoadKg: 10, nextLoadKg: 10, climbing: false });
    t.eq('ceiling reps but no room left -> repeat, not climb', r.repeatsWithNoRoom,
      { lastLoadKg: 10, nextLoadKg: 10, climbing: false });
    t.eq('effort not recorded -> repeat, never assume room that was not reported', r.repeatsWithUnknownRoom,
      { lastLoadKg: 10, nextLoadKg: 10, climbing: false });
    t.eq('poor readiness today overrides an otherwise-earned climb', r.easedByReadiness,
      { lastLoadKg: 10, nextLoadKg: 10, climbing: false });
    t.eq('the calendar deload week overrides an otherwise-earned climb', r.easedByCalendarDeload,
      { lastLoadKg: 10, nextLoadKg: 10, climbing: false });
  }

  // ---- loadCeilingNote() and openLiftLog() surface the recommendation -----
  /* currentRung() (which gates whether a ladder counts as "topped") reads
     STATE.progressPtr directly and ignores whatever pos is passed to
     atLadderCeiling — but week 6 of the final cycle, the ONLY position where
     dragonflagfull is naturally ceiling-maxed for this athlete, is ALSO always
     the calendar deload week, which would make "climbing" unreachable by
     construction, not by the code being wrong. Decoupling the two: keep
     STATE.progressPtr at the real maxed position (so the rung genuinely IS
     topped), but hand prescribe()/atLadderCeiling a copy of that same
     position with an earlier, non-deload week — exactly the kind of pos
     object every other block in this file already constructs by hand. */
  {
    const r = await page.evaluate(() => {
      const exId = 'dragonflagfull';
      const ceiling = prescribeCeiling(EX[exId]);
      STATE.progressPtr = SESSIONS_PER_CYCLE * TOTAL_CYCLES - 1;
      const pos = Object.assign({}, posOf(STATE.progressPtr), { week: 2 });
      const reallyMaxed = atLadderCeiling(exId, pos);
      const reallyNotDeload = !deloadOn(pos);
      const keepPlayer = (typeof PLAYER !== 'undefined') ? PLAYER : undefined;
      PLAYER = { sess: { pos } };

      STATE.liftLog = [];
      const firstTimeNote = loadCeilingNote({ exId });

      STATE.liftLog = [{ date: todayISO(), exId, loadKg: 10, reps: ceiling, rir: 3 }];
      const climbNoteHtml = loadCeilingNote({ exId });

      STATE.liftLog = [{ date: todayISO(), exId, loadKg: 10, reps: ceiling - 1, rir: 3 }];
      const repeatNoteHtml = loadCeilingNote({ exId });

      PLAYER = keepPlayer;

      // openLiftLog's own row hint — no PLAYER needed, it defaults pos to {}
      STATE.liftLog = [{ date: todayISO(), exId, loadKg: 10, reps: ceiling, rir: 3 }];
      openLiftLog([{ exId, unit: 'reps', target: ceiling }]);
      const sheetHtml = document.querySelector('#sheet').innerHTML;
      closeSheet();

      return { reallyMaxed, reallyNotDeload, ceiling, firstTimeNote, climbNoteHtml, repeatNoteHtml, sheetHtml };
    });
    t.ok('guard: this position is really not a deload week', r.reallyNotDeload, r);
    t.ok('guard: dragonflag is really ceiling-maxed at this position', r.reallyMaxed, r);
    t.ok('a ceiling-maxed movement with no lift history prompts to add load', /try adding load/.test(r.firstTimeNote), r.firstTimeNote);
    t.ok('an earned climb names the SPECIFIC next load, not just the last one', /aim for \+11/.test(r.climbNoteHtml), r.climbNoteHtml);
    t.ok('a short set says repeat, not aim for a heavier one', /repeat \+10/.test(r.repeatNoteHtml) && !/aim for/.test(r.repeatNoteHtml), r.repeatNoteHtml);
    t.ok('the lift-log sheet itself shows the same recommendation per row', /aim for 11/.test(r.sheetHtml) && r.sheetHtml.includes('📈'), r.sheetHtml);
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
