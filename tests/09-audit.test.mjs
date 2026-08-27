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

  const FORCE_EVENTS_EX = ['sbaglift', 'sbagshuttle', 'rushes', 'sbagdrag'];
  /* ---- the FORCE Evaluation prep block (v322) ------------------------------
     A published fitness standard MOVES — the US Army replaced the ACFT's event
     list mid-2025 — and this app cannot reach the internet to check. A figure
     shown with confidence that is a year stale is worse than no figure,
     because the athlete trains to it. So the screen stamps what it knows and
     when, and says whose job it is to confirm. */
  {
    const r = await page.evaluate(() => {
      const keep = {
        gear: (STATE.profile.gear || []).slice(),
        lims: STATE.profile.limitations,
        prep: JSON.parse(JSON.stringify(STATE.prep || {})),
        parq: STATE.profile.parq, parqDone: STATE.profile.parqDone,
        medCleared: STATE.profile.medCleared,
      };
      STATE.profile.gear = ['bar', 'bench', 'sandbag'];
      STATE.profile.limitations = [];
      STATE.prep = {};
      const sheet = () => (document.querySelector('#sheet') || {}).textContent.replace(/\s+/g, ' ') || '';
      const o = {};

      /* An earlier block in this file leaves the athlete un-onboarded, so Today
         renders the welcome screen and NO tiles at all. Build the state this
         block asserts on, and guard that the tile row really rendered — the
         check would otherwise pass on nothing the day someone deletes it. */
      keep.onboarded = STATE.onboarded;
      STATE.onboarded = true;
      go('today'); TODAY_TAB = 'workout'; render();
      const tv = document.querySelector('#v-today').innerHTML;
      o.altRowRendered = /openRestSheet\(\)/.test(tv);
      o.tileOnToday = /openForcePrep\(\)/.test(tv);
      /* Order matters: v246 removed these tiles from Today at the athlete's
         request as clutter and v314 brought them back BELOW the session. A
         bare "the tile is on Today" assertion passes on exactly the layout
         that was rejected. */
      o.tileAfterSession = tv.indexOf('openForcePrep()') > tv.indexOf('id="finishSession"');

      openForcePrep();
      o.saysConfirm = /Confirm these figures with your unit/.test(sheet());
      o.stampsAsOf  = sheet().indexOf(FORCE_ASOF) >= 0;
      o.saysNoInternet = /cannot check them for you/.test(sheet());
      o.unmeasuredCount = (sheet().match(/not measured/g) || []).length;
      o.namesEvents = FORCE_EVENTS.every(e => sheet().indexOf(e.name) >= 0);

      // one under the standard, one over, one pass/fail task
      setForceResultQuiet('lift', 190);
      setForceResultQuiet('rush', 60);
      setForceResultQuiet('drag', 1);
      closeSheet(); openForcePrep();
      o.verdicts = FORCE_IDS.map(id => forceVerdict(id));
      o.showsMeets = /meets it/.test(sheet());
      o.showsShort = /short/.test(sheet());
      o.stillUnmeasured = (sheet().match(/not measured/g) || []).length;

      // a date paces the build
      const d = new Date(); d.setDate(d.getDate() + 70);
      STATE.prep.date = d.toISOString().slice(0, 10);
      closeSheet(); openForcePrep();
      o.weeks = forceWeeksLeft();
      o.showsWeeks = /10 weeks to go/.test(sheet());

      // junk in the stored block must not reach the screen or the next backup
      STATE.prep = { results: { lift: 'abc', bogus: 5, rush: -3, drag: 1 }, date: 'soon' };
      normalizeState();
      o.repaired = JSON.parse(JSON.stringify(STATE.prep));

      // an array where the block belongs
      STATE.prep = [];
      normalizeState();
      o.arrayRepaired = !Array.isArray(STATE.prep) && typeof STATE.prep === 'object';

      // SAFETY: a flagged, uncleared health screen does not get handed
      // four maximal efforts under load
      STATE.prep = {};
      STATE.profile.parq = ['heart']; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
      closeSheet();
      startForceTrain();
      o.safeModeBlocked = !(PLAYER && PLAYER.items);
      o.safeModeSheet = sheet().slice(0, 120);
      try { playerQuit(); } catch (e) {}
      closeSheet();

      // cleared: the session builds, and it builds the four real tasks
      STATE.profile.parq = []; STATE.profile.medCleared = true;
      startForceTrain();
      o.built = !!(PLAYER && PLAYER.items);
      o.builtIds = (PLAYER && PLAYER.items || []).map(i => i.exId);
      try { playerQuit(); } catch (e) {}

      /* WITH A JOINT FLAGGED. The check above runs unflagged, so safeSwap() is
         the identity there and a mutant that silently substitutes is
         EQUIVALENT — it escaped exactly that way. The whole product decision
         is that these four are NOT swapped, and only a flagged athlete can
         tell the two behaviours apart. */
      STATE.profile.limitations = ['lowback', 'wrist'];
      o.wouldSwap = FORCE_EVENTS.map(e => safeSwap(e.ex));
      startForceTrain();
      o.flaggedIds = (PLAYER && PLAYER.items || []).map(i => i.exId);
      try { playerQuit(); } catch (e) {}
      STATE.profile.limitations = [];

      // WARN, do not swap: a flagged joint names the movement and keeps it
      STATE.profile.limitations = ['lowback'];
      o.riskNames = forceRiskHTML();
      STATE.profile.limitations = [];
      o.riskClean = forceRiskHTML();

      /* NO SANDBAG. Every other path that picks a movement asks hasGearFor() —
         builderPool(), gearSwap(), weightsPool() — and this one did not, so a
         bagless athlete tapping "Train the four tasks" was handed all four,
         three of which they physically cannot do. */
      STATE.profile.gear = ['bar', 'bench'];
      closeSheet(); openForcePrep();
      o.bagSheetWarns = /You need a 20 kg sandbag/.test(sheet());
      o.bagSheetNames = /Sandbag Lift/.test(sheet());
      o.bagSheetSaysNoSubs = /a stand-in would leave you unready/.test(sheet());
      startForceTrain();
      o.baglessIds = (PLAYER && PLAYER.items || []).map(i => i.exId);
      o.baglessAllDoable = o.baglessIds.every(k => hasGearFor(k));
      try { playerQuit(); } catch (e) {}
      closeSheet();

      /* THE FLOOR: a note that always fires is a note nobody reads. With the
         bag owned there must be nothing to say at all. */
      STATE.profile.gear = ['bar', 'bench', 'sandbag'];
      o.kitNoteWithBag = forceKitHTML();
      openForcePrep();
      o.sheetWithBagQuiet = !/You need a 20 kg sandbag/.test(sheet());
      o.buttonSaysFour = /Train the four tasks/.test(sheet());
      closeSheet();

      /* The "nothing available at all" guard is unreachable on today's library
         because the rushes need no kit. Exercise it directly, the same way the
         hardness-band guard is exercised, so a future EX edit that gives them
         an equip requirement does not walk straight through. */
      const rushEquip = EX.rushes.equip;
      EX.rushes.equip = ['sandbag'];
      STATE.profile.gear = ['bar', 'bench'];
      o.availWhenNothing = forceAvailable().length;
      startForceTrain();
      o.builtWhenNothing = !!(PLAYER && PLAYER.items && PLAYER.items.length);
      o.refusalToast = (document.querySelector('#toast') || {}).textContent || '';
      try { playerQuit(); } catch (e) {}
      EX.rushes.equip = rushEquip;
      closeSheet();

      STATE.profile.gear = keep.gear; STATE.profile.limitations = keep.lims;
      STATE.prep = keep.prep;
      STATE.profile.parq = keep.parq; STATE.profile.parqDone = keep.parqDone;
      STATE.profile.medCleared = keep.medCleared;
      STATE.onboarded = keep.onboarded;
      try { closeSheet(); } catch (e) {}
      return o;
    });

    t.ok('guard: the alternate-session tile row really rendered', r.altRowRendered, r);
    t.ok('the FORCE tile is on Today', r.tileOnToday, r);
    t.ok('and it sits BELOW the session, not in front of it', r.tileAfterSession, r);
    t.ok('the sheet names every event', r.namesEvents, r);
    /* The honesty half. Without these the screen states a fitness standard as
       fact, from an app that cannot check it. */
    t.ok('it says to confirm the figures with your unit', r.saysConfirm, r);
    t.ok('and stamps when it last knew them', r.stampsAsOf, r);
    t.ok('and says it cannot check them itself', r.saysNoInternet, r);
    /* Absent is "not measured", which is a different answer from "failed" and
       must never render as one. */
    t.eq('with nothing logged, all four read as not measured', r.unmeasuredCount, 4, r);
    t.eq('a time under the standard passes', r.verdicts[0], 'pass', r);
    t.eq('a time over it is short', r.verdicts[2], 'fail', r);
    t.eq('the pass/fail drag reads its own way', r.verdicts[3], 'pass', r);
    t.eq('and an event never logged stays unmeasured', r.verdicts[1], null, r);
    t.ok('the screen shows both verdicts', r.showsMeets && r.showsShort, r);
    t.eq('and still says not measured for the one that is not', r.stillUnmeasured, 1, r);
    t.eq('a test date is counted in weeks', r.weeks, 10, r);
    t.ok('and shown', r.showsWeeks, r);
    /* Three levels of repair, because a container check is not a type repair
       and one map holds several inputs. */
    t.eq('a junk time is dropped, not zeroed', r.repaired.results.lift, undefined, r.repaired);
    t.eq('an unknown event id is dropped', r.repaired.results.bogus, undefined, r.repaired);
    t.eq('a negative time is dropped', r.repaired.results.rush, undefined, r.repaired);
    t.eq('and the good entry beside them survives', r.repaired.results.drag, 1, r.repaired);
    t.eq('a junk date is dropped', r.repaired.date, undefined, r.repaired);
    t.ok('an array where the block belongs is repaired', r.arrayRepaired, r);
    /* SAFETY, and it fails closed. These are four maximal efforts under load —
       the same call the baseline battery makes. */
    t.ok('a flagged, uncleared health screen does not get the session', r.safeModeBlocked, r);
    t.ok('and is sent to the health screen instead', r.safeModeSheet.length > 0, r);
    t.ok('floor: a cleared athlete DOES get it', r.built, r);
    t.eq('and gets the four real test events', r.builtIds,
      ['sbaglift', 'sbagshuttle', 'rushes', 'sbagdrag'], r);
    t.ok('guard: with a joint flagged, safeSwap WOULD move at least two of them',
      r.wouldSwap.filter((k, i) => k !== FORCE_EVENTS_EX[i]).length >= 2,
      { wouldSwap: r.wouldSwap });
    t.eq('and it still builds the four real test events, not the substitutes',
      r.flaggedIds, ['sbaglift', 'sbagshuttle', 'rushes', 'sbagdrag'], r);
    /* WARN, do not silently swap: these are the actual test events, and
       substituting one leaves the athlete unprepared for the thing they will
       be asked to do. Same call as the custom builder. */
    t.ok('a flagged joint is named rather than swapped away', /Sandbag Lift/.test(r.riskNames), r);
    t.ok('and the warning says they are not swapped here', /not swapped here/.test(r.riskNames), r);
    t.eq('floor: an unflagged athlete sees no warning at all', r.riskClean, '', r);
    /* Gear, and it does NOT substitute — same call as the joint case. */
    t.ok('without a sandbag the sheet says so plainly', r.bagSheetWarns, r);
    t.ok('and names which tasks need it', r.bagSheetNames, r);
    t.ok('and says nothing is stood in for', r.bagSheetSaysNoSubs, r);
    t.eq('the session drops what cannot be done rather than handing it over',
      r.baglessIds, ['rushes'], r);
    t.ok('so every movement in it is one the athlete can actually perform',
      r.baglessAllDoable, r);
    /* THE FLOOR: the rushes need no kit at all, so a bagless athlete still
       gets real work rather than an empty session. */
    t.ok('and there is still something to train', r.baglessIds.length > 0, r);

    /* ---- army running (v323) ----------------------------------------------
       The FORCE Evaluation has no run in it, and running is still the aerobic
       base underneath everything else. THE TIMED RUN HAS NO PASS FIGURE BAKED
       IN, and that is the point: what you have to run depends on the trade,
       the age band and which test the unit uses, none of which this app can
       know. A number invented here is one the athlete would train to. */
    const ar = await page.evaluate(() => {
      const keep = JSON.parse(JSON.stringify(STATE.prep || {}));
      const sheet = () => (document.querySelector('#sheet') || {}).textContent.replace(/\s+/g, ' ');
      const o = {};
      STATE.prep = {};
      openArmyRun();
      o.namesEverySession = RUN_SESSIONS.every(x => sheet().indexOf(x.name) >= 0);
      o.sessionCount = RUN_SESSIONS.length;
      o.saysNoTargetBuiltIn = /No target time is built in, on purpose/.test(sheet());
      o.noVerdict = runTTVerdict();

      STATE.prep.ttTarget = 716; STATE.prep.ttBest = 700;
      o.under = runTTVerdict();
      STATE.prep.ttBest = 740;
      o.over = runTTVerdict();
      closeSheet(); openArmyRun();
      o.showsVerdict = /short/.test(sheet());
      /* THE FLOOR: a note that always fires is a note nobody reads. Once a
         target is set there is nothing to explain. */
      o.quietOnceSet = !/No target time is built in/.test(sheet());
      /* And a best with NO target is still not a verdict — measuring is not
         the same as passing. */
      delete STATE.prep.ttTarget;
      o.bestWithoutTarget = runTTVerdict();

      /* Starting a session sets the pace and hands the athlete back to Today.
         It does NOT log the run for them — a session you were offered is not a
         session you ran, the same rule the completion gate enforces. */
      STATE.prep = {}; setRunVal(0);
      startRunSession('tempo');
      o.started = { mode: cardioMode(), pace: movement().nlvl,
                    loggedForThem: runWork().min, tab: TODAY_TAB };

      // junk in the stored times must not reach the screen or the next backup
      STATE.prep = { ttBest: 'fast', ttTarget: -5, results: {} };
      normalizeState();
      o.repaired = JSON.parse(JSON.stringify(STATE.prep));
      // and a real time beside them survives
      STATE.prep = { ttBest: 700, ttTarget: 'soon', results: {} };
      normalizeState();
      o.goodSurvives = STATE.prep.ttBest;
      o.badTargetDropped = STATE.prep.ttTarget === undefined;

      STATE.prep = keep;
      try { closeSheet(); } catch (e) {}
      return o;
    });
    t.ok('guard: there is a real set of running sessions', ar.sessionCount >= 5, ar);
    t.ok('the army running sheet names every one', ar.namesEverySession, ar);
    /* The honesty half, and the reason this differs from the FORCE figures:
       there those are stamped and confirmable, here no figure exists to stamp. */
    t.ok('it says no target time is built in, and why', ar.saysNoTargetBuiltIn, ar);
    t.eq('with nothing logged there is no verdict', ar.noVerdict, null, ar);
    t.eq('and a time with no target is still not a verdict', ar.bestWithoutTarget, null, ar);
    t.eq('a time under the athlete\'s own target passes', ar.under, 'pass', ar);
    t.eq('and one over it is short', ar.over, 'short', ar);
    t.ok('the verdict reaches the screen', ar.showsVerdict, ar);
    t.ok('floor: once a target is set the explanation stops firing', ar.quietOnceSet, ar);
    /* Offered is not done. */
    t.eq('starting a session sets the run mode', ar.started.mode, 'run', ar);
    t.eq('and its pace', ar.started.pace, 'tempo', ar);
    t.eq('and sends the athlete to the tab that logs it', ar.started.tab, 'workout', ar);
    t.eq('but logs nothing on their behalf', ar.started.loggedForThem, 0, ar);
    t.eq('a junk best time is dropped, not zeroed', ar.repaired.ttBest, undefined, ar.repaired);
    t.eq('a negative target is dropped', ar.repaired.ttTarget, undefined, ar.repaired);
    t.eq('floor: a real time beside a junk one survives', ar.goodSurvives, 700, ar);
    t.ok('and only the junk one is dropped', ar.badTargetDropped, ar);

    /* ---- the endurance block (v325) ---------------------------------------
       `prep.date` was stored and counted down and NOTHING scheduled against
       it — the timelineWeeks defect verbatim. THE 10% RULE IS THE POINT:
       running volume that climbs faster than about a tenth a week is how
       people arrive at selection injured rather than fit.

       And the rule governs the CURVE, not the step back up out of a down
       week. A naive week-on-week assertion would fail on correct code and
       then get "fixed" by removing the down weeks, which is the opposite of
       what the plan needs. */
    const en = await page.evaluate(() => {
      const keep = JSON.parse(JSON.stringify(STATE.prep || {}));
      const keepDays = JSON.parse(JSON.stringify(nut().days || {}));
      const iso = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
      const o = {};

      STATE.prep = {};
      o.noDate = !!enduranceWeek().noDate;
      o.noDateSaysSo = /Set your test date and this becomes a plan/.test(enduranceHTML());

      // nothing logged: it opens LOW and says the number is a floor
      STATE.prep = { date: iso(140), planFrom: iso(0) };
      const w1 = enduranceWeek();
      o.floorStart = { km: w1.km, estimated: w1.estimated, floor: PREP_FLOOR_KM };
      o.floorSaysSo = /Starting low, because nothing is logged yet/.test(enduranceHTML());

      // with real logged running it builds from what the athlete actually does
      const days = nut().days;
      for (let i = 1; i <= 21; i++) { const d = iso(-i);
        days[d] = days[d] || { water: 0, habits: {} };
        if (i % 2 === 0) { days[d].runVal = 5; days[d].runUnit = 'dist'; days[d].runLvl = 'steady'; } }
      o.trailing = Math.round(trailingRunKm() * 10) / 10;
      STATE.prep.planFrom = iso(0);
      const r1 = enduranceWeek();
      o.fromLogs = { km: r1.km, estimated: r1.estimated };

      // the ramp across eight weeks
      const weeks = [];
      for (let w = 0; w < 8; w++) { STATE.prep.planFrom = iso(-7 * w);
        const e = enduranceWeek(); weeks.push({ wk: e.wk, km: e.km, curve: e.curve, down: e.down }); }
      o.weeks = weeks;
      /* Read the app's OWN cap rather than restating it, and allow for the
         curve being rounded to one decimal for display — 18.3/16.7 reads as
         1.1038 against an exact 1.10. The allowance is the rounding, not
         slack in the rule. */
      o.cap = PREP_RAMP;
      o.curveClimb = weeks.slice(1).map((w, i) => w.curve / weeks[i].curve);
      o.curveWithinCap = weeks.slice(1).every((w, i) => w.curve <= weeks[i].curve * PREP_RAMP + 0.1);
      /* MEASURE THE PAYLOAD, NOT THE CONTAINER. `curve` is what the screen
         explains; `km` is what the athlete actually runs. A mutant that
         flattened km to the starting distance left curve climbing and walked
         through every assertion above. */
      const norm = weeks.filter(w => !w.down);
      o.kmClimbs = norm.slice(1).every((w, i) => w.km > norm[i].km);
      o.kmWithinCap = norm.slice(1).every((w, i) => w.km <= norm[i].km * Math.pow(PREP_RAMP, w.wk - norm[i].wk) + 0.1);
      o.downWeeks = weeks.filter(w => w.down).map(w => ({ wk: w.wk, km: w.km, curve: w.curve }));
      const bounce = [];
      weeks.forEach((w, i) => { if (i < 2 || !weeks[i - 1].down) return;
        bounce.push({ from: weeks[i - 2].km, to: w.km, weeksApart: 2 }); });
      o.bounce = bounce;

      STATE.prep.planFrom = iso(0);
      o.phases = [200, 80, 40, 10].map(d => { STATE.prep.date = iso(d); return prepPhase(); });
      STATE.prep.date = iso(10); const taper = enduranceWeek().km;
      STATE.prep.date = iso(140); const full = enduranceWeek().km;
      o.taperCuts = taper < full;

      /* Changing the test date must NOT restart a block already trained, and
         SETTING THE FIELD IS NOT DRIVING THE ROUTE — the stamping code lives
         in saveForceDate(), so a mutant that re-stamps on every save walked
         straight through a check that assigned STATE.prep.date by hand. */
      STATE.prep = { date: iso(140), planFrom: iso(-35) };
      const before = prepWeekNo(), stampedBefore = STATE.prep.planFrom;
      openForceDate();
      const di = document.querySelector('#fq-date');
      if (di) { di.value = iso(90); saveForceDate(); }
      try { closeSheet(); } catch (e) {}
      o.drovenSave = !!di && STATE.prep.date === iso(90);
      o.planFromKept = STATE.prep.planFrom === stampedBefore && prepWeekNo() === before;
      /* And the FLOOR: a first-ever save must stamp one, or nothing ever
         progresses past week 1. */
      STATE.prep = {};
      openForceDate();
      const di2 = document.querySelector('#fq-date');
      if (di2) { di2.value = iso(140); saveForceDate(); }
      try { closeSheet(); } catch (e) {}
      o.firstSaveStamps = typeof STATE.prep.planFrom === 'string';
      /* A record with no stamp reads as week 1 — the fail-safe direction,
         because it prescribes LESS, not more. */
      delete STATE.prep.planFrom;
      o.noStampIsWeekOne = prepWeekNo() === 1;
      STATE.prep.planFrom = 'soon';
      normalizeState();
      o.junkStampDropped = STATE.prep.planFrom === undefined;

      STATE.prep = keep; nut().days = keepDays;
      return o;
    });

    t.ok('with no test date there is no plan, and it says so', en.noDate && en.noDateSaysSo, en);
    /* PIN THE VALUE, not just "it equals its own constant" — comparing the app
       to itself passes however high the floor is raised, and guessing high is
       the failure that costs a tendon. */
    t.eq('the opening floor is a genuinely conservative number', en.floorStart.floor, 8, en);
    t.eq('with nothing logged it opens there', en.floorStart.km, 8, en);
    t.ok('and says the number is a floor, not a measurement', en.floorSaysSo, en);
    t.ok('guard: the seeded runs really are ~17 km a week',
      en.trailing > 12 && en.trailing < 22, en);
    t.eq('with runs logged it builds from what the athlete actually does',
      en.fromLogs.km, en.trailing, en);
    t.ok('and stops calling the figure an estimate', !en.fromLogs.estimated, en);
    /* THE RULE. */
    t.eq('guard: the cap is the app\'s own constant, not a number restated here',
      en.cap, 1.10, en);
    t.ok('the underlying curve never climbs faster than the cap',
      en.curveWithinCap, { curveClimb: en.curveClimb, weeks: en.weeks });
    /* And the number the athlete actually runs. */
    t.ok('the prescribed distance really climbs week on week', en.kmClimbs, en.weeks);
    t.ok('and never faster than the cap either', en.kmWithinCap, en.weeks);
    t.ok('guard: and it really does climb — a flat curve satisfies the cap trivially',
      en.curveClimb.every(x => x > 1.0), { curveClimb: en.curveClimb });
    /* Every fourth week is a real cut. A plan with no down weeks is a plan
       that ends in a deload the athlete did not choose. */
    t.ok('guard: there is at least one down week in eight', en.downWeeks.length >= 1, en);
    t.ok('a down week is a genuine cut against its own curve',
      en.downWeeks.every(w => w.km < w.curve * 0.85), en.downWeeks);
    /* And the bounce out of one is still capped against the last UNCUT week —
       a naive week-on-week assertion fails here on correct code. */
    t.ok('guard: there is a bounce out of a down week to check', en.bounce.length >= 1, en);
    t.ok('coming out of a down week is capped against the last uncut week',
      en.bounce.every(b => b.to <= b.from * Math.pow(en.cap, b.weeksApart) + 0.1), en.bounce);
    t.eq('the phases run base, build, sharpen, taper', en.phases,
      ['base', 'build', 'sharpen', 'taper'], en);
    t.ok('and the taper actually cuts volume', en.taperCuts, en);
    /* Changing the date must not restart a block already trained. */
    t.ok('guard: the save really was driven through the sheet', en.drovenSave, en);
    t.ok('changing the test date keeps the plan running from when it started', en.planFromKept, en);
    t.ok('floor: a first-ever save does stamp one', en.firstSaveStamps, en);
    t.ok('a record with no stamp reads as week one — it prescribes less, not more',
      en.noStampIsWeekOne, en);
    t.ok('and a junk stamp is dropped', en.junkStampDropped, en);

    /* ---- the plan matches its own phase notes (v330) ---------------------

       Every note in PREP_PHASE_NOTE is a specification, and three of the four
       described a plan the code did not produce. Measured over a 20-week
       block before the fix:

         build   "one tempo AND one interval session"  -> no intervals at all
         build   "on top of it, not instead of it"     -> a base run REPLACED
         sharpen "volume holds"                        -> 30.4 -> 36.8 -> 40.4
         taper   "the intensity stays"                 -> intervals dropped

       The sharpen one is the safety-relevant one: two hard sessions out of
       three, at the HIGHEST volume of the block, with the easy base run gone.
       Peak distance and peak intensity in the same three weeks. */
    const pn = await page.evaluate(() => {
      const o = {};
      const keep = JSON.parse(JSON.stringify(STATE.prep || {}));
      const iso = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
      /* A top-level `const` is NOT a window property — only function
         declarations are — so `window.PREP_PHASE_SESSIONS` reads undefined
         however healthy the app is. Reference the bare identifier. */
      o.namesExist = ['enduranceWeek', 'prepPhase', 'prepClimbWeeks'].every(n => typeof window[n] === 'function')
        && typeof PREP_PHASE_SESSIONS === 'object' && typeof PREP_PHASE_NOTE === 'object'
        && Array.isArray(RUN_SESSIONS);
      if (!o.namesExist) return o;

      /* Walk a real 20-week block by moving planFrom back a week at a time,
         so every reading comes from the app's own phase arithmetic rather
         than from a phase name assigned by the check. */
      o.weeks = [];
      for (let w = 1; w <= 20; w++) {
        STATE.prep = { planFrom: iso(-(w - 1) * 7), date: iso((21 - w) * 7) };
        const e = enduranceWeek();
        o.weeks.push({ wk: e.wk, left: e.left, phase: e.phase, km: e.km,
                       curve: e.curve, down: !!e.down, sess: e.sessions.slice() });
      }
      o.phasesSeen = Array.from(new Set(o.weeks.map(w => w.phase)));
      o.notes = JSON.parse(JSON.stringify(PREP_PHASE_NOTE));
      o.table = JSON.parse(JSON.stringify(PREP_PHASE_SESSIONS));
      /* The easy-run id, read off the app rather than restated. */
      o.easyIds = RUN_SESSIONS.filter(s => s.pace === 'easy').map(s => s.id);
      o.hardIds = RUN_SESSIONS.filter(s => s.pace === 'tempo' || s.pace === 'intervals').map(s => s.id);
      /* Minutes, so the balance can be stated in the currency that matters
         rather than in session counts. */
      o.mins = {}; RUN_SESSIONS.forEach(x => o.mins[x.id] = x.mins);
      STATE.prep = keep;
      return o;
    });

    t.ok('guard: every name this block calls exists', pn.namesExist, pn);
    /* Guard immediately, before the first line that assumes the payload
       exists. Without this the block THREW rather than naming a failed
       check, which hides which property broke. */
    if (!pn.namesExist || !Array.isArray(pn.weeks)) {
      t.ok('guard: the block collected a 20-week plan to assert on', false, pn);
    } else {
    t.ok('guard: all four phases really occur in a 20-week block',
      ['base', 'build', 'sharpen', 'taper'].every(p => pn.phasesSeen.indexOf(p) >= 0), pn.phasesSeen);
    t.ok('guard: the app declares easy and hard sessions to compare',
      pn.easyIds.length >= 1 && pn.hardIds.length >= 2, { easy: pn.easyIds, hard: pn.hardIds });

    const byPhase = p => pn.weeks.filter(w => w.phase === p);

    /* EVERY phase keeps its easy running. Roughly four fifths of endurance
       running should be easy at every level, and sharpen used to be
       two-thirds hard.

       "Has at least one easy session" is NOT the assertion — the LONG RUN is
       also pace:'easy', so deleting the short base run leaves it true. Two
       mutants escaped on exactly that. The requirement is a BALANCE: never
       more hard sessions than easy ones, and more easy minutes than hard. */
    ['base', 'build', 'sharpen', 'taper'].forEach(p => {
      const wk = byPhase(p)[0];
      const easy = wk.sess.filter(id => pn.easyIds.indexOf(id) >= 0);
      const hard = wk.sess.filter(id => pn.hardIds.indexOf(id) >= 0);
      const sum = ids => ids.reduce((a, id) => a + (pn.mins[id] || 0), 0);
      t.ok('the ' + p + ' phase never runs more hard sessions than easy ones',
        easy.length >= hard.length, { phase: p, sess: wk.sess, easy, hard });
      t.ok('and spends more minutes easy than hard in ' + p,
        sum(easy) > sum(hard), { phase: p, easyMin: sum(easy), hardMin: sum(hard) });
    });

    /* build's note names a tempo AND an interval session, and says they go on
       top rather than instead. Both halves are assertions about the plan. */
    {
      const b = byPhase('build')[0], base = byPhase('base')[0];
      t.ok('build runs the tempo session its note promises', b.sess.indexOf('tempo') >= 0, b);
      t.ok('and the interval session its note promises', b.sess.indexOf('intervals') >= 0, b);
      t.ok('and they go ON TOP — build has more sessions than base, not the same count',
        b.sess.length > base.sess.length, { base: base.sess, build: b.sess });
      /* FLOOR: the easy running the note says "stays" really is still there. */
      t.ok('and the easy running stays',
        b.sess.filter(id => pn.easyIds.indexOf(id) >= 0).length >= 1, b);
    }

    /* sharpen's note says volume HOLDS. Read the payload — the distance the
       athlete runs — across every sharpen week that is not a planned cut. */
    {
      const sh = byPhase('sharpen').filter(w => !w.down);
      t.ok('guard: there are at least two full sharpen weeks to compare', sh.length >= 2, sh);
      const first = sh[0].km;
      t.ok('volume holds across sharpen, as its note says',
        sh.every(w => Math.abs(w.km - first) <= 0.2), sh.map(w => w.wk + ':' + w.km).join(' '));
      /* …and the underlying CURVE stops climbing too, not just the shown
         number — a taper-style multiplier on a still-climbing curve would
         satisfy the line above while the plan underneath kept growing. */
      const curves = byPhase('sharpen').map(w => w.curve);
      t.ok('and the curve underneath it stops climbing as well',
        curves.every(c => Math.abs(c - curves[0]) <= 0.2), curves);
    }

    /* FLOOR: it must still CLIMB where it is supposed to. A plan that never
       climbed at all would satisfy "volume holds" perfectly. */
    {
      const early = pn.weeks.filter(w => (w.phase === 'base' || w.phase === 'build') && !w.down);
      t.ok('guard: there are early weeks to check', early.length >= 4, early.length);
      t.ok('but the volume genuinely climbs through base and build',
        early[early.length - 1].curve > early[0].curve * 1.5,
        { from: early[0].curve, to: early[early.length - 1].curve });
      /* and the plateau is a number the athlete EARNED, not a constant: it is
         where the climb reached, so a bigger starting week gives a bigger
         plateau. A hardcoded ceiling would fail this. */
      t.ok('and the plateau is where the climb reached, not a fixed ceiling',
        byPhase('sharpen')[0].curve > early[0].curve * 1.5,
        { start: early[0].curve, plateau: byPhase('sharpen')[0].curve });
    }

    /* taper: volume down from the plateau, intensity kept. */
    {
      const tp = byPhase('taper'), sh = byPhase('sharpen').filter(w => !w.down);
      t.ok('guard: there is a taper and a sharpen plateau to compare',
        tp.length >= 1 && sh.length >= 1, { tp: tp.length, sh: sh.length });
      t.ok('the taper cuts volume against the plateau it came off',
        tp.every(w => w.km < sh[0].km * 0.8), { taper: tp.map(w => w.km), plateau: sh[0].km });
      t.ok('and the intensity stays, as its note says',
        tp.every(w => w.sess.some(id => pn.hardIds.indexOf(id) >= 0)), tp.map(w => w.sess));
      /* FLOOR: "intensity stays" must not mean "nothing changed" — the taper
         is a smaller week, not the sharpen week with a different label. */
      t.ok('but the taper really is a lighter week than sharpen',
        tp[0].sess.length < sh[0].sess.length, { taper: tp[0].sess, sharpen: sh[0].sess });
    }

    /* And the notes still SAY these things. Change one and change the plan
       with it — that is the whole defect this block exists for. */
    t.ok('build’s note still promises a tempo and an interval session',
      /tempo/i.test(pn.notes.build) && /interval/i.test(pn.notes.build), pn.notes.build);
    t.ok('sharpen’s note still says volume holds', /volume holds/i.test(pn.notes.sharpen), pn.notes.sharpen);
    t.ok('taper’s note still says the intensity stays',
      /intensity stays/i.test(pn.notes.taper), pn.notes.taper);
    t.ok('and base’s note still says almost all of it is easy',
      /easy/i.test(pn.notes.base), pn.notes.base);
    }
    /* ---- constants that were declared and never read (v331) --------------

       A sweep for every ALLCAPS top-level const and how often it is READ found
       three that were never read once:

         RUN_TT_M        "the distance the time trial is run over" — while
                         "2.4 km time trial" was written out by hand in THREE
                         places. Editing the constant moved nothing; editing
                         one string left the other two disagreeing with it.
                         The five-diets shape, again.
         PREP_TAPER_DAYS "freshness in, volume out" — and WRONG: prepPhase()
                         tapers at two WEEKS, so it claimed 10 days while the
                         code did 14. A number that looks like a setting and
                         is not is the voicePitch trap.
         RUN_SESSION_IDS dead outright — runSession() already membership-tests.

       And v330's own prepClimbWeeks() had introduced a SECOND copy of the
       sharpen boundary beside prepPhase()'s. Fixing one instance is not
       fixing the class, including when the instance is your own. */
    const dc = await page.evaluate(() => {
      const o = {};
      o.namesExist = typeof runTTLabel === 'function'
        && typeof RUN_TT_M === 'number'
        && typeof PREP_TAPER_WEEKS === 'number' && typeof PREP_SHARPEN_WEEKS === 'number';
      if (!o.namesExist) return o;
      const iso = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
      const keep = JSON.parse(JSON.stringify(STATE.prep || {}));

      /* The label is DERIVED, and the check reads the constant rather than
         restating "2.4 km" — asserting the literal would pass on a hardcoded
         string, which is the defect. */
      o.label = runTTLabel();
      o.wantsKm = String(RUN_TT_M / 1000);
      o.labelFromConstant = o.label.indexOf(o.wantsKm) === 0;
      /* Every surface must move with it. Rendered text, not the source. */
      o.ttSessionName = (RUN_SESSIONS.find(x => x.id === 'tt') || {}).name;
      STATE.prep = { date: iso(60), planFrom: iso(0) };
      const seen = () => document.body.innerText.replace(/\s+/g, ' ');
      try { openArmyRun(); o.onArmyCard = seen().indexOf(o.label) >= 0; } catch (e) { o.onArmyCard = 'threw'; }
      try { closeSheet(); } catch (e) {}
      try { openRunTT(); o.onEntrySheet = seen().indexOf(o.label) >= 0; } catch (e) { o.onEntrySheet = 'threw'; }
      try { closeSheet(); } catch (e) {}
      /* FLOOR: no surface still carries a hand-written distance, and each of
         the three really CALLS the derivation.

         Scan the SOURCE, because a hardcoded string that happens to match
         today's constant is indistinguishable on screen — four mutants that
         reverted the label escaped a rendered-text check. And take the
         BIGGEST inline script: the first one on this page is two characters
         long, which is the wrong-script-element trap already recorded here. */
      const src = [...document.querySelectorAll('script:not([src])')]
        .map(e => e.textContent).sort((a, b) => b.length - a.length)[0];
      o.srcIsApp = src.indexOf('function runTTLabel') >= 0;
      o.handWritten = (src.match(/2\.4 km time trial/g) || []).length;
      /* Three sites must each call it: the session row, the army card, the
         entry sheet. Counting the calls is what makes reverting ONE of them
         fail rather than only reverting all three. */
      /* Call sites only — `function runTTLabel()` matches the same pattern,
         so counting raw occurrences reads one too many. */
      o.labelCalls = (src.match(/runTTLabel\(\)/g) || []).length
        - (src.match(/function\s+runTTLabel\(\)/g) || []).length;
      /* And the derivation reads the constant rather than restating it. */
      o.labelSrc = runTTLabel.toString();
      o.labelReadsConstant = /RUN_TT_M/.test(o.labelSrc);

      /* The taper and sharpen boundaries live in exactly one place each. */
      STATE.prep = { planFrom: iso(0) };
      o.phaseAt = {};
      [200, 80, 45, 20, 15, 8].forEach(d => { STATE.prep.date = iso(d); o.phaseAt[d] = prepPhase(); });
      /* Read the boundary out of the app, then prove the phase really turns
         there — a check that restated 2 and 6 would pass on any constant. */
      const atWeeks = w => { STATE.prep.date = iso(w * 7 + 1); return prepPhase(); };
      o.taperInside = atWeeks(PREP_TAPER_WEEKS - 1);
      o.taperOutside = atWeeks(PREP_TAPER_WEEKS + 1);
      o.sharpenInside = atWeeks(PREP_SHARPEN_WEEKS - 1);
      o.sharpenOutside = atWeeks(PREP_SHARPEN_WEEKS + 1);
      /* prepClimbWeeks() must read the SAME boundary, not a second copy —
         v330 shipped one. Move the plateau and the climb must move with it. */
      o.climbSrc = prepClimbWeeks.toString();
      o.climbUsesConstant = /PREP_SHARPEN_WEEKS/.test(o.climbSrc);
      o.climbHasLiteral = /\bleft\s*-\s*6\b/.test(o.climbSrc);

      /* A top-level `const` is NOT a window property, so `typeof
         window.PREP_TAPER_DAYS === 'undefined'` is true whether or not the
         constant exists — the check passed on nothing and a mutant restoring
         it walked straight through. Scan the source for the DECLARATION. */
      o.deadGone = !/\bconst\s+RUN_SESSION_IDS\s*=/.test(src)
        && !/\bconst\s+PREP_TAPER_DAYS\s*=/.test(src);
      STATE.prep = keep;
      return o;
    });

    t.ok('guard: every name this block calls exists', dc.namesExist, dc);
    if (!dc.namesExist) {
      t.ok('guard: the block collected something to assert on', false, dc);
    } else {
      /* The label is built from the constant, on every surface. */
      t.ok('the time-trial label is derived from RUN_TT_M', dc.labelFromConstant,
        { label: dc.label, wants: dc.wantsKm });
      t.eq('and the session row uses it', dc.ttSessionName, dc.label);
      t.ok('and the army-running card shows it', dc.onArmyCard === true, dc);
      t.ok('and the entry sheet shows it', dc.onEntrySheet === true, dc);
      /* FLOOR: and nothing writes the distance out by hand any more. Three
         copies is how the five diets drifted. */
      t.ok('guard: the source scanned really is the app', dc.srcIsApp, dc);
      t.eq('no surface hardcodes the distance any more', dc.handWritten, 0);
      t.eq('and all three sites call the derivation', dc.labelCalls, 3);
      t.ok('which itself reads the constant', dc.labelReadsConstant, dc.labelSrc);

      /* The phase boundaries are single-sourced, and really bite where the
         constants say. Restating 2 and 6 here would pass on any value. */
      t.ok('the taper starts inside PREP_TAPER_WEEKS', dc.taperInside === 'taper',
        { weeks: dc.taperInside });
      t.ok('and has not started outside it', dc.taperOutside !== 'taper',
        { weeks: dc.taperOutside });
      t.ok('sharpening starts inside PREP_SHARPEN_WEEKS', dc.sharpenInside === 'sharpen',
        { weeks: dc.sharpenInside });
      t.ok('and has not started outside it', dc.sharpenOutside !== 'sharpen',
        { weeks: dc.sharpenOutside });
      /* v330 introduced a second copy of the sharpen boundary in its own new
         function. Assert on the SOURCE, because a literal 6 and the constant
         are indistinguishable from the output while both are 6. */
      t.ok('the volume plateau reads the same boundary constant', dc.climbUsesConstant, dc.climbSrc);
      t.ok('and does not carry a second copy of the number', !dc.climbHasLiteral, dc.climbSrc);

      t.ok('and the constants that were never read are gone', dc.deadGone, dc);
    }
    /* ---- the two plans, added together (v332) ---------------------------

       Found by driving the army-prep athlete across subsystems rather than by
       reading code. The endurance plan ramps from what was logged RUNNING and
       the ruck ladder from what was logged RUCKING; each caps its own curve at
       10% a week, and each has a floor for an athlete with nothing logged IN
       THAT MODE. Neither read the other — and a rucked kilometre and a run
       kilometre are absorbed by the same tissue. Measured before the fix:

         rucks 25 km/wk, never runs -> 27.5 ruck + 8.8 run = 36.3, +45% in ONE WEEK
         runs  25 km/wk, never rucks -> 27.5 run + 5.5 ruck = 33.0, +32% in one week

       and no surface showed the combined figure at all.

       THE FIX WARNS, IT DOES NOT RESIZE, and three measured wrong turns are
       why. A flat cap cut a legal 6.7%/wk plan; a compounding one constrained
       nothing; and proportional scaling under a one-week cap suppressed the
       plan being FOLLOWED because of a plan being ignored — "is the other mode
       on its floor?" stays true forever for an athlete who never takes it up. */
    const fl = await page.evaluate(() => {
      const o = {};
      o.namesExist = ['trailingFootKm', 'footNewMode', 'fitFootKm', 'footLoadHTML',
                      'enduranceWeek', 'ruckLadderWeek'].every(n => typeof window[n] === 'function');
      if (!o.namesExist) return o;
      const keepPrep = JSON.parse(JSON.stringify(STATE.prep || {}));
      const keepDays = JSON.parse(JSON.stringify(nut().days || {}));
      const keepKg = STATE.nutrition.weightKg, keepLb = STATE.profile.ruckLb;
      const iso = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
      const strip = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      STATE.nutrition.weightKg = 86; STATE.profile.ruckLb = 30;
      const n = nut();
      /* `climb` makes the logged weeks RISE, which is what an athlete
         following the plan actually does. A flat six weeks of logs while the
         plan climbs is not a legal athlete, it is one who has fallen behind —
         and the warning correctly fires on them, which is how the first
         version of this block failed on correct code. */
      const shot = (rk, rn, w, climb) => { n.days = {};
        for (let x = 0; x < 6; x++) {
          const f = climb ? Math.pow(1 / 1.10, x) : 1;   // x=0 is the most recent week
          if (rk) n.days[iso(-(x * 7 + 1))] = { water: 0, habits: {}, ruckUnit: 'dist', ruckVal: rk / f };
          if (rn) n.days[iso(-(x * 7 + 3))] = { water: 0, habits: {}, runUnit: 'dist', runVal: rn / f };
        }
        STATE.prep = { date: iso((16 - w) * 7), planFrom: iso(-w * 7) };
        const E = enduranceWeek(), L = ruckLadderWeek();
        return { logged: Math.round(((trailingRuckKm() || 0) + (trailingRunKm() || 0)) * 10) / 10,
                 ruck: L.km, run: E.km, sum: Math.round((L.km + E.km) * 10) / 10,
                 reported: E.footTotal, ruckReported: L.footTotal,
                 step: E.footStep, from: E.footFrom, big: !!E.footBig, ruckBig: !!L.footBig,
                 newMode: E.footNew, added: E.footAdded,
                 card: strip(enduranceHTML()), ruckCard: strip(ruckLadderHTML()),
                 /* …and it must be VISIBLE. strip() keeps the text of a
                    `hidden` element, so a mutant that hid the note rather
                    than deleting it walked through a text-only assertion. */
                 hiddenNote: /<[^>]*\bhidden\b[^>]*>[^<]*(together|on your feet)/.test(enduranceHTML())
                   || /<[^>]*\bhidden\b[^>]*>[^<]*(together|on your feet)/.test(ruckLadderHTML()) }; };

      /* An athlete who has actually been following the plan: both modes
         logged, and the logs RISING at the same 10% the plan uses. */
      o.balanced = shot(18.6, 12.4, 6, true);
      o.rucker   = shot(25, 0, 1);          // takes up running
      o.runner   = shot(0, 25, 1);          // takes up rucking
      o.nothing  = shot(0, 0, 1);           // a genuine beginner
      o.late     = shot(24.8, 18.2, 12, true);   // deep into a block, kept up
      /* …and the athlete who has NOT kept up is warned, which is correct:
         their legs only know what they have actually done. */
      o.behind   = shot(14, 7, 12);

      /* GUARD: the two functions read each other one level deep. A raw read
         must terminate and carry no combined figure of its own. */
      shot(25, 0, 1);
      o.rawTerminates = (() => { try { const a = enduranceWeek(true), b = ruckLadderWeek(true);
        return !!a && !!b && a.footTotal === null && b.footTotal === null; } catch (e) { return 'threw: ' + e.message; } })();
      o.warnPct = 0;

      STATE.prep = keepPrep; nut().days = keepDays;
      STATE.nutrition.weightKg = keepKg; STATE.profile.ruckLb = keepLb;
      return o;
    });

    t.ok('guard: every name this block calls exists', fl.namesExist, fl);
    if (!fl.namesExist) {
      t.ok('guard: the block collected something to assert on', false, fl);
    } else {
      t.ok('guard: reading a plan raw terminates and carries no combined figure',
        fl.rawTerminates === true, fl);

      /* NEITHER PLAN IS RESIZED. This is the whole design decision, and the
         floor that catches every version of the fix that got it wrong: the
         numbers each plan reports are its own. */
      [['balanced', 'a legal plan'], ['rucker', 'a rucker taking up running'],
       ['runner', 'a runner taking up rucking'], ['late', 'a plan deep into a block'],
       ['behind', 'an athlete behind their plan']].forEach(([k, label]) => {
        const c = fl[k];
        t.eq('the combined figure for ' + label + ' is the plain sum', c.reported, c.sum);
        t.ok('and ' + label + ' still gets real work in both modes',
          c.ruck > 0 && c.run > 0, { ruck: c.ruck, run: c.run });
      });
      /* FLOOR: a plan already inside its own rule keeps every kilometre, and
         the total is free to grow across a block. A cap held the total at
         +10% forever, which is a plateau, not a plan. */
      t.ok('a legal plan is left entirely alone', !fl.balanced.big, fl.balanced);
      t.ok('and the total grows across the block',
        fl.late.sum > fl.balanced.sum, { wk6: fl.balanced.sum, wk12: fl.late.sum });

      /* THE WARNING fires on the two introduction cases and names the step. */
      [['rucker', 'a rucker taking up running'], ['runner', 'a runner taking up rucking']].forEach(([k, label]) => {
        const c = fl[k];
        t.ok('guard: ' + label + ' really has history in one mode only', c.logged > 0, c);
        /* The precise condition: this athlete has NO history in one mode and
           real history in the other, so that mode opens at its floor. */
        t.ok('guard: ' + label + ' really has one brand-new mode',
          c.newMode === (k === 'rucker' ? 'run' : 'ruck'), c);
        t.ok(label + ' is warned that the new mode lands on top', c.big, c);
        t.ok('and the warning names how much is new', c.added > 0, c);
        t.ok('and what it is on top of', c.step !== null && c.step > 0,
          { step: c.step, from: c.from });
        t.ok('and names what it is a step up FROM', c.from !== null && c.from > 0, c);
        t.ok('and the warning is on the running card',
          c.card.indexOf('on your feet this week') >= 0, c.card.slice(0, 200));
        t.ok('and on the rucking card too', c.ruckBig && c.ruckCard.indexOf('on your feet this week') >= 0,
          c.ruckCard.slice(0, 200));
      });

      /* FLOOR: a note that always fires is a note nobody reads. A legal plan
         still SHOWS the total — that is the second half of the fix — but does
         not claim anything is wrong with it. */
      t.ok('a legal plan still shows the combined distance',
        fl.balanced.card.indexOf(String(fl.balanced.sum)) >= 0, fl.balanced.card.slice(0, 200));
      t.ok('and shows it — not merely renders it hidden', !fl.balanced.hiddenNote, fl.balanced);
      t.ok('and on the rucking card',
        fl.balanced.ruckCard.indexOf(String(fl.balanced.sum)) >= 0, fl.balanced.ruckCard.slice(0, 200));
      t.ok('but is not warned', !fl.balanced.big && fl.balanced.card.indexOf('% up on the') < 0,
        fl.balanced.card.slice(0, 200));
      t.ok('and neither is a plan deep into a block', !fl.late.big, fl.late);
      /* FLOOR: but an athlete who has NOT kept up IS warned. Their legs know
         only what they have done — the step is real for them even though the
         plan itself is legal. A warning that only ever read the plan would
         miss the one athlete it matters to. */
      t.ok('guard: the athlete behind their plan really is behind',
        fl.behind.logged < fl.behind.sum * 0.8, fl.behind);
      /* …and is NOT warned, because nothing is landing on top: both modes are
         already being done. Comparing the plan against the trailing average
         instead warned EVERY athlete from about week three, because each
         plan's curve compounds FROM that average — measured at +77% for a
         model athlete who had kept up perfectly. */
      t.ok('but is not told a mode is brand new', !fl.behind.big, fl.behind);
      /* FLOOR: a beginner has no history to step up FROM, so no warning is
         possible — and the floors stand untouched. */
      t.ok('a beginner with nothing logged keeps both floors and is not warned',
        !fl.nothing.big && fl.nothing.ruck > 0 && fl.nothing.run > 0, fl.nothing);
      /* A beginner has nothing in EITHER mode, so neither is "new on top of"
         the other — there is nothing to land on. */
      t.ok('and no mode is called brand new', fl.nothing.newMode === null, fl.nothing);

      /* Both cards report the SAME figure — one renderer, read twice. */
      t.eq('the two cards agree on the combined figure',
        fl.rucker.reported, fl.rucker.ruckReported);
    }
    /* ---- FORCE Combat, the Army standard (v333) --------------------------

       Researched at the athlete's request. The Canadian Army's soldier-first
       standard used to be the Battle Fitness Test — 13 km carrying 24.5 kg in
       2:26:20 — and FORCE COMBAT HAS REPLACED IT. That is why COMBAT_ASOF
       exists beside FORCE_ASOF: a retired standard is the most dangerous kind
       of number in a training app, because an athlete trains to it and nothing
       on screen says it stopped being the requirement.

       FORCE Combat is the SAME four events as the annual evaluation, run as
       one continuous circuit in a fixed order, in full fighting order, against
       a single clock — plus a 5 km march under 35 kg. The events are read from
       FORCE_EVENTS rather than restated, because a second copy of four times
       is a second place for them to drift.

       Cross-checked against the official manual: the app's existing 210 s,
       321 s, 51 s and pass/fail figures match it exactly. */
    const cb = await page.evaluate(() => {
      const o = {};
      o.namesExist = ['openCombat', 'openCombatLog', 'saveCombat', 'startCombatCircuit',
                      'combatVerdict', 'combatResult', 'combatOrder', 'combatMarchLb',
                      'combatMarchGap'].every(n => typeof window[n] === 'function')
        && typeof COMBAT_CIRCUIT_MAX === 'number' && Array.isArray(COMBAT_ORDER);
      if (!o.namesExist) return o;
      const keep = JSON.parse(JSON.stringify(STATE.prep || {}));
      const keepKg = STATE.nutrition.weightKg;
      const seen = () => document.body.innerText.replace(/\s+/g, ' ');

      /* The order IS the test, not a presentation choice. */
      o.order = combatOrder().map(e => e.id);
      o.orderCoversAll = o.order.length === FORCE_IDS.length
        && o.order.every(id => FORCE_IDS.indexOf(id) >= 0);
      /* …and it reads the SAME events, so the times cannot drift apart. */
      o.sameTimes = combatOrder().every(e => forceEvent(e.id) === e);

      /* Verdicts. Absent is "not measured", which is not "failed". */
      STATE.prep = {};
      o.unmeasured = { c: combatVerdict('circuit'), m: combatVerdict('march') };
      STATE.prep = { combatCircuit: COMBAT_CIRCUIT_MAX - 100, combatMarch: (COMBAT_MARCH_MIN[1] - 5) * 60 };
      o.pass = { c: combatVerdict('circuit'), m: combatVerdict('march') };
      STATE.prep = { combatCircuit: COMBAT_CIRCUIT_MAX + 100, combatMarch: (COMBAT_MARCH_MIN[1] + 10) * 60 };
      o.fail = { c: combatVerdict('circuit'), m: combatVerdict('march') };
      /* The boundary: exactly on the standard is a pass. */
      STATE.prep = { combatCircuit: COMBAT_CIRCUIT_MAX, combatMarch: COMBAT_MARCH_MIN[1] * 60 };
      o.onTheLine = { c: combatVerdict('circuit'), m: combatVerdict('march') };

      /* A backup can carry anything. */
      STATE.prep = { combatCircuit: 'fast', combatMarch: -5 };
      normalizeState();
      o.junkGone = STATE.prep.combatCircuit === undefined && STATE.prep.combatMarch === undefined;
      /* FLOOR: and a real result SURVIVES the repair. A repair that always
         wiped would satisfy the line above and destroy the measurement. */
      STATE.prep = { combatCircuit: 800, combatMarch: 3300 };
      normalizeState();
      o.realSurvives = STATE.prep.combatCircuit === 800 && STATE.prep.combatMarch === 3300;

      /* The load the app will not train anyone to, said out loud. */
      STATE.nutrition.weightKg = 86;
      o.marchLb = combatMarchLb();
      o.gap = combatMarchGap();
      STATE.prep = { date: '2026-12-01' };
      try { openCombat(); o.card = seen(); } catch (e) { o.card = 'THREW ' + e.message; }
      try { closeSheet(); } catch (e) {}
      /* FLOOR: a very heavy athlete whose own ceiling clears the standard is
         NOT warned. A note that always fires is a note nobody reads — and
         RUCK_LB_MAX would have to move for this, so it is exercised directly. */
      o.noGapWhenCeilingClears = (() => {
        const need = combatMarchLb();
        return need <= RUCK_LB_MAX ? 'unreachable' : (combatMarchGap() !== null);
      })();

      /* Carried out of the page. A top-level const is not on `window` and is
         not visible in Node either — referencing one from an assertion threw
         and the block reported "the test file itself threw" instead of naming
         a check. Same trap as PREP_PHASE_SESSIONS two blocks up. */
      o.ffoKg = COMBAT_FFO_KG;
      o.circuitMax = COMBAT_CIRCUIT_MAX;
      o.marchWindow = COMBAT_MARCH_MIN.slice();

      STATE.prep = keep; STATE.nutrition.weightKg = keepKg;
      return o;
    });

    t.ok('guard: every name this block calls exists', cb.namesExist, cb);
    if (!cb.namesExist) {
      t.ok('guard: the block collected something to assert on', false, cb);
    } else {
      /* The order is the test. */
      t.eq('the circuit runs rushes, lift, shuttles, drag in that order',
        cb.order, ['rush', 'lift', 'shuttle', 'drag'], cb.order);
      t.ok('and covers every FORCE event, with no strays', cb.orderCoversAll, cb.order);
      /* The times are not restated — the circuit reads the same event objects
         the annual evaluation does, so they cannot drift apart. */
      t.ok('and reads the same events the annual evaluation does', cb.sameTimes, cb);

      /* Verdicts, including the boundary and the not-measured case. */
      t.ok('a result never entered is NOT a fail',
        cb.unmeasured.c === null && cb.unmeasured.m === null, cb.unmeasured);
      t.ok('inside the standard is a pass', cb.pass.c === 'pass' && cb.pass.m === 'pass', cb.pass);
      t.ok('outside it is not', cb.fail.c === 'fail' && cb.fail.m === 'fail', cb.fail);
      t.ok('and exactly on the standard is a pass',
        cb.onTheLine.c === 'pass' && cb.onTheLine.m === 'pass', cb.onTheLine);

      /* A backup can carry anything, and a real result must survive the repair. */
      t.ok('junk from an import is dropped, not read as a result', cb.junkGone, cb);
      t.ok('and a real result survives the repair', cb.realSurvives, cb);

      /* THE HONEST CONSTRAINT. 35 kg is 77 lb; the ladder stops at 60. The app
         says so rather than quietly clamping the standard, because an athlete
         training to a clamped number would not know it was not the standard. */
      t.eq('the march load is stated in pounds as well', cb.marchLb, 77);
      /* Guard IMMEDIATELY, before the first line that dereferences cb.gap.
         Two mutants — clamping the load, and never returning a gap — were
         caught by a TypeError rather than by a named check, which is still
         red but hides which property broke. */
      const gapOK = cb.gap !== null && typeof cb.gap === 'object'
        && cb.gap.need > cb.gap.ceil;
      t.ok('guard: it really is heavier than the ladder will go', gapOK, cb.gap);
      if (gapOK) {
        t.ok('and the card says the load is beyond what it will train you to',
          cb.card.indexOf('heavier than this app will train you to') >= 0, cb.card.slice(0, 200));
        t.ok('and names both numbers, not just the shortfall',
          cb.card.indexOf(String(cb.gap.need)) >= 0 && cb.card.indexOf(String(cb.gap.ceil)) >= 0, cb.gap);
      }

      /* The date stamp, for the same reason FORCE_ASOF has one — and this one
         matters more, because it replaced a standard people still train to. */
      t.ok('the figures are stamped with a date', cb.card.indexOf('as of') >= 0, cb.card.slice(0, 300));
      t.ok('and say the app cannot check them',
        cb.card.indexOf('cannot check them for you') >= 0, cb.card.slice(0, 400));
      t.ok('and name the standard it replaced',
        /Battle Fitness Test/.test(cb.card), cb.card.slice(0, 400));

      /* The circuit's whole difference from the annual evaluation is that the
         rest is gone. If the card does not say that, it is just a second copy
         of a screen the athlete already has. */
      t.ok('the card says the rest between events is what is taken away',
        /rest between events is what is taken away/.test(cb.card), cb.card.slice(0, 300));
      t.ok('and names the kit load worn for it',
        cb.card.indexOf(String(cb.ffoKg) + ' kg') >= 0, { want: cb.ffoKg, card: cb.card.slice(0, 300) });
    }




    /* ---- the ruck ladder (v326) --------------------------------------------
       v325 scheduled the running and left the rucking as a SENTENCE — "build
       the distance or the load, never both" — with nothing scheduling it. Same
       countdown-not-a-plan gap prep.date had, one variable over.

       THE RULE IS DISTANCE OR LOAD, NEVER BOTH IN THE SAME WEEK. A ruck is
       carried by the same tissue that absorbs every step, so raising two
       things at once is how a back goes. */
    const rk = await page.evaluate(() => {
      const keep = { prep: JSON.parse(JSON.stringify(STATE.prep || {})),
                     days: JSON.parse(JSON.stringify(nut().days || {})),
                     kg: STATE.nutrition.weightKg, lb: STATE.profile.ruckLb };
      const iso = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
      const o = {};
      STATE.nutrition.weightKg = 86;

      STATE.prep = {};
      o.noDate = !!ruckLadderWeek().noDate;
      o.noDateRendersNothing = ruckLadderHTML() === '';

      STATE.prep = { date: iso(180), planFrom: iso(0) };
      const w1 = ruckLadderWeek();
      o.floor = { km: w1.km, lb: w1.lb, estimated: w1.estimated,
                  floorKm: PREP_RUCK_FLOOR_KM, lightestPlate: RUCK_PLATES[0] };
      o.floorSaysSo = /Starting light, because nothing is logged yet/.test(ruckLadderHTML());

      // walk sixteen weeks
      const weeks = [];
      for (let w = 0; w < 16; w++) { STATE.prep.planFrom = iso(-7 * w);
        const x = ruckLadderWeek();
        weeks.push({ wk: x.wk, km: x.curve, lb: x.lb, down: x.down, climbing: x.climbing }); }
      o.weeks = weeks;
      const both = [];
      for (let i = 1; i < weeks.length; i++) {
        if (weeks[i].km > weeks[i - 1].km + 0.05 && weeks[i].lb > weeks[i - 1].lb) both.push(weeks[i].wk); }
      o.bothClimbed = both;
      o.kmClimbed = weeks[weeks.length - 1].km > weeks[0].km;
      o.lbClimbed = weeks[weeks.length - 1].lb > weeks[0].lb;
      o.downWeeks = weeks.filter(w => w.down).length;
      /* MEASURE THE CUT, not the flag. A mutant that removed the loop's down
         branch left the flag set by a second writer and walked through a check
         that counted flags — week 4 climbed and still rendered as a rest. */
      o.downWeeksReallyCut = weeks.every((w, i) => i === 0 || !w.down || w.km <= weeks[i - 1].km + 0.05);
      o.downShown = weeks.filter(w => w.down).map(w => ({ wk: w.wk, km: w.km, prev: (weeks[w.wk - 2] || {}).km }));
      o.loadWeeks = weeks.filter(w => w.climbing === 'load').length;
      // and the distance HOLDS on a load week
      o.heldOnLoadWeek = weeks.every((w, i) => i === 0 || w.climbing !== 'load' || Math.abs(w.km - weeks[i - 1].km) < 0.06);

      /* Both ceilings are live. The bodyweight one binds for a lighter athlete
         and the plate maximum binds for a heavier one — a check at only one of
         them passes on half the code. */
      o.ceilings = [55, 70, 110].map(kg => { STATE.nutrition.weightKg = kg; return ruckLoadCeilLb(); });
      STATE.nutrition.weightKg = null;
      o.ceilNoWeight = ruckLoadCeilLb();
      STATE.nutrition.weightKg = 86;

      // with rucks logged it builds from what the athlete actually carries
      const days = nut().days;
      for (let i = 1; i <= 21; i++) { const d = iso(-i);
        days[d] = days[d] || { water: 0, habits: {} };
        if (i % 3 === 0) { days[d].ruckVal = 6; days[d].ruckUnit = 'dist'; days[d].ruckLvl = 'brisk'; } }
      STATE.profile.ruckLb = 30;
      STATE.prep.planFrom = iso(0);
      const fromLogs = ruckLadderWeek();
      o.fromLogs = { km: fromLogs.km, lb: fromLogs.lb, estimated: fromLogs.estimated };
      o.trailing = Math.round(trailingRuckKm() * 10) / 10;

      STATE.prep = keep.prep; nut().days = keep.days;
      STATE.nutrition.weightKg = keep.kg; STATE.profile.ruckLb = keep.lb;
      return o;
    });

    t.ok('with no test date there is no ruck plan', rk.noDate, rk);
    t.ok('and nothing is rendered for one', rk.noDateRendersNothing, rk);
    /* THE RULE. */
    t.eq('across sixteen weeks, distance and load never climb together',
      rk.bothClimbed, [], { bothClimbed: rk.bothClimbed, weeks: rk.weeks });
    /* THE FLOORS UNDER IT — "never both" is trivially satisfied by nothing
       ever climbing, which would be a plan that goes nowhere. */
    t.ok('the distance really does climb across the block', rk.kmClimbed, rk.weeks);
    t.ok('and so does the load', rk.lbClimbed, rk.weeks);
    t.ok('guard: there really are load weeks in sixteen', rk.loadWeeks >= 3, rk);
    t.ok('and down weeks', rk.downWeeks >= 3, rk);
    t.ok('a down week does not climb — the flag and the distance agree',
      rk.downWeeksReallyCut, rk.downShown);
    t.ok('the distance HOLDS on a week the load climbs', rk.heldOnLoadWeek, rk.weeks);
    /* Nothing logged opens light and says the number is a floor. */
    t.eq('with nothing logged it opens at the floor distance', rk.floor.km, rk.floor.floorKm, rk);
    t.eq('under the lightest plate', rk.floor.lb, rk.floor.lightestPlate, rk);
    t.eq('and the floor is a genuinely light opening', rk.floor.floorKm, 5, rk);
    t.eq('and the lightest plate really is the lightest', rk.floor.lightestPlate, 10, rk);
    t.ok('and it says the number is a floor, not a measurement', rk.floorSaysSo, rk);
    /* BOTH ceilings, because a check at one passes on half the code. */
    t.ok('a lighter athlete is capped by their bodyweight, not the plate rack',
      rk.ceilings[0] < 60 && rk.ceilings[0] > 20, rk.ceilings);
    t.eq('and a heavier one by the plate maximum', rk.ceilings[2], 60, rk.ceilings);
    t.ok('guard: the two ceilings really are different', rk.ceilings[0] !== rk.ceilings[2], rk.ceilings);
    t.eq('with no bodyweight on file it falls back to the plate maximum', rk.ceilNoWeight, 60, rk);
    /* And it reads what the athlete actually does. */
    t.ok('guard: the seeded rucks really are ~12 km a week',
      rk.trailing > 8 && rk.trailing < 20, rk);
    t.eq('with rucks logged it builds from the real distance', rk.fromLogs.km, rk.trailing, rk);
    t.eq('and from the plate they actually carry', rk.fromLogs.lb, 30, rk);
    t.ok('and stops calling it an estimate', !rk.fromLogs.estimated, rk);
    /* THE FLOOR under the note. */
    t.eq('floor: with the sandbag owned there is nothing to say', r.kitNoteWithBag, '', r);
    t.ok('and the sheet is quiet about kit', r.sheetWithBagQuiet, r);
    t.ok('and the button offers all four', r.buttonSaysFour, r);
    /* And the refusal, exercised directly because it is unreachable today. */
    t.eq('guard: with nothing available at all, nothing is available', r.availWhenNothing, 0, r);
    t.ok('a session with no performable movement is refused, not built empty',
      !r.builtWhenNothing, r);
    t.ok('and says why', /sandbag/i.test(r.refusalToast), r);
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
