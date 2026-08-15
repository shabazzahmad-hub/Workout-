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

/* ---- Today is today's workout, nothing else (v246) -----------------------
   Two grids were removed from the Today tab at the athlete's request: six
   alternate-session tiles and the six-stat summary. Both MOVED rather than
   died, so this asserts on both ends — gone from Today AND present on the tab
   that now owns them. Checking only the removal would pass just as happily on
   a version that deleted them outright, which is not what was asked for. */
{
  const r = await page.evaluate(() => {
    const o = {};
    const txt = el => (el && el.innerText) || '';
    const html = el => (el && el.innerHTML) || '';

    go('today'); renderToday();
    const today = document.querySelector('#v-today');
    o.todayLen = txt(today).trim().length;
    // the six moved tiles, by the handler each one carried
    o.todayTiles = ['startWeights(', 'openSpecial(', 'openMealPlan(', 'openQuickList(',
      'openRestSheet(', 'startRestDay('].filter(fn => html(today).includes(fn));
    o.todayStats = !!today.querySelector('.grid3 [onclick^="logMeasure"]');
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
    o.progTiles = ['openSpecial(', 'openQuickList(', 'openRestSheet('].filter(fn => html(prog).includes(fn));
    o.progHasRest = html(prog).includes('startRestDay(') || html(prog).includes('openRestSheet(');
    // the standalone Quick button folded INTO the grid — not both
    o.progQuickCount = (html(prog).match(/openQuickList\(/g) || []).length;
    // the dead tile is not carried over: v245 removed the card it scrolled to
    o.progMealPlan = html(prog).includes('openMealPlan(');

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
  s.eq('no alternate-session tiles remain on Today', r.todayTiles, []);
  s.eq('and the six-stat summary is gone from Today', r.todayStats, false);
  s.ok('Today still leads with the guided player', r.keepsPlayer, r);
  s.ok('and still shows the main work', r.keepsMainWork, r);
  s.ok('and the finisher', r.keepsFinisher, r);
  s.ok('and still lists today\'s actual exercises', r.keepsExercises > 0, r);
  s.ok('Today still renders a real page, not a stub', r.todayLen > 200, r);
  s.eq('the session tiles now live on Program', r.progTiles.length, 3, r);
  s.ok('including the rest-day control', r.progHasRest, r);
  s.eq('with Quick Workouts appearing once, not beside a duplicate button', r.progQuickCount, 1, r);
  s.eq('the dead Meal plan tile is not carried over', r.progMealPlan, false, r);
  s.ok('the stat summary now lives on Progress', r.progressStats, r);
  s.ok('showing the week', r.progressShowsWeek, r);
  s.ok('and the badge count', r.progressShowsBadges, r);
}

srv.close();
const failed = s.finish(errors);
await browser.close();
return failed;
}
