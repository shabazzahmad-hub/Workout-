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

  /* Duplicate keys in a hand-maintained object literal are silent — JS keeps the
     last one. That is how boxpistol shipped with two repCaps and how a shadowed
     SAFE_SWAP entry routed a flagged low back into lumbar flexion. */
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const name of ['SAFE_SWAP', 'LOWBACK_SWAP', 'GEAR_FALLBACK', 'JOINT_RISK', 'REGION_KIN']) {
    const m = src.match(new RegExp('const ' + name + '\\s*=\\s*\\{[\\s\\S]*?\\n\\};'));
    if (!m) { t.fail(`${name} literal found in source`); continue; }
    const keys = (m[0].match(/(?:^|[\s,{])([a-zA-Z0-9_]+)\s*:/gm) || []).map(s => s.replace(/[\s,{:]/g, ''));
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    t.ok(`${name} has no duplicate keys`, dupes.length === 0, [...new Set(dupes)]);
  }
  const exBlock = src.slice(src.indexOf('const EX = {'));
  const exKeys = (exBlock.slice(0, exBlock.indexOf('\n};')).match(/^ {2}([a-z0-9]+):\{/gm) || [])
    .map(s => s.trim().replace(':{', ''));
  const exDupes = exKeys.filter((k, i) => exKeys.indexOf(k) !== i);
  t.ok('EX has no duplicate keys', exDupes.length === 0, [...new Set(exDupes)]);
  const dupField = (exBlock.match(/^ {2}[a-z0-9]+:\{[^\n]*?\b(\w+):[^\n]*?\b\1:/gm) || [])
    .map(s => s.slice(0, 40));
  t.ok('no exercise repeats a field on its own line', dupField.length === 0, dupField);

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

  await browser.close(); srv.close();
  return t.finish(errors);
}
