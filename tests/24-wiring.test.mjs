/* Suite 24 — is every onboarding control actually WIRED to the program?

   This repo's worst defect class is a control that looks connected and is not.
   `focusBonus()` walked a priority list and returned on the first key that
   yielded a candidate, so every secondary target and every trouble zone the
   quiz collected was dead input — and the comment on it claimed the opposite,
   which is how it survived. Individual controls are checked in several suites;
   nothing swept them ALL and asserted each one moves the built program.

   The method is the one CLAUDE.md prescribes for exactly this: set A,
   fingerprint the whole program, set B, fingerprint again, assert they differ.
   Two things make it honest rather than decorative:

     - Both values are stated EXPLICITLY. Setting a control to the value the
       seeded athlete already has is a no-op, and reads as "dead" when the wire
       is perfectly fine. That produced three false findings while this suite
       was being written, which is the whole reason the pairs are spelled out.
     - It runs over a SPREAD of the 378-session program. Gear and handstands
       cannot appear in a week-1 bodyweight core day, so testing there proves
       nothing.
*/
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

export default async function run() {
  const t = suite('input wiring');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  const r = await page.evaluate(() => {
    const out = { errs: [] };
    const SPREAD = []; for (let i = 0; i < 378; i += 5) SPREAD.push(i);

    const fp = () => {
      const parts = [];
      for (const i of SPREAD) {
        try { const s = buildSession(i); const it = [];
          Object.keys(s).forEach(k => { if (Array.isArray(s[k])) s[k].forEach(x => x && x.exId && it.push(x.exId + ':' + x.target + 'x' + x.sets)); });
          parts.push(it.join(',')); } catch (e) { parts.push('ERR:' + e.message); }
      }
      return parts.join('|');
    };

    /* A FRESH deep copy every time. Handing back the same object let each
       mutation write onto the saved baseline, so every probe after the first
       compared against accumulated junk — the "every block builds the state it
       asserts on" trap, which is easy to reintroduce here. */
    const KEEP = JSON.stringify({ profile: STATE.profile, baseline: STATE.baseline,
      reassess: STATE.reassess, ptr: STATE.progressPtr });
    const restore = () => { const o = JSON.parse(KEEP); STATE.profile = o.profile;
      STATE.baseline = o.baseline; STATE.reassess = o.reassess; STATE.progressPtr = o.ptr; };

    // guard: the fingerprint is a real, populated signal, not an empty string
    restore();
    const sample = fp();
    out.fpLen = sample.length;
    out.fpItems = (sample.match(/:/g) || []).length;

    /* Both ends stated explicitly — never "change it to X" against a seeded
       athlete who may already BE X. */
    const PAIRS = [
      ['experience', p => { p.experience = 'Beginner'; }, p => { p.experience = 'Advanced'; }],
      ['goal', p => { p.goal = 'lose'; }, p => { p.goal = 'gain'; }],
      ['gear', p => { p.gear = []; }, p => { p.gear = ['dumbbell', 'bar', 'kettlebell', 'bench']; }],
      ['limitations', p => { p.limitations = []; }, p => { p.limitations = ['shoulder', 'knee']; }],
      ['tightSpace', p => { p.tightSpace = false; }, p => { p.tightSpace = true; }],
      ['focusPrimary', p => { p.focusPrimary = 'abs'; }, p => { p.focusPrimary = 'glutes'; }],
      ['troubleZones', p => { p.troubleZones = []; }, p => { p.troubleZones = ['arms', 'chest', 'thighs']; }],
      ['conditioning', p => { p.conditioning = 'low'; }, p => { p.conditioning = 'high'; }],
    ];
    out.pairs = PAIRS.map(([name, a, b]) => {
      restore(); try { a(STATE.profile); } catch (e) { out.errs.push(name + ' A: ' + e.message); }
      const A = fp();
      restore(); try { b(STATE.profile); } catch (e) { out.errs.push(name + ' B: ' + e.message); }
      const B = fp();
      restore();
      return { name, moves: A !== B };
    });

    /* `goal` moves the program through TWO independent paths: prescribe()'s
       rep/rest multipliers (the numbers) and rungIndex()'s +1 rung for 'gain'
       (the exercise NAMES). The pair check above cannot tell them apart —
       deleting the rung bump still changes every target, so it passes on a
       version where the documented promise, "this is what makes 'I changed my
       goal' visible in the exercise names", is dead. Fingerprint the ids ALONE
       to separate them. */
    const ids = () => {
      const parts = [];
      for (const i of SPREAD) {
        try { const s = buildSession(i);
          parts.push([...s.main, s.finisher].filter(Boolean).map(m => m.exId).join(',')); }
        catch (e) { parts.push('ERR'); }
      }
      return parts.join('|');
    };
    restore(); STATE.profile.goal = 'lose'; const idsLose = ids();
    restore(); STATE.profile.goal = 'gain'; const idsGain = ids();
    restore();
    out.goalMovesNames = idsLose !== idsGain;

    /* Even the ids-only fingerprint could not isolate the rung bump: `goal`
       reaches the exercise names through more than one path, so deleting the
       bump still left the two fingerprints different and the check passed on a
       version where the bump was gone. Measure the thing under test DIRECTLY —
       the same rule this repo applies to reading the SSML pitch attribute
       rather than asserting the SSML "builds". Chosen with real headroom above
       the rung so the clamp cannot mask the +1. */
    restore();
    out.rung = ['plankL', 'hollowL', 'lowerL'].map(lad => {
      const arr = LADDERS[lad] || [];
      STATE.profile.goal = 'lose'; const lo = rungIndex(lad, 0, 1, 'Beginner');
      STATE.profile.goal = 'gain'; const hi = rungIndex(lad, 0, 1, 'Beginner');
      return { lad, lo, hi, headroom: arr.length - 1 - lo };
    });
    restore();

    // the measured numbers themselves must steer the program
    restore();
    const beforeM = fp();
    STATE.baseline = JSON.parse(JSON.stringify(STATE.baseline));
    Object.keys(STATE.baseline.maxes).forEach(k => { STATE.baseline.maxes[k] = STATE.baseline.maxes[k] * 2; });
    const afterM = fp();
    restore();
    out.maxesMove = beforeM !== afterM;

    // measured level, both directions away from the seeded value
    restore();
    const atLevel = lv => { STATE.baseline = Object.assign(JSON.parse(JSON.stringify(STATE.baseline)), { level: lv });
      STATE.profile.experience = lv; const f = fp(); restore(); return f; };
    out.levelMoves = atLevel('Beginner') !== atLevel('Advanced');

    /* ---- a re-test must rebuild the block it belongs to ---- */
    const RE = { level: 'Advanced', score: 92, testCount: TESTS.length,
      maxes: { plank: 240, side: 150, hollow: 150, lower: 60, dyn: 90, push: 70, pull: 30, squat: 90, power: 60, stamina: 60 } };
    out.reassess = [1, 2].map(c => {
      restore();
      const idxs = [c * SESSIONS_PER_CYCLE, c * SESSIONS_PER_CYCLE + 9, c * SESSIONS_PER_CYCLE + 30];
      const rd = () => idxs.map(i => { try { const s = buildSession(i);
        return [...s.main, s.finisher].filter(Boolean).map(m => m.exId + ':' + m.target).join(','); } catch (e) { return 'ERR'; } }).join('|');
      const before = rd();
      STATE.reassess[c] = JSON.parse(JSON.stringify(RE));
      const after = rd();
      restore();
      return { cycle: c, moves: before !== after };
    });

    // currentMaxes must READ the re-test, not just store it
    restore();
    const base1 = currentMaxes(1).plank;
    STATE.reassess[1] = JSON.parse(JSON.stringify(RE));
    const re1 = currentMaxes(1).plank;
    restore();
    out.currentMaxes = { base1, re1 };

    // and the gate must fire only at a block boundary
    restore();
    out.gates = [0, 1, SESSIONS_PER_CYCLE - 1, SESSIONS_PER_CYCLE, SESSIONS_PER_CYCLE + 1, SESSIONS_PER_CYCLE * 2]
      .map(p => { STATE.progressPtr = p; return { p, g: reassessGate() }; });
    restore();
    return out;
  });

  /* Guards first. A fingerprint that came back empty would make every
     "moves" assertion below pass or fail on nothing. */
  t.ok('guard: the program fingerprint is a real signal', r.fpLen > 5000, { len: r.fpLen });
  t.ok('guard: and it contains many prescribed items', r.fpItems > 300, { items: r.fpItems });
  t.eq('no control threw while being changed', r.errs, []);

  r.pairs.forEach(p => t.ok(`the "${p.name}" answer changes the program`, p.moves, p));

  t.ok('changing the goal changes which EXERCISES are prescribed, not only the numbers',
    r.goalMovesNames, r);
  r.rung.forEach(x => {
    // guard: without headroom the clamp would hide the bump and this proves nothing
    t.ok(`guard: ${x.lad} has room above the rung to climb`, x.headroom >= 2, x);
    t.eq(`"build muscle" climbs a rung on ${x.lad}`, x.hi, x.lo + 1, x);
  });
  t.ok('the measured maxes steer the program', r.maxesMove, r);
  t.ok('the measured level steers the program', r.levelMoves, r);

  r.reassess.forEach(x => t.ok(`a re-test rebuilds block ${x.cycle + 1}`, x.moves, x));
  t.ok('currentMaxes reads the re-test rather than the baseline',
    r.currentMaxes.re1 !== r.currentMaxes.base1, r.currentMaxes);
  t.eq('the re-test gate fires only at a block boundary',
    r.gates.filter(x => x.g > 0).map(x => x.p), [42, 84], r.gates);

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
