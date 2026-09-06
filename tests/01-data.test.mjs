/* Data integrity. This is the cheapest, highest-yield file in the suite: the
   defects it catches are the ones repeated regex edits over EX and the swap maps
   keep reintroducing, and every one of them is silent at runtime. */
import { serve, launch, suite, ROOT } from './lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

export default async function run() {
  const t = suite('data integrity');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);

  const r = await page.evaluate(() => {
    const testUnit = {}; TESTS.forEach(x => testUnit[x.id] = x.unit);
    const imgs = Object.keys(EX).filter(k => EX[k].img).map(k => EX[k].img);
    return {
      validator: validateData(),
      exCount: Object.keys(EX).length,
      withImg: new Set(imgs).size,
      images: [...new Set(imgs)],
      noImg: Object.keys(EX).filter(k => !EX[k].img),
      appVersion: APP_VERSION,
      // every swap target must resolve
      swapMisses: [['SAFE_SWAP', SAFE_SWAP], ['LOWBACK_SWAP', LOWBACK_SWAP], ['GEAR_FALLBACK', GEAR_FALLBACK]]
        .flatMap(([n, m]) => Object.keys(m).filter(k => !EX[m[k]]).map(k => n + '.' + k + ' -> ' + m[k])),
      riskMisses: Object.keys(JOINT_RISK)
        .flatMap(j => JOINT_RISK[j].filter(k => !EX[k]).map(k => j + ': ' + k)),
      // a ladder must never get EASIER as it climbs
      ladderBreaks: Object.keys(LADDERS).flatMap(l => {
        const a = LADDERS[l]; const out = [];
        for (let i = 1; i < a.length; i++) {
          const p = EX[a[i - 1]], c = EX[a[i]];
          if (!p || !c) { out.push(l + ': unknown rung'); continue; }
          if (p.anchor && c.anchor && p.anchor === c.anchor && c.hardness > p.hardness)
            out.push(`${l}[${i}] ${a[i]}(${c.hardness}) easier than ${a[i - 1]}(${p.hardness})`);
        }
        return out;
      }),
      unitMismatch: Object.keys(EX).filter(k => EX[k].anchor && testUnit[EX[k].anchor]
        && testUnit[EX[k].anchor] !== EX[k].unit),
      // an anchored move left at the default hardness is an uncalibrated one
      overCap: Object.keys(EX).filter(k => EX[k].unit === 'reps' && EX[k].repCap > 0 && EX[k].base > EX[k].repCap),
      gearNoPattern: Object.keys(EX).filter(k => EX[k].equip && EX[k].equip.length && !EX[k].pattern),
      noHardness: Object.keys(EX).filter(k => !(EX[k].hardness > 0)),
      thinCopy: Object.keys(EX).filter(k => !EX[k].steps || !EX[k].cues || !EX[k].mistakes
        || !EX[k].steps.length || !EX[k].cues.length),
      testCount: TESTS.length,
      testExMissing: TESTS.filter(x => !EX[x.ex]).map(x => x.id),
    };
  });

  t.eq('validateData() reports no problems', r.validator, []);
  t.ok('every exercise has artwork', r.noImg.length === 0, r.noImg);
  t.ok('every swap target exists', r.swapMisses.length === 0, r.swapMisses);
  t.ok('every JOINT_RISK entry names a real exercise', r.riskMisses.length === 0, r.riskMisses);
  t.ok('every ladder is non-increasing in hardness', r.ladderBreaks.length === 0, r.ladderBreaks);
  t.ok('no exercise is anchored to a test of a different unit', r.unitMismatch.length === 0, r.unitMismatch);
  t.ok('no exercise base exceeds its own rep cap', r.overCap.length === 0, r.overCap);
  t.ok('every gear exercise carries a pattern', r.gearNoPattern.length === 0, r.gearNoPattern);
  t.ok('every exercise has a hardness', r.noHardness.length === 0, r.noHardness);
  t.ok('every exercise has complete coaching copy', r.thinCopy.length === 0, r.thinCopy);
  t.ok('every test names a real exercise', r.testExMissing.length === 0, r.testExMissing);

  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  /* Duplicate keys in a hand-maintained object literal are silent — JS keeps the
     last one. That is how boxpistol shipped with two repCaps and how a shadowed
     SAFE_SWAP entry routed a flagged low back into lumbar flexion.

     This replaces two weaker scans and is strictly stronger than both, which was
     measured rather than assumed:

     - The old list named FIVE maps by hand. A hand-written list of the members
       it guards is the drift this repo records everywhere else: the sixth map
       gets no guard on the day it is added. This walks every ALLCAPS data
       literal in the file — 147 of them.
     - The old EX field scan was `[^\n]*`, so it could only see a repeat on an
       entry's FIRST line. Measured: ALL 197 EX entries are multi-line, so a
       field repeated on line 2 or below was invisible. A shadowed `hardness` is
       exactly the silent kind — this file records an uncalibrated one
       prescribing 4x40 dips.
     - It skips strings and comments, so prose that merely looks like code is
       not counted. The old text scan flagged a comment reading `btsquat:'squat'`
       and another reading `FORCE:`, twice costing real time. */
  const dupKeys = (js) => {
    const scan = (t, start) => {
      let i = start; const stack = []; const out = []; const n = t.length;
      while (i < n) {
        const c = t[i];
        if (c === '/' && t[i + 1] === '/') { const j = t.indexOf('\n', i); i = j < 0 ? n : j; continue; }
        if (c === '/' && t[i + 1] === '*') { const j = t.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
        if (c === "'" || c === '"' || c === '`') {
          const q = c; i++;
          while (i < n) { if (t[i] === '\\') { i += 2; continue; } if (t[i] === q) { i++; break; } i++; }
          continue;
        }
        if (c === '{') { stack.push({ obj: true, seen: new Set() }); i++; continue; }
        if (c === '[') { stack.push({ obj: false }); i++; continue; }
        if (c === '}' || c === ']') { stack.pop(); if (!stack.length) return out; i++; continue; }
        const top = stack[stack.length - 1];
        if (top && top.obj) {
          const m = /^(['"]?)([A-Za-z_$][A-Za-z0-9_$]*)\1\s*:/.exec(t.slice(i, i + 64));
          /* Only a key: the previous non-space character must open the object or
             end the field before it. That is what keeps a ternary's `a ? b : c`
             and a `case x:` out of the key set. */
          if (m) {
            let j = i - 1; while (j >= 0 && ' \t\r\n'.includes(t[j])) j--;
            if (j >= 0 && (t[j] === '{' || t[j] === ',')) {
              if (top.seen.has(m[2])) out.push({ key: m[2], at: i });
              top.seen.add(m[2]); i += m[0].length; continue;
            }
          }
        }
        i++;
      }
      return out;
    };
    const found = []; let literals = 0;
    const re = /\bconst\s+([A-Z][A-Z0-9_]+)\s*=\s*[{[]/g;
    let m;
    while ((m = re.exec(js))) {
      literals++;
      for (const d of scan(js, m.index + m[0].length - 1)) {
        found.push(`${m[1]}.${d.key} @ line ${js.slice(0, d.at).split('\n').length}`);
      }
    }
    return { literals, found };
  };

  /* The BIGGEST inline script — the first one on this page is two characters
     long, and reading it reports every literal as absent. */
  const appJs = (src.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [])
    .sort((a, b) => b.length - a.length)[0] || '';
  t.ok('guard: the duplicate-key scan read the app script', /function prescribe/.test(appJs));

  /* A detector that reports zero must be shown finding one first, and the
     synthetic source keeps that proof independent of what the real file
     happens to contain today. The name is two characters because `EX` is —
     an earlier version of this scan demanded three and silently skipped the
     single most important literal in the app. */
  const SYN_CLEAN = 'const XY = {\n  a:{x:1,\n    y:2},\n};';
  const SYN_DEEP  = 'const XY = {\n  a:{x:1,\n    y:2,\n    x:3},\n};';
  const SYN_TOP   = 'const XY = {\n  a:{x:1},\n  a:{x:2},\n};';
  t.eq('guard: a clean literal reports nothing', dupKeys(SYN_CLEAN).found.length, 0);
  t.eq('guard: a field repeated on a LATER line is seen', dupKeys(SYN_DEEP).found.length, 1);
  t.eq('guard: and a repeated top-level key is seen', dupKeys(SYN_TOP).found.length, 1);

  const dk = dupKeys(appJs);
  t.ok('guard: the scan walked every data literal', dk.literals > 100, dk.literals);
  t.ok('no data literal has a duplicate key', dk.found.length === 0, dk.found);

  /* The service worker shell is the offline cache. A referenced-but-uncached
     image is a blank card on a phone with no signal. */
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const cacheName = (sw.match(/const CACHE\s*=\s*'([^']+)'/) || [])[1] || '';
  t.eq('sw.js CACHE and APP_VERSION are in lockstep', cacheName, 'coreforge-v' + r.appVersion);
  const missing = r.images.filter(i => !sw.includes("'./" + i + "'"));
  t.ok('every referenced image is in the service-worker shell', missing.length === 0, missing);
  const shell = [...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]).filter(f => /\.(jpg|png|mp4|woff2)$/.test(f));
  const onDisk = shell.filter(f => !fs.existsSync(path.join(ROOT, f)));
  t.ok('every shell asset exists on disk', onDisk.length === 0, onDisk);

  /* ---- the three new core additions (Dumbbell Pallof Press, Medicine Ball
     Woodchopper, Full Dragon Flag) land where they were designed to, not just
     where validateData()'s generic sweep happens not to complain. ---------- */
  const core = await page.evaluate(() => {
    const o = {};
    o.hollowLTop = LADDERS.hollowL[LADDERS.hollowL.length - 1];
    o.dragonflagNotTop = LADDERS.hollowL.indexOf('dragonflag') < LADDERS.hollowL.indexOf('dragonflagfull');
    o.equip = { dbpallof: EX.dbpallof.equip, mbchop: EX.mbchop.equip, dragonflagfull: EX.dragonflagfull.equip };
    // hasGearFor() actually gates on the equipment, both ways
    STATE.profile.gear = [];
    o.noneOwned = { dbpallof: hasGearFor('dbpallof'), mbchop: hasGearFor('mbchop'), dragonflagfull: hasGearFor('dragonflagfull') };
    STATE.profile.gear = ['dumbbell', 'medball', 'bar'];
    o.allOwned = { dbpallof: hasGearFor('dbpallof'), mbchop: hasGearFor('mbchop'), dragonflagfull: hasGearFor('dragonflagfull') };
    // an anti-rotation press is genuinely joint-friendly by design — unflagged, matching dbtwist's own precedent
    o.dbpallofFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('dbpallof'));
    // a loaded, ballistic standing rotation is flagged the same way its seated cousins (mbtwist, russiantwist) already are
    o.mbchopLowback = JOINT_RISK.lowback.includes('mbchop');
    o.mbchopLandsSafe = (() => {
      const real = STATE.profile.limitations; STATE.profile.limitations = ['lowback'];
      const out = safeSwap('mbchop'); STATE.profile.limitations = real;
      return !!EX[out] && !JOINT_RISK.lowback.includes(out);
    })();
    // the full dragon flag carries the SAME flags as the bent-knee rung it extends, and lands the same places
    o.dragonflagfullShoulder = JOINT_RISK.shoulder.includes('dragonflagfull');
    o.dragonflagfullLowback = JOINT_RISK.lowback.includes('dragonflagfull');
    o.dragonflagfullSwaps = { safe: SAFE_SWAP.dragonflagfull, lowback: LOWBACK_SWAP.dragonflagfull };
    // reachable by the focus bonus (abs/obliques), the actual point of adding them
    o.inFocusPool = { dbpallof: FOCUS_POOL.obliques.includes('dbpallof'),
      mbchop: FOCUS_POOL.obliques.includes('mbchop'), dragonflagfull: FOCUS_POOL.abs.includes('dragonflagfull') };
    STATE.profile.gear = [];
    return o;
  });
  t.eq('the full dragon flag, not the bent-knee version, is the new top of hollowL', core.hollowLTop, 'dragonflagfull');
  t.ok('the bent-knee rung sits below the full version in the ladder', core.dragonflagNotTop, core);
  t.eq('Dumbbell Pallof Press requires a dumbbell', core.equip.dbpallof, ['dumbbell']);
  t.eq('Medicine Ball Woodchopper requires a medicine ball', core.equip.mbchop, ['medball']);
  t.eq('Full Dragon Flag requires a bar, same as the bent-knee version', core.equip.dragonflagfull, ['bar']);
  t.ok('none of the three are offered without the right gear', !core.noneOwned.dbpallof && !core.noneOwned.mbchop && !core.noneOwned.dragonflagfull, core.noneOwned);
  t.ok('all three are offered once the gear is owned', core.allOwned.dbpallof && core.allOwned.mbchop && core.allOwned.dragonflagfull, core.allOwned);
  t.eq('the anti-rotation press is not flagged for any joint — that is its whole purpose', core.dbpallofFlags, []);
  t.ok('the loaded standing woodchopper is flagged for a low back, like its seated cousins', core.mbchopLowback, core);
  t.ok('and a flagged low back is actually routed somewhere safe', core.mbchopLandsSafe, core);
  t.ok('the full dragon flag inherits the shoulder flag its bent-knee rung carries', core.dragonflagfullShoulder, core);
  t.ok('and the low-back flag too', core.dragonflagfullLowback, core);
  t.eq('and lands on the same safe substitutes', core.dragonflagfullSwaps, { safe: 'hollow', lowback: 'plank' });
  t.ok('all three are reachable through the focus bonus', core.inFocusPool.dbpallof && core.inFocusPool.mbchop && core.inFocusPool.dragonflagfull, core.inFocusPool);

  /* ---- eight exercises added from a screenshot-driven roster comparison
     (Sit Thrust, Knee Kicks, Warrior III, Skater Jumps w/ Ground Touch,
     Quick Punches, Toe Touches, Hanging Knee-to-Elbow, Seated Leg Circles).
     The generic "safeSwap lands clear across all 31 joint combinations"
     sweep proves the SWAP MECHANISM works; it cannot prove any of this
     content was ever flagged in the first place — an exercise nobody added
     to JOINT_RISK simply never enters that sweep's risky bucket. These
     assert JOINT_RISK membership directly, per exercise. */
  const eight = await page.evaluate(() => {
    const o = {};
    // knee: cardio/impact family — matches skater/buttkick/highknees precedent
    o.kneeFlags = { kneekick: JOINT_RISK.knee.includes('kneekick'), skaterground: JOINT_RISK.knee.includes('skaterground') };
    // wrist-bearing, hip-thrust-under-weight — matches bearhold's wrist-only precedent
    o.sitthrustFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('sitthrust'));
    // spinal-flexion family — matches situp/vertcrunch/crunch's lowback precedent
    o.toetouchLowback = JOINT_RISK.lowback.includes('toetouch');
    o.legcircleLowback = JOINT_RISK.lowback.includes('legcircle');
    // harder than a straight knee raise (shoulder demand of hanglegraise), still lowback-flagged like both neighbours
    o.kneetoelbowFlags = { shoulder: JOINT_RISK.shoulder.includes('kneetoelbow'), lowback: JOINT_RISK.lowback.includes('kneetoelbow') };
    // a straight-leg standing balance hold is genuinely unflagged, matching plank/hollow's own precedent —
    // not every isometric hold gets a joint flag just because it looks demanding
    o.warriorthreeFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('warriorthree'));
    o.quickpunchFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('quickpunch'));

    // every flagged one actually lands somewhere safe when its OWN joint is flagged
    const landsSafe = (exId, joint) => {
      const real = STATE.profile.limitations; STATE.profile.limitations = [joint];
      const out = safeSwap(exId); STATE.profile.limitations = real;
      return !!EX[out] && !(JOINT_RISK[joint] || []).includes(out);
    };
    o.kneekickLandsSafe = landsSafe('kneekick', 'knee');
    o.skatergroundLandsSafe = landsSafe('skaterground', 'knee');
    o.sitthrustLandsSafe = landsSafe('sitthrust', 'wrist');
    o.toetouchLandsSafe = landsSafe('toetouch', 'lowback');
    o.legcircleLandsSafe = landsSafe('legcircle', 'lowback');
    o.kneetoelbowLandsSafe = landsSafe('kneetoelbow', 'lowback');

    // ladder placement: kneetoelbow strictly between kneeraise and hanglegraise
    o.lowerLOrder = LADDERS.lowerL.map(k => LADDERS.lowerL.indexOf(k));
    o.kneetoelbowBetween = LADDERS.lowerL.indexOf('kneeraise') < LADDERS.lowerL.indexOf('kneetoelbow')
      && LADDERS.lowerL.indexOf('kneetoelbow') < LADDERS.lowerL.indexOf('hanglegraise');
    o.kneetoelbowHardness = { kneeraise: EX.kneeraise.hardness, kneetoelbow: EX.kneetoelbow.hardness, hanglegraise: EX.hanglegraise.hardness };
    // ladder placement: skaterground is the new top of cardioAL, above skater
    o.cardioALTop = LADDERS.cardioAL[LADDERS.cardioAL.length - 1];
    o.skaterBelowGround = LADDERS.cardioAL.indexOf('skater') < LADDERS.cardioAL.indexOf('skaterground');
    o.skatergroundHardness = { skater: EX.skater.hardness, skaterground: EX.skaterground.hardness };

    // equipment: kneetoelbow needs a bar, same as its neighbours, and falls back correctly without one
    o.kneetoelbowEquip = EX.kneetoelbow.equip;
    STATE.profile.gear = [];
    o.kneetoelbowNoBar = hasGearFor('kneetoelbow');
    STATE.profile.gear = ['bar'];
    o.kneetoelbowWithBar = hasGearFor('kneetoelbow');
    STATE.profile.gear = [];
    o.gearFallback = GEAR_FALLBACK.kneetoelbow;
    // the hardcoded no-bar override in buildSession()'s ladder resolver, same
    // pattern as kneeraise/hanglegraise — proved directly by sweeping real
    // built sessions rather than reverse-engineering which ptr lands on which
    // rung index: with no bar owned, kneetoelbow must never be prescribed,
    // and its fallback (kneeraise) must actually appear somewhere in the sweep
    // — otherwise an absent kneetoelbow would prove nothing (the ladder might
    // just never have been reached at all).
    // 400 covers the full ~54-week program regardless of exactly where an
    // earlier block in this same test file left STATE.baseline — the level
    // curve that decides which rung gets reached at which ptr shifts with it,
    // so a short sweep is fragile to block order (the file's own "every block
    // builds the state it asserts on" discipline), a long one is not.
    let sawKneetoelbowNoBar = false, sawKneeraiseNoBar = false;
    for (let p = 0; p < 400; p++) {
      const s = buildSession(p);
      const ids = [...s.main, s.finisher].filter(Boolean).map(m => m.exId);
      if (ids.includes('kneetoelbow')) sawKneetoelbowNoBar = true;
      if (ids.includes('kneeraise')) sawKneeraiseNoBar = true;
    }
    o.noBarSweep = { sawKneetoelbowNoBar, sawKneeraiseNoBar };

    // reachable through the focus bonus
    o.inFocusPool = {
      toetouch: FOCUS_POOL.abs.includes('toetouch'), sitthrust: FOCUS_POOL.abs.includes('sitthrust'),
      legcircle: FOCUS_POOL.abs.includes('legcircle'), kneetoelbow: FOCUS_POOL.abs.includes('kneetoelbow'),
      kneekick: FOCUS_POOL.full.includes('kneekick'), quickpunch: FOCUS_POOL.full.includes('quickpunch'),
    };
    return o;
  });
  t.ok('Knee Kicks is flagged for a knee, matching the standing-impact family it sits in', eight.kneeFlags.kneekick, eight.kneeFlags);
  t.ok('so is the harder Skater ground-touch rung', eight.kneeFlags.skaterground, eight.kneeFlags);
  t.eq('Sit Thrust is flagged for a wrist only, matching bearhold\'s own precedent', eight.sitthrustFlags, ['wrist', 'lowback']);
  t.ok('Toe Touches is flagged for a low back, matching the spinal-flexion crunch family', eight.toetouchLowback, eight);
  t.ok('and so is Seated Leg Circles', eight.legcircleLowback, eight);
  t.ok('the knee-to-elbow inherits the shoulder demand of the hanging leg raise it sits below', eight.kneetoelbowFlags.shoulder, eight.kneetoelbowFlags);
  t.ok('and the low-back flag both hanging neighbours carry', eight.kneetoelbowFlags.lowback, eight.kneetoelbowFlags);
  t.eq('Warrior III is a straight-leg balance hold with no real joint-loading risk, so it stays unflagged', eight.warriorthreeFlags, []);
  t.eq('Quick Punches carries no lower-body impact, so it stays unflagged like Shadow Boxing', eight.quickpunchFlags, []);
  t.ok('a flagged knee actually routes Knee Kicks somewhere safe', eight.kneekickLandsSafe, eight);
  t.ok('and the ground-touch skater too', eight.skatergroundLandsSafe, eight);
  t.ok('a flagged wrist routes Sit Thrust somewhere safe', eight.sitthrustLandsSafe, eight);
  t.ok('a flagged low back routes Toe Touches somewhere safe', eight.toetouchLandsSafe, eight);
  t.ok('and Seated Leg Circles', eight.legcircleLandsSafe, eight);
  t.ok('and the knee-to-elbow', eight.kneetoelbowLandsSafe, eight);
  t.eq('the knee-to-elbow lower.L ladder position sits strictly between the raise and the leg raise', eight.kneetoelbowBetween, true, eight);
  t.ok('and its hardness is correctly between the two — non-increasing down the ladder',
    eight.kneetoelbowHardness.kneeraise > eight.kneetoelbowHardness.kneetoelbow
    && eight.kneetoelbowHardness.kneetoelbow > eight.kneetoelbowHardness.hanglegraise, eight.kneetoelbowHardness);
  t.eq('the ground-touch skater is the new top of cardioAL', eight.cardioALTop, 'skaterground');
  t.ok('sitting above plain Skater Hops in the ladder', eight.skaterBelowGround, eight);
  t.ok('with a lower (harder) hardness than the rung below it', eight.skatergroundHardness.skaterground < eight.skatergroundHardness.skater, eight.skatergroundHardness);
  t.eq('the knee-to-elbow requires a bar, matching its hanging neighbours', eight.kneetoelbowEquip, ['bar']);
  t.ok('and is not offered without one', !eight.kneetoelbowNoBar, eight);
  t.ok('but is offered once a bar is owned', eight.kneetoelbowWithBar, eight);
  t.eq('a bar-free athlete falls back to the plain knee raise, the closest already-covered no-bar move', eight.gearFallback, 'legraise');
  t.ok('and a real sweep of built sessions never actually prescribes kneetoelbow without a bar', !eight.noBarSweep.sawKneetoelbowNoBar, eight.noBarSweep);
  t.ok('while its fallback, the plain knee raise, genuinely does appear — proving the ladder rung was actually reached, not just absent by luck',
    eight.noBarSweep.sawKneeraiseNoBar, eight.noBarSweep);
  t.ok('the four core-family additions are reachable through the focus bonus',
    eight.inFocusPool.toetouch && eight.inFocusPool.sitthrust && eight.inFocusPool.legcircle && eight.inFocusPool.kneetoelbow, eight.inFocusPool);
  t.ok('and the two full-body cardio additions too', eight.inFocusPool.kneekick && eight.inFocusPool.quickpunch, eight.inFocusPool);

  /* ---- Dumbbell Bench Press — a follow-up gap: the athlete's own gear
     picker has a "Bench / chair" option that, before this, powered exactly
     one exercise (benchdip). No exercise required dumbbell + bench together;
     the existing loaded chest press (dbfloor) is done lying on the floor.
     This is the first exercise to actually consult both. */
  const bench = await page.evaluate(() => {
    const o = {};
    o.equip = EX.dbbench.equip;
    // the AND-gate: missing EITHER item must deny it, not just missing both
    STATE.profile.gear = [];
    o.gearNone = hasGearFor('dbbench');
    STATE.profile.gear = ['dumbbell'];
    o.gearDbOnly = hasGearFor('dbbench');
    STATE.profile.gear = ['bench'];
    o.gearBenchOnly = hasGearFor('dbbench');
    STATE.profile.gear = ['dumbbell', 'bench'];
    o.gearBoth = hasGearFor('dbbench');
    // the fuller range of motion a bench allows (vs. the floor stopping the
    // descent early) is genuinely more shoulder-loading — dbfloor's own
    // "why" text says as much ("no bench needed"), so this earns the flag
    // dbfloor deliberately does not carry
    o.dbbenchShoulder = JOINT_RISK.shoulder.includes('dbbench');
    o.dbfloorShoulder = JOINT_RISK.shoulder.includes('dbfloor');
    o.dbbenchLandsSafe = (() => {
      const real = STATE.profile.limitations; STATE.profile.limitations = ['shoulder'];
      const out = safeSwap('dbbench'); STATE.profile.limitations = real;
      return !!EX[out] && !JOINT_RISK.shoulder.includes(out);
    })();
    o.safeSwapTarget = SAFE_SWAP.dbbench;
    // GEAR_FALLBACK is consulted only by gearSwap(), which resolve() calls for
    // LADDER rungs — dbbench is reached through the focus bonus instead, whose
    // own has()/hasGearFor() gate never calls gearSwap() at all. So this entry
    // is kept as documentation/defense-in-depth (same precedent as
    // kneeraise:'legraise'), not because any current path needs it — confirmed
    // below by exercising the REAL selection path (focusBonus), not this map.
    o.gearFallback = GEAR_FALLBACK.dbbench;
    o.inFocusPool = FOCUS_POOL.chest.includes('dbbench');

    // real behavioural sweep of the actual selection path: with a dumbbell
    // but no bench, dbbench must never be offered by the focus bonus, while
    // dbfloor (needing only a dumbbell) genuinely is — proving the chest pool
    // was actually reached, not just skipped entirely for some other reason.
    const real = { gear: STATE.profile.gear, focusPrimary: STATE.profile.focusPrimary, targets: STATE.profile.targets };
    STATE.profile.gear = ['dumbbell'];
    STATE.profile.focusPrimary = 'chest';
    STATE.profile.targets = [];
    let sawDbbenchNoBench = false, sawDbfloorNoBench = false;
    for (let c = 0; c < 54; c++) {
      const bonus = focusBonus({ cycle: c, inCycle: 0 }, new Set());
      if (bonus && bonus.exId === 'dbbench') sawDbbenchNoBench = true;
      if (bonus && bonus.exId === 'dbfloor') sawDbfloorNoBench = true;
    }
    o.noBenchSweep = { sawDbbenchNoBench, sawDbfloorNoBench };
    // and with both items owned, dbbench does get offered at least once
    STATE.profile.gear = ['dumbbell', 'bench'];
    let sawDbbenchWithBench = false;
    for (let c = 0; c < 54; c++) {
      const bonus = focusBonus({ cycle: c, inCycle: 0 }, new Set());
      if (bonus && bonus.exId === 'dbbench') sawDbbenchWithBench = true;
    }
    o.sawDbbenchWithBench = sawDbbenchWithBench;
    STATE.profile.gear = real.gear; STATE.profile.focusPrimary = real.focusPrimary; STATE.profile.targets = real.targets;
    return o;
  });
  t.eq('Dumbbell Bench Press requires both a dumbbell and a bench', bench.equip, ['dumbbell', 'bench']);
  t.ok('neither item alone is enough — owning nothing fails', !bench.gearNone, bench);
  t.ok('a dumbbell alone is not enough, missing the bench', !bench.gearDbOnly, bench);
  t.ok('a bench alone is not enough, missing the dumbbell', !bench.gearBenchOnly, bench);
  t.ok('both together is enough', bench.gearBoth, bench);
  t.ok('the fuller range of motion earns a shoulder flag the floor press deliberately does not carry', bench.dbbenchShoulder, bench);
  t.ok('confirming the floor press really does stay unflagged', !bench.dbfloorShoulder, bench);
  t.ok('a flagged shoulder actually routes it somewhere safe', bench.dbbenchLandsSafe, bench);
  t.eq('and lands specifically on the floor press, the documented shoulder-friendlier alternative', bench.safeSwapTarget, 'dbfloor');
  t.eq('GEAR_FALLBACK also points there, for defense-in-depth', bench.gearFallback, 'dbfloor');
  t.ok('reachable through the focus bonus on a chest day', bench.inFocusPool, bench);
  t.ok('a real sweep of the focus bonus never offers it without a bench', !bench.noBenchSweep.sawDbbenchNoBench, bench.noBenchSweep);
  t.ok('while the floor press genuinely is offered — proving the chest pool was actually reached', bench.noBenchSweep.sawDbfloorNoBench, bench.noBenchSweep);
  t.ok('and it is genuinely offered once both items are owned', bench.sawDbbenchWithBench, bench);

  /* ---- five new kettlebell exercises (Windmill, Suitcase Carry, Figure-8,
     Renegade Row, Sumo Deadlift High Pull) — requested after the athlete
     said they now own a 25lb and a 31lb kettlebell. Three core-focused
     (anti-lateral-flexion, anti-rotation), two compound full-body. --------- */
  const kb = await page.evaluate(() => {
    const o = {};
    const ids = ['kbwindmill', 'kbsuitcase', 'kbfigure8', 'kbrenegade', 'kbhighpull'];
    o.equip = {}; ids.forEach(id => { o.equip[id] = EX[id].equip; });
    STATE.profile.gear = [];
    o.noneOwned = {}; ids.forEach(id => { o.noneOwned[id] = hasGearFor(id); });
    STATE.profile.gear = ['kettlebell'];
    o.allOwned = {}; ids.forEach(id => { o.allOwned[id] = hasGearFor(id); });
    // overhead-locked (windmill) and hinge-under-ballistic-load (windmill, high pull)
    // are flagged the same way their existing kb siblings (kbsnatch/kbtgu, kbswing/kbrdl) already are
    o.windmillShoulder = JOINT_RISK.shoulder.includes('kbwindmill');
    o.windmillLowback = JOINT_RISK.lowback.includes('kbwindmill');
    o.highpullLowback = JOINT_RISK.lowback.includes('kbhighpull');
    // a single-arm plank row loads the wrist under an off-center round base, same as its dumbbell cousin
    o.renegadeWrist = JOINT_RISK.wrist.includes('kbrenegade');
    // suitcase carry and figure-8 are deliberately UNFLAGGED — matching kbcarry/kbhalo,
    // their closest siblings, which carry no flag either
    o.suitcaseFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('kbsuitcase'));
    o.figure8Flags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('kbfigure8'));
    // every flagged one still lands somewhere real and unflagged for that joint
    const landsSafe = (exId, joint) => {
      const real = STATE.profile.limitations; STATE.profile.limitations = [joint];
      const out = safeSwap(exId); STATE.profile.limitations = real;
      return !!EX[out] && !(JOINT_RISK[joint] || []).includes(out);
    };
    o.windmillLandsSafeShoulder = landsSafe('kbwindmill', 'shoulder');
    o.windmillLandsSafeLowback = landsSafe('kbwindmill', 'lowback');
    o.highpullLandsSafe = landsSafe('kbhighpull', 'lowback');
    o.renegadeLandsSafe = landsSafe('kbrenegade', 'wrist');
    // reachable through the focus bonus — the core ones via obliques/abs, the compound ones via full/back
    o.inFocusPool = {
      kbwindmill: FOCUS_POOL.obliques.includes('kbwindmill'),
      kbsuitcase: FOCUS_POOL.obliques.includes('kbsuitcase'),
      kbfigure8: FOCUS_POOL.obliques.includes('kbfigure8'),
      kbrenegade: FOCUS_POOL.abs.includes('kbrenegade') && FOCUS_POOL.back.includes('kbrenegade'),
      kbhighpull: FOCUS_POOL.full.includes('kbhighpull'),
    };
    STATE.profile.gear = [];
    return o;
  });
  t.eq('Kettlebell Windmill requires a kettlebell', kb.equip.kbwindmill, ['kettlebell']);
  t.eq('Kettlebell Suitcase Carry requires a kettlebell', kb.equip.kbsuitcase, ['kettlebell']);
  t.eq('Kettlebell Figure-8 requires a kettlebell', kb.equip.kbfigure8, ['kettlebell']);
  t.eq('Kettlebell Renegade Row requires a kettlebell', kb.equip.kbrenegade, ['kettlebell']);
  t.eq('Kettlebell Sumo Deadlift High Pull requires a kettlebell', kb.equip.kbhighpull, ['kettlebell']);
  t.ok('none of the five are offered without a kettlebell', Object.values(kb.noneOwned).every(v => !v), kb.noneOwned);
  t.ok('all five are offered once a kettlebell is owned', Object.values(kb.allOwned).every(v => v), kb.allOwned);
  t.ok('the windmill is flagged for a loaded overhead shoulder, like kbsnatch/kbtgu', kb.windmillShoulder, kb);
  t.ok('and for a weighted hip hinge, like kbswing/kbrdl', kb.windmillLowback, kb);
  t.ok('the sumo high pull is flagged for a weighted hip hinge too', kb.highpullLowback, kb);
  t.ok('the renegade row is flagged for the wrist, like its dumbbell cousin', kb.renegadeWrist, kb);
  t.eq('the suitcase carry is unflagged, matching kbcarry', kb.suitcaseFlags, []);
  t.eq('the figure-8 is unflagged, matching kbhalo', kb.figure8Flags, []);
  t.ok('a flagged shoulder routes the windmill somewhere safe', kb.windmillLandsSafeShoulder, kb);
  t.ok('a flagged low back routes the windmill somewhere safe', kb.windmillLandsSafeLowback, kb);
  t.ok('a flagged low back routes the high pull somewhere safe', kb.highpullLandsSafe, kb);
  t.ok('a flagged wrist routes the renegade row somewhere safe', kb.renegadeLandsSafe, kb);
  t.ok('all five are reachable through the focus bonus', Object.values(kb.inFocusPool).every(v => v), kb.inFocusPool);

  /* ---- two more gaps named directly by the athlete after the kettlebell round:
     a harder progression above the kneeling ab rollout, and a core move that
     actually uses the battle rope for something other than power/cardio. Neither
     belongs in a LADDERS array — abroll itself, the movement abrollstand extends,
     is standalone and reached only through the focus bonus, not a progression walk. */
  const gaps = await page.evaluate(() => {
    const o = {};
    o.equip = { abrollstand: EX.abrollstand.equip, ropeplank: EX.ropeplank.equip };
    STATE.profile.gear = [];
    o.noneOwned = { abrollstand: hasGearFor('abrollstand'), ropeplank: hasGearFor('ropeplank') };
    STATE.profile.gear = ['abroller', 'battlerope'];
    o.allOwned = { abrollstand: hasGearFor('abrollstand'), ropeplank: hasGearFor('ropeplank') };
    o.notLaddered = Object.keys(LADDERS).every(l => !LADDERS[l].includes('abrollstand') && !LADDERS[l].includes('ropeplank'));
    // the standing rollout removes the knee anchor abroll still has — same full risk profile
    o.abrollstandFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('abrollstand')).sort();
    o.abrollFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('abroll')).sort();
    // a controlled isometric hold against a moving rope — plank-family precedent (bearhold/isoclimber), not the ballistic slam
    o.ropeplankFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('ropeplank'));
    const landsSafe = (exId, joint) => {
      const real = STATE.profile.limitations; STATE.profile.limitations = [joint];
      const out = safeSwap(exId); STATE.profile.limitations = real;
      return !!EX[out] && !(JOINT_RISK[joint] || []).includes(out);
    };
    o.abrollstandLandsSafeShoulder = landsSafe('abrollstand', 'shoulder');
    o.abrollstandLandsSafeWrist = landsSafe('abrollstand', 'wrist');
    o.abrollstandLandsSafeLowback = landsSafe('abrollstand', 'lowback');
    o.ropeplankLandsSafeWrist = landsSafe('ropeplank', 'wrist');
    o.inFocusPool = { abrollstand: FOCUS_POOL.abs.includes('abrollstand'), ropeplank: FOCUS_POOL.abs.includes('ropeplank') };
    STATE.profile.gear = [];
    return o;
  });
  t.eq('Standing Ab-Wheel Rollout requires an ab roller', gaps.equip.abrollstand, ['abroller']);
  t.eq('Battle Rope Plank Waves requires a battle rope', gaps.equip.ropeplank, ['battlerope']);
  t.ok('neither is offered without the right gear', !gaps.noneOwned.abrollstand && !gaps.noneOwned.ropeplank, gaps.noneOwned);
  t.ok('both are offered once the gear is owned', gaps.allOwned.abrollstand && gaps.allOwned.ropeplank, gaps.allOwned);
  t.ok('neither sits in a LADDERS array, matching abroll\'s own standalone precedent', gaps.notLaddered, gaps);
  t.eq('the standing rollout inherits the SAME risk profile as the kneeling one it extends', gaps.abrollstandFlags, gaps.abrollFlags);
  t.eq('the rope plank is flagged wrist-only, matching the plank-family hold (bearhold/isoclimber), not the ballistic slam', gaps.ropeplankFlags, ['wrist']);
  t.ok('a flagged shoulder routes the standing rollout somewhere safe', gaps.abrollstandLandsSafeShoulder, gaps);
  t.ok('a flagged wrist routes the standing rollout somewhere safe', gaps.abrollstandLandsSafeWrist, gaps);
  t.ok('a flagged low back routes the standing rollout somewhere safe', gaps.abrollstandLandsSafeLowback, gaps);
  t.ok('a flagged wrist routes the rope plank somewhere safe', gaps.ropeplankLandsSafeWrist, gaps);
  t.ok('both are reachable through the focus bonus', gaps.inFocusPool.abrollstand && gaps.inFocusPool.ropeplank, gaps.inFocusPool);

  /* ---- extended arm plank: a genuinely harder rung above longplank in the SAME
     ladder, not a standalone addition — walking the HANDS forward (arms locked)
     is a further-along point on the exact continuum longplank (elbows forward)
     already occupies, so it belongs IN plankL, not beside it. */
  const ext = await page.evaluate(() => {
    const o = {};
    const lad = LADDERS.plankL;
    o.longplankIdx = lad.indexOf('longplank');
    o.extplankIdx = lad.indexOf('extplank');
    o.hardness = { longplank: EX.longplank.hardness, extplank: EX.extplank.hardness };
    o.anchor = { longplank: EX.longplank.anchor, extplank: EX.extplank.anchor };
    // hand contact (vs longplank's forearm contact) adds a wrist flag that longplank never carried
    o.extplankFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('extplank')).sort();
    o.longplankFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('longplank')).sort();
    const landsSafe = (exId, joint) => {
      const real = STATE.profile.limitations; STATE.profile.limitations = [joint];
      const out = safeSwap(exId); STATE.profile.limitations = real;
      return !!EX[out] && !(JOINT_RISK[joint] || []).includes(out);
    };
    o.landsSafeWrist = landsSafe('extplank', 'wrist');
    o.landsSafeLowback = landsSafe('extplank', 'lowback');
    o.notInFocusPool = Object.keys(FOCUS_POOL).every(k => !FOCUS_POOL[k].includes('extplank'));
    o.longplankNotInFocusPool = Object.keys(FOCUS_POOL).every(k => !FOCUS_POOL[k].includes('longplank'));
    return o;
  });
  t.ok('extplank sits in plankL, right after longplank', ext.extplankIdx === ext.longplankIdx + 1, ext);
  t.eq('both are anchored to the same baseline plank test', ext.anchor, { longplank: 'plank', extplank: 'plank' });
  t.ok('extplank is HARDER (lower hardness) than the longplank rung it extends', ext.hardness.extplank < ext.hardness.longplank, ext);
  t.eq('extplank keeps the lowback flag longplank already carries', ext.extplankFlags.includes('lowback'), true);
  t.eq('and adds a wrist flag longplank never needed, because it is hand- not forearm-contact', ext.extplankFlags, ['lowback', 'wrist']);
  t.eq('longplank itself stays forearm-only (no wrist flag)', ext.longplankFlags, ['lowback']);
  t.ok('a flagged wrist routes extplank somewhere safe', ext.landsSafeWrist, ext);
  t.ok('a flagged low back routes extplank somewhere safe', ext.landsSafeLowback, ext);
  t.eq('extplank is reached via the ladder, matching longplank\'s own exclusion from the focus bonus', ext.notInFocusPool, ext.longplankNotInFocusPool);

  /* ---- Jump Squats: a ninth baseline test, and legPowerL re-anchored to it
     (v247). Explosive power was previously only measured as a fraction of the
     squat test — a proxy for not having a better number. jumpsquat is now the
     'power' test's own anchor exercise; splitjump and broadjump, the harder
     rungs above it, keep their ORIGINAL relative spacing rebased onto the new
     1.0 ceiling. */
  const power = await page.evaluate(() => {
    const o = {};
    o.testEntry = TESTS.find(x => x.id === 'power');
    o.testIdx = TESTS.findIndex(x => x.id === 'power');
    o.equip = EX.jumpsquat.equip;
    // the self-anchor convention every other test's own exercise already uses
    // (pushup/push, squat/squat, plank/plank, ...) — jumpsquat IS the power
    // test's exercise, so it must follow the same hardness:1 pattern.
    o.anchors = { jumpsquat: EX.jumpsquat.anchor, splitjump: EX.splitjump.anchor, broadjump: EX.broadjump.anchor };
    o.hardness = { jumpsquat: EX.jumpsquat.hardness, splitjump: EX.splitjump.hardness, broadjump: EX.broadjump.hardness };
    const lad = LADDERS.legPowerL;
    o.ladderOrder = lad;
    o.monotonic = lad.every((id, i) => i === 0 || EX[lad[i - 1]].hardness >= EX[id].hardness);
    // TEST_DEFAULTS must have an entry for every test id, both directions —
    // exercised directly here, not just inferred from validateData() staying
    // clean, since a validator that never runs the case it claims to guard
    // proves nothing about it.
    o.defaultsHasPower = 'power' in TEST_DEFAULTS;
    o.defaultsKeys = Object.keys(TEST_DEFAULTS).sort();
    o.testIds = TESTS.map(x => x.id).sort();
    /* Backward compatibility: an athlete whose baseline predates this change
       has no maxes.power. prescribe() must not crash or produce NaN for
       jumpsquat in that case — it should fall through to the unanchored
       base/level formula, exactly like any other exercise whose anchor test
       result is missing. Called DIRECTLY rather than through buildSession(),
       which chooses exercises via its own ladder-walk and calendar position —
       whether it happens to reach legPowerL's jumpsquat at a given ptr is a
       fact about session composition, not about prescribe()'s own anchor
       fallback, and asserting on buildSession() output here would make this
       check pass or fail on a coincidence of which exercise got picked. */
    const realBaseline = STATE.baseline;
    STATE.baseline = { date: todayISO(), score: 60, level: 'Intermediate', testCount: 8,
      maxes: { plank: 60, side: 40, hollow: 35, lower: 15, dyn: 30, push: 20, pull: 12, squat: 25 } };   // no .power key at all
    normalizeState();
    const rx = prescribe('jumpsquat', posOf(0));
    o.oldBaselineTarget = rx ? rx.target : null;
    o.oldBaselineFinite = rx ? (typeof rx.target === 'number' && isFinite(rx.target) && rx.target > 0) : null;
    STATE.baseline = realBaseline; normalizeState();
    // and a validateData() problem count of zero is confirmed directly, not
    // just assumed from the rest of this block passing
    o.validateProblems = validateData();
    return o;
  });
  t.eq('the power test is the second test in the battery, right after plank', power.testIdx, 1, power);
  t.eq('it is a 20-second countdown scored in reps, anchored to jumpsquat', { unit: power.testEntry.unit, dur: power.testEntry.dur, ex: power.testEntry.ex }, { unit: 'reps', dur: 20, ex: 'jumpsquat' });
  t.eq('jump squats need no equipment', power.equip, undefined);
  t.eq('jumpsquat, splitjump and broadjump all anchor to the new power test', power.anchors, { jumpsquat: 'power', splitjump: 'power', broadjump: 'power' });
  t.eq('jumpsquat self-anchors at hardness 1, matching every other test\'s own exercise', power.hardness.jumpsquat, 1);
  t.ok('splitjump and broadjump keep their original relative spacing, rebased below it', power.hardness.splitjump < 1 && power.hardness.broadjump < power.hardness.splitjump, power.hardness);
  t.eq('legPowerL is jumpsquat, splitjump, broadjump in that order', power.ladderOrder, ['jumpsquat', 'splitjump', 'broadjump']);
  t.ok('and it is non-increasing in hardness top to bottom', power.monotonic, power);
  t.ok('TEST_DEFAULTS has an entry for the new test', power.defaultsHasPower, power);
  t.eq('and TEST_DEFAULTS covers exactly the same ids as TESTS, no more and no fewer', power.defaultsKeys, power.testIds);
  t.ok('an athlete whose baseline predates this change still gets a finite jump-squat target', power.oldBaselineFinite, power);
  t.ok('validateData() stays at zero problems with the new test and the re-anchored ladder', power.validateProblems.length === 0, power.validateProblems);

  /* "validateData() is clean" proves nothing about the TEST_DEFAULTS<->TESTS
     rule specifically — TEST_DEFAULTS and TESTS already agree in real data, so
     removing the check that compares them produces no NEW problems and the
     mutation escapes silently. Requires the SPECIFIC complaint, breaking the
     data live and restoring it, muting console.error the same way this file's
     other live validateData() breaks already do. */
  const lockstep = await page.evaluate(() => {
    const realErr = console.error; console.error = () => {};
    const o = {};
    const realDefaults = { ...TEST_DEFAULTS };
    delete TEST_DEFAULTS.power;
    o.missingCaught = validateData().some(e => /TEST_DEFAULTS is missing an entry for test "power"/.test(e));
    Object.assign(TEST_DEFAULTS, realDefaults);
    TEST_DEFAULTS.ghost = 99;
    o.staleCaught = validateData().some(e => /TEST_DEFAULTS has a stale entry "ghost"/.test(e));
    delete TEST_DEFAULTS.ghost;
    o.cleanAfterRestore = validateData().length === 0;
    console.error = realErr;
    return o;
  });
  t.ok('a TEST_DEFAULTS entry deleted at runtime is caught by name', lockstep.missingCaught, lockstep);
  t.ok('a stale TEST_DEFAULTS entry for a test that does not exist is caught by name', lockstep.staleCaught, lockstep);
  t.ok('and validateData() is clean again once both are restored', lockstep.cleanAfterRestore, lockstep);

  /* Same shape, for the cardio registry's row builder. Every mode has a
     `detail` today, so removing the rule that requires one produces no new
     problems and the mutation escapes in silence — that is what happened on
     the first run. Break it live and require the specific complaint.

     `detail` is what puts the FIGURES on a mode's row on Progress. Without it
     the row still renders with its label and its minutes, so a check asking
     only "does the row exist" cannot see the loss either. */
  const detailRule = await page.evaluate(() => {
    const realErr = console.error; console.error = () => {};
    const o = {};
    const k = CARDIO_MODES[CARDIO_MODES.length - 1];
    o.mode = k;
    const real = CARDIO_INFO[k].detail;
    o.guardReal = typeof real === 'function';
    delete CARDIO_INFO[k].detail;
    o.caught = validateData().some(e => new RegExp('CARDIO_INFO\\.' + k + ': no detail builder').test(e));
    CARDIO_INFO[k].detail = real;
    o.cleanAfterRestore = validateData().length === 0;
    console.error = realErr;
    return o;
  });
  t.ok('guard: the mode really had a detail builder to remove',
    detailRule.guardReal, detailRule);
  t.ok('a cardio mode with no row-detail builder is caught by name',
    detailRule.caught, detailRule);
  t.ok('and validateData() is clean again once it is restored',
    detailRule.cleanAfterRestore, detailRule);

  /* Same shape again, for the FORCE Combat circuit. COMBAT_ORDER is a
     PERMUTATION of the four evaluation events and combatOrder() ends in
     .filter(Boolean) — so an id that no longer exists is dropped in silence
     and the card renders three rows where the standard has four. The athlete
     would train the three and be tested on four.

     The three complaints are separate on purpose: a renamed id, a duplicate
     (which passes any length test and still loses an event), and a missing
     one. */
  const combatRule = await page.evaluate(() => {
    const realErr = console.error; console.error = () => {};
    const o = {};
    o.guardLen = COMBAT_ORDER.length === FORCE_IDS.length && FORCE_IDS.length === 4;
    o.guardClean = validateData().length === 0;
    const real = COMBAT_ORDER.slice();

    COMBAT_ORDER[0] = 'ghost';
    o.strayCaught = validateData().some(e => /COMBAT_ORDER names "ghost"/.test(e));
    o.missingCaught = validateData().some(e => new RegExp('COMBAT_ORDER is missing FORCE event "' + real[0] + '"').test(e));

    COMBAT_ORDER.length = 0; real.forEach(x => COMBAT_ORDER.push(x));
    COMBAT_ORDER[1] = COMBAT_ORDER[0];
    o.dupCaught = validateData().some(e => new RegExp('COMBAT_ORDER: duplicate id "' + real[0] + '"').test(e));
    o.dupAlsoMissing = validateData().some(e => new RegExp('COMBAT_ORDER is missing FORCE event "' + real[1] + '"').test(e));

    COMBAT_ORDER.length = 0; real.forEach(x => COMBAT_ORDER.push(x));
    o.cleanAfterRestore = validateData().length === 0;
    o.restored = COMBAT_ORDER.join(',') === real.join(',');
    console.error = realErr;
    return o;
  });
  t.ok('guard: the circuit order really is the four evaluation events',
    combatRule.guardLen && combatRule.guardClean, combatRule);
  t.ok('an id in the circuit order that is not a FORCE event is caught by name',
    combatRule.strayCaught, combatRule);
  t.ok('and the event it displaced is reported missing',
    combatRule.missingCaught, combatRule);
  t.ok('a duplicated id is caught rather than passing on the count',
    combatRule.dupCaught, combatRule);
  t.ok('and the event it overwrote is reported missing too',
    combatRule.dupAlsoMissing, combatRule);
  t.ok('and validateData() is clean again once the order is restored',
    combatRule.cleanAfterRestore && combatRule.restored, combatRule);

  /* ---- every registry member is reachable in its picker ------------------
     A registry and a hand-written consumer is this repo's most-repeated
     drift: the five diets as three literals, onboarding offering 13 gear
     items while Settings offered 12, and — one round ago — an activity card
     that listed four of five cardio modes by hand.

     Most pickers now render FROM the registry (`DIET_OPTS.map(...)`,
     `ACTIVITY_OPTS.map(...)`, `CARDIO_MODES.map(...)`), so they cannot drift
     at all. MOBILITY_LEVELS is the one left whose buttons are written out by
     hand, because each carries its own copy — and no test file mentioned it,
     so a level added to the list with no button, or a button whose value the
     repair refuses, would have been silent both ways.

     Checked in BOTH directions: no member without a button (unreachable), and
     no button that is not a member (a tap that normalizeState() would undo on
     the next boot). */
  const mobPicker = await page.evaluate(() => {
    const out = {};
    try { go('today'); openProfileEdit(); } catch (e) { return { threw: e.message }; }
    const btns = [...document.querySelectorAll('#ob-mob button')];
    out.found = btns.map(b => b.dataset.m).filter(Boolean);
    out.legal = MOBILITY_LEVELS.slice();
    out.noButton = out.legal.filter(k => out.found.indexOf(k) < 0);
    out.orphanButton = out.found.filter(k => out.legal.indexOf(k) < 0);
    try { closeSheet(); } catch (e) {}
    return out;
  });
  t.ok('guard: the mobility picker really rendered', !mobPicker.threw && mobPicker.found &&
    mobPicker.found.length >= 3, JSON.stringify(mobPicker));
  t.eq('every mobility level the app accepts has a button', (mobPicker.noButton || []).join(', '), '', mobPicker);
  t.eq('and no button offers a level the repair would undo', (mobPicker.orphanButton || []).join(', '), '', mobPicker);

  /* ---- and every cardio mode can come back from a watch screenshot -------
     activityKind() maps what a watch WROTE ("Jump Rope 34", "Carstairs
     Running") onto a mode, so its patterns cannot be derived from the
     registry — they are the words a device uses, not the keys this app uses.
     What can be asserted is COMPLETENESS: a sixth mode added to CARDIO_MODES
     with no matcher lands every one of its activities in the unplaceable
     bucket. That fails safe (v352 names an unplaceable activity rather than
     filing it under the nearest mode) and is still a mode the import can
     never recognise. */
  const kindCover = await page.evaluate(() => {
    const src = String(activityKind);
    return { modes: CARDIO_MODES.slice(),
             guardIsFn: typeof activityKind === 'function' && src.length > 100,
             missing: CARDIO_MODES.filter(k => src.indexOf("return '" + k + "'") < 0) };
  });
  t.ok('guard: activityKind was read as a real function body', kindCover.guardIsFn, kindCover);
  t.eq('every cardio mode a watch could report has a matcher',
    kindCover.missing.join(', '), '', kindCover);

  /* ---- a figure the app owns must not be written out beside it -----------
     This is the shape that made the FORCE card say "80 kg dragged" when the
     load is 100: a number stated by hand next to the constant that holds it.
     The re-test screen was the clearest case — it derived TESTS.length in one
     half of a sentence and hardcoded the block length in the other.

     Scoped to the block length, which four athlete-visible sentences carried
     as a literal 6, and to the last-week test that decides which of them the
     athlete reads. */
  const blockLen = await page.evaluate(() => {
    const src = [...document.querySelectorAll('script:not([src])')]
      .map(s => s.textContent).sort((a, b) => b.length - a.length)[0] || '';
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    /* A NUMBER SPELLED OUT IS THE SAME DEFECT AS A DIGIT, and v457 is what
       proved it: "your one-year build" survived a sweep aimed at digits because
       it is a WORD. So every arm takes both forms. The subject markers are what
       keep this honest — "six-week six-pack" states a rhetorical timeframe, not
       this program's block length, and must not be caught. */
    const W = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
    const BLOCKLEN = new RegExp([
      W + '[- ]week blocks?', W + ' weeks? done', 'after week ' + W,
      /* "After 6 weeks you re-test" — the OTHER word order, and it slipped past
         both scans: v467's looks for ${WEEKS_PER_CYCLE} interpolations and this
         was a hard-coded digit, while "after week N" is a different sentence.
         Found by reading the rendered Program tab, not by scanning. */
      'after ' + W + ' weeks',
      'next ' + W + ' weeks', 'moves in ' + W + ' weeks', 'means ' + W + ' weeks',
      'Weeks 1[\\u2013-]\\d+'
    ].join('|'), 'g');
    return {
      weeks: WEEKS_PER_CYCLE,
      isApp: /function normalizeState/.test(noComments),
      /* A literal block length left in code, outside comments. THREE phrasings
         now: the re-test screen states the same fact twice — a paragraph saying
         "N-week block" and a hero header saying "N weeks done" — and fixing only
         the first left the second hardcoded two lines above it. A third,
         "Re-test after week N" on the strength chart, slipped past both and was
         found by reading the RENDERED screens instead of scanning for a pattern
         already known. Each new phrasing goes in here, not into a second scan. */
      hardcoded: noComments.match(BLOCKLEN) || [],
      /* Both ways, on a SYNTHETIC source — an empty offender list is otherwise a
         statement about the regex. Every phrasing that has been found by hand is
         planted here, and a sentence that merely mentions weeks is not. */
      probeCatches: ('a 6-week block. eight-week blocks. 6 weeks done. after week 7. '
        + 'after 6 weeks you re-test. '
        + 'the next six weeks. moves in six weeks. means six weeks of work. Weeks 1-6 are core.')
        .match(BLOCKLEN) || [],
      probeQuiet: ('spot-reduction is not real and neither is a six-week six-pack. '
        + 'expect the tape to move in 3-4 weeks. once every three or four weeks is plenty.')
        .match(BLOCKLEN) || [],
      /* And the coach count, the same class one cast over: "pick one of the 16"
         was written when there were sixteen, and there are 38. */
      coachCount: COACHES.length,
      coachCopy: (noComments.match(/pick one of the \d+/g) || []),
      // the achievement and the re-test screen must both read the constant
      achDesc: (ACHIEVEMENTS.find(a => a.id === 'block') || {}).desc,
      achDesc3: (ACHIEVEMENTS.find(a => a.id === 'blocks3') || {}).desc,
      lastWeekNote: (typeof _overloadNoteInner === 'function')
        ? _overloadNoteInner({ week: WEEKS_PER_CYCLE, cycle: 1 }) : ''
    };
  });
  t.ok('guard: the scan read the app, not a stub', blockLen.isApp, blockLen);
  t.eq('guard: the scan catches every phrasing that has been found by hand',
    blockLen.probeCatches.length, 9, JSON.stringify(blockLen.probeCatches));
  t.eq('guard: and stays quiet on a week count that is not the block length',
    blockLen.probeQuiet.join(', '), '', JSON.stringify(blockLen.probeQuiet));
  t.ok('guard: and the block really is more than one week', blockLen.weeks > 1, blockLen);
  t.eq('no sentence writes the block length out by hand',
    blockLen.hardcoded.join(', '), '', blockLen);
  t.eq('the Block Complete badge names the real length',
    blockLen.achDesc, 'Finish a ' + blockLen.weeks + '-week block', blockLen);
  /* Its SIBLING two lines above still spelled the length out — "Finish 3
     six-week blocks" — so v397 fixed the badge it was looking at and left the
     one beside it. Fixing one instance is not fixing the class. */
  t.eq('and so does the badge two lines above it',
    blockLen.achDesc3, 'Finish 3 ' + blockLen.weeks + '-week blocks', blockLen);
  t.ok('and the final-week note does too',
    blockLen.lastWeekNote.indexOf(blockLen.weeks + '-week block') >= 0, blockLen);
  /* The coach roster is named in Settings copy. It said 16 when the cast was
     16 and the cast is now 38 — a number written by hand beside the list that
     holds it, which is the class v397 fixed for the block length. */
  t.ok('guard: the roster really has grown past the number that was written',
    blockLen.coachCount > 16, JSON.stringify({ coaches: blockLen.coachCount }));
  t.eq('and no copy writes the coach count out by hand',
    blockLen.coachCopy.join(', '), '', JSON.stringify(blockLen.coachCopy));

  /* ---- every format's PROSE against its own numbers -----------------------
     The v397 class: a figure written by hand beside the data that holds it. The
     FORCE card had three of them — a total that dropped the carried bag, a
     shuttle described as run when the standard walks it, and rushes whose steps
     covered half the distance the card claimed. A format's `desc` is the same
     shape: "5 hangs of 30 seconds, 60s rest" sits beside w:0.5, r:1, n:5, and
     nothing compared them. */
  const fmtProse = await page.evaluate(() => {
    const out = { checked: 0, bad: [] };
    const sec = m => Math.round(m * 60);
    const maps = { HIIT_FORMATS, ENDURANCE_FORMATS, SKIP_FORMATS, SPECIAL_FORMATS, GRINDER_FORMATS };
    Object.keys(maps).forEach(mn => {
      const M = maps[mn];
      Object.keys(M).forEach(key => {
        const f = M[key], d = String(f.desc || '');
        if (!d) return;
        out.checked++;
        const say = [];
        let m = d.match(/(\d+)\s*(?:hangs|rounds|sets|reps of|×|x)\b/i);
        if (m && f.n && +m[1] !== f.n) say.push('count ' + m[1] + ' vs n=' + f.n);
        m = d.match(/of (\d+)\s*(?:seconds|s)\b/i);
        if (m && f.w && +m[1] !== sec(f.w)) say.push('work ' + m[1] + 's vs w=' + sec(f.w) + 's');
        m = d.match(/(\d+)\s*s(?:ec(?:onds)?)? rest/i);
        if (m && f.r && +m[1] !== sec(f.r)) say.push('rest ' + m[1] + 's vs r=' + sec(f.r) + 's');
        m = d.match(/(\d+)\s*min(?:ute)?s? rest/i);
        if (m && f.r && +m[1] !== Math.round(f.r)) say.push('rest ' + m[1] + 'min vs r=' + f.r + 'min');
        m = d.match(/(\d+)[- ]minute rounds?/i);
        if (m && f.w && +m[1] !== Math.round(f.w)) say.push('work ' + m[1] + 'min vs w=' + f.w + 'min');
        if (say.length) out.bad.push(mn + '.' + key + ': "' + d + '" -> ' + say.join('; '));
      });
    });
    /* THE OPS BENCHMARKS ARE THE SAME SHAPE AND WERE NOT IN THE SWEEP — an
       array rather than a map, so a scan written over five maps could not see
       them. Each one states its round count in prose beside the `rounds` the
       player actually runs. */
    (typeof OPS !== 'undefined' ? OPS : []).forEach(o => {
      const d = String(o.desc || '');
      if (!d) return;
      out.checked++;
      const m = d.match(/(\d+)\s*rounds?\b/i);
      if (m && o.rounds && +m[1] !== o.rounds)
        out.bad.push('OPS.' + o.id + ': "' + d + '" -> count ' + m[1] + ' vs rounds=' + o.rounds);
    });
    out.opsSeen = (typeof OPS !== 'undefined' ? OPS : []).length;
    return out;
  });
  /* The guard is what makes an empty `bad` list mean anything: a sweep that
     matched no descriptions at all would report clean on nothing. */
  t.ok('guard: the ops benchmarks were in the sweep', fmtProse.opsSeen >= 4,
    JSON.stringify({ ops: fmtProse.opsSeen }));
  t.ok('guard: the sweep read real format descriptions', fmtProse.checked >= 15,
    JSON.stringify({ checked: fmtProse.checked }));
  t.eq('no format description contradicts its own work, rest or round count',
    fmtProse.bad.join('\n'), '', JSON.stringify(fmtProse.bad));

  /* ---- kit an exercise DESCRIBES but does not REQUIRE ---------------------
     `bench` is a real gear key — ruckstepup and dbbench are gated on it — so a
     movement that is NOT gated is available to every athlete by design. Five of
     them told that athlete to use "a bench" and named no alternative, while
     three ungated siblings already said "a bench, chair or step". The app had
     made the decision and the words did not carry it: same class as a promise
     in UI text, one register down. The two that genuinely REQUIRE a bench stay
     bench-only, which is what the second half of this check pins. */
  const benchProse = await page.evaluate(() => {
    const out = { ungated: [], gated: [], silentUngated: [] };
    Object.keys(EX).forEach(k => {
      const e = EX[k]; if (!e) return;
      const steps = (e.steps || []).join(' ');
      if (!/\bbench\b/i.test(steps)) return;
      const needsBench = (e.equip || []).indexOf('bench') >= 0;
      const namesAlt = /bench[^.]{0,40}\b(or|chair|step|sofa|stair|box|couch)\b/i.test(steps)
        || /\b(chair|step|sofa|stair|box|couch)\b[^.]{0,40}bench/i.test(steps);
      (needsBench ? out.gated : out.ungated).push(k);
      if (!needsBench && !namesAlt) out.silentUngated.push(k);
      /* EX is a page constant and is NOT visible in Node, so the floor is
         computed HERE and carried out — reading it from the assertion threw
         "EX is not defined" and reported the file itself as broken. */
      if (needsBench) out.gatedOk = (out.gatedOk !== false)
        && (e.equip || []).indexOf('bench') >= 0;
    });
    return out;
  });
  t.ok('guard: the sweep found bench movements on both sides of the gate',
    benchProse.ungated.length >= 5 && benchProse.gated.length >= 2, JSON.stringify(benchProse));
  t.eq('a movement that does NOT require a bench names what else will do',
    benchProse.silentUngated.join(', '), '', JSON.stringify(benchProse.silentUngated));
  /* FLOOR: the ones that really do need a bench are gated on it, so the athlete
     is never offered them without one — and their steps may say bench alone. */
  t.ok('and the ones that really need one are gated on the gear key',
    benchProse.gatedOk === true, JSON.stringify(benchProse.gated));

  /* ---- and the program's own length, which is not a year for most people --
     v348 measured it: 378 sessions is 54 weeks at SEVEN a week, and the
     wizard's own floor is five — 75.6 weeks, 17.4 months. It fixed the
     Program tab's "54-week journey" and built programWeeks() for exactly
     this. The header chip was missed: it said "Complete · 1 year" to an
     athlete who had just taken seventeen months over it.

     The total is derived too, in the Full Tour badge AND in its condition. */
  const progLen = await page.evaluate(() => {
    const src = [...document.querySelectorAll('script:not([src])')]
      .map(s => s.textContent).sort((a, b) => b.length - a.length)[0] || '';
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const total = SESSIONS_PER_CYCLE * TOTAL_CYCLES;
    const out = { total, isApp: /function normalizeState/.test(noComments),
      literal: (noComments.match(/\b378\b/g) || []).length,
      badge: (ACHIEVEMENTS.find(a => a.id === 's378') || {}).desc };
    /* Drive the real chip at the end of the program, on a five-day athlete —
       the pace the wizard floors at and the one v348 measured. */
    const keepPtr = STATE.progressPtr, keepDays = STATE.profile.days;
    const keepOn = STATE.onboarded, keepBase = STATE.baseline;
    /* updatePill() returns early for an athlete who has not onboarded or has
       no baseline, so the chip has to be driven past both to reach the
       completion branch at all. */
    STATE.onboarded = true; STATE.baseline = STATE.baseline || { results: {} };
    STATE.profile.days = [1, 2, 3, 4, 5];
    STATE.progressPtr = total;
    try { updatePill(); } catch (e) {}
    out.pill = (document.querySelector('#pillSub') || {}).textContent || '';
    out.weeks = programWeeks();
    STATE.progressPtr = keepPtr; STATE.profile.days = keepDays;
    STATE.onboarded = keepOn; STATE.baseline = keepBase;
    try { updatePill(); } catch (e) {}
    return out;
  });
  t.ok('guard: the scan read the app', progLen.isApp, progLen);
  t.ok('guard: a five-day athlete really takes longer than a year',
    progLen.weeks > 52, progLen);
  t.eq('the program length is never written out by hand', progLen.literal, 0, progLen);
  t.eq('the Full Tour badge names the derived total',
    progLen.badge, progLen.total + ' sessions — the complete program', progLen);
  t.ok('and finishing does not claim a year it did not take',
    progLen.pill.indexOf('year') < 0 && progLen.pill.indexOf(String(progLen.weeks)) >= 0,
    progLen);



  /* ---- Burpees: a tenth baseline test, for cardiovascular stamina (v252) --
     Requested after an audit found the battery measured strength and local
     muscular endurance nine ways over but never touched cardiovascular
     stamina at all — "conditioning" was self-reported only, never checked
     against a real number the way every other capacity in the battery is.
     Placed LAST (opposite of Jump Squats, placed 2nd): this is the fatiguer,
     not the fatigue-sensitive one, so it has to run after everything it
     could otherwise compromise. Reuses the existing burpee exercise purely
     for display (photo/instructions/info) — EX.burpee itself is left
     completely untouched (still unanchored, still unit:'time', still used
     as-is by every HIIT circuit and cardio finisher that already prescribes
     it) precisely to avoid the blast radius of changing a widely-shared
     exercise's own unit just to satisfy one new test's anchor. */
  const stamina = await page.evaluate(() => {
    const o = {};
    o.testEntry = TESTS.find(x => x.id === 'stamina');
    o.testIdx = TESTS.findIndex(x => x.id === 'stamina');
    o.count = TESTS.length;
    o.defaultsHasStamina = 'stamina' in TEST_DEFAULTS;
    o.defaultsKeys = Object.keys(TEST_DEFAULTS).sort();
    o.testIds = TESTS.map(x => x.id).sort();
    // burpee itself must be untouched — anchoring it would ripple into every
    // HIIT circuit and cardio finisher that already prescribes it by time
    o.burpeeUnchanged = { anchor: EX.burpee.anchor, unit: EX.burpee.unit, hardness: EX.burpee.hardness, base: EX.burpee.base };
    o.estimateMaxesStamina = estimateMaxes({}).stamina;
    o.estimateMaxesKeepsReal = estimateMaxes({ stamina: 19 }).stamina === 19;
    const realBaseline = STATE.baseline;
    STATE.baseline = null;
    skipBaseline();
    o.skippedStamina = STATE.baseline && STATE.baseline.maxes && STATE.baseline.maxes.stamina;
    STATE.baseline = realBaseline;
    o.metricEntry = STRENGTH_METRICS.find(x => x.k === 'stamina');
    // a flagged joint reroutes the stamina test too, generalising the v251
    // baseline-safety fix without a single line changed for this new test —
    // burpee is flagged BOTH shoulder and wrist in JOINT_RISK
    const real = STATE.profile.limitations;
    STATE.profile.limitations = ['shoulder'];
    o.swappedShoulder = safeSwap('burpee');
    STATE.profile.limitations = ['wrist'];
    o.swappedWrist = safeSwap('burpee');
    STATE.profile.limitations = real;
    o.validateProblems = validateData();
    return o;
  });
  t.eq('the stamina test is the LAST test in the battery', stamina.testIdx, stamina.count - 1, stamina);
  t.eq('a 60-second countdown scored in reps, displayed with the real burpee exercise', { unit: stamina.testEntry.unit, dur: stamina.testEntry.dur, ex: stamina.testEntry.ex }, { unit: 'reps', dur: 60, ex: 'burpee' });
  t.eq('EX.burpee itself is untouched — no new anchor, same unit, same hardness, same base', stamina.burpeeUnchanged, { anchor: null, unit: 'time', hardness: 0.7, base: 25 });
  t.ok('TEST_DEFAULTS has an entry for the new test', stamina.defaultsHasStamina, stamina);
  t.eq('and TEST_DEFAULTS covers exactly the same ids as TESTS, no more and no fewer', stamina.defaultsKeys, stamina.testIds);
  t.ok('estimateMaxes({}) has a real default for stamina now, not missing', stamina.estimateMaxesStamina > 0, stamina);
  t.eq('and a real measured value still wins over the default', stamina.estimateMaxesKeepsReal, true);
  t.ok('skipping the baseline entirely still estimates stamina too', stamina.skippedStamina > 0, stamina);
  t.eq('Strength Trends gets a short "Burpees" label, not the full test name', (stamina.metricEntry || {}).label, 'Burpees');
  t.ok('a flagged shoulder routes the stamina test away from burpee', stamina.swappedShoulder !== 'burpee', stamina);
  t.ok('a flagged wrist routes the stamina test away from burpee too', stamina.swappedWrist !== 'burpee', stamina);
  t.ok('validateData() stays at zero problems with the tenth test', stamina.validateProblems.length === 0, stamina.validateProblems);

  /* Same live-break-and-restore shape as the power test's own lockstep check
     above — "validateData() is clean" proves nothing about THIS test id
     specifically until something is actually broken and restored under it. */
  const staminaLockstep = await page.evaluate(() => {
    const realErr = console.error; console.error = () => {};
    const o = {};
    const realDefaults = { ...TEST_DEFAULTS };
    delete TEST_DEFAULTS.stamina;
    o.missingCaught = validateData().some(e => /TEST_DEFAULTS is missing an entry for test "stamina"/.test(e));
    Object.assign(TEST_DEFAULTS, realDefaults);
    const real = estimateMaxes;
    window.estimateMaxes = m => { const r = real(m); delete r.stamina; return r; };
    o.emCaught = validateData().some(e => /estimateMaxes\(\{\}\) has no usable default for test "stamina"/.test(e));
    window.estimateMaxes = real;
    o.cleanAfterRestore = validateData().length === 0;
    console.error = realErr;
    return o;
  });
  t.ok('a TEST_DEFAULTS entry deleted for stamina is caught by name', staminaLockstep.missingCaught, staminaLockstep);
  t.ok('a missing estimateMaxes() default for stamina is caught by name', staminaLockstep.emCaught, staminaLockstep);
  t.ok('and validateData() is clean again once both are restored', staminaLockstep.cleanAfterRestore, staminaLockstep);

  /* ---- an audit of the whole test->week chain, prompted directly (v249) ----
     Asked to add all nine tests to the Strength Trends chart, and separately to
     audit that the baseline test is properly interlinked to every week of the
     program. STRENGTH_METRICS was a hand-kept five-test literal (the audit's
     actual request); estimateMaxes() and skipBaseline() were found broken by
     reading every consumer of TESTS/maxes, not reported by the athlete. Both
     had shipped the exact "a hand-kept list drifts behind TESTS" defect
     TEST_DEFAULTS was hoisted to prevent in v247 — just in two places that
     hoist did not reach, because they are not simple flat literals. */
  const audit = await page.evaluate(() => {
    const o = {};
    // 1. the chart now covers every test, membership read from TESTS itself
    o.metricIds = STRENGTH_METRICS.map(x => x.k).sort();
    o.testIds = TESTS.map(t => t.id).sort();
    o.hasLabels = STRENGTH_METRICS.every(x => typeof x.label === 'string' && x.label.length > 0);
    o.powerLabel = (STRENGTH_METRICS.find(x => x.k === 'power') || {}).label;

    // 2. estimateMaxes({}) — the actual gate every stored maxes object passes
    // through before prescribe() ever sees it — has a real, positive default
    // for every test, not just the original eight.
    const em = estimateMaxes({});
    o.estimateMaxesIds = TESTS.map(t => t.id);
    o.estimateMaxesFinite = o.estimateMaxesIds.every(id => typeof em[id] === 'number' && isFinite(em[id]) && em[id] > 0);
    o.estimateMaxesPower = em.power;
    // a real, present power value must still win over the default — the bug
    // was an ABSENT default, not the merge order, so this must keep working
    o.estimateMaxesKeepsReal = estimateMaxes({ power: 17 }).power === 17;

    // 3. skipBaseline() — an athlete who never takes the battery at all must
    // still get an estimate for every test, including the new one, or the
    // Strength Trends chart shows "no data" for Jump Squats specifically while
    // every other lift the same athlete has an estimate for.
    const keep = STATE.baseline;
    STATE.baseline = null;
    skipBaseline();
    o.skippedMaxes = STATE.baseline && STATE.baseline.maxes;
    o.skippedHasAllIds = o.skippedMaxes ? TESTS.every(t => o.skippedMaxes[t.id] > 0) : false;
    STATE.baseline = keep;

    // 4. the caption no longer claims something the content contradicts —
    // this file's own "a promise in the UI is a specification" rule, pointed
    // at itself: Push-Ups/Squats/Jump Squats are not core-specific, so a chart
    // that now includes them cannot still call itself core-only.
    // This file never calls seedAthlete() — it drives the raw page — so
    // STATE.baseline starts null. A real baseline is set here explicitly
    // rather than assumed, or strengthTrendHTML() renders nothing at all and
    // the chip-rendering assertion below would pass on an empty tab.
    STATE.baseline = { date: todayISO(), score: 60, level: 'Intermediate', testCount: TESTS.length,
      maxes: { plank: 60, side: 40, hollow: 35, lower: 15, dyn: 30, push: 20, pull: 12, squat: 25, power: 12, stamina: 15 } };
    /* Progress gained sub-tabs in v312 — this content lives on one pane,
       so select it rather than relying on which pane happens to open. */
    go('progress'); setProgressTab('strength'); renderProgress();
    const capt = (document.querySelector('#v-progress') || {}).innerText || '';
    o.oldClaimGone = !/truest measure of core strength/i.test(capt);

    // and the chips actually render, in TESTS' own order, on the real tab
    const chipEls = [...document.querySelectorAll('#v-progress .chip')].map(b => b.textContent.trim());
    o.chipLabels = STRENGTH_METRICS.map(x => x.label).filter(l => chipEls.includes(l));
    return o;
  });
  t.eq('the Strength Trends chart covers exactly the real tests, no more and no fewer', audit.metricIds, audit.testIds);
  t.ok('every metric has a real display label', audit.hasLabels, audit);
  t.eq('Jump Squats gets its own short label rather than the full test name', audit.powerLabel, 'Jump Squats');
  t.ok('estimateMaxes({}) returns a finite positive default for every test, including the new one', audit.estimateMaxesFinite, audit);
  t.ok('specifically, the power default is a real number now, not missing', audit.estimateMaxesPower > 0, audit);
  t.eq('and a real measured value still wins over the default', audit.estimateMaxesKeepsReal, true);
  t.ok('skipping the baseline entirely still estimates every test, including power', audit.skippedHasAllIds, audit);
  t.ok('the caption no longer claims to be core-only now that it is not', audit.oldClaimGone, audit.capt);
  t.eq('all 10 chips actually render on the real Progress tab', audit.chipLabels.length, 10, audit);

  /* "validateData() is clean" proves nothing about the estimateMaxes() check
     specifically, same shape as the TEST_DEFAULTS lockstep check above:
     estimateMaxes({}) already returns a real default for every test, so
     deleting the two lines that verify it produces no NEW problems and the
     mutation escapes silently. Requires the SPECIFIC complaint, forcing the
     real function to actually go missing a default rather than editing the
     validator's own source (which page.evaluate cannot do to a running page
     anyway) — monkey-patching estimateMaxes() itself for the duration of one
     validateData() call, muting console.error the same way this file's other
     live breaks already do. */
  const emGate = await page.evaluate(() => {
    const realErr = console.error; console.error = () => {};
    const real = estimateMaxes;
    window.estimateMaxes = m => { const r = real(m); delete r.power; return r; };
    const caught = validateData().some(e => /estimateMaxes\(\{\}\) has no usable default for test "power"/.test(e));
    window.estimateMaxes = real;
    const cleanAfter = validateData().length === 0;
    console.error = realErr;
    return { caught, cleanAfter };
  });
  t.ok('a power default that goes missing from estimateMaxes() is caught by name', emGate.caught, emGate);
  t.ok('and validateData() is clean again once the real function is restored', emGate.cleanAfter, emGate);

  /* ---- three stability-ball exercises — a genuinely new gear category, not
     hiding under an existing checkbox. The rollout inherits abroll's exact
     risk profile (same anti-extension mechanism, just wobblier). The
     hamstring curl is a loaded hip bridge — flagged lowback only, matching
     hipthrust/dbrdl, not the abroll-family shoulder/wrist flags. Stir-the-Pot
     is a forearm-plank hold — flagged wrist only, matching bearhold/
     isoclimber/ropeplank, not shoulder or lowback. */
  const ball = await page.evaluate(() => {
    const o = {};
    const ids = ['sbrollout', 'sbhamcurl', 'sbstir'];
    o.equip = {}; ids.forEach(id => { o.equip[id] = EX[id].equip; });
    STATE.profile.gear = [];
    o.noneOwned = {}; ids.forEach(id => { o.noneOwned[id] = hasGearFor(id); });
    STATE.profile.gear = ['stabilityball'];
    o.allOwned = {}; ids.forEach(id => { o.allOwned[id] = hasGearFor(id); });
    o.rolloutFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('sbrollout')).sort();
    o.hamcurlFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('sbhamcurl')).sort();
    o.stirFlags = Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes('sbstir')).sort();
    const landsSafe = (exId, joint) => {
      const real = STATE.profile.limitations; STATE.profile.limitations = [joint];
      const out = safeSwap(exId); STATE.profile.limitations = real;
      return !!EX[out] && !(JOINT_RISK[joint] || []).includes(out);
    };
    o.rolloutLandsSafeShoulder = landsSafe('sbrollout', 'shoulder');
    o.rolloutLandsSafeWrist = landsSafe('sbrollout', 'wrist');
    o.rolloutLandsSafeLowback = landsSafe('sbrollout', 'lowback');
    o.hamcurlLandsSafeLowback = landsSafe('sbhamcurl', 'lowback');
    o.stirLandsSafeWrist = landsSafe('sbstir', 'wrist');
    o.inFocusPool = {
      sbrollout: FOCUS_POOL.abs.includes('sbrollout'),
      sbstir: FOCUS_POOL.abs.includes('sbstir'),
      sbhamcurl: FOCUS_POOL.glutes.includes('sbhamcurl'),
    };
    // real behavioural sweep, matching the dbbench/kettlebell precedent: with
    // no stability ball owned, none of the three are ever offered by the
    // focus bonus, while an unrelated bodyweight sibling in the same pool
    // genuinely is — proving the pool was actually reached, not skipped
    // entirely for an unrelated reason.
    //
    // sbstir's hardness (0.55) only clears focusBonus()'s difficulty gate at
    // the Advanced tier (threshold 0.4) — an earlier block in this same file
    // has already mutated STATE.baseline by this point, degrading the level
    // to Beginner (threshold 1.0), which silently excludes all three of
    // these below-1.0 items. Every block builds the state it asserts on, not
    // what an earlier block left behind — set the level explicitly rather
    // than trusting whatever the file's execution order happens to leave.
    // levelOf() also lets profile.experience nudge the measured level DOWN
    // by one tier — an earlier block leaving experience at something below
    // Advanced silently dragged an explicit Advanced baseline back down to
    // Intermediate, which was the second half of the same trap.
    const real = { gear: STATE.profile.gear, focusPrimary: STATE.profile.focusPrimary, targets: STATE.profile.targets, baseline: STATE.baseline, reassess: STATE.reassess, experience: STATE.profile.experience };
    STATE.baseline = { level: 'Advanced' };
    STATE.reassess = {};
    STATE.profile.experience = 'Advanced';
    STATE.profile.gear = [];
    STATE.profile.focusPrimary = 'abs';
    STATE.profile.targets = [];
    let sawBallNoGear = false, sawHollowNoGear = false;
    for (let c = 0; c < 54; c++) {
      const bonus = focusBonus({ cycle: c, dayInWeek: c % 7 }, new Set());
      if (bonus && (bonus.exId === 'sbrollout' || bonus.exId === 'sbstir')) sawBallNoGear = true;
      if (bonus && bonus.exId === 'hollow') sawHollowNoGear = true;
    }
    o.noGearSweep = { sawBallNoGear, sawHollowNoGear };
    STATE.profile.gear = ['stabilityball'];
    let sawRolloutWithGear = false, sawStirWithGear = false;
    for (let c = 0; c < 54; c++) {
      const bonus = focusBonus({ cycle: c, dayInWeek: c % 7 }, new Set());
      if (bonus && bonus.exId === 'sbrollout') sawRolloutWithGear = true;
      if (bonus && bonus.exId === 'sbstir') sawStirWithGear = true;
    }
    o.withGearSweep = { sawRolloutWithGear, sawStirWithGear };
    STATE.profile.focusPrimary = 'glutes';
    let sawHamcurlWithGear = false;
    for (let c = 0; c < 54; c++) {
      const bonus = focusBonus({ cycle: c, dayInWeek: c % 7 }, new Set());
      if (bonus && bonus.exId === 'sbhamcurl') sawHamcurlWithGear = true;
    }
    o.sawHamcurlWithGear = sawHamcurlWithGear;

    STATE.profile.gear = real.gear; STATE.profile.focusPrimary = real.focusPrimary; STATE.profile.targets = real.targets;
    STATE.baseline = real.baseline; STATE.reassess = real.reassess; STATE.profile.experience = real.experience;
    return o;
  });
  t.eq('Stability Ball Rollout requires a stability ball', ball.equip.sbrollout, ['stabilityball']);
  t.eq('Stability Ball Hamstring Curl requires a stability ball', ball.equip.sbhamcurl, ['stabilityball']);
  t.eq('Stir-the-Pot requires a stability ball', ball.equip.sbstir, ['stabilityball']);
  t.ok('none of the three are offered without a stability ball', Object.values(ball.noneOwned).every(v => !v), ball.noneOwned);
  t.ok('all three are offered once a stability ball is owned', Object.values(ball.allOwned).every(v => v), ball.allOwned);
  t.eq('the rollout inherits abroll\'s full risk profile: shoulder, wrist and lowback', ball.rolloutFlags, ['lowback', 'shoulder', 'wrist']);
  t.eq('the hamstring curl is a loaded bridge — lowback only, matching hipthrust/dbrdl', ball.hamcurlFlags, ['lowback']);
  t.eq('stir-the-pot is a forearm-plank hold — wrist only, matching bearhold/isoclimber/ropeplank', ball.stirFlags, ['wrist']);
  t.ok('a flagged shoulder routes the rollout somewhere safe', ball.rolloutLandsSafeShoulder, ball);
  t.ok('a flagged wrist routes the rollout somewhere safe', ball.rolloutLandsSafeWrist, ball);
  t.ok('a flagged low back routes the rollout somewhere safe', ball.rolloutLandsSafeLowback, ball);
  t.ok('a flagged low back routes the hamstring curl somewhere safe', ball.hamcurlLandsSafeLowback, ball);
  t.ok('a flagged wrist routes stir-the-pot somewhere safe', ball.stirLandsSafeWrist, ball);
  t.ok('all three are reachable through the focus bonus', Object.values(ball.inFocusPool).every(v => v), ball.inFocusPool);
  t.ok('a real sweep of the focus bonus never offers the rollout or stir-the-pot without a ball', !ball.noGearSweep.sawBallNoGear, ball.noGearSweep);
  t.ok('while an unrelated bodyweight sibling genuinely is offered — proving the abs pool was actually reached', ball.noGearSweep.sawHollowNoGear, ball.noGearSweep);
  t.ok('the rollout is genuinely offered once the ball is owned', ball.withGearSweep.sawRolloutWithGear, ball.withGearSweep);
  t.ok('stir-the-pot is genuinely offered once the ball is owned', ball.withGearSweep.sawStirWithGear, ball.withGearSweep);
  t.ok('the hamstring curl is genuinely offered through the glutes pool once the ball is owned', ball.sawHamcurlWithGear, ball);

  /* ---- the balance trainer: a DIFFERENT implement from the stability ball --
     Both are "a ball" in conversation and neither is the other: the stability
     ball is a large sphere you lie on or roll, the balance trainer is a rigid-
     based half-dome you stand ON. Owning one must never imply the other, which
     is the same "confirm what the kit physically IS" rule the 9.6-inch push-up
     bars taught. Flags are reasoned from mechanics rather than copied: the
     floor versions of the squat and the side plank are both UNFLAGGED, and the
     dome versions are a deliberate escalation because the base moves. */
  const bt = await page.evaluate(() => {
    const o = {};
    const ids = ['btsquat', 'btbalance', 'btsideplank', 'btpushup'];
    o.equip = {}; ids.forEach(id => { o.equip[id] = EX[id].equip; });

    // owning the OTHER ball must not unlock these, and vice versa
    STATE.profile.gear = ['stabilityball'];
    o.ballDoesNotUnlockDome = ids.every(id => !hasGearFor(id));
    o.ballStillUnlocksItsOwn = ['sbrollout', 'sbhamcurl', 'sbstir'].every(id => hasGearFor(id));
    STATE.profile.gear = ['balancetrainer'];
    o.domeUnlocksDome = ids.every(id => hasGearFor(id));
    o.domeDoesNotUnlockBall = ['sbrollout', 'sbhamcurl', 'sbstir'].every(id => !hasGearFor(id));

    const flags = id => Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes(id)).sort();
    o.squatFlags = flags('btsquat');
    o.balanceFlags = flags('btbalance');
    o.sidePlankFlags = flags('btsideplank');
    o.pushupFlags = flags('btpushup');
    // the floor versions these escalate FROM, to prove the escalation is real
    o.floorSquatFlags = flags('squat');
    o.floorSidePlankFlags = flags('sideplank');
    o.floorPushupFlags = flags('pushup');

    const landsSafe = (exId, joint) => {
      const real = STATE.profile.limitations; STATE.profile.limitations = [joint];
      const out = safeSwap(exId); STATE.profile.limitations = real;
      return { to: out, safe: !!EX[out] && !(JOINT_RISK[joint] || []).includes(out) };
    };
    o.squatKnee = landsSafe('btsquat', 'knee');
    o.balanceKnee = landsSafe('btbalance', 'knee');
    o.sidePlankShoulder = landsSafe('btsideplank', 'shoulder');
    o.sidePlankWrist = landsSafe('btsideplank', 'wrist');
    o.pushupWrist = landsSafe('btpushup', 'wrist');

    o.inFocusPool = {
      btsquat: FOCUS_POOL.legs.includes('btsquat'),
      btbalance: FOCUS_POOL.legs.includes('btbalance'),
      btsideplank: FOCUS_POOL.obliques.includes('btsideplank'),
      btpushup: FOCUS_POOL.chest.includes('btpushup'),
    };

    // the picker must name both by shape, or they get mis-ticked
    go('guide'); render();
    const html = document.querySelector('#v-guide').innerHTML;
    o.picker = { dome: html.includes('Balance trainer (half-dome)'),
                 ball: html.includes('Stability ball (large)') };
    STATE.profile.gear = [];
    return o;
  });
  ['btsquat','btbalance','btsideplank','btpushup'].forEach(id =>
    t.eq(id + ' requires the balance trainer', bt.equip[id], ['balancetrainer']));
  t.ok('owning the stability ball does NOT unlock the dome work', bt.ballDoesNotUnlockDome, bt);
  t.ok('owning the dome does NOT unlock the stability-ball work', bt.domeDoesNotUnlockBall, bt);
  t.ok('each ball still unlocks its own exercises', bt.ballStillUnlocksItsOwn && bt.domeUnlocksDome, bt);
  t.eq('the dome squat is knee-flagged', bt.squatFlags, ['knee']);
  t.eq('and the single-leg stand too', bt.balanceFlags, ['knee']);
  t.eq('while the FLOOR squat stays unflagged — proving this is a real escalation, not a copy',
    bt.floorSquatFlags, []);
  t.eq('the dome side plank is shoulder and wrist flagged — a straight arm on a moving base',
    bt.sidePlankFlags, ['shoulder', 'wrist']);
  t.eq('while the FLOOR side plank, a forearm hold, stays unflagged', bt.floorSidePlankFlags, []);
  t.eq('the dome push-up carries the wrist flag its floor version has, plus a shoulder one',
    bt.pushupFlags, ['shoulder', 'wrist']);
  t.eq('confirming the floor push-up is wrist-only', bt.floorPushupFlags, ['wrist']);
  t.ok('a flagged knee routes the dome squat somewhere safe', bt.squatKnee.safe, bt.squatKnee);
  t.ok('a flagged knee routes the single-leg stand somewhere safe', bt.balanceKnee.safe, bt.balanceKnee);
  t.ok('a flagged shoulder routes the dome side plank somewhere safe', bt.sidePlankShoulder.safe, bt.sidePlankShoulder);
  t.ok('a flagged wrist routes it somewhere safe too', bt.sidePlankWrist.safe, bt.sidePlankWrist);
  t.ok('a flagged wrist routes the dome push-up somewhere safe', bt.pushupWrist.safe, bt.pushupWrist);
  t.ok('all four are reachable through the focus bonus', Object.values(bt.inFocusPool).every(v => v), bt.inFocusPool);
  t.ok('the gear picker names the dome by its shape', bt.picker.dome, bt.picker);
  t.ok('and renames the sphere so the two cannot be mis-ticked', bt.picker.ball, bt.picker);

  /* ---- loaded ruck work ------------------------------------------------
     Four movements chosen by searching the roster by MOVEMENT, not by name:
     there was no step-up anywhere in the library, and no back-loaded hinge —
     every existing hinge is front-loaded or single-leg. */
  {
    const r = await page.evaluate(() => {
      const IDS = ['ruckstepup', 'rucksquat', 'ruckgm', 'ruckcarry'];
      const risk = j => (JOINT_RISK[j] || []);
      const flags = k => ['knee', 'lowback', 'shoulder', 'wrist', 'elbow']
        .filter(j => risk(j).includes(k));
      return {
        exist: IDS.filter(k => !EX[k]),
        imgs: IDS.map(k => EX[k] && EX[k].img),
        patterns: IDS.map(k => EX[k].pattern),
        /* JOINT_RISK membership asserted DIRECTLY, per exercise. A generic
           "flagged joints do not leak" sweep cannot prove a new entry was ever
           flagged — it never enters the risky bucket if nothing asked. */
        stepup: flags('ruckstepup'),
        squat: flags('rucksquat'),
        gm: flags('ruckgm'),
        carry: flags('ruckcarry'),
        /* The FLOOR versions, which prove the escalation is reasoned rather
           than a blanket flag on anything with a load. */
        floorSquat: flags('squat'),
        floorGoblet: flags('kbgoblet'),
        floorCarry: flags('kbcarry'),
        swaps: IDS.map(k => SAFE_SWAP[k] || null),
        fallbacks: IDS.map(k => GEAR_FALLBACK[k] || null),
        swapsReal: IDS.every(k => !SAFE_SWAP[k] || !!EX[SAFE_SWAP[k]]),
        fallbacksReal: IDS.every(k => !GEAR_FALLBACK[k] || !!EX[GEAR_FALLBACK[k]]),
      };
    });
    t.eq('all four ruck movements exist', r.exist.length, 0);
    t.ok('each ships a real photo', r.imgs.every(i => /^ex-ruck\w+\.jpg$/.test(i)), r.imgs);
    t.eq('the step-up fills the missing unilateral-leg slot', r.patterns[0], 'lunge');
    t.eq('the squat is a squat', r.patterns[1], 'squat');
    t.eq('and the good morning is the back-loaded HINGE the library lacked', r.patterns[2], 'hinge');
    /* Each flag reasoned from mechanics. */
    t.eq('a loaded single-leg step-up flags the knee', JSON.stringify(r.stepup), JSON.stringify(['knee']));
    t.eq('an axially-loaded squat flags the low back', JSON.stringify(r.squat), JSON.stringify(['lowback']));
    t.eq('and so does a back-loaded hinge', JSON.stringify(r.gm), JSON.stringify(['lowback']));
    /* The discriminator. Blanket-flagging everything with "ruck" in the name
       would satisfy every check above and this is the one it fails. */
    t.eq('a symmetrical bear-hug carry is deliberately NOT flagged', r.carry.length, 0);
    /* And the floors, which prove the escalation rather than a family flag. */
    t.eq('plain squat stays unflagged', r.floorSquat.length, 0);
    t.eq('the goblet squat stays unflagged — the ruck is on the SPINE', r.floorGoblet.length, 0);
    t.eq('the farmer\'s carry stays unflagged too', r.floorCarry.length, 0);
    t.ok('every swap target is a real exercise', r.swapsReal, r.swaps);
    t.ok('and so is every gear fallback', r.fallbacksReal, r.fallbacks);
    t.eq('a flagged hinge lands where every other flagged hinge lands', r.swaps[2], 'glutebridge');
  }
  {
    /* Gear gating, both directions. A single `equip` typo would hand an
       athlete four movements they have no kit for, and the generic sweeps
       cannot see that at all. */
    const r = await page.evaluate(() => {
      const IDS = ['ruckstepup', 'rucksquat', 'ruckgm', 'ruckcarry'];
      const real = STATE.profile.gear;
      const withGear = g => { STATE.profile.gear = g; return IDS.filter(hasGearFor); };
      const o = {
        none: withGear([]),
        ruckOnly: withGear(['ruck']),
        ruckAndBench: withGear(['ruck', 'bench']),
        benchOnly: withGear(['bench']),
        /* Owning a different implement must NOT unlock ruck work. */
        ballOnly: withGear(['stabilityball', 'balancetrainer', 'kettlebell', 'dumbbell']),
      };
      /* ...and owning the ruck must not unlock somebody else's work. */
      STATE.profile.gear = ['ruck'];
      o.ruckUnlocksBall = ['sbrollout', 'btsquat', 'kbgoblet'].filter(hasGearFor);
      /* Ruck March stays open to everyone: any bag with books is fine for
         WALKING, which is what its own steps say. */
      STATE.profile.gear = [];
      o.marchStillOpen = hasGearFor('ruck');
      STATE.profile.gear = real;
      return o;
    });
    t.eq('with no kit, none of the four are offered', r.none.length, 0);
    t.eq('the pack alone unlocks three', r.ruckOnly.length, 3);
    t.ok('but not the step-up, which also needs a box', !r.ruckOnly.includes('ruckstepup'), r);
    t.eq('pack plus a box unlocks all four', r.ruckAndBench.length, 4);
    t.eq('a box on its own unlocks none of them', r.benchOnly.length, 0);
    t.eq('and neither does owning every other implement', r.ballOnly.length, 0);
    t.eq('owning the pack does not unlock anyone else\'s work', r.ruckUnlocksBall.length, 0);
    /* The deliberate exception, and the reason it is one. */
    t.ok('Ruck March itself stays open to everyone', r.marchStillOpen, r);
  }

  /* ---- the Inchworm Walkout's words must match its video -----------------
     The written steps said "walk the hands back to the feet". Both the
     athlete's own reference clip and the generated video walk the FEET in
     instead — which is the travelling inchworm, the form that gives the
     exercise its name. A video sitting beside a contradicting instruction is
     the same defect as a promise in UI text with no code behind it, so the
     words moved to match the picture rather than the other way round. */
  {
    const r = await page.evaluate(() => {
      const ex = EX.inchworm, steps = (ex.steps || []).join(' | ');
      return {
        vid: ex.vid,
        emitsVideo: /ex-inchworm\.mp4/.test(plRingMediaHTML(ex)),
        saysFeetIn: /walk the FEET in/i.test(steps),
        saysHandsBack: /walk the hands back/i.test(steps),
        walksHandsOut: /walk the hands out/i.test(steps),
        neverJump: (ex.cues || []).some(c => /never jump/i.test(c)),
        /* The floor: a movement whose steps SAY hands-out must still say it. */
        squatThrustUntouched: (EX.squatthrust.steps || []).join(' ').length > 40,
      };
    });
    t.eq('the inchworm ships a video', r.vid, 'ex-inchworm.mp4');
    t.ok('and the player emits it rather than the photo', r.emitsVideo, r);
    /* THE point of this block: the words describe what the clip shows. */
    t.ok('the steps say the FEET walk in, which is what the video shows', r.saysFeetIn, r);
    t.ok('and no longer say the hands walk back', !r.saysHandsBack, r);
    /* The floors — the rest of the movement is unchanged. */
    t.ok('the hands still walk OUT on the way there', r.walksHandsOut, r);
    t.ok('and the no-jump cue survives, which is what stops it being a burpee',
      r.neverJump, r);
    t.ok('guard: a sibling movement still has real steps', r.squatThrustUntouched, r);
  }

  /* ---- the 8-count push-up ---------------------------------------------
     Searched by MOVEMENT, not by name. The library had squatthrust, burpee,
     burpeetuck and plankjack — every beat of the drill separately, and the
     drill itself nowhere. The 8-count chains a squat, a plank, a leg spread
     and a MANDATORY push-up into one count; the burpee's own steps offer its
     push-up as optional ("add a push-up to make it harder"), which is the
     difference that earns this its own entry. */
  {
    const r = await page.evaluate(() => {
      const risk = j => (JOINT_RISK[j] || []);
      const flags = k => ['knee', 'lowback', 'shoulder', 'wrist', 'elbow']
        .filter(j => risk(j).includes(k));
      const hard = k => EX[k] && EX[k].hardness;
      const mono = arr => arr.every((k, i) => i === 0 || hard(arr[i - 1]) >= hard(k));
      const real = STATE.profile.limitations;
      const routes = j => { STATE.profile.limitations = [j];
        const to = safeSwap('count8');
        return { to, safe: to !== 'count8' && !jointRisky(to, [j]) }; };
      const o = {
        exists: !!EX.count8,
        img: EX.count8 && EX.count8.img,
        unit: EX.count8 && EX.count8.unit,
        region: EX.count8 && EX.count8.region,
        hardness: hard('count8'),
        /* JOINT_RISK membership asserted DIRECTLY, per exercise — a generic
           "flagged joints do not leak" sweep never puts a new entry in the
           risky bucket at all if nothing asked for it. */
        mine: flags('count8'),
        /* The floors that prove the flags are reasoned rather than copied off
           the nearest sibling in the same family. */
        burpee: flags('burpee'),
        squatthrust: flags('squatthrust'),
        /* Ladders must stay non-increasing in hardness. */
        cardioBL: mono(LADDERS.cardioBL), cardioFinL: mono(LADDERS.cardioFinL),
        hiitFinL: mono(LADDERS.hiitFinL),
        inLadders: ['cardioBL', 'cardioFinL', 'hiitFinL'].filter(k => LADDERS[k].includes('count8')),
        inHiit: HIIT_POOL.includes('count8'),
        inFocus: (FOCUS_POOL.full || []).includes('count8'),
        swap: SAFE_SWAP.count8,
        swapReal: !!EX[SAFE_SWAP.count8],
        /* No gear at all — it is a floor and a body. */
        gearFree: (EX.count8.equip || []).length === 0,
      };
      o.wristRoute = routes('wrist');
      o.shoulderRoute = routes('shoulder');
      STATE.profile.limitations = real;
      return o;
    });
    t.ok('the 8-count push-up exists', r.exists, r);
    t.eq('it ships a photo', r.img, 'ex-count8.jpg');
    t.eq('timed, like the rest of the burpee family', r.unit, 'time');
    t.eq('and filed as cardio', r.region, 'cardio');
    /* Calibrated against the nearest siblings: harder than a plain burpee
       (0.7) because the push-up is not optional, easier than a maximal tuck
       jump (0.6). Higher hardness means easier. */
    t.ok('its hardness sits between the burpee and the tuck-jump burpee',
      r.hardness < 0.7 && r.hardness > 0.6, r.hardness);
    /* Each flag reasoned from mechanics: bodyweight through the hands for the
       plank, the leg spread and a full push-up. */
    t.eq('it flags the shoulder and the wrist', JSON.stringify(r.mine),
      JSON.stringify(['shoulder', 'wrist']));
    /* THE discriminator. Copying the burpee's flag set — the obvious thing to
       do for a movement in the same family — satisfies every check above and
       fails this one. There is no jump and no landing in an 8-count: you stand
       up on the eighth count. The squat thrust, the one sibling that also has
       no jump, carries no knee flag either. */
    t.ok('but NOT the knee — there is no jump and no landing',
      !r.mine.includes('knee'), r.mine);
    t.ok('while the burpee, which does jump, IS knee flagged',
      r.burpee.includes('knee'), r.burpee);
    t.ok('and the squat thrust, which does not, is wrist-only',
      JSON.stringify(r.squatthrust) === JSON.stringify(['wrist']), r.squatthrust);
    t.ok('a flagged wrist routes it somewhere safe', r.wristRoute.safe, r.wristRoute);
    t.ok('a flagged shoulder routes it somewhere safe too', r.shoulderRoute.safe, r.shoulderRoute);
    t.eq('its swap is the same drill with the push-up taken out', r.swap, 'squatthrust');
    t.ok('and that swap is a real exercise', r.swapReal, r);
    t.eq('it joins all three ladders it belongs in', r.inLadders.length, 3);
    t.ok('the base cardio ladder stays non-increasing in hardness', r.cardioBL, r);
    t.ok('so does the cardio finisher ladder', r.cardioFinL, r);
    t.ok('and the HIIT finisher ladder', r.hiitFinL, r);
    t.ok('it is reachable from the HIIT pool', r.inHiit, r);
    t.ok('and from the full-body focus pool', r.inFocus, r);
    t.ok('it needs no equipment', r.gearFree, r);
  }
  {
    /* The two pickers were built in different functions from two hand-written
       literals, and they HAD drifted: onboarding offered 13 items and Settings
       offered 12. The missing one was `bike`, which bikeSwap() reads and
       toggleGear() is the only writer of — so an athlete who bought a trainer
       after setup could never tell the app. (hasTrainer() read it too, until
       v387: its gate had been removed deliberately and the function sat
       uncalled, while a comment still asserted it gated the bike work.)

       The old check here counted the literal twice and could not see that at
       all: it asked whether ONE entry appeared in both copies, not whether the
       two copies agreed. Asserting the shared list exists is the weaker half;
       what matters is what the athlete can actually reach, so the Settings
       picker is DRIVEN and compared against the list itself. */
    const src2 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const r = await page.evaluate(() => {
      go('guide');
      const offered = [...document.querySelectorAll('#v-guide button')]
        .map(b => ((b.getAttribute('onclick') || '').match(/toggleGear\('([a-z]+)'\)/) || [])[1])
        .filter(Boolean);
      return { offered, keys: GEAR_KEYS.slice(), opts: GEAR_OPTS.length };
    });
    t.ok('guard: the Settings picker really rendered', r.offered.length > 5, r);
    t.eq('every piece of kit the app knows about is settable in Settings',
      r.offered.slice().sort(), r.keys.slice().sort(), r);
    t.ok('including the bike, which only onboarding used to offer',
      r.offered.includes('bike'), r);
    t.ok('and the sandbag the FORCE work needs', r.offered.includes('sandbag'), r);
    /* One list, so the two pickers cannot drift again. Both render sites read
       it rather than restating it. */
    t.eq('the kit list exists exactly once', (src2.match(/const GEAR_OPTS=/g) || []).length, 1);
    /* Count the RENDER sites, not every read: GEAR_KEYS derives from the same
       list and is a third, legitimate, non-picker use of it. */
    t.eq('and both pickers read it rather than restating it',
      (src2.match(/GEAR_OPTS\.map\(\(\[k,l\]\)/g) || []).length, 2);
    /* Named by what the kit physically IS. "Rucksack" alone would be ticked by
       anyone who owns a school bag; the plate is the part that matters, and the
       sandbag's weight is the part that matters for the FORCE tasks. */
    t.ok('the ruck entry names the plate', /\['ruck','Weighted rucksack \+ plate'\]/.test(src2));
    t.ok('the sandbag entry names its weight', /\['sandbag','Sandbag \(20 kg \/ 45 lb\)'\]/.test(src2));
  }

  /* ---- the four Canadian FORCE Evaluation tasks (v322) ---------------------
     The roster search by MOVEMENT found no drag, no shuttle, no rush and no
     floor-to-shelf lift anywhere in 155 exercises — the nearest relatives were
     a suitcase carry and a bear-hug carry, neither of which asks for what
     these ask for. */
  {
    const r = await page.evaluate(() => {
      const keep = { gear: (STATE.profile.gear || []).slice(), lims: STATE.profile.limitations };
      const jr = (k, j) => (JOINT_RISK[j] || []).includes(k);
      STATE.profile.gear = ['bar', 'bench'];
      const without = ['sbaglift', 'sbagshuttle', 'sbagdrag', 'rushes'].map(k => hasGearFor(k));
      STATE.profile.gear = ['bar', 'bench', 'sandbag'];
      const withBag = ['sbaglift', 'sbagshuttle', 'sbagdrag', 'rushes'].map(k => hasGearFor(k));
      STATE.profile.gear = ['bar', 'bench', 'ruck'];
      const withRuckOnly = ['sbaglift', 'sbagshuttle', 'sbagdrag'].map(k => hasGearFor(k));
      const out = {
        without, withBag, withRuckOnly,
        exist: ['sbaglift', 'sbagshuttle', 'rushes', 'sbagdrag'].map(k => !!EX[k]),
        imgs:  ['sbaglift', 'sbagshuttle', 'rushes', 'sbagdrag'].map(k => (EX[k] || {}).img),
        // every escalation, asserted DIRECTLY — a generic "flags do not leak"
        // sweep never puts a new entry in the risky bucket, so it proves nothing
        liftLow: jr('sbaglift', 'lowback'),   dragLow: jr('sbagdrag', 'lowback'),
        shuttleKnee: jr('sbagshuttle', 'knee'), rushKnee: jr('rushes', 'knee'),
        rushWrist: jr('rushes', 'wrist'),     dragShoulder: jr('sbagdrag', 'shoulder'),
        // and every flag that must NOT be there
        liftKnee: jr('sbaglift', 'knee'),     liftShoulder: jr('sbaglift', 'shoulder'),
        dragKnee: jr('sbagdrag', 'knee'),     shuttleWrist: jr('sbagshuttle', 'wrist'),
        shuttleShoulder: jr('sbagshuttle', 'shoulder'), rushLow: jr('rushes', 'lowback'),
        // the FLOOR siblings: unflagged, which is what proves the escalation is
        // reasoned rather than a family flag stamped on everything with a bag
        carryShoulder: jr('kbcarry', 'shoulder'), ruckcarryShoulder: jr('ruckcarry', 'shoulder'),
        gobletLow: jr('kbgoblet', 'lowback'),  squatKnee: jr('squat', 'knee'),
        thrustShoulder: jr('squatthrust', 'shoulder'),
        // swaps resolve
        swaps: ['sbaglift', 'sbagshuttle', 'sbagdrag', 'rushes']
          .map(k => [SAFE_SWAP[k], LOWBACK_SWAP[k], GEAR_FALLBACK[k]])
          .flat().filter(Boolean).every(t => !!EX[t]),
      };
      STATE.profile.gear = keep.gear; STATE.profile.limitations = keep.lims;
      return out;
    });
    t.ok('all four FORCE movements exist', r.exist.every(Boolean), r);
    /* Cross-contamination, BOTH directions. A single equip typo would hand an
       athlete three movements they have no kit for, and the generic sweeps
       cannot see that at all. */
    t.eq('without a sandbag the three bag tasks are locked', r.without.slice(0, 3), [false, false, false], r);
    t.ok('but the rushes need no equipment at all', r.without[3], r);
    t.eq('with a sandbag all four are available', r.withBag, [true, true, true, true], r);
    t.eq('and a ruck plate is NOT a sandbag', r.withRuckOnly, [false, false, false], r);
    // escalations
    t.ok('the sandbag lift is flagged for the low back', r.liftLow, r);
    t.ok('so is the drag', r.dragLow, r);
    t.ok('the loaded shuttle is flagged for the knee', r.shuttleKnee, r);
    t.ok('so are the rushes', r.rushKnee, r);
    t.ok('the rushes are flagged for the wrist', r.rushWrist, r);
    t.ok('the drag is flagged for the shoulder — the load sits behind the torso', r.dragShoulder, r);
    // the flags that must not fire
    t.ok('a bilateral floor-to-shelf lift is not a knee flag', !r.liftKnee, r);
    t.ok('nor a shoulder one — the bag never goes overhead', !r.liftShoulder, r);
    t.ok('a backwards walk under load is not a knee flag', !r.dragKnee, r);
    t.ok('the shuttle never touches the ground, so no wrist flag', !r.shuttleWrist, r);
    t.ok('and no shoulder flag', !r.shuttleShoulder, r);
    t.ok('the rushes put no load on the spine, so no low-back flag', !r.rushLow, r);
    /* THE FLOORS. Blanket-flagging the family satisfies every assertion above
       and fails every one of these. */
    t.ok('floor: a suitcase carry stays unflagged for the shoulder', !r.carryShoulder, r);
    t.ok('floor: so does the bear-hug carry', !r.ruckcarryShoulder, r);
    t.ok('floor: a goblet squat stays unflagged for the low back', !r.gobletLow, r);
    t.ok('floor: a bodyweight squat stays unflagged for the knee', !r.squatKnee, r);
    t.ok('floor: a squat thrust stays unflagged for the shoulder', !r.thrustShoulder, r);
    t.ok('every FORCE swap target is a real exercise', r.swaps, r);
    /* A pattern the Weights circuit never asks for is exactly as unreachable
       as no pattern at all, and the "has equip but no pattern" rule passes it.
       Found by inventing `carry` and `sprint` here: both satisfied the
       validator and neither could ever be picked — measured at 0 appearances
       in 400 circuits.

       "The validator is clean" proves nothing about a validator RULE: it stays
       clean whether the rule exists or not. Break the data in front of it and
       require the specific complaint, then restore. console.error is muted
       because validateData() logs and the harness counts a console error as a
       page failure. */
    const v = await page.evaluate(() => {
      const CIRCUIT = WEIGHTS_PATTERNS.concat(WEIGHTS_PATTERNS_EXTRA);
      const orphans = Object.keys(EX).filter(k => EX[k].pattern && !CIRCUIT.includes(EX[k].pattern));
      const err = console.error; console.error = () => {};
      const keep = EX.sbagdrag.pattern;
      EX.sbagdrag.pattern = 'carry';                 // the exact value that escaped
      const seeded = validateData();
      EX.sbagdrag.pattern = keep;
      const restored = validateData();
      console.error = err;
      return {
        orphans, keep,
        seededComplains: seeded.some(e => /sbagdrag.*pattern "carry".*never asks for/.test(e)),
        restoredClean: restored.length === 0,
        circuit: CIRCUIT,
      };
    });
    t.eq('no exercise carries a pattern the circuit never asks for', v.orphans, [], v);
    t.eq('the sandbag drag matches every other carry in the library', v.keep, 'core', v);
    t.ok('the validator complains about an invented pattern', v.seededComplains, v);
    t.ok('and is clean again once it is restored', v.restoredClean, v);
    /* One copy of the list, and the BUILDER must read it. Asserting the
       declaration exists is the weaker half and a mutant walked straight
       through it: reverting the builder to its own inline literal leaves the
       declaration standing while re-creating the two-hand-kept-copies drift
       that caused this. Assert on the function's own source — the circuit is
       randomised, so no single built session can prove which list it used. */
    const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    t.eq('the circuit list is declared once', (idxSrc.match(/const WEIGHTS_PATTERNS=/g) || []).length, 1);
    const reads = await page.evaluate(() => ({
      builder: buildWeightsSession.toString(),
      validator: validateData.toString(),
    }));
    t.ok('the Weights circuit reads it rather than restating it',
      /WEIGHTS_PATTERNS\.forEach/.test(reads.builder), reads.builder.slice(0, 200));
    t.ok('and so does the validator', /WEIGHTS_PATTERNS\.includes/.test(reads.validator));
    t.eq('no inline copy of the pattern order is left anywhere',
      (idxSrc.match(/\['squat','hinge','pushh'/g) || []).length, 1);
    // artwork on disk and in a precache tier
    const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    r.imgs.forEach(img => {
      t.ok('artwork exists on disk: ' + img, fs.existsSync(path.join(ROOT, img)));
      t.ok('and is precached: ' + img, swSrc.indexOf("'./" + img + "'") >= 0);
    });
  }


  /* ---- every function is reachable from a root ---------------------------
     v385 found that `_recipePlanHTML()` — the only renderer of a recipe's
     ingredients and method in the file — had NO CALLER, so the whole recipe
     view was unreachable from every screen while the morning brief read its
     address aloud. Its head `mealPlanHTML()` was uncalled, and everything
     below it went dark with it: toggleRecipe, openGrocery, regenPlan and
     mealGapHTML each had 0 reachable call sites.

     A direct-caller count cannot see that — `_recipePlanHTML` HAD a caller.
     It takes transitive reachability from the real roots: the page's own
     markup (an onclick= in the body is a call site the script never mentions),
     the top-level code, and boot().

     THE GUARDS MATTER MORE THAN THE RESULT. Every version of this analysis
     that was wrong reported hundreds of orphans, not a handful — a broken
     traversal looks exactly like a broken app. So it asserts that boot() was
     found, that most functions are reachable, and that the script it parsed is
     the app's. */
  {
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    // the app's script is the biggest inline one without a src
    let best = null;
    for (const m of idx.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g))
      if (!best || m[1].length > best[1].length) best = m;
    t.ok('guard: found the app script', !!best && best[1].indexOf('function normalizeState') >= 0);

    if (best) {
      // strip comments, respecting strings and template literals
      const stripComments = code => {
        let out = '', i = 0, st = null;
        while (i < code.length) {
          const c = code[i], nx = code[i + 1];
          if (!st) {
            if (c === '/' && nx === '*') { const j = code.indexOf('*/', i + 2); i = j < 0 ? code.length : j + 2; out += ' '; continue; }
            if (c === '/' && nx === '/') { const j = code.indexOf('\n', i); i = j < 0 ? code.length : j; continue; }
            if (c === '"' || c === "'" || c === '`') { st = c; out += c; i++; continue; }
            out += c; i++; continue;
          }
          if (c === '\\') { out += code.slice(i, i + 2); i += 2; continue; }
          if (c === st) st = null;
          out += c; i++;
        }
        return out;
      };
      const clean = stripComments(best[1]);

      const decl = [...clean.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)]
        .map(m => [m[1], m.index]);
      const names = new Set(decl.map(d => d[0]));
      t.ok('guard: the declaration pattern found the whole roster', names.size > 900, String(names.size));
      t.ok('guard: boot() is among them — otherwise the roots are wrong', names.has('boot'));

      /* A one-liner has no `}` in column 0, so a line-anchored search runs past
         it and swallows every top-level registry that follows — which made a
         dozen live builders read as unreachable. Match the brace. */
      const bodyEnd = start => {
        let i = clean.indexOf('{', start);
        if (i < 0) return null;
        let depth = 0, q = null;
        while (i < clean.length) {
          const c = clean[i];
          if (q) { if (c === '\\') { i += 2; continue; } if (c === q) q = null; i++; continue; }
          if (c === '"' || c === "'" || c === '`') { q = c; i++; continue; }
          if (c === '{') depth++;
          else if (c === '}') { depth--; if (!depth) return i + 1; }
          i++;
        }
        return null;
      };
      const bounds = decl.map(([nm, st2], k) => {
        const en = bodyEnd(st2) ?? (k + 1 < decl.length ? decl[k + 1][1] : clean.length);
        return [nm, st2, en];
      });
      const bodies = new Map(bounds.map(([nm, st2, en]) => [nm, clean.slice(st2, en)]));

      let top = '', prev = 0;
      for (const [, st2, en] of bounds) { top += clean.slice(prev, st2); prev = Math.max(prev, en); }
      top += clean.slice(prev);
      // the markup outside the script is a root: onclick="openSettings()"
      top += '\n' + idx.slice(0, best.index) + idx.slice(best.index + best[0].length);

      const refs = (text, self) => {
        const found = new Set();
        for (const m of text.matchAll(/\b([A-Za-z0-9_$]+)\s*[(),;\]}]/g))
          if (names.has(m[1]) && m[1] !== self) found.add(m[1]);
        return found;
      };
      const reach = new Set();
      const work = [...refs(top, null), 'boot'];
      while (work.length) {
        const f = work.pop();
        if (reach.has(f)) continue;
        reach.add(f);
        for (const g of refs(bodies.get(f) || '', f)) if (!reach.has(g)) work.push(g);
      }
      t.ok('guard: the traversal reached most of the roster, so it is not itself broken',
        reach.size > names.size * 0.9, reach.size + ' of ' + names.size);

      /* Kept on purpose and documented in the source: the suites are their
         only call site. mealPlanHTML() is suite 02's safety surface for the
         meal generator, todaysWorkedDay() is its helper, and logFoodFromList()
         is suite 06's bad-index guard. Deleting one of those on a call-site
         count is exactly the mistake v387 records. */
      const KEPT = new Set(['mealPlanHTML', 'todaysWorkedDay', 'logFoodFromList']);
      const orphans = [...names].filter(n => !reach.has(n) && !KEPT.has(n)).sort();
      t.eq('no function is unreachable from the markup, the top level or boot()',
        orphans.length, 0, orphans.slice(0, 20));
      // and the allowlist does not rot: each entry must still be genuinely uncalled
      KEPT.forEach(k => t.ok('the kept-on-purpose entry ' + k + ' is still uncalled',
        !reach.has(k), k + ' now has a caller — take it off the list'));

      /* ---- and no top-level constant is declared and never read (v453) ----
         The same question one declaration kind over. v331 found THREE dead
         constants at once and the middle one was the expensive kind: it looked
         like a setting, DISAGREED with the behaviour it named, and changed
         nothing at all when edited — the voicePitch trap in its purest form.

         v453 removed WARMUP and COOLDOWN, which were read and wrong rather than
         unread; this is what stops the next pair being merely forgotten. */
      const constNames = [...clean.matchAll(/\bconst\s+([A-Z][A-Z0-9_]+)\s*=/g)].map(m => m[1]);
      const unreadIn = (text, list) => list.filter(nm =>
        (text.match(new RegExp('\\b' + nm + '\\b', 'g')) || []).length <= 1).sort();

      /* GUARD, on a SYNTHETIC source rather than the real one, so it stays true
         whatever the app becomes: the detector must report a constant nothing
         reads and must NOT report one that is only ever read inside a template
         literal — which is how most of this app's constants are consumed. */
      const probe = "const AA_LIVE = 1;\nconst AA_DEAD = 2;\nconst h = `x ${AA_LIVE} y`;\n";
      const probeNames = [...probe.matchAll(/\bconst\s+([A-Z][A-Z0-9_]+)\s*=/g)].map(m => m[1]);
      const probeUnread = unreadIn(probe, probeNames);
      t.ok('guard: the scan reports a constant nothing reads', probeUnread.indexOf('AA_DEAD') >= 0, probeUnread);
      t.ok('guard: and not one read only inside a template literal', probeUnread.indexOf('AA_LIVE') < 0, probeUnread);
      t.ok('guard: it found the real roster of constants', constNames.length > 200, String(constNames.length));

      const deadConsts = unreadIn(clean, constNames);
      t.eq('no top-level constant is declared and never read', deadConsts.length, 0, deadConsts.slice(0, 20));

      /* ---- and every inline handler names a function that exists (v457) ---
         The mirror of the block above. Reachability asks whether a declared
         function is ever CALLED; it cannot see the opposite — a `onclick=`
         in markup naming a function that is not there. That is a button the
         athlete taps and nothing happens, with nothing on screen to say so,
         and `npm run check` cannot see it either because the file parses.

         v316 measured this once as a probe (275 names, none dead) and kept
         nothing. v385 is what that costs: a whole cluster went dark and stayed
         dark for many versions because the probe that would have caught it was
         thrown away.

         Handlers live inside template literals, so the scan reads the stripped
         script AND the static markup outside it. A name preceded by a dot is a
         method (`Math.round(`) and is not a handler. */
      const declared = new Set(names);
      for (const m of clean.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z0-9_$]+\s*=>)/gm))
        declared.add(m[1]);
      const HKW = new Set(['if', 'for', 'while', 'return', 'function', 'catch', 'switch', 'typeof',
        'new', 'do', 'else', 'delete', 'await', 'in', 'of', 'var', 'let', 'const', 'try', 'throw', 'void']);
      const HGLOBAL = new Set(['Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
        'Promise', 'Image', 'Set', 'Map', 'RegExp', 'Error', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
        'alert', 'confirm', 'prompt', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        'encodeURIComponent', 'decodeURIComponent', 'requestAnimationFrame', 'fetch', 'URL', 'Blob',
        'FileReader', 'Audio', 'AbortController']);
      const handlerCalls = text => {
        const o = new Map();
        for (const m of text.matchAll(/\bon[a-z]+\s*=\s*(["'])([\s\S]*?)\1/g))
          for (const c of m[2].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g))
            if (!o.has(c[1])) o.set(c[1], m[2].replace(/\s+/g, ' ').slice(0, 80));
        return o;
      };
      const outsideMarkup = idx.slice(0, best.index) + idx.slice(best.index + best[0].length);
      const unresolvedIn = (text, decl) => [...handlerCalls(text)]
        .filter(([n]) => !decl.has(n) && !HKW.has(n) && !HGLOBAL.has(n));

      /* GUARDS, on a SYNTHETIC source both ways, so an empty result is a
         statement about the app rather than about the regex. The third case is
         this file's most-recorded trap: a COMMENT that quotes a handler is not
         a call site, and the real file carries one (the v406 note quoting an
         `onerror=` payload) — measured, it is the ONLY hit if comments are not
         stripped first. */
      const hProbeDecl = new Set(['realFn']);
      const hProbe = '<button onclick="realFn(1)">a</button><b onclick="ghostFn()">b</b>';
      const hProbeHits = unresolvedIn(hProbe, hProbeDecl).map(x => x[0]);
      t.ok('guard: the scan reports a handler naming a function that is not there',
        hProbeHits.indexOf('ghostFn') >= 0, hProbeHits);
      t.ok('guard: and not one that is', hProbeHits.indexOf('realFn') < 0, hProbeHits);
      t.eq('guard: a comment quoting a handler is not a call site — the real file carries one',
        unresolvedIn(stripComments('/* onclick="ghostFn()" broke out and RAN */'), hProbeDecl).length, 0);

      const liveCalls = new Map([...handlerCalls(clean), ...handlerCalls(outsideMarkup)]);
      t.ok('guard: it found the real roster of handlers', liveCalls.size > 200, String(liveCalls.size));
      t.ok('guard: and the real roster of declarations', declared.size > 900, String(declared.size));

      const ghosts = [...new Map([...unresolvedIn(clean, declared), ...unresolvedIn(outsideMarkup, declared)])];
      t.eq('every inline handler names a function that exists', ghosts.length, 0,
        JSON.stringify(ghosts.slice(0, 8)));

      /* ---- and no stored flag is set while gating nothing (v457) ----------
         The same question a third declaration kind over, on a field that lives
         in the athlete's own saved state rather than in the source.

         `if(!STATE.profile._x)STATE.profile._x=true;` is the shape a one-time
         migration takes: the flag exists so the body beside it runs once. When
         the body is later removed the flag is routinely left behind, and what
         remains looks like it guards something and guards nothing — the
         voicePitch trap in a stored field. Three were live when this was
         written (_gearMil, _gearDb, _benchKit), two of them having lost even
         their comment, and each wrote a key into every athlete's profile and
         into every backup for ever.

         A live flag has a third site: the branch that reads it. */
      const selfSet = /if\s*\(\s*!\s*(STATE(?:\.[A-Za-z0-9_$]+)*\.(_[A-Za-z0-9_$]+))\s*\)\s*\1\s*=\s*[^;]+;/g;
      const deadFlagsIn = text => {
        const o = [];
        for (const m of text.matchAll(selfSet)) {
          const uses = (text.match(new RegExp('\\.' + m[2] + '\\b', 'g')) || []).length;
          if (uses <= 2) o.push(m[2]);
        }
        return o;
      };

      /* GUARDS, on a SYNTHETIC source both ways: a flag whose only two sites
         are its own set-once statement must be reported, and one that is
         genuinely read somewhere else must not. */
      const fProbe = 'if(!STATE.profile._deadF)STATE.profile._deadF=true;\n'
        + 'if(!STATE.profile._liveF){doThing();STATE.profile._liveF=true;}\n'
        + 'if(seeding&&!STATE.profile._liveF)seed();\n';
      const fProbeHits = deadFlagsIn(fProbe);
      t.ok('guard: the scan reports a flag that gates nothing', fProbeHits.indexOf('_deadF') >= 0, fProbeHits);
      t.ok('guard: and not one that is read elsewhere', fProbeHits.indexOf('_liveF') < 0, fProbeHits);
      t.ok('guard: the app really does carry set-once flags of this shape',
        [...clean.matchAll(selfSet)].length > 0, 'no set-once flag found at all');

      const deadFlags = deadFlagsIn(clean);
      t.eq('no stored one-time flag is set while gating nothing', deadFlags.length, 0, deadFlags);
    }
  }

  /* ---- the two static blurbs cannot derive, so they are pinned (v457) -----
     v348 measured it: 378 sessions is 54 weeks at SEVEN a week and the wizard's
     floor is FIVE, which is 76 — so a fixed duration is true for nobody who
     took the default. Every surface inside the app derives it from
     programWeeks(). The `<meta name="description">` and the manifest cannot:
     they are static text read by the install prompt and the store listing.

     So the claim they make is the one thing that can be checked — the SESSION
     count, which is a constant of the program rather than of the athlete — and
     a duration in time is forbidden outright. */
  {
    const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
    const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const metaM = /<meta\s+name="description"\s+content="([^"]*)"/.exec(idxSrc);
    t.ok('guard: the page carries a description meta tag', !!metaM, String(!!metaM));
    /* THREE registry-facing blurbs, not two. package.json's description is what
       npm and GitHub show and no sweep had ever read it — it still said "a
       54-week calisthenics and core program" after v473 fixed that exact claim
       in the other two. A sweep is only as wide as the surface it enumerates. */
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const blurbs = [['manifest', mf.description || ''], ['meta', metaM ? metaM[1] : ''],
                    ['package.json', pkg.description || '']];
    t.ok('guard: all three registry blurbs were read',
      blurbs.length === 3 && blurbs.every(([, v]) => v.length > 20),
      JSON.stringify(blurbs.map(b => b[0])));

    /* AND THE CHECK READ ONE FIELD OF A FILE WITH TEN (v474). The blurb rule
       has always read mf.description alone, while the manifest carries nine
       more strings a store listing and an install prompt show: the name, the
       short name, three screenshot labels and three shortcut names. A sweep is
       only as wide as the surface it enumerates.
       Nothing is wrong today. The one string that reads like a frequency claim
       — "Today's session, built for you every day" — was MEASURED rather than
       argued: on a day the athlete has picked off, isTrainingDay() is false and
       Today still builds a full live session with a Start button. It is true. */
    const storeText = [['manifest name', mf.name || ''], ['manifest short_name', mf.short_name || '']]
      .concat((mf.screenshots || []).map((x, i) => ['screenshot label ' + (i + 1), x.label || '']))
      .concat((mf.shortcuts || []).flatMap((x, i) => [
        ['shortcut name ' + (i + 1), x.name || ''], ['shortcut short_name ' + (i + 1), x.short_name || '']]));
    t.ok('guard: the sweep really reads every store-facing manifest string',
      storeText.length >= 9 && storeText.every(([, v]) => v.length > 0), String(storeText.length));

    const total = await page.evaluate(() => SESSIONS_PER_CYCLE * TOTAL_CYCLES);
    t.eq('guard: the program really is 378 sessions', total, 378, String(total));

    /* WEEKS WERE MISSING FROM THE PATTERN, so the meta tag kept a duration
       claim through v457's own fix: it said "starts with 6 weeks of core,
       abs and HIIT" while the detector looked only for years and months.
       A block is 6 PROGRAM weeks and a five-day athlete takes EIGHT calendar
       weeks over it, so the tag was true for nobody who took the default.
       Same shape as the one v457 recorded one clause away: a sweep aimed at
       one unit leaves the same claim alive in another. */
    const DUR = /\b(?:full[- ]year|one[- ]year|1[- ]year|year[- ]long|\d+\s*(?:months?|weeks?|years?))\b/i;
    blurbs.forEach(([where, txt]) => {
      t.ok('the ' + where + ' blurb claims no fixed duration in time',
        !DUR.test(txt), txt.slice(0, 140));
      const n = /\b(\d{2,4})[- ]session\b/.exec(txt);
      if (n) t.eq('and the ' + where + ' session count matches the program', +n[1], total, txt.slice(0, 140));
      t.ok('and the ' + where + ' blurb names the session count', /\b\d{2,4}[- ]session\b/.test(txt), txt.slice(0, 140));
    });
    /* FLOORS: the detector really catches each unit, and does NOT fire on an
       ordinary sentence with no duration in it. An empty offender list is
       otherwise a statement about the regex rather than about the blurbs. */
    t.ok('guard: the scan reports a year claim when there is one',
      DUR.test('a full year of full-body strength'), 'blind to years');
    t.ok('guard: the scan reports a WEEK claim when there is one',
      DUR.test('starts with 6 weeks of core, abs and HIIT'), 'blind to weeks');
    t.ok('guard: the scan reports a month claim when there is one',
      DUR.test('gets you there in 9 months'), 'blind to months');
    t.ok('guard: the scan stays quiet on a blurb with no duration in it',
      !DUR.test('a 378-session home training program with a baseline assessment'), 'over-eager');

    /* AND A FREQUENCY CLAIM IS THE SAME DEFECT ONE CLAUSE OVER (v474).
       v473 fixed the DURATION claim in both blurbs and left a frequency claim
       standing in one: the manifest said the plan "gets harder every week".
       Measured over whole weeks, block 1 runs 3149 -> 3436 -> 2091, because
       week 6 of every block is a scheduled deload — a 39% cut, by design, and
       the app names it on screen. So the blurb contradicted the app's own
       design, in the one kind of copy no rendered-surface sweep can reach.

       Two arms, each about a cadence the app itself contradicts: work that
       RISES on a fixed cadence, and training EVERY DAY (the wizard floors at
       five). The guard below measures the deload rather than asserting it —
       without that, the ban is a statement about a regex. */
    const RISE = /\b(?:harder|heavier|tougher|more|increases?|climbs?|rises?|progresses?)\s+(?:\w+\s+){0,2}every\s+(?:week|day|session|workout|time)\b/i;
    const DAILY = /\b(?:train|trains|training|work\s*out|workouts?|exercise)\w*\s+every\s+(?:single\s+)?day\b/i;
    blurbs.forEach(([where, txt]) => {
      t.ok('the ' + where + ' blurb claims no fixed rate of progression',
        !RISE.test(txt), txt.slice(0, 200));
      t.ok('and the ' + where + ' blurb does not claim training every day',
        !DAILY.test(txt), txt.slice(0, 200));
    });

    /* THE GUARD IS THE FINDING: the app really does schedule a lighter week,
       so the banned sentence really was false. Measured over the WHOLE week,
       because total volume is not comparable across session types. */
    const dl = await page.evaluate(() => {
      const wk = (c, w) => { let u = 0;
        for (let d = 0; d < SESSIONS_PER_WEEK; d++) {
          const s = buildSession((c * SESSIONS_PER_CYCLE) + ((w - 1) * SESSIONS_PER_WEEK) + d);
          [...s.main, s.finisher].forEach(m => { if (m) u += (m.sets || 0) * (m.target || 0); });
        }
        return u; };
      const rows = [];
      for (let c = 0; c < TOTAL_CYCLES; c++) {
        const last = (c * SESSIONS_PER_CYCLE) + ((WEEKS_PER_CYCLE - 1) * SESSIONS_PER_WEEK);
        rows.push({ block: c + 1,
          isDeload: deloadOn(posOf(last)) === true,
          beforeIsNot: deloadOn(posOf(last - SESSIONS_PER_WEEK)) === false,
          five: wk(c, WEEKS_PER_CYCLE - 1), six: wk(c, WEEKS_PER_CYCLE) });
      }
      return { rows, blocks: TOTAL_CYCLES };
    });
    /* THE SENTENCE SAYS "EVERY BLOCK", SO THE GUARD WALKS EVERY BLOCK. Measured:
       the drop runs 33-41% across all nine. A guard that proved it for block 1
       alone would leave the copy claiming more than the check backs, which is
       the class this round is about. */
    t.eq('guard: the sweep walked every block', dl.rows.length, dl.blocks, String(dl.rows.length));
    const noDeload = dl.rows.filter(r => !r.isDeload).map(r => r.block);
    t.eq('guard: the last week of EVERY block really is a scheduled deload', noDeload.length, 0, JSON.stringify(noDeload));
    const beforeBad = dl.rows.filter(r => !r.beforeIsNot).map(r => r.block);
    t.eq('guard: the week before it is not, in every block', beforeBad.length, 0, JSON.stringify(beforeBad));
    const noEase = dl.rows.filter(r => !(r.six > 0 && r.five > 0 && r.six < r.five * 0.85))
      .map(r => ({ b: r.block, five: r.five, six: r.six }));
    t.eq('guard: the whole week really eases in every block, so "harder every week" was false',
      noEase.length, 0, JSON.stringify(noEase));

    /* FLOORS: each arm proven to catch its own shape, and proven quiet on the
       truthful sentence that replaced it and on a plain description. */
    t.ok('guard: the scan reports a rising-cadence claim when there is one',
      RISE.test('an auto-generated plan that gets harder every week'), 'blind to the rise');
    t.ok('guard: it catches the same claim worded another way',
      RISE.test('the load increases every session'), 'blind to the rise');
    t.ok('guard: the scan reports a train-every-day claim when there is one',
      DAILY.test('a session to train every day of the week'), 'blind to daily');
    t.ok('guard: the scan stays quiet on the lighter-week sentence',
      !RISE.test('with a lighter week built into every block'), 'over-eager');
    t.ok('guard: the scan stays quiet on an ordinary description',
      !RISE.test('progressive full-body strength, calisthenics and HIIT') &&
      !DAILY.test('progressive full-body strength, calisthenics and HIIT'), 'over-eager');

    /* The same three arms over the rest of the manifest. No session count is
       required of these — a shortcut name has no room for one. */
    storeText.forEach(([where, txt]) => {
      t.ok('the ' + where + ' claims no fixed duration in time', !DUR.test(txt), txt.slice(0, 120));
      t.ok('the ' + where + ' claims no fixed rate of progression', !RISE.test(txt), txt.slice(0, 120));
      t.ok('the ' + where + ' does not claim training every day', !DAILY.test(txt), txt.slice(0, 120));
    });
  }

  /* ---- the store screenshots go stale in silence (v475) ------------------
     They were last regenerated at v294 and the app is at v474 — 180 versions,
     across changes that moved whole blocks between tabs. Measured against the
     live app, all three showed screens that no longer exist: Fuel had six goals
     where there are now seven and no diet picker at all (v324 put one there),
     Progress had NO sub-tab strip (v312 added four panes), and Today carried
     the alternate-session tiles high up where v314 moved them below the
     session. That is the most visible surface the app has, and no rendered-copy
     sweep can see a PNG.

     A pixel comparison is the wrong tool — fonts, timing and the coach photo
     all move. So the screenshots carry a STAMP of the structure they show, and
     the check re-derives it from the live app: the _planStamp shape, a stamp of
     every input the generator read rather than a writer remembering. Red here
     means "regenerate the screenshots and re-stamp", not "the app is broken".

     Each manifest label must also describe its own picture — the v473 rule,
     applied to a store listing. The FILE facts are checked here; the live
     comparison against the running app is in suite 09, which seeds an athlete. */
  {
    const fp = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/screenshot-fingerprint.json'), 'utf8'));
    const mf2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
    const files = (mf2.screenshots || []).map(x => x.src);
    t.eq('guard: the manifest still declares three screenshots', files.length, 3, JSON.stringify(files));
    t.eq('guard: every declared screenshot carries a structure stamp',
      files.filter(f => !fp[f]), [], JSON.stringify(Object.keys(fp)));

    /* Every declared screenshot exists, is a PNG, and is the size the manifest
       says it is — read from the file's own IHDR rather than trusted. */
    (mf2.screenshots || []).forEach(sh => {
      const buf = fs.readFileSync(path.join(ROOT, sh.src));
      const isPng = buf.length > 24 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG';
      t.ok('the ' + sh.src + ' file is a real PNG', isPng, String(buf.length));
      if (!isPng) return;
      t.eq('and it is the size the manifest declares',
        buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20), sh.sizes, sh.src);
    });

    /* And the label describes the picture rather than a screen it no longer
       shows — v473's rule, on a store listing. Two of the three named things
       that had moved off the captured pane. The LIVE comparison against the
       app lives in suite 09, which seeds an athlete: this file drives the raw
       page on purpose, and an un-onboarded app is not what a screenshot shows. */
    const lab = f => (mf2.screenshots.find(x => x.src === f) || {}).label || '';
    t.ok('the Fuel label names what is in the Fuel frame',
      /goal/i.test(lab('screenshot-fuel.png')) && /(eat|target)/i.test(lab('screenshot-fuel.png')),
      lab('screenshot-fuel.png'));
    t.ok('the Progress label names what is in the Progress frame',
      /(week|streak|activity)/i.test(lab('screenshot-progress.png')),
      lab('screenshot-progress.png'));
    t.ok('the Today label names what is in the Today frame',
      /session/i.test(lab('screenshot-today.png')), lab('screenshot-today.png'));
  }

  /* ---- every way OUT of the device is named where consent is formed (v476)
     The privacy policy is the document whose entire job is to list what leaves
     the phone. It named THREE ways and there are SIX: it was written at v294
     and voice commands shipped at v376, the watch-screenshot reader at v352,
     the tracker-screenshot reader at v253. The strongest wording of all was on
     the FIRST-RUN screen — "skip all three and nothing ever leaves the phone" —
     while the microphone, which needs no API key and so appears on no key
     screen, streamed audio to the browser's own speech service.

     v423 fixed the microphone sentence in SETTINGS and its own comment calls a
     false privacy claim "the worst kind of promise in UI text with no code
     behind it". The document carrying the strongest version of that promise was
     never touched: fixing one instance is not fixing the class, and the class is
     four documents wide.

     A RENDERED-COPY SWEEP CANNOT FIND THIS. v355 and v391 both read every
     promise sentence off the real screens and both came back clean, because a
     sweep judges the sentence it can see rather than the capability list it
     cannot. And an outbound-HOST scan cannot find it either: SpeechRecognition
     is a platform API with no URL anywhere in the file.

     So the list is DERIVED FROM THE SOURCE — each capability proved present by
     its own marker — and every document that makes the promise must name every
     member. A seventh capability needs a row here; the guard makes a renamed
     marker fail loudly rather than pass in silence. */
  {
    const app = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const pol = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
    const ter = fs.readFileSync(path.join(ROOT, 'terms.html'), 'utf8');
    /* The first-run note is a pure helper with no interpolation, but it is what
       the athlete actually reads, so it is taken from the APP rather than from
       the source: calling the helper is not the same as reading a string. */
    const note = await page.evaluate(() => {
      try { return privacyNoteHTML(); } catch (e) { return 'THREW: ' + e.message; }
    });
    t.ok('guard: the first-run privacy note really rendered', note.length > 200 &&
      !/^THREW/.test(note), note.slice(0, 90));

    /* name, the marker that proves the app HAS it, what the policy must say,
       what the first-run note must say. */
    /* SCOPE THE ASSERTION TO WHERE THE CHANGE WAS MADE. A page-wide /screenshot/
       and /watch/ over the whole policy is satisfied by the SUMMARY paragraph
       below the list, which names both — so gutting the image bullet escaped
       clean. Each capability is asserted inside the bullet that carries it. */
    const bulletOf = re => {
      const m = pol.match(new RegExp('<li><b>' + re + '[\\s\\S]*?<\\/li>'));
      return m ? m[0] : '';
    };
    const imageBullet = bulletOf('Image lookup');
    const voiceBullet = bulletOf('Voice commands');
    const offBullet   = bulletOf('Packaged-food');
    const azureBullet = bulletOf('Premium coach voice');
    t.ok('guard: all four exception bullets were found by name',
      [imageBullet, voiceBullet, offBullet, azureBullet].every(b => b.length > 80),
      [imageBullet, voiceBullet, offBullet, azureBullet].map(b => b.length).join(','));

    const CAPS = [
      ['Open Food Facts', /world\.openfoodfacts\.org/,           offBullet,   /open\s*food\s*facts/i, /open\s*food\s*facts/i],
      ['Gemini',          /generativelanguage\.googleapis\.com/,  imageBullet, /gemini/i,              /gemini/i],
      ['tracker shot',    /estimateFoodFromScreenshot/,           imageBullet, /screenshot of another/i, /screenshot/i],
      ['watch shot',      /ACTIVITY_PROMPT/,                      imageBullet, /watch/i,               /watch/i],
      ['Azure voice',     /SPEECH_SDK_URL/,                       azureBullet, /azure/i,               /azure/i],
      ['microphone',      /webkitSpeechRecognition/,              voiceBullet, /microphone/i,          /microphone/i],
    ];
    /* GUARD: a marker that no longer matches would let its whole row pass in
       silence, which is the drift this rule exists to stop. */
    t.eq('guard: every capability marker is still present in the app',
      CAPS.filter(c => !c[1].test(app)).map(c => c[0]), [], String(CAPS.length));

    /* GUARD: proven able to fail in BOTH directions, on a synthetic document,
       so it stays true whatever the real files become. */
    t.ok('guard: the rule reports a document that omits a capability',
      !/microphone/i.test('a policy that names gemini and azure only'), 'synthetic');
    t.ok('guard: and stays quiet on one that names it',
      /microphone/i.test('this one names the microphone'), 'synthetic');

    CAPS.forEach(([name, , scope, inPol, inNote]) => {
      t.ok('privacy.html names how data leaves via ' + name, inPol.test(scope), name);
      t.ok('and the first-run note names ' + name, inNote.test(note), name);
    });

    /* A LAZY MUTANT HIDES RATHER THAN DELETES, and a text search cannot tell —
       display:none and hidden both leave every word in the DOM. Recorded twice
       already (v314, v332); the answer both times was to catch BOTH shapes, so
       the note and the policy list are refused outright if either is hidden. */
    t.ok('the first-run note is not hidden from the athlete who reads it',
      !/display\s*:\s*none|visibility\s*:\s*hidden|\shidden[=\s>]/i.test(note),
      note.slice(0, 120));
    t.ok('and no exception bullet is hidden in the policy',
      !/<li[^>]*(?:hidden|display\s*:\s*none)/i.test(pol), 'privacy.html');

    /* ONE COUNT, AND IT IS CHECKED AGAINST ITS OWN LIST. A number written by
       hand beside the list that holds it drifts — it drifted three ways inside
       this very fix before the two spare copies were removed. The heading keeps
       the count; nothing else states one. */
    const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
    const head = (pol.match(/<h2>The (\w+) exceptions/) || [])[1] || '';
    const listM = pol.match(/<h2>The \w+ exceptions[\s\S]*?<ul>([\s\S]*?)<\/ul>/);
    const items = listM ? (listM[1].match(/<li><b>/g) || []).length : -1;
    t.ok('guard: the exceptions list really was found', items > 0, String(items));
    t.eq('the stated number of exceptions equals the bullets under it',
      WORD[head] || head, items, head + ' vs ' + items);
    t.eq('and no other sentence in the policy states a count of them',
      (pol.match(/(?:one of |through the )(one|two|three|four|five|six) (?:optional|explicit)/g) || []),
      [], 'a second copy is a second place to drift');

    /* The age floor both legal pages claim must be the one the app enforces.
       They said 16 and the setup screen accepts 13 — and it is TWO documents,
       so fixing either alone leaves the class alive. */
    const AGE_MIN = +(app.match(/const AGE_MIN=(\d+)/) || [])[1];
    t.ok('guard: AGE_MIN was read out of the app', AGE_MIN >= 10 && AGE_MIN <= 21, String(AGE_MIN));
    t.eq('privacy.html states the age floor the app enforces',
      +((pol.match(/aged (\d+) and older/) || [])[1]), AGE_MIN, String(AGE_MIN));
    t.eq('and terms.html states the same one',
      +((ter.match(/aged (\d+) and older/) || [])[1]), AGE_MIN, String(AGE_MIN));
  }

  /* ---- every hand-written pool names a real movement (v441) --------------
     The five swap maps have been checked for many versions and the POOLS never
     were, though they are the same kind of hand-kept list of exercise ids.

     Every consumer filters its pool before using it — `HIIT_POOL.filter(k=>EX[k])`,
     the same in focusBonus(), correctiveBonus() and sharpenFinisher(). That is
     right at RUN time and is exactly why a typo is invisible: the pool simply
     gets smaller. Measured, validateData() saw a typo'd HIIT_POOL member ZERO
     times before this rule existed.

     All 19 pools are clean today, so a clean validator proves nothing at all
     about the rule — it stays clean whether or not the rule exists. Each kind
     of pool is broken in front of it, the specific complaint required, then
     restored. console.error is muted because validateData() logs and the
     harness counts a console error as a page failure. */
  const poolRule = await page.evaluate(() => {
    const realErr = console.error; console.error = () => {};
    const o = {};
    const hits = re => validateData().filter(e => re.test(e)).length;

    /* GUARD: the app really is clean before anything is broken, or every
       "caught" below could be reporting a problem that was already there. */
    o.cleanBefore = validateData().length;

    /* GUARD: a truthiness filter would let an inherited key through, which is
       why the rule asks exKnown() rather than EX[k]. */
    o.inheritedTruthy = !!EX['constructor'];
    o.exKnownRefuses = exKnown('constructor') === false;

    const flat = HIIT_POOL.slice();
    HIIT_POOL.push('notARealMove');
    o.flatCaught = hits(/HIIT_POOL: unknown exercise "notARealMove"/);
    HIIT_POOL.length = 0; flat.forEach(k => HIIT_POOL.push(k));

    const fa = FOCUS_POOL.abs.slice();
    FOCUS_POOL.abs.push('notARealMove');
    o.focusCaught = hits(/FOCUS_POOL\.abs: unknown exercise "notARealMove"/);
    FOCUS_POOL.abs.length = 0; fa.forEach(k => FOCUS_POOL.abs.push(k));

    const cs = CORRECTIVE_POOL.shoulder.slice();
    CORRECTIVE_POOL.shoulder.push('notARealMove');
    o.correctiveCaught = hits(/CORRECTIVE_POOL\.shoulder: unknown exercise "notARealMove"/);
    CORRECTIVE_POOL.shoulder.length = 0; cs.forEach(k => CORRECTIVE_POOL.shoulder.push(k));

    const q0 = QUICKIES[0]; const realEx = q0.items[0].exId;
    q0.items[0].exId = 'notARealMove';
    o.quickCaught = hits(new RegExp('QUICKIES\\.' + q0.id + ': unknown exercise "notARealMove"'));
    q0.items[0].exId = realEx;

    const fk = Object.keys(SPECIAL_FORMATS).find(k => SPECIAL_FORMATS[k].exId);
    o.specialKey = fk;
    const realSp = SPECIAL_FORMATS[fk].exId;
    SPECIAL_FORMATS[fk].exId = 'notARealMove';
    o.specialCaught = hits(new RegExp('SPECIAL_FORMATS\\.' + fk + ': unknown exercise "notARealMove"'));
    SPECIAL_FORMATS[fk].exId = realSp;

    /* SWAP_ALT rides on the swap-map rule that already existed and never
       covered it. Same break, same specific complaint. */
    const ak = Object.keys(SWAP_ALT)[0];
    const realAlt = SWAP_ALT[ak];
    SWAP_ALT[ak] = 'notARealMove';
    o.swapAltCaught = hits(new RegExp('SWAP_ALT\\.' + ak + ' -> unknown exercise "notARealMove"'));
    SWAP_ALT[ak] = 'constructor';
    o.swapAltInherited = hits(new RegExp('SWAP_ALT\\.' + ak + ' -> unknown exercise "constructor"'));
    SWAP_ALT[ak] = realAlt;

    /* SIX MORE REGISTRIES CARRY AN EXERCISE ID and none was in the sweep v441
       shipped — the four format maps, the FORCE events and BOTH test lists, 29
       ids in all. HOLD_TESTS is the sharpest: holdMovement() resolves that id,
       so a typo leaves the whole hold test measuring nothing. */
    const skk = Object.keys(SKIP_FORMATS).find(k => SKIP_FORMATS[k].exId);
    const realSk = SKIP_FORMATS[skk].exId; SKIP_FORMATS[skk].exId = 'notARealMove';
    o.skipCaught = hits(new RegExp('SKIP_FORMATS\\.' + skk + ': unknown exercise "notARealMove"'));
    SKIP_FORMATS[skk].exId = realSk;

    const fe = FORCE_EVENTS.find(e => e.ex);
    const realFe = fe.ex; fe.ex = 'notARealMove';
    o.forceCaught = hits(new RegExp('FORCE_EVENTS\\.' + fe.id + ': unknown exercise "notARealMove"'));
    fe.ex = realFe;

    const realTe = TESTS[0].ex; TESTS[0].ex = 'notARealMove';
    o.testCaught = hits(new RegExp('TESTS\\.' + TESTS[0].id + ': unknown exercise "notARealMove"'));
    TESTS[0].ex = realTe;

    const realHo = HOLD_TESTS[0].exId; HOLD_TESTS[0].exId = 'notARealMove';
    o.holdCaught = hits(new RegExp('HOLD_TESTS\\.' + HOLD_TESTS[0].id + ': unknown exercise "notARealMove"'));
    HOLD_TESTS[0].exId = 'constructor';
    o.holdInherited = hits(new RegExp('HOLD_TESTS\\.' + HOLD_TESTS[0].id + ': unknown exercise "constructor"'));
    HOLD_TESTS[0].exId = realHo;

    /* An INHERITED key is the case a truthiness filter cannot see at all. */
    HIIT_POOL.push('constructor');
    o.inheritedCaught = hits(/HIIT_POOL: unknown exercise "constructor"/);
    HIIT_POOL.length = 0; flat.forEach(k => HIIT_POOL.push(k));

    o.cleanAfter = validateData().length;
    console.error = realErr;
    return o;
  });

  t.eq('guard: the app is clean before any pool is broken', poolRule.cleanBefore, 0);
  t.ok('guard: an inherited key is truthy on EX, and exKnown() refuses it',
    poolRule.inheritedTruthy && poolRule.exKnownRefuses, JSON.stringify(poolRule));
  t.eq('a typo in a flat pool is caught by name', poolRule.flatCaught, 1, poolRule);
  t.eq('and in a focus pool', poolRule.focusCaught, 1, poolRule);
  t.eq('and in a corrective pool', poolRule.correctiveCaught, 1, poolRule);
  t.eq('and in a quick workout', poolRule.quickCaught, 1, poolRule);
  t.eq('and in a special format', poolRule.specialCaught, 1, poolRule);
  t.eq('and in SWAP_ALT, which the swap-map rule never covered', poolRule.swapAltCaught, 1, poolRule);
  t.eq('and in a skipping format', poolRule.skipCaught, 1, poolRule);
  t.eq('and in a FORCE event', poolRule.forceCaught, 1, poolRule);
  t.eq('and in a baseline test', poolRule.testCaught, 1, poolRule);
  t.eq('and in a hold test — holdMovement() resolves that id',
    poolRule.holdCaught, 1, poolRule);
  t.eq('and a hold test refuses an inherited key too', poolRule.holdInherited, 1, poolRule);
  /* The swap-map rule itself read EX[target] by truthiness. Two rules of the
     same kind must not disagree about what an exercise is, so it asks
     exKnown() now — and only an INHERITED key can tell the two apart. */
  t.eq('and the swap maps refuse an inherited key too', poolRule.swapAltInherited, 1, poolRule);
  t.eq('an INHERITED key is caught too — a truthiness filter cannot see it',
    poolRule.inheritedCaught, 1, poolRule);
  /* FLOOR: a rule that complained about everything satisfies every assertion
     above and makes the validator useless. */
  t.eq('and the validator is clean again once every pool is restored',
    poolRule.cleanAfter, 0, poolRule);


  /* ---- a local computed and never read ------------------------------------
     `const gate=reassessGate();` sat in commitSession() and nothing read it, so
     the commit READ as though it gated on the re-test and did not. Six more
     like it: a set count in the exercise card, an EX lookup in
     loadProgression(), a nut() call in readinessSlump() that reads
     STATE.readiness instead, a habit count in renderFuel(), a date in
     saveTDEE() and a QUICKIES lookup in quickFinish(). None was athlete-visible;
     all seven misled a reader, and the shape also catches the real defect —
     a value computed for the screen and never rendered.

     Run in NODE against the file: no page needed, and the page-side scan cannot
     see a declaration's scope anyway. */
  {
    const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    let big = '', bigAt = 0;
    for (const m of src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g))
      if (m[1].length > big.length) { big = m[1]; bigAt = m.index; }
    /* Comments go, STRINGS STAY. Most of this app's values are consumed inside a
       template literal, and blanking string bodies reported 370 dead locals —
       every one of them a variable the markup uses. */
    const noComm = code => {
      let out = '', i = 0, st = null;
      while (i < code.length) {
        const c = code[i], nx = code[i + 1];
        if (!st) {
          if (c === '/' && nx === '*') { const j = code.indexOf('*/', i + 2); out += ' '.repeat((j < 0 ? code.length : j + 2) - i); i = j < 0 ? code.length : j + 2; continue; }
          if (c === '/' && nx === '/') { const j = code.indexOf('\n', i); out += ' '.repeat((j < 0 ? code.length : j) - i); i = j < 0 ? code.length : j; continue; }
          if (c === '"' || c === "'" || c === '`') st = c;
          out += c; i++; continue;
        }
        if (c === '\\') { out += code.slice(i, i + 2); i += 2; continue; }
        if (c === st) st = null;
        out += c; i++;
      }
      return out;
    };
    /* A SPREAD IS A USE. `...lead` puts a dot before the name, so a plain
       property-access lookbehind reads it as `obj.lead` and misses it — which
       reported focusBonus()'s two live variables as dead. */
    const scan = body => {
      const b = body.replace(/\.\.\./g, '   ');
      const out = [];
      for (const dm of b.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
        const v = dm[1];
        const uses = (b.match(new RegExp('(?<![.\\w$])' + v.replace(/\$/g, '\\$') + '(?![\\w$])', 'g')) || []).length;
        if (uses === 1) out.push(v);
      }
      return out;
    };
    const clean = noComm(big);
    const found = [];
    let fnCount = 0;
    for (const fm of clean.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)) {
      const open = clean.indexOf('{', fm.index + fm[0].length - 1);
      if (open < 0) continue;
      let d = 0, j = open;
      for (; j < clean.length; j++) { if (clean[j] === '{') d++; else if (clean[j] === '}' && --d === 0) break; }
      fnCount++;
      scan(clean.slice(open, j + 1)).forEach(v =>
        found.push(fm[1] + '(): ' + v + ' @' + (src.slice(0, bigAt + open).split('\n').length)));
    }
    t.ok('guard: the dead-local scan walked the whole roster', fnCount > 900,
      JSON.stringify({ functions: fnCount }));
    const probeDead = scan('{ const gate = reassessGate(); go("today"); }');
    const probeSpread = scan('{ const lead = [1]; const p = [...lead, 2]; use(p); }');
    const probeTpl = scan('{ const n = 3; return `there are ${n} of them`; }');
    t.eq('guard: it sees a local nothing reads', probeDead.join(), 'gate');
    t.eq('guard: and a SPREAD counts as a use', probeSpread.join(), '');
    t.eq('guard: and so does a template literal', probeTpl.join(), '');
    t.eq('no local is computed and never read', found.join('; '), '',
      JSON.stringify(found.slice(0, 8)));
  }


  /* ---- every note modifier is actually styled --------------------------
     `.note` has info, fire and warn. `class="note ok"` is written in 22 places
     — a cleared health screen, a met target, a goal reached — and `.ok` had NO
     RULE, so every one of them painted BYTE-IDENTICAL to a bare `.note`:
     transparent, no border, plain ink, while the other three carry a 10% tint
     and a 1px edge. `--green` was already in the palette in both themes and
     unused by any note.

     Measured on the PAINTED box, not on the stylesheet text: a rule added
     somewhere else, or a modifier that stops resolving, shows up here either
     way. */
  {
    const notes = await page.evaluate(() => {
      const src = [...document.querySelectorAll('script:not([src])')]
        .map(s => s.textContent).sort((a, b) => b.length - a.length)[0] || '';
      /* Static modifiers, plus the quoted literals inside a computed one
         (class="note ${w.down?'ok':'info'}"). */
      const mods = new Set();
      for (const m of src.matchAll(/class="note ([a-z]+)"/g)) mods.add(m[1]);
      for (const m of src.matchAll(/class="note \$\{([^}]*)\}"/g))
        for (const q of m[1].matchAll(/'([a-z]+)'/g)) mods.add(q[1]);
      const paint = cls => { const d = document.createElement('div'); d.className = cls;
        document.body.appendChild(d); const cs = getComputedStyle(d);
        const o = cs.backgroundColor + '|' + cs.borderTopWidth + '|' + cs.color;
        d.remove(); return o; };
      const out = { mods: [...mods], themes: {} };
      const keep = document.documentElement.getAttribute('data-theme');
      ['dark', 'light'].forEach(t => {
        document.documentElement.setAttribute('data-theme', t);
        const plain = paint('note');
        out.themes[t] = { plain, unstyled: out.mods.filter(m => paint('note ' + m) === plain) };
      });
      if (keep) document.documentElement.setAttribute('data-theme', keep);
      else document.documentElement.removeAttribute('data-theme');
      return out;
    });
    t.ok('guard: the scan found the note modifiers the app really uses',
      notes.mods.length >= 3 && notes.mods.indexOf('ok') >= 0, JSON.stringify(notes.mods));
    t.eq('every note modifier paints differently from a bare note — dark',
      notes.themes.dark.unstyled.join(', '), '', JSON.stringify(notes.themes.dark));
    t.eq('and in light theme too',
      notes.themes.light.unstyled.join(', '), '', JSON.stringify(notes.themes.light));

    /* AND THE LIGHT THEME DECLARES ITS OWN color-scheme. It was set once,
       unconditionally dark, with no override — so the browser painted every
       NATIVE control from its dark palette on a light page. Measured on a
       light-background date field: the calendar button is a pale outline
       against the solid icon it becomes under color-scheme:light, and the same
       declaration drives the number spinners and the scrollbars.

       The app styles its own field bodies, so the TEXT was never at risk (a
       bare input measures 1.44:1, a real one 14.57:1) — it is the
       browser-painted parts that were wrong. */
    const scheme = await page.evaluate(() => {
      const read = t => {
        if (t) document.documentElement.setAttribute('data-theme', t);
        else document.documentElement.removeAttribute('data-theme');
        return { scheme: getComputedStyle(document.documentElement).colorScheme,
          ink: getComputedStyle(document.body).color };
      };
      const keep = document.documentElement.getAttribute('data-theme');
      const o = { light: read('light'), dark: read('dark') };
      if (keep) document.documentElement.setAttribute('data-theme', keep);
      else document.documentElement.removeAttribute('data-theme');
      return o;
    });
    /* GUARD: the two themes really are different palettes, or the assertions
       below pass on one theme measured twice. */
    t.ok('guard: the light and dark palettes really differ',
      scheme.light.ink !== scheme.dark.ink, JSON.stringify(scheme));
    t.eq('the light theme paints native controls from the light palette',
      scheme.light.scheme, 'light', JSON.stringify(scheme));
    t.eq('and the dark theme keeps the dark one', scheme.dark.scheme, 'dark',
      JSON.stringify(scheme));
  }

  await browser.close(); srv.close();
  return t.finish(errors);
}
