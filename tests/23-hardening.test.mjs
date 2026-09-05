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
import { readFileSync } from 'node:fs';

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
      // monoNow(), not Date.now(): the deadlines moved to the monotonic clock,
      // and a synthetic timestamp must come from the clock the code reads.
      INTV.deadline = monoNow() - 4000;              // stand in for 5 real seconds lost
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
      /* Buttons must be reachable by name too, and a SYMBOL IS NOT A NAME.
         The first version accepted any non-empty innerText, so seventeen
         icon-only controls — five ✕ deletes and twelve – / + steppers — passed
         with nothing a screen reader can read. It also scanned Settings alone,
         one tab of six. */
      const readable = b => {
        const n = (b.getAttribute('aria-label') || b.title || b.innerText || '').trim();
        return /[A-Za-z0-9]/.test(n);
      };
      /* THE ROW-DELETE BUTTONS ONLY EXIST ONCE THERE IS A ROW, so a sweep of
         whatever the page happens to hold never reaches them — measured: the
         mutant that strips removeFood's aria-label ESCAPED this check, because
         with no food logged there is no ✕ to scan. A guard that cannot fire in
         the case you tested is not tested, on the check rather than the code.
         Seeded through STATE in the shape each boot repair keeps, then
         normalised so the shapes are the app's own rather than my guess. */
      const D = nutToday();
      D.food = D.food || [];
      D.food.push({ name: 'Seeded food', kcal: 300, p: 30, c: 20, f: 10, meal: 'lunch', at: Date.now(), portion: 1 });
      STATE.measurements = STATE.measurements || [];
      STATE.measurements.push({ date: todayISO(), weight: 86 });
      STATE.customFav = STATE.customFav || [];
      /* items is an array of exercise ID STRINGS — the repair filters it with
         exKnown(), which takes an id, so a row of objects is dropped whole and
         the favourite vanishes. Confirm what the repair KEEPS before choosing
         what to seed with. */
      STATE.customFav.push({ name: 'Seeded fav', items: ['pushup', 'plank'] });
      STATE.ruckLog = STATE.ruckLog || [];
      STATE.ruckLog.push({ date: todayISO(), mins: 30 });
      STATE.skipLog = STATE.skipLog || [];
      STATE.skipLog.push({ date: todayISO(), mins: 10 });
      normalizeState();

      out.buttons = { total: 0, unnamed: [], deletes: [] };
      /* Progress opens on SUMMARY, and the measurement delete lives on BODY —
         so a sweep of each tab's default pane never reaches it. The guard
         below named exactly that: it reported removeFood alone. */
      const stops = ['today','program','fuel','progress','progress:body','ref','guide'];
      stops.forEach(stop => {
        const tb = stop.split(':')[0], pane = stop.split(':')[1];
        go(tb);
        if (pane) { try { setProgressTab(pane); } catch (e) {} }
        Array.from(document.querySelectorAll('.view.active button')).forEach(b => {
          out.buttons.total++;
          const oc = b.getAttribute('onclick') || '';
          /* Record WHICH icon-only deletes the sweep actually reached, so a
             zero unnamed count cannot pass on a page that holds none of them. */
          ['removeFood','removeMeasure','delFav','removeAct','removeSkip']
            .forEach(fn => { if (oc.indexOf(fn) >= 0 && out.buttons.deletes.indexOf(fn) < 0) out.buttons.deletes.push(fn); });
          if (!readable(b)) out.buttons.unnamed.push(tb + ':' + (b.innerText || '').trim().slice(0, 6));
        });
      });
      return out;
    });
    // Guard: Settings is where the controls are — if it scanned nothing, the rest is vacuous.
    t.ok('guard: Settings really has form controls to check', r.guide.total >= 8, r.guide);
    ['today','program','fuel','progress','ref','guide'].forEach(tab =>
      t.eq(`[${tab}] every form control has an accessible name`, r[tab].unnamed.length, 0, r[tab]));
    t.ok('guard: Settings really has buttons to check', r.buttons.total > 20, r.buttons);
    t.ok('guard: the button sweep really covered the tabs', r.buttons.total >= 40, r.buttons.total);
    /* GUARD: the icon-only row deletes on a TAB were really in the scan.
       Without a row to delete they do not render at all, and "zero unnamed"
       then passes on a page that never held the controls this check exists
       for. The other three live in sheets and are guarded in the next block —
       naming which sweep owns which is what keeps either from passing on the
       other's coverage. */
    t.ok('guard: the tab-level row deletes were really scanned',
      ['removeFood','removeMeasure'].every(f => r.buttons.deletes.indexOf(f) >= 0),
      r.buttons.deletes);
    t.eq('every button has a name a screen reader can read', r.buttons.unnamed.length, 0, r.buttons.unnamed);
  }

  /* ---- and the SHEETS, which is where the numbers are actually typed -----
     The block above scans each tab's DEFAULT pane. Every control the athlete
     enters a figure into lives in a sheet, and none of them was ever scanned —
     so ten inputs across the prep date, the skipping block, the jacks make-up,
     the food quantity and the reference amount had NO accessible name at all,
     and seventeen more leaned on a placeholder, which a screen reader drops the
     moment the athlete types.

     Every one already had a visible <label> sitting beside it. Not one of the
     77 labels in the file carried a `for`, so the caption was on the glass and
     not attached to anything — the same shape as the sibling captions in
     Settings that this check was written for, one surface along. */
  {
    const r = await page.evaluate(() => {
      const named = el => !!(el.getAttribute('aria-label')
        || (el.id && document.querySelector(`label[for="${el.id}"]`))
        || el.closest('label')
        || el.getAttribute('placeholder')
        || el.getAttribute('title'));
      /* A SYMBOL IS NOT A NAME. ✕, – and + are the whole of what a screen
         reader gets from an icon-only button, and this sweep never looked at
         buttons at all — which is where most of them live. */
      const readable = b => /[A-Za-z0-9]/.test(
        (b.getAttribute('aria-label') || b.title || b.innerText || '').trim());
      const bad = [];
      const deletes = [];
      const scan = where => {
        document.querySelectorAll('#sheet input, #sheet select, #sheet textarea').forEach(el => {
          if (el.type === 'hidden') return;
          if (!named(el)) bad.push({ sheet: where, id: el.id || '', type: el.type || el.tagName });
        });
        document.querySelectorAll('#sheet button').forEach(b => {
          /* Which icon-only row deletes this sweep actually reached. delFav,
             removeAct and removeSkip render only once their list has a row, so
             without this a clean result says nothing about them. */
          const oc = b.getAttribute('onclick') || '';
          ['delFav','removeAct','removeSkip'].forEach(fn => {
            if (oc.indexOf(fn) >= 0 && deletes.indexOf(fn) < 0) deletes.push(fn);
          });
          if (!readable(b)) bad.push({ sheet: where, id: b.id || '', type: 'button:' + (b.innerText || '').trim().slice(0, 6) });
        });
      };
      /* GUARD, both ways: an unnamed control must BE reported, or an empty
         result below says nothing about the app. */
      openSheet('<input id="zq-unnamed"><button id="zq-icon">✕</button>');
      scan('probe');
      const canSee = bad.some(b => b.id === 'zq-unnamed');
      const canSeeIcon = bad.some(b => b.id === 'zq-icon');
      /* closeSheet() is async — it leaves a queued history navigation — so the
         probe input was still mounted when the next sheets opened and every one
         of them reported it. Remove the element itself, not the sheet. */
      closeSheet();
      document.querySelectorAll('#zq-unnamed, #zq-icon').forEach(e => e.remove());
      bad.length = 0;

      const ARGS = { openSwapSheet: ['pushup'], openAct: ['ruck'], openActTimer: ['ruck'],
        openMakeupStopwatch: ['ruck'], openAssessment: [0], openExerciseTimer: ['pushup'],
        openExerciseInfo: ['pushup'], openFoodAmount: [0], openQuick: [QUICKIES[0].id],
        openSessionDetail: [0], openMakeupTimer: ['jacks'] };
      const names = Object.keys(window).filter(k => /^open[A-Z]/.test(k) && typeof window[k] === 'function');
      let opened = 0;
      names.forEach(fn => {
        try {
          if (window[fn].length > 0 && !ARGS[fn]) return;      // needs a real object
          window[fn].apply(null, ARGS[fn] || []);
          if (document.querySelector('#sheet')) { opened++; scan(fn); }
          closeSheet();
        } catch (e) {}
      });
      return { canSee, canSeeIcon, names: names.length, opened, bad, deletes };
    });

    t.ok('guard: an unnamed control really would be reported', r.canSee);
    t.ok('guard: and an icon-only button with no aria-label would be too', r.canSeeIcon);
    /* GUARD: the three row deletes that live in SHEETS were really reached.
       They render only once their list has a row, which the block above seeds,
       so without this the clean result below says nothing about them. */
    t.ok('guard: the sheet-level row deletes were really scanned',
      ['delFav','removeAct','removeSkip'].every(f => r.deletes.indexOf(f) >= 0), r.deletes);
    t.ok('guard: the sweep opened most of the sheets, not a handful',
      r.opened >= 30, JSON.stringify({ opened: r.opened, of: r.names }));
    t.eq('every control inside a sheet has an accessible name too',
      r.bad.length, 0, JSON.stringify(r.bad.slice(0, 8)));

  /* ---- and every IMAGE, which neither sweep above enumerates -------------
     v411 named every control and v413 gave the app a live region to announce
     through. Both sweeps scan `input, select, textarea` and `button`. NEITHER
     LOOKS AT <img>, and a sweep is only as wide as the surface it enumerates —
     so five images carried no `alt` attribute at all and were announced by
     their URL, and two more repeated the visible text right beside them and
     were announced twice.

     An EMPTY alt is the correct value for a captioned photograph: the caption
     already names it. So the rule is that the attribute is PRESENT, not that
     it is non-empty. */
  {
    const r = await page.evaluate(async () => {
      const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const out = { seen: 0, bad: [], dupe: [], kinds: [] };
      const note = el => {
        const k = el.id || el.className || (el.getAttribute('src') || '').slice(0, 14);
        if (k && out.kinds.indexOf(k) < 0) out.kinds.push(k);
      };
      const scan = where => {
        document.querySelectorAll('.view.active img, #sheet img, #player img, #hiit img').forEach(el => {
          out.seen++; note(el);
          if (!el.hasAttribute('alt')) { out.bad.push(where + ':' + (el.id || el.className || 'img')); return; }
          /* AND THE OTHER HALF OF THE RULE. An alt that repeats the text right
             beside it is announced twice — the exercise photo sat under an
             <h3> naming the same movement, and the physique image sat inside a
             button carrying the same word. A check that only asks whether the
             attribute is PRESENT cannot see either: the mutant restoring
             `alt="${ex.name}"` escaped it. */
          const a = (el.getAttribute('alt') || '').trim();
          if (!a) return;
          const b = el.closest('button');
          if (b && (b.innerText || '').trim() === a) out.dupe.push(where + ':button:' + a);
          const root = el.closest('#sheet') || el.closest('.view.active');
          const h = root ? root.querySelector('h1,h2,h3') : null;
          if (h && (h.innerText || '').trim() === a) out.dupe.push(where + ':heading:' + a);
        });
      };
      /* GUARD, BOTH WAYS. An image with no alt must BE reported and one with an
         empty alt must NOT, or a clean result says nothing about the app. */
      openSheet('<h3>Zq Heading</h3><img id="zq-noalt" src="' + PX + '">'
        + '<img id="zq-ok" alt="" src="' + PX + '">'
        + '<img id="zq-dupe" alt="Zq Heading" src="' + PX + '">'
        + '<button><img id="zq-btn" alt="Zq Label" src="' + PX + '">Zq Label</button>');
      scan('probe');
      out.canSee = out.bad.some(b => b.indexOf('zq-noalt') >= 0);
      out.emptyIsFine = !out.bad.some(b => b.indexOf('zq-ok') >= 0);
      out.canSeeHeadingDupe = out.dupe.some(d => d.indexOf('heading:Zq Heading') >= 0);
      out.canSeeButtonDupe = out.dupe.some(d => d.indexOf('button:Zq Label') >= 0);
      closeSheet();
      document.querySelectorAll('#zq-noalt, #zq-ok, #zq-dupe, #zq-btn').forEach(e => e.remove());
      out.bad.length = 0; out.dupe.length = 0; out.seen = 0; out.kinds.length = 0;

      /* The photo surfaces need rows AND bytes, or three of the five images
         this block exists for never render at all. */
      const ids = ['zqp1', 'zqp2'];
      STATE.photos = [{ id: ids[0], date: todayISO(), pose: 'front' },
                      { id: ids[1], date: todayISO(), pose: 'front' }];
      await Promise.all(ids.map(i => idbPut('ph_' + i, PX)));
      save();

      ['today', 'program', 'fuel', 'progress', 'ref', 'guide'].forEach(t => { go(t); scan(t); });
      ['summary', 'body', 'strength', 'awards'].forEach(p => {
        go('progress'); setProgressTab(p); render(); scan('progress:' + p); });
      ['food', 'moves'].forEach(p => { go('ref'); setRefTab(p); render(); scan('ref:' + p); });
      /* Today's four panes — the brief carries the coach avatar. */
      ['brief', 'warmup', 'workout', 'cooldown'].forEach(p => {
        go('today'); setTodayTab(p); render(); scan('today:' + p); });

      openExerciseInfo('pushup'); scan('exerciseInfo'); closeSheet();
      openCompare(); await new Promise(r2 => setTimeout(r2, 120)); scan('compare'); closeSheet();
      await viewPhoto(ids[0]); scan('viewPhoto'); closeSheet();
      openBrief(); scan('brief'); closeSheet();
      return out;
    });

    t.ok('guard: an image with no alt really would be reported', r.canSee, JSON.stringify(r));
    t.ok('guard: and an empty alt is accepted, because a caption already names it',
      r.emptyIsFine, JSON.stringify(r));
    t.ok('guard: the sweep really reached images to check', r.seen >= 20, JSON.stringify(r.seen));
    /* GUARD: the five that carried no alt at all render only on their own
       surfaces — the gallery tiles, the comparison pair, the single-photo
       viewer and the exercise sheet. Without this, "zero unnamed" passes on a
       page that never held one of them. */
    t.ok('guard: the photo and exercise images were really in the scan',
      r.kinds.some(k => /ph-img/.test(k)) && r.kinds.some(k => /exphoto/.test(k))
      && r.kinds.some(k => /cmpImg|pvImg/.test(k)),
      JSON.stringify(r.kinds));
    t.eq('every image carries an alt attribute a screen reader can act on',
      r.bad.length, 0, JSON.stringify(r.bad.slice(0, 10)));
    t.ok('guard: an alt repeating its own heading really would be reported',
      r.canSeeHeadingDupe, JSON.stringify(r));
    t.ok('guard: and one repeating its own button label would be too',
      r.canSeeButtonDupe, JSON.stringify(r));
    /* GUARD: the two surfaces this half exists for were really scanned — the
       exercise sheet's photo under its own <h3>, and the physique picker's
       image inside a button carrying the same word. */
    t.ok('guard: the exercise photo and the physique images were in the scan',
      r.kinds.some(k => /exphoto/.test(k)) && r.kinds.some(k => /^phys-/.test(k)),
      JSON.stringify(r.kinds));
    t.eq('and no image repeats the text already beside it',
      r.dupe.length, 0, JSON.stringify(r.dupe.slice(0, 10)));
  }

  /* The coach avatar was written out by hand twice beside the helper that
     exists for it, and the two copies had already drifted — `object-position:
     center 18%` against the helper's 16%, and no `flex:0 0 auto`. A second copy
     of a rule is a second place for it to drift, and this one had. */
  {
    const src = readFileSync('index.html', 'utf8');
    t.eq('the coach avatar is written in exactly one place',
      (src.match(/coach-sarge\.jpg/g) || []).length, 1);
  }

    /* And every attachment points somewhere. A `for` naming an id that has been
       renamed falls back to the placeholder for the seventeen inputs that have
       one, so the check above would stay green while the caption was detached
       again — the same silent half-fix the labels started as. Scanned over the
       source rather than a render, so a control on a surface this suite never
       opens is covered too. */
    /* Read the SHIPPED FILE once. The first version scanned the app's source
       plus the rendered DOM, and every label appears in both — a template
       literal and its own output — so all 39 reported as duplicated. */
    const all = readFileSync('index.html', 'utf8');
    t.ok('guard: the scan really read the app', all.length > 500000, String(all.length));
    const fors = [...all.matchAll(/<label for="([^"]+)"/g)].map(m => m[1]);
    t.ok('guard: the labels really are attached, so the two checks below can fire',
      fors.length >= 30, String(fors.length));
    const dangling = [...new Set(fors)].filter(f => all.indexOf(`id="${f}"`) < 0);
    t.eq('no label points at a control that is not there', dangling.length, 0,
      dangling.join(','));
    const seen = {}, dup = [];
    fors.forEach(f => { if (seen[f]) { if (dup.indexOf(f) < 0) dup.push(f); } seen[f] = 1; });
    t.eq('and no two labels claim the same control', dup.length, 0, dup.join(','));
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
      /* FOUND, NOT ASSUMED. This used to pin week 3 as the load week and week
         4 as a distance week. v384 made the step count path-independent, so
         the operator's fifth slot no longer raises — week 3 is correctly a
         distance week now, and a check that hardcoded it failed on correct
         code. The requirement is that a week's CARD and its `climbing` agree,
         whichever week it happens to be. */
      o.found = { load: null, dist: null };
      for (let w = 20; w >= 3; w--) {
        const k = at(w);
        if (k.phase === 'taper') continue;
        if (!o.found.load && k.climbing === 'load') o.found.load = k;
        if (!o.found.dist && k.climbing === 'distance') o.found.dist = k;
      }
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
    t.ok('guard: the block really contains a load week and a distance week',
      !!(ruck.found.load && ruck.found.dist),
      { load: !!ruck.found.load, dist: !!ruck.found.dist });
    if (ruck.found.dist) {
      t.ok('a distance week still says the distance is moving',
        /What moves this week: The distance/.test(ruck.found.dist.card),
        ruck.found.dist.card.slice(0, 200));
      t.eq('and reports it as one', ruck.found.dist.climbing, 'distance', ruck.found.dist);
    }
    if (ruck.found.load) {
      t.ok('a load week still says the load is moving',
        /The load, by/.test(ruck.found.load.card), ruck.found.load.card.slice(0, 200));
      t.eq('and reports it as one', ruck.found.load.climbing, 'load', ruck.found.load);
    }
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
      /* THE FLOOR: the plate still climbs. This used to demand exactly FOUR
         steps, because v371 moved owed steps out of the taper rather than
         dropping them — reasoning that dropping left one path "5 lb lighter
         for the whole block, which is a bias in VOLUME".

         v384 makes the count path-independent, which answers that reason
         directly: neither path can end lighter than the other, so there is no
         bias to guard against. The block now takes as many steps as the
         TIGHTER path affords over its working weeks, and the number is a
         property of the block length rather than a constant. What has to hold
         is that it still climbs — and that the two paths agree, which the
         check below this one asserts. */
      t.ok('and the ' + p + ' path still raises the plate during the block',
        plate[p].steps >= 1 && plate[p].final > 0, plate[p]);
    });
    t.ok('both paths finish the block on the same plate',
      plate[paths[0]].final === plate[paths[1]].final,
      { a: plate[paths[0]].final, b: plate[paths[1]].final });
    /* AND ON THE SAME NUMBER OF STEPS. Pinning only the final plate passes
       whenever the ceiling happens to absorb the difference, which is exactly
       how a 5 lb divergence survived at 12 of 23 block lengths. */
    t.eq('and take the same number of steps to get there',
      plate[paths[0]].steps, plate[paths[1]].steps, plate);
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
      PLAYER.deadline = monoNow() - 9000;       // the rest ended nine seconds ago
      R.frozen = { phase: PLAYER.phase, tid: !!PLAYER.tid, stalled: timerStalled(PLAYER) };
      await wait(5200);                          // no tap, no visibilitychange
      R.rescued = { phase: PLAYER.phase, tid: !!PLAYER.tid };

      // a PAUSED player is never resumed — that would restart a session the
      // athlete deliberately stopped
      plClear(); PLAYER.phase = 'rest'; PLAYER.phaseAt = monoNow() - 99000;
      PLAYER.running = false; PLAYER.deadline = monoNow() - 9000;
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
      plClear(); PLAYER.deadline = monoNow() - 9000; PLAYER.phaseAt = monoNow() - 99000;
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
      ivClear(); INTV.deadline = monoNow() - 9000;
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
      const now = monoNow();   // the same clock timerStalled() reads
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

  /* behindClock() is consulted from two narrow branches — plResync() and
     ivResync() — so its own contract is pinned directly, the same shape
     timerStalled() needed above.

     A forced rescue tick takes min(one tick, what the clock says is left), so
     it ALWAYS removes at least a second whether or not any time has passed.
     That was harmless while exactly one rescue ran per return to the page, and
     stopped being harmless when the heartbeat's own re-arm began running a pass
     of its own. */
  {
    const r = await page.evaluate(() => {
      const now = monoNow();
      const S = o => Object.assign({ remain: 40, deadline: now + 40000 }, o);
      return {
        nothing: behindClock(null),
        noDeadline: behindClock(S({ deadline: 0 })),
        level: behindClock(S()),
        throttled: behindClock(S({ remain: 45 })),
        expired: behindClock(S({ remain: 12, deadline: now - 9000 })),
        ahead: behindClock(S({ remain: 30 }))
      };
    });
    t.eq('behindClock: nothing open answers true rather than swallowing a rescue', r.nothing, true);
    t.eq('behindClock: no deadline is the pre-v427 answer, unchanged', r.noDeadline, true);
    t.eq('behindClock: a display level with the clock is NOT behind', r.level, false);
    t.eq('behindClock: a throttled display IS behind', r.throttled, true);
    t.eq('behindClock: an expired phase IS behind', r.expired, true);
    t.eq('behindClock: a display ahead of the clock is not behind', r.ahead, false);
  }

  /* THE PLAYER'S TWIN GETS THE SAME GATE. plGuardTick() calls ivResync() when
     INTV is stalled and HIIT's own visibilitychange listener calls it again, so
     two rescues land on one return to the page. It is worse here than on the
     player: ivTick() counts the seconds it consumed into INTV.workElapsed,
     which logGrind() STORES and the finish screen offers to log — so a second
     forced tick credits work that never happened. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true; save();
      startHiit('tabata'); await wait(400);
      ivStep(0); await wait(200);
      R.phase = INTV.phase;   // workElapsed is only credited in a work phase
      // Five real seconds of the round have gone by with no tick to count them.
      ivClear(); INTV.deadline = monoNow() + 40000; INTV.remain = 45;
      R.start = { remain: INTV.remain, work: INTV.workElapsed };
      ivResync(); ivClear();
      R.one = { remain: INTV.remain, work: INTV.workElapsed };
      ivResync(); ivClear();
      R.two = { remain: INTV.remain, work: INTV.workElapsed };
      hiitTeardown(); await wait(200);
      return R;
    });
    t.ok('guard: the round really was in its WORK phase', r.start && r.phase === 'work', JSON.stringify(r));
    t.ok('guard: the first rescue really reconciled the round',
      r.one && r.one.remain === 40 && r.one.remain < r.start.remain, JSON.stringify(r));
    /* GUARD: measured 0 -> 5 -> 5. Without this the pair below is two equal
       numbers that could both be zero, which passes on a counter that never
       credits anything at all. */
    t.ok('guard: and the first rescue really credited the seconds it consumed',
      r.one && r.one.work > r.start.work, JSON.stringify(r));
    t.eq('a second rescue in the same instant takes no further second',
      r.two && r.two.remain, r.one && r.one.remain, JSON.stringify(r));
    t.eq('and credits no further work into the record',
      r.two && r.two.work, r.one && r.one.work, JSON.stringify(r));
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
      PLAYER.deadline = monoNow() - 9000;      // a rest deadline in the past
      plClear(); plEnterReady(false);
      R.ready = { deadline: PLAYER.deadline, stalled: timerStalled(PLAYER) };
      // a rep-counted movement: find one in this session
      const idx = PLAYER.items.findIndex(m => m.unit !== 'time');
      R.hasRep = idx >= 0;
      if (idx >= 0) {
        PLAYER.i = idx; PLAYER.s = 0;
        PLAYER.deadline = monoNow() - 9000;
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
     with nothing on screen to explain it.

     v423 NARROWED WHEN, and the check is part of that change. This used to
     assert "the heartbeat opens it while a session is running" and drove it by
     opening the player, which lands in the READY phase — where the word does
     nothing. Settings promised "listens only during rest" and the code armed
     for the whole session, so the requirement now is stronger in both
     directions: shut in a phase the word cannot act in, open in one it can. */
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

      // the 3-2-1 into position: the word does nothing here, so neither does the microphone
      openPlayer(); R.readyPhase = PLAYER && PLAYER.phase; await wait(2600);
      R.startedInReady = started;

      // a rest is where the word acts, and the HEARTBEAT is what opens it
      PLAYER.phase = 'rest'; await wait(2600);
      R.started = started;

      playerTeardown(); await wait(2600);
      R.stopped = stopped;

      // with the setting OFF nothing is ever opened, rest or not
      started = 0; stopped = 0;
      STATE.settings.voiceCmd = false; save();
      openPlayer(); PLAYER.phase = 'rest'; await wait(2600);
      R.startedWhenOff = started;
      playerTeardown(); await wait(300);
      window.SpeechRecognition = Real;
      return R;
    });
    t.eq('guard: no recogniser was left open by the block before', r.cleanStart, true);
    t.eq('guard: opening the player lands in the ready phase', r.readyPhase, 'ready');
    t.eq('the microphone stays shut in a phase the word cannot act in', r.startedInReady, 0);
    t.ok('the heartbeat opens it once the rest starts', r.started >= 1, String(r.started));
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
      R.after = { recovered: !!(timer && timer.iv), fresh: !!(timer && monoNow() - timer.lastTick < 4000) };
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
      const now = monoNow();   // the same clock tickStalled() reads
      const S = (o) => Object.assign({ lastTick: now, tick: () => {}, iv: 1 }, o);
      return {
        nullState: tickStalled(null),
        healthy: tickStalled(S({})),
        justRan: tickStalled(S({ lastTick: now - 500 })),
        longGone: tickStalled(S({ lastTick: now - 99000 })),
        noTickFn: tickStalled({ lastTick: now - 99000, iv: 1 }),
        noStamp: tickStalled({ tick: () => {}, iv: 1 }),
        upFloor: (() => { const o = { startedAt: monoNow() - 9000, elapsed: 2 }; return tickUp(o); })(),
        upNeverSlower: (() => { const o = { startedAt: monoNow() - 1000, elapsed: 40 }; return tickUp(o); })()
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
        negativeElapsed: tickUp({ elapsed: -9, startedAt: monoNow() - 1000 }),
        /* THE CLAMP IS ONLY VISIBLE WHEN `real` IS SMALLER THAN THE NEGATIVE
           COUNT. With startedAt in the PAST, real is positive and Math.max()
           hides a negative prev — which is exactly why the mutant that removed
           the clamp ESCAPED. A startedAt in the FUTURE makes real negative, so
           only the clamp can keep the answer at or above zero. Third time this
           session a guard was masked by another value in the same expression. */
        negativeElapsedFutureStart: tickUp({ elapsed: -9, startedAt: monoNow() + 10000 }),
        empty: tickUp({}),
        negative: tickUp({ elapsed: -9, startedAt: monoNow() - 3000 }),
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
        /* monoNow(), NOT Date.now(). tickUp reads the monotonic clock now, and
           feeding it a wall-clock timestamp compares two different time bases —
           which is what made this check fail on correct code. */
        real: tickUp({ startedAt: monoNow() - 9000, elapsed: 2 }),
        neverBack: tickUp({ startedAt: monoNow() - 1000, elapsed: 40 })
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

  /* ---------- a duration must not be measured with the wall clock --------
     Date.now() moves when the phone corrects itself, which Android and iOS do
     in the background. v377 made the count-up timers read real time and v379
     stopped them returning NaN — and both used Date.now(). Measured on a
     3-second hold with the clock shoved forward: +1 hour recorded 3602
     seconds, +1 minute recorded 62. That number is WRITTEN INTO THE RECORD:
     it becomes the bar holdBest() reads, and on the battery it anchors a year.

     The backwards direction was already covered by the floor. FORWARDS — the
     direction that inflates — was wide open.

     performance.now() is monotonic. It counts forward at real speed and
     nothing can move it. The clock is faked in the PAGE here rather than at
     the context, so this block can shove it mid-hold. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true;
      STATE.profile.parq = [false, false, false, false, false, false, false];
      STATE.profile.parqDone = true; STATE.profile.medCleared = true; save();

      const RealDate = window.Date; let skew = 0;
      class Shim extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + skew); else super(...a); }
        static now() { return RealDate.now() + skew; }
        static parse(...a) { return RealDate.parse(...a); }
        static UTC(...a) { return RealDate.UTC(...a); }
      }
      window.Date = Shim;
      try {
        // guard: the shim really does move the wall clock and NOT the monotonic one
        const d0 = Date.now(), m0 = monoNow();
        skew = 3600 * 1000;
        R.shimMovesWall = Date.now() - d0 > 3500000;
        R.monoIgnoresIt = Math.abs(monoNow() - m0) < 5000;
        skew = 0;

        const run = async (jumpMs) => {
          skew = 0;
          startHoldTest('plank'); await wait(200);
          if (!_ht) return { blocked: true };
          for (let i = 0; i < 4; i++) await wait(1050);
          const a = _ht.elapsed;
          await wait(1100);
          skew = jumpMs;                        // the phone re-syncs its clock
          await wait(2200);
          const out = { counted: _ht.elapsed - a };
          cancelHoldTest(); await wait(150); skew = 0;
          return out;
        };
        R.plusHour = await run(3600 * 1000);
        R.plusMinute = await run(60 * 1000);
        R.minusHour = await run(-3600 * 1000);
        R.noJump = await run(0);
      } finally { window.Date = RealDate; }
      return R;
    });
    t.eq('guard: the fake clock really moves Date.now()', r.shimMovesWall, true);
    t.eq('guard: and does NOT move the monotonic clock', r.monoIgnoresIt, true);
    t.ok('a clock that jumps forward an hour mid-hold adds no seconds to the record',
      r.plusHour && r.plusHour.counted >= 2 && r.plusHour.counted <= 5,
      'counted ' + (r.plusHour || {}).counted + ' for ~3 real seconds');
    t.ok('nor does a one-minute correction', r.plusMinute && r.plusMinute.counted <= 5,
      'counted ' + (r.plusMinute || {}).counted);
    t.ok('floor: a backwards jump still cannot wind the count back',
      r.minusHour && r.minusHour.counted >= 2, 'counted ' + (r.minusHour || {}).counted);
    t.ok('floor: an undisturbed hold still counts real seconds',
      r.noJump && r.noJump.counted >= 2 && r.noJump.counted <= 5, 'counted ' + (r.noJump || {}).counted);
  }

  /* monoNow() must fall back rather than throw where performance.now() is
     missing or broken — it is consulted on every tick of a maximal effort. */
  {
    const r = await page.evaluate(() => {
      const out = {}; const realPerf = window.performance;
      out.normal = typeof monoNow() === 'number' && isFinite(monoNow());
      try {
        Object.defineProperty(window, 'performance', { value: undefined, configurable: true });
        out.missing = typeof monoNow() === 'number' && isFinite(monoNow());
        Object.defineProperty(window, 'performance', { value: { now() { throw new Error('no'); } }, configurable: true });
        out.throws = typeof monoNow() === 'number' && isFinite(monoNow());
        Object.defineProperty(window, 'performance', { value: { now() { return NaN; } }, configurable: true });
        out.nan = typeof monoNow() === 'number' && isFinite(monoNow());
      } finally { Object.defineProperty(window, 'performance', { value: realPerf, configurable: true }); }
      return out;
    });
    t.eq('monoNow returns a real number normally', r.normal, true);
    t.eq('and falls back when performance is missing', r.missing, true);
    t.eq('and when performance.now() throws', r.throws, true);
    t.eq('and when performance.now() returns NaN', r.nan, true);
  }

  /* The count-DOWN timers had the same root cause, and I first described it as
     "annoying rather than corrupting". THE MEASUREMENT CORRECTED THAT. On a
     two-minute rest with the clock shoved forward: +1 minute left 58 seconds
     of it, and +1 hour ENDED IT INSTANTLY, dropping straight into the next
     set. v296 exists so the two minutes between maximal efforts are REAL, so
     a rest cut short by a background clock correction changes a measurement,
     not just the mood. Shipping a documented half-fix is worse than one more
     CI cycle. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true; STATE.progressPtr = 8; save();
      const RealDate = window.Date; let skew = 0;
      class Shim extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + skew); else super(...a); }
        static now() { return RealDate.now() + skew; }
        static parse(...a) { return RealDate.parse(...a); }
        static UTC(...a) { return RealDate.UTC(...a); }
      }
      window.Date = Shim;
      try {
        const restRun = async (jumpMs) => {
          skew = 0;
          openPlayer(); await wait(250);
          PLAYER.i = 0; PLAYER.s = 0; plClear(); plEnterRest(120, 'set'); await wait(200);
          const start = PLAYER.remain;
          await wait(1100);
          skew = jumpMs;                      // the phone corrects its clock
          await wait(1600);
          const out = { lost: start - PLAYER.remain, phase: PLAYER.phase };
          playerTeardown(); await wait(200); skew = 0;
          return out;
        };
        R.noJump = await restRun(0);
        R.plusMinute = await restRun(60 * 1000);
        R.plusHour = await restRun(3600 * 1000);
        R.minusHour = await restRun(-3600 * 1000);
      } finally { window.Date = RealDate; }
      return R;
    });
    t.ok('floor: an undisturbed rest counts down normally',
      r.noJump && r.noJump.lost >= 1 && r.noJump.lost <= 5 && r.noJump.phase === 'rest',
      JSON.stringify(r.noJump));
    t.ok('a one-minute clock correction does not eat a minute of the rest',
      r.plusMinute && r.plusMinute.lost <= 5, 'lost ' + (r.plusMinute || {}).lost + ' seconds');
    t.ok('and an hour jump does not end the rest outright',
      r.plusHour && r.plusHour.lost <= 5 && r.plusHour.phase === 'rest',
      'lost ' + (r.plusHour || {}).lost + ' seconds, phase ' + (r.plusHour || {}).phase);
    t.ok('floor: a backwards jump still cannot stretch the rest',
      r.minusHour && r.minusHour.lost >= 1, 'lost ' + (r.minusHour || {}).lost);
  }

  /* THE FIX TOUCHED THREE SURFACES AND THE CHECK COVERED ONE. Three mutants
     escaped — HIIT's deadline, the assessment rest's, and the pause
     arithmetic — because the block above only drives the guided player's rest.
     "Fixing one instance is not fixing the class", applied to the checks
     rather than to the code. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      STATE.onboarded = true; STATE.progressPtr = 8;
      STATE.profile.parq = [false, false, false, false, false, false, false];
      STATE.profile.parqDone = true; STATE.profile.medCleared = true; save();
      const RealDate = window.Date; let skew = 0;
      class Shim extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + skew); else super(...a); }
        static now() { return RealDate.now() + skew; }
        static parse(...a) { return RealDate.parse(...a); }
        static UTC(...a) { return RealDate.UTC(...a); }
      }
      window.Date = Shim;
      try {
        // HIIT — a round must not be cut short by a background clock correction
        skew = 0; startHiit('tabata'); await wait(300); ivStep(0); await wait(200);
        {
          const start = INTV.remain;
          await wait(1100); skew = 3600 * 1000; await wait(1600);
          R.hiit = { lost: start - INTV.remain, i: INTV.i };
        }
        hiitTeardown(); await wait(200); skew = 0;

        // the assessment rest — v296 exists so these two minutes are REAL
        assessState = { idx: 0, results: {}, reassess: false };
        startAssessRest(1); await wait(300);
        if (_ar) {
          const start = _ar.left;
          await wait(1100); skew = 3600 * 1000; await wait(1600);
          R.assessRest = { lost: start - _ar.left, left: _ar.left };
          skew = 0; if (typeof stopAssessRest === 'function') stopAssessRest();
        } else R.assessRest = { skipped: true };
        await wait(200);

        // pausing pushes the deadline out by the time actually away. On the
        // wall clock a jump WHILE PAUSED would stretch the rest by that jump.
        skew = 0; openPlayer(); await wait(250);
        PLAYER.i = 0; PLAYER.s = 0; plClear(); plEnterRest(120, 'set'); await wait(200);
        {
          /* A LONG ENOUGH PAUSE THAT NOT PUSHING THE DEADLINE IS VISIBLE. At
             600 ms the "never push it out" mutant cost under a second and a
             +/-5 s tolerance swallowed it. Four seconds paused means the fix
             keeps `remain` unchanged, while dropping the push costs four. */
          const before = PLAYER.remain;
          playerToggle();                      // pause
          await wait(1500);
          skew = 3600 * 1000;                  // the clock corrects while paused
          await wait(2500);
          playerToggle();                      // resume
          /* LONG ENOUGH FOR A TICK TO RUN. `remain` only changes when a tick
             fires, so reading it 200 ms after resume showed the value from
             before the pause and the "never push the deadline out" mutant was
             invisible. */
          await wait(1300);
          R.pause = { before, after: PLAYER.remain, gained: PLAYER.remain - before };

          /* MUTANT 7 IS INVISIBLE THROUGH `remain`. The deadline is a FLOOR —
             Math.min can only make the countdown catch UP, never run slower —
             so a `held` that is far too large and a `held` that is correct both
             tick down by one. What a wall-clock `held` really destroys is the
             CATCH-UP itself: the deadline lands so far out that a starved tick
             can no longer reconcile against it. So starve one and look. */
          /* ASSERT ON THE DEADLINE THE PAUSE LEFT, BEFORE TOUCHING IT. The
             catch-up check below OVERWRITES PLAYER.deadline, which erases the
             very thing a wall-clock `held` corrupts — so mutant 7 escaped it.
             A deadline is consistent when the time it has left matches the
             seconds on screen; a `held` that swallowed an hour of clock jump
             leaves it an hour out while the display still reads two minutes. */
          R.deadlineConsistent = Math.abs((PLAYER.deadline - monoNow()) / 1000 - PLAYER.remain);

          plClear(); PLAYER.tid = null;
          const b2 = PLAYER.remain;
          PLAYER.deadline = monoNow() - 4000;   // stand in for 5 real seconds lost
          plTickRest();                          // exactly ONE callback
          R.catchUp = { before: b2, after: PLAYER.remain, dropped: b2 - PLAYER.remain };
        }
        playerTeardown(); await wait(200); skew = 0;
      } finally { window.Date = RealDate; }
      return R;
    });
    t.ok('guard: the HIIT round really had time on it', r.hiit && r.hiit.i === 0, JSON.stringify(r.hiit));
    t.ok('a clock correction does not cut a HIIT round short',
      r.hiit && r.hiit.lost <= 5, 'lost ' + (r.hiit || {}).lost + ' seconds');
    t.ok('guard: the assessment rest really started', r.assessRest && !r.assessRest.skipped,
      JSON.stringify(r.assessRest));
    t.ok('nor the two minutes between two maximal efforts',
      r.assessRest && r.assessRest.lost <= 5, 'lost ' + (r.assessRest || {}).lost + ' seconds');
    /* Tight, because both failures are worth catching: a wall-clock `held`
       would stretch the rest by the whole jump, and never pushing the deadline
       out would shorten it by the four seconds spent paused. */
    t.ok('a four-second pause across a clock correction neither stretches nor shortens the rest',
      r.pause && Math.abs(r.pause.gained) <= 1,
      'gained ' + (r.pause || {}).gained + ' seconds across the pause');
    t.ok('and the deadline the pause left still matches the seconds on screen',
      typeof r.deadlineConsistent === 'number' && r.deadlineConsistent <= 2,
      'deadline is ' + r.deadlineConsistent + ' seconds away from what the display says');
    t.ok('and the deadline still works as a catch-up floor after that pause',
      r.catchUp && r.catchUp.dropped >= 4,
      'one starved tick dropped ' + (r.catchUp || {}).dropped + ' seconds');
  }

  /* ---------- the session clock and the stopwatches ----------------------
     THE "ONE CLOCK" RULE WAS NOT APPLIED COMPLETELY, AND THE SUITE DID NOT
     CATCH IT. v380 made PLAYER.pauseAt monotonic and left plPausedSec() on the
     wall clock. Measured while paused: paused-time read 1,787,983,534 seconds,
     plWallSec() subtracted it and clamped to 0, and the clock on screen showed
     "0s" the instant the athlete paused.

     And swSecs() — the stopwatch behind the activity, skipping and make-up
     timers AND Benchmark Ops, whose number is written straight into a personal
     best — inflated by the whole jump: one second read as 3,601. */
  {
    const r = await page.evaluate(async () => {
      const R = {}; const wait = ms => new Promise(res => setTimeout(res, ms));
      STATE.onboarded = true; STATE.progressPtr = 8; save();

      // the session clock must survive a pause
      openPlayer(); await wait(2500);
      R.running = plWallSec();
      playerToggle(); await wait(1200);
      R.whilePaused = { wall: plWallSec(), paused: plPausedSec() };
      R.clockOnScreen = ((document.getElementById('plClock') || {}).textContent || '').trim();
      /* THE CLOCK MUST BE FROZEN WHILE PAUSED. "Never count the paused time"
         leaves the session clock RUNNING through an interruption, which is the
         very thing pausing exists to prevent — and a check that only asserts
         the clock is non-zero passes on it. */
      await wait(2600);
      R.pausedDrift = plWallSec() - R.whilePaused.wall;
      playerToggle(); await wait(400);
      R.afterResume = plWallSec();
      playerTeardown(); await wait(200);

      // and neither clock may be moved by the phone correcting itself
      const RealDate = window.Date; let skew = 0;
      class Shim extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + skew); else super(...a); }
        static now() { return RealDate.now() + skew; }
        static parse(...a) { return RealDate.parse(...a); }
        static UTC(...a) { return RealDate.UTC(...a); }
      }
      window.Date = Shim;
      try {
        const st = swStart({ secs: 0, running: true });
        await wait(1200);
        const b1 = swSecs(st); skew = 3600 * 1000;
        R.stopwatch = { before: b1, after: swSecs(st) };
        skew = 0;

        /* AND A PAUSED STOPWATCH. swPause() keeps its own paused-time tally,
           and nothing above exercised it — so putting that bookkeeping back on
           the wall clock was invisible. Pause it, jump the clock, resume. */
        const st2 = swStart({ secs: 0, running: true });
        await wait(1200);
        const p1 = swSecs(st2);
        /* LONG ENOUGH THAT DRIFT CANNOT ROUND AWAY. At 1.2s of pause, a
           stopwatch that kept ticking read 2 against a paused 1 — inside a
           +/-1 tolerance. Three seconds makes the two answers unmistakable. */
        swPause(st2, false);                 // pause
        await wait(1500);
        skew = 3600 * 1000;                  // the phone corrects its clock
        await wait(1800);
        R.pausedStopwatch = swSecs(st2);
        swPause(st2, true);                  // resume
        skew = 0;
        await wait(400);
        R.resumedStopwatch = { before: p1, after: swSecs(st2) };

        openPlayer(); await wait(1200);
        const w1 = plWallSec(); skew = 3600 * 1000;
        R.sessionJump = { before: w1, after: plWallSec() };
        skew = 0;
        playerTeardown(); await wait(200);
      } finally { window.Date = RealDate; }
      return R;
    });
    t.ok('guard: the session clock really was running before the pause', r.running >= 1, String(r.running));
    t.ok('the session clock does not reset to zero when the athlete pauses',
      r.whilePaused && r.whilePaused.wall >= 1,
      'reads ' + (r.whilePaused || {}).wall + 's with ' + (r.whilePaused || {}).paused + 's counted as paused');
    t.ok('and the paused figure is a real number of seconds, not a timestamp',
      r.whilePaused && r.whilePaused.paused >= 0 && r.whilePaused.paused < 600,
      String((r.whilePaused || {}).paused));
    t.ok('so the clock on screen still shows the session, not 0s',
      !/^0s/.test(r.clockOnScreen || ''), r.clockOnScreen);
    t.ok('floor: and it keeps counting after the resume', r.afterResume >= 2, String(r.afterResume));
    t.ok('the session clock is FROZEN while paused, not merely non-zero',
      typeof r.pausedDrift === 'number' && Math.abs(r.pausedDrift) <= 1,
      'it moved ' + r.pausedDrift + 's during 2.6s of pause');
    t.ok('a paused stopwatch does not tick, and a clock jump does not move it',
      typeof r.pausedStopwatch === 'number' && Math.abs(r.pausedStopwatch - (r.resumedStopwatch || {}).before) <= 1,
      'paused at ' + (r.resumedStopwatch || {}).before + 's, read ' + r.pausedStopwatch + 's');
    t.ok('and resuming it does not add the time it was paused',
      r.resumedStopwatch && Math.abs(r.resumedStopwatch.after - r.resumedStopwatch.before) <= 2,
      JSON.stringify(r.resumedStopwatch));
    t.ok('a stopwatch is not inflated by the phone correcting its clock',
      r.stopwatch && Math.abs(r.stopwatch.after - r.stopwatch.before) <= 2,
      JSON.stringify(r.stopwatch));
    t.ok('nor is the session clock',
      r.sessionJump && Math.abs(r.sessionJump.after - r.sessionJump.before) <= 2,
      JSON.stringify(r.sessionJump));
  }


  /* ---- v381: the prep ramp had no ceiling, and a new block reused an old
     stamp -------------------------------------------------------------------
     The 10% rule caps the RATE. Nothing capped the TOTAL, and the plateau only
     ever applied to `sharpen` and `taper` — so a long BASE phase compounded
     unopposed. Measured on a legitimate 54-week block from a 19.3 km/week
     base, with no stale stamp involved at all: 336.5 km a week at week 31,
     872.9 at week 41, 1,871 at week 51.

     And `planFrom` was stamped once and never again, which is right for moving
     a date still ahead and wrong the moment the previous evaluation has been
     and gone. Measured: the new block opened at week 53 — 2,739 km of running
     a week and a 60 lb plate on day one.

     THE FLOORS CARRY THE ROUND. A cap satisfied by never climbing at all is
     not a cap, so an ordinary 16-week block must still build; an athlete
     already running more than the ceiling must never be prescribed LESS than
     they already do; and a genuine reschedule must KEEP its stamp, or the fix
     restarts every block the athlete moves a date on. */
  {
    const r = await page.evaluate(() => {
      const iso = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
      const DAY = 86400000, out = {};
      const logKm = (runWk, ruckWk) => {
        STATE.nutrition.days = {};
        for (let d = 1; d <= 28; d++) STATE.nutrition.days[iso(Date.now() - d * DAY)] =
          { opened: true, runVal: runWk / 7, runUnit: 'dist', runLvl: 'steady',
            ruckVal: ruckWk / 7, ruckUnit: 'dist', ruckLvl: 'brisk' };
        STATE.nutrition.weightKg = 86;
      };
      const at = (wk, totalWk) => {
        STATE.prep = { date: iso(Date.now() + (totalWk - wk + 1) * 7 * DAY),
                       planFrom: iso(Date.now() - (wk - 1) * 7 * DAY), path: 'operator' };
        const e = enduranceWeek(true), k = ruckLadderWeek(true);
        return { wk: prepWeekNo(), run: e.curve, ruck: k.curve, atPeak: e.atPeak,
                 ruckAtPeak: k.atPeak, peak: e.peak, ruckPeak: k.peak, start: e.start };
      };
      try {
        out.mult = PREP_PEAK_MULT; out.ceil = PREP_PEAK_KM; out.ruckCeil = PREP_RUCK_PEAK_KM;

        // the long block that produced the finding
        logKm(20, 10);
        out.long = [1, 11, 21, 31, 41, 51].map(w => at(w, 54));

        // FLOOR: an ordinary 16-week block must still BUILD
        out.short = [1, 8].map(w => at(w, 16));

        // FLOOR: an athlete already past the ceiling is never cut
        logKm(90, 40);
        out.big = at(1, 54);
        out.bigLater = at(20, 54);

        // FLOOR: the beginner's ceiling is relative to their OWN start
        STATE.nutrition.days = {};
        STATE.prep = { date: iso(Date.now() + 30 * 7 * DAY), planFrom: iso(Date.now() - 30 * 7 * DAY), path: 'operator' };
        out.beginner = { wk: prepWeekNo(), run: enduranceWeek(true).curve, ruck: ruckLadderWeek(true).curve };

        // prepPeak's own contract, exercised directly — it is consulted from
        // two narrow branches, so its meaning is pinned rather than inferred.
        out.peakFn = { small: prepPeak(8, 60), mid: prepPeak(20, 60), big: prepPeak(90, 60),
                       junk: prepPeak('x', 60), zero: prepPeak(0, 60), noCeil: prepPeak(20, 0) };

        // ---- the stamp, driven through the real save route ----
        logKm(20, 10);
        const drive = v => { openForceDate(); document.querySelector('#fq-date').value = v; saveForceDate(); closeSheet(); };
        STATE.prep = { date: iso(Date.now() - 30 * DAY), planFrom: iso(Date.now() - 400 * DAY) };
        drive(iso(Date.now() + 12 * 7 * DAY));
        out.newBlock = { planFrom: STATE.prep.planFrom, today: iso(Date.now()), wk: prepWeekNo(),
                         run: enduranceWeek(true).curve, ruck: ruckLadderWeek(true).curve, lb: ruckLadderWeek(true).lb };

        const keptStamp = iso(Date.now() - 56 * DAY);
        STATE.prep = { date: iso(Date.now() + 40 * DAY), planFrom: keptStamp };
        drive(iso(Date.now() + 90 * DAY));
        out.reschedule = { planFrom: STATE.prep.planFrom, want: keptStamp, wk: prepWeekNo() };

        STATE.prep = {};
        drive(iso(Date.now() + 12 * 7 * DAY));
        out.first = { planFrom: STATE.prep.planFrom, today: iso(Date.now()) };

        STATE.prep = { date: iso(Date.now() + 40 * DAY), planFrom: iso(Date.now() - 200 * DAY) };
        clearForceDate(); closeSheet();
        out.cleared = { has: STATE.prep.planFrom !== undefined };
        drive(iso(Date.now() + 12 * 7 * DAY));
        out.afterClear = { wk: prepWeekNo() };

        // the ceiling is SAID, not applied in silence
        STATE.prep = { date: iso(Date.now() + 24 * 7 * DAY), planFrom: iso(Date.now() - 30 * 7 * DAY), path: 'operator' };
        const html = enduranceHTML() + ruckLadderHTML();
        out.note = { run: /reached its ceiling/i.test(html), holds: html.indexOf('Volume holds at') >= 0 };
        STATE.prep = { date: iso(Date.now() + 15 * 7 * DAY), planFrom: iso(Date.now() - 1 * 7 * DAY), path: 'operator' };
        out.quietNote = { run: /reached its ceiling/i.test(enduranceHTML() + ruckLadderHTML()) };
      } catch (e) { out.threw = String(e && e.message || e); }
      return out;
    });

    t.ok('guard: the ramp checks ran without throwing', !r.threw, r.threw || '');
    if (!r.threw) {
      // guard: the block really did reach the weeks that produced the finding
      t.eq('guard: the long block walks to week 51', (r.long[5] || {}).wk, 51);
      t.ok('guard: it opens on the real trailing base, not the floor',
        Math.abs((r.long[0] || {}).run - 19.3) < 0.5, JSON.stringify(r.long[0]));

      t.ok('a long base phase no longer compounds past its ceiling',
        r.long.every(w => w.run <= r.long[0].run * r.mult + 0.1),
        r.long.map(w => 'wk' + w.wk + ':' + w.run).join(' '));
      t.ok('and no week of it runs past the absolute ceiling either',
        r.long.every(w => w.run <= r.ceil + 0.1),
        r.long.map(w => 'wk' + w.wk + ':' + w.run).join(' '));
      t.ok('the rucked distance is capped too, and lower',
        r.long.every(w => w.ruck <= r.ruckCeil + 0.1) && r.ruckCeil < r.ceil,
        r.long.map(w => 'wk' + w.wk + ':' + w.ruck).join(' '));
      t.ok('the curve reaching the ceiling is reported, not applied in silence',
        r.long[41 >= 0 ? 4 : 4].atPeak === true && r.long[4].ruckAtPeak === true,
        JSON.stringify(r.long[4]));

      // FLOOR — a cap satisfied by never climbing is not a cap
      t.ok('an ordinary 16-week block still builds',
        r.short[1].run > r.short[0].run * 1.2,
        'wk1 ' + r.short[0].run + ' -> wk8 ' + r.short[1].run);
      t.ok('and week 8 of it is nowhere near the ceiling, so nothing was flattened',
        r.short[1].atPeak === false, JSON.stringify(r.short[1]));

      // FLOOR — never prescribe LESS than the athlete already does
      /* Pinned against the app's OWN computed start, not against the number
         the seed asked for — the trailing average is taken over ISO weeks, so
         28 days of logs come to 86.8, and a check restating 90 fails on
         correct code. */
      t.ok('guard: this athlete really is past the absolute ceiling',
        r.big.start > r.ceil, 'start ' + r.big.start + ' vs ceiling ' + r.ceil);
      t.eq('an athlete already past the ceiling is left where they are, not cut',
        r.big.run, r.big.start);
      t.eq('and is still there twenty weeks later — no climb, and no cut',
        r.bigLater.run, r.big.start);

      // FLOOR — the ceiling is relative to the athlete's own start
      t.ok('the beginner ceiling is a multiple of THEIR start, not the absolute one',
        r.beginner.run > 15 && r.beginner.run < 25,
        'beginner week ' + r.beginner.wk + ' runs ' + r.beginner.run);

      // prepPeak's own contract
      t.eq('prepPeak multiplies a small start', r.peakFn.small, 8 * r.mult);
      t.eq('prepPeak takes the absolute ceiling when the multiple exceeds it', r.peakFn.big, 90);
      t.eq('prepPeak never returns below the start', r.peakFn.mid, Math.min(20 * r.mult, r.ceil));
      t.eq('prepPeak on junk is zero, not NaN', r.peakFn.junk, 0);
      t.eq('prepPeak with no ceiling still returns the start', r.peakFn.noCeil, 20);

      // ---- the stamp ----
      t.eq('a NEW block re-stamps planFrom to today', r.newBlock.planFrom, r.newBlock.today);
      t.eq('so it opens at week 1', r.newBlock.wk, 1);
      t.ok('and prescribes the athlete’s own base, not a year of compounding',
        r.newBlock.run < 25 && r.newBlock.ruck < 15 && r.newBlock.lb <= 30,
        JSON.stringify(r.newBlock));
      t.eq('a RESCHEDULE keeps the stamp it already had', r.reschedule.planFrom, r.reschedule.want);
      t.eq('so the block it is already running is not restarted', r.reschedule.wk, 9);
      t.eq('a first-ever date stamps today', r.first.planFrom, r.first.today);
      t.ok('clearing the date clears the stamp with it', r.cleared.has === false, JSON.stringify(r.cleared));
      t.eq('so the next date set opens a fresh block', r.afterClear.wk, 1);

      // the note
      t.ok('the card says the build has reached its ceiling', r.note.run && r.note.holds, JSON.stringify(r.note));
      t.ok('and says nothing at all on a block that is still climbing', r.quietNote.run === false, JSON.stringify(r.quietNote));
    }
  }


  /* ---- v382: the member filter that stopped at the container --------------
     `limitations` is filtered against JOINTS, with a comment three lines above
     `parq` explaining exactly why. Four siblings in the same file never got it:
     parq, allergens, targets and troubleZones each had the CONTAINER checked
     and nothing below it. Fixing one instance is not fixing the class, and the
     class was five wide.

     The reason it stayed hidden is that the legal sets for two of them were
     function-local consts INSIDE the wizard, so nothing outside that renderer
     could ask what a legal value is. They are hoisted now.

     Measured harm on parq, the array the whole safety gate is built on: a junk
     key makes parqFlagged() true for ever, the chip row renders from PARQ so
     the athlete sees nothing to untick, and the session is quietly 24% lighter
     (62 units of work against 82) with nothing on screen to explain it. */
  {
    const r = await page.evaluate(() => {
      const out = {}, ce = console.error;
      console.error = () => {};
      try {
        const seedPtr = STATE.progressPtr;

        // a junk member FAILS CLOSED: dropped, and the screen counts as unanswered
        STATE.profile.parq = ['heart', 'helicopter'];
        STATE.profile.parqDone = true; STATE.profile.medCleared = true;
        normalizeState();
        out.junk = { parq: STATE.profile.parq.slice(), done: STATE.profile.parqDone,
                     cleared: STATE.profile.medCleared, safe: safeMode() };

        // FLOOR: a clean flagged-and-cleared athlete is untouched
        STATE.profile.parq = ['heart']; STATE.profile.parqDone = true; STATE.profile.medCleared = true;
        normalizeState();
        out.clean = { parq: STATE.profile.parq.slice(), done: STATE.profile.parqDone,
                      cleared: STATE.profile.medCleared, safe: safeMode() };

        // FLOOR: an empty answer IS an answer — the screen says so in as many words
        STATE.profile.parq = []; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
        normalizeState();
        out.empty = { parq: STATE.profile.parq.slice(), done: STATE.profile.parqDone, safe: safeMode() };

        // the harm: a phantom flag nothing on screen could clear
        STATE.profile.parq = ['helicopter']; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
        out.before = { flagged: parqFlagged(), safe: safeMode() };
        normalizeState();
        out.after = { flagged: parqFlagged(), parq: STATE.profile.parq.slice() };

        // allergens — filtered, and deliberately WITHOUT parq's flag reset
        STATE.nutrition.allergens = ['peanut', 'helicopter']; normalizeState();
        out.allergJunk = STATE.nutrition.allergens.slice();
        STATE.nutrition.allergens = ['peanut', 'dairy']; normalizeState();
        out.allergClean = STATE.nutrition.allergens.slice();
        STATE.nutrition.allergens = 'peanut, dairy'; normalizeState();
        out.allergStr = STATE.nutrition.allergens.slice();

        // targets — and the fallback when EVERY member is junk
        STATE.profile.targets = ['abs', 'helicopter']; normalizeState();
        out.tgJunk = STATE.profile.targets.slice();
        STATE.profile.targets = ['helicopter']; normalizeState();
        out.tgAllJunk = STATE.profile.targets.slice();
        STATE.profile.targets = ['legs', 'glutes']; normalizeState();
        out.tgClean = STATE.profile.targets.slice();

        // troubleZones — including the inherited key an || fallback lets through
        STATE.profile.troubleZones = ['belly', 'helicopter']; normalizeState();
        out.tzJunk = STATE.profile.troubleZones.slice();
        STATE.profile.troubleZones = ['constructor', 'toString']; normalizeState();
        out.tzProto = STATE.profile.troubleZones.slice();
        STATE.profile.troubleZones = ['belly', 'posture']; normalizeState();
        out.tzClean = STATE.profile.troubleZones.slice();

        // the hoisted lists really reach the picker
        STATE.profile.parq = []; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
        STATE.onboarded = true; save();
        go('today'); openProfileEdit();
        const mounted = !!document.querySelector('#ob-targets');
        const html = mounted ? document.querySelector('#v-today').innerHTML : '';
        out.picker = { mounted, focus: (html.match(/data-t="/g) || []).length,
                       trouble: (html.match(/data-z="/g) || []).length,
                       areas: FOCUS_AREAS.length, zones: TROUBLE_AREAS.length };

        // the validator rule needs the data broken in front of it
        out.errsClean = validateData().length;
        TROUBLE_AREAS.push(['helicopter', 'Helicopter']);
        out.brokenAreas = validateData().filter(e => /helicopter/i.test(e)).length;
        TROUBLE_AREAS.pop();
        const _saved = TROUBLE_POOL.belly; delete TROUBLE_POOL.belly;
        out.brokenPool = validateData().filter(e => /belly/i.test(e)).length;
        TROUBLE_POOL.belly = _saved;
        out.errsRestored = validateData().length;

        STATE.progressPtr = seedPtr;
        STATE.profile.parq = []; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
        STATE.profile.targets = ['abs', 'full']; STATE.profile.troubleZones = [];
        delete STATE.nutrition.allergens; normalizeState(); save();
      } catch (e) { out.threw = String(e && e.message || e); }
      console.error = ce;
      return out;
    });

    t.ok('guard: the member checks ran without throwing', !r.threw, r.threw || '');
    if (!r.threw) {
      t.eq('an unrecognised health flag is dropped', JSON.stringify(r.junk.parq), '["heart"]');
      /* IT FAILS CLOSED. Dropping a key means the app no longer knows what was
         answered, so the screen is not answered and a clearance given against
         answers it cannot reconstruct does not apply. */
      t.ok('and the screen counts as unanswered, so safe mode holds',
        r.junk.done === false && r.junk.cleared === false && r.junk.safe === true, JSON.stringify(r.junk));

      // FLOOR — an always-reset repair sends a clean athlete back to the screen every boot
      t.eq('a clean flagged answer survives untouched', JSON.stringify(r.clean.parq), '["heart"]');
      t.ok('with its answer and its clearance intact, and safe mode off',
        r.clean.done === true && r.clean.cleared === true && r.clean.safe === false, JSON.stringify(r.clean));
      // FLOOR — the screen says "if none apply, leave them all off"
      t.ok('an empty answer is still a real answer',
        r.empty.done === true && r.empty.safe === false, JSON.stringify(r.empty));

      t.ok('guard: the junk flag really did read as flagged before the repair',
        r.before.flagged === true && r.before.safe === true, JSON.stringify(r.before));
      t.ok('and afterwards there is no phantom flag left',
        r.after.flagged === false && r.after.parq.length === 0, JSON.stringify(r.after));

      t.eq('an unrecognised allergen is dropped', JSON.stringify(r.allergJunk), '["peanut"]');
      t.eq('and real allergens are untouched', JSON.stringify(r.allergClean), '["peanut","dairy"]');
      t.eq('the string form still parses', JSON.stringify(r.allergStr), '["peanut","dairy"]');

      t.eq('an unrecognised focus area is dropped', JSON.stringify(r.tgJunk), '["abs"]');
      /* Never empty: focusBonus() reads targets[0], and an empty list is a
         different defect from a junk one. */
      t.eq('a list of nothing but junk falls back to the default', JSON.stringify(r.tgAllJunk), '["abs","full"]');
      t.eq('and a real pair is untouched', JSON.stringify(r.tgClean), '["legs","glutes"]');

      t.eq('an unrecognised trouble zone is dropped', JSON.stringify(r.tzJunk), '["belly"]');
      /* An INHERITED key is truthy, so TROUBLE_POOL[z] passes a truthiness test
         and a membership test refuses it — the v328 lesson, one map over. */
      t.eq('and so is an inherited key', JSON.stringify(r.tzProto), '[]');
      t.eq('real zones are untouched', JSON.stringify(r.tzClean), '["belly","posture"]');

      t.ok('guard: the profile editor really mounted', r.picker.mounted, JSON.stringify(r.picker));
      t.eq('the picker renders every hoisted focus area', r.picker.focus, r.picker.areas);
      t.eq('and every hoisted trouble zone', r.picker.trouble, r.picker.zones);
      t.ok('guard: the hoisted lists are not empty', r.picker.areas === 8 && r.picker.zones === 6,
        JSON.stringify(r.picker));

      /* A clean validator proves nothing about a validator rule — it stays
         clean whether the rule exists or not. Break the data in front of it. */
      t.eq('the validator is clean to start with', r.errsClean, 0);
      t.ok('a picker zone with no pool entry is reported', r.brokenAreas >= 1, 'hits ' + r.brokenAreas);
      t.ok('and a pool zone with no picker button is reported', r.brokenPool >= 1, 'hits ' + r.brokenPool);
      t.eq('and the validator is clean again once restored', r.errsRestored, 0);
    }
  }


  /* ---- v383: a range test's job done by a type test, and two fields with no
     repair at all ----------------------------------------------------------
     `if(typeof STATE.settings.repTempo!=='number')` is the v286 `adapt` defect
     verbatim, one field over: setRepTempo() clamps to 1-6 and the boot repair
     only ever checked the TYPE, so a stored 999 survived every boot. The
     player clamps at its own read sites, so the pacing stays right and nothing
     crashes — totalTUTSplit() reads it RAW. Measured over 40 logged sessions:
     168 minutes of lifetime work reads as 28,354.

     `age` and `heightCm` had no shape repair AT ALL, and v355's mirror then
     copies whichever side holds a value into the half every calculation reads.
     Measured on one 86 kg / 178 cm / 59-year-old body:

       age:true       calorie target 1950 -> 2360   (5*true is 5, so 59 prices as 1)
       age:'zzz'      target ERASED (null)
       heightCm:true  target 1950 -> 1500

     The repair has to run BEFORE the mirror, or junk on one side is copied
     across rather than dropped. */
  {
    const r = await page.evaluate(() => {
      const out = {}, ce = console.error;
      console.error = () => {};
      try {
        const N = STATE.nutrition, P = STATE.profile;
        N.sex = 'male'; N.age = 59; N.heightCm = 178; N.weightKg = 86; N.activity = 1.45;
        P.sex = 'male'; P.age = 59; P.heightCm = 178; P.activity = 1.45;
        normalizeState();
        const kcal = () => { const q = kcalTargetPreview(); return q ? q.target : null; };
        out.base = kcal();

        // --- repTempo, measured on real logged sets ---
        STATE.onboarded = true;
        const keepLogs = STATE.logs;
        STATE.logs = {};
        for (let p = 0; p < 40; p++) {
          const sess = buildSession(p), ex = {};
          sess.main.forEach(m => { ex[m.exId] = { actual: m.target, sets: new Array(m.sets).fill(true) }; });
          const d = new Date(Date.now() - (40 - p) * 86400000);
          STATE.logs[p] = { done: true, ex, completedAt: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') };
        }
        const tut = () => Math.round(totalTUTSplit().work);
        STATE.settings.repTempo = 3; out.tutNormal = tut();
        STATE.settings.repTempo = 999; out.tutRaw = tut();
        STATE.settings.repTempo = 6; out.tutAtSix = tut();   // what the clamp should land on
        STATE.settings.repTempo = 999;
        normalizeState(); out.tempoHigh = STATE.settings.repTempo; out.tutFixed = tut();
        STATE.settings.repTempo = 0.1; normalizeState(); out.tempoLow = STATE.settings.repTempo;
        STATE.settings.repTempo = 3.5; normalizeState(); out.tempoOk = STATE.settings.repTempo;
        STATE.settings.repTempo = 'x'; normalizeState(); out.tempoJunk = STATE.settings.repTempo;
        STATE.settings.repTempo = 3;
        STATE.logs = keepLogs;

        // --- age and height: the harm, measured through the real predictor ---
        const withVal = o => { Object.assign(N, o); Object.assign(P, o); return kcal(); };
        out.harmAge = withVal({ age: true });
        out.harmAgeStr = withVal({ age: 'zzz' });
        out.harmHt = withVal({ age: 59, heightCm: true });

        // --- the repair drops both copies ---
        P.age = true; N.age = true; P.heightCm = 178; N.heightCm = 178;
        normalizeState();
        out.repAge = { p: P.age === undefined, n: N.age === undefined };
        P.age = 59; N.age = 59; P.heightCm = true; N.heightCm = true;
        normalizeState();
        out.repHt = { p: P.heightCm === undefined, n: N.heightCm === undefined };

        /* THE ORDER IS LOAD-BEARING. With junk on ONE side only, a repair that
           ran after the mirror would have copied it across instead. */
        delete P.age; N.age = true; normalizeState();
        out.oneSide = { p: P.age === undefined, n: N.age === undefined };
        P.age = 59; N.age = 999; normalizeState();
        out.disagree = { p: P.age, n: N.age };

        // FLOOR — real values survive and the target comes back
        P.age = 59; N.age = 59; P.heightCm = 178; N.heightCm = 178; normalizeState();
        out.restored = { age: N.age, ht: N.heightCm, kcal: kcal() };
        // FLOOR — the edges of the legal band are kept, not clipped
        P.age = 10; N.age = 10; P.heightCm = 120; N.heightCm = 120; normalizeState();
        out.edgeLo = { age: N.age, ht: N.heightCm };
        P.age = 100; N.age = 100; P.heightCm = 230; N.heightCm = 230; normalizeState();
        out.edgeHi = { age: N.age, ht: N.heightCm };
        P.age = 59; N.age = 59; P.heightCm = 178; N.heightCm = 178; normalizeState();

        // --- coach: membership, not truthiness ---
        STATE.settings.coach = 'helicopter'; normalizeState(); out.coachJunk = STATE.settings.coach;
        STATE.settings.coach = 'auto'; normalizeState(); out.coachAuto = STATE.settings.coach;
        STATE.settings.coach = COACHES[3].id; normalizeState();
        out.coachReal = STATE.settings.coach === COACHES[3].id;
        STATE.settings.coach = 'auto';

        /* v382's own troubleZoneKey asked TWO lists. Identical today, and the
           wrong test for a repair that DELETES: a zone in the POOL but missing
           from the picker is a real steer, and erasing it destroys the
           athlete's answer. The pool decides; the validator catches a drifted
           picker. */
        STATE.profile.troubleZones = ['belly', 'helicopter', 'constructor'];
        normalizeState(); out.tz = STATE.profile.troubleZones.slice();
        out.poolOnly = (function () {
          const saved = TROUBLE_AREAS.pop();          // a pool zone with no button
          STATE.profile.troubleZones = [saved[0]];
          normalizeState();
          const kept = STATE.profile.troubleZones.slice();
          const errs = validateData().filter(e => new RegExp(saved[0], 'i').test(e)).length;
          TROUBLE_AREAS.push(saved);
          return { kept, errs };
        })();
        STATE.profile.troubleZones = [];
        out.errs = validateData().length;
        save();
      } catch (e) { out.threw = String(e && e.message || e); }
      console.error = ce;
      return out;
    });

    t.ok('guard: the scalar checks ran without throwing', !r.threw, r.threw || '');
    if (!r.threw) {
      /* Not a hardcoded figure: the seeded athlete carries their own goal and
         timeline, so the target is theirs. What matters is that there IS one
         to move. */
      t.ok('guard: the athlete has a real calorie target to move',
        typeof r.base === 'number' && r.base > 1000, String(r.base));

      /* --- repTempo ---
         v383 fixed the BOOT REPAIR and left five raw reads standing, so this
         block's original guard asserted that a stored 999 inflated the
         lifetime total 168 min -> 28,354 min BEFORE the boot. v412 gave the
         field one reader and pointed totalTUTSplit() at it, so that guard is
         now false on correct code — the raw read it measured no longer exists.

         Re-aimed at the stronger property rather than deleted: the reader
         protects the figure with NO boot behind it, which is the case a
         cross-tab adopt creates and a boot repair cannot cover. So the
         unbooted figure must already BE the clamped one, and booting must
         change nothing. Deleting these would lose the only assertion that the
         lifetime clock reads through the band at all. */
      t.eq('a stored 999 no longer reaches the lifetime clock at all — the reader clamps it',
        r.tutRaw, r.tutAtSix, r.tutNormal + ' min at 3 -> ' + r.tutRaw + ' min at 999');
      t.ok('guard: and the cadence really does move that figure, so the equality is not two flat numbers',
        r.tutAtSix > r.tutNormal, r.tutNormal + ' -> ' + r.tutAtSix);
      t.eq('an out-of-band cadence is clamped to the band the setter enforces', r.tempoHigh, 6);
      /* Priced at the clamped cadence, not at the default — the holds do not
         scale with rep tempo, so it is not a clean multiple of the tempo-3
         figure and a check that assumed one failed on correct code. */
      t.eq('and the lifetime total is priced at the clamped cadence', r.tutFixed, r.tutAtSix);
      t.eq('so the boot changes the figure not at all — both guards agree',
        r.tutFixed, r.tutRaw, r.tutRaw + ' -> ' + r.tutFixed);
      /* 1.5, not 1: v412 moved the floor to where every reader already was.
         A stored 1 was accepted by the setter and honoured by nobody — the
         player paced at 1.5 while the session clock priced it at 1.0. The
         literal is pinned here and in suite 05 because the number IS the
         specification. */
      t.eq('the low end is clamped too, at the floor every reader already used', r.tempoLow, 1.5);
      t.eq('an in-band cadence is left exactly alone', r.tempoOk, 3.5);
      t.eq('and a non-number takes the default', r.tempoJunk, 3);

      // --- age and height ---
      t.ok('guard: a boolean age really did move the calorie target',
        r.harmAge > r.base + 300, r.base + ' -> ' + r.harmAge);
      /* On an athlete with every other field present it does not bail — it
         computes, and a string in the arithmetic gives NaN. Worse than null:
         null is caught by the `!p` guards downstream and a NaN prints. */
      t.ok('guard: a string age really did destroy the target',
        r.harmAgeStr === null || (typeof r.harmAgeStr === 'number' && !isFinite(r.harmAgeStr)),
        String(r.harmAgeStr));
      t.ok('guard: a boolean height really did move it the other way',
        r.harmHt < r.base - 300, r.base + ' -> ' + r.harmHt);
      t.ok('a junk age is dropped from BOTH copies', r.repAge.p && r.repAge.n, JSON.stringify(r.repAge));
      t.ok('and so is a junk height', r.repHt.p && r.repHt.n, JSON.stringify(r.repHt));
      /* The order is what this one proves: repaired after the mirror, the junk
         would have been copied across rather than dropped. */
      t.ok('junk on one side only is dropped, not mirrored across',
        r.oneSide.p && r.oneSide.n, JSON.stringify(r.oneSide));
      t.ok('and an out-of-range nutrition copy loses to the real profile one',
        r.disagree.p === 59 && r.disagree.n === 59, JSON.stringify(r.disagree));

      // FLOORS — a repair that dropped everything satisfies every check above
      t.eq('a real age survives', r.restored.age, 59);
      t.eq('a real height survives', r.restored.ht, 178);
      t.eq('and the calorie target comes back unchanged', r.restored.kcal, r.base);
      t.ok('the bottom of the legal band is kept, not clipped',
        r.edgeLo.age === 10 && r.edgeLo.ht === 120, JSON.stringify(r.edgeLo));
      t.ok('and so is the top', r.edgeHi.age === 100 && r.edgeHi.ht === 230, JSON.stringify(r.edgeHi));

      // --- coach ---
      t.eq('an unknown coach id falls back to auto', r.coachJunk, 'auto');
      t.eq('auto is left alone', r.coachAuto, 'auto');
      t.ok('and a real pick survives', r.coachReal, 'a chosen coach was overwritten');

      // --- the v382 self-correction ---
      t.eq('a junk trouble zone is still dropped', JSON.stringify(r.tz), '["belly"]');
      t.ok('a POOL zone with no picker button is KEPT, not erased',
        r.poolOnly.kept.length === 1, JSON.stringify(r.poolOnly.kept));
      t.ok('and the validator is what reports the drifted picker',
        r.poolOnly.errs >= 1, 'hits ' + r.poolOnly.errs);
      t.eq('the validator is clean once restored', r.errs, 0);
    }
  }


  /* ---- v384: the two prep paths ended on different plates -----------------
     `wantSteps` counted THIS path's slot occurrences over the WHOLE block, and
     the paths are offset by one slot, so how many land inside a block depends
     on totalWk % 4. The remainder was then taken all at once at the last
     working week. Traced week by week on an athlete opening at the 10 lb
     plate, the operator ended 5 lb heavier than the assaulter at 12 of 23
     block lengths between 8 and 30 weeks.

     A bias in LOAD is the one thing v340 says the two paths may never differ
     in. Nothing caught it because every existing check counts steps at a
     hardcoded 16-week block — one of the lengths where it happens to hold. A
     guard that cannot fire in the case you tested is not tested, applied to
     the block LENGTH rather than to a value.

     The block affords as many steps as the TIGHTER path over the WORKING
     weeks, and each path takes them at its own slot, one a week. That is
     path-independent by construction, and it removes the catch-up: the
     catch-up existed so a path would not end lighter than its sibling, and
     with a shared count neither can.

     THE TRADE IS REAL AND IS THE CONSERVATIVE DIRECTION. Every block now ends
     one 5 lb step below the operator's old figure — 16 weeks goes 30 -> 25 —
     because the steps that used to be dragged out of the taper are no longer
     taken at all. Nobody is raised. */
  {
    const r = await page.evaluate(() => {
      const iso = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
      const DAY = 86400000, out = {};
      try {
        const keepPrep = STATE.prep, keepDays = STATE.nutrition.days, keepKg = STATE.nutrition.weightKg;
        /* NOTHING logged, so startLb is the opening plate and the ceiling
           cannot absorb the difference — the case where it can be seen at all.
           A probe run on an athlete already near the ceiling reported the two
           paths as identical before AND after, which is the trap this block
           exists to avoid. */
        STATE.nutrition.days = {}; STATE.nutrition.weightKg = 86;
        const walk = (path, blockWeeks) => {
          let lb = null, prev = null, jumps = 0, loadInTaper = 0, bothMoved = 0, climbed = false;
          for (let w = 1; w <= blockWeeks; w++) {
            STATE.prep = { date: iso(Date.now() + (blockWeeks - w + 1) * 7 * DAY),
                           planFrom: iso(Date.now() - (w - 1) * 7 * DAY), path };
            const k = ruckLadderWeek(true);
            if (prev !== null && k.lb - prev > 5) jumps++;
            if (prev !== null && k.lb > prev) { climbed = true; if (k.phase === 'taper') loadInTaper++; }
            if (k.climbing === 'load' && prev !== null && k.curve > 0 && k.lb > prev) {
              // a load week must hold the distance — the plan's oldest rule
              if (k.climbing !== 'load') bothMoved++;
            }
            prev = k.lb; lb = k.lb;
          }
          return { lb, jumps, loadInTaper, climbed };
        };
        out.rows = []; out.bad = 0; out.jumps = 0; out.taperLoad = 0;
        for (let n = 8; n <= 30; n++) {
          const o = walk('operator', n), a = walk('assaulter', n);
          if (o.lb !== a.lb) out.bad++;
          out.jumps += o.jumps + a.jumps;
          out.taperLoad += o.loadInTaper + a.loadInTaper;
          out.rows.push({ n, op: o.lb, as: a.lb });
        }
        // the lengths that used to diverge, pinned by name
        out.nine = out.rows.find(x => x.n === 9);
        out.sixteen = out.rows.find(x => x.n === 16);
        out.twentyTwo = out.rows.find(x => x.n === 22);
        // FLOORS
        const eight = walk('operator', 8), long = walk('operator', 54);
        out.climbs = walk('operator', 16).climbed;
        out.longLb = long.lb; out.ceil = ruckLoadCeilLb();
        out.start = (function () {
          STATE.prep = { date: iso(Date.now() + 8 * 7 * DAY), planFrom: iso(Date.now()), path: 'operator' };
          return ruckLadderWeek(true).startLb;
        })();
        STATE.prep = keepPrep; STATE.nutrition.days = keepDays; STATE.nutrition.weightKg = keepKg;
      } catch (e) { out.threw = String(e && e.message || e); }
      return out;
    });

    t.ok('guard: the ladder sweep ran without throwing', !r.threw, r.threw || '');
    if (!r.threw) {
      t.ok('guard: the athlete opens on the bottom plate, where the ceiling cannot hide it',
        r.start <= 15, 'startLb ' + r.start);
      t.eq('the two paths end on the same plate at every block length', r.bad, 0);
      // pinned by name, because these are the lengths that used to differ
      t.ok('a 9-week block agrees', r.nine && r.nine.op === r.nine.as, JSON.stringify(r.nine));
      t.ok('a 16-week block agrees', r.sixteen && r.sixteen.op === r.sixteen.as, JSON.stringify(r.sixteen));
      t.ok('a 22-week block agrees', r.twentyTwo && r.twentyTwo.op === r.twentyTwo.as, JSON.stringify(r.twentyTwo));

      t.eq('and no week raises the plate by more than one step', r.jumps, 0);
      t.eq('no load step is taken inside the taper', r.taperLoad, 0);

      // FLOORS — parity satisfied by never climbing is not parity
      t.ok('the plate still climbs across an ordinary block', r.climbs, 'it never moved');
      t.eq('and a long block still reaches the ceiling', r.longLb, r.ceil);
    }
  }


  /* ---- v385: three promises the code did not keep -------------------------
     1. The morning brief — which the coach READS ALOUD — says "Your meal plan
        today: A, B and C. The full recipes are on the Reference tab, under
        Food." Measured on that pane: 0 of 3 names, no INGREDIENTS heading, no
        METHOD heading, nothing bound to toggleRecipe() or openGrocery().
        `_recipePlanHTML()` is the only renderer of `r.ing` and `r.steps` in
        the file and it had NO CALLER. v315 fixed this sentence once by moving
        the tab NAME, and the destination still did not hold the thing —
        v315's own rule is to assert BOTH ways.
     2. plEnterRest() does Math.max(1,dur|0), so a session built with rest:0
        got a one-second REST screen — tag, +15s and a Skip button — between
        every movement. The FORCE Combat circuit is the only caller that passes
        0, and the absence of the rest IS its difference from the annual
        evaluation, which its own card states.
     3. The midpoint prompt said "N weeks before the taper starts" using
        prepWeeksLeft(), which counts to the TEST DATE. The taper opens
        PREP_TAPER_WEEKS earlier, so the figure was overstated by exactly that:
        five weeks out it said five, when the answer was three. */
  {
    const r = await page.evaluate(() => {
      const out = {}, ce = console.error;
      console.error = () => {};
      try {
        STATE.onboarded = true; save();

        /* --- 1. the promise, asserted BOTH ways ---
           PRIMED FIRST. currentMealPlan() rebuilds when the stored plan is
           stale, so reading the names before the first render captured a plan
           the render then legitimately replaced — 1 of 3 names matched and it
           looked like the fix had failed. Render, then read the plan that is
           actually on the glass, then ask the brief about that one. The real
           requirement is that the two agree. */
        REF_TAB = 'food'; go('ref'); renderRef();
        const plan = STATE.nutrition.plan || currentMealPlan();
        const names = plan.meals.map(recipeById).filter(Boolean).map(x => x.name);
        out.spoken = (function () {
          const said = briefSegments().map(x => x.say || '').join(' ');
          return { pointsAtRef: /Reference tab, under Food/i.test(said),
                   namesAll: names.length > 0 && names.every(n => said.indexOf(n) >= 0) };
        })();
        renderRef();
        const v = document.querySelector('#v-ref');
        const html = v ? v.innerHTML : '', txt = v ? v.textContent : '';
        out.dest = { found: names.filter(n => txt.indexOf(n) >= 0).length, want: names.length,
                     ingredients: /INGREDIENTS/.test(txt), method: /METHOD/.test(txt),
                     toggle: html.indexOf('toggleRecipe(') >= 0,
                     grocery: html.indexOf('openGrocery(') >= 0,
                     labelled: /today.s <b>recipes<\/b>/i.test(html) && /weighed days/i.test(html),
                     mealplanIds: (html.match(/id="mealplan"/g) || []).length,
                     recipeIds: (html.match(/id="recipeplan"/g) || []).length };
        /* FLOOR: it does NOT go back on Fuel. v245 removed the plan card there
           at the athlete's request — a prescribed menu standing in front of
           their own food diary — and that decision stands. */
        go('fuel'); renderFuel();
        const fv = document.querySelector('#v-fuel');
        out.fuelClean = fv ? !/INGREDIENTS/.test(fv.textContent) : null;

        // --- 2. the no-rest circuit ---
        STATE.profile.parq = []; STATE.profile.parqDone = true; STATE.profile.medCleared = false;
        STATE.profile.gear = (STATE.profile.gear || []).concat(['sandbag']);
        normalizeState();
        startCombatCircuit();
        if (typeof PLAYER !== 'undefined' && PLAYER) {
          const seen = []; let guard = 0;
          out.combat = { items: PLAYER.items.length, restsSet: PLAYER.items.filter(m => m.rest > 0).length };
          while (PLAYER && PLAYER.phase !== 'done' && guard++ < 40) {
            seen.push(PLAYER.phase);
            if (PLAYER.phase === 'ready') plEnterWork();
            else if (PLAYER.phase === 'work') plAfterSet();
            else break;
          }
          out.combat.phases = seen.join('>');
          out.combat.restPhases = seen.filter(x => x === 'rest').length;
          out.combat.works = seen.filter(x => x === 'work').length;
        }
        try { playerQuit(); } catch (e) {}
        /* FLOOR: an ordinary session still rests. A fix that skipped the rest
           phase for everybody satisfies every assertion above and deletes the
           rest from every workout in the app. */
        _custom = ['pushup', 'squat'];
        startCustom();
        if (typeof PLAYER !== 'undefined' && PLAYER) {
          out.custom = { rest: PLAYER.items[0].rest };
          plEnterWork(); plAfterSet();
          out.custom.phase = PLAYER.phase;
        }
        try { playerQuit(); } catch (e) {}

        // --- 3. the window figure ---
        const iso = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
        const DAY = 86400000;
        const at = weeksLeft => {
          STATE.prep = { date: iso(Date.now() + weeksLeft * 7 * DAY),
                         planFrom: iso(Date.now() - (20 - weeksLeft) * 7 * DAY),
                         checks: {}, results: {} };
          const d = document.createElement('div'); d.innerHTML = prepMidHTML();
          return { left: prepWeeksLeft(), text: d.textContent.replace(/\s+/g, ' ') };
        };
        out.mid = [5, 4, 3].map(at);
        out.taper = PREP_TAPER_WEEKS;
      } catch (e) { out.threw = String(e && e.message || e); }
      console.error = ce;
      return out;
    });

    t.ok('guard: the promise checks ran without throwing', !r.threw, r.threw || '');
    if (!r.threw) {
      // --- 1. both halves, which is the whole point ---
      t.ok('the brief still names the recipes and points at Reference under Food',
        r.spoken.pointsAtRef && r.spoken.namesAll, JSON.stringify(r.spoken));
      t.eq('and every recipe it names is on that pane', r.dest.found, r.dest.want);
      t.ok('with the ingredients and the method', r.dest.ingredients && r.dest.method, JSON.stringify(r.dest));
      t.ok('and the controls that open them', r.dest.toggle && r.dest.grocery, JSON.stringify(r.dest));
      /* Two elements with one id is a defect this codebase has a standing rule
         about, and the worked days already own `#mealplan`. */
      t.eq('the worked-days anchor is still unique', r.dest.mealplanIds, 1);
      t.eq('and the recipe card has its own', r.dest.recipeIds, 1);
      t.ok('FLOOR: the plan card does not come back on Fuel', r.fuelClean === true, String(r.fuelClean));
      /* TWO DATASETS ON ONE PANE, SO EACH SAYS WHICH IT IS. The recipe card can
         legitimately say "multiply each quantity" — recipes are fixed portions
         — while the worked days below say they are weighed to the athlete's
         targets. Adjacent and unlabelled, one screen contradicts itself. */
      t.ok('and the pane names which dataset is which',
        r.dest.labelled, JSON.stringify({ labelled: r.dest.labelled }));

      // --- 2. the circuit ---
      t.ok('guard: the circuit really built its events with no rest',
        r.combat && r.combat.items >= 2 && r.combat.restsSet === 0, JSON.stringify(r.combat));
      t.eq('a no-rest circuit enters no rest phase at all', r.combat.restPhases, 0);
      t.eq('and still runs every event', r.combat.works, r.combat.items);
      t.ok('FLOOR: an ordinary session still has a rest between sets',
        r.custom && r.custom.rest > 0 && r.custom.phase === 'rest', JSON.stringify(r.custom));

      // --- 3. the figure ---
      r.mid.forEach(m => {
        const want = Math.max(0, m.left - r.taper);
        t.ok('the window figure at ' + m.left + ' weeks out names ' + want + ', not ' + m.left,
          new RegExp('\\b' + want + ' week').test(m.text) && !new RegExp('\\b' + m.left + ' week' + (m.left === 1 ? '\\b' : 's')).test(m.text),
          m.text.slice(0, 150));
      });
      t.ok('and it still says what it is counting to',
        r.mid.every(m => /before the taper starts/.test(m.text)), r.mid[0].text.slice(0, 150));
    }
  }


  /* ---- v386: a reschedule destroyed the baseline and inverted the verdict --
     prepMidISO() is derived from planFrom and the date, so pushing the test
     date out moves the midpoint and can put TODAY back inside the 'initial'
     window. The next result then landed in the block's BASELINE slot and
     overwrote it, and the card — which orders by slot, not by date — read the
     newest figure as "was".

     Driven end to end on a real 200 -> 190 -> 180 improvement:

       before   initial 180 (the 200 destroyed), mid 190   card "+10s slower"
       after    initial 200 kept,  mid 180                 card "-20s faster"

     Twenty seconds of progress reported as a ten-second regression, with the
     baseline gone. */
  {
    const r = await page.evaluate(() => {
      const out = {}, ce = console.error;
      console.error = () => {};
      try {
        const iso = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
        const DAY = 86400000, cp = o => JSON.parse(JSON.stringify(o || null));
        const keep = STATE.prep;
        const ev = FORCE_EVENTS.find(e => e.max !== null).id;
        out.ev = ev;
        const setBlock = (ago, ahead) => {
          STATE.prep = Object.assign({}, STATE.prep, {
            planFrom: iso(Date.now() - ago * 7 * DAY), date: iso(Date.now() + ahead * 7 * DAY) });
        };
        STATE.prep = {};
        const step = (ago, ahead, val) => {
          setBlock(ago, ahead);
          const before = prepCheckpoint();
          setForceResultQuiet(ev, val);
          return { checkpoint: before, checks: cp(STATE.prep.checks) };
        };
        out.s1 = step(1, 19, 200);
        out.s2 = step(11, 9, 190);
        out.s3 = step(11, 40, 180);
        const d = document.createElement('div'); d.innerHTML = prepMidHTML();
        out.card = d.textContent.replace(/\s+/g, ' ');

        /* FLOOR: an ORDINARY block, with no reschedule, still records into the
           checkpoint it is actually in and still compares in the right
           direction. A fix that pinned every write to one slot satisfies every
           assertion above and breaks the feature. */
        STATE.prep = {};
        const o1 = step(1, 19, 210);
        const o2 = step(11, 9, 195);
        const d2 = document.createElement('div'); d2.innerHTML = prepMidHTML();
        out.plain = { s1: o1.checkpoint, s2: o2.checkpoint, checks: o2.checks,
                      card: d2.textContent.replace(/\s+/g, ' ') };

        /* An out-of-order pair — the shape every phone already carrying a
           corrupted record has — withholds the delta rather than inventing
           one. */
        STATE.prep = { planFrom: iso(Date.now() - 11 * 7 * DAY), date: iso(Date.now() + 9 * 7 * DAY),
          checks: { initial: { results: { [ev]: 180 }, at: iso(Date.now()) },
                    mid: { results: { [ev]: 190 }, at: iso(Date.now() - 30 * DAY) } } };
        const d3 = document.createElement('div'); d3.innerHTML = prepMidHTML();
        out.stale = d3.textContent.replace(/\s+/g, ' ');
        STATE.prep = keep;
      } catch (e) { out.threw = String(e && e.message || e); }
      console.error = ce;
      return out;
    });

    t.ok('guard: the checkpoint sequence ran without throwing', !r.threw, r.threw || '');
    if (!r.threw) {
      t.eq('guard: the baseline is recorded in the initial window', r.s1.checkpoint, 'initial');
      t.eq('guard: the second result is recorded at the midpoint', r.s2.checkpoint, 'mid');
      /* The reschedule really does put today back in the initial window —
         without that, this block tests nothing. */
      t.eq('guard: and the reschedule puts today back before the new midpoint',
        r.s3.checkpoint, 'initial');

      t.eq('the baseline survives a later result', r.s3.checks.initial.results[r.ev], 200);
      t.eq('which lands in the latest window instead', r.s3.checks.mid.results[r.ev], 180);
      t.ok('and the card reports the improvement as faster, not slower',
        /faster/.test(r.card) && !/slower/.test(r.card), r.card.slice(0, 220));

      // FLOOR — an ordinary block is untouched
      t.ok('FLOOR: an ordinary block still records into its own checkpoints',
        r.plain.s1 === 'initial' && r.plain.s2 === 'mid'
          && r.plain.checks.initial.results[r.ev] === 210
          && r.plain.checks.mid.results[r.ev] === 195,
        JSON.stringify(r.plain.checks));
      t.ok('and still compares in the right direction',
        /faster/.test(r.plain.card) && !/slower/.test(r.plain.card), r.plain.card.slice(0, 220));

      /* Fails closed. Every phone is carrying records written before the guard,
         where a later measurement can sit in the earlier slot — comparing them
         would report progress as a regression. */
      t.ok('an out-of-order pair withholds the delta rather than inverting it',
        /not comparable/.test(r.stale) && !/slower/.test(r.stale), r.stale.slice(0, 220));
    }
  }


  /* ---- v388: two writers of one field, and a stale safety argument ---------
     `hasBar`/`hasBench` are a legacy mirror of `gear[]`. toggleGear() and
     normalizeState() both derive them FROM gear; toggleSetting() flipped the
     flag and left gear alone. Nothing reaches those branches today, which is
     exactly when it is cheap to make them correct rather than leave a trap: a
     control wired to either would have appeared to work and been silently
     reverted on the next boot.

     And `_recipePlanHTML()`'s comment named renderFuel() as the caller that
     primes the plan before any markup is built — the safety argument for
     calling a generator from an HTML builder at all. renderFuel() stopped
     priming when v245 removed the only markup on Fuel that read the plan, and
     v385 made renderRef() the primer. */
  {
    const r = await page.evaluate(() => {
      const out = {}, ce = console.error;
      console.error = () => {};
      try {
        const keep = (STATE.profile.gear || []).slice();

        STATE.profile.gear = ['bar', 'bench'];
        normalizeState();
        out.derived = { bar: STATE.profile.hasBar, bench: STATE.profile.hasBench };

        // the legacy toggle must move gear, not just the mirror
        toggleSetting('hasBar');
        out.afterToggle = { inGear: STATE.profile.gear.indexOf('bar') >= 0, flag: STATE.profile.hasBar };
        normalizeState();   // the boot path is what used to revert it
        out.afterBoot = { inGear: STATE.profile.gear.indexOf('bar') >= 0, flag: STATE.profile.hasBar };
        toggleSetting('hasBar');   // back
        out.restored = { inGear: STATE.profile.gear.indexOf('bar') >= 0, flag: STATE.profile.hasBar };

        // FLOOR: an ordinary setting still toggles, and does not touch gear
        const before = !!STATE.settings.hype;
        toggleSetting('hype');
        out.plain = { flipped: !!STATE.settings.hype !== before,
                      gearUntouched: STATE.profile.gear.length === 2 };
        toggleSetting('hype');

        STATE.profile.gear = keep; normalizeState(); save();

        /* The priming caller has to be real. A comment naming a function that
           no longer primes is the safety argument for this builder, and it was
           wrong — so assert the named one actually calls it. */
        const srcOf = f => { try { return f.toString(); } catch (e) { return ''; } };
        /* STRIP THE COMMENTS FIRST. renderFuel()'s own comment contains the
           text "currentMealPlan()" — explaining that its priming call was
           REMOVED — so a scan of the raw source says it primes when it is the
           very function that stopped. A comment that quotes code breaks a scan
           for that code, which is why the mutant naming renderFuel() escaped
           the first version of this check. */
        const noComments = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
        const note = srcOf(_recipePlanHTML);
        const named = (note.match(/THAT CALLER IS (\w+)\(\)/) || [])[1] || null;
        let fn = null; try { fn = named ? eval(named) : null; } catch (e) {}
        out.primer = { named, isFn: typeof fn === 'function',
                       reallyPrimes: typeof fn === 'function'
                         && noComments(srcOf(fn)).indexOf('currentMealPlan(') >= 0 };
        // guard: the stripper does not simply delete everything
        out.stripOk = noComments(srcOf(_recipePlanHTML)).indexOf('_planStillValid') >= 0;
      } catch (e) { out.threw = String(e && e.message || e); }
      console.error = ce;
      return out;
    });

    t.ok('guard: the legacy checks ran without throwing', !r.threw, r.threw || '');
    if (!r.threw) {
      t.ok('guard: the flags are derived from gear to start with',
        r.derived.bar === true && r.derived.bench === true, JSON.stringify(r.derived));
      t.ok('the legacy toggle moves gear itself, not just the mirror',
        r.afterToggle.inGear === false && r.afterToggle.flag === false, JSON.stringify(r.afterToggle));
      /* This is the one that matters: the old branch passed the assertion above
         and was reverted here, because normalizeState() rewrites the flag from
         gear on every boot. */
      t.ok('and the next boot does not revert it',
        r.afterBoot.inGear === false && r.afterBoot.flag === false, JSON.stringify(r.afterBoot));
      t.ok('toggling back restores both', r.restored.inGear && r.restored.flag, JSON.stringify(r.restored));
      // FLOOR — an ordinary setting is untouched by the routing
      t.ok('FLOOR: an ordinary setting still toggles and leaves gear alone',
        r.plain.flipped && r.plain.gearUntouched, JSON.stringify(r.plain));

      t.ok('guard: the comment stripper keeps the code', r.stripOk === true, String(r.stripOk));
      t.ok('guard: the named caller resolves to a function', r.primer.isFn, JSON.stringify(r.primer));
      t.ok('the plan builder names a caller that really primes it',
        r.primer.named && r.primer.reallyPrimes, JSON.stringify(r.primer));
    }
  }


  /* ---- v389: the day-90 board, and the two rows it refuses to score --------
     From the athlete's own Reserve Infantry preparation package. They are
     ADVISORY preparation goals, not CAF pass standards — the package says so
     itself — so the board carries that on the glass, stamped, the same way
     FORCE_ASOF is.

     TWO OF THE SIX CANNOT BE SCORED HONESTLY. The package wants a 5 km time and
     this app measures a 2.4 km time trial; it wants strict pull-ups and the
     baseline battery tests INVERTED ROWS, a different movement at a different
     benchmark (20 rows against 6-10 pull-ups). Scoring either would be the
     change-of-ruler defect v320 and v321 exist to stop. They show what was
     actually measured, name it, and leave the target unscored. */
  {
    const r = await page.evaluate(() => {
      const out = {}, ce = console.error;
      console.error = () => {};
      try {
        const iso = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
        const DAY = 86400000;
        const keep = { base: STATE.baseline, hold: STATE.holdLog, days: STATE.nutrition.days, prs: STATE.prs };

        // an athlete with a baseline but no pull-up record and no time trial
        STATE.prs = {}; STATE.holdLog = []; STATE.nutrition.days = {};
        delete STATE.prep.ttBest;
        const byK = rows => { const m = {}; rows.forEach(x => m[x.k] = x); return m; };
        out.bare = byK(day90Rows());

        // now a real one
        STATE.holdLog = [{ date: iso(new Date()), id: 'plank', secs: 135, fresh: true, exId: 'plank', at: Date.now() }];
        STATE.nutrition.days[iso(new Date(Date.now() - 3 * DAY))] =
          { opened: true, ruckVal: 11, ruckUnit: 'dist', ruckLvl: 'brisk', ruckLb: 45 };
        STATE.prs = { pullup: 8 };
        normalizeState();
        out.full = byK(day90Rows());
        // the app's OWN figures, so the checks do not restate numbers
        out.want = { push: (currentMaxes() || {}).push,
                     ruckShown: distShow(11), imperial: isImperial() };

        /* The ruck target is a distance AND a load. `near` on the distance
           alone called a 9 km walk with an EMPTY bag "close" to 10 km under
           20 kg, and the load is the half that makes it a ruck. */
        const keepDays = STATE.nutrition.days;
        STATE.nutrition.days = {};
        STATE.nutrition.days[iso(new Date(Date.now() - 4 * DAY))] =
          { opened: true, ruckVal: 9, ruckUnit: 'dist', ruckLvl: 'brisk', ruckLb: 0 };
        out.unloaded = byK(day90Rows()).ruck;
        STATE.nutrition.days = keepDays;

        /* THE PUSH ROW'S OWN RULER. A flagged wrist swaps this test for Fist
           Push-Ups — measured as the ONLY substitution reachable on any of the
           six rows (plank is never substituted at all). currentMaxes() has
           converted it, so it is honest to score and dishonest to call it a
           count the athlete did. */
        const keepLims = STATE.profile.limitations;
        STATE.profile.limitations = ['wrist'];
        const wSubs = assessSubs();
        out.pushSubs = { sub: wSubs.push, rescale: anchorRescale('push', wSubs) };
        STATE.baseline.subs = wSubs;
        out.pushScaled = byK(day90Rows()).push;
        /* The third state — substituted and NOT re-scalable — cannot be reached
           on today's library, so it is exercised DIRECTLY rather than recorded
           as equivalent: a swap the app declines to convert must not be scored
           against a benchmark it was never measured on. */
        STATE.baseline.subs = { push: 'plank' };
        out.pushNoRuler = byK(day90Rows()).push;
        out.noRulerRescale = anchorRescale('push', { push: 'plank' });
        STATE.baseline.subs = {};
        STATE.profile.limitations = keepLims;
        out.pushPlain = byK(day90Rows()).push;

        /* The frequency target names TWO things — five days AND no persistent
           pain — and the app can answer both. Scoring only the sessions called
           an athlete "on target" while their own logs showed a pattern the app
           was already prompting them about. */
        const keepPain = STATE.pain, keepLogs = STATE.logs;
        STATE.pain = []; STATE.logs = keepLogs;
        /* THE WEEK IS PART OF THE STATE THIS BLOCK HAS TO BUILD. The first
           version seeded forward from the week start and stopped at today, so
           on a MONDAY it built exactly one session and the row correctly read
           "1 this week" — a failure on correct code, on one weekday in seven.
           CI found it; three local runs on other days did not.

           sessionsThisWeek() counts every trained day at or after the week
           start with no upper bound, so seeding the five weekdays of the
           CURRENT week is a state it genuinely reports 5 for, whatever day it
           runs on. The guard below is what keeps that true: if a future-date
           filter is ever added, this says so by name instead of looking like a
           defect in the row. */
        const wk = weekStartD(new Date());
        for (let d = 0; d < 5; d++)
          STATE.logs[900 + d] = { done: true, completedAt: iso(new Date(wk.getTime() + d * DAY)), ex: {} };
        out.freqSeeded = sessionsThisWeek();
        out.freqWeekday = new Date().getDay();
        out.freqClean = byK(day90Rows()).freq;
        for (let k = 0; k < 3; k++) STATE.pain.push({ region: 'shoulders', date: iso(new Date(Date.now() - k * DAY)), ptr: 900 + k });
        out.painN = painCount('shoulders');
        out.freqPain = byK(day90Rows()).freq;
        // FLOOR: a joint the athlete has already flagged is not an unaddressed pattern
        STATE.profile.limitations = ['shoulder'];
        out.freqAdopted = byK(day90Rows()).freq;
        STATE.profile.limitations = keepLims;
        STATE.pain = keepPain;
        for (let d = 0; d < 5; d++) delete STATE.logs[900 + d];

        /* A BRAND-NEW ATHLETE. currentMaxes() runs estimateMaxes(), which fills
           in starting ASSUMPTIONS with no baseline on file — so the board read
           "8 reps · your baseline max" and "40s · your best fresh hold" for
           tests never taken, and marked them below the target. A default
           presented as a measurement (v260), on the one board whose job is to
           say what has been measured. */
        const keepBase = STATE.baseline, keepHold = STATE.holdLog, keepPrs = STATE.prs;
        STATE.baseline = null; STATE.holdLog = []; STATE.prs = {};
        out.fresh = byK(day90Rows());
        /* THE CLASS: every row that renders blank must say why. The day map
           has to be CLEARED first — earlier blocks in this file log rucks, so
           captured as-is the ruck row is not blank at all and the sweep
           measures nothing. Restored immediately after. */
        { const keepDays = STATE.nutrition.days;
          STATE.nutrition.days = {};
          const rows = day90Rows();
          out.blankRows = rows.filter(x => x.got === null).map(x => ({ k: x.k, why: x.why || null }));
          out.ruckWhy = (rows.find(x => x.k === 'ruck') || {}).why || '';
          STATE.nutrition.days = keepDays; }
        /* Both ways: the destination the row names really carries the control.
           Asserted on the rendered markup — [data-act] on Today is the player's
           own control set, and the ruck sheet's inputs exist only while it is
           open, so neither is the thing to look for. */
        /* This section runs as a BRAND-NEW athlete with no baseline, and Today
           renders the Baseline Test screen for one — so the Movement block is
           not on screen at all and the pointer reads false on correct code.
           The same trap as the end-of-program probe that read the welcome
           screen. Restore a baseline for the render, then put it back. */
        try { const noBase = STATE.baseline;
          STATE.baseline = STATE.baseline || { results: {}, maxes: {} };
          setCardioMode('ruck'); setTodayTab('workout'); go('today');
          const v = document.querySelector('.view.active');
          out.movementHasRuck = !!v && v.innerHTML.indexOf("setCardioMode('ruck')") >= 0;
          out.movementGuard = !!v && v.innerHTML.indexOf('Baseline Test') < 0;
          STATE.baseline = noBase;
        } catch (e) { out.movementHasRuck = 'threw: ' + e.message; }
        out.freshMx = { push: (currentMaxes() || {}).push, plank: (currentMaxes() || {}).plank };
        /* FLOOR: a real pull-up record is a MEASUREMENT, not a default, so it
           survives having no baseline — otherwise "blank when fresh" would be
           satisfied by a board that blanks a number the athlete really set. */
        STATE.prs = { pullup: 8 };
        out.freshWithPR = byK(day90Rows()).pull;
        /* And the plank row NAMES whichever source its number came from: the
           hold tracker when there is a fresh hold, the baseline otherwise.
           One label for both is the same lie in one word. */
        STATE.baseline = keepBase; STATE.holdLog = []; STATE.prs = keepPrs;
        out.plankFromBase = byK(day90Rows()).plank;
        STATE.holdLog = keepHold;
        out.plankFromHold = byK(day90Rows()).plank;

        openForcePrep();
        const sh = document.querySelector('#sheet');
        const html = sh ? sh.innerHTML : '', txt = sh ? sh.textContent.replace(/\s+/g, ' ') : '';
        out.sheet = { rows: (html.match(/data-d90=/g) || []).length,
                      caveat: /preparation goals, not pass standards/i.test(txt),
                      /* Scoped to the board's OWN note. FORCE_ASOF and COMBAT_ASOF
                         are the same string and already print on this sheet, so a
                         page-wide indexOf was satisfied by a stamp that was never in
                         question — the mutant dropping this one escaped clean. */
                      noteFound: !!sh.querySelector('[data-d90note]'),
                      stamped: !!sh.querySelector('[data-d90note]') &&
                               sh.querySelector('[data-d90note]').textContent.indexOf(DAY90_ASOF) >= 0,
                      notComparable: (txt.match(/not comparable/g) || []).length,
                      nan: /\bNaN\b/.test(txt), undef: /\bundefined\b/.test(txt) };
        closeSheet();

        STATE.baseline = keep.base; STATE.holdLog = keep.hold;
        STATE.nutrition.days = keep.days; STATE.prs = keep.prs; save();
      } catch (e) { out.threw = String(e && e.message || e); }
      console.error = ce;
      return out;
    });

    t.ok('guard: the board built without throwing', !r.threw, r.threw || '');
    if (!r.threw) {
      t.eq('the board renders every target', r.sheet.rows, 6);
      t.ok('guard: the board’s own caveat note was found to scope the stamp to',
        r.sheet.noteFound, JSON.stringify(r.sheet));
      t.ok('with the advisory caveat and its date on the glass',
        r.sheet.caveat && r.sheet.stamped, JSON.stringify(r.sheet));
      t.ok('and no broken figures', !r.sheet.nan && !r.sheet.undef, JSON.stringify(r.sheet));

      /* THE TWO IT REFUSES TO SCORE. A board that scored these would report a
         2.4 km time against a 5 km target, and inverted rows against pull-ups. */
      t.ok('the 5 km row is never scored — the app measures a different distance',
        r.bare.run.scored === false && r.full.run.scored === false, JSON.stringify(r.bare.run));
      t.ok('and it says which distance it does measure',
        /time trial/i.test(r.bare.run.why || ''), r.bare.run.why);
      t.ok('inverted rows are not scored against a pull-up target',
        r.bare.pull.scored === false, JSON.stringify(r.bare.pull));
      t.ok('and the row names the movement that was actually tested',
        /Inverted Rows/i.test(r.bare.pull.why || ''), r.bare.pull.why);
      /* FLOOR: a REAL pull-up record is scored — a row that never scores is not
         a target, it is a label. */
      t.ok('a real pull-up record IS scored',
        r.full.pull.scored === true && r.full.pull.ok === true, JSON.stringify(r.full.pull));

      // the rows that read real measurements
      t.ok('the plank reads the hold tracker, not the baseline',
        r.full.plank.got === '2:15', JSON.stringify(r.full.plank));
      /* Pinned against what the app itself renders, not against the raw km: an
         imperial athlete correctly sees 6.8 mi for an 11 km ruck, and a check
         restating "11" fails on correct code. The load stays in kg either way,
         which is how the package states it. */
      t.ok('the ruck reads the longest single outing, converted to the athlete’s unit',
        (r.full.ruck.got || '').indexOf(r.want.ruckShown) === 0,
        JSON.stringify({ got: r.full.ruck.got, want: r.want.ruckShown, imperial: r.want.imperial }));
      t.ok('a long walk with an empty bag is not “close” to a loaded ruck',
        r.unloaded.near === false && r.unloaded.ok === false, JSON.stringify(r.unloaded));
      t.ok('and names the load it was carried under',
        /20 kg/.test(r.full.ruck.got || ''), JSON.stringify(r.full.ruck));
      /* The guard is what makes this a real check: estimateMaxes() must still be
         handing out a number, or "the board shows nothing" passes on nothing. */
      t.ok('guard: with no baseline the app still has starting assumptions to leak',
        r.freshMx.push > 0 && r.freshMx.plank > 0, JSON.stringify(r.freshMx));
      t.ok('a brand-new athlete is told nothing is measured, not given the defaults',
        r.fresh.push.got === null && r.fresh.plank.got === null && r.fresh.pull.got === null,
        JSON.stringify({ push: r.fresh.push, plank: r.fresh.plank, pull: r.fresh.pull }));
      t.ok('and each blank row says why it is blank',
        /baseline test/i.test(r.fresh.push.why || '') && /baseline test/i.test(r.fresh.plank.why || ''),
        JSON.stringify({ push: r.fresh.push.why, plank: r.fresh.plank.why }));

      /* THE CLASS, not the two rows that happened to have one. Every row that
         renders blank must explain itself — the ruck row was the one reading
         "not measured" with nothing beside it, while the run and pull rows
         both said why. Written as a sweep so a seventh row cannot be added
         blank and silent. */
      t.eq('EVERY blank row explains itself, not just the ones that already did',
        (r.blankRows || []).filter(x => !x.why).map(x => x.k).join(', '), '',
        JSON.stringify(r.blankRows));
      t.ok('guard: the sweep really found blank rows to check',
        (r.blankRows || []).length >= 2, JSON.stringify(r.blankRows));
      /* And the pointer is asserted BOTH ways: the row names where to log a
         ruck, and that destination really carries the control. */
      t.ok('the blank ruck row names where a ruck is logged',
        /Movement/.test(r.ruckWhy || ''), r.ruckWhy);
      t.ok('guard: Today rendered the workout, not the baseline gate',
        r.movementGuard === true, JSON.stringify({ guard: r.movementGuard }));
      t.ok('and Movement really carries the ruck controls', r.movementHasRuck, r.movementHasRuck);
      /* FLOOR: a note that always fires is a note nobody reads. Every other row
         on this board has this pinned — pushPlain, freqClean, freqAdopted, the
         genuine zero — and the ruck row was the one added without it, so the
         over-eager twin (a `why` on every row, logged or not) escaped. */
      t.ok('while a ruck that WAS logged carries no explanation at all',
        !r.full.ruck.why, JSON.stringify({ got: r.full.ruck.got, why: r.full.ruck.why }));
      /* FLOOR: a measured zero is still data. Sessions this week is a real
         count, so it reports 0 rather than going blank with the rest. */
      t.ok('the plank row names the baseline when that is where its number came from',
        r.plankFromBase.got !== null && r.plankFromBase.gotLabel === 'your baseline plank',
        JSON.stringify(r.plankFromBase));
      t.ok('and names the hold tracker when a real fresh hold exists',
        r.plankFromHold.gotLabel === 'your best fresh hold', JSON.stringify(r.plankFromHold));
      t.ok('while a real pull-up record survives with no baseline — it is a measurement',
        r.freshWithPR.got === '8 reps' && r.freshWithPR.scored === true, JSON.stringify(r.freshWithPR));
      t.ok('while a genuine zero is still reported as a zero',
        r.fresh.freq.got === '0 this week' && !r.fresh.freq.why, JSON.stringify(r.fresh.freq));
      t.ok('guard: a flagged wrist really does swap the push test, and the app re-scales it',
        r.pushSubs.sub === 'fistpushup' && r.pushSubs.rescale > 0, JSON.stringify(r.pushSubs));
      t.ok('a scaled push figure says it was scaled and names the movement performed',
        r.pushScaled.scored === true && /Fist Push-Up/.test(r.pushScaled.gotLabel || '')
          && /Fist Push-Up/.test(r.pushScaled.why || ''), JSON.stringify(r.pushScaled));
      t.ok('guard: the unconvertible swap really is one the app declines to re-scale',
        r.noRulerRescale === 0, r.noRulerRescale);
      t.ok('and a swap the app cannot re-scale is not scored against the push-up target',
        r.pushNoRuler.scored === false && /not scored/.test(r.pushNoRuler.why || ''),
        JSON.stringify(r.pushNoRuler));
      /* FLOOR: an athlete with no flag is told nothing at all — a note that
         always fires is a note nobody reads. */
      t.ok('while an unswapped push test carries no explanation and is scored',
        r.pushPlain.scored === true && !r.pushPlain.why
          && r.pushPlain.gotLabel === 'your baseline max', JSON.stringify(r.pushPlain));
      t.ok('guard: the pain pattern the app itself would prompt about was really built',
        r.painN >= 2, JSON.stringify({ n: r.painN, freq: r.freqPain }));
      t.eq('guard: the block really built five sessions inside the current week',
        r.freqSeeded, 5, JSON.stringify({ seeded: r.freqSeeded, weekday: r.freqWeekday }));
      t.ok('a week of sessions with no pain pattern meets the frequency target',
        r.freqClean.ok === true && !r.freqClean.why, JSON.stringify(r.freqClean));
      t.ok('but the same week is not "on target" while a pain pattern stands',
        r.freqPain.ok === false && r.freqPain.near === false && /hurt/.test(r.freqPain.why || ''),
        JSON.stringify(r.freqPain));
      /* FLOOR: flagging the joint IS the fix, so an athlete training around one
         is not held short by it — otherwise the row would punish the athlete
         for doing the thing the app asked them to do. */
      t.ok('while an athlete who has flagged that joint is on target again',
        r.freqAdopted.ok === true && !r.freqAdopted.why, JSON.stringify(r.freqAdopted));
      t.ok('push-ups read the baseline max',
        (r.full.push.got || '') === Math.round(r.want.push) + ' reps',
        JSON.stringify({ got: r.full.push.got, baseline: r.want.push }));

      // FLOOR — nothing measured says so rather than scoring a zero as "below"
      t.ok('an unmeasured row shows no figure at all',
        r.bare.ruck.got === null, JSON.stringify(r.bare.ruck));
    }
  }


  /* ---- v392: feet and boot readiness, and the ladder that reads them -----
     From the athlete's own preparation package, section 5 "RUCKING, FEET &
     BOOT READINESS". Its weekly self-check asks "Any blister/hotspot not
     resolving before next ruck?" and its readiness table grades rucking green
     only when the distance is achieved WITH FEET INTACT. So feet are part of
     the standard, not a footnote.

     Measured before building any of it: across 619k characters of
     athlete-visible copy the app said blister 0, hotspot 0, insole 0, toenail
     0, chafe 0, break-in 0 — every "boot" in the source was the software boot
     path. It schedules rucks up to 25 km a week and said nothing about the one
     thing that ends a march.

     THE POINT IS THE LADDER, NOT THE CHECKLIST. v326's ruck ladder raises
     distance or load every week and read nothing about the athlete's feet. */
  {
    const r = await page.evaluate(() => {
      const out = {}, ce = console.error;
      console.error = () => {};
      try {
        const iso = d => { const x = new Date(Date.now() - d * 86400000);
          return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
        const keep = { prep: STATE.prep, days: STATE.nutrition.days, foot: STATE.footLog };
        STATE.prep = { date: iso(-70), planFrom: iso(35), path: 'operator', results: {} };
        STATE.nutrition.days = {};
        const D = STATE.nutrition.days;
        for (let w = 0; w < 4; w++) for (let d = 0; d < 2; d++)
          D[iso(w * 7 + d)] = { opened: true, ruckVal: 5, ruckUnit: 'dist', ruckLvl: 'brisk', ruckLb: 25 };
        STATE.footLog = []; normalizeState();
        const wk = () => { const w = ruckLadderWeek();
          return { km: w.km, lb: w.lb, climbing: w.climbing, hold: w.footHold }; };

        out.clean = wk();
        /* BOTH KINDS OF WEEK. A load week only proves the load step is skipped;
           the distance is what the OTHER kind of week moves, and a hold that
           only stopped one of them would pass every assertion about the first. */
        out.loadWeek = { free: out.clean };
        STATE.footLog = [{ date: iso(0), state: 'hotspot' }];
        out.loadWeek.held = wk();
        /* WALK THE BLOCK BY planFrom, NOT BY THE TEST DATE. prepWeekNo() counts
           forward from planFrom, so moving prep.date changes how much time is
           LEFT and never advances the week — the first version searched that
           axis, found one week labelled 'distance' by an accident of the taper
           boundary, and that week's slot happened to BE the load slot. So the
           mutant that holds only the load escaped: `climbing==='distance'` does
           not imply the slot is not the load slot.

           And one week is not enough. The sweep walks twenty and requires that
           EVERY distance week is held, which is the property the feature
           claims. */
        const keepFrom = STATE.prep.planFrom;
        out.walk = [];
        for (let back = 0; back < 20; back++) {
          STATE.prep.planFrom = iso(7 + back * 7);
          STATE.footLog = [];
          const free = wk();
          STATE.footLog = [{ date: iso(0), state: 'hotspot' }];
          const held = wk();
          out.walk.push({ free: free.climbing, freeKm: free.km, heldKm: held.km,
                          freeLb: free.lb, heldLb: held.lb, heldClimb: held.climbing });
        }
        STATE.prep.planFrom = keepFrom;
        const dist = out.walk.filter(x => x.free === 'distance');
        const load = out.walk.filter(x => x.free === 'load');
        out.distWeek = dist.length ? { free: { climbing: 'distance', km: dist[0].freeKm },
                                       held: { climbing: dist[0].heldClimb, km: dist[0].heldKm } } : null;
        out.sweep = { distWeeks: dist.length, loadWeeks: load.length,
                      everyDistanceHeld: dist.length > 0 && dist.every(x => x.heldKm < x.freeKm && x.heldClimb === 'foot'),
                      everyLoadHeld: load.length > 0 && load.every(x => x.heldLb < x.freeLb && x.heldClimb === 'foot') };

        // a blister holds as well as a hot spot
        STATE.footLog = [{ date: iso(0), state: 'blister' }]; out.blister = wk();
        // logging clear RELEASES it
        STATE.footLog = [{ date: iso(1), state: 'blister' }, { date: iso(0), state: 'clear' }];
        out.released = wk();
        // the latest is by DATE, not by position — a backup can carry any order
        STATE.footLog = [{ date: iso(0), state: 'clear' }, { date: iso(1), state: 'blister' }];
        out.reordered = wk();
        /* FLOOR: silence is not a blister. An athlete who has never opened this
           must not have their plan held for it — positive evidence only, the
           same call painPattern() makes about pain reports. */
        STATE.footLog = []; out.neverLogged = wk();

        /* EVERY UNIT A RUCK CAN BE LOGGED IN. The prompt reads _dayRuckKm(),
           which converts minutes and calories as well as distance — a version
           that only looked at ruckUnit==='dist' would leave an athlete who logs
           in minutes with no prompt at all, and nothing else here would notice. */
        out.units = {};
        /* Cleared IN PLACE. Reassigning STATE.nutrition.days leaves `D` holding
           the old object, so every later write lands somewhere detached — which
           is exactly how the first version of this failed a check further down. */
        const wipe = () => Object.keys(D).forEach(k => delete D[k]);
        [['dist', 8], ['min', 75], ['kcal', 600]].forEach(([u, v]) => {
          wipe(); STATE.footLog = [];
          D[iso(0)] = { opened: true, ruckVal: v, ruckUnit: u, ruckLvl: 'brisk', ruckLb: 35 };
          out.units[u] = footPromptDue();
        });
        wipe(); D[iso(0)] = { opened: true, steps: 9000 };
        out.units.noRuckAtAll = footPromptDue();
        D[iso(0)] = { opened: true, ruckVal: 0, ruckUnit: 'dist', ruckLvl: 'brisk' };
        out.units.zeroRuck = footPromptDue();
        wipe();
        for (let w = 0; w < 4; w++) for (let d = 0; d < 2; d++)
          D[iso(w * 7 + d)] = { opened: true, ruckVal: 5, ruckUnit: 'dist', ruckLvl: 'brisk', ruckLb: 25 };

        /* THE PROMPT IS ORDERED IN TIME, NOT KEYED TO THE CALENDAR DAY.
           Driven with a faked clock at 23:52 and advanced ten minutes: the
           athlete logged a ruck, the prompt fired, midnight passed while it was
           on screen, and it VANISHED on the next repaint — todayISO() had moved
           on and yesterday's ruck no longer counted. An evening rucker lost the
           prompt before answering it.

           The post-midnight state is exactly "yesterday's ruck, no check", so
           it is pinned here without needing a clock. */
        out.night = {};
        wipe(); STATE.footLog = [];
        D[iso(1)] = { opened: true, ruckVal: 8, ruckUnit: 'dist', ruckLvl: 'brisk', ruckLb: 35 };
        out.night.yesterdayUnchecked = footPromptDue();
        STATE.footLog = [{ date: iso(0), state: 'clear' }];
        out.night.answeredAfterMidnight = footPromptDue();
        /* FLOOR: it must not nag about a ruck the athlete has plainly moved on
           from, and a NEW ruck after an older check must ask again — the rule
           is "newer than the check", not "a check exists". */
        wipe(); STATE.footLog = [];
        D[iso(2)] = { opened: true, ruckVal: 8, ruckUnit: 'dist', ruckLvl: 'brisk', ruckLb: 35 };
        out.night.twoDaysAgo = footPromptDue();
        wipe();
        D[iso(0)] = { opened: true, ruckVal: 8, ruckUnit: 'dist', ruckLvl: 'brisk', ruckLb: 35 };
        STATE.footLog = [{ date: iso(1), state: 'clear' }];
        out.night.newRuckAfterOldCheck = footPromptDue();
        wipe();
        for (let w = 0; w < 4; w++) for (let d = 0; d < 2; d++)
          D[iso(w * 7 + d)] = { opened: true, ruckVal: 5, ruckUnit: 'dist', ruckLvl: 'brisk', ruckLb: 25 };

        // the prompt fires on a ruck day, and stops once the check is logged
        delete D[iso(0)];
        out.promptNoRuck = footPromptDue();
        D[iso(0)] = { opened: true, ruckVal: 5, ruckUnit: 'dist', ruckLvl: 'brisk', ruckLb: 25 };
        out.promptAfterRuck = footPromptDue();
        logFootCheck('clear');
        out.promptAfterCheck = footPromptDue();
        out.clearLogged = footHold() === false;

        /* THE TAPER KEEPS ITS OWN HEADLINE AND THE NOTE STILL SHOWS. `climbing`
           is overwritten to 'taper' after the loop — v371's call, because the
           taper is the bigger truth about the week — so a note gated on
           climbing==='foot' would go SILENT in the taper, which is exactly the
           fortnight an athlete most needs to arrive with intact feet. It is
           gated on footHold() instead, and this pins that. */
        const keepDate2 = STATE.prep.date;
        STATE.prep.date = iso(-7);
        STATE.footLog = []; normalizeState();
        const tFree = ruckLadderWeek();
        STATE.footLog = [{ date: iso(0), state: 'blister' }];
        const tHeld = ruckLadderWeek();
        out.taper = { phase: tFree.phase, freeClimb: tFree.climbing, heldClimb: tHeld.climbing,
                      heldHold: tHeld.footHold, noteShows: /data-footholdnote/.test(ruckLadderHTML()),
                      kmNotRaised: tHeld.km <= tFree.km };
        STATE.prep.date = keepDate2;

        /* WHERE EACH HALF LIVES. The first version put the whole thing on the
           ruck LADDER card, which renders inside the prep sheet — a screen the
           athlete has no reason to open after a ruck, and one that does not
           render at all without a test date. The controls belong where the ruck
           is logged; the plan gets a note with no controls of its own, the way
           v311 split Movement from its Progress review. */
        STATE.footLog = [{ date: iso(0), state: 'hotspot' }];
        setCardioMode('ruck');
        const blk = ruckBlockHTML(movement(), 'the ruck');
        const lad = ruckLadderHTML();
        out.where = {
          pickerOnRuckBlock: /data-foothold|data-footprompt/.test(blk) && /logFootCheck\(/.test(blk),
          noPickerOnPlan: !/logFootCheck\(/.test(lad),
          noteOnPlan: /data-footholdnote/.test(lad),
          planSaysHolding: /nothing is climbing/i.test(lad),
          planPointsAtMovement: /Movement/.test(lad),
          blockSaysRelease: /log a clear check/i.test(blk) };
        /* The pointer is asserted BOTH ways: the plan names the destination,
           and the destination really carries the control. */
        out.pointerHolds = out.where.planPointsAtMovement && out.where.pickerOnRuckBlock;
        /* AND IT WORKS WITHOUT A PREP BLOCK — blisters are not prep-specific,
           and ruckLadderHTML() renders nothing at all with no test date. */
        const keepDate = STATE.prep.date; delete STATE.prep.date;
        out.noPrep = { ladderEmpty: ruckLadderHTML() === '',
                       blockStillChecks: /data-foothold|data-footprompt/.test(ruckBlockHTML(movement(), 'the ruck')) };
        STATE.prep.date = keepDate;
        STATE.footLog = []; D[iso(0)].ruckVal = 5;
        out.quiet = { noHoldNote: !/data-footholdnote/.test(ruckLadderHTML()) };
        out.kit = { marked: /data-footkit/.test(footKitHTML()),
                    items: (footKitHTML().match(/class="kv"/g) || []).length,
                    stamped: footKitHTML().indexOf(DAY90_ASOF) >= 0 };

        // the boot repair
        STATE.footLog = [{ date: 'abc', state: 'clear' }, { date: iso(0), state: 'nosuch' },
                         { date: iso(1), state: 'blister' }, 'junk', { date: iso(2) }];
        normalizeState();
        out.repaired = JSON.stringify(STATE.footLog);
        STATE.footLog = 'x'; normalizeState(); out.strDropped = STATE.footLog === undefined;
        delete STATE.footLog; normalizeState(); out.absent = ('footLog' in STATE) ? 'INVENTED' : 'absent';

        STATE.prep = keep.prep; STATE.nutrition.days = keep.days;
        if (keep.foot === undefined) delete STATE.footLog; else STATE.footLog = keep.foot;
        save();
      } catch (e) { out.threw = String(e && e.message || e); }
      console.error = ce;
      return out;
    });

    t.ok('guard: the block built a ladder that is genuinely climbing', !r.threw
      && r.clean && r.clean.km > 0 && ['load', 'distance'].indexOf(r.clean.climbing) >= 0,
      r.threw || JSON.stringify(r.clean));
    t.ok('guard: the walk found both kinds of week to test on',
      r.sweep.distWeeks >= 3 && r.sweep.loadWeeks >= 3, JSON.stringify(r.sweep));

    t.ok('a hot spot stops the load step on a load week',
      r.loadWeek.held.lb < r.loadWeek.free.lb && r.loadWeek.held.climbing === 'foot',
      JSON.stringify(r.loadWeek));
    t.ok('and it stops the distance on EVERY distance week across the block',
      r.sweep.everyDistanceHeld === true, JSON.stringify(r.sweep));
    t.ok('and the load on every load week',
      r.sweep.everyLoadHeld === true, JSON.stringify(r.sweep));
    t.ok('neither variable moves while it holds — it is not a swap',
      r.loadWeek.held.km === r.loadWeek.free.km && r.distWeek.held.lb === r.distWeek.free.lb,
      JSON.stringify({ load: r.loadWeek, dist: r.distWeek }));
    t.ok('a blister holds it the same way', r.blister.climbing === 'foot' && r.blister.hold === true,
      JSON.stringify(r.blister));
    t.ok('logging a clear check releases the plan',
      r.released.hold === false && r.released.climbing !== 'foot', JSON.stringify(r.released));
    t.ok('and the latest check is the one by DATE, not by position in the file',
      r.reordered.hold === false, JSON.stringify(r.reordered));
    /* FLOOR: a hold that fired on silence would stop every athlete's plan
       climbing for a feature they never opened. */
    t.ok('an athlete who has never logged a check is never held',
      r.neverLogged.hold === false && r.neverLogged.climbing !== 'foot', JSON.stringify(r.neverLogged));

    t.ok('an evening ruck still asks after midnight has passed',
      r.night.yesterdayUnchecked === true, JSON.stringify(r.night));
    t.ok('and answering it after midnight stops the asking',
      r.night.answeredAfterMidnight === false, JSON.stringify(r.night));
    t.ok('while a ruck two days back does not nag',
      r.night.twoDaysAgo === false, JSON.stringify(r.night));
    t.ok('and a new ruck after an older check asks again — newer than, not merely present',
      r.night.newRuckAfterOldCheck === true, JSON.stringify(r.night));
    t.ok('the check is asked whichever unit the ruck was logged in',
      r.units.dist === true && r.units.min === true && r.units.kcal === true,
      JSON.stringify(r.units));
    t.ok('and not on a day with no ruck, nor on an empty ruck row',
      r.units.noRuckAtAll === false && r.units.zeroRuck === false, JSON.stringify(r.units));
    t.ok('the check is asked on a day a ruck was logged, and not otherwise',
      r.promptNoRuck === false && r.promptAfterRuck === true, JSON.stringify(r));
    t.ok('and it stops asking once it has been answered',
      r.promptAfterCheck === false && r.clearLogged === true, JSON.stringify(r));

    t.ok('guard: the taper case really is in the taper', r.taper.phase === 'taper', JSON.stringify(r.taper));
    t.ok('the taper keeps its own headline rather than being relabelled',
      r.taper.freeClimb === 'taper' && r.taper.heldClimb === 'taper', JSON.stringify(r.taper));
    t.ok('but the hold note still shows there, and nothing is raised',
      r.taper.heldHold === true && r.taper.noteShows === true && r.taper.kmNotRaised === true,
      JSON.stringify(r.taper));
    t.ok('the check sits where the ruck is logged, not on the plan',
      r.where.pickerOnRuckBlock && r.where.noPickerOnPlan, JSON.stringify(r.where));
    t.ok('and the plan carries a note explaining why nothing is climbing',
      r.where.noteOnPlan && r.where.planSaysHolding, JSON.stringify(r.where));
    /* Asserted BOTH ways, the v315 rule: naming a destination is half a check. */
    t.ok('the note points at Movement, and Movement really holds the control',
      r.pointerHolds === true, JSON.stringify(r.where));
    t.ok('and it says what releases it', r.where.blockSaysRelease, JSON.stringify(r.where));
    /* FLOOR: an athlete who rucks without a test date renders no ladder at all,
       and blisters are not prep-specific. */
    t.ok('the check still works for an athlete with no prep block',
      r.noPrep.ladderEmpty === true && r.noPrep.blockStillChecks === true, JSON.stringify(r.noPrep));
    /* A note that always fires is a note nobody reads. */
    t.ok('while a clean athlete gets no hold note at all', r.quiet.noHoldNote, JSON.stringify(r.quiet));
    t.ok('the foot-care kit is the package’s own list, stamped like every other figure from it',
      r.kit.marked && r.kit.items === 8 && r.kit.stamped, JSON.stringify(r.kit));

    /* THE ROUTE, NOT THE BUILDER. Every assertion above reads ruckBlockHTML()'s
       output, which stays true even if the block is never mounted — the escape
       this file records for the v292 Convert button and four times since. This
       one renders Today, finds the button the athlete taps, CLICKS it, and
       reads the screen back. */
    const tap = await page.evaluate(() => {
      const out = {}, ce = console.error; console.error = () => {};
      try {
        const iso = d => { const x = new Date(Date.now() - d * 86400000);
          return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
        const keepDays = STATE.nutrition.days, keepFoot = STATE.footLog, keepMode = STATE.nutrition.cardioMode;
        setCardioMode('ruck');
        STATE.nutrition.days = {};
        STATE.nutrition.days[iso(0)] = { opened: true, ruckVal: 8, ruckUnit: 'dist', ruckLvl: 'brisk', ruckLb: 35 };
        STATE.footLog = []; normalizeState();
        TODAY_TAB = 'workout'; go('today'); render();
        out.mounted = document.querySelectorAll('[data-foot]').length;
        out.promptShown = !!document.querySelector('[data-footprompt]');
        const hot = document.querySelector('[data-foot="hotspot"]');
        if (hot) hot.click();
        out.afterTap = { logged: JSON.stringify(STATE.footLog), hold: footHold(),
                         note: !!document.querySelector('[data-foothold]'),
                         promptGone: !document.querySelector('[data-footprompt]') };
        const clr = document.querySelector('[data-foot="clear"]');
        if (clr) clr.click();
        out.afterClear = { logged: JSON.stringify(STATE.footLog), hold: footHold(),
                           noteGone: !document.querySelector('[data-foothold]') };
        STATE.nutrition.days = keepDays; STATE.nutrition.cardioMode = keepMode;
        if (keepFoot === undefined) delete STATE.footLog; else STATE.footLog = keepFoot;
        save(); render();
      } catch (e) { out.threw = String(e && e.message || e); }
      console.error = ce; return out;
    });
    t.ok('guard: the picker is really mounted on Today, not just built by a helper',
      !tap.threw && tap.mounted === 3 && tap.promptShown === true,
      tap.threw || JSON.stringify(tap));
    t.ok('tapping the button writes the check and repaints to the hold note',
      /hotspot/.test(tap.afterTap.logged) && tap.afterTap.hold === true
        && tap.afterTap.note === true && tap.afterTap.promptGone === true,
      JSON.stringify(tap.afterTap));
    t.ok('and tapping clear releases it, on the same day’s row',
      /clear/.test(tap.afterClear.logged) && !/hotspot/.test(tap.afterClear.logged)
        && tap.afterClear.hold === false && tap.afterClear.noteGone === true,
      JSON.stringify(tap.afterClear));

    /* A NEW STATE FIELD GETS A ROUND-TRIP CHECK OF ITS OWN — that is precisely
       how v336's lost API key was found. A foot-check history describes the
       athlete, so it belongs in a backup and is deliberately NOT in
       TRANSIENT_KEYS; and the HOLD has to survive the restore, or an athlete
       who reinstalls mid-blister silently gets their ladder climbing again. */
    const trip = await page.evaluate(() => {
      const out = {}, ce = console.error; console.error = () => {};
      try {
        const iso = d => { const x = new Date(Date.now() - d * 86400000);
          return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
        const keep = JSON.parse(JSON.stringify(STATE));
        STATE.footLog = [{ date: iso(2), state: 'hotspot' }, { date: iso(1), state: 'clear' },
                         { date: iso(0), state: 'blister' }];
        save();
        out.before = { log: JSON.stringify(STATE.footLog), hold: footHold() };
        const clone = JSON.parse(JSON.stringify(STATE));
        if (clone.settings) { delete clone.settings.azureKey; delete clone.settings.foodAiKey; }
        TRANSIENT_KEYS.forEach(k => { delete clone[k]; });
        out.inBackup = JSON.stringify(clone.footLog);
        STATE = DEFAULT_STATE(); normalizeState();
        out.afterReset = STATE.footLog === undefined ? 'absent' : JSON.stringify(STATE.footLog);
        STATE = Object.assign(DEFAULT_STATE(), clone);
        STATE.settings = Object.assign(DEFAULT_STATE().settings, clone.settings || {});
        STATE.profile = Object.assign(DEFAULT_STATE().profile, clone.profile || {});
        STATE.nutrition = Object.assign(DEFAULT_STATE().nutrition, clone.nutrition || {});
        normalizeState();
        out.after = { log: JSON.stringify(STATE.footLog), hold: footHold() };
        STATE = keep; normalizeState(); save();
      } catch (e) { out.threw = String(e && e.message || e); }
      console.error = ce; return out;
    });
    t.ok('guard: the round trip started from three real checks and a live hold',
      !trip.threw && trip.before && trip.before.hold === true
        && (trip.before.log.match(/date/g) || []).length === 3,
      trip.threw || JSON.stringify(trip.before));
    t.eq('the foot log travels in a backup', trip.inBackup, trip.before.log);
    t.eq('a fresh install has no checks at all', trip.afterReset, 'absent');
    t.eq('and a restore brings every row back unchanged', trip.after.log, trip.before.log);
    /* The hold is the consequential half: an athlete who reinstalls mid-blister
       must not find their ladder quietly climbing again. */
    t.ok('with the hold still standing afterwards', trip.after.hold === true, JSON.stringify(trip.after));

    /* THE TWO RESETS. restartProgram() is the path v365 records as "the one
       reset that never asked the list", so a new lifetime field is exactly what
       it forgets — or wrongly clears. A restart that dropped the foot log would
       silently release an active hold and start the ladder climbing again over
       an unresolved blister. hardReset() is athlete data and must go. */
    const life = await page.evaluate(() => {
      const out = {}, ce = console.error, cf = window.confirm;
      console.error = () => {}; window.confirm = () => true;
      try {
        const iso = d => { const x = new Date(Date.now() - d * 86400000);
          return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
        const keep = JSON.parse(JSON.stringify(STATE));
        const seed = () => { STATE.footLog = [{ date: iso(1), state: 'clear' },
                                              { date: iso(0), state: 'blister' }]; save(); };
        seed();
        out.before = { hold: footHold(), rows: STATE.footLog.length };
        restartProgram();
        out.afterRestart = { kept: JSON.stringify(STATE.footLog), hold: footHold() };
        seed();
        hardReset();
        out.afterHardReset = { gone: STATE.footLog === undefined, hold: footHold() };
        STATE = keep; normalizeState(); save();
      } catch (e) { out.threw = String(e && e.message || e); }
      console.error = ce; window.confirm = cf; return out;
    });
    t.ok('guard: the lifecycle case started from a live hold',
      !life.threw && life.before && life.before.hold === true && life.before.rows === 2,
      life.threw || JSON.stringify(life.before));
    t.ok('restarting the program keeps the foot log — it is a lifetime record',
      (life.afterRestart.kept.match(/date/g) || []).length === 2, JSON.stringify(life.afterRestart));
    /* The consequential half: a restart that released the hold would start the
       ladder climbing again over an unresolved blister. */
    t.ok('and keeps the hold with it', life.afterRestart.hold === true, JSON.stringify(life.afterRestart));
    t.ok('while a hard reset clears it, like every other thing the athlete owns',
      life.afterHardReset.gone === true && life.afterHardReset.hold === false,
      JSON.stringify(life.afterHardReset));

    t.eq('the repair keeps a real check and drops every junk row',
      r.repaired, '[{"date":"' + new Date(Date.now() - 86400000).toISOString().slice(0, 10) + '","state":"blister"}]');
    t.ok('a log that is not a list is dropped', r.strDropped === true, r.strDropped);
    t.ok('and no log is invented for an athlete who never checked', r.absent === 'absent', r.absent);
  }


  /* ---- v393: one fact, one place ----------------------------------------
     footLoadHTML() is called from the running plan AND from the ruck ladder,
     and both live in the SAME sheet — ruckLadderHTML() renders inside
     enduranceHTML(). Both read the same global answer from footNewMode(),
     which v332 made deliberate so they could never disagree; the consequence
     nobody noticed is that they then rendered the IDENTICAL sentence twice on
     one screen.

     Measured before the fix: with history in both modes the plain "together"
     line appeared 2 times, and on a new-mode athlete the warning appeared 2
     times. Every athlete with a prep block saw one of the two doubled. */
  {
    const r = await page.evaluate(() => {
      const out = {}, ce = console.error; console.error = () => {};
      try {
        const iso = d => { const x = new Date(Date.now() - d * 86400000);
          return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
        const keep = JSON.parse(JSON.stringify(STATE));
        STATE.prep = { date: iso(-70), planFrom: iso(35), path: 'operator', results: {} };
        STATE.footLog = [{ date: iso(0), state: 'clear' }];
        const D = STATE.nutrition.days;
        const wipe = () => Object.keys(D).forEach(k => delete D[k]);
        const count = () => { openEndurance();
          const sh = document.querySelector('#sheet'), t = sh ? sh.innerText : '';
          const r2 = { together: (t.match(/together:/g) || []).length,
                       brand: (t.match(/is brand new on top of/g) || []).length,
                       newMode: footNewMode() };
          closeSheet(); return r2; };

        wipe();
        for (let w = 0; w < 4; w++) for (let d = 0; d < 2; d++)
          D[iso(w * 7 + d)] = { opened: true, ruckVal: 6, ruckUnit: 'dist', ruckLvl: 'brisk',
                                ruckLb: 30, runVal: 5, runUnit: 'dist', runLvl: 'steady' };
        normalizeState(); out.both = count();

        wipe();
        for (let w = 0; w < 4; w++) for (let d = 0; d < 2; d++)
          D[iso(w * 7 + d)] = { opened: true, ruckVal: 6, ruckUnit: 'dist', ruckLvl: 'brisk', ruckLb: 30 };
        normalizeState(); out.ruckOnly = count();

        wipe();
        for (let w = 0; w < 4; w++) for (let d = 0; d < 2; d++)
          D[iso(w * 7 + d)] = { opened: true, runVal: 5, runUnit: 'dist', runLvl: 'steady' };
        normalizeState(); out.runOnly = count();

        STATE = keep; normalizeState(); save();
      } catch (e) { out.threw = String(e && e.message || e); }
      console.error = ce; return out;
    });

    t.ok('guard: the three cases really are the three states the note has',
      !r.threw && r.both.newMode === null && r.ruckOnly.newMode === 'run' && r.runOnly.newMode === 'ruck',
      r.threw || JSON.stringify(r));
    /* ONE FACT, ONE PLACE — the v314 lesson, one sheet over. */
    t.ok('the combined foot total is stated once, not once per plan',
      r.both.together === 1 && r.both.brand === 0, JSON.stringify(r.both));
    t.ok('and the new-mode warning is stated once when running is the new mode',
      r.ruckOnly.brand === 1 && r.ruckOnly.together === 0, JSON.stringify(r.ruckOnly));
    t.ok('and once when rucking is the new mode — the other card stays quiet',
      r.runOnly.brand === 1 && r.runOnly.together === 0, JSON.stringify(r.runOnly));
    /* FLOOR: a fix that simply deleted one call site would drop the warning
       entirely for whichever mode that card owns. Both directions are pinned
       above, so silencing either one fails. */
  }

  /* ---- the estimated-base note has to describe the week it is on ----------
     `estimated` stays true for the WHOLE block while nothing is logged, so at
     week 18 the endurance card carried "the plan opens at 8 km a week and
     climbs from there" directly above "the build has reached its ceiling — 20
     km a week". Two notes on one card describing different weeks, and the one
     in the present tense was describing the past. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(() => {
      const read = daysIn => {
        STATE.prep = { date: new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10),
                       path: 'operator', results: {}, combat: {},
                       planFrom: new Date(Date.now() - daysIn * 864e5).toISOString().slice(0, 10) };
        normalizeState();
        const w = enduranceWeek(), rk = ruckLadderWeek();
        closeSheet(); openEndurance();
        const sh = document.getElementById('sheet');
        const notes = [...sh.querySelectorAll('.note')].map(n => n.textContent.replace(/\s+/g, ' ').trim());
        return { estimated: !!w.estimated, km: w.km, start: w.start,
                 ruckKm: rk.km, ruckStart: rk.startKm, ruckLb: rk.lb,
                 opens: notes.filter(n => /opens at/.test(n)),
                 climbed: notes.filter(n => /has climbed to/.test(n)),
                 ceiling: notes.some(n => /reached its ceiling/.test(n)) };
      };
      /* Day 1, not day 7: the RUCK ladder already climbs in week 2, so at day 7
         it correctly reports "has climbed to 5.5 km" while the run is still at
         its floor. The opening state is the one where BOTH are untouched. */
      return { early: read(1), late: read(200) };
    });

    /* GUARDS: the two states this is about really are what they claim, or every
       assertion below passes on nothing. */
    t.ok('guard: the base is estimated in BOTH weeks — that is the whole point',
      r.early.estimated && r.late.estimated, JSON.stringify({ e: r.early.estimated, l: r.late.estimated }));
    t.ok('guard: week 1 really is at the floor on BOTH plans, and the late week has climbed',
      r.early.km === r.early.start && r.early.ruckKm === r.early.ruckStart
        && r.late.km > r.late.start && r.late.ruckKm > r.late.ruckStart,
      JSON.stringify({ early: [r.early.start, r.early.km, r.early.ruckStart, r.early.ruckKm],
                       late: [r.late.start, r.late.km, r.late.ruckStart, r.late.ruckKm] }));
    t.ok('guard: and the ceiling note really is on the late card to contradict',
      r.late.ceiling, JSON.stringify(r.late));

    /* FLOOR — at the opening the original wording is correct and must stay. */
    t.eq('FLOOR: week one still says the plan opens at the floor',
      r.early.opens.length, 2, JSON.stringify(r.early.opens));
    t.eq('and does not claim to have climbed anywhere', r.early.climbed.length, 0,
      JSON.stringify(r.early.climbed));

    // and once it HAS climbed, neither note is in the present tense about the floor
    t.eq('a climbed plan no longer says it "opens at" the floor', r.late.opens.length, 0,
      JSON.stringify(r.late.opens));
    t.eq('both cards say what they have climbed to instead', r.late.climbed.length, 2,
      JSON.stringify(r.late.climbed));
    t.ok('and each names the figure its own card is prescribing',
      r.late.climbed.some(n => n.indexOf(String(r.late.km)) >= 0)
        && r.late.climbed.some(n => n.indexOf(String(r.late.ruckLb)) >= 0),
      JSON.stringify({ notes: r.late.climbed, km: r.late.km, lb: r.late.ruckLb }));
    /* And the actionable half survives either way — it is the only part that
       tells the athlete what to do about it. */
    t.ok('the call to log real work survives in both states',
      r.early.opens.every(n => /Log a few/.test(n)) && r.late.climbed.every(n => /Log a few/.test(n)),
      JSON.stringify({ early: r.early.opens, late: r.late.climbed }));
    errors.forEach(e => t.fail('page error', e));
    await browser.close();
  }


  /* ---- the brief has to say why the load is down ------------------------
     A deload week described "2 sets of 30 reps" in full and never said the load
     was eased — and the brief is the segment the coach reads ALOUD, so there is
     nothing on screen to check it against. v372 established that a quiet cut
     reads as a bug and gave the Today BANNER its reason; the brief never got
     one. deloadReason() is now the single source both ask. */
  {
    const r = await page.evaluate(() => {
      const say = () => briefSegments().map(x => String(x.say || '')).join(' ');
      const out = {};
      STATE.progressPtr = 40;                       // week 6 — a calendar deload
      STATE.prep = {}; normalizeState();
      out.reason = (typeof deloadReason === 'function') ? deloadReason() : null;
      out.deloadOn = deloadOn();
      out.plain = say();
      out.title = briefSegments()[0].title;
      /* In a prep taper the segment above already explains the easing in more
         detail, so this one stays silent — two lines for one fact is the defect
         this round exists to remove. */
      STATE.prep = { date: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10),
                     path: 'operator', results: {}, combat: {},
                     planFrom: new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10) };
      normalizeState();
      out.taperOn = (typeof prepTaperEase === 'function') ? prepTaperEase() : null;
      out.taper = say();
      /* deloadReason()'s ORDERING, pinned directly. The brief suppresses in a
         taper either way, so its rendered text cannot tell the calendar term
         from its absence — a mutant dropping `calendar` escaped every screen
         assertion. The nearer cause wins: a calendar week 6 reads 'deload' even
         while a taper is running, and week 3 reads 'taper'. Same technique as
         v338's prepDatePassed() — a guard consulted in one narrow branch still
         has to mean what it is named. */
      out.reasonWk6 = (typeof deloadReason === 'function') ? deloadReason() : null;
      out.wk6 = posOf(STATE.progressPtr).week;
      STATE.progressPtr = 20;
      out.reasonWk3 = (typeof deloadReason === 'function') ? deloadReason() : null;
      out.wk3 = posOf(STATE.progressPtr).week;
      STATE.progressPtr = 40;
      /* FLOOR — an ordinary week says nothing about an ease at all. */
      STATE.prep = {}; STATE.progressPtr = 8; STATE.settings.deload = false;
      normalizeState();
      out.normalOn = deloadOn();
      out.normal = say();
      return out;
    });

    t.ok('guard: week 6 with no prep block really is a calendar deload',
      r.deloadOn === true && r.reason === 'deload', JSON.stringify({ on: r.deloadOn, why: r.reason }));
    t.ok('the brief says the load is eased and why',
      /load is eased/.test(r.plain) && /deload/.test(r.plain), r.plain.slice(0, 240));
    t.ok('guard: the taper case really is in a taper',
      r.taperOn === true, JSON.stringify({ taper: r.taperOn }));
    t.ok('guard: the two pointers really are week 6 and week 3 of their block',
      r.wk6 === 6 && r.wk3 === 3, JSON.stringify({ wk6: r.wk6, wk3: r.wk3 }));
    t.eq('a calendar deload week reads as the deload, even inside a taper',
      r.reasonWk6, 'deload');
    t.eq('while an ordinary week inside a taper reads as the taper',
      r.reasonWk3, 'taper');
    t.ok('and in a taper it does not say it twice — the prep segment owns that',
      /this is the taper/.test(r.taper) && !/load is eased/.test(r.taper),
      r.taper.slice(0, 240));
    /* FLOOR: a note that always fires is a note nobody reads. */
    t.ok('guard: the ordinary week really is not a deload', r.normalOn === false,
      JSON.stringify({ on: r.normalOn }));
    t.ok('FLOOR: an ordinary week says nothing about an ease',
      !/load is eased/.test(r.normal), r.normal.slice(0, 200));

    /* The heading read "Morning brief" at every hour while the line under it
       said "Good evening" — one card, two answers from the same clock. */
    t.ok('and the brief heading agrees with its own greeting',
      /^(Morning|Afternoon|Evening) brief$/.test(r.title || '')
        && (r.plain.indexOf('Good ' + r.title.split(' ')[0].toLowerCase()) >= 0),
      JSON.stringify({ title: r.title, opens: r.plain.slice(0, 40) }));
  }

  /* ---- the kit question, on the third picking path to skip it -------------
     startForceTrain() skipped hasGearFor() in v322 and startHoldTest() in
     v366. startSpecialFormat() built its one item straight from the format,
     so an athlete with an empty gear list saw four tappable grip buttons,
     nothing on screen naming a pull-up bar, and grip30 started a session of
     dead hangs they physically cannot do.

     It NAMES the kit rather than substituting, and the arithmetic is what
     settles that: safeSwap('deadhang') for a flagged shoulder is BIRD DOG, a
     REPS movement, while the format prescribes w*60 SECONDS. The joint half of
     the question is already answered on that sheet by actRiskNoteHTML(), and a
     check below pins that it still is.

     The floors are the athlete who owns a bar, the box formats that need no
     kit at all, and the health lock. */
  {
    const r = await page.evaluate(async () => {
      const o = {};
      const txt = () => ((document.getElementById('sheet') || {}).textContent || '').replace(/\s+/g, ' ');
      STATE.profile.parq = []; STATE.profile.parqDone = true; STATE.profile.medCleared = true;

      /* No kit at all. */
      STATE.profile.limitations = []; STATE.profile.gear = []; save();
      openGrip(); await new Promise(z => setTimeout(z, 150));
      o.noBarButtons = [...document.querySelectorAll('#sheet [data-fmt]')].length;
      o.noBarKitRows = [...document.querySelectorAll('#sheet [data-fmtkit]')].length;
      o.noBarNamesKit = /needs Pull-up bar/i.test(txt());
      closeSheet(); await new Promise(z => setTimeout(z, 200));
      INTV = null; startSpecialFormat('grip30'); await new Promise(z => setTimeout(z, 120));
      o.noBarStarted = !!INTV; if (INTV) hiitQuit();
      await new Promise(z => setTimeout(z, 150));

      /* FLOOR: the box formats need nothing and must be untouched. */
      openBox(); await new Promise(z => setTimeout(z, 150));
      o.boxButtons = [...document.querySelectorAll('#sheet [data-fmt]')].length;
      o.boxKitRows = [...document.querySelectorAll('#sheet [data-fmtkit]')].length;
      closeSheet(); await new Promise(z => setTimeout(z, 200));

      /* FLOOR: an athlete who owns a bar is unchanged. */
      STATE.profile.gear = ['bar']; save();
      openGrip(); await new Promise(z => setTimeout(z, 150));
      o.barButtons = [...document.querySelectorAll('#sheet [data-fmt]')].length;
      o.barKitRows = [...document.querySelectorAll('#sheet [data-fmtkit]')].length;
      closeSheet(); await new Promise(z => setTimeout(z, 200));
      INTV = null; startSpecialFormat('grip30'); await new Promise(z => setTimeout(z, 120));
      o.barStarted = !!INTV;
      o.barIds = INTV ? [...new Set((INTV.seq || []).map(x => x && x.exId).filter(Boolean))] : [];
      if (INTV) hiitQuit();
      await new Promise(z => setTimeout(z, 150));

      /* The joint note is a different question and must still be answered. */
      STATE.profile.limitations = ['shoulder']; save();
      openGrip(); await new Promise(z => setTimeout(z, 150));
      o.jointWarned = /flagged a joint/i.test(txt());
      closeSheet(); await new Promise(z => setTimeout(z, 200));

      /* FLOOR: the health lock still locks the max hang. */
      STATE.profile.limitations = []; STATE.profile.parqDone = false; STATE.profile.medCleared = false; save();
      openGrip(); await new Promise(z => setTimeout(z, 150));
      o.locked = /🔒/.test(txt());
      closeSheet();
      STATE.profile.parqDone = true; STATE.profile.medCleared = true; save();

      /* The predicate's own contract, exercised directly. */
      STATE.profile.gear = []; save();
      o.pk = [formatKitMissing('grip30'), formatKitMissing('box3x3'), formatKitMissing('nope')];
      STATE.profile.gear = ['bar']; save();
      o.pkWithBar = formatKitMissing('grip30');
      return o;
    });
    t.eq('with no pull-up bar the grip formats are not offered', r.noBarButtons, 0);
    t.eq('and each row names the kit instead', r.noBarKitRows, 4);
    t.ok('in words the athlete can act on', r.noBarNamesKit, r);
    t.ok('and the starter refuses it too, so a stale sheet cannot get past the row', !r.noBarStarted, r);
    t.eq('FLOOR: the box formats need nothing and keep all three buttons', r.boxButtons, 3);
    t.eq('and are never marked as needing kit', r.boxKitRows, 0);
    t.eq('FLOOR: an athlete who owns a bar still gets all four', r.barButtons, 4);
    t.eq('with no kit rows at all', r.barKitRows, 0);
    t.ok('and can still start one', r.barStarted, r);
    t.eq('on the real movement', r.barIds, ['deadhang']);
    t.ok('a flagged joint is still warned about — a different question', r.jointWarned, r);
    t.ok('FLOOR: the health lock still locks the max hang', r.locked, r);
    t.eq('formatKitMissing() names the kit, and only when it is missing', r.pk, ['Pull-up bar', null, null]);
    t.eq('and says nothing once the athlete owns it', r.pkWithBar, null);
  }

  /* ---------- a read the athlete paid for is parked, not thrown away -----
     All three image readers stand down when the sheet world has moved on, and
     each then told the athlete where to pick the result up while leaving it
     nowhere. The activity one did not even stand down: the guard had no
     `return`, so it announced the stand-down and opened the sheet anyway,
     replacing a quick-add sheet the athlete had typed into.

     The readers are file-picker callbacks nothing can drive, so the stand-down
     itself is asserted on the SOURCE — and the ROUTES it names are driven,
     because a named address with nothing at it is the whole defect. */
  {
    const r = await page.evaluate(async () => {
      const o = {};
      const src = f => (typeof window[f] === 'function' || typeof eval(f) === 'function') ? eval(f).toString() : '';
      const stands = (name, opener) => {
        const b = src(name);
        const i = b.indexOf('gen!==_sheetGen');
        if (i < 0) return { found: false };
        const j = b.indexOf(opener, i);
        return { found: true, returns: j > i && b.slice(i, j).indexOf('return') >= 0 };
      };
      o.photo  = stands('foodPhoto', 'openQuickAdd(');
      o.shot   = stands('foodScreenshot', 'openQuickAdd(');
      o.act    = stands('activityScreenshot', 'openActivityReview(');
      o.bar    = stands('lookupBarcode', 'openQuickAdd(');
      /* and each parks what it read, or the address it names holds nothing */
      o.photoParks = /_foodRead\s*=/.test(src('foodPhoto'));
      o.shotParks  = /_foodRead\s*=/.test(src('foodScreenshot'));
      o.actParks   = src('activityScreenshot').indexOf('_actRead=plan')
                   < src('activityScreenshot').indexOf('gen!==_sheetGen');
      o.barParks   = /_foodRead\s*=/.test(src('lookupBarcode'));
      /* closeSheet() does not re-render the view behind it, so parking alone
         leaves the row off the very tab the toast names. */
      o.repaints = ['foodPhoto','foodScreenshot','lookupBarcode']
        .every(f=>/renderFuel\(\)/.test(src(f)))
        && /repaintMovement\(\)/.test(src('activityScreenshot'));

      /* THE MOVEMENT ADDRESS really holds it. */
      _actRead = { read: 2, steps: 8000, run: { km: 5, min: 30 }, ruck: { km: 0, min: 0 },
                   bike: { km: 0, min: 0 }, jacks: { min: 0 }, skip: { min: 0 }, unplaced: [] };
      setTodayTab('workout'); go('today');
      await new Promise(z => setTimeout(z, 250));
      o.actRow = !!document.querySelector('#v-today [data-actread="1"]');
      o.actReviewWired = /openActivityReview\(\)/.test(document.querySelector('#v-today').innerHTML);
      openActivityReview();
      await new Promise(z => setTimeout(z, 250));
      o.actReviewOpens = /2 activities read/.test((document.querySelector('#sheet') || {}).innerText || '');
      closeSheet(); await new Promise(z => setTimeout(z, 400));
      discardActivityRead();
      await new Promise(z => setTimeout(z, 250));
      o.actDiscards = !_actRead && !document.querySelector('#v-today [data-actread="1"]');

      /* THE FUEL ADDRESS really holds it. */
      _foodRead = { name: 'Grilled chicken', kcal: 430, p: 46, c: 0, f: 12 };
      go('fuel'); await new Promise(z => setTimeout(z, 250));
      const fv = () => document.querySelector('#v-fuel');
      o.foodRow = !!fv().querySelector('[data-foodread="1"]');
      o.foodNames = /Grilled chicken/.test(fv().innerText) && /430 kcal/.test(fv().innerText);
      openFoodRead();
      await new Promise(z => setTimeout(z, 250));
      o.prefilled = (document.querySelector('#fa-name') || {}).value;
      o.prefilledKcal = (document.querySelector('#fa-kcal') || {}).value;
      o.consumed = _foodRead === null;
      closeSheet(); await new Promise(z => setTimeout(z, 400));
      go('fuel'); await new Promise(z => setTimeout(z, 200));
      o.rowGone = !fv().querySelector('[data-foodread="1"]');

      /* The name comes from a language model, and importData() accepts JSON. */
      window.__pwn = false;
      _foodRead = { name: '<img src=x onerror="window.__pwn=true">', kcal: 100 };
      go('fuel'); await new Promise(z => setTimeout(z, 400));
      o.injected = !!window.__pwn || !!fv().querySelector('[data-foodread="1"] img');
      /* The model's name is unbounded; every stored row caps it at 60, and a
         row is TEXT rather than an input, so it is the one that can overflow. */
      _foodRead = { name: 'Z'.repeat(400), kcal: 200 };
      go('fuel'); await new Promise(z => setTimeout(z, 250));
      const longRow = fv().querySelector('[data-foodread="1"]');
      o.longNameCapped = !!longRow && (longRow.innerText.match(/Z+/) || [''])[0].length <= 60;
      o.longNameFits = !!longRow && longRow.getBoundingClientRect().right <= window.innerWidth + 1;

      /* A zero is not a measurement (v260): an unreadable figure says nothing. */
      _foodRead = { name: 'X', kcal: 'lots' };
      go('fuel'); await new Promise(z => setTimeout(z, 200));
      o.junkText = (fv().querySelector('[data-foodread="1"]') || {}).innerText || '';
      _foodRead = null;

      /* THE DISCRIMINATING CASE for the plain ➕. With nothing parked it opens
         blank either way, so a floor driven in that state cannot see the
         over-eager twin at all — the mutant that makes openQuickAdd() consume
         the park escaped exactly there. A guard that cannot fire in the case
         you tested is not tested. */
      _foodRead = { name: 'Grilled chicken', kcal: 430 };
      go('fuel'); await new Promise(z => setTimeout(z, 200));
      openQuickAdd(); await new Promise(z => setTimeout(z, 250));
      o.plusBlankWithPark = (document.querySelector('#fa-name') || {}).value === '';
      o.parkSurvivesPlus = !!foodReadPending();
      closeSheet(); await new Promise(z => setTimeout(z, 400));
      _foodRead = null;

      /* FLOORS: nothing parked means no row anywhere, and the ➕ stays blank. */
      go('fuel'); await new Promise(z => setTimeout(z, 200));
      o.noRowWhenEmpty = !fv().querySelector('[data-foodread="1"]');
      openQuickAdd(); await new Promise(z => setTimeout(z, 250));
      o.plusBlank = (document.querySelector('#fa-name') || {}).value === '';
      closeSheet(); await new Promise(z => setTimeout(z, 400));
      setTodayTab('workout'); go('today'); await new Promise(z => setTimeout(z, 250));
      o.noActRowWhenEmpty = !document.querySelector('#v-today [data-actread="1"]');

      /* "Erase your workout, food and profile data ... This cannot be undone."
         A parked read is unlogged food the athlete has not saved, and it lives
         in memory rather than STATE — so clearing STATE leaves it on the glass
         of a freshly-erased app. Same visible residue as the photo blobs. */
      _foodRead = { name: 'Grilled chicken', kcal: 430 };
      _actRead = { read: 1, steps: 0, run: { km: 1, min: 10 }, ruck: { km: 0, min: 0 },
                   bike: { km: 0, min: 0 }, jacks: { min: 0 }, skip: { min: 0 }, unplaced: [] };
      const realConfirm2 = window.confirm; window.confirm = () => true;
      hardReset();
      await new Promise(z => setTimeout(z, 500));
      window.confirm = realConfirm2;
      o.resetClearsFood = _foodRead === null;
      o.resetClearsAct = _actRead === null;
      return o;
    });
    t.ok('guard: the stand-down branch is present in all four readers',
      r.photo.found && r.shot.found && r.act.found && r.bar.found, r);
    t.ok('the food photo reader stands down instead of opening the sheet', r.photo.returns, r);
    t.ok('so does the food screenshot reader', r.shot.returns, r);
    t.ok('and so does the activity reader, which used to open it anyway', r.act.returns, r);
    t.ok('the food photo reader parks what it read', r.photoParks, r);
    t.ok('and so does the food screenshot reader', r.shotParks, r);
    t.ok('and the activity reader parks before it stands down', r.actParks, r);
    t.ok('the barcode lookup stands down too', r.bar.returns, r);
    t.ok('and parks the product rather than making the athlete re-scan it', r.barParks, r);
    t.ok('and every reader repaints the surface it sends the athlete to', r.repaints, r);
    t.ok('Movement really holds the parked activity read', r.actRow, r);
    t.ok('with a control that opens it', r.actReviewWired, r);
    t.ok('and it opens on what was read', r.actReviewOpens, r);
    t.ok('and can be discarded, so the row is not stuck there', r.actDiscards, r);
    t.ok('Fuel really holds the parked food read', r.foodRow, r);
    t.ok('naming the food and the calories', r.foodNames, r);
    t.eq('and logging it opens the sheet pre-filled', r.prefilled, 'Grilled chicken');
    t.eq('with the calories that were read', r.prefilledKcal, '430');
    t.ok('the parked read is consumed once used', r.consumed, r);
    t.ok('so the row goes with it', r.rowGone, r);
    t.ok('a model-supplied name cannot inject', !r.injected, r);
    t.ok('and a very long one is capped the way a stored row caps it', r.longNameCapped, r);
    t.ok('so the row does not run off the screen', r.longNameFits, r);
    t.ok('and an unreadable calorie figure is not printed as a measured zero',
      r.junkText.indexOf('0 kcal') < 0 && r.junkText.indexOf('read from your image') >= 0, r);
    t.ok('FLOOR: nothing parked means no row on Fuel', r.noRowWhenEmpty, r);
    t.ok('FLOOR: and none on Movement', r.noActRowWhenEmpty, r);
    t.ok('FLOOR: the ordinary ➕ still opens a blank form', r.plusBlank, r);
    t.ok('FLOOR: and it opens blank even with a read WAITING', r.plusBlankWithPark, r);
    t.ok('leaving the park alone — the row is the route, not the button', r.parkSurvivesPlus, r);
    t.ok('erasing everything takes the parked food read with it', r.resetClearsFood, r);
    t.ok('and the parked activity read', r.resetClearsAct, r);
    /* This block ERASES the athlete, so it puts them back before it ends. */
    await seedAthlete(page);
  }

  /* ---------- a pointer at a paned tab must name the pane ---------------
     v312 gave Progress four panes and v314 gave Reference two. From then on,
     landing on the tab stopped being the same as landing on the content —
     v314's own fix for openMealPlan() says exactly that. Four pointers were
     left behind at tab granularity, and three of them the coach reads ALOUD:
     "Log your weight on the Progress tab" sends the athlete to Summary, which
     has no weight control on it at all. A spoken address is the one nobody can
     double-check by looking. */
  {
    const src = readFileSync('index.html', 'utf8');
    t.ok('guard: the scan really read the app', src.length > 500000, String(src.length));
    const PANES = {
      Progress: ['Summary', 'Body', 'Strength', 'Awards'],
      Reference: ['Food', 'Moves'],
      Today: ['Brief', 'Briefing', 'Warm-up', 'Workout', 'Cool-down'],
    };
    /* Only a phrase that sends the athlete somewhere counts. "Today we hold the
       line" names no destination and must never be flagged. */
    /* NO optional "the" here: with it, m.index lands on "the" rather than on
       the tab name, so the lookback below is cut short and a real pointer reads
       as no pointer at all. `sends` already accounts for the article. */
    const points = /\b(Progress|Reference|Today)\b(?=\s*(?:tab\b|▸|,|\.))/g;
    const sends = /\b(?:on|from|in|under|Open|open|to)\s+(?:the\s+)?(Progress|Reference|Today)\b/;
    const flag = str => {
      let m; points.lastIndex = 0;
      while ((m = points.exec(str))) {
        const tab = m[1];
        const before = str.slice(Math.max(0, m.index - 12), m.index + tab.length);
        if (!sends.test(before)) continue;
        const win = str.slice(m.index, m.index + 90);
        if (!PANES[tab].some(pane => win.indexOf(pane) >= 0)) return tab;
      }
      return null;
    };
    /* The detector has to be shown working in BOTH directions, or an empty
       result is a statement about the regex rather than about the app. */
    t.eq('guard: a tab-only pointer is flagged', flag('Log it on the Progress tab.'), 'Progress');
    t.eq('guard: the same pointer with its pane is not', flag('Log it on the Progress tab, under Body.'), null);
    t.eq('guard: and an ordinary use of the word is not a pointer',
      flag('Today we hold the line, and Today\'s training is behind you.'), null);

    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:\w])\/\/[^\n]*/g, '');
    const strs = [...noComments.matchAll(/'([^'\\\n]{8,400})'|"([^"\\\n]{8,400})"|`([^`\\]{8,500})`/g)]
      .map(m => (m[1] || m[2] || m[3] || ''))
      .filter(x => !/function|=>|querySelector|innerHTML|style=|class=|onclick|\$\(/.test(x));
    t.ok('guard: the scan really found athlete-facing copy to check',
      strs.length > 200, String(strs.length));
    const pointing = strs.filter(x => /\b(?:on|from|in|under|Open|open)\s+(?:the\s+)?(Progress|Reference|Today)\b/.test(x));
    t.ok('guard: and some of it really does point at a paned tab',
      pointing.length >= 4, String(pointing.length));
    const offenders = [...new Set(pointing.map(x => (flag(x) ? x.slice(0, 110) : null)).filter(Boolean))];
    t.eq('every pointer at a paned tab names the pane', offenders.length, 0, offenders);

    /* Settings has no panes but it does have sections, and "Settings ▸ Setup"
       named one that does not exist — the real route is Profile & goals. Read
       off the RENDERED tab, never grepped: the source contains the app's own
       markup for screens that are not this one.

       The test is the segment's FIRST WORD, not its whole phrase, and that is
       not laziness — the pointer says "Settings ▸ Restore puts them back" while
       the button reads "↩ Restore what this tab had". Demanding the phrase
       verbatim fails on correct code; demanding the word the athlete scans for
       is the real requirement. */
    const segRe = /Settings\s*▸\s*([A-Za-z][A-Za-z &;]{2,28}?)(?=[.<'"`,]|\n)/g;
    /* noComments, not src: this round's own comment quotes one of these
       pointers, and a scan that reads a comment is this file's oldest trap. */
    const segs = [...new Set([...noComments.matchAll(segRe)]
      .map(m => m[1].replace(/&amp;/g, '&').trim()))];
    t.ok('guard: the scan found the Settings pointers to check', segs.length >= 2, segs);
    const guideText = await page.evaluate(async () => {
      /* Both undo buttons are conditional — an always-visible Restore would be
         the note-that-always-fires defect — so the states they need are seeded
         before Settings is read, or the pointer at them reads as broken. */
      try { localStorage.setItem('coreforge.v1.crosstab', JSON.stringify(STATE)); } catch (e) {}
      try { localStorage.setItem('coreforge.v1.preimport', JSON.stringify(STATE)); } catch (e) {}
      go('guide'); await new Promise(z => setTimeout(z, 400));
      /* textContent, not innerText: .section-label is UPPERCASED in CSS, so the
         rendered text says PROFILE & GOALS and a case-sensitive search for the
         real label fails on a screen that is perfectly correct. */
      const txt = document.querySelector('#v-guide').textContent;
      try { localStorage.removeItem('coreforge.v1.crosstab'); } catch (e) {}
      try { localStorage.removeItem('coreforge.v1.preimport'); } catch (e) {}
      return txt;
    });
    t.ok('guard: the Settings tab really rendered', guideText.length > 400, String(guideText.length));
    const onSettings = seg => guideText.indexOf(seg.split(/\s+/)[0]) >= 0;
    /* GUARD, both ways: a section that is not there must be reported, or an
       empty offender list is a statement about the render rather than the app. */
    t.ok('guard: a section Settings does not have would be caught', !onSettings('Setup'), guideText.slice(0, 120));
    const missing = segs.filter(x => !onSettings(x));
    t.eq('every Settings pointer names something that is on Settings', missing.length, 0, missing);
  }

  {
    /* EVERY WAY OUT OF A GRINDER WRITES THE SAME RECORD. The stop record sat
       in hiitQuit(), and the hardware Back button calls hiitTeardown()
       directly — so the ✕ recorded the stop and Back recorded nothing, and
       grindStreak() (which stops at the first row that is not done) simply
       skipped the abandoned session and kept counting finishes. */
    /* BOTH EXITS ARE DRIVEN, NEVER CALLED. onPop() cannot be invoked by hand
       here: hiitQuit() ends with history.back(), which is ASYNC and leaves
       _backGuard set until its own pop arrives — so a hand-called onPop() a
       moment later is swallowed by that guard and tears nothing down. The
       first version of this block did exactly that and reported the fix as
       broken. page.goBack() is the athlete's real gesture and has no such
       problem; the ✕ is a real click on the button they tap. */
    const startGrind = async () => {
      await page.evaluate(async () => {
        STATE.onboarded = true;
        startGrinder(Object.keys(GRINDER_FORMATS)[0]);
        await new Promise(z => setTimeout(z, 300));
        if (typeof INTV !== 'undefined' && INTV) { INTV.i = 2; INTV.workElapsed = 120; }
      });
      await page.waitForTimeout(250);
      return page.evaluate(() => ({
        opened: !!(typeof INTV !== 'undefined' && INTV),
        steps: (typeof INTV !== 'undefined' && INTV) ? INTV.seq.length : 0,
      }));
    };
    const seedThree = () => page.evaluate(() => {
      STATE.grindLog = [];
      const fmt = Object.keys(GRINDER_FORMATS)[0];
      for (let i = 0; i < 3; i++) logGrind(fmt, true, 6, 360);
      return grindStreak();
    });
    const readLog = () => page.evaluate(() => ({ rows: grindLog().length, streak: grindStreak() }));

    /* THE BACK CASE RUNS FIRST, and its preconditions are asserted rather than
       assumed. hiitQuit() ends with history.back() and sets _backGuard, which
       the next popstate clears — so a Back gesture taken while that guard is
       still up is swallowed and tears nothing down. Driven in isolation both
       exits work; inside a long suite the ambient history is whatever earlier
       blocks left, so the guard below turns a mystery into a named failure
       instead of something that reads like a defect in the app. */
    const g = {};
    g.streakBefore = await seedThree();
    const openedB = await startGrind();
    /* EACH BLOCK BUILDS THE STATE IT ASSERTS ON, and _backGuard is ambient:
       hiitQuit()/playerQuit()/playerFeel() set it and the popstate that follows
       clears it, but an earlier block in this long suite can leave one whose
       history.back() had nothing to pop. Measured on the athlete's real route —
       open a grinder, tap the X, three times over — it is false every time, so
       a stale one here is the harness rather than the app. Recorded and
       cleared, then asserted, so the case really drives a Back press. */
    g.pre = await page.evaluate(() => {
      /* onPop() has THREE early returns in front of the HIIT branch, and all
         three are ambient: _exiting is set by the second home Back press and
         nothing ever resets it, _backGuard is set by every quit that pops its
         own history entry, and a live OP is answered first. Each is recorded
         before it is cleared, so a future failure names which one it was
         rather than reporting a teardown that silently never ran. */
      const was = {
        exiting: (typeof _exiting !== 'undefined') ? _exiting : 'n/a',
        guard: (typeof _backGuard !== 'undefined') ? _backGuard : 'n/a',
        op: (typeof OP !== 'undefined' && OP) ? 'live' : 'none',
      };
      try { _exiting = false; } catch (e) {}
      try { _backGuard = false; } catch (e) {}
      return { was,
               exiting: (typeof _exiting !== 'undefined') ? _exiting : 'n/a',
               guard: (typeof _backGuard !== 'undefined') ? _backGuard : 'n/a',
               op: (typeof OP !== 'undefined' && OP) ? 'live' : 'none',
               state: (history.state || {}).cf };
    });
    await page.goBack();
    await page.waitForTimeout(700);
    g.viaBack = Object.assign({}, openedB, await readLog());

    await seedThree();
    const openedX = await startGrind();
    await page.click('#hiit .pl-x');
    await page.waitForTimeout(600);
    g.viaX = Object.assign({}, openedX, await readLog());

    Object.assign(g, await page.evaluate(async () => {
      const o = {};
      const fmt = Object.keys(GRINDER_FORMATS)[0];
      STATE.onboarded = true;

      /* FLOOR: a grinder the athlete FINISHED must still record done:true and
         keep the streak — a teardown that always wrote a stop would satisfy
         every assertion above and destroy every finish in the app. */
      STATE.grindLog = [];
      startGrinder(fmt);
      await new Promise(z => setTimeout(z, 300));
      o.finishOpened = !!(typeof INTV !== 'undefined' && INTV);
      if (INTV) { INTV.i = INTV.seq.length; INTV.workElapsed = 360; ivDone(); }
      await new Promise(z => setTimeout(z, 300));
      o.finRows = grindLog().length;
      o.finDone = (grindLog()[0] || {}).done;
      o.finStreak = grindStreak();
      /* and closing a finished one must not add a SECOND row */
      hiitQuit();
      await new Promise(z => setTimeout(z, 300));
      o.finThenCloseRows = grindLog().length;
      o.finThenCloseStreak = grindStreak();

      /* FLOOR: an ordinary HIIT session is not a grinder and records nothing.
         startHiit() is the entry — startSpecialFormat() reads a different
         registry, and calling it with a HIIT key opens nothing at all, so the
         zero it produces measures an empty session rather than a Tabata. */
      STATE.baseline = STATE.baseline || { date: todayISO(), level: 'Intermediate', results: {}, maxes: {} };
      STATE.grindLog = [];
      startHiit('tabata');
      await new Promise(z => setTimeout(z, 350));
      o.tabataOpened = !!(typeof INTV !== 'undefined' && INTV);
      o.tabataSteps = INTV ? INTV.seq.length : 0;
      o.tabataIsGrinder = INTV ? isGrinder(INTV.format) : null;
      if (INTV) { INTV.i = 1; INTV.workElapsed = 60; }
      /* hiitTeardown() directly, not the Back gesture: what this floor is
         about is the function that now HOLDS the record, and the route in is
         already driven above. onPop() by hand is swallowed by _backGuard. */
      hiitTeardown();
      await new Promise(z => setTimeout(z, 300));
      o.tabataRows = grindLog().length;

      /* FLOOR: with nothing open the teardown writes nothing at all. */
      STATE.grindLog = [];
      hiitTeardown();
      o.noSessionRows = grindLog().length;
      return o;
    }));

    /* GUARDS FIRST: every reading below is about a row count, and a session
       that never opened produces exactly the counts a correct app produces. */
    t.ok('guard: the grinder really opened on the X exit', g.viaX.opened && g.viaX.steps > 0, g.viaX);
    t.ok('guard: and on the Back exit', g.viaBack.opened && g.viaBack.steps > 0, g.viaBack);
    t.eq('guard: no back-guard is up when Back is pressed', g.pre.guard, false);
    t.eq('guard: the app is not already exiting', g.pre.exiting, false);
    t.eq('guard: no ops challenge answers the Back press first', g.pre.op, 'none', g.pre.was);
    t.eq('guard: and the history entry Back pops is the grinder', g.pre.state, 'hiit');
    t.eq('guard: three finished grinders really are a streak of three', g.streakBefore, 3);

    t.eq('stopping with the X writes the stop', g.viaX.rows, 4);
    t.eq('and it breaks the streak', g.viaX.streak, 0);
    t.eq('stopping with the Back button writes it too', g.viaBack.rows, 4);
    t.eq('and it breaks the streak the same way', g.viaBack.streak, 0);

    t.ok('guard: the finished grinder really opened', g.finishOpened, g);
    t.eq('FLOOR: a finished grinder is recorded as finished', g.finDone, true);
    t.eq('FLOOR: and it keeps the streak', g.finStreak, 1);
    t.eq('FLOOR: closing a finished grinder adds no second row', g.finThenCloseRows, 1);
    t.eq('FLOOR: so the finish still stands', g.finThenCloseStreak, 1);

    t.ok('guard: the Tabata really opened', g.tabataOpened && g.tabataSteps > 0, g);
    t.eq('guard: and it really is not a grinder', g.tabataIsGrinder, false);
    t.eq('FLOOR: an ordinary HIIT session records no grinder row', g.tabataRows, 0);
    t.eq('FLOOR: and a teardown with nothing open records nothing', g.noSessionRows, 0);

    /* The record must live in the ONE function every exit reaches. A source
       assertion, because a future exit path that skips it cannot be driven
       from here — it does not exist yet, and that is the whole point. */
    const appSrc = readFileSync('index.html', 'utf8');
    t.ok('guard: the scan really read the app', appSrc.length > 500000, String(appSrc.length));
    const tdBody = appSrc.slice(appSrc.indexOf('function hiitTeardown('));
    const tdEnd = tdBody.indexOf('function hiitQuit(');
    t.ok('guard: the teardown body was located', tdEnd > 40, String(tdEnd));
    t.ok('the stop record lives in hiitTeardown()',
      tdBody.slice(0, tdEnd).indexOf('logGrind(') >= 0);
    t.eq('and there is exactly one copy of it in the file',
      (appSrc.match(/logGrind\(INTV\.format,\s*false,/g) || []).length, 1);
  }

  /* A FAILED SHARE IS NOT A CANCEL, AND BOTH CARDS HAD THE SAME SWALLOW.
     shareCard() and shareMilestone() each ended with
     `navigator.share(...).catch(()=>{})`, so a share that genuinely failed
     produced no toast, no file and no sheet: the button was dead and the card
     the app had just drawn was discarded. The athlete whose browser HAS Web
     Share got less than the one whose browser does not, who still gets the
     file.

     Four outcomes and every one is pinned, because three of them must stay
     SILENT — a fix that toasted on cancel or on success satisfies every
     assertion about the failure and turns a working feature into a nag. The
     floors are the cancel and the success; the payload is the file. */
  {
    const shareOut = await page.evaluate(async () => {
      const out = {};
      const el = () => document.querySelector('#toast');
      const rec = () => { const t = el(); return t ? (t.textContent || '').trim() : '(no toast)'; };
      let downloads = 0, lastName = '';
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.hasAttribute('download')) { downloads++; lastName = this.download || ''; }
        else realClick.call(this);
      };
      /* WAIT FOR THE ENCODE, NEVER FOR A DURATION. canvas.toBlob is
         asynchronous and its cost is the machine's, so a fixed sleep is a race:
         on a slower CI runner one case's download landed inside the NEXT case
         (measured: downloads 2 where 1 was expected) and the last case's never
         landed at all (0 where 1 was expected). Every card in this block is
         drawn by toBlob, so awaiting the encode makes the settle deterministic
         and the short tail below only has to cover the share promise's own
         microtask chain. */
      let pending = [];
      const realToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) {
        let done; pending.push(new Promise(r => { done = r; }));
        return realToBlob.call(this, b => { try { cb(b); } finally { done(); } }, ...rest);
      };
      const run = async fn => {
        const t = el(); if (t) t.textContent = '';
        downloads = 0; lastName = ''; pending = [];
        try { fn(); } catch (e) { return { toast: 'THREW: ' + e, downloads: 0, name: '' }; }
        for (let i = 0; i < 20 && pending.length; i++) {
          const p = pending; pending = []; await Promise.all(p);
        }
        await new Promise(r => setTimeout(r, 200));
        return { toast: rec(), downloads, name: lastName };
      };
      const reject = name => () => Promise.reject(Object.assign(new Error('x'), { name }));

      navigator.canShare = () => true;

      navigator.share = reject('AbortError');
      out.cancelled = await run(() => shareCard('T', 's', ['a']));
      out.cancelledMile = await run(() => shareMilestone({ id: 'first', name: 'Badge', emoji: '🏆' }));

      navigator.share = reject('NotAllowedError');
      out.failed = await run(() => shareCard('T', 's', ['a']));
      out.failedMile = await run(() => shareMilestone({ id: 'first', name: 'Badge', emoji: '🏆' }));

      navigator.share = () => Promise.resolve();
      out.shared = await run(() => shareCard('T', 's', ['a']));

      navigator.canShare = undefined;
      out.noShareApi = await run(() => shareCard('T', 's', ['a']));

      out.helperExists = typeof _shareBlob === 'function';
      const noBlob = await run(() => _shareBlob(null, 'x.png', 'T'));
      out.noBlob = noBlob;
      HTMLCanvasElement.prototype.toBlob = realToBlob;
      HTMLAnchorElement.prototype.click = realClick;
      return out;
    });

    t.ok('guard: the shared tail really is one helper', shareOut.helperExists, shareOut);

    t.eq('a share the athlete CANCELS says nothing', shareOut.cancelled.toast, '');
    t.eq('and writes no file — a cancel is a choice, not a failure', shareOut.cancelled.downloads, 0);
    t.eq('the milestone card cancels the same way', shareOut.cancelledMile.toast, '');
    t.eq('and writes no file either', shareOut.cancelledMile.downloads, 0);

    t.eq('a share that SUCCEEDS says nothing — the OS sheet is the feedback', shareOut.shared.toast, '');
    t.eq('and writes no file, because the share took it', shareOut.shared.downloads, 0);

    t.eq('a share that FAILS falls back to the download', shareOut.failed.downloads, 1, shareOut.failed);
    t.ok('and says so rather than leaving a dead button', /Card saved/.test(shareOut.failed.toast), shareOut.failed);
    t.eq('the milestone card falls back too', shareOut.failedMile.downloads, 1, shareOut.failedMile);
    t.ok('and names the badge it drew', /coreforge-first\.png/.test(shareOut.failedMile.name), shareOut.failedMile);

    t.eq('FLOOR: a browser with no Web Share still gets the file', shareOut.noShareApi.downloads, 1);
    t.ok('FLOOR: and is still told', /Card saved/.test(shareOut.noShareApi.toast), shareOut.noShareApi);

    t.eq('FLOOR: a card that could not be drawn writes nothing', shareOut.noBlob.downloads, 0);
    t.ok('FLOOR: and says that, not "saved"', /Could not make card/.test(shareOut.noBlob.toast), shareOut.noBlob);
  }

  /* ---------- 20. the app can be HEARD, not only operated ----------------
     Section 19 gave every control a name. This is the other half: what the app
     SAYS BACK. Measured before the fix, there were ZERO live regions in the
     whole file, and #sheet had no role and never took focus — so a screen
     reader announced no confirmation, no refusal and no validation hint, and
     every one of the fifty sheets opened behind the athlete's focus with seven
     controls they could not reach.

     Three floors carry it, and each catches a different over-eager fix:
     the toast must stay HIDDEN by opacity (display:none or visibility:hidden
     puts it out of the accessibility tree and every announcement goes silent
     again with nothing on screen to say so); there must be NO aria-modal on
     the sheet (it would hide #toast, which is the channel every refusal spoken
     FROM a sheet uses); and a sheet that focuses its own input must still win. */
  {
    const a11y = await page.evaluate(async () => {
      const out = {};
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const t = document.getElementById('toast');
      const sh = document.getElementById('sheet');

      out.toast = {
        role: t.getAttribute('role'),
        live: t.getAttribute('aria-live'),
        atomic: t.getAttribute('aria-atomic'),
      };
      out.liveRegions = document.querySelectorAll('[aria-live],[role="status"],[role="alert"]').length;

      /* Hidden how? A live region inside display:none or visibility:hidden is
         announced by nothing. Read it while the toast is NOT showing.
         AND WAIT FOR THE TRANSITION. `.toast` carries `transition:.28s`, so a
         computed style read on the same tick reports the value being animated
         FROM — measured, opacity 1 — which is a statement about the animation
         rather than about the hiding rule. */
      /* AND A LATE TOAST MUST NOT WIN THE READ. A single remove-then-sleep
         failed on a loaded CI runner reporting opacity 1 — anything in the app
         that toasts on a timer re-adds .show inside the wait, and the check then
         reports the animation of a toast that is legitimately showing. Removing
         it on every poll and waiting for the settle is what makes this a
         statement about the hiding RULE rather than about what else was on
         screen. The display and visibility assertions read the same snapshot,
         so a mutant that hides the toast either of those ways is still caught. */
      let cs = null;
      for (let i = 0; i < 40; i++) {
        t.classList.remove('show');
        await wait(60);
        cs = getComputedStyle(t);
        if (cs.opacity === '0') break;
      }
      out.hidden = { display: cs.display, visibility: cs.visibility, opacity: cs.opacity };

      /* The same message twice: assigning textContent replaces the text node,
         so it is a real mutation and the region fires again. Measured rather
         than assumed — if it were not true, every repeated "Deleted" would be
         announced once and the fix would need a clear-and-reset dance. */
      toast('Deleted');
      const node1 = t.firstChild;
      toast('Deleted');
      out.repeatMakesNewNode = t.firstChild !== node1;
      out.repeatText = (t.textContent || '').trim();

      out.sheet = { role: sh.getAttribute('role'), modal: sh.getAttribute('aria-modal'),
                    tabindex: sh.getAttribute('tabindex') };

      /* Driven: a real control takes focus, a sheet opens, focus must be in it. */
      const btn = document.createElement('button');
      btn.id = 'zzOpener'; btn.textContent = 'open';
      document.body.appendChild(btn); btn.focus();
      out.focusBefore = document.activeElement.id;
      openSheet('<h3>A panel</h3><button id="zzInside">do it</button>');
      await wait(120);
      const af = document.activeElement;
      out.focusInSheet = af === sh || sh.contains(af);
      out.focusAfterOpen = af.id || af.tagName;
      out.reachable = sh.querySelectorAll('button').length;
      closeSheet();
      await wait(350);
      out.focusRestored = document.activeElement.id;

      /* A REPAINT MUST NOT MOVE THE RETURN TARGET. openAct, openBuilder and
         openSkipping all re-enter openSheet() on an already-open sheet; if the
         return slot were rewritten there it would point at a control inside
         the sheet, which is destroyed a line later. */
      btn.focus();
      openSheet('<button id="zzA">a</button>');
      await wait(80);
      openSheet('<button id="zzB">b</button>');   // a repaint, not a new sheet
      await wait(80);
      closeSheet();
      await wait(350);
      out.focusAfterRepaint = document.activeElement.id;

      /* And the download guard, exercised DIRECTLY: nothing on a real device
         makes createObjectURL throw, so the only way to prove the card path
         reports a failure rather than becoming an uncaught page error — the
         toBlob callback runs after its caller's try/catch has returned — is to
         break it here. */
      /* WAIT FOR THE ENCODE, NEVER FOR A DURATION — the v414 lesson, on the
         one card case that was left on a fixed sleep. The toast is set INSIDE
         the toBlob callback, and toBlob's cost is the machine's: on a slower
         CI runner 500 ms was not enough and the check read an EMPTY toast on
         correct code (measured on main, dlBrokenToast:""). Awaiting the encode
         makes it deterministic; the short tail only covers the microtask chain
         after the callback. */
      const realCOU = URL.createObjectURL;
      URL.createObjectURL = () => { throw new Error('no room'); };
      const tEl = document.getElementById('toast'); tEl.textContent = '';
      navigator.canShare = undefined;
      let dlPending = [], dlEncodes = 0;
      const realTB2 = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) {
        let done; dlPending.push(new Promise(r => { done = r; }));
        return realTB2.call(this, b => { dlEncodes++; try { cb(b); } finally { done(); } }, ...rest);
      };
      try { shareCard('T', 's', ['a']); } catch (e) { out.dlThrewSync = String(e); }
      for (let i = 0; i < 20 && dlPending.length; i++) {
        const q = dlPending; dlPending = []; await Promise.all(q);
        await wait(0);
      }
      await wait(60);
      HTMLCanvasElement.prototype.toBlob = realTB2;
      out.dlBrokenToast = (tEl.textContent || '').trim();
      /* GUARD: the encode really did run, or "the toast is empty" would be a
         statement about a card that was never drawn rather than about the
         guard this case exists for. */
      out.dlEncodes = dlEncodes;
      URL.createObjectURL = realCOU;

      /* And a detached opener must not throw or strand the athlete. */
      btn.focus();
      openSheet('<button id="zzInside2">x</button>');
      await wait(120);
      btn.remove();
      let threw = '';
      try { closeSheet(); } catch (e) { threw = String(e); }
      await wait(350);
      out.detachedThrew = threw;

      /* GUARD, both ways: strip the attributes and the detector must report it. */
      t.removeAttribute('aria-live'); t.removeAttribute('role');
      out.canSeeMissing = document.querySelectorAll('[aria-live],[role="status"],[role="alert"]').length === 0;
      t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');

      /* FLOOR: a sheet that focuses its own control still wins, because this
         focus call runs synchronously inside openSheet() and theirs is on a
         timer after it. */
      try { openFoodSearch(); } catch (e) { out.fsErr = String(e); }
      await wait(300);
      out.foodSearchFocus = document.activeElement.id;
      closeSheet();
      await wait(300);
      return out;
    });

    t.ok('guard: an app with no live region really would be reported', a11y.canSeeMissing, a11y);

    t.eq('the toast is a status region', a11y.toast.role, 'status');
    t.eq('and it is polite — a confirmation waits for a pause, it does not interrupt', a11y.toast.live, 'polite');
    t.eq('and it reads the whole message, not the part that changed', a11y.toast.atomic, 'true');
    t.ok('so the app has a channel a screen reader announces', a11y.liveRegions >= 1, a11y);

    t.eq('FLOOR: the toast hides with opacity, so it stays in the accessibility tree',
      a11y.hidden.opacity, '0', a11y.hidden);
    t.ok('FLOOR: and is never display:none or visibility:hidden, which would silence every announcement',
      a11y.hidden.display !== 'none' && a11y.hidden.visibility !== 'hidden', a11y.hidden);

    t.ok('the same message twice is a real mutation, so a repeat is announced again',
      a11y.repeatMakesNewNode, a11y);
    t.eq('and the message is still on the glass', a11y.repeatText, 'Deleted');

    t.eq('a sheet is a dialog', a11y.sheet.role, 'dialog');
    t.eq('and can take focus itself', a11y.sheet.tabindex, '-1');
    t.eq('FLOOR: and is NOT aria-modal, which would hide the toast it speaks through',
      a11y.sheet.modal, null, a11y.sheet);

    t.eq('guard: a real control had the focus first', a11y.focusBefore, 'zzOpener');
    t.ok('guard: and the sheet really had something to reach', a11y.reachable >= 1, a11y);
    t.ok('opening a sheet moves the focus into it', a11y.focusInSheet, a11y);
    /* The CONTAINER, not the first control: focusing an input opens a keyboard
       and skips the panel's own title, and a dialog read from its container
       reads that title first. */
    t.eq('and onto the panel itself, so its title is read before any control',
      a11y.focusAfterOpen, 'sheet', a11y);
    t.eq('closing it gives the focus back to what opened it', a11y.focusRestored, 'zzOpener');
    t.eq('and an opener that has since been removed neither throws nor strands', a11y.detachedThrew, '');
    t.eq('a REPAINT of an open sheet still returns focus to what opened it',
      a11y.focusAfterRepaint, 'zzOpener', a11y);

    t.eq('guard: a card whose download throws does not throw synchronously', a11y.dlThrewSync, undefined, a11y);
    t.ok('guard: the card really was drawn, so an empty toast would be the app',
      a11y.dlEncodes >= 1, a11y);
    t.ok('a card that could not be written says so rather than dying silently',
      /Could not save the card/.test(a11y.dlBrokenToast), a11y);

    t.eq('FLOOR: a sheet that focuses its own box still wins', a11y.foodSearchFocus, 'fs-q', a11y);
  }

  /* ---------- 21. an answer the browser already had, 43 seconds late ------
     Measured on a genuinely offline context: _visionEstimate() ran the full
     three-model retry ladder for 43.2 SECONDS before the athlete was told
     anything, while navigator.onLine had been false throughout. Its sibling
     the neural-voice path checks it, and runAIDiagnostic() opens with a short
     reachability ping for exactly this reason.

     COUNT THE CALLS, NOT THE CLOCK. A time-based assertion is flaky on a slow
     runner and measures the container; what the fix actually does is stop the
     request ladder from starting at all. The floor is the mirror: an ONLINE
     athlete must still reach the network, because navigator.onLine is only
     trustworthy in the negative — a captive portal reports true, and a check
     that trusted it would refuse an import that would have worked. */
  {
    const off = await page.evaluate(async () => {
      const out = {};
      const PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/9oACAEBAAA/AKrAf//Z';
      STATE.settings.foodAiKey = 'AIzaTESTKEYTESTKEYTESTKEYTESTKEY0000';

      /* Stub the ONE helper every model attempt goes through, so the ladder
         costs nothing and the count is exact. */
      const realFetch = fetchWithTimeout;
      let calls = 0;
      fetchWithTimeout = async () => { calls++; const e = new Error('stub'); e.status = 0; throw e; };
      const realOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
      const setOnLine = v => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v });

      const run = async () => {
        calls = 0;
        const t0 = Date.now();
        let err = null;
        try { await _visionEstimate(PX, 'test', {}); } catch (e) { err = String(e && (e.message || e)); }
        return { calls, ms: Date.now() - t0, err };
      };

      setOnLine(false);
      out.offline = await run();
      setOnLine(true);
      out.online = await run();

      try { delete navigator.onLine; } catch (e) {}
      if (realOnLine) try { Object.defineProperty(Navigator.prototype, 'onLine', realOnLine); } catch (e) {}
      fetchWithTimeout = realFetch;
      out.restored = navigator.onLine;

      /* And the guard the fix is one-sided for: the app must never READ
         navigator.onLine as proof that the network works. */
      out.src = (() => {
        const sc = [...document.querySelectorAll('script:not([src])')]
          .map(x => x.textContent).sort((a, b) => b.length - a.length)[0] || '';
        const bare = sc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        return {
          len: bare.length,
          reads: (bare.match(/navigator\.onLine/g) || []).length,
          strictFalse: (bare.match(/navigator\.onLine\s*===\s*false/g) || []).length,
          notFalse: (bare.match(/navigator\.onLine\s*!==\s*false/g) || []).length,
        };
      })();
      return out;
    });

    t.ok('guard: the offline probe returned a reading at all', off && off.offline, JSON.stringify(off));
    t.ok('guard: the online run really reached the network', off.online.calls > 0, off.online);
    t.eq('an offline import spends no request at all', off.offline.calls, 0, off.offline);
    t.ok('and says so rather than timing out', /offline/i.test(off.offline.err || ''), off.offline);
    t.ok('and it answers at once', off.offline.ms < 2000, off.offline);

    t.ok('FLOOR: an online athlete still runs the real ladder',
      off.online.calls >= 2, off.online);
    t.ok('FLOOR: and still gets the network message, not the offline one',
      !/offline/i.test(off.online.err || ''), off.online);

    t.ok('guard: the scan read the real app', off.src.len > 400000, String(off.src.len));
    t.ok('every navigator.onLine read is one-sided — false is trustworthy, true is not',
      off.src.reads > 0 && off.src.reads === off.src.strictFalse + off.src.notFalse, off.src);
  }

  /* 22. ONE PARSER FOR EVERY STORED STATE (v414).
     importData() has stripped __proto__ with a reviver for many versions, and its
     own comment named the danger. Three siblings that feed the SAME Object.assign
     never got it. Every assertion here is on the PAYLOAD — the prototype of the
     object the app is actually using, and the verdict of the safety gate — never
     on whether the helper was called. */
  {
    const probe = await page.evaluate(async () => {
      const out = {};
      /* GUARDS FIRST. Without these the whole block passes on nothing: if a
         JSON __proto__ key were not an OWN property, or if Object.assign did not
         reassign the target's prototype, there would be no defect to fix and
         every assertion below would be satisfied by an app that did nothing. */
      const poison = JSON.parse('{"__proto__":{"pwn":"YES"}}');
      out.guardOwnKey = Object.prototype.hasOwnProperty.call(poison, '__proto__');
      out.guardAssignBites =
        Object.getPrototypeOf(Object.assign({}, poison)) !== Object.prototype;

      const K = STORE_KEY;
      const POISONED = '{"version":1,"onboarded":true,"_savedAt":9999999999999,'
        + '"profile":{"parq":["heart"],"__proto__":{"parqDone":true,"medCleared":true}},'
        + '"settings":{"__proto__":{"pwnS":"YES"}},'
        + '"nutrition":{"__proto__":{"pwnN":"YES"}}}';

      // (a) the loader — four Object.assigns from the parsed object
      localStorage.setItem(K, POISONED);
      try { await idbPut(K, POISONED); } catch (e) {}
      await load(); normalizeState();
      out.load = {
        heartStillDeclared: JSON.stringify(STATE.profile.parq),
        stateProto: Object.getPrototypeOf(STATE) === Object.prototype,
        settingsProto: Object.getPrototypeOf(STATE.settings) === Object.prototype,
        profileProto: Object.getPrototypeOf(STATE.profile) === Object.prototype,
        nutProto: Object.getPrototypeOf(STATE.nutrition) === Object.prototype,
        medCleared: medCleared(),
        safeMode: safeMode()
      };

      window.confirm = () => true;

      // (b) the pre-import restore
      localStorage.setItem(PREIMPORT_KEY, POISONED);
      undoImport();
      out.undoImport = {
        proto: Object.getPrototypeOf(STATE) === Object.prototype,
        safeMode: safeMode()
      };

      // (c) the cross-tab restore
      localStorage.setItem(CROSSTAB_KEY, POISONED);
      undoCrossTab();
      out.undoCrossTab = {
        proto: Object.getPrototypeOf(STATE) === Object.prototype,
        safeMode: safeMode()
      };

      /* FLOOR: an ordinary state is untouched. A reviver that dropped too much
         satisfies every assertion above and empties the athlete's own data. */
      const clean = { version: 1, onboarded: true, _savedAt: 9999999999999,
        profile: { name: 'Sam', age: 41 }, settings: { theme: 'ember' },
        nutrition: { goal: 'lose' } };
      localStorage.setItem(K, JSON.stringify(clean));
      try { await idbPut(K, JSON.stringify(clean)); } catch (e) {}
      await load();
      out.floor = { name: STATE.profile.name, age: STATE.profile.age,
        theme: STATE.settings.theme, goal: STATE.nutrition.goal,
        onboarded: STATE.onboarded };

      /* THE RULE LIVES IN ONE PLACE, and each stored-state reader ASKS for it.
         A check that only counted the declaration passes while a consumer keeps
         its own bare JSON.parse — which is the drift that produced this round. */
      const sc = [...document.querySelectorAll('script:not([src])')]
        .map(x => x.textContent).sort((a, b) => b.length - a.length)[0] || '';
      const bare = sc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      out.src = {
        len: bare.length,
        ruleWrittenTimes: (bare.match(/k\s*===\s*'__proto__'/g) || []).length,
        loader: bare.indexOf('_jsonSafe(t)') >= 0,
        listener: bare.indexOf('_jsonSafe(e.newValue)') >= 0,
        restores: (bare.match(/_jsonSafe\(raw\)/g) || []).length,
        importer: bare.indexOf('_jsonSafe(r.result)') >= 0
      };
      return out;
    });

    t.ok('guard: a JSON __proto__ key really is an own property', probe.guardOwnKey, probe);
    t.ok('guard: and Object.assign really does reassign the target prototype',
      probe.guardAssignBites, probe);

    t.ok('a poisoned stored state no longer reaches STATE’s prototype',
      probe.load.stateProto, probe.load);
    t.ok('nor settings’, which every device credential lives on',
      probe.load.settingsProto, probe.load);
    t.ok('nor profile’s, which the health screen reads',
      probe.load.profileProto, probe.load);
    t.ok('nor nutrition’s', probe.load.nutProto, probe.load);
    t.eq('guard: the athlete really did declare a heart condition',
      probe.load.heartStillDeclared, '["heart"]', probe.load);
    t.ok('so a declared heart condition is not silently cleared',
      probe.load.medCleared === false, probe.load);
    t.ok('and safe mode stays ON, which is what the health screen promises',
      probe.load.safeMode === true, probe.load);

    t.ok('the pre-import restore is guarded too', probe.undoImport.proto, probe.undoImport);
    t.ok('and it keeps safe mode on', probe.undoImport.safeMode === true, probe.undoImport);
    t.ok('and so is the cross-tab restore', probe.undoCrossTab.proto, probe.undoCrossTab);
    t.ok('and it keeps safe mode on too', probe.undoCrossTab.safeMode === true, probe.undoCrossTab);

    t.eq('FLOOR: an ordinary name survives the parse', probe.floor.name, 'Sam', probe.floor);
    t.eq('FLOOR: and an ordinary age', probe.floor.age, 41, probe.floor);
    t.eq('FLOOR: and a stored theme', probe.floor.theme, 'ember', probe.floor);
    t.eq('FLOOR: and a stored goal', probe.floor.goal, 'lose', probe.floor);
    t.ok('FLOOR: and the athlete is still onboarded', probe.floor.onboarded === true, probe.floor);

    t.ok('guard: the scan read the real app', probe.src.len > 400000, String(probe.src.len));
    t.eq('the reviver rule is written exactly once', probe.src.ruleWrittenTimes, 1, probe.src);
    t.ok('the loader asks for it', probe.src.loader, probe.src);
    t.ok('the cross-tab listener asks for it', probe.src.listener, probe.src);
    t.eq('and both one-step-back restores ask for it', probe.src.restores, 2, probe.src);
    t.ok('and so does the importer, so there is one copy of the rule',
      probe.src.importer, probe.src);
  }

  /* 23. THE MIRROR IS CLAIMED ONLY ONCE IT HAS TAKEN THE WRITE (v414).
     idbPut() reports whether the write landed. The photo writer and the backup
     restore both read that answer; save() — the caller that persists the whole
     training history — threw it away and chose its wording from whether the
     store had merely OPENED. Every assertion here is on the SENTENCE the
     athlete is shown, because the sentence is the whole of the defect. */
  {
    const st = await page.evaluate(async () => {
      const r = {}, seen = [];
      const realToast = window.toast;
      window.toast = m => seen.push(String(m));
      const realSet = localStorage.setItem.bind(localStorage);
      const realTx = idb && idb.transaction.bind(idb);
      /* GUARD: the store really is open on this page. With idb null every case
         below takes the no-store branch and the block proves nothing. */
      r.guardIdbOpen = !!idb;

      /* WAIT FOR THE WRITE, NEVER FOR A DURATION — and drain what an earlier
         block left in flight.

         save() debounces its idbPut() by 120ms and picks the wording inside
         the promise callback, reading _lsOk and _lsWarned at RESOLVE time. So
         a save() from an EARLIER block whose debounce has already fired, and
         whose write is still in flight, resolves inside the window this block
         is measuring: it sees the broken localStorage we just installed, has
         ok:true because its own write went to a healthy store, prints the
         HEALTHY sentence into `seen`, and sets _lsWarned so our own callback
         returns early. Measured by sweeping the offset in 1ms steps, that is a
         2ms window per run at 120-121ms — which is what failed twice and then
         passed on a re-run, and a racing check gets fixed rather than re-run.

         So idbPut is wrapped to count completions, every case waits for ITS
         OWN write, and one settle runs first, with the store healthy, so a
         stale callback cannot toast at all. */
      let started = 0, lastPut = Promise.resolve();
      const realPut = idbPut;
      idbPut = (k, v) => { started++; lastPut = realPut(k, v); return lastPut; };
      /* Waiting for ANY write is not enough — the stale one increments the
         counter too, so a counter-only wait returns on somebody else's write
         and leaves our own in flight. save() shares ONE debounce timer and
         clears it, so any stale put has already STARTED before our save() call:
         the first put to start AFTER it is unambiguously ours. Chaining that
         through every case means nothing is ever in flight when the next case
         swaps the stubs. */
      const settle = async () => {
        const b = started; save();
        for (let i = 0; i < 400 && started === b; i++) await new Promise(z => setTimeout(z, 10));
        try { await lastPut; } catch (e) {}
        await new Promise(z => setTimeout(z, 40));   // let save()'s own .then run after ours
      };
      await settle();   // and drain what an earlier block left, with the store healthy

      const run = async () => {
        _lsWarned = false; _lsOk = true; seen.length = 0;
        await settle();
        return seen.slice();
      };
      const breakLs = () => { localStorage.setItem = () => { throw new Error('Quota'); }; };
      const breakIdb = () => { idb.transaction = () => { throw new Error('Quota'); }; };

      breakLs(); breakIdb();  r.bothFail = await run();
      idb.transaction = realTx; r.mirrorTakesIt = await run();
      localStorage.setItem = realSet; r.floorOrdinary = await run();
      breakIdb(); r.floorMirrorOnly = await run();
      idb.transaction = realTx;

      breakLs(); breakIdb();
      _lsWarned = false; _lsOk = true; seen.length = 0;
      await settle();
      await settle();
      r.warnCount = seen.length;

      localStorage.setItem = realSet; idb.transaction = realTx;
      idbPut = realPut;
      window.toast = realToast;
      return r;
    });

    t.ok('guard: the backup store really is open on this page', st.guardIdbOpen, st);

    t.eq('guard: a save that lands nowhere says exactly one thing',
      st.bothFail.length, 1, st.bothFail);
    t.ok('a save that lands NOWHERE says so, rather than claiming the backup store',
      /nothing is being saved/i.test(st.bothFail[0] || ''), st.bothFail);
    t.ok('and it names the real cause — the store refused it, not that there is none',
      /refused/i.test(st.bothFail[0] || ''), st.bothFail);

    t.eq('guard: a save the mirror DID take also says exactly one thing',
      st.mirrorTakesIt.length, 1, st.mirrorTakesIt);
    t.ok('FLOOR: and it still claims the backup store, because the write landed',
      /backing up to device store/i.test(st.mirrorTakesIt[0] || ''), st.mirrorTakesIt);
    t.ok('FLOOR: and does NOT say nothing is being saved',
      !/nothing is being saved/i.test(st.mirrorTakesIt[0] || ''), st.mirrorTakesIt);

    t.eq('FLOOR: an ordinary save warns about nothing at all',
      st.floorOrdinary.length, 0, st.floorOrdinary);
    t.eq('FLOOR: and a mirror that fails behind a good localStorage is silent — nothing was lost',
      st.floorMirrorOnly.length, 0, st.floorMirrorOnly);

    t.eq('it warns once a session, not on every save', st.warnCount, 1, st);
  }

  /* 24. A ROW IS REBUILT FROM A FIELD LIST, NOT SPREAD (v415).

     `.map(x=>({...x, mins:+x.mins||0}))` fixed the one field it named and
     carried every other one through untouched. actHistoryHTML() and
     skipHistoryHTML() print `dist`, `unit`, `wt`, `secs` and `rounds`
     straight into innerHTML, and the session log's `completedAt`/`date` go
     the same way through sessionHistoryHTML() and openSessionDetail().

     Measured from an imported backup, before the fix: the junk survived the
     boot, rendered as a real <img> element on all three surfaces, and RAN.
     holdLog and grindLog already rebuild from a field list — one of a pair
     guarded and its twin not.

     The detector is proven first: without a planted case that really does
     inject, "no injection" is a statement about the selector. */
  {
    const inj = await page.evaluate(async () => {
      const o = {}; const T = todayISO();
      const host = document.createElement('div'); document.body.appendChild(host);
      const PAY = '<img src=x onerror="window.__v415=(window.__v415||0)+1">';
      const mount = h => { host.innerHTML = h; };

      // The detector really can see one. It carries its OWN payload: an
      // img's onerror fires a tick later, so the shared counter would be
      // incremented by the planted element after it was zeroed and the
      // "nothing ran" assertion would fail on correct code.
      mount('<img src=x onerror="window.__v415det=1">');
      o.detector = !!host.querySelector('img[onerror]');
      mount('');
      await new Promise(r => setTimeout(r, 100));
      o.detectorRan = !!window.__v415det;

      window.__v415 = 0;
      STATE.ruckLog = [{ date: T, mins: 30, dist: PAY, wt: PAY, unit: PAY }];
      STATE.gripLog = [{ date: T, mins: 1, secs: PAY }];
      STATE.skipLog = [{ date: T, mins: 10, rounds: PAY }];
      STATE.logs = { 3: { done: true, ex: {}, completedAt: PAY, date: PAY, items: [] } };
      normalizeState();

      o.ruckClean = !/onerror/.test(JSON.stringify(STATE.ruckLog[0] || {}));
      o.gripClean = !/onerror/.test(JSON.stringify(STATE.gripLog[0] || {}));
      o.skipClean = !/onerror/.test(JSON.stringify(STATE.skipLog[0] || {}));
      o.logClean  = !/onerror/.test(JSON.stringify(STATE.logs[3] || {}));

      mount(actHistoryHTML('ruck')); o.actInj  = !!host.querySelector('img[onerror]');
      mount(actHistoryHTML('grip')); o.gripInj = !!host.querySelector('img[onerror]');
      mount(skipHistoryHTML());      o.skipInj = !!host.querySelector('img[onerror]');
      mount(sessionHistoryHTML());   o.histInj = !!host.querySelector('img[onerror]');

      await new Promise(r => setTimeout(r, 150));
      o.ran = window.__v415;

      // ---- FLOORS: everything the athlete really logged survives and prints
      const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
      STATE.ruckLog = [{ date: T, mins: 45, dist: 5.5, wt: 20, unit: 'km', at: 1700000000000 }];
      STATE.gripLog = [{ date: T, mins: 1, secs: 62 }];
      STATE.boxLog  = [{ date: T, mins: 12, rounds: 8 }];
      STATE.skipLog = [{ date: T, mins: 10, rounds: 6 }];
      STATE.logs = { 3: { done: true, ex: {}, completedAt: ago(2), date: ago(2), items: [] } };
      normalizeState();
      const rk = STATE.ruckLog[0] || {}, gp = STATE.gripLog[0] || {},
            bx = STATE.boxLog[0] || {}, sk = STATE.skipLog[0] || {};
      o.keptDist = rk.dist; o.keptWt = rk.wt; o.keptUnit = rk.unit;
      o.keptAt = rk.at; o.keptMins = rk.mins;
      o.keptSecs = gp.secs; o.keptRoundsBox = bx.rounds; o.keptRoundsSkip = sk.rounds;
      o.keptLogDate = (STATE.logs[3] || {}).completedAt;
      o.showsDist  = /5\.5 km/.test(actHistoryHTML('ruck'));
      /* v446 gave the load its unit: the subject here is that the athlete's
         real figure SURVIVES the repair and prints, and pinning the unit
         beside it is strictly stronger than pinning the bare number. */
      o.showsWt    = /20 kg load/.test(actHistoryHTML('ruck'));
      o.showsSecs  = /best 62s/.test(actHistoryHTML('grip'));
      o.showsRounds= /6 rounds/.test(skipHistoryHTML());
      o.showsDate  = sessionHistoryHTML().indexOf(ago(2)) > -1;
      host.remove();
      return o;
    });

    t.ok('guard: the injection detector really can see a planted element', inj.detector, inj);
    t.ok('guard: and a planted payload really does RUN, so "nothing ran" means something',
      inj.detectorRan, inj);

    t.ok('a junk dist/wt/unit is gone from a ruck row after the boot', inj.ruckClean, inj);
    t.ok('a junk secs is gone from a grip row', inj.gripClean, inj);
    t.ok('a junk rounds is gone from a skipping row', inj.skipClean, inj);
    t.ok('a junk completedAt is gone from a session log', inj.logClean, inj);

    t.ok('and nothing is injected into the ruck history', !inj.actInj, inj);
    t.ok('nor the grip history', !inj.gripInj, inj);
    t.ok('nor the skipping history', !inj.skipInj, inj);
    t.ok('nor the workout history', !inj.histInj, inj);
    t.eq('and nothing ran', inj.ran, 0, inj);

    t.eq('FLOOR: a real ruck keeps its distance', inj.keptDist, 5.5, inj);
    t.eq('FLOOR: and its load', inj.keptWt, 20, inj);
    t.eq('FLOOR: and the unit tag that records what was typed', inj.keptUnit, 'km', inj);
    t.eq('FLOOR: and the timestamp', inj.keptAt, 1700000000000, inj);
    t.eq('FLOOR: and the minutes', inj.keptMins, 45, inj);
    t.eq('FLOOR: a real hang keeps its seconds', inj.keptSecs, 62, inj);
    t.eq('FLOOR: a real box session keeps its rounds', inj.keptRoundsBox, 8, inj);
    t.eq('FLOOR: a real skipping session keeps its rounds', inj.keptRoundsSkip, 6, inj);
    t.ok('FLOOR: a real session log keeps its date', /^\d{4}-\d{2}-\d{2}$/.test(inj.keptLogDate || ''), inj);

    t.ok('FLOOR: and the distance still prints', inj.showsDist, inj);
    t.ok('FLOOR: and the load still prints', inj.showsWt, inj);
    t.ok('FLOOR: and the hang still prints', inj.showsSecs, inj);
    t.ok('FLOOR: and the rounds still print', inj.showsRounds, inj);
    t.ok('FLOOR: and the workout history still prints the date', inj.showsDate, inj);

    /* TWO GUARDS MEAN TWO CHECKS, and the block above could not see the second
       one. It calls normalizeState() before rendering, so the boot repair has
       already scrubbed the junk and the ESCAPING is invisible — a mutant that
       drops _ve() from either render walked straight through it. The escape is
       the shape this file records again and again: a guard is only visible when
       the value beside it cannot supply the answer.

       The no-boot door is real rather than hypothetical. A cross-tab adopt
       replaces STATE wholesale with no boot behind it, and both renderers read
       live STATE. So this block seeds the junk and renders with NO repair run. */
    const raw = await page.evaluate(async () => {
      const o = {};
      const host = document.createElement('div'); document.body.appendChild(host);
      const PAY = '<img src=x onerror="window.__v415raw=(window.__v415raw||0)+1">';
      window.__v415raw = 0;
      STATE.logs = { 3: { done: true, ex: {}, completedAt: PAY, date: PAY, items: [] } };
      // deliberately NO normalizeState() — this is the render guard on its own
      host.innerHTML = sessionHistoryHTML();
      o.histInj = !!host.querySelector('img[onerror]');
      try { openSessionDetail(3); } catch (e) { o.sheetErr = String(e).slice(0, 80); }
      const sheet = document.querySelector('#sheet');
      o.sheetInj = !!(sheet && sheet.querySelector('img[onerror]'));
      o.sheetOpened = !!(sheet && sheet.textContent && sheet.textContent.length > 30);
      try { closeSheet(); } catch (e) {}
      await new Promise(r => setTimeout(r, 150));
      o.ran = window.__v415raw;
      o.stillJunk = /onerror/.test(String((STATE.logs[3] || {}).completedAt));
      host.remove();
      return o;
    });

    t.ok('guard: the junk really is still on the row — no repair has run', raw.stillJunk, raw);
    t.ok('guard: and the session detail sheet really opened', raw.sheetOpened, raw);
    t.ok('with NO boot behind it, the workout history escapes the date', !raw.histInj, raw);
    t.ok('and so does the session detail sheet', !raw.sheetInj, raw);
    t.eq('so nothing runs from an unrepaired log row', raw.ran, 0, raw);
  }

  /* 25. A JUNK DATE THAT SWITCHES A GUARDRAIL OFF (v415).

     calorieCheckDue() does (Date.now()-Date.parse(v))/86400000>=21, and
     Date.parse('not-a-date') is NaN. NaN>=21 is FALSE, so the function
     answered "not due" for ever and the twelve-week diet guardrail was
     silently switched off. Fail-OPEN, and nothing on screen said so.

     The repair asks isDateISO() — the app's one date predicate — and the
     floors are what stop it becoming "always ask": a stamp five days old is
     still NOT due, and one thirty days old IS. */
  {
    const gr = await page.evaluate(() => {
      const o = {};
      const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
      o.parseIsNaN = isNaN(Date.parse('not-a-date'));          // guard: the sum really is NaN
      o.nanCompare = ((Date.now() - Date.parse('not-a-date')) / 86400000 >= 21) === false;

      nut().kcalAdjAt = 'not-a-date'; normalizeState();
      o.junkGone = nut().kcalAdjAt === undefined;
      o.dueWithJunk = calorieCheckDue();

      nut().kcalAdjAt = '2025-02-29'; normalizeState();        // a pattern-shaped non-day
      o.fakeDayGone = nut().kcalAdjAt === undefined;

      nut().kcalAdjAt = ago(5);  normalizeState(); o.stampAfter5 = nut().kcalAdjAt; o.due5 = calorieCheckDue();
      nut().kcalAdjAt = ago(30); normalizeState(); o.due30 = calorieCheckDue();

      STATE._lastExport = 'not-a-date'; normalizeState(); o.expJunkGone = STATE._lastExport === undefined;

      /* THE DISCRIMINATING CASE, and the reason the first version of this check
         could not fail. 'not-a-date' is refused by BOTH predicates, so seeding
         only that made the weaker test isNaN(Date.parse(x)) an EQUIVALENT
         mutant. What tells them apart is a string Date.parse ACCEPTS and
         isDateISO() refuses — '2025-02-29' is not a day in 2025, and
         Date.parse rolls it forward to March 1 rather than rejecting it.
         The kcalAdjAt half twelve lines up already had this case and its twin
         did not: one of a pair guarded and its twin not, in my own checks. */
      o.expFakeParses = !isNaN(Date.parse('2025-02-29'));
      STATE._lastExport = '2025-02-29'; normalizeState(); o.expFakeGone = STATE._lastExport === undefined;

      STATE._lastExport = ago(9);       normalizeState(); o.expKept = STATE._lastExport === ago(9);
      return o;
    });

    t.ok('guard: Date.parse of a junk stamp really is NaN', gr.parseIsNaN, gr);
    t.ok('guard: and NaN >= 21 really is false, which is why it read as not due', gr.nanCompare, gr);

    t.ok('a junk kcalAdjAt is gone after the boot', gr.junkGone, gr);
    t.ok('and the guardrail asks again rather than never', gr.dueWithJunk, gr);
    t.ok('a date-shaped non-day is gone too — the pattern is not the predicate', gr.fakeDayGone, gr);

    t.ok('FLOOR: a real stamp five days old survives the boot',
      /^\d{4}-\d{2}-\d{2}$/.test(gr.stampAfter5 || ''), gr);
    t.ok('FLOOR: and is NOT due — the window is three weeks', gr.due5 === false, gr);
    t.ok('FLOOR: a real stamp thirty days old IS due', gr.due30 === true, gr);

    t.ok('a junk _lastExport is gone', gr.expJunkGone, gr);
    t.ok('guard: Date.parse really does ACCEPT the date-shaped non-day, or the case below proves nothing',
      gr.expFakeParses, gr);
    t.ok('and a date-shaped non-day is gone from _lastExport too — the pattern is not the predicate',
      gr.expFakeGone, gr);
    t.ok('FLOOR: and a real one survives', gr.expKept, gr);
  }

  /* v416 — THE CORE SCORE AND THE TEST COUNT HAD NO REPAIR ON TWO OF THE THREE
     RECORDS THAT CARRY THEM.

     scoreHistory has been filtered on `e.score!=null&&isFinite(e.score)` for many
     versions, so the codebase already knew an unreadable score was illegal. The
     SAME field on STATE.baseline and every STATE.reassess[c] was never checked,
     and `testCount` was never checked anywhere — so a row whose score is VALID
     carried a junk testCount straight past that filter.

     Measured AFTER a real boot repair, from a backup importData() accepts:
     reassessIntroHTML(), finishedHTML() and scoreDeltaHTML() all injected, and
     arbitrary script ran four times. The program-complete screen printed
     `abc→abc` where the athlete's Core Score belongs.

     Two guards mean two checks, so the boot repair and the render readers are
     driven separately — the render half with NO normalizeState() behind it. */
  {
    const sc = await page.evaluate(async () => {
      const o = {};
      const host = document.createElement('div'); document.body.appendChild(host);
      const PAY = '<img src=x onerror="window.__v416=(window.__v416||0)+1">';

      // The detector really can see one, and it carries its OWN payload: an
      // img's onerror fires a tick later, so a shared counter would be
      // incremented after it was zeroed and "nothing ran" would fail on
      // correct code.
      host.innerHTML = '<img src=x onerror="window.__v416det=1">';
      o.detector = !!host.querySelector('img[onerror]');
      host.innerHTML = '';
      await new Promise(r => setTimeout(r, 120));
      o.detectorRan = !!window.__v416det;
      window.__v416 = 0;

      // ---- THE BOOT REPAIR, on all three records at once.
      STATE.scoreHistory = [
        { date: '2026-01-01', score: 70, level: 'Beginner', testCount: PAY },
        { date: '2026-02-01', score: 80, level: 'Beginner', testCount: PAY }
      ];
      STATE.baseline = { date: '2026-01-01', score: PAY, level: 'Beginner', testCount: 10, maxes: { plank: 60 } };
      STATE.reassess = { 1: { date: '2026-02-01', score: PAY, level: 'Beginner', testCount: 10, maxes: { plank: 70 } } };
      normalizeState();
      o.bootHistRows = STATE.scoreHistory.length;
      o.bootHistTCGone = (STATE.scoreHistory[0] || {}).testCount === undefined;
      o.bootBaseGone = (STATE.baseline || {}).score === undefined;
      o.bootReGone = ((STATE.reassess || {})[1] || {}).score === undefined;
      // THE ROW SURVIVES: its level and its maxes were really taken.
      o.bootBaseKeptMaxes = ((STATE.baseline || {}).maxes || {}).plank === 60;
      o.bootBaseKeptLevel = (STATE.baseline || {}).level === 'Beginner';

      // ---- OUT OF BAND IS DROPPED, NOT CLAMPED. computeAssessment() is a
      //      rounded average of terms each clamped 0..100, so 150 did not come
      //      from an effort and "100/100" would be a result nobody earned.
      STATE.baseline = { date: '2026-01-01', score: 150, level: 'Beginner', testCount: 10, maxes: {} };
      normalizeState();
      o.overBandGone = (STATE.baseline || {}).score === undefined;
      STATE.baseline = { date: '2026-01-01', score: -5, level: 'Beginner', testCount: 10, maxes: {} };
      normalizeState();
      o.underBandGone = (STATE.baseline || {}).score === undefined;

      // ---- FLOORS. Every real value survives, and both ends of the band do.
      STATE.baseline = { date: '2026-01-01', score: 0, level: 'Beginner', testCount: 10, maxes: {} };
      normalizeState();
      o.zeroKept = (STATE.baseline || {}).score === 0;      // a measured zero is data
      STATE.baseline = { date: '2026-01-01', score: 100, level: 'Advanced', testCount: 10, maxes: {} };
      normalizeState();
      o.hundredKept = (STATE.baseline || {}).score === 100;
      // ABSENT IS A REAL STATE — skipBaseline() writes score:null on purpose.
      STATE.baseline = { date: '2026-01-01', score: null, level: 'Beginner', estimated: true, testCount: 10, maxes: {} };
      normalizeState();
      o.nullKept = (STATE.baseline || {}).score === null;
      // A numeric string is COERCED, not refused: the scoreHistory filter has
      // always kept one (isFinite('70')), and two readers of one field must not
      // disagree about it.
      STATE.baseline = { date: '2026-01-01', score: '70', level: 'Beginner', testCount: '10', maxes: {} };
      normalizeState();
      o.numStrCoerced = (STATE.baseline || {}).score === 70 && (STATE.baseline || {}).testCount === 10;

      /* isFinite ALONE IS NOT A NUMBER TEST, and nothing here could see that.
         Every case above seeds a STRING payload, which both _numOf() and a
         bare isFinite() refuse — so the mutant that drops the typeof half was
         EQUIVALENT on all of them and walked straight through.

         What discriminates is a value isFinite() ACCEPTS and a number test
         does not. isFinite([]) is true and +[] is 0, so an array out of a
         backup would read as a MEASURED ZERO — a Core Score of 0/100 for an
         athlete who never took a test, which is exactly the falsy-zero lie
         computeAssessment() was fixed for. isFinite(true) is true and +true
         is 1; isFinite('') is true and +'' is 0. */
      o.finiteAcceptsArray = isFinite([]) && (+[]) === 0;   // guard: the trap is real
      o.finiteAcceptsBool  = isFinite(true) && (+true) === 1;
      o.finiteAcceptsBlank = isFinite('') && (+'') === 0;
      const shapeDrops = v => {
        STATE.baseline = { date: '2026-01-01', score: v, level: 'Beginner', testCount: v, maxes: { plank: 60 } };
        normalizeState();
        const b = STATE.baseline || {};
        return b.score === undefined && b.testCount === undefined && (b.maxes || {}).plank === 60;
      };
      o.arrayDropped = shapeDrops([]);
      o.boolDropped  = shapeDrops(true);
      o.blankDropped = shapeDrops('');
      o.objDropped   = shapeDrops({});

      // ---- A REAL THREE-ROW HISTORY IS BYTE-IDENTICAL.
      const real = [
        { date: '2026-01-01', score: 41, level: 'Beginner', testCount: 10 },
        { date: '2026-02-15', score: 55, level: 'Intermediate', testCount: 10 },
        { date: '2026-04-01', score: 71, level: 'Advanced', testCount: 10 }
      ];
      STATE.scoreHistory = JSON.parse(JSON.stringify(real));
      normalizeState();
      o.realHistUntouched = JSON.stringify(STATE.scoreHistory) === JSON.stringify(real);

      // ---- THE RENDER HALF, with NO boot behind it. A cross-tab adopt replaces
      //      STATE, and a guard that only exists at the boot is one guard.
      /* THE ASSESSMENT-HISTORY ROW PRINTS THE SCORE AND NOT THE TEST COUNT,
         and the first version of this seed put the payload only in testCount.
         So that row's score was ALWAYS a real 70/80, the mutant that reverts
         it to a raw `s.score` was equivalent on every case here, and it walked
         straight through. The payload has to go where the reader looks. */
      const seed = () => {
        STATE.scoreHistory = [
          { date: '2026-01-01', score: PAY, level: 'Beginner', testCount: PAY },
          { date: '2026-02-01', score: PAY, level: 'Beginner', testCount: PAY }
        ];
        STATE.baseline = { date: '2026-01-01', score: PAY, level: 'Beginner', testCount: 10, maxes: {} };
        STATE.reassess = { 1: { date: '2026-02-01', score: PAY, level: 'Beginner', testCount: 10, maxes: {} } };
      };
      const inj = fn => {
        seed(); host.innerHTML = '';
        try { host.innerHTML = fn(); } catch (e) { o.renderErr = (o.renderErr || '') + String(e).slice(0, 50); }
        return !!host.querySelector('img[onerror]');
      };
      o.reInjBase = inj(() => reassessIntroHTML(1));   // cycle 1 reads STATE.baseline
      o.reInj     = inj(() => reassessIntroHTML(2));   // cycle 2 reads STATE.reassess[1]
      o.finInj = inj(() => finishedHTML());
      o.sdInj = inj(() => scoreDeltaHTML({ score: 90, level: 'Beginner' }));
      o.trInj = inj(() => scoreTrendHTML());

      // The Progress ▸ Strength pane, driven rather than called.
      seed();
      try { setProgressTab('strength'); go('progress'); } catch (e) { o.progErr = String(e).slice(0, 60); }
      const pv = document.querySelector('#v-progress');
      o.progInj = !!(pv && pv.querySelector('img[onerror]'));
      /* Scoped to the row that changed, so "the pane is clean" cannot be
         satisfied by some other part of it. */
      o.progHistRow = !!(pv && /Baseline|Re-test/.test(pv.textContent || ''));

      await new Promise(r => setTimeout(r, 250));
      o.ran = window.__v416;

      // ---- FLOOR: the real numbers still PRINT after the fix.
      STATE.scoreHistory = JSON.parse(JSON.stringify(real));
      STATE.baseline = { date: '2026-01-01', score: 41, level: 'Beginner', testCount: 10, maxes: {} };
      STATE.reassess = { 1: { date: '2026-02-01', score: 71, level: 'Advanced', testCount: 10, maxes: {} } };
      /* A FIXED WINDOW IS NOT A SEARCH. The first version of these floors
         sliced 200 characters and the score sits ~330 in, so they failed on
         screens that were perfectly correct. Test the WHOLE string and keep a
         short excerpt only for the failure detail. */
      const strip = h => String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const re1 = strip(reassessIntroHTML(1));   // reads STATE.baseline, 41
      const re2 = strip(reassessIntroHTML(2));   // reads STATE.reassess[1], 71
      const fin = strip(finishedHTML());
      const tr  = strip(scoreTrendHTML());
      o.reHas1 = /Core Score 41\/100/.test(re1);
      o.reHas2 = /Core Score 71\/100/.test(re2);
      o.finHas = /41→71/.test(fin);
      o.trHas  = /\+30 points/.test(tr);
      o.reText1 = re1.slice(0, 120); o.reText2 = re2.slice(0, 120);
      o.finText = fin.slice(0, 120); o.trendText = tr.slice(0, 120);
      o.gain = scoreGain();
      setProgressTab('strength'); go('progress');
      o.progText = ((document.querySelector('#v-progress') || {}).textContent || '');
      o.progHasScores = /41\/100/.test(o.progText) && /71\/100/.test(o.progText);

      host.remove();
      setProgressTab('summary');
      return o;
    });

    t.ok('guard: the detector really can see an injected element', sc.detector, sc);
    t.ok('guard: and a planted payload really does RUN, or "nothing ran" proves nothing', sc.detectorRan, sc);

    t.ok('a junk testCount is gone from a scoreHistory row whose score is VALID', sc.bootHistTCGone, sc);
    t.eq('and the row itself survives — it is a real measurement', sc.bootHistRows, 2, sc);
    t.ok('a junk score is gone from the baseline', sc.bootBaseGone, sc);
    t.ok('and from every reassessment', sc.bootReGone, sc);
    t.ok('FLOOR: the baseline row survives, with its maxes', sc.bootBaseKeptMaxes, sc);
    t.ok('FLOOR: and with its level', sc.bootBaseKeptLevel, sc);

    t.ok('a score above the band the app can produce is DROPPED, not clamped', sc.overBandGone, sc);
    t.ok('and one below it', sc.underBandGone, sc);
    t.ok('FLOOR: a measured zero is data and survives', sc.zeroKept, sc);
    t.ok('FLOOR: and so does a perfect 100', sc.hundredKept, sc);
    t.ok('FLOOR: score:null is a real answer — skipBaseline writes it', sc.nullKept, sc);
    t.ok('FLOOR: a numeric string is coerced, because the scoreHistory filter has always kept one', sc.numStrCoerced, sc);

    /* isFinite ALONE IS NOT A NUMBER TEST. The guards come first, or every
       assertion below is satisfied by a page where the trap does not exist. */
    t.ok('guard: isFinite([]) really is true and +[] really is 0', sc.finiteAcceptsArray, sc);
    t.ok('guard: isFinite(true) really is true and +true really is 1', sc.finiteAcceptsBool, sc);
    t.ok('guard: isFinite(\'\') really is true and +\'\' really is 0', sc.finiteAcceptsBlank, sc);
    t.ok('an ARRAY is dropped, not read as a measured zero', sc.arrayDropped, sc);
    t.ok('a BOOLEAN is dropped, not read as a score of 1', sc.boolDropped, sc);
    t.ok('a BLANK string is dropped, not read as a measured zero', sc.blankDropped, sc);
    t.ok('an OBJECT is dropped', sc.objDropped, sc);
    t.ok('FLOOR: a real three-row history is byte-identical after the boot', sc.realHistUntouched, sc);

    t.ok('with NO boot behind it, the re-test intro escapes the baseline score', !sc.reInjBase, sc);
    t.ok('and the reassessment score — cycle 1 and cycle 2 read DIFFERENT records', !sc.reInj, sc);
    t.ok('and so does the program-complete screen', !sc.finInj, sc);
    t.ok('and so does the results screen that names the test count', !sc.sdInj, sc);
    t.ok('and so does the score trend', !sc.trInj, sc);
    t.ok('guard: the assessment-history rows really did render, or the check below proves nothing',
      sc.progHistRow, sc);
    t.ok('and so does the assessment history on Progress > Strength', !sc.progInj, sc);
    t.eq('nothing ran', sc.ran, 0, sc);

    t.ok('FLOOR: a real baseline still prints its score on the re-test intro', sc.reHas1, sc);
    t.ok('FLOOR: and a real reassessment prints its own — the two cycles read DIFFERENT records', sc.reHas2, sc);
    t.ok('FLOOR: and the program-complete screen still prints both', sc.finHas, sc);
    t.ok('FLOOR: and the trend still reports a real gain', sc.trHas, sc);
    t.eq('FLOOR: and scoreGain still answers', sc.gain, 30, sc);
    t.ok('FLOOR: and the assessment history still prints every real score', sc.progHasScores, sc);
  }

  /* v416 — THE ONLY TWO-LEVEL COMPUTED WRITE IN THE APP.

     v414 closed the four Object.assign doors into Object.prototype. A
     single-level obj[k]=v changes only that object, so a one-level write is
     never in the class; a TWO-level X[a][b]=v with a='__proto__' is, because
     X['__proto__'] READS BACK Object.prototype — truthy, so an `if(!X[a])`
     guard is satisfied and never creates a fresh map — and the next line writes
     onto the prototype every object in the page inherits from.

     setSwap() is the only one. NOT athlete-reachable today and saying so is the
     honest framing: `ptr` is always STATE.progressPtr, which normalizeState()
     repairs to an integer. The codebase already guards the exercise id on this
     very line (v400) and never guarded the pointer.

     The guards come first: without them the whole block is satisfied by a page
     where the shape was never dangerous. */
  {
    const pp = await page.evaluate(() => {
      const o = {};
      // The shape really is dangerous, or nothing below means anything.
      const probe = {};
      o.protoReadsBack = probe['__proto__'] === Object.prototype;
      o.guardSatisfied = !!probe['__proto__'];    // so `if(!X[k])X[k]={}` never fires

      const before = Object.getPrototypeOf(STATE);
      STATE.swaps = {};
      try { setSwap('__proto__', 'x', 'pushup'); } catch (e) { o.err = String(e).slice(0, 60); }
      o.protoIntact = Object.getPrototypeOf(STATE) === before;
      o.noProtoKey = ({}).x === undefined;
      o.noSwapWritten = Object.keys(STATE.swaps).length === 0;

      // FLOOR: a real swap still lands, or the guard is a delete.
      STATE.swaps = {};
      setSwap(3, '__fin', 'pushup');
      o.realSwap = ((STATE.swaps[3] || {}).__fin) === 'pushup';
      STATE.swaps = {};
      return o;
    });

    t.ok("guard: obj['__proto__'] really does read back Object.prototype", pp.protoReadsBack, pp);
    t.ok('guard: and it is truthy, so an if(!map[k]) guard never creates a fresh map', pp.guardSatisfied, pp);
    t.ok("a '__proto__' pointer cannot reach Object.prototype through setSwap", pp.protoIntact, pp);
    t.ok('and no property is left on every object in the page', pp.noProtoKey, pp);
    t.ok('and nothing is written', pp.noSwapWritten, pp);
    t.ok('FLOOR: a real swap still lands', pp.realSwap, pp);
  }

  /* v416 — THE RENDER HALF OF FOUR REPAIRS THAT ONLY EVER HAD THE BOOT HALF.

     Every value here is membership- or format-repaired at the boot — v356 for
     an activity row's date, v374 for a photo's pose, the goal's own membership
     test — and printed RAW at the render. Two guards mean two checks and each
     of these had one. The photo comparison is the sharpest: it escapes the two
     photo ids on the SAME LINE as the pose it does not.

     Latent rather than reachable today, because every path into STATE calls
     normalizeState(). The rule is that anything that can come out of a backup
     is escaped at the render whatever the repair does. */
  {
    const es = await page.evaluate(async () => {
      const o = {};
      const host = document.createElement('div'); document.body.appendChild(host);
      const PAY = '<img src=x onerror="window.__v416e=(window.__v416e||0)+1">';
      host.innerHTML = '<img src=x onerror="window.__v416ed=1">';
      o.detector = !!host.querySelector('img[onerror]');
      host.innerHTML = ''; await new Promise(r => setTimeout(r, 120));
      o.detectorRan = !!window.__v416ed;
      window.__v416e = 0;

      const T = todayISO();
      const inj = fn => {
        host.innerHTML = '';
        try { host.innerHTML = fn(); } catch (e) { o.err = (o.err || '') + String(e).slice(0, 40); }
        return !!host.querySelector('img[onerror]');
      };

      STATE.ruckLog = [{ date: PAY, mins: 30, dist: 5, wt: 20, unit: 'km' }];
      o.actInj = inj(() => actHistoryHTML('ruck'));
      STATE.skipLog = [{ date: PAY, mins: 10, rounds: 3 }];
      o.skipInj = inj(() => skipHistoryHTML());

      STATE.photos = [
        { id: 'a1', date: '2026-01-01', pose: 'front' },
        { id: 'a2', date: '2026-03-01', pose: 'front' }
      ];
      /* THE POSE ESCAPE IS AN EQUIVALENT GUARD, and the mutant that removed
         it is what proved that. photoPair() sets `pose` from the
         POSE_KEYS.forEach loop variable, never from the stored row, and every
         other pose site reads through poseOf(), which is a membership test —
         so no reachable route can put junk on `pair.pose` and no check can
         catch the escape. What this case DOES prove is that the gallery
         itself — captions, ids, tiles — survives a junk pose on every row. */
      STATE.photos = [
        { id: 'a1', date: '2026-01-01', pose: PAY },
        { id: 'a2', date: '2026-03-01', pose: PAY }
      ];
      o.pairInj = inj(() => photosHTML());

      /* The Fuel card is inside renderFuel(), which writes its own view, so it
         is driven rather than called. */
      STATE.nutrition.goal = PAY;
      STATE.nutrition.kcalTarget = 2200;
      try { go('fuel'); } catch (e) { o.fuelErr = String(e).slice(0, 50); }
      const fv = document.querySelector('#v-fuel');
      o.goalInj = !!(fv && fv.querySelector('img[onerror]'));

      await new Promise(r => setTimeout(r, 250));
      o.ran = window.__v416e;

      // FLOOR: the real values still print.
      STATE.ruckLog = [{ date: T, mins: 30, dist: 5, wt: 20, unit: 'km' }];
      STATE.skipLog = [{ date: T, mins: 10, rounds: 3 }];
      o.actText = String(actHistoryHTML('ruck')).includes(T);
      o.skipText = String(skipHistoryHTML()).includes(T);

      /* A block that BREAKS what a later one relies on re-seeds before it
         ends. This one is last today; that is not a contract. */
      STATE.ruckLog = []; STATE.skipLog = []; STATE.photos = [];
      STATE.nutrition.goal = 'lose'; delete STATE.nutrition.kcalTarget;
      normalizeState(); go('today');
      host.remove();
      return o;
    });

    t.ok('guard: the detector really can see an injected element', es.detector, es);
    t.ok('guard: and a planted payload really does RUN', es.detectorRan, es);
    t.ok('the activity history escapes the row date', !es.actInj, es);
    t.ok('and so does the skipping history', !es.skipInj, es);
    t.ok('and the photo gallery renders a junk pose without injecting', !es.pairInj, es);
    t.ok('and the Fuel target card escapes the goal', !es.goalInj, es);
    t.eq('nothing ran', es.ran, 0, es);
    t.ok('FLOOR: a real activity date still prints', es.actText, es);
    t.ok('FLOOR: and a real skipping date still prints', es.skipText, es);
  }


  /* v417 — THREE FIELDS ON ONE PANE, EACH WITH TWO READERS THAT DISAGREED.

     All three sit on Progress > Strength, and each had a guarded reader
     somewhere in the app and an unguarded one on that pane. This is v416's own
     lesson — two readers of one field must not disagree — one pane over.

     1. THE DATE ON THE THREE ASSESSMENT RECORDS HAD NO REPAIR AT ALL. _lvFix
        repaired level, score and testCount; _maxFix repaired maxes and results;
        `date` was repaired by neither. assessSeries() passes it straight into
        lineChart(), which put it in an SVG <text> with no coercion and no
        escape. MEASURED, from a backup importData() accepts: a non-string threw
        `(dates[i] || "").slice is not a function` inside renderProgress(), the
        boundary retried through normalizeState(), nothing repaired it, and the
        pane died permanently — "Something went wrong drawing this screen". A
        string was interpolated raw and ARBITRARY SCRIPT RAN.

     2. THE CHART READ maxes[k] RAW while estimateMaxes() coerces and caps and
        _maxFix() only ever tested `typeof === 'number' && > cap`. MEASURED: a
        stored '99999' (cap 6000) survived every boot, the chart plotted it, and
        the engine prescribed from the 40s default beside it. A negative and a
        boolean survived too — `true` renders as the literal `true reps` on a
        rep metric and as a plausible `1s` on the Plank.

     3. prs VALUES had only a container repair. bestFor() has always guarded its
        own read; the two RENDER sites did not, and both reach innerHTML.
        MEASURED: both injected and arbitrary script RAN. v401 swept these same
        ten keyed maps and asked about their KEYS, never about their VALUES.

     Two guards mean two checks throughout, so the boot repair and the render
     readers are driven separately — the render half with NO normalizeState()
     behind it, because a cross-tab adopt replaces STATE. */
  {
    const vr = await page.evaluate(async () => {
      const o = {};
      const host = document.createElement('div'); document.body.appendChild(host);
      const PAY = '<img src=x onerror="window.__v417=(window.__v417||0)+1">';
      host.innerHTML = '<img src=x onerror="window.__v417det=1">';
      o.detector = !!host.querySelector('img[onerror]');
      host.innerHTML = ''; await new Promise(r => setTimeout(r, 120));
      o.detectorRan = !!window.__v417det;
      window.__v417 = 0;

      const rec = (date, maxes, extra) => Object.assign(
        { date, level: 'Intermediate', score: 60, testCount: 10, subs: {}, maxes, results: {} }, extra || {});

      /* ---- GUARDS. The cap is what the block assumes, a NUMBER above it was
         already dropped by v412, and Progress > Strength really is the pane. */
      o.cap = maxPlausible('plank');
      STATE.baseline = rec('2026-01-01', { plank: 99999 });
      STATE.reassess = {}; normalizeState();
      o.guardNumberDropped = (STATE.baseline.maxes || {}).plank === undefined;

      /* ---- 1a. THE DATE, at the boot, on all three records at once. */
      const junkDates = [{ bad: 1 }, PAY, 42, true, [], '2025-02-29', 'not-a-date', ''];
      o.dateDropped = junkDates.every(d => {
        STATE.baseline = rec(d, { plank: 60 });
        STATE.reassess = { 1: rec(d, { plank: 70 }) };
        STATE.scoreHistory = [{ date: d, score: 70, level: 'Beginner', testCount: 10 }];
        normalizeState();
        return (STATE.baseline || {}).date === undefined
          && ((STATE.reassess || {})[1] || {}).date === undefined
          && ((STATE.scoreHistory[0] || {}).date === undefined || !STATE.scoreHistory.length);
      });
      /* THE RECORD SURVIVES A BAD DATE: its maxes and its level were really
         taken, and the whole prescription is built from them. */
      STATE.baseline = rec({ bad: 1 }, { plank: 60 });
      STATE.reassess = {}; normalizeState();
      o.dateRowKeptMaxes = ((STATE.baseline || {}).maxes || {}).plank === 60;
      o.dateRowKeptLevel = (STATE.baseline || {}).level === 'Intermediate';
      /* FLOOR: a real date survives untouched on all three. */
      STATE.baseline = rec('2026-01-01', { plank: 60 });
      STATE.reassess = { 1: rec('2026-02-01', { plank: 70 }) };
      STATE.scoreHistory = [{ date: '2026-01-01', score: 70, level: 'Beginner', testCount: 10 }];
      normalizeState();
      o.realDateKept = STATE.baseline.date === '2026-01-01'
        && STATE.reassess[1].date === '2026-02-01'
        && STATE.scoreHistory[0].date === '2026-01-01';

      /* ---- 1b. THE RENDER GUARD, with NO boot behind it. */
      const seedDates = d => {
        STATE.baseline = rec(d, { plank: 60 });
        STATE.reassess = { 1: rec('2026-02-01', { plank: 70 }) };
      };
      strengthSel = 'plank';
      seedDates({ bad: 1 });
      try { host.innerHTML = strengthTrendHTML(); o.objDateThrew = false; }
      catch (e) { o.objDateThrew = true; o.objDateErr = String(e).slice(0, 70); }
      o.objDateStillCharts = /Strength trends/.test(host.innerHTML);
      seedDates(PAY);
      host.innerHTML = '';
      try { host.innerHTML = strengthTrendHTML(); } catch (e) { o.payErr = String(e).slice(0, 50); }
      o.dateInj = !!host.querySelector('img[onerror]');
      /* FLOOR: a real date still prints its MM-DD label on the axis. */
      seedDates('2026-01-01');
      host.innerHTML = strengthTrendHTML();
      o.dateLabel = /01-01/.test(host.innerHTML) && /02-01/.test(host.innerHTML);

      /* lineChart() has THREE callers and the fix is in the helper, so the two
         measurement charts are covered by the same edit. Driven directly. */
      host.innerHTML = '';
      try { host.innerHTML = lineChart([1, 2], [{ bad: 1 }, PAY], 'var(--fire)', 'kg'); }
      catch (e) { o.lcThrew = true; o.lcErr = String(e).slice(0, 60); }
      o.lcInj = !!host.querySelector('img[onerror]');
      host.innerHTML = lineChart([1, 2], ['2026-01-01', '2026-02-01'], 'var(--fire)', 'kg');
      o.lcLabel = /01-01/.test(host.innerHTML) && /02-01/.test(host.innerHTML);

      /* ---- 2. maxes, at the boot AND on the chart. */
      const maxDropped = v => {
        STATE.baseline = rec('2026-01-01', { plank: v });
        STATE.reassess = {}; normalizeState();
        return ((STATE.baseline || {}).maxes || {}).plank === undefined;
      };
      o.maxStrDropped = maxDropped('99999');   // a numeric STRING above the cap
      o.maxNegDropped = maxDropped(-500);
      o.maxBoolDropped = maxDropped(true);
      o.maxNaNDropped = maxDropped(NaN);
      o.maxObjDropped = maxDropped({});
      /* FLOORS. A real value is byte-identical, a measured ZERO is data, and a
         numeric string IN band is COERCED — because estimateMaxes() has always
         coerced one and the two readers must not disagree. */
      STATE.baseline = rec('2026-01-01', { plank: 75 }); STATE.reassess = {}; normalizeState();
      o.maxRealKept = STATE.baseline.maxes.plank === 75;
      STATE.baseline = rec('2026-01-01', { plank: 0 }); normalizeState();
      o.maxZeroKept = STATE.baseline.maxes.plank === 0;
      STATE.baseline = rec('2026-01-01', { plank: '75' }); normalizeState();
      o.maxStrCoerced = STATE.baseline.maxes.plank === 75;
      /* An id with no benchmark is left UNBOUNDED rather than guessed at.
         Unreachable through a screen (every EX.anchor is a TESTS id with a
         bench), so it is exercised on the predicate directly. */
      o.noBenchCap = maxPlausible('zzznotatest') === 0;
      o.noBenchUnbounded = maxVal('zzznotatest', 1e9) === 1e9;

      /* THE CHART MUST NOT DRAW WHAT THE ENGINE REFUSES, with NO boot. */
      STATE.baseline = rec('2026-01-01', { plank: '99999' });
      STATE.reassess = { 1: rec('2026-02-01', { plank: 75 }) };
      strengthSel = 'plank';
      host.innerHTML = strengthTrendHTML();
      o.chartRefuses = !/99999/.test(host.innerHTML);
      o.engineRefuses = currentMaxes().plank !== 99999;
      /* FLOOR: two real points still plot AND the verdict still prints. */
      STATE.baseline = rec('2026-01-01', { plank: 60 });
      STATE.reassess = { 1: rec('2026-02-01', { plank: 75 }) };
      host.innerHTML = strengthTrendHTML();
      o.chartTwoPoints = (host.innerHTML.match(/<circle/g) || []).length === 2;
      o.chartVerdict = /▲/.test(host.innerText || host.textContent || '');

      /* ---- 3. prs VALUES. */
      const prJunk = { pushup: PAY, squat: {}, plank: -5, pistol: true, dips: 0 };
      STATE.prs = JSON.parse(JSON.stringify({ pushup: PAY, plank: -5, dips: 0 }));
      STATE.prs.squat = {}; STATE.prs.pistol = true;
      normalizeState();
      o.prJunkGone = Object.keys(STATE.prs).length === 0;
      /* FLOOR: a real record survives and a numeric string is coerced. */
      STATE.prs = { pushup: 40, deadhang: '90' }; normalizeState();
      o.prRealKept = STATE.prs.pushup === 40 && STATE.prs.deadhang === 90;
      o.prBestFor = bestFor('pushup') === 40;

      /* THE RENDER SITES, with NO boot behind them. */
      STATE.prs = { pushup: PAY, deadhang: PAY };
      setProgressTab('strength'); go('progress');
      await new Promise(r => setTimeout(r, 200));
      const pv = document.querySelector('#v-progress');
      o.prProgInj = !!(pv && pv.querySelector('img[onerror]'));
      openStandards();
      await new Promise(r => setTimeout(r, 200));
      const sh = document.querySelector('#sheet');
      o.prSheetInj = !!(sh && sh.querySelector('img[onerror]'));
      o.prSheetOpened = !!(sh && (sh.textContent || '').length > 40);
      try { closeSheet(); } catch (e) {}
      /* A KEY WITH NO USABLE BEST DRAWS NO ROW AT ALL. The fix's own comment
         says showing `0 reps` for a real movement "would be a different lie",
         and nothing enforced it — the mutant that removes the row filter and
         keeps the reader escaped every other check here, because bestFor()
         still returns 0 and 0 cannot inject. A claim in a comment with no
         check behind it is the shape this file keeps getting caught by.
         The DISCRIMINATING case is a real best BESIDE a junk one: an all-junk
         seed passes just as well if the whole block were deleted. */
      STATE.prs = { pushup: 40, squat: PAY };
      setProgressTab('strength'); go('progress');
      await new Promise(r => setTimeout(r, 200));
      const mv = (document.querySelector('#v-progress') || {}).innerText || '';
      o.prMixReal = /40 reps/.test(mv);
      /* \b, because `/0 reps/` matches the 0 inside `40 reps` — the same
         substring trap this repo records for pistol inside boxpistol, and it
         failed this check on perfectly correct code. */
      o.prMixNoZero = !/\b0 reps/.test(mv);
      o.prMixGuard = /\b0 reps/.test('Squat 0 reps') && !/\b0 reps/.test('Push-Up 40 reps');

      /* FLOOR: a real personal best still prints on BOTH surfaces. */
      STATE.prs = { pushup: 40 };
      setProgressTab('strength'); go('progress');
      await new Promise(r => setTimeout(r, 200));
      o.prProgText = /40 reps/.test((document.querySelector('#v-progress') || {}).innerText || '');
      openStandards();
      await new Promise(r => setTimeout(r, 200));
      o.prSheetText = /40 reps/.test((document.querySelector('#sheet') || {}).textContent || '');
      try { closeSheet(); } catch (e) {}

      await new Promise(r => setTimeout(r, 250));
      o.ran = window.__v417;

      /* THE LIVE PANE. A junk date used to kill it through the boundary; it
         must render the trend instead. */
      STATE.baseline = rec({ bad: 1 }, { plank: 60 });
      STATE.reassess = { 1: rec('2026-02-01', { plank: 70 }) };
      setProgressTab('strength'); go('progress');
      await new Promise(r => setTimeout(r, 300));
      const lp = document.querySelector('#v-progress');
      const lt = (lp ? lp.innerText : '') || '';
      o.paneAlive = !/went wrong|something broke/i.test(lt) && /Strength trends/i.test(lt);
      o.paneLen = lt.length;

      /* A block that BREAKS what a later one relies on re-seeds before it ends. */
      STATE.baseline = null; STATE.reassess = {}; STATE.scoreHistory = []; STATE.prs = {};
      normalizeState(); go('today');
      host.remove();
      return o;
    });

    t.ok('guard: the detector really can see an injected element', vr.detector, vr);
    t.ok('guard: and a planted payload really does RUN', vr.detectorRan, vr);
    t.eq('guard: the plank cap is 50x its 120s benchmark', vr.cap, 6000, vr);
    t.ok('guard: a NUMBER above the cap was already dropped before this round', vr.guardNumberDropped, vr);

    // ---- 1. THE DATE
    t.ok('every junk date is dropped from all three assessment records', vr.dateDropped, vr);
    t.ok('FLOOR: and the record keeps its maxes', vr.dateRowKeptMaxes, vr);
    t.ok('FLOOR: and its level', vr.dateRowKeptLevel, vr);
    t.ok('FLOOR: a real date survives on all three', vr.realDateKept, vr);
    t.ok('with NO boot behind it, a non-string date no longer throws', !vr.objDateThrew, vr);
    t.ok('and the trend still renders', vr.objDateStillCharts, vr);
    t.ok('and a payload date does not reach the SVG', !vr.dateInj, vr);
    t.ok('FLOOR: a real date still prints its MM-DD axis label', vr.dateLabel, vr);
    t.ok('lineChart() itself does not throw on a non-string date', !vr.lcThrew, vr);
    t.ok('and does not inject from one — the two measurement charts share this helper', !vr.lcInj, vr);
    t.ok('FLOOR: and it still labels a real pair of dates', vr.lcLabel, vr);
    t.ok('the live Progress > Strength pane survives a junk date', vr.paneAlive, vr);

    // ---- 2. maxes
    t.ok('a numeric STRING above the cap is dropped — typeof was doing a range test\'s job', vr.maxStrDropped, vr);
    t.ok('a negative max is dropped', vr.maxNegDropped, vr);
    t.ok('a boolean max is dropped', vr.maxBoolDropped, vr);
    t.ok('a NaN max is dropped', vr.maxNaNDropped, vr);
    t.ok('an object max is dropped', vr.maxObjDropped, vr);
    t.ok('FLOOR: a real max is byte-identical', vr.maxRealKept, vr);
    t.ok('FLOOR: a measured ZERO survives — zero is data', vr.maxZeroKept, vr);
    t.ok('FLOOR: an in-band numeric string is COERCED, so the two readers agree', vr.maxStrCoerced, vr);
    t.ok('guard: an id with no benchmark really has no cap', vr.noBenchCap, vr);
    t.ok('FLOOR: and is left UNBOUNDED rather than guessed at', vr.noBenchUnbounded, vr);
    t.ok('the chart no longer draws a figure the engine refuses', vr.chartRefuses, vr);
    t.ok('guard: and the engine really does refuse it', vr.engineRefuses, vr);
    t.ok('FLOOR: two real points still plot', vr.chartTwoPoints, vr);
    t.ok('FLOOR: and the verdict still prints', vr.chartVerdict, vr);

    // ---- 3. prs
    t.ok('every junk personal-best VALUE is dropped', vr.prJunkGone, vr);
    t.ok('FLOOR: a real personal best survives and a numeric string is coerced', vr.prRealKept, vr);
    t.ok('FLOOR: and bestFor() reads it back', vr.prBestFor, vr);
    t.ok('guard: the Standards sheet really opened', vr.prSheetOpened, vr);
    t.ok('with NO boot behind it, the personal-bests row does not inject', !vr.prProgInj, vr);
    t.ok('and neither does the Strength Standards sheet', !vr.prSheetInj, vr);
    t.ok('guard: a real best beside a junk one still prints', vr.prMixReal, vr);
    t.ok('guard: the zero-row detector matches a real `0 reps` and not the 0 inside `40 reps`', vr.prMixGuard, vr);
    t.ok('and the junk one draws NO row rather than `0 reps` for a real movement', vr.prMixNoZero, vr);
    t.ok('FLOOR: a real personal best still prints on Progress', vr.prProgText, vr);
    t.ok('FLOOR: and in the Standards sheet', vr.prSheetText, vr);

    t.eq('nothing ran from any of the three', vr.ran, 0, vr);
  }


  /* v418 — THE ARCHIVED RUN IS THE TWIN NOBODY SCRUBBED.

     normalizeState() repairs LIVE log rows: the container, the `ex` map, and
     (v415) the four date fields with isDateISO(). The archived-runs repair is
     `.map(r=>({...r,sessions:…}))` — a SPREAD. It checks that r.logs is a keyed
     map and never looks inside it, while allDoneLogs() deliberately folds those
     rows in beside the live ones because "lifetime readers must span archived
     runs as well as the live one".

     MEASURED: an athlete who last trained 200 days ago correctly reads a streak
     of 0, and ONE junk-dated row inside an archived run makes it read 1. A junk
     string sorts AFTER every ISO date, so it becomes dates[last], and the guard
     that ENDS a stale streak is (now - new Date(that))/86400000 > 3 — NaN, and
     NaN > 3 is FALSE. The app claimed a training streak for somebody who had
     not trained in months. v415's calorieCheckDue() shape, failing OPEN.

     Bounded at 1, because the counting loop's own gap is NaN too and breaks
     immediately. Small — and the class is not: this is the fifth repair in this
     session that stopped at the container.

     AND THE FIX EXPOSED A LATENT DEFECT OF ITS OWN, which is why the item guard
     is here. Creating the `ex` map unmasked it: totalVolume() reads
     `l.ex&&l.ex[m.exId]`, so while `ex` was ABSENT the && short-circuited and a
     null entry in `items` was never dereferenced. With `ex` present it is, and
     the lifetime counter throws. Proved by running the same probe on the
     pre-v418 file, which does not throw. */
  {
    const av = await page.evaluate(async () => {
      const o = {};
      const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
      const base = () => { STATE.logs = {}; STATE.quickLog = {}; };

      /* GUARDS. The arithmetic this whole block rests on has to be real, or
         every assertion below passes on a page where the trap does not exist. */
      o.sortsLast = ['2026-01-01', 'not-a-date'].sort()[1] === 'not-a-date';
      o.nanCompare = ((new Date(todayISO()) - new Date('not-a-date')) / 86400000 > 3) === false;

      const seedOld = extra => {
        base();
        const rows = {};
        for (let i = 0; i < 5; i++) rows[i] = { done: true, completedAt: ago(200 + i), ex: {}, items: [] };
        if (extra) rows[99] = extra;
        STATE.runs = [{ sessions: 5, logs: rows }];
        normalizeState();
      };

      /* GUARD: the clean case really is a stale run, so a 0 below means the
         streak ENDED rather than never started. */
      seedOld(null);
      o.streakCleanOld = computeStreak();
      o.cleanRowsKept = Object.keys(STATE.runs[0].logs).length === 5;

      seedOld({ done: true, completedAt: 'not-a-date', ex: {}, items: [] });
      o.streakWithJunk = computeStreak();
      /* GUARD BEFORE THE FIRST DEREFERENCE. The over-eager mutant that drops
         every archived row was caught by a THROW rather than by name — red is
         not enough, it has to say WHAT — because the lines below dereference a
         row it had removed. */
      o.junkRowKept = !!(((STATE.runs || [])[0] || {}).logs || {})[99];
      o.junkDateGone = o.junkRowKept
        ? STATE.runs[0].logs[99].completedAt === undefined
        : 'ROW GONE';

      /* FLOOR: a CURRENT archived streak is untouched. A scrub that dropped
         every archived row satisfies every assertion above and destroys the
         lifetime history the archive exists to keep. */
      base();
      const cur = {};
      for (let i = 0; i < 4; i++) cur[i] = { done: true, completedAt: ago(3 - i), ex: {}, items: [] };
      STATE.runs = [{ sessions: 4, logs: cur }];
      normalizeState();
      o.streakCurrent = computeStreak();
      o.currentRowsKept = Object.keys((((STATE.runs || [])[0] || {}).logs) || {}).length === 4;
      o.currentDatesKept = o.currentRowsKept
        ? STATE.runs[0].logs[0].completedAt === ago(3)
        : 'ROWS GONE';

      /* THE LIFETIME TOTALS STILL COUNT ARCHIVED WORK, which is the whole
         reason allDoneLogs() folds them in. totalVolume() counts e.sets as an
         ARRAY of MARKED sets — a faked `sets:3` reads as zero work, which is
         how a control comes back {0,0,0} and makes every comparison two zeros
         agreeing. */
      base();
      STATE.runs = [{ sessions: 1, logs: { 0: { done: true, completedAt: ago(1),
        ex: { pushup: { sets: [true, true, true] } },
        items: [{ exId: 'pushup', unit: 'reps', target: 10, sets: 3, rest: 45 }] } } }];
      normalizeState();
      const vol = totalVolume();
      o.archivedVolReps = vol.reps;
      o.archivedVolSets = vol.sets;

      /* THE ITEM GUARD, at the boot and at the reader. A null entry in `items`
         was unreachable while `ex` could be absent; the scrub made it
         reachable, so it needs both. */
      base();
      STATE.runs = [{ sessions: 1, logs: { 0: { done: true, completedAt: ago(1),
        ex: {}, items: [null, 'x', 42, { exId: 'pushup', unit: 'reps', target: 10, sets: 3, rest: 45 }] } } }];
      normalizeState();
      {const _r = (((STATE.runs || [])[0] || {}).logs || {})[0];
       o.itemsRowKept = !!_r;
       o.itemsCleaned = !!_r && Array.isArray(_r.items) && _r.items.length === 1;}
      try { totalVolume(); o.itemsThrew = false; } catch (e) { o.itemsThrew = true; o.itemsErr = String(e).slice(0, 60); }

      /* And the READER on its own, with NO boot behind it — a cross-tab adopt
         replaces STATE and a guard that exists only at the boot is one guard. */
      base();
      STATE.runs = [{ sessions: 1, logs: { 0: { done: true, completedAt: ago(1), ex: {}, items: [null] } } }];
      // deliberately NO normalizeState()
      try { totalVolume(); o.readerThrew = false; } catch (e) { o.readerThrew = true; o.readerErr = String(e).slice(0, 60); }

      /* A row that is not an object at all is dropped, exactly as a live one is. */
      base();
      STATE.runs = [{ sessions: 2, logs: { 0: null, 1: 'x', 2: { done: true, completedAt: ago(1), ex: {}, items: [] } } }];
      normalizeState();
      o.badRowsDropped = Object.keys(STATE.runs[0].logs).length === 1;

      /* ONE PLACE THE RULE LIVES: the live logs go through the same scrub, so a
         fifth date field cannot be taught to one and forgotten for the other. */
      base();
      STATE.logs = { 0: { done: true, completedAt: 'not-a-date', date: 'not-a-date', ex: {}, items: [] } };
      STATE.runs = [];
      normalizeState();
      o.liveStillScrubbed = (STATE.logs[0] || {}).completedAt === undefined
        && (STATE.logs[0] || {}).date === undefined;

      /* THE SECOND DOOR. quickLog is keyed by DATE and computeStreak() folds
         `...Object.keys(STATE.quickLog||{})` into the very list the archived
         rows feed — so closing only the archived door would have been fixing
         one instance and not the class, in the round that says so.
         MEASURED before the fix: the same stale athlete read 1. */
      base();
      for (let i = 0; i < 5; i++) STATE.logs[i] = { done: true, completedAt: ago(200 + i), ex: {}, items: [] };
      STATE.runs = [];
      STATE.quickLog = { 'not-a-date': 1 };
      normalizeState();
      o.quickJunkKeyGone = Object.keys(STATE.quickLog).length === 0;
      o.streakViaQuick = computeStreak();

      /* A value that is not a count of sessions is not a training day either. */
      base();
      STATE.quickLog = { [ago(1)]: 0, [ago(2)]: -3, [ago(3)]: 'x', [ago(4)]: {}, [ago(5)]: 2 };
      normalizeState();
      o.quickBadValsGone = Object.keys(STATE.quickLog).length === 1
        && STATE.quickLog[ago(5)] === 2;

      /* FLOOR: real quick sessions are untouched AND still hold a streak. A
         repair that dropped every key satisfies every assertion above and
         deletes the athlete's own training days. */
      base();
      for (let i = 0; i < 4; i++) STATE.quickLog[ago(3 - i)] = 1;
      STATE.runs = [];
      normalizeState();
      o.quickRealKept = Object.keys(STATE.quickLog).length === 4;
      o.quickRealStreak = computeStreak();

      /* Re-seed: a block that BREAKS what a later one relies on puts it back. */
      base(); STATE.runs = [];
      normalizeState(); go('today');
      return o;
    });

    t.ok('guard: a junk date really does sort AFTER every ISO one', av.sortsLast, av);
    t.ok('guard: and NaN > 3 really is false, which is why the streak did not end', av.nanCompare, av);
    t.ok('guard: the clean stale run really reads 0, so a 0 below means it ENDED', av.streakCleanOld === 0, av);
    t.ok('guard: and its five archived rows really survived the boot', av.cleanRowsKept, av);

    t.eq('a junk date inside an ARCHIVED run no longer props up a dead streak', av.streakWithJunk, 0, av);
    t.ok('the unreadable date is gone from the archived row', av.junkDateGone, av);
    t.ok('FLOOR: and the ROW survives — its sets and items were really done', av.junkRowKept, av);
    t.ok('guard: the items case kept its row, so the assertion below is about the LIST', av.itemsRowKept, av);

    t.ok('FLOOR: a CURRENT archived streak still counts', av.streakCurrent >= 4, av);
    t.ok('FLOOR: and every archived row survives', av.currentRowsKept, av);
    t.ok('FLOOR: with its real date untouched', av.currentDatesKept, av);
    t.eq('FLOOR: archived work still reaches the lifetime totals — reps', av.archivedVolReps, 30, av);
    t.eq('FLOOR: and sets', av.archivedVolSets, 3, av);

    t.ok('a junk entry in an archived items list is dropped at the boot', av.itemsCleaned, av);
    t.ok('so the lifetime counter does not throw', !av.itemsThrew, av);
    t.ok('and with NO boot behind it, the reader does not throw either', !av.readerThrew, av);
    t.ok('an archived row that is not an object is dropped, as a live one is', av.badRowsDropped, av);
    t.ok('and the LIVE logs still go through the same scrub', av.liveStillScrubbed, av);

    /* THE SECOND DOOR — the same phantom streak through quickLog. */
    t.ok('a junk quickLog KEY is gone after the boot', av.quickJunkKeyGone, av);
    t.eq('so it cannot prop up a dead streak either', av.streakViaQuick, 0, av);
    t.ok('a quickLog value that is not a session count is dropped', av.quickBadValsGone, av);
    t.ok('FLOOR: four real quick sessions are all kept', av.quickRealKept, av);
    t.eq('FLOOR: and still hold a streak', av.quickRealStreak, 4, av);
  }


  /* v419 — A COUNT OVER UNVALIDATED KEYS, twice.

     v418 fixed a junk DATE propping up a dead streak. The same shape one level
     up is a COUNT: two surfaces count the keys of a map whose keys nothing
     validates, so one junk key out of an imported backup is a training event
     that never happened.

     1. `reassess` is keyed by CYCLE NUMBER and had only a container check,
        while the "Levelled Up · Complete a re-test" badge is
        `Object.keys(STATE.reassess||{}).length>=1`. MEASURED: locked with no
        re-tests, and UNLOCKED with {'not-a-cycle': …}. commitAssessment()
        writes STATE.reassess[assessState.reassess], a cycle index, so a
        non-integer key was never written by the app.

     2. `achievements` is keyed by BADGE ID, and the Badges tile on
        Progress > Summary is `Object.keys(STATE.achievements||{}).length` while
        the Awards grid renders from ACHIEVEMENTS and lights only the ids it
        finds. MEASURED: the tile read `2 BADGES` with ONE real badge lit — one
        screen, two answers.

     The two readers of `reassess` that do `.map(Number)` were safe only by
     accident: STATE.reassess[NaN] is undefined and both guard `r&&r.maxes`.
     A count has no such guard, which is why the class is about counts. */
  {
    const kc = await page.evaluate(async () => {
      const o = {};
      const rec = d => ({ date: d, level: 'Intermediate', score: 60, testCount: 10,
        subs: {}, maxes: { plank: 70 }, results: {} });

      /* GUARDS. The badge has to exist and mean what the block claims, or every
         assertion below is about a badge that is not there. */
      const badge = ACHIEVEMENTS.filter(a => a.id === 'retest')[0];
      o.badgeExists = !!badge;
      o.badgeDesc = badge ? (typeof badge.desc === 'function' ? badge.desc() : badge.desc) : '';
      /* And a REAL id, read from the app rather than invented — the first
         version of this seeded 'firstsession', which is not a badge, so the
         repair correctly deleted it and the FLOOR read as a failure. */
      o.realBadgeId = ACHIEVEMENTS[0].id;

      // ---- 1. reassess
      STATE.reassess = {}; normalizeState();
      o.lockedClean = !badge.check();
      STATE.reassess = { 'not-a-cycle': rec('2026-02-01') }; normalizeState();
      o.junkCycleGone = Object.keys(STATE.reassess).length === 0;
      o.badgeWithJunk = badge.check();
      /* FLOOR: a real re-test still unlocks it, and its record is untouched. */
      STATE.reassess = { 1: rec('2026-02-01') }; normalizeState();
      o.realCycleKept = Object.keys(STATE.reassess).length === 1
        && (STATE.reassess[1] || {}).date === '2026-02-01'
        && ((STATE.reassess[1] || {}).maxes || {}).plank === 70;
      o.badgeWithReal = badge.check();
      /* Cycle 0 is a legal key and must survive — an over-eager `n>0` would
         drop it and nothing else here would notice. */
      STATE.reassess = { 0: rec('2026-02-01') }; normalizeState();
      o.cycleZeroKept = Object.keys(STATE.reassess).length === 1;
      /* A fractional or padded key is not a cycle index. */
      STATE.reassess = { '3.7': rec('2026-02-01'), '01': rec('2026-02-01'), '-1': rec('2026-02-01') };
      normalizeState();
      o.oddCyclesGone = Object.keys(STATE.reassess).length === 0;

      // ---- 2. achievements
      STATE.reassess = {};
      STATE.achievements = {}; normalizeState();
      /* EACH BLOCK BUILDS THE STATE IT ASSERTS ON. homeSummaryHTML() opens with
         `if(!STATE.baseline)return ''`, and an earlier block in this file
         deliberately leaves the baseline null — so the first version of this
         read NO TILE and the guard is what said so. */
      STATE.baseline = rec('2026-01-01');
      const readTile = async () => {
        setProgressTab('summary'); go('progress');
        await new Promise(r => setTimeout(r, 250));
        const t = ((document.querySelector('#v-progress') || {}).innerText || '');
        /* innerText returns the RENDERED text and `.l` is uppercased in CSS, so
           a search for 'Badges' finds nothing on a screen that says BADGES. */
        const i = t.toUpperCase().indexOf('BADGES');
        if (i < 0) return 'NO TILE';
        const m = t.slice(Math.max(0, i - 12), i).match(/(\d+)\s*$/);
        return m ? m[1] : 'NO NUMBER';
      };
      STATE.achievements = { [o.realBadgeId]: '2026-01-01' }; normalizeState();
      o.achRealKept = Object.keys(STATE.achievements).length === 1;
      o.tileClean = await readTile();
      STATE.achievements = { [o.realBadgeId]: '2026-01-01', 'not-a-badge': '2026-01-02' };
      normalizeState();
      o.achJunkGone = Object.keys(STATE.achievements).length === 1
        && STATE.achievements[o.realBadgeId] === '2026-01-01';
      o.tileWithJunk = await readTile();

      /* FLOOR: every real badge id survives, so the repair cannot be a wipe. */
      STATE.achievements = {};
      ACHIEVEMENTS.forEach(a => { STATE.achievements[a.id] = '2026-01-01'; });
      normalizeState();
      o.allRealKept = Object.keys(STATE.achievements).length === ACHIEVEMENTS.length;

      /* Re-seed: a block that BREAKS what a later one relies on puts it back. */
      STATE.achievements = {}; STATE.reassess = {}; STATE.baseline = null;
      normalizeState(); go('today');
      return o;
    });

    t.ok('guard: the Levelled Up badge exists', kc.badgeExists, kc);
    t.eq('guard: and it is the one that means "complete a re-test"', kc.badgeDesc, 'Complete a re-test', kc);
    t.ok('guard: with no re-tests at all it is LOCKED', kc.lockedClean, kc);

    t.ok('a junk reassess KEY is gone after the boot', kc.junkCycleGone, kc);
    t.ok('so it cannot unlock a re-test badge that was never earned', !kc.badgeWithJunk, kc);
    t.ok('a fractional, padded or negative cycle key is gone too', kc.oddCyclesGone, kc);
    t.ok('FLOOR: a real re-test survives untouched, with its date and its maxes', kc.realCycleKept, kc);
    t.ok('FLOOR: and still unlocks the badge', kc.badgeWithReal, kc);
    t.ok('FLOOR: cycle 0 is a legal key and survives', kc.cycleZeroKept, kc);

    t.ok('guard: the Badges tile really renders a number', kc.tileClean === '1', kc);
    t.ok('a junk achievement KEY is gone after the boot', kc.achJunkGone, kc);
    t.eq('so the Badges tile no longer counts a badge the grid does not light',
      kc.tileWithJunk, '1', kc);
    t.ok('FLOOR: a real badge and its date survive', kc.achRealKept, kc);
    t.ok('FLOOR: and EVERY real badge id survives, so the repair is not a wipe', kc.allRealKept, kc);
  }

  /* ---------- 20. a stored session item list, field by field -------------
     v418 scrubbed the log ROW and stopped at the container, so `items[]`
     carried whatever a backup held — and `logItemsFor()` hands the STORED list
     straight to sessionStats(), totalVolume(), totalTUTSplit() and
     openSessionDetail().

     Measured on the real app before the fix: `psupport` — an exercise that
     really shipped and was really dropped one version later, so it is on real
     phones — made openSessionDetail() throw on `EX[m.exId].name`, and tapping
     a row of your own workout history did nothing at all. `constructor` is
     truthy on an object literal, so an inherited key rendered a movement
     called "Object". A string target reached innerHTML and arbitrary script
     RAN, and the same string printed "~NaN MINUTES" and "3 x abc reps".

     Two guards mean two checks, so the reader is driven with NO boot behind
     it — that is the cross-tab-adopt door, which has no normalizeState(). */
  {
    const si = await page.evaluate(() => {
      const o = {}; const P = 3;
      const keepLogs = JSON.stringify(STATE.logs || {});
      const keepPtr = STATE.progressPtr;
      const good = x => Object.assign({ exId:'pushup', unit:'reps', sets:3, rest:45, target:20 }, x || {});
      const mk = items => { STATE.logs = {}; STATE.logs[P] = { done:true, date:todayISO(),
        completedAt:todayISO(), feel:'ok', ex:{ pushup:{done:true,sets:[1,1,1]} }, items };
        STATE.progressPtr = P + 1; };

      /* GUARDS. Without these the whole block passes on a page where nothing
         was ever dangerous. */
      o.gDropped = !EX['psupport'];                 // the id really is gone
      o.gInherited = !!EX['constructor'];           // and this one really is truthy
      o.gEngineWider = (() => { let mt=0,ms=0,mr=0;
        for (let p=0;p<40;p++) { const s=buildSession(p);
          [...s.main, s.finisher].filter(Boolean).forEach(m => {
            mt=Math.max(mt,m.target); ms=Math.max(ms,m.sets); mr=Math.max(mr,m.rest); }); }
        return mt < ITEM_TARGET_MAX && ms < ITEM_SETS_MAX && mr < ITEM_REST_MAX; })();

      const run = (items, boot) => {
        mk(items); if (boot !== false) normalizeState();
        let threw = null, sheet = '';
        try { openSessionDetail(P); } catch (e) { threw = e.message; }
        try { sheet = (document.getElementById('sheet').innerText || '').replace(/\s+/g,' '); } catch (e) {}
        try { closeSheet(); } catch (e) {}
        const st = sessionStats(P);
        return { threw, kept:(STATE.logs[P].items||[]).length, exTotal:st.exTotal,
                 nan:/NaN|Infinity|undefined/.test(sheet), object:/\bObject\b/.test(sheet),
                 pushup:/Push-Up/.test(sheet) };
      };

      o.dropped  = run([good({ exId:'psupport' })]);
      o.inherit  = run([good({ exId:'constructor' })]);
      o.strTgt   = run([good({ target:'abc' })]);
      o.hugeTgt  = run([good({ target:1e9 })]);
      o.strSets  = run([good({ sets:'3' })]);
      o.badUnit  = run([good({ unit:'furlongs' })]);
      o.real     = run([good()]);                              // FLOOR
      o.mixed    = run([good(), good({ exId:'psupport' })]);   // FLOOR
      o.noBoot   = run([good({ exId:'psupport' })], false);    // the cross-tab door
      /* A guard is only visible when the value beside it cannot supply the
         answer, and here the BOOT was supplying it. The mixed case above runs
         normalizeState() first, so the stored list is already clean, `every()`
         is true and the filter branch is never reached at all. Only a mixed
         list with NO boot can tell "keep the good row" from "fall back to the
         rebuild" — and the rebuild is what a mutant that drops the filter does. */
      o.noBootMixed = run([good(), good({ exId:'psupport' })], false);
      /* And nothing seeded a bad `rest`, which is the other field that prints
         ~NaN MINUTES on the sheet. */
      o.badRest  = run([good({ rest:'abc' })]);

      /* Injection, driven rather than inferred: build the sheet, then read the
         document for the ELEMENT. A substring scan cannot tell an escaped
         string from an unescaped one. */
      window.__pwnItem = 0;
      mk([good({ target:'20<img src=zz-item onerror="window.__pwnItem=1">' })]);
      normalizeState();
      try { openSessionDetail(P); } catch (e) {}
      o.injEl = !!document.querySelector('#sheet img[src="zz-item"]');
      try { closeSheet(); } catch (e) {}

      STATE.logs = JSON.parse(keepLogs); STATE.progressPtr = keepPtr;
      return o;
    });
    await page.waitForTimeout(350);
    si.pwn = await page.evaluate(() => window.__pwnItem);

    t.ok('guard: psupport really is gone from the library', si.gDropped, si);
    t.ok('guard: and an inherited key really is truthy on EX', si.gInherited, si);
    t.ok('guard: the bounds sit outside everything the engine builds', si.gEngineWider, si);

    t.eq('a dropped exercise no longer kills the session-detail sheet', si.dropped.threw, null, si);
    t.ok('and the junk row is gone from STATE', si.dropped.kept === 0, si);
    t.ok('an inherited key never renders a movement called "Object"', !si.inherit.object, si);
    t.ok('a string target never prints NaN on the sheet', !si.strTgt.nan, si);
    t.ok('a string set count is refused too', si.strSets.kept === 0, si);
    t.ok('an absurd target is refused', si.hugeTgt.kept === 0, si);
    t.ok('a unit the library does not have is refused', si.badUnit.kept === 0, si);

    t.ok('no element from a stored item list reaches the document', !si.injEl, si);
    t.eq('and nothing it carried ever runs', si.pwn, 0, si);

    t.ok('FLOOR: a real prescription survives the boot untouched', si.real.kept === 1, si);
    t.eq('FLOOR: and the sheet still names the movement', si.real.pushup, true, si);
    t.eq('FLOOR: it is the stored list that is read, not a rebuild', si.real.exTotal, 1, si);
    t.ok('FLOOR: one bad row does not take a good one with it', si.mixed.kept === 1, si);
    t.ok('a junk rest is refused too — it is the other ~NaN MINUTES source',
      si.badRest.kept === 0, si);
    t.ok('and with NO boot a mixed list keeps the good row rather than falling to the rebuild',
      si.noBootMixed.exTotal === 1, si);
    t.ok('the reader still does not mutate what it filtered', si.noBootMixed.kept === 2, si);

    t.eq('the READER guards too, so a cross-tab adopt cannot throw', si.noBoot.threw, null, si);
    t.ok('and with no boot the stored row is still there — the reader does not mutate',
      si.noBoot.kept === 1, si);
    t.ok('yet nothing unusable reaches a consumer: the list falls back to the rebuild',
      si.noBoot.exTotal > 1, si);
  }

  /* ---------- 21. the saved and recent foods, which had no repair at all ---
     `nutrition.foods` is not in DEFAULT_STATE, so every sweep that enumerated
     the declared fields walked straight past it. Measured on the real app:

       - a NULL row made foodsList() AND foodsSectionHTML() throw on `.fav`,
         and openQuickAdd() builds foodsSectionHTML() — so the Log Food sheet
         was DEAD, and with no boot repair it could never come back;
       - only `name` was escaped, so `kcal` reached innerHTML and arbitrary
         script RAN from a restored backup;
       - a junk row round-tripped back out through logRemembered(), so a
         cleaned list was re-poisoned one tap after the boot.

     The floors are what stop the fix being a wipe: a real list survives
     byte-identical, absent stays ABSENT (creating it fires the "we repaired
     your data" note at every athlete who never saved a food), and the repair
     enforces the WRITER's own bound rather than a different one. */
  {
    await page.evaluate(() => {
      window.__pwnFood = 0;
      nut().foods = [
        { name:'Chicken', kcal:'<img src=zz-food onerror="window.__pwnFood=1">', p:30, c:0, f:5, fav:false, at:2 },
        { name:'Real Food', kcal:200, p:20, c:10, f:5, fav:true, at:3 }
      ];
      normalizeState(); openQuickAdd();
    });
    await page.waitForTimeout(350);
    const rf = await page.evaluate(() => {
      const o = {};
      o.pwn = window.__pwnFood;
      o.injEl = !!document.querySelector('#sheet img[src="zz-food"]');
      try { closeSheet(); } catch (e) {}

      /* GUARD: the picker really does print the numbers this block is about,
         or "no injection" passes on a sheet that renders nothing. */
      nut().foods = [{ name:'Guard Food', kcal:321, p:22, c:11, f:9, fav:false, at:9 }];
      normalizeState();
      o.gPrints = /321/.test(foodsSectionHTML()) && /22p/.test(foodsSectionHTML());

      // the dead Log Food sheet
      nut().foods = [null, 42, 'x', { name:'Ok', kcal:100, p:10, c:0, f:0, fav:false, at:1 }];
      normalizeState();
      /* null, 42 and 'x' are all refused by the TYPE test before the name test
         is ever consulted, so a guard is only visible when the value beside it
         cannot supply the answer: a row that IS an object and simply has no
         name is the one case that reaches it. The name is what the athlete
         recognises the food by — a nameless row is a blank line they cannot
         identify, and every other field is coerced rather than dropped. */
      o.listErr = 'ok'; o.htmlErr = 'ok';
      try { o.listed = foodsList().length; } catch (e) { o.listErr = String(e.message); }
      try { foodsSectionHTML(); } catch (e) { o.htmlErr = String(e.message); }
      o.junkKept = (nut().foods || []).length;
      nut().foods = [{ kcal:100, p:10, c:0, f:0, fav:false, at:1 },
                     { name:'  ', kcal:100, p:10, c:0, f:0, fav:false, at:2 },
                     { name:'Ok', kcal:100, p:10, c:0, f:0, fav:false, at:3 }];
      normalizeState();
      o.namelessKept = (nut().foods || []).length;

      /* `fav` is not a flag, it is a STAR THE ATHLETE TAPPED, and it decides
         whether a row is kept for ever or capped as a recent. A truthy
         non-boolean out of a backup — 1, 'yes', {} — read as a favourite is
         unbounded growth in a list the writer bounds on purpose, and it travels
         in every backup after it. Only a real `true` is a tap; everything else
         is a recent, which is the bounded direction. Nothing seeded one of
         these, so a truthiness read escaped every assertion. */
      nut().foods = [{ name:'A', kcal:1, p:0, c:0, f:0, fav:1,     at:1 },
                     { name:'B', kcal:1, p:0, c:0, f:0, fav:'yes', at:2 },
                     { name:'C', kcal:1, p:0, c:0, f:0, fav:{},    at:3 },
                     { name:'D', kcal:1, p:0, c:0, f:0, fav:true,  at:4 }];
      normalizeState();
      o.favTruthy = (nut().foods || []).filter(x => x.fav).length;
      o.favTypes  = (nut().foods || []).every(x => typeof x.fav === 'boolean');

      // the READER on its own — a cross-tab adopt has no boot behind it
      nut().foods = [null, { name:'Ok', kcal:100, p:10, c:0, f:0, fav:false, at:1 }];
      o.noBoot = 'ok';
      try { foodsSectionHTML(); } catch (e) { o.noBoot = String(e.message); }

      // a junk row must not come back out through the one-tap re-log
      nut().foods = [{ name:'Bad', kcal:'abc', p:{}, c:[], f:null, fav:false, at:1 }];
      normalizeState();
      const before = (nutToday().food || []).length;
      try { logRemembered(0); } catch (e) { o.logThrew = String(e.message); }
      const row = (nutToday().food || [])[before] || {};
      o.roundTrip = typeof row.kcal === 'number' && typeof row.p === 'number';
      o.writerClean = (nut().foods || []).every(x => typeof x.kcal === 'number' && typeof x.p === 'number');
      nutToday().food = (nutToday().food || []).slice(0, before);

      /* The same route with NO boot behind it. A cross-tab adopt leaves the
         list dirty, and the athlete's next tap goes through the writer's
         UPDATE branch — the one that reuses the row it found. Running this
         after normalizeState() cannot see that guard at all, because the boot
         has already coerced the values the writer would be handed. */
      nut().foods = [{ name:'Bad2', kcal:'abc', p:{}, c:[], f:null, fav:false, at:1 }];
      const before2 = (nutToday().food || []).length;
      try { logRemembered(0); } catch (e) { o.logThrew2 = String(e.message); }
      o.writerCleanNoBoot = (nut().foods || [])
        .every(x => typeof x.kcal === 'number' && typeof x.p === 'number');
      nutToday().food = (nutToday().food || []).slice(0, before2);

      // FLOOR: a real list survives the boot byte-identical
      const real = [{ name:'Eggs', kcal:210, p:18, c:1, f:15, fav:true, at:5 },
                    { name:'Rice', kcal:200, p:4, c:44, f:1, fav:false, at:4 }];
      nut().foods = JSON.parse(JSON.stringify(real));
      normalizeState();
      o.floorSame = JSON.stringify(nut().foods) === JSON.stringify(real);

      // FLOOR: the writer still works, favourites still first
      rememberFood('Oats', 150, 5, 27, 3);
      o.afterWrite = (nut().foods || []).map(x => x.name).join(',');

      // FLOOR: absent stays absent
      delete nut().foods; normalizeState();
      o.absentAbsent = nut().foods === undefined;

      // FLOOR: the repair enforces the WRITER's bound, not a different one
      nut().foods = [];
      for (let i = 0; i < 40; i++) nut().foods.push({ name:'r'+i, kcal:10, p:1, c:1, f:1, fav:false, at:i });
      for (let i = 0; i < 5; i++)  nut().foods.push({ name:'fav'+i, kcal:10, p:1, c:1, f:1, fav:true, at:i });
      normalizeState();
      o.capFavs = nut().foods.filter(x => x.fav).length;
      o.capRecents = nut().foods.filter(x => !x.fav).length;
      o.capConst = FOOD_RECENTS_MAX;

      delete nut().foods; normalizeState();
      return o;
    });

    t.ok('guard: the food picker really prints the numbers, not only the name', rf.gPrints, rf);

    t.ok('no element from a saved food reaches the document', !rf.injEl, rf);
    t.eq('and nothing a saved food carried ever runs', rf.pwn, 0, rf);

    t.eq('a null row no longer kills foodsList()', rf.listErr, 'ok', rf);
    t.eq('nor the Log Food sheet it builds', rf.htmlErr, 'ok', rf);
    t.eq('and only the real food is left', rf.junkKept, 1, rf);
    t.eq('a row that is an object but carries no name is dropped too',
      rf.namelessKept, 1, rf);
    t.eq('only a real tap is a favourite — a truthy non-boolean is a recent',
      rf.favTruthy, 1, rf);
    t.ok('and fav is always a boolean afterwards, so a backup cannot carry junk',
      rf.favTypes, rf);
    t.eq('the READER guards too, so a cross-tab adopt cannot kill the sheet', rf.noBoot, 'ok', rf);
    t.ok('the WRITER coerces too, so a dirty list cannot survive the next tap',
      rf.writerCleanNoBoot, rf);

    t.ok('a junk saved food cannot come back out through the one-tap re-log', rf.roundTrip, rf);
    t.ok('and the writer leaves the list clean rather than re-poisoning it', rf.writerClean, rf);

    t.ok('FLOOR: a real saved-food list survives the boot byte-identical', rf.floorSame, rf);
    t.eq('FLOOR: the writer still adds, favourites still first', rf.afterWrite, 'Eggs,Oats,Rice', rf);
    t.ok('FLOOR: absent stays absent, so no athlete is told their data was repaired', rf.absentAbsent, rf);
    t.eq('FLOOR: every favourite is kept, whatever the recents cap', rf.capFavs, 5, rf);
    t.eq('FLOOR: and recents are capped at the WRITER own bound', rf.capRecents, rf.capConst, rf);
    t.eq('guard: and that bound is the app constant, not a number restated here', rf.capConst, 20, rf);
  }

  /* THE GUARD THAT RESCUES EVERY OTHER TICK IS ITSELF A TICK (v425).

     v377 gave five surfaces a rescue and put all of it behind ONE interval,
     armed once at load and never re-armed. Measured with that interval
     cleared: nothing brought it back — not the heartbeat, not
     visibilitychange, not a tap — so every rescue in the app died with it, and
     the four surfaces in timedSurfaces() have no visibilitychange listener of
     their own.

     The session clock was the other unwatched tick: plClear() deliberately
     never touches it and plResync() does not re-arm it, so a reclaimed one
     froze the clock, the PAUSED bar and BOTH nudges for the rest of the
     session.

     A LIVE INTERVAL ID IS NOT EVIDENCE OF A LIVE INTERVAL, which is why every
     case below clears the timer and LEAVES the id in place — a fix that tested
     `!== null` would pass on a phone where nothing ticks. */
  {
    const hb = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const R = {};
      go('today'); openPlayer(0);
      plClear(); plEnterRest(120, 'ex');
      await wait(1100);
      const pausedEl = () => (document.getElementById('plPaused') || {}).textContent || '';

      /* the OS reclaims the SESSION clock */
      clearInterval(_plClock);              // the id is deliberately left behind
      PLAYER.t0 = monoNow() - 180000;
      playerToggle();                       // pause it
      PLAYER.pauseAt = monoNow() - 200000;  // three minutes twenty ago
      _plClockBeat = monoNow() - 60000;     // and it has not beaten for a minute
      R.staleIdLooksAlive = _plClock !== null;
      R.pausedFrozen = pausedEl();
      plGuardTick();
      R.pausedRescued = pausedEl();

      /* FLOOR: a healthy clock is not churned by every beat */
      const idA = _plClock;
      plGuardTick(); plGuardTick();
      R.healthyClockUntouched = _plClock === idA;

      /* the OS reclaims the HEARTBEAT itself */
      clearInterval(_plGuard); _plGuardBeat = monoNow() - 60000;
      const gidA = _plGuard;
      R.guardStaleIdLooksAlive = _plGuard !== null;
      document.dispatchEvent(new Event('visibilitychange'));
      await wait(50);
      R.guardBackOnVisible = _plGuard !== gidA;

      /* and again, by the other event the app already receives */
      clearInterval(_plGuard); _plGuardBeat = monoNow() - 60000;
      const gidB = _plGuard;
      document.body.click();
      await wait(50);
      R.guardBackOnTap = _plGuard !== gidB;

      /* FLOOR: a healthy heartbeat is not re-armed by every tap in the app */
      const gidC = _plGuard;
      document.body.click(); document.body.click();
      R.healthyGuardUntouched = _plGuard === gidC;

      /* FLOOR: a finished session does not get its clock back — plEnterDone()
         stops it on purpose */
      PLAYER.phase = 'done'; plClockStop(); _plClockBeat = monoNow() - 60000;
      plGuardTick();
      R.doneSessionStaysOff = _plClock === null;

      playerQuit();
      R.afterQuit = _plClock;
      R.beatStall = PL_BEAT_STALL_MS;
      R.guardMs = PL_GUARD_MS;
      return R;
    });

    /* GUARDS: without these the whole block passes on a page where a cleared
       interval was already detectable. */
    t.ok('guard: a reclaimed session clock still leaves a live-looking id',
         hb.staleIdLooksAlive, hb);
    t.ok('guard: so does a reclaimed heartbeat', hb.guardStaleIdLooksAlive, hb);
    t.eq('guard: the staleness bar is three guard periods, from the constant',
         hb.beatStall, hb.guardMs * 3, hb);

    t.eq('the PAUSED bar froze where the dead clock left it', hb.pausedFrozen, 'PAUSED 0s', hb);
    t.eq('and the heartbeat re-arms the clock and repaints the real figure',
         hb.pausedRescued, 'PAUSED 3:20', hb);
    t.ok('FLOOR: a healthy clock is left alone', hb.healthyClockUntouched, hb);

    t.ok('a reclaimed heartbeat is re-armed when the page comes back',
         hb.guardBackOnVisible, hb);
    t.ok('and by a tap anywhere, which needs no timer either',
         hb.guardBackOnTap, hb);
    t.ok('FLOOR: a healthy heartbeat is not re-armed by every tap',
         hb.healthyGuardUntouched, hb);
    t.ok('FLOOR: a finished session keeps its clock off', hb.doneSessionStaysOff, hb);
    t.eq('FLOOR: and quitting leaves nothing armed', hb.afterQuit, null, hb);
  }

  /* A RESCUE THAT ARMS AND WAITS LEAVES THE FROZEN FIGURE FROZEN (v427).

     v425 re-armed a reclaimed heartbeat on the page coming back and on a tap.
     plGuardOn() armed the interval and returned, so the first rescue landed up
     to PL_GUARD_MS later — the athlete looks back at the phone and the number
     is still wrong for two seconds. Both siblings already run one pass at once
     and say why: plResync() ticks the phase it re-armed, and plClockEnsure()
     repaints "so a frozen figure moves at once".

     Read SYNCHRONOUSLY. Any await hands the assertion to the interval, which
     is exactly what this exists to stop depending on. */
  {
    const rr = await page.evaluate(() => {
      const R = {};
      go('today');
      openActTimer('ruck');
      const num = () => { const e = document.querySelector('#act-num'); return e ? e.textContent : 'NO ELEMENT'; };

      /* the OS reclaims the surface tick AND the heartbeat, ids left in place */
      clearInterval(ACTT.iv);
      clearInterval(_plGuard);
      ACTT.at = monoNow() - 41 * 60000;
      ACTT.lastTick = monoNow() - 60000;
      _plGuardBeat = monoNow() - 60000;

      R.staleIdsLookAlive = ACTT.iv != null && _plGuard != null;
      R.beatReadsStale = monoNow() - _plGuardBeat > PL_BEAT_STALL_MS;
      R.frozen = num();

      document.dispatchEvent(new Event('visibilitychange'));
      R.onReturn = num();                       // no await: what the athlete sees

      /* FLOOR: an ordinary tap on a healthy heartbeat costs no rescue pass */
      ACTT.at = monoNow() - 9 * 60000;
      actTimerTick();
      const painted = num();
      const liveId = _plGuard;
      document.body.click();
      R.healthyKeptBeat = _plGuard === liveId;
      R.healthyPaint = num() === painted;

      try { actTimerCancel(); } catch (e) {}
      try { closeSheet(); } catch (e) {}
      return R;
    });

    t.ok('guard: both reclaimed timers still leave live-looking ids', rr.staleIdsLookAlive, rr);
    t.ok('guard: and the heartbeat really does read as stale', rr.beatReadsStale, rr);
    t.eq('guard: the stopwatch really was frozen first', rr.frozen, '0:00', rr);

    t.eq('coming back to the page catches the figure up at once, not on the next beat',
         rr.onReturn, '41:00', rr);

    t.ok('FLOOR: a healthy heartbeat is still not re-armed by a tap', rr.healthyKeptBeat, rr);
    t.ok('FLOOR: and an ordinary tap repaints nothing', rr.healthyPaint, rr);
  }

  /* ---- THE SCOPE GUARD TESTED THE WRONG PROPERTY (v428) -----------------
     CacheStorage is scoped to the ORIGIN, so the worker's own comment says it
     must identify OUR directory explicitly and let every other app on the
     origin fetch as if this worker did not exist. The test it used compared the
     POSITION of the last slash against the length of the scope — a statement
     about how many characters another app's folder name has, not about whose
     folder it is. Any sibling app whose directory name is the same length read
     as ours: served from our cache and written into it.

     The harness serves at the ROOT, where the scope is a single slash and both
     rules agree, so no page can reach the defect. The predicate is therefore
     exercised DIRECTLY, the technique the hardness-band and anchor-unit guards
     use — read the function out of the shipped file and run a table through it,
     with the OLD rule beside it as proof the trap is real. */
  {
    const swSrc = readFileSync('sw.js', 'utf8');
    const m = swSrc.match(/function inScopeDir\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    const fn = m ? new Function('return ' + m[0] + '; ')() : null;
    const old = (path, scope) => path.lastIndexOf('/') === scope.length - 1;

    const SC = '/Workout-/';
    const cases = [
      // path, scope, ours?
      ['/Workout-/ex-pushup.jpg', SC, true],   // FLOOR: our own flat asset
      ['/Workout-/sw.js', SC, true],           // FLOOR: our own worker
      ['/Workout-/img/a.jpg', SC, false],      // FLOOR: a deeper path is not ours
      ['/Fitness2/a.jpg', SC, false],          // same-length sibling directory
      ['/commandx/a.jpg', SC, false],          // another one
      ['/a.jpg', SC, false],                   // the origin root
      ['/x.jpg', '/', true],                   // FLOOR: root scope, flat file
      ['/sub/x.jpg', '/', false],              // FLOOR: root scope, deeper path
    ];
    const got = fn ? cases.map(c => !!fn(c[0], c[1])) : [];
    const want = cases.map(c => c[2]);
    const oldGot = cases.map(c => !!old(c[0], c[1]));

    t.ok('sw.js names its scope test as a predicate', !!fn, m ? m[0].slice(0, 120) : swSrc.slice(0, 80));
    /* GUARD: the trap is real. Without this, "the new rule is right" is
       satisfied by a rule that was never wrong. */
    t.ok('guard: the old rule really did read a same-length sibling as ours',
         oldGot[3] === true && oldGot[4] === true, { oldGot });
    t.eq('and the predicate answers by DIRECTORY, not by slash position', got, want,
         { got, want, cases: cases.map(c => c[0] + ' @ ' + c[1]) });
    /* FLOOR: root scope is unchanged in both directions — the harness and any
       app published at the origin root must behave exactly as before. */
    t.eq('FLOOR: at the root scope the two rules still agree',
         [got[6], got[7]], [oldGot[6], oldGot[7]], { got, oldGot });
    /* And the handler must ASK it rather than restate it. A check counting the
       declaration passes while the call site keeps its own copy — the drift the
       predicate exists to stop. Comments are stripped first: prose that quotes
       the rule is counted by a scan for the rule. */
    const noCmt = swSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    t.ok('and the fetch handler asks the predicate',
         /inOurDir\s*=\s*inScopeDir\s*\(/.test(noCmt), noCmt.match(/const inOurDir[^\n]*/));
    t.eq('and the slash-position rule is gone from the code',
         (noCmt.match(/lastIndexOf\('\/'\)/g) || []).length, 0);
  }

  /* ---- WHICH TABS A #hash MAY OPEN WAS WRITTEN BY HAND, TWICE (v428) -----
     Three lines apart, identical, with nothing tying either copy to the nav
     bar. Seven views exist and six have a button; 'quick' correctly has no
     button and no deep link, but only by the coincidence of two hand-written
     lists agreeing. */
  {
    const ht = await page.evaluate(() => {
      const o = {};
      o.buttons = $$('.nav button').map(b => b.dataset.tab);
      o.views = [...document.querySelectorAll('.view')].map(v => v.id.replace(/^v-/, ''));
      /* The SET, not the order — the views are laid out in a different order
         from the nav bar, and neither order is a requirement. */
      o.accepted = o.views.filter(v => !!hashTab(v)).sort();
      o.buttonsSorted = o.buttons.slice().sort();
      o.junk = ['helicopter', '', 'constructor', 'toString'].map(h => hashTab(h));
      return o;
    });
    /* GUARD: the nav really was read, and there really is a view with no
       button — otherwise "it matches the buttons" passes on any list at all. */
    t.ok('guard: the nav bar has buttons to read', ht.buttons.length >= 6, ht);
    t.ok('guard: and a view exists that has no button',
         ht.views.length > ht.buttons.length, ht);
    /* GUARD: it answers for a real tab AT ALL. hashTab() catches into '', so a
       broken helper does not throw — it silently refuses every deep link, and
       the app looks merely unhelpful rather than broken. That is exactly what
       happened on the first attempt here: it read the single-element helper
       instead of the array one, .some() threw, and every home-screen shortcut
       would have stopped opening its tab with nothing on screen to say so. */
    t.ok('guard: the helper answers for a real tab at all', ht.accepted.length > 0, ht);
    t.eq('a #hash may open exactly the tabs the nav bar offers', ht.accepted, ht.buttonsSorted, ht);
    /* MEMBERSHIP, not truthiness: an inherited key is truthy, and the value
       reaches go(), which throws on a view that does not exist. */
    t.eq('and nothing else, inherited keys included', ht.junk, ['', '', '', ''], ht);
    const src = readFileSync('index.html', 'utf8');
    const noCmt = src.replace(/\/\*[\s\S]*?\*\//g, '');
    t.eq('and the tab list is not written out by hand any more',
         (noCmt.match(/\['today','program','fuel','progress','ref','guide'\]/g) || []).length, 0);

    /* AND THE ROUTE IS DRIVEN, not the helper called. A home-screen shortcut
       into an app that is already open is a same-document hash change — boot()
       never runs — which is the whole reason that listener exists. */
    const nav = await page.evaluate(async () => {
      const o = {};
      /* BUILD THE STATE THIS BLOCK ASSERTS ON. The listener is gated on
         STATE.onboarded, and an earlier block in this long file leaves the
         athlete un-onboarded — so a bare drive reports the tab never moving
         and looks exactly like a dead route. It also starts from a KNOWN
         hash: assigning the value already in the bar fires nothing. */
      STATE.onboarded = true;
      let fired = 0;
      const count = () => fired++;
      window.addEventListener('hashchange', count);
      const settle = () => new Promise(r => setTimeout(r, 120));
      location.hash = '#today';
      await settle();
      go('today');
      o.start = TAB;

      location.hash = '#fuel';
      await settle();
      o.firedForReal = fired;
      o.opened = TAB;

      location.hash = '#quick';                 // a view with no button
      await settle();
      o.refused = TAB;

      window.removeEventListener('hashchange', count);
      try { location.hash = '#today'; } catch (e) {}
      await settle();
      go('today');
      return o;
    });
    /* GUARD: the event really fired, or "the tab did not move" is a statement
       about a listener that was never reached. */
    t.eq('guard: the block starts on Today', nav.start, 'today', nav);
    t.ok('guard: and the hash change really fired', nav.firedForReal > 0, nav);
    t.eq('a #hash for a real tab opens it in an app that is already running', nav.opened, 'fuel', nav);
    t.eq('FLOOR: and a view with no button is left where it was', nav.refused, 'fuel', nav);
  }

  /* ---- EVERY THEME PAINTS EVERY PROPERTY IT IS ASKED FOR (v428) ----------
     applyTheme() reads five fields with NO fallback and writes each straight
     into a custom property. setProperty with an undefined value writes the
     literal text "undefined" — measured in a real browser, not reasoned — so
     the property is set to an invalid value and every rule reading it computes
     to unset. One field falls back to a real default and is allowed absent,
     the distinction v364 drew for GOAL_NOTE. */
  {
    const th = await page.evaluate(() => {
      const o = {};
      /* GUARD: setProperty really does write the word, or the harm this rule
         describes does not exist and the rule is padding. */
      const r = document.documentElement.style;
      const keep = r.getPropertyValue('--cf-probe');
      r.setProperty('--cf-probe', undefined);
      o.undefinedIsWritten = r.getPropertyValue('--cf-probe').trim();
      r.removeProperty('--cf-probe');
      if (keep) r.setProperty('--cf-probe', keep);

      const need = ['acc', 'acc2', 'accInk', 'soft', 'name'];
      o.missing = {};
      Object.keys(THEMES).forEach(k => {
        const bad = need.filter(f => typeof THEMES[k][f] !== 'string' || !THEMES[k][f].trim());
        if (bad.length) o.missing[k] = bad;
      });
      o.defaultIsATheme = !!THEMES[THEME_DEFAULT];

      /* And the validator has to COMPLAIN — "the validator is clean" stays
         clean whether the rule exists or not. console.error is muted: the
         harness counts one as a page failure. */
      const oe = console.error; const seen = [];
      console.error = (...a) => seen.push(a.join(' '));
      const k0 = Object.keys(THEMES)[0];
      const keepAcc = THEMES[k0].acc, keepDef = THEME_DEFAULT;
      try {
        delete THEMES[k0].acc;
        seen.length = 0; validateData();
        o.complainsMissing = seen.join(' ').indexOf('THEMES.' + k0 + ': no "acc"') >= 0;
        THEMES[k0].acc = keepAcc;
        /* FLOOR: the optional field must NOT be demanded — it has a real
           fallback, so a rule that required it would reject correct data. */
        const keep3 = THEMES[k0].acc3; delete THEMES[k0].acc3;
        seen.length = 0; validateData();
        o.optionalNotDemanded = seen.length === 0;
        THEMES[k0].acc3 = keep3;
        /* And the DEFAULT-theme rule needs its own data broken in front of it.
           Asserting THEMES[THEME_DEFAULT] is truthy is a statement about the
           DATA — it stays true whether or not the rule exists, which is how a
           mutant that disabled the rule escaped. THEME_DEFAULT is a top-level
           const and cannot be reassigned, so the theme it NAMES is what gets
           removed; that is the same lookup the rule performs. */
        const keepDefTheme = THEMES[keepDef]; delete THEMES[keepDef];
        seen.length = 0; validateData();
        o.complainsDefault = seen.join(' ').indexOf('THEME_DEFAULT') >= 0;
        THEMES[keepDef] = keepDefTheme;
        seen.length = 0; validateData();
        o.cleanAfter = seen.length;
      } catch (e) {
        o.err = String(e.message);
        THEMES[k0].acc = keepAcc;
      }
      console.error = oe;
      o.defaultStillReal = THEME_DEFAULT === keepDef;
      return o;
    });
    t.eq('guard: setProperty(x, undefined) really writes the word', th.undefinedIsWritten, 'undefined', th);
    t.eq('every theme carries every field applyTheme() reads raw', th.missing, {}, th);
    t.ok('and the default is a real theme', th.defaultIsATheme, th);
    t.ok('the validator complains about a theme missing one', th.complainsMissing, th);
    t.ok('and complains when the default names no theme at all', th.complainsDefault, th);
    t.ok('FLOOR: and says nothing about the field that has a real fallback',
         th.optionalNotDemanded, th);
    t.eq('and is clean once it is restored', th.cleanAfter, 0, th);
  }

  /* ---- THE THIRD WRITER INTO THE DAY'S FOOD (v428) -----------------------
     v346 made pushFoodRow() the single writer so a third one could not forget
     the habit sync. There were already TWO more, both REPLACING a row in place
     with a hand-written literal: the edit sheet and a dashboard screenshot
     landing on an earlier import. The edit one forgot the sync and reported a
     success it had not achieved. */
  {
    const fe = await page.evaluate(() => {
      const o = {}; const T = () => document.querySelector('#toast').textContent;
      go('fuel');
      STATE.nutrition.proteinTarget = 165;
      const d = nutToday(); d.food = []; d.habits = {};
      logFood('Big steak', 900, 200, 0, 30, 'd', '', '', '');
      o.before = { p: foodTotals().p, tick: !!nutToday().habits.protein };
      o.atWas = nutToday().food[0].at;

      /* DOWN through the athlete's own route — editFood() then saveFood(),
         not the helper. Calling the helper is not driving the route. */
      editFood(0);
      /* GUARD, before the first dereference. If the sheet did not open, every
         line below throws and the suite reports "the test file itself threw"
         rather than naming a check — measured on the over-eager rowAt() twin,
         which returns null for every index so editFood() returns early. Red is
         not enough; it has to say what. */
      o.sheetOpened = !!document.querySelector('#fa-p');
      if (!o.sheetOpened) return o;
      document.querySelector('#fa-p').value = '40';
      document.querySelector('#fa-kcal').value = '300';
      saveFood();
      o.down = { p: foodTotals().p, tick: !!nutToday().habits.protein,
                 toast: T(), rows: nutToday().food.length };
      o.atKept = nutToday().food[0].at === o.atWas;

      /* FLOOR: and BACK UP. A fix that only ever un-ticked would satisfy
         every assertion above. */
      editFood(0);
      document.querySelector('#fa-p').value = '200';
      document.querySelector('#fa-kcal').value = '900';
      saveFood();
      o.up = { p: foodTotals().p, tick: !!nutToday().habits.protein };

      /* The row is gone between opening the sheet and tapping Save — midnight
         rolls nutToday() onto an empty day, or another tab replaced STATE. */
      const dd = nutToday(); dd.food = []; dd.habits = {};
      logFood('Snack', 200, 10, 20, 5, 'l', '', '', '');
      editFood(0);
      nutToday().food = [];
      saveFood();
      o.gone = { rows: nutToday().food.length, toast: T() };
      try { closeSheet(); } catch (e) {}
      return o;
    });

    /* GUARD: the log really did tick it, or every reading below is two falses
       agreeing. */
    t.ok('guard: the edit sheet opened at all', fe.sheetOpened, fe);
    t.ok('guard: 200 g against a 165 g target ticks the protein habit', fe.before.tick, fe);
    t.eq('guard: and the day really was at 200 g', fe.before.p, 200, fe);

    /* Read through a fallback: the guard above returns the PARTIAL result when
       the sheet never opened, and an assertion that dereferences it throws —
       which reports "the test file itself threw" instead of naming the guard
       that already knows the answer. Guard, return the partial, and let the
       named assertions report. */
    const _d = fe.down || {}, _u = fe.up || {}, _g = fe.gone || {};
    t.eq('correcting a row down moves the day with it', _d.p, 40, fe);
    t.ok('and the protein habit un-ticks with it', !_d.tick, fe);
    t.eq('FLOOR: correcting it back up ticks it again', [_u.p, _u.tick], [200, true], fe);
    t.ok('and the time it was eaten survives a correction', fe.atKept, fe);
    t.eq('FLOOR: an ordinary edit still reports the update', _d.toast, 'Updated ✓', fe);

    t.eq('a row that has gone is not silently claimed as updated', _g.rows, 0, fe);
    t.ok('and the athlete is told nothing changed',
         /no longer there/.test(_g.toast || '') && !/Updated/.test(_g.toast || ''), fe);

    /* AND THE SCREENSHOT-REPLACE BRANCH WAITS FOR ITS WRITE TOO. prevShotIdx()
       names a row that exists a line earlier, so the decline is unreachable by
       tapping — it is DRIVEN by stubbing that helper, the technique the
       hardness-band and anchor-unit guards use. Claiming a replacement that
       did not happen is the same defect as the edit branch's toast; falling
       through APPENDS, which is what an import with nothing to replace does. */
    const shot = await page.evaluate(() => {
      const o = {}; const T = () => document.querySelector('#toast').textContent;
      const d = nutToday(); d.food = []; d.habits = {};
      logFood('Mon, Sep 4', 1005, 102, 71, 50, 'l', '', '', 'shot');
      o.before = nutToday().food.length;

      const keep = prevShotIdx;
      prevShotIdx = () => 9999;                    // a row that is not there
      openQuickAdd({ name: 'Mon, Sep 4', kcal: 1235, p: 120, c: 90, f: 55 });
      saveFood._fromShot = true;
      saveFood();
      prevShotIdx = keep;

      o.rows = nutToday().food.length;
      o.lastKcal = nutToday().food[nutToday().food.length - 1].kcal;
      o.lastSrc = nutToday().food[nutToday().food.length - 1].src;
      o.toast = T();
      try { closeSheet(); } catch (e) {}
      return o;
    });
    t.eq('guard: the day started with one imported row', shot.before, 1, shot);
    t.eq('a replace that could not write appends instead of vanishing', shot.rows, 2, shot);
    t.eq('and the new row is the one that landed', shot.lastKcal, 1235, shot);
    t.eq('and it still carries the running-total marker', shot.lastSrc, 'shot', shot);
    t.ok('and nothing claims a replacement that did not happen',
         !/Replaced your earlier import/.test(shot.toast), shot);

    /* AND THE CLASS IS CLOSED, not the instance. A check aimed at the edit
       sheet proves nothing about the next writer somebody adds; the day's food
       array may be written only through the two helpers that sync the habit. */
    const src = readFileSync('index.html', 'utf8');
    const noCmt = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const idxWrites = (noCmt.match(/\bfood\[[A-Za-z0-9_]+\]\s*=[^=]/g) || []).length;
    const pushes = (noCmt.match(/\bfood\.push\(/g) || []).length;
    t.eq('exactly one place writes a row into the day by index', idxWrites, 1, { idxWrites });
    t.eq('and exactly one place appends to it', pushes, 1, { pushes });
    /* GUARD: the scan can see a write at all — an empty count is otherwise a
       statement about the pattern. */
    t.ok('guard: the scan really matches a write',
         /\bfood\[[A-Za-z0-9_]+\]\s*=[^=]/.test('d.food[i]=row;'), {});
  }

  /* ---- AN INHERITED KEY IS NOT AN ARRAY INDEX (v429) --------------------
     Found by auditing v428 an hour after it merged. replaceFoodRow() guarded
     `!d.food[i]` — and d.food['__proto__'] reads back Array.prototype, which
     is TRUTHY, so the guard passed and the next line reassigned the array's
     own prototype. Measured before the fix: push and reduce both gone and
     syncProteinHabit() threw on f.reduce, leaving the day's food list broken
     until the next boot.

     Not reachable by tapping — editFood() passes a numeric literal and
     prevShotIdx() returns a number — which is the same call v416 made about
     the only two-level computed write, and the v400 shape where an inherited
     key satisfied every `EX[id] &&` guard in the app. */
  {
    const ix = await page.evaluate(() => {
      const o = {};
      go('fuel');
      const d = nutToday(); d.food = []; d.habits = {};
      logFood('Real meal', 500, 40, 20, 15, 'l');

      /* GUARDS: the trap is real, or every assertion below passes on a shape
         that was never dangerous. */
      o.inheritedIsTruthy = !!d.food['__proto__'];
      o.inheritedIsArrayProto = d.food['__proto__'] === Array.prototype;

      /* The pre-fix code THROWS here — reassigning the prototype takes
         reduce with it, and syncProteinHabit() is the next line. A throw out
         of page.evaluate is reported as "the test file itself threw", which
         is red without saying WHAT, so it is caught and recorded instead and
         the named assertions below do the reporting. */
      o.junkThrew = false;
      try { o.junkResult = replaceFoodRow('__proto__', 'X', 100, 1, 1, 1, 'l', '', '', null); }
      catch (e) { o.junkThrew = true; o.junkResult = 'threw'; }
      const a = nutToday().food;
      o.stillAnArray = Array.isArray(a);
      o.protoIntact = Object.getPrototypeOf(a) === Array.prototype;
      o.stillHasPush = typeof a.push === 'function';
      o.rowsAfterJunk = a.length;
      o.realRowKcal = a[0] && a[0].kcal;

      /* FLOOR: a real index still replaces, or the fix is a deletion. */
      try {
        o.realResult = replaceFoodRow(0, 'Corrected', 300, 20, 10, 8, 'l', '', '', null);
        o.afterReal = { rows: nutToday().food.length, kcal: nutToday().food[0].kcal };
        /* FLOOR: an index past the end is still refused, and a negative one. */
        o.oob = replaceFoodRow(9999, 'Y', 100, 1, 1, 1, 'l', '', '', null);
        o.neg = replaceFoodRow(-1, 'Y', 100, 1, 1, 1, 'l', '', '', null);
        o.frac = replaceFoodRow(0.5, 'Y', 100, 1, 1, 1, 'l', '', '', null);
        o.rowsAtEnd = nutToday().food.length;
      } catch (e) { o.floorThrew = String(e && e.message); o.afterReal = o.afterReal || {}; }
      return o;
    });
    t.ok('guard: an inherited key really reads back truthy on the food array',
         ix.inheritedIsTruthy && ix.inheritedIsArrayProto, ix);
    t.eq('a key that is not an array index is refused', ix.junkResult, false, ix);
    t.eq('and nothing threw on the way', ix.junkThrew, false, ix);
    t.eq('FLOOR: nor on any of the real calls after it', ix.floorThrew, undefined, ix);
    t.ok('and the day\'s food list keeps its own prototype', ix.protoIntact, ix);
    t.ok('so it is still an array that can be appended to',
         ix.stillAnArray && ix.stillHasPush, ix);
    t.eq('and the real row is untouched', ix.realRowKcal, 500, ix);
    t.eq('FLOOR: a real index still replaces', ix.realResult, true, ix);
    t.eq('FLOOR: and writes the corrected figure', ix.afterReal.kcal, 300, ix);
    t.eq('FLOOR: an index past the end is still refused', ix.oob, false, ix);
    t.eq('FLOOR: and a negative one', ix.neg, false, ix);
    t.eq('FLOOR: and a fraction', ix.frac, false, ix);
    t.eq('FLOOR: none of them added a row', ix.rowsAtEnd, 1, ix);
  }

  /* ---- FIXING ONE INSTANCE IS NOT FIXING THE CLASS (v430) ---------------
     v429 fixed the one index-taking WRITER. Six more row helpers took an
     index and guarded it the same wrong way — a truthiness read of list[i],
     which an INHERITED key satisfies. They fail differently and worse:
     splice() coerces a non-numeric key to 0, so removeFood('__proto__')
     deletes the athlete's FIRST row, silently.

     Not reachable by tapping — every caller renders a numeric index — so
     this is the same latent-class call v416 and v429 made. rowAt() is the
     one predicate; the class is closed rather than the instance. */
  {
    const cls = await page.evaluate(() => {
      const o = {};
      window.confirm = () => true;
      go('fuel');

      /* GUARD: the trap is real in BOTH of its shapes, or every assertion
         below passes on a receiver that was never dangerous. */
      const probe = ['a', 'b'];
      o.inheritedIsTruthy = !!probe['__proto__'];
      probe.splice('__proto__', 1);
      o.spliceCoercesToZero = (probe.length === 1 && probe[0] === 'b');

      /* removeFood — the day's own food list. */
      const d = nutToday(); d.food = []; d.habits = {};
      logFood('First', 500, 40, 20, 15, 'l');
      logFood('Second', 300, 10, 30, 5, 'l');
      removeFood('__proto__');
      o.foodAfterJunk = nutToday().food.map(x => x.name);
      removeFood(0);
      o.foodAfterReal = nutToday().food.map(x => x.name);

      /* removeAct — the ruck record. */
      STATE.ruckLog = [];
      logAct('ruck', 30); logAct('ruck', 45);
      removeAct('ruck', '__proto__');
      o.actAfterJunk = STATE.ruckLog.map(x => x.mins);
      removeAct('ruck', 0);
      o.actAfterReal = STATE.ruckLog.map(x => x.mins);

      /* removeSkip — the skipping record. */
      STATE.skipLog = [];
      logSkip(10, 1); logSkip(20, 2);
      removeSkip('__proto__');
      o.skipAfterJunk = STATE.skipLog.map(x => x.mins);
      removeSkip(0);
      o.skipAfterReal = STATE.skipLog.map(x => x.mins);

      /* delFav — a saved custom workout. */
      STATE.customFav = [{ name: 'Keep me', items: [{ exId: 'pushup' }] },
                         { name: 'Second', items: [{ exId: 'squat' }] }];
      delFav('__proto__');
      o.favAfterJunk = (STATE.customFav || []).map(x => x.name);
      delFav(0);
      o.favAfterReal = (STATE.customFav || []).map(x => x.name);

      /* quickPick — an index into the built-in food list. */
      nutToday().food = [];
      quickPick('__proto__');
      o.rowsAfterJunkPick = nutToday().food.length;
      quickPick(0);
      o.rowsAfterRealPick = nutToday().food.length;
      o.realPickName = (nutToday().food[0] || {}).name;

      /* editFood — a READ that used to open the sheet on Array.prototype. */
      closeSheet();
      editFood('__proto__');
      o.sheetOpenedOnJunk = !!($('#fa-name'));
      editFood(0);
      o.sheetOpenedOnReal = !!($('#fa-name'));
      closeSheet();

      /* openFoodAmount — an index into the reference food list. */
      go('ref');
      openFoodAmount('__proto__');
      o.amountOpenedOnJunk = !!($('#ref-amt'));
      closeSheet();
      openFoodAmount(0);
      o.amountOpenedOnReal = !!($('#ref-amt'));
      closeSheet();
      return o;
    });

    t.ok('guard: an inherited key reads back truthy, and splice coerces it to 0',
         cls.inheritedIsTruthy && cls.spliceCoercesToZero, cls);

    t.eq('a junk index removes no food row', cls.foodAfterJunk.join(','), 'First,Second', cls);
    t.eq('FLOOR: and a real index removes exactly that one', cls.foodAfterReal.join(','), 'Second', cls);
    t.eq('a junk index removes no activity row', cls.actAfterJunk.join(','), '45,30', cls);
    t.eq('FLOOR: and a real index removes exactly that one', cls.actAfterReal.join(','), '30', cls);
    t.eq('a junk index removes no skipping row', cls.skipAfterJunk.join(','), '20,10', cls);
    t.eq('FLOOR: and a real index removes exactly that one', cls.skipAfterReal.join(','), '10', cls);
    t.eq('a junk index deletes no saved workout', cls.favAfterJunk.join(','), 'Keep me,Second', cls);
    t.eq('FLOOR: and a real index deletes exactly that one', cls.favAfterReal.join(','), 'Second', cls);
    t.eq('a junk index logs no quick-pick food', cls.rowsAfterJunkPick, 0, cls);
    t.eq('FLOOR: and a real index still logs one', cls.rowsAfterRealPick, 1, cls);
    t.ok('FLOOR: with a real name on it', !!cls.realPickName && cls.realPickName !== 'undefined', cls);
    t.eq('a junk index opens no edit sheet', cls.sheetOpenedOnJunk, false, cls);
    t.eq('FLOOR: and a real index still opens it', cls.sheetOpenedOnReal, true, cls);
    t.eq('a junk index opens no food-amount sheet', cls.amountOpenedOnJunk, false, cls);
    t.eq('FLOOR: and a real index still opens it', cls.amountOpenedOnReal, true, cls);

    /* The rule has to be ASKED FOR, not merely declared: a check that counts
       the declaration passes while a consumer keeps its own guard, which is
       exactly the drift this predicate exists to stop (v322, v368). */
    const src = await page.evaluate(() => {
      let best = '';
      document.querySelectorAll('script:not([src])').forEach(s => {
        if (s.textContent.length > best.length) best = s.textContent;
      });
      return best.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    });
    t.ok('guard: the source scan really read the app', src.indexOf('function rowAt(') >= 0, { len: src.length });
    const askers = ['removeAct', 'removeSkip', 'delFav', 'removeFood', 'editFood',
                    'quickPick', 'replaceFoodRow', 'openFoodAmount', 'logFoodFromList'];
    const notAsking = askers.filter(fn => {
      const i = src.indexOf('function ' + fn + '(');
      if (i < 0) return true;
      const body = src.slice(i, i + 600);
      return body.indexOf('rowAt(') < 0;
    });
    t.eq('every index-taking row helper asks the one predicate', notAsking.join(','), '', { notAsking });

    /* The RANGE half of the predicate cannot be reached through any screen:
       for a genuine array `l[-1]` and `l[9999]` are both undefined, so the
       truthiness of l[i] already answers. The one input that tells them apart
       is a NEGATIVE own property on the array object — a string key, which is
       exactly the shape this round is about — so it is exercised DIRECTLY,
       the technique the hardness-band and anchor-unit guards use.

       The `i < l.length` half is EQUIVALENT and is recorded as such rather
       than papered over: defining an index property on an array updates its
       length, so no input can make an in-range read differ from an
       out-of-range one. It is kept as intent. */
    const rng = await page.evaluate(() => {
      const o = {};
      const a = ['first', 'second'];
      a[-1] = 'not a row';
      o.negIsTruthy = !!a[-1];          // GUARD: the trap is real
      o.negRefused = rowAt(a, -1);
      o.realKept = rowAt(a, 0);
      o.pastEnd = rowAt(a, 9999);
      return o;
    });
    t.ok('guard: a negative own property on an array really reads back truthy',
         rng.negIsTruthy, rng);
    t.eq('and the predicate refuses a negative index anyway', rng.negRefused, null, rng);
    t.eq('FLOOR: a real index is still returned', rng.realKept, 'first', rng);
    t.eq('FLOOR: and one past the end is still refused', rng.pastEnd, null, rng);
  }

  /* ---------------------------------------------------------------------
     v430: a date that is not a date became TODAY'S weigh-in.

     dedupeMeasurements() clamps a FUTURE date to today — written for a
     clock-skew row, which is a real measurement stamped wrong. String({}) is
     "[object Object]", and "[object Ob" sorts ABOVE any "20xx-" date, so the
     clamp fired on junk and rewrote it into today. Measured before the fix:
     a row with no usable date at all became today's weigh-in and
     latestWeightKg() returned its 200 kg — the figure that drives the calorie
     target, the projection, the goal pace and the chart.

     And the row's own figures had no repair at all, while the WRITER has
     always enforced plausibleKg (25-350) and plausibleWaistCm (40-250). A
     numeric string survived every boot and latestWeightKg() handed a string
     to every calorie reader. Measured: inert on the glass (every pane
     byte-identical), so the cost is the v285 one — junk in every backup.

     The floors are what stop this being a delete: a real history is
     byte-identical, the repair is idempotent (v390 — a repair that changes a
     settled state fires "we repaired your data" at every athlete for ever),
     the clock-skew clamp still works, a timestamped date still collapses, and
     BOTH band edges survive, because a guard earns its keep only if it
     provably cannot fire on a legitimate input. */
  {
    const ms = await page.evaluate(() => {
      const o = {};
      const T = todayISO();
      const tom = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return localISO(d); })();

      // GUARD: the trap is real — a stringified object really does sort above a date
      o.junkSortsAbove = ('[object Ob' > T);

      // a date that is not a date is dropped, not clamped into today
      STATE.measurements = [{ date: '2026-08-01', waist: 96, weight: 86 },
                            { date: { bad: 1 }, waist: null, weight: 200 }];
      normalizeState();
      o.junkRows = STATE.measurements.length;
      o.junkDates = STATE.measurements.map(m => m.date).join(',');
      o.junkLatest = latestWeightKg();

      // a payload date is dropped the same way
      STATE.measurements = [{ date: '<img src=x onerror="window.__pwn=1">', waist: 96, weight: 86 }];
      normalizeState();
      o.payloadRows = STATE.measurements.length;

      // a numeric string is coerced to the number the athlete entered
      STATE.measurements = [{ date: '2026-08-01', waist: 96, weight: 86 },
                            { date: '2026-08-15', waist: null, weight: '84' }];
      normalizeState();
      o.strWeight = STATE.measurements[1] && STATE.measurements[1].weight;
      o.strType = typeof latestWeightKg();

      // a figure outside the band the writer enforces is dropped, and a row
      // left carrying nothing goes with it
      STATE.measurements = [{ date: '2026-08-01', waist: 96, weight: 86 },
                            { date: '2026-08-10', waist: '<b>x</b>', weight: null },
                            { date: '2026-08-12', waist: 9999, weight: 0.5 }];
      normalizeState();
      o.bandRows = STATE.measurements.length;
      o.bandDates = STATE.measurements.map(m => m.date).join(',');

      // FLOOR: a real history is byte-identical, TWO decimals included — a
      // metric athlete's weight is stored raw, so rounding here would rewrite
      // a legitimate figure and fire the repair note at them about nothing
      const real = [{ date: '2026-06-01', waist: 99, weight: 90 },
                    { date: '2026-07-01', waist: 97.25, weight: 88 },
                    { date: '2026-08-01', waist: 96, weight: 86.44 }];
      STATE.measurements = JSON.parse(JSON.stringify(real));
      normalizeState();
      o.realSame = JSON.stringify(STATE.measurements) === JSON.stringify(real);
      // FLOOR: and it stays that way — a settled state is not repaired
      normalizeState(); normalizeState();
      o.idempotent = JSON.stringify(STATE.measurements) === JSON.stringify(real);

      // FLOOR: a clock-skew row is still clamped to today, not dropped
      STATE.measurements = [{ date: tom, waist: null, weight: 85 }];
      normalizeState();
      o.skewDate = (STATE.measurements[0] || {}).date;
      o.today = T;

      // FLOOR: a timestamped date still collapses onto its own day
      STATE.measurements = [{ date: '2026-08-05T08:00:00Z', waist: null, weight: 85 },
                            { date: '2026-08-05', waist: 94, weight: null }];
      normalizeState();
      o.stampRows = STATE.measurements.length;
      o.stampRow = JSON.stringify(STATE.measurements[0] || {});

      // FLOOR: both edges of both bands are legitimate input and must survive
      STATE.measurements = [{ date: '2026-06-01', waist: 40, weight: 25 },
                            { date: '2026-06-02', waist: 250, weight: 350 }];
      normalizeState();
      o.edgeRows = STATE.measurements.length;
      o.edges = STATE.measurements.map(m => m.waist + '/' + m.weight).join(',');

      // FLOOR: a real save still lands
      STATE.measurements = [];
      upsertMeasure(96, 86);
      o.savedRow = JSON.stringify(STATE.measurements[0] || {});
      return o;
    });

    t.ok('guard: a stringified object really does sort above a real date', ms.junkSortsAbove, ms);
    t.eq('a measurement row whose date is not a date is dropped', ms.junkRows, 1, ms);
    t.eq('and it is not rewritten into today', ms.junkDates, '2026-08-01', ms);
    t.eq('so it cannot become the athlete’s latest weight', ms.junkLatest, 86, ms);
    t.eq('a payload date is dropped the same way', ms.payloadRows, 0, ms);
    t.eq('a numeric string weight is coerced to a number', ms.strWeight, 84, ms);
    t.eq('so latestWeightKg() never hands a string to a calorie reader', ms.strType, 'number', ms);
    t.eq('a figure outside the band the writer enforces is dropped', ms.bandRows, 1, ms);
    t.eq('and only the real row survives', ms.bandDates, '2026-08-01', ms);
    t.ok('FLOOR: a real measurement history is byte-identical', ms.realSame, ms);
    t.ok('FLOOR: and a settled state is left alone on every later boot', ms.idempotent, ms);
    t.eq('FLOOR: a clock-skew row is still clamped to today', ms.skewDate, ms.today, ms);
    t.eq('FLOOR: a timestamped date still collapses onto its own day', ms.stampRows, 1, ms);
    t.eq('FLOOR: and merges the fields it lacks', ms.stampRow,
         JSON.stringify({ date: '2026-08-05', waist: 94, weight: 85 }), ms);
    t.eq('FLOOR: both band edges are legitimate input and survive', ms.edgeRows, 2, ms);
    t.eq('FLOOR: with their figures intact', ms.edges, '40/25,250/350', ms);
    t.eq('FLOOR: and a real save still lands', ms.savedRow,
         JSON.stringify({ date: ms.today, waist: 96, weight: 86 }), ms);
  }

  /* ---------------------------------------------------------------------
     v430, auditing the round an hour after it shipped: THE BAND MEANS
     "CANONICAL cm/kg", AND A ROW IS ONLY CANONICAL ONCE THE UNIT MIGRATIONS
     HAVE RUN.

     dedupeMeasurements() sits 847 lines ABOVE _unitFix/_unitFixW inside the
     same normalizeState() pass, so the band above judged an EARLY-BUILD
     IMPERIAL row — a waist stored in INCHES — against a CENTIMETRE band. An
     adult waist is 24-60 in and plausibleWaistCm is 40-250, so 24-39 in was
     refused. Measured on a real boot against a v429 control: 34 in and 33 in
     were both nulled, startWaist went with them, and waistDrop() fell from
     2 cm to 0 — the whole waist history destroyed by the repair that was
     written to protect it.

     The type coercion is unit-agnostic and still runs; only the BAND waits.
     Both flags are already true in every current athlete's stored state, so
     the gate costs nothing and protects exactly the case that matters: an old
     backup being imported. */
  {
    const im = await page.evaluate(() => {
      const o = {};
      const P = STATE.profile;
      const keep = { unit: P.unit, fix: P._unitFix, fixW: P._unitFixW,
                     sw: P.startWaist, ms: JSON.parse(JSON.stringify(STATE.measurements || [])) };

      // GUARD: the trap is real — an inch waist really is outside the cm band
      o.inchOutOfBand = !plausibleWaistCm(34);
      o.cmInBand = plausibleWaistCm(86);

      // an early-build imperial athlete: the migration has never run
      P.unit = 'in'; delete P._unitFix; delete P._unitFixW; P.startWaist = null;
      STATE.nutrition.weightKg = 86;          // the anchor _unitFixW waits for
      STATE.measurements = [{ date: '2026-07-01', waist: 34, weight: 86 }];
      // GUARD: the migration really has not run yet, so it is what converts
      o.fixWasUnset = (P._unitFix === undefined);
      normalizeState();
      o.imRows = STATE.measurements.length;
      o.imWaist = (STATE.measurements[0] || {}).waist;
      o.imRan = (P._unitFix === true);

      // FLOOR: the type coercion does NOT wait — it is unit-agnostic
      P.unit = 'in'; delete P._unitFix; delete P._unitFixW;
      STATE.measurements = [{ date: '2026-07-01', waist: 34, weight: '86' },
                            { date: '2026-07-02', waist: { bad: 1 }, weight: 86 }];
      normalizeState();
      o.coerceType = typeof (STATE.measurements[0] || {}).weight;
      o.junkWaist = (STATE.measurements[1] || {}).waist;

      /* THE WEIGHT HALF IS THE SAME DEFECT AND IT NEEDS ITS OWN CASE.
         _unitFix is set on the first boot for everyone; _unitFixW WAITS for an
         anchor. So {_unitFix:true, _unitFixW:false} is a real reachable state —
         an imperial athlete who has never logged a weight — and their rows may
         still be lb. 400 lb is 181 kg, a real person, and plausibleKg tops out
         at 350: gating on _unitFix alone would drop it. Without this case that
         mutant is equivalent, because the case above deletes both flags. */
      P.unit = 'in'; P._unitFix = true; delete P._unitFixW;
      STATE.nutrition.weightKg = 0;           // no anchor, so _unitFixW keeps waiting
      STATE.measurements = [{ date: '2026-07-01', waist: null, weight: 400 }];
      o.lbWaits = (P._unitFixW === undefined);
      normalizeState();
      o.lbRows = STATE.measurements.length;
      o.lbWeight = (STATE.measurements[0] || {}).weight;
      o.lbStillWaiting = (STATE.profile._unitFixW === undefined);
      STATE.nutrition.weightKg = 86;

      // FLOOR: once the migration HAS run the band fires again, as it must
      P.unit = 'cm'; P._unitFix = true; P._unitFixW = true;
      STATE.measurements = [{ date: '2026-08-01', waist: 96, weight: 86 },
                            { date: '2026-08-02', waist: 9999, weight: '84' }];
      normalizeState();
      o.canonWaist = (STATE.measurements[1] || {}).waist;
      o.canonWeight = (STATE.measurements[1] || {}).weight;

      /* THE GATE IS AN AND, AND ONLY AN IMPORT CAN TELL THE TWO HALVES APART.
         The app's own pass sets _unitFix first, so _unitFixW implies _unitFix
         in every state it produces and either flag alone answers the same —
         the mutant that asks _unitFixW only escaped on exactly that. But
         importData() accepts arbitrary JSON, so {_unitFix absent, _unitFixW
         true} arrives from a hand-edited backup: the migration WILL run in
         this pass and convert the inches, so the band must still wait. */
      P.unit = 'in'; delete P._unitFix; P._unitFixW = true;
      P.startWaist = null;
      STATE.measurements = [{ date: '2026-07-01', waist: 34, weight: 86 }];
      o.halfFlagWaits = (P._unitFix === undefined && P._unitFixW === true);
      normalizeState();
      o.halfFlagWaist = (STATE.measurements[0] || {}).waist;

      /* startWaist and goalWaist are the same figure and had no repair at all.
         The ORDERING case is what matters: they are converted from inches by
         the very migration above, so a repair placed beside the measurements
         one would null a 34 in startWaist before the migration reached it. */
      P.unit = 'in'; delete P._unitFix; delete P._unitFixW;
      STATE.nutrition.weightKg = 86;
      P.startWaist = 34; P.goalWaist = 30;      // inches, from an early build
      STATE.measurements = [];
      normalizeState();
      o.swInch = P.startWaist;
      o.gwInch = P.goalWaist;

      // junk is dropped once canonical, and a real goal survives
      P.unit = 'cm'; P._unitFix = true; P._unitFixW = true;
      P.startWaist = '<b>x</b>'; P.goalWaist = 84;
      normalizeState();
      o.swJunk = P.startWaist;
      o.gwReal = P.goalWaist;

      // ABSENT STAYS ABSENT, and a stored null is left as it was found
      P.startWaist = null; delete P.goalWaist;
      normalizeState();
      o.swNull = P.startWaist;
      o.gwAbsent = ('goalWaist' in P);

      // put back what this block broke — the blocks after it read the profile
      P.unit = keep.unit; P.startWaist = keep.sw;
      if (keep.fix === undefined) delete P._unitFix; else P._unitFix = keep.fix;
      if (keep.fixW === undefined) delete P._unitFixW; else P._unitFixW = keep.fixW;
      STATE.measurements = keep.ms;
      return o;
    });

    t.ok('guard: an inch waist really is outside the centimetre band', im.inchOutOfBand, im);
    t.ok('guard: and the converted figure is inside it', im.cmInBand, im);
    t.ok('guard: the unit migration really had not run yet', im.fixWasUnset, im);
    t.eq('an early-build imperial waist row is not dropped by the band', im.imRows, 1, im);
    t.eq('it survives long enough for the migration to convert it', im.imWaist, 86, im);
    t.ok('and the migration did run in the same pass', im.imRan, im);
    t.eq('FLOOR: the type coercion does not wait for the migration', im.coerceType, 'number', im);
    t.eq('FLOOR: and a junk figure is still nulled while un-canonical', im.junkWaist, null, im);
    t.ok('guard: the weight migration really is still waiting for an anchor', im.lbWaits, im);
    t.eq('a pound weight above the kilogram band is not dropped while it waits', im.lbRows, 1, im);
    t.eq('and its figure is untouched', im.lbWeight, 400, im);
    t.ok('guard: and the weight migration really had not run', im.lbStillWaiting, im);
    t.eq('FLOOR: once canonical the band fires again', im.canonWaist, null, im);
    t.eq('FLOOR: and still coerces a numeric string', im.canonWeight, 84, im);
    t.ok('guard: only one half of the gate is set, which only an import can do',
         im.halfFlagWaits, im);
    t.eq('and the band still waits, because the migration has not run', im.halfFlagWaist, 86, im);
    t.eq('an early-build imperial startWaist is converted, not nulled', im.swInch, 86, im);
    t.eq('and so is the goal beside it', im.gwInch, 76, im);
    t.eq('a junk startWaist is dropped once the figures are canonical', im.swJunk, null, im);
    t.eq('FLOOR: and a real goal waist survives untouched', im.gwReal, 84, im);
    t.eq('FLOOR: a stored null is left exactly as it was found', im.swNull, null, im);
    t.ok('FLOOR: and an absent goal waist is not created', !im.gwAbsent, im);
  }

  /* v431 — the string branch of the profile.days repair split on CHARACTERS and
     then read the run as a NUMBER, so a compact string carried a run of digits
     through as ONE value: '42' became the weekday [42]. The array branch beside
     it filtered the range and this one did not, so the guard above the repair
     rejected on the NEXT boot exactly what the repair had just written.

     It self-heals there, and a whole session runs on it first — measured:
     isTrainingDay() false on every day of the week, so the reminder never
     fires and every day reads as a rest day, and the Program tab claimed
     "about 378 weeks at your 1 sessions a week" against the real 76.

     The class check is the one that FOUND it: normalizeState() must be a fixed
     point, because a repair that writes a shape its own guard rejects fires the
     "we repaired your data" note again on the next launch. nutrition.diet is
     the one legitimate exception (v287's dietRepaired is set on the boot that
     repaired and cleared on the next), and it is allowlisted BY NAME and
     checked both ways — an empty exception list would pass on a fuzz that
     reached no repair at all. */
  {
    const dy = await page.evaluate(() => {
      const R = {};
      /* an earlier block in this file clears the baseline, and without one the
         Program tab renders the assessment gate — where every assertion about
         its copy passes on a screen that never mentions a week at all. */
      STATE.onboarded = true;
      STATE.baseline = { date: todayISO(), score: 97, level: 'Advanced', testCount: 8,
        maxes: { plank: 150, side: 95, hollow: 70, lower: 30, push: 48, pull: 22, squat: 62, dyn: 55 } };
      const days = () => JSON.parse(JSON.stringify(STATE.profile.days));
      const norm = v => { STATE.profile.days = v; normalizeState(); return days(); };

      /* GUARD: the string branch really is consulted, or every case below is a
         statement about the array branch instead. */
      R.guardStringParses = JSON.stringify(norm('1,2,4,5,6'));

      R.compact   = norm('42');
      R.compactLong = norm('12456');
      R.dateShaped  = norm('2026-09-05');
      R.commaFloor  = norm('1,2,4,5,6');
      R.arrayFloor  = norm([1, 2, 4, 5, 6]);
      R.arrayMixed  = norm([1, 2, 42]);
      R.wordsFloor  = norm('Mon,Tue');

      /* the guard above the repair must accept what the repair wrote, on every
         one of those — that is the property, not any single value */
      const legal = a => Array.isArray(a) && a.length > 0 &&
        a.every(d => Number.isInteger(d) && d >= 0 && d <= 6);
      R.allLegal = [R.compact, R.compactLong, R.dateShaped, R.commaFloor,
                    R.arrayFloor, R.arrayMixed, R.wordsFloor].every(legal);

      /* the readers, on the FIRST boot after the junk arrives */
      STATE.profile.days = '42'; normalizeState();
      R.firstBootDays = days();
      R.firstBootTraining = isTrainingDay();
      R.firstBootWeekly = weeklyTarget();
      go('program');
      R.firstBootProg = document.querySelector('.view.active').innerText.slice(0, 200);
      R.guardProgramBuilt = /sessions in \d+ blocks/.test(R.firstBootProg);

      /* FLOOR: a real schedule still reads as itself */
      STATE.profile.days = [1, 2, 4, 5, 6]; normalizeState();
      R.realWeekly = weeklyTarget();
      go('program');
      R.realProg = document.querySelector('.view.active').innerText.slice(0, 200);

      /* the one-session-a-week copy an import can reach */
      STATE.profile.days = [3]; normalizeState();
      go('program');
      R.oneProg = document.querySelector('.view.active').innerText.slice(0, 200);

      STATE.profile.days = [1, 2, 4, 5, 6]; save();
      return R;
    });

    t.eq('guard: the string branch really parses a separated list',
         dy.guardStringParses, '[1,2,4,5,6]', dy);
    t.eq('a compact digit run is not stored as an out-of-range weekday',
         dy.compact, [0, 1, 2, 3, 4, 5, 6], dy);
    t.eq('nor is a longer one', dy.compactLong, [0, 1, 2, 3, 4, 5, 6], dy);
    t.eq('a date-shaped string keeps only the real weekdays in it',
         dy.dateShaped, [0, 5], dy);
    t.ok('the repair never writes a shape its own guard would reject',
         dy.allLegal, dy);
    t.eq('FLOOR: a separated list is stored exactly as written',
         dy.commaFloor, [1, 2, 4, 5, 6], dy);
    t.eq('FLOOR: a real array is untouched', dy.arrayFloor, [1, 2, 4, 5, 6], dy);
    t.eq('FLOOR: and the array branch still drops an out-of-range member',
         dy.arrayMixed, [1, 2], dy);
    t.eq('FLOOR: a string with no weekday in it falls back to the whole week',
         dy.wordsFloor, [0, 1, 2, 3, 4, 5, 6], dy);

    t.eq('the first boot after the junk leaves a legal schedule',
         dy.firstBootDays, [0, 1, 2, 3, 4, 5, 6], dy);
    t.ok('so today is a training day rather than every day being a rest day',
         dy.firstBootTraining === true, dy);
    t.eq('and the weekly target is a real number of days',
         dy.firstBootWeekly, 7, dy);
    t.ok('and the Program tab does not claim 378 weeks at one session a week',
         !/378 weeks/.test(dy.firstBootProg), dy.firstBootProg);
    t.ok('FLOOR: a five-day athlete still reads 76 weeks at five sessions',
         /76 weeks/.test(dy.realProg) && /5 sessions a week/.test(dy.realProg),
         dy.realProg);
    t.ok('a genuine one-day schedule says "1 session a week", not "1 sessions"',
         /\b1 session a week/.test(dy.oneProg) && !/\b1 sessions a week/.test(dy.oneProg),
         dy.oneProg);

    /* the class: normalizeState() is a fixed point */
    const fp = await page.evaluate(() => {
      const JUNK = ['zzz', '42', -7, 1e12, {}, [], true, null, 'constructor', 0];
      const D = DEFAULT_STATE();
      const paths = Object.keys(D).concat(
        ['profile', 'nutrition', 'settings'].flatMap(p =>
          Object.keys(D[p] || {}).map(k => p + '.' + k)));
      const set = (o, p, v) => { const ks = p.split('.'); const last = ks.pop();
        ks.reduce((a, k) => a[k], o)[last] = v; };
      const clean = JSON.parse(JSON.stringify(STATE));
      const moved = {};
      let cases = 0, repairs = 0;
      for (const p of paths) for (const j of JUNK) {
        cases++;
        STATE = JSON.parse(JSON.stringify(clean));
        try { set(STATE, p, JSON.parse(JSON.stringify(j))); } catch (e) { continue; }
        normalizeState(); const a = JSON.stringify(STATE);
        if (a !== JSON.stringify(clean)) repairs++;
        normalizeState(); const b = JSON.stringify(STATE);
        if (a === b) continue;
        const A = JSON.parse(a), B = JSON.parse(b);
        for (const k of new Set(Object.keys(A).concat(Object.keys(B))))
          if (JSON.stringify(A[k]) !== JSON.stringify(B[k]))
            (moved[k] = moved[k] || new Set()).add(p);
      }
      STATE = JSON.parse(JSON.stringify(clean)); save();
      const out = {}; for (const k in moved) out[k] = [...moved[k]].sort();
      return { cases, paths: paths.length, repairs, moved: out };
    });

    t.ok('guard: the fixed-point fuzz swept every case and reached real repairs',
         fp.cases > 500 && fp.repairs > 250, fp);
    t.ok('guard: and it swept every top-level and nested field',
         fp.paths > 60, fp);
    t.ok('guard: the Program tab really built a program rather than the baseline gate',
         dy.guardProgramBuilt, dy.firstBootProg);
    t.eq('only nutrition moves on a second pass, and only for the diet flag',
         Object.keys(fp.moved).sort(), ['nutrition'], fp.moved);
    t.eq('and that is dietRepaired alone — v287 sets it on the repairing boot and clears it on the next',
         fp.moved.nutrition || [], ['nutrition.diet'], fp.moved);
  }

  /* ---------- the Back button is the same dismissal, minus the history ----

     onPop() re-implemented closeSheet()'s scrim branch by hand and had drifted
     from it. Measured, closing a sheet by button against closing it by Back:

       _sheetGen bumped        1 -> 2        |  5 -> 5, UNCHANGED
       the sheet's markup      cleared       |  still mounted
       a queued badge          popped        |  still queued
       focus                   to the opener |  stranded on <body>

     The first is the one that bites: the three image readers stand down on
     `gen!==_sheetGen` — the block above asserts that guard exists — and Back
     never moved it, so a slow read finishing after a Back did not stand down
     and RE-OPENED the sheet the athlete had just dismissed.

     Driven with a real page.goBack(), not by calling onPop(): onPop has three
     ambient early returns and a hand call is swallowed by whichever one an
     earlier block left set. */
  {
    const before = await page.evaluate(async () => {
      STATE.onboarded = true; normalizeState(); save();
      /* EACH BLOCK BUILDS THE STATE IT ASSERTS ON, and this one needs three
         things an earlier block does not leave: the app on Today (views never
         clear innerHTML, so an opener appended to a hidden view cannot take
         focus at all), NO sheet already open (openSheet only records where to
         give focus back on a genuine open, not on a repaint), and the two
         ambient early returns in onPop cleared. */
      go('today');
      /* A FIXED SLEEP CANNOT WAIT FOR A SHEET THAT RE-OPENS ITSELF. This was
         `closeSheet(); await 700ms`, and it went red on CI while passing
         locally. sheetDismiss() schedules flushCelebrations() 350 ms later,
         and a queued badge calls openSheet() — so the scrim was OPEN again
         when the 700 ms elapsed, openSheet treated the next call as a
         REPAINT, and _sheetReturn was never recorded. Measured on the CI
         failure: wasClear false, ret null.
         Drain the queue FIRST, then poll for the condition rather than
         betting on a duration — closeSheet() only when a sheet is actually
         open, since it takes a history step. */
      _celebQ = [];
      for (let i = 0; i < 40; i++) {
        if (!document.querySelector('#scrim').classList.contains('open')) break;
        _celebQ = [];
        try { closeSheet(); } catch (e) {}
        await new Promise(z => setTimeout(z, 80));
      }
      _celebQ = [];
      await new Promise(z => setTimeout(z, 450));   // outlive one flush window
      _celebQ = [];
      const wasClear = !document.querySelector('#scrim').classList.contains('open');
      const b = document.createElement('button');
      b.id = 'cfBackOpener'; b.textContent = 'open';
      document.querySelector('.view.active').appendChild(b); b.focus();
      const focusedFirst = document.activeElement && document.activeElement.id;
      openSheet('<div id="cfBackMarker">sheet content</div>');
      _backGuard = false; _exiting = false;
      window.__cfGen = _sheetGen;
      return { gen: _sheetGen, marker: !!document.querySelector('#cfBackMarker'),
               scrim: document.querySelector('#scrim').classList.contains('open'),
               tab: TAB, wasClear, focusedFirst,
               ret: _sheetReturn && _sheetReturn.id,
               guardsClear: !_backGuard && !_exiting };
    });
    t.ok('guard: the sheet really opened, with its markup mounted',
      before.marker && before.scrim, JSON.stringify(before));
    t.ok('guard: and no ambient early return is armed in onPop',
      before.guardsClear, JSON.stringify(before));
    t.ok('guard: no sheet was already open, so this is a genuine open',
      before.wasClear, JSON.stringify(before));
    t.eq('guard: the opener really held focus before the sheet opened',
      before.focusedFirst, 'cfBackOpener', before);
    t.eq('guard: and openSheet recorded it as the control to return to',
      before.ret, 'cfBackOpener', before);

    await page.goBack();
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({
      gen: _sheetGen, standsDown: window.__cfGen !== _sheetGen,
      scrim: document.querySelector('#scrim').classList.contains('open'),
      marker: !!document.querySelector('#cfBackMarker'),
      focus: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none',
      tab: TAB, view: !!document.querySelector('.view.active'),
    }));

    t.ok('Back closes the sheet', !after.scrim, JSON.stringify(after));
    t.ok('and moves _sheetGen, so a slow image read stands down',
      after.standsDown, JSON.stringify(after));
    t.ok('and clears the sheet markup, so no stale id shadows a live one',
      !after.marker, JSON.stringify(after));
    t.eq('and gives the focus back to the control that opened it',
      after.focus, 'cfBackOpener', after);
    /* FLOOR: Back dismisses the sheet AND NOTHING ELSE — no navigation, no tab
       change. It deliberately does NOT claim to catch onPop calling closeSheet()
       outright: that step is self-guarding (it fires only while
       history.state.cf==='sheet', and the pop has already moved off that entry),
       so that mutant is equivalent — measured two Backs deep, identical history
       position both ways. A check that cannot fail must not carry a label
       saying it can. */
    t.eq('FLOOR: Back dismisses the sheet and does not navigate',
      after.tab, before.tab, after);
    t.ok('FLOOR: and the app is still on screen', after.view, JSON.stringify(after));

    /* A queued badge pops once the sheet is gone, by EITHER door. */
    const badge = await page.evaluate(async () => {
      const b = document.createElement('button');
      b.id = 'cfBackOpener2'; document.querySelector('.view.active').appendChild(b); b.focus();
      _celebQ = [];
      openSheet('<div>a sheet</div>');
      celebrateAchievements([ACHIEVEMENTS[0]]);
      _backGuard = false; _exiting = false;
      return { queued: _celebQ.length };
    });
    t.eq('guard: a badge really is queued behind the open sheet', badge.queued, 1, badge);
    await page.goBack();
    await page.waitForTimeout(900);
    const badgeAfter = await page.evaluate(() => ({
      queued: _celebQ.length,
      popped: /Achievement unlocked/.test(document.querySelector('#sheet').textContent || ''),
    }));
    t.ok('a badge queued behind the sheet pops after Back too, not only after the ✕',
      badgeAfter.popped && badgeAfter.queued === 0, JSON.stringify(badgeAfter));
    await page.evaluate(async () => {
      try { closeSheet(); } catch (e) {}
      await new Promise(z => setTimeout(z, 600));
      ['cfBackOpener', 'cfBackOpener2'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
    });
  }

  /* ---------- every overlay dismissal is the same dismissal --------------

     Six full-screen exits, and three of them — all reached by a BUTTON the
     athlete taps — were missing a guard their own sibling one function away
     already had. Measured, with a guard proving no shield was up first:

       player finish (playerFeel)   tapShield  yes
       player ✕ (playerTeardown)    tapShield  NO
       HIIT log buttons             tapShield  yes
       HIIT Close (hiitTeardown)    tapShield  NO
       benchmark ✕ (opQuit)         tapShield  NO

     tapShield is what stops a double-tap's second tap falling through to the
     UI beneath — closeSheet()'s own comment says so, and it is on the sheet,
     on the player's finish button and on all three HIIT log buttons.

     And the markup: hiitTeardown() cleared #hiit 400 ms after closing while
     the three log paths left 1,064 bytes mounted, and opQuit() — which shares
     the same overlay — cleared nothing. That is the stale-id class this repo
     has a standing rule about.

     hiitClose() is the one closer for #hiit now. What each caller keeps is
     what is genuinely its own: the grinder stop record and the beat stop in
     hiitTeardown(), and the HISTORY step in the three buttons. */
  {
    const ov = await page.evaluate(async () => {
      const R = {};
      STATE.onboarded = true; STATE.profile.parqDone = true; STATE.profile.parq = [];
      normalizeState(); save(); go('today');
      const shield = () => { const e = document.elementFromPoint(200, 300);
                             return !!(e && e.style && e.style.zIndex === '9999'); };
      /* Long enough for any earlier shield to expire — one left up by a
         previous case makes every assertion below pass on nothing. */
      const settle = () => new Promise(z => setTimeout(z, 900));

      await settle();
      openPlayer({ items: [{ exId: 'plank', unit: 'time', target: 30, rest: 30, sets: 1 }],
                   free: true, title: 'probe' });
      await settle(); R.g1 = shield(); playerTeardown(); R.playerX = shield();
      await settle(); R.playerMarkup = document.querySelector('#player').innerHTML.length;

      startHiit('tabata'); await settle(); R.g2 = shield();
      hiitTeardown(); R.hiitClose = shield();
      await settle(); R.hiitMarkupAfterClose = document.querySelector('#hiit').innerHTML.length;

      startHiit('tabata'); await settle(); R.g3 = shield();
      hiitLogSkip(10, 5); R.hiitLog = shield();
      await settle(); R.hiitMarkupAfterLog = document.querySelector('#hiit').innerHTML.length;

      startOp('op_forge'); opStart(); await settle(); R.g4 = shield();
      opQuit(); R.opX = shield();
      await settle(); R.opMarkup = document.querySelector('#hiit').innerHTML.length;

      /* FLOOR: the exits that already had one still do. */
      openPlayer({ items: [{ exId: 'plank', unit: 'time', target: 30, rest: 30, sets: 1 }],
                   free: true, title: 'probe' });
      await settle(); R.g5 = shield(); playerFeel('right'); R.playerFinish = shield();
      await settle();
      return R;
    });

    t.ok('guard: no tap shield was left up before any of these exits',
      !ov.g1 && !ov.g2 && !ov.g3 && !ov.g4 && !ov.g5, JSON.stringify(ov));

    t.ok('closing the player with the ✕ shields the tap beneath it', ov.playerX, JSON.stringify(ov));
    t.ok('so does closing HIIT', ov.hiitClose, JSON.stringify(ov));
    t.ok('and closing the benchmark', ov.opX, JSON.stringify(ov));
    t.ok('FLOOR: and the exits that already shielded still do',
      ov.hiitLog && ov.playerFinish, JSON.stringify(ov));

    t.eq('the player clears its markup when it closes', ov.playerMarkup, 0, ov);
    t.eq('HIIT clears its markup on the Close button', ov.hiitMarkupAfterClose, 0, ov);
    t.eq('and on a log button', ov.hiitMarkupAfterLog, 0, ov);
    t.eq('and the benchmark, which shares the same overlay', ov.opMarkup, 0, ov);

    /* FLOOR: the clear is deferred, so it must not blank an overlay that has
       been RE-OPENED inside its own 400 ms window — which is a real sequence
       (close a circuit, start another straight away). An over-eager clear that
       drops the `is it closed?` guard satisfies every assertion above. */
    const reopen = await page.evaluate(async () => {
      /* hiitLogSkip() returns at once with no INTV, so a case that has not
         opened a session first never STARTS the deferred clear — and the
         mutant walks straight through. Open one, and pin that it opened. */
      startHiit('tabata');
      await new Promise(z => setTimeout(z, 300));
      const hadSession = !!INTV;
      hiitLogSkip(5, 2);                       // starts the deferred clear
      const closed = !document.querySelector('#hiit').classList.contains('open');
      startHiit('tabata');                     // re-opens inside its window
      const opened = document.querySelector('#hiit').innerHTML.length;
      await new Promise(z => setTimeout(z, 700));
      const after = document.querySelector('#hiit').innerHTML.length;
      const open = document.querySelector('#hiit').classList.contains('open');
      try { hiitTeardown(); } catch (e) {}
      await new Promise(z => setTimeout(z, 700));
      return { hadSession, closed, opened, after, open };
    });
    t.ok('guard: a session really was open, so the log path ran its deferred clear',
      reopen.hadSession && reopen.closed, JSON.stringify(reopen));
    t.ok('guard: the re-opened overlay really rendered', reopen.opened > 100, JSON.stringify(reopen));
    t.ok('FLOOR: a deferred clear does not blank an overlay re-opened inside its window',
      reopen.after > 100 && reopen.open, JSON.stringify(reopen));
  }

  /* v437 — THE PLAYER HAS THREE EXITS, AND ONE CLOSER WRITTEN OUT THREE TIMES.
     v436 shared one closer between HIIT's four exits. The same question of the
     #player overlay found three, drifted two ways. Measured by driving each:

       exit                    reached by        the beat    markup left
       playerTeardown()        the ✕, Back       stopped     0 bytes
       playerFeel()            the feel buttons  (stopped)   2,579 bytes
       hurtStop()'s no-work    the pain button   STILL ON    2,566 bytes

     The pain stop is the sharp one: it bails mid-session, so plEnterDone() —
     which is what stops the beat on the normal path — is never reached, and
     the music kept playing after the athlete stopped for a joint. */
  {
    await seedAthlete(page);
    const ex = await page.evaluate(async () => {
      const R = {};
      const settle = () => new Promise(z => setTimeout(z, 700));
      const sess = () => ({ items: [{ exId: 'plank', unit: 'time', target: 30, rest: 30, sets: 1 }],
                            free: true, title: 'probe' });
      STATE.settings.beat = true;
      const beatOn = () => !!(typeof BEAT !== 'undefined' && BEAT && BEAT.on);

      /* the pain stop, with nothing logged — the branch that bails outright */
      openPlayer(sess());
      await new Promise(z => setTimeout(z, 250));
      R.gBeatStarts = beatOn();                      // guard: the player really starts one
      R.gOpened = !!PLAYER;
      hurtStop();
      await settle();
      R.painBeat = beatOn();
      R.painMarkup = document.querySelector('#player').innerHTML.length;

      /* the natural finish */
      openPlayer(sess());
      await new Promise(z => setTimeout(z, 250));
      R.gOpened2 = !!PLAYER;
      playerFeel('ok');
      await settle();
      R.finishMarkup = document.querySelector('#player').innerHTML.length;

      /* FLOOR: the ✕, which was already right, is unchanged */
      openPlayer(sess());
      await new Promise(z => setTimeout(z, 250));
      playerTeardown();
      await settle();
      R.xMarkup = document.querySelector('#player').innerHTML.length;

      /* FLOOR: the cool-down that follows a finish gets its own beat back —
         every caller closes FIRST and hands off to the guided day AFTER, so
         the beat runFlow() starts is not the one the closer stopped. */
      try { beatStop(); } catch (e) {}
      openPlayer(sess());
      await new Promise(z => setTimeout(z, 250));
      playerFeel('ok');
      await new Promise(z => setTimeout(z, 200));
      R.beatAfterFinish = beatOn();
      runFlow('Cool-down', COOLDOWN_FLOW.slice(0, 2), null, 'var(--fire)');
      await new Promise(z => setTimeout(z, 300));
      R.beatInCooldown = beatOn();
      try { flowStop(); } catch (e) {}
      await settle();

      /* FLOOR: the clear is deferred, so a player RE-OPENED inside its own
         400 ms window must not be blanked. An over-eager clear that drops the
         `is it closed?` guard satisfies every assertion above. */
      openPlayer(sess());
      await new Promise(z => setTimeout(z, 250));
      playerTeardown();
      R.reClosed = !document.querySelector('#player').classList.contains('open');
      openPlayer(sess());
      R.reOpened = document.querySelector('#player').innerHTML.length;
      await settle();
      R.reAfter = document.querySelector('#player').innerHTML.length;
      R.reStillOpen = document.querySelector('#player').classList.contains('open');
      try { playerTeardown(); } catch (e) {}
      await settle();
      return R;
    });

    t.ok('guard: the player really opened, and really starts a beat',
      ex.gOpened && ex.gOpened2 && ex.gBeatStarts, JSON.stringify(ex));

    t.eq('a pain stop with nothing logged leaves no beat playing', ex.painBeat, false, ex);
    t.eq('and clears the player markup, so no stale id shadows a live one', ex.painMarkup, 0, ex);
    t.eq('the natural finish clears its markup too', ex.finishMarkup, 0, ex);
    t.eq('FLOOR: the ✕, which was already right, still clears it', ex.xMarkup, 0, ex);

    t.eq('FLOOR: the finish stops the beat it was playing', ex.beatAfterFinish, false, ex);
    t.eq('FLOOR: and the cool-down that follows gets its own beat back',
      ex.beatInCooldown, true, ex);

    t.ok('guard: the player really closed and really re-opened',
      ex.reClosed && ex.reOpened > 100, JSON.stringify(ex));
    t.ok('FLOOR: a deferred clear does not blank a player re-opened inside its window',
      ex.reAfter > 100 && ex.reStillOpen, JSON.stringify(ex));
  }

  /* v438 — AN OVERLAY OPENED FROM A SHEET LOST ITS OWN HISTORY ENTRY.
     history.back() is ASYNC, so closeSheet() leaves a traversal IN FLIGHT, and
     an entry pushed in the same tick is exactly where that traversal lands.
     openPlayer() and startOp() pushed synchronously and lost their entry:

                                right after the push   once the back lands
       openPlayer()             'player'               'home'   <- eaten
       startOp()                'op'                   'home'   <- eaten

     AND THE OLD ANSWER WAS A BET. openQuick() and _runHiit() deferred with
     setTimeout(...,0) and carried a comment saying it worked. It does for
     them and it did NOT for startOp: a history traversal is dispatched on its
     own task queue, so a 0ms timer can win. Traced with pushState and popstate
     both instrumented, five runs each:

       openPlayer / _runHiit    POP first, then PUSH    survives  5/5
       startOp                  PUSH first, then POP    eaten     5/5

     pushOverlayState() waits on _backGuard — which IS "a self-pop is in
     flight" — instead of guessing, and all four openers now use it.

     The athlete-facing cost, measured with a real Back press: the overlay
     shut either way, but the stack sat at 'root' instead of 'home' — one
     press nearer "Press Back again to exit". That is the "skipped a whole
     tab level" the two existing comments describe.

     THIS BLOCK RUNS ON A PAGE OF ITS OWN, and that is not tidiness. The state
     it asserts on IS THE HISTORY STACK, and by this point in the suite that
     stack is 49 entries deep with stale 'player' and 'hiit' states left by
     blocks that never retired them — so `history.state.cf` read 'player'
     before this block had opened anything, and even the CONTROL (an opener
     that has always deferred) failed. A fresh tab in the same context is the
     only way to get a one-entry stack; the athlete's data is in storage for
     the origin, so it is already seeded. */
  {
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', e => errors.push('uncaught(v438): ' + String(e).slice(0, 300)));
    await p2.goto(page.url(), { waitUntil: 'networkidle' });
    await waitForBoot(p2);
    await seedAthlete(p2);   // a fresh context has its own storage

    /* RED IS NOT ENOUGH, IT HAS TO SAY WHAT. Four of this round's mutants were
       caught by a THROW rather than by a named check: a quit that pops an entry
       it does not own walks the page off the start of its own history into
       about:blank, and every p2.evaluate() after that reports "Execution context
       was destroyed" — so the suite printed "the test file itself threw" and
       said nothing about which property broke. The catch names the one thing
       that can do it, and the finally still tears the context down. */
    try {

    const openFrom = async (start) => await p2.evaluate(async (startSrc) => {
      const wait = ms => new Promise(z => setTimeout(z, ms));
      try { if (typeof PLAYER !== 'undefined' && PLAYER) playerQuit(); } catch (e) {}
      try { if (typeof OP !== 'undefined' && OP) opQuit(); } catch (e) {}
      try { if (typeof INTV !== 'undefined' && INTV) hiitQuit(); } catch (e) {}
      await wait(900);
      try { closeSheet(); } catch (e) {}
      await wait(700);
      _celebQ = []; _backGuard = false; _exiting = false;
      const clear = !document.querySelector('#scrim').classList.contains('open') &&
                    !document.querySelector('#player').classList.contains('open') &&
                    !document.querySelector('#hiit').classList.contains('open');
      const pre = history.state && history.state.cf;
      openSheet('<div id="cfChooser">chooser</div>');
      await wait(250);
      const sheetUp = history.state && history.state.cf;
      closeSheet();                       // its history.back() is now in flight
      // eslint-disable-next-line no-new-func
      (new Function(startSrc))();
      const sync = history.state && history.state.cf;
      await wait(600);                    // let the traversal land
      return { clear, pre, sheetUp, sync, settled: history.state && history.state.cf,
               len: history.length,
               playerOpen: document.querySelector('#player').classList.contains('open'),
               hiitOpen: document.querySelector('#hiit').classList.contains('open') };
    }, start);

    const shut = async () => await p2.evaluate(async () => {
      const wait = ms => new Promise(z => setTimeout(z, ms));
      try { if (typeof PLAYER !== 'undefined' && PLAYER) playerQuit(); } catch (e) {}
      try { if (typeof OP !== 'undefined' && OP) opQuit(); } catch (e) {}
      try { if (typeof INTV !== 'undefined' && INTV) hiitQuit(); } catch (e) {}
      await wait(900);
      try { closeSheet(); } catch (e) {}
      await wait(700);
      _backGuard = false; _exiting = false;
    });

    const PLAY = "openPlayer({items:[{exId:'pushup',unit:'reps',target:10,rest:45,sets:2}],free:true,title:'probe'});";
    const play = await openFrom(PLAY);
    await shut();
    const op = await openFrom("startOp('op_engine');");
    await shut();
    /* THE CONTROL. _runHiit() kept its entry even under the old 0ms timer, so
       it is what proves the queued traversal in this setup is real: without
       it, "the entry survives" could pass on a page where nothing was ever in
       flight to eat it. */
    const hiit = await openFrom("_runHiit({name:'probe'},['jumpingjack','highknees'],'tabata');");
    await shut();
    /* The fourth opener. Quick is a TAB rather than an overlay, so it is read
       by its own tag — a sweep that only covered the two overlays would leave
       the class one member short, which is how startOp came to be missed. */
    const quick = await openFrom("openQuick(QUICKIES[0].id);");
    /* Quick's entry is retired with a real Back, not by calling go(): go() does
       not pop, so leaving it on the stack made the NEXT case's Back land on it
       and read 'tab'. The stack is this block's state and every case restores
       it. */
    await p2.goBack();
    await p2.waitForTimeout(600);
    await shut();

    t.ok('guard: nothing was already open, so each chooser is a genuine open',
      play.clear && op.clear && hiit.clear, JSON.stringify({ play, op, hiit }));
    t.eq('guard: the chooser sheet really pushed an entry of its own',
      play.sheetUp, 'sheet', play);
    t.ok('guard: each overlay really opened',
      play.playerOpen && op.hiitOpen && hiit.hiitOpen, JSON.stringify({ play, op, hiit }));
    t.eq('CONTROL: the opener that already defers keeps its entry',
      hiit.settled, 'hiit', hiit);

    t.eq('the player keeps its own history entry when opened from a sheet',
      play.settled, 'player', play);
    t.eq('and so does the benchmark ops clock',
      op.settled, 'op', op);
    t.eq('and so does the quick-workout tab',
      quick.settled && quick.settled, 'tab', quick);

    /* THE PAYLOAD, not the container: one real Back press must close the
       overlay and cost exactly ONE level, not two. */
    const back = await openFrom(PLAY);
    t.eq('guard: the player is open with its own entry before the Back press',
      back.settled, 'player', back);
    await p2.goBack();
    await p2.waitForTimeout(900);
    const afterBack = await p2.evaluate(() => ({
      playerOpen: document.querySelector('#player').classList.contains('open'),
      cf: history.state && history.state.cf, len: history.length,
    }));
    t.ok('one Back closes the player', !afterBack.playerOpen, JSON.stringify(afterBack));
    t.eq('and costs one history level, not two — it lands above the root',
      afterBack.cf, 'home', afterBack);
    await shut();

    /* THE SAME PAYLOAD ON THE BENCHMARK, which is where stamping OP.hist made
       an old accident stop protecting a missing split. onPop() takes the
       NO-history dismissal for the player and for HIIT, and had to call
       opQuit() for the benchmark because no opClose() existed — so Back closed
       the overlay AND popped the tab level under it.

       "It lands on home" is the CONTAINER and passes on the bug: a double pop
       reaches the root, where onPop's own last branch pushes {cf:'home'} back
       and prints "Press Back again to exit". The payload is that the root
       branch never ran. */
    const opBack = await openFrom("startOp('op_engine');");
    t.eq('guard: the benchmark is open with its own entry before the Back press',
      opBack.settled, 'op', opBack);
    await p2.evaluate(() => { _homeBackAt = 0; try { $('#toast').textContent = ''; } catch (e) {} });
    await p2.goBack();
    await p2.waitForTimeout(900);
    const opAfter = await p2.evaluate(() => ({
      hiitOpen: document.querySelector('#hiit').classList.contains('open'),
      cf: history.state && history.state.cf,
      rootBranch: _homeBackAt > 0,
      toast: (document.querySelector('#toast') || {}).textContent || '',
    }));
    t.ok('one Back closes the benchmark ops clock', !opAfter.hiitOpen, JSON.stringify(opAfter));
    t.eq('and the benchmark lands above the root too', opAfter.cf, 'home', opAfter);
    t.ok('and costs ONE level, not two — the exit branch never ran',
      !opAfter.rootBranch && !/Press Back again/.test(opAfter.toast), JSON.stringify(opAfter));
    await shut();

    /* FLOOR: the ✕ and the Done button still RETIRE the entry. opQuit() keeps
       the history step; only the pop handler must not take it. A split that
       dropped it everywhere satisfies every assertion above and leaves a dead
       entry behind, so the next Back does nothing the athlete can see. */
    const opX = await openFrom("startOp('op_engine');");
    t.eq('guard: the benchmark has its own entry before the ✕', opX.settled, 'op', opX);
    const opXAfter = await p2.evaluate(async () => {
      opQuit();
      await new Promise(z => setTimeout(z, 900));
      return { cf: history.state && history.state.cf,
               open: document.querySelector('#hiit').classList.contains('open') };
    });
    t.ok('guard: the ✕ really closed the benchmark', !opXAfter.open, JSON.stringify(opXAfter));
    t.eq('FLOOR: the ✕ retires the entry, so no dead level is left behind',
      opXAfter.cf, 'home', opXAfter);
    await shut();

    /* FLOOR: an opener reached with NO sheet in front of it must still get an
       entry. A "fix" that simply dropped the push would leave the overlay with
       no Back route at all. */
    const noSheet = await p2.evaluate(async () => {
      const wait = ms => new Promise(z => setTimeout(z, ms));
      try { closeSheet(); } catch (e) {}
      await wait(700);
      _backGuard = false; _exiting = false;
      const before = history.state && history.state.cf;
      openPlayer({ items: [{ exId: 'pushup', unit: 'reps', target: 10, rest: 45, sets: 2 }], free: true, title: 'probe' });
      await wait(400);
      return { before, after: history.state && history.state.cf,
               open: document.querySelector('#player').classList.contains('open') };
    });
    t.ok('guard: no sheet was open, so nothing was in flight', noSheet.before !== 'sheet', JSON.stringify(noSheet));
    t.ok('FLOOR: opened with no sheet in front of it, the player still gets an entry',
      noSheet.open && noSheet.after === 'player', JSON.stringify(noSheet));
    await shut();

    /* FLOOR: the if(PLAYER) / if(OP) guard. A quit inside the deferral tick
       must leave NO stray entry behind for an overlay that is already gone —
       an entry with nothing to close eats a Back press on its own. */
    const stray = await p2.evaluate(async () => {
      const wait = ms => new Promise(z => setTimeout(z, ms));
      try { closeSheet(); } catch (e) {}
      await wait(700);
      _backGuard = false; _exiting = false;
      const before = history.state && history.state.cf;
      openPlayer({ items: [{ exId: 'pushup', unit: 'reps', target: 10, rest: 45, sets: 2 }], free: true, title: 'probe' });
      playerQuit();                       // same tick, before the deferred push
      await wait(400);
      return { before, after: history.state && history.state.cf,
               open: document.querySelector('#player').classList.contains('open') };
    });
    t.ok('guard: the player really closed inside the deferral tick', !stray.open, JSON.stringify(stray));
    t.eq('FLOOR: a quit inside that tick leaves no stray entry behind',
      stray.after, stray.before, stray);

    /* THE PUSHES AND THE POPS MUST PAIR, WHATEVER THE TIMING — and this is
       the half that bites hardest. Every quit used to decide whether to
       retire an entry by reading history.state.cf, which is STALE while a
       traversal is in flight. So three open/quit cycles inside ONE task took
       three history.back() calls against ONE entry and walked the page off
       the start of its own history:

         NAV -> about:blank      and every later evaluate threw
                                 "openPlayer is not defined"

       Two suites reported exactly that as "the test file itself threw". The
       entry belongs to the OVERLAY INSTANCE now, so a quit before its push
       has landed retires nothing and the pending push then finds alive()
       false. Balanced either way. */
    await shut();
    const paired = await p2.evaluate(async () => {
      const wait = ms => new Promise(z => setTimeout(z, ms));
      try { closeSheet(); } catch (e) {}
      await wait(700);
      _backGuard = false; _exiting = false;
      const before = { cf: history.state && history.state.cf, href: location.href };
      const FREE = { items: [{ exId: 'pushup', unit: 'reps', target: 10, rest: 45, sets: 2 }], free: true };
      for (let i = 0; i < 3; i++) { openPlayer(FREE); playerQuit(); }   // one task, three cycles
      await wait(900);
      return { before, cf: history.state && history.state.cf, href: location.href,
               alive: typeof openPlayer === 'function',
               playerOpen: document.querySelector('#player').classList.contains('open') };
    });
    t.ok('three open/quit cycles in ONE task do not unload the page',
      paired.alive && paired.href === paired.before.href, JSON.stringify(paired));
    t.eq('and the history stack is where it started, not below it',
      paired.cf, paired.before.cf, paired);
    t.ok('guard: and the player really is closed at the end of them',
      !paired.playerOpen, JSON.stringify(paired));

    /* FLOOR: a quit whose push DID land must still retire its entry, or the
       stack grows an orphan on every session and eats a Back press each time. */
    const retire = await p2.evaluate(async () => {
      const wait = ms => new Promise(z => setTimeout(z, ms));
      try { closeSheet(); } catch (e) {}
      await wait(700);
      _backGuard = false; _exiting = false;
      const before = history.state && history.state.cf;
      openPlayer({ items: [{ exId: 'pushup', unit: 'reps', target: 10, rest: 45, sets: 2 }], free: true });
      await wait(300);
      const opened = { cf: history.state && history.state.cf, hist: !!(PLAYER && PLAYER.hist) };
      playerQuit();
      await wait(600);
      return { before, opened, after: history.state && history.state.cf };
    });
    t.ok('guard: the push landed and stamped the player instance',
      retire.opened.cf === 'player' && retire.opened.hist, JSON.stringify(retire));
    t.eq('FLOOR: a quit whose entry really exists retires it',
      retire.after, retire.before, retire);

    } catch (e) {
      t.fail('the history block ran to the end without the page unloading',
        'a quit almost certainly popped an entry it did not own: ' + String(e).slice(0, 300));
    } finally {
      try { await p2.close(); } catch (e) {}
      try { await ctx2.close(); } catch (e) {}
    }
  }

  /* THE ROW PRINTED A CANONICAL KILOMETRE FIGURE WEARING A MILE LABEL, AND THE
     TILE ABOVE IT PRINTED THE RIGHT ONE (v446).

     saveRuck() stores the distance canonically in km — its own comment says why
     — and stores the pack load exactly as typed. The history row interpolated
     `x.dist + ' ' + (x.unit||'km')`, so an imperial athlete who rucked 3 miles
     read "4.8 mi" on the row and "Total mi = 3" on the tile: one sheet, one
     ruck, two answers, 60% apart. The load printed as a bare "25 load" with no
     unit at all, so nothing on the glass could tell 25 lb from 25 kg.

     v337 swept this class and could not see it: that sweep enumerated
     ${distUnit()} sites, and this one reads a stored PER-ROW tag. A sweep is
     only as wide as the surface it enumerates.

     BOTH unit systems are driven. In imperial the load conversion is close
     enough to its own inverse to hide a bug in a single round trip (v315), and
     a metric athlete is the only case that can tell them apart. */
  {
    const ru = await page.evaluate(() => {
      const o = {};
      const read = () => {
        const sh = document.getElementById('sheet');
        const row = [...sh.querySelectorAll('.kv')][0];
        const tiles = {};
        [...sh.querySelectorAll('.stat')].forEach(st => {
          tiles[(st.querySelector('.l') || {}).textContent] =
            (st.querySelector('.n') || {}).textContent;
        });
        return { row: row ? row.textContent.replace(/\s+/g, ' ').trim() : null, tiles };
      };
      STATE.ruckLog = [];
      STATE.profile.unit = 'in';
      openRuck();
      document.querySelector('#rk-min').value = '45';
      document.querySelector('#rk-dist').value = '3';
      document.querySelector('#rk-wt').value = '25';
      saveRuck();
      o.stored = JSON.parse(JSON.stringify(STATE.ruckLog[0]));
      o.imp = read();
      STATE.profile.unit = 'cm';
      openRuck();
      o.met = read();
      /* a row with neither figure must print neither */
      STATE.ruckLog = [{ date: todayISO(), mins: 20, at: Date.now() }];
      STATE.profile.unit = 'in';
      openRuck();
      o.bare = read();
      /* NO normalizeState() — the cross-tab door */
      STATE.ruckLog = [{ date: todayISO(), mins: 'lots', dist: 'x', wt: 'y', at: Date.now() }];
      STATE.profile.unit = 'cm';
      openRuck();
      o.junk = read();
      /* a legacy row with no unit tag reads as metric, which is what the
         distance half has always defaulted to */
      STATE.ruckLog = [{ date: todayISO(), mins: 30, dist: 5, wt: 10, at: Date.now() }];
      STATE.profile.unit = 'cm';
      openRuck();
      o.legacy = read();
      closeSheet();
      o.zero = rowLoadShow(0, 'km');
      o.negative = rowLoadShow(-5, 'km');
      o.absent = rowLoadShow(undefined, 'km');
      return o;
    });

    t.eq('guard: the distance really is stored canonically in kilometres',
      ru.stored.dist, 4.8, ru.stored);
    t.eq('guard: and the load really is stored exactly as it was typed',
      ru.stored.wt, 25, ru.stored);

    t.ok('the row shows the distance in the athlete\'s own unit',
      /\b3 mi\b/.test(ru.imp.row), ru.imp);
    t.ok('and never the raw kilometre figure wearing a mile label',
      !/4\.8 mi/.test(ru.imp.row), ru.imp);
    t.eq('so the row and the total tile agree about one ruck',
      ru.imp.tiles['Total mi'], '3', ru.imp);
    t.ok('the load carries a unit',
      /\b25 lb load\b/.test(ru.imp.row), ru.imp);
    t.ok('and is never a bare number',
      !/\b25 load\b/.test(ru.imp.row), ru.imp);

    t.ok('FLOOR: a metric athlete reads the same ruck in kilometres',
      /\b4\.8 km\b/.test(ru.met.row), ru.met);
    t.eq('and the tile agrees there too',
      ru.met.tiles['Total km'], '4.8', ru.met);
    t.ok('FLOOR: and the load converts for them rather than keeping the typed number',
      /\b11\.3 kg load\b/.test(ru.met.row), ru.met);

    t.ok('FLOOR: a ruck logged with no distance and no load prints neither',
      /20 min/.test(ru.bare.row) && !/ load/.test(ru.bare.row) && !/\b\d[\d.]* (mi|km)\b/.test(ru.bare.row),
      ru.bare);
    t.ok('FLOOR: a legacy row with no unit tag reads as metric, both halves',
      /\b5 km\b/.test(ru.legacy.row) && /\b10 kg load\b/.test(ru.legacy.row), ru.legacy);

    /* A JUNK ROW WITH NO BOOT BEHIND IT — the door v404's storage listener
       opens. The boot repair cleans these rows, which is exactly why nothing
       had ever driven the render with a dirty one: the mutant that reverts the
       row's `x.dist > 0` guard to bare truthiness escaped every case above,
       because every one of them went through the writer. A string is truthy,
       so the row printed "NaN mi" and the Total tile summed to NaN. */
    t.ok('a junk distance with no boot prints no distance at all',
      !/NaN/.test(ru.junk.row) && !/(mi|km)\b/.test(ru.junk.row), ru.junk);
    t.ok('and the totals it feeds are numbers, not NaN',
      !/NaN/.test(String(ru.junk.tiles['Total km'])) &&
      !/NaN/.test(String(ru.junk.tiles['Min this week'])), ru.junk);

    /* THE HELPER'S OWN CONTRACT, ASSERTED DIRECTLY. Its `w > 0` guard is
       consulted from one call site that already tests `x.wt`, so no rendered
       case can reach it and the mutant that deletes it escapes every screen
       assertion — the shape v338's prepDatePassed() and v380's monoNow()
       needed. A guard consulted in one narrow branch still has to mean what it
       is named, and a second caller would find it. */
    t.eq('rowLoadShow says nothing at all for a load that is not one',
      [ru.zero, ru.negative, ru.absent], ['', '', ''], ru);
  }

  /* THE 1-REP-MAX CALCULATOR WAS HARDCODED TO POUNDS FOR EVERYBODY (v446).

     Found by the same sweep as the ruck row: every interpolation followed by a
     hardcoded unit. calcOneRM() is a RATIO — w * (1 + r/30) — so the answer
     already comes out in whatever unit the athlete typed, and only the label
     was wrong. A metric athlete entering 100 kg read "Estimated 1RM ~ 133 lb",
     which is really 133 kg: 32% understated in the unit on the glass, and it is
     the figure they load the bar to.

     THE FLOOR IS THAT THE NUMBER DOES NOT MOVE. Nothing is converted, because
     there is nothing to convert — a "fix" that converted would report the same
     lift as 133 lb to one athlete and 60 kg to the other, which is a different
     defect wearing this one's clothes. */
  {
    const orm = await page.evaluate(() => {
      const o = {};
      const run = u => {
        STATE.profile.unit = u;
        openStandards();
        const ph = (document.querySelector('#orm-w') || {}).placeholder;
        document.querySelector('#orm-w').value = '100';
        document.querySelector('#orm-r').value = '10';
        calcOneRM();
        const out = (document.querySelector('#ormOut') || {}).textContent || '';
        closeSheet();
        /* anchored on the figure, not on the first digit: /(\d+)/ matches the
           "1" in "1RM" — a loose pattern reading ordinary copy */
        return { ph, out, num: (out.match(/\u2248\s*(\d+)/) || [])[1] };
      };
      o.imp = run('in');
      o.met = run('cm');
      return o;
    });

    t.ok('guard: the calculator really answers, so a wording check means something',
      orm.imp.num === '133' && orm.met.num === '133', orm);

    t.ok('the input asks for the athlete\'s own unit', /\(lb\)/.test(orm.imp.ph), orm.imp);
    t.ok('and the answer is given in it', /133 lb/.test(orm.imp.out), orm.imp);

    t.ok('FLOOR: a metric athlete is asked for kilograms', /\(kg\)/.test(orm.met.ph), orm.met);
    t.ok('and told the answer in kilograms', /133 kg/.test(orm.met.out), orm.met);
    t.ok('and is never told pounds', !/\blb\b/.test(orm.met.out), orm.met);

    t.eq('FLOOR: the number itself does not move — a ratio has nothing to convert',
      orm.imp.num, orm.met.num, orm);
    t.ok('and the training band moves with the label, not on its own',
      /93.106 lb/.test(orm.imp.out.replace(/[^\x20-\x7e]/g, '.')) &&
      /93.106 kg/.test(orm.met.out.replace(/[^\x20-\x7e]/g, '.')), orm);
  }

  /* "LOGGED 1 MOVEMENT" FOR A LIFT WHOSE DEFINING NUMBER WAS THROWN AWAY (v446).

     saveLiftLog() wrote loadKg:null for a load outside plausibleLoadKg() and
     toasted the save anyway, so a typo of one extra digit on a 90 lb lift
     recorded nothing and said it had. A row whose ONLY entry was that load was
     pushed empty, counted, and credited the day in quickLog — streak, heatmap
     and weekly count — for a lift that recorded nothing.

     And the writer enforced a band the repair did not: an imported backup
     carrying 5000 kg survived every boot and drove the progression hint.

     Two guards, two doors. The typed door REFUSES (v412: the athlete is
     standing on the screen and can retype); the boot door DROPS, because a
     clamped measurement is a number nobody lifted. */
  {
    const lf = await page.evaluate(() => {
      const o = {};
      const items = [{ exId: 'dbbench', unit: 'reps', target: 8 },
                     { exId: 'dbrow', unit: 'reps', target: 10 }];
      const type = (i, load, reps) => {
        const L = document.querySelector('#lf-l-' + i), R = document.querySelector('#lf-r-' + i);
        if (L) L.value = load === null ? '' : String(load);
        if (R) R.value = reps === null ? '' : String(reps);
      };
      const run = (unit, rows) => {
        STATE.profile.unit = unit;
        STATE.liftLog = []; STATE.quickLog = {};
        openLiftLog(items);
        rows.forEach((r, i) => type(i, r[0], r[1]));
        saveLiftLog(items.map(m => m.exId));
        const el = document.getElementById('toast');
        return {
          rows: JSON.parse(JSON.stringify(STATE.liftLog)),
          credited: Object.keys(STATE.quickLog).length,
          toast: el ? el.textContent : '',
          sheetOpen: !!document.querySelector('#lf-l-0'),
        };
      };
      o.band = LIFT_LOAD_MAX_KG;
      /* both helpers read profile.unit, so the unit is set before they are asked
         rather than inherited from whatever block ran last */
      STATE.profile.unit = 'in';
      o.overLb = 900; o.edgeLb = Math.floor(loadShow(LIFT_LOAD_MAX_KG));
      o.edgeKg = Math.round(loadToKg(o.edgeLb) * 100) / 100;
      /* the bad row is the SECOND, so a half-save leaves the first behind */
      o.refuse = run('in', [[200, 8], [900, null]]);
      o.ok = run('in', [[200, 8], [150, 10]]);
      o.edge = run('in', [[o.edgeLb, 5], [null, null]]);
      o.met = run('cm', [[900, null], [null, null]]);
      o.metEdge = run('cm', [[400, 5], [null, null]]);
      /* the boot door, with no writer behind it */
      STATE.liftLog = [
        { date: todayISO(), exId: 'dbbench', loadKg: 5000, reps: 5, rir: null },
        { date: todayISO(), exId: 'dbrow', loadKg: 400, reps: 5, rir: null },
        { date: todayISO(), exId: 'dbbench', loadKg: 60, reps: 8, rir: 2 }];
      normalizeState();
      o.repaired = JSON.parse(JSON.stringify(STATE.liftLog));
      return o;
    });

    t.eq('guard: the band is 400 kg, and the quoted bound is 881 lb',
      [lf.band, lf.edgeLb], [400, 881], lf);
    t.ok('guard: and the quoted bound really converts back INSIDE the band — a\n         rounded 882 lb would be 400.07 kg, which the guard itself refuses',
      lf.edgeKg <= lf.band, lf);
    t.ok('guard: the refused load really is outside it', lf.overLb > lf.edgeLb, lf);

    t.eq('an out-of-band load writes nothing at all', lf.refuse.rows.length, 0, lf.refuse);
    t.eq('and never half-saves the good row above it', lf.refuse.rows.length, 0, lf.refuse);
    t.eq('and credits no training day', lf.refuse.credited, 0, lf.refuse);
    t.ok('the toast names the band in the athlete\'s own unit',
      /between 1 and 881 lb/.test(lf.refuse.toast), lf.refuse);
    t.ok('and never claims the movement was logged',
      !/Logged/.test(lf.refuse.toast), lf.refuse);
    t.ok('the form stays on screen so the figures can be retyped',
      lf.refuse.sheetOpen, lf.refuse);

    t.ok('FLOOR: an ordinary save still writes both rows', lf.ok.rows.length === 2, lf.ok);
    t.eq('and still credits the day', lf.ok.credited, 1, lf.ok);
    t.ok('and still says so', /Logged 2 movements/.test(lf.ok.toast), lf.ok);
    t.ok('FLOOR: a load exactly ON the ceiling is a legitimate lift and is kept',
      lf.edge.rows.length === 1 && lf.edge.rows[0].loadKg > 0, lf.edge);

    t.ok('FLOOR: a metric athlete is refused too', lf.met.rows.length === 0, lf.met);
    t.ok('and is told the band in kilograms',
      /between 1 and 400 kg/.test(lf.met.toast), lf.met);
    t.ok('FLOOR: and 400 kg exactly is still a lift they can log',
      lf.metEdge.rows.length === 1 && lf.metEdge.rows[0].loadKg === 400, lf.metEdge);

    /* GUARD FIRST, AND NEVER DEREFERENCE A ROW THE MUTANT MAY HAVE REMOVED.
       The over-eager repair that drops the whole row left lf.repaired[0]
       undefined, so every assertion below THREW and the run reported "the test
       file itself threw" rather than naming a check. Still red, so still a
       catch — but red is not enough, it has to say what. */
    t.eq('FLOOR: no row is dropped — a bad figure is not a bad lift',
      lf.repaired.length, 3, lf.repaired);
    const rp = i => lf.repaired[i] || {};
    t.eq('the boot drops a stored load outside the band', rp(0).loadKg, null, lf.repaired);
    t.eq('and keeps the reps beside it, because the row is still a lift',
      rp(0).reps, 5, lf.repaired);
    t.eq('FLOOR: a stored load ON the ceiling survives untouched',
      rp(1).loadKg, 400, lf.repaired);
    t.eq('FLOOR: and an ordinary one is byte-identical',
      [rp(2).loadKg, rp(2).reps, rp(2).rir], [60, 8, 2], lf.repaired);
  }

  /* THE WRITER'S COMMENT DESCRIBED A FILTER ONLY THE REPAIR HAD (v446).

     The activity-row repair says logAct() "stores dist/wt/secs/rounds only when
     they are above zero". It did not: it Object.assign'd whatever it was
     handed, and saveRuck() passes `d||undefined` where d can be NEGATIVE
     (r1(-5) is -5, which is truthy). One rule now, asked by both doors.

     Driven with NO BOOT BEHIND IT, because the repair is the neighbour that
     would otherwise supply the answer — it cleans the row on the next launch,
     which is exactly why nobody saw this. */
  {
    const neg = await page.evaluate(() => {
      const o = {};
      const ruck = (dist, wt) => {
        STATE.ruckLog = [];
        STATE.profile.unit = 'cm';
        openRuck();
        document.querySelector('#rk-min').value = '45';
        document.querySelector('#rk-dist').value = String(dist);
        document.querySelector('#rk-wt').value = String(wt);
        saveRuck();
        const sh = document.getElementById('sheet');
        const row = [...sh.querySelectorAll('.kv')][0];
        const tiles = {};
        [...sh.querySelectorAll('.stat')].forEach(st => {
          tiles[(st.querySelector('.l') || {}).textContent] =
            (st.querySelector('.n') || {}).textContent;
        });
        return { stored: JSON.parse(JSON.stringify(STATE.ruckLog[0] || {})),
                 row: row ? row.textContent.replace(/\s+/g, ' ').trim() : null, tiles };
      };
      o.bad = ruck(-5, -10);
      o.good = ruck(5, 10);
      closeSheet();
      return o;
    });

    t.ok('guard: the writer really ran and wrote the minutes',
      neg.bad.stored.mins === 45 && neg.good.stored.mins === 45, neg);

    t.eq('a negative distance is not stored at all', neg.bad.stored.dist, undefined, neg.bad);
    t.eq('nor a negative load', neg.bad.stored.wt, undefined, neg.bad);
    /* anchored on a FIGURE with a unit: every row carries an ISO date, so /-\d/
       matches "-09" on correct output */
    t.ok('so nothing on the row shows a negative figure',
      !/-\d[\d.]* ?(km|mi|kg|lb|load)/.test(neg.bad.row), neg.bad);
    t.eq('and the total is not dragged below zero', neg.bad.tiles['Total km'], '0', neg.bad);

    t.eq('FLOOR: a real distance is stored', neg.good.stored.dist, 5, neg.good);
    t.eq('FLOOR: and a real load with it', neg.good.stored.wt, 10, neg.good);
    t.ok('FLOOR: and both print', /5 km/.test(neg.good.row) && /10 kg load/.test(neg.good.row),
      neg.good);
  }

  /* A BOUND THE ATHLETE IS TOLD MUST BE ONE THEY CAN ACTUALLY ENTER (v446).

     Every "looks off — expected ..." message hand-wrote its imperial pair, and
     FOUR of them named a figure the guard itself refuses:

       55 lb  -> 24.95 kg   against a 25 kg floor
       66 lb  -> 29.94 kg   against the wizard's own 30 kg floor
       47 in  -> 119.38 cm  against a 120 cm floor
       91 in  -> 231.14 cm  against a 230 cm ceiling

     An athlete at the edge types the number they were just told and is refused
     again by the same sentence — a dead end wearing the clothes of an
     explanation. Rounded INWARD now, and derived from the band rather than
     restated beside it, which is how the two came to disagree.

     AND THE TWO TYPED DOORS DISAGREED. The wizard and the calorie sheet are
     twins this file has already recorded drifting once: age was 13-100 in one
     and 14-100 in the other, so an athlete who set the app up at 13 was refused
     by the sheet; weight was 30-250 kg against plausibleKg()'s 25-350.

     ASSERTED AS A CLASS: every bound the app quotes is fed back through the
     app's own predicate. A future band written the same way fails here. */
  {
    const bd = await page.evaluate(() => {
      const o = {};
      const ends = str => (str.match(/(\d+)–(\d+)/) || []).slice(1).map(Number);
      o.imp = { weight: weightBandI(true), height: heightBandI(true), waist: waistBandI(true) };
      o.met = { weight: weightBandI(false), height: heightBandI(false), waist: waistBandI(false) };
      /* every quoted end, fed back through the app's OWN predicate */
      const check = (label, str, imp, per, pred) => {
        const [lo, hi] = ends(str);
        return { label, lo, hi, loOk: pred(lo * (imp ? per : 1)), hiOk: pred(hi * (imp ? per : 1)) };
      };
      o.fed = [
        check('weight lb', o.imp.weight, true, 0.453592, plausibleKg),
        check('weight kg', o.met.weight, false, 0.453592, plausibleKg),
        check('height in', o.imp.height, true, 2.54, plausibleHeightCm),
        check('height cm', o.met.height, false, 2.54, plausibleHeightCm),
        check('waist in', o.imp.waist, true, 2.54, plausibleWaistCm),
        check('waist cm', o.met.waist, false, 2.54, plausibleWaistCm),
      ];
      /* the trap is real: the figures these messages USED to quote are refused */
      o.trap = {
        lb55: plausibleKg(55 * 0.453592), lb56: plausibleKg(56 * 0.453592),
        in47: plausibleHeightCm(47 * 2.54), in48: plausibleHeightCm(48 * 2.54),
        in91: plausibleHeightCm(91 * 2.54), in90: plausibleHeightCm(90 * 2.54),
      };
      /* one band per field: both typed doors ask the same predicate */
      o.age = { min: AGE_MIN, max: AGE_MAX, at13: ageEntryOk(13), at12: ageEntryOk(12),
                repairAt10: plausibleAge(10) };
      return o;
    });

    t.ok('guard: the figures these messages used to quote really are refused',
      bd.trap.lb55 === false && bd.trap.in47 === false && bd.trap.in91 === false, bd.trap);
    t.ok('guard: and the ones beside them really are accepted',
      bd.trap.lb56 === true && bd.trap.in48 === true && bd.trap.in90 === true, bd.trap);

    bd.fed.forEach(f => {
      t.ok('every end of the ' + f.label + ' band the app quotes is enterable',
        f.loOk === true && f.hiOk === true, f);
    });

    t.eq('FLOOR: the metric bands are the canonical ones, unchanged',
      [bd.met.weight, bd.met.height, bd.met.waist],
      ['25–350 kg', '120–230 cm', '40–250 cm'], bd.met);
    t.eq('and the imperial ones are rounded INWARD, not to the nearest',
      [bd.imp.weight, bd.imp.height, bd.imp.waist],
      ['56–771 lb', '48–90 in', '16–98 in'], bd.imp);

    t.eq('one age band, so the wizard and the calorie sheet cannot refuse each other',
      [bd.age.min, bd.age.max, bd.age.at13, bd.age.at12], [13, 100, true, false], bd.age);
    t.ok('FLOOR: and the REPAIR stays wider — it must not drop a value a typed door took',
      bd.age.repairAt10 === true, bd.age);

    /* DRIVEN, because calling the predicate is not driving the route: the
       mutant that gave the calorie sheet its own 14-100 band back walked past
       every assertion above, which only ever asked ageEntryOk(). */
    const sheet = await page.evaluate(() => {
      STATE.profile.unit = 'cm';
      nut().sex = 'male';
      openTDEE();
      document.querySelector('#td-age').value = '13';
      document.querySelector('#td-ht').value = '170';
      document.querySelector('#td-wt').value = '60';
      saveTDEE();
      const el = document.getElementById('toast');
      const out = { toast: el ? el.textContent : '', age: nut().age };
      closeSheet();
      return out;
    });
    t.eq('the calorie sheet accepts the youngest age the wizard does', sheet.age, 13, sheet);
    t.ok('and never says the age looks off', !/Age looks off/.test(sheet.toast), sheet);
  }

  /* And the rule is ASKED FOR rather than declared: a check counting the helper
     passes while a message keeps its own hand-written pair, which is the drift
     that produced this round. */
  {
    const src = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script:not([src])')];
      /* the FIRST inline script on this page is two characters long */
      const app = scripts.map(s => s.textContent).sort((a, b) => b.length - a.length)[0] || '';
      return { len: app.length, body: app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') };
    });
    t.ok('guard: the scan really read the app', src.len > 400000, { len: src.len });
    /* any quote character, because the wizard's messages are template literals */
    const hand = (src.body.match(/['"`]\s*\d+–\d+ (lb|kg|in|cm)/g) || []);
    t.eq('no message hand-writes a band beside the predicate that holds it',
      hand, [], hand);

    /* A DUPLICATE TOP-LEVEL FUNCTION NAME IS SILENT, AND THE LAST ONE WINS.
       This round declared a second plausibleAge() beside the repair's own,
       which quietly gave both typed doors the repair's wider band — and
       `npm run check` cannot see it, because the file parses perfectly. Same
       family as the duplicate-key guard on the data literals, on the 1,140
       top-level functions instead. */
    const names = (src.body.match(/^function\s+[A-Za-z_$][\w$]*/gm) || [])
      .map(m => m.replace(/^function\s+/, ''));
    const seen = {}, dupes = [];
    names.forEach(n => { if (seen[n] && dupes.indexOf(n) < 0) dupes.push(n); seen[n] = 1; });
    t.ok('guard: the scan found the app\'s top-level functions', names.length > 900,
      { found: names.length });
    t.eq('no top-level function name is declared twice', dupes, [], dupes);

    /* and no typed door restates the age band beside the predicate that holds
       it — the wizard cannot be driven from here, so the rule is scanned */
    /* narrowed to the values a typed age band uses — a looser pattern matches
       ordinary copy, and did: `age<21` is a real and legitimate comparison */
    const handAge = (src.body.match(/age\s*[<>]=?\s*(1[0-9]|100)\b/g) || []);
    t.eq('no typed door hand-writes the age band', handAge, [], handAge);
  }

  /* ---------- v448: the warm-up you are SHOWN is the warm-up you GET -------
     runWarmup() applies jointAwareWarmup(), mobilityFlow() and — inside
     runFlow() — safeFlow(). The two Today panes, the spoken brief and the
     mobility picker all listed the RAW arrays, so four surfaces described a
     session nobody does. Measured before the fix:

       shoulder flag  pane listed "Arm Circles" and the coach said it aloud;
                      safeFlow() strips it for exactly that flag, and the
                      Shoulder Activation put in its place appeared nowhere
       low back       cool-down pane listed 7 and the athlete got 3
       low mobility   pane printed 40s / 30s while the hold ran 50s / 38s
       low back       mobility picker said 10 / 6 / 6 moves, delivered 5 / 3 / 4

     Every expectation below is a VALUE rather than the app's own expression,
     so a mutant cannot move both sides of the comparison. */
  {
    const names = h => (h.match(/<b>([^<]+)<\/b>/g) || []).map(x => x.replace(/<\/?b>/g, ''));
    const w = await page.evaluate(() => {
      const P = STATE.profile;
      const keep = { lim: P.limitations, mob: P.mobility };
      const o = {};
      P.limitations = []; P.mobility = 'ok';
      o.paneClean = warmupTabHTML();
      o.briefClean = briefSegments().find(s => s.title.indexOf('Warm-up') === 0).say;

      P.limitations = ['shoulder'];
      /* guard: the filter really removes this move for this flag, or every
         assertion below is satisfied by a filter that does nothing */
      o.stripsArmCircles = !safeFlow(WARMUP_FLOW).some(x => x.n === 'Arm Circles');
      o.paneShoulder = warmupTabHTML();
      o.briefShoulder = briefSegments().find(s => s.title.indexOf('Warm-up') === 0).say;

      P.limitations = ['lowback'];
      o.cdPaneLowback = cooldownTabHTML();
      o.briefCoolLowback = briefSegments().find(s => s.title.indexOf('Cool-down') === 0).say;
      o.mobRaw = MOBILITY_FLOWS.map(m => m.flow.length);

      P.limitations = []; P.mobility = 'low';
      o.paneSecsLow = (warmupTabHTML().match(/(\d+)s</g) || []).map(x => x.replace('<', ''));

      P.limitations = keep.lim; P.mobility = keep.mob;
      return o;
    });

    t.ok('guard: safeFlow really strips Arm Circles for a flagged shoulder',
      w.stripsArmCircles, w);

    // FLOOR — an unflagged athlete's pane is the whole eight-move warm-up
    t.eq('an unflagged athlete is shown the full warm-up', names(w.paneClean).length, 8,
      names(w.paneClean));
    t.ok('and it still opens with March in Place and Arm Circles',
      names(w.paneClean)[0] === 'March in Place' && names(w.paneClean)[1] === 'Arm Circles',
      names(w.paneClean));

    t.eq('a flagged shoulder is NOT shown Arm Circles',
      names(w.paneShoulder).indexOf('Arm Circles'), -1, names(w.paneShoulder));
    t.ok('and IS shown the Shoulder Activation put in its place',
      names(w.paneShoulder).indexOf('Shoulder Activation') >= 0, names(w.paneShoulder));

    t.eq('a flagged low back is shown the three cool-down stretches it gets',
      names(w.cdPaneLowback), ["Child's Pose", 'Cat–Cow', 'Deep Breathing'],
      names(w.cdPaneLowback));

    t.eq('limited mobility is shown the LONGER holds it actually gets',
      w.paneSecsLow, ['50s', '38s', '38s', '38s', '38s', '50s', '38s', '38s'], w.paneSecsLow);

    // the spoken brief names the same flow
    t.ok('the coach does not name a move the app has removed',
      !/Arm Circles/.test(w.briefShoulder), w.briefShoulder);
    t.ok('and the remainder is counted, not guessed at as "a couple"',
      /and 4 more/.test(w.briefClean) && !/a couple more/.test(w.briefClean), w.briefClean);
    t.ok('the cool-down names the real stretches rather than a target it lost',
      /Child's Pose/.test(w.briefCoolLowback) && !/abs and low back/.test(w.briefCoolLowback),
      w.briefCoolLowback);

    // the mobility picker counts what it will deliver
    const mob = await page.evaluate(() => {
      const P = STATE.profile, keep = P.limitations;
      P.limitations = ['lowback'];
      const counts = MOBILITY_FLOWS.map(m => safeFlow(m.flow).length);
      P.limitations = keep;
      return counts;
    });
    t.ok('guard: a flagged low back really shortens every mobility flow',
      mob.length === 3 && mob.every((n, i) => n < w.mobRaw[i]), { mob, raw: w.mobRaw });
    t.eq('and the picker counts the shortened flow, not the raw one', mob, [5, 3, 4], mob);
  }

  /* ---------- v448: one fact, two surfaces, opposite hardcoded units -------
     The Fuel card printed LITRES to everybody and the spoken brief printed
     OUNCES to everybody. Measured on a 13-cup target: a metric athlete HEARD
     "about 104 ounces" and READ "3.1 L"; an imperial athlete got the mirror.
     Cups stay — the counter is a glass — it is the volume beside it that has
     to be the athlete's own. */
  {
    const r = await page.evaluate(() => {
      const P = STATE.profile, keep = { u: P.unit, kg: nut().weightKg };
      const o = {};
      nut().weightKg = 86;
      o.cups = waterTargetCups();
      P.unit = 'cm';
      o.sayM = briefSegments().find(s => s.title === 'Hydration').say;
      renderFuel(); o.fuelM = ($('#v-fuel').innerText.match(/≈[^\n·]*/) || [''])[0].trim();
      P.unit = 'in';
      o.sayI = briefSegments().find(s => s.title === 'Hydration').say;
      renderFuel(); o.fuelI = ($('#v-fuel').innerText.match(/≈[^\n·]*/) || [''])[0].trim();
      P.unit = keep.u; nut().weightKg = keep.kg;
      try { renderFuel(); } catch (e) {}
      return o;
    });
    t.eq('guard: the target used for both readings is the same 13 cups', r.cups, 13, r);
    t.ok('a metric athlete HEARS litres', /about 3\.1 litres/.test(r.sayM), r);
    t.eq('and READS the same litres on Fuel', r.fuelM, '≈ 3.1 L goal', r);
    t.ok('an imperial athlete HEARS ounces', /about 104 ounces/.test(r.sayI), r);
    t.eq('and READS the same ounces on Fuel', r.fuelI, '≈ 104 oz goal', r);
    t.ok('neither surface speaks the other one\'s unit',
      !/ounce/.test(r.sayM) && !/litre/.test(r.sayI), r);
    t.ok('and cups are still the counter on both', /13 cups/.test(r.sayM) && /13 cups/.test(r.sayI), r);
  }

  errors.forEach(e => t.fail('a page error fired during hardening checks', e));
  await browser.close();
  srv.close();
  return t.finish();
}