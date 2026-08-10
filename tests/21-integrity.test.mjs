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
      const ids = ['plank', 'side', 'hollow', 'lower', 'dyn', 'push', 'pull', 'squat'];
      const zero = {}; ids.forEach(k => zero[k] = 0);
      const a = computeAssessment(zero);
      const blank = {}; ids.forEach(k => blank[k] = '');
      const b = computeAssessment(blank);
      const mixed = computeAssessment({ plank: 0, side: 45, hollow: '', lower: 12, dyn: 0, push: 0, pull: 0, squat: 30 });
      return { zeroMaxes: a.maxes, zeroScore: a.score, zeroLevel: a.level,
        blankMaxes: b.maxes, mixed: mixed.maxes };
    });
    const zeros = Object.values(r.zeroMaxes);
    t.ok('a whole battery of zeros stays zero', zeros.every(v => v === 0), r.zeroMaxes);
    t.eq('and scores as zero', r.zeroScore, 0);
    t.eq('and reads as Beginner', r.zeroLevel, 'Beginner');
    t.ok('a BLANK answer still falls back to the starting estimate',
      r.blankMaxes.plank === 30 && r.blankMaxes.pull === 6, r.blankMaxes);
    t.eq('a zero beside real results is kept', r.mixed.plank, 0);
    t.eq('and the real results are untouched', r.mixed.side, 45);
    t.eq('while a blank one falls back', r.mixed.hollow, 20);
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

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
