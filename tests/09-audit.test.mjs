/* The v190 audit fixes.

   Every check here maps to a defect five independent reviewers found in code
   that had already passed several review rounds and a 596-check suite. They
   share a shape worth naming, because it is the shape this file exists to stop
   coming back:

     - the value is plausible, so reading the code does not catch it
     - the failure is an ABSENCE (a nudge that never fires, a button that does
       not exist, a photo that is not in the backup), so nothing throws
     - or it only bites outside the reviewer's own conditions — west of UTC,
       after 6pm, in imperial units, at two sessions a week

   Which is why several of these assert behaviour under a *specific* timezone,
   unit system or training schedule rather than the default. */
import { serve, launch, suite, seedAthlete, waitForBoot } from './lib/harness.mjs';
import { chromium } from 'playwright';

export default async function run() {
  const t = suite('audit fixes');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  // ---- defaults that quietly reconfigure the program -----------------------
  const def = await page.evaluate(() => {
    const d = DEFAULT_STATE();
    const o = { days: d.profile.days, experience: d.profile.experience };
    o.fiveDays = d.profile.days.length === 5;
    o.hasRest = ![0, 1, 2, 3, 4, 5, 6].every(x => d.profile.days.includes(x));
    /* The measured level must win. `experience` was pre-selected as
       'Intermediate' in the wizard, and levelOf() let it promote a measured
       Beginner a whole tier: LEVEL_FACTOR 0.8 -> 1.0 is +25% on every
       unanchored target, and rungIndex starts at 1, skipping the true-novice
       rung of every ladder. */
    const realBase = STATE.baseline, realExp = STATE.profile.experience;
    STATE.baseline = { date: todayISO(), score: 20, level: 'Beginner', testCount: 8,
      maxes: { plank: 30, side: 20, hollow: 15, lower: 6, push: 9, pull: 2, squat: 18, dyn: 15 } };
    STATE.profile.experience = 'Intermediate';
    o.claimCannotPromote = levelOf(0) === 'Beginner';
    STATE.profile.experience = 'Advanced';
    o.evenAdvancedCannotPromote = levelOf(0) === 'Beginner';
    // easing yourself down is still allowed — that direction is a safety valve
    STATE.baseline.level = 'Advanced'; STATE.profile.experience = 'Intermediate';
    o.claimCanEase = levelOf(0) === 'Intermediate';
    STATE.profile.experience = 'Beginner';
    o.easesOneTierOnly = levelOf(0) === 'Intermediate';
    // and the promotion really did change the prescription, not just a label
    STATE.baseline = { date: todayISO(), score: 20, level: 'Beginner', testCount: 8,
      maxes: { plank: 30, side: 20, hollow: 15, lower: 6, push: 9, pull: 2, squat: 18, dyn: 15 } };
    o.factorBeginner = LEVEL_FACTOR['Beginner']; o.factorInter = LEVEL_FACTOR['Intermediate'];
    o.factorGap = +(o.factorInter / o.factorBeginner).toFixed(2);
    STATE.baseline = realBase; STATE.profile.experience = realExp;
    return o;
  });
  t.ok('the default training week is five days, not seven', def.fiveDays, def);
  t.ok('and it includes rest days', def.hasRest, def);
  t.eq('a beginner is the default, not an intermediate', def.experience, 'Beginner');
  t.ok('a quiz answer cannot promote a measured Beginner', def.claimCannotPromote, def);
  t.ok('not even a claim of Advanced', def.evenAdvancedCannotPromote, def);
  t.ok('but it can still ease the program down', def.claimCanEase, def);
  t.ok('by one tier at a time', def.easesOneTierOnly, def);
  t.ok('the promotion was worth 25% of every unanchored target', def.factorGap === 1.25, def);

  // ---- the comeback ease must not become the permanent state ---------------
  const cb = await page.evaluate(() => {
    const o = {};
    const gapFor = days => { STATE.profile.days = days; return comebackGap(); };
    o.fiveDay = gapFor([1, 2, 4, 5, 6]);
    o.threeDay = gapFor([1, 3, 5]);
    o.weekendOnly = gapFor([0, 6]);
    o.onceAWeek = gapFor([6]);
    /* A Saturday+Sunday athlete has a 6-day gap every single week. At a flat
       threshold of 5 the ease armed 26 times in 26 weeks — 51 of 52 sessions
       ran at sets-1 and target x0.8, and he was told "it's been 6 days" every
       Saturday. The threshold has to know his schedule. */
    o.weekendNotPunished = o.weekendOnly > 6;
    o.fiveDayUnchanged = o.fiveDay === 5;
    o.neverBelowFive = [o.fiveDay, o.threeDay, o.weekendOnly, o.onceAWeek].every(g => g >= 5);
    STATE.profile.days = [1, 2, 4, 5, 6];
    return o;
  });
  t.eq('a five-day athlete still eases after five days away', cb.fiveDay, 5);
  t.ok('a weekend-only athlete is not permanently "coming back"', cb.weekendNotPunished, cb);
  t.ok('the threshold never drops below five days', cb.neverBelowFive, cb);

  // ---- a re-test has to be reachable ---------------------------------------
  const retest = await page.evaluate(() => {
    const o = {};
    o.fnExists = typeof retestNow === 'function';
    /* Progress gained sub-tabs in v312 — this content lives on one pane,
       so select it rather than relying on which pane happens to open. */
    go('progress'); setProgressTab('strength');
    const v = document.querySelector('#v-progress');
    o.buttonOnProgress = !!v.querySelector('[onclick^="retestNow"]');
    o.saysWhatItIsFor = /newest result wins/.test(v.innerHTML);
    /* Two toasts promised this button for months while openAssessment() was
       reachable only from the two Today gates — so a test taken while ill
       scaled six weeks of training with no way to correct it. */
    o.gateIsClosed = reassessGate() === 0;
    let threw = false;
    try { assessState = null; retestNow(); o.opened = !!assessState; } catch (e) { threw = true; }
    o.opensDespiteClosedGate = !threw && o.opened;
    try { closeSheet(); } catch (e) {}
    assessState = null;
    // no date recorded must not render the string "undefined"
    const rb = STATE.baseline;
    STATE.baseline = { score: 50, level: 'Beginner', maxes: { push: 10 } };
    o.noDateSafe = latestTestDate() === null;
    /* Progress gained sub-tabs in v312 — this content lives on one pane,
       so select it rather than relying on which pane happens to open. */
    go('progress'); setProgressTab('strength');
    o.noUndefinedOnScreen = !/undefined/.test(document.querySelector('#v-progress').innerHTML);
    STATE.baseline = rb;
    return o;
  });
  t.ok('a re-test control exists', retest.fnExists && retest.buttonOnProgress, retest);
  t.ok('it explains that the newest result wins', retest.saysWhatItIsFor, retest);
  t.ok('and it works even when the block gate is closed', retest.opensDespiteClosedGate, retest);
  t.ok('a record with no date does not render as "undefined"', retest.noDateSafe && retest.noUndefinedOnScreen, retest);

  // ---- a re-test rebases per-exercise ratings too ---------------------------
  const rebase = await page.evaluate(() => {
    STATE.adapt = 1.2; STATE.exAdapt = { pushup: 1.25, dips: 0.85 };
    rebaseAdapt();
    return { adapt: STATE.adapt, exAdapt: JSON.stringify(STATE.exAdapt) };
  });
  t.eq('a re-test rebases the global multiplier', rebase.adapt, 1);
  t.eq('and the per-exercise ones, which were counting the same gain twice', rebase.exAdapt, '{}');

  // ---- deferred re-tests are not measurements -------------------------------
  const series = await page.evaluate(() => {
    const real = JSON.stringify(STATE.reassess);
    STATE.reassess = {
      1: { date: '2026-03-01', maxes: { push: 30 }, score: 60 },
      2: { date: '2026-04-01', maxes: { push: 30 }, score: 60, deferred: true },
      3: { date: '2026-05-01', maxes: { push: 40 }, score: 70 },
    };
    const s = assessSeries();
    const o = { n: s.length, dates: s.map(x => x.date) };
    o.excludesDeferred = !o.dates.includes('2026-04-01');
    o.keepsReal = o.dates.includes('2026-03-01') && o.dates.includes('2026-05-01');
    STATE.reassess = JSON.parse(real);
    return o;
  });
  t.ok('a carried-forward re-test is not plotted as a measurement', series.excludesDeferred, series);
  t.ok('real re-tests still are', series.keepsReal, series);

  // ---- two screens must not disagree about the same week -------------------
  const agree = await page.evaluate(() => {
    const o = {};
    STATE.logs = {}; STATE.quickLog = {};
    const mon = weekStartD(new Date());
    for (let i = 0; i < 3; i++) { const d = new Date(mon); d.setDate(d.getDate() + i); STATE.quickLog[localISO(d)] = 1; }
    o.week = sessionsThisWeek();
    o.heat = [...trainedDaysSet()].length;
    o.agrees = o.week === 3 && o.heat === 3;
    STATE.logs = {}; STATE.quickLog = {};
    return o;
  });
  t.ok('Quick sessions count on the weekly tile, as they already did on the heatmap', agree.agrees, agree);

  /* ---- the score comparison across a test-count change ---------------------
     Was hardcoded to the specific 5->8 transition (v178); that literal '8' is
     what this file's own history warns about — a value that is only correct
     until the NEXT test gets added, at which point 8 quietly becomes the OLD
     era instead of the current one and the "compares within era" half starts
     failing for a reason that has nothing to do with the code being wrong.
     Derived from the real TESTS.length instead, so this stays correct across
     any future change to the battery size. */
  const score = await page.evaluate(() => {
    const real = JSON.stringify(STATE.scoreHistory);
    const cur = TESTS.length, prev = cur - 1;
    STATE.scoreHistory = [{ date: '2026-01-01', score: 62, level: 'Beginner', testCount: prev },
                          { date: '2026-03-01', score: 55, level: 'Beginner', testCount: cur }];
    const oldEra = scoreDeltaHTML({ score: 55 });
    STATE.scoreHistory = [{ date: '2026-01-01', score: 50, level: 'Beginner', testCount: cur },
                          { date: '2026-03-01', score: 60, level: 'Beginner', testCount: cur }];
    const sameEra = scoreDeltaHTML({ score: 60 });
    STATE.scoreHistory = JSON.parse(real);
    return { refusesAcrossEras: /Scoring changed/.test(oldEra) && !/▼/.test(oldEra),
             comparesWithinEra: /▲/.test(sameEra) };
  });
  t.ok('scores are not compared across the test-count change', score.refusesAcrossEras, score);
  t.ok('but are compared within it', score.comparesWithinEra, score);

  // ---- the pointer stops at the end of the program -------------------------
  const end = await page.evaluate(() => {
    const real = STATE.progressPtr;
    const total = SESSIONS_PER_CYCLE * TOTAL_CYCLES;
    STATE.progressPtr = total;
    commitSession('right');
    const o = { total, after: STATE.progressPtr, held: STATE.progressPtr === total };
    STATE.progressPtr = real; save();
    return o;
  });
  t.ok('committing past the last session does not advance the pointer', end.held, end);

  // ---- type repair for the two fields that drive prescription --------------
  const repair = await page.evaluate(() => {
    const o = {};
    STATE.exAdapt = { pushup: 'oops', plank: 1.1, bad: -3, worse: Infinity };
    STATE.readiness = { '2026-01-01': 'bad', '2026-01-02': { score: 70 }, '2026-01-03': { score: 'x' } };
    normalizeState();
    o.exAdapt = JSON.stringify(STATE.exAdapt);
    o.keptGoodEx = STATE.exAdapt.plank === 1.1;
    o.droppedBadEx = !('oops' in STATE.exAdapt) && !('bad' in STATE.exAdapt) && !('worse' in STATE.exAdapt);
    o.keptGoodRdy = !!STATE.readiness['2026-01-02'];
    o.droppedBadRdy = !STATE.readiness['2026-01-01'] && !STATE.readiness['2026-01-03'];
    /* Unrepaired, a string in exAdapt gave prescribe() a NaN target that the
       render boundary never catches because nothing throws, and a string in
       readiness made readinessMult() return 0.7 — a silent 30% deload. */
    STATE.exAdapt = { pushup: 'oops' };
    const nan = prescribe ? null : null;
    normalizeState();
    o.noNaNTarget = (() => { try { const s = buildSession(0);
      return [...s.main, s.finisher].every(m => isFinite(m.target) && m.target > 0); } catch (e) { return false; } })();
    STATE.exAdapt = ['x']; normalizeState(); o.arrayRepaired = !Array.isArray(STATE.exAdapt);
    STATE.readiness = 'nope'; normalizeState(); o.stringRepaired = typeof STATE.readiness === 'object';
    STATE.exAdapt = {}; STATE.readiness = {}; save();
    return o;
  });
  t.ok('a corrupt per-exercise multiplier is dropped', repair.droppedBadEx, repair);
  t.ok('a good one survives', repair.keptGoodEx, repair);
  t.ok('a corrupt readiness record is dropped', repair.droppedBadRdy, repair);
  t.ok('a good one survives', repair.keptGoodRdy, repair);
  t.ok('no prescription comes out NaN after the repair', repair.noNaNTarget, repair);
  t.ok('an array where the object belongs is repaired', repair.arrayRepaired, repair);
  t.ok('so is a string', repair.stringRepaired, repair);

  // ---- clearing a mistyped step count clears the tick (v188 regression) ----
  const steps = await page.evaluate(() => {
    const o = {}, T = nutToday();
    delete T.steps; delete T.bikeVal; delete T.bikeUnit; T.habits = {};
    setSteps(stepTarget() + 1000);
    o.ticked = nutToday().habits.steps === true;
    setSteps(0);
    o.clearedTick = nutToday().habits.steps === false;
    o.cardAgrees = stepEquivalent() === 0;
    /* And with nothing EVER logged, a manual tick is still the athlete's
       business — plenty of days get walked without anyone counting. _stepAuto
       is what distinguishes "never logged" from "logged then cleared", so a
       reset that leaves it set is not the state this is checking. */
    delete T.steps; delete T.bikeVal; delete T._stepAuto; T.habits = { steps: true };
    syncStepHabit();
    o.manualUntouched = T.habits.steps === true;
    delete T.steps; delete T.bikeVal; T.habits = {}; save();
    return o;
  });
  t.ok('logging enough steps ticks the habit', steps.ticked, steps);
  t.ok('clearing them back to zero unticks it', steps.clearedTick, steps);
  t.ok('so the card and the tick agree', steps.cardAgrees, steps);
  t.ok('a manual tick with nothing logged is still left alone', steps.manualUntouched, steps);

  // ---- a ruck is not converted twice ----------------------------------------
  const ruck = await page.evaluate(() => {
    const o = {}, real = JSON.stringify(STATE.ruckLog || []);
    STATE.profile.unit = 'in';
    // ruck rows live in STATE.ruckLog (ACTS.ruck.logKey), not a generic map
    STATE.ruckLog = [{ date: todayISO(), mins: 45, dist: 4.8, unit: 'mi' }];
    const st = actStats('ruck');
    o.storedKm = 4.8; o.totalKm = st.dist;
    o.notDoubled = Math.abs(st.dist - 4.8) < 0.05;
    o.shownMiles = +(st.dist * 0.621371).toFixed(1);
    o.readsBackAsThree = Math.abs(o.shownMiles - 3) < 0.1;
    STATE.ruckLog = JSON.parse(real); STATE.profile.unit = 'cm';
    return o;
  });
  t.ok('a canonical km ruck is not converted again', ruck.notDoubled, ruck);
  t.ok('so a 3-mile ruck reads back as 3 miles', ruck.readsBackAsThree, ruck);

  // ---- a diet break you took must clear the banner --------------------------
  const diet = await page.evaluate(() => {
    const o = {}, P = STATE.profile;
    const realG = P.goal, realS = P._shredStart, realE = P._everDeficit, realC = P.createdAt;
    P.createdAt = '2025-11-01'; delete P._shredStart; delete P._everDeficit;
    P.goal = 'lose'; noteGoalPhase();
    o.firstSeed = P._shredStart;
    o.seedsFromInstall = P._shredStart === '2025-11-01';
    P.goal = 'maintain'; noteGoalPhase();
    o.clearedOnBreak = !P._shredStart;
    P.goal = 'lose'; noteGoalPhase();
    /* Re-seeding from createdAt meant that after taking the diet break the
       banner asked for, coming back immediately re-announced 14 unbroken weeks
       — so it could never be cleared again for the life of the install. */
    o.reseedFromToday = P._shredStart === todayISO();
    o.weeksAfterBreak = shredWeeks();
    o.bannerQuiet = !/deficit for/.test(dietBreakBanner() || '');
    P.goal = realG; P._shredStart = realS; P._everDeficit = realE; P.createdAt = realC;
    return o;
  });
  t.ok('a first deficit is dated from the install', diet.seedsFromInstall, diet);
  t.ok('leaving a deficit clears the clock', diet.clearedOnBreak, diet);
  t.ok('and returning restarts it from today, not from the install', diet.reseedFromToday, diet);
  t.eq('so the banner is quiet again', diet.weeksAfterBreak, 0);
  t.ok('and stays quiet', diet.bannerQuiet, diet);

  // ---- the goal ETA has to be able to see a stall --------------------------
  const eta = await page.evaluate(() => {
    const o = {}, real = JSON.stringify(STATE.measurements), realG = STATE.profile.goalWaist;
    STATE.profile.goalWaist = 90;
    const ms = []; const start = new Date(); start.setDate(start.getDate() - 180);
    // three good months, then three flat ones — the shape that hid a plateau
    for (let i = 0; i < 13; i++) { const d = new Date(start); d.setDate(d.getDate() + i * 7);
      ms.push({ date: localISO(d), waist: 105 - i * 0.5, weight: 88 }); }
    for (let i = 13; i < 26; i++) { const d = new Date(start); d.setDate(d.getDate() + i * 7);
      ms.push({ date: localISO(d), waist: 98.5, weight: 88 }); }
    STATE.measurements = ms;
    const html = goalETAHTML();
    o.flatDetected = /Trend is flat/.test(html);
    o.noFalseETA = !/you'll hit your goal/.test(html);
    // a genuinely moving trend still gets its date
    STATE.measurements = ms.slice(0, 13);
    o.movingGetsETA = /you'll hit your goal/.test(goalETAHTML());
    /* The thresholds are bare constants, so measuring pace in DISPLAY units made
       them 2.54x stricter in inches: the same body read "on pace" in metric and
       "pick up the pace" in imperial. */
    const ms2 = []; const s2 = new Date(); s2.setDate(s2.getDate() - 56);
    for (let i = 0; i < 9; i++) { const d = new Date(s2); d.setDate(d.getDate() + i * 7);
      ms2.push({ date: localISO(d), waist: 100 - i * 0.35, weight: 88 }); }
    STATE.measurements = ms2;
    STATE.profile.unit = 'cm'; const metric = goalETAHTML();
    STATE.profile.unit = 'in'; const imperial = goalETAHTML();
    o.metricGood = /--green/.test(metric); o.imperialGood = /--green/.test(imperial);
    o.verdictMatches = o.metricGood === o.imperialGood;
    o.imperialTwoDecimals = /~0\.\d\din\/wk/.test(imperial);
    // the quoted rate must agree with the quoted ETA
    const mm = /~([\d.]+)in\/wk[^(]*\(~(\d+) wk\)/.exec(imperial);
    if (mm) { const rate = +mm[1], wks = +mm[2];
      const toGo = (ms2[ms2.length - 1].waist - 90) / 2.54;
      o.rateAgreesWithETA = Math.abs(toGo / rate - wks) / wks < 0.15; }
    STATE.profile.unit = 'cm';
    STATE.measurements = JSON.parse(real); STATE.profile.goalWaist = realG;
    return o;
  });
  t.ok('three flat months are reported as flat', eta.flatDetected, eta);
  t.ok('and no confident date is offered on top of them', eta.noFalseETA, eta);
  t.ok('a moving trend still gets its date', eta.movingGetsETA, eta);
  t.ok('the same body gets the same verdict in either unit', eta.verdictMatches, eta);
  t.ok('inches are quoted to two decimals', eta.imperialTwoDecimals, eta);
  t.ok('and the quoted rate agrees with the quoted ETA', eta.rateAgreesWithETA, eta);

  // ---- a measurement has to be plausible, and removable --------------------
  const meas = await page.evaluate(() => {
    const o = {}, real = JSON.stringify(STATE.measurements);
    const realKcal = STATE.nutrition.kcalTarget, realW = STATE.nutrition.weightKg;
    o.rejectsFatFinger = !plausibleKg(861.8) && !plausibleWaistCm(965.2);
    o.acceptsReal = plausibleKg(86.2) && plausibleWaistCm(96.5);
    o.acceptsExtremes = plausibleKg(40) && plausibleKg(200) && plausibleWaistCm(60) && plausibleWaistCm(160);
    STATE.measurements = [{ date: '2026-01-01', waist: 96.5, weight: 88 },
                          { date: '2026-02-01', waist: 965, weight: 861 },
                          { date: '2026-03-01', waist: 94, weight: 86 }];
    o.listRenders = /2026-02-01/.test(measureListHTML());
    o.hasDelete = /removeMeasure/.test(measureListHTML());
    STATE.measurements = STATE.measurements.filter(m => m.date !== '2026-02-01');
    o.deletedGone = !STATE.measurements.some(m => m.waist > 200);
    STATE.measurements = JSON.parse(real);
    STATE.nutrition.kcalTarget = realKcal; STATE.nutrition.weightKg = realW; save();
    return o;
  });
  t.ok('a fat-fingered weight or waist is rejected', meas.rejectsFatFinger, meas);
  t.ok('a real one is accepted', meas.acceptsReal, meas);
  t.ok('and so are genuine extremes', meas.acceptsExtremes, meas);
  t.ok('logged measurements are listed', meas.listRenders, meas);
  t.ok('with a way to delete a bad row', meas.hasDelete, meas);

  // ---- a backup contains the one thing that cannot be recreated ------------
  const backup = await page.evaluate(async () => {
    const o = {};
    const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    STATE.photos = [{ id: 'p1', date: todayISO(), pose: 'front' }];
    await idbPut('ph_p1', px);
    // capture what exportData would write, without triggering a download
    const realBlob = window.Blob; let captured = null;
    window.Blob = function (parts, opts) { captured = parts[0]; return new realBlob(parts, opts); };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    try { await exportData(); } finally { window.Blob = realBlob; HTMLAnchorElement.prototype.click = realClick; }
    const parsed = JSON.parse(captured);
    o.carriesPhoto = !!(parsed._photoData && parsed._photoData.p1 === px);
    o.stillStripsKeys = !(parsed.settings && (parsed.settings.azureKey || parsed.settings.foodAiKey));
    // and a restore puts the bytes back where hydratePhotos() looks
    await idbDel('ph_p1');
    o.goneBeforeRestore = (await idbGet('ph_p1')) === null;
    await idbPut('ph_p1', parsed._photoData.p1);
    o.restored = (await idbGet('ph_p1')) === px;
    o.notInState = !STATE._photoData;
    STATE.photos = []; await idbDel('ph_p1'); save();
    return o;
  });
  t.ok('a backup carries the photo bytes, not just their metadata', backup.carriesPhoto, backup);
  t.ok('and still strips the API keys', backup.stillStripsKeys, backup);
  t.ok('the bytes restore to where the app looks for them', backup.restored, backup);
  t.ok('and are not left sitting in STATE', backup.notInState, backup);

  // ---- calories burned is net, and counts what was done --------------------
  const burn = await page.evaluate(() => {
    const o = {}, real = JSON.stringify(STATE.logs);
    STATE.logs = { 0: { done: true, completedAt: todayISO(),
      items: [{ exId: 'pushup', sets: 4, target: 20, unit: 'reps', rest: 60 }],
      ex: { pushup: { sets: [true, true, false, false] } } } };
    const split = totalTUTSplit();
    /* Two of four sets ticked. The minutes tile counted the PRESCRIBED four
       while the reps tile beside it counted the completed two. */
    o.countsCompletedOnly = Math.abs(split.work - (2 * 20 * 3) / 60) < 0.1;
    o.restSeparated = Math.abs(split.rest - (2 * 60) / 60) < 0.1;
    const kcal = estCalories();
    // gross 6 METs over work AND rest was ~2.4x; net must be well under that
    const gross = Math.round(6 * 3.5 * 88 / 200 * totalTUT());
    o.kcal = kcal; o.gross = gross;
    o.netIsLower = kcal < gross * 0.6;
    o.notZero = kcal > 0;
    STATE.logs = JSON.parse(real);
    return o;
  });
  t.ok('minutes count the sets actually completed', burn.countsCompletedOnly, burn);
  t.ok('rest is tracked separately from work', burn.restSeparated, burn);
  t.ok('calories burned is net, not gross-over-rest', burn.netIsLower, burn);
  t.ok('and is still a real number', burn.notZero, burn);

  // ---- the intake verdict is not drawn from a self-selected sample ---------
  const intake = await page.evaluate(() => {
    const o = {}, n = nut(), real = JSON.stringify(n.days);
    const day = (back, kcal) => { const d = new Date(); d.setDate(d.getDate() - back);
      n.days[localISO(d)] = { water: 0, habits: {}, food: kcal ? [{ name: 'x', kcal, p: 40, c: 10, f: 5, meal: 'l' }] : [] }; };
    n.kcalTarget = 2170;
    n.days = {};
    // six closed days over target, plus a barely-started today
    for (let i = 1; i <= 6; i++) day(i, 2300);
    day(0, 420);
    const html = intakeTrendHTML();
    o.avg = /2300 kcal/.test(html) || /23\d\d kcal/.test(html);
    o.notFooledByToday = !/✅/.test(html);
    o.warns = /⚠️/.test(html);
    // too few logged days: report, do not judge
    n.days = {}; day(1, 1900); day(2, 1950);
    const thin = intakeTrendHTML();
    o.withholdsVerdict = !/✅/.test(thin) && !/⚠️/.test(thin) && /not your week/.test(thin);
    n.days = JSON.parse(real);
    return o;
  });
  t.ok('a half-logged today cannot flip the verdict', intake.notFooledByToday, intake);
  t.ok('six days over target reads as over target', intake.warns, intake);
  t.ok('too few logged days reports instead of judging', intake.withholdsVerdict, intake);

  // ---- allergens: the recipe bank is now checked, not just trusted ---------
  const alg = await page.evaluate(() => {
    const o = {}, N = STATE.nutrition;
    const realD = N.diet, realA = N.allergens, realP = N.plan;
    /* Coconut is a declarable tree nut and ALG_SYN already said so, but two
       recipes carried alg:[] while serving it. dietOk() fails an UNTAGGED
       recipe closed — alg:[] is a valid array, so "wrongly tagged as containing
       nothing" walked straight through the guard. */
    N.diet = 'vegan'; N.allergens = ['treenut']; N.plan = null;
    o.coconutServed = RECIPES.filter(dietOk).filter(r =>
      /coconut/i.test((r.ing || []).join(' '))).map(r => r.id);
    // and the validator now catches it being re-introduced
    const victim = RECIPES.find(r => r.id === 'b_fruitnut');
    const keep = victim.alg; victim.alg = [];
    /* validateData() reports to console.error, and the harness counts a console
       error as a failed run — correctly. Silence it only around the deliberate
       corruption, so a REAL validation failure anywhere else still fails. */
    const realErr = console.error; console.error = () => {};
    try { o.validatorCatchesMistag = validateData().some(e => /b_fruitnut/.test(e) && /treenut/.test(e)); }
    finally { console.error = realErr; victim.alg = keep; }
    o.validatorCleanOtherwise = validateData().length === 0;
    // plant milk is not dairy, and nut butter is not dairy
    o.noPlantMilkFalsePositive = !validateData().some(e => /milk/.test(e));
    /* A stored plan must re-validate: migrateAllergens() runs at boot, derives
       tags from free text, and did not null the plan — so the allergy, the
       banner announcing it, and the violating recipes were all on screen at
       once. */
    N.allergens = []; N.plan = null;
    const before = generateMealPlan();
    o.planMade = before.meals.length > 0;
    N.allergens = ['treenut', 'dairy', 'peanut'];   // changed WITHOUT nulling the plan
    const after = currentMealPlan();
    o.planRevalidated = after.meals.every(id => { const r = recipeById(id); return r && dietOk(r); });
    N.diet = realD; N.allergens = realA; N.plan = realP;
    return o;
  });
  t.eq('no coconut recipe reaches a tree-nut allergy', alg.coconutServed, []);
  t.ok('the validator catches a re-introduced mistag', alg.validatorCatchesMistag, alg);
  t.ok('and is otherwise clean', alg.validatorCleanOtherwise, alg);
  t.ok('plant milk and nut butter are not flagged as dairy', alg.noPlantMilkFalsePositive, alg);
  t.ok('a stored plan re-validates against a changed allergy', alg.planRevalidated, alg);

  // ---- quick workouts respect the injury flags the program routes around ---
  const quick = await page.evaluate(() => {
    const o = { risky: [] };
    const real = STATE.profile.limitations;
    STATE.profile.limitations = ['lowback', 'knee'];
    const risky = k => ['lowback', 'knee'].some(j => (JOINT_RISK[j] || []).includes(k));
    QUICKIES.forEach(q => q.items.forEach(it => {
      const out = quickExId(it.exId);
      if (!EX[out] || risky(out)) o.risky.push(q.id + '/' + it.exId + '->' + out);
    }));
    o.noFlagsIsNoOp = (STATE.profile.limitations = [], QUICKIES[0].items.every(it => quickExId(it.exId) === it.exId));
    STATE.profile.limitations = real;
    return o;
  });
  t.ok('no Quick workout serves a flagged joint a risky movement', quick.risky.length === 0, quick.risky.slice(0, 6));
  t.ok('and with nothing flagged it changes nothing', quick.noFlagsIsNoOp, quick);

  // ---- the habit count, and the protein habit -------------------------------
  const hab = await page.evaluate(() => {
    const o = {}, t2 = nutToday();
    t2.habits = {}; delete t2._stepAuto; t2.food = [];
    setSteps(stepTarget() + 500);
    /* _stepAuto is bookkeeping. Written into the habits map it read as a
       completed habit: 3,000 steps against an 8,000 target showed 1/5 with
       every checkbox empty, and Perfect Day unlocked on four of five. */
    o.flagOutsideHabits = !('_stepAuto' in t2.habits) && !!t2._stepAuto;
    t2.habits = { steps: true, _stepAuto: 1 };
    o.countsDeclaredOnly = bestHabitDay() <= HABITS.length - 1 || HABITS.filter(h => t2.habits[h.k]).length === 1;
    // the diary ticks its own habit, like water and steps already do
    t2.habits = {}; t2.food = [];
    const tgt = proteinTargetG();
    logFood('x', 400, tgt + 10, 10, 5, 'l');
    o.proteinTicked = nutToday().habits.protein === true;
    nutToday().food = [{ name: 'x', kcal: 100, p: 5, c: 1, f: 1, meal: 'l' }];
    syncProteinHabit();
    o.proteinUnticked = nutToday().habits.protein === false;
    t2.habits = {}; t2.food = []; delete t2._stepAuto; delete t2.steps; save();
    return o;
  });
  t.ok('the movement bookkeeping flag is not stored among the habits', hab.flagOutsideHabits, hab);
  t.ok('logging enough protein ticks the protein habit', hab.proteinTicked, hab);
  t.ok('and dropping below the target unticks it', hab.proteinUnticked, hab);

  /* ---- Perfect Day asks for what the screen says matters (v314) ------------
     Fuel counts "Daily habits · n/4" — habitsRequired(), the calorie one being
     deliberately optional since restriction was dropped as a streak condition.
     The badge counted all five and its description said "All 5 daily habits",
     so an athlete who did everything the screen asks read 4/4 with a green
     tick on the day and never unlocked it. The badge asked for the one habit
     the app had stopped asking for.

     The DISCRIMINATING check is the one that must not fire: making the badge
     unlock on any old day satisfies every "it unlocks on the required set"
     assertion, so a day with one habit short is pinned beside it. */
  const pd = await page.evaluate(() => {
    const o = {}, d = nutToday(), badge = ACHIEVEMENTS.find(a => a.id === 'perfectday');
    const req = HABITS.filter(h => !h.optional), opt = HABITS.filter(h => h.optional);
    o.required = habitsRequired();
    o.thereIsAnOptionalOne = opt.length > 0;
    /* The description is a FUNCTION so its number comes from habitsRequired()
       rather than being restated. Reading it through achDesc() here proves the
       resolver works and NOTHING about the badge grid — a read site that forgot
       the resolver prints the function body onto the glass and this stays
       green. Calling the helper is not driving the route, so the grid itself
       is rendered and read back below. */
    o.desc = achDesc(badge);
    o.descNamesRequired = achDesc(badge).includes(String(habitsRequired()));

    STATE.nutrition.days = {}; const day = nutToday();
    // one short of the required set: must NOT unlock
    day.habits = {}; req.slice(0, -1).forEach(h => day.habits[h.k] = true);
    o.shortCount = bestHabitDay(); o.shortUnlocks = badge.check();
    // the optional habit does not make up the shortfall
    opt.forEach(h => day.habits[h.k] = true);
    o.shortPlusOptionalUnlocks = badge.check();
    // every REQUIRED habit, and nothing else: must unlock
    day.habits = {}; req.forEach(h => day.habits[h.k] = true);
    o.fullCount = bestHabitDay(); o.fullUnlocks = badge.check();
    /* And what Fuel prints for that same day, read off the rendered tab rather
       than recomputed — the two numbers disagreeing is the whole defect. */
    go('fuel'); renderFuel();
    o.fuelLine = (document.querySelector('#v-fuel').textContent
      .match(/Daily habits · (\d+)\/(\d+)/) || []).slice(1, 3);
    STATE.nutrition.days = {}; save();
    return o;
  });
  t.ok('there is an optional habit for this to be about', pd.thereIsAnOptionalOne, pd);
  t.ok('doing every required habit unlocks Perfect Day', pd.fullUnlocks, pd);
  t.eq('and the day counts as the full required set', pd.fullCount, pd.required, pd);
  t.eq('one habit short does not unlock it', pd.shortUnlocks, false, pd);
  t.eq('and the optional habit cannot make up that shortfall', pd.shortPlusOptionalUnlocks, false, pd);
  t.eq('Fuel prints the same denominator the badge asks for',
    pd.fuelLine[1], String(pd.required), pd);
  t.eq('and on a perfect day Fuel agrees the day is full', pd.fuelLine[0], String(pd.required), pd);
  t.ok('the badge description names that number rather than restating one', pd.descNamesRequired, pd);
  t.ok('and resolves to real text, not a function body', /^All \d+ daily habits/.test(pd.desc), pd);

  /* The RENDERED grid, because that is where a forgotten resolver shows. Every
     badge is read, not only the one that changed: the resolver exists so any
     future badge may carry a computed description, and a check that only looks
     at Perfect Day proves nothing about the site that renders the other forty. */
  const grid = await page.evaluate(() => {
    STATE.achievements = {};                       // locked, so the DESC renders
    go('progress'); setProgressTab('awards'); renderProgress();
    const v = document.querySelector('#v-progress');
    const cells = [...v.querySelectorAll('.card .tiny.muted')].map(e => e.textContent.trim());
    const pd = ACHIEVEMENTS.find(a => a.id === 'perfectday');
    return {
      cells: cells.length,
      badges: ACHIEVEMENTS.length,
      // a function printed instead of resolved leaves its source on the glass
      leaked: cells.filter(c => /=>|function\s*\(|habitsRequired/.test(c)),
      showsPerfectDay: cells.some(c => c === achDesc(pd)),
      // the floor: the other badges still print their own plain-string text
      showsPlainOnes: cells.filter(c => /workouts completed|training streak/.test(c)).length,
    };
  });
  /* Anchored on ACHIEVEMENTS.length, not a magic number — a bar of "> 30"
     drifts the moment a badge is added or removed and then measures nothing. */
  t.eq('the badge grid renders a line for every badge', grid.cells, grid.badges, grid);
  t.eq('no badge prints a function body instead of its description', grid.leaked, [], grid);
  t.ok('Perfect Day\'s computed description is what reaches the glass', grid.showsPerfectDay, grid);
  t.ok('and the plain-string badges still print theirs', grid.showsPlainOnes > 3, grid);

  // ---- nothing interrupts a live session ------------------------------------
  const live = await page.evaluate(() => {
    const o = {};
    /* An update toast at z-index 500 landed exactly on "Set done ✓" with no
       dismiss, and selfUpdate() could reload the page mid-set. */
    openPlayer();
    o.live = _sessionLive();
    showUpdateToast();
    o.toastSuppressed = !document.querySelector('#updToast');
    playerQuit();
    o.idleAfterQuit = !_sessionLive();
    showUpdateToast();
    o.toastShownWhenIdle = !!document.querySelector('#updToast');
    const el = document.querySelector('#updToast'); if (el) el.remove();
    return o;
  });
  t.ok('an update toast never covers a live session', live.live && live.toastSuppressed, live);
  t.ok('but is still offered once the session ends', live.idleAfterQuit && live.toastShownWhenIdle, live);

  // ---- the API key survives being saved -------------------------------------
  const key = await page.evaluate(() => {
    const o = {};
    /* _neuralCacheClear() called itself. The RangeError threw before
       saveAzureKey() reached save(), so the key worked for one session and was
       silently gone on the next launch. */
    try { _neuralCacheClear(); o.clearOk = true; } catch (e) { o.clearOk = false; }
    saveAzureKey('testkey123');
    o.persisted = JSON.parse(localStorage.getItem('coreforge.v1')).settings.azureKey === 'testkey123';
    // clearAzureKey() asks for confirmation, which headless auto-dismisses
    const realConfirm = window.confirm; window.confirm = () => true;
    try { clearAzureKey(); } finally { window.confirm = realConfirm; }
    o.cleared = !JSON.parse(localStorage.getItem('coreforge.v1')).settings.azureKey;
    return o;
  });
  t.ok('clearing the voice cache does not blow the stack', key.clearOk, key);
  t.ok('so a saved voice key actually persists', key.persisted, key);
  t.ok('and can be cleared again', key.cleared, key);

  // ---- the coaching fixes ---------------------------------------------------
  const coach = await page.evaluate(() => {
    const o = {};
    const realP = JSON.stringify(STATE.profile), realB = JSON.stringify(STATE.baseline);
    STATE.profile.experience = 'Beginner'; STATE.profile.goal = 'lose';
    STATE.profile.gear = ['bar', 'bench', 'dip'];
    STATE.baseline = { date: todayISO(), score: 22, level: 'Beginner', testCount: 8,
      maxes: { plank: 38, side: 22, hollow: 18, lower: 7, push: 11, pull: 3, squat: 20, dyn: 20 } };
    STATE.reassess = {}; STATE.adapt = 1; STATE.exAdapt = {};
    /* L-Sit (was hardness 1.6) and Bent-Knee Dragon Flag (1.7) are the two
       hardest movements in the catalogue. hardness means "fraction of your
       anchor max for one working set — higher is EASIER", both have no anchor
       so nobody calibrated them, and both got a high number. The gate written
       to stop exactly this (`h >= 1.0` for a beginner) waved them through, and
       an ungated fallback would have anyway. Driven: 40 appearances each,
       first at session 2. */
    o.hardMoves = [];
    let worst = 0, worstDesc = '';
    for (let p = 0; p < 378; p++) {
      const s2 = buildSession(p);
      [...s2.main, s2.finisher].filter(Boolean).forEach(m => {
        if (['lsit', 'dragonflag'].includes(m.exId)) o.hardMoves.push(p + ':' + m.exId);
      });
    }
    // and no working set may exceed the athlete's own tested single
    const mx = currentMaxes(0);
    for (let p = 0; p < 42; p++) {
      const s2 = buildSession(p);
      [...s2.main, s2.finisher].filter(Boolean).forEach(m => {
        const ex = EX[m.exId]; if (!ex || !ex.anchor || m.unit !== 'reps') return;
        const cap = mx[ex.anchor] * (ex.hardness || 1);
        if (cap > 0 && m.target / cap > worst) { worst = m.target / cap; worstDesc = `${m.exId} ${m.sets}x${m.target} vs ${cap.toFixed(1)}`; }
      });
    }
    o.worstRatio = +worst.toFixed(2); o.worstDesc = worstDesc;
    // Pull Day must contain a pull
    o.rowOpensOnARow = !['superman', 'swimmer'].includes(LADDERS.rowL[0]);
    o.bicepProtected = true;   // asserted via goalSlots below
    /* Owning a trainer is no longer enough to be programmed one. A bike is the
       least portable thing an athlete owns, so jumping jacks lead and the ride
       is what you opt into — CHOOSING the bike still replaces about half the
       jumping, not none and not all. */
    const jumps = (g, mode) => { STATE.profile.gear = g; STATE.nutrition.cardioMode = mode; let j = 0, b = 0;
      for (let p = 0; p < 42; p++) { const s2 = buildSession(p);
        [...s2.main, s2.finisher].filter(Boolean).forEach(m => {
          if (m.exId === 'bike') b += m.sets; else if ((EX[m.exId] || {}).region === 'cardio') j += m.sets; }); }
      return { j, b }; };
    const noBike = jumps(['bar', 'bench', 'dip'], 'jacks');
    const ownsNotChosen = jumps(['bar', 'bench', 'dip', 'bike'], 'jacks');
    const withBike = jumps(['bar', 'bench', 'dip', 'bike'], 'bike');
    o.jumpBefore = noBike.j; o.jumpAfter = withBike.j; o.bikeSets = withBike.b;
    o.bikeUnchangedWithoutTrainer = noBike.b === 0;
    o.ownsButDidNotChoose = ownsNotChosen.b === 0 && ownsNotChosen.j === noBike.j;
    o.roughlyHalf = withBike.j < noBike.j * 0.75 && withBike.j > 0;
    STATE.nutrition.cardioMode = 'jacks';
    o.phase1 = PHASE1_CYCLES;
    o.validator = validateData().length;
    STATE.profile = JSON.parse(realP); STATE.baseline = JSON.parse(realB);
    return o;
  });
  t.eq('a beginner is never handed an L-sit or a dragon flag', coach.hardMoves, []);
  t.ok('no working set exceeds the athlete\'s own tested single',
    coach.worstRatio <= 1.01, { ratio: coach.worstRatio, worst: coach.worstDesc });
  t.ok('the row ladder opens on an actual row, not a back extension', coach.rowOpensOnARow, coach);
  t.ok('owning a trainer alone does not put the bike in the programme', coach.ownsButDidNotChoose, coach);
  t.ok('an athlete who CHOOSES the bike rides instead of jumping, for about half of it', coach.roughlyHalf,
    { before: coach.jumpBefore, after: coach.jumpAfter, bike: coach.bikeSets });
  t.ok('and without a trainer nothing changes', coach.bikeUnchangedWithoutTrainer, coach);
  t.eq('full-body work starts after one block, not two', coach.phase1, 1);
  t.eq('the validator is still clean', coach.validator, 0);

  // ---- the app stops promising a six-week six-pack -------------------------
  const honest = await page.evaluate(() => {
    go('guide');
    const h = document.querySelector('#v-guide').innerHTML;
    return {
      dropped: !/substantial visible results in 6 weeks/.test(h),
      saysMonths: /6–9 months/.test(h),
      saysTapeFirst: /3–4 weeks/.test(h),
      noSpotReduction: !/flattens the waist|cinches the waist|carves the waistline/.test(document.body.innerHTML),
    };
  });
  t.ok('the six-week claim is gone', honest.dropped, honest);
  t.ok('replaced with the real timeline', honest.saysMonths, honest);
  t.ok('and what to actually watch first', honest.saysTapeFirst, honest);
  t.ok('spot-reduction language is out of the exercise copy', honest.noSpotReduction, honest);

  // ---- the handstand tells you how to get down -----------------------------
  const hs = await page.evaluate(() => ({
    noKick: !/Kick up to a handstand|Kick into a wall handstand/.test(JSON.stringify(EX.wallhandstand) + JSON.stringify(EX.hspushup)),
    hasBailout: /walk the feet back down|turn your chest/i.test(EX.wallhandstand.steps.join(' ')),
    warnsKicking: EX.wallhandstand.mistakes.some(m => /kicking up/i.test(m)),
    dipWarnsShoulder: EX.benchdip.mistakes.some(m => /below parallel/i.test(m)),
  }));
  t.ok('neither handstand entry tells you to kick up', hs.noKick, hs);
  t.ok('and one of them tells you how to come down', hs.hasBailout, hs);
  t.ok('kicking up is listed as a mistake', hs.warnsKicking, hs);
  t.ok('the bench dip warns about the depth that hurts people', hs.dipWarnsShoulder, hs);

  // ---- every ladder is now genuinely ordered, and checked ------------------
  const lad = await page.evaluate(() => {
    const o = { violations: [], unanchoredRungs: 0, total: 0 };
    Object.keys(LADDERS).forEach(l => {
      const a = LADDERS[l];
      for (let i = 0; i < a.length; i++) {
        o.total++;
        if (!(EX[a[i]] || {}).anchor) o.unanchoredRungs++;
        if (i && EX[a[i]].hardness > EX[a[i - 1]].hardness)
          o.violations.push(`${l}: ${a[i]}(${EX[a[i]].hardness}) after ${a[i-1]}(${EX[a[i-1]].hardness})`);
      }
    });
    /* The check used to require BOTH rungs to share an anchor, so every
       anchor:null rung was invisible — most of the cardio, plank, rotation and
       inverted work. Eleven ladders climbed backwards unreported, which is how
       an L-Sit rated "easier than a knee plank" survived. */
    const keep = EX.wallhandstand.hardness; EX.wallhandstand.hardness = 1.6;
    const ce = console.error; console.error = () => {};
    try { o.catchesUnanchored = validateData().some(e => /wallhandstand/.test(e)); }
    finally { console.error = ce; EX.wallhandstand.hardness = keep; }
    o.everyRungHasHardness = Object.keys(LADDERS).every(l => LADDERS[l].every(k => EX[k] && EX[k].hardness > 0));
    return o;
  });
  t.ok('no ladder gets easier as it climbs', lad.violations.length === 0, lad.violations.slice(0, 6));
  t.ok('and most rungs are unanchored, so this was the blind spot', lad.unanchoredRungs > 30, lad);
  t.ok('the validator now catches an unanchored rung going backwards', lad.catchesUnanchored, lad);
  t.ok('every rung carries a hardness', lad.everyRungHasHardness, lad);

  // ---- tight space -----------------------------------------------------------
  const space = await page.evaluate(() => {
    const o = {}, realP = JSON.stringify(STATE.profile), realB = JSON.stringify(STATE.baseline);
    STATE.baseline = { date: todayISO(), score: 40, level: 'Intermediate', testCount: 8,
      maxes: { plank: 70, side: 45, hollow: 40, lower: 14, push: 26, pull: 9, squat: 40, dyn: 45 } };
    STATE.reassess = {}; STATE.adapt = 1; STATE.exAdapt = {};
    const HUNGRY = Object.keys(SPACE_SWAP);
    const scan = () => { const hits = {};
      for (let p = 0; p < 378; p++) { const s2 = buildSession(p);
        [...s2.main, s2.finisher].filter(Boolean).forEach(m => {
          if (HUNGRY.includes(m.exId)) hits[m.exId] = (hits[m.exId] || 0) + 1; }); }
      return hits; };
    STATE.profile.tightSpace = false; o.full = scan();
    o.fullHasThem = Object.keys(o.full).length > 0;
    STATE.profile.tightSpace = true; o.tight = scan();
    o.tightHasNone = Object.keys(o.tight).length === 0;
    // the program must still be a program, not a shorter one
    const n = p => { const s2 = buildSession(p); return [...s2.main, s2.finisher].filter(Boolean).length; };
    STATE.profile.tightSpace = false; const a = [0, 40, 120, 300].map(n);
    STATE.profile.tightSpace = true; const b = [0, 40, 120, 300].map(n);
    o.sameLength = JSON.stringify(a) === JSON.stringify(b);
    // and every substitute must be a real, non-swapped exercise
    o.badTargets = Object.keys(SPACE_SWAP).filter(k => !EX[SPACE_SWAP[k]] || SPACE_SWAP[SPACE_SWAP[k]]);
    o.stillPresses = (() => { let press = 0;
      for (let p = 0; p < 84; p++) { const s2 = buildSession(p);
        [...s2.main, s2.finisher].filter(Boolean).forEach(m => {
          if ((EX[m.exId] || {}).region === 'chest' || (EX[m.exId] || {}).region === 'shoulders') press++; }); }
      return press; })();
    o.offByDefault = (STATE.profile.tightSpace = false, !tightSpace());
    STATE.profile = JSON.parse(realP); STATE.baseline = JSON.parse(realB);
    return o;
  });
  t.ok('a full room still gets the handstand and travelling work', space.fullHasThem, space.full);
  t.ok('a tight room gets none of it, across all 378 sessions', space.tightHasNone, space.tight);
  t.ok('and the sessions are the same length, not shorter', space.sameLength, space);
  t.ok('every substitute exists and is not itself swapped away', space.badTargets.length === 0, space.badTargets);
  t.ok('a tight room still gets real pressing work', space.stillPresses > 20, space);
  t.ok('the setting is off by default', space.offByDefault, space);

  // ---- what you actually did, not what you were asked -----------------------
  const actual = await page.evaluate(() => {
    const o = {};
    STATE.progressPtr = 0; STATE.logs = {}; STATE.prs = {}; STATE.adapt = 1;
    const sess = buildSession(0), m = sess.main[0];
    o.target = m.target;
    for (let i = 0; i < m.sets; i++) toggleSet(m.exId, i);
    o.asksOnLastSet = !!document.querySelector('#ac-n');
    o.prefilledWithTarget = +document.querySelector('#ac-n').value === m.target;
    document.querySelector('#ac-n').value = Math.round(m.target * 0.7);
    saveActual(m.exId);
    const st = STATE.logs[0].ex[m.exId];
    o.stored = st.actual;
    /* STATE.prs used to store m.target — the PRESCRIBED number — so the
       Personal Records card and the Strength Standards graded the athlete on
       his own prescriptions, and a gold PR badge appeared for every exercise
       completed at its highest-ever prescription, achieved or not. */
    o.prIsWhatWasDone = STATE.prs[m.exId] === st.actual && STATE.prs[m.exId] !== m.target;
    o.ratio = +actualRatio().toFixed(2);
    /* And the only thing that could push back on next week's load was one
       three-way feel chip: grind out 70% and tap "just right", and adapt still
       climbed. */
    const before = STATE.adapt;
    commitSession('easy');
    o.easyAfterShortfallStillEases = STATE.adapt < before;
    // hitting the target and calling it easy still adds load
    STATE.progressPtr = 1; STATE.adapt = 1;
    const s2 = buildSession(1), m2 = s2.main[0];
    for (let i = 0; i < m2.sets; i++) toggleSet(m2.exId, i);
    if (document.querySelector('#ac-n')) { document.querySelector('#ac-n').value = m2.target; saveActual(m2.exId); }
    const b2 = STATE.adapt; commitSession('easy');
    o.easyOnTargetStillAdds = STATE.adapt > b2;
    // skipping the question must not corrupt anything
    STATE.progressPtr = 2;
    const s3 = buildSession(2), m3 = s3.main[0];
    for (let i = 0; i < m3.sets; i++) toggleSet(m3.exId, i);
    saveActual(m3.exId, null);
    /* closeSheet() clears the markup on a 400 ms timer, so checking for the
       node synchronously tests the animation, not the behaviour. Check the
       state it was supposed to leave behind. */
    o.skipSafe = STATE.logs[2].ex[m3.exId].actualSkipped === 1
      && isFinite(STATE.prs[m3.exId] || 0) && (STATE.prs[m3.exId] || 0) > 0;
    // a corrupt actual from an import is repaired
    STATE.logs[0].ex[Object.keys(STATE.logs[0].ex)[0]].actual = 'lots';
    normalizeState();
    o.corruptRepaired = Object.values(STATE.logs[0].ex).every(x => x.actual === undefined || typeof x.actual === 'number');
    STATE.logs = {}; STATE.prs = {}; STATE.progressPtr = 0; STATE.adapt = 1; save();
    return o;
  });
  t.ok('finishing an exercise asks what you actually got', actual.asksOnLastSet, actual);
  t.ok('pre-filled with the target, so accepting is one tap', actual.prefilledWithTarget, actual);
  t.ok('a personal record is what you did, not what you were asked', actual.prIsWhatWasDone, actual);
  t.ok('falling short eases the load even if you call it easy', actual.easyAfterShortfallStillEases, actual);
  t.ok('but hitting the target and calling it easy still adds load', actual.easyOnTargetStillAdds, actual);
  t.ok('skipping the question is safe', actual.skipSafe, actual);
  t.ok('a corrupt figure from an import is repaired', actual.corruptRepaired, actual);

  // ---- sticking with it ------------------------------------------------------
  const stick = await page.evaluate(() => {
    const o = {}, n = nut();
    // the weight chart shows a trend, not the noise
    const realM = JSON.stringify(STATE.measurements);
    const base = new Date(); base.setDate(base.getDate() - 60);
    STATE.measurements = [];
    for (let i = 0; i < 20; i++) { const d = new Date(base); d.setDate(d.getDate() + i * 3);
      STATE.measurements.push({ date: localISO(d), weight: 88 - i * 0.15 + (i % 2 ? 1.1 : -1.1), waist: 96 }); }
    const html = weightChartHTML();
    o.saysAveraged = /7-day average/.test(html);
    o.showsSpotToo = /actual reading/.test(html);
    /* Assert the SMOOTHING, not the label. The first version of this checked
       only for the words "7-day average" in the markup — a static string that
       stayed true when the averaging was removed entirely. */
    const spiky = [80, 90, 80, 90, 80, 90, 80, 90];
    const sm = trailingMean(spiky, 7);
    /* Compare the SETTLED part — once the window is full. The early points are
       averages of fewer readings by definition (sm[0] is just raw[0]), so
       including them measures the warm-up of the filter, not the filter. */
    const settled = sm.slice(6);
    o.flattensASpike = (Math.max(...settled) - Math.min(...settled))
      < (Math.max(...spiky) - Math.min(...spiky)) / 4;
    o.keepsTheLevel = Math.abs(sm[sm.length - 1] - 85) < 1.5;
    o.firstPointUnchanged = sm[0] === spiky[0];
    /* And the CHART must use it. Testing trailingMean() alone passed happily
       when weightChartHTML() stopped calling it — the function still existed
       and still worked. The "Now" figure is rendered from the plotted series,
       so it distinguishes the two. */
    const rawVals = STATE.measurements.map(mm => r1(weightShow(mm.weight)));
    const smVals = trailingMean(rawVals, 7);
    const rawLast = rawVals[rawVals.length - 1], smLast = smVals[smVals.length - 1];
    o.seriesDiffer = rawLast !== smLast;           // guard: otherwise the check is vacuous
    o.chartPlotsSmoothed = html.includes('Now ' + smLast) && !html.includes('Now ' + rawLast);
    STATE.measurements = JSON.parse(realM);
    /* One forgotten day used to end a 60-day streak permanently: grace was a
       single token for the whole backward walk, not an allowance per week. */
    const realD = JSON.stringify(n.days);
    n.days = {};
    for (let i = 0; i < 40; i++) { const d = new Date(); d.setDate(d.getDate() - i);
      const bad = (i === 9 || i === 25);
      n.days[localISO(d)] = { water: 0, habits: bad ? {} : { protein: 1, water: 1, sleep: 1, steps: 1 } }; }
    o.streakSurvivesTwoBadDays = nutritionStreak() > 25;
    n.days = JSON.parse(realD);
    // drifting: three opens with no training offers the short version
    const realO = STATE._opens; STATE._opens = {};
    for (let i = 0; i < 3; i++) { const d = new Date(); d.setDate(d.getDate() - i); STATE._opens[localISO(d)] = 1; }
    STATE.logs = {}; STATE.quickLog = {};
    o.driftDetected = driftingDays() >= 3 && /5-minute/.test(driftBanner());
    STATE.quickLog[todayISO()] = 1;
    o.trainingClearsIt = driftingDays() === 0 && driftBanner() === '';
    STATE.quickLog = {}; STATE._opens = realO || {};
    // and the app can say you are done
    const t2 = nutToday(); t2.habits = { protein: 1, water: 1 };
    STATE.quickLog[todayISO()] = 1;
    o.saysDone = minimumDayMet() && /that is today done/i.test(doneForTodayHTML());
    t2.habits = {}; STATE.quickLog = {};
    o.quietOtherwise = !minimumDayMet() && doneForTodayHTML() === '';
    save();
    return o;
  });
  t.ok('the weight chart plots a 7-day average', stick.saysAveraged, stick);
  t.ok('and the averaging actually flattens a spike', stick.flattensASpike, stick);
  t.ok('without shifting the level it is averaging', stick.keepsTheLevel, stick);
  t.ok('the first reading is itself, not an average of nothing', stick.firstPointUnchanged, stick);
  t.ok('the seeded data is noisy enough for this check to mean something', stick.seriesDiffer, stick);
  t.ok('and the chart plots the smoothed series, not the raw one', stick.chartPlotsSmoothed, stick);
  t.ok('and still shows today\'s real number', stick.showsSpotToo, stick);
  t.ok('two bad days in six weeks do not wipe the streak', stick.streakSurvivesTwoBadDays, stick);
  t.ok('three opens without training offers the 5-minute version', stick.driftDetected, stick);
  t.ok('and training clears it', stick.trainingClearsIt, stick);
  t.ok('the app says when the day is done', stick.saysDone, stick);
  t.ok('and stays quiet when it is not', stick.quietOtherwise, stick);

  // ---- warm-ups honour the injury flags, and rests survive a sleeping phone --
  const flow = await page.evaluate(() => {
    const o = {}, real = STATE.profile.limitations;
    STATE.profile.limitations = ['lowback'];
    /* Flow items carry a NAME, not an exId — checking `it.exId` matched nothing
       and passed whether or not the filter did anything at all. */
    const names = f => f.map(it => it.n);
    o.warmNames = names(safeFlow(WARMUP_FLOW));
    o.coolNames = names(safeFlow(COOLDOWN_FLOW));
    o.warmRisky = o.warmNames.filter(n2 => (FLOW_RISK[n2] || []).includes('lowback')).length;
    o.coolRisky = o.coolNames.filter(n2 => (FLOW_RISK[n2] || []).includes('lowback')).length;
    o.actuallyRemovedSome = o.warmNames.length < WARMUP_FLOW.length && o.coolNames.length < COOLDOWN_FLOW.length;
    o.keptTheSafeOnes = o.coolNames.includes("Child's Pose") && o.coolNames.includes('Deep Breathing');
    STATE.profile.limitations = [];
    o.unfilteredUntouched = safeFlow(WARMUP_FLOW).length === WARMUP_FLOW.length;
    STATE.profile.limitations = real;
    // a rest timer must not lose time while the phone is asleep
    openPlayer(); plEnterRest(90, 'set');
    o.hasDeadline = !!PLAYER.deadline;
    PLAYER.deadline = Date.now() + 30000;   // as if 60s passed while frozen
    plTickRest();
    o.catchesUp = PLAYER.remain <= 30;
    // +15s still works
    const b = PLAYER.remain; playerAddRest(); plTickRest();
    o.addRestWorks = PLAYER.remain > b;
    // and pausing does not let it expire
    plEnterRest(60, 'set');
    playerToggle(); PLAYER.pauseAt = Date.now() - 40000; playerToggle();
    plTickRest();
    o.pauseHoldsRest = PLAYER.remain > 15;
    playerQuit();
    return o;
  });
  t.eq('a flagged low back gets no risky warm-up move', flow.warmRisky, 0);
  t.ok('and something was actually removed', flow.actuallyRemovedSome, flow);
  t.ok('while the safe stretches stay', flow.keptTheSafeOnes, flow);
  t.eq('nor a risky cool-down move', flow.coolRisky, 0);
  t.ok('with nothing flagged the flow is untouched', flow.unfilteredUntouched, flow);
  t.ok('the rest timer is anchored to the clock', flow.hasDeadline, flow);
  t.ok('so it catches up after the phone sleeps', flow.catchesUp, flow);
  t.ok('+15s still adds time', flow.addRestWorks, flow);
  t.ok('and pausing does not let the rest expire', flow.pauseHoldsRest, flow);

  // ---- a timed WORK hold (plank, hollow, etc.) must not lose time either —
  // the same throttling fix plEnterRest/plTickRest already carry, extended to
  // plEnterWork/plTickHold, which had none of it.
  const hold = await page.evaluate(() => {
    const o = {};
    openPlayer();
    const idx = PLAYER.items.findIndex(m => m.unit === 'time');
    if (idx < 0) { playerQuit(); return { skip: true }; }
    PLAYER.i = idx; PLAYER.s = 0; plEnterWork();
    o.hasDeadline = !!PLAYER.deadline;
    o.total = PLAYER.total;
    if (o.total < 8) { playerQuit(); return { skip: true, tooShort: o.total }; }   // needs headroom below "5s left"
    // as if most of the hold passed while the phone was frozen — 5s left on the
    // clock, same shape as the existing plTickRest check two blocks up
    PLAYER.deadline = Date.now() + 5000;
    plTickHold();
    o.catchesUp = PLAYER.remain <= 5 && PLAYER.remain < o.total - 1;
    playerQuit();
    return o;
  });
  if (hold.skip) t.fail('no timed exercise (with enough headroom) available to drive the hold-timer check', hold);
  else {
    t.ok('the work-phase hold timer is anchored to the clock too', hold.hasDeadline, hold);
    t.ok('so a backgrounded hold catches up instead of drifting', hold.catchesUp, hold);
  }

  // ---- a 'gain' goal must not read a bulking athlete's own numbers backwards
  {
    const r = await page.evaluate(() => {
      const realProfile = JSON.stringify(STATE.profile);
      const realWeightKg = nut().weightKg;
      const o = {};
      nut().weightKg = 68;   // ~150 lb, fixed regardless of whatever the seed carries
      STATE.profile.goal = 'gain'; STATE.profile.goalWeightLb = 160;
      const missionGain = briefSegments().find(s => s.title === 'Your mission').say;
      STATE.profile.goal = 'lose'; STATE.profile.goalWeightLb = 140;
      const missionLose = briefSegments().find(s => s.title === 'Your mission').say;
      nut().weightKg = realWeightKg;
      STATE.profile = JSON.parse(realProfile);
      return {
        gainSaysUp: /up to 160/.test(missionGain),
        gainNotBackwards: !/outstanding/i.test(missionGain),
        loseSaysDown: /down to 140/.test(missionLose),
        missionGain, missionLose,
      };
    });
    t.ok('a gain-goal athlete below target is told to go UP toward it', r.gainSaysUp, r);
    t.ok('not congratulated for being short of a weight-GAIN goal', r.gainNotBackwards, r);
    t.ok('a lose-goal athlete above target is still told to go down (unchanged)', r.loseSaysDown, r);
  }

  // ---- the weight-trend chart colors "good" relative to the actual goal direction
  {
    const r = await page.evaluate(() => {
      const realM = JSON.stringify(STATE.measurements);
      const realProfile = JSON.stringify(STATE.profile);
      const base = new Date(); base.setDate(base.getDate() - 9);
      STATE.measurements = [];
      for (let i = 0; i < 10; i++) {
        const d = new Date(base); d.setDate(d.getDate() + i);
        STATE.measurements.push({ date: localISO(d), weight: 70 + i * 0.3, waist: 90 });   // rising trend
      }
      STATE.profile.goal = 'gain';
      const htmlGain = weightChartHTML();
      STATE.profile.goal = 'lose';
      const htmlLose = weightChartHTML();
      STATE.measurements = JSON.parse(realM);
      STATE.profile = JSON.parse(realProfile);
      return {
        gainRisingIsGreen: htmlGain.includes('▲') && htmlGain.includes('color:var(--green)'),
        loseRisingIsMuted: htmlLose.includes('▲') && htmlLose.includes('color:var(--muted)') && !htmlLose.includes('color:var(--green)'),
      };
    });
    t.ok('a rising trend reads GREEN for a gain goal', r.gainRisingIsGreen, r);
    t.ok('the SAME rising trend reads muted (not green) for a lose goal', r.loseRisingIsMuted, r);
  }

  // ---- the in-app waist-goal editor enforces the same bound onboarding already does
  {
    const r = await page.evaluate(() => {
      const real = STATE.profile.goalWaist;
      const o = {};
      setWaistGoal();
      document.querySelector('#g-waist').value = '9999';
      saveWaistGoal();
      o.rejectedAbsurd = STATE.profile.goalWaist === real;
      setWaistGoal();
      document.querySelector('#g-waist').value = STATE.profile.unit === 'in' ? '34' : '86';
      saveWaistGoal();
      o.acceptedPlausible = STATE.profile.goalWaist > 0 && STATE.profile.goalWaist !== real;
      STATE.profile.goalWaist = real; save();
      return o;
    });
    t.ok('an absurd waist goal (9999) is rejected, not stored', r.rejectedAbsurd, r);
    t.ok('a plausible waist goal still saves', r.acceptedPlausible, r);
  }

  // ---- the history list no longer pays for a full buildSession() per row
  {
    const r = await page.evaluate(() => {
      // a synthetic but realistic completed log — real items, decoupled from
      // whatever the earlier blocks in this file left in STATE.logs
      const p = STATE.progressPtr;
      const built = buildSession(p);
      const items = [...built.main, built.finisher].filter(Boolean);
      const realLog = STATE.logs[p];
      STATE.logs[p] = { done: true, items, ex: {}, completedAt: todayISO(), feel: 'ok' };

      const real = buildSession; let calls = 0;
      buildSession = function (...a) { calls++; return real.apply(this, a); };
      const cheap = sessionStats(p);
      const cheapCalls = calls;
      const full = sessionStats(p, true);
      const fullCalls = calls - cheapCalls;
      buildSession = real;

      if (realLog === undefined) delete STATE.logs[p]; else STATE.logs[p] = realLog;
      return {
        cheapCalls, fullCalls,
        cheapHasNoSess: !('sess' in cheap),
        fullHasSess: !!(full.sess && typeof full.sess.week === 'number'),
        sameCounts: cheap.exDone === full.exDone && cheap.setsDone === full.setsDone && cheap.exTotal === full.exTotal,
      };
    });
    t.eq('the history-list (cheap) path does not call buildSession() at all', r.cheapCalls, 0, r);
    t.eq('the detail (full) path calls it exactly once', r.fullCalls, 1, r);
    t.ok('the cheap path omits sess entirely rather than a half-built one', r.cheapHasNoSess, r);
    t.ok('the full path still returns a real sess object', r.fullHasSess, r);
    t.ok('both paths agree on the counts that matter to the list', r.sameCounts, r);
  }

  // ---- a flagged joint gets prep ADDED to the warm-up, not just risk removed
  const jointWarm = await page.evaluate(() => {
    const o = {}, real = STATE.profile.limitations;
    const names = f => f.map(it => it.n);

    STATE.profile.limitations = ['lowback'];
    const lowback = jointAwareWarmup(WARMUP_FLOW);
    o.lowbackAdds = names(lowback).includes('Spine Stability Prep');
    o.lowbackAfterBirdDog = names(lowback).indexOf('Spine Stability Prep') === names(lowback).indexOf('Bird Dog') + 1;
    o.lowbackSurvivesSafeFlow = names(safeFlow(lowback)).includes('Spine Stability Prep');
    o.lowbackNotDuplicated = names(jointAwareWarmup(lowback)).filter(n2 => n2 === 'Spine Stability Prep').length === 1;

    STATE.profile.limitations = ['shoulder'];
    o.shoulderAdds = names(jointAwareWarmup(WARMUP_FLOW)).includes('Shoulder Activation');
    STATE.profile.limitations = ['knee'];
    o.kneeAdds = names(jointAwareWarmup(WARMUP_FLOW)).includes('Knee Prep — Glute Bridge');

    // only ONE bonus slot, same as correctiveBonus() — the first flagged joint wins
    STATE.profile.limitations = ['shoulder', 'knee'];
    const both = names(jointAwareWarmup(WARMUP_FLOW));
    o.onlyFirstJointAdded = both.includes('Shoulder Activation') && !both.includes('Knee Prep — Glute Bridge');

    STATE.profile.limitations = [];
    o.noneFlaggedUnchanged = jointAwareWarmup(WARMUP_FLOW).length === WARMUP_FLOW.length;

    STATE.profile.limitations = real;
    return o;
  });
  t.ok('a flagged low back gets real spine prep added to the warm-up', jointWarm.lowbackAdds, jointWarm);
  t.ok('placed right after Bird Dog, the same-family movement it extends', jointWarm.lowbackAfterBirdDog, jointWarm);
  t.ok('and it is not itself flagged as risky for the joint it was added for', jointWarm.lowbackSurvivesSafeFlow, jointWarm);
  t.ok('running it twice does not add it twice', jointWarm.lowbackNotDuplicated, jointWarm);
  t.ok('a flagged shoulder gets shoulder activation added', jointWarm.shoulderAdds, jointWarm);
  t.ok('a flagged knee gets glute-bridge prep added', jointWarm.kneeAdds, jointWarm);
  t.ok('two flagged joints still add only one bonus item, same as correctiveBonus()', jointWarm.onlyFirstJointAdded, jointWarm);
  t.ok('with nothing flagged the warm-up is unchanged', jointWarm.noneFlaggedUnchanged, jointWarm);

  /* ---- onboarding's "mobility" question actually tunes the flow (v251) ----
     Labelled "tunes warm-up & cool-down" in the wizard, but until now the only
     thing STATE.profile.mobility touched was a sentence of encouragement
     above the flow — a promise in the UI with no code behind it, per this
     file's own note on that exact shape of defect. mobilityFlow() is the fix;
     confirm it actually lengthens holds for 'low' and leaves 'ok'/'good'
     (and the joint-aware addition) alone, rather than just existing. */
  const mob = await page.evaluate(() => {
    const o = {}, real = STATE.profile.mobility;
    const secsOf = f => f.map(it => it.secs);
    const beforeWarm = secsOf(WARMUP_FLOW), beforeCool = secsOf(COOLDOWN_FLOW);

    STATE.profile.mobility = 'low';
    o.warmupLonger = secsOf(mobilityFlow(WARMUP_FLOW)).every((s, i) => s === Math.round(beforeWarm[i] * 1.25));
    o.cooldownLonger = secsOf(mobilityFlow(COOLDOWN_FLOW)).every((s, i) => s === Math.round(beforeCool[i] * 1.25));
    // the joint-aware addition is built AFTER onboarding's mobility answer is
    // known, so it must also be scaled — not just the fixed WARMUP_FLOW array
    STATE.profile.limitations = ['lowback'];
    const withAdd = mobilityFlow(jointAwareWarmup(WARMUP_FLOW));
    const addedItem = withAdd.find(it => it.n === 'Spine Stability Prep');
    o.jointAddAlsoScaled = !!addedItem && addedItem.secs === Math.round(30 * 1.25);
    STATE.profile.limitations = [];
    // must not mutate the shared source arrays — a later unflagged athlete
    // reading WARMUP_FLOW/COOLDOWN_FLOW directly must still see the originals
    o.sourceUntouched = secsOf(WARMUP_FLOW).every((s, i) => s === beforeWarm[i]) &&
      secsOf(COOLDOWN_FLOW).every((s, i) => s === beforeCool[i]);

    STATE.profile.mobility = 'ok';
    o.averageUnchanged = secsOf(mobilityFlow(WARMUP_FLOW)).every((s, i) => s === beforeWarm[i]);
    STATE.profile.mobility = 'good';
    o.goodUnchanged = secsOf(mobilityFlow(COOLDOWN_FLOW)).every((s, i) => s === beforeCool[i]);

    STATE.profile.mobility = real;
    return o;
  });
  t.ok('a stiff athlete (mobility: low) gets 25% longer warm-up holds', mob.warmupLonger, mob);
  t.ok('and 25% longer cool-down holds, matching the UI\'s own "hold a little longer" promise', mob.cooldownLonger, mob);
  t.ok('the joint-aware warm-up addition is scaled too, not just the fixed array', mob.jointAddAlsoScaled, mob);
  t.ok('an average-mobility athlete sees the original warm-up durations', mob.averageUnchanged, mob);
  t.ok('a very-mobile athlete sees the original cool-down durations', mob.goodUnchanged, mob);
  t.ok('scaling does not mutate the shared WARMUP_FLOW source array', mob.sourceUntouched, mob);

  // ---- the food table knows what is in it ----------------------------------
  const food = await page.evaluate(() => {
    const o = {}, N = STATE.nutrition;
    const realD = N.diet, realA = N.allergens;
    /* Every food must be LISTED, including the ones with nothing to declare.
       An absent entry is the failure that let two recipes ship coconut to a
       tree-nut allergy with alg:[] — indistinguishable from a real all-clear. */
    o.untagged = FOODS.filter(f => !Array.isArray(FOOD_ALG[f[0]])).map(f => f[0]);
    o.orphanTags = Object.keys(FOOD_ALG).filter(n => FOOD_BY_NAME[n] === undefined);
    // molluscs and crustaceans are shellfish, which is a different allergy to fish
    o.shellfishRight = ['Prawns', 'Crab meat', 'Mussels', 'Scallops', 'Squid / calamari']
      .every(n => (FOOD_ALG[n] || []).includes('shellfish') && !(FOOD_ALG[n] || []).includes('fish'));
    o.finfishRight = ['Cod', 'Salmon fillet', 'Mackerel'].every(n => (FOOD_ALG[n] || []).includes('fish'));
    o.porkNotHalal = !foodDiets(FOODS[FOOD_BY_NAME['Pork loin']]).includes('halal');
    o.beefIsHalal = foodDiets(FOODS[FOOD_BY_NAME['Sirloin steak']]).includes('halal');
    // an unlisted food fails CLOSED
    o.unlistedHidden = !foodOk(['Mystery meat', 40, 200, '100 g', 'meat', 5, 100, 'g']);
    // no combination leaks, and the days still hit the target after substitution
    const combos = [['omnivore', []], ['vegan', []], ['vegetarian', ['egg']],
      ['pescatarian', ['dairy', 'soy', 'shellfish']], ['omnivore', ['treenut', 'peanut']],
      ['vegan', ['soy', 'treenut', 'peanut', 'gluten']]];
    o.leaks = []; o.unsafeDays = []; o.worstGap = 0;
    combos.forEach(([diet, alg]) => {
      N.diet = diet; N.allergens = alg;
      FOODS.filter(foodOk).forEach(f => {
        if ((FOOD_ALG[f[0]] || []).some(a => alg.includes(a))) o.leaks.push(diet + '/' + f[0]);
        if (!foodDiets(f).includes(diet)) o.leaks.push(diet + '/diet/' + f[0]);
      });
      const days = scaledDays(), T = refTargets();
      days.forEach(d => {
        d.meals.forEach(m => m.items.forEach(x => {
          const f = FOODS[FOOD_BY_NAME[x.name]];
          if (f && !foodOk(f)) o.unsafeDays.push(diet + '/' + x.name);
        }));
        o.worstGap = Math.max(o.worstGap, Math.abs(d.p - T.p));
      });
    });
    N.diet = realD; N.allergens = realA;
    return o;
  });
  t.ok('every food is tagged, including the clean ones', food.untagged.length === 0, food.untagged);
  t.ok('no tag refers to a food that does not exist', food.orphanTags.length === 0, food.orphanTags);
  t.ok('molluscs and crustaceans are shellfish, not fish', food.shellfishRight, food);
  t.ok('and finfish are fish', food.finfishRight, food);
  t.ok('pork is not halal', food.porkNotHalal, food);
  t.ok('but beef is', food.beefIsHalal, food);
  t.ok('an unlisted food is hidden, not served', food.unlistedHidden, food);
  t.ok('no diet or allergen combination leaks a food', food.leaks.length === 0, food.leaks.slice(0, 6));
  t.ok('and the seven days never serve one either', food.unsafeDays.length === 0, food.unsafeDays.slice(0, 6));
  t.ok('every day still lands on the protein target after substitution',
    food.worstGap <= 12, { worstGap: food.worstGap });

  /* ---- an anchor is replaced by an ANCHOR -------------------------------
     Closest protein-per-calorie alone is not enough. For a vegan with soy,
     tree-nut, peanut and gluten allergies the whole meat category is unsafe,
     so the sort fell through to "anywhere" and served Spinach in place of
     Turkey mince — and in place of Salmon — because spinach's ratio (13.3 g
     per 100 kcal) sits nearer turkey's (17.2) than any pulse's (7.8).
     It cannot self-correct: spinach is cat 'veg', so the day ends with no
     anchor, scaleDay()'s `anchorP>0` test fails, and the one dial that moves
     protein is dead — the day fell further behind the harder the target got.
     Read the day the app actually builds, not a replay of the sort: a replay
     would pass whether or not scaleDay() uses it. */
  {
    const r = await page.evaluate(() => {
      const N = STATE.nutrition;
      const realD = N.diet, realA = N.allergens;
      const catsOf = day => day.meals.flatMap(m => m.items.map(x => FOODS[x.i][4]));
      const namesOf = day => day.meals.flatMap(m => m.items.map(x => x.name));
      N.diet = 'omnivore'; N.allergens = [];
      const plain = scaleDay(REF_DAYS[10], 165, 2280);
      N.diet = 'vegan'; N.allergens = ['soy', 'treenut', 'peanut', 'gluten'];
      const hard = scaleDay(REF_DAYS[10], 165, 2280);
      N.diet = realD; N.allergens = realA;
      return {
        /* Guard: the day this block reasons about must really have anchors to
           lose, or every assertion below passes on nothing. */
        plainAnchors: catsOf(plain).filter(c => REF_ANCHOR_CATS.includes(c)).length,
        hardAnchors: catsOf(hard).filter(c => REF_ANCHOR_CATS.includes(c)).length,
        hardNames: namesOf(hard),
        plainP: Math.round(plain.p), hardP: Math.round(hard.p),
      };
    });
    t.ok('guard: the day really does carry anchors for an omnivore', r.plainAnchors >= 2, r);
    t.ok('the most-substituted diet still gets a protein anchor', r.hardAnchors >= 2, r);
    t.ok('and it is not a leafy green standing in for the meat',
      !r.hardNames.includes('Spinach, cooked') || r.hardAnchors >= 2, r);
    /* The outcome, not the rule that produced it: a day with no anchor cannot
       be dialled onto its protein target at all. */
    t.ok('so the substituted day still reaches the target', Math.abs(r.hardP - 165) <= 12, r);
    t.ok('the same day for an omnivore reaches it too', Math.abs(r.plainP - 165) <= 12, r);
  }

  /* ---- today's plan is a worked day, not a random draw --------------------
     The DAY-level invariants below are unchanged and still matter: the same
     worked days feed the Reference tab and the shopping list, so they must
     still land on the athlete's real targets.

     What moved is where they are READ FROM. v245 removed the "Today's plan"
     card from Fuel at the athlete's request — they log what they actually ate,
     by photo or by hand — so the three markup assertions now run against the
     Reference tab, which is where a worked day still renders. Pointing them at
     Fuel would have made them pass on an empty tab, which is worse than
     deleting them: a check that cannot fail reads as coverage and is not. */
  const plan = await page.evaluate(() => {
    const o = {};
    go('ref'); renderRef();
    const v = document.querySelector('#v-ref').innerHTML;
    const T = refTargets(), d = todaysWorkedDay().day;
    o.usesWorkedDay = new RegExp('of the ' + REF_DAYS.length + ' days|' + REF_DAYS.length + ' days').test(v)
      && /Log this meal/.test(v);
    /* The generator picked on CALORIES alone against a library that topped out
       below the per-slot target, so it undershot every day: 1,500-1,620 kcal
       and 103-139 g protein against 1,970 and 155, then told the athlete to
       multiply every quantity by 1.3x. */
    o.hitsCalories = Math.abs(d.kcal - T.kcal) < T.kcal * 0.12;
    o.hitsProtein = Math.abs(d.p - T.p) <= 12;
    // Reference states them as "Weighed out for <p> g protein and <kcal> kcal";
    // the old 'of <n>' phrasing belonged to the removed Fuel card's own header
    o.showsBothTargets = v.includes(T.p + ' g protein') && v.includes(T.kcal + ' kcal');
    o.noScalingBanner = !/Scale these portions/.test(v) && !/multiply each quantity/i.test(v);
    o.loggable = /logRefMeal/.test(v);
    // deterministic within a day, so it does not reshuffle on every render
    o.stable = todaysWorkedDay().idx === todaysWorkedDay().idx;
    return o;
  });
  t.ok('the plan is one of the seven worked days', plan.usesWorkedDay, plan);
  t.ok('it hits the calorie target', plan.hitsCalories, plan);
  t.ok('and the protein target', plan.hitsProtein, plan);
  t.ok('showing both, so neither is quietly missing', plan.showsBothTargets, plan);
  t.ok('with no "multiply everything by 1.3" instruction', plan.noScalingBanner, plan);
  t.ok('and every meal is loggable in one tap', plan.loggable, plan);
  t.ok('the day does not reshuffle on re-render', plan.stable, plan);

  // ---- removeMeasure's onclick must survive a real click, not just a regex
  // read of the markup. A hand-wrapped onclick="removeMeasure('${_ve(x)}')"
  // LOOKS safe once _ve() escapes ' to &#39; — but the browser HTML-decodes
  // the onclick attribute before compiling it as JS, so &#39; turns back
  // into a literal ' right before the handler runs and the exploit still
  // fires. A regex over the rendered HTML string can't see that decode step
  // at all, so this drives it through a REAL DOM element and a REAL click.
  // measureListHTML() truncates the date to 10 chars (String(m.date).slice(0,10))
  // before it ever reaches the onclick, on the display path AND the argument
  // path alike — so the real attack surface is a 10-character window, and the
  // payload below is built to fit a valid breakout inside exactly that: a
  // closing quote, a closing paren, an injected statement, and a `//` comment
  // to swallow whatever the template appends after it, all within 10 chars.
  {
    const r = await page.evaluate(() => {
      const o = {};
      o.escapesQuote = _ve("it's") === 'it&#39;s';
      o.stillEscapesOthers = _ve('<&">') === '&lt;&amp;&quot;&gt;';

      const PAYLOAD = "');q=1;//x"; // exactly 10 chars — survives the slice untouched
      delete window.q;
      const real = JSON.stringify(STATE.measurements);
      STATE.measurements = [{ date: PAYLOAD, waist: 90, weight: 80 }];
      const html = measureListHTML();
      STATE.measurements = JSON.parse(real);

      const div = document.createElement('div');
      div.id = '__exploitProbe';
      div.innerHTML = html;
      document.body.appendChild(div);
      const btn = div.querySelector('button[onclick^="removeMeasure"]');
      o.foundButton = !!btn;
      const origRemove = window.removeMeasure;
      let calledWith;
      window.removeMeasure = (d) => { calledWith = d; };
      if (btn) btn.click();
      window.removeMeasure = origRemove;
      div.remove();
      o.pwned = window.q === 1;
      o.calledWith = calledWith;
      delete window.q;
      return o;
    });
    t.ok('_ve() escapes a single quote to &#39;', r.escapesQuote, r);
    t.ok('and still escapes the original &<>" set', r.stillEscapesOthers, r);
    t.ok('the delete button is found in the rendered markup', r.foundButton, r);
    t.ok('a real click on a crafted measurement date does not execute injected JS', !r.pwned, r);
    t.eq('removeMeasure is instead called with the full, unbroken date string', r.calledWith, "');q=1;//x", r);
  }

  // ---- importData()'s Object.assign(d, backup) must not hijack STATE's own
  // prototype. Checked empirically before writing this: JSON.parse WITHOUT a
  // reviver produces an own "__proto__"-named DATA property — it does NOT
  // touch the real Object.prototype at parse time, and neither does the
  // later Object.assign ever touch the GLOBAL Object.prototype. The actual
  // danger is one line later, at STATE=Object.assign(d,p): Object.assign
  // performs a genuine property SET for every source key, and a set of
  // "__proto__" DOES trigger the inherited accessor, reassigning the
  // TARGET's own [[Prototype]] to whatever object the backup supplied — so
  // STATE.someUndefinedField can start reading attacker data instead of
  // undefined. An earlier draft of this check asserted on
  // Object.prototype.polluted, which stays undefined whether the guard
  // exists or not — it passed clean on a seeded mutant that deleted the
  // guard entirely. This drives the REAL importData() through a REAL File,
  // the same way 13-feedback.test.mjs's legacy-backup check does, and reads
  // STATE's actual prototype afterwards.
  {
    const r = await page.evaluate(async () => {
      // NOT _saved as the completion signal — save(), called at the end of
      // importData() itself, unconditionally overwrites STATE._saved to
      // todayISO() on every call, so a sentinel there is wiped before the
      // polling loop's first tick ever runs. profile.name survives — it is
      // deep-merged from the backup, not stamped by save().
      const json = '{"version":1,"__proto__":{"polluted":"yes"},"profile":{"name":"__PROTOTEST__"}}';
      const file = new File([json], 'proto.json', { type: 'application/json' });
      const realConfirm = window.confirm; window.confirm = () => true;
      await new Promise(res => {
        importData({ target: { files: [file] } });
        const iv = setInterval(() => { if (STATE.profile && STATE.profile.name === '__PROTOTEST__') { clearInterval(iv); res(); } }, 60);
        setTimeout(() => { clearInterval(iv); res(); }, 3000);
      });
      window.confirm = realConfirm;
      return {
        imported: STATE.profile && STATE.profile.name === '__PROTOTEST__',
        protoIsReal: Object.getPrototypeOf(STATE) === Object.prototype,
        pollutedLeak: STATE.polluted,
      };
    });
    t.ok('guard: the crafted backup was actually imported', r.imported, r);
    t.ok('STATE keeps its real prototype after importing a backup carrying __proto__', r.protoIsReal, r);
    t.eq('and nothing leaks through a hijacked prototype chain', r.pollutedLeak, undefined, r);
  }

  // ---- _faNum() must ceiling a manually-typed food value, not just floor
  // it — every other numeric input in this file (weight, waist, lift load)
  // has a sanity ceiling; this one didn't.
  {
    const r = await page.evaluate(() => {
      const el = document.createElement('input');
      el.id = '__faTestProbe';
      document.body.appendChild(el);
      el.value = '99999999';
      const huge = _faNum('__faTestProbe');
      el.value = '-50';
      const neg = _faNum('__faTestProbe');
      el.value = '250';
      const normal = _faNum('__faTestProbe');
      el.remove();
      return { huge, neg, normal };
    });
    t.ok('an absurdly large manually-typed value is capped, not passed through raw', r.huge <= 9999, r);
    t.eq('a negative value still floors to 0', r.neg, 0, r);
    t.eq('an ordinary value passes through unchanged', r.normal, 250, r);
  }

  // ---- removeMeasure() must say so when the date it was asked to delete
  // doesn't match anything, instead of unconditionally claiming "Deleted".
  {
    const r = await page.evaluate(() => {
      const real = JSON.stringify(STATE.measurements);
      STATE.measurements = [{ date: '2020-01-01', waist: 90, weight: 80 }];
      const realConfirm = window.confirm; window.confirm = () => true;
      removeMeasure('2099-12-31');   // does not match the one entry above
      const notFoundToast = document.querySelector('#toast').textContent;
      const untouchedAfterMiss = STATE.measurements.length;
      removeMeasure('2020-01-01');   // the real one
      const deletedToast = document.querySelector('#toast').textContent;
      window.confirm = realConfirm;
      STATE.measurements = JSON.parse(real);
      return { notFoundToast, untouchedAfterMiss, deletedToast };
    });
    t.eq('deleting a non-matching date says so', r.notFoundToast, 'Not found', r);
    t.eq('and leaves the real entry untouched', r.untouchedAfterMiss, 1, r);
    t.eq('deleting the real entry still says Deleted', r.deletedToast, 'Deleted', r);
  }

  // ---- playerSwap() must not claim an unqualified "Swapped" when the part
  // that's supposed to survive leaving the player silently failed to persist.
  {
    const r = await page.evaluate(() => {
      openPlayer();
      if (!PLAYER) return { skip: true };
      PLAYER.i = 0; PLAYER.s = 0;
      const m = plCur();
      const altId = Object.keys(EX).find(k => k !== m.exId && EX[k].unit === m.unit && !EX[k].equip);
      if (!altId) { playerQuit(); return { skip: true }; }

      playerSwap(altId);
      const successToast = document.querySelector('#toast').textContent;
      const successExId = plCur().exId;

      // reset to the original exercise for a clean second attempt
      PLAYER.i = 0; PLAYER.s = 0;
      const m2 = plCur();
      const altId2 = Object.keys(EX).find(k => k !== m2.exId && EX[k].unit === m2.unit && !EX[k].equip) || altId;
      const origSetSwap = window.setSwap;
      window.setSwap = () => { throw new Error('forced'); };
      playerSwap(altId2);
      window.setSwap = origSetSwap;
      const failToast = document.querySelector('#toast').textContent;
      const failExId = plCur().exId;

      playerQuit();
      return { successToast, successExId, altId, failToast, failExId, altId2 };
    });
    if (r.skip) { t.fail('no suitable bodyweight exercise found to drive the playerSwap check', r); }
    else {
      t.eq('a normal swap changes the in-session exercise', r.successExId, r.altId, r);
      t.ok('and its toast is an unqualified "Swapped to X"', /^Swapped to /.test(r.successToast) && !/may not stick/.test(r.successToast), r.successToast);
      t.eq('the in-session swap still applies even when persistence throws', r.failExId, r.altId2, r);
      t.ok('but the toast now warns it may not survive leaving the player', /may not stick/.test(r.failToast), r.failToast);
    }
  }

  // ---- plAfterSet() must say something when a completed set fails to log,
  // instead of the athlete finding out later that the count never saved.
  /* ---- a change of MOVEMENT is not a change of strength (v320) ------------
     safeSwap() protects a flagged joint during the baseline battery, so the
     number that comes back measures a DIFFERENT exercise — and nothing
     recorded which. Measured on a wrist-flagged athlete: `stamina` is Burpees
     and resolves to marching in place. Baseline 40 on the substitute, re-test
     18 on real burpees once the wrist recovered — an athlete who genuinely
     improved, whose stamina number more than halved, with nothing on the glass
     to say the ruler had changed.

     That is exactly what TEST_PROTOCOL already exists to prevent, one variable
     down: a v1 and a v2 taken under different conditions are not the same
     measurement. `subs` is now stamped on every record and both consumers ask
     it — retestDrop() and the strength trend. */
  {
    const r = await page.evaluate(() => {
      const o = {};
      STATE.profile.limitations = ['wrist']; save();
      o.subsWrist = assessSubs();
      STATE.profile.limitations = []; save();
      o.subsNone = assessSubs();

      const flagged = { subs: { stamina: 'march' } }, clean = { subs: {} };
      o.differentMovement = sameMovement(flagged, clean, 'stamina');
      o.sameMovement = sameMovement(clean, clean, 'stamina');
      o.untouchedTest = sameMovement(flagged, clean, 'plank');
      /* An older record has no `subs` at all — unknown, not equal. It must fail
         CLOSED, or every phone carrying a pre-v320 baseline silently claims a
         like-for-like comparison it cannot vouch for. */
      o.legacyFailsClosed = sameMovement({}, clean, 'stamina');

      /* DRIVE THE REAL WRITER. Hand-building records exercises sameMovement()
         and the trend and NOTHING about the save path — a mutant that deleted
         `subs:assessSubs()` from the record literal walked straight through
         four checks. finishAssessment() is what an athlete's last tap reaches. */
      STATE.profile.limitations = ['wrist'];
      STATE.baseline = null; STATE.reassess = {}; STATE.scoreHistory = [];
      assessState = { idx: 0, results: {}, reassess: 0 };
      TESTS.forEach(t => { assessState.results[t.id] = 20; });
      save();
      try { finishAssessment(); } catch (e) { o.finishThrew = e.message; }
      o.savedSubs = (STATE.baseline || {}).subs || null;
      o.writerStampsSubs = !!(o.savedSubs && Object.keys(o.savedSubs).length > 0);
      /* And the floor: an athlete with nothing flagged records an EMPTY map,
         not a missing one — absent has to keep meaning "before the stamp". */
      STATE.profile.limitations = [];
      STATE.baseline = null;
      assessState = { idx: 0, results: {}, reassess: 0 };
      TESTS.forEach(t => { assessState.results[t.id] = 20; });
      save();
      try { finishAssessment(); } catch (e) {}
      o.cleanSubs = (STATE.baseline || {}).subs;
      o.cleanStampsEmpty = !!(o.cleanSubs && Object.keys(o.cleanSubs).length === 0);
      try { closeSheet(); } catch (e) {}

      /* Drive the real trend: a substituted baseline, a clean re-test. */
      STATE.baseline = { date: '2026-07-01', score: 63, level: 'Beginner',
        testCount: TESTS.length, protocol: TEST_PROTOCOL,
        subs: { stamina: 'march' }, maxes: { stamina: 40, plank: 60 } };
      STATE.reassess = { 1: { date: '2026-08-15', score: 74, level: 'Intermediate',
        testCount: TESTS.length, protocol: TEST_PROTOCOL,
        subs: {}, maxes: { stamina: 18, plank: 75 } } };
      save();
      /* GUARD: `subs` has to survive assessSeries(), which builds the chart's
         points. It was dropped there on the first attempt and EVERY metric read
         as not-comparable — a marker that lives only in the stored record is
         not a record. */
      const series = assessSeries();
      o.seriesCarriesSubs = series.length >= 2 && series.every(x => x.subs !== undefined);

      strengthSel = 'stamina';
      const swapped = strengthTrendHTML();
      o.swappedSaysSo = /not comparable/.test(swapped);
      o.swappedWithholdsVerdict = !/▲|▼/.test(swapped);
      o.swappedStillPlots = /svg/i.test(swapped);
      /* THE FLOOR: a test that was NEVER substituted must still get its
         verdict. A change that simply withheld every verdict satisfies both
         assertions above and guts the feature. */
      strengthSel = 'plank';
      const plain = strengthTrendHTML();
      o.plainKeepsVerdict = /▲|▼/.test(plain);
      o.plainNoWarning = !/not comparable/.test(plain);
      return o;
    });

    t.ok('guard: a flagged wrist really does substitute a test',
      Object.keys(r.subsWrist).length > 0, r.subsWrist);
    t.eq('and nothing is substituted with no joint flagged', r.subsNone, {});
    t.eq('two records that used different movements are not the same', r.differentMovement, false, r);
    t.eq('two records that used the same movement are', r.sameMovement, true, r);
    t.eq('a test neither record substituted is the same', r.untouchedTest, true, r);
    t.eq('a record from before the stamp fails closed', r.legacyFailsClosed, false, r);
    t.ok('the real save path stamps the substitutions', r.writerStampsSubs, r);
    t.ok('and stamps an empty map when nothing was substituted', r.cleanStampsEmpty, r);
    t.ok('the substitutions survive into the chart series', r.seriesCarriesSubs, r);
    t.ok('a metric measured on two different movements says so', r.swappedSaysSo, r);
    t.ok('and withholds the up/down verdict', r.swappedWithholdsVerdict, r);
    t.ok('while still plotting both real measurements', r.swappedStillPlots, r);
    t.ok('a metric measured the same way both times keeps its verdict', r.plainKeepsVerdict, r);
    t.ok('and carries no warning', r.plainNoWarning, r);
  }

  /* ---- a substituted test is on a DIFFERENT SCALE, not just a different
     movement (v321) -----------------------------------------------------------
     v320 stopped the app COMPARING across a swap. It still PRESCRIBED from one.
     prescribe() does maxes[anchor] * frac * ex.hardness, and hardness is defined
     as a fraction of the anchor test's max — so a Dead Bug count (hardness 1.4)
     read as a Reverse Crunch max inflates every lower-anchored target by 40%.
     Measured before the fix: Dead Bug 10 -> 15, Crunch 10 -> 15, Toe Touch
     8 -> 12, Towel Door Row 8 -> 11. Flagging a joint made the app prescribe
     MORE work in the flagged region.

     THE DISCRIMINATING CHECK is not "the number changed" — it is that one body
     with one true capacity gets the SAME target whether or not it was flagged.
     Everything else here is a floor under that, because the obvious over-eager
     fix (convert every substituted value, or convert everything) satisfies the
     headline assertion and breaks a floor. */
  {
    const r = await page.evaluate(() => {
      const keep = {
        lims: STATE.profile.limitations,
        baseline: JSON.parse(JSON.stringify(STATE.baseline || {})),
        reassess: JSON.parse(JSON.stringify(STATE.reassess || {})),
      };
      const o = {};
      function targets(key, val, lims, subs, list) {
        STATE.profile.limitations = lims;
        STATE.baseline.maxes = Object.assign({}, STATE.baseline.maxes, { [key]: val });
        STATE.baseline.subs = subs;
        STATE.reassess = {};
        const out = {};
        list.forEach(k => { try { out[k] = prescribe(k, { cycle: 0, week: 1 }).target; } catch (e) { out[k] = 'ERR'; } });
        return out;
      }
      const L = ['deadbug', 'crunch', 'toetouch', 'legraise'];
      // true Reverse Crunch max 14; the same body measured on Dead Bugs (h 1.4) records ~20
      o.lowerUnflagged = targets('lower', 14, [], {}, L);
      o.lowerFlagged   = targets('lower', 20, ['lowback'], { lower: 'deadbug' }, L);
      o.lowerLegacy    = targets('lower', 20, ['lowback'], undefined, L);
      const P = ['towelrow', 'invertedrow', 'tablerow'];
      o.pullUnflagged  = targets('pull', 12, [], {}, P);
      o.pullFlagged    = targets('pull', 16, ['shoulder'], { pull: 'towelrow' }, P);

      // the conversion itself, and every guard that must NOT fire
      o.convLower   = anchorEquiv('lower', 20, { lower: 'deadbug' });      // easier sub -> DOWN
      o.convPull    = anchorEquiv('pull', 16, { pull: 'towelrow' });       // easier sub -> DOWN
      o.convPush    = anchorEquiv('push', 20, { push: 'fistpushup' });     // HARDER sub -> UP
      o.guardDyn    = anchorEquiv('dyn', 60, { dyn: 'deadbug' });          // time -> reps, other anchor
      o.guardPower  = anchorEquiv('power', 30, { power: 'squat' });        // explosive -> not
      /* The one reachable swap that shares a UNIT with its original and is
         anchored elsewhere. jumpsquat->squat happens to be hardness 1.0 both
         sides, so it cannot tell a missing anchor guard from a present one;
         burpee(0.7,time) -> squatthrust(0.95,time) can, and does. */
      o.guardStamina = anchorEquiv('stamina', 40, { stamina: 'squatthrust' });
      /* The unit guard cannot fire on today's library: validateData() enforces
         that an anchored exercise carries its anchor test's unit, so "same
         anchor" already implies "same unit". Exercise it directly, the same way
         the band guard is exercised, so a future EX edit that breaks that
         invariant does not walk straight through. */
      const ub = EX.deadbug.unit;
      EX.deadbug.unit = 'time';
      o.guardUnit = anchorEquiv('lower', 20, { lower: 'deadbug' });
      EX.deadbug.unit = ub;
      o.guardNoSub  = anchorEquiv('lower', 20, {});
      o.guardLegacy = anchorEquiv('lower', 20, undefined);
      o.guardJunkId = anchorEquiv('lower', 20, { lower: 'nosuchmove' });
      o.guardJunkV  = anchorEquiv('lower', 'abc', { lower: 'deadbug' });

      // a calibration too far apart to be a re-scale is left alone, not multiplied by 10
      const hb = EX.deadbug.hardness;
      EX.deadbug.hardness = 0.1;
      o.guardBand = anchorEquiv('lower', 20, { lower: 'deadbug' });
      EX.deadbug.hardness = hb;

      // the SCORE reads the same equivalent — it sets level, which scales the unanchored branch
      o.scoreRaw   = computeAssessment({ lower: 20 }, {}).score;
      o.scoreSwap  = computeAssessment({ lower: 20 }, { lower: 'deadbug' }).score;
      o.maxesStayRaw = computeAssessment({ lower: 20 }, { lower: 'deadbug' }).maxes.lower;

      STATE.profile.limitations = keep.lims;
      STATE.baseline = keep.baseline;
      STATE.reassess = keep.reassess;
      return o;
    });

    t.ok('guard: the un-flagged athlete really was prescribed something',
      r.lowerUnflagged.deadbug > 0 && r.pullUnflagged.towelrow > 0, r);
    t.eq('one body, one capacity: a flagged low back gets the SAME lower-ab targets',
      r.lowerFlagged, r.lowerUnflagged, r);
    t.eq('and a flagged shoulder gets the SAME pull targets',
      r.pullFlagged, r.pullUnflagged, r);
    /* THE FLOOR. A record written before the stamp existed does not know what it
       measured, so it is left exactly as it was — converting it would be
       inventing. Every phone is carrying one of these. */
    t.ok('a record from before the stamp is left untouched, not converted',
      r.lowerLegacy.deadbug > r.lowerUnflagged.deadbug, r);

    // direction: an EASIER substitute must lower the anchor, a HARDER one must raise it
    t.eq('a Dead Bug count converts DOWN to a Reverse Crunch max', r.convLower, 14, r);
    t.eq('a Towel Row count converts DOWN to an Inverted Row max', r.convPull, 12, r);
    t.eq('a Fist Push-Up count converts UP — it is the harder movement', r.convPush, 21, r);

    // the guards, each of which a blanket converter would trip
    t.eq('a substitute measured in other units is not re-scaled', r.guardDyn, 60, r);
    t.eq('a substitute anchored to another test is not re-scaled', r.guardPower, 30, r);
    t.eq('nor one that shares the unit but measures another quality', r.guardStamina, 40, r);
    t.eq('nor one whose unit no longer matches its original', r.guardUnit, 20, r);
    t.eq('a test that was not substituted is untouched', r.guardNoSub, 20, r);
    t.eq('a legacy record with no subs at all is untouched', r.guardLegacy, 20, r);
    t.eq('an unresolvable substitute id is untouched', r.guardJunkId, 20, r);
    t.eq('a junk value is untouched', r.guardJunkV, 'abc', r);
    t.eq('a hardness ratio outside the band is untouched, not multiplied', r.guardBand, 20, r);

    t.ok('guard: the two scores really are computed from the same raw input',
      typeof r.scoreRaw === 'number' && typeof r.scoreSwap === 'number', r);
    t.ok('the Core Score reads the equivalent too — it is what sets level',
      r.scoreSwap < r.scoreRaw, r);
    t.eq('but the stored max stays RAW — v320 plots the real measurement', r.maxesStayRaw, 20, r);
  }

  /* The writer has to hand the swaps to the scorer. Calling computeAssessment()
     with a subs map proves the helper works and nothing about the route: the
     mutant that drops the argument from finishAssessment() leaves every check
     above green. Drive the real save. */
  {
    const r = await page.evaluate(() => {
      const keep = {
        lims: STATE.profile.limitations,
        baseline: JSON.parse(JSON.stringify(STATE.baseline || {})),
        scoreHistory: (STATE.scoreHistory || []).slice(),
      };
      STATE.profile.limitations = ['wrist'];
      STATE.baseline = null;
      const results = {};
      TESTS.forEach(x => { results[x.id] = 20; });
      assessState = { idx: TESTS.length - 1, results, reassess: null };
      let saved = null;
      try { finishAssessment(); saved = STATE.baseline; } catch (e) { saved = { err: e.message }; }
      try { closeSheet(); } catch (e) {}
      const subs = saved && saved.subs;
      const expectSwap = computeAssessment(results, subs).score;
      const expectRaw  = computeAssessment(results, {}).score;
      STATE.profile.limitations = keep.lims;
      STATE.baseline = keep.baseline;
      STATE.scoreHistory = keep.scoreHistory;
      return { savedScore: saved && saved.score, subs, expectSwap, expectRaw };
    });
    t.ok('guard: the real save ran and stamped a substitution',
      r.subs && Object.keys(r.subs).length > 0, r);
    t.ok('guard: the swap really does change the score for this input',
      r.expectSwap !== r.expectRaw, r);
    t.eq('the real save path scores against the substituted movement',
      r.savedScore, r.expectSwap, r);
  }

  /* A personal record belongs to the movement that was PERFORMED. This block is
     the third consumer of the same defect and the one that writes a claim the
     athlete can read back: keyed on the test's nominal exercise, 20 Fist
     Push-Ups became a 20-rep PUSH-UP record, 20 Towel Door Rows a 20-rep
     INVERTED ROW, and 20 Single-Leg Dead Bugs a 20-rep BURPEE — three bests on
     three movements never done, feeding strengthLevel(). */
  {
    const r = await page.evaluate(() => {
      const keep = {
        lims: STATE.profile.limitations,
        baseline: JSON.parse(JSON.stringify(STATE.baseline || {})),
        prs: JSON.parse(JSON.stringify(STATE.prs || {})),
        scoreHistory: (STATE.scoreHistory || []).slice(),
      };
      STATE.prs = {};
      STATE.profile.limitations = ['wrist', 'shoulder'];
      STATE.baseline = null;
      const results = {}; TESTS.forEach(x => { results[x.id] = 20; });
      assessState = { idx: TESTS.length - 1, results, reassess: null };
      const subs = assessSubs();
      let err = null;
      try { finishAssessment(); } catch (e) { err = e.message; }
      try { closeSheet(); } catch (e) {}
      const prs = JSON.parse(JSON.stringify(STATE.prs || {}));
      STATE.profile.limitations = keep.lims;
      STATE.baseline = keep.baseline;
      STATE.prs = keep.prs;
      STATE.scoreHistory = keep.scoreHistory;
      return { subs, prs, err };
    });
    t.ok('guard: the battery really did substitute push, pull and stamina',
      !r.err && r.subs && r.subs.push === 'fistpushup' && r.subs.pull === 'towelrow'
      && r.subs.stamina === 'march', r);
    t.eq('a Fist Push-Up set is a Fist Push-Up record', r.prs.fistpushup, 20, r.prs);
    t.eq('and awards no Push-Up record for push-ups never done', r.prs.pushup, undefined, r.prs);
    t.eq('a Towel Door Row set is a Towel Door Row record', r.prs.towelrow, 20, r.prs);
    t.eq('and awards no Inverted Row record', r.prs.invertedrow, undefined, r.prs);
    t.eq('and awards no Burpee record for dead bugs', r.prs.burpee, undefined, r.prs);
    /* THE FLOOR. This block exists so the plank, side plank, squat and dead hang
       can be rated at all — nothing ever prescribes them as working sets. A fix
       that dropped un-substituted tests would satisfy every assertion above. */
    t.eq('a test that was NOT substituted still records its own PR', r.prs.plank, 20, r.prs);
    t.eq('and so does the squat', r.prs.squat, 20, r.prs);
    t.eq('and the side plank', r.prs.sideplank, 20, r.prs);
  }

  /* The results screen is the FOURTH consumer, and the one the athlete reads
     the second the battery ends. Before this it said "Burpees (max reps in
     60s) — 40 reps · +22 · 133% of the 30 reps benchmark · past it" to someone
     who had just done 40 Single-Leg Dead Bugs against a previous 18 that WAS a
     burpee. Named wrong, scored wrong, and congratulated on a rise that was a
     change of ruler. */
  {
    const r = await page.evaluate(() => {
      const keep = {
        lims: STATE.profile.limitations,
        baseline: JSON.parse(JSON.stringify(STATE.baseline || {})),
      };
      const prevResults = { plank:60,power:12,push:20,side:40,squat:30,hollow:35,pull:12,lower:14,dyn:50,stamina:18 };
      STATE.baseline = { date:'2026-01-01', protocol:TEST_PROTOCOL, subs:{},
        results: prevResults, maxes:{}, score:50, level:'Intermediate' };
      STATE.profile.limitations = ['wrist'];
      const subs = assessSubs();
      const results = Object.assign({}, prevResults, { stamina: 40, squat: 34 });
      assessState = { idx: TESTS.length - 1, results, reassess: 1 };
      const div = document.createElement('div');
      div.innerHTML = testBreakdownHTML(computeAssessment(results, subs));
      const rows = [...div.querySelectorAll('div[style*="border-top"]')]
        .map(x => x.textContent.replace(/\s+/g, ' ').trim());
      const find = frag => rows.find(x => x.indexOf(frag) === 0) || '';
      const out = {
        subs,
        burpeeTitled: rows.find(x => /^Burpees/.test(x)) || '',
        marchRow:  find(EX.march.name),
        fistRow:   find(EX.fistpushup.name),
        pushupRow: rows.find(x => /^Push-Ups/.test(x)) || '',
        squatRow:  find(TESTS.find(t => t.id === 'squat').name),
        rowCount:  rows.length,
      };
      STATE.profile.limitations = keep.lims;
      STATE.baseline = keep.baseline;
      return out;
    });
    t.ok('guard: the battery substituted push and stamina, and left squat alone',
      r.subs.push === 'fistpushup' && r.subs.stamina === 'march' && !r.subs.squat, r);
    t.ok('guard: every test still produced a row', r.rowCount === 10, r);
    t.ok('a swapped row is named after the movement actually performed', /Dead Bug/.test(r.marchRow), r);
    t.eq('and no row is TITLED with the movement that was not done', r.burpeeTitled, '', r);
    t.eq('nor claims a push-up that was not done', r.pushupRow, '', r);
    t.ok('and the row says it was swapped', /swapped/.test(r.marchRow), r);
    /* THE ONE THAT MATTERS. 40 against a previous 18 is +22 of nothing. */
    t.ok('a swapped test shows NO delta against a differently-measured previous run',
      !/\+22/.test(r.marchRow), r);
    /* THE FLOOR. An un-substituted test that really did improve must still be
       congratulated — a fix that withheld every delta passes the check above. */
    t.ok('while an un-swapped test that really improved keeps its delta',
      /\+4/.test(r.squatRow), r);
    t.ok('and an un-swapped row is not marked swapped', !/swapped/.test(r.squatRow), r);
    /* THREE states, and this is the one two states got wrong. burpee -> march is
       NOT re-scalable (different anchor, different unit), so the row must show
       no share at all. It used to print "133% of the 30 reps benchmark · past
       it" for 40 dead bugs — and calling that an estimate would have been
       inventing the number anchorRescale() declines to compute. */
    t.ok('an unconvertible swap shows NO benchmark share', !/%/.test(r.marchRow), r);
    t.eq('and does not congratulate the athlete for passing it', /past it/.test(r.marchRow), false, r);
    t.ok('and says why there is nothing to compare against', /No benchmark/.test(r.marchRow), r);
    /* A swap the app CAN re-scale keeps its share and says it is scaled: 20 Fist
       Push-Ups -> 21 push-up-equivalent -> 60% of the 35-rep benchmark. */
    t.ok('a re-scalable swap keeps a share', /60%/.test(r.fistRow), r);
    t.ok('and says the figure is scaled from the swap', /estimate/.test(r.fistRow), r);
    /* THE FLOOR under both: an ordinary un-swapped row keeps its plain share and
       claims nothing about a swap. */
    t.ok('an un-swapped row keeps its plain benchmark share', /85%/.test(r.squatRow), r);
    t.ok('and says nothing about scaling or missing benchmarks',
      !/estimate/.test(r.squatRow) && !/No benchmark/.test(r.squatRow), r);
  }

  /* Withholding a delta SILENTLY is the same defect in the other direction: the
     athlete reads a blank where a number used to be and has nothing to act on.
     Two reasons, two sentences — a record from before the stamp existed is not
     the same situation as a movement that genuinely changed. */
  {
    const r = await page.evaluate(() => {
      const keep = {
        lims: STATE.profile.limitations,
        baseline: JSON.parse(JSON.stringify(STATE.baseline || {})),
      };
      const prevResults = Object.fromEntries(TESTS.map(x => [x.id, 10]));
      const results = Object.fromEntries(TESTS.map(x => [x.id, 14]));
      const txt = () => {
        const d = document.createElement('div');
        d.innerHTML = testBreakdownHTML(computeAssessment(results, assessSubs()));
        return d.textContent.replace(/\s+/g, ' ');
      };
      const base = extra => Object.assign({ date: '2026-01-01', protocol: TEST_PROTOCOL,
        results: prevResults, score: 50, level: 'Intermediate' }, extra);

      STATE.profile.limitations = [];
      STATE.baseline = base({ subs: {} });
      assessState = { idx: TESTS.length - 1, results, reassess: 1 };
      const clean = txt();

      STATE.baseline = base({});                       // no stamp at all — pre-v320
      const legacy = txt();

      STATE.profile.limitations = ['wrist'];           // stamped both sides, movement changed
      STATE.baseline = base({ subs: {} });
      const swapped = txt();

      STATE.profile.limitations = keep.lims;
      STATE.baseline = keep.baseline;
      return { clean, legacy, swapped };
    });
    /* THE FLOOR: a genuine like-for-like re-test says nothing at all. A note that
       always fires is a note nobody reads. */
    t.ok('guard: a like-for-like re-test still shows its improvement', /\+4/.test(r.clean), r.clean);
    t.ok('and carries no explanation, because there is nothing to explain',
      !/No change shown on some tests/.test(r.clean), r.clean);
    t.ok('a prior with no swap stamp says the app could not check it',
      /predates the app recording which movement/.test(r.legacy), r.legacy);
    t.ok('a prior measured on a different movement says THAT instead',
      /different movement this time/.test(r.swapped), r.swapped);
    t.ok('and the two explanations are not the same sentence',
      !/predates the app recording which movement/.test(r.swapped), r.swapped);
  }

  {
    const r = await page.evaluate(() => {
      openPlayer();
      if (!PLAYER) return { skip: true };
      PLAYER.i = 0; PLAYER.s = 0;
      const m = plCur();
      if (!(m.sets >= 1)) { playerQuit(); return { skip: true }; }
      PLAYER.s = m.sets - 1;   // the LAST set, so the "record actual" branch runs
      PLAYER.repN = m.target; PLAYER.total = m.target; PLAYER.remain = 0;

      plAfterSet();
      const successToast = document.querySelector('#toast').textContent;
      playerQuit();

      // fresh session for the isolated failure path
      openPlayer();
      if (!PLAYER) return { skip: true };
      PLAYER.i = 0; PLAYER.s = 0;
      const m2 = plCur();
      PLAYER.s = m2.sets - 1;
      PLAYER.repN = m2.target; PLAYER.total = m2.target; PLAYER.remain = 0;
      const orig = window.markSetFromTimer;
      window.markSetFromTimer = () => { throw new Error('forced'); };
      plAfterSet();
      window.markSetFromTimer = orig;
      const failToast = document.querySelector('#toast').textContent;
      playerQuit();

      return { successToast, failToast };
    });
    if (r.skip) { t.fail('could not drive a completable set to test plAfterSet', r); }
    else {
      t.ok('a normal completed set does not warn about a save failure', !/may not have saved/.test(r.successToast), r.successToast);
      t.ok('but a forced logging failure surfaces a toast instead of staying silent', /may not have saved/.test(r.failToast), r.failToast);
    }
  }

  await browser.close();

  // ---- the readiness deload, in the timezone it was broken in --------------
  /* This one cannot be checked in the default context. The bug was invisible in
     UTC — which is where every previous review ran — and only appeared west of
     it, after 6pm local. */
  const tzb = await chromium.launch();
  for (const [when, label, expect] of [
    ['2026-08-08T14:00:00Z', 'morning', true],
    ['2026-08-09T02:00:00Z', 'evening', true],
    ['2026-08-09T05:30:00Z', 'late night', true],
  ]) {
    const ctx = await tzb.newContext({ timezoneId: 'America/Denver' });
    const pg = await ctx.newPage();
    await pg.clock.setFixedTime(new Date(when));
    await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForBoot(pg);
    const r = await pg.evaluate(() => {
      STATE.readiness = {};
      for (let i = 0; i < 3; i++) { const d = new Date(); d.setDate(d.getDate() - i);
        STATE.readiness[localISO(d)] = { score: 40, sleep: 1, sore: 1, energy: 1 }; }
      return { slump: readinessSlump(), deload: deloadOn({ week: 2 }), today: todayISO() };
    });
    t.ok(`three bad days trigger the deload in the ${label}, west of UTC`, r.slump === expect && r.deload === expect, { label, ...r });
    await ctx.close();
  }
  // and it must still say no when the days are genuinely fine
  {
    const ctx = await tzb.newContext({ timezoneId: 'America/Denver' });
    const pg = await ctx.newPage();
    await pg.clock.setFixedTime(new Date('2026-08-09T02:00:00Z'));
    await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForBoot(pg);
    const r = await pg.evaluate(() => {
      STATE.readiness = {};
      for (let i = 0; i < 3; i++) { const d = new Date(); d.setDate(d.getDate() - i);
        STATE.readiness[localISO(d)] = { score: 85, sleep: 3, sore: 3, energy: 3 }; }
      const good = readinessSlump();
      STATE.readiness = {}; const empty = readinessSlump();
      return { good, empty };
    });
    t.ok('three good days do not trigger it', r.good === false, r);
    t.ok('and neither does no data at all', r.empty === false, r);
    await ctx.close();
  }

  // ---- readinessMult() actually moves the real prescription -----------------
  /* readinessSlump() (above) and the normalizeState() repair (below) were the
     only readiness coverage in the suite — readinessMult() itself, the UI that
     writes it, and the card that displays it had none. Reading the code is not
     enough: focusBonus() looked identical and was proven DEAD by exactly this
     shape of check (set A, fingerprint the program, set B, fingerprint again,
     assert they differ, in the correct direction) across a spread of
     exercises and a real calendar position — not just at the seeded athlete's
     default day 0. */
  {
    const ctx = await tzb.newContext();
    const pg = await ctx.newPage();
    await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForBoot(pg);
    await seedAthlete(pg);   // a fresh context boots to a default, near-zero athlete — prescribe() needs real numbers to show a % swing
    const r = await pg.evaluate(() => {
      const pos = posOf(50);   // mid-cycle, mid-week — not the seeded athlete's day-0 pointer
      const bands = [
        ['unset', undefined, null],
        ['79', 79, 1.0], ['80', 80, 1.05],   // the >=80 boundary
        ['59', 59, 0.82], ['60', 60, 1.0],   // the >=60 boundary
        ['39', 39, 0.7], ['40', 40, 0.82],   // the >=40 boundary
        ['95', 95, 1.05], ['70', 70, 1.0], ['50', 50, 0.82], ['25', 25, 0.7],
      ];
      const mults = {};
      bands.forEach(([label, score]) => {
        if (score === undefined) delete STATE.readiness;
        else STATE.readiness = { [todayISO()]: { score, sleep: score, sore: score, energy: score } };
        mults[label] = readinessMult();
      });
      // real prescribe() output, anchored and unanchored exercises, across the band
      const fingerprint = score => {
        if (score == null) delete STATE.readiness;
        else STATE.readiness = { [todayISO()]: { score, sleep: score, sore: score, energy: score } };
        return { pushup: prescribe('pushup', pos), thruster: prescribe('dbthruster', pos) };
      };
      const none = fingerprint(null);
      const great = fingerprint(95);
      const poor = fingerprint(25);
      const setsCut = { at82: fingerprint(50), at100: fingerprint(70) };
      delete STATE.readiness;
      return { mults, bands, none, great, poor, setsCut };
    });
    t.eq('band boundaries match the documented thresholds', r.mults, {
      unset: 1, '79': 1.0, '80': 1.05, '59': 0.82, '60': 1.0, '39': 0.7, '40': 0.82,
      '95': 1.05, '70': 1.0, '50': 0.82, '25': 0.7,
    });
    t.ok('great readiness raises the real target above no-readiness',
      r.great.pushup.target > r.none.pushup.target && r.great.thruster.target > r.none.thruster.target,
      { great: r.great, none: r.none });
    t.ok('poor readiness lowers the real target below no-readiness',
      r.poor.pushup.target < r.none.pushup.target && r.poor.thruster.target < r.none.thruster.target,
      { poor: r.poor, none: r.none });
    t.ok('a multiplier under 0.85 also cuts a set, one at 1.0 does not',
      r.setsCut.at82.pushup.sets < r.setsCut.at100.pushup.sets, r.setsCut);
    await ctx.close();
  }

  // ---- the readiness sheet itself: write, re-open, display ------------------
  {
    const ctx = await tzb.newContext();
    const pg = await ctx.newPage();
    await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForBoot(pg);
    await seedAthlete(pg);
    const r = await pg.evaluate(() => {
      delete STATE.readiness;
      const out = {};
      // incomplete: only two of three picked
      _rdy = { sleep: 100, sore: 60 };
      out.incompleteRejected = (() => { saveReadiness(); return !STATE.readiness || !STATE.readiness[todayISO()]; })();
      // complete: tap sleep=Poor(25), sore=Some(60), energy=High(100) -> avg 61.67 -> round 62
      _rdy = {};
      openReadiness();
      _rdy.sleep = 25; openReadiness();
      _rdy.sore = 60; openReadiness();
      _rdy.energy = 100; openReadiness();
      const sheetBeforeSave = document.querySelector('#sheet').innerHTML;
      saveReadiness();
      const saved = STATE.readiness[todayISO()];
      out.scoreIsRoundedAverage = saved.score === 62;
      out.fieldsStored = saved.sleep === 25 && saved.sore === 60 && saved.energy === 100;
      out.chipsMarkedOnBeforeSave = /class="chip on"[^>]*>🥱 Poor/.test(sheetBeforeSave)
        && /class="chip on"[^>]*>😐 Some/.test(sheetBeforeSave)
        && /class="chip on"[^>]*>⚡ High/.test(sheetBeforeSave);
      // closeSheet() clears #sheet's innerHTML on a 400ms setTimeout, not
      // synchronously — the scrim's 'open' class is what it clears immediately
      out.sheetClosedAfterSave = !document.querySelector('#scrim').classList.contains('open');
      // re-opening the same day pre-fills from what was just saved, not a blank sheet
      _rdy = {};
      openReadiness();
      const reopened = document.querySelector('#sheet').innerHTML;
      out.reopenPrefillsSleep = /class="chip on"[^>]*>🥱 Poor/.test(reopened);
      out.reopenPrefillsEnergy = /class="chip on"[^>]*>⚡ High/.test(reopened);
      closeSheet();
      // the card reflects each band with the right tag
      const cardFor = score => {
        STATE.readiness = { [todayISO()]: { score, sleep: score, sore: score, energy: score } };
        return readinessCardHTML();
      };
      out.cardPrimed = /Primed/.test(cardFor(90));
      out.cardReady = /Ready/.test(cardFor(65));
      out.cardEaseUp = /Ease up/.test(cardFor(45));
      out.cardRecover = /Recover/.test(cardFor(20)) && /eased/.test(cardFor(20));
      delete STATE.readiness;
      out.cardUnfilledPrompt = /Readiness check/.test(readinessCardHTML());
      return out;
    });
    t.ok('saving with a field unpicked is rejected, nothing is written', r.incompleteRejected, r);
    t.ok('the score is the rounded average of the three picks', r.scoreIsRoundedAverage, r);
    t.ok('sleep, sore and energy are stored individually, not just the average', r.fieldsStored, r);
    t.ok('the tapped chips show selected before saving', r.chipsMarkedOnBeforeSave, r);
    t.ok('the sheet closes after a successful save', r.sheetClosedAfterSave, r);
    t.ok('re-opening the same day pre-fills the sleep pick', r.reopenPrefillsSleep, r);
    t.ok('and the energy pick', r.reopenPrefillsEnergy, r);
    t.ok('the card reads "Primed" at 90', r.cardPrimed, r);
    t.ok('"Ready" at 65', r.cardReady, r);
    t.ok('"Ease up" at 45', r.cardEaseUp, r);
    t.ok('"Recover" at 20, naming that today was eased', r.cardRecover, r);
    t.ok('an unfilled day shows the quiet prompt, not a score', r.cardUnfilledPrompt, r);
    await ctx.close();
  }

  // ---- objective training-load tracking (ACWR), independent of readiness --
  /* readinessMult()/readinessSlump() are both SELF-reported — exactly the
     signal a driven athlete under-reports right up until they get hurt.
     acwr() tracks what was actually DONE (logged sets), comparing this
     week's total against the trailing 4-week average — a real spike must
     ease the load even when the athlete says they feel great, and it must
     say NOTHING when there isn't enough history for the ratio to mean
     anything. loggedSetsOn() buckets by localISO() exactly like
     readinessSlump() does — the same west-of-UTC bug is possible here, so
     this runs in the same non-UTC timezone context as that check. */
  {
    const ctx = await tzb.newContext({ timezoneId: 'America/Denver' });
    const pg = await ctx.newPage();
    await pg.clock.setFixedTime(new Date('2026-08-09T02:00:00Z'));   // evening, west of UTC
    await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForBoot(pg);
    const r = await pg.evaluate(() => {
      const keep = JSON.stringify(STATE.logs || {});
      const dISO = daysAgo => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return localISO(d); };
      const fakeLog = (dateISO, sets) => ({ done: true, completedAt: dateISO, setsDone: sets, setsAsked: sets });
      const out = {};

      STATE.logs = {};
      out.noHistory = { ratio: acwr(), spike: loadSpike() };

      // steady 3x/week, 12 sets/session, for 4 weeks -> this week ~= chronic average
      let idx = 0;
      for (let w = 0; w < 4; w++) for (const dow of [0, 2, 4]) STATE.logs[idx++] = fakeLog(dISO(w * 7 + dow), 12);
      out.steady = { ratio: acwr(), spike: loadSpike() };

      // same 3 prior weeks, but this week trains every day -> a real spike
      STATE.logs = {}; idx = 0;
      for (let w = 1; w < 4; w++) for (const dow of [0, 2, 4]) STATE.logs[idx++] = fakeLog(dISO(w * 7 + dow), 12);
      for (let dow = 0; dow < 7; dow++) STATE.logs[idx++] = fakeLog(dISO(dow), 12);
      out.spike = { ratio: acwr(), spike: loadSpike() };
      // isolate from calendar/readiness so this is provably the spike alone
      const posKeep = STATE.progressPtr; STATE.progressPtr = 3;   // week 1 of cycle 0, not a deload week
      delete STATE.readiness;
      out.spikeAloneDeloads = deloadOn();
      out.spikeBanner = deloadBanner();
      STATE.progressPtr = posKeep;

      // guard: only 1 of the 4 weekly buckets has anything -> not enough history
      STATE.logs = {}; idx = 0;
      for (let dow = 0; dow < 3; dow++) STATE.logs[idx++] = fakeLog(dISO(dow), 40);
      out.thinHistory = { ratio: acwr(), spike: loadSpike() };

      // abandoned and pain-stopped sessions must not count toward load. In
      // real data completedAt is only ever set alongside done:true — an
      // abandoned/stoppedForPain log never gets one — so a fixture missing
      // completedAt would pass this check whether or not the done guard
      // exists at all. Set completedAt explicitly too, so this actually
      // exercises the done check and not just the date match.
      STATE.logs = {};
      STATE.logs[0] = { done: false, abandonedAt: dISO(0), completedAt: dISO(0), setsDone: 5 };
      STATE.logs[1] = { done: false, stoppedForPain: dISO(1), completedAt: dISO(1), setsDone: 3 };
      out.abandonedCounted = loggedSetsOn(dISO(0));
      out.painStoppedCounted = loggedSetsOn(dISO(1));

      // calendar week 6 still wins the banner even if a spike is ALSO true
      STATE.logs = {}; idx = 0;
      for (let w = 1; w < 4; w++) for (const dow of [0, 2, 4]) STATE.logs[idx++] = fakeLog(dISO(w * 7 + dow), 12);
      for (let dow = 0; dow < 7; dow++) STATE.logs[idx++] = fakeLog(dISO(dow), 12);
      const posKeep2 = STATE.progressPtr; STATE.progressPtr = SESSIONS_PER_CYCLE * WEEKS_PER_CYCLE - 1;
      out.calendarStillWinsBanner = /Deload week —/.test(deloadBanner()) && !/Weekly volume spiked/.test(deloadBanner());
      STATE.progressPtr = posKeep2;

      STATE.logs = JSON.parse(keep);
      return out;
    });
    t.eq('no logged history at all is "not enough data", never a spike', r.noHistory, { ratio: null, spike: false });
    t.ok('a steady weekly pattern reads close to a 1.0 ratio', Math.abs(r.steady.ratio - 1) < 0.1, r.steady);
    t.ok('and does not read as a spike', !r.steady.spike, r.steady);
    t.ok('tripling this week\'s sets against a steady baseline reads as a real spike', r.spike.ratio >= 1.5 && r.spike.spike, r.spike);
    t.ok('a spike alone (no calendar deload, no readiness slump) still triggers deloadOn()', r.spikeAloneDeloads, r);
    t.ok('and the banner names the REAL reason — weekly volume, not the generic deload message', /Weekly volume spiked/.test(r.spikeBanner), r.spikeBanner);
    t.eq('with only 1 of 4 weeks logged, the ratio is withheld rather than guessed', r.thinHistory, { ratio: null, spike: false });
    t.eq('an abandoned session contributes zero sets to the load', r.abandonedCounted, 0);
    t.eq('a pain-stopped session contributes zero sets to the load', r.painStoppedCounted, 0);
    t.ok('the calendar deload week still shows the generic message even with a spike also true', r.calendarStillWinsBanner, r);
    await ctx.close();
  }

  // ---- acwr() stays cheap at a realistic year of REAL matching history ----
  /* The first version scanned all of STATE.logs once per day queried (28
     scans per acwr() call) — invisible at a handful of sessions, and
     deloadOn() (which calls acwr()) runs on every exercise of every
     prescribe() call, including historical ones the Progress tab
     reconstructs. The launch-gates performance budget caught this by
     accident (its fabricated logs use a `date` field, not `completedAt`,
     so they never actually match — the cost was in scanning regardless of
     match count). This is the direct, ACWR-specific version: real
     completedAt-matching entries, called repeatedly, with a real budget. */
  {
    const ctx = await tzb.newContext();
    const pg = await ctx.newPage();
    await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForBoot(pg);
    const r = await pg.evaluate(() => {
      STATE.logs = {};
      for (let i = 0; i < 365; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        STATE.logs[i] = { done: true, completedAt: localISO(d), setsDone: 12 };
      }
      const t0 = performance.now();
      for (let i = 0; i < 300; i++) deloadOn();
      const ms = performance.now() - t0;
      const ratio = acwr();
      STATE.logs = {};
      return { ms, ratio };
    });
    t.ok('300 deloadOn() calls against a year of real logged history stay well under budget',
      r.ms < 200, r);
    t.ok('guard: this really did compute a real ratio, not skip the work entirely',
      typeof r.ratio === 'number' && Math.abs(r.ratio - 1) < 0.05, r);
    await ctx.close();
  }

  await tzb.close();

  await tzb.close();

  srv.close();
  return t.finish(errors);
}
