/* Suite 10 — pre-launch gates.
   These come from a QA pass run the way a paid consumer fitness app is treated
   before it goes on sale: a device matrix, the first-run funnel driven by real
   clicks, lifecycle and hostile input, and a performance budget. Every check
   here failed at least once against a shipped build. */
import { serve, launch, seedAthlete, suite, waitForBoot, ROOT } from './lib/harness.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export default async function run() {
const s = suite('launch gates');
const { srv, port } = await serve();
const base = `http://127.0.0.1:${port}/`;
const { browser, page, errors } = await launch(port);

/* ============ A. safety: an unanswered health screen is not a clean one ==== */
{
  await seedAthlete(page);
  const r = await page.evaluate(() => {
    const out = {};
    // the realistic shape: a backup from an older build, or hand-edited JSON
    delete STATE.profile.parq;
    STATE.profile.parqDone = true; STATE.profile.medCleared = false;
    normalizeState();
    out.missing = { parqDone: parqDone(), safeMode: safeMode(), isArray: Array.isArray(STATE.profile.parq) };
    STATE.profile.parq = null; STATE.profile.parqDone = true;
    normalizeState();
    out.nulled = { parqDone: parqDone(), safeMode: safeMode() };
    STATE.profile.parq = 'yes'; STATE.profile.parqDone = true;
    normalizeState();
    out.stringy = { parqDone: parqDone(), safeMode: safeMode() };
    // and the honest all-clear must still work
    STATE.profile.parq = []; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
    normalizeState();
    out.genuinelyClear = { parqDone: parqDone(), safeMode: safeMode() };
    // a real flag with no clearance stays locked
    STATE.profile.parq = ['heart']; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
    normalizeState();
    out.flagged = { safeMode: safeMode() };
    return out;
  });
  s.ok('missing parq is not treated as answered', r.missing.parqDone === false, r.missing);
  s.ok('missing parq keeps safe mode ON', r.missing.safeMode === true, r.missing);
  s.ok('missing parq is repaired to an array', r.missing.isArray === true, r.missing);
  s.ok('null parq keeps safe mode ON', r.nulled.safeMode === true, r.nulled);
  s.ok('non-array parq keeps safe mode ON', r.stringy.safeMode === true, r.stringy);
  s.ok('a genuine all-clear still unlocks', r.genuinelyClear.parqDone === true && r.genuinelyClear.safeMode === false, r.genuinelyClear);
  s.ok('a declared flag without clearance stays locked', r.flagged.safeMode === true, r.flagged);

  /* Defence in depth, tested on its own. normalizeState repairs the state, so
     with that fix in place the predicate hardening is invisible through the
     normal path — a mutation that reverted parqDone() alone survived the checks
     above. These call the predicate directly, without a repair pass, which is
     the layer that has to hold if anything ever reads STATE before boot
     finishes normalising it. */
  const direct = await page.evaluate(() => {
    const out = {};
    STATE.profile.parq = []; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
    normalizeState();                       // a clean, repaired baseline
    out.clean = { done: parqDone(), safe: safeMode() };
    delete STATE.profile.parq;              // corrupt AFTER the repair pass
    out.missing = { done: parqDone(), safe: safeMode(), flags: parqFlags().length };
    STATE.profile.parq = null;
    out.nulled = { done: parqDone(), safe: safeMode() };
    STATE.profile.parq = 'yes';
    out.stringy = { done: parqDone(), safe: safeMode() };
    STATE.profile.parq = { heart: true };   // an object is not an answer list
    out.objecty = { done: parqDone(), safe: safeMode() };
    return out;
  });
  s.ok('baseline for the direct check is genuinely unlocked', direct.clean.done === true && direct.clean.safe === false, direct.clean);
  s.ok('parqDone() alone rejects a missing answer list', direct.missing.done === false, direct.missing);
  s.ok('safeMode() alone stays ON for a missing answer list', direct.missing.safe === true, direct.missing);
  s.ok('parqDone() alone rejects null', direct.nulled.done === false, direct.nulled);
  s.ok('parqDone() alone rejects a string', direct.stringy.done === false, direct.stringy);
  s.ok('parqDone() alone rejects an object', direct.objecty.done === false, direct.objecty);
}

/* ============ B. a corrupt max must never reach the athlete as NaN ========= */
{
  const r = await page.evaluate(() => {
    const out = {};
    STATE.profile.parq = []; STATE.profile.parqDone = true;
    // present-but-invalid values used to WIN over estimateMaxes' defaults
    STATE.baseline = { date: todayISO(), score: 97, level: 'Advanced', testCount: 8,
      maxes: { plank: 'abc', push: null, pull: -5, hollow: NaN, side: 95, lower: 30, squat: 62, dyn: 55 } };
    normalizeState();
    const m = currentMaxes(0);
    out.maxes = m;
    out.allFinitePositive = Object.values(m).every(v => typeof v === 'number' && isFinite(v) && v > 0);
    out.keptGoodValues = m.side === 95 && m.squat === 62;
    const sess = buildSession(0);
    const items = [...sess.main, sess.finisher];
    out.badTargets = items.filter(x => !(typeof x.target === 'number' && isFinite(x.target) && x.target > 0)).length;
    out.vol = sessionVolume(sess);
    // a wholly corrupt maxes object must fall all the way back, not crash
    STATE.baseline.maxes = 'nope'; normalizeState();
    const m2 = currentMaxes(0);
    out.stringMaxesFinite = Object.values(m2).every(v => isFinite(v) && v > 0);
    go('today'); render();
    return out;
  });
  s.ok('every derived max is a finite positive number', r.allFinitePositive, r.maxes);
  s.ok('valid maxes survive the sanitiser', r.keptGoodValues, r.maxes);
  s.eq('no session target is NaN/null', r.badTargets, 0);
  s.ok('session duration is a real number', typeof r.vol.minutes === 'number' && isFinite(r.vol.minutes) && r.vol.minutes > 0, r.vol);
  s.ok('maxes as a bare string still yields finite maxes', r.stringMaxesFinite, {});
  const screen = await page.evaluate(() => [...document.querySelectorAll('.view.active')].map(v => v.textContent).join(' '));
  s.ok('no "NaN" rendered on Today', !/NaN|Infinity/.test(screen), screen.slice(0, 200));
}

/* ============ B2. a genuine ZERO baseline must not become a fake default ==== */
/* computeAssessment() was already fixed for this exact class of bug
   (+results.plank||30 silently replacing an honest zero) — estimateMaxes(),
   one function downstream, had the identical mistake: v>0 (not v>=0) dropped
   a legitimate "couldn't hold the plank at all" 0 from the sanitiser, and a
   second `||` on the very next line would have re-broken it even with the
   sanitiser fixed. An athlete who scores 0 must be prescribed EASIER than the
   defaults, never AS IF they'd scored the default. */
{
  const r = await page.evaluate(() => {
    STATE.profile.parq = []; STATE.profile.parqDone = true;
    // push/pull/squat deliberately OMITTED so estimateMaxes() must derive them
    // from the plank-anchored `s` scale — including push here would let the
    // input value pass straight through Object.assign and the check would
    // never actually exercise the scale formula the `||` bug lives in.
    STATE.baseline = { date: todayISO(), score: 10, level: 'Beginner', testCount: 8,
      maxes: { plank: 0, hollow: 5, side: 8, lower: 2, dyn: 4 } };
    normalizeState();
    const m = currentMaxes(0);
    go('today'); render();
    const screen = [...document.querySelectorAll('.view.active')].map(v => v.textContent).join(' ');
    return { m, noNaN: !/NaN|Infinity/.test(screen) };
  });
  s.eq('a genuine zero-second plank is stored as 0, not defaulted to 40', r.m.plank, 0, r.m);
  // correct: s clamps to the 0.5 floor -> push=round(12*0.5)=6. Buggy `||40`
  // fallback: s=40/60=0.667 -> push=round(12*0.667)=8. The strict "<6" (not
  // "<=6") is deliberate so the floor value itself still counts as a pass.
  s.ok('the derived push/pull/squat scale is pulled toward the FLOOR by a real zero plank, not the 40s default\'s scale', r.m.push < 7, r.m);
  s.eq('push lands exactly at the 0.5-floor value, not the ~0.67 the ||40 bug would produce', r.m.push, 6, r.m);
  s.ok('nothing renders NaN/Infinity from a zero-anchored scale', r.noNaN, r);
}

/* ============ C. the first-run funnel gates its required fields ============ */
{
  const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p2.goto(base, { waitUntil: 'networkidle' }); await waitForBoot(p2);
  const blank = await p2.evaluate(async () => {
    const out = { steps: [], blocked: false };
    for (let i = 0; i < 12; i++) {
      const lbl = document.querySelector('#ob-steplbl'); const before = lbl ? lbl.textContent : '';
      const btn = document.querySelector('#ob-next'); if (!btn) break;
      btn.click(); await new Promise(r => setTimeout(r, 50));
      const after = document.querySelector('#ob-steplbl');
      if (after && after.textContent === before) { out.blocked = true; out.stuckAt = before; break; }
      out.steps.push(before);
    }
    out.onboarded = !!STATE.onboarded;
    out.marked = !!document.querySelector('#ob-age.bad, #ob-height.bad, #ob-weight.bad');
    return out;
  });
  s.ok('a blank wizard cannot be tapped through', blank.blocked === true, blank);
  s.ok('a blank wizard does not complete onboarding', blank.onboarded === false, blank);
  s.ok('the blocking field is visibly marked', blank.marked === true, blank);

  const ranges = await p2.evaluate(async () => {
    const put = (id, v) => { const e = document.querySelector('#' + id); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); };
    const tryNext = () => { const l = document.querySelector('#ob-steplbl').textContent; document.querySelector('#ob-next').click(); return document.querySelector('#ob-steplbl').textContent !== l; };
    const out = {};
    put('ob-age', 5); put('ob-height', 178); put('ob-weight', 86); out.childAge = tryNext();
    put('ob-age', 38); put('ob-height', 12); out.absurdHeight = tryNext();
    put('ob-height', 178); put('ob-weight', 900); out.absurdWeight = tryNext();
    put('ob-weight', 86); out.validAdvances = tryNext();
    return out;
  });
  s.ok('an implausible age is rejected', ranges.childAge === false, ranges);
  s.ok('an implausible height is rejected', ranges.absurdHeight === false, ranges);
  s.ok('an implausible weight is rejected', ranges.absurdWeight === false, ranges);
  s.ok('plausible values advance the wizard', ranges.validAdvances === true, ranges);

  /* imperial input must be validated in imperial, not read as metric */
  const imp = await p2.evaluate(async () => {
    const im = [...document.querySelectorAll('#ob-unit button')].find(b => b.dataset.u === 'in');
    if (!im) return { skip: true };
    im.click();
    const put = (id, v) => { const e = document.querySelector('#' + id); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); };
    const lbl = () => document.querySelector('#ob-steplbl').textContent;
    put('ob-age', 38); put('ob-height', 70); put('ob-weight', 190);   // 5'10", 190 lb — a real person
    const b = lbl(); document.querySelector('#ob-next').click();
    return { advanced: lbl() !== b };
  });
  if (!imp.skip) s.ok('a valid imperial body advances (70 in / 190 lb is not "too small")', imp.advanced === true, imp);

  /* ---- the message has to name the mistake, not restate the range --------
     Reported from the phone: an athlete who is 5'10" typed 178 — their height
     in CENTIMETRES — into a box set to inches. The app correctly refused it
     and said "47-91", which is true and names nothing; the number they needed
     was 70 and nothing on screen said so. Read the toast the app actually
     shows, not obStepError()'s return value — a message that never reaches
     the screen is not a message. */
  /* On its OWN page: the block above advanced the wizard past step 1, and
     step 1 is the only step that validates these fields — so tapping Next
     here would have gated a different step entirely and every toast came back
     empty. What the block before you left on screen is not a contract. */
  const p2b = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p2b.goto(base, { waitUntil: 'networkidle' }); await waitForBoot(p2b);
  const hint = await p2b.evaluate(async () => {
    const seen = [];
    const realToast = window.toast;
    window.toast = m => { seen.push(String(m)); };
    const put = (id, v) => { const e = document.querySelector('#' + id); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); };
    const unit = u => { const b = [...document.querySelectorAll('#ob-unit button')].find(x => x.dataset.u === u); if (b) b.click(); };
    /* A tap that PASSES advances the wizard, and step 1 is the only step that
       validates these fields — so every case after the first success was
       silently gating step 2 and came back with no toast at all. Walk back to
       step 1 after each tap, and report the step we were actually on. */
    const step = () => document.querySelector('#ob-steplbl').textContent;
    const tap = () => {
      seen.length = 0;
      const was = step();
      document.querySelector('#ob-next').click();
      const moved = step() !== was;
      if (moved) { const b = document.querySelector('#ob-back'); if (b) b.click(); }
      return { msg: seen.join(' | '), advanced: moved, on: was };
    };
    const out = {};
    unit('in');
    put('ob-age', 47); put('ob-weight', 190);
    put('ob-height', 178); out.cmInInches = tap();       // the reported case
    put('ob-height', 12);  out.justWrong = tap();        // not a unit mix-up
    unit('cm');
    put('ob-weight', 86);
    put('ob-height', 70);  out.inchesInCm = tap();       // the mirror image
    /* The sibling that does NOT error on its own: 86 is inside the legal
       66-550 lb range, so it advanced silently and every calorie number below
       was built from 39 kg. */
    unit('in');
    put('ob-height', 70); put('ob-weight', 86); out.kgInPounds = tap();
    put('ob-weight', 190); out.realBodyOk = tap();
    /* The gate's EDGES, not just its middle. A cross-check like this earns its
       keep only if it cannot fire on a real person, and 190 lb at 5'10" (BMI
       27) sits so far inside that a floor moved up to 20 or a ceiling moved
       down to 40 would never be noticed — that mutant escaped. These two are
       lean and heavy real bodies, and both must pass untouched. */
    put('ob-height', 70); put('ob-weight', 132); out.leanBodyOk = tap();   // BMI 18.9
    put('ob-height', 70); put('ob-weight', 300); out.heavyBodyOk = tap();  // BMI 43.0
    window.toast = realToast;
    return out;
  });
  s.ok('the reported case names centimetres', /centimet/i.test(hint.cmInInches.msg), hint);
  s.ok('and gives the number to type instead', /\b70\b/.test(hint.cmInInches.msg), hint);
  /* A wrong number that is NOT a unit mix-up must not be told it is one. */
  s.ok('a plainly wrong height gets the range and no false explanation',
    /47/.test(hint.justWrong.msg) && !/centimet|inches that is/i.test(hint.justWrong.msg), hint);
  s.ok('the mirror image names inches', /inches/i.test(hint.inchesInCm.msg), hint);
  s.ok('and converts it', /\b178\b/.test(hint.inchesInCm.msg), hint);
  /* Only the PAIR is wrong here — 86 lb is a legal number on its own. */
  s.ok('a weight in the wrong unit is caught against the height',
    /does not add up/i.test(hint.kgInPounds.msg), hint);
  s.ok('and says what to type instead', /\b190\b/.test(hint.kgInPounds.msg), hint);
  s.ok('a real body still passes silently and advances', hint.realBodyOk.msg === '' && hint.realBodyOk.advanced, hint);
  s.ok('a lean real athlete is not accused of a typo (BMI 18.9)', hint.leanBodyOk.msg === '' && hint.leanBodyOk.advanced, hint);
  s.ok('nor a heavy one (BMI 43.0)', hint.heavyBodyOk.msg === '' && hint.heavyBodyOk.advanced, hint);
  /* Guard: an empty toast on every case would satisfy the two negative checks
     above on nothing at all, which is exactly how this block first failed. */
  /* Guard, widened after the first version of it missed exactly this: assert
     EVERY case was taken on step 1. A tap on any later step produces no toast,
     which satisfies each negative check on nothing. */
  s.ok('guard: every case was taken on the step that validates these fields',
    Object.values(hint).every(x => x && x.on === hint.cmInInches.on), hint);
  s.ok('guard: the rejected cases really did produce a message',
    hint.cmInInches.msg !== '' && hint.justWrong.msg !== '' && hint.kgInPounds.msg !== '', hint);
  s.ok('guard: and the rejected cases did not advance',
    !hint.cmInInches.advanced && !hint.justWrong.advanced && !hint.kgInPounds.advanced, hint);
  await p2b.close();
  await p2.close();
}

/* ============ D. a session killed by the phone can be resumed ============== */
{
  const p3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p3.goto(base, { waitUntil: 'networkidle' }); await waitForBoot(p3);
  await seedAthlete(p3);
  const during = await p3.evaluate(async () => {
    openPlayer(); await new Promise(r => setTimeout(r, 150));
    for (let i = 0; i < 2; i++) { playerSetDone(); await new Promise(r => setTimeout(r, 120)); }
    return { hasCrumb: !!STATE._plResume, i: STATE._plResume && STATE._plResume.i };
  });
  s.ok('an in-flight session leaves a resume breadcrumb', during.hasCrumb === true, during);

  await p3.reload({ waitUntil: 'networkidle' }); await waitForBoot(p3);
  const offered = await p3.evaluate(() => {
    const t = [...document.querySelectorAll('.view.active')].map(v => v.textContent).join(' ');
    return { offers: /Pick up where I left off/i.test(t), info: !!resumeInfo() };
  });
  s.ok('after a reload the athlete is offered the session back', offered.offers === true, offered);

  const resumed = await p3.evaluate(async () => {
    resumeSession(); await new Promise(r => setTimeout(r, 250));
    return { open: !!PLAYER, i: PLAYER ? PLAYER.i : null };
  });
  s.ok('resuming reopens the player', resumed.open === true, resumed);
  s.ok('resuming lands on the exercise they stopped on', resumed.i === during.i, { resumed, during });

  /* an intentional quit must NOT leave an offer behind */
  const quit = await p3.evaluate(async () => {
    playerQuit(); await new Promise(r => setTimeout(r, 200));
    return { crumb: !!STATE._plResume, info: !!resumeInfo() };
  });
  s.ok('quitting on purpose clears the breadcrumb', quit.crumb === false && quit.info === false, quit);

  /* a stale crumb from another day or another session must be ignored */
  const stale = await p3.evaluate(() => {
    STATE._plResume = { ptr: STATE.progressPtr, i: 0, s: 0, setsDone: 3, date: '2001-01-01', ts: 1 };
    const oldDay = !!resumeInfo();
    STATE._plResume = { ptr: STATE.progressPtr + 99, i: 0, s: 0, setsDone: 3, date: todayISO(), ts: 1 };
    const otherSession = !!resumeInfo();
    STATE._plResume = { ptr: STATE.progressPtr, i: 9999, s: 0, setsDone: 3, date: todayISO(), ts: 1 };
    const outOfRange = !!resumeInfo();
    STATE._plResume = 'garbage'; normalizeState();
    const junk = STATE._plResume === undefined && !resumeInfo();
    return { oldDay, otherSession, outOfRange, junk };
  });
  s.ok('a crumb from another day is ignored', stale.oldDay === false, stale);
  s.ok('a crumb from another session is ignored', stale.otherSession === false, stale);
  s.ok('a crumb pointing past the end is ignored', stale.outOfRange === false, stale);
  s.ok('a non-object crumb is dropped by normalizeState', stale.junk === true, stale);
  await p3.close();
}

/* ============ E. layout holds on the smallest phones people own ============ */
{
  for (const [name, w, h] of [['Fold', 280, 653], ['SE', 320, 568], ['iPhone 8', 375, 667]]) {
    const pv = await browser.newPage({ viewport: { width: w, height: h } });
    await pv.goto(base, { waitUntil: 'networkidle' }); await waitForBoot(pv);
    await seedAthlete(pv);
    for (const tab of ['today', 'program', 'fuel', 'progress', 'ref', 'guide']) {
      const r = await pv.evaluate(t => {
        go(t);
        const d = document.documentElement;
        const view = document.querySelector('.view.active');
        const off = [];
        view.querySelectorAll('button,a,input,select').forEach(el => {
          const b = el.getBoundingClientRect();
          if (b.width && b.height && (b.right > d.clientWidth + 1 || b.left < -1))
            off.push({ label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24), right: Math.round(b.right) });
        });
        return { overflow: d.scrollWidth > d.clientWidth + 1, off: off.slice(0, 3) };
      }, tab);
      s.ok(`no horizontal overflow — ${tab} @ ${name}`, !r.overflow, r);
      s.eq(`no control off-screen — ${tab} @ ${name}`, r.off.length, 0, r.off);
    }
    await pv.close();
  }
}

/* ============ F. the player is fully reachable on a small screen =========== */
{
  const pp = await browser.newPage({ viewport: { width: 320, height: 568 } });
  await pp.goto(base, { waitUntil: 'networkidle' }); await waitForBoot(pp);
  await seedAthlete(pp);
  /* Actually SCROLL to the offending control rather than asking whether the
     element overflows. `scrollHeight > clientHeight` is true even when the
     parent is overflow:hidden, so the first version of this check passed with
     the bug put back — it measured overflow, not reachability. */
  const r = await pp.evaluate(async () => {
    openPlayer(); await new Promise(z => setTimeout(z, 250));
    const body = document.querySelector('.pl-body');
    const d = document.documentElement;
    const below = [...document.querySelectorAll('#player button')].filter(b => {
      const q = b.getBoundingClientRect();
      return q.width && q.height && q.bottom > d.clientHeight + 1;
    });
    // scroll the player body as far as it will actually go
    if (body) { body.scrollTop = body.scrollHeight; }
    await new Promise(z => setTimeout(z, 150));
    const stillBelow = below.map(b => {
      const q = b.getBoundingClientRect();
      return { t: (b.textContent || '').trim().slice(0, 22), over: Math.round(q.bottom - d.clientHeight) };
    }).filter(x => x.over > 1);
    return { wasBelow: below.length, stillBelow,
      scrolled: body ? body.scrollTop : -1,
      overflowY: body ? getComputedStyle(body).overflowY : null,
      quitBox: (() => { const x = document.querySelector('.pl-x'); const q = x.getBoundingClientRect(); return { w: Math.round(q.width), h: Math.round(q.height) }; })() };
  });
  s.ok('the player body is scrollable, not clipped', r.overflowY === 'auto' || r.overflowY === 'scroll', r);
  s.eq('every player control can be scrolled into view at 320×568', r.stillBelow.length, 0, r);
  s.ok('the quit button meets the 44px target', r.quitBox.w >= 44 && r.quitBox.h >= 44, r.quitBox);
  await pp.close();
}

/* ============ G. the exercise tick is actually hittable ==================== */
{
  const ph = await browser.newPage({ viewport: { width: 320, height: 568 } });
  await ph.goto(base, { waitUntil: 'networkidle' }); await waitForBoot(ph);
  await seedAthlete(ph);
  await ph.evaluate(() => go('today'));
  await ph.evaluate(() => { const b = document.querySelector('button.ex-check'); if (b) b.scrollIntoView({ block: 'center', behavior: 'instant' }); });
  await ph.waitForTimeout(400);
  const box = await ph.evaluate(() => {
    const b = document.querySelector('button.ex-check');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, exId: b.closest('.ex').dataset.ex, labelled: !!b.getAttribute('aria-label') };
  });
  s.ok('the exercise tick has an accessible name', box.labelled, box);
  const read = () => ph.evaluate(id => { const l = ensureLog(); return !!(l.ex[id] && l.ex[id].done); }, box.exId);
  const before = await read();
  await ph.mouse.click(box.x, box.y - 18);          // outside the 30px box, inside the 44px band
  await ph.waitForTimeout(300);
  const near = await read();
  s.ok('a tap 18px off-centre still hits the tick', near !== before, { before, near });
  await ph.mouse.click(box.x, box.y - 18);
  await ph.waitForTimeout(250);
  const back = await read();
  await ph.mouse.click(box.x, box.y - 40);          // well outside — must not toggle
  await ph.waitForTimeout(250);
  const far = await read();
  s.ok('the expanded target does not swallow neighbouring taps', far === back, { back, far });
  await ph.close();
}

/* ============ H. performance budget ======================================== */
{
  const files = fs.readdirSync(ROOT).filter(f => /\.(jpg|png|mp4|webp)$/i.test(f));
  const bytes = files.reduce((a, f) => a + fs.statSync(path.join(ROOT, f)).size, 0);
  s.ok('no single asset above 1MB', !files.some(f => fs.statSync(path.join(ROOT, f)).size > 1024 * 1024),
    files.map(f => [f, fs.statSync(path.join(ROOT, f)).size]).filter(([, b]) => b > 1024 * 1024));

  const pf = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await pf.goto(base, { waitUntil: 'networkidle' }); await waitForBoot(pf);
  await seedAthlete(pf);
  const soak = await pf.evaluate(async () => {
    const iso = d => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
    for (let i = 0; i < 300; i++) STATE.logs[i] = { date: iso(370 - i), feel: 'ok', done: true, sets: 13, vol: 400 + i };
    STATE.measurements = []; for (let i = 0; i < 200; i++) STATE.measurements.push({ date: iso(200 - i), weight: 88 - i * 0.02, waist: 96 - i * 0.02 });
    STATE.progressPtr = 300; normalizeState(); save();
    const t = {};
    for (const tab of ['today', 'program', 'fuel', 'progress', 'ref', 'guide']) {
      const a = performance.now(); go(tab); await new Promise(r => requestAnimationFrame(r)); t[tab] = performance.now() - a;
    }
    return { t, kb: Math.round((localStorage.getItem('coreforge.v1') || '').length / 1024) };
  });
  Object.entries(soak.t).forEach(([tab, ms]) =>
    s.ok(`${tab} renders under 400ms with a year of history`, ms < 400, { ms: Math.round(ms) }));
  s.ok('localStorage stays well under the 5MB cap after a year', soak.kb < 3000, soak);
  await pf.close();
}

/* ============ I. content and legal surface ================================= */
{
  const pc = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await pc.goto(base, { waitUntil: 'networkidle' }); await waitForBoot(pc);
  await seedAthlete(pc);
  const c = await pc.evaluate(async () => {
    let all = '';
    for (const t of ['today', 'program', 'fuel', 'progress', 'ref', 'guide']) { go(t); await new Promise(r => setTimeout(r, 60)); all += ' ' + [...document.querySelectorAll('.view.active')].map(v => v.textContent).join(' '); }
    return {
      disclaimer: /not medical advice|consult (a|your) (doctor|physician|GP)|healthcare professional/i.test(all),
      privacy: /stays on (your|this) (device|phone)|never leaves|on this device|no account/i.test(all),
      guarantees: (all.match(/guaranteed results|lose \d+ ?(lb|kg|pounds) in \d+ (day|week)/gi) || []),
      cures: (all.match(/\bcures?\b|\bdetox\b/gi) || []),
    };
  });
  s.ok('a medical disclaimer is present', c.disclaimer, c);
  s.ok('the on-device privacy promise is stated', c.privacy, c);
  s.eq('no results-guarantee language', c.guarantees.length, 0, c.guarantees);
  s.eq('no cure/detox claims', c.cures.length, 0, c.cures);
  await pc.close();
}

/* ---- Today LEADS with today's workout (v246, re-aimed v314) --------------
   Two grids were removed from the top of Today at the athlete's request. The
   six-stat summary moved to Progress and stayed there. The alternate-session
   tiles went to Program in v246 and came back in v314 — to the BOTTOM of this
   tab, because the original request was about position and Program is a
   54-week calendar nobody opens looking for a five-minute substitute.

   So the assertion is no longer "gone from Today". It is ORDER: the tiles are
   present, and every one of them sits below the session's own controls. A
   bare "the tiles are on Today" check passes on exactly the layout v246
   rejected, and a bare "they are on Program" check was holding the wrong
   destination in place. Both ends are pinned, both ways. */
{
  const r = await page.evaluate(() => {
    const o = {};
    const txt = el => (el && el.innerText) || '';
    const html = el => (el && el.innerHTML) || '';

    go('today'); setTodayTab('workout'); renderToday();
    const today = document.querySelector('#v-today');
    o.todayLen = txt(today).trim().length;
    // the moved tiles, by the handler each one carried
    o.todayTiles = ['startWeights(', 'openSpecial(', 'openQuickList(',
      'openRestSheet(', 'startRestDay('].filter(fn => html(today).includes(fn));
    // the dead tile is not carried back: v245 removed the card it scrolled to
    o.todayMealPlan = html(today).includes('openMealPlan(');
    o.todayStats = !!today.querySelector('.grid3 [onclick^="logMeasure"]');
    /* ORDER is the requirement, not presence. Measured against the session's
       own Mark-Complete button — the last thing that belongs to today's work —
       so a tile that crept back above the exercise list fails even though it
       is still technically "on Today". Every handler is measured, not just the
       first: a mutant that moved one tile up passes a check that only reads
       the earliest index. */
    const _fin = html(today).indexOf('id="finishSession"');
    o.finishIdx = _fin;
    o.tilesAboveSession = ['startWeights(', 'openSpecial(', 'openQuickList(',
      'openRestSheet(', 'startRestDay(']
      .filter(fn => { const i = html(today).indexOf(fn); return i >= 0 && i < _fin; });
    o.altLabelled = /not today.s session|something else today/i.test(txt(today));
    // what MUST still be there: today's actual session
    o.keepsPlayer = html(today).includes('openPlayer(');
    /* Section labels and stat labels are uppercased by CSS text-transform, and
       innerText reflects that — match case-insensitively or an assertion reads
       as "the section is gone" when it is only shouting. */
    o.keepsMainWork = /main work/i.test(txt(today));
    o.keepsFinisher = /finisher/i.test(txt(today));
    o.keepsExercises = today.querySelectorAll('.exlist .excard, .exlist > *').length;

    go('program'); renderProgram();
    const prog = document.querySelector('#v-program');
    o.progTiles = ['startWeights(', 'openSpecial(', 'openQuickList(', 'openRestSheet(',
      'startRestDay('].filter(fn => html(prog).includes(fn));
    /* Program keeps what it is FOR — the 54-week calendar — so this is the
       floor that stops the move becoming a deletion of the tab's own content. */
    o.progKeepsCalendar = !!prog.querySelector('.calday') && /week 1/i.test(txt(prog));

    go('progress'); renderProgress();
    const prg = document.querySelector('#v-progress');
    /* NOT a bare '.grid3' probe — renderProgress() has grids of its own, so that
       selector stays true whether or not the summary moved here, and a mutant
       that never added it passed exactly that way. Anchor on markup unique to
       homeSummaryHTML(): the waist stat is its only logMeasure() button, and the
       week tile is the only one carrying the /54 programme denominator. */
    o.progressStats = !!prg.querySelector('.grid3 [onclick^="logMeasure"]')
      && html(prg).includes('/' + (WEEKS_PER_CYCLE * TOTAL_CYCLES));
    o.progressShowsWeek = /week/i.test(txt(prg));
    o.progressShowsBadges = /badges/i.test(txt(prg));
    return o;
  });
  s.eq('all five alternate-session tiles are on Today', r.todayTiles.length, 5, r);
  s.eq('and every one of them sits BELOW the session controls', r.tilesAboveSession, [], r);
  s.ok('the session button they are measured against really is there', r.finishIdx > 0, r);
  s.ok('the block says what it is for', r.altLabelled, r);
  s.eq('the dead Meal plan tile is not carried back', r.todayMealPlan, false, r);
  s.eq('and the six-stat summary is still gone from Today', r.todayStats, false);
  s.ok('Today still leads with the guided player', r.keepsPlayer, r);
  s.ok('and still shows the main work', r.keepsMainWork, r);
  s.ok('and the finisher', r.keepsFinisher, r);
  s.ok('and still lists today\'s actual exercises', r.keepsExercises > 0, r);
  s.ok('Today still renders a real page, not a stub', r.todayLen > 200, r);
  s.eq('the session tiles no longer sit on the 54-week calendar', r.progTiles, [], r);
  s.ok('but Program keeps the calendar itself', r.progKeepsCalendar, r);
  s.ok('the stat summary now lives on Progress', r.progressStats, r);
  s.ok('showing the week', r.progressShowsWeek, r);
  s.ok('and the badge count', r.progressShowsBadges, r);
}

/* ---- "Meal ideas" must land on meals, not an empty tab -------------------
   Regression from v245: removing Fuel's plan card orphaned openMealPlan(),
   which still scrolled to a #mealplan anchor that no longer existed. Its own
   `if(el)` guard swallowed that silently, so two live buttons — on the
   day-complete sheet and the rest-day sheet — became dead ends that promised
   food and showed none. Driven end to end rather than asserting on source: a
   check that only read openMealPlan() for the string 'ref' would pass just as
   happily if the anchor it scrolls to had been deleted. */
{
  const r = await page.evaluate(() => {
    const o = {};
    go('today');
    openMealPlan();
    o.tab = TAB;
    const view = document.querySelector('#v-' + TAB);
    o.anchorExists = !!(view && view.querySelector('#mealplan'));
    // the destination genuinely shows meals, not just a tab that rendered
    const txt = (view && view.innerText) || '';
    o.showsMeals = /worked days/i.test(txt) && /Log this meal/i.test(txt);
    // and every caller still points at the function under test
    o.callers = ((document.documentElement.innerHTML.match(/openMealPlan\(\)/g) || []).length);
    return o;
  });
  s.eq('the meal-ideas button lands on Reference, where the days now live', r.tab, 'ref');
  s.ok('the anchor it scrolls to actually exists on that tab', r.anchorExists, r);
  s.ok('and that tab really shows meals', r.showsMeals, r);
}

/* ---- Reference is the look-it-up tab, and it holds two libraries (v314) ---
   138 movements used to be the THIRD section of Settings, above the settings
   themselves — a reference work filed under "change my preferences". It moved
   behind a Moves pane on Reference.

   Both ends are asserted, and so is the ROUTE: openMealPlan() lands on
   Reference and scrolls to a #mealplan anchor that only exists on the Food
   pane, so a version that forgot to name the pane is a dead end for an athlete
   who last left Reference on Moves. That is the same defect v245's own fix
   closed, one layer further in. */
{
  const r = await page.evaluate(() => {
    const o = {};
    const H = id => document.querySelector(id).innerHTML;
    const T = id => document.querySelector(id).textContent;
    go('guide'); renderGuide();
    o.libInSettings = /Exercise library ·/.test(H('#v-guide'));
    /* The floor: Settings keeps being Settings. A move that emptied the tab
       satisfies every "the library is gone from here" assertion. */
    o.settingsKeepsControls = H('#v-guide').includes('id="settingsAnchor"')
      && H('#v-guide').includes('toggleSetting(');

    go('ref'); setRefTab('food'); renderRef();
    o.foodPaneHasLib = /Exercise library ·/.test(H('#v-ref'));
    o.foodPaneHasFood = /Food list/i.test(T('#v-ref'));
    setRefTab('moves');
    o.movesPaneHasLib = /Exercise library ·/.test(H('#v-ref'));
    /* Count the info buttons, not the heading. A heading that says "· 138"
       with an empty list underneath satisfies a substring check. */
    o.movesInfoButtons = document.querySelectorAll('#v-ref [onclick^="openExerciseInfo"]').length;
    o.movesPaneHasFood = /Food list/i.test(T('#v-ref'));
    /* TWO guards, so two checks. The setter refuses a name that is not a real
       pane, and the reader falls back when REF_TAB is ALREADY junk — which is
       the case a stored value from an older build produces, and the only one
       that can reach innerHTML. A check that only calls the setter measures
       the reader on nothing. */
    setRefTab('moves');
    setRefTab('nonsense'); o.setterRefused = REF_TAB;
    REF_TAB = 'nonsense'; o.readerFellBack = refTab();
    renderRef();
    o.junkPaneRendersFood = /Food list/i.test(T('#v-ref'));
    o.junkNameNotOnGlass = !H('#v-ref').includes('nonsense');
    REF_TAB = 'moves';
    return o;
  });
  s.eq('the exercise library is no longer buried in Settings', r.libInSettings, false, r);
  s.ok('and Settings still has its actual settings', r.settingsKeepsControls, r);
  s.ok('the library lives on Reference ▸ Moves', r.movesPaneHasLib, r);
  s.ok('with every movement listed, not just the heading', r.movesInfoButtons > 100, r);
  s.eq('and no food on that pane', r.movesPaneHasFood, false, r);
  s.ok('Reference ▸ Food is still the food list', r.foodPaneHasFood, r);
  s.eq('and does not carry the library too', r.foodPaneHasLib, false, r);
  s.eq('the pane setter refuses a name that is not a pane', r.setterRefused, 'moves', r);
  s.eq('and a junk value already in REF_TAB reads back as Food', r.readerFellBack, 'food', r);
  s.ok('so a stale stored pane still renders real content', r.junkPaneRendersFood, r);
  s.ok('and the junk name never reaches innerHTML', r.junkNameNotOnGlass, r);

  // the route in: it must name the pane, not just the tab
  const route = await page.evaluate(async () => {
    setRefTab('moves');            // the athlete's last position
    openMealPlan();
    await new Promise(r => setTimeout(r, 200));
    const v = document.querySelector('#v-' + TAB);
    return { tab: TAB, pane: refTab(), anchor: !!(v && v.querySelector('#mealplan')) };
  });
  s.eq('the meal-ideas route still lands on Reference', route.tab, 'ref', route);
  s.eq('and switches to the pane the days are actually on', route.pane, 'food', route);
  s.ok('so its scroll anchor exists', route.anchor, route);
}

/* ---- every figure on Progress ▸ Summary has exactly one home (v314) -------
   Sessions, the streak and the Core Score each rendered twice: once in the
   grid at the top of the tab, once again 20 lines below — the score as a full
   ring, sessions in the lifetime grid, the streak under a second label ("Day
   streak"). Two numbers that agree are not reassurance, they are a reader
   wondering which one is real.

   Asserted by counting the RENDERED stat labels rather than by naming the
   three that were wrong: a check that only knows about Sessions passes on the
   next duplicate someone adds. The floors below it are what stop a de-dup
   becoming a deletion. */
{
  const r = await page.evaluate(() => {
    go('progress'); setProgressTab('summary'); renderProgress();
    const v = document.querySelector('#v-progress');
    const counts = {};
    v.querySelectorAll('.stat .l').forEach(el => {
      const k = el.textContent.trim().toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
    });
    const txt = v.textContent;
    return {
      dups: Object.entries(counts).filter(([, n]) => n > 1),
      labelCount: Object.keys(counts).length,
      // the figures themselves must all still be reachable
      hasWeek: 'week' in counts,
      hasSessions: 'sessions' in counts,
      hasStreak: Object.keys(counts).some(k => /streak/.test(k)),
      hasCoreScore: /core score/i.test(txt),
      hasThisWeek: 'this week' in counts,
      hasMinutes: 'min trained' in counts,
      // the prose line that restated the volume grid is gone
      noVolumeProse: !/lifetime volume:/i.test(txt),
      hasVolume: 'sets' in counts && 'reps' in counts && 'holds' in counts,
    };
  });
  s.eq('no figure is printed twice on the summary', r.dups, [], r);
  s.ok('and the summary still carries a real set of figures', r.labelCount >= 10, r);
  s.ok('the programme week survives', r.hasWeek, r);
  s.ok('this week survives', r.hasThisWeek, r);
  s.ok('the streak survives', r.hasStreak, r);
  s.ok('lifetime sessions survive', r.hasSessions, r);
  s.ok('minutes trained survive', r.hasMinutes, r);
  s.ok('the Core Score survives', r.hasCoreScore, r);
  s.ok('and the volume totals survive as a grid', r.hasVolume, r);
  s.ok('with the prose line that restated them gone', r.noVolumeProse, r);
}

/* ---- copy that names a tab has to name the right one (v315) --------------
   Four sentences pointed at screens the thing they named had already left.
   Two of them the COACH READS ALOUD every morning, which is the worst version
   of this: an athlete cannot double-check a spoken address by looking at it.

     - "The full recipes are in the Fuel tab" — v245 removed the plan card from
       Fuel at the athlete's request; the worked days are on Reference.
     - "Log your weight in the Fuel tab" — Fuel has no weight control at all.
       logMeasure() is on Progress, beside the chart.
     - "already on your live total in Fuel above" — v311 moved that block to
       Today, so there is nothing above it.
     - "Open the Progress tab and pick [a goal weight]" — no such control
       existed anywhere outside the setup wizard until this version.

   Each is asserted BOTH ways: the copy names the tab the thing is on, and the
   destination really has it. Checking only the wording passes on a sentence
   that names a tab for a feature that was deleted; checking only the feature
   passes while the sentence still points somewhere else. That is precisely how
   the v311 regression survived — a check was pinning the OLD address. */
{
  const r = await page.evaluate(() => {
    const o = {};
    const T = t => { go(t); return document.querySelector('#v-' + t).textContent; };

    // --- 1. the meal-plan address, spoken ---
    const segs = briefSegments();
    const meals = segs.find(x => /meal plan today/i.test(x.say || ''));
    o.mealsSpoken = !!meals;
    o.mealsSay = meals ? meals.say : '';
    o.mealsNamesRef = /Reference/i.test(o.mealsSay);
    o.mealsNamesFuel = /Fuel tab/i.test(o.mealsSay);
    setRefTab('food');
    o.refReallyHasDays = /worked days|meal plan/i.test(T('ref'));
    o.fuelHasNoPlan = !/worked days|Today's plan/i.test(T('fuel'));

    // --- 2. where weight is logged ---
    o.fuelWeightControls = [...document.querySelectorAll('#v-fuel [onclick]')]
      .map(e => e.getAttribute('onclick')).filter(x => /logMeasure/.test(x)).length;
    go('progress'); setProgressTab('body'); renderProgress();
    o.progressLogsWeight = [...document.querySelectorAll('#v-progress [onclick]')]
      .some(e => /logMeasure/.test(e.getAttribute('onclick')));
    return o;
  });
  s.ok('the brief still names the day\'s meals', r.mealsSpoken, r);
  s.ok('and sends the athlete to Reference for the recipes', r.mealsNamesRef, r);
  s.eq('not to Fuel, where the plan card no longer is', r.mealsNamesFuel, false, r);
  s.ok('Reference really does carry the days', r.refReallyHasDays, r);
  s.ok('and Fuel really does not', r.fuelHasNoPlan, r);
  s.eq('Fuel has no weight logger to send anyone to', r.fuelWeightControls, 0, r);
  s.ok('Progress ▸ Body does', r.progressLogsWeight, r);

  /* The spoken mission lines, driven through briefSegments() with the goal
     weight both set and unset — the two branches print different addresses and
     a check that only runs one of them measures half the code. */
  const m = await page.evaluate(() => {
    const keep = STATE.profile.goalWeightLb;
    const say = () => (briefSegments().find(x => x.title === 'Your mission') || {}).say || '';
    STATE.profile.goalWeightLb = 165; STATE.nutrition.weightKg = null;
    STATE.measurements = [];
    const noWeight = say();
    STATE.profile.goalWeightLb = null;
    const noGoal = say();
    STATE.profile.goalWeightLb = keep;
    STATE.nutrition.weightKg = 88;
    STATE.measurements = [{ date: todayISO(), weight: 88, waist: 96 }];
    save();
    return { noWeight, noGoal };
  });
  s.ok('with no logged weight the coach sends you to Progress, not Fuel',
    /Progress/i.test(m.noWeight) && !/Fuel/i.test(m.noWeight), m);
  s.ok('and with no goal weight it names the pane the control is on',
    /Progress/i.test(m.noGoal) && /Body/i.test(m.noGoal), m);

  // --- 3. the earned-calorie note, which moved tabs in v311 ---
  const e = await page.evaluate(() => {
    setSteps(stepTarget() + 4000); save();
    go('today'); setTodayTab('workout'); renderToday();
    const line = (document.querySelector('#v-today').textContent
      .match(/[^\n]{0,40}kcal earned today[^\n]{0,140}/i) || [])[0] || '';
    const onFuel = /kcal earned today/i.test(document.querySelector('#v-fuel').textContent);
    setSteps(0); save();
    return { line, onFuel };
  });
  s.ok('the earned-calorie note is on Today', !!e.line, e);
  s.eq('and not on Fuel', e.onFuel, false, e);
  s.eq('so it does not claim the total it names is "above"', /above/i.test(e.line), false, e);
  s.ok('it points at the tab that total really is on', /Fuel/i.test(e.line), e);
}

/* ---- the goal weight is settable outside the setup wizard (v315) ----------
   profile.goalWeightLb is what projTargetKg() and timelineRateKgWk() are built
   on and what the coach reads aloud every morning, and it had NO setter
   anywhere but the profile quiz — so changing one number meant walking the
   whole wizard. Two sentences in the brief already told the athlete to set it
   on Progress, which was simply false.

   Driven through the sheet the athlete taps, not by calling the writer: a
   control that stores correctly from a direct call and is mounted nowhere is
   the same defect. */
{
  const r = await page.evaluate(async () => {
    const o = {};
    STATE.profile.unit = 'in';
    delete STATE.profile.goalWeightLb; delete STATE.profile.goalBodyFat; save();
    go('progress'); setProgressTab('body'); renderProgress();
    const v = document.querySelector('#v-progress');
    o.emptyStateSaysHow = /no goal weight set/i.test(v.textContent);
    const btn = [...v.querySelectorAll('button')]
      .find(b => /Goal/.test(b.textContent) && /setGoalWeight/.test(b.getAttribute('onclick') || ''));
    o.hasButton = !!btn;
    if (!btn) return o;                       // guard before anything assumes the sheet
    btn.click();
    await new Promise(res => setTimeout(res, 40));
    o.sheetOpen = !!document.querySelector('#g-weight');
    if (!o.sheetOpen) return o;

    // a junk value must be refused, and must not store anything
    document.querySelector('#g-weight').value = '9';
    saveGoalWeight();
    o.junkRefused = !(STATE.profile.goalWeightLb > 0);
    o.sheetStillOpen = !!document.querySelector('#g-weight');

    // a real one is stored, in POUNDS, whatever unit the box was in
    document.querySelector('#g-weight').value = '165';
    saveGoalWeight();
    await new Promise(res => setTimeout(res, 40));
    o.storedLb = STATE.profile.goalWeightLb;
    o.projTargetKg = Math.round(projTargetKg() * 10) / 10;

    renderProgress();
    /* SCOPED to the goal-weight row. A page-wide search matched the WAIST
       goal's own "to go" and passed with the gap deleted — the same trap as
       the v267 warning icon that existed in two places and was asserted in
       one. */
    const row = document.querySelector('#v-progress [data-goalwt="set"]');
    o.hasRow = !!row;
    o.lineShowsGoal = !!row && /165 lb/.test(row.textContent);
    o.lineShowsGap = !!row && /to go|under it|you are there/i.test(row.textContent);

    /* METRIC too. In imperial the conversion is its own inverse — 165 in,
       165 stored — so a mutant that ignores the unit entirely is EQUIVALENT
       there and escaped. Only kg tells the two apart. */
    STATE.profile.unit = 'cm';
    delete STATE.profile.goalWeightLb; save();
    setProgressTab('body'); renderProgress();
    const b2 = [...document.querySelectorAll('#v-progress button')]
      .find(x => /setGoalWeight/.test(x.getAttribute('onclick') || ''));
    if (b2) {
      b2.click();
      const inp = document.querySelector('#g-weight');
      if (inp) { inp.value = '75'; saveGoalWeight(); }
      o.metricStoredLb = STATE.profile.goalWeightLb;
      setProgressTab('body'); renderProgress();
      const r2 = document.querySelector('#v-progress [data-goalwt="set"]');
      o.metricLine = r2 ? r2.textContent.trim() : '';
    }
    STATE.profile.unit = 'in';
    return o;
  });
  s.ok('Progress ▸ Body offers a goal-weight control', r.hasButton, r);
  s.ok('and says so when none is set', r.emptyStateSaysHow, r);
  s.ok('tapping it opens the sheet', r.sheetOpen, r);
  s.ok('an implausible weight is refused', r.junkRefused, r);
  s.ok('and the sheet stays open so it can be corrected', r.sheetStillOpen, r);
  s.eq('a real goal is stored in pounds', r.storedLb, 165, r);
  s.eq('and the projection reads the same number', r.projTargetKg, 74.8, r);
  s.ok('the tab renders a goal-weight row of its own', r.hasRow, r);
  s.ok('which states the goal', r.lineShowsGoal, r);
  s.ok('and how far there is to go', r.lineShowsGap, r);
  /* 75 kg is 165 lb. A mutant that stored the typed number would leave 75. */
  s.eq('a metric entry is converted to the stored pounds', r.metricStoredLb, 165, r);
  s.ok('and reads back in kilograms', /75 kg/.test(r.metricLine || ''), r);

  /* A hand-set goal outranks the derived one. recomputeTargetWeight() writes
     goalWeightLb FROM goalBodyFat, so leaving the body-fat target in place
     would let the next body-level tap silently overwrite the athlete's own
     answer — the same call as a hand-set protein target beating the
     calculation. */
  const own = await page.evaluate(() => {
    STATE.profile.goalBodyFat = 12; save();
    document.querySelector('#v-progress');
    setProgressTab('body'); renderProgress();
    const btn = [...document.querySelectorAll('#v-progress button')]
      .find(b => /setGoalWeight/.test(b.getAttribute('onclick') || ''));
    /* Guard BEFORE the first line that assumes it exists. The mutant that
       unmounts the control left this undefined and the block died on
       `btn.click()`, so the run reported "the test file itself threw" instead
       of naming a failed check — still red, so still a catch, but a throw
       hides which property broke and the same shape one step further along
       hung a whole suite in v267. */
    if (!btn) return { mounted: false };
    btn.click();
    if (!document.querySelector('#g-weight')) return { mounted: true, sheet: false };
    document.querySelector('#g-weight').value = '170';
    saveGoalWeight();
    const afterSave = { lb: STATE.profile.goalWeightLb, bf: STATE.profile.goalBodyFat };
    recomputeTargetWeight();
    return { afterSave, afterRecompute: STATE.profile.goalWeightLb };
  });
  s.ok('the goal-weight control is still mounted for this block', own.afterSave, own);
  if (own.afterSave) {
    s.eq('a hand-set goal weight is what gets stored', own.afterSave.lb, 170, own);
    s.eq('and the derived body-fat target is dropped', own.afterSave.bf, undefined, own);
    s.eq('so recomputing cannot overwrite the athlete\'s own answer',
      own.afterRecompute, 170, own);
  }
}

srv.close();
const failed = s.finish(errors);
await browser.close();
return failed;
}
