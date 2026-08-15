/* v210 invariant hardening — the findings from the external v209 audit that
   were real, plus the actualRatio() hole found alongside them.

   The theme is the same in every case: a promise made somewhere the athlete can
   read it, and no code enforcing it. A baseline that says "your numbers" and
   invents them. A finish screen that says "complete" for a session nobody did.
   A health screen that says "well short of failure" while prescribe() never
   asks. A restart that says "history stays saved" and hands the new block the
   old block's record.

   Everything here runs the real path — boot, player, commit — because each
   defect lived in the gap between what a function looked like it did and what
   it did. */
import { serve, launch, suite, waitForBoot, seedAthlete, ATHLETE } from './lib/harness.mjs';

export default async function run() {
  const t = suite('v210 integrity');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  /* ---- CF209-01: a measured zero is data, not a missing answer ----------- */
  {
    const r = await page.evaluate(() => {
      // driven off the real TESTS ids, not a hand-kept list — the same trap
      // this file's own trunk-order check hit a few blocks down: a literal
      // list of ids goes stale the moment a test is added, and for THIS check
      // specifically a stale list is worse than most, because an id simply
      // missing from the fixture reads as "absent" and falls back to its
      // default rather than testing the zero it was supposed to test.
      const ids = TESTS.map(t => t.id);
      const zero = {}; ids.forEach(k => zero[k] = 0);
      const a = computeAssessment(zero);
      const blank = {}; ids.forEach(k => blank[k] = '');
      const b = computeAssessment(blank);
      const mixed = computeAssessment({ plank: 0, side: 45, hollow: '', lower: 12, dyn: 0, push: 0, pull: 0, squat: 30, power: 0 });
      return { zeroMaxes: a.maxes, zeroScore: a.score, zeroLevel: a.level,
        blankMaxes: b.maxes, mixed: mixed.maxes };
    });
    const zeros = Object.values(r.zeroMaxes);
    t.ok('a whole battery of zeros stays zero', zeros.every(v => v === 0), r.zeroMaxes);
    t.eq('and scores as zero', r.zeroScore, 0);
    t.eq('and reads as Beginner', r.zeroLevel, 'Beginner');
    t.ok('a BLANK answer still falls back to the starting estimate',
      r.blankMaxes.plank === 30 && r.blankMaxes.pull === 6 && r.blankMaxes.power === 7, r.blankMaxes);
    t.eq('a zero beside real results is kept', r.mixed.plank, 0);
    t.eq('and the real results are untouched', r.mixed.side, 45);
    t.eq('while a blank one falls back', r.mixed.hollow, 20);
    t.eq('and a measured zero on the newest test is kept too, not defaulted', r.mixed.power, 0);
  }

  /* ---- CF209-20: the skill tree agrees with the engine ------------------- */
  {
    /* The bug is `LEVEL_TIER[level] || 1`, and LEVEL_TIER.Beginner is the only
       tier that is 0 — so this has to run as an actual BEGINNER. The seeded
       athlete is Advanced (tier 2, truthy), which walked straight past the
       defect: the first version of this check passed with the bug restored. */
    const r = await page.evaluate(() => {
      const keep = { b: STATE.baseline, e: STATE.profile.experience };
      STATE.baseline = null; STATE.profile.experience = 'Beginner';
      const lad = Object.keys(LADDERS)[0];
      const out = { level: levelOf(0), tier: LEVEL_TIER[levelOf(0)],
        shown: currentRung(lad), engine: rungIndex(lad, 0, 1, levelOf(0)) };
      STATE.baseline = keep.b; STATE.profile.experience = keep.e;
      return out;
    });
    t.eq('the probe really is a beginner', r.level, 'Beginner');
    t.eq('whose tier is the falsy zero that caused this', r.tier, 0);
    t.eq('a pre-baseline beginner is shown the rung the engine prescribes', r.shown, r.engine);
    t.eq('which is the bottom rung, not one above it', r.shown, 0);
  }

  /* ---- CF209-02: no work, no session ------------------------------------ */
  {
    const r = await page.evaluate(async () => {
      STATE.progressPtr = 4; STATE.logs = {}; STATE.adapt = 1; save();
      const before = { ptr: STATE.progressPtr, adapt: STATE.adapt };
      openPlayer();
      const items = PLAYER.items.length;
      let guard = 0;
      while (document.querySelector('#player.open') && guard++ < 400) playerSkip();
      const ratio = actualRatio();
      commitSession('easy');
      await new Promise(z => setTimeout(z, 200));
      const log = STATE.logs[before.ptr] || {};
      return { items, ratio, ptr: STATE.progressPtr, was: before.ptr, adapt: STATE.adapt,
        done: !!log.done, abandoned: !!log.abandonedAt, counted: sessionsDoneCount(),
        streak: computeStreak() };
    });
    t.eq('skipping every movement does not advance the programme', r.ptr, r.was);
    t.ok('the session is not marked done', !r.done, r);
    t.ok('it is recorded as abandoned rather than silently dropped', r.abandoned, r);
    t.eq('it does not count toward sessions done', r.counted, 0);
    t.eq('it does not build a streak', r.streak, 0);
    t.eq('zero work reads as ratio 0, not "no data"', r.ratio, 0);
    t.eq('and the adaptive load does not rise off an untrained session', r.adapt, 1);
  }
  {
    // the other half: real work still commits, and partial work is marked partial
    const r = await page.evaluate(async () => {
      STATE.progressPtr = 4; STATE.logs = {}; STATE.adapt = 1; save();
      const s = buildSession(STATE.progressPtr);
      toggleEx(s.main[0].exId);                       // one movement, not the whole session
      const before = STATE.progressPtr;
      commitSession('right');
      await new Promise(z => setTimeout(z, 200));
      const log = STATE.logs[before] || {};
      return { ptr: STATE.progressPtr, was: before, done: !!log.done, partial: !!log.partial,
        counted: sessionsDoneCount(), setsDone: log.setsDone, setsAsked: log.setsAsked };
    });
    t.eq('doing real work still advances the programme', r.ptr, r.was + 1);
    t.ok('and is marked done', r.done, r);
    t.ok('a short session is flagged partial', r.partial, r);
    t.ok('with the numbers behind that flag stored', r.setsDone > 0 && r.setsAsked > r.setsDone, r);
    t.eq('and it counts as a session', r.counted, 1);
  }

  /* ---- CF209-03: the health promise reaches the prescription ------------- */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ p: STATE.profile.parq, d: STATE.profile.parqDone, m: STATE.profile.medCleared });
      const pos = { cycle: 0, week: 1 };
      const ex = Object.keys(EX).find(k => EX[k].unit === 'time' && EX[k].anchor);
      STATE.profile.parq = []; STATE.profile.parqDone = true; STATE.profile.medCleared = true;
      const clear = prescribe(ex, pos);
      const clearSafe = safeMode();
      STATE.profile.parq = ['heart']; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
      const flagged = prescribe(ex, pos);
      const flaggedSafe = safeMode();
      const k = JSON.parse(keep);
      STATE.profile.parq = k.p; STATE.profile.parqDone = k.d; STATE.profile.medCleared = k.m;
      return { ex, clear, flagged, clearSafe, flaggedSafe };
    });
    t.ok('a clean health screen is not in safe mode', !r.clearSafe, r);
    t.ok('a flagged, uncleared screen is', r.flaggedSafe, r);
    t.ok('a flagged athlete is held below the cleared prescription',
      r.flagged.target < r.clear.target, { clear: r.clear, flagged: r.flagged });
    t.ok('with no more than three sets', r.flagged.sets <= 3, r.flagged);
    t.ok('and longer rest between them', r.flagged.rest >= r.clear.rest, r.flagged);
  }
  {
    // fails closed: an UNANSWERED screen is not a clean one
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ p: STATE.profile.parq, d: STATE.profile.parqDone, m: STATE.profile.medCleared });
      const pos = { cycle: 0, week: 1 };
      const ex = Object.keys(EX).find(k => EX[k].unit === 'time' && EX[k].anchor);
      STATE.profile.parq = []; STATE.profile.parqDone = true; STATE.profile.medCleared = true;
      const clear = prescribe(ex, pos);
      delete STATE.profile.parq; STATE.profile.parqDone = true;   // the restored-backup shape
      const unanswered = prescribe(ex, pos);
      const k = JSON.parse(keep);
      STATE.profile.parq = k.p; STATE.profile.parqDone = k.d; STATE.profile.medCleared = k.m;
      return { clear, unanswered, safe: true };
    });
    t.ok('an unanswered health screen is treated as flagged, not as clean',
      r.unanswered.target < r.clear.target, r);
  }

  /* ---- CF209-04: a fresh block cannot collide with the old one ----------- */
  {
    const r = await page.evaluate(async () => {
      STATE.logs = {}; STATE.runs = []; STATE.progressPtr = 0; save();
      // build a finished block: three real sessions
      for (let i = 0; i < 3; i++) {
        const s = buildSession(STATE.progressPtr);
        toggleEx(s.main[0].exId);
        commitSession('right');
        await new Promise(z => setTimeout(z, 60));
      }
      const before = { counted: sessionsDoneCount(), vol: totalVolume(), ptr: STATE.progressPtr,
        firstDate: STATE.logs[0] && STATE.logs[0].completedAt };
      window.confirm = () => true;                    // restartProgram asks
      restartProgram();
      await new Promise(z => setTimeout(z, 200));
      const fresh = ensureLog();                       // what the new block's session 0 gets
      return { before, ptr: STATE.progressPtr, runs: (STATE.runs || []).length,
        freshDone: !!fresh.done, freshHasWork: Object.keys(fresh.ex || {}).length,
        counted: sessionsDoneCount(), vol: totalVolume(),
        archived: (STATE.runs[0] && STATE.runs[0].sessions) || 0 };
    });
    t.eq('restarting resets the pointer', r.ptr, 0);
    t.ok('the new block session 0 is a FRESH log, not the old one', !r.freshDone, r);
    t.eq('with no work carried into it', r.freshHasWork, 0);
    t.eq('the finished run is archived', r.runs, 1);
    t.eq('with its session count intact', r.archived, r.before.counted);
    t.eq('lifetime sessions survive the restart', r.counted, r.before.counted);
    t.eq('and so does lifetime volume', r.vol.sets, r.before.vol.sets);
  }

  /* ---- CF209-12: lifetime volume counts what was performed --------------- */
  {
    const r = await page.evaluate(async () => {
      STATE.logs = {}; STATE.runs = []; STATE.progressPtr = 0; save();
      const s = buildSession(0);
      const m = s.main[0];
      toggleEx(m.exId);
      const log = ensureLog();
      log.ex[m.exId].actual = 1;                       // scraped one rep on the last set
      commitSession('right');
      await new Promise(z => setTimeout(z, 120));
      const withActual = totalVolume();
      // same session, no actual recorded
      STATE.logs = {}; STATE.runs = []; STATE.progressPtr = 0; save();
      toggleEx(m.exId);
      commitSession('right');
      await new Promise(z => setTimeout(z, 120));
      return { target: m.target, unit: m.unit, withActual, withoutActual: totalVolume() };
    });
    const key = r.unit === 'time' ? 'hold' : 'reps';
    t.ok('a set logged short of target does not bank the full target',
      r.withActual[key] < r.withoutActual[key], r);
    t.ok('while an unrecorded set still falls back to the prescription',
      r.withoutActual[key] > 0, r);
  }

  /* ---- CF209-06: an imported backup cannot execute -------------------- */
  {
    const r = await page.evaluate(() => {
      const keepSaved = STATE._saved, keepAch = JSON.stringify(STATE.achievements || {});
      const payload = '"><img src=x onerror="window.__pwned=1">';
      window.__pwned = 0;
      STATE._saved = payload;
      STATE.achievements = { first: '2026-01-01' + payload };
      try { renderGuide(); } catch (e) {}
      /* Assert on the DOM, not on the string. Escaping leaves the words
         "onerror=" sitting in the markup as inert text, so a substring match
         fails on a page that is perfectly safe — and would equally pass on one
         that is not, if the payload were spelled differently. What matters is
         whether an ELEMENT was created. */
      /* Match the PAYLOAD, not `onerror` — 126 legitimate exercise thumbnails
         in the Settings library carry onerror="this.style.display='none'" as a
         missing-image fallback, so the broad selector flagged a safe page. */
      const injectedInSettings = document.querySelectorAll('#v-guide img[src="x"]').length;
      let ach = '';
      try { ach = achievementsHTML(); } catch (e) { ach = 'THREW'; }
      const probe = document.createElement('div'); probe.innerHTML = ach;
      const injectedInAch = probe.querySelectorAll('img[src="x"]').length;
      STATE._saved = keepSaved; STATE.achievements = JSON.parse(keepAch);
      return { pwned: window.__pwned, injectedInSettings, injectedInAch,
        threw: ach === 'THREW', achShowsText: /onerror/.test(probe.textContent) };
    });
    t.eq('an injected _saved value never executes', r.pwned, 0);
    t.eq('and builds no element in Settings', r.injectedInSettings, 0);
    t.eq('an injected achievement date builds no element either', r.injectedInAch, 0);
    t.ok('it survives as inert text instead', r.achShowsText, r);
    t.ok('neither throws', !r.threw, r);
  }

  /* ---- the first-run privacy claim is true ------------------------------
     "Nothing is uploaded" was an absolute, and two opt-in features break it:
     the food-photo lookup posts to Google Gemini and the neural voice posts to
     Azure. Both are described where they are switched on — but consent is
     formed on the first-run screen, which had already promised otherwise. */
  {
    const r = await page.evaluate(() => {
      const html = privacyNoteHTML();
      const el = document.createElement('div'); el.innerHTML = html;
      const txt = el.textContent;
      return { txt,
        saysLocal: /only on this phone/i.test(txt),
        namesGemini: /gemini/i.test(txt),
        namesAzure: /azure/i.test(txt),
        saysOptIn: /own API key/i.test(txt),
        absolute: /Nothing is uploaded\.\s*$/.test(txt.trim()) };
    });
    t.ok('the note still says training data is local', r.saysLocal, r.txt);
    t.ok('it names Google Gemini as a recipient', r.namesGemini, r.txt);
    t.ok('and Microsoft Azure', r.namesAzure, r.txt);
    t.ok('and says both need the athlete\'s own key', r.saysOptIn, r.txt);
    t.ok('the unqualified "nothing is uploaded" claim is gone', !r.absolute, r.txt);
  }
  {
    // and it actually renders on the screen that makes the promise
    const r = await page.evaluate(() => {
      const before = STATE.onboarded; STATE.onboarded = false;
      let txt = '', threw = null;
      try { obMount(document.querySelector('#v-today')); txt = document.querySelector('#v-today').innerText; }
      catch (e) { threw = String(e).slice(0, 120); }
      STATE.onboarded = before;
      return { threw, hasClaim: /only on this phone/i.test(txt), names: /Gemini|Azure/i.test(txt) };
    });
    t.ok('onboarding renders the note without throwing', !r.threw, r);
  }

  /* ---- every area the athlete picks actually gets trained ---------------
     focusBonus() returned on the FIRST key that yielded a candidate, and the
     first key virtually always does. Measured across a whole 378-session
     program: the bonus was chosen by 'abs' 306 times out of 306, and adding
     chest, arms and thighs as trouble zones changed precisely nothing. Every
     secondary target and every trouble zone was dead input — the quiz asked,
     stored the answer, and the engine never read it. The in-code comment on
     focusKey even claimed the opposite. */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ f: STATE.profile.focusPrimary, t: STATE.profile.targets,
        z: STATE.profile.troubleZones, g: STATE.profile.goal });
      const scan = () => {
        const k = {};
        for (let p = 0; p < 378; p++) {
          try {
            const s = buildSession(p);
            const f = [...s.main, s.finisher].filter(Boolean).find(m => m && m.focus);
            if (f && f.focusKey) k[f.focusKey] = (k[f.focusKey] || 0) + 1;
          } catch (e) {}
        }
        return k;
      };
      STATE.profile.goal = 'lose';
      STATE.profile.focusPrimary = 'abs'; STATE.profile.targets = ['abs', 'full'];
      STATE.profile.troubleZones = [];
      const twoAreas = scan();
      STATE.profile.troubleZones = ['chest', 'arms', 'thighs'];
      const withTrouble = scan();
      const k = JSON.parse(keep);
      STATE.profile.focusPrimary = k.f; STATE.profile.targets = k.t;
      STATE.profile.troubleZones = k.z; STATE.profile.goal = k.g;
      return { twoAreas, withTrouble, total: Object.values(withTrouble).reduce((a, b) => a + b, 0) };
    });
    t.ok('a secondary target is trained, not just the primary',
      (r.twoAreas.full || 0) > 0, r.twoAreas);
    t.ok('the primary focus still gets the largest share',
      (r.twoAreas.abs || 0) >= (r.twoAreas.full || 0), r.twoAreas);
    ['chest', 'arms', 'legs'].forEach(z =>
      t.ok(`the "${z}" trouble zone actually reaches the program`, (r.withTrouble[z] || 0) > 0, r.withTrouble));
    t.ok('the primary is still the most-trained area with trouble zones added',
      (r.withTrouble.abs || 0) > (r.withTrouble.chest || 0), r.withTrouble);
    t.ok('and the bonus still fires on the same number of sessions', r.total > 300, r);
  }

  /* ---- a flagged joint gets stability work, not just avoidance -----------
     Every flagged joint until now was purely AVOIDED — safeSwap routes
     around anything risky, but nothing ever added corrective work back.
     correctiveBonus() adds one light stability movement on TOP of the
     session for a flagged shoulder/knee/lowback, scoped to joints where the
     library actually has a real (non-flagged, genuinely targeted) movement
     — wrist and elbow have none, and must stay silent rather than offer a
     mismatched filler. */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify(STATE.profile.limitations || []);
      const picksFor = lims => {
        STATE.profile.limitations = lims;
        const seen = new Set(); const dupes = [];
        for (let p = 20; p < 60; p++) {
          const items = buildSession(p).main;
          const ids = items.map(m => m.exId);
          if (new Set(ids).size !== ids.length) dupes.push({ p, ids });
          items.forEach(m => { if (m.corrective) seen.add(m.exId); });
        }
        return { picks: [...seen], dupes };
      };
      const none = picksFor([]);
      const shoulder = picksFor(['shoulder']);
      const knee = picksFor(['knee']);
      const lowback = picksFor(['lowback']);
      const wristElbow = picksFor(['wrist', 'elbow']);
      // superman IS itself lowback-flagged — stacking shoulder+lowback must
      // still land on something that clears BOTH flags, not just shoulder's
      const stacked = picksFor(['shoulder', 'lowback']);
      const lims = ['shoulder', 'lowback'];
      const risky = k => lims.some(j => (JOINT_RISK[j] || []).includes(k));
      const stackedStillSafe = stacked.picks.every(k => !risky(k));
      // glutebridge sits in BOTH FOCUS_POOL.glutes and CORRECTIVE_POOL.knee —
      // a knee-flagged athlete whose focus is glutes is the real scenario
      // where the two bonus slots could pick the identical exercise twice
      const keepFocus = JSON.stringify({ f: STATE.profile.focusPrimary, t: STATE.profile.targets });
      STATE.profile.focusPrimary = 'glutes'; STATE.profile.targets = ['glutes'];
      const glutesCollision = picksFor(['knee']);
      const fk = JSON.parse(keepFocus);
      STATE.profile.focusPrimary = fk.f; STATE.profile.targets = fk.t;
      // sets are capped low — this is a light add-on, not a full accessory.
      // Every CORRECTIVE_POOL entry is region:'stability', which prescribe()
      // already caps at 2 sets on its own — so the real prescribed number
      // can never exercise correctiveBonus()'s OWN cap. Force prescribe()
      // to hand back something bigger and confirm the cap still catches it.
      STATE.profile.limitations = ['lowback'];
      const sess = buildSession(50);
      const item = sess.main.find(m => m.corrective);
      const origPrescribe = prescribe;
      prescribe = (exId, pos) => ({ ...origPrescribe(exId, pos), sets: 5 });
      const forcedItem = correctiveBonus(posOf(50), new Set());
      prescribe = origPrescribe;
      const k = JSON.parse(keep);
      STATE.profile.limitations = k;
      return { none, shoulder, knee, lowback, wristElbow, stacked, stackedStillSafe, glutesCollision, item, forcedItem };
    });
    t.eq('no flagged joint means no corrective item anywhere', r.none.picks, []);
    t.eq('a flagged shoulder gets superman', r.shoulder.picks, ['superman']);
    t.eq('a flagged knee gets glutebridge', r.knee.picks, ['glutebridge']);
    t.ok('a flagged lowback gets birddog and/or deadbug', r.lowback.picks.length > 0 &&
      r.lowback.picks.every(k => ['birddog', 'deadbug'].includes(k)), r.lowback);
    t.eq('wrist and elbow have no corrective content and stay silent', r.wristElbow.picks, []);
    t.ok('stacking shoulder+lowback never lands on a movement risky for either', r.stackedStillSafe, r.stacked);
    t.ok('the corrective item never duplicates an exercise already in the session',
      r.none.dupes.length === 0 && r.shoulder.dupes.length === 0 && r.knee.dupes.length === 0 &&
      r.lowback.dupes.length === 0 && r.stacked.dupes.length === 0, r);
    t.ok('not even when the focus bonus and the corrective slot could both want glutebridge',
      r.glutesCollision.dupes.length === 0, r.glutesCollision);
    t.ok('it is capped at 2 sets — an add-on, not a full accessory', !!r.item && r.item.sets <= 2, r.item);
    t.eq('and tagged so it is identifiable as corrective, not the focus bonus', r.item && r.item.slot, 'corrective');
    t.eq('the cap itself clamps a bigger prescribed number down to 2, not just passes a naturally-small one through',
      r.forcedItem && r.forcedItem.sets, 2);
  }

  /* ---- the baseline battery does not measure its own fatigue -------------
     plank -> side -> hollow -> reverse crunch was four maximal TRUNK efforts
     in a row. Each measured how tired the one before it had left you, and
     those numbers anchor every prescription for a year. */
  {
    const r = await page.evaluate(() => {
      const TRUNK = new Set(['plank', 'side', 'hollow', 'lower', 'dyn']);
      const ids = TESTS.map(t => t.id);
      let run = 0, worst = 0;
      ids.forEach(id => { if (TRUNK.has(id)) { run++; worst = Math.max(worst, run); } else run = 0; });
      return { ids, worst, count: ids.length, protocol: (typeof TEST_PROTOCOL === 'number') ? TEST_PROTOCOL : null,
        trunk: ids.filter(i => TRUNK.has(i)).length };
    });
    /* v247 added a ninth test (Jump Squats, id 'power') — a non-trunk power
       test placed second, right after plank. v252 added a tenth (Burpees, id
       'stamina') — placed LAST instead, the opposite reasoning: it is the
       fatiguer, not the fatigue-sensitive one, so it has to run after
       everything it could otherwise compromise, not before. Count and
       position both moved on purpose each time; what must NOT move is the
       invariant itself (no 3+ trunk efforts in a row), which is checked
       generically against TESTS.map(t=>t.id) above rather than a hand-kept id
       list, so it stays correct across the next test added too. */
    t.eq('all ten tests are still in the battery', r.count, 10);
    t.ok('no more than two trunk tests run back to back', r.worst <= 2, r);
    t.eq('the battery still opens on the plank anchor', r.ids[0], 'plank');
    t.eq('the power test runs second, before any other maximal effort tires the athlete', r.ids[1], 'power');
    t.eq('the stamina test runs LAST, after everything it could otherwise fatigue', r.ids[r.ids.length - 1], 'stamina');
    t.ok('the protocol version is defined', r.protocol >= 2, r);
  }
  {
    // a recorded assessment carries the protocol it was taken under
    const r = await page.evaluate(() => {
      const keepB = STATE.baseline, keepH = STATE.scoreHistory.slice(), keepA = assessState;
      const res = {}; TESTS.forEach(t => res[t.id] = 20);
      // commitAssessment reads assessState.reassess; it is null outside the flow
      assessState = { idx: TESTS.length, results: res, reassess: null };
      const a = computeAssessment(res);
      const rec = { date: todayISO(), results: res, score: a.score, level: a.level,
        maxes: a.maxes, testCount: TESTS.length, protocol: TEST_PROTOCOL };
      commitAssessment(a, rec);
      const stamped = STATE.baseline && STATE.baseline.protocol;
      STATE.baseline = keepB; STATE.scoreHistory = keepH; assessState = keepA;
      return { stamped };
    });
    t.ok('a saved baseline records which protocol produced it', r.stamped >= 2, r);
  }

  /* ---- progress past the benchmark is visible ---------------------------
     Core Score clamps each test's contribution at 100, so an athlete who goes
     from 120s to 150s on the plank sees the headline number not move. The cap
     is right for a 0-100 level indicator and wrong as the only thing shown. */
  {
    const r = await page.evaluate(() => {
      const keepA = assessState, keepB = STATE.baseline;
      const plank = TESTS.find(t => t.id === 'plank');
      // well past every benchmark
      const res = {}; TESTS.forEach(t => res[t.id] = t.bench * 1.5);
      assessState = { idx: TESTS.length, results: res, reassess: null };
      const a = computeAssessment(res);
      const html = testBreakdownHTML(a);
      const el = document.createElement('div'); el.innerHTML = html; const txt = el.textContent;
      // and a re-test against a same-protocol prior, to check the delta appears
      STATE.baseline = { date: '2026-01-01', results: Object.fromEntries(TESTS.map(t => [t.id, t.bench])),
        protocol: TEST_PROTOCOL, score: 80, level: 'Advanced' };
      assessState = { idx: TESTS.length, results: res, reassess: 1 };
      const el2 = document.createElement('div'); el2.innerHTML = testBreakdownHTML(a); const txt2 = el2.textContent;
      // ...and against an OLD-protocol prior, where a delta would be misleading
      STATE.baseline = { date: '2026-01-01', results: Object.fromEntries(TESTS.map(t => [t.id, t.bench])),
        protocol: 1, score: 80, level: 'Advanced' };
      const el3 = document.createElement('div'); el3.innerHTML = testBreakdownHTML(a); const txt3 = el3.textContent;
      assessState = keepA; STATE.baseline = keepB;
      return { score: a.score, has150: /150%/.test(txt), pastIt: /past it/.test(txt),
        namesPlank: txt.indexOf(plank.name) >= 0,
        deltaShown: /\+/.test(txt2), crossProtocolNote: /not measuring the same thing/.test(txt3),
        crossProtocolHidesDelta: !/\+/.test(txt3) };
    });
    t.eq('the headline score is still capped at 100', r.score, 100);
    t.ok('but the breakdown shows 150% of benchmark uncapped', r.has150, r);
    t.ok('and says the benchmark was passed', r.pastIt, r);
    t.ok('every test is named in it', r.namesPlank, r);
    t.ok('a same-protocol re-test shows the improvement', r.deltaShown, r);
    t.ok('a cross-protocol comparison shows no delta', r.crossProtocolHidesDelta, r);
    t.ok('and explains why', r.crossProtocolNote, r);
  }

  /* ---- resistance work leaves a trace ------------------------------------
     buildWeightsSession() prescribed sets and reps and recorded nothing: no
     load, no reps, no effort. A session with dumbbells vanished from history,
     adherence and progression, and the app could not tell whether the athlete
     was getting stronger with weights at all. */
  {
    const r = await page.evaluate(async () => {
      const keepQ = JSON.stringify(STATE.quickLog || {});
      STATE.liftLog = []; STATE.quickLog = {}; STATE.profile.unit = 'cm';
      const ex = Object.keys(EX).find(k => EX[k].equip && EX[k].equip.includes('dumbbell'));
      const items = [{ exId: ex, unit: 'reps', target: 10 }];
      openLiftLog(items);
      const before = { trained: trainedToday(), rows: STATE.liftLog.length,
        prevHint: /first time/.test(document.body.innerText) };
      document.querySelector('#lf-l-0').value = '22.5';
      document.querySelector('#lf-r-0').value = '8';
      document.querySelector('#lf-e-0').value = '1';
      saveLiftLog([ex]);
      await new Promise(z => setTimeout(z, 120));
      const row = STATE.liftLog[STATE.liftLog.length - 1];
      // second session: the sheet must hand back what was lifted last time
      openLiftLog(items);
      const prefill = document.querySelector('#lf-l-0').value;
      const hint = /last time/.test(document.body.innerText);
      closeSheet();
      // imperial round trip: stored canonical kg, shown in lb
      STATE.profile.unit = 'in';
      openLiftLog(items);
      const lbPrefill = parseFloat(document.querySelector('#lf-l-0').value);
      closeSheet(); STATE.profile.unit = 'cm';
      STATE.quickLog = JSON.parse(keepQ);
      return { before, row, prefill, hint, lbPrefill, trainedAfter: !!row };
    });
    t.ok('a first-time movement says so', r.before.prevHint, r.before);
    t.eq('nothing was logged before', r.before.rows, 0);
    t.eq('the load is stored canonically in kg', r.row.loadKg, 22.5);
    t.eq('the reps are stored', r.row.reps, 8);
    t.eq('the effort rating is stored', r.row.rir, 1);
    t.eq('next time the sheet hands the load back', r.prefill, '22.5');
    t.ok('and says it was last time', r.hint, r);
    t.ok('an imperial athlete sees pounds, not kilos', Math.abs(r.lbPrefill - 49.6) < 0.5, r);
  }
  {
    /* Entering in metric proves nothing about the conversion — loadToKg() is
       the identity there, so storing the raw display value looks identical.
       Enter in POUNDS, where a canonical store and a naive one differ. */
    const r = await page.evaluate(async () => {
      STATE.liftLog = []; STATE.profile.unit = 'in';
      const ex = Object.keys(EX).find(k => EX[k].equip && EX[k].equip.includes('dumbbell'));
      openLiftLog([{ exId: ex, unit: 'reps', target: 10 }]);
      document.querySelector('#lf-l-0').value = '100';    // 100 lb
      document.querySelector('#lf-r-0').value = '5';
      saveLiftLog([ex]);
      await new Promise(z => setTimeout(z, 120));
      const stored = STATE.liftLog[STATE.liftLog.length - 1].loadKg;
      openLiftLog([{ exId: ex, unit: 'reps', target: 10 }]);
      const back = parseFloat(document.querySelector('#lf-l-0').value);
      closeSheet(); STATE.profile.unit = 'cm';
      return { stored, back };
    });
    t.ok('100 lb is stored as ~45.4 kg, not as 100', Math.abs(r.stored - 45.4) < 0.3, r);
    t.ok('and reads back as ~100 lb', Math.abs(r.back - 100) < 0.5, r);
  }
  {
    // it credits the day without consuming a program session
    const r = await page.evaluate(async () => {
      // clear the program log too: earlier blocks in this suite commit sessions
      STATE.liftLog = []; STATE.quickLog = {}; STATE.logs = {}; STATE.runs = [];
      STATE.progressPtr = 7; save();
      const ex = Object.keys(EX).find(k => EX[k].equip && EX[k].equip.includes('dumbbell'));
      openLiftLog([{ exId: ex, unit: 'reps', target: 10 }]);
      document.querySelector('#lf-l-0').value = '20';
      document.querySelector('#lf-r-0').value = '10';
      saveLiftLog([ex]);
      await new Promise(z => setTimeout(z, 120));
      return { ptr: STATE.progressPtr, trained: trainedToday(),
        counted: sessionsDoneCount(), quick: Object.keys(STATE.quickLog).length };
    });
    t.eq('a weights session does not advance the programme', r.ptr, 7);
    t.ok('but it does count as having trained today', r.trained, r);
    t.eq('and it is not banked as a program session', r.counted, 0);
    t.eq('it credits the day once', r.quick, 1);
  }
  {
    // a junk row must not cost the whole history
    /* save() writes localStorage immediately but mirrors to IndexedDB 120ms
       later (see CLAUDE.md); reloading right after planting a value races
       that mirror, and load() prefers whichever copy has the fresher stamp.
       Beat it on its own terms, exactly like 05-state.test.mjs does. */
    await page.evaluate(async ([seed]) => {
      eval(seed)();
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      cur.liftLog = [
        { date: '2026-01-01', exId: 'dbpress', loadKg: 20, reps: 10, rir: 1 },
        { date: '2026-01-02', exId: 'dbpress', loadKg: 'heavy', reps: 'lots', rir: 99 },
        { date: '2026-01-03', exId: 'nosuchexercise', loadKg: 20 },
        null, 'junk',
      ];
      cur._savedAt = Date.now() + 5000;
      const json = JSON.stringify(cur);
      localStorage.setItem('coreforge.v1', json);
      await idbPut('coreforge.v1', json);
    }, [ATHLETE]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const r = await page.evaluate(() => ({
      kept: STATE.liftLog.length,
      good: STATE.liftLog[0],
      repaired: STATE.liftLog[1],
      types: STATE.liftLog.map(x => typeof x.reps),
      boundary: /went wrong drawing/i.test(document.body.innerText),
    }));
    t.eq('rows for real exercises survive, junk rows do not', r.kept, 2);
    t.eq('a good row is untouched', r.good.loadKg, 20);
    t.eq('a bad load is nulled, not dropped with the row', r.repaired.loadKg, null);
    t.eq('a bad rep count is nulled too', r.repaired.reps, null);
    t.eq('and a bad effort rating is nulled rather than clamped', r.repaired.rir, null);
    t.eq('every surviving row has a numeric-or-null reps field',
      r.types, ['number', 'object']);
    t.ok('and nothing hits the error boundary', !r.boundary, r);
  }

  /* ---- the weights circuit respects a flagged joint ----------------------
     weightsPool() filtered on EQUIPMENT and nothing else. With shoulder, knee,
     back and wrist flagged, 300 sampled circuits produced 17 distinct
     contraindicated movements — battle-rope waves in every single one,
     dumbbell shoulder press in 153, kettlebell clean-and-press in 147. The
     main program has run safeSwap since the beginning; this track never got
     it, the same gap the focus bonus had. */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ g: STATE.profile.gear, l: STATE.profile.limitations, t: STATE.profile.tightSpace });
      STATE.profile.gear = ['bar', 'bench', 'dip', 'dumbbell', 'kettlebell', 'medball', 'abroller', 'battlerope'];
      const sample = () => {
        const risky = {}; const seen = new Set(); let empty = 0;
        for (let i = 0; i < 120; i++) {
          const s = buildWeightsSession() || [];
          if (s.length < 3) empty++;
          s.forEach(m => { seen.add(m.exId); if (safeSwap(m.exId) !== m.exId) risky[m.exId] = (risky[m.exId] || 0) + 1; });
        }
        return { risky: Object.keys(risky), distinct: seen.size, empty };
      };
      STATE.profile.limitations = []; STATE.profile.tightSpace = false;
      const clean = sample();
      STATE.profile.limitations = ['shoulder', 'knee', 'back', 'wrist'];
      const flagged = sample();
      /* Owning EVERYTHING cannot catch a missing gear re-check — the swap can
         only land on kit you already have. The interesting athlete owns a
         little and has flagged joints, so a safe alternative may need kit that
         is not in the room. */
      const gearOk = (() => {
        const sets = [['dumbbell'], ['kettlebell'], ['bench'], ['dumbbell', 'bench']];
        for (const g of sets) {
          STATE.profile.gear = g;
          for (let i = 0; i < 40; i++) {
            const s = buildWeightsSession() || [];
            if (s.some(m => !hasGearFor(m.exId))) return { ok: false, gear: g, bad: s.filter(m => !hasGearFor(m.exId)).map(m => m.exId) };
          }
        }
        return { ok: true };
      })();
      const k = JSON.parse(keep);
      STATE.profile.gear = k.g; STATE.profile.limitations = k.l; STATE.profile.tightSpace = k.t;
      return { clean, flagged, gearOk };
    });
    t.eq('a clean athlete gets no contraindicated movement', r.clean.risky.length, 0);
    t.eq('and neither does one with four flagged joints', r.flagged.risky.length, 0);
    t.ok('the circuit is still built, not emptied by the filter',
      r.flagged.distinct >= 8 && r.flagged.empty === 0, r.flagged);
    t.ok('and never prescribes kit the athlete does not own', r.gearOk.ok, r.gearOk);
  }
  {
    /* The hasGearFor() guard in addItem cannot currently fail: every swap
       target that needs equipment needs the SAME equipment as its source, so
       owning the source implies owning the target. That makes the guard
       unreachable and its mutant equivalent — no runtime check can kill it.
       Pin the PROPERTY instead. The day someone adds a cross-equipment swap
       (kbswing -> dbrdl, say) this fires, and the guard starts earning its
       keep instead of silently becoming the only thing standing between the
       athlete and kit they do not own. */
    const r = await page.evaluate(() => {
      const need = k => ((EX[k] && EX[k].equip) || []).slice().sort().join(',');
      const bad = [];
      [['SAFE_SWAP', SAFE_SWAP], ['SPACE_SWAP', SPACE_SWAP]].forEach(([name, map]) => {
        Object.keys(map || {}).forEach(src => {
          const tgt = map[src];
          if (!EX[tgt]) { bad.push(`${name}: ${src} -> ${tgt} (no such exercise)`); return; }
          const extra = ((EX[tgt] && EX[tgt].equip) || []).filter(g => !((EX[src] && EX[src].equip) || []).includes(g));
          if (extra.length) bad.push(`${name}: ${src} (${need(src) || 'none'}) -> ${tgt} needs ${extra.join(',')}`);
        });
      });
      return { bad };
    });
    t.eq('no swap target needs equipment its source did not', r.bad, []);
  }

  /* ---- dumbbell and kettlebell full-body compounds ------------------------
     The weights library had exactly one genuine full-body compound per
     implement (dbthruster, kbcp) buried among single-pattern isolation moves
     (goblet squat, RDL, row, curl…). dbcp, dbmanmaker, dbdevil, kbsnatch,
     kbtgu and kbthruster round that out — real ground-to-overhead /
     loaded-hinge movements that train the body as one chain, not another
     accessory. dbcarry fills a plain coverage gap: a dumbbell-only athlete
     had no loaded carry at all, only kbcarry did.

     The generic "flagged joints" sample two blocks up proves the SWAP
     mechanism works for whatever IS flagged; it says nothing about whether
     THESE SEVEN were ever flagged in the first place. An exercise nobody
     added to JOINT_RISK never shows up in that sample's risky list, not
     because it is safe but because risky() was never asked about it — the
     same shape of gap that let dbpress and kbcp through 153 and 147
     contraindicated circuits before safeSwap covered this track at all.
     Assert JOINT_RISK membership directly, independent of the sample. */
  {
    const r = await page.evaluate(() => {
      const NEW = ['dbcp', 'dbmanmaker', 'dbdevil', 'dbcarry', 'kbsnatch', 'kbtgu', 'kbthruster'];
      const flaggedFor = k => Object.keys(JOINT_RISK).filter(j => JOINT_RISK[j].includes(k));
      const present = NEW.map(k => !!EX[k]);
      const equipOk = NEW.map(k => !!(EX[k] && EX[k].equip && EX[k].equip.length));
      const patternOk = NEW.map(k => !!(EX[k] && EX[k].pattern));
      const sameFamily = NEW.map(k => {
        const want = k[0] === 'k' ? 'kettlebell' : 'dumbbell';
        return !!(EX[k].equip && EX[k].equip.length === 1 && EX[k].equip[0] === want);
      });
      const flags = {}; NEW.forEach(k => { flags[k] = flaggedFor(k); });
      const keep = JSON.stringify({ g: STATE.profile.gear, l: STATE.profile.limitations });
      STATE.profile.gear = ['dumbbell', 'kettlebell'];
      const swaps = {}; const landsSafe = {}; const staysInFamily = {};
      const risky = j => (STATE.profile.limitations || []).some(l => (JOINT_RISK[l] || []).includes(j));
      NEW.forEach(k => {
        // an unflagged movement (dbcarry) is legitimately never risky —
        // fall back to 'shoulder' just so the swap path still runs on it
        STATE.profile.limitations = flags[k].length ? flags[k] : ['shoulder'];
        swaps[k] = safeSwap(k);
        landsSafe[k] = !risky(swaps[k]);
        const want = k[0] === 'k' ? 'kettlebell' : 'dumbbell';
        staysInFamily[k] = !!(EX[swaps[k]] && EX[swaps[k]].equip && EX[swaps[k]].equip.includes(want));
      });
      // in an unflagged pool, every one of them is reachable — the reverse
      // of the point above: a movement that IS safe must not be swapped away
      STATE.profile.limitations = [];
      const pool = weightsPool();
      const inPool = NEW.map(k => pool.includes(k));
      const seen = new Set();
      for (let i = 0; i < 80; i++) (buildWeightsSession() || []).forEach(m => seen.add(m.exId));
      const everAppears = NEW.map(k => seen.has(k));
      const k2 = JSON.parse(keep);
      STATE.profile.gear = k2.g; STATE.profile.limitations = k2.l;
      return { present, equipOk, patternOk, sameFamily, flags, landsSafe, staysInFamily, inPool, everAppears };
    });
    t.ok('all seven new compounds exist', r.present.every(Boolean), r.present);
    t.ok('each carries equip', r.equipOk.every(Boolean), r.equipOk);
    t.ok('each carries a pattern (equip without pattern is unreachable in the circuit)', r.patternOk.every(Boolean), r.patternOk);
    t.ok('each is tagged to its own implement only, not mixed', r.sameFamily.every(Boolean), r.sameFamily);
    t.ok('dbcp is flagged shoulder + lowback (loaded floor clean to overhead)',
      r.flags.dbcp.includes('shoulder') && r.flags.dbcp.includes('lowback'), r.flags.dbcp);
    t.ok('dbmanmaker is flagged shoulder + lowback + wrist (plank, clean and overhead in one)',
      ['shoulder', 'lowback', 'wrist'].every(j => r.flags.dbmanmaker.includes(j)), r.flags.dbmanmaker);
    t.ok('dbdevil is flagged shoulder + lowback + wrist (burpee into a double overhead snatch)',
      ['shoulder', 'lowback', 'wrist'].every(j => r.flags.dbdevil.includes(j)), r.flags.dbdevil);
    t.eq('dbcarry carries no joint flag, matching kbcarry\'s precedent', r.flags.dbcarry, []);
    t.ok('kbsnatch is flagged shoulder + lowback (ballistic hip-to-overhead)',
      r.flags.kbsnatch.includes('shoulder') && r.flags.kbsnatch.includes('lowback'), r.flags.kbsnatch);
    t.ok('kbtgu is flagged shoulder (locked overhead through the whole rep)',
      r.flags.kbtgu.includes('shoulder'), r.flags.kbtgu);
    t.ok('kbthruster is flagged shoulder + lowback (mirrors dbthruster)',
      r.flags.kbthruster.includes('shoulder') && r.flags.kbthruster.includes('lowback'), r.flags.kbthruster);
    t.ok('every flagged one swaps to something that clears the flag', Object.values(r.landsSafe).every(Boolean), r.landsSafe);
    t.ok('and the swap stays on kit the athlete still owns', Object.values(r.staysInFamily).every(Boolean), r.staysInFamily);
    t.ok('all seven are reachable in the pool when nothing is flagged', r.inPool.every(Boolean), r.inPool);
    t.ok('and all seven actually turn up in the circuit, not just the pool', r.everAppears.every(Boolean), r.everAppears);
  }

  /* ---- the weights track shares the program's deload/readiness clock -----
     buildWeightsSession() credits the day and builds a real circuit but ran
     on its own clock entirely — no deloadOn(), no readinessMult(). An
     athlete in a genuine 3-day slump, or one who logged a poor readiness
     score TODAY, got full-intensity dumbbell work on the exact day the main
     program would have eased both sets and reps. deloadOn() with no pos
     falls back to the readiness-slump check only, since a bonus session has
     no calendar week — the one signal here that is position-independent.
     Both signals are independent (same as prescribe()'s own two separate
     `if` cuts) and must be provably independent here too: a real deload
     week is not the only way to trigger either one. */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ g: STATE.profile.gear, rd: STATE.readiness || null });
      STATE.profile.gear = ['dumbbell', 'kettlebell', 'bar', 'bench', 'dip'];
      delete STATE.readiness;
      const setsAcross = n => { const out = []; for (let i = 0; i < n; i++) { const s = buildWeightsSession(); if (s && s.length) out.push(s.map(x => x.sets)); } return out; };

      const clean = setsAcross(15);
      const repsClean = weightsRepsFor('dbgoblet');

      // isolated deload (slump): today's OWN score stays high, only the 3-day average is low
      STATE.readiness = {};
      const d0 = new Date();
      STATE.readiness[localISO(d0)] = { score: 90, sleep: 3, sore: 3, energy: 3 };
      for (let i = 1; i < 3; i++) { const d = new Date(); d.setDate(d.getDate() - i);
        STATE.readiness[localISO(d)] = { score: 25, sleep: 1, sore: 1, energy: 1 }; }
      const deloadGuard = { slump: readinessSlump(), deloadNoPos: deloadOn(), multToday: readinessMult() };
      const deloadOnly = setsAcross(15);
      const repsDeloadOnly = weightsRepsFor('dbgoblet');   // readinessMult() is 1.0 here — only the deload cut can move this
      delete STATE.readiness;

      // isolated readiness: no slump, just a poor score today
      STATE.readiness = { [todayISO()]: { score: 25, sleep: 1, sore: 1, energy: 1 } };
      const readinessGuard = { slump: readinessSlump(), deloadNoPos: deloadOn() };
      const readinessOnly = setsAcross(15);
      const repsReadinessOnly = weightsRepsFor('dbgoblet');   // deloadOn() is false here — only the readiness cut can move this
      delete STATE.readiness;

      // both at once: a slump AND a poor score today should stack, same as prescribe()
      STATE.readiness = {};
      for (let i = 0; i < 3; i++) { const d = new Date(); d.setDate(d.getDate() - i);
        STATE.readiness[localISO(d)] = { score: 25, sleep: 1, sore: 1, energy: 1 }; }
      const bothGuard = { slump: readinessSlump(), multToday: readinessMult() };
      const both = setsAcross(15);
      delete STATE.readiness;

      // timed items (kbswing etc.) went through raw ex.base with no easing at all
      const timedClean = weightsTargetFor('kbswing');
      STATE.readiness = { [todayISO()]: { score: 25, sleep: 1, sore: 1, energy: 1 } };
      const timedEased = weightsTargetFor('kbswing');

      const k = JSON.parse(keep);
      STATE.profile.gear = k.g; STATE.readiness = k.rd;
      return { clean, repsClean, deloadGuard, deloadOnly, repsDeloadOnly, readinessGuard, readinessOnly, repsReadinessOnly, bothGuard, both, timedClean, timedEased };
    });
    t.ok('a clean athlete keeps a full 3 sets', r.clean.every(arr => arr.every(x => x === 3)), r.clean);
    t.ok('guard: the deload-only scenario is really a slump, not a readiness cut',
      r.deloadGuard.slump && r.deloadGuard.deloadNoPos && r.deloadGuard.multToday >= 1, r.deloadGuard);
    t.ok('a real slump alone cuts exactly one set', r.deloadOnly.every(arr => arr.every(x => x === 2)), r.deloadOnly);
    t.ok('and the deload cut also lowers the REP target itself, not just sets', r.repsDeloadOnly < r.repsClean, { repsClean: r.repsClean, repsDeloadOnly: r.repsDeloadOnly });
    t.ok('guard: the readiness-only scenario has no slump behind it',
      !r.readinessGuard.slump && !r.readinessGuard.deloadNoPos, r.readinessGuard);
    t.ok('poor readiness alone (no slump) also cuts exactly one set', r.readinessOnly.every(arr => arr.every(x => x === 2)), r.readinessOnly);
    t.ok('and the readiness cut also lowers the REP target itself, not just sets', r.repsReadinessOnly < r.repsClean, { repsClean: r.repsClean, repsReadinessOnly: r.repsReadinessOnly });
    t.ok('guard: the stacked scenario really is both a slump and a poor day', r.bothGuard.slump && r.bothGuard.multToday < 0.85, r.bothGuard);
    t.ok('both signals together cut two sets, not one — they stack like prescribe()\'s own do', r.both.every(arr => arr.every(x => x === 1)), r.both);
    t.ok('a timed weights item is eased by poor readiness too, not just rep-based ones', r.timedEased < r.timedClean, { timedClean: r.timedClean, timedEased: r.timedEased });
  }

  /* ---- Special HIIT respects the same flags as everything else -----------
     HIIT_POOL is a flat literal and startHiitSpecial() used it RAW.
     startHiit() goes through buildSession() and was fine; this path was not,
     so with a joint flagged 9 of the 11 movements came through
     contraindicated. The comment on quickExId() named HIIT_POOL as needing
     the swap and only QUICKIES ever received it. Warm-up and cool-down were
     checked at the same time and are clean — nothing in them is swappable. */
  {
    const r = await page.evaluate(seed => {
      /* Reseed. Earlier blocks in this suite reload the page and leave STATE
         wherever they finished, and the first version of this check found the
         flags simply not taking — it passed with the swap removed. A block
         builds the state it asserts on. */
      eval(seed)();
      const keep = JSON.stringify({ l: STATE.profile.limitations, t: STATE.profile.tightSpace });
      /* Read INTV, the state the app actually runs from. Monkeypatching
         window._runHiit looked like it worked — the clean list came back with
         eleven entries — but the flagged lists came back safe with the swap
         REMOVED, which means the patch was not intercepting the real call.
         The sequence the athlete would perform is the honest output. */
      const build = () => {
        try { startHiitSpecial('classic'); } catch (e) { return []; }
        const seq = (typeof INTV === 'object' && INTV && INTV.seq) || [];
        const ids = [...new Set(seq.map(x => x && x.exId).filter(Boolean))];
        try { ivClear(); document.querySelector('#hiit').classList.remove('open');
          document.body.style.overflow = ''; } catch (e) {}
        return ids;
      };
      const unsafe = l => l.filter(k => safeSwap(k) !== k || spaceSwap(k) !== k);
      /* Score each list WHILE its flags are still set. The first version
         collected the lists here and called unsafe() down in the return
         statement — by which point the flags had been restored, so safeSwap()
         compared against no injuries and every list read clean. The checks
         passed with the swap removed, twice, before this was spotted. */
      STATE.profile.limitations = []; STATE.profile.tightSpace = false;
      const clean = build();
      STATE.profile.limitations = ['knee'];
      const knee = build(), kneeBad = unsafe(knee);
      STATE.profile.limitations = ['shoulder', 'knee', 'back', 'wrist'];
      const many = build(), manyBad = unsafe(many);
      STATE.profile.limitations = []; STATE.profile.tightSpace = true;
      const tight = build(), tightBad = unsafe(tight);
      // the flows, checked in the same breath
      STATE.profile.limitations = ['shoulder', 'knee', 'back', 'wrist', 'neck', 'hip'];
      const flows = unsafe([...WARMUP, ...COOLDOWN]);
      const k = JSON.parse(keep);
      STATE.profile.limitations = k.l; STATE.profile.tightSpace = k.t;
      return { cleanN: clean.length, kneeBad, manyBad,
        manyN: many.length, tightBad,
        dupes: many.length !== new Set(many).size, flows,
        // guard: prove the flag actually bites, or the checks above are vacuous
        swapLive: (STATE.profile.limitations = ['knee'], safeSwap('tuckjump') !== 'tuckjump') };
    }, ATHLETE);
    t.ok('guard: a flagged knee really does make a jump unsafe', r.swapLive, r);
    t.ok('a clean athlete still gets the full interval list', r.cleanN >= 10, r);
    t.eq('one flagged joint yields no contraindicated interval', r.kneeBad, []);
    t.eq('four flagged joints yield none either', r.manyBad, []);
    t.ok('and a session is still built rather than emptied', r.manyN >= 3, r);
    t.eq('a tight room yields no travelling movement', r.tightBad, []);
    t.ok('two pool entries collapsing on one alternative do not repeat it', !r.dupes, r);
    t.eq('warm-up and cool-down carry nothing contraindicated', r.flows, []);
  }

  /* ---- the single-movement formats warn instead of pretending -----------
     Finishing the sibling-path audit. QUICKIES came back clean on both filters
     (23 movements, zero unsafe). SPECIAL_FORMATS did not: every grip format
     hard-codes deadhang, which safeSwap routes around for a flagged shoulder,
     elbow or wrist.

     This one does NOT get a silent swap. A hang session IS the hang — handing
     back a different movement while still calling it "Hangs 30s x 5" is not a
     safety control, it is a lie about what the athlete chose. They get a
     warning and keep the decision. */
  {
    const r = await page.evaluate(seed => {
      eval(seed)();
      const read = () => {
        let txt = '';
        /* openGrip(), not openSpecial() — the latter is the chooser between
           ruck/grip/boxing and never renders the hang sets. The first version
           of this block read the wrong sheet and failed on both counts. */
        try { openGrip(); txt = document.body.innerText; } catch (e) { txt = 'THREW ' + e; }
        try { closeSheet(); } catch (e) {}
        return txt;
      };
      STATE.profile.limitations = [];
      const clean = read();
      STATE.profile.limitations = ['shoulder', 'wrist'];
      const flagged = read();
      // and the quick workouts, which came back clean — pin that they stay clean
      const qIds = [...new Set((QUICKIES || []).flatMap(q => (q.items || []).map(i => i.exId)))].filter(k => EX[k]);
      const quickBad = qIds.filter(k => safeSwap(quickExId(k)) !== quickExId(k));
      STATE.profile.limitations = [];
      return { cleanWarns: /flagged a joint/i.test(clean),
        flaggedWarns: /flagged a joint/i.test(flagged),
        stillOffersHangs: /Hangs 30s/.test(flagged),
        quickBad, quickTotal: qIds.length };
    }, ATHLETE);
    t.ok('a clean athlete sees no warning on the hang sets', !r.cleanWarns, r);
    t.ok('a flagged shoulder or wrist does', r.flaggedWarns, r);
    t.ok('but the session is still offered — the athlete keeps the choice', r.stillOffersHangs, r);
    t.eq('and no quick workout hands out a contraindicated movement', r.quickBad, []);
    t.ok('across every movement the quick workouts use', r.quickTotal >= 20, r);
  }

  /* ---- the custom workout builder was the fourth sibling path -----------
     builderPool() filters by gear the same way the main program does, but
     never checked safeSwap() — an athlete could tap a shoulder-risky dip or a
     wrist-risky push-up into their own session with the joint flagged and see
     nothing. Same call as grip/box above: warn, do not silently swap, because
     the athlete built this list on purpose. And starting a SAVED favorite
     used to skip the builder screen entirely and drop straight into the
     player — the one place the warning could never be seen at all. */
  {
    const r = await page.evaluate(seed => {
      eval(seed)();
      STATE.profile.limitations = ['shoulder', 'wrist'];
      // a movement JOINT_RISK actually flags for this profile, and one it does not
      const risky = Object.keys(EX).find(k => safeSwap(k) !== k && builderPool().includes(k));
      const safe = Object.keys(EX).find(k => safeSwap(k) === k && builderPool().includes(k));
      const out = { risky, safe };
      /* Guard BEFORE touching addCustom/startFav — both assume a real exId, and
         a mutant that makes builderPool() hide every risky move (the wrong fix:
         hide, not warn) leaves `risky` undefined. Feeding that into the render
         path threw inside a template literal that the render error boundary
         then retried forever, hanging the check instead of failing it. Bail out
         with the same shape the assertions below already expect. */
      if (!risky || !safe) { STATE.profile.limitations = []; return out; }

      // ---- the pool itself never drops a risky move — it warns, it doesn't hide it
      out.poolHasRisky = builderPool().includes(risky);

      // ---- the builder screen: adding a risky move surfaces the warning
      _custom = [];
      addCustom(risky);
      out.warnsOnRisky = /flagged a joint/i.test(document.body.innerText);
      /* The pool chip below ALSO carries the same ⚠️ + name text, so a plain
         .includes() on the risky move's marked form passes whether or not the
         "Your session" ROW is marked — it is just matching the unrelated chip.
         Scope to that row specifically. .kv also appears in other mounted
         views (CLAUDE.md: views never clear innerHTML), so scope to #sheet too. */
      const rowText = k => { const row = [...document.querySelectorAll('#sheet .kv')]
        .find(el => el.textContent.includes(EX[k].name)); return row ? row.textContent : ''; };
      out.riskyRowMarked = rowText(risky).includes('⚠️');
      _custom = [];
      addCustom(safe);
      out.silentOnSafe = !/flagged a joint/i.test(document.body.innerText);
      out.safeRowUnmarked = rowText(safe).includes(EX[safe].name) && !rowText(safe).includes('⚠️');
      _custom = [];
      try { closeSheet(); } catch (e) {}

      // ---- a favorite saved before the flag existed still warns when started
      STATE.customFav = STATE.customFav || [];
      STATE.customFav.push({ name: 'Old favorite', items: [risky, safe] });
      const favIdx = STATE.customFav.length - 1;
      startFav(favIdx);
      out.favRoutesToBuilder = /flagged a joint/i.test(document.body.innerText);
      out.favDidNotJumpToPlayer = !document.getElementById('player').classList.contains('open');
      try { closeSheet(); } catch (e) {}

      // ---- a clean favorite (nothing flagged) still starts in one tap — no added friction
      STATE.customFav.push({ name: 'Clean favorite', items: [safe] });
      const cleanIdx = STATE.customFav.length - 1;
      startFav(cleanIdx);
      out.cleanFavStartsPlayer = document.getElementById('player').classList.contains('open');
      try { document.getElementById('player').classList.remove('open'); PLAYER = null; } catch (e) {}
      try { closeSheet(); } catch (e) {}

      STATE.customFav = [];
      STATE.profile.limitations = [];
      return out;
    }, ATHLETE);
    t.ok('guard: a flagged shoulder+wrist really does mark a builder move risky', !!r.risky, r);
    t.ok('guard: and leaves at least one move clear', !!r.safe, r);
    t.ok('the pool still offers the risky move — informed, not blocked', r.poolHasRisky, r);
    t.ok('adding it to a custom session warns', r.warnsOnRisky, r);
    t.ok('and marks that row with a warning icon', r.riskyRowMarked, r);
    t.ok('adding a clear move does not', r.silentOnSafe, r);
    t.ok('and leaves that row unmarked', r.safeRowUnmarked, r);
    t.ok('starting a favorite that carries a flagged move opens the builder, warning shown', r.favRoutesToBuilder, r);
    t.ok('rather than dropping straight into the player', r.favDidNotJumpToPlayer, r);
    t.ok('a favorite with nothing flagged still starts in one tap', r.cleanFavStartsPlayer, r);
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
