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
        STATE.holdLog = best ? [{ date: todayISO(), id: id, secs: best, fresh: true, at: 1 }] : [];
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

  errors.forEach(e => t.fail('a page error fired during hardening checks', e));
  await browser.close();
  srv.close();
  return t.finish();
}
