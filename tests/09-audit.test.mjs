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
    go('progress');
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
    go('progress');
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

  // ---- the score comparison across the 5->8 test change --------------------
  const score = await page.evaluate(() => {
    const real = JSON.stringify(STATE.scoreHistory);
    STATE.scoreHistory = [{ date: '2026-01-01', score: 62, level: 'Beginner', testCount: 5 },
                          { date: '2026-03-01', score: 55, level: 'Beginner', testCount: 8 }];
    const oldEra = scoreDeltaHTML({ score: 55 });
    STATE.scoreHistory = [{ date: '2026-01-01', score: 50, level: 'Beginner', testCount: 8 },
                          { date: '2026-03-01', score: 60, level: 'Beginner', testCount: 8 }];
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
  await tzb.close();

  srv.close();
  return t.finish(errors);
}
