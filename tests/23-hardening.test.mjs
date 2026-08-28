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

  errors.forEach(e => t.fail('a page error fired during hardening checks', e));
  await browser.close();
  srv.close();
  return t.finish();
}
