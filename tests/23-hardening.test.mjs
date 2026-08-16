/* Hardening: the findings from the four-way senior audit that followed seven
   consecutive real-device failures of the screenshot import.

   The complaint that started it was fair — a green suite had been reported as
   "clean and ready" while a headline feature broke on first use. So every check
   in this file is written against the OBSERVABLE effect, not the instruction
   that produces it: an injected element is queried for rather than a substring
   scanned, a habit tick is read back off STATE rather than inferred from the
   function returning, and the calorie button is read for the number it actually
   promises rather than for the fact that a button exists.

   Each block builds the state it asserts on. Nothing here relies on what the
   block above left mounted. */
import { serve, launch, suite, waitForBoot, seedAthlete } from './lib/harness.mjs';

export default async function () {
  const t = suite('hardening — audit fixes');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await waitForBoot(page);
  await seedAthlete(page);

  /* ---------- 1. photos[].id breaks out of its onclick ------------------
     A restored backup carries photos verbatim; normalizeState() only ever
     required `id` to be truthy. `onclick="viewPhoto('${p.id}')"` then let an
     id containing a quote close the string and run whatever followed. This is
     the removeMeasure() defect CLAUDE.md records as fixed in v240, unfixed one
     function away.

     Escaping alone cannot be asserted on: the browser HTML-DECODES an inline
     handler before compiling it as JS, so `&#39;` becomes `'` again right
     before it runs. The only check that proves anything injects the rendered
     markup into a real element and fires a real click. */
  {
    const r = await page.evaluate(() => {
      window.__pwn = 0;
      const keep = JSON.stringify(STATE.photos || []);
      STATE.photos = [{ id: "a'),window.__pwn=1,viewPhoto('b", date: '2026-01-02', pose: 'front' }];
      const host = document.createElement('div');
      host.innerHTML = photosHTML();
      document.body.appendChild(host);
      const img = host.querySelector('img.ph-img[onclick]');
      const attr = img ? img.getAttribute('onclick') : '';
      if (img) img.click();
      const pwned = window.__pwn;
      host.remove();
      STATE.photos = JSON.parse(keep);
      return { attr, pwned, hadImg: !!img };
    });
    t.ok('the gallery still renders a clickable photo', r.hadImg, r);
    t.eq('a quote in a photo id cannot execute code on click', r.pwned, 0, r);
    // Guard: without this the check above could pass on a photo that never rendered.
    t.ok('the handler carries a single JSON-quoted argument', /^viewPhoto\("/.test(r.attr || ''), r);
  }

  /* ---------- 2. profile.unit had no repair and reached innerHTML raw ----
     Six sinks on the Progress render path interpolate it directly. It has
     exactly two legal values, so a MEMBERSHIP test closes all six at once —
     truthiness and typeof both let a payload straight through, which is the
     `diet` bug shape this repo has already paid for once.

     Asserted on STATE, not on what the render produced: reading the rendered
     page alone would pass whether the repair ran or the sink merely escaped. */
  {
    const CASES = [
      ['a script payload', '"><img src=x onerror="window.__u=1">', 'cm'],
      ['an unknown unit', 'stones', 'cm'],
      ['a number', 7, 'cm'],
      ['absent', undefined, 'cm'],
      ['the real imperial value', 'in', 'in'],
      ['the real metric value', 'cm', 'cm'],
    ];
    for (const [label, planted, want] of CASES) {
      const r = await page.evaluate(p => {
        const keep = STATE.profile.unit;
        if (p === undefined) delete STATE.profile.unit; else STATE.profile.unit = p;
        normalizeState();
        const got = STATE.profile.unit;
        window.__u = 0;
        go('progress');
        const injected = document.querySelectorAll('#v-progress img[src="x"]').length;
        STATE.profile.unit = keep;
        return { got, injected };
      }, planted);
      t.eq(`[unit ${label}] is repaired to a legal unit`, r.got, want, r);
      t.eq(`[unit ${label}] injects nothing into Progress`, r.injected, 0, r);
    }
  }

  /* ---------- 3. photos[].pose was any string at all --------------------
     poseOf() returned whatever non-empty string it found, and that value is
     rendered raw at five sites. Three poses are legal. Asserting through
     poseOf() is the point here rather than the trap CLAUDE.md warns about —
     poseOf() IS the repair, not a getter hiding one, and normalizeState()'s
     own photo repair only ever guessed at a MISSING pose, never a hostile one. */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify(STATE.photos || []);
      STATE.photos = [{ id: 'p1', date: '2026-01-02', pose: '<img src=x onerror="window.__p=1">' }];
      normalizeState();
      const resolved = poseOf(STATE.photos[0]);
      window.__p = 0;
      go('progress');
      const injected = document.querySelectorAll('#v-progress img[src="x"]').length;
      const legalSet = POSE_KEYS.slice();
      STATE.photos = JSON.parse(keep);
      return { resolved, injected, legalSet };
    });
    t.ok('a hostile pose resolves to a legal pose', r.legalSet.indexOf(r.resolved) >= 0, r);
    t.eq('a hostile pose injects nothing into Progress', r.injected, 0, r);
  }

  /* ---------- 4. settings.reminderTime was truthiness-repaired ----------
     `if(!x)` catches '', null and undefined and nothing else, and the value
     lands inside value="…" in Settings. Same shape as `diet`, same fix: a
     membership test — here, the shape of a clock time. */
  {
    const CASES = [
      ['a script payload', '"><img src=x onerror="window.__r=1">', '18:00'],
      ['a word', 'evening', '18:00'],
      ['a real time', '07:30', '07:30'],
      ['empty', '', '18:00'],
    ];
    for (const [label, planted, want] of CASES) {
      const r = await page.evaluate(p => {
        const keep = STATE.settings.reminderTime, keepOn = STATE.settings.reminderOn;
        STATE.settings.reminderTime = p; STATE.settings.reminderOn = true;
        normalizeState();
        const got = STATE.settings.reminderTime;
        window.__r = 0;
        go('guide');
        const injected = document.querySelectorAll('#v-guide img[src="x"]').length;
        STATE.settings.reminderTime = keep; STATE.settings.reminderOn = keepOn;
        return { got, injected };
      }, planted);
      t.eq(`[reminderTime ${label}] is repaired to a clock time`, r.got, want, r);
      t.eq(`[reminderTime ${label}] injects nothing into Settings`, r.injected, 0, r);
    }
  }

  /* ---------- 5. hardReset() left a complete, un-stripped copy behind ----
     The pre-import snapshot is not a backup file — exportData() strips both API
     keys, this does not. Leaving it made "This cannot be undone" false, and the
     Undo button was still offered on the freshly-erased app.

     The check reads the raw localStorage key rather than calling
     hasPreImportSnapshot(), so it cannot pass on a getter that happens to
     answer no while the bytes are still on the device. */
  {
    const r = await page.evaluate(() => {
      const kc = window.confirm; window.confirm = () => true;
      const keep = JSON.stringify(STATE);
      STATE.settings.azureKey = 'AZURE-SECRET-123';
      STATE.settings.foodAiKey = 'GEMINI-SECRET-456';
      STATE.profile.name = 'Real Athlete';
      localStorage.setItem(PREIMPORT_KEY, JSON.stringify(STATE));
      const before = localStorage.getItem(PREIMPORT_KEY) || '';
      hardReset();
      const after = localStorage.getItem(PREIMPORT_KEY);
      window.confirm = kc;
      STATE = JSON.parse(keep); normalizeState(); save();
      return {
        snapshotHadKeys: before.indexOf('AZURE-SECRET-123') >= 0 && before.indexOf('GEMINI-SECRET-456') >= 0,
        survived: after != null,
        // hasPreImportSnapshot() drives the Undo button; it must agree with the bytes.
        stillOffered: hasPreImportSnapshot(),
      };
    });
    // Guard: the snapshot really did carry both plaintext keys before the reset.
    t.ok('guard: the snapshot carried both API keys', r.snapshotHadKeys, r);
    t.ok('hardReset erases the pre-import snapshot too', !r.survived, r);
    t.ok('the Undo button is not offered on a freshly-erased app', !r.stillOffered, r);
  }

  /* ---------- 6. nutrition.kcalTarget had no type repair ----------------
     todayKcalBudget() did `k + movementKcalAdj()`, so a stored STRING
     CONCATENATED: '2400' + 600 rendered "24000 kcal left today" on Fuel while
     Settings two rows down still said 2400. Nothing threw. The repair is the
     real fix; the unary plus in todayKcalBudget() is the second half.

     Both halves are checked separately, because a mutant that reverts only one
     of them is caught by only one of these. */
  {
    const r = await page.evaluate(() => {
      const keep = STATE.nutrition.kcalTarget;
      STATE.nutrition.kcalTarget = '2400';
      normalizeState();
      const repaired = STATE.nutrition.kcalTarget;
      const typeAfter = typeof repaired;
      // Second half: force a string past the repair and confirm the reader adds.
      STATE.nutrition.kcalTarget = '2400';
      const budget = todayKcalBudget();
      STATE.nutrition.kcalTarget = keep;
      return { repaired, typeAfter, budget, budgetType: typeof budget };
    });
    t.eq('a numeric-string calorie target is repaired to a number', r.repaired, 2400, r);
    t.eq('the repaired target is stored as a number', r.typeAfter, 'number', r);
    t.eq('todayKcalBudget adds rather than concatenating', r.budgetType, 'number', r);
    t.ok('todayKcalBudget stays a plausible day, not a ten-fold one', r.budget >= 2400 && r.budget <= 2900, r);
  }

  /* ---------- 7. restartProgram() destroyed unfinished sessions ----------
     Its own confirm says "Your history stays saved". It archived only when a
     COMPLETED session existed, then cleared the map unconditionally — so a run
     made entirely of part-finished and pain-stopped work was dropped, which is
     precisely the work an athlete cannot re-create.

     Asserted on sets recoverable from STATE.runs, not on runs.length: an
     archive that stores an empty object would satisfy a length check. */
  {
    const r = await page.evaluate(() => {
      const keep = JSON.stringify({ logs: STATE.logs, runs: STATE.runs, ptr: STATE.progressPtr });
      const kc = window.confirm; window.confirm = () => true;
      STATE.runs = [];
      STATE.logs = {
        0: { done: false, ex: { plank: { sets: [30, 30] } } },
        1: { done: false, stoppedForPain: true, ex: { hollow: { sets: [20] } } },
        2: { done: false, ex: { pushup: { sets: [8, 8, 8] } } },
      };
      restartProgram();
      const countSets = o => Object.values(o || {}).reduce((n, l) =>
        n + Object.values((l && l.ex) || {}).reduce((m, e) => m + (((e || {}).sets) || []).length, 0), 0);
      const recovered = (STATE.runs || []).reduce((n, r) => n + countSets(r.logs), 0);
      window.confirm = kc;
      const back = JSON.parse(keep);
      STATE.logs = back.logs; STATE.runs = back.runs; STATE.progressPtr = back.ptr; save();
      return { recovered, logsAfter: Object.keys(STATE.logs || {}).length };
    });
    t.eq('every logged set survives a restart, finished or not', r.recovered, 6, r);
  }

  /* ---------- 8. three habit ticks that only ever went ON ---------------
     syncStepHabit()'s own comment says the tick and the number must never
     contradict each other. Water and protein never got that treatment, and the
     step guard was blind to jumping jacks — the DEFAULT cardio mode.

     Each case drives the real writer (logWater / removeFood / setJackVal) and
     reads the tick back off STATE. Calling the sync function directly would
     pass on a version whose caller never reaches it. */
  {
    const water = await page.evaluate(() => {
      const t0 = nutToday();
      const keep = JSON.stringify({ water: t0.water, habits: t0.habits });
      t0.water = 0; t0.habits = {};
      const target = waterTargetCups();
      for (let i = 0; i < target; i++) logWater(1);
      const onAtTarget = !!nutToday().habits.water;
      logWater(-target);
      const offAfterUndo = !!nutToday().habits.water;
      const cups = nutToday().water;
      const back = JSON.parse(keep);
      const tt = nutToday(); tt.water = back.water; tt.habits = back.habits; save();
      return { onAtTarget, offAfterUndo, cups };
    });
    t.ok('the water habit ticks when the target is reached', water.onAtTarget, water);
    t.eq('guard: the cups really went back to zero', water.cups, 0, water);
    t.ok('the water habit unticks when the cups are taken back', !water.offAfterUndo, water);

    const prot = await page.evaluate(() => {
      const t0 = nutToday();
      const keep = JSON.stringify({ food: t0.food, habits: t0.habits });
      t0.food = []; t0.habits = {};
      const tgt = proteinTargetG();
      t0.food = [{ name: 'Big meal', kcal: 900, p: tgt + 10, c: 40, f: 20 }];
      syncProteinHabit();
      const onWhenLogged = !!nutToday().habits.protein;
      removeFood(0);
      const offWhenEmptied = !!nutToday().habits.protein;
      const rows = foodTotals().n;
      const back = JSON.parse(keep);
      const tt = nutToday(); tt.food = back.food; tt.habits = back.habits; save();
      return { onWhenLogged, offWhenEmptied, rows };
    });
    t.ok('the protein habit ticks when the target is met', prot.onWhenLogged, prot);
    t.eq('guard: the diary really is empty', prot.rows, 0, prot);
    t.ok('an emptied diary unticks the protein habit', !prot.offWhenEmptied, prot);

    const jacks = await page.evaluate(() => {
      const t0 = nutToday();
      const keep = JSON.stringify({ jackVal: t0.jackVal, jackUnit: t0.jackUnit, jackLvl: t0.jackLvl,
        steps: t0.steps, val: t0.val, habits: t0.habits, _stepAuto: t0._stepAuto, cardioMode: nut().cardioMode });
      delete t0.steps; delete t0.val; delete t0._stepAuto; t0.habits = {};
      nut().cardioMode = 'jacks';
      setJackUnit('min'); setJackLvl('hard'); setJackVal(60);
      const equiv = stepEquivalent(), target = stepTarget();
      const ticked = !!nutToday().habits.steps;
      const back = JSON.parse(keep);
      const tt = nutToday();
      tt.jackVal = back.jackVal; tt.jackUnit = back.jackUnit; tt.jackLvl = back.jackLvl;
      tt.steps = back.steps; tt.val = back.val; tt.habits = back.habits; tt._stepAuto = back._stepAuto;
      nut().cardioMode = back.cardioMode; save();
      return { equiv, target, ticked };
    });
    // Guard: without this, "ticked" could be false simply because the work fell short.
    t.ok('guard: an hour of hard jacks really does clear the step target',
      jacks.equiv >= jacks.target, jacks);
    t.ok('jumping jacks tick the step habit, not only the bike', jacks.ticked, jacks);
  }

  /* ---------- 9. the calorie button promised a number it would not deliver
     applyKcalAdj() routes through the BMR/absolute floor, which can swallow the
     whole correction. The label was the raw arithmetic, so an athlete already
     on the floor was offered "Drop to 1130 kcal", tapped it, and nothing moved
     — and the three-week silence was still stamped.

     Two scenarios, because one alone cannot discriminate: a floored athlete
     must NOT be offered a cut, and an unfloored one must still be offered a
     real one. A fix that simply removed the button would pass the first. */
  {
    const r = await page.evaluate(() => {
      const n = nut();
      const keep = JSON.stringify(n);
      const setBody = (sex, age, cm, kg, act, goal) => {
        n.sex = sex; n.age = age; n.heightCm = cm; n.weightKg = kg; n.activity = act; n.goal = goal;
        n.kcalAdj = 0; delete n.kcalAdjAt; recalcKcalFromStored();
      };
      // Small, older, sedentary — the body the floor exists to protect.
      setBody('female', 52, 158, 56, 1.2, 'lose');
      const floored = { target: n.kcalTarget, flag: !!n.kcalFloored,
        preview: kcalTargetPreview(-110) };
      // A large, very active athlete sits well clear of the floor.
      setBody('male', 28, 186, 92, 1.6, 'lose');
      const clear = { target: n.kcalTarget, flag: !!n.kcalFloored,
        preview: kcalTargetPreview(-110) };
      Object.assign(n, JSON.parse(keep)); recalcKcalFromStored(); save();
      return { floored, clear };
    });
    // Guard: the two scenarios really are on opposite sides of the floor.
    t.ok('guard: the small athlete is on the floor', r.floored.flag, r);
    t.ok('guard: the large athlete is not', !r.clear.flag, r);
    t.eq('a floored athlete: the preview refuses to move the target',
      r.floored.preview.target, r.floored.target, r);
    t.ok('an unfloored athlete: the preview really does cut',
      r.clear.preview.target < r.clear.target, r);
    t.eq('an unfloored athlete: the preview equals the requested cut',
      r.clear.preview.target, r.clear.target - 110, r);
  }


  /* ---------- 10. the lift-log sheet rendered BEHIND the player ---------
     `.scrim` is 60, `.pl` is 75. The sheet built correctly and was painted
     underneath, so the app's only route for recording added load had no input
     path at all — the button looked dead and Android Back popped an invisible
     sheet.

     Asserted with elementFromPoint on the input the athlete has to type into,
     not on the panel merely existing: a panel mounted somewhere unreachable
     would satisfy a querySelector and still be the same bug. */
  {
    const r = await page.evaluate(async () => {
      startWeights();
      await new Promise(res => setTimeout(res, 60));
      if (!PLAYER) return { skipped: true };
      plEnterDone();
      const btn = Array.from(document.querySelectorAll('#plBody button'))
        .find(b => /Log what you lifted/.test(b.textContent));
      if (btn) btn.click();
      const panel = document.querySelector('#plLiftPanel');
      const input = document.querySelector('#lf-l-0');
      let reachable = false, hit = '';
      if (input) {
        input.scrollIntoView({ block: 'center' });
        const b = input.getBoundingClientRect();
        const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        hit = el ? (el.id || el.className || el.tagName) : 'null';
        reachable = !!el && (el === input || input.contains(el));
      }
      const shown = !!panel && panel.style.display === 'block';
      playerTeardown();
      return { hadBtn: !!btn, shown, hasInput: !!input, reachable, hit };
    });
    if (!r.skipped) {
      t.ok('the finish screen offers the load log', r.hadBtn, r);
      t.ok('it mounts as an in-player panel, not a buried sheet', r.shown, r);
      t.ok('the load input is rendered', r.hasInput, r);
      t.ok('the load input is actually reachable by a tap', r.reachable, r);
    }
  }

  /* ---------- 11. HIIT and the flow counted callbacks, not seconds -------
     v238 gave the guided player a wall-clock anchor because Chrome throttles a
     hidden tab's timers to roughly one callback a minute. Both twins were left
     counting ticks. Measured before the fix: six real seconds moved the HIIT
     clock by two.

     The check STARVES the tick — fires exactly one callback after real time has
     passed — which is what throttling actually does. Sleeping and letting the
     interval run normally would prove nothing, because an unthrottled interval
     is accurate either way. */
  {
    const r = await page.evaluate(async () => {
      startHiit('tabata');
      await new Promise(res => setTimeout(res, 60));
      if (!INTV) return { skipped: true };
      // Land on a real work/rest step rather than the lead-in countdown.
      ivStep(0);
      clearInterval(INTV.tid); INTV.tid = null;      // starve it
      const before = INTV.remain;
      INTV.deadline = Date.now() - 4000;             // stand in for 5 real seconds lost
      ivTick();                                      // exactly ONE callback
      const after = INTV ? INTV.remain : null;
      if (typeof hiitTeardown === 'function') hiitTeardown();
      return { before, after, dropped: before - after };
    });
    if (!r.skipped) {
      t.ok('guard: the HIIT step really started with time on it', r.before > 5, r);
      t.ok('one starved HIIT tick catches the clock up to real time',
        r.dropped >= 4, r);
    }
  }

  /* ---------- 12. count-up stopwatches under-counted ---------------------
     Benchmark Ops writes its number straight into STATE.opsPR as a personal
     best, so a throttled run set a fake record. Same starve-the-tick method:
     one callback after real time has passed must report real time. */
  {
    const r = await page.evaluate(async () => {
      const st = swStart({ secs: 0, running: true });
      const immediately = swSecs(st);
      st.at -= 10000;                 // ten real seconds ago
      const afterTen = swSecs(st);
      swPause(st, false);             // paused...
      await new Promise(res => setTimeout(res, 40));
      swPause(st, true);              // ...and resumed
      const stillTen = swSecs(st);
      return { immediately, afterTen, stillTen };
    });
    t.eq('a fresh stopwatch reads zero', r.immediately, 0, r);
    t.eq('ten real seconds read as ten, however few ticks arrived', r.afterTen, 10, r);
    t.ok('time spent paused is not counted', r.stillTen === 10, r);
  }

  /* ---------- 13. Quick Workouts showed the exercise it would replace ----
     safeSwap() ran only inside quickPlay(), so a flagged athlete read one
     movement on the card and performed another. A swap can also cross units,
     turning "20 reps" into a 20-second hold.

     Driven with a real flag set, and asserted on the rendered card — the swap
     resolving correctly in isolation was never the broken half. */
  {
    const r = await page.evaluate(() => {
      const keep = (STATE.profile.limitations || []).slice();
      STATE.profile.limitations = ['lowback'];
      const q = QUICKIES.find(x => x.items.some(i => safeSwap(i.exId) !== i.exId));
      if (!q) { STATE.profile.limitations = keep; return { skipped: true }; }
      QUICK_ID = q.id; go('quick'); renderQuick();
      const txt = document.querySelector('#v-quick').innerText;
      const swapped = q.items.filter(i => safeSwap(i.exId) !== i.exId);
      const originalsShown = swapped.filter(i => txt.indexOf(EX[i.exId].name) >= 0).map(i => i.exId);
      const substitutesShown = swapped.filter(i => txt.indexOf(EX[safeSwap(i.exId)].name) >= 0).length;
      // Units must agree between the card and what Play will run.
      const crossed = swapped.filter(i => EX[i.exId].unit !== EX[safeSwap(i.exId)].unit);
      const carriedRaw = crossed.filter(i => {
        const sub = EX[safeSwap(i.exId)];
        return quickTarget(i, sub) === i.target && (sub.base || 0) !== i.target;
      }).map(i => i.exId);
      STATE.profile.limitations = keep; go('today');
      return { swaps: swapped.length, originalsShown, substitutesShown, crossed: crossed.length, carriedRaw };
    });
    if (!r.skipped) {
      t.ok('guard: this quick workout really does contain a swapped movement', r.swaps > 0, r);
      t.eq('the card never names the contraindicated movement', r.originalsShown.length, 0, r);
      t.eq('the card names the substitute instead', r.substitutesShown, r.swaps, r);
      t.eq('a unit-crossing swap does not carry the old number across',
        r.carriedRaw.length, 0, r);
    }
  }


  /* ---------- 14. the reference days could not reach a gain target -------
     The starch dial clamps at 1.6x, deliberately — closing a gap on starch
     alone put 700 g of potato on one plate — so above ~2,800 kcal it bound on
     every one of the 28 days and an ordinary very-active athlete on a gain goal
     missed the calorie bar 28 times out of 28. Every documented bar was
     calibrated at exactly that ceiling, so nothing objected.

     Asserted as a measured RANGE, not as "the new bar passes": a bar only ever
     probed from the inside cannot show the range shrinking again. */
  {
    const r = await page.evaluate(() => {
      const ceilingAt = p => {
        let hi = 0;
        for (let k = 2000; k <= 4000; k += 20)
          if (REF_DAYS.every(d => Math.abs(scaleDay(d, p, k).kcal - k) <= 150)) hi = k;
        return hi;
      };
      // The audit's own example: 78 kg, very active, building muscle.
      const day = scaleDay(REF_DAYS[0], 140, 3300);
      return { at140: ceilingAt(140), at200: ceilingAt(200), day: { kcal: day.kcal, p: day.p } };
    });
    t.ok('every day reaches a real gain-goal calorie target', r.at140 >= 3200, r);
    t.ok('and the ceiling rises with the protein target, not against it', r.at200 >= r.at140, r);
    t.ok('a single day lands on 3,300 kcal', Math.abs(r.day.kcal - 3300) <= 150, r);
    t.ok('without overshooting its protein target', Math.abs(r.day.p - 140) <= 12, r);
  }

  /* ---------- 15. the calorie check never ran for a gain goal ------------
     `if(expected>-0.05)return null` bailed on anything that was not a deficit,
     so an athlete bulking and gaining nothing got no check at all — the exact
     failure the function's own header calls the commonest way a diet app fails
     somebody.

     Four scenarios, because a fix that simply removed the guard would pass a
     check that only ever tests one: both goals must produce a verdict, and the
     correction must point the right way in each. */
  {
    const r = await page.evaluate(() => {
      const n = nut(); const keep = JSON.stringify(n);
      const keepM = JSON.stringify(STATE.measurements || []);
      const setup = (goal, fromKg, toKg) => {
        n.sex = 'male'; n.age = 30; n.heightCm = 180; n.weightKg = toKg;
        n.activity = 1.6; n.goal = goal; n.kcalAdj = 0; delete n.kcalAdjAt;
        recalcKcalFromStored();
        // eight weeks of a flat-or-moving trend
        const ms = []; const day = 86400000;
        for (let i = 0; i < 8; i++) {
          const d = new Date(Date.now() - (7 - i) * 7 * day).toISOString().slice(0, 10);
          ms.push({ date: d, waist: 84, weight: fromKg + (toKg - fromKg) * (i / 7) });
        }
        STATE.measurements = ms;
        return calorieCheck();
      };
      const out = {};
      out.gainStalled = setup('gain', 80, 80);            // bulking, nothing happening
      out.gainFast    = setup('gain', 80, 88);            // bulking far too fast
      out.loseStalled = setup('lose', 80, 80);            // cutting, nothing happening
      out.maintain    = setup('maintain', 80, 80);        // no prescribed rate to verify
      Object.assign(n, JSON.parse(keep)); STATE.measurements = JSON.parse(keepM);
      recalcKcalFromStored(); save();
      return out;
    });
    t.ok('a bulk that is not moving gets a verdict at all', !!r.gainStalled, r.gainStalled);
    t.eq('and it reads as stalled', r.gainStalled && r.gainStalled.verdict, 'stalled', r.gainStalled);
    t.ok('and the correction says EAT MORE, not less',
      r.gainStalled && r.gainStalled.step > 0, r.gainStalled);
    t.eq('a bulk gaining far too fast reads as fast',
      r.gainFast && r.gainFast.verdict, 'fast', r.gainFast);
    t.ok('and that correction says eat LESS', r.gainFast && r.gainFast.step < 0, r.gainFast);
    // Guard: the cut path must not have been broken by generalising the test.
    t.eq('a stalled cut still reads as stalled', r.loseStalled && r.loseStalled.verdict, 'stalled', r.loseStalled);
    t.ok('and still says eat less', r.loseStalled && r.loseStalled.step < 0, r.loseStalled);
    t.eq('maintenance has no prescribed rate, so no check', r.maintain, null, r.maintain);
  }

  /* ---------- 16. the flow had no Pause, no wake lock, a shrunken photo --
     It is as hands-free as the player and HIIT — it talks you through each
     stretch — and it was the only one of the three that let the screen sleep,
     with no way to answer the door except abandoning it or falsely marking it
     Done. Its photo was fixed at 191px against the player's 331px.

     Measured after the sheet has finished sliding open: read synchronously and
     every geometry number is taken while the sheet is still off-screen. */
  {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.evaluate(() => runWarmup());
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const sh = document.querySelector('#sheet');
      const media = document.querySelector('#flowImg');
      const before = !!(timer && timer.mode === 'flow');
      flowToggle();
      const paused = !(timer && timer.mode === 'flow');
      const label = (document.querySelector('#flowToggle') || {}).textContent;
      flowToggle();
      const resumed = !!(timer && timer.mode === 'flow');
      return { before, paused, resumed, label,
        hasPause: !!document.querySelector('#flowToggle'),
        wakes: /wakeOn\(/.test(runFlow.toString()),
        media: Math.round(media.getBoundingClientRect().width),
        hidden: sh.scrollHeight - sh.clientHeight };
    });
    await page.evaluate(() => flowStop(false));
    await page.waitForTimeout(400);
    t.ok('the flow offers a Pause control', r.hasPause, r);
    t.ok('guard: the flow timer was really running', r.before, r);
    t.ok('Pause actually stops the timer', r.paused, r);
    t.eq('and says so', r.label, 'Resume', r);
    t.ok('Resume restarts it', r.resumed, r);
    t.ok('the flow keeps the screen awake like its twins', r.wakes, r);
    t.ok('its photo is no longer half the size of the player’s', r.media >= 260, r);
    t.eq('and the sheet still fits the fold', r.hidden, 0, r);
  }

  /* ---------- 17. the assessment sheet hid its own primary action --------
     "Next test →" sat ~91px below the fold at 375x667 on all ten tests, and at
     320x568 six of ten also clipped "← Back". This is the primary action of the
     app's most important first-run flow.

     Shrinking the photo alone took 91px to 61 — better, and still not "the
     button is on screen", which is the actual requirement. The nav row is
     sticky, so it is reachable whatever a test's content does. */
  for (const [w, h] of [[375, 667], [320, 568]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => openAssessment());
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const sh = document.querySelector('#sheet');
      const cta = Array.from(sh.querySelectorAll('button'))
        .find(b => /Next test|See my results/.test(b.textContent));
      const b = cta.getBoundingClientRect();
      return { visible: b.bottom <= innerHeight + 1 && b.top >= 0,
        bottom: Math.round(b.bottom), vh: innerHeight,
        sticky: getComputedStyle(sh.querySelector('.assess-nav')).position };
    });
    await page.evaluate(() => closeSheet());
    await page.waitForTimeout(400);
    t.ok(`[${w}x${h}] the primary action is on screen without scrolling`, r.visible, r);
    t.eq(`[${w}x${h}] the nav row is pinned, not merely shrunk into place`, r.sticky, 'sticky', r);
  }
  await page.setViewportSize({ width: 390, height: 844 });

  errors.forEach(e => t.fail('a page error fired during hardening checks', e));
  await browser.close();
  srv.close();
  return t.finish();
}
