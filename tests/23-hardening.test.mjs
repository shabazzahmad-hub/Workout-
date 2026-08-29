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

  /* ---------- 5b. hardReset() must still ERASE athlete data, and now must NOT
     erase the two API keys — a deliberate change, requested directly, from the
     original "erase ALL data" posture. The key was typed once into this device
     and never leaves it either way (exportData() already strips it from a
     backup file), so re-typing it after wiping a season of training is real
     cost with no safety benefit.

     Both halves of this need their own check: proving keys survive says
     nothing about whether the rest of STATE was actually wiped, and a version
     that skipped the wipe entirely (or only reset a couple of fields) would
     pass a keys-survive-only assertion just as happily. */
  {
    const r = await page.evaluate(() => {
      const kc = window.confirm; window.confirm = () => true;
      STATE.settings.azureKey = 'AZURE-SECRET-789';
      // deliberately NOT DEFAULT_STATE()'s own default ('eastus') — a region
      // that happens to already match the default cannot distinguish a real
      // carry-forward from the carry-forward being silently skipped
      STATE.settings.azureRegion = 'westeurope';
      STATE.settings.foodAiKey = 'GEMINI-SECRET-321';
      STATE.profile.name = 'Real Athlete';
      STATE.baseline = { date: '2026-01-01', score: 80, level: 'Advanced', maxes: { plank: 90 } };
      STATE.logs = { 0: { done: true, feel: 'good' } };
      STATE.nutrition.diet = 'vegan';
      save();
      hardReset();
      window.confirm = kc;
      return {
        azureKey: STATE.settings.azureKey, azureRegion: STATE.settings.azureRegion,
        foodAiKey: STATE.settings.foodAiKey,
        profileName: STATE.profile.name, baseline: STATE.baseline,
        logCount: Object.keys(STATE.logs || {}).length,
        diet: STATE.nutrition.diet,
      };
    });
    t.eq('the Azure key survives a reset', r.azureKey, 'AZURE-SECRET-789', r);
    t.eq('its region survives alongside it', r.azureRegion, 'westeurope', r);
    t.eq('the Gemini key survives a reset', r.foodAiKey, 'GEMINI-SECRET-321', r);
    // and everything else really is wiped — the keys are the ONE exception
    t.ok('the profile name is erased', r.profileName !== 'Real Athlete', r);
    t.eq('the baseline is erased', r.baseline, null, r);
    t.eq('the training log is erased', r.logCount, 0, r);
    t.eq('the diet preference is reset to its default', r.diet, 'omnivore', r);
    // re-seed for the blocks that follow — ATHLETE overwrites STATE.onboarded itself
    await seedAthlete(page);
  }

  /* ---------- 5c. a region carried across is normalised on the way back in --
     Keeping the key but losing (or mangling) its region reintroduces the exact
     "opaque WebSocket failure naming nothing" defect fixed once already (v272)
     — a stored "east us" with the portal's own space in it must not survive a
     reset unrepaired, since normalizeState() runs BEFORE the carried region is
     written back and would never see it. */
  {
    const r = await page.evaluate(() => {
      const kc = window.confirm; window.confirm = () => true;
      STATE.settings.azureKey = 'AZURE-SECRET-999';
      STATE.settings.azureRegion = 'East US';   // the portal's own spelling, unnormalised
      save();
      hardReset();
      window.confirm = kc;
      return { region: STATE.settings.azureRegion };
    });
    t.eq('a region carried across a reset is normalised, not just copied', r.region, 'eastus', r);
    await page.evaluate(() => { STATE.onboarded = false; });
    await seedAthlete(page);
  }

  /* ---------- 5d. the confirm text must say what the button now does -------
     A promise in the UI is a specification. The old wording ("Erase ALL your
     data") became false the moment keys started surviving — this is the exact
     class of defect this file already exists to catch, applied to a change
     made in the SAME round rather than found in old code. */
  {
    const r = await page.evaluate(() => {
      return { src: hardReset.toString() };
    });
    t.ok('the confirm text no longer promises ALL data is erased',
      !/erase all your data/i.test(r.src), r.src.slice(0, 200));
    t.ok('and says the keys are kept', /api keys stay/i.test(r.src), r.src.slice(0, 200));
  }

  /* ---------- 5e. restoring a backup must not erase the device's keys ------
     The mirror of 5b, and the reason carryDeviceCreds() exists as ONE function
     rather than as two copies of the same three lines.

     exportData() strips both keys, so a backup file holds no opinion about
     them — and importData() merged the file's settings over DEFAULT_STATE(),
     whose blanks then won. Measured before the fix: a device with a Gemini key
     restoring its OWN backup went foodAIReady() true to false, the AI food
     import silently stopped working, and the only thing on screen was "Backup
     restored". The app was protecting the key against the MORE destructive
     action and erasing it on the LESS destructive one.

     Four floors, because "keep the keys" is satisfiable in several wrong ways:
     the backup must STILL carry neither key (putting them in the file would
     pass every survives-a-restore assertion and is the one thing this app
     promises never to do); the restore must still genuinely replace athlete
     data (a fix that kept everything passes too); and a device with NO key of
     its own must take the FILE's region, or a new phone loses the region it
     was exported with. */
  {
    const r = await page.evaluate(async () => {
      const grab = async () => {
        let blob = null;
        const rb = window.URL.createObjectURL, rc = HTMLAnchorElement.prototype.click;
        window.URL.createObjectURL = b => { blob = b; return 'blob:x'; };
        HTMLAnchorElement.prototype.click = function () {};
        await exportData();
        window.URL.createObjectURL = rb; HTMLAnchorElement.prototype.click = rc;
        return blob ? await blob.text() : null;
      };
      const restore = async (text, sentinel) => {
        const kc = window.confirm; window.confirm = () => true;
        await new Promise(res => {
          importData({ target: { files: [new File([text], 'b.json', { type: 'application/json' })] } });
          const iv = setInterval(() => { if (STATE.profile && STATE.profile.name === sentinel) { clearInterval(iv); res(); } }, 60);
          setTimeout(() => { clearInterval(iv); res(); }, 3000);
        });
        window.confirm = kc;
      };
      const o = {};
      // A backup taken with one region, on a device that has since been pointed
      // at another — so "the device's region wins" cannot pass by coincidence.
      STATE.profile.name = 'BACKUP-ME';
      STATE.settings.azureKey = 'AZ-DEVICE'; STATE.settings.azureRegion = 'westeurope';
      STATE.settings.foodAiKey = 'GEMINI-DEVICE';
      STATE.nutrition.diet = 'vegan'; STATE.prs = { pushup: 41 };
      save();
      const text = await grab();
      o.fileHasAzure = text.includes('AZ-DEVICE');
      o.fileHasGemini = text.includes('GEMINI-DEVICE');
      o.fileRegion = JSON.parse(text).settings.azureRegion;

      // the device moves on: different athlete data, a different region
      STATE.profile.name = 'MOVED-ON'; STATE.nutrition.diet = 'omnivore';
      STATE.prs = {}; STATE.settings.azureRegion = 'canadacentral';
      save();
      await restore(text, 'BACKUP-ME');
      o.readyAfter = foodAIReady();
      o.azureAfter = STATE.settings.azureKey;
      o.geminiAfter = STATE.settings.foodAiKey;
      o.regionAfter = STATE.settings.azureRegion;
      o.dietAfter = STATE.nutrition.diet;          // floor: athlete data really was replaced
      o.prAfter = (STATE.prs || {}).pushup;

      // and the same file onto a device carrying no key at all
      STATE.settings.azureKey = ''; STATE.settings.foodAiKey = '';
      STATE.settings.azureRegion = 'eastus'; STATE.profile.name = 'BLANK-DEVICE';
      save();
      await restore(text, 'BACKUP-ME');
      o.blankRegion = STATE.settings.azureRegion;
      o.blankAzure = STATE.settings.azureKey;
      return o;
    });
    t.ok('guard: the backup file carries a region to argue with', r.fileRegion === 'westeurope', r);
    t.ok('the backup still carries no Azure key', r.fileHasAzure === false, r);
    t.ok('the backup still carries no Gemini key', r.fileHasGemini === false, r);
    t.eq('the Gemini key survives restoring a backup', r.geminiAfter, 'GEMINI-DEVICE', r);
    t.ok('so the AI food import still works afterwards', r.readyAfter === true, r);
    t.eq('the Azure key survives restoring a backup', r.azureAfter, 'AZ-DEVICE', r);
    t.eq("and takes the DEVICE's region, not the file's", r.regionAfter, 'canadacentral', r);
    t.eq('a device with no key of its own takes the file’s region', r.blankRegion, 'westeurope', r);
    t.eq('and gains no key it never had', r.blankAzure, '', r);
    // floors: the restore is still a restore
    t.eq('the backup’s diet really did replace the device’s', r.dietAfter, 'vegan', r);
    t.eq('and so did its personal records', r.prAfter, 41, r);
    await page.evaluate(() => { STATE.onboarded = false; });
    await seedAthlete(page);
  }

  /* ---------- 5f. a NEW state field has to survive the round trip ---------
     v340 added prep.path, and v336 was found by driving exactly this: export →
     import, checking that what the athlete set comes back. A field that is
     stored, rendered and repaired but silently dropped by a restore is a
     control the athlete loses on their next new phone. */
  {
    const r = await page.evaluate(async () => {
      const o = {};
      if (typeof setPrepPath !== 'function' || typeof prepPath !== 'function') return { absent: true };
      const ahead = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
      STATE.prep = { date: ahead(112), path: 'assaulter',
        /* v341's dated checkpoint records travel in the same file. A record of
           what the athlete scored halfway through a block is exactly the kind
           of thing a restore must bring back — it cannot be re-created. */
        checks: { initial: { at: '2026-07-01', results: { lift: 190 } },
                  mid: { at: '2026-08-01', results: { lift: 172, shuttle: 285 } } } }; save();
      let blob = null;
      const rb = window.URL.createObjectURL, rc = HTMLAnchorElement.prototype.click;
      window.URL.createObjectURL = b => { blob = b; return 'blob:x'; };
      HTMLAnchorElement.prototype.click = function () {};
      await exportData();
      window.URL.createObjectURL = rb; HTMLAnchorElement.prototype.click = rc;
      const text = blob ? await blob.text() : '';
      o.inBackup = text ? JSON.parse(text).prep.path : null;
      o.checksInBackup = text ? JSON.parse(text).prep.checks : null;
      // the device moves to the other path, then restores the file
      STATE.prep = { date: ahead(112), path: 'operator' }; save();
      o.before = prepPath();
      const kc = window.confirm; window.confirm = () => true;
      await new Promise(res => {
        importData({ target: { files: [new File([text], 'b.json', { type: 'application/json' })] } });
        const iv = setInterval(() => { if (STATE.prep && STATE.prep.path === 'assaulter') { clearInterval(iv); res(); } }, 60);
        setTimeout(() => { clearInterval(iv); res(); }, 3000);
      });
      window.confirm = kc;
      o.after = prepPath();
      o.stored = STATE.prep.path;
      o.checksAfter = JSON.parse(JSON.stringify(STATE.prep.checks || {}));
      STATE.prep = {}; save();
      return o;
    });
    t.ok('guard: the device really was on the other path first',
      !r.absent && r.before === 'operator', r);
    t.eq('the training path travels in a backup', r.inBackup, 'assaulter', r);
    t.eq('and comes back on a restore', r.after, 'assaulter', r);
    t.eq('stored on STATE, not merely reported by the getter', r.stored, 'assaulter', r);
    t.ok('the dated assessment records travel in the backup too',
      !!(r.checksInBackup && r.checksInBackup.mid && r.checksInBackup.mid.results.lift === 172), r.checksInBackup);
    t.ok('and both checkpoints come back on a restore',
      r.checksAfter.initial && r.checksAfter.initial.results.lift === 190
      && r.checksAfter.mid && r.checksAfter.mid.results.shuttle === 285, r.checksAfter);
    t.eq('with their dates intact', (r.checksAfter.mid || {}).at, '2026-08-01', r.checksAfter);
    await page.evaluate(() => { STATE.onboarded = false; });
    await seedAthlete(page);
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

  /* ---------- 10b. the harness must not hand back a covered page -----------
     The check above failed one CI run in three with `hit: "sgrad"` — the
     SPLASH's own gradient. `.splash` is a full-screen `z-index:400` overlay
     dismissed 850ms after the first draw, and waitForBoot resolved on a
     rendered view at about 626ms, so it returned a page with an opaque sheet
     over the whole app and called it booted.

     Nothing that reads TEXT could tell, which is why it survived so long — but
     every check that hit-tests, clicks or screenshots was racing a timer it did
     not know about, and an unrelated change shifting the timing by a few
     milliseconds is all it took to lose. Fixing it inside the one check that
     noticed would have left the class alive, so waitForBoot waits for it.

     MEASURED AT THE MOMENT BOOT RESOLVES, on a fresh load. The first version of
     this block sat where the failure happened, four seconds in — by which time
     the splash is gone whatever waitForBoot does, so the mutant that deletes
     the wait walked straight through it. A check that cannot fire in the case
     you tested is not tested. */
  {
    const pg = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForBoot(pg);
    /* Read SYNCHRONOUSLY in the first evaluate after the wait — any further
       await hands the splash's own 850ms timer the chance to fire and the
       assertion passes on that instead. */
    const r = await pg.evaluate(() => {
      const sp = document.getElementById('splash');
      const v = document.querySelector('.view.active');
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return {
        splashGone: !sp || sp.classList.contains('hide'),
        rendered: !!v && v.innerHTML.length > 400,
        hit: el ? (el.id || el.className || el.tagName) : 'null',
      };
    });
    await pg.close();
    /* The floor: waiting for the splash must not have turned waitForBoot into
       a wait for nothing. A mutant that returns before the app has drawn
       satisfies every "no overlay" assertion. */
    t.ok('boot still waits for the app to actually render', r.rendered, r);
    t.ok('and the splash is dismissed before it hands back', r.splashGone, r);
    t.ok('so a hit-test in the middle of the page reaches the app, not an overlay',
      !/splash|sgrad/.test(String(r.hit)), r);
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
      /* The MEDIA BOX, not the <img>. #flowImg is display:none until the photo
         decodes, so its own rect is 0x0 on any machine slower than the one this
         check was written on — it passed locally at 279px and failed CI at 0.
         The box is what the CSS actually sizes, and it is there whether or not
         a photo ever arrives. */
      const media = sh.querySelector('.pl-ringmedia');
      const before = !!(timer && timer.mode === 'flow');
      flowToggle();
      const paused = !(timer && timer.mode === 'flow');
      const label = (document.querySelector('#flowToggle') || {}).textContent;
      flowToggle();
      const resumed = !!(timer && timer.mode === 'flow');
      return { before, paused, resumed, label,
        hasPause: !!document.querySelector('#flowToggle'),
        wakes: /wakeOn\(/.test(runFlow.toString()),
        media: media ? Math.round(media.getBoundingClientRect().width) : 0,
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
    t.ok('its photo box is no longer half the size of the player’s', r.media >= 260, r);
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


  /* ---------- 18. a logged row with no macros is not a measured zero -----
     Reported from a real phone: an imported 897 kcal meal sat above three macro
     bars reading 0/165g, 0/180g, 0/60g with nothing saying why. v260 fixed the
     INPUT side — the sheet blanks the fields and warns — but once the row was
     saved the zeros were indistinguishable from real ones again.

     The rule is arithmetic, not a guess: calories come from protein, carbs and
     fat and nothing else, so 897 kcal with all three at zero cannot be a
     measurement. The 50 kcal floor keeps black coffee out of it. */
  {
    const r = await page.evaluate(() => {
      const CASES = [
        ['an imported meal with no macros', { kcal: 897, p: 0, c: 0, f: 0 }, true],
        ['black coffee', { kcal: 5, p: 0, c: 0, f: 0 }, false],
        ['a real zero-carb steak', { kcal: 400, p: 60, c: 0, f: 18 }, false],
        ['a pure-fat spoon of oil', { kcal: 120, p: 0, c: 0, f: 14 }, false],
        ['a plain sugar drink', { kcal: 140, p: 0, c: 35, f: 0 }, false],
      ];
      return CASES.map(([label, row, want]) => [label, macrosUncaptured(row), want]);
    });
    r.forEach(([label, got, want]) =>
      t.eq(`[${label}] uncaptured = ${want}`, got, want, { label, got, want }));
  }

  {
    const r = await page.evaluate(() => {
      const d = nutToday();
      const keep = JSON.stringify({ food: d.food, habits: d.habits });
      d.food = [{ name: 'Breakfast', kcal: 897, p: 0, c: 0, f: 0, meal: 'b' }];
      go('fuel'); renderFuel();
      const v = document.querySelector('#v-fuel');
      const txt = v.innerText;
      const out = {
        warns: /no macros recorded/i.test(txt),
        saysNotZero: /not saying you ate none/i.test(txt),
        rowFlagged: /macros not captured/i.test(txt),
        // the row must still be the thing you tap to fix it
        editable: !!Array.from(v.querySelectorAll('button')).find(b => /macros not captured/i.test(b.innerText)),
        count: uncapturedCount(),
      };
      // A day of REAL macros must say none of this.
      d.food = [{ name: 'Chicken and rice', kcal: 620, p: 55, c: 60, f: 14, meal: 'l' }];
      renderFuel();
      const t2 = document.querySelector('#v-fuel').innerText;
      out.cleanDayQuiet = !/no macros recorded/i.test(t2) && !/macros not captured/i.test(t2);
      out.cleanCount = uncapturedCount();
      const back = JSON.parse(keep);
      const dd = nutToday(); dd.food = back.food; dd.habits = back.habits; save();
      return out;
    });
    t.eq('the day counts the item with no macros', r.count, 1, r);
    t.ok('the macro bars say an item is missing, not that you ate none', r.warns, r);
    t.ok('and say so in those words', r.saysNotZero, r);
    t.ok('the diary row is marked', r.rowFlagged, r);
    t.ok('and the mark is on the button that opens the editor', r.editable, r);
    // Guard: without this the checks above could pass on markup shown to everybody.
    t.eq('a day of real macros counts none', r.cleanCount, 0, r);
    t.ok('and says nothing at all about missing macros', r.cleanDayQuiet, r);
  }


  /* ---------- 19. every control has an accessible name -------------------
     Found in the pre-release sweep: nine controls in Settings — six sliders,
     two dropdowns, a file input and both API-key fields — announced to a screen
     reader as a bare "slider" or "combo box". Their visible captions live in
     SIBLING elements, not in a <label>, so nothing associates the two.

     Asserted on the computed accessible name (aria-label, a wrapping label, a
     label[for], or a placeholder) rather than on the presence of the attribute,
     so a future control that gets a real <label> instead still passes. */
  {
    const r = await page.evaluate(() => {
      const named = el => !!(el.getAttribute('aria-label')
        || (el.id && document.querySelector(`label[for="${el.id}"]`))
        || el.closest('label')
        || el.getAttribute('placeholder')
        || el.getAttribute('title'));
      const scan = tab => {
        go(tab);
        const els = Array.from(document.querySelectorAll('.view.active input, .view.active select, .view.active textarea'));
        return { total: els.length, unnamed: els.filter(e => !named(e)).map(e => (e.type||e.tagName)) };
      };
      const out = {};
      ['today','program','fuel','progress','ref','guide'].forEach(t => out[t] = scan(t));
      // buttons must be reachable by name too — icon-only ones need aria-label
      go('guide');
      const btns = Array.from(document.querySelectorAll('.view.active button'));
      out.buttons = { total: btns.length,
        unnamed: btns.filter(b => !(b.innerText||'').trim() && !b.getAttribute('aria-label') && !b.title).length };
      return out;
    });
    // Guard: Settings is where the controls are — if it scanned nothing, the rest is vacuous.
    t.ok('guard: Settings really has form controls to check', r.guide.total >= 8, r.guide);
    ['today','program','fuel','progress','ref','guide'].forEach(tab =>
      t.eq(`[${tab}] every form control has an accessible name`, r[tab].unnamed.length, 0, r[tab]));
    t.ok('guard: Settings really has buttons to check', r.buttons.total > 20, r.buttons);
    t.eq('every button has a name a screen reader can read', r.buttons.unnamed, 0, r.buttons);
  }

  // ---- a device credential is not in any backup, so clearing it asks -------
  /* exportData() strips azureKey and foodAiKey on purpose, so a backup holds no
     opinion about either and a restore cannot undo the tap. clearAzureKey()
     confirmed; the Gemini key was cleared by a bare setFoodAiKey('') on a chip
     a few pixels from the password field, with a toast reading "Cleared".
     The route is driven through the CHIP, not the helper — the difference the
     Convert-button escape was made of. */
  {
    const r = await page.evaluate(() => {
      const o = {}, asks = [], orig = window.confirm;
      const chip = () => [...document.querySelectorAll('#v-guide .chip')]
        .find(b => (b.textContent || '').trim() === 'Clear key');
      STATE.settings.foodAiKey = 'AIza-test'; STATE.settings.azureKey = 'az-test'; save();
      go('guide'); renderGuide();
      o.chipFound = !!chip();
      window.confirm = m => { asks.push(m); return false; };
      if (chip()) chip().click();
      o.askedOnDecline = asks.length;
      o.declineKeptKey = STATE.settings.foodAiKey === 'AIza-test';
      window.confirm = m => { asks.push(m); return true; };
      if (chip()) chip().click();
      o.acceptCleared = !STATE.settings.foodAiKey;
      o.geminiMsg = asks[0] || '';
      // the twin
      asks.length = 0;
      clearAzureKey();
      o.azCleared = !STATE.settings.azureKey;
      o.azMsg = asks[0] || '';
      // THE FLOOR: SAVING a key must not ask anything.
      asks.length = 0;
      setFoodAiKey('AIza-again');
      o.saveAsked = asks.length;
      o.saveWorked = STATE.settings.foodAiKey === 'AIza-again';
      window.confirm = orig;
      STATE.settings.foodAiKey = ''; STATE.settings.azureKey = ''; save();
      return o;
    });
    t.ok('guard: the Clear key chip is on screen with a key saved', r.chipFound, r);
    t.eq('clearing the Gemini key asks first', r.askedOnDecline, 1, r);
    t.ok('and saying no keeps the key', r.declineKeptKey, r);
    t.ok('saying yes really clears it', r.acceptCleared, r);
    t.ok('the Gemini confirm says a backup cannot bring it back', /backup/i.test(r.geminiMsg), r.geminiMsg);
    t.ok('the Azure twin still clears', r.azCleared, r);
    t.ok('and its confirm says the same thing', /backup/i.test(r.azMsg), r.azMsg);
    /* THE FLOOR. A confirm bolted onto the setter would satisfy every
       assertion above and make entering a key a two-tap chore. */
    t.eq('saving a key asks nothing', r.saveAsked, 0, r);
    t.ok('and stores it', r.saveWorked, r);
  }


  /* ---- membership at the WRITE site (v354) --------------------------------
     From a full audit: junk was driven into every set*() writer and every tab
     was then rendered looking for the injected ELEMENT, not the substring.
     Two writers put a live DOM node on the page — setNutGoal() on all six
     tabs, setPersona() on two. importData() accepts arbitrary JSON, so that is
     a real path and not self-XSS. */
  {
    const wr = await page.evaluate(() => {
      const o = {}; const realErr = console.error; console.error = () => {};
      const P = '<img src=x data-inj="1">';
      const snap = JSON.stringify(STATE);
      const TABS = ['today','program','fuel','progress','ref','guide'];

      /* THE ELEMENT, not the substring — a legitimate thumbnail uses onerror
         as a missing-image fallback, so a text search reports 126 false hits. */
      o.injected = [];
      [['setNutGoal', () => setNutGoal(P)],
       ['setPersona', () => setPersona(P)],
       ['setReminderTime', () => setReminderTime(P)],
       ['setSwap', () => setSwap(0, 'x', P)]].forEach(([n, run]) => {
        STATE = JSON.parse(snap); try { run(); } catch (e) {}
        TABS.forEach(t => { try { go(t); render(); } catch (e) {}
          if (document.querySelector('[data-inj]')) o.injected.push(n + '@' + t); });
      });
      STATE = JSON.parse(snap);

      /* FLOOR: every control still works. A guard that refuses everything
         satisfies each assertion above and breaks the app. */
      setNutGoal('shred');       o.goalSet = STATE.nutrition.goal;
      setPersona('auto');        o.personaAuto = STATE.settings.coach;
      setPersona(COACHES[1].id); o.personaReal = STATE.settings.coach;
      setBodyLevel('cur', 3);    o.bodySet = STATE.profile.bodyCur;
      setReminderTime('18:30');  o.timeSet = STATE.settings.reminderTime;

      // and junk is refused rather than stored
      const g0 = STATE.nutrition.goal;  setNutGoal('zzz');
      o.goalJunkRefused = STATE.nutrition.goal === g0;
      const p0 = STATE.settings.coach;  setPersona('zzz');
      o.personaJunkRefused = STATE.settings.coach === p0;
      const t0 = STATE.settings.reminderTime; setReminderTime('99:99');
      o.timeJunkRefused = STATE.settings.reminderTime === t0;
      const s0 = JSON.stringify(STATE.swaps); setSwap(0, 'x', 'not_an_exercise');
      o.swapJunkRefused = JSON.stringify(STATE.swaps) === s0;

      /* Two writers THREW on anything but their own control's value —
         setBodyLevel via clamp(NaN) and setFoodAiKey via (v||'').trim. */
      o.threw = [];
      [['setBodyLevel-goal', () => setBodyLevel('goal', 'zzz')],
       ['setBodyLevel-goal-obj', () => setBodyLevel('goal', {})],
       ['setBodyLevel-cur', () => setBodyLevel('cur', 'zzz')],
       ['setFoodAiKey', () => setFoodAiKey({})],
       ['setFoodAiKey-null', () => setFoodAiKey(null)]].forEach(([n, run]) => {
        try { run(); } catch (e) { o.threw.push(n); } });
      /* Only the 'goal' branch reaches levelBF(), so a check on 'cur' alone
         exercises the branch that CANNOT throw — and 'cur' has its own harm:
         junk stored there travels in every backup. Both branches, and the
         stored value, or the guard is tested on half of what it guards. */
      const b0 = STATE.profile.bodyCur, g0b = STATE.profile.bodyGoal;
      setBodyLevel('cur', 'zzz'); setBodyLevel('goal', {});
      o.bodyJunkRefused = STATE.profile.bodyCur === b0 && STATE.profile.bodyGoal === g0b;
      setBodyLevel('cur', 9); setBodyLevel('goal', 0);
      o.bodyRangeRefused = STATE.profile.bodyCur === b0 && STATE.profile.bodyGoal === g0b;

      /* THE BOOT REPAIRS. sex feeds Mifflin-St Jeor and every reader tests for
         'female', so ANY junk reads as male — measured at BMR 1793 against
         1627 and a target of 2280 against 2020 on one body. */
      STATE = JSON.parse(snap);
      const kc = v => { STATE.profile.sex = v; STATE.nutrition.sex = v;
        const q = kcalTargetPreview(); return q && q.target; };
      o.male = kc('male'); o.female = kc('female');
      o.sexMatters = o.male !== o.female;
      STATE.profile.sex = 'zzz'; STATE.nutrition.sex = 'zzz'; normalizeState();
      o.sexJunkGone = STATE.profile.sex === undefined && STATE.nutrition.sex === undefined;
      STATE.profile.sex = 'female'; STATE.nutrition.sex = 'female'; normalizeState();
      o.sexRealKept = STATE.profile.sex;

      /* focusPrimary was guarded by truthiness, so any other string survived —
         and focusBonus() looks it up in FOCUS_POOL, silently dropping the
         bonus the athlete chose. */
      STATE = JSON.parse(snap);
      const fpr = () => { const seen = {}; for (let p = 0; p < 42; p++) {
        const x = buildSession(p);
        [...x.main, x.finisher].filter(Boolean).forEach(m => seen[m.exId] = 1); }
        return Object.keys(seen).sort().join(','); };
      STATE.profile.focusPrimary = 'obliques'; const real = fpr();
      STATE.profile.focusPrimary = 'zzz';      const junk = fpr();
      o.focusJunkChangedProgram = real !== junk;      // guard: it really mattered
      normalizeState();
      o.focusRepairedTo = STATE.profile.focusPrimary;
      o.focusIsLegal = focusKeys().indexOf(STATE.profile.focusPrimary) >= 0;
      STATE.profile.focusPrimary = 'obliques'; normalizeState();
      o.focusRealKept = STATE.profile.focusPrimary;

      /* FOCUS_POOL is declared BELOW these helpers, so a const would be a
         temporal dead zone error that stops the page loading. Functions. */
      o.keysAreFunctions = typeof focusKeys === 'function' && typeof goalKeys === 'function';
      STATE = JSON.parse(snap); normalizeState(); save();
      console.error = realErr;
      return o;
    });
    t.eq('no writer puts a live node on any tab', wr.injected, [], wr);
    t.eq('floor: the goal is still settable', wr.goalSet, 'shred', wr);
    t.eq('floor: auto is still a legal persona', wr.personaAuto, 'auto', wr);
    t.ok('floor: and so is a real coach', !!wr.personaReal && wr.personaReal !== 'auto', wr);
    t.eq('floor: the body level is still settable', wr.bodySet, 3, wr);
    t.eq('floor: and the reminder time', wr.timeSet, '18:30', wr);
    t.ok('a goal outside the legal set is refused', wr.goalJunkRefused, wr);
    t.ok('and a persona that is not a coach', wr.personaJunkRefused, wr);
    t.ok('and a time that is not a time', wr.timeJunkRefused, wr);
    t.ok('and a swap to something that is not an exercise', wr.swapJunkRefused, wr);
    t.eq('no writer throws on hostile input', wr.threw, [], wr);
    t.ok('and junk in a body level is not stored either', wr.bodyJunkRefused, wr);
    t.ok('nor a level outside the five the app has', wr.bodyRangeRefused, wr);
    t.ok('guard: sex really does change the calorie target', wr.sexMatters,
      { male: wr.male, female: wr.female });
    t.ok('junk in sex is dropped, not read as male', wr.sexJunkGone, wr);
    t.eq('floor: a real sex survives the repair', wr.sexRealKept, 'female', wr);
    t.ok('guard: a junk focus really did change the program', wr.focusJunkChangedProgram, wr);
    t.ok('and the repair puts it back inside FOCUS_POOL', wr.focusIsLegal, wr);
    t.eq('floor: a real focus survives the repair', wr.focusRealKept, 'obliques', wr);
    t.ok('the key helpers are functions, not consts read before their source', wr.keysAreFunctions, wr);
  }

  /* ---- the container was checked and its MEMBERS were not (v354) ---------
     Three keyed sets carried a container check and nothing below it. A junk
     member changes no behaviour — measured, the built session is byte-identical
     — but the pickers all render from the REGISTRY and mark each key they find,
     so a stored key outside it is invisible and cannot be un-ticked, and it
     travels in every backup. */
  {
    const mm = await page.evaluate(() => {
      const o = {}; const realErr = console.error; console.error = () => {};
      const snap = JSON.stringify(STATE);
      STATE = JSON.parse(snap);
      STATE.profile.limitations = ['shoulder', 'zzz', '<img src=x>', 'knee'];
      STATE.profile.gear = ['bar', 'zzz', 'kettlebell', '<img src=x>'];
      nutToday().habits = { protein: true, zzz: true, '<img src=x>': true };
      const before = JSON.stringify(STATE).length;
      normalizeState();
      o.lim = STATE.profile.limitations.slice();
      o.gear = STATE.profile.gear.slice();
      o.habits = Object.keys(nutToday().habits);
      o.saved = before - JSON.stringify(STATE).length;
      /* guard: the junk really was inert, so this is about what a backup
         carries and what the athlete can reach — not about a broken session. */
      STATE = JSON.parse(snap); STATE.profile.limitations = ['shoulder'];
      const a = JSON.stringify(buildSession(12).main.map(m => m.exId));
      STATE.profile.limitations = ['shoulder', 'zzz'];
      o.junkWasInert = a === JSON.stringify(buildSession(12).main.map(m => m.exId));
      /* FLOOR: a repair that always wiped would satisfy every assertion above
         and silently clear a flagged joint, the athlete's kit and their ticks. */
      STATE = JSON.parse(snap);
      STATE.profile.limitations = ['shoulder', 'knee'];
      STATE.profile.gear = ['bar', 'kettlebell', 'bench'];
      nutToday().habits = { protein: true, water: false, sleep: true };
      normalizeState();
      o.limKept = STATE.profile.limitations.slice();
      o.gearKept = STATE.profile.gear.slice();
      o.habitsKept = Object.keys(nutToday().habits).sort();
      o.habitFalseKept = nutToday().habits.water === false;
      STATE = JSON.parse(snap); normalizeState(); save();
      console.error = realErr; return o;
    });
    t.ok('guard: a junk member really was inert in the program', mm.junkWasInert, mm);
    t.eq('a joint outside JOINTS does not survive a boot', mm.lim, ['shoulder', 'knee'], mm);
    t.eq('nor a gear key outside GEAR_KEYS', mm.gear, ['bar', 'kettlebell'], mm);
    t.eq('nor a habit key outside HABITS', mm.habits, ['protein'], mm);
    t.ok('and the backup gets smaller for it', mm.saved > 0, mm);
    t.eq('floor: every real flagged joint survives', mm.limKept, ['shoulder', 'knee'], mm);
    t.eq('floor: and every real piece of kit', mm.gearKept, ['bar', 'kettlebell', 'bench'], mm);
    t.eq('floor: and every real habit key', mm.habitsKept, ['protein', 'sleep', 'water'], mm);
    t.ok('floor: an UNticked habit is a value, not an absence', mm.habitFalseKept, mm);
  }

  /* ---- the goal sync had four siblings (v355) ------------------------------
     Age, height, sex and activity each live in BOTH profile and nutrition. The
     profile copies are what the wizard and editor SHOW; every calculation reads
     the nutrition copies. Both writers keep them in step, so nothing repaired a
     divergence — and importData() accepts arbitrary JSON. */
  {
    const sy = await page.evaluate(() => {
      const o = {}; const realErr = console.error; console.error = () => {};
      const base = () => {
        STATE.profile.sex = 'male';      STATE.nutrition.sex = 'male';
        STATE.profile.age = 52;          STATE.nutrition.age = 52;
        STATE.profile.heightCm = 178;    STATE.nutrition.heightCm = 178;
        STATE.profile.activity = 1.45;   STATE.nutrition.activity = 1.45;
        STATE.nutrition.weightKg = 86;   STATE.profile.goalWeightLb = 165;
      };
      const t = () => { const q = kcalTargetPreview(); return q && q.target; };
      base(); normalizeState();
      o.agreed = t();

      /* A DIVERGENCE: the editor shows one number, the calculation uses another.
         Each is pinned with the target it produces, because "they now match" is
         also true of a repair that overwrote BOTH with the wrong one. */
      o.diverge = {};
      [['age', 25], ['heightCm', 160], ['activity', 1.75], ['sex', 'female']].forEach(([f, v]) => {
        base(); STATE.profile[f] = v; normalizeState();
        o.diverge[f] = { shown: STATE.profile[f], used: STATE.nutrition[f], target: t() };
      });

      /* The nutrition copy ABSENT with the profile holding the answer.
         kcalTargetPreview() bails on !(n.sex && n.age && n.heightCm && n.weightKg),
         so "Calculate my targets" silently did nothing. */
      o.missing = {};
      [['age', 52], ['heightCm', 178], ['sex', 'male']].forEach(([f]) => {
        base(); delete STATE.nutrition[f]; normalizeState();
        o.missing[f] = { profile: STATE.profile[f], nutrition: STATE.nutrition[f], target: t() };
      });

      /* THE OTHER DIRECTION, which is what matters for an older backup: a value
         present only on the NUTRITION side is copied across, not dropped. */
      o.nutOnly = {};
      [['age', 44], ['heightCm', 165], ['sex', 'female'], ['activity', 1.2]].forEach(([f, v]) => {
        base(); delete STATE.profile[f]; STATE.nutrition[f] = v; normalizeState();
        o.nutOnly[f] = { profile: STATE.profile[f], nutrition: STATE.nutrition[f] };
      });

      /* FLOOR: absent on BOTH sides stays absent. There is no sensible default
         age, height or sex, and a repair that invents one is worse than a field
         the wizard can ask for again. */
      base();
      ['age', 'heightCm', 'sex'].forEach(f => { delete STATE.profile[f]; delete STATE.nutrition[f]; });
      normalizeState();
      o.bothAbsent = ['age', 'heightCm', 'sex'].map(f =>
        (STATE.profile[f] === undefined && STATE.nutrition[f] === undefined) ? f + ':absent' : f + ':INVENTED');

      /* FLOOR: an athlete whose copies already agree is untouched. */
      base(); normalizeState();
      o.untouched = [STATE.profile.age, STATE.nutrition.age, STATE.profile.sex,
                     STATE.nutrition.sex, STATE.profile.heightCm, STATE.nutrition.activity];

      /* And the editor really does render the profile copy — which is what makes
         a divergence visible rather than merely stored. */
      /* Through the BOOT path, which is where the mirror lives and the only
         route a divergence can arrive by — both writers write both copies, so
         only an import creates one, and importData() calls normalizeState(). */
      base(); STATE.profile.age = 25; normalizeState(); go('today'); render();
      try { openProfileEdit(); } catch (e) {}
      const el = document.querySelector('#ob-age');
      o.editorShows = el ? el.value : '(no field)';
      o.editorAgrees = el ? (+el.value === STATE.nutrition.age) : false;
      try { closeSheet(); } catch (e) {}
      base(); normalizeState(); save(); console.error = realErr;
      return o;
    });
    t.ok('guard: a body with both copies agreeing gets a real target', sy.agreed > 1200, sy);
    ['age', 'heightCm', 'activity', 'sex'].forEach(f => {
      t.eq('the two copies of ' + f + ' cannot disagree after a boot',
        sy.diverge[f].shown, sy.diverge[f].used, sy.diverge[f]);
    });
    /* Pinned VALUES, not just agreement: a repair that overwrote both with the
       stale number would satisfy every "they match" assertion. */
    t.eq('and the profile copy is the one that wins', sy.diverge.age.shown, 25, sy.diverge.age);
    t.ok('so the target really moves with it', sy.diverge.age.target > sy.agreed, sy.diverge.age);
    t.ok('a shorter athlete gets a smaller target', sy.diverge.heightCm.target < sy.agreed, sy.diverge.heightCm);
    t.ok('a more active one a bigger target', sy.diverge.activity.target > sy.agreed, sy.diverge.activity);
    t.ok('and a woman is not priced as a man', sy.diverge.sex.target < sy.agreed, sy.diverge.sex);
    ['age', 'heightCm', 'sex'].forEach(f => {
      t.eq('a missing nutrition ' + f + ' is filled from the profile',
        sy.missing[f].nutrition, sy.missing[f].profile, sy.missing[f]);
    });
    t.ok('so the calorie target stops silently returning nothing',
      sy.missing.age.target > 1200 && sy.missing.heightCm.target > 1200 && sy.missing.sex.target > 1200, sy.missing);
    ['age', 'heightCm', 'sex', 'activity'].forEach(f => {
      t.eq('an older backup carrying only the nutrition ' + f + ' keeps it',
        sy.nutOnly[f].profile, sy.nutOnly[f].nutrition, sy.nutOnly[f]);
    });
    t.eq('floor: absent on both sides stays absent', sy.bothAbsent,
      ['age:absent', 'heightCm:absent', 'sex:absent'], sy.bothAbsent);
    t.eq('floor: copies that already agree are untouched', sy.untouched,
      [52, 52, 'male', 'male', 178, 1.45], sy.untouched);
    t.eq('the editor renders the profile copy', sy.editorShows, '25', sy);
    t.ok('and it now names the number the calculation uses', sy.editorAgrees, sy);
  }

  /* ---- clearance is a tap, not a truthy value (v355) -----------------------
     `medCleared()` was `!!STATE.profile.medCleared` — a bare truthiness read on
     a raw stored flag, which is the defect this repo's notes OPEN with, on the
     sibling flag. parqDone() was fixed to require the answers behind it;
     medCleared() is the other half of the same gate and never was. */
  {
    const cl = await page.evaluate(() => {
      const o = {}; const realErr = console.error; console.error = () => {};
      const snap = JSON.stringify(STATE);
      const flag = (Array.isArray(PARQ) ? [PARQ[0][0] || PARQ[0].k || PARQ[0]] : ['heart']);
      o.flag = flag;
      const boot = v => {
        STATE = JSON.parse(snap);
        STATE.profile.parq = flag.slice();      // a REAL declared condition
        STATE.profile.parqDone = true;
        STATE.profile.medCleared = v;
        normalizeState();
        return { stored: STATE.profile.medCleared, cleared: medCleared(),
                 flagged: parqFlagged(), safe: safeMode() };
      };
      /* The string 'false' is the one a hand-edited or foreign export really
         produces, and it is truthy — so it leads the list rather than sitting
         in it. */
      o.junk = {};
      ['false', 'x', 1, {}, [], -1, [0], 'true'].forEach((v, i) => { o.junk['j' + i] = boot(v); });
      o.real = boot(true);
      o.declined = boot(false);

      /* What safe mode is FOR: it must actually change the prescription, or the
         whole gate is decoration. Measured on the same pointer. */
      const sess = () => JSON.stringify(buildSession(40).main.map(m => m.exId + ':' + m.sets + 'x' + m.target));
      boot(true);  const clearedSession = sess();
      boot('x');   const junkSession = sess();
      boot(false); const guardedSession = sess();
      o.guardBites = clearedSession !== guardedSession;   // guard: it does something
      o.junkIsGuarded = junkSession === guardedSession;
      o.clearedIsNot  = junkSession !== clearedSession;

      /* FLOOR: a genuine clearance still works, through the button the athlete
         actually taps — not by assigning the field. */
      STATE = JSON.parse(snap);
      STATE.profile.parq = flag.slice(); STATE.profile.parqDone = true;
      STATE.profile.medCleared = false; normalizeState();
      try { confirmClearance(); } catch (e) { o.confirmErr = String(e.message).slice(0, 60); }
      normalizeState();
      o.afterConfirm = { stored: STATE.profile.medCleared, cleared: medCleared(), safe: safeMode() };

      /* FLOOR: an athlete with NO declared condition is not put into safe mode
         by any of this — an over-eager fix that refused every clearance would
         satisfy every assertion above. */
      STATE = JSON.parse(snap);
      STATE.profile.parq = []; STATE.profile.parqDone = true;
      STATE.profile.medCleared = false; normalizeState();
      o.noCondition = { flagged: parqFlagged(), safe: safeMode() };

      /* THE READ SITE HAS ITS OWN CONTRACT, and every check above boots first —
         so the repair scrubs the junk and medCleared() never sees any. Two
         guards mean two checks: call it with junk in STATE and NO boot, which
         is the state a future writer or a render before normalizeState() would
         leave. A guard consulted only behind another guard still has to mean
         what it is named. */
      o.rawRead = {};
      ['false', 'x', 1, {}, [], -1, [0], 'true'].forEach((v, i) => {
        STATE = JSON.parse(snap);
        STATE.profile.parq = flag.slice(); STATE.profile.parqDone = true;
        STATE.profile.medCleared = v;                 // deliberately NOT booted
        o.rawRead['r' + i] = { cleared: medCleared(), safe: safeMode() };
      });
      STATE = JSON.parse(snap);
      STATE.profile.parq = flag.slice(); STATE.profile.parqDone = true;
      STATE.profile.medCleared = true;                // the real thing, unbooted
      o.rawRealCleared = medCleared();

      /* And the junk does not travel: both flags are booleans after a boot. */
      boot({});
      o.types = [typeof STATE.profile.medCleared, typeof STATE.profile.parqDone];
      STATE = JSON.parse(snap); normalizeState(); save(); console.error = realErr;
      return o;
    });
    t.ok('guard: safe mode really changes what is prescribed', cl.guardBites, cl);
    Object.keys(cl.junk).forEach(k => {
      t.eq('junk in the clearance flag does not clear it (' + k + ')', cl.junk[k].cleared, false, cl.junk[k]);
      t.ok('so a declared condition keeps safe mode on (' + k + ')', cl.junk[k].safe === true, cl.junk[k]);
      t.eq('and the junk does not survive the boot (' + k + ')', cl.junk[k].stored, false, cl.junk[k]);
    });
    t.ok('and the guarded session is what a junk-flagged athlete gets', cl.junkIsGuarded, cl);
    t.ok('guard: a genuinely cleared athlete gets a different one', cl.clearedIsNot, cl);
    t.eq('floor: a real boolean true still clears', cl.real.cleared, true, cl.real);
    t.eq('floor: and turns safe mode off', cl.real.safe, false, cl.real);
    t.eq('floor: tapping the confirm button still clears', cl.afterConfirm.cleared, true, cl.afterConfirm);
    t.eq('floor: and it survives the boot', cl.afterConfirm.stored, true, cl.afterConfirm);
    t.eq('floor: an athlete with no declared condition is not flagged', cl.noCondition.flagged, false, cl.noCondition);
    t.eq('floor: and is not in safe mode', cl.noCondition.safe, false, cl.noCondition);
    Object.keys(cl.rawRead).forEach(k => {
      t.eq('medCleared() itself refuses junk with no boot behind it (' + k + ')',
        cl.rawRead[k].cleared, false, cl.rawRead[k]);
      t.eq('so safe mode stays on (' + k + ')', cl.rawRead[k].safe, true, cl.rawRead[k]);
    });
    t.eq('floor: and it still accepts a real true with no boot', cl.rawRealCleared, true, cl);
    t.eq('both health flags are booleans after a boot', cl.types, ['boolean', 'boolean'], cl.types);
  }

  /* ---- a week bucket built from millisecond arithmetic (v356) --------------
     `Math.floor(((d - Jan1) / 86400000 + Jan1.getDay()) / 7)` is neither
     DST-safe nor year-safe, and this file already had the right algorithm in
     it. Written to hold in ANY timezone: the year-boundary case is about the
     calendar rollover, not the clock. */
  {
    const wk = await page.evaluate(() => {
      const o = {}; const realErr = console.error; console.error = () => {};
      const run = (start, n) => { const out = []; const d0 = new Date(start + 'T00:00:00');
        for (let i = 0; i < n; i++) { const d = new Date(d0); d.setDate(d0.getDate() + i); out.push(localISO(d)); }
        return out; };
      /* guard: 30 Dec 2024 really is a Monday, so this span really is one
         Monday-Sunday week — otherwise the case proves nothing. */
      o.startsMonday = new Date('2024-12-30T00:00:00').getDay() === 1;
      o.ordinaryStartsMonday = new Date('2025-06-02T00:00:00').getDay() === 1;

      /* THE PAYLOAD, not the key: 15 minutes on each of seven days is 105, and
         bestSkipWeek() reported 60 across the year boundary. Drive the real
         reader, not _weekKeyOf directly. */
      const best = dates => {
        STATE.skipLog = dates.map(d => ({ date: d, mins: 15 }));
        return bestSkipWeek();
      };
      o.newYear = best(run('2024-12-30', 7));
      o.ordinary = best(run('2025-06-02', 7));
      /* FLOOR: a bucket must not swallow MORE than a week either — eight days
         of work is not "in one week". */
      o.eightDays = best(run('2024-12-30', 8));
      o.ordinaryEight = best(run('2025-06-02', 8));

      /* Every bucket spans exactly seven days, across three whole calendar
         years — the property the old arithmetic broke in both directions. */
      const days = [];
      for (let y = 2024; y <= 2026; y++) for (let m = 0; m < 12; m++) for (let d = 1; d <= 31; d++) {
        const dt = new Date(y, m, d); if (dt.getMonth() !== m) continue; days.push(localISO(dt));
      }
      o.daysWalked = days.length;
      const by = {}; days.forEach(d => { const k = _weekKeyOf(d); (by[k] = by[k] || []).push(d); });
      o.oversized = Object.keys(by).filter(k => by[k].length > 7).map(k => k + ':' + by[k].length);
      /* and a seven-day window never spans more than two buckets */
      let over2 = 0;
      for (let i = 0; i + 6 < days.length; i++) {
        if (new Set(days.slice(i, i + 7).map(_weekKeyOf)).size > 2) over2++;
      }
      o.windowsOverTwo = over2;
      /* weekKey() is the same bucket for today — one algorithm, not two. */
      o.todayAgrees = weekKey() === _weekKeyOf(localISO(new Date()));
      /* and a date it cannot parse still comes back as itself rather than NaN */
      o.junkKey = _weekKeyOf('not-a-date');
      STATE.skipLog = []; save(); console.error = realErr; return o;
    });
    t.ok('guard: the New Year span really starts on a Monday', wk.startsMonday, wk);
    t.ok('guard: and so does the ordinary week beside it', wk.ordinaryStartsMonday, wk);
    t.eq('a real week straddling New Year counts every day of it', wk.newYear, 105, wk);
    t.eq('floor: an ordinary week is unchanged', wk.ordinary, 105, wk);
    t.eq('floor: eight days is not one week, at the year boundary', wk.eightDays, 105, wk);
    t.eq('floor: nor in an ordinary month', wk.ordinaryEight, 105, wk);
    t.ok('guard: three whole years really were walked', wk.daysWalked > 1090, wk);
    t.eq('no bucket holds more than seven days', wk.oversized, [], wk);
    t.eq('and no seven-day window spans more than two buckets', wk.windowsOverTwo, 0, wk);
    t.ok('weekKey() is the same bucket, not a second copy of the arithmetic', wk.todayAgrees, wk);
    t.eq('an unparseable date still comes back as itself', wk.junkKey, 'not-a-date', wk);
  }

  /* ---- a row with no usable date is not a record (v356) --------------------
     The four activity logs repaired `mins` and never looked at `date`, while
     the liftLog repair forty lines up already required one. One instance
     guarded, four siblings not. */
  {
    const dl = await page.evaluate(() => {
      const o = {}; const realErr = console.error; console.error = () => {};
      const snap = JSON.stringify(STATE);

      /* THE PAYLOAD, not the row count: _weekKeyOf returns the raw string when
         it cannot parse, so a junk-dated row forms its OWN week bucket and can
         BEAT a real week. */
      STATE.skipLog = [{ date: 'not-a-date', mins: 30 }, { date: null, mins: 40 },
                       { date: '2025-06-02', mins: 20 }];
      const before = bestSkipWeek();
      normalizeState();
      o.junkBeatRealBefore = before;
      o.afterRepair = bestSkipWeek();
      o.rowsLeft = STATE.skipLog.map(r => r.date);

      /* FLOOR: a real row is untouched, and its minutes still count. */
      STATE = JSON.parse(snap);
      STATE.skipLog = [{ date: '2025-06-02', mins: 30 }, { date: '2025-06-03', mins: 25 }];
      normalizeState();
      o.realKept = STATE.skipLog.length;
      o.realWeek = bestSkipWeek();

      /* The same repair on all four logs, not just the one the probe touched. */
      STATE = JSON.parse(snap);
      ['skipLog', 'ruckLog', 'gripLog', 'boxLog'].forEach(k => {
        STATE[k] = [{ date: 'nope', mins: 10 }, { date: '2025-06-02', mins: 10 }];
      });
      normalizeState();
      o.perLog = {}; ['skipLog', 'ruckLog', 'gripLog', 'boxLog'].forEach(k => {
        o.perLog[k] = (STATE[k] || []).map(r => r.date);
      });

      /* And liftLog, whose own test was `typeof === 'string'` — which
         'not-a-date' passes. */
      STATE = JSON.parse(snap);
      STATE.liftLog = [{ date: 'not-a-date', exId: 'kbgoblet', loadKg: 20, reps: 8 },
                       { date: '2025-06-02', exId: 'kbgoblet', loadKg: 20, reps: 8 }];
      normalizeState();
      o.liftLeft = (STATE.liftLog || []).map(r => r.date);

      /* The predicate's own contract: shape AND parse. '2025-13-45' matches the
         pattern and is not a day. */
      o.pred = {
        good: isDateISO('2025-06-02'),
        notADate: isDateISO('not-a-date'),
        month13: isDateISO('2025-13-01'),
        day45: isDateISO('2025-06-45'),
        feb30: isDateISO('2025-02-30'),
        leapReal: isDateISO('2024-02-29'),
        leapFake: isDateISO('2025-02-29'),
        nullish: isDateISO(null),
        number: isDateISO(20250602),
        short: isDateISO('2025-6-2'),
      };
      STATE = JSON.parse(snap); normalizeState(); save(); console.error = realErr; return o;
    });
    t.eq('guard: a junk-dated row really did beat a real week', dl.junkBeatRealBefore, 40, dl);
    t.eq('after the repair the real week wins', dl.afterRepair, 20, dl);
    t.eq('and only the dated row survives', dl.rowsLeft, ['2025-06-02'], dl);
    t.eq('floor: two real rows are both kept', dl.realKept, 2, dl);
    t.eq('floor: and their week still totals', dl.realWeek, 55, dl);
    ['skipLog', 'ruckLog', 'gripLog', 'boxLog'].forEach(k => {
      t.eq('the same repair reaches ' + k, dl.perLog[k], ['2025-06-02'], dl.perLog);
    });
    t.eq('and liftLog, whose test a junk string passed', dl.liftLeft, ['2025-06-02'], dl);
    t.ok('floor: a real date is a date', dl.pred.good, dl.pred);
    t.ok('floor: and a real leap day is a date', dl.pred.leapReal, dl.pred);
    ['notADate', 'month13', 'day45', 'feb30', 'leapFake', 'nullish', 'number', 'short']
      .forEach(k => t.eq('isDateISO refuses ' + k, dl.pred[k], false, dl.pred));
  }

  /* ---- the level before the baseline was whatever was stored (v357) --------
     levelOf()'s pre-baseline branch returned `profile.experience` RAW, and the
     field had no repair at all. LEVEL_FACTOR[level]||1 and LEVEL_TIER[lv]??1
     both fall back to the INTERMEDIATE value, so an out-of-set string is
     silently promoted a tier — on the one path a brand-new athlete lives on
     until they take the baseline. */
  {
    const lv = await page.evaluate(() => {
      const o = {}; const realErr = console.error; console.error = () => {};
      const snap = JSON.stringify(STATE);
      o.legal = LEVEL_NAME.slice();
      o.factorKeys = Object.keys(LEVEL_FACTOR).sort();
      /* guard: the three tables really do describe the same three tiers, or
         everything below is asserting against a moving target. */
      o.tablesAgree = JSON.stringify(o.factorKeys) === JSON.stringify(LEVEL_NAME.slice().sort())
        && JSON.stringify(Object.keys(LEVEL_TIER).sort()) === JSON.stringify(LEVEL_NAME.slice().sort());

      const at = exp => {
        STATE = JSON.parse(snap);
        delete STATE.baseline; STATE.reassess = {};
        STATE.profile.experience = exp;
        normalizeState();
        const level = levelOf(0);
        return { stored: STATE.profile.experience, level,
                 factor: LEVEL_FACTOR[level], tier: LEVEL_TIER[level],
                 prog: JSON.stringify(buildSession(3).main.map(m => m.exId + ':' + m.target)) };
      };
      o.rows = {};
      ['Beginner', 'Intermediate', 'Advanced', 'beginner', 'ADVANCED', 'expert', 'zzz', '', null, 42, {}, []]
        .forEach(v => { o.rows[JSON.stringify(v)] = at(v); });

      /* THE READ SITE HAS ITS OWN CONTRACT. Every case above boots first, so
         the repair scrubs the junk and levelOf() never sees any — reverting it
         to the raw return escaped all of them. Two guards mean two checks:
         call it with junk in STATE and NO boot behind it, which is what a
         render before normalizeState(), or a future writer, would leave. */
      o.raw = {};
      ['beginner', 'expert', 'zzz', 42, {}].forEach(v => {
        STATE = JSON.parse(snap);
        delete STATE.baseline; STATE.reassess = {};
        STATE.profile.experience = v;          // deliberately NOT booted
        const level = levelOf(0);
        o.raw[JSON.stringify(v)] = { level, factor: LEVEL_FACTOR[level], tier: LEVEL_TIER[level] };
      });
      STATE = JSON.parse(snap);
      delete STATE.baseline; STATE.reassess = {};
      STATE.profile.experience = 'Advanced';   // the real thing, unbooted
      o.rawRealAdvanced = levelOf(0);
      STATE = JSON.parse(snap); normalizeState(); save(); console.error = realErr; return o;
    });
    t.ok('guard: LEVEL_NAME, LEVEL_TIER and LEVEL_FACTOR describe the same three tiers',
      lv.tablesAgree, { legal: lv.legal, factorKeys: lv.factorKeys });

    /* FLOOR FIRST: every level the wizard really offers survives untouched and
       keeps its own factor. A repair that flattened everything to Beginner
       satisfies every "junk is refused" assertion and breaks the app. */
    ['Beginner', 'Intermediate', 'Advanced'].forEach(n => {
      const r = lv.rows[JSON.stringify(n)];
      t.eq('floor: ' + n + ' survives the boot', r.stored, n, r);
      t.eq('floor: and is the level used', r.level, n, r);
      t.ok('floor: with its own factor', typeof r.factor === 'number', r);
    });
    t.ok('guard: the three tiers really do prescribe differently',
      new Set(['Beginner', 'Intermediate', 'Advanced'].map(n => lv.rows[JSON.stringify(n)].prog)).size === 3,
      { b: lv.rows['"Beginner"'].prog, i: lv.rows['"Intermediate"'].prog, a: lv.rows['"Advanced"'].prog });

    /* And nothing outside the set reaches the prescription. A lowercase
       'beginner' from an imported backup was the real case: factor 1.0 and
       intermediate ladder rungs for someone who said they were a novice. */
    ['beginner', 'ADVANCED', 'expert', 'zzz', '', null, 42, {}, []].forEach(v => {
      const r = lv.rows[JSON.stringify(v)];
      t.eq('an out-of-set experience does not survive the boot (' + JSON.stringify(v) + ')',
        r.stored, 'Beginner', r);
      t.eq('nor reach levelOf() (' + JSON.stringify(v) + ')', r.level, 'Beginner', r);
      t.eq('so the factor is the beginner one, not the middle (' + JSON.stringify(v) + ')',
        r.factor, lv.rows['"Beginner"'].factor, r);
    });
    /* the DISCRIMINATING one: junk must land on Beginner, NOT on the tier the
       ||1 fallback used to give it. */
    Object.keys(lv.raw).forEach(k => {
      t.eq('levelOf() itself refuses junk with no boot behind it (' + k + ')',
        lv.raw[k].level, 'Beginner', lv.raw[k]);
      t.eq('so the factor is never the middle one (' + k + ')',
        lv.raw[k].factor, lv.rows['"Beginner"'].factor, lv.raw[k]);
      t.eq('nor the middle ladder tier (' + k + ')', lv.raw[k].tier, 0, lv.raw[k]);
    });
    t.eq('floor: and it still returns a real level unbooted', lv.rawRealAdvanced, 'Advanced', lv);
    t.ok('junk is not silently promoted to the intermediate tier',
      lv.rows['"beginner"'].prog === lv.rows['"Beginner"'].prog
      && lv.rows['"beginner"'].prog !== lv.rows['"Intermediate"'].prog,
      { junk: lv.rows['"beginner"'].prog, beginner: lv.rows['"Beginner"'].prog,
        intermediate: lv.rows['"Intermediate"'].prog });
  }

  /* ---- SHARPEN rehearses the test, and adds nothing (v358) -----------------
     The prep block scheduled running and rucking and the daily program never
     knew a test was coming: measured, an athlete four weeks out in the SHARPEN
     phase got a byte-identical session to one with no test date at all, on
     either path — while a WEIGHT deadline does raise conditioning a notch.

     The fix moves EMPHASIS AND NOT VOLUME, because the prep block already adds
     up to 20 km of running and 9 km of rucking a week and piling conditioning
     on top is the injury the 10% rule exists to prevent. Exactly one slot
     changes: the finisher, which is already a single all-out cardio round. */
  {
    const sh = await page.evaluate(() => {
      const o = {}; const realErr = console.error; console.error = () => {};
      const snap = JSON.stringify(STATE);
      const iso = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10); };
      const FULL = ['ruck', 'sandbag', 'bar', 'bench', 'kettlebell', 'dumbbell'];
      const setup = (weeksOut, gear, lims) => {
        STATE = JSON.parse(snap);
        STATE.nutrition.weightKg = 86; STATE.profile.sex = 'male';
        STATE.profile.age = 41; STATE.profile.heightCm = 178;
        STATE.profile.gear = gear.slice(); STATE.profile.limitations = lims.slice();
        STATE.profile.tightSpace = false;
        if (weeksOut === null) delete STATE.prep;
        else STATE.prep = { date: iso(weeksOut * 7), path: 'operator', planFrom: iso(-(16 - weeksOut) * 7) };
        normalizeState();
      };
      const scan = () => {
        const fins = {}; const units = {}; let slots = 0, total = 0;
        for (let p = 0; p < 378; p += 5) {
          const s = buildSession(p);
          total += s.main.length + (s.finisher ? 1 : 0);
          if (s.finisher) {
            slots++; fins[s.finisher.exId] = (fins[s.finisher.exId] || 0) + 1;
            /* PER POINTER, so the swap can be compared against the movement it
               actually replaced. Asserting only that a unit EXISTS is measuring
               the container: every exercise has one. */
            units[p] = (EX[s.finisher.exId] || {}).unit;
          }
        }
        return { fins, slots, total, units };
      };
      setup(null, FULL, []);  o.noDate = scan();
      setup(16, FULL, []);    o.base = scan();    o.basePhase = prepPhase();
      setup(4, FULL, []);     o.sharpen = scan(); o.sharpenPhase = prepPhase();
      setup(1, FULL, []);     o.taper = scan();   o.taperPhase = prepPhase();
      setup(4, [], []);       o.noKit = scan();
      setup(4, FULL, ['knee', 'shoulder', 'wrist', 'lowback']); o.flagged = scan();
      /* A flagged athlete gets correctiveBonus() ADDED ON TOP (v227), so their
         slot count is legitimately higher. Compare them with themselves. */
      setup(null, FULL, ['knee', 'shoulder', 'wrist', 'lowback']); o.flaggedNoDate = scan();
      o.pool = PREP_SHARPEN_POOL.slice();
      o.riskyFlagged = Object.keys(o.flagged.fins).filter(k => jointRisky(k, ['knee', 'shoulder', 'wrist', 'lowback']));
      o.gearedNoKit = Object.keys(o.noKit.fins).filter(k => (EX[k].equip || []).length);
      o.rehearsals = Object.keys(o.sharpen.fins).filter(k => PREP_SHARPEN_POOL.includes(k));
      /* The swap must keep the finisher's UNIT, pointer by pointer — a timed
         all-out round must not become a rep count. */
      o.unitChanged = Object.keys(o.noDate.units)
        .filter(p => o.sharpen.units[p] !== o.noDate.units[p])
        .slice(0, 6).map(p => p + ': ' + o.noDate.units[p] + ' -> ' + o.sharpen.units[p]);
      o.unitChangedNoKit = Object.keys(o.noDate.units)
        .filter(p => o.noKit.units[p] !== o.noDate.units[p]).length;
      STATE = JSON.parse(snap); normalizeState(); save(); console.error = realErr; return o;
    });
    t.eq('guard: 16 weeks out really is the base phase', sh.basePhase, 'base', sh);
    t.eq('guard: 4 weeks out really is the sharpen phase', sh.sharpenPhase, 'sharpen', sh);
    t.eq('guard: 1 week out really is the taper', sh.taperPhase, 'taper', sh);

    /* THE VOLUME FLOOR, first and hardest: not one extra slot, anywhere. */
    [['base', sh.base, sh.noDate], ['sharpen', sh.sharpen, sh.noDate], ['taper', sh.taper, sh.noDate],
     ['no kit', sh.noKit, sh.noDate], ['flagged', sh.flagged, sh.flaggedNoDate]].forEach(([n, r, ref]) => {
      t.eq('no slot is added in ' + n, r.total, ref.total, { got: r.total, ref: ref.total });
      t.eq('and the finisher count is unchanged in ' + n, r.slots, ref.slots, { got: r.slots, ref: ref.slots });
    });

    /* Only SHARPEN changes anything. */
    t.eq('the base phase is byte-identical to having no test date',
      JSON.stringify(sh.base.fins), JSON.stringify(sh.noDate.fins), sh.base.fins);
    t.eq('and so is the taper',
      JSON.stringify(sh.taper.fins), JSON.stringify(sh.noDate.fins), sh.taper.fins);
    t.ok('the sharpen phase does change the finishers',
      JSON.stringify(sh.sharpen.fins) !== JSON.stringify(sh.noDate.fins), sh.sharpen.fins);
    t.ok('and what it changes them to rehearses the test', sh.rehearsals.length >= 3, sh.rehearsals);

    /* Every question the sibling paths ask, asked here too. */
    t.eq('a flagged athlete is never handed a risky rehearsal', sh.riskyFlagged, [], sh.flagged.fins);
    t.eq('an athlete with no sandbag is never handed one', sh.gearedNoKit, [], sh.noKit.fins);
    t.ok('but a bagless athlete still rehearses what needs no kit',
      Object.keys(sh.noKit.fins).some(k => k === 'rushes' || k === 'latshuffle'), sh.noKit.fins);
    t.eq('the swap keeps the finisher\'s own unit, pointer by pointer', sh.unitChanged, [], sh.unitChanged);
    t.eq('and with no kit too', sh.unitChangedNoKit, 0, sh);
    t.ok('every pool member is a real exercise', sh.pool.every(k => !!k) && sh.pool.length > 0, sh.pool);
  }

  /* ---- THE HARD PART, NAMED (v359) ------------------------------------
     Measured across the corpus before this: 190 `push` lines over 38 coaches
     and exactly TWO name what the effort feels like. The rest are exhortation.
     The checks below pin four things the fix rests on — the line lands in the
     last THIRD (not at a fixed ten seconds), it lands once, it never shares a
     second with another utterance, and the surfaces that should stay silent
     do. Each has its floor beside it, because "say it everywhere" and "say it
     nowhere" both satisfy half the block. */
  {
    const G = /hard part|Burning muscles|Shaking here|honest part|Fatigue now|last third|does not get easier/;
    const g = await page.evaluate(async (Gsrc) => {
      const G = new RegExp(Gsrc);
      const o = {};
      const flush = () => new Promise(r => setTimeout(r, 4));
      /* EACH BLOCK BUILDS THE STATE IT ASSERTS ON. An earlier block in this
         suite leaves STATE.baseline null, and estimateMaxes() then hands
         back DEFAULTS — so the open-hold half of this block was measuring
         an athlete who had never tested, with a plank max of 40. */
      const _baseKeep = STATE.baseline;
      STATE.baseline = { date: todayISO(), score: 70, level: 'Advanced', testCount: TESTS.length,
        maxes: { plank: 150, side: 95, hollow: 70, lower: 30, dyn: 55, push: 48, pull: 22, squat: 62, power: 20, stamina: 24 } };

      // --- the pool, and the arithmetic that places it
      o.lines = GRIND_LINES.length;
      o.min = GRIND_MIN_S;
      o.at = {}; [20, 30, 35, 36, 40, 50, 60, 95, 150].forEach(t => o.at[t] = grindAt(t));
      /* THE MARKER MUST NEVER BE ADJACENT. _deviceSpeak() cancels, so a line
         placed at remain 11 is cut mid-word by the ten-second marker itself. */
      o.minRemain = 999; o.adjacent = [];
      for (let t = 1; t <= 200; t++) {
        const x = grindAt(t); if (x < 0) continue;
        o.minRemain = Math.min(o.minRemain, t - x);
        if ((t - x) <= 11) o.adjacent.push(t);
      }
      // hype off means silence, the same contract motivateLine() carries
      const hb = STATE.settings.hype; STATE.settings.hype = false;
      o.hypeOff = grindLine(); STATE.settings.hype = hb;
      const vb = STATE.settings.voice; STATE.settings.voice = false;
      o.voiceOff = grindLine(); STATE.settings.voice = vb;
      o.hypeOn = grindLine();

      // --- the guided player's hold, driven second by second
      const drivePl = async (total) => {
        const said = []; const real = window.coachSpeak; let cur = 0;
        window.coachSpeak = t => said.push([cur, String(t)]);
        PLAYER = { phase: 'work', remain: total, total: total, s: 0, i: 0,
          items: [{ exId: 'plank', unit: 'time', target: total, sets: 1 }],
          cues: ['Brace.'], cueIdx: 0, grindSaid: false, running: true };
        for (let k = 0; k < total - 1; k++) {
          cur = total - PLAYER.remain + 1;
          try { plTickHold(); } catch (e) { break; }
          await flush();
          if (!PLAYER || PLAYER.phase !== 'work') break;
        }
        window.coachSpeak = real;
        const hits = said.filter(x => G.test(x[1]));
        /* AN UTTERANCE TAKES ~1.5s, so nothing else may sit within a second of
           it — otherwise the acknowledgement is cut by a form cue. */
        const clash = hits.length ? said.filter(x => !G.test(x[1]) && Math.abs(x[0] - hits[0][0]) <= 1) : [];
        return { n: hits.length, at: hits.map(x => x[0]), clash: clash.length, total: said.length };
      };
      o.p50 = await drivePl(50);
      o.p95 = await drivePl(95);
      o.p36 = await drivePl(36);
      o.p20 = await drivePl(20);   // floor: no last third worth naming
      o.p35 = await drivePl(35);   // floor: one second under the gate

      // --- HIIT: work has a hard part, rest does not
      const driveIv = async (secs, type) => {
        const said = []; const real = window.coachSpeak; let cur = 0;
        window.coachSpeak = t => said.push([cur, String(t)]);
        INTV = { i: 0, seq: [{ type: type, secs: secs, exId: 'burpee' }], phase: type,
          remain: secs, total: secs, grindSaid: false, running: false, workElapsed: 0, deadline: 0 };
        for (let k = 0; k < secs - 1; k++) {
          cur = secs - INTV.remain + 1;
          try { ivTick(); } catch (e) { break; }
          await flush();
          if (!INTV || INTV.remain <= 0) break;
        }
        window.coachSpeak = real;
        return said.filter(x => G.test(x[1])).map(x => x[0]);
      };
      o.ivWork = await driveIv(45, 'work');
      o.ivRest = await driveIv(45, 'rest');
      o.ivShort = await driveIv(20, 'work');

      // --- the baseline battery's OPEN hold: the point is the athlete's own max
      o.maxPlank = (currentMaxes() || {}).plank;
      o.openAt = grindAtOpen('plank');
      /* A LEANER ATHLETE'S HARD PART ARRIVES SOONER. A fixed constant cannot
         express that at all, which is the whole argument for reading the max. */
      const mb = STATE.baseline;
      try {
        STATE.baseline = JSON.parse(JSON.stringify(mb));
        STATE.baseline.maxes.plank = 60;
        o.openAtWeak = grindAtOpen('plank');
      } catch (e) { o.openAtWeak = -1; }
      /* AND ITS OWN FLOOR, WHICH ONLY A SMALL MAX CAN REACH. Both cases
         above sit far above it, so a mutant deleting `at>=12` was invisible
         — a guard that cannot fire in the case you tested is not tested. */
      try {
        STATE.baseline = JSON.parse(JSON.stringify(mb));
        STATE.baseline.maxes.plank = 15;
        o.openAtTiny = grindAtOpen('plank');
      } catch (e) { o.openAtTiny = 'ERR'; }
      STATE.baseline = mb;

      const runBaseline = async (testId, setAt) => {
        assessState = { idx: TESTS.map(t => t.id).indexOf(testId), results: {} };
        const said = []; const real = window.coachSpeak;
        window.coachSpeak = t => said.push(String(t));
        startBaselineTimer();
        await new Promise(r => setTimeout(r, 60));
        _bt.mode = 'run'; _bt.grindSaid = false; _bt.elapsed = setAt - 1;
        await new Promise(r => setTimeout(r, 1150));
        stopBaselineTimer(); closeSheet();
        window.coachSpeak = real;
        return said.filter(x => G.test(x)).length;
      };
      o.openHit = await runBaseline('plank', o.openAt);
      o.openEarly = await runBaseline('plank', o.openAt - 20);
      // --- the warm-up flow is deliberately silent: a stretch is not a grind
      o.flowSilent = !/grindLine|grindAt/.test(String(runFlow));
      /* THE NEIGHBOUR GUARD, AS A CLASS. Every surface with a PERIODIC cue
         has to yield the second either side of the grind line, or the cue
         cancels it mid-word. The guided player is driven above; the other
         two need a 36-second effort to reach and cannot be, so their guard
         is read off the source — the same call foodScreenshot()'s wiring
         gets. Match the EXPRESSION, not the name: `nearGrind` appearing
         anywhere in the function would pass on the grind line alone. */
      o.yield = {
        player: /el%8===0&&PLAYER\.remain>5&&!nearGrind\(el,PLAYER\.total\)/.test(String(plTickHold)),
        timer: /el%10===0&&remain>4&&!nearGrind\(el,total\)/.test(String(runTimer)),
        baseFixed: /_bt\.elapsed%10===0&&left>4&&!nearGrind\(_bt\.elapsed,dur\)/.test(String(startBaselineTimer)),
        baseOpen: /_bt\.elapsed%10===0&&!nearGrindOpen\(_bt\.elapsed,_bt\.tid\)/.test(String(startBaselineTimer))
      };
      // --- and every surface that SHOULD have it, does
      o.wired = {
        player: /grindAt\(/.test(String(plTickHold)),
        timer: /grindAt\(/.test(String(runTimer)),
        hiit: /grindAt\(/.test(String(ivTick)),
        baseline: /grindAt\(|grindAtOpen\(/.test(String(startBaselineTimer))
      };
      STATE.baseline = _baseKeep;
      return o;
    }, G.source);

    t.eq('the grind pool has real lines in it', g.lines > 3, true, g.lines);
    t.eq('and the floor is a whole effort, not a couple of seconds', g.min, 36);

    t.eq('a 20-second hold has no last third worth naming', g.at[20], -1);
    t.eq('nor a 35-second one, one under the gate', g.at[35], -1);
    t.eq('a 36-second hold names it at the two-thirds mark', g.at[36], 24);
    t.eq('a 50-second hold at 33', g.at[50], 33);
    /* THE LAST THIRD IS A PROPERTY OF THE EFFORT. Ten seconds is 10.5% of the
       longest hold in the program — this is the check that a fixed marker
       cannot pass. */
    t.eq('and a 95-second hold at 63, not at 85', g.at[95], 63);
    t.eq('a 150-second hold scales with it too', g.at[150], 100);

    t.eq('no legal grind second is adjacent to the ten-second marker', g.adjacent, []);
    t.eq('the closest one still leaves a clear second either side', g.minRemain >= 12, true, g.minRemain);

    t.eq('hype off means the line is silent', g.hypeOff, '');
    t.eq('voice off means the same', g.voiceOff, '');
    t.ok('and with both on there really is a line to say', !!g.hypeOn, g.hypeOn);

    // ---- the guided player
    t.eq('a 50-second hold is acknowledged exactly once', g.p50.n, 1);
    t.eq('at the second grindAt() named', g.p50.at, [33]);
    /* MEASURE THE CLASH, NOT THE PRESENCE. Before the neighbour guard the form
       cue landed at 32 and the line at 33, so one of the two was cancelled
       mid-word and the check would still have seen both. */
    t.eq('with nothing else spoken within a second of it', g.p50.clash, 0);
    t.eq('a 95-second hold is acknowledged once, at 63', g.p95.at, [63]);
    t.eq('and nothing collides there either', g.p95.clash, 0);
    t.eq('a 36-second hold, at the floor, still gets it', g.p36.at, [24]);
    // floors: an effort with no grind must stay exactly as it was
    t.eq('a 20-second hold gets no grind line at all', g.p20.n, 0);
    t.eq('nor a 35-second one', g.p35.n, 0);
    t.ok('but a short hold is still coached', g.p20.total > 0, g.p20);

    // ---- HIIT
    t.eq('a 45-second work round is acknowledged once, at 30', g.ivWork, [30]);
    /* Rest has no hard part, and saying it has costs the ear the difference
       between the two phases — the same reason countdownCue() is kept off it. */
    t.eq('a 45-second REST round says nothing of the kind', g.ivRest, []);
    t.eq('and a 20-second round is too short to have a third', g.ivShort, []);

    // ---- the baseline battery's open hold
    t.eq('guard: this block seeded its own 150-second plank max', g.maxPlank, 150);
    t.eq('the open hold names it at two thirds of THEIR OWN max', g.openAt, Math.round(g.maxPlank * 2 / 3));
    t.eq('driven for real, the line lands there', g.openHit, 1);
    t.eq('and does not land twenty seconds earlier', g.openEarly, 0);
    /* The discriminating floor: a fixed number would give the same answer to
       both athletes. A weaker athlete's hard part genuinely arrives sooner. */
    t.eq('a weaker athlete reaches their hard part sooner', g.openAtWeak, 40);
    t.ok('which a fixed constant could not express', g.openAtWeak < g.openAt, g);
    /* The floor beneath the floor: a 15-second plank has no third worth
       naming either, and 10 seconds in is not a grind, it is the start. */
    t.eq('a 15-second plank max gets no open-hold line at all', g.openAtTiny, -1);

    // ---- who gets it and who does not
    t.ok('the warm-up and cool-down flow stays silent — a stretch is not a grind', g.flowSilent, g);
    t.ok('the guided player is wired', g.wired.player, g.wired);
    t.ok('the standalone hold timer is wired', g.wired.timer, g.wired);
    t.ok('HIIT is wired', g.wired.hiit, g.wired);
    t.ok('and the baseline battery is wired', g.wired.baseline, g.wired);
    t.ok('the player\'s periodic cue yields the second either side', g.yield.player, g.yield);
    t.ok('the standalone hold timer\'s does too', g.yield.timer, g.yield);
    t.ok('the battery\'s fixed-duration cue does too', g.yield.baseFixed, g.yield);
    t.ok('and its open-hold cue, against the open-hold point', g.yield.baseOpen, g.yield);
  }

  /* ---- THE GRINDER: one unbroken effort (v360) --------------------------
     Measured before building it: every one of 274 sets in 60 prescribed
     sessions carries at least 25 seconds of rest, and the only zero-rest
     format among the seventeen was gripmax — ONE hang, one movement. Nothing
     ran unbroken across several movements.
     The floors carry most of the weight here: "no rest" is satisfiable by
     deleting rest everywhere, and "you must finish" is satisfiable by taking
     the stop button away. Both would be worse than the gap. */
  {
    const gr = await page.evaluate(async () => {
      const o = {};
      const flush = () => new Promise(r => setTimeout(r, 3));
      const list = HIIT_POOL.filter(x => EX[x]).map(x => ({ exId: x }));

      // --- the sequence itself carries no rest step, per format
      o.seq = {};
      Object.keys(GRINDER_FORMATS).forEach(k => {
        const q = buildIntervals(list, k);
        o.seq[k] = { steps: q.length, rest: q.filter(x => x.type === 'rest').length,
          total: q.reduce((a, b) => a + b.secs, 0), stations: GRINDER_FORMATS[k].stations,
          want: GRINDER_FORMATS[k].stations * GRINDER_FORMATS[k].secs };
      });
      /* THE FLOOR: an ordinary interval format must be untouched. "No rest"
         implemented by deleting rest from buildIntervals() satisfies every
         assertion above and breaks every other session in the app. */
      o.tabataRest = buildIntervals(list, 'tabata').filter(x => x.type === 'rest').length;
      o.emomRest = buildIntervals(list, 'emom').filter(x => x.type === 'rest').length;
      o.skipRest = buildIntervals(list, 'skip93x3').filter(x => x.type === 'rest').length;

      // --- membership, because the format id reaches innerHTML and an import
      //     can carry anything
      o.isG = { real: isGrinder('grind6'), junk: isGrinder('helicopter'),
        inherited: isGrinder('constructor'), other: isGrinder('tabata') };

      STATE.grindLog = [];
      // --- drive one to the end
      startGrinder('grind6');
      await new Promise(r => setTimeout(r, 120));
      o.opened = !!INTV; o.fmt = INTV && INTV.format;
      o.sess = INTV && { key: INTV.sess.session.key, ptr: INTV.sess.ptr };
      const ptrBefore = STATE.progressPtr;
      INTV.lead = 0; ivTickLead(); await flush();
      const html = document.querySelector('#hiit').innerHTML;
      /* SKIP IS GONE AND STOP IS NOT. Removing both would satisfy "there is no
         skip" and leave an athlete locked into a session they need out of. */
      /* SCOPED TO THE ACTION ROW, not the page. The header ✕ also calls
         hiitQuit(), so a page-wide search reports a Stop button that is not
         there — the mutant that removed it walked straight through. */
      const acts = (document.querySelector('#hiit .pl-actions') || {}).innerHTML || '';
      o.chrome = { skip: /hiitSkip\(\)/.test(acts), stop: /hiitQuit\(\)/.test(acts),
        actsFound: !!document.querySelector('#hiit .pl-actions'),
        totalClock: !!document.querySelector('#ivTotal') };
      o.totalAtStart = (document.querySelector('#ivTotal') || {}).textContent;
      /* AND IT HAS TO MOVE WITHIN A STATION. Crossing a boundary re-renders
         the whole body, which writes the label fresh — so a tick that ends a
         station cannot tell the per-tick repaint from its absence. Ticking
         once INSIDE station 1 can: only the repaint produces 5:59. */
      INTV.remain = 60; INTV.deadline = 0; ivTick(); await flush();
      o.totalMidStation = (document.querySelector('#ivTotal') || {}).textContent;
      o.remainMid = INTV && INTV.remain;
      let guard = 0;
      while (INTV && INTV.phase !== 'done' && guard++ < 400) {
        INTV.remain = 1; INTV.deadline = 0; ivTick(); await flush();
      }
      o.donePhase = INTV ? INTV.phase : 'gone';
      o.doneText = (document.querySelector('#ivBody') || {}).innerText || '';
      hiitQuit(); await flush();
      o.finished = JSON.parse(JSON.stringify(STATE.grindLog));
      o.streakDone = grindStreak();
      o.ptrMoved = STATE.progressPtr !== ptrBefore;

      // --- and stop one early
      startGrinder('grind6');
      await new Promise(r => setTimeout(r, 120));
      INTV.lead = 0; ivTickLead(); await flush();
      INTV.remain = 1; INTV.deadline = 0; ivTick(); await flush();
      hiitQuit(); await flush();
      o.stopped = JSON.parse(JSON.stringify(STATE.grindLog)).slice(-1)[0];
      o.streakStopped = grindStreak();

      // --- a flagged athlete gets no station they cannot do, and no station
      //     they could only escape by skipping — which this session removes
      const limKeep = STATE.profile.limitations;
      STATE.profile.limitations = ['shoulder', 'wrist', 'knee', 'lowback'];
      startGrinder('grind6');
      await new Promise(r => setTimeout(r, 120));
      o.flagged = INTV ? INTV.seq.map(x => x.exId) : [];
      o.flaggedRisky = o.flagged.filter(id => jointRisky(id, STATE.profile.limitations));
      hiitQuit(); await flush();
      STATE.profile.limitations = limKeep;

      /* THE GEAR GUARD IS UNREACHABLE ON TODAY'S POOL — measured, all 12
         HIIT_POOL movements are bodyweight and need no kit — so it is
         exercised directly by giving one an equip the athlete lacks, the
         same technique the hardness-band and anchor-unit guards use. */
      {
        const victim = HIIT_POOL.filter(k => EX[k])[0];
        const keepEq = EX[victim].equip, keepGear = STATE.profile.gear;
        EX[victim].equip = ['sandbag']; STATE.profile.gear = [];
        startGrinder('grind20');
        await new Promise(r => setTimeout(r, 120));
        o.gearGuard = { victim, seq: INTV ? INTV.seq.map(x => x.exId) : null };
        hiitQuit(); await flush();
        EX[victim].equip = keepEq; STATE.profile.gear = keepGear;
      }
      // --- the log is capped, so it cannot grow for ever inside every backup
      STATE.grindLog = [];
      for (let i = 0; i < 250; i++) logGrind('grind6', true, 6, 360);
      o.capped = STATE.grindLog.length;
      o.cappedKeepsNewest = STATE.grindLog[STATE.grindLog.length - 1].done === true;

      // --- the boot repair: a new STATE field gets one
      STATE.grindLog = [
        { date: todayISO(), format: 'grind6', done: 'false', stations: '6', total: '360', at: 1 },
        { date: 'not-a-date', format: 'grind6', done: true, stations: 6, total: 360, at: 2 },
        { date: todayISO(), format: 'helicopter', done: true, stations: 6, total: 360, at: 3 },
        'junk', null,
        { date: todayISO(), format: 'grind12', done: true, stations: 12, total: 720, at: 4 }
      ];
      normalizeState();
      o.repaired = JSON.parse(JSON.stringify(STATE.grindLog));
      STATE.grindLog = 'wrecked'; normalizeState(); o.wrecked = STATE.grindLog;

      // --- and it travels in a backup
      STATE.grindLog = [{ date: todayISO(), format: 'grind20', done: true, stations: 20, total: 1200, at: 9 }];
      const clone = JSON.parse(JSON.stringify(STATE));
      TRANSIENT_KEYS.forEach(k => { delete clone[k]; });
      o.inBackup = Array.isArray(clone.grindLog) && clone.grindLog.length === 1 && clone.grindLog[0].format === 'grind20';
      STATE.grindLog = [];
      return o;
    });

    // the sequence
    Object.keys(gr.seq).forEach(k => {
      t.eq('the ' + k + ' sequence contains no rest step at all', gr.seq[k].rest, 0);
      t.eq('and runs the stations it promises', gr.seq[k].steps, gr.seq[k].stations);
      t.eq('for exactly the minutes on the card', gr.seq[k].total, gr.seq[k].want);
    });
    /* The floors: deleting rest from buildIntervals() outright satisfies every
       assertion above and silently rewrites every other session in the app. */
    t.eq('an ordinary Tabata still has its rests', gr.tabataRest, 7);
    t.eq('EMOM still has its rests', gr.emomRest > 0, true, gr.emomRest);
    t.eq('and a skipping block still has its rests', gr.skipRest > 0, true, gr.skipRest);

    t.ok('a real grinder format is recognised', gr.isG.real, gr.isG);
    t.ok('junk is not', !gr.isG.junk, gr.isG);
    /* `GRINDER_FORMATS[f]||...` looks equivalent to a membership test and is
       not: an INHERITED key is truthy, so the || form hands back
       Object.prototype.constructor while hasOwnProperty refuses it. */
    t.ok('an inherited key is not', !gr.isG.inherited, gr.isG);
    t.ok('and neither is another registry\'s format', !gr.isG.other, gr.isG);

    // the session it opens
    t.ok('the grinder opens', gr.opened, gr);
    t.eq('under its own session key', gr.sess.key, 'grinder');
    t.eq('and off the program queue', gr.sess.ptr, -1);
    t.ok('guard: the action row rendered at all', gr.chrome.actsFound, gr.chrome);
    t.ok('the total clock is on screen', gr.chrome.totalClock, gr.chrome);
    t.eq('reading the whole session, not the station', gr.totalAtStart, '6:00 LEFT');
    t.eq('guard: that tick stayed inside the first station', gr.remainMid, 59);
    t.eq('and it counts down every second, not only at a station change', gr.totalMidStation, '5:59 LEFT');
    /* Skip is what breaks an unbroken effort, so it goes. Stop never does —
       and a fix that removed both would pass every "there is no skip" check. */
    t.ok('there is no Skip button', !gr.chrome.skip, gr.chrome);
    t.ok('but Stop is still there', gr.chrome.stop, gr.chrome);

    // finishing
    t.eq('running every station finishes it', gr.donePhase, 'done');
    t.ok('and says so', /finished it/i.test(gr.doneText), gr.doneText.slice(0, 90));
    t.eq('one record is written', gr.finished.length, 1);
    t.eq('marked done', gr.finished[0].done, true);
    t.eq('with every station reached', gr.finished[0].stations, 6);
    t.eq('and the streak counts it', gr.streakDone, 1);
    /* Bonus only: it must not consume a program session, the same promise the
       custom builder and Special HIIT already make. */
    t.ok('the program pointer does not move', !gr.ptrMoved, gr);

    // stopping
    t.eq('stopping early writes a record too', gr.stopped.done, false);
    t.eq('naming how far they got', gr.stopped.stations, 1);
    /* A STOP IS NOT A FINISH. A streak that counted every logged session would
       count this one, which is the opposite of what the streak means. */
    t.eq('and the streak breaks on it', gr.streakStopped, 0);

    // a flagged athlete
    t.ok('a flagged athlete still gets a grinder', gr.flagged.length > 0, gr.flagged);
    /* It matters more here than anywhere: there is no Skip, so a station they
       cannot safely do is one they can only escape by ending the session. */
    t.eq('with no station their flags forbid', gr.flaggedRisky, []);
    t.ok('guard: the gear case really built a sequence', !!gr.gearGuard.seq, gr.gearGuard);
    t.eq('a movement whose kit they do not own is not a station',
      gr.gearGuard.seq.indexOf(gr.gearGuard.victim), -1, gr.gearGuard);
    /* A log that grows for ever travels in every backup — the cost v285
       measured, one field over. */
    t.eq('the grinder log is capped', gr.capped, 200);
    t.ok('and the cap keeps the newest, not the oldest', gr.cappedKeepsNewest, gr);

    // the repair
    t.eq('junk rows are dropped, and the real ones are not', gr.repaired.length, 3);
    if (gr.repaired.length !== 3) {
      t.fail('the repair did not leave three rows to check', JSON.stringify(gr.repaired));
    } else {
    /* The string 'false' is TRUTHY, and a backup that serialises the flag that
       way would turn every stopped session into a finish — medCleared()'s own
       defect, one field over. */
    t.eq("the string 'false' does not read as a finish", gr.repaired[0].done, false);
    t.eq('and its string counts become numbers', gr.repaired[0].stations, 6);
    t.eq('an unknown format is blanked, not kept', gr.repaired[1].format, '');
    t.eq('a real row survives untouched', gr.repaired[2].format, 'grind12');
    }
    t.eq('and a wrecked container becomes an empty list', gr.wrecked, []);
    t.ok('the log travels in a backup', gr.inBackup, gr);
  }

  /* ---- HOLD TO FAILURE: one movement, timed to the limit (v361) ---------
     Measured before building it: the battery measures four to-failure holds
     and taking one means taking a TEN-test battery, and outside it `gripmax`
     was the only standalone max effort — dead hang only, and a three-minute
     countdown rather than a hold, so it could not record past 3:00.
     The load-bearing property is that a fresh hold and a hold done after a
     session are kept apart. Without it the trend silently mixes the two. */
  {
    const ht = await page.evaluate(async () => {
      const o = {};
      const flush = () => new Promise(r => setTimeout(r, 20));
      STATE.holdLog = []; STATE.logs = {};      // untrained today => fresh
      o.freshWhenUntrained = holdFreshNow();
      /* EACH BLOCK BUILDS THE STATE IT ASSERTS ON — an earlier block here
         leaves STATE.baseline null, and estimateMaxes() then hands back
         defaults. And the real requirement is not a particular number: it
         is that logging holds moves NOTHING, so both ends are measured. */
      const _bKeep = STATE.baseline;
      STATE.baseline = { date: todayISO(), score: 70, level: 'Advanced', testCount: TESTS.length,
        maxes: { plank: 150, side: 95, hollow: 70, lower: 30, dyn: 55, push: 48, pull: 22, squat: 62, power: 20, stamina: 24 } };
      o.maxesBefore = JSON.stringify(currentMaxes());

      // --- the registry reaches innerHTML, so membership not truthiness
      o.reg = HOLD_TESTS.map(t => t.id);
      o.lookup = { real: !!holdTest('plank'), junk: !!holdTest('helicopter'),
        inherited: !!holdTest('constructor') };
      o.everyExReal = HOLD_TESTS.every(t => !!EX[t.exId]);
      o.everyExTimed = HOLD_TESTS.every(t => EX[t.exId].unit === 'time');

      // --- driven for real, off the Special training menu
      openSpecial();
      o.onSpecialMenu = /openHoldTests\(\)/.test(document.querySelector('#sheet').innerHTML);
      openHoldTests();
      o.rows = [...document.querySelectorAll('[data-hold]')].map(b => b.getAttribute('data-hold'));
      o.saysFresh = /counts as a fresh test/.test(document.querySelector('#sheet').innerHTML);
      startHoldTest('plank');
      await new Promise(r => setTimeout(r, 60));
      o.timerOpened = !!_ht;
      o.timerFresh = _ht && _ht.fresh;
      /* IT COUNTS UP AND HAS NO CAP. gripmax counts DOWN from three minutes,
         so it cannot record a hold longer than that — the defect this exists
         to fix. Well past 3:00 must still be a real recorded number. */
      _ht.mode = 'run'; _ht.elapsed = 47;
      stopHoldTest(); await flush();
      o.firstRow = JSON.parse(JSON.stringify(STATE.holdLog))[0];
      o.bestAfterOne = holdBest('plank');
      o.trendAfterOne = holdTrend('plank');      // one point is not a trend

      logHold('plank', 62, true);
      o.trendTwo = holdTrend('plank');
      o.bestTwo = holdBest('plank');
      logHold('plank', 250, true);               // past gripmax's 3:00 ceiling
      o.bestPast3min = holdBest('plank');

      /* THE DISCRIMINATING CASE: a LONGER hold taken after training must not
         set the best and must not enter the trend. A tracker that took the
         maximum of everything would report a personal best the athlete never
         set fresh, and then show it falling for months. */
      logHold('plank', 400, false);
      o.bestAfterFatigued = holdBest('plank');
      o.trendAfterFatigued = holdTrend('plank');
      o.fatiguedIsStored = holdLog().filter(r => r.id === 'plank' && r.secs === 400).length;
      /* A HOLD THAT NEVER STARTED IS NOT A RESULT — a cancel, or a Stop
         tapped on the 3-2-1, would otherwise write a zero-second row that
         travels in every backup and reads as an effort that was made. */
      const beforeZero = holdLog().length;
      o.zeroReturn = logHold('plank', 0, true);
      o.zeroWrote = holdLog().length - beforeZero;

      // --- and the app decides fresh-or-not from the DATA, not from a prompt
      const logKeep = STATE.logs;
      STATE.logs = {}; STATE.logs[STATE.progressPtr] = { done: true, completedAt: todayISO(), sets: 1, ex: {} };
      o.freshWhenTrained = holdFreshNow();
      startHoldTest('hang');
      await new Promise(r => setTimeout(r, 60));
      o.trainedTimerFresh = _ht && _ht.fresh;
      _ht.mode = 'run'; _ht.elapsed = 99; stopHoldTest(); await flush();
      o.hangRow = holdLog().filter(r => r.id === 'hang')[0];
      o.hangBest = holdBest('hang');            // fatigued only => no bar yet
      STATE.logs = logKeep;

      /* IT MUST NOT TOUCH THE BASELINE OR THE PRESCRIPTION. The battery is
         taken rested, in a fixed order, with two minutes between efforts, and
         its numbers scale every target for a year. A Tuesday plank is a real
         number and is not that one. */
      o.maxesAfter = JSON.stringify(currentMaxes());
      o.maxesUnmoved = (currentMaxes() || {}).plank;
      o.baselineUnmoved = STATE.baseline ? STATE.baseline.maxes.plank : null;
      o.readsHoldLog = /holdLog|holdBest/.test(String(currentMaxes)) ||
                       /holdLog|holdBest/.test(String(estimateMaxes)) ||
                       /holdLog|holdBest/.test(String(prescribe));

      // --- the tracker renders where a tracker belongs
      go('progress'); setProgressTab('strength'); render(); await flush();
      const v = document.querySelector('#v-progress');
      o.tracker = /Hold to failure/.test(v.innerHTML);
      o.trackerRow = (v.querySelector('[data-holdrow="plank"]') || {}).innerText || '';
      o.trackerHang = (v.querySelector('[data-holdrow="hang"]') || {}).innerText || '';
      /* SCOPED TO THE NOTE, not the page. The ROW for a fatigued-only hold
         also says "after training", so a page-wide search is satisfied by
         the row and the note itself goes untested. */
      o.fatiguedNote = /only been tested after training/.test(v.innerHTML);
      o.notInBaselineChart = !/data-holdrow/.test(String(strengthTrendHTML()));

      /* THE NOTE MUST NOT ALWAYS FIRE. A note that appears whatever the log
         says is a note nobody reads — and it would be wrong for an athlete
         whose every hold WAS taken fresh. */
      const _hKeep = STATE.holdLog;
      STATE.holdLog = [{ date: todayISO(), id: 'plank', secs: 60, fresh: true, at: 1 }];
      render(); await flush();
      o.noteWhenAllFresh = /only been tested after training/.test(
        (document.querySelector('#v-progress') || {}).innerHTML || '');
      // and the log is capped, so it cannot grow for ever inside every backup
      STATE.holdLog = [];
      for (let i = 0; i < 250; i++) logHold('plank', 30 + i, true);
      o.capped = STATE.holdLog.length;
      o.cappedKeepsNewest = holdBest('plank');
      STATE.holdLog = _hKeep;
      /* AN INTERVAL MUST NOT OUTLIVE THE SHEET IT PAINTS. _ht ticks against
         #htBig, so a dismissed sheet left it writing to a node that is gone. */
      startHoldTest('wallsit');
      await new Promise(r => setTimeout(r, 60));
      o.tickerLive = !!_ht;
      closeSheet(); await flush();
      o.tickerAfterClose = !!_ht;

      /* THE HARD PART, NAMED, AT THIS ATHLETE'S OWN POINT. A constant would
         give the same answer to a 60-second plank and a 150-second one, so
         the check drives TWO bests and requires two different seconds. */
      const G = /hard part|Burning muscles|Shaking here|honest part|Fatigue now|last third|does not get easier/;
      /* DRIVE THE REAL TICK, not a copy of it. htTick() is a closure local
         driven by the interval, so the only way in is to park the clock one
         second before the point and let ONE genuine tick cross it — the same
         technique suite 04 uses on the baseline timer. Re-implementing the
         branch here would pass with the branch deleted from the app. */
      const driveHold = async (id, best, at) => {
        /* The prior has to say WHICH MOVEMENT it was held on, or v367's
           same-movement rule correctly refuses to treat it as this athlete's
           bar — the record was incomplete, not the rule. Same shape as v321's
           like-for-like prior needing `subs:{}`. */
        STATE.holdLog = best ? [{ date: todayISO(), id: id, secs: best, fresh: true, at: 1,
                                  exId: holdMovement(holdTest(id)) }] : [];
        STATE.logs = {};
        const said = []; const real = window.coachSpeak;
        window.coachSpeak = x => said.push(String(x));
        startHoldTest(id);
        await new Promise(r => setTimeout(r, 60));
        _ht.mode = 'run'; _ht.grindSaid = false; _ht.elapsed = at - 1;
        await new Promise(r => setTimeout(r, 1150));   // one real tick crosses it
        const landed = _ht ? _ht.elapsed : -1;
        const hit = said.filter(x => G.test(x)).length;
        stopHoldTimer(); closeSheet();
        window.coachSpeak = real;
        return { landed, hit };
      };
      o.point150 = grindAtBest(150); o.point60 = grindAtBest(60);
      o.at150 = await driveHold('plank', 150, o.point150);        // lands
      o.off150 = await driveHold('plank', 150, o.point60);        // 40 is NOT their point
      o.at60 = await driveHold('plank', 60, o.point60);           // lands
      o.grindNone = await driveHold('plank', 0, 40);              // no bar, nothing to say
      /* THE MOVEMENT ACTUALLY HELD IS THE ONE THE FLAG ALLOWS, and the
         screen names it — the baseline battery's own call, for its reason:
         this is a maximal effort, so a silent substitution would be wrong. */
      const limK = STATE.profile.limitations;
      STATE.profile.limitations = ['shoulder'];
      startHoldTest('hang'); await new Promise(r => setTimeout(r, 60));
      o.swapped = { exId: _ht && _ht.exId, named: /Bird Dog/i.test((document.querySelector('#sheet') || {}).innerText || '') };
      stopHoldTimer(); closeSheet(); await flush();
      STATE.profile.limitations = [];
      startHoldTest('hang'); await new Promise(r => setTimeout(r, 60));
      o.unswapped = _ht && _ht.exId;
      stopHoldTimer(); closeSheet(); await flush();
      STATE.profile.limitations = limK;

      // --- the empty state explains itself
      const keep = STATE.holdLog; STATE.holdLog = [];
      render(); await flush();
      o.empty = (document.querySelector('#v-progress') || {}).innerText || '';
      o.emptyExplains = /Hold to failure/.test(o.empty);
      STATE.holdLog = keep;

      // --- the boot repair
      STATE.holdLog = [
        { date: todayISO(), id: 'plank', secs: 60, fresh: 'false', at: 1 },  // truthy string
        { date: 'not-a-date', id: 'plank', secs: 60, fresh: true, at: 2 },
        { date: todayISO(), id: 'helicopter', secs: 60, fresh: true, at: 3 },
        { date: todayISO(), id: 'plank', secs: 0, fresh: true, at: 4 },
        'junk', null,
        { date: todayISO(), id: 'wallsit', secs: '75', fresh: true, at: 5 }
      ];
      normalizeState();
      o.repaired = JSON.parse(JSON.stringify(STATE.holdLog));
      STATE.holdLog = 'wrecked'; normalizeState(); o.wrecked = STATE.holdLog;

      // --- and it travels in a backup
      STATE.holdLog = [{ date: todayISO(), id: 'wallsit', secs: 88, fresh: true, at: 9 }];
      const clone = JSON.parse(JSON.stringify(STATE));
      TRANSIENT_KEYS.forEach(k => { delete clone[k]; });
      o.inBackup = Array.isArray(clone.holdLog) && clone.holdLog.length === 1 && clone.holdLog[0].secs === 88;
      STATE.holdLog = [];
      STATE.baseline = _bKeep;
      return o;
    });

    t.eq('there are five holds to test', ht.reg.length, 5);
    t.ok('every one names a real exercise', ht.everyExReal, ht.reg);
    t.ok('and every one is a timed movement', ht.everyExTimed, ht.reg);
    t.ok('a real hold id resolves', ht.lookup.real, ht.lookup);
    t.ok('junk does not', !ht.lookup.junk, ht.lookup);
    t.ok('and neither does an inherited key', !ht.lookup.inherited, ht.lookup);

    t.ok('it is reachable from Special training', ht.onSpecialMenu, ht);
    t.eq('and lists every hold', ht.rows, ht.reg);
    t.ok('the timer opens', ht.timerOpened, ht);

    // fresh
    t.ok('an untrained day is a fresh test', ht.freshWhenUntrained, ht);
    t.ok('and the sheet says so', ht.saysFresh, ht);
    t.eq('the timer carries it', ht.timerFresh, true);
    t.eq('a 47-second hold is stored', ht.firstRow.secs, 47);
    t.eq('marked fresh', ht.firstRow.fresh, true);
    t.eq('and it is the best so far', ht.bestAfterOne, 47);
    /* One point is not a trend, and reporting one would be inventing a
       direction out of a single number. */
    t.eq('one hold gives no trend yet', ht.trendAfterOne, null);
    t.eq('two fresh holds do', ht.trendTwo.delta, 15);
    t.eq('and the best moves with them', ht.bestTwo, 62);
    /* gripmax counts DOWN from three minutes and cannot record past 3:00.
       This one counts up, so 250 seconds is a number. */
    t.eq('a hold past three minutes is recorded, not capped', ht.bestPast3min, 250);

    // fatigued — the discriminating half
    t.eq('a longer hold taken after training does NOT set the best', ht.bestAfterFatigued, 250);
    t.eq('nor does it enter the trend', ht.trendAfterFatigued.last, 250);
    /* But it is kept. Dropping it would satisfy every "it does not set the
       best" assertion and throw away a real effort the athlete made. */
    t.eq('and it is still stored', ht.fatiguedIsStored, 1);

    /* READ THE DATA, NOT A PROMPT. The athlete is never asked whether they
       trained today — the log already knows. */
    t.ok('a trained day is not a fresh test', !ht.freshWhenTrained, ht);
    t.eq('the timer carries that too', ht.trainedTimerFresh, false);
    if (!ht.hangRow) {
      t.fail('the after-training hold was not recorded at all', JSON.stringify(ht));
    } else {
      t.eq('the hold is recorded as after-training', ht.hangRow.fresh, false);
    }
    t.eq('and with nothing fresh there is no best yet, not a zero', ht.hangBest, 0);

    // it stays out of the prescription
    t.eq('guard: this block seeded a real 150-second plank baseline', ht.maxesUnmoved, 150);
    t.eq('the baseline is untouched by a hold test', ht.baselineUnmoved, 150);
    /* Not merely one number: EVERY max the program is built from is
       byte-identical before and after four holds, one of them 400s. */
    t.eq('and every max the program reads is unchanged', ht.maxesAfter, ht.maxesBefore);
    t.ok('no prescription path reads the hold log', !ht.readsHoldLog, ht);
    t.ok('and it is not folded into the baseline chart', ht.notInBaselineChart, ht);

    // the tracker
    t.ok('the tracker renders on Progress ▸ Strength', ht.tracker, ht);
    t.ok('showing the best and the change', /4:10/.test(ht.trackerRow) && /\+15s|\+188s/.test(ht.trackerRow), ht.trackerRow);
    /* A number that is not moving needs a reason on the glass. A hold only
       ever tested after training has no best, and a blank with no explanation
       reads as broken. */
    t.ok('a fatigued-only hold row says why it has no best', /after training/i.test(ht.trackerHang), ht.trackerHang);
    t.ok('and the card carries the note explaining it', ht.fatiguedNote, ht);
    t.ok('but an athlete who tested fresh gets no such note', !ht.noteWhenAllFresh, ht);
    /* A log that grows for ever travels in every backup — the cost v285
       measured, two fields over. */
    t.eq('the hold log is capped', ht.capped, 200);
    t.eq('and the cap keeps the newest, not the oldest', ht.cappedKeepsNewest, 279);
    t.ok('guard: the hold timer really was running', ht.tickerLive, ht);
    t.ok('and closing the sheet stops it', !ht.tickerAfterClose, ht);
    t.eq('a 150-second best puts the hard part at 100', ht.point150, 100);
    t.eq('a 60-second best puts it at 40', ht.point60, 40);
    t.eq('guard: the driven tick really landed on the point', ht.at150.landed, 100);
    t.eq('and the line is spoken there', ht.at150.hit, 1);
    /* A CONSTANT COULD NOT DO THIS. Second 40 is the 60-second athlete's hard
       part and not this one's, so a fixed point fails exactly here. */
    t.eq('but not at the other athlete\'s point', ht.off150.hit, 0);
    t.eq('and the 60-second athlete gets it at 40', ht.at60.hit, 1);
    t.eq('with no bar yet, nothing is said', ht.grindNone.hit, 0);
    /* A maximal effort is never silently substituted: the movement is
       swapped for a flagged joint AND the screen names what is being held. */
    t.eq('a shoulder-flagged athlete holds the substitute', ht.swapped.exId, 'birddog');
    t.ok('and the screen names it', ht.swapped.named, ht.swapped);
    /* The floor: an unflagged athlete gets the real movement. A build that
       substituted everybody passes every assertion above. */
    t.eq('an unflagged athlete holds the real one', ht.unswapped, 'deadhang');
    t.eq('a hold that never started writes nothing', ht.zeroWrote, 0);
    t.eq('and reports that it recorded nothing', ht.zeroReturn, null);
    t.ok('and with nothing tested the empty state explains itself', ht.emptyExplains, ht.empty.slice(0, 120));

    // the repair
    t.eq('junk rows are dropped', ht.repaired.length, 2);
    if (ht.repaired.length !== 2) {
      t.fail('the repair did not leave two rows to check', JSON.stringify(ht.repaired));
    } else {
      /* The string 'false' is TRUTHY. A backup serialising the flag that way
         would turn a fatigued hold into a fresh one and set a best that was
         never set — medCleared()'s defect, two fields over. */
      t.eq("the string 'false' does not read as fresh", ht.repaired[0].fresh, false);
      t.eq('a string duration becomes a number', ht.repaired[1].secs, 75);
      t.eq('and the real row keeps its id', ht.repaired[1].id, 'wallsit');
    }
    t.eq('a wrecked container becomes an empty list', ht.wrecked, []);
    t.ok('and the log travels in a backup', ht.inBackup, ht);
  }

  /* ---- A GRINDER IS ONE EFFORT, NOT SIX (v362) --------------------------
     Found by auditing v360 an hour after shipping it — the ratio this file
     already records. Reusing the HIIT engine inherited its PER-ROUND
     semantics, and a grinder has no rest: it is one continuous piece of work.
     Measured before the fix: SIX grind lines in a six-minute grinder, which
     is a nag and contradicts v359's own "one per effort" rule. And its
     minutes went nowhere, while Special HIIT one branch away offered exactly
     that log. */
  {
    const g2 = await page.evaluate(async () => {
      const o = {};
      const flush = () => new Promise(r => setTimeout(r, 20));
      const G = /hard part|Burning muscles|Shaking here|honest part|Fatigue now|last third|does not get easier/;
      const runGrind = async (fmt) => {
        STATE.grindLog = [];
        const said = []; const real = window.coachSpeak;
        window.coachSpeak = x => said.push([Math.round(ivSessionSecs() - grinderLeft()), String(x)]);
        startGrinder(fmt);
        await new Promise(r => setTimeout(r, 120));
        INTV.lead = 0; ivTickLead(); await flush();
        let n = 0;
        while (INTV && INTV.phase !== 'done' && n++ < 1400) { INTV.deadline = 0; ivTick(); await flush(); }
        const fin = (document.querySelector('#ivBody') || {}).innerText || '';
        window.coachSpeak = real;
        const hits = said.filter(x => G.test(x[1]));
        hiitQuit(); await flush();
        return { n: hits.length, at: hits.map(x => x[0]), logBtn: /Log \d+ min to my record/.test(fin) };
      };
      o.six = await runGrind('grind6');
      o.sixWant = grindAt(360);          // the SESSION's last third, not a station's
      o.stationWant = grindAt(60);       // what the old code used
      /* THE FLOOR: HIIT rounds ARE separate efforts, with rest between, so
         each keeps its own acknowledgement. A fix that reset only once would
         satisfy every "the grinder says it once" assertion and silence five
         rounds of a Tabata. */
      const said = []; const real = window.coachSpeak;
      window.coachSpeak = x => said.push(String(x));
      INTV = { i: 0, format: 'tabata',
        seq: [{ type: 'work', secs: 45, exId: 'burpee' }, { type: 'rest', secs: 20, exId: 'burpee' },
              { type: 'work', secs: 45, exId: 'burpee' }],
        phase: 'work', remain: 45, total: 45, grindSaid: false, running: false,
        workElapsed: 0, deadline: 0,
        sess: { session: { name: 'x', key: 'specialhiit' }, ptr: -1, pos: {} } };
      let n = 0;
      while (INTV && INTV.i < 3 && n++ < 400) { INTV.deadline = 0; ivTick(); await flush(); }
      window.coachSpeak = real;
      o.hiitRounds = said.filter(x => G.test(x)).length;
      INTV = null;
      return o;
    });

    t.eq('a six-minute grinder is acknowledged exactly once', g2.six.n, 1);
    /* Two thirds of the SESSION (240s of 360), not two thirds of a station
       (40s). A station-based point fires six times and lands at 40. */
    t.eq('at two thirds of the whole session', g2.six.at, [g2.sixWant]);
    t.eq('guard: which is 240 seconds, not the 40 a station would give', g2.sixWant, 240);
    t.eq('guard: and a station really would have given 40', g2.stationWant, 40);
    /* The floor: a HIIT round IS its own effort, and two work rounds get two. */
    t.eq('but HIIT rounds each keep their own', g2.hiitRounds, 2);
    /* Its minutes went nowhere while its sibling offered the log. */
    t.ok('and a finished grinder can log its minutes', g2.six.logBtn, g2.six);
  }

  /* ---- LEAN RECOMP: Tone up's volume with a real deficit (v363) ---------
     Asked for as "increase the rep sets like in Tone up but drop belly fat
     like Shred". Measuring first CORRECTED the premise — Tone up already gives
     more reps than Shred (14,147 against 13,192); what Shred buys is 620 fewer
     calories, more hold time, shorter rest and more cardio. So the rep half
     was never the gap.
     The load-bearing property is therefore that this goal's rep volume is
     IDENTICAL to Tone up's, and everything below is built around proving that
     and proving the table refactor moved nothing else. */
  {
    const lr = await page.evaluate(() => {
      const o = {};
      const kp = STATE.profile, kn = STATE.nutrition, kb = STATE.baseline;
      /* EACH BLOCK BUILDS THE STATE IT ASSERTS ON. An earlier block here
         leaves STATE.baseline null, and estimateMaxes() then hands back
         DEFAULTS — so every prescribed target shrinks and the rep totals
         halve. The guard below caught exactly that. */
      STATE.baseline = { date: todayISO(), score: 70, level: 'Advanced', testCount: TESTS.length,
        maxes: { plank: 150, side: 95, hollow: 70, lower: 30, dyn: 55, push: 48, pull: 22, squat: 62, power: 20, stamina: 24 } };
      Object.assign(STATE.profile, { age: 41, heightCm: 178, sex: 'male', activity: 1.45, bodyFat: 28 });
      Object.assign(STATE.nutrition, { age: 41, heightCm: 178, sex: 'male', activity: 1.45, weightKg: 86 });
      delete STATE.nutrition.proteinTarget;   // read the CALCULATION, not a hand-set value
      delete STATE.nutrition.kcalTarget;
      delete STATE.profile.timelineWeeks;
      delete STATE.nutrition.kcalAdj;

      const scan = g => {
        STATE.profile.goal = g; STATE.nutrition.goal = g;
        let reps = 0, holdS = 0, sets = 0, restS = 0, cardio = 0, slots = 0;
        for (let p = 0; p < 378; p += 3) {
          const s = buildSession(p);
          (s.main || []).concat(s.finisher ? [s.finisher] : []).forEach(m => {
            if (!m || !EX[m.exId]) return;
            slots++; sets += m.sets || 0; restS += (m.rest || 0) * (m.sets || 0);
            if (EX[m.exId].region === 'cardio') cardio++;
            if (m.unit === 'time') holdS += m.target * (m.sets || 0);
            else reps += m.target * (m.sets || 0);
          });
        }
        const p = kcalTargetPreview();
        return { reps: Math.round(reps), holdMin: Math.round(holdS / 60), sets, slots,
          rest: Math.round(restS / sets), cardioPct: Math.round(cardio / slots * 100),
          kcal: p ? p.target : null, protein: proteinTargetCalc(),
          steps: STEP_TARGETS[g], stable: weightStableGoal(g) };
      };
      o.g = {};
      GOALS.map(x => x[0]).forEach(g => { o.g[g] = scan(g); });
      STATE.nutrition.goal = 'maintain';
      o.tdee = Math.round(kcalTargetPreview().tdee);

      // membership, because the goal id reaches innerHTML
      o.ids = GOALS.map(x => x[0]);
      o.inRegistry = o.ids.indexOf('leanrecomp') >= 0;
      /* THE TABLE'S FALLBACK. The nested ternary this replaced had an ELSE
         that swallowed every goal it did not name; the table must land an
         unknown goal on the same place that else did — 'lose' — rather than
         throwing or reading an inherited key. */
      STATE.nutrition.goal = 'helicopter'; STATE.profile.goal = 'helicopter';
      o.junkKcal = (kcalTargetPreview() || {}).target;
      STATE.nutrition.goal = 'constructor'; STATE.profile.goal = 'constructor';
      o.inheritedKcal = (kcalTargetPreview() || {}).target;

      // the picker and the tip, driven
      STATE.profile.goal = 'leanrecomp'; STATE.nutrition.goal = 'leanrecomp';
      delete STATE.nutrition.kcalTarget;
      go('fuel'); render();
      const fv = document.querySelector('#v-fuel');
      o.picker = /setNutGoal\('leanrecomp'\)/.test(fv.innerHTML);
      o.tipText = (fv.innerText.match(/Lean recomp is Tone up[^]*?calculator below\./) || [''])[0];
      o.bad = /NaN|undefined|\[object/.test(fv.innerText);

      STATE.profile = kp; STATE.nutrition = kn; STATE.baseline = kb;
      return o;
    });

    t.ok('the goal is in the registry', lr.inRegistry, lr.ids);
    /* Guard before the first dereference: without it, a goal missing from
       GOALS makes every assertion below THROW rather than name itself. */
    if (!lr.g.leanrecomp) t.fail('lean recomp is not a goal at all', JSON.stringify(lr.ids));
    const LR = lr.g.leanrecomp || {}, RC = lr.g.recomp || {}, SH = lr.g.shred || {};
    t.ok('and reachable from the Fuel picker', lr.picker, lr);
    t.ok('with no bad text on the tab', !lr.bad, lr);

    /* THE WHOLE POINT OF THE GOAL. Measured across all 378 sessions: the rep
       volume must be Tone up's exactly, not merely "high". The first build
       gave it Shred's cardio slot and landed at 12,053 — the LOWEST in the
       app — while the tip promised the opposite. */
    t.ok('guard: the sweep measured a real program, not an empty one', RC.reps > 10000, RC);
    t.eq('lean recomp keeps it, rep for rep', LR.reps, RC.reps);
    t.eq('and the same hold time', LR.holdMin, RC.holdMin);
    t.eq('the same number of slots', LR.slots, RC.slots);
    t.eq('and the same share of cardio', LR.cardioPct, RC.cardioPct);
    /* The measurement that corrected the premise, pinned so nobody "fixes"
       the goal by giving it Shred's slots: Shred has FEWER reps, not more. */
    t.ok('Shred really does have fewer reps than Tone up', SH.reps < RC.reps, { sh: SH.reps, rc: RC.reps });

    /* What it takes from Shred instead: density, calories and steps. */
    t.ok('rest is shorter than Tone up\'s', LR.rest < RC.rest, { lr: LR.rest, rc: RC.rest });
    t.ok('but not as short as Shred\'s', LR.rest > SH.rest, { lr: LR.rest, sh: SH.rest });
    t.eq('the step target matches the fat-loss goals', LR.steps, 10000);
    t.ok('where Tone up sits lower', RC.steps < LR.steps, { rc: RC.steps, lr: LR.steps });

    // calories: a real cut, and it sits IN the gap rather than at either end
    t.eq('guard: maintenance for this body is 2570', lr.tdee, 2570);
    t.eq('lean recomp eats ~12% under maintenance', LR.kcal, 2260);
    t.ok('which is below Tone up', LR.kcal < RC.kcal, { lr: LR.kcal, rc: RC.kcal });
    t.ok('and above Shred', LR.kcal > SH.kcal, { lr: LR.kcal, sh: SH.kcal });
    t.eq('protein stays on the 2.2 g/kg tier', LR.protein, RC.protein);
    t.eq('which is Shred\'s tier too', LR.protein, SH.protein);
    /* NOT weight-stable: the scale is meant to move, so calorieCheck(), the
       weight chart's colour and the projection all treat it as a cut. */
    t.ok('it is not a weight-stable goal', !LR.stable, LR);
    t.ok('where Tone up is', RC.stable, RC);

    /* THE TABLE REFACTOR MUST HAVE MOVED NOTHING ELSE. Replacing a nested
       ternary is exactly the change that silently reprices another goal. */
    t.eq('Tone up still eats at maintenance', RC.kcal, 2570);
    t.eq('Shred is unchanged', SH.kcal, 1950);
    t.eq('Lose fat is unchanged', lr.g.lose.kcal, 2070);
    t.eq('Strong core is unchanged', lr.g.core.kcal, 2440);
    t.eq('Maintain is unchanged', lr.g.maintain.kcal, 2570);
    t.eq('and Build muscle is unchanged', lr.g.gain.kcal, 2830);
    /* An unknown goal must land where the old else landed — on fat loss —
       rather than throwing, and an INHERITED key must not read as a rule. */
    t.eq('an unknown goal falls back to the fat-loss deficit', lr.junkKcal, 2070);
    t.eq('and so does an inherited key', lr.inheritedKcal, 2070);

    /* A PROMISE IN UI TEXT IS A SPECIFICATION, and this tip's first version
       claimed the rep volume while the code delivered the lowest in the app.
       Every number in it is pinned against the code that produces it. */
    t.ok('the tip renders', !!lr.tipText, lr.tipText);
    t.ok('naming the ~12% deficit it actually runs', /~12% below maintenance/.test(lr.tipText), lr.tipText);
    t.ok('the 2.2 g/kg protein it actually prescribes', /2\.2 g\/kg/.test(lr.tipText), lr.tipText);
    t.ok('and that the session is unchanged rep for rep', /rep for rep/.test(lr.tipText), lr.tipText);
    /* It must NOT claim the thing that was removed: the first version promised
       "an extra conditioning slot", which the measurement showed was the very
       thing costing the reps. */
    t.ok('it does not claim an extra conditioning slot', !/conditioning slot/.test(lr.tipText), lr.tipText);
  }

  /* ---- A DERIVED HABIT IS A VERDICT AGAINST A TARGET (v364) -------------
     v346 fixed this for the setters that move a target's NUMBER and wrote the
     rule down: every writer that moves one of these calls the sync rather than
     remembering which habit it touched. Three writers that move a target were
     never wired, and only the onboarding wizard was.
     Measured before the fix: 7,500 steps on Maintain (7,000) is a legitimate
     tick; switching goal raises the bar to 10,000 and the tick STAYED ON. A
     wrong tick extends the nutrition streak by a day and can unlock Perfect
     Day, so it is not cosmetic. */
  {
    const dh = await page.evaluate(() => {
      const o = {};
      const base = g => {
        Object.assign(STATE.profile, { age: 41, heightCm: 178, sex: 'male', activity: 1.45, bodyFat: 28, goal: g, unit: 'in' });
        Object.assign(STATE.nutrition, { age: 41, heightCm: 178, sex: 'male', activity: 1.45, weightKg: 86, goal: g });
        delete STATE.nutrition.proteinTarget; delete STATE.profile.timelineWeeks;
        delete STATE.profile.goalWeightLb; delete STATE.profile.goalBodyFat;
        const t = nutToday(); t.steps = 0; t.water = 0; t.food = []; t.habits = {};
      };
      const st = () => ({ target: stepTarget(), tick: !!(nutToday().habits || {}).steps });
      const pr = () => ({ target: proteinTargetG(), tick: !!(nutToday().habits || {}).protein });

      // A — the goal moves the STEP target
      base('maintain'); nutToday().steps = 7500; syncDerivedHabits();
      o.A = { before: st() }; setNutGoal('leanrecomp'); o.A.after = st();
      /* BOTH DIRECTIONS. A fix that only ever un-ticked would satisfy every
         assertion about the raise and break the athlete who lowers the bar. */
      setNutGoal('maintain'); o.A.back = st();

      // B — the goal moves the PROTEIN tier
      base('lose'); nutToday().food = [{ name: 'x', kcal: 800, p: 160, c: 0, f: 0, meal: 'lunch', at: 1 }];
      syncDerivedHabits(); o.B = { before: pr() };
      setNutGoal('leanrecomp'); o.B.after = pr();
      setNutGoal('lose'); o.B.back = pr();

      // C — the GOAL WEIGHT sets the pace, and the pace flips the timeline tier
      base('lose'); STATE.profile.timelineWeeks = 24; STATE.profile.goalWeightLb = 185;
      nutToday().steps = 10500;
      nutToday().food = [{ name: 'x', kcal: 800, p: 160, c: 0, f: 0, meal: 'lunch', at: 1 }];
      syncDerivedHabits();
      o.C = { before: { step: st(), prot: pr() } };
      const el = document.createElement('input'); el.id = 'g-weight'; el.value = '150';
      document.body.appendChild(el);
      try { saveGoalWeight(); } finally { el.remove(); }
      o.C.after = { step: st(), prot: pr() };

      // D — the BODY LEVEL path reaches the same field through recomputeTargetWeight()
      base('lose'); STATE.profile.timelineWeeks = 24; STATE.profile.goalBodyFat = 12;
      nutToday().steps = 10500; syncDerivedHabits(); o.D = { before: st() };
      recomputeTargetWeight(); o.D.after = st();

      /* E — THE FLOOR. A setter that moves nothing must leave a legitimate tick
         alone; a sync that always un-ticked would pass every case above. */
      base('leanrecomp'); nutToday().steps = 11000; syncDerivedHabits(); o.E = { before: st() };
      setNutGoal('leanrecomp'); o.E.after = st();

      /* F — and with nothing logged today there is no derived habit to correct,
         so the sync must not create an empty day row that travels in a backup. */
      base('lose'); delete nut().days[todayISO()];
      syncDerivedHabits();
      o.F = { madeRow: !!(nut().days && nut().days[todayISO()]) };
      return o;
    });

    t.eq('guard: 7,500 steps legitimately ticks a 7,000 target', dh.A.before, { target: 7000, tick: true });
    t.eq('switching goal raises the bar to 10,000', dh.A.after.target, 10000);
    t.eq('and the step tick clears with it', dh.A.after.tick, false);
    t.eq('switching back lowers the bar again', dh.A.back.target, 7000);
    t.eq('and the tick returns', dh.A.back.tick, true);

    t.eq('guard: 160 g legitimately ticks a 155 g target', dh.B.before, { target: 155, tick: true });
    t.eq('switching goal raises protein to 180 g', dh.B.after.target, 180);
    t.eq('and the protein tick clears', dh.B.after.tick, false);
    t.eq('switching back lowers it', dh.B.back.target, 155);
    t.eq('and that tick returns too', dh.B.back.tick, true);

    /* The goal weight is the writer nobody would think of: it does not name a
       habit or a target, it sets the PACE — and the pace decides both. */
    t.eq('guard: a gentle goal weight gives 10,000 steps and 155 g',
      { s: dh.C.before.step.target, p: dh.C.before.prot.target }, { s: 10000, p: 155 });
    t.eq('guard: and both were legitimately ticked',
      { s: dh.C.before.step.tick, p: dh.C.before.prot.tick }, { s: true, p: true });
    t.eq('tightening the goal weight raises the step bar to 12,000', dh.C.after.step.target, 12000);
    t.eq('and the protein bar to 180 g', dh.C.after.prot.target, 180);
    t.eq('the step tick clears', dh.C.after.step.tick, false);
    t.eq('and so does the protein tick', dh.C.after.prot.tick, false);

    /* Fixing the sheet alone would have left half the class alive: a body-LEVEL
       tap reaches the same field by a different door. */
    t.eq('guard: the body-level path starts at 10,000 and ticked',
      dh.D.before, { target: 10000, tick: true });
    t.eq('recomputing from the body-fat target raises the bar', dh.D.after.target, 12000);
    t.eq('and clears the tick', dh.D.after.tick, false);

    t.eq('a setter that moves nothing leaves a real tick alone', dh.E.after, dh.E.before);
    t.eq('guard: and that tick was genuinely on', dh.E.before.tick, true);
    /* With nothing logged there is no derived habit to correct, and creating a
       day row here would add an empty entry to every backup. */
    t.ok('the sync does not create a day row out of nothing', !dh.F.madeRow, dh.F);

    /* THE CLASS, NOT THE INSTANCE. The checks above name the writers I happened
       to think of, and that is exactly how clearGoalWeight() was missed in the
       same round that fixed its twin — found only by sweeping every
       zero-argument writer in the app. This drives each writer that can move
       one of these targets and asserts the habit FOLLOWED.

       EACH CASE BUILDS A STATE WHERE ITS OWN MOVE IS DETECTABLE. The first
       version used one setup for all of them, which left the protein habit
       already OFF — so a mutant deleting setProteinTarget()'s sync changed
       nothing observable and escaped. A guard that cannot fire in the case you
       tested is not tested. */
    const cls = await page.evaluate(() => {
      /* steps: `have` against a target the case moves. protein: the same. */
      const setup = (steps, prot, extra) => {
        Object.assign(STATE.profile, { age: 41, heightCm: 178, sex: 'male', activity: 1.45,
          bodyFat: 28, goal: 'lose', unit: 'in', goalWeightLb: 150, timelineWeeks: 24 });
        Object.assign(STATE.nutrition, { age: 41, heightCm: 178, sex: 'male', activity: 1.45,
          weightKg: 86, goal: 'lose' });
        delete STATE.nutrition.proteinTarget; delete STATE.profile.goalBodyFat;
        if (extra) extra();
        const t = nutToday();
        t.steps = steps; t.water = 10;
        t.food = [{ name: 'x', kcal: 800, p: prot, c: 0, f: 0, meal: 'lunch', at: 1 }];
        t.habits = {}; syncDerivedHabits();
      };
      const tick = k => !!(nutToday().habits || {})[k];
      const o = { cases: [] };
      const run = (name, steps, prot, fn, watch, extra) => {
        setup(steps, prot, extra);
        const b = { tick: tick(watch), s: stepTarget(), p: proteinTargetG() };
        let err = null;
        try { fn(); } catch (e) { err = String(e.message); }
        const a = { tick: tick(watch), s: stepTarget(), p: proteinTargetG() };
        const want = watch === 'steps' ? (stepEquivalent() >= stepTarget())
          : ((nutToday().food || []).reduce((x, f) => x + (+f.p || 0), 0) >= proteinTargetG());
        o.cases.push({ name, watch, err, before: b, after: a,
          movedTarget: watch === 'steps' ? b.s !== a.s : b.p !== a.p,
          flipped: b.tick !== a.tick, agrees: a.tick === want });
      };
      /* Aggressive baseline (goal weight 150 on a 24-week timeline): 12,000
         steps and 180 g. Each case below moves its own watched target ACROSS
         the athlete's logged value, so the tick must flip — which is what makes
         it able to catch a missing sync at all. */
      run('setNutGoal', 11000, 190, () => setNutGoal('maintain'), 'steps');
      run('saveGoalWeight', 11000, 190, () => {
        const e = document.createElement('input'); e.id = 'g-weight'; e.value = '185';
        document.body.appendChild(e); try { saveGoalWeight(); } finally { e.remove(); } }, 'steps');
      run('clearGoalWeight', 11000, 190, () => clearGoalWeight(), 'steps');
      /* Starts GENTLE so the recompute can make it aggressive — from 150 the
         derived weight barely moves and nothing is measurable. */
      run('recomputeTargetWeight', 11000, 190, () => {
        STATE.profile.goalWeightLb = 185; STATE.profile.goalBodyFat = 10;
        recomputeTargetWeight(); }, 'steps', () => { STATE.profile.goalWeightLb = 185; });
      /* setSteps moves the VALUE, not the target — the same requirement seen
         from the other side, and the sync still has to follow. */
      run('setSteps', 11000, 190, () => setSteps(20000), 'steps');
      /* protein: 190 g against the aggressive 180 g starts TICKED, and a
         hand-set 200 g must un-tick it. */
      run('setProteinTarget', 11000, 190, () => setProteinTarget(200), 'protein');
      /* The hand-set 200 g goes in the SETUP, so the case itself is only the
         CLEAR — otherwise the tick is off and on again inside one case and the
         before/after snapshot shows no flip, which cannot discriminate. */
      run('clearProteinTarget', 11000, 190, () => clearProteinTarget(), 'protein',
        () => { STATE.nutrition.proteinTarget = 200; });
      /* A goal change on a NON-aggressive athlete: lose is 155 g, lean recomp
         is 180 g, and 160 g logged sits between them. */
      run('setNutGoal(protein)', 11000, 160, () => setNutGoal('leanrecomp'), 'protein',
        () => { delete STATE.profile.timelineWeeks; });
      return o;
    });
    t.eq('every writer that can move a derived target was driven', cls.cases.length, 8, cls);
    /* GUARD: a sweep where nothing moved proves nothing. Each case must have
       genuinely shifted the target it is watching, and flipped the tick. */
    /* THE FLIP IS THE GUARD. A case where the tick does not change cannot
       catch a missing sync at all — which is how the first version of this
       sweep let setProteinTarget's mutant through. Whether the TARGET or the
       logged VALUE moved is beside the point; crossing is what matters. */
    const noFlip = cls.cases.filter(c => !c.flipped).map(c => c.name);
    t.eq('guard: every case crosses the athlete\'s logged value', noFlip, [],
      JSON.stringify(cls.cases.filter(c=>!c.flipped).map(c=>({n:c.name,w:c.watch,b:c.before,a:c.after,e:c.err}))));
    const threw = cls.cases.filter(c => c.err).map(c => c.name + ':' + c.err);
    t.eq('guard: and none of them threw', threw, [], cls);
    const disagree = cls.cases.filter(c => !c.agrees).map(c => c.name + ':' + c.watch);
    t.eq('no writer leaves a habit disagreeing with its own target', disagree, [], cls);
  }

  /* ---- EVERY GOAL EXPLAINS ITSELF (v364) --------------------------------
     GOAL_NOTE is read as `GOAL_NOTE[g]||''`, so a goal missing from it renders
     the picker button selected with NOTHING under it. v363 shipped exactly
     that: the goal went into GOALS, the picker rendered it from the registry
     correctly, and the sentence describing it was blank. */
  {
    const gn = await page.evaluate(() => {
      const o = {};
      o.ids = GOALS.map(g => g[0]);
      o.blank = o.ids.filter(g => !(typeof GOAL_NOTE[g] === 'string' && GOAL_NOTE[g].trim()));
      o.orphan = Object.keys(GOAL_NOTE).filter(g => o.ids.indexOf(g) < 0);
      /* And the validator has to COMPLAIN, which "the validator is clean"
         cannot show. Break the data in front of it, require the specific
         message, restore. console.error is muted — the harness counts one
         as a page failure. */
      const oe = console.error; const seen = [];
      console.error = (...a) => seen.push(a.join(' '));
      const keep = GOAL_NOTE[o.ids[0]];
      try {
        delete GOAL_NOTE[o.ids[0]];
        seen.length = 0; validateData();
        o.complainsMissing = seen.join(' ').indexOf('no note for goal "' + o.ids[0] + '"') >= 0;
        GOAL_NOTE[o.ids[0]] = keep;
        GOAL_NOTE.helicopter = 'x';
        seen.length = 0; validateData();
        o.complainsOrphan = /note for "helicopter", which is not a goal/.test(seen.join(' '));
        delete GOAL_NOTE.helicopter;
        seen.length = 0; validateData();
        o.cleanAfter = seen.length;
      } catch (e) { o.err = String(e.message); GOAL_NOTE[o.ids[0]] = keep; delete GOAL_NOTE.helicopter; }
      console.error = oe;
      return o;
    });
    t.eq('every goal has a note the picker can show', gn.blank, []);
    /* Checked BOTH directions, the lockstep TESTS/TEST_DEFAULTS gets: a note
       for a goal that no longer exists is dead copy nobody will ever see. */
    t.eq('and no note describes a goal that does not exist', gn.orphan, []);
    t.ok('the validator complains about a missing note', gn.complainsMissing, gn);
    t.ok('and about an orphaned one', gn.complainsOrphan, gn);
    t.eq('and is clean once both are restored', gn.cleanAfter, 0, gn);
  }

  /* ---- THE DIET-BREAK CLOCK KNEW TWO OF THE THREE CUTS (v365) -----------
     noteGoalPhase() was a hand-written `g==='shred'||g==='lose'`, and it went
     stale the moment a seventh goal arrived. Measured against maintenance:
     shred 24.1%, lose 19.5%, LEAN RECOMP 12.1%, core 5.1%. Lean recomp runs a
     real cut and the clock never started — and switching to it from a cut
     WIPED the clock, so an athlete ten weeks in read zero and the twelve-week
     guardrail was pushed indefinitely into the future while they carried on
     eating at a deficit. */
  {
    const db = await page.evaluate(() => {
      const o = {};
      Object.assign(STATE.profile, { age: 41, heightCm: 178, sex: 'male', activity: 1.45, bodyFat: 28 });
      Object.assign(STATE.nutrition, { age: 41, heightCm: 178, sex: 'male', activity: 1.45, weightKg: 86 });
      delete STATE.nutrition.kcalTarget; delete STATE.nutrition.proteinTarget;
      const wks = n => localISO(new Date(Date.now() - 1000 * 60 * 60 * 24 * 7 * n));

      /* How far under maintenance each goal actually eats — the evidence the
         membership list is drawn from, rather than a restated opinion. */
      o.pct = {};
      GOALS.map(g => g[0]).forEach(g => {
        STATE.profile.goal = g; STATE.nutrition.goal = g;
        const p = kcalTargetPreview();
        o.pct[g] = Math.round((1 - p.target / p.tdee) * 1000) / 10;
      });

      // the clock starts on every deficit goal and on no other
      o.starts = {};
      GOALS.map(g => g[0]).forEach(g => {
        delete STATE.profile._shredStart; delete STATE.profile._everDeficit;
        setNutGoal(g); o.starts[g] = !!STATE.profile._shredStart;
      });

      // a cut in progress SURVIVES the switch — the half that was worse
      STATE.profile._shredStart = wks(10); STATE.profile._everDeficit = 1;
      setNutGoal('lose'); const before = shredWeeks();
      setNutGoal('leanrecomp');
      o.carried = { before, after: shredWeeks() };
      /* …and a genuine maintenance phase still CLEARS it. Without this, a fix
         that simply never reset would make the banner unclearable — which is
         the defect the function's own comment records. */
      setNutGoal('recomp');
      o.clearedByMaintenance = { weeks: shredWeeks(), start: STATE.profile._shredStart };

      // the banner itself
      STATE.profile._shredStart = wks(14); STATE.profile._everDeficit = 1;
      setNutGoal('leanrecomp'); o.banner14 = (dietBreakBanner() || '').length > 0;
      STATE.profile._shredStart = wks(4); setNutGoal('leanrecomp');
      o.banner4 = (dietBreakBanner() || '').length > 0;

      /* THE FLOOR, AND IT IS THE POINT OF THE ROUND. goalSlots() also tests
         shred||lose, and lean recomp is excluded THERE on purpose — that swap
         is what cost it the rep volume it exists to keep (v363). Two lists
         that coincide are not one list, and sharing them would silently undo
         the previous round. */
      const cardio = g => {
        STATE.profile.goal = g; let c = 0, n = 0;
        for (let p = 0; p < 120; p += 3) {
          const s = buildSession(p);
          (s.main || []).concat(s.finisher ? [s.finisher] : []).forEach(m => {
            if (!m || !EX[m.exId]) return; n++;
            if (EX[m.exId].region === 'cardio') c++;
          });
        }
        return Math.round(c / n * 100);
      };
      o.cardioPct = { recomp: cardio('recomp'), leanrecomp: cardio('leanrecomp'),
        lose: cardio('lose'), shred: cardio('shred') };
      o.slotsSourceShared = /DEFICIT_GOALS|deficitGoal/.test(String(goalSlots));
      return o;
    });

    /* The membership list is drawn from measured deficits, so pin them: a goal
       silently repriced would move which side of the line it belongs on. */
    t.eq('guard: shred and lose really are deep cuts',
      { s: db.pct.shred > 20, l: db.pct.lose > 15 }, { s: true, l: true }, db.pct);
    t.eq('guard: lean recomp really is a cut too', db.pct.leanrecomp > 8, true, db.pct);
    t.eq('guard: and core really is only just under maintenance', db.pct.core < 8, true, db.pct);
    t.eq('guard: while the stable goals eat at maintenance',
      { r: db.pct.recomp, m: db.pct.maintain }, { r: 0, m: 0 }, db.pct);

    t.eq('the deficit clock starts on every real cut, and on nothing else', db.starts,
      { lose: true, shred: true, recomp: false, leanrecomp: true, core: false,
        maintain: false, gain: false });

    t.eq('guard: the athlete really was ten weeks into a cut', db.carried.before, 10);
    /* The worse half: switching to another cut must not restart the clock. */
    t.eq('switching to lean recomp carries the cut, not resets it', db.carried.after, 10);
    /* …but a real maintenance phase still ends it, or the banner can never be
       cleared and every maintenance week counts as deficit time. */
    t.eq('a maintenance phase still clears it', db.clearedByMaintenance.weeks, 0);
    t.eq('and drops the stamp entirely', db.clearedByMaintenance.start, null);

    t.ok('the diet-break banner fires on lean recomp at 14 weeks', db.banner14, db);
    t.ok('but not at 4 weeks', !db.banner4, db);

    /* THE FLOOR. Sharing the list with goalSlots() would give lean recomp
       Shred's cardio slot and silently undo v363's whole point. */
    t.eq('lean recomp still has Tone up\'s cardio share', db.cardioPct.leanrecomp, db.cardioPct.recomp);
    t.ok('which is lower than the fat-loss goals\'',
      db.cardioPct.leanrecomp < db.cardioPct.lose, db.cardioPct);
    t.eq('guard: and lose and shred really do carry more', db.cardioPct.lose, db.cardioPct.shred);
    t.ok('the slot builder does not read the deficit list', !db.slotsSourceShared, db);

    /* ---- AND WHICH MAINTENANCE GOAL THE BREAK OFFERS -------------------
       The banner exists to protect muscle, and it offered `maintain` to
       everybody — which drops protein from 2.2 g/kg to 1.8. Measured: a shred
       or lean-recomp athlete went 180 g to 155 g at exactly the moment protein
       matters most. Both candidates are weight-stable, so either clears the
       clock; the one that KEEPS the tier is the right offer. */
    const brk = await page.evaluate(() => {
      const o = { offers: {}, protein: {} };
      Object.assign(STATE.profile, { age: 41, heightCm: 178, sex: 'male', activity: 1.45, bodyFat: 28 });
      Object.assign(STATE.nutrition, { age: 41, heightCm: 178, sex: 'male', activity: 1.45, weightKg: 86 });
      const wks = n => localISO(new Date(Date.now() - 1000 * 60 * 60 * 24 * 7 * n));
      const protOf = g => {
        const a = STATE.profile.goal, b = STATE.nutrition.goal;
        STATE.profile.goal = g; STATE.nutrition.goal = g;
        delete STATE.nutrition.proteinTarget;
        const v = proteinTargetCalc();
        STATE.profile.goal = a; STATE.nutrition.goal = b;
        return v;
      };
      ['leanrecomp', 'shred', 'lose', 'core'].forEach(g => {
        STATE.profile.goal = g; STATE.nutrition.goal = g;
        delete STATE.nutrition.proteinTarget;
        STATE.profile._shredStart = wks(14); STATE.profile._everDeficit = 1;
        const h = dietBreakBanner() || '';
        const to = (h.match(/setNutGoal\('(\w+)'\)/) || [])[1] || null;
        o.offers[g] = to;
        o.protein[g] = to ? { from: proteinTargetCalc(), to: protOf(to) } : null;
        if (g === 'leanrecomp') {
          o.copy = { sameTraining: /same training/i.test(h),
            keepProtein: /keep the protein/i.test(h),
            namesGoal: /Switch to [^<]*Tone up/.test(h) };
        }
      });
      /* Tapping it must actually work: switch the goal, clear the clock, and
         make the banner go away — otherwise it nags forever. */
      STATE.profile.goal = 'leanrecomp'; STATE.nutrition.goal = 'leanrecomp';
      STATE.profile._shredStart = wks(14); STATE.profile._everDeficit = 1;
      const to = dietBreakTarget();
      setNutGoal(to);
      o.afterTap = { goal: STATE.profile.goal, weeks: shredWeeks(),
        stable: weightStableGoal(to), bannerGone: (dietBreakBanner() || '') === '' };
      return o;
    });

    /* The 2.2 g/kg goals break to Tone up, which holds the tier… */
    t.eq('a lean-recomp break goes to Tone up, not Maintain', brk.offers.leanrecomp, 'recomp');
    t.eq('and so does a shred break', brk.offers.shred, 'recomp');
    /* …while the 1.8 goals keep the plain maintenance offer, which already
       held THEIR tier. A fix that sent everybody to Tone up would pass every
       assertion above and change two goals that were never wrong. */
    t.eq('a fat-loss break still goes to Maintain', brk.offers.lose, 'maintain');
    t.eq('and so does a core break', brk.offers.core, 'maintain');
    /* THE REQUIREMENT ITSELF, not the goal name: protein must not drop. */
    Object.keys(brk.protein).forEach(g => {
      t.ok('the ' + g + ' break keeps its protein tier',
        brk.protein[g] && brk.protein[g].to >= brk.protein[g].from, brk.protein[g]);
    });
    t.eq('guard: and the high tier really is higher than the low one',
      brk.protein.leanrecomp.from > brk.protein.lose.from, true, brk.protein);

    t.eq('tapping it switches the goal', brk.afterTap.goal, 'recomp');
    t.eq('clears the deficit clock', brk.afterTap.weeks, 0);
    t.ok('lands on a weight-stable goal', brk.afterTap.stable, brk.afterTap);
    t.ok('and the banner goes away', brk.afterTap.bannerGone, brk.afterTap);

    /* A PROMISE IN UI TEXT IS A SPECIFICATION. "Same training" was never true
       across every goal — the rep multipliers differ — so the copy claims only
       what the switch actually delivers, and names the goal it switches to. */
    t.ok('the copy no longer claims the training is unchanged', !brk.copy.sameTraining, brk.copy);
    t.ok('it claims the protein is kept, which is true', brk.copy.keepProtein, brk.copy);
    t.ok('and the button names the goal it switches to', brk.copy.namesGoal, brk.copy);
  }


  /* ===================================================================
     v366 — ONE GATE FOR EVERY TRUE MAX EFFORT.

     The baseline battery's own screen promises that a test to failure "stays
     locked until you have spoken to a doctor". Measured on an athlete who
     declared a heart condition and was not cleared: the battery refused, and
     `Hold to failure` started anyway — five live rows, an open-ended clock,
     and nothing on screen mentioning the health check. `gripmax` ("one
     all-out hang") was ungated too.

     THE FLOORS ARE WHAT KEEP THIS A GATE RATHER THAN A DELETION: an ordinary
     timed hang must never be blocked, and a cleared athlete must get every
     one of them back. A fix that blocked everybody satisfies every assertion
     about the flagged athlete and breaks the app for the athletes it is not
     for. */
  {
    const states = [
      ['flagged and uncleared', () => { STATE.profile.parq = ['heart']; STATE.profile.parqDone = true; STATE.profile.medCleared = false; }],
      ['screen never answered', () => { STATE.profile.parq = []; STATE.profile.parqDone = false; STATE.profile.medCleared = false; }],
      ['flagged then cleared', () => { STATE.profile.parq = ['heart']; STATE.profile.parqDone = true; STATE.profile.medCleared = true; }],
      ['nothing flagged', () => { STATE.profile.parq = []; STATE.profile.parqDone = true; STATE.profile.medCleared = false; }],
    ];
    const seen = {};
    for (const [label, setup] of states) {
      await seedAthlete(page, setup);
      seen[label] = await page.evaluate(() => {
        const o = { safe: safeMode() };
        assessState = null; openAssessment(); o.battery = !!assessState; closeSheet();
        startHoldTest('plank');
        o.hold = !!(typeof _ht !== 'undefined' && _ht);
        if (typeof _ht !== 'undefined' && _ht) { clearInterval(_ht.iv); _ht = null; }
        closeSheet();
        INTV = null; startSpecialFormat('gripmax'); o.gripmax = !!INTV; if (INTV) hiitQuit();
        INTV = null; startSpecialFormat('grip30'); o.grip30 = !!INTV; if (INTV) hiitQuit();
        openHoldTests();
        const sh = document.getElementById('sheet');
        o.lockNote = !!sh.querySelector('[data-holdlock]');
        o.route = /Answer the health check|cleared by a doctor/.test(sh.innerText);
        o.liveRows = sh.querySelectorAll('[data-hold]').length;
        o.lockedRows = sh.querySelectorAll('[data-holdlocked]').length;
        closeSheet();
        openGrip();
        const g = document.getElementById('sheet');
        const b = g.querySelector('[data-fmt="gripmax"]');
        const b2 = g.querySelector('[data-fmt="grip30"]');
        o.gripLock = !!(b && /🔒/.test(b.innerText));
        o.grip30Lock = !!(b2 && /🔒/.test(b2.innerText));
        closeSheet();
        return o;
      });
    }
    /* Guard first: the two blocked states really are blocked and the two open
       ones really are open, or every assertion below passes on one state. */
    t.eq('guard: safe mode is on for exactly the two flagged states',
      states.map(([l]) => seen[l].safe), [true, true, false, false], seen);

    ['flagged and uncleared', 'screen never answered'].forEach(l => {
      t.ok('the battery refuses (' + l + ')', !seen[l].battery, seen[l]);
      t.ok('the hold to failure refuses (' + l + ')', !seen[l].hold, seen[l]);
      t.ok('the max hang test refuses (' + l + ')', !seen[l].gripmax, seen[l]);
      /* A LOCKED BUTTON WITH NO SENTENCE IS A DEAD END. */
      t.ok('the hold sheet says why (' + l + ')', seen[l].lockNote, seen[l]);
      t.ok('and offers the screen that unlocks it (' + l + ')', seen[l].route, seen[l]);
      t.eq('no hold row is tappable (' + l + ')', seen[l].liveRows, 0, seen[l]);
      t.eq('the past numbers still show (' + l + ')', seen[l].lockedRows, 5, seen[l]);
      t.ok('the grip picker marks the max test locked (' + l + ')', seen[l].gripLock, seen[l]);
      /* THE FLOOR: an ordinary timed hang is not a max effort. */
      t.ok('an ordinary hang block still starts (' + l + ')', seen[l].grip30, seen[l]);
      t.ok('and is not marked locked (' + l + ')', !seen[l].grip30Lock, seen[l]);
    });
    ['flagged then cleared', 'nothing flagged'].forEach(l => {
      t.ok('the battery starts (' + l + ')', seen[l].battery, seen[l]);
      t.ok('the hold to failure starts (' + l + ')', seen[l].hold, seen[l]);
      t.ok('the max hang test starts (' + l + ')', seen[l].gripmax, seen[l]);
      t.ok('and nothing is marked locked (' + l + ')',
        !seen[l].lockNote && !seen[l].gripLock && seen[l].liveRows === 5, seen[l]);
    });

    /* The rule lives in ONE place. Four paths had copied the same five lines
       by hand and two never got them, so the check is written against the
       CLASS: every max-effort entry point calls the one gate, and the gate
       itself fails closed. */
    const wiring = await page.evaluate(() => {
      const src = [...document.querySelectorAll('script:not([src])')]
        .map(x => x.textContent).sort((a, b) => b.length - a.length)[0];
      const body = name => {
        const i = src.indexOf('function ' + name + '(');
        if (i < 0) return null;
        const j = src.indexOf('\nfunction ', i + 1);
        return src.slice(i, j < 0 ? i + 4000 : j);
      };
      const names = ['openAssessment', 'startForceTrain', 'startCombatCircuit', 'startHoldTest', 'startSpecialFormat'];
      const o = { calls: {}, missing: [] };
      names.forEach(n => {
        const b = body(n);
        if (b === null) { o.missing.push(n); return; }
        o.calls[n] = /maxEffortBlocked\(\)/.test(b);
      });
      /* The gate must not be re-derived anywhere: a second copy of the
         route-to-clearance decision is a second place for it to drift. Anchor
         on the ROUTING line, not on a bare safeMode() read — safeMode() is
         legitimately read elsewhere (prescribe() eases the session, the
         fasting card adds a warning) and counting those flags correct code. */
      o.routings = (src.match(/if\(!parqDone\(\)\)openHealthCheck\(\); ?else openClearance\(\);/g) || []).length;
      o.gripmaxDeclaresMax = SPECIAL_FORMATS.gripmax.max === true;
      o.grip30DeclaresMax = SPECIAL_FORMATS.grip30.max === true;
      return o;
    });
    t.eq('guard: every max-effort entry point was found in the source', wiring.missing, []);
    Object.keys(wiring.calls).forEach(n => {
      t.ok(n + '() asks the one gate', wiring.calls[n], wiring.calls);
    });
    t.eq('and the route-to-clearance decision exists exactly once', wiring.routings, 1);
    t.ok('the max hang test declares itself a max effort', wiring.gripmaxDeclaresMax);
    t.ok('and an ordinary hang block does not', !wiring.grip30DeclaresMax);

    /* FAILS CLOSED. A safety predicate that throws answers "blocked", never
       "fine" — the rule this file opens with, on a new gate. */
    const closed = await page.evaluate(() => {
      const real = window.parqDone;
      let blocked = null;
      try {
        parqDone = () => { throw new Error('boom'); };
        blocked = maxEffortBlocked();
      } finally { parqDone = real; }
      return { blocked, restored: maxEffortBlocked() === false };
    });
    t.ok('the gate blocks when the health check throws', closed.blocked === true, closed);
    t.ok('guard: and lets a clean athlete through once restored', closed.restored, closed);
  }


  /* v366 (same round) — THE DEAD HANG NEEDS A BAR AND NOTHING ASKED.
     Four of the five holds need no kit, so the one that does sat in the menu
     unmarked. Measured on an athlete with an empty gear list: the row rendered
     and the timer STARTED on a movement they cannot perform. startHoldTest()
     ran safeSwap() and never hasGearFor() — the question startForceTrain()
     skipped in v322, one picking path over.

     IT NAMES THE KIT RATHER THAN SUBSTITUTING: a hold test measures ONE
     movement, and a stand-in measures a different capacity under the same
     label (v320). THE FLOOR is the athlete who owns a bar — a fix that simply
     dropped the row satisfies every assertion below and deletes a real test. */
  {
    const kit = {};
    for (const [label, gear] of [['no bar', []], ['owns a bar', ['bar', 'bench', 'dip']]]) {
      await seedAthlete(page, new Function('', 'STATE.profile.gear=' + JSON.stringify(gear) +
        ';STATE.profile.hasBar=' + (gear.length ? 'true' : 'false') + ';save();'));
      kit[label] = await page.evaluate(() => {
        const o = { owns: hasGearFor('deadhang') };
        openHoldTests();
        const sh = document.getElementById('sheet');
        o.tappable = [...sh.querySelectorAll('[data-hold]')].map(b => b.getAttribute('data-hold'));
        o.needsKit = [...sh.querySelectorAll('[data-holdkit]')].map(b => b.getAttribute('data-holdkit'));
        o.namesTheKit = /needs Pull-?up bar/i.test(sh.innerText);
        o.note = !!sh.querySelector('[data-holdkitnote]');
        closeSheet();
        startHoldTest('hang');
        o.started = !!(typeof _ht !== 'undefined' && _ht);
        o.movement = (typeof _ht !== 'undefined' && _ht) ? _ht.exId : null;
        if (typeof _ht !== 'undefined' && _ht) { clearInterval(_ht.iv); _ht = null; }
        closeSheet();
        return o;
      });
    }
    t.eq('guard: the two athletes really differ on the bar',
      [kit['no bar'].owns, kit['owns a bar'].owns], [false, true], kit);

    t.ok('with no bar the dead hang will not start', !kit['no bar'].started, kit['no bar']);
    t.eq('and it is not offered as a tappable row', kit['no bar'].tappable.indexOf('hang'), -1, kit['no bar']);
    t.eq('it is listed with what it needs instead', kit['no bar'].needsKit, ['hang'], kit['no bar']);
    t.ok('and the kit is NAMED, not merely marked', kit['no bar'].namesTheKit, kit['no bar']);
    t.ok('the sheet says a hold is listed rather than swapped', kit['no bar'].note, kit['no bar']);
    /* NOT SUBSTITUTED: a stand-in would measure a different capacity. */
    t.eq('nothing was substituted for it', kit['no bar'].movement, null, kit['no bar']);
    /* THE FLOOR: the four kit-free holds are untouched. */
    t.eq('the four kit-free holds are still offered',
      kit['no bar'].tappable, ['plank', 'wallsit', 'side', 'hollow'], kit['no bar']);

    t.ok('an athlete with a bar still gets the dead hang', kit['owns a bar'].started, kit['owns a bar']);
    t.eq('and it really is the dead hang', kit['owns a bar'].movement, 'deadhang', kit['owns a bar']);
    t.eq('with all five rows tappable', kit['owns a bar'].tappable.length, 5, kit['owns a bar']);
    t.ok('and nothing is listed as missing kit',
      !kit['owns a bar'].needsKit.length && !kit['owns a bar'].note, kit['owns a bar']);
  }


  /* ===================================================================
     v367 — A CHANGE OF RULER IS NOT A CHANGE OF STRENGTH, in the hold
     tracker this time. safeSwap() protects a flagged joint here exactly as it
     does in the baseline battery (v320), and the number coming back then
     measures a DIFFERENT movement — shoulder turns the Dead Hang into a Bird
     Dog, knee turns the Wall Sit into a Glute Bridge. The record carried only
     the test id, so the two mixed.

     Measured end to end before the fix: a Bird Dog held 5:00 while the
     shoulder was flagged, then a real 45-second Dead Hang six weeks later,
     and the row read "Dead Hang · Best 5:00 · last 45s · -255s on the one
     before". */
  {
    /* Driven through the REAL route both times — stopHoldTest() is what an
       athlete's last tap reaches, and calling logHold() directly is what let
       v320's own writer bug survive four checks. */
    const driveTwo = `(lims) => {
      STATE.profile.limitations = lims; STATE.holdLog = []; STATE.logs = {}; save();
      const hold = secs => { startHoldTest('hang'); if (!_ht) return false;
        _ht.mode = 'run'; _ht.elapsed = secs; stopHoldTest(); closeSheet(); return true; };
      if (!hold(60)) return null;
      STATE.holdLog[0].at = 1;
      STATE.holdLog[0].date = localISO(new Date(Date.now() - 864e5 * 30));
      hold(75);
      PROGRESS_TAB = 'strength'; go('progress'); render();
      const kv = document.querySelector('[data-holdrow="hang"]');
      return { records: STATE.holdLog.map(r => ({ exId: r.exId, secs: r.secs })),
               best: holdBest('hang'), trend: holdTrend('hang'),
               other: holdIncomparable('hang'),
               tracker: kv ? kv.innerText.replace(/\\n/g, ' ') : null };
    }`;
    const hold = await page.evaluate(([fn]) => {
      const run = eval('(' + fn + ')');
      const o = { clean: run([]), shoulder: run(['shoulder']), knee: null };
      /* The knee swap, so the finding is proved on the CLASS rather than on
         the one movement it was reported against. */
      STATE.profile.limitations = ['knee'];
      o.knee = { performs: safeSwap('wallsit'), floor: safeSwap('plank') };
      /* THE REPORTED DEFECT: holds on the substitute, then the real movement. */
      STATE.profile.limitations = ['shoulder']; STATE.holdLog = []; STATE.logs = {};
      const sub = safeSwap('deadhang');
      STATE.holdLog.push({ date: '2026-01-01', id: 'hang', secs: 300, fresh: true, at: 1, exId: sub });
      STATE.profile.limitations = [];
      STATE.holdLog.push({ date: '2026-02-12', id: 'hang', secs: 45, fresh: true, at: 2, exId: 'deadhang' });
      o.mixed = { sub, best: holdBest('hang'), trend: holdTrend('hang'), other: holdIncomparable('hang') };
      openHoldTests();
      const sh = document.getElementById('sheet');
      const row = sh.querySelector('[data-hold="hang"]');
      o.mixed.rowText = row ? row.innerText.replace(/\n/g, ' ') : null;
      o.mixed.saysWhy = !!sh.querySelector('[data-holdother="hang"]');
      closeSheet();
      /* A LEGACY ROW carries no movement at all. Unknown is not equal, so it
         is kept as history and left out of the comparison. */
      STATE.holdLog = [{ date: '2026-01-01', id: 'hang', secs: 300, fresh: true, at: 1 },
                       { date: '2026-02-01', id: 'hang', secs: 280, fresh: true, at: 2 }];
      o.legacy = { best: holdBest('hang'), trend: holdTrend('hang'),
                   other: holdIncomparable('hang'), last: (holdLast('hang') || {}).secs };
      /* The repair keeps a real movement and refuses junk. */
      STATE.holdLog = [{ date: '2026-01-01', id: 'hang', secs: 60, fresh: true, at: 1, exId: 'deadhang' },
                       { date: '2026-01-02', id: 'hang', secs: 61, fresh: true, at: 2, exId: 'not-a-move' },
                       { date: '2026-01-03', id: 'hang', secs: 62, fresh: true, at: 3, exId: { x: 1 } }];
      normalizeState();
      o.repaired = STATE.holdLog.map(r => r.exId === undefined ? 'absent' : r.exId);
      return o;
    }, [driveTwo]);

    /* Guard: the two substitutions this round is about really happen. */
    t.eq('guard: a flagged shoulder really substitutes the dead hang',
      hold.shoulder.records[0].exId, 'birddog', hold.shoulder);
    t.eq('guard: and a flagged knee substitutes the wall sit',
      hold.knee.performs, 'glutebridge', hold.knee);
    t.ok('guard: the floor movements are not substituted at all',
      hold.knee.floor === 'plank' && hold.clean.records[0].exId === 'deadhang', hold);

    /* THE WRITER: the movement actually held is stamped, by the real route. */
    t.eq('an unflagged athlete records the dead hang',
      hold.clean.records.map(r => r.exId), ['deadhang', 'deadhang'], hold.clean);
    t.eq('a flagged athlete records what they actually held',
      hold.shoulder.records.map(r => r.exId), ['birddog', 'birddog'], hold.shoulder);

    /* THE FLOORS. Both athletes still get a best and a real trend on their
       own movement — a fix that withheld everything satisfies every
       assertion about the mixed case and deletes the feature. */
    t.eq('the unflagged athlete keeps their best', hold.clean.best, 75, hold.clean);
    t.eq('and a real trend', hold.clean.trend && hold.clean.trend.delta, 15, hold.clean);
    t.eq('the flagged athlete keeps a best on the substitute', hold.shoulder.best, 75, hold.shoulder);
    t.eq('and a real trend of their own', hold.shoulder.trend && hold.shoulder.trend.delta, 15, hold.shoulder);
    t.eq('neither has anything left uncompared',
      [hold.clean.other, hold.shoulder.other], [0, 0], hold);

    /* NAME THE MOVEMENT THE NUMBER WAS SET ON. */
    t.ok('the tracker names the dead hang for the unflagged athlete',
      /Dead Hang/.test(hold.clean.tracker || ''), hold.clean);
    t.ok('and names the BIRD DOG for the flagged one',
      /Bird Dog/.test(hold.shoulder.tracker || ''), hold.shoulder);
    t.ok('never the movement they did not do',
      !/Dead Hang/.test(hold.shoulder.tracker || ''), hold.shoulder);

    /* THE REPORTED DEFECT, on the current head. */
    t.eq('the bird-dog hold no longer sets the dead-hang best', hold.mixed.best, 45, hold.mixed);
    t.eq('and no delta is drawn across the two movements', hold.mixed.trend, null, hold.mixed);
    t.eq('the incomparable one is counted', hold.mixed.other, 1, hold.mixed);
    t.ok('the row shows no false regression',
      !/−255s|-255s/.test(hold.mixed.rowText || ''), hold.mixed);
    /* A WITHHELD NUMBER NEEDS A SENTENCE. */
    t.ok('and the row says why it is not compared', hold.mixed.saysWhy, hold.mixed);

    /* UNKNOWN IS NOT EQUAL — and is still history. */
    t.eq('a record written before the stamp sets no best', hold.legacy.best, 0, hold.legacy);
    t.eq('and draws no trend', hold.legacy.trend, null, hold.legacy);
    t.eq('but it is kept, not deleted', hold.legacy.last, 280, hold.legacy);
    t.eq('and counted as uncomparable', hold.legacy.other, 2, hold.legacy);

    /* MEMBERSHIP, not truthiness: exId reaches innerHTML through the row. */
    t.eq('the repair keeps a real movement and refuses junk',
      hold.repaired, ['deadhang', 'absent', 'absent'], hold.repaired);
  }


  /* v367 (same round) — A LOCKED BUTTON WITH NO SENTENCE IS A DEAD END, on
     the two cards v366 did not reach. maxEffortBlocked() correctly refuses on
     the tap, but the FORCE and FORCE Combat cards still showed a live
     "Train the four tasks" and "Run the circuit" with no mention of the
     health check — so the athlete tapped and landed on the clearance screen
     with no idea what they had just done. One renderer now, for the reason
     forceKitHTML() is one: three surfaces saying the same thing.

     THE FLOOR is the cleared athlete, who must get every start button back
     and no note at all — a note that always fires is a note nobody reads. */
  {
    const lock = {};
    for (const [label, setup] of [
      ['locked', () => { STATE.profile.parq = ['heart']; STATE.profile.parqDone = true; STATE.profile.medCleared = false; STATE.profile.gear = ['bar', 'bench', 'dip', 'sandbag']; }],
      ['cleared', () => { STATE.profile.parq = []; STATE.profile.parqDone = true; STATE.profile.medCleared = false; STATE.profile.gear = ['bar', 'bench', 'dip', 'sandbag']; }],
    ]) {
      await seedAthlete(page, setup);
      lock[label] = await page.evaluate(() => {
        const read = fn => {
          fn();
          const sh = document.getElementById('sheet');
          const btns = [...sh.querySelectorAll('button')].map(b => b.innerText.trim());
          const o = { note: !!sh.querySelector('[data-maxlock]'),
                      start: btns.some(b => /Train the four|Train what you have|Run the circuit/.test(b)),
                      route: btns.some(b => /cleared by a doctor|Answer the health check/.test(b)),
                      /* the rest of the card must survive — a note that ate
                         the screen would satisfy every assertion below */
                      logBtn: btns.some(b => /Log a result/.test(b)) };
          closeSheet();
          return o;
        };
        return { safe: safeMode(), force: read(() => openForcePrep()), combat: read(() => openCombat()),
                 holds: read(() => openHoldTests()) };
      });
    }
    t.eq('guard: one athlete is in safe mode and the other is not',
      [lock.locked.safe, lock.cleared.safe], [true, false], lock);

    ['force', 'combat', 'holds'].forEach(card => {
      t.ok('the ' + card + ' card says why it is locked', lock.locked[card].note, lock.locked[card]);
      t.ok('and offers the screen that unlocks it', lock.locked[card].route, lock.locked[card]);
      t.ok('with no live start button on it', !lock.locked[card].start, lock.locked[card]);
      /* THE FLOOR. */
      t.ok('a cleared athlete gets the ' + card + ' card with no note', !lock.cleared[card].note, lock.cleared[card]);
    });
    t.ok('a cleared athlete can start the FORCE tasks', lock.cleared.force.start, lock.cleared.force);
    t.ok('and the FORCE Combat circuit', lock.cleared.combat.start, lock.cleared.combat);
    /* THE REST OF THE CARD SURVIVES: logging a past result is not a max
       effort and is never taken away. */
    t.ok('a locked athlete can still log a FORCE result', lock.locked.force.logBtn, lock.locked.force);
    t.ok('and a FORCE Combat result', lock.locked.combat.logBtn, lock.locked.combat);

    /* ONE renderer, not three copies of the sentence. */
    const one = await page.evaluate(() => {
      const src = [...document.querySelectorAll('script:not([src])')]
        .map(x => x.textContent).sort((a, b) => b.length - a.length)[0];
      return { hasApp: /function maxEffortBlocked/.test(src),
               callers: (src.match(/maxLockNoteHTML\(/g) || []).length,
               copies: (src.match(/stays locked until you have spoken to a doctor/g) || []).length };
    });
    /* THE RENDERER'S OWN CONTRACT, pinned directly. Every caller already
       guards on safeMode(), so its internal guard is consulted in no branch a
       screen can reach — v338's prepDatePassed() shape. A guard that cannot
       be exercised through the UI still has to mean what it is named. */
    const contract = await page.evaluate(() => {
      const real = { p: STATE.profile.parq, d: STATE.profile.parqDone, m: STATE.profile.medCleared };
      const at = (parq, done, cleared) => {
        STATE.profile.parq = parq; STATE.profile.parqDone = done; STATE.profile.medCleared = cleared;
        return maxLockNoteHTML('A test');
      };
      const o = { clean: at([], true, false), unscreened: at([], false, false),
                  flagged: at(['heart'], true, false), cleared: at(['heart'], true, true) };
      STATE.profile.parq = real.p; STATE.profile.parqDone = real.d; STATE.profile.medCleared = real.m;
      return { clean: o.clean, unscreenedRoutes: /Answer the health check/.test(o.unscreened),
               flaggedRoutes: /cleared by a doctor/.test(o.flagged), clearedIsEmpty: o.cleared === '' };
    });
    /* A THROW PUTS NO JUNK ON THE GLASS. The GATE is what fails closed (it
       blocks); this note is cosmetic, so its own failure mode is silence —
       the athlete still meets the gate on the tap. */
    const threw = await page.evaluate(() => {
      const real = window.parqDone;
      let out = null;
      try { parqDone = () => { throw new Error('boom'); }; out = maxLockNoteHTML('A test'); }
      finally { parqDone = real; }
      return { out, restored: typeof maxLockNoteHTML('A test') === 'string' };
    });
    t.eq('the locked note renders nothing when the health check throws', threw.out, '');
    t.ok('guard: and still works once restored', threw.restored, threw);

    t.eq('the renderer says nothing to an athlete who needs no gate', contract.clean, '');
    t.ok('and nothing to one who has been cleared', contract.clearedIsEmpty, contract);
    t.ok('an unscreened athlete is sent to the health check', contract.unscreenedRoutes, contract);
    t.ok('a flagged one is sent to the clearance screen', contract.flaggedRoutes, contract);

    t.ok('guard: the source scan really found the app', one.hasApp, one);
    t.eq('the locked note has one definition and three call sites', one.callers, 4, one);
    /* The battery's own screen keeps its longer wording; the three cards
       share one. Two is the definition plus the battery, not a third copy. */
    t.ok('and the sentence is not copied per card', one.copies <= 2, one);
  }


  /* v368 — THE LAST TWO HAND-WRITTEN LISTS OVER CARDIO_MODES.
     `movementHTML()` chose the per-mode block with a five-branch chain and
     `openMakeupTimer()` chose its shape with `mode==='jacks'||mode==='skip'`.
     Both have an ELSE that swallows everything they do not name — the shape
     that credited a ruck as jumping jacks (v327) and told a runner to do them
     (v328), three rounds running. A sixth mode would have rendered the JACKS
     block, inputs and all, under its own label.

     Nothing here is a live defect today: cardioMode() is a membership test,
     so no out-of-set value reaches either surface. The refactor is proved
     BEHAVIOUR-PRESERVING rather than argued — every mode's card and make-up
     sheet is byte-identical to what the chain produced — and the lockstep is
     enforced in validateData() so an incomplete registry fails at boot
     instead of on a phone. */
  {
    const cardio = await page.evaluate(() => {
      const o = { modes: CARDIO_MODES.slice(), block: {}, timer: {}, shared: [], cards: {} };
      const seen = {};
      CARDIO_MODES.forEach(k => {
        const i = CARDIO_INFO[k] || {};
        o.block[k] = typeof i.block;
        o.timer[k] = i.timer;
        const src = String(i.block);
        if (seen[src]) o.shared.push(k + '=' + seen[src]); else seen[src] = k;
      });
      /* Each mode's card must actually be ITS card: the ruck names the ruck,
         the run names the run. A shared builder passes every "it has a block"
         assertion and renders the wrong one. */
      CARDIO_MODES.forEach(k => { setCardioMode(k); o.cards[k] = movementHTML(); });
      /* MEASURE THE PAYLOAD, NOT THE CONTAINER. Reading CARDIO_INFO[k].timer
         is reading the input; a mutant that hardcoded every sheet to the
         work/rest shape left those values untouched and escaped. Drive the
         real sheet and count the controls it actually renders. */
      o.sheet = {};
      CARDIO_MODES.forEach(k => {
        openMakeupTimer(k);
        const sh = document.getElementById('sheet');
        o.sheet[k] = { durations: sh.querySelectorAll('[onclick^="startBikeMakeup("]').length,
                       workRest: !!sh.querySelector('#mut-jk-w'),
                       stopwatch: !!sh.querySelector('[onclick^="openMakeupStopwatch("]'),
                       saysContinuous: /one continuous effort/i.test(sh.innerText) };
        closeSheet();
      });
      /* A KEY THE MODE LIST DOES NOT CARRY IS UNREACHABLE, and that rule
         cannot fire on today's data — exercise it directly. */
      /* validateData() LOGS, and the harness counts a console error as a page
         failure — mute it around every deliberate break. */
      const hush = console.error; console.error = () => {};
      CARDIO_INFO.helicopter = { label: 'x', block: () => '', timer: 'stopwatch' };
      const orphan = validateData() || [];
      delete CARDIO_INFO.helicopter;
      console.error = hush;
      o.orphanCaught = orphan.some(e => /CARDIO_INFO\.helicopter: not in CARDIO_MODES/.test(e));
      o.orphans = Object.keys(CARDIO_INFO).filter(k => CARDIO_MODES.indexOf(k) < 0);
      /* The validator rule fires when the registry is incomplete. */
      const keepB = CARDIO_INFO.run.block, keepT = CARDIO_INFO.ruck.timer;
      const quiet = console.error; console.error = () => {};
      delete CARDIO_INFO.run.block; CARDIO_INFO.ruck.timer = 'wobble';
      const errs = validateData() || [];
      CARDIO_INFO.run.block = keepB; CARDIO_INFO.ruck.timer = keepT;
      /* The copy-paste this rule exists for: two modes pointing at one
         builder renders another mode's inputs under this mode's label, and
         every "it has a block" assertion still passes. */
      const keepS = CARDIO_INFO.skip.block;
      CARDIO_INFO.skip.block = CARDIO_INFO.ruck.block;
      const shared = validateData() || [];
      CARDIO_INFO.skip.block = keepS;
      o.complains = { block: errs.some(e => /CARDIO_INFO\.run: no block builder/.test(e)),
                      timer: errs.some(e => /CARDIO_INFO\.ruck: timer shape/.test(e)),
                      shared: shared.some(e => /shares its block builder/.test(e)) };
      o.cleanAfter = (validateData() || []).length;
      console.error = quiet;
      return o;
    });

    t.eq('guard: five cardio modes are registered', cardio.modes.length, 5, cardio.modes);
    cardio.modes.forEach(k => {
      t.eq('the ' + k + ' mode declares its own block builder', cardio.block[k], 'function', cardio.block);
      t.ok('and a timer shape the make-up sheet can render',
        ['block', 'durations', 'stopwatch'].indexOf(cardio.timer[k]) >= 0, cardio.timer);
    });
    t.eq('no two modes share a block builder', cardio.shared, []);
    t.eq('and nothing in the registry is unreachable', cardio.orphans, []);

    /* THE PAYLOAD, not the container: each card is the right card. */
    t.ok('the ruck card is the ruck block', /ruck/i.test(cardio.cards.ruck), null);
    t.ok('the run card is the run block', /Run|running/.test(cardio.cards.run), null);
    t.ok('the skip card is the skipping block', /rope|skip/i.test(cardio.cards.skip), null);
    t.ok('and the ruck card is not the jacks one',
      !/jumping jacks, that is/i.test(cardio.cards.ruck), null);

    /* THE THREE TIMER SHAPES, and why they differ. Jacks and skipping are
       done in SETS with rests; the trainer wants a duration list; a ruck and
       a run are one continuous effort and get the stopwatch alone. Asserted
       on the SHEET, so a mutant that hardcodes one shape for everybody is
       caught by the two modes that must not have it. */
    t.eq('jacks and skipping declare the work/rest block shape',
      [cardio.timer.jacks, cardio.timer.skip], ['block', 'block'], cardio.timer);
    t.eq('the bike declares durations', cardio.timer.bike, 'durations');
    t.eq('and the continuous efforts declare the stopwatch only',
      [cardio.timer.ruck, cardio.timer.run], ['stopwatch', 'stopwatch'], cardio.timer);
    ['jacks', 'skip'].forEach(k => {
      t.ok('the ' + k + ' sheet really renders the work/rest inputs', cardio.sheet[k].workRest, cardio.sheet[k]);
      t.eq('and no duration list', cardio.sheet[k].durations, 0, cardio.sheet[k]);
    });
    t.ok('the bike sheet really renders a duration list', cardio.sheet.bike.durations >= 4, cardio.sheet.bike);
    t.ok('and not the work/rest inputs', !cardio.sheet.bike.workRest, cardio.sheet.bike);
    ['ruck', 'run'].forEach(k => {
      t.ok('the ' + k + ' sheet renders neither', !cardio.sheet[k].workRest && !cardio.sheet[k].durations, cardio.sheet[k]);
      /* A screen with a control missing and no sentence reads as broken. */
      t.ok('and says why it is the stopwatch alone', cardio.sheet[k].saysContinuous, cardio.sheet[k]);
    });
    /* THE FLOOR: every mode keeps the stopwatch. */
    cardio.modes.forEach(k => t.ok('the ' + k + ' sheet offers the stopwatch', cardio.sheet[k].stopwatch, cardio.sheet[k]));

    /* A CLEAN VALIDATOR PROVES NOTHING ABOUT A VALIDATOR RULE. Break the
       registry in front of it and require the specific complaint, then
       restore and require silence. */
    /* THE CONSUMERS HAVE TO READ THE REGISTRY, not merely for the registry to
       exist — v322's WEIGHTS_PATTERNS lesson, where a mutant reverting the
       builder to its own inline literal walked straight through a check that
       counted the declaration. Reverting either consumer here is BYTE-
       IDENTICAL on today's five modes, so no rendered assertion can see it;
       the source is the only place the difference lives. */
    const reads = await page.evaluate(() => {
      const src = [...document.querySelectorAll('script:not([src])')]
        .map(x => x.textContent).sort((a, b) => b.length - a.length)[0];
      const body = name => {
        const i = src.indexOf('function ' + name + '(');
        if (i < 0) return null;
        const j = src.indexOf('\nfunction ', i + 1);
        return src.slice(i, j < 0 ? i + 6000 : j);
      };
      const mv = body('movementHTML'), mk = body('openMakeupTimer');
      return {
        found: !!mv && !!mk,
        cardReads: /cardioInfo\(mode\)\.block\(/.test(mv || ''),
        cardChain: /mode===.(bike|run|ruck|skip). ?\?/.test(mv || ''),
        timerReads: /cardioInfo\(mode\)\.timer/.test(mk || ''),
        timerChain: /mode===.(jacks|skip|bike|ruck|run)./.test(mk || ''),
      };
    });
    t.ok('guard: both consumers were found in the source', reads.found, reads);
    t.ok('the movement card asks the registry for its block', reads.cardReads, reads);
    t.ok('and no longer branches on the mode name', !reads.cardChain, reads);
    t.ok('the make-up timer asks the registry for its shape', reads.timerReads, reads);
    t.ok('and no longer branches on the mode name either', !reads.timerChain, reads);

    t.ok('the validator names a mode with no block builder', cardio.complains.block, cardio.complains);
    t.ok('and one whose timer shape it cannot render', cardio.complains.timer, cardio.complains);
    t.ok('and two modes pointing at one builder', cardio.complains.shared, cardio.complains);
    t.ok('and a registry key no mode list carries', cardio.orphanCaught, cardio);
    t.eq('and it is clean again once restored', cardio.cleanAfter, 0);
  }


  /* v368 (same round) — THE FINISHER SLOT WENT TO WHICHEVER PATTERN WAS
     FIRST IN A TWO-ITEM ARRAY. Seven base patterns fill seven slots, the cap
     is eight, so the loop added `WEIGHTS_PATTERNS_EXTRA[0]` and broke — and
     `cardio` has exactly ONE member in the library while `power` has nine.

     Measured over 200 circuits before the fix:
       owns every piece of kit      cardio 200, power   0
       owns kettlebell/db/medball   cardio   0, power 200

     Nine movements were unreachable for the athlete who owns the MOST kit,
     and buying a battle rope took them away. v322's `pattern` defect (0
     appearances in 400 circuits) one line over. */
  {
    const w = await page.evaluate(() => {
      const run = (gear, n) => {
        STATE.profile.gear = gear.slice(); STATE.profile.limitations = [];
        const moves = {}, pats = {}; let slots = 0, over = 0;
        for (let i = 0; i < n; i++) {
          const c = buildWeightsSession() || [];
          slots += c.length; if (c.length > 8) over++;
          c.forEach(x => {
            const p = (EX[x.exId] || {}).pattern || 'other';
            pats[p] = (pats[p] || 0) + 1;
            if (WEIGHTS_PATTERNS_EXTRA.indexOf(p) >= 0) moves[x.exId] = (moves[x.exId] || 0) + 1;
          });
        }
        return { moves, pats, avg: slots / n, over };
      };
      const keep = STATE.profile.gear;
      const o = { full: run(GEAR_KEYS, 300), some: run(['kettlebell', 'dumbbell', 'medball'], 300) };
      /* Every conditioning movement a fully-kitted athlete OWNS, from the
         registry rather than a hand-written list. */
      STATE.profile.gear = GEAR_KEYS.slice();
      o.owned = weightsPool().filter(k => WEIGHTS_PATTERNS_EXTRA.indexOf(EX[k].pattern) >= 0).sort();
      o.extras = WEIGHTS_PATTERNS_EXTRA.slice();
      o.base = WEIGHTS_PATTERNS.slice();
      STATE.profile.gear = keep;
      return o;
    });

    /* Guard: the imbalance this is about is real — one pattern has far more
       members than the other, which is what made a fixed order fatal. */
    t.ok('guard: the athlete owns conditioning movements in both extra patterns',
      w.extras.every(p => w.owned.some(k => k)), w.extras);
    t.ok('guard: there are at least eight of them', w.owned.length >= 8, w.owned);

    /* THE FINDING: every one of them is reachable. */
    const never = w.owned.filter(k => !w.full.moves[k]);
    t.eq('every conditioning finisher the athlete owns can be drawn', never, [], w.full.moves);

    /* MORE KIT MUST NOT MEAN FEWER MOVEMENTS. This is the property the defect
       violated, and it is the one a hand-written pattern order breaks again. */
    const lost = Object.keys(w.some.moves).filter(k => !w.full.moves[k]);
    t.eq('buying more kit never removes a finisher', lost, [], { some: w.some.moves, full: w.full.moves });

    /* THE FLOORS: the circuit is unchanged in shape. */
    t.eq('the circuit is still capped at eight', w.full.over, 0);
    t.ok('and still fills all seven base patterns',
      w.base.every(p => w.full.pats[p] === 300), w.full.pats);
    t.ok('a partly-equipped athlete still gets a finisher',
      Object.keys(w.some.moves).length > 0, w.some.moves);
    t.ok('and their circuit is the same length',
      Math.abs(w.full.avg - w.some.avg) < 0.01, { full: w.full.avg, some: w.some.avg });

    /* NO SINGLE MOVEMENT OWNS THE SLOT. The defect was one movement taking
       100% of it; a fix that simply reversed the order would hand 100% to a
       different one. */
    const total = Object.values(w.full.moves).reduce((a, b) => a + b, 0);
    const top = Math.max.apply(null, Object.values(w.full.moves));
    t.ok('no one finisher takes more than half the slot', top < total * 0.5,
      { top, total, moves: w.full.moves });
  }


  /* v369 — THE MIDPOINT PROMPT INSTRUCTED WHAT THE GATE REFUSED. It told
     every athlete to "re-run the four tasks", and v366's gate blocks that for
     an uncleared one — with the lock note four lines below saying the
     opposite. Two sentences on one screen cannot disagree.

     The checkpoint is still DUE and the prompt still fires: the FORCE
     evaluation is administered by a unit, not by this app, so an athlete
     tested elsewhere has a real number to type in. Only the half the app
     hosts is withheld. */
  {
    const mid = {};
    for (const [label, safe] of [['locked', true], ['cleared', false]]) {
      await seedAthlete(page, new Function('', `
        STATE.profile.parq = ${safe ? "['heart']" : '[]'};
        STATE.profile.parqDone = true;
        STATE.profile.medCleared = ${safe ? 'false' : 'true'};
        STATE.profile.gear = ['bar','bench','dip','sandbag'];
        const D = n => localISO(new Date(Date.now() + 864e5 * n));
        STATE.prep = { date: D(40), planFrom: localISO(new Date(Date.now() - 864e5 * 40)),
                       path: 'operator', results: {} };
        save();`));
      mid[label] = await page.evaluate(() => {
        const o = { safe: safeMode(), checkpoint: prepCheckpoint(), due: prepMidDue() };
        openForcePrep();
        const sh = document.getElementById('sheet');
        const txt = sh.innerText;
        o.prompt = /Midpoint assessment due/.test(txt);
        o.tellsThemToRun = /Re-run the four tasks/.test(txt);
        o.tellsThemToLog = /Log the times if your unit tests you/.test(txt);
        o.saysLocked = /stays locked until your health check is cleared/.test(txt);
        o.lockNote = !!sh.querySelector('[data-maxlock]');
        o.canLog = [...sh.querySelectorAll('button')].some(b => /Log a result/.test(b.innerText));
        closeSheet();
        /* The countdown that precedes it says the same thing, one window
           earlier — fixing one and not the other leaves the class alive. */
        STATE.prep.date = localISO(new Date(Date.now() + 864e5 * 100));
        STATE.prep.planFrom = localISO(new Date(Date.now() - 864e5 * 10));
        o.early = { cp: prepCheckpoint(), due: prepMidDue() };
        openForcePrep();
        const t2 = document.getElementById('sheet').innerText;
        o.early.tellsThemToRun = /you re-run the four tasks then/.test(t2);
        o.early.tellsThemToLog = /log the times if your unit tests you then/.test(t2);
        closeSheet();
        return o;
      });
    }
    t.eq('guard: both athletes are at the midpoint with the prompt due',
      [mid.locked.checkpoint, mid.cleared.checkpoint, mid.locked.due, mid.cleared.due],
      ['mid', 'mid', true, true], mid);
    t.eq('guard: one is in safe mode and the other is not',
      [mid.locked.safe, mid.cleared.safe], [true, false], mid);
    t.eq('guard: and the early window really is the initial one',
      [mid.locked.early.cp, mid.cleared.early.cp], ['initial', 'initial'], mid);

    /* THE FLOOR: a cleared athlete's copy is untouched. */
    t.ok('a cleared athlete is still told to re-run the four tasks', mid.cleared.tellsThemToRun, mid.cleared);
    t.ok('and the countdown says the same', mid.cleared.early.tellsThemToRun, mid.cleared.early);
    t.ok('with no lock note on their card', !mid.cleared.lockNote, mid.cleared);

    /* THE FINDING: the locked athlete is not told to do what is blocked. */
    t.ok('a locked athlete is NOT told to re-run them', !mid.locked.tellsThemToRun, mid.locked);
    t.ok('they are told what they can do instead', mid.locked.tellsThemToLog, mid.locked);
    t.ok('and the prompt names the reason', mid.locked.saysLocked, mid.locked);
    /* FIXING ONE INSTANCE IS NOT FIXING THE CLASS: the countdown one window
       earlier says the same sentence. */
    t.ok('the countdown does not tell them to re-run them either',
      !mid.locked.early.tellsThemToRun, mid.locked.early);
    t.ok('and offers the same alternative', mid.locked.early.tellsThemToLog, mid.locked.early);

    /* THE PROMPT STILL FIRES, and logging is still possible — the evaluation
       is administered by a unit, not by this app. A fix that simply hid the
       midpoint prompt satisfies every assertion above and loses the
       checkpoint the block is built on. */
    t.ok('the midpoint prompt still appears for a locked athlete', mid.locked.prompt, mid.locked);
    t.ok('and they can still log a result', mid.locked.canLog, mid.locked);
  }


  /* v370 — THE MIDPOINT PROMPT RAN THROUGH THE TAPER, AND CLAIMED A HALFWAY
     THAT HAD LONG PASSED. `PREP_PHASE_NOTE.taper` says in as many words "you
     cannot gain fitness now — you can only arrive tired, so do not", and this
     prompt asked for FOUR MAXIMAL EFFORTS UNDER LOAD right through it, up to
     the day before the evaluation. Two sentences the app owns, on one block,
     in flat contradiction.

     And its opening line — "You are halfway to your test date" — was false
     everywhere but the first day of the window: it said so three weeks out on
     a twelve-week block. */
  {
    const prep = await page.evaluate(() => {
      const D = n => localISO(new Date(Date.now() + 864e5 * n));
      const at = (from, to) => {
        STATE.prep = { planFrom: D(from), date: D(to), path: 'operator', results: {} };
        openForcePrep();
        const sh = document.getElementById('sheet');
        const txt = sh.innerText;
        const o = { phase: prepPhase(), weeksLeft: prepWeeksLeft(),
          due: prepMidDue(), open: prepMidWindowOpen(), missed: prepMidMissed(),
          asksForIt: /Re-run the four tasks|Log the times if your unit/.test(txt),
          claimsHalfway: /You are halfway to your test date/.test(txt),
          missedNote: !!sh.querySelector('[data-midmissed]'),
          saysDoNot: /Do not run an assessment to catch it up/.test(txt),
          canLog: [...sh.querySelectorAll('button')].some(b => /Log a result/.test(b.innerText)),
          render: txt.length > 200 };
        closeSheet();
        return o;
      };
      const o = { mid: at(-80, 70), sharpen: at(-59, 21), taperIn: at(-66, 14),
                  taperEnd: at(-79, 1), taperWeeks: PREP_TAPER_WEEKS,
                  sharpenWeeks: PREP_SHARPEN_WEEKS };
      /* A midpoint that WAS recorded must not draw the missed note. */
      STATE.prep = { planFrom: D(-79), date: D(1), path: 'operator', results: {},
        checks: { mid: { date: D(-30), results: { shuttle: 210 } } } };
      o.recorded = { missed: prepMidMissed(), due: prepMidDue() };
      openForcePrep();
      const sh = document.getElementById('sheet');
      o.recorded.note = !!sh.querySelector('[data-midmissed]');
      /* textContent, not innerText: `.section-label` is uppercased in CSS and
         innerText returns the RENDERED text, so /Midpoint/ failed on a screen
         that was perfectly correct — the v296 trap, verbatim. */
      o.recorded.showsRecord = /Midpoint assessment/.test(sh.textContent);
      closeSheet();
      return o;
    });

    t.eq('guard: the four points really span the phases the block defines',
      [prep.mid.phase, prep.sharpen.phase, prep.taperIn.phase, prep.taperEnd.phase],
      ['build', 'sharpen', 'taper', 'taper'],
      { phases: [prep.mid.phase, prep.sharpen.phase, prep.taperIn.phase, prep.taperEnd.phase],
        weeks: [prep.mid.weeksLeft, prep.sharpen.weeksLeft, prep.taperIn.weeksLeft, prep.taperEnd.weeksLeft],
        sharpenWeeks: prep.sharpenWeeks, taperWeeks: prep.taperWeeks });

    /* THE WINDOW: open before the taper, closed inside it. */
    t.ok('the midpoint window is open in the build phase', prep.mid.open, prep.mid);
    t.ok('and still open in the sharpen phase', prep.sharpen.open, prep.sharpen);
    t.ok('it closes when the taper starts', !prep.taperIn.open, prep.taperIn);
    t.ok('and stays closed the day before the test', !prep.taperEnd.open, prep.taperEnd);

    /* THE CONTRADICTION: no maximal assessment is asked for in the taper. */
    t.ok('the taper is not asked for four maximal efforts', !prep.taperIn.asksForIt, prep.taperIn);
    t.ok('nor is the day before the evaluation', !prep.taperEnd.asksForIt, prep.taperEnd);
    /* THE FLOOR: it is still asked for where it belongs. */
    t.ok('the build phase is still asked for it', prep.mid.asksForIt, prep.mid);
    t.ok('and so is the sharpen phase', prep.sharpen.asksForIt, prep.sharpen);

    /* A FALSE SENTENCE IS A DEFECT EVEN WHEN THE ADVICE IS RIGHT. */
    t.ok('the prompt no longer claims you are halfway three weeks out',
      !prep.sharpen.claimsHalfway, prep.sharpen);
    t.ok('nor anywhere else', !prep.mid.claimsHalfway, prep.mid);

    /* A WINDOW THAT CLOSED WITH NOTHING IN IT SAYS SO. Silence would read as
       the earlier prompt having been a glitch. */
    t.ok('the taper explains the window has closed', prep.taperIn.missedNote, prep.taperIn);
    t.ok('and says not to catch it up', prep.taperIn.saysDoNot, prep.taperIn);
    t.ok('logging the evaluation itself is still offered', prep.taperIn.canLog, prep.taperIn);

    /* THE OTHER FLOOR: an athlete who DID record a midpoint gets no such note,
       and their record still renders. A note that always fires is a note
       nobody reads. */
    t.ok('an athlete who recorded a midpoint sees no missed note', !prep.recorded.note, prep.recorded);
    t.ok('and nothing is due for them', !prep.recorded.due, prep.recorded);
    t.ok('their record still shows', prep.recorded.showsRecord, prep.recorded);

    /* The copy quotes the taper length from the app's own constant. */
    t.eq('guard: the taper is the length the block model says', prep.taperWeeks, 2);
  }


  /* v371 — THE RUCK CARD CLAIMED TO BE BUILDING DISTANCE WHILE THE TAPER CUT
     IT BY A THIRD. `climbing` is computed from the four-week cycle slot, which
     knows nothing about the phase. Measured at two weeks out: the distance
     went 10.7 km -> 7.1 km and the card read "What moves this week: The
     distance. The load holds." The running card beside it, on the same block
     and the same week, said correctly "volume comes down and nothing gets
     sharper". Two cards on one screen disagreeing about the same week. */
  {
    const ruck = await page.evaluate(() => {
      const D = n => localISO(new Date(Date.now() + 864e5 * n));
      const text = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent.replace(/\s+/g, ' '); };
      const at = w => {
        STATE.prep = { planFrom: D(-(20 - w) * 7), date: D(w * 7), path: 'operator', results: {} };
        const u = ruckLadderWeek(), e = enduranceWeek();
        return { left: u.left, phase: u.phase, km: u.km, lb: u.lb, down: u.down,
                 climbing: u.climbing, runKm: e.km,
                 card: text(ruckLadderHTML()), runCard: text(enduranceHTML ? enduranceHTML() : '') };
      };
      const o = {};
      [6, 4, 3, 2, 1].forEach(w => { o['w' + w] = at(w); });
      return o;
    });

    /* Guard: the taper really does cut both, or there is nothing to describe. */
    t.ok('guard: the taper cuts the ruck distance',
      ruck.w2.km < ruck.w3.km * 0.85, { taper: ruck.w2.km, before: ruck.w3.km });
    t.ok('guard: and cuts the running too', ruck.w2.runKm < ruck.w4.runKm, ruck);
    t.eq('guard: the weeks span sharpen into taper',
      [ruck.w4.phase, ruck.w3.phase, ruck.w2.phase], ['sharpen', 'sharpen', 'taper'], ruck);

    /* THE FINDING: no card claims to be building anything in the taper. */
    t.ok('the taper card does not claim the distance is moving',
      !/What moves this week: The distance/.test(ruck.w2.card), ruck.w2.card.slice(0, 200));
    t.ok('nor that the load is', !/The load, by/.test(ruck.w2.card), ruck.w2.card.slice(0, 200));
    t.ok('it says the volume comes down', /volume comes down/i.test(ruck.w2.card), ruck.w2.card.slice(0, 200));
    t.eq('and the week reports it as the taper, not a build slot', ruck.w2.climbing, 'taper', ruck.w2);

    /* THE TWO CARDS AGREE. The running card was already honest; the point is
       that they now say the same thing about the same week. */
    t.ok('the running card says volume comes down in the same week',
      /volume comes down/i.test(ruck.w2.runCard), ruck.w2.runCard.slice(0, 200));

    /* THE FLOORS. A build week must still name what it is building — a fix
       that said "nothing is being built" everywhere satisfies every taper
       assertion and deletes the plan's whole point. */
    t.ok('a distance week still says the distance is moving',
      /What moves this week: The distance/.test(ruck.w4.card), ruck.w4.card.slice(0, 200));
    t.eq('and reports it as one', ruck.w4.climbing, 'distance', ruck.w4);
    t.ok('a load week still says the load is moving',
      /The load, by/.test(ruck.w3.card), ruck.w3.card.slice(0, 200));
    t.eq('and reports it as one', ruck.w3.climbing, 'load', ruck.w3);
    /* THE DOWN WEEK KEEPS ITS OWN ANSWER, in the taper as everywhere else:
       "this is the down week" is accurate there too. */
    t.ok('a down week inside the taper still names itself',
      /this is the down week/i.test(ruck.w1.card), ruck.w1.card.slice(0, 200));
    t.eq('and is not relabelled', ruck.w1.climbing, 'neither', ruck.w1);
    t.ok('guard: that week really is a down week and in the taper',
      ruck.w1.down === true && ruck.w1.phase === 'taper', ruck.w1);

    /* NEVER BOTH still holds through the taper — the plan's oldest rule. */
    t.ok('the load holds while the taper cuts the distance',
      ruck.w2.lb === ruck.w3.lb, { taper: ruck.w2.lb, before: ruck.w3.lb });

    /* THE PLATE ITSELF, not just the label. The two ladders are offset by one
       slot (v340), so the operator's fourth load step landed at three weeks
       out — sharpen, fine — and the ASSAULTER'S landed at TWO weeks out,
       inside the taper: 30 lb -> 35 lb a fortnight before the evaluation, on
       the path whose own note says "arrive fresh under load".

       Every earlier check counted the STEPS and none asked WHEN, which is why
       it survived — and the fairness check that finally went red did so
       because the label moved, not because it was looking at the timing. */
    const plate = await page.evaluate(() => {
      const D = n => localISO(new Date(Date.now() + 864e5 * n));
      const out = {};
      Object.keys(PREP_PATHS).forEach(path => {
        const rows = []; let prev = null;
        for (let w = 16; w >= 1; w--) {
          STATE.prep = { planFrom: D(-(20 - w) * 7), date: D(w * 7), path, results: {} };
          const u = ruckLadderWeek();
          rows.push({ left: u.left, phase: u.phase, lb: u.lb, km: u.km,
                      up: prev !== null && u.lb > prev });
          prev = u.lb;
        }
        out[path] = { final: rows[rows.length - 1].lb,
                      steps: rows.filter(r => r.up).length,
                      inTaper: rows.filter(r => r.up && r.phase === 'taper').length,
                      taperWeeks: rows.filter(r => r.phase === 'taper').length,
                      lastStepLeft: (rows.filter(r => r.up).pop() || {}).left };
      });
      return out;
    });
    const paths = Object.keys(plate);
    t.ok('guard: both training paths were measured', paths.length >= 2, paths);
    t.ok('guard: and each block really has a taper in it',
      paths.every(p => plate[p].taperWeeks >= 2), plate);

    /* THE FINDING. */
    paths.forEach(p => {
      t.eq('the ' + p + ' path never raises the plate in the taper', plate[p].inTaper, 0, plate[p]);
      /* THE FLOOR: the step is not DROPPED. Dropping it leaves one path
         lighter for the whole block, which is a bias in VOLUME — the one
         thing v340 says the two paths may never differ in. */
      t.eq('and still takes all four steps', plate[p].steps, 4, plate[p]);
    });
    t.ok('both paths finish the block on the same plate',
      plate[paths[0]].final === plate[paths[1]].final,
      { a: plate[paths[0]].final, b: plate[paths[1]].final });
    t.ok('and the last step lands before the taper on both',
      paths.every(p => plate[p].lastStepLeft > 2), plate);
  }


  /* v372 — THE TAPER EASED TWO OF THE THREE TRAINING STREAMS. The running plan
     cuts volume in the last fortnight and the ruck ladder cuts distance while
     holding the plate — and the strength program ran at FULL volume through
     both, up to the day before the evaluation. Measured at 12 weeks out, 3
     weeks out and the day before: 5 movements, 10 sets, byte-identical.

     `PREP_PHASE_NOTE.taper` is a specification and it says "you cannot gain
     fitness now — you can only arrive tired, so do not". v370 and v371 fixed
     that contradiction in words; this is the one place it cost real
     freshness. A FOURTH automatic deload trigger, not a new mechanism. */
  {
    const ease = await page.evaluate(() => {
      const D = n => localISO(new Date(Date.now() + 864e5 * n));
      const sum = p => { const s = buildSession(p);
        return { sets: (s.main || []).reduce((a, m) => a + m.sets, 0),
                 work: (s.main || []).reduce((a, m) => a + m.target * m.sets, 0) }; };
      /* NOT pointer 40: it is week 6 of 6 and therefore already a deload, so
         both readings agree and the check passes on nothing. */
      let p = 0; for (p = 0; p < 378; p++) { const q = posOf(p); if (q.week !== WEEKS_PER_CYCLE && q.week >= 3) break; }
      STATE.progressPtr = p;
      const at = (from, to) => {
        STATE.prep = to === null ? { results: {} }
          : { planFrom: D(from), date: D(to), path: 'operator', results: {} };
        const b = deloadBanner();
        return { phase: prepPhase(), deload: deloadOn(), ...sum(p),
                 taperBanner: /Taper — lighter load on purpose/.test(b),
                 anyBanner: !!b };
      };
      const o = { ptr: p, week: posOf(p).week };
      o.noDate = at(0, null); o.build = at(-40, 70);
      o.sharpen = at(-80, 21); o.taper = at(-90, 10); o.dayBefore = at(-97, 1);
      STATE.settings.autoDeload = false;
      o.optedOut = at(-90, 10);
      delete STATE.settings.autoDeload;
      /* A calendar deload keeps its own wording — the taper copy must not
         swallow the other reasons. */
      STATE.prep = { results: {} };
      let d = 0; for (d = 0; d < 378; d++) if (posOf(d).week === WEEKS_PER_CYCLE) break;
      STATE.progressPtr = d;
      o.calendar = { deload: deloadOn(), banner: deloadBanner(),
                     taperBanner: /Taper — lighter load/.test(deloadBanner()) };
      STATE.progressPtr = p;
      return o;
    });

    t.ok('guard: the measured week is not already a deload week',
      ease.week !== 6, { week: ease.week, ptr: ease.ptr });
    t.eq('guard: the phases really are what the block says',
      [ease.build.phase, ease.sharpen.phase, ease.taper.phase, ease.dayBefore.phase],
      ['build', 'sharpen', 'taper', 'taper'], ease);

    /* THE FLOORS FIRST: nothing outside the taper moves. v310's rule is that
       a deadline may never ADD work; a fix that eased every phase would break
       the block it exists to build. */
    t.ok('an athlete with no test date is untouched', !ease.noDate.deload, ease.noDate);
    t.ok('so is the build phase', !ease.build.deload, ease.build);
    t.ok('and the sharpen phase', !ease.sharpen.deload, ease.sharpen);
    t.eq('their sessions are identical',
      [ease.noDate.sets, ease.build.sets, ease.sharpen.sets],
      [ease.noDate.sets, ease.noDate.sets, ease.noDate.sets], ease);

    /* THE FINDING. */
    t.ok('the taper eases the strength program', ease.taper.deload, ease.taper);
    t.ok('and so does the day before the evaluation', ease.dayBefore.deload, ease.dayBefore);
    t.ok('the sets really come down',
      ease.taper.sets < ease.noDate.sets, { taper: ease.taper.sets, normal: ease.noDate.sets });
    t.ok('and the work with them',
      ease.taper.work < ease.noDate.work * 0.75, { taper: ease.taper.work, normal: ease.noDate.work });

    /* A QUIET 44% CUT READS AS A BUG. */
    t.ok('the taper names itself as the reason', ease.taper.taperBanner, ease.taper);
    t.ok('and there is no banner when nothing is eased', !ease.noDate.anyBanner, ease.noDate);
    /* The taper copy must not swallow the other reasons. */
    t.ok('guard: a calendar deload week still eases', ease.calendar.deload, ease.calendar);
    t.ok('and keeps its own wording', !ease.calendar.taperBanner, ease.calendar);

    /* AN ATHLETE WHO TURNED AUTOMATIC DELOADS OFF KEEPS THAT CHOICE — the
       taper is a fourth automatic trigger, not an override of one. */
    t.ok('opting out of automatic deloads still opts out in the taper',
      !ease.optedOut.deload, ease.optedOut);
    t.eq('and their session is unchanged', ease.optedOut.sets, ease.noDate.sets, ease.optedOut);

    /* IT FAILS CLOSED, AND THAT MATTERS MORE THAN IT LOOKS. deloadOn() catches
       for the WHOLE composite, so a throw from the new trigger would discard
       the calendar week and the readiness slump with it — turning a real
       deload OFF. Nothing reachable exercises that, so the contract is pinned
       directly, the v338 prepDatePassed() shape. */
    const closed = await page.evaluate(() => {
      const real = window.prepPhase;
      let out = null, kept = null;
      try {
        let d = 0; for (d = 0; d < 378; d++) if (posOf(d).week === WEEKS_PER_CYCLE) break;
        STATE.progressPtr = d; STATE.prep = { results: {} };
        prepPhase = () => { throw new Error('boom'); };
        out = prepTaperEase();
        kept = deloadOn();
      } finally { prepPhase = real; }
      return { eased: out, calendarSurvived: kept };
    });
    t.eq('the taper trigger answers no when the phase check throws', closed.eased, false, closed);
    t.ok('and a real calendar deload survives it', closed.calendarSurvived, closed);

    /* v372 (same round) — AND THE BRIEF NEVER MENTIONED THE EVALUATION. Not at
       twelve weeks, not the day before it: measured silent at every phase,
       while the prep card counted down and — after the fix above — the session
       eased underneath it with nothing spoken to explain why. The brief is the
       segment the coach READS ALOUD, and v315's rule is that a spoken line is
       the one an athlete cannot double-check by looking. */
    const brief = await page.evaluate(() => {
      const D = n => localISO(new Date(Date.now() + 864e5 * n));
      const at = to => {
        STATE.prep = to === null ? { results: {} }
          : { planFrom: D(-100), date: D(to), path: 'operator', results: {} };
        const segs = briefSegments() || [];
        const seg = segs.find(x => x && x.title === 'Your test date');
        const all = JSON.stringify(segs);
        return { phase: prepPhase(), has: !!seg, say: seg ? seg.say : '',
                 segments: segs.length, mentionsAnywhere: /evaluation/i.test(all) };
      };
      return { none: at(null), build: at(84), sharpen: at(21), taper: at(10), tomorrow: at(1) };
    });

    t.eq('guard: the phases really are what the block says',
      [brief.build.phase, brief.sharpen.phase, brief.taper.phase],
      ['build', 'sharpen', 'taper'], brief);

    /* THE FLOOR FIRST: an athlete with no test date hears nothing about one.
       A segment that always fires is one nobody listens to. */
    t.ok('an athlete with no test date gets no such segment', !brief.none.has, brief.none);
    t.ok('and the word is not spoken anywhere in their brief',
      !brief.none.mentionsAnywhere, brief.none);

    /* THE FINDING. */
    ['build', 'sharpen', 'taper', 'tomorrow'].forEach(k => {
      t.ok('the brief names the evaluation in the ' + k + ' state', brief[k].has, brief[k]);
    });
    /* IT SAYS SOMETHING DIFFERENT PER PHASE — a single line repeated would
       pass every "it is mentioned" assertion and tell the athlete nothing. */
    t.ok('the taper brief says the sessions ease off',
      /taper/i.test(brief.taper.say) && /ease/i.test(brief.taper.say), brief.taper.say);
    t.ok('and says why, in the plan\'s own words',
      /arrive tired/i.test(brief.taper.say), brief.taper.say);
    t.ok('the build brief says the volume is still climbing',
      /climb/i.test(brief.build.say), brief.build.say);
    t.ok('the sharpen brief says it stops climbing',
      /stops climbing/i.test(brief.sharpen.say), brief.sharpen.say);
    t.ok('the three phases do not share one line',
      brief.build.say !== brief.sharpen.say && brief.sharpen.say !== brief.taper.say, brief);
    /* THE COUNTDOWN IS REAL, not a fixed phrase. */
    t.ok('it counts the weeks left', /12 weeks out/.test(brief.build.say), brief.build.say);
    t.ok('and reads the last week as one week', /One week out|This week/.test(brief.tomorrow.say), brief.tomorrow.say);
  }


  /* v373 — THE WATCH IMPORT WROTE MINUTES WITHOUT SAYING THEY WERE MINUTES.
     saveActivityRead() sets the unit for the run, the ruck and skipping, and
     wrote a bare number for the bike and the jacks — so the readers priced it
     in whatever unit the athlete had last left the field on. Measured:

       bike, unit left on distance   30 min imported -> read as 30 km
                                     = 100 min = 893 kcal, against ~268
       jacks, unit left on reps      20 min imported -> read as 20 REPS
                                     = 0.4 min = 3 kcal

     Over-crediting is the worse direction — movement earns calorie room on
     the surplus, so 893 kcal goes straight into the food budget. */
  {
    const act = await page.evaluate(() => {
      const day = () => nutToday();
      const fresh = () => { STATE.nutrition.days = {}; save(); };
      const imp = o => { _actRead = Object.assign(
        { steps: 0, run: { km: 0, min: 0 }, ruck: { km: 0, min: 0 },
          bike: { min: 0 }, jacks: { min: 0 }, skip: { min: 0 }, unplaced: [] }, o);
        saveActivityRead(); };
      const out = {};
      /* Each mode imported with the field left on a DIFFERENT unit — the
         state that made the number mean something else. */
      fresh(); setBikeUnit('dist'); setBikeVal(12); imp({ bike: { min: 30 } });
      out.bike = { unit: day().bikeUnit, val: day().bikeVal,
                   min: CARDIO_INFO.bike.dayMin(day()),
                   kcal: Math.round(CARDIO_INFO.bike.dayKcal(day())) };
      fresh(); setJackUnit('reps'); setJackVal(400); imp({ jacks: { min: 20 } });
      out.jacks = { unit: day().jackUnit, val: day().jackVal,
                    min: CARDIO_INFO.jacks.dayMin(day()),
                    kcal: Math.round(CARDIO_INFO.jacks.dayKcal(day())) };
      /* The three that were already right — the floors that show the shape. */
      fresh(); setSkipUnit('kcal'); setSkipVal(300); imp({ skip: { min: 25 } });
      out.skip = { unit: day().skipUnit, val: day().skipVal,
                   min: CARDIO_INFO.skip.dayMin(day()) };
      fresh(); setRunUnit('min'); imp({ run: { km: 5, min: 30 } });
      out.run = { unit: day().runUnit, val: day().runVal };
      fresh(); setRuckUnit('dist'); imp({ ruck: { km: 0, min: 45 } });
      out.ruck = { unit: day().ruckUnit, val: day().ruckVal };
      fresh();
      return out;
    });

    /* THE FINDING: the unit travels with the number. */
    t.eq('an imported bike ride is stored as minutes', act.bike.unit, 'min', act.bike);
    t.eq('and reads back as the minutes imported', act.bike.min, 30, act.bike);
    t.ok('so the energy is the ride, not a distance',
      act.bike.kcal > 200 && act.bike.kcal < 400, act.bike);
    t.eq('imported jacks are stored as minutes', act.jacks.unit, 'min', act.jacks);
    t.eq('and read back as the minutes imported', act.jacks.min, 20, act.jacks);
    t.ok('so they are not priced as twenty reps',
      act.jacks.kcal > 100, act.jacks);

    /* THE FLOORS: the three that already set their unit still do, and the two
       that carry a DISTANCE still store one. A fix that forced 'min'
       everywhere would break the run. */
    t.eq('skipping still sets its own unit', act.skip.unit, 'min', act.skip);
    t.eq('and still reads back', act.skip.min, 25, act.skip);
    t.eq('a run with a distance is still stored as a distance', act.run.unit, 'dist', act.run);
    t.eq('and a ruck with only minutes falls to minutes', act.ruck.unit, 'min', act.ruck);
    t.eq('with the minutes it was given', act.ruck.val, 45, act.ruck);
  }


  /* v374 — TRUTHINESS WAS DOING A MEMBERSHIP TEST'S JOB IN THE PHOTO REPAIR,
     and `typeof === 'string'` a date test's — the pair v356 fixed for the five
     activity logs, never applied here. Measured:

       pose 'helicopter'   survived, and the gallery groups by POSE_KEYS, so
                           the photo was invisible in every group while still
                           travelling in every backup
       date 'not-a-date'   survived, printed "not-a-date · front" on the glass,
                           and photoPair() picked it as the NOW — a 90-day
                           transformation shown against an undated shot
                           instead of against today's real one

     THE BYTES ARE NEVER DROPPED. That is this repair's own stated rule and it
     is the right one — a photo cannot be re-created — so unlike the activity
     logs a bad row is repaired rather than filtered out. */
  {
    const ph = await page.evaluate(() => {
      const D = n => localISO(new Date(Date.now() - 864e5 * n));
      const out = {};
      /* A real gallery with one junk-dated row in the same pose. */
      STATE.photos = [{ id: 'a1', date: D(90), pose: 'front' },
                      { id: 'a2', date: D(0), pose: 'front' },
                      { id: 'bad', date: 'not-a-date', pose: 'front' }];
      normalizeState();
      out.keptIds = STATE.photos.map(p => p.id);
      out.badDate = STATE.photos.find(p => p.id === 'bad').date;
      const pr = photoPair();
      out.pair = pr ? { a: pr.a.id, b: pr.b.id, pose: pr.pose } : null;
      PROGRESS_TAB = 'body'; go('progress'); render();
      const txt = document.querySelector('.view.active').innerText;
      out.printsJunk = /not-a-date/.test(txt);
      /* SCOPE IT TO THE TILE. A page-wide /no date/ also matches the
         projection copy, so the mutant that prints a blank caption escaped. */
      const tile = [...document.querySelectorAll('.view.active img.ph-img')]
        .map(i => i.parentElement)
        .find(d => d && (d.querySelector('img.ph-img') || {}).dataset &&
                   d.querySelector('img.ph-img').dataset.pid === 'bad');
      out.tileText = tile ? tile.innerText.trim() : null;
      out.saysNoDate = !!(tile && /no date/i.test(tile.innerText));
      out.fileName = photoFileName(STATE.photos.find(p => p.id === 'bad'));

      /* A junk POSE: repaired to a legal one so the photo is visible again. */
      STATE.photos = [{ id: 'h1', date: D(0), pose: 'helicopter' },
                      { id: 'h2', date: D(10), pose: 'back' }];
      normalizeState();
      out.poses = STATE.photos.map(p => p.pose);

      /* THE FLOOR: an ordinary gallery is untouched, and every legal pose
         survives as itself — a repair that forced 'front' everywhere would
         satisfy every assertion above and destroy the back and side shots. */
      STATE.photos = [{ id: 'g1', date: D(60), pose: 'front' },
                      { id: 'g2', date: D(60), pose: 'side' },
                      { id: 'g3', date: D(60), pose: 'back' },
                      { id: 'g4', date: D(0), pose: 'back' }];
      const before = JSON.stringify(STATE.photos);
      normalizeState();
      out.legalUntouched = JSON.stringify(STATE.photos) === before;
      const pr2 = photoPair();
      out.goodPair = pr2 ? { a: pr2.a.id, b: pr2.b.id, pose: pr2.pose } : null;

      /* Nothing comparable: two shots, two different poses. */
      STATE.photos = [{ id: 'x1', date: D(60), pose: 'front' },
                      { id: 'x2', date: D(0), pose: 'side' }];
      out.noPair = photoPair();
      /* And two undated shots of one pose are still not a timeline. */
      STATE.photos = [{ id: 'u1', date: '', pose: 'front' },
                      { id: 'u2', date: 'nope', pose: 'front' }];
      normalizeState();
      out.undatedPair = photoPair();
      out.undatedKept = STATE.photos.length;
      STATE.photos = [];
      return out;
    });

    /* THE BYTES SURVIVE — every row is still there. */
    t.eq('a junk-dated photo is kept, not deleted', ph.keptIds, ['a1', 'a2', 'bad'], ph);
    t.eq('its unusable date is blanked rather than invented', ph.badDate, '', ph);
    t.eq('and two undated shots are still kept', ph.undatedKept, 2, ph);

    /* THE COMPARISON IS HONEST. */
    t.eq('the before-and-now spans the two real dates',
      [ph.pair && ph.pair.a, ph.pair && ph.pair.b], ['a1', 'a2'], ph.pair);
    t.eq('undated shots alone make no pair', ph.undatedPair, null, ph);
    t.eq('and neither do two different poses', ph.noPair, null, ph);

    /* THE GLASS. */
    t.ok('the gallery no longer prints a junk date', !ph.printsJunk, ph);
    t.ok('guard: the undated tile really is on screen', ph.tileText !== null, ph);
    t.ok('its caption says the date is unknown instead', ph.saysNoDate, ph.tileText);
    t.eq('and the saved file is named undated', ph.fileName, 'coreforge-undated-front.jpg', ph);

    /* MEMBERSHIP, not truthiness: a junk pose becomes a legal one, so the
       photo is visible in a group again. */
    t.eq('a junk pose is repaired to a legal one', ph.poses, ['front', 'back'], ph);

    /* THE FLOOR: a clean gallery is byte-identical, and every legal pose
       survives as itself. */
    t.ok('an ordinary gallery is untouched by the repair', ph.legalUntouched, ph);
    t.eq('and the widest-span pose still wins',
      [ph.goodPair && ph.goodPair.pose, ph.goodPair && ph.goodPair.a, ph.goodPair && ph.goodPair.b],
      ['back', 'g3', 'g4'], ph.goodPair);
  }

  /* ---------- the rest hand-off had ONE rescue, and it needed the phone ----
     Reported from the phone twice. v350 investigated the first report, could
     not reproduce the stall, and removed a dependency instead: a rest that
     expired while the page was hidden now resolves on the next
     visibilitychange. The second report says why that was not enough — "I am
     already in the exercise position thinking I am starting the next set, only
     to realize after the rest countdown everything stops and I am forced to
     leave my exercise position, get to the phone to start the other set."

     MEASURED with the interval killed and no visibilitychange fired: the
     player sat in rest for ever, tid null and remain frozen. The rescue
     existed and it cost the athlete their position, which is the complaint.

     The heartbeat owns its own interval, so nothing in the phase code can
     clear it, and it covers HIIT as well — the twin v350 never reached. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true; STATE.progressPtr = 8; save();
      openPlayer(); await wait(200);
      PLAYER.i = 0; PLAYER.s = 0; plClear(); plEnterRest(3, 'set');
      plClear();                                 // the OS reclaims the interval
      PLAYER.deadline = Date.now() - 9000;       // the rest ended nine seconds ago
      R.frozen = { phase: PLAYER.phase, tid: !!PLAYER.tid, stalled: timerStalled(PLAYER) };
      await wait(5200);                          // no tap, no visibilitychange
      R.rescued = { phase: PLAYER.phase, tid: !!PLAYER.tid };

      // a PAUSED player is never resumed — that would restart a session the
      // athlete deliberately stopped
      plClear(); PLAYER.phase = 'rest'; PLAYER.phaseAt = Date.now() - 99000;
      PLAYER.running = false; PLAYER.deadline = Date.now() - 9000;
      await wait(4500);
      R.paused = { phase: PLAYER.phase, running: PLAYER.running, tid: !!PLAYER.tid };
      PLAYER.running = true;

      // an ordinary running rest is untouched, and a tap must NOT skip it —
      // one stray touch costing the whole rest is worse than the bug
      plClear(); plEnterRest(60, 'set'); await wait(2500);
      R.normal = { phase: PLAYER.phase, remain: PLAYER.remain, stalled: timerStalled(PLAYER) };
      document.querySelector('#plBody .pl-name').click(); await wait(200);
      R.innocentTap = PLAYER.phase;

      // ...but a tap while genuinely stuck DOES advance, from anywhere on the
      // screen: the three rest buttons measure 123x52, a small target to hit
      // from a plank
      plClear(); PLAYER.deadline = Date.now() - 9000; PLAYER.phaseAt = Date.now() - 99000;
      R.stuckNow = timerStalled(PLAYER);
      document.querySelector('#plBody .pl-name').click(); await wait(200);
      R.rescueTap = PLAYER.phase;
      playerTeardown(); await wait(300);
      return R;
    });
    t.ok('guard: the frozen rest really was stuck before the heartbeat ran',
      r.frozen && r.frozen.phase === 'rest' && r.frozen.tid === false && r.frozen.stalled === true,
      JSON.stringify(r.frozen));
    t.ok('a rest whose tick died starts the next set on its own — no tap, no visibilitychange',
      r.rescued && r.rescued.phase !== 'rest' && r.rescued.tid === true, JSON.stringify(r.rescued));
    t.eq('and a PAUSED player is left paused', r.paused && r.paused.phase + '/' + r.paused.running, 'rest/false');
    t.ok('floor: an ordinary rest is still counting down and is not stalled',
      r.normal && r.normal.phase === 'rest' && r.normal.remain > 0 && r.normal.stalled === false,
      JSON.stringify(r.normal));
    t.eq('floor: tapping the screen during a working rest does NOT skip it', r.innocentTap, 'rest');
    t.eq('guard: the screen really is stuck before the rescue tap', r.stuckNow, true);
    t.ok('tapping anywhere while stuck advances it', r.rescueTap !== 'rest', String(r.rescueTap));
  }

  /* HIIT is the twin v350 did not reach: the guided player got a resync on
     every return to the page and its interval sibling got nothing at all. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true; save();
      startHiit('tabata'); await wait(400);
      ivStep(0); await wait(200);
      ivClear(); INTV.deadline = Date.now() - 9000;
      R.frozen = { phase: INTV.phase, i: INTV.i, tid: !!INTV.tid, stalled: timerStalled(INTV) };
      await wait(5200);
      R.rescued = { phase: INTV.phase, i: INTV.i, tid: !!INTV.tid };
      ivStep(0); await wait(2500);
      R.normal = { i: INTV.i, stalled: timerStalled(INTV), remain: INTV.remain };
      hiitTeardown(); await wait(200);
      return R;
    });
    t.ok('guard: the frozen HIIT round really was stuck',
      r.frozen && r.frozen.tid === false && r.frozen.stalled === true, JSON.stringify(r.frozen));
    t.ok('a HIIT round whose tick died moves on by itself',
      r.rescued && r.rescued.i > r.frozen.i && r.rescued.tid === true, JSON.stringify(r.rescued));
    t.ok('floor: an ordinary HIIT round is untouched and not stalled',
      r.normal && r.normal.i === 0 && r.normal.stalled === false && r.normal.remain > 0,
      JSON.stringify(r.normal));
  }

  /* hiitToggle() now shares ivArmTick() with the resync rather than repeating
     it. Two copies of "which tick does this phase need" is two places to
     drift, and the resume path is the one nothing else drives. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true; save();
      startHiit('tabata'); await wait(300);
      ivStep(0); await wait(200);
      hiitToggle(); await wait(200);
      R.paused = { running: INTV.running, tid: !!INTV.tid };
      const was = INTV.remain;
      hiitToggle(); await wait(2200);
      R.resumed = { running: INTV.running, tid: !!INTV.tid, moved: INTV.remain < was };
      hiitTeardown(); await wait(200);
      return R;
    });
    t.eq('pausing HIIT stops its tick', r.paused && r.paused.running + '/' + r.paused.tid, 'false/false');
    t.ok('and resuming arms it again and the clock really moves',
      r.resumed && r.resumed.running === true && r.resumed.tid === true && r.resumed.moved === true,
      JSON.stringify(r.resumed));
  }

  /* timerStalled() is consulted from three places and every one of them is a
     narrow branch, so its own contract is pinned directly — the shape v338's
     prepDatePassed() needed. A phase change legitimately leaves tid null for
     an instant; treating that as a stall would re-arm the phase being left. */
  {
    const r = await page.evaluate(() => {
      const now = Date.now();
      const S = (o) => Object.assign({ running: true, phase: 'rest', tid: 1, phaseAt: now, deadline: 0 }, o);
      return {
        nullState: timerStalled(null),
        notRunning: timerStalled(S({ running: false, deadline: now - 9000 })),
        done: timerStalled(S({ phase: 'done', deadline: now - 9000 })),
        healthy: timerStalled(S({ deadline: now + 30000 })),
        justSwitched: timerStalled(S({ tid: null, phaseAt: now })),
        tickDied: timerStalled(S({ tid: null, phaseAt: now - 99000 })),
        deadlineGone: timerStalled(S({ deadline: now - 9000 })),
        deadlineJustGone: timerStalled(S({ deadline: now - 500 })),
        noPhase: timerStalled(S({ phase: null, deadline: now - 9000 }))
      };
    });
    t.eq('timerStalled: nothing open is not a stall', r.nullState, false);
    t.eq('timerStalled: a paused surface is not a stall', r.notRunning, false);
    t.eq('timerStalled: a finished surface is not a stall', r.done, false);
    t.eq('timerStalled: a healthy running phase is not a stall', r.healthy, false);
    t.eq('timerStalled: a phase change that just happened is not a stall', r.justSwitched, false);
    t.eq('timerStalled: a tick that vanished IS a stall', r.tickDied, true);
    t.eq('timerStalled: a deadline long gone IS a stall', r.deadlineGone, true);
    t.eq('timerStalled: a deadline a moment gone is not yet a stall', r.deadlineJustGone, false);
    t.eq('timerStalled: a surface with no phase yet is not a stall', r.noPhase, false);
  }

  /* A rep set and a get-ready must CLEAR the deadline they inherit. Rest sets
     one; the next phase would otherwise open holding a deadline that has
     already passed, and the heartbeat would read a healthy set as stuck. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true; STATE.progressPtr = 8; save();
      openPlayer(); await wait(200);
      PLAYER.i = 0; PLAYER.s = 0;
      plClear(); plEnterRest(2, 'set');
      PLAYER.deadline = Date.now() - 9000;      // a rest deadline in the past
      plClear(); plEnterReady(false);
      R.ready = { deadline: PLAYER.deadline, stalled: timerStalled(PLAYER) };
      // a rep-counted movement: find one in this session
      const idx = PLAYER.items.findIndex(m => m.unit !== 'time');
      R.hasRep = idx >= 0;
      if (idx >= 0) {
        PLAYER.i = idx; PLAYER.s = 0;
        PLAYER.deadline = Date.now() - 9000;
        plClear(); plEnterWork();
        R.work = { deadline: PLAYER.deadline, stalled: timerStalled(PLAYER) };
      }
      playerTeardown(); await wait(200);
      return R;
    });
    t.eq('the get-ready phase clears the rest deadline it inherits', r.ready && r.ready.deadline, 0);
    t.eq('so a fresh get-ready never reads as stalled', r.ready && r.ready.stalled, false);
    t.eq('guard: this session really holds a rep-counted movement', r.hasRep, true);
    t.eq('a rep set clears it too', r.work && r.work.deadline, 0);
    t.eq('so a fresh rep set never reads as stalled', r.work && r.work.stalled, false);
  }

  /* ---------- say "continue" and the next set starts --------------------
     Asked for straight after the rest hand-off report: "so I can just say
     continue and the new set starts." The heartbeat above removes the STALL;
     this removes the TAP.

     ONE WORD, AND IT ONLY EVER MOVES FORWARD. A misheard "stop" would end a
     session; a misheard "continue" costs at most an early rest, which +15s
     puts straight back. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      R.support = voiceCmdSupported();
      delete STATE.settings.voiceCmd;
      R.offByDefault = voiceCmdOn();

      STATE.onboarded = true; STATE.progressPtr = 8; save();
      STATE.settings.voiceCmd = true; save();
      openPlayer(); await wait(200);
      PLAYER.i = 0; PLAYER.s = 0; plClear(); plEnterRest(60, 'set');
      R.inRest = { phase: PLAYER.phase, actionable: voiceCmdActionable() };

      R.wrongWord = voiceCmdHeard('bananas and rice');
      R.afterWrong = PLAYER.phase;
      R.rightWord = voiceCmdHeard('ok continue please');
      R.afterRight = PLAYER.phase;

      // during a working set the word means nothing — listening there would
      // spend the microphone on a phase where it cannot act
      plClear(); plEnterWork(); await wait(100);
      R.inWork = { phase: PLAYER.phase, actionable: voiceCmdActionable() };
      R.workWord = voiceCmdHeard('continue');
      R.afterWorkWord = PLAYER.phase;

      // ...and with the setting OFF the word does nothing at all
      plClear(); plEnterRest(60, 'set');
      STATE.settings.voiceCmd = false; save();
      R.offWord = voiceCmdHeard('continue');
      R.afterOffWord = PLAYER.phase;
      playerTeardown(); await wait(200);
      return R;
    });
    t.eq('guard: this browser really does have speech recognition', r.support, true);
    t.eq('the voice command is absent by default — the athlete has not chosen', r.offByDefault, false);
    t.ok('guard: the player really is resting and the word can act there',
      r.inRest && r.inRest.phase === 'rest' && r.inRest.actionable === true, JSON.stringify(r.inRest));
    t.eq('floor: a word that is not the command does nothing', r.wrongWord, false);
    t.eq('and the rest is left alone', r.afterWrong, 'rest');
    t.eq('saying "continue" during rest starts the next set', r.rightWord, true);
    t.ok('and the rest really ended', r.afterRight !== 'rest', String(r.afterRight));
    t.eq('guard: a working set is not somewhere the word can act', r.inWork && r.inWork.actionable, false);
    t.eq('floor: saying it during a working set does nothing', r.workWord, false);
    t.eq('and the set carries on', r.afterWorkWord, 'work');
    t.eq('floor: with the setting off the word does nothing', r.offWord, false);
    t.eq('and the rest carries on', r.afterOffWord, 'rest');
  }

  /* IT IGNORES THE APP'S OWN VOICE. The coach names the next movement during
     rest, and the library carries steps like "Continue alternating, walking
     forward" — so without this the app talks itself into the next set. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true; STATE.progressPtr = 8; STATE.settings.voiceCmd = true; save();
      openPlayer(); await wait(200);
      PLAYER.i = 0; PLAYER.s = 0; plClear(); plEnterRest(60, 'set');
      _vrSpokeAt = Date.now();                    // the app just spoke
      R.duringEcho = voiceCmdHeard('continue');
      R.phaseDuringEcho = PLAYER.phase;
      _vrSpokeAt = Date.now() - (VOICE_ECHO_TAIL_MS + 500);   // the tail has passed
      R.afterEcho = voiceCmdHeard('continue');
      R.phaseAfterEcho = PLAYER.phase;
      playerTeardown(); await wait(200);
      return R;
    });
    t.eq('a "continue" heard while the app is talking is thrown away', r.duringEcho, false);
    t.eq('so the rest is not ended by the coach', r.phaseDuringEcho, 'rest');
    t.eq('floor: once the tail has passed the athlete is heard again', r.afterEcho, true);
    t.ok('and the rest really ended', r.phaseAfterEcho !== 'rest', String(r.phaseAfterEcho));
  }

  /* The microphone is opened by the heartbeat, not by each opener — the same
     reason the heartbeat itself is armed once at boot. And it must CLOSE: a
     recogniser left running after the session is a battery and privacy cost
     with nothing on screen to explain it. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      let started = 0, stopped = 0;
      const Real = window.SpeechRecognition || window.webkitSpeechRecognition;
      /* EACH BLOCK BUILDS THE STATE IT ASSERTS ON. The block above ends with a
         real recogniser still open — the heartbeat closes it on its own beat,
         up to PL_GUARD_MS later — so without this the stub below is never
         constructed and both counts read 0 on correct code. Passed standalone
         and failed in the full run, which is exactly how a block-order
         dependency shows itself. */
      STATE.settings.voiceCmd = false; save(); voiceCmdStop();
      window.SpeechRecognition = function () { this.start = () => { started++; }; this.stop = () => { stopped++; if (this.onend) this.onend(); }; };
      R.cleanStart = (_vrec === null);
      STATE.onboarded = true; STATE.progressPtr = 8; STATE.settings.voiceCmd = true; save();
      openPlayer(); await wait(2600);
      R.started = started;
      playerTeardown(); await wait(2600);
      R.stopped = stopped;

      // with the setting OFF nothing is ever opened
      started = 0; stopped = 0;
      STATE.settings.voiceCmd = false; save();
      openPlayer(); await wait(2600);
      R.startedWhenOff = started;
      playerTeardown(); await wait(300);
      window.SpeechRecognition = Real;
      return R;
    });
    t.eq('guard: no recogniser was left open by the block before', r.cleanStart, true);
    t.ok('the heartbeat opens the microphone while a session is running', r.started >= 1, String(r.started));
    t.ok('and closes it when the session ends', r.stopped >= 1, String(r.stopped));
    t.eq('floor: with the setting off it is never opened', r.startedWhenOff, 0);
  }

  /* FORWARD ONLY. There is deliberately no voice command that stops, pauses or
     quits — the stop-for-pain button stays a deliberate tap, which is this
     app's oldest safety rule and not something a microphone gets a vote in.
     Asserted on the SOURCE because the absence of a route cannot be driven. */
  {
    const r = await page.evaluate(() => ({
      advance: voiceCmdAdvance.toString(),
      heard: voiceCmdHeard.toString(),
      word: VOICE_CMD_WORD
    }));
    const body = r.advance + r.heard;
    t.eq('there is exactly one command word', r.word, 'continue');
    t.ok('no voice path quits a session', !/hiitQuit|plEnterDone|playerTeardown|hardReset/.test(body), body.slice(0, 200));
    t.ok('no voice path pauses a session', !/playerToggle|hiitToggle/.test(body), body.slice(0, 200));
    t.ok('no voice path skips a whole exercise', !/playerSkip\b|hiitSkip/.test(body), body.slice(0, 200));
    t.ok('and it only acts where the word can act', /voiceCmdActionable\(\)/.test(r.heard), r.heard.slice(0, 200));
  }

  /* The setting reaches a chip and a rest screen, and importData() accepts
     arbitrary JSON — so it is repaired at boot. Absent is the contract for
     "not chosen", which is why the test is !== undefined and not != null: a
     stored null is a junk key that travels in every backup. */
  {
    const r = await page.evaluate(() => {
      const out = {};
      for (const junk of ['yes', 1, 0, {}, [], null]) {
        STATE.settings.voiceCmd = junk;
        normalizeState();
        out[JSON.stringify(junk)] = Object.prototype.hasOwnProperty.call(STATE.settings, 'voiceCmd')
          ? JSON.stringify(STATE.settings.voiceCmd) : 'absent';
      }
      STATE.settings.voiceCmd = true; normalizeState();
      out.realTrue = STATE.settings.voiceCmd;
      STATE.settings.voiceCmd = false; normalizeState();
      out.realFalse = STATE.settings.voiceCmd;
      delete STATE.settings.voiceCmd; normalizeState();
      out.absentStaysAbsent = Object.prototype.hasOwnProperty.call(STATE.settings, 'voiceCmd') ? 'present' : 'absent';
      return out;
    });
    ['"yes"', '1', '0', '{}', '[]', 'null'].forEach(k =>
      t.eq('a junk voiceCmd (' + k + ') is dropped at boot', r[k], 'absent'));
    t.eq('floor: a real yes survives', r.realTrue, true);
    t.eq('floor: a real no survives', r.realFalse, false);
    t.eq('floor: absent stays absent', r.absentStaysAbsent, 'absent');
  }

  /* The rest screen names the word it is listening for. A feature the athlete
     cannot see is one they will not use, and it is the screen where it acts. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true; STATE.progressPtr = 8; save();
      STATE.settings.voiceCmd = true; save();
      openPlayer(); await wait(200);
      PLAYER.i = 0; PLAYER.s = 0; plClear(); plEnterRest(60, 'set');
      R.on = document.getElementById('plBody').textContent;
      STATE.settings.voiceCmd = false; save();
      plClear(); plEnterRest(60, 'set');
      R.off = document.getElementById('plBody').textContent;
      playerTeardown(); await wait(200);
      return R;
    });
    t.ok('the rest screen says which word starts the next set', /continue/i.test(r.on), r.on.slice(0, 160));
    t.ok('floor: and says nothing about it when the setting is off', !/say .continue/i.test(r.off), r.off.slice(0, 160));
  }

  /* ---------- a tick is not a second, and five surfaces treated it as one ----
     v375 gave the guided player and HIIT a wall-clock anchor and a heartbeat.
     There are SEVEN timed surfaces in this app. plTickHold() has had the floor
     since it was written with a comment explaining exactly this — Chrome
     throttles a hidden tab to about one tick a minute, and an OS can reclaim
     the interval outright — and the count-UP timers never got one.

     Measured before the fix, ticks stopped for six real seconds: the hold test
     lost 8 seconds and the baseline test lost 7, and neither recovered. Those
     two measure a MAXIMAL EFFORT — one anchors every prescription for a year,
     the other sets a personal best — so under-reporting them is worse than a
     frozen screen, and it is silent. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true;
      STATE.profile.parq = [false, false, false, false, false, false, false];
      STATE.profile.parqDone = true; STATE.profile.medCleared = true; save();
      R.cleared = !safeMode();

      // the hold test — a max effort held to failure
      startHoldTest('plank'); await wait(200);
      R.htStarted = !!_ht;
      for (let i = 0; i < 4; i++) await wait(1050);
      const h0 = _ht.elapsed, t0 = Date.now();
      clearInterval(_ht.iv);              // the OS reclaims the interval
      await wait(6500);                   // six real seconds with no ticks
      await wait(2600);                   // then one heartbeat
      const realH = Math.round((Date.now() - t0) / 1000);
      R.hold = { counted: _ht.elapsed - h0, real: realH, recovered: !!_ht.iv };
      cancelHoldTest(); await wait(200);

      // the baseline battery — the number that anchors a year
      assessState = { idx: 0, results: {}, reassess: false };
      startBaselineTimer(); await wait(200);
      R.btStarted = !!_bt;
      for (let i = 0; i < 4; i++) await wait(1050);
      const b0 = _bt.elapsed, s0 = Date.now();
      clearInterval(_bt.iv);
      await wait(6500); await wait(2600);
      const realB = Math.round((Date.now() - s0) / 1000);
      R.baseline = { counted: _bt.elapsed - b0, real: realB, recovered: !!_bt.iv };
      stopBaselineTimer(); await wait(200);

      // FLOOR: a healthy timer is untouched — the floor must not distort a
      // normal run, or it is a different bug wearing the fix's clothes
      startHoldTest('plank'); await wait(200);
      for (let i = 0; i < 3; i++) await wait(1050);
      const f0 = _ht.elapsed, ft = Date.now();
      await wait(4200);
      R.healthy = { counted: _ht.elapsed - f0, real: Math.round((Date.now() - ft) / 1000) };
      cancelHoldTest(); await wait(200);
      return R;
    });
    t.eq('guard: the athlete really is cleared for a maximal effort', r.cleared, true);
    t.eq('guard: the hold test really started', r.htStarted, true);
    t.ok('a hold test counts REAL seconds, not the ticks it happened to get',
      r.hold && Math.abs(r.hold.counted - r.hold.real) <= 2, JSON.stringify(r.hold));
    t.eq('and its tick is brought back by the heartbeat', r.hold && r.hold.recovered, true);
    t.eq('guard: the baseline timer really started', r.btStarted, true);
    t.ok('the baseline test counts REAL seconds — it anchors a year of prescriptions',
      r.baseline && Math.abs(r.baseline.counted - r.baseline.real) <= 2, JSON.stringify(r.baseline));
    t.eq('and its tick is brought back too', r.baseline && r.baseline.recovered, true);
    t.ok('floor: an ordinary uninterrupted hold is unchanged — no drift either way',
      r.healthy && Math.abs(r.healthy.counted - r.healthy.real) <= 1, JSON.stringify(r.healthy));
  }

  /* THE FLOOR AND THE RESCUE ARE TWO FIXES, AND THE CHECK ABOVE MEASURES THEM
     TOGETHER. Both "no floor" mutants ESCAPED it: once the heartbeat re-arms
     the tick, the seconds it then counts bring the total close enough to real
     time that a tolerance-based assertion passes with the floor deleted. The
     rescue was doing the work the check credited to the floor.

     So the floor gets its own measurement, with the heartbeat held OFF and
     exactly ONE tick driven by hand across a six-second gap. With the floor
     that tick reports the six seconds that really passed; without it, it
     reports one. Nothing else can tell them apart. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true;
      STATE.profile.parq = [false, false, false, false, false, false, false];
      STATE.profile.parqDone = true; STATE.profile.medCleared = true; save();
      plGuardOff();                       // the rescue must not do the floor's work
      try {
        startHoldTest('plank'); await wait(200);
        for (let i = 0; i < 4; i++) await wait(1050);
        R.htMode = _ht && _ht.mode;
        const h0 = _ht.elapsed;
        clearInterval(_ht.iv); _ht.iv = null;
        await wait(6000);
        R.htNoTicks = _ht.elapsed - h0;   // guard: nothing ran during the gap
        _ht.tick();                       // exactly one tick
        R.htJump = _ht.elapsed - h0;
        cancelHoldTest(); await wait(150);

        assessState = { idx: 0, results: {}, reassess: false };
        startBaselineTimer(); await wait(200);
        for (let i = 0; i < 4; i++) await wait(1050);
        R.btMode = _bt && _bt.mode;
        const b0 = _bt.elapsed;
        clearInterval(_bt.iv); _bt.iv = null;
        await wait(6000);
        R.btNoTicks = _bt.elapsed - b0;
        _bt.tick();
        R.btJump = _bt.elapsed - b0;
        stopBaselineTimer(); await wait(150);
      } catch (e) { R.err = String(e); }
      plGuardOn();
      return R;
    });
    t.eq('guard: no error while the heartbeat was held off', r.err, undefined);
    t.eq('guard: the hold test really was running', r.htMode, 'run');
    t.eq('guard: and nothing ticked during the six-second gap', r.htNoTicks, 0);
    t.ok('one tick after a six-second gap reports the six seconds that really passed',
      r.htJump >= 5, 'jumped ' + r.htJump + ' — a tick-counter would report 1');
    t.eq('guard: the baseline timer really was running', r.btMode, 'run');
    t.eq('guard: and nothing ticked during its gap', r.btNoTicks, 0);
    t.ok('the baseline test does the same — it anchors a year of prescriptions',
      r.btJump >= 5, 'jumped ' + r.btJump + ' — a tick-counter would report 1');
  }

  /* The warm-up flow HAD a resume (_flowResume) and nothing ever called it but
     the Pause button — no visibilitychange, no heartbeat. So a frozen stretch
     stayed frozen, on the surface the guided day walks through FIRST. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true; save();
      runWarmup(); await wait(2200);
      R.open = { hasTick: typeof (timer && timer.tick) === 'function', stamped: !!(timer && timer.lastTick) };
      clearInterval(timer.iv);            // the OS reclaims it
      await wait(6500);                   // long enough for a heartbeat
      R.after = { recovered: !!(timer && timer.iv), fresh: !!(timer && Date.now() - timer.lastTick < 4000) };
      flowStop(false); await wait(300);
      return R;
    });
    t.eq('guard: the flow hands its own tick to the heartbeat', r.open && r.open.hasTick, true);
    t.eq('guard: and stamps when it last ran', r.open && r.open.stamped, true);
    t.eq('a warm-up whose tick died is brought back', r.after && r.after.recovered, true);
    t.eq('and is really ticking again, not merely re-armed', r.after && r.after.fresh, true);
  }

  /* tickStalled()/tickResync() are consulted only from the heartbeat, so their
     own contract is pinned directly — the shape v338's prepDatePassed() needed
     and v375's timerStalled() reused. */
  {
    const r = await page.evaluate(() => {
      const now = Date.now();
      const S = (o) => Object.assign({ lastTick: now, tick: () => {}, iv: 1 }, o);
      return {
        nullState: tickStalled(null),
        healthy: tickStalled(S({})),
        justRan: tickStalled(S({ lastTick: now - 500 })),
        longGone: tickStalled(S({ lastTick: now - 99000 })),
        noTickFn: tickStalled({ lastTick: now - 99000, iv: 1 }),
        noStamp: tickStalled({ tick: () => {}, iv: 1 }),
        upFloor: (() => { const o = { startedAt: now - 9000, elapsed: 2 }; return tickUp(o); })(),
        upNeverSlower: (() => { const o = { startedAt: now - 1000, elapsed: 40 }; return tickUp(o); })()
      };
    });
    t.eq('tickStalled: nothing open is not a stall', r.nullState, false);
    t.eq('tickStalled: a tick that just ran is not a stall', r.healthy, false);
    t.eq('tickStalled: half a second ago is not a stall', r.justRan, false);
    t.eq('tickStalled: a tick long gone IS a stall', r.longGone, true);
    t.eq('tickStalled: a surface with no tick to re-arm is skipped', r.noTickFn, false);
    t.eq('tickStalled: a surface that never stamped is skipped', r.noStamp, false);
    t.eq('tickUp: nine real seconds beats two counted ticks', r.upFloor, 9);
    t.eq('tickUp: it is a FLOOR — it never winds a counter backwards', r.upNeverSlower, 41);
  }

  /* ---------- a note that opens by naming a different goal ---------------
     Reported from the phone with a screenshot: the athlete picked Lean recomp
     and read the note below the picker as leftover Tone-up text.

     IT WAS NOT LEFTOVER. Driven on the real Fuel picker, the note is dynamic
     and was correct — it is genuinely leanrecomp's own note. The defect is the
     WORDING: it opened with the words "Tone up", which is a button sitting
     directly above it, so it could not be read as an answer about the goal
     just chosen. His reaction is the proof.

     Opening with its OWN label is fine: `gain` starts "Build muscle on a
     slight surplus", which is the goal naming itself. Only another option's
     label collides — so the rule is a membership test against the OTHER
     labels, not a ban on goal names. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true; save();
      go('fuel'); await wait(300);
      const noteOf = () => {
        const v = document.getElementById('v-fuel');
        return [...v.querySelectorAll('.tiny.muted')].map(n => n.textContent.trim()).filter(x => x.length > 40)[0] || '';
      };
      setNutGoal('recomp'); await wait(250); R.recompNote = noteOf();
      setNutGoal('leanrecomp'); await wait(250); R.leanNote = noteOf();
      R.dynamic = R.recompNote !== R.leanNote;
      R.labels = GOALS.reduce((a, [k, l]) => (a[k] = String(l).replace(/[^\x20-\x7E]/g, '').trim(), a), {});
      R.notes = Object.assign({}, GOAL_NOTE);
      return R;
    });
    // the wiring was never the bug, and a check that assumed it was would be
    // testing the wrong thing — so it is pinned as a guard, not as the finding
    t.eq('guard: the note really is dynamic — picking a goal repaints it', r.dynamic, true);
    t.ok('guard: the lean-recomp note is the one on screen', /12%/.test(r.leanNote || ''), r.leanNote);

    const others = (g) => Object.keys(r.labels).filter(k => k !== g).map(k => r.labels[k]);
    Object.keys(r.notes).forEach(g => {
      const n = String(r.notes[g] || '').trim().toLowerCase();
      const bad = others(g).filter(L => L && n.startsWith(L.toLowerCase()));
      t.eq('GOAL_NOTE.' + g + ' does not open by naming a different goal', bad.join(','), '');
    });
    t.ok('floor: a goal may still open with its OWN name — gain says "Build muscle"',
      /^build muscle/i.test(String(r.notes.gain || '')), r.notes.gain);
    t.ok('floor: every note still explains something', Object.keys(r.notes).every(g => String(r.notes[g] || '').length > 30),
      JSON.stringify(Object.keys(r.notes).map(g => [g, String(r.notes[g] || '').length])));
  }

  /* A CLEAN VALIDATOR PROVES NOTHING ABOUT A VALIDATOR RULE — it stays clean
     whether the rule exists or not. So the data is broken in front of it and
     the specific complaint is required, then restored. validateData() LOGS,
     and the harness counts a console error as a page failure, so it is muted
     across the break. */
  {
    const r = await page.evaluate(() => {
      const keep = GOAL_NOTE.core;
      const realErr = console.error; console.error = () => {};
      let out = {};
      try {
        out.cleanBefore = validateData().filter(e => /GOAL_NOTE/.test(e)).length;
        GOAL_NOTE.core = 'Tone up but for your midsection.';        // another goal's label, first
        out.broken = validateData().filter(e => /GOAL_NOTE\.core.*Tone up/.test(e));
        GOAL_NOTE.core = 'Strong core & abs is what this one builds.'; // its OWN label — legal
        out.ownLabelOk = validateData().filter(e => /GOAL_NOTE\.core/.test(e)).length;
        GOAL_NOTE.core = keep;
        out.cleanAfter = validateData().filter(e => /GOAL_NOTE/.test(e)).length;
      } finally { GOAL_NOTE.core = keep; console.error = realErr; }
      return out;
    });
    t.eq('guard: the validator is clean on the shipped notes', r.cleanBefore, 0);
    t.eq('breaking one note in front of the rule produces the specific complaint', r.broken.length, 1);
    t.ok('and the complaint names the label it collided with', /Tone up/.test((r.broken[0] || '')), r.broken[0]);
    t.eq('floor: a note opening with its OWN goal label is legal', r.ownLabelOk, 0);
    t.eq('and the validator is clean again once restored', r.cleanAfter, 0);
  }

  /* ---------- v377's own two helpers, made fail-safe ---------------------
     Found by fuzzing the code shipped one round earlier — the fifth round
     running where the best finding was in the round immediately before.

     Neither is reachable on today's five timed surfaces: `startedAt` and
     `elapsed` are only ever set to real numbers, and all five ticks guard
     themselves. Both are kept because a rescue is the wrong place to be
     optimistic, and because the two ways of being wrong are not symmetrical —
     one second short is a rounding error, a NaN is a lost maximal effort.
     No route feeds either one junk, so both contracts are exercised DIRECTLY,
     the technique this file already uses for the hardness-band and anchor-unit
     guards. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      const now = Date.now();
      // tickUp must never return NaN — it is written into the record, not
      // merely shown. Measured before the fix: both of the first two produced
      // NaN, because a junk elapsed concatenates and a junk startedAt makes
      // the subtraction NaN.
      R.up = {
        junkElapsed: tickUp({ elapsed: 'x' }),
        junkStart: tickUp({ startedAt: 'y', elapsed: 3 }),
        nanStart: tickUp({ startedAt: NaN, elapsed: 2 }),
        empty: tickUp({}),
        negative: tickUp({ elapsed: -9, startedAt: now - 3000 }),
        /* AN ARRAY IS TRUTHY AND COERCES TO 0. These two produce a huge
           FINITE number, which "is it a number?" cannot see — the first
           version of this check tested only a STRING startedAt, which the
           isFinite layer already caught, so the mutant that dropped this
           guard ESCAPED. Measured: 1,787,973,936 seconds reported as the
           length of a hold. */
        arrayStart: tickUp({ elapsed: {}, startedAt: [] }),
        zeroStart: tickUp({ elapsed: 0, startedAt: 0 }),
        objectStart: tickUp({ elapsed: 1, startedAt: {} }),
        // and the floor still works on real input
        real: tickUp({ startedAt: now - 9000, elapsed: 2 }),
        neverBack: tickUp({ startedAt: now - 1000, elapsed: 40 })
      };
      // tickResync must not leave a runaway when the tick it re-arms throws
      let calls = 0;
      const S = { lastTick: 1, iv: null, tick() { calls++; throw new Error('tick blew up'); } };
      R.returned = tickResync(S);
      R.ivAfterThrow = S.iv;
      await wait(2600);
      R.callsAfterThrow = calls;
      if (S.iv) clearInterval(S.iv);
      // FLOOR: a tick that does NOT throw is still re-armed and still runs
      let ok = 0;
      const G = { lastTick: 1, iv: null, tick() { ok++; } };
      R.goodReturned = tickResync(G);
      R.goodIv = !!G.iv;
      await wait(1200);
      R.goodCalls = ok;
      if (G.iv) clearInterval(G.iv);
      return R;
    });
    Object.keys(r.up).forEach(k => {
      t.ok('tickUp never returns NaN (' + k + ')',
        typeof r.up[k] === 'number' && isFinite(r.up[k]), k + ' = ' + r.up[k]);
    });
    /* A PLAUSIBLE number, not merely a number. No hold in this app runs for
       more than a few hours, so anything past a day is a coerced timestamp
       leaking through — which is exactly what the escaped mutant produced. */
    Object.keys(r.up).forEach(k => {
      t.ok('tickUp returns a plausible count of seconds (' + k + ')',
        typeof r.up[k] === 'number' && r.up[k] >= 0 && r.up[k] < 86400,
        k + ' = ' + r.up[k]);
    });
    t.eq('tickUp: nine real seconds still beat two counted ticks', r.up.real, 9);
    t.eq('tickUp: it is still a FLOOR — it never winds a counter backwards', r.up.neverBack, 41);
    t.eq('a rescue whose tick throws reports that it failed', r.returned, false);
    t.eq('and it clears the interval it had just armed', r.ivAfterThrow, null);
    t.eq('so the throw happens ONCE, not once a second for ever', r.callsAfterThrow, 1);
    t.eq('floor: a healthy tick is still re-armed', r.goodReturned, true);
    t.eq('and its interval is left running', r.goodIv, true);
    t.ok('and it really keeps ticking', r.goodCalls >= 2, String(r.goodCalls));
  }

  errors.forEach(e => t.fail('a page error fired during hardening checks', e));
  await browser.close();
  srv.close();
  return t.finish();
}
