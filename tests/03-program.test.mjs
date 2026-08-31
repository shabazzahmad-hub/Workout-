/* The engine. Runs the entire 54-week program to completion and asserts the
   prescriptions stay sane the whole way — for a rank beginner, a mid athlete and
   an advanced one, with and without equipment, with and without flagged joints. */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

export default async function run() {
  const t = suite('program engine');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  // ---- a full 378-session run, re-testing at every block boundary ----------
  const full = await page.evaluate(() => {
    const out = { gates: [], deloadWeeks: new Set(), sessions: 0, errs: [], zero: [], long: [],
      dupSessions: 0, dropped: 0, maxReps: 0, maxRepsEx: '', maxHold: 0 };
    const feel = ['right', 'right', 'easy', 'right', 'hard', 'right', 'right'];
    for (let g = 0; g < 600 && STATE.progressPtr < 378; g++) {
      const gate = reassessGate();
      if (gate != null && gate > 0) {
        out.gates.push(gate);
        const prev = (gate === 1 ? STATE.baseline : STATE.reassess[gate - 1]) || STATE.baseline;
        const m = prev.maxes; const grow = v => Math.round(v * 1.06);
        STATE.reassess[gate] = { date: todayISO(), score: Math.min(100, (prev.score || 60) + 1),
          level: 'Advanced', testCount: 8,
          maxes: { plank: grow(m.plank), side: grow(m.side), hollow: grow(m.hollow), lower: grow(m.lower),
            dyn: grow(m.dyn), push: grow(m.push), pull: grow(m.pull), squat: grow(m.squat) } };
        rebaseAdapt(); save(); continue;
      }
      let s;
      try { s = buildSession(STATE.progressPtr); }
      catch (e) { out.errs.push('ptr ' + STATE.progressPtr + ': ' + e); break; }
      if (s.dropped) out.dropped += s.dropped.length;
      const items = [...s.main, s.finisher];
      const ids = items.map(m => m.exId);
      if (new Set(ids).size !== ids.length) out.dupSessions++;
      items.forEach(m => {
        if (!(m.target > 0)) out.zero.push(STATE.progressPtr + ':' + m.exId);
        if (m.unit === 'reps' && m.target > out.maxReps) { out.maxReps = m.target; out.maxRepsEx = m.exId; }
        if (m.unit === 'time' && m.target > out.maxHold) out.maxHold = m.target;
      });
      const v = sessionVolume(s);
      if (v.minutes > 75) out.long.push(STATE.progressPtr + ':' + v.minutes);
      if (deloadOn(s.pos)) out.deloadWeeks.add(s.pos.week);
      items.forEach(m => { for (let i = 0; i < m.sets; i++) toggleSet(m.exId, i); });
      commitSession(feel[STATE.progressPtr % 7]);
      out.sessions++;
    }
    out.deloadWeeks = [...out.deloadWeeks];
    out.finalPtr = STATE.progressPtr;
    return out;
  });
  t.ok('buildSession never throws across the whole program', full.errs.length === 0, full.errs.slice(0, 3));
  t.eq('all 378 sessions complete', full.sessions, 378);
  t.eq('the re-test gate fires once per block boundary', full.gates.length, 8);
  t.eq('deloads fire only in week 6', full.deloadWeeks, [6]);
  t.ok('no session prescribes an invalid target', full.zero.length === 0, full.zero.slice(0, 5));
  t.ok('no session prescribes the same movement twice', full.dupSessions === 0, full.dupSessions);
  t.ok('no slot is ever dropped for a fully-equipped athlete', full.dropped === 0, full.dropped);
  t.ok('no session runs over 75 minutes', full.long.length === 0, full.long.slice(0, 5));
  t.ok('no rep prescription exceeds 40', full.maxReps <= 40, full.maxReps + ' ' + full.maxRepsEx);
  t.ok('no hold exceeds 150s', full.maxHold <= 150, full.maxHold);

  // ---- load intensity, measured against the PREDICTED max for the movement --
  const inten = await page.evaluate(() => {
    const TU = {}; TESTS.forEach(x => TU[x.id] = x.unit);
    const run = (level, mx) => {
      STATE.baseline = { date: todayISO(), score: 60, level, testCount: 8, maxes: mx };
      STATE.reassess = {}; STATE.adapt = 1;
      let n = 0, hot = 0; const worst = [];
      for (let p = 0; p < 378; p++) {
        const s = buildSession(p);
        [...s.main, s.finisher].forEach(m => {
          const ex = EX[m.exId];
          if (!ex || !ex.anchor || ex.unit !== 'reps') return;
          if (TU[ex.anchor] !== ex.unit || !(mx[ex.anchor] > 0)) return;
          const predicted = mx[ex.anchor] * ex.hardness;   // your max AT THIS MOVEMENT
          const ratio = m.target / predicted;
          n++; if (ratio > 1.6) { hot++; worst.push(m.exId + ' ' + ratio.toFixed(2)); }
        });
      }
      return { n, hot, worst: [...new Set(worst)].slice(0, 4) };
    };
    return {
      beginner: run('Beginner', { plank: 20, side: 12, hollow: 10, lower: 5, dyn: 15, push: 5, pull: 2, squat: 12 }),
      mid: run('Intermediate', { plank: 60, side: 40, hollow: 30, lower: 14, dyn: 40, push: 25, pull: 12, squat: 35 }),
      advanced: run('Advanced', { plank: 180, side: 120, hollow: 90, lower: 40, dyn: 60, push: 60, pull: 20, squat: 80 }),
    };
  });
  for (const [who, v] of Object.entries(inten)) {
    t.ok(`${who} is never prescribed beyond 1.6x their predicted max`, v.hot === 0,
      { overprescribed: v.hot, of: v.n, worst: v.worst });
  }

  // ---- goals must shape the program without deleting its structure ---------
  const goals = await page.evaluate(() => {
    const out = {};
    ['lose', 'shred', 'recomp', 'core', 'maintain', 'gain'].forEach(g => {
      STATE.profile.goal = g;
      let push = 0, row = 0, hinge = 0, slot01 = 0;
      [...SESSIONS, ...PHASE2_SESSIONS].forEach(s => {
        for (let c = 0; c < 9; c++) for (let d = 0; d < 7; d++) {
          const after = goalSlots(s, { cycle: c, dayInWeek: d, week: 1 });
          if (after[0] !== s.slots[0] || after[1] !== s.slots[1]) slot01++;
        }
      });
      for (let d = 0; d < 7 * 12; d++) {
        const pos = posOf(d); if (pos.cycle > 1) continue;
        const sl = goalSlots(SESSIONS[d % SESSIONS.length], pos);
        push += sl.filter(x => x === 'pushL').length;
        row += sl.filter(x => x === 'rowL').length;
        hinge += sl.filter(x => x === 'hingeL').length;
      }
      out[g] = { push, row, hinge, slot01 };
    });
    STATE.profile.goal = 'recomp';
    // and the goal must actually CHANGE something
    const sig = g => { STATE.profile.goal = g; const s = buildSession(90);
      return [...s.main, s.finisher].map(m => m.exId + ':' + m.sets + 'x' + m.target).join('|'); };
    out.distinct = new Set(['lose', 'shred', 'recomp', 'core', 'maintain', 'gain'].map(sig)).size;
    STATE.profile.goal = 'recomp';
    return out;
  });
  for (const g of ['lose', 'shred', 'recomp', 'core', 'maintain', 'gain']) {
    const v = goals[g];
    t.ok(`goal "${g}" keeps the Phase-1 press, pull and hinge`, v.push > 0 && v.row > 0 && v.hinge > 0, v);
    t.ok(`goal "${g}" never replaces a day's primary lift`, v.slot01 === 0, v);
  }
  t.ok('changing the goal changes the actual workout', goals.distinct >= 4, goals.distinct);

  // ---- the athletes most likely to be underserved --------------------------
  const edge = await page.evaluate(() => {
    const probe = (label, setup) => {
      setup();
      const seen = {}; let dropped = 0, dup = 0;
      for (let p = 0; p < 378; p++) {
        const s = buildSession(p);
        dropped += (s.dropped || []).length;
        const ids = [...s.main, s.finisher].map(m => m.exId);
        if (new Set(ids).size !== ids.length) dup++;
        ids.forEach(k => seen[k] = (seen[k] || 0) + 1);
      }
      const byRegion = {};
      Object.keys(seen).forEach(k => { const r = EX[k].region; byRegion[r] = (byRegion[r] || 0) + seen[k]; });
      return { label, variety: Object.keys(seen).length, dropped, dup, byRegion };
    };
    const base = () => { STATE.profile.limitations = []; STATE.profile.gear = ['bar', 'bench', 'dip'];
      STATE.profile.hasBar = true; STATE.profile.hasBench = true; STATE.profile.goal = 'recomp';
      STATE.baseline = { date: todayISO(), score: 60, level: 'Intermediate', testCount: 8,
        maxes: { plank: 60, side: 40, hollow: 30, lower: 14, dyn: 40, push: 25, pull: 12, squat: 35 } };
      STATE.reassess = {}; STATE.adapt = 1; };
    const out = [];
    out.push(probe('fully equipped', base));
    out.push(probe('no equipment at all', () => { base(); STATE.profile.gear = []; STATE.profile.hasBar = false; STATE.profile.hasBench = false; }));
    out.push(probe('four flagged joints', () => { base(); STATE.profile.limitations = ['knee', 'shoulder', 'wrist', 'lowback']; }));
    out.push(probe('rank beginner, no kit', () => { base(); STATE.profile.gear = []; STATE.profile.hasBar = false;
      STATE.baseline = { date: todayISO(), score: 15, level: 'Beginner', testCount: 8,
        maxes: { plank: 20, side: 12, hollow: 10, lower: 5, dyn: 15, push: 5, pull: 2, squat: 12 } }; }));
    base();
    return out;
  });
  for (const e of edge) {
    t.ok(`[${e.label}] every slot is filled`, e.dropped === 0, e);
    t.ok(`[${e.label}] no duplicate movement in a session`, e.dup === 0, e);
    t.ok(`[${e.label}] the program keeps real variety`, e.variety >= 20, e);
  }
  const bodyweight = edge.find(e => e.label === 'no equipment at all');
  t.ok('a bodyweight-only athlete still gets real pulling', (bodyweight.byRegion.back || 0) > 0, bodyweight.byRegion);
  const fourJoint = edge.find(e => e.label === 'four flagged joints');
  t.ok('a four-joint athlete still gets pressing work',
    (fourJoint.byRegion.chest || 0) + (fourJoint.byRegion.strength || 0) > 0, fourJoint.byRegion);

  /* ---- A one-sided movement balances INSIDE the set ----------------------
     Reported from the phone about the Kettlebell Bent-Over Row: "it doesn't
     tell you to switch hands, so with three sets you do two on one hand and
     one on the other. It needs to be either two sets or four to balance."

     Exactly right about the imbalance, and the fix is not the set count —
     prescribe() owns that for real reasons and forcing it even here would
     distort volume everywhere else. The SET is what has to balance, which is
     how the other fifteen one-sided movements in this library already work. */
  {
    const side = await page.evaluate(async () => {
      const o = {};
      o.flagged = Object.keys(EX).filter(k => EX[k].side === 'switch').sort();
      /* The three that loaded one arm and said nothing about the other. */
      o.reported = ['kbcp', 'kbrow', 'kbwindmill'].every(k => EX[k].side === 'switch');
      /* The two that said it in prose where only a reader would find it. */
      o.prose = ['btbalance', 'kbhalo'].every(k => EX[k].side === 'switch');
      /* THE FLOOR, and it is what a blanket flag would fail: two-handed
         movements must NOT be flagged. dbrow holds a bell in each hand, dbcp
         cleans both, and kbgoblet is two hands on one bell. */
      o.twoHanded = ['dbrow', 'dbcp', 'kbgoblet', 'kbcarry', 'ruckcarry']
        .filter(k => EX[k].side === 'switch');
      /* Flag and words travel together, both directions. */
      o.silentFlag = o.flagged.filter(k => {
        const e = EX[k];
        return !/switch (hand|side|leg)|each side|other side|reverse direction/i
          .test([...(e.steps || []), ...(e.cues || []), e.why || ''].join(' '));
      });

      /* The guided player CALLS it — the steps alone are not the fix, since
         the player is hands-free and nobody is reading. */
      const said = []; const realSpeak = window.coachSpeak;
      window.coachSpeak = txt => { said.push(String(txt)); return true; };
      const keep = { plS: window.plS, plRingSet: window.plRingSet, beep: window.beep,
        haptic: window.haptic, plAfterSet: window.plAfterSet, plClear: window.plClear,
        plCur: window.plCur };
      /* The call is not only spoken. A phone on silent in a gym hears nothing,
         and the athlete is hands-free and looking at the ring — so the beep and
         the on-screen line are part of the fix, not decoration. Counted here
         because a mutant that deleted them left every spoken assertion green. */
      let freqs = [], coachPaint = [];
      window.plS = (sel, v) => { if (sel === '#plCoach') coachPaint.push(String(v)); };
      window.plRingSet = () => {}; window.beep = f => { freqs.push(f); };
      window.haptic = () => {}; window.plAfterSet = () => {}; window.plClear = () => {};
      /* plSay() DEFERS the utterance, which is the whole point of it — so the
         lines have to be read after the microtask queue drains, not on the
         line after the last tick. The first version of this block read `said`
         synchronously and measured an empty array. */
      const runReps = async exId => {
        await new Promise(r => setTimeout(r, 80));
        said.length = 0;
        window.plCur = () => ({ exId, target: 10, sets: 3, unit: 'reps', rest: 55 });
        PLAYER = { phase: 'work', repMs: 0, repCounted: false, repN: 0, elapsed: 0,
          ecc: 2, eccMs: 2000, repDurMs: 4000, total: 10, cues: ['Flat back'], cueIdx: 0 };
        for (let k = 0; k < 10 * 40; k++) plTickRep();
        /* 250 ms, not 80: the second tone of the switch pair is scheduled
           140 ms out so the two read as a rising pair rather than a chord. */
        await new Promise(r => setTimeout(r, 250));
        return said.slice();
      };
      freqs = []; coachPaint = [];
      const oneSided = await runReps('kbrow');
      o.repSwitchTones = freqs.filter(f => f === 660).length;
      o.repPairFollows = freqs.filter(f => f === 880).length >= 11; o.repPaint = coachPaint.filter(x => /switch sides/i.test(x)).length;
      o.callsIt = oneSided.some(x => /switch sides/i.test(x));
      /* HALFWAY, not at the end — a call after the last rep is no call. */
      o.callsItHalfway = oneSided.findIndex(x => /switch sides/i.test(x)) === 4;   // rep 5 of 10
      o.counted = oneSided.length;
      freqs = []; coachPaint = [];
      const bothHands = await runReps('dbrow');
      o.twoHandedSwitchTones = freqs.filter(f => f === 660).length;
      o.twoHandedStillCounts = freqs.filter(f => f === 880).length; o.twoHandedPaint = coachPaint.filter(x => /switch sides/i.test(x)).length;
      o.twoHandedSilent = !bothHands.some(x => /switch sides/i.test(x));

      /* And a one-sided HOLD, where there are no reps to hang it on. */
      said.length = 0;
      const keep2 = { countdownCue: window.countdownCue, beepGo: window.beepGo,
        motivate: window.motivate };
      window.countdownCue = () => {}; window.beepGo = () => {}; window.motivate = () => false;
      freqs = []; coachPaint = [];
      window.plCur = () => ({ exId: 'btbalance', target: 40, sets: 2, unit: 'time', rest: 45 });
      PLAYER = { phase: 'work', remain: 40, total: 40, deadline: 0, elapsed: 0 };
      for (let k = 0; k < 39; k++) plTickHold();
      await new Promise(r => setTimeout(r, 250));
      o.holdCallsIt = said.filter(x => /switch sides/i.test(x)).length;
      o.holdSwitchTones = freqs.filter(f => f === 660).length; o.holdPaint = coachPaint.filter(x => /switch sides/i.test(x)).length;
      /* The floor for holds: a two-sided hold stays silent. */
      said.length = 0;
      window.plCur = () => ({ exId: 'plank', target: 40, sets: 2, unit: 'time', rest: 45 });
      PLAYER = { phase: 'work', remain: 40, total: 40, deadline: 0, elapsed: 0 };
      for (let k = 0; k < 39; k++) plTickHold();
      await new Promise(r => setTimeout(r, 80));
      o.holdFloorSilent = !said.some(x => /switch sides/i.test(x));
      Object.assign(window, keep, keep2); window.coachSpeak = realSpeak;
      return o;
    });
    t.ok('the reported row and its two siblings are flagged one-sided', side.reported, side.flagged);
    t.ok('so are the two that only said it in prose', side.prose, side.flagged);
    t.eq('a two-handed movement is never flagged', side.twoHanded.join(','), '', side);
    t.eq('every flagged movement says so in its own steps', side.silentFlag.join(','), '', side);
    t.ok('the guided player calls the switch on a one-sided set', side.callsIt, side);
    t.ok('at the halfway rep, not after the last one', side.callsItHalfway, side);
    t.eq('and still counts all ten reps', side.counted, 10, side);
    t.ok('a two-handed row is never told to switch', side.twoHandedSilent, side);
    /* Two tones per call, so it is audible on a silenced phone, plus the line
       on the glass for anyone who missed both. */
    t.eq('the switch has its own tone on a rep set', side.repSwitchTones, 1, side);
    t.ok('followed by the second half of the pair', side.repPairFollows, side);
    t.eq('and is written on the coach line', side.repPaint, 1, side);
    t.eq('a two-handed row gets no switch tone', side.twoHandedSwitchTones, 0, side);
    /* GUARD: the two-handed case really did run — a zero from a set that
       never ticked would satisfy the line above on nothing. */
    t.eq('but still counts its ten reps out loud', side.twoHandedStillCounts, 10, side);
    t.eq('and writes no switch line', side.twoHandedPaint, 0, side);
    t.eq('a one-sided hold gets the tone too', side.holdSwitchTones, 1, side);
    t.eq('and writes it', side.holdPaint, 1, side);
    t.eq('a one-sided HOLD is called exactly once', side.holdCallsIt, 1, side);
    t.ok('and a two-sided hold stays silent', side.holdFloorSilent, side);
  }


  /* ---- a set that is ONE side needs an even number of sets (v351) ---------
     Reported from the phone: "the first exercise was side plank, and they only
     have three sets — therefore you'll work on two sides and the other side
     you'll only work on once."

     v307 balanced the kettlebell row INSIDE the set (`side:'switch'`), which is
     right when the prescribed number covers both sides. It is wrong here: the
     side plank is anchored to the `side` baseline test, which measures ONE side
     to failure, so switching halfway would hand back half the hold against a
     benchmark taken on one. The set stays one side; the COUNT goes even. */
  {
    const sd = await page.evaluate(() => {
      const o = {};
      o.perSide = Object.keys(EX).filter(k => EX[k].side === 'perSet').sort();
      o.switching = Object.keys(EX).filter(k => EX[k].side === 'switch').sort();
      o.modes = SIDE_MODES.slice();

      // the reported case
      o.sidePlank = prescribe('sideplank', posOf(0)).sets;
      /* FLOOR: a two-sided movement is untouched. A rule that rounded every
         exercise up satisfies every assertion about the side plank. */
      o.squat = prescribe('squat', posOf(0)).sets;
      o.pushup = prescribe('pushup', posOf(0)).sets;

      /* THE SWEEP. Not "side plank is 4" — every per-side movement, in every
         session of the whole program, must be even and at least two. */
      const total = SESSIONS_PER_CYCLE * TOTAL_CYCLES;
      const bad = []; const seen = {};
      for (let p = 0; p < total; p++) {
        const s = buildSession(p);
        for (const m of [...s.main, s.finisher].filter(Boolean)) {
          if (!EX[m.exId] || EX[m.exId].side !== 'perSet') continue;
          seen[m.exId] = (seen[m.exId] || 0) + 1;
          if (m.sets % 2 || m.sets < 2) bad.push({ p, ex: m.exId, sets: m.sets });
        }
      }
      o.oddInProgram = bad.length;
      o.distinctPerSideSeen = Object.keys(seen).length;   // guard: the sweep saw some
      o.timesSeen = Object.values(seen).reduce((a, b) => a + b, 0);

      /* The direction follows what the app is already doing to the session.
         Easing rules exist to take work away; none of them should be handed a
         set back by a rounding rule. */
      o.evenUp = evenSets(3, false);
      o.evenDown = evenSets(3, true);
      o.evenLeavesEven = [evenSets(2, false), evenSets(2, true), evenSets(4, false)];
      o.neverBelowTwo = [evenSets(1, true), evenSets(0, true), evenSets(1, false)];

      /* Driven, not just the helper: an uncleared health screen puts the
         athlete in safe mode, and the count must come DOWN to two, not up. */
      const realP = JSON.stringify(STATE.profile.parq), realD = STATE.profile.parqDone;
      STATE.profile.parq = ['heart']; STATE.profile.parqDone = true;
      o.safeModeOn = safeMode();
      o.sidePlankInSafeMode = prescribe('sideplank', posOf(0)).sets;
      STATE.profile.parq = JSON.parse(realP); STATE.profile.parqDone = realD;
      o.backToNormal = prescribe('sideplank', posOf(0)).sets;

      // the steps of every per-side movement must say to switch, and the
      // validator must enforce both directions
      o.validatorClean = validateData().filter(x => /side/.test(x));
      const realSide = EX.sideplank.side;
      const realErr = console.error;
      console.error = () => {};        // validateData() logs; the harness counts that
      EX.sideplank.side = 'sometimes';
      o.validatorCatchesJunk = validateData().some(x => /sideplank.*unknown side/.test(x));
      EX.sideplank.side = realSide;
      console.error = realErr;

      return o;
    });
    t.ok('guard: the sweep actually met per-side movements', sd.distinctPerSideSeen >= 6, sd);
    t.ok('guard: and met them many times', sd.timesSeen > 100, sd);
    t.eq('no per-side movement gets an odd set count anywhere in the program', sd.oddInProgram, 0, sd);
    t.eq('the reported side plank is four sets, not three', sd.sidePlank, 4, sd);
    t.eq('floor: a two-sided squat is untouched', sd.squat, 3, sd);
    t.eq('floor: and so is a push-up', sd.pushup, 3, sd);
    t.eq('rounding goes UP by default', sd.evenUp, 4, sd);
    t.eq('and DOWN when the app is already easing off', sd.evenDown, 2, sd);
    t.eq('an even count is left alone either way', sd.evenLeavesEven, [2, 2, 4], sd);
    t.eq('and it never drops below two — one set cannot be balanced', sd.neverBelowTwo, [2, 2, 2], sd);
    t.ok('guard: the safe-mode case really is in safe mode', sd.safeModeOn, sd);
    t.eq('a flagged athlete gets two sets, not four', sd.sidePlankInSafeMode, 2, sd);
    t.eq('and clearing the flag puts it back to four', sd.backToNormal, 4, sd);
    t.eq('the validator has no complaint about any side flag', sd.validatorClean, [], sd);
    t.ok('but it does reject a side value outside the legal set', sd.validatorCatchesJunk, sd);
    t.eq('and that legal set lives in one place', sd.modes, ['switch', 'perSet'], sd);
    t.ok('the twelve per-side movements are the side planks and the single-leg work',
      sd.perSide.length === 12 && sd.perSide.includes('sideplank') && sd.perSide.includes('pistol')
      && sd.perSide.includes('warriorthree'), sd);
    t.ok('and the mid-set switchers are a separate, smaller set',
      sd.switching.includes('kbrow') && sd.switching.includes('kbsuitcase')
      && !sd.switching.includes('sideplank'), sd);

    /* The player has to SAY which side, or an even count balances nothing —
       the athlete has no way to know he is meant to alternate. */
    const say = await page.evaluate(() => {
      const said = []; const realSpeak = window.coachSpeak, realPlSay = window.plSay;
      window.coachSpeak = t2 => { said.push(String(t2)); return true; };
      window.plSay = t2 => { said.push(String(t2)); return true; };
      const o = {};
      /* seedAthlete starts at pointer 0, which is week-1 core work and carries
         no per-side movement at all — the guard caught it. Walk the program for
         a session that has one AND a two-sided one, so the floor has something
         to stand on. */
      const realPtr = STATE.progressPtr;
      let found = -1;
      for (let p = 0; p < SESSIONS_PER_CYCLE * TOTAL_CYCLES && found < 0; p++) {
        const s2 = buildSession(p);
        const items = [...s2.main, s2.finisher].filter(Boolean);
        if (items.some(m => EX[m.exId] && EX[m.exId].side === 'perSet')
            && items.some(m => EX[m.exId] && !EX[m.exId].side)) found = p;
      }
      o.foundAt = found;
      if (found >= 0) STATE.progressPtr = found;
      openPlayer();
      const i = PLAYER ? PLAYER.items.findIndex(m => EX[m.exId] && EX[m.exId].side === 'perSet') : -1;
      const j = PLAYER ? PLAYER.items.findIndex(m => EX[m.exId] && !EX[m.exId].side) : -1;
      if (i < 0 || j < 0) { o.guard = 'no per-side or no plain movement in this session'; }
      else {
        PLAYER.i = i; PLAYER.s = 0; said.length = 0; plEnterReady(false);
        o.set1 = said.join(' | '); o.sub1 = ($('#plSub') || {}).textContent;
        PLAYER.s = 1; said.length = 0; plEnterReady(false);
        o.set2 = said.join(' | '); o.sub2 = ($('#plSub') || {}).textContent;
        PLAYER.s = 2; said.length = 0; plEnterReady(false);
        o.set3 = said.join(' | ');
        // FLOOR: a two-sided movement must claim no side at all
        PLAYER.i = j; PLAYER.s = 0; said.length = 0; plEnterReady(false);
        o.plain = said.join(' | '); o.plainSub = ($('#plSub') || {}).textContent;
      }
      window.coachSpeak = realSpeak; window.plSay = realPlSay;
      try { plQuit(true); } catch (e) { try { plClear(); } catch (e2) {} }
      STATE.progressPtr = realPtr; save();      // put the shared pointer back
      return o;
    });
    t.ok('guard: the session had both a per-side and a two-sided movement', !say.guard, say);
    t.ok('set 1 of a per-side movement names the first side', /Left side/.test(say.set1), say);
    t.ok('and set 2 names the other one', /Right side/.test(say.set2), say);
    t.ok('and set 3 comes back to the first', /Left side/.test(say.set3), say);
    t.ok('the screen shows it too', /LEFT SIDE/.test(say.sub1 || ''), say);
    t.ok('and follows the set', /RIGHT SIDE/.test(say.sub2 || ''), say);
    t.ok('floor: a two-sided movement claims no side', !/Left side|Right side/.test(say.plain), say);
    t.ok('and its screen says GET READY as before', /GET READY/.test(say.plainSub || ''), say);
  }

  /* ---- a mid-session swap has to ask prescribe() for the SET COUNT too ----
     playerSwap() computed rx = prescribe(exId, pos) and used only rx.target, so
     swapping a two-sided movement for a PER-SIDE one kept the old count:
     measured, a 3-set Bear Hold swapped for a Side Plank stayed at 3 — two sets
     on one side and one on the other, the exact imbalance evenSets() exists to
     prevent, arriving through the swap path. v351 fixed prescribe(); this
     caller never asked it. */
  {
    const r = await page.evaluate(() => {
      const out = {};
      // a real session slot holding a two-sided movement with an ODD count
      let found = null;
      for (let p = 0; p < 378 && !found; p++) {
        const ss = buildSession(p);
        const m = [...ss.main].find(x => x && !sidePerSet(x.exId) && x.sets % 2 === 1);
        if (m) found = { p, exId: m.exId, sets: m.sets };
      }
      out.found = found;
      if (!found) return out;
      STATE.progressPtr = found.p;

      openPlayer(buildSession(found.p));
      const i = PLAYER.items.findIndex(x => x.exId === found.exId);
      out.idx = i;
      if (i < 0) return out;
      PLAYER.i = i; PLAYER.s = 0;
      out.before = { sets: PLAYER.items[i].sets, perSet: sidePerSet(PLAYER.items[i].exId) };
      {const _rx = prescribe('sideplank', PLAYER.sess.pos);
       out.prescribed = _rx.sets; out.prescribedTarget = _rx.target;}
      out.beforeTarget = PLAYER.items[i].target;
      playerSwap('sideplank');
      out.after = { sets: PLAYER.items[i].sets, perSet: sidePerSet(PLAYER.items[i].exId),
                    target: PLAYER.items[i].target, unit: PLAYER.items[i].unit };

      /* FLOOR — a swap between two TWO-SIDED movements still takes what
         prescribe() says and is not forced even. An "always round up" fix
         satisfies every assertion above and quietly adds a set everywhere. */
      /* playerSwap() PERSISTS the swap, so rebuilding the session no longer
         holds the original movement — the second block found index -1 and threw
         on plCur(). Each block builds the state it asserts on. */
      STATE.swaps = {};
      openPlayer(buildSession(found.p));
      const j = PLAYER.items.findIndex(x => x.exId === found.exId);
      out.j = j; if (j < 0) return out;
      PLAYER.i = j; PLAYER.s = 0;
      {const _rx = prescribe('crunch', PLAYER.sess.pos);
       out.plainRx = _rx.sets; out.plainRxTarget = _rx.target;}
      out.plainUnitBefore = PLAYER.items[j].unit;
      playerSwap('crunch');
      out.plainAfter = PLAYER.items[j].sets;
      out.plainUnitAfter = PLAYER.items[j].unit;
      out.plainTargetAfter = PLAYER.items[j].target;

      /* FLOOR — a swap can never end the item underneath the athlete. On set 4
         of 4, swapping to a movement prescribing fewer must still leave room
         for the set they are standing in. */
      STATE.swaps = {};
      openPlayer(buildSession(found.p));
      const k = PLAYER.items.findIndex(x => x.exId === found.exId);
      out.k = k; if (k < 0) return out;
      PLAYER.i = k; PLAYER.s = 5;                 // deliberately past the count
      playerSwap('crunch');
      out.strandGuard = PLAYER.items[k].sets;
      playerQuit(); STATE.swaps = {};
      return out;
    });

    t.ok('guard: the sweep found a two-sided movement on an odd set count',
      r.found && r.found.sets % 2 === 1 && r.idx >= 0, JSON.stringify(r.found));
    if (r.found && r.idx >= 0) {
      t.ok('guard: and prescribe() really wants an even count for the per-side one',
        r.prescribed % 2 === 0, JSON.stringify(r));
      t.ok('guard: both floor blocks found the movement after clearing the swap',
        r.j >= 0 && r.k >= 0, JSON.stringify({ j: r.j, k: r.k }));
      t.eq('a swap to a per-side movement takes the prescribed count',
        r.after.sets, r.prescribed, JSON.stringify(r));
      t.ok('so it is never left odd', r.after.sets % 2 === 0 && r.after.perSet, JSON.stringify(r));
      /* THE TARGET IS THE OTHER HALF, and nothing had ever pinned it: a mutant
         that stopped re-prescribing it escaped, leaving the athlete doing the
         new movement at the OLD movement's number. The guard is what makes the
         assertion mean something — if the two targets happen to agree, an
         unchanged value passes on nothing. */
      t.ok('guard: the two movements really want different targets',
        r.prescribedTarget !== r.beforeTarget,
        JSON.stringify({ was: r.beforeTarget, wants: r.prescribedTarget }));
      t.eq('and the target is re-prescribed for the movement actually being done',
        r.after.target, r.prescribedTarget, JSON.stringify(r));
      /* THE UNIT NEEDS A PAIR THAT ACTUALLY DIFFERS. Bear Hold and Side Plank
         are both timed, so a mutant that stopped updating the unit was
         equivalent here and escaped — a guard that cannot fire in the case you
         tested is not tested. The reps swap below is what discriminates. */
      t.eq('with the movement\u2019s own unit', r.after.unit, 'time');
      t.eq('FLOOR: a swap between two-sided movements is not forced even',
        r.plainAfter, r.plainRx, JSON.stringify(r));
      t.ok('guard: this swap really does change the unit',
        r.plainUnitBefore === 'time', JSON.stringify({ before: r.plainUnitBefore }));
      t.eq('so a timed movement swapped for a rep one carries reps', r.plainUnitAfter, 'reps');
      t.eq('and that movement\u2019s own target', r.plainTargetAfter, r.plainRxTarget,
        JSON.stringify({ got: r.plainTargetAfter, want: r.plainRxTarget }));
      t.ok('FLOOR: and a swap never ends the item underneath the athlete',
        r.strandGuard >= 6, JSON.stringify({ onSet: 6, sets: r.strandGuard }));
    }
  }

  await browser.close(); srv.close();
  return t.finish(errors);
}
