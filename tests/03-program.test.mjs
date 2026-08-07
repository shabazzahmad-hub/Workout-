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

  await browser.close(); srv.close();
  return t.finish(errors);
}
