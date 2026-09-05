/* The athlete's journey, driven through the real UI: the wizard, the baseline
   battery, the four Today panes, the guided player, and every button on every
   tab. Nothing here injects state that the app would not have produced itself. */
import { serve, launch, suite, seedAthlete, waitForBoot, ATHLETE } from './lib/harness.mjs';

export default async function run() {
  const t = suite('athlete journey');
  const { srv, port } = await serve();

  // ---- onboarding, clicked like a first-time user --------------------------
  {
    const { browser, page, errors } = await launch(port);
    const steps = [];
    for (let i = 0; i < 12; i++) {
      const before = await page.evaluate(() => {
        const s = document.querySelector('.ob-step:not([style*="display: none"])');
        return s ? s.dataset.step : null;
      });
      if (!before) break;
      steps.push(before);
      await page.evaluate(() => {
        const vis = document.querySelector('.ob-step:not([style*="display: none"])');
        if (!vis) return;
        vis.querySelectorAll('input[type=text],input[type=number],input:not([type])').forEach(inp => {
          if (inp.value) return;
          const id = inp.id || '';
          if (/name/.test(id)) inp.value = 'Test Athlete';
          else if (/age/.test(id)) inp.value = '41';
          else if (/height/.test(id)) inp.value = '178';
          else if (/goalwt|goalwaist/.test(id)) inp.value = '';
          else if (/weight/.test(id)) inp.value = '88';
          else if (/waist/.test(id)) inp.value = '96';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        });
        vis.querySelectorAll('.daypick,.chooser,.seg').forEach(g => {
          if (g.querySelector('button.on')) return;
          const b = g.querySelector('button'); if (b) b.click();
        });
      });
      const btn = await page.$('#ob-next');
      if (!btn) { t.fail('wizard step has no Next button', 'step ' + before); break; }
      await btn.click(); await page.waitForTimeout(240);
      const after = await page.evaluate(() => {
        const s = document.querySelector('.ob-step:not([style*="display: none"])');
        return s ? s.dataset.step : null;
      });
      if (after === before) { t.fail('Next did not advance the wizard', 'stuck on step ' + before); break; }
      if (!after) break;
    }
    const done = await page.evaluate(() => ({
      onboarded: STATE.onboarded, name: STATE.profile.name, age: STATE.profile.age,
      heightCm: STATE.profile.heightCm, parqDone: STATE.profile.parqDone,
      weightKg: STATE.nutrition.weightKg, kcal: STATE.nutrition.kcalTarget,
      days: STATE.profile.days, landing: (document.querySelector('#v-today') || {}).innerText || '',
    }));
    t.ok('the wizard walks all 7 steps and completes', done.onboarded, { steps, done });
    t.ok('the name typed in the wizard is saved', done.name === 'Test Athlete', done);
    t.ok('age and height are saved', done.age === 41 && done.heightCm === 178, done);
    t.ok('bodyweight is saved', done.weightKg === 88, done);
    t.ok('the calorie target is computed on completion', done.kcal > 0, done);
    t.ok('the health screen is recorded as answered', done.parqDone === true, done);
    t.ok('onboarding lands on the baseline test', /Baseline Test/i.test(done.landing), done.landing.slice(0, 120));
    await browser.close();
    errors.forEach(e => t.fail('page error during onboarding', e));
  }

  /* ---- the day-picker's own promise — "keep at least five" — is enforced,
     not just printed. Walked through the real wizard exactly like the block
     above, but this time deliberately dropping below the floor on step 5. */
  {
    const { browser, page, errors } = await launch(port);
    const fillVisibleStep = () => page.evaluate(() => {
      const vis = document.querySelector('.ob-step:not([style*="display: none"])');
      if (!vis) return;
      vis.querySelectorAll('input[type=text],input[type=number],input:not([type])').forEach(inp => {
        if (inp.value) return;
        const id = inp.id || '';
        if (/name/.test(id)) inp.value = 'Floor Test';
        else if (/age/.test(id)) inp.value = '30';
        else if (/height/.test(id)) inp.value = '178';
        else if (/goalwt|goalwaist/.test(id)) inp.value = '';
        else if (/weight/.test(id)) inp.value = '82';
        else if (/waist/.test(id)) inp.value = '90';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      });
      // every group except the day-picker itself defaults sanely — leave #ob-days alone here
      vis.querySelectorAll('.daypick:not(#ob-days),.chooser,.seg').forEach(g => {
        if (g.querySelector('button.on')) return;
        const b = g.querySelector('button'); if (b) b.click();
      });
    });
    for (let i = 0; i < 4; i++) { await fillVisibleStep(); await page.click('#ob-next'); await page.waitForTimeout(200); }
    const onStep5 = await page.evaluate(() => document.querySelector('.ob-step:not([style*="display: none"])')?.dataset.step);
    t.eq('the walkthrough reaches the schedule step', onStep5, '5');

    // drop to 2 days and try to advance
    const before = await page.evaluate(() => {
      document.querySelectorAll('#ob-days button.on').forEach(b => b.click());
      const btns = [...document.querySelectorAll('#ob-days button')];
      btns[0].click(); btns[3].click();
      return { selected: document.querySelectorAll('#ob-days button.on').length };
    });
    t.eq('two days are actually selected', before.selected, 2);
    await page.click('#ob-next'); await page.waitForTimeout(150);
    const blocked = await page.evaluate(() => ({
      step: document.querySelector('.ob-step:not([style*="display: none"])')?.dataset.step,
      flagged: document.getElementById('ob-days').classList.contains('bad'),
      toast: (document.getElementById('toast') || {}).textContent,
    }));
    t.eq('two days does not advance past the schedule step', blocked.step, '5');
    t.ok('the day-picker is visibly flagged', blocked.flagged, blocked);
    t.ok('and the toast names the floor', /at least 5/.test(blocked.toast), blocked);

    // the boundary itself: four is still short of the floor, not close enough
    const four = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#ob-days button')];
      btns[1].click(); btns[2].click();
      return { selected: document.querySelectorAll('#ob-days button.on').length };
    });
    t.eq('four days are now selected', four.selected, 4);
    await page.click('#ob-next'); await page.waitForTimeout(150);
    const stillBlocked = await page.evaluate(() => document.querySelector('.ob-step:not([style*="display: none"])')?.dataset.step);
    t.eq('four days still does not clear the floor', stillBlocked, '5');

    // fix it — the fifth day, the flag clears, and the wizard actually advances
    const fixed = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#ob-days button')];
      btns[4].click();
      return { selected: document.querySelectorAll('#ob-days button.on').length,
        flaggedNow: document.getElementById('ob-days').classList.contains('bad') };
    });
    t.eq('five days are now selected', fixed.selected, 5);
    t.ok('the flag clears as soon as the floor is met', !fixed.flaggedNow, fixed);
    await page.click('#ob-next'); await page.waitForTimeout(150);
    const advanced = await page.evaluate(() => document.querySelector('.ob-step:not([style*="display: none"])')?.dataset.step);
    t.eq('five days advances past the schedule step', advanced, '6');

    /* obReadForm() is the actual write path into STATE.profile.days — it must
       hold the floor on its own, not merely trust that a caller reached it
       through the wizard's Next-button gate. Drop back below 5 directly on
       the still-mounted DOM and call it without going through obBlocked(). */
    const direct = await page.evaluate(() => {
      document.querySelectorAll('#ob-days button.on').forEach(b => b.click());
      const btns = [...document.querySelectorAll('#ob-days button')];
      btns[0].click(); btns[1].click(); btns[2].click();   // exactly 3, unreachable via the wizard's own gate
      obReadForm();
      return { days: STATE.profile.days };
    });
    t.ok('obReadForm() itself refuses to persist fewer than 5 days',
      Array.isArray(direct.days) && direct.days.length >= 5, direct);
    await browser.close();
    errors.forEach(e => t.fail('page error during the day-floor walkthrough', e));
  }

  // ---- the baseline battery, driven through the real sheet ----------------
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page, () => { STATE.baseline = null; STATE.scoreHistory = []; STATE.prs = {}; save(); render(); });
    await page.waitForTimeout(200);
    const start = await page.$('#startAssess');
    t.ok('a screened athlete can start the baseline', !!start);
    if (start) {
      await start.click(); await page.waitForTimeout(200);
      const ENTER = { plank: 150, side: 95, hollow: 70, lower: 30, push: 48, pull: 22, squat: 62, dyn: 55, power: 14, stamina: 24 };
      const walked = [];
      for (let i = 0; i < 12; i++) {
        const cur = await page.evaluate(() => {
          const s = document.querySelector('#sheet');
          if (!s || !s.querySelector('#assess-val')) return null;
          const test = TESTS[assessState.idx];
          return { id: test.id, unit: test.unit, idx: assessState.idx,
            header: (s.innerText.match(/Test \d+ of \d+/) || [''])[0],
            hasTimer: /startBaselineTimer/.test(s.innerHTML) };
        });
        if (!cur) break;
        walked.push(cur.id);
        t.ok(`test ${cur.idx + 1} shows its progress header`, !!cur.header, cur);
        if (cur.unit === 'time') t.ok(`timed test "${cur.id}" offers a timer`, cur.hasTimer, cur);
        await page.evaluate(v => {
          const el = document.querySelector('#assess-val');
          el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true }));
        }, ENTER[cur.id]);
        // assessNav(1) now lands on the 2-minute rest between tests; skip it the
        // way the athlete can, rather than pretending the rest is not there.
        await page.evaluate(() => { assessNav(1); if (typeof _ar !== 'undefined' && _ar) skipAssessRest(); });
        await page.waitForTimeout(120);
      }
      t.eq('all 10 tests are walked', walked.length, 10);
      const res = await page.evaluate(() => ({
        maxes: STATE.baseline && STATE.baseline.maxes, score: STATE.baseline && STATE.baseline.score,
        level: STATE.baseline && STATE.baseline.level, testCount: STATE.baseline && STATE.baseline.testCount,
        prs: STATE.prs || {}, history: (STATE.scoreHistory || []).length,
      }));
      t.ok('the baseline is stored', !!res.maxes, res);
      if (res.maxes) {
        const wrong = Object.keys(ENTER).filter(k => res.maxes[k] !== ENTER[k]);
        t.ok('every entered result is stored exactly', wrong.length === 0,
          wrong.map(k => `${k}: entered ${ENTER[k]}, stored ${res.maxes[k]}`));
      }
      t.ok('a Core Score is computed', res.score > 0, res);
      t.eq('the record stamps how many tests it used', res.testCount, 10);
      /* The tests ARE max efforts. Recording them is the only way the plank,
         side plank and squat rows of Strength Standards can ever be rated —
         the program prescribes those as measuring sticks, never as work. */
      const rated = ['plank', 'sideplank', 'squat', 'pushup', 'hollow'].filter(k => res.prs[k] > 0);
      t.eq('the baseline seeds personal bests for the tested movements', rated.length, 5, res.prs);
      t.eq('the score history gains one entry', res.history, 1);
    }
    await browser.close();
    errors.forEach(e => t.fail('page error during the baseline', e));
  }

  /* ---- the Jump Squats test's own 20-second countdown timer (v247) --------
     The walkthrough above never touches the timer — it types straight into
     #assess-val, which is a valid path but proves nothing about the countdown
     UI itself. This drives startBaselineTimer() for real. It also directly
     regression-tests the reps label, which was hardcoded to "60 seconds"
     regardless of the test's actual duration — dead code until this test
     existed (nothing before it ever set t.dur), and the first thing that would
     have shown a wrong number to every athlete taking this test had it shipped
     unfixed. Fast-forwarded by writing _bt.elapsed directly rather than
     waiting out a real 20 seconds — the player's own tests do the equivalent
     with PLAYER.deadline. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page, () => { STATE.baseline = null; save(); render(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => openAssessment());
    await page.waitForTimeout(150);
    // advance from plank (idx 0) to power (idx 1) — assessNav() reads the real
    // input's value, same as the walkthrough above; setting assessState.results
    // directly does nothing, since the field is what it actually checks
    await page.evaluate(() => {
      const el = document.querySelector('#assess-val');
      el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true }));
      assessNav(1);
      if (typeof _ar !== 'undefined' && _ar) skipAssessRest();
    });
    await page.waitForTimeout(150);
    const label = await page.evaluate(() => (document.querySelector('#sheet label') || {}).textContent || '');
    t.ok('the reps label names the test\'s real duration, not a hardcoded one', /20 seconds/.test(label), label);
    t.ok('and not the stale "60 seconds" this label used to show for ANY dur-based test', !/60 seconds/.test(label), label);

    const run = await page.evaluate(async () => {
      startBaselineTimer();
      await new Promise(r => setTimeout(r, 60));   // let the 3-2-1 ready phase start
      const midReady = { mode: _bt.mode, dur: _bt.dur };
      _bt.mode = 'run'; _bt.elapsed = _bt.dur - 1;   // fast-forward past ready and most of the run
      await new Promise(r => setTimeout(r, 1150));   // one more real tick crosses left<=0
      return { midReady, stoppedItself: !_bt, sheetText: (document.querySelector('#sheet') || {}).innerText || '' };
    });
    t.eq('the timer starts in the 3-2-1 ready phase', run.midReady.mode, 'ready');
    t.eq('carrying the test\'s real 20s duration, not a default', run.midReady.dur, 20);
    t.ok('time running out stops the timer itself, without a manual Stop tap', run.stoppedItself, run);
    t.ok('and returns to the reps entry, prompting the athlete to enter what they got', /reps/i.test(run.sheetText), run.sheetText.slice(0, 200));
    await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
    await browser.close();
    errors.forEach(e => t.fail('page error during the power test timer', e));
  }

  /* ---- Day 1 says what a NORMAL day looks like, not just the test (v277) --
     The hero's figure only ever described the baseline TEST — a competitor
     field report flagged that as the exact gap that makes a 54-week program
     feel like a bigger ask than it is on first glance. (That figure was a
     hardcoded "~15 minutes" until v450 derived it; the rests alone are 18.)
     typicalSessionMin() reuses plBudgetMin() (the guided player's own real
     estimate) and sessionStats()'s own 35s/33s-per-move warm-up/cool-down
     pricing — not a second, inventable copy of either number — built from
     buildSession(0), the athlete's actual first day. Driven through the real
     render path (go('today')), not by calling the function directly, matching
     this file's own "nothing here injects state the app would not have
     produced itself" rule. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page, () => { STATE.baseline = null; save(); render(); });
    const r = await page.evaluate(() => {
      go('today');
      const text = document.querySelector('#v-today').innerText;
      const m = text.match(/Most training days after this run about ~(\d+) minutes/);
      return { text, minutes: m ? +m[1] : null };
    });
    t.ok('the Day-1 screen names a typical session length', r.minutes != null, r.text.slice(0, 400));
    t.ok('and it is a real, sane number of minutes', r.minutes > 3 && r.minutes < 90, r.minutes);

    /* Proves the number is actually COMPUTED, not a static string that
       happens to look dynamic — the exact "dead input" shape this whole
       file's onboarding-wizard checks already guard against elsewhere. */
    const moved = await page.evaluate(() => {
      const lo = typicalSessionMin();
      const keep = { exp: STATE.profile.experience, cond: STATE.profile.conditioning, goal: STATE.profile.goal };
      STATE.profile.experience = 'Advanced'; STATE.profile.conditioning = 'high'; STATE.profile.goal = 'gain';
      const hi = typicalSessionMin();
      STATE.profile.experience = keep.exp; STATE.profile.conditioning = keep.cond; STATE.profile.goal = keep.goal;
      return { lo, hi };
    });
    t.ok('the estimate moves when the inputs that feed it change', moved.lo !== moved.hi, moved);

    /* A defensive path: if the estimate can't be computed, the sentence must
       not render at all — no "~null minutes" or an empty fragment left in the
       paragraph. */
    const guarded = await page.evaluate(() => {
      const keep = window.buildSession;
      window.buildSession = () => { throw new Error('forced'); };
      const html = baselineIntroHTML();
      window.buildSession = keep;
      return html;
    });
    t.ok('and the sentence is omitted entirely rather than rendering a broken number',
      !/Most training days/.test(guarded), guarded.slice(0, 400));

    await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
    await browser.close();
    errors.forEach(e => t.fail('page error rendering the Day-1 screen', e));
  }

  /* ---- the baseline test respects a flagged joint (v251) ------------------
     renderAssessStep() used to read EX[t.ex] straight through with no
     safeSwap() call — a maximal-EFFORT battery is a harder ask on a joint
     than an ordinary prescribed set, so a shoulder-flagged athlete was still
     asked to inverted-row to failure and a knee-flagged one to jump-squat for
     20 seconds, the exact class of harm safeSwap() exists everywhere else in
     the app to prevent. Drives the real sheet with a shoulder flag set (the
     "pull" test's own exercise, invertedrow, is shoulder-flagged) and
     confirms the swap actually reaches the screen — not just that safeSwap()
     itself returns a different id, which the app already knew how to do. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page, () => {
      STATE.baseline = null; STATE.profile.limitations = ['shoulder']; save(); render();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => openAssessment());
    await page.waitForTimeout(150);
    // walk to the "pull" test (invertedrow) without asserting on any other step
    let pull = null;
    for (let i = 0; i < 9 && !pull; i++) {
      const cur = await page.evaluate(() => (assessState ? TESTS[assessState.idx] : null));
      if (!cur) break;
      if (cur.id === 'pull') {
        pull = await page.evaluate(() => {
          const s = document.querySelector('#sheet');
          const infoBtn = (s.innerHTML.match(/openExerciseInfo\('([a-z0-9]+)'\)/) || [])[1];
          return { html: s.innerHTML, text: s.innerText, infoBtn,
            infoBtnStillRisky: infoBtn ? JOINT_RISK.shoulder.includes(infoBtn) : null };
        });
        break;
      }
      await page.evaluate(() => {
        const el = document.querySelector('#assess-val');
        el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true }));
        assessNav(1);
        if (typeof _ar !== 'undefined' && _ar) skipAssessRest();
      });
      await page.waitForTimeout(100);
    }
    t.ok('reached the pull test', !!pull);
    if (pull) {
      t.ok('a shoulder-flagged athlete is shown a swap note', /Swapped to/.test(pull.text), pull.text.slice(0, 300));
      t.ok('the swap note names the joint they flagged', /shoulder/i.test(pull.text), pull.text.slice(0, 300));
      t.ok('the "how to" button points at the SWAPPED exercise, not the risky original',
        pull.infoBtn && pull.infoBtn !== 'invertedrow', pull.infoBtn);
      t.ok('and the swapped exercise is not itself shoulder-flagged',
        pull.infoBtn && pull.infoBtnStillRisky === false, pull.infoBtn);
    }
    // an athlete with NO flagged joints sees the original movement, unchanged
    const clean = await page.evaluate(async () => {
      closeSheet(); await new Promise(r => setTimeout(r, 450));
      STATE.profile.limitations = []; assessState = null; openAssessment();
      await new Promise(r => setTimeout(r, 50));
      /* BOUND THE WALK. This was `while (... !== 'pull')`, and any defect that
         stops the battery advancing spins it forever INSIDE page.evaluate — so
         the whole suite hung until the harness timeout rather than naming a
         failed check. Measured: a mutant that refused every typed result ran
         suite 04 for eight minutes against its usual 51 seconds. The v267
         hang, in a check rather than in the app. Bound it, and let the
         assertions below report. */
      let guard = 0;
      while (TESTS[assessState.idx].id !== 'pull' && guard++ < 12) {
        const el = document.querySelector('#assess-val');
        if (!el) break;
        el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true }));
        assessNav(1);
        if (typeof _ar !== 'undefined' && _ar) skipAssessRest();
        await new Promise(r => setTimeout(r, 30));
      }
      if (TESTS[assessState.idx].id !== 'pull') return { stuck: true };
      const s = document.querySelector('#sheet');
      return { hasSwapNote: /Swapped to/.test(s.innerText), infoBtn: (s.innerHTML.match(/openExerciseInfo\('([a-z0-9]+)'\)/) || [])[1] };
    });
    t.ok('guard: the unflagged walk actually reached the pull test', !clean.stuck, clean);
    t.ok('an unflagged athlete sees no swap note', !clean.hasSwapNote, clean);
    t.eq('and the info button still points at the real test exercise', clean.infoBtn, 'invertedrow');
    await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
    await browser.close();
    errors.forEach(e => t.fail('page error during the joint-flagged baseline test', e));
  }

  // ---- Today: four panes, every card control ------------------------------
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    await page.waitForTimeout(250);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('#v-today .ttab')].map(b => b.innerText.trim()));
    t.eq('Today has four sub-tabs', tabs.length, 4, tabs);
    for (const pane of ['brief', 'warmup', 'workout', 'cooldown']) {
      await page.evaluate(p => setTodayTab(p), pane);
      await page.waitForTimeout(160);
      const r = await page.evaluate(() => {
        const v = document.querySelector('#v-today');
        const txt = v.innerText;
        return { len: txt.trim().length,
          bad: (txt.match(/.{0,50}(undefined|NaN|\[object|Infinity).{0,20}/g) || []).slice(0, 2),
          nullish: (txt.match(/(^|[\s>])null([\s<]|$)/g) || []).length,
          broken: [...v.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')) };
      });
      t.ok(`the ${pane} pane renders real content`, r.len > 150, `${r.len} chars`);
      t.ok(`the ${pane} pane shows no placeholder values`, r.bad.length === 0 && r.nullish === 0, r);
      t.ok(`the ${pane} pane has no broken images`, r.broken.length === 0, r.broken);
    }
    await page.evaluate(() => setTodayTab('workout'));
    await page.waitForTimeout(160);
    const acts = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('#v-today .ex [data-act]')].map(b => b.dataset.act))]);
    ['toggle', 'set', 'swap', 'info'].forEach(a =>
      t.ok(`exercise cards offer the "${a}" control`, acts.includes(a), acts));
    const howto = await page.evaluate(() => {
      const s = buildSession(STATE.progressPtr);
      return [...s.main, s.finisher].map(m => {
        try { openExerciseInfo(m.exId);
          const sh = document.querySelector('#sheet'); const txt = sh ? sh.innerText : '';
          const im = sh && sh.querySelector('img.exphoto');
          const r = { id: m.exId, len: txt.length, broken: !!(im && im.complete && im.naturalWidth === 0) };
          closeSheet(); return r;
        } catch (e) { return { id: m.exId, err: String(e).slice(0, 120) }; }
      });
    });
    howto.forEach(h => {
      t.ok(`how-to for ${h.id} opens`, !h.err, h.err);
      t.ok(`how-to for ${h.id} is substantive`, (h.len || 0) > 200, h);
      t.ok(`how-to for ${h.id} has a working image`, !h.broken, h);
    });
    await browser.close();
    errors.forEach(e => t.fail('page error on Today', e));
  }

  // ---- the guided player, driven through every phase ----------------------
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page, () => { STATE.settings = STATE.settings || {}; STATE.settings.voice = false; STATE.settings.beat = false; save(); });
    const drive = await page.evaluate(() => {
      const out = { phases: [], err: null };
      try {
        openPlayer();
        out.mounted = !!document.querySelector('.pl-name');
        out.items = PLAYER ? PLAYER.items.length : 0;
        for (let g = 0; g < 30000 && document.querySelector('#player.open'); g++) {
          const p = PLAYER && PLAYER.phase;
          if (p && out.phases[out.phases.length - 1] !== p) out.phases.push(p);
          if (!PLAYER) break;
          if (p === 'ready') plTickReady();
          else if (p === 'work') ((PLAYER.items[PLAYER.i] || {}).unit === 'time') ? plTickHold() : plTickRep();
          else if (p === 'rest') plTickRest();
          else break;
        }
      } catch (e) { out.err = String(e).slice(0, 200); }
      const log = STATE.logs[String(STATE.progressPtr)] || {};
      out.exLogged = Object.keys(log.ex || {}).length;
      out.setsLogged = Object.values(log.ex || {}).reduce((a, x) => a + (x.sets || []).filter(Boolean).length, 0);
      out.prs = Object.keys(STATE.prs || {}).length;
      out.finalPhase = PLAYER && PLAYER.phase;
      out.timerLeak = !!(window.timer && window.timer.iv);
      out.expected = (() => { const s = buildSession(STATE.progressPtr); return s.main.length + 1; })();
      return out;
    });
    t.ok('the player mounts', drive.mounted, drive);
    t.ok('the player never throws while running', !drive.err, drive.err);
    t.ok('the player cycles ready -> work -> rest', ['ready', 'work', 'rest'].every(p => drive.phases.includes(p)), drive.phases.slice(0, 6));
    t.ok('the player reaches its finish screen', drive.finalPhase === 'done', drive);
    t.eq('the player logs every exercise in the session', drive.exLogged, drive.expected);
    t.ok('the player logs sets', drive.setsLogged > 0, drive);
    t.ok('the player records personal bests', drive.prs > 0, drive);
    t.ok('no timer is left running after the player finishes', !drive.timerLeak, drive);
    await browser.close();
    errors.forEach(e => t.fail('page error in the player', e));
  }

  // ---- every button on every tab -----------------------------------------
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page, () => { STATE.progressPtr = 12; save(); });
    let clicked = 0;
    for (const tab of ['today', 'program', 'fuel', 'progress', 'guide']) {
      await page.click(`[data-tab="${tab}"]`).catch(() => t.fail('tab is not clickable', tab));
      await page.waitForTimeout(280);
      const r = await page.evaluate(tb => {
        const v = document.querySelector('#v-' + tb); const txt = v.innerText;
        return { len: txt.trim().length,
          bad: (txt.match(/.{0,50}(undefined|NaN|\[object|Infinity).{0,20}/g) || []).slice(0, 2),
          nullish: (txt.match(/(^|[\s>])null([\s<]|$)/g) || []).length,
          broken: [...v.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')),
          overflow: v.scrollWidth > v.clientWidth + 2 };
      }, tab);
      t.ok(`the ${tab} tab renders`, r.len > 200, `${r.len} chars`);
      t.ok(`the ${tab} tab shows no placeholder values`, r.bad.length === 0 && r.nullish === 0, r);
      t.ok(`the ${tab} tab has no broken images`, r.broken.length === 0, r.broken);
      t.ok(`the ${tab} tab does not overflow a 390px screen`, !r.overflow, r);
      const n = await page.evaluate(() => document.querySelectorAll('#v-' + TAB + ' button').length);
      for (let i = 0; i < n; i++) {
        const res = await page.evaluate(({ tb, idx }) => {
          const btn = document.querySelectorAll('#v-' + tb + ' button')[idx];
          if (!btn) return null;
          const label = (btn.innerText || btn.title || '').trim().slice(0, 40);
          try { btn.click(); } catch (e) { return { label, err: String(e).slice(0, 140) }; }
          return { label, err: null };
        }, { tb: tab, idx: i });
        if (res) { clicked++; if (res.err) t.fail('a button click threw', `${tab} · "${res.label}" -> ${res.err}`); }
        /* Recover from whatever that click opened, so one button cannot poison
           the rest of the sweep. closeSheet() alone was enough while every
           button that mounts a FULL-SCREEN surface lived on 'today', the first
           tab — v246 moved the Weights tile to Program, and startWeights()
           legitimately opens the player. `.pl` is z-index 75 and covers the tab
           bar, so a real page.click() on the next tab then times out and every
           later tab renders 0 chars. That is the harness lacking a teardown,
           not the app misbehaving: the tile does exactly what it always did. */
        await page.evaluate(() => {
          try { closeSheet(); } catch (e) {}
          try { playerTeardown(); } catch (e) {}
          try { hiitTeardown(); } catch (e) {}
        });
        await page.waitForTimeout(30);
      }
    }
    t.ok('a meaningful number of controls were exercised', clicked > 150, clicked + ' buttons clicked');
    await browser.close();
    errors.forEach(e => t.fail('page error while clicking through the tabs', e));
  }

  /* ---- the two-minute rest between tests is now a FEATURE ---------------
     The battery's own guidance says, in bold, "Rest 2 minutes between tests —
     these are maximal efforts, and a short rest measures your recovery instead
     of your strength." Nothing enforced it or even helped: assessNav() went
     straight to the next test. A promise in UI text is a specification, and
     this one had no code behind it. Reported by an athlete who realised
     afterwards he had taken thirty or forty seconds between some of them —
     and whose two lowest scores were the two tests that follow another trunk
     test. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(async () => {
      openAssessment();
      await new Promise(z => setTimeout(z, 150));
      const o = {};
      const put = v => { const e = document.querySelector('#assess-val');
        e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); };
      put(129); assessNav(1);
      await new Promise(z => setTimeout(z, 150));
      o.restShown = !!document.querySelector('#arRing');
      o.clock = (document.querySelector('#arNum') || {}).textContent;
      /* The clock must be SOLID: rest has no ten-second spoken cue, so it is
         the one timer with nothing behind it — the same rule the player's rest
         screen follows. */
      o.solid = !!(document.querySelector('#arRing') || { classList: { contains: () => false } }).classList.contains('solid');
      /* Previews what is COMING, so the athlete can get set. */
      o.media = !!document.querySelector('#arRing .pl-ringmedia img, #arRing .pl-ringmedia video');
      /* Scope this to the row that names it, and require the name of the test
         that is COMING — a page-wide substring search would pass on the label
         of the test just finished. Read textContent, not innerText: `.tt` is
         uppercased in CSS, so innerText returns "UP NEXT". */
      o.nextName = TESTS[assessState.idx + 1].name;
      const up = [...document.querySelectorAll('#sheet .timerbox .tt')]
        .find(e => /^Up next/.test(e.textContent));
      o.upRow = up ? up.textContent : null;
      o.namesNext = !!(up && up.textContent.includes(o.nextName));
      /* And it must NOT have advanced yet — the rest is between the tests. */
      o.idxHeld = assessState.idx;
      /* Guard before anything that assumes the rest exists. Without this a
         mutant that skips the rest entirely kills the block with a TypeError
         on the line below, and the suite reports "the file threw" instead of
         naming the check that failed. */
      if (!_ar) { o.noRest = true; return o; }
      /* Run it out. */
      _ar.left = 2;
      await new Promise(z => setTimeout(z, 2600));
      o.afterExpiry = { idx: assessState.idx, onTest: !!document.querySelector('#assess-val'),
        rests: (assessState.rests || []).slice() };
      /* Skipping records the seconds actually TAKEN, not a zero — the athlete
         did rest, just not the full two minutes, and a re-test comparison
         wants the real number. */
      put(12); assessNav(1);
      await new Promise(z => setTimeout(z, 150));
      if (!_ar) { o.noRest = true; return o; }
      _ar.left = 80;                       // 40 of the 120 taken
      skipAssessRest();
      await new Promise(z => setTimeout(z, 150));
      o.afterSkip = (assessState.rests || []).slice();
      /* Stepping BACK to fix a mistyped number is not a new effort and must
         not cost two minutes. */
      assessNav(-1);
      await new Promise(z => setTimeout(z, 150));
      o.back = { idx: assessState.idx, onRest: !!document.querySelector('#arRing') };
      /* Cancelling mid-rest must not leave an interval running against a
         screen that is gone — it would re-open the battery a minute later. */
      if (o.back.onRest) return o;         // a mutant that rests on Back has no field to type into
      put(30); assessNav(1);
      await new Promise(z => setTimeout(z, 150));
      assessQuit();
      o.quitClears = (typeof _ar === 'undefined') || _ar === null;
      return o;
    });
    /* The guards above return early rather than throw, so give the later
       assertions something to read and let them report by name. */
    r.afterExpiry = r.afterExpiry || {}; r.afterSkip = r.afterSkip || []; r.back = r.back || {};
    t.ok('tapping Next test rests before the next one', r.restShown, r);
    t.eq('for the full two minutes', r.clock, '2:00');
    t.ok('the rest clock is solid — it has no ten-second cue behind it', r.solid, r);
    t.ok('and it previews the movement coming up', r.media && r.namesNext, r);
    t.eq('the next test does not start until the rest is done', r.idxHeld, 0);
    t.eq('when the clock runs out it advances', r.afterExpiry.idx, 1);
    t.ok('and lands on the test, ready to go', r.afterExpiry.onTest, r);
    t.eq('a full rest is recorded as the full two minutes', r.afterExpiry.rests[0], 120);
    /* The discriminating one: a skip that records 0 would say the athlete
       never rested, which is not what happened and would mislead a re-test. */
    t.eq('skipping records the seconds actually taken, not zero', r.afterSkip[1], 40);
    t.eq('stepping back does not cost a rest', r.back.onRest, false);
    t.ok('and it really did step back', r.back.idx === 1, r.back);
    t.ok('cancelling mid-rest stops the clock', r.quitClears, r);
    await browser.close();
    errors.forEach(e => t.fail('page error during the between-test rest', e));
  }
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    /* Rest discipline travels WITH the numbers, the same reason TEST_PROTOCOL
       is stamped: a v1 and a v2 taken under different rest are not the same
       measurement and a comparison should be able to say so. */
    const r = await page.evaluate(async () => {
      openAssessment();
      await new Promise(z => setTimeout(z, 150));
      const put = v => { const e = document.querySelector('#assess-val');
        e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); };
      const V = [129, 12, 30, 50, 60, 57, 10, 20, 32, 15];
      for (let i = 0; i < V.length; i++) {
        put(V[i]); assessNav(1);
        await new Promise(z => setTimeout(z, 60));
        if (typeof _ar !== 'undefined' && _ar) { _ar.left = 60; skipAssessRest(); }
        await new Promise(z => setTimeout(z, 60));
      }
      await new Promise(z => setTimeout(z, 250));
      const b = STATE.baseline || {};
      return { restsTaken: b.restsTaken, restsFull: b.restsFull, median: b.restMedian,
        protocol: b.protocol, score: b.score };
    });
    t.eq('the record counts every rest gap', r.restsTaken, 9);
    t.eq('and how many were taken in full', r.restsFull, 0);
    t.eq('with the median actually rested', r.median, 60);
    t.ok('alongside the protocol stamp it sits next to', r.protocol > 0, r);
    t.ok('and the battery still scores', r.score > 0, r);
    await browser.close();
    errors.forEach(e => t.fail('page error while stamping rest discipline', e));
  }

  /* ---- TODAY, AFTER TODAY IS DONE ---------------------------------------
     Reported: "Today's tab is showing me a workout for tomorrow even though I
     have completed today's workout already. Nowhere under the Today tab am I
     seeing that I have completed today's workout."

     Two defects behind it. `STATE.progressPtr` is a QUEUE position and
     advances on completion, so Today rendered the NEXT session under the word
     TODAY — with a Start button and a Mark-Session-Complete button. And the
     one acknowledgement that existed, doneForTodayHTML(), was gated on
     `minimumDayMet()` = trainedToday() AND two HABIT ticks — so finishing the
     session did not earn the line saying you had finished it.

     TWO TRAPS THIS FILE NAMES, both deliberately walked into here:
       - seedAthlete starts at pointer 0, which IS day zero of a week. This
         block runs from a MID-WEEK pointer.
       - ticking habits would hide the mutant that restores the minimumDayMet
         gate, so this block ticks NONE. */
  {
    const { browser, page, errors } = await launch(port);
    await page.evaluate(seed => { eval(seed)(); }, ATHLETE);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);

    const r = await page.evaluate(() => {
      const o = {}; const T = () => document.querySelector('#v-today').innerText;
      STATE.logs = {}; STATE.progressPtr = 3; delete STATE._trainAgain;
      nutToday().habits = {}; save();
      o.dayInWeek = posOf(3).dayInWeek;                     // guard: NOT day zero
      o.habitsTicked = Object.keys(nutToday().habits || {}).length;   // guard: none
      const s = buildSession(3); const log = ensureLog();
      [...s.main, s.finisher].filter(Boolean).forEach(m => {
        log.ex[m.exId] = { sets: Array.from({ length: m.sets }, () => true),
          done: true, actual: m.target }; });
      save(); commitSession('right');
      o.name = s.session.name;
      o.queuePtr = STATE.progressPtr;                       // the ENGINE moved on
      setTodayTab('workout'); renderToday();
      const t = T();
      o.shownSession = (t.match(/SESSION (\d+) \/ \d+/) || [])[1];
      o.namesCompleted = t.includes(s.session.name);
      o.saysDone = /Session done/i.test(t);
      o.nextIsLabelled = /Next session · not today's/i.test(t);
      o.noCompleteButton = !document.querySelector('#v-today #finishSession');
      o.noSetDots = document.querySelectorAll('#v-today .setdot').length === 0;
      /* DERIVED, not a flag — so a re-render lands on the same screen. */
      renderToday(); o.survivesRerender = /Session done/i.test(T());
      /* And Progress agrees, on the same day. */
      go('progress'); setProgressTab('summary'); renderProgress();
      const p = document.querySelector('#v-progress').innerText;
      o.progressNamesCompleted = p.includes(s.session.name);
      o.progressNoNotYet = !/Not yet/i.test(p);
      return o;
    });

    t.ok('guard: this runs from a MID-WEEK pointer, not day zero', r.dayInWeek !== 0, r);
    t.eq('guard: and with NO habits ticked', r.habitsTicked, 0, r);
    t.eq('the queue pointer still advances', r.queuePtr, 4, r);
    /* THE REPORTED BUG: Today showed session 5 here. */
    t.eq('but Today shows the session that was just finished', r.shownSession, '4', r);
    t.ok('and names it', r.namesCompleted, r);
    t.ok('and says it is done — with no habits ticked', r.saysDone, r);
    t.ok('the next session is present but labelled as NOT today\'s', r.nextIsLabelled, r);
    t.ok('there is no Mark-Session-Complete button for work already logged', r.noCompleteButton, r);
    t.ok('and no set dots to tap on a finished session', r.noSetDots, r);
    t.ok('the done state is derived, so it survives a re-render', r.survivesRerender, r);
    t.ok('Progress names the same completed session', r.progressNamesCompleted, r);
    t.ok('and no longer says "Not yet" on a day that was trained', r.progressNoNotYet, r);

    /* IT SURVIVES A RELOAD — the state is read from the log, never a flag. */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    const after = await page.evaluate(() => {
      setTodayTab('workout'); renderToday();
      const t = document.querySelector('#v-today').innerText;
      return { done: /Session done/i.test(t), shown: (t.match(/SESSION (\d+)/) || [])[1] };
    });
    t.ok('closing and reopening the app still shows today as done', after.done, after);
    t.eq('and still on the session that was finished', after.shown, '4', after);

    /* THE FLOORS. A queue is not a calendar: the next session must stay
       REACHABLE, and an untrained day must be completely unaffected. */
    const floors = await page.evaluate(async () => {
      const o = {};
      const realConfirm = window.confirm; window.confirm = () => true;
      setTodayTab('workout'); go('today'); renderToday();
      const btn = [...document.querySelectorAll('#v-today button')]
        .find(b => /Train again/i.test(b.textContent));
      o.offersTrainAgain = !!btn;
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 60));
      renderToday();
      const t = document.querySelector('#v-today').innerText;
      o.trainAgainShowsNext = (t.match(/SESSION (\d+)/) || [])[1];
      o.trainAgainIsLive = !!document.querySelector('#v-today #finishSession');
      window.confirm = realConfirm;

      /* A day with NO session logged must look exactly as it always did. */
      STATE.logs = {}; STATE.progressPtr = 3; delete STATE._trainAgain; save();
      renderToday();
      const u = document.querySelector('#v-today').innerText;
      o.untrainedShowsLive = !!document.querySelector('#v-today #finishSession');
      o.untrainedNoDoneCard = !/Session done/i.test(u);
      o.untrainedNoNextCard = !/Next session · not today's/i.test(u);
      return o;
    });
    t.ok('the next session is still reachable on the same day', floors.offersTrainAgain, floors);
    t.eq('and choosing it puts the queue back on screen', floors.trainAgainShowsNext, '5', floors);
    t.ok('as a live, startable session', floors.trainAgainIsLive, floors);
    t.ok('a day with nothing logged still shows a live session', floors.untrainedShowsLive, floors);
    t.ok('with no done card', floors.untrainedNoDoneCard, floors);
    t.ok('and no next-session card', floors.untrainedNoNextCard, floors);

    /* ---- the request is about a SESSION, not about a DAY (v316) ---------
       `_trainAgain` was a bare date string, and a date alone cannot say whether
       the session the athlete was looking at is still the one behind the
       pointer. Two writers move that pointer and neither cleared the flag:

         - undoSession() rewinds it, so undo-then-redo the same day re-opened
           the v313 defect exactly — Today showed the NEXT session under TODAY
           with a Mark Session Complete button on it.
         - restartProgram() resets it to 0 and archives the run.

       Nulling it in each writer works until the next writer forgets, which is
       this repo's most-repeated bug. It stamps the pointer instead, so any
       pointer move voids the request with no writer involved — the _planStamp
       fix, one subsystem over.

       Driven through the REAL undo path: a hand-built _undo is refused by
       undoInfo() and the block then measures an undo that never happened. */
    const stale = await page.evaluate(async () => {
      const o = {}; const realConfirm = window.confirm; window.confirm = () => true;
      const P = 4, pos = posOf(P);
      STATE.progressPtr = P + 1;
      STATE.logs = { [P]: { ex: {}, done: true, completedAt: todayISO() } };
      STATE._undo = snapshotForUndo(P, pos.cycle + '-' + pos.week);
      STATE._undo.ptr = P; STATE._undo.date = todayISO();
      STATE._trainAgain = { date: todayISO(), from: P + 1 };
      save();
      o.undoWasReal = !!undoInfo();          // guard: the undo below really runs
      undoSession();
      o.rewound = STATE.progressPtr;
      /* The pointer stamp cannot cover an undo on its own: re-doing the session
         puts the pointer back to the SAME value, so the stamp would match again
         and resurrect a request made about a completion the athlete erased.
         Un-logging is an explicit "that did not happen". */
      o.clearedByUndo = STATE._trainAgain === undefined;
      /* Re-do the same session, the same day. */
      STATE.logs[P] = { ex: {}, done: true, completedAt: todayISO() };
      STATE.progressPtr = P + 1; save(); setTodayTab('workout'); renderToday();
      const t = document.querySelector('#v-today').innerText;
      o.after = { todayPtr: todayPtr(), done: todayDone(),
        saysDone: /Session done/i.test(t),
        offersComplete: !!document.querySelector('#v-today #finishSession') };
      /* CONTROL: the identical state with no flag at all. The two must agree —
         that is what proves the flag stopped mattering, rather than the screen
         happening to look right for some other reason. */
      delete STATE._trainAgain; save(); renderToday();
      const c = document.querySelector('#v-today').innerText;
      o.control = { todayPtr: todayPtr(), done: todayDone(),
        saysDone: /Session done/i.test(c),
        offersComplete: !!document.querySelector('#v-today #finishSession') };
      /* A v313 bare-string value is what every phone is carrying right now.
         It must fail CLOSED — show the session that was actually finished. */
      STATE._trainAgain = todayISO(); save();
      o.legacyString = { todayPtr: todayPtr(), done: todayDone() };
      window.confirm = realConfirm;
      return o;
    });
    t.ok('guard: the undo under test really ran', stale.undoWasReal, stale);
    t.eq('and rewound the pointer', stale.rewound, 4, stale);
    t.ok('un-logging a session voids the train-again request', stale.clearedByUndo, stale);
    t.ok('undo-then-redo the same day still shows the session that was done',
      stale.after.saysDone, stale);
    t.eq('and matches a run with no stale request at all',
      stale.after, stale.control, stale);
    t.ok('no Complete button on work already logged', !stale.after.offersComplete, stale);
    t.eq('a v313 bare-string request fails closed', stale.legacyString,
      { todayPtr: 4, done: true }, stale);

    /* AND THE SECOND SESSION ENDS THE REQUEST. This is the case only the
       pointer stamp can catch, and the first version of this block missed it:
       undo and restart both delete the flag outright, so with those two covered
       nothing exercised the comparison at all and a mutant that stored the
       stamp without ever reading it walked straight through.

       The athlete finishes today's session, taps Train again, and finishes the
       next one too. The request was about the FIRST completion; the second one
       is now what today is. A date-only test says yes forever and Today shows a
       THIRD session with a Mark Session Complete button on it. */
    const second = await page.evaluate(() => {
      const o = {}; const realConfirm = window.confirm; window.confirm = () => true;
      STATE.progressPtr = 5;
      STATE.logs = { 4: { ex: {}, done: true, completedAt: todayISO() } };
      delete STATE._trainAgain; save();
      trainAgainToday();
      o.granted = { todayPtr: todayPtr(), from: (STATE._trainAgain || {}).from };
      /* now really train it */
      STATE.logs[5] = { ex: {}, done: true, completedAt: todayISO() };
      STATE.progressPtr = 6; save(); setTodayTab('workout'); renderToday();
      const t = document.querySelector('#v-today').innerText;
      o.afterSecond = { todayPtr: todayPtr(), done: todayDone(),
        saysDone: /Session done/i.test(t),
        offersComplete: !!document.querySelector('#v-today #finishSession') };
      window.confirm = realConfirm;
      return o;
    });
    t.eq('guard: the request really was granted on the pointer it was made from',
      second.granted, { todayPtr: 5, from: 5 }, second);
    t.eq('training that second session makes IT today\'s', second.afterSecond.todayPtr, 5, second);
    t.ok('and Today says so', second.afterSecond.saysDone, second);
    t.ok('rather than offering a third with a Complete button',
      !second.afterSecond.offersComplete, second);

    /* ---- restarting the program drops the live-session scratch (v316) ----
       TRANSIENT_KEYS is already the list of keys that describe a live session;
       the export and the import both ask it, and this was the one place that
       reset the run without asking. A _plResume left pointing at slot 0 matched
       the NEW block's slot 0 and offered to resume a session out of the run
       that had just been archived. */
    const restart = await page.evaluate(() => {
      const o = {}; const realConfirm = window.confirm; window.confirm = () => true;
      STATE.progressPtr = 5;
      STATE.logs = { 4: { ex: {}, done: true, completedAt: todayISO() } };
      STATE._trainAgain = { date: todayISO(), from: 5 };
      STATE._plResume = { date: todayISO(), ptr: 0, i: 1, setsDone: 2 };
      STATE._undo = { ptr: 4, date: todayISO() };
      save();
      o.scratchBefore = TRANSIENT_KEYS.filter(k => STATE[k] !== undefined);
      restartProgram();
      o.ptr = STATE.progressPtr;
      o.scratchAfter = TRANSIENT_KEYS.filter(k => STATE[k] !== undefined);
      o.resumeOffered = !!resumeInfo();
      /* The floor: a restart ARCHIVES the run, it does not delete it. A clear
         that also dropped the history satisfies every "scratch is gone" check
         and breaks the confirm's own promise that history stays saved. */
      o.runsArchived = (STATE.runs || []).length;
      o.archivedRowsKept = Object.keys((STATE.runs || [])[0]?.logs || {}).length;
      window.confirm = realConfirm;
      return o;
    });
    t.ok('guard: there really was live-session scratch to drop',
      restart.scratchBefore.length >= 3, restart);
    t.eq('restarting drops every transient key', restart.scratchAfter, [], restart);
    t.eq('and resets the pointer', restart.ptr, 0, restart);
    t.ok('so nothing offers to resume a session out of the archived run',
      !restart.resumeOffered, restart);
    t.eq('while the finished run is archived, not deleted', restart.runsArchived, 1, restart);
    t.ok('with its logged sessions kept', restart.archivedRowsKept > 0, restart);

    /* restartProgram() nulls the baseline, so every block after this one would
       render the assessment gate instead of a workout. Each block builds the
       state it asserts on — and a block that DESTROYS shared state has to put
       it back, or the next three checks measure a screen nobody asked for. */
    await seedAthlete(page);

    /* A PAIN STOP IS NOT A COMPLETION. commitSession() records it as
       stoppedForPain and NOT done, so the app must not congratulate it. */
    const pain = await page.evaluate(() => {
      STATE.logs = {}; STATE.progressPtr = 3; delete STATE._trainAgain; save();
      const log = ensureLog();
      log.stoppedForPain = todayISO(); log.done = false; log.completedAt = todayISO();
      STATE.progressPtr = 4; save();
      setTodayTab('workout'); renderToday();
      const t = document.querySelector('#v-today').innerText;
      return { saysStopped: /stopped for pain/i.test(t),
        noCongratulation: !/Session done/i.test(t),
        saysPointerMoved: /program still moved on/i.test(t),
        shown: (t.match(/SESSION (\d+)/) || [])[1] };
    });
    t.ok('a pain stop says so', pain.saysStopped, pain);
    t.ok('and is never congratulated as a completed session', pain.noCongratulation, pain);
    t.ok('and says out loud that the program moved on', pain.saysPointerMoved, pain);
    t.eq('while still showing the session it happened on', pain.shown, '4', pain);

    /* Reference must not point at a screen that moved (v311 moved Movement
       from Fuel to Today and left two sentences behind). */
    const ref = await page.evaluate(() => {
      go('ref'); render();
      const r = document.querySelector('#v-ref').innerText;
      return { stale: /Fuel → Movement/.test(r), points: /Today ▸ Workout ▸ Movement/.test(r) };
    });
    t.ok('Reference no longer points at Fuel for Movement', !ref.stale, ref);
    t.ok('it points at where Movement actually lives', ref.points, ref);

    errors.forEach(e => t.fail('page error in the done-today block', e));
    await browser.close();
  }

  /* THE TYPED PATH IS THE OTHER DOOR IN. assessNav()'s only guard was v>=0, so
     a slip on the keypad — 1200 for 120 — anchored every prescription for a
     year, and the athlete was still on the screen and could have fixed it.
     Refused with the benchmark named, rather than repaired silently at the next
     boot: the boot repair DROPS the number, which loses a result the athlete
     could simply have retyped. */
  {
    const { browser, page, errors } = await launch(port);
    await seedAthlete(page);
    const r = await page.evaluate(async () => {
      openAssessment();
      await new Promise(z => setTimeout(z, 150));
      const o = {};
      const put = v => { const e = document.querySelector('#assess-val');
        if (!e) return false;
        e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); return true; };
      const toastText = () => (document.getElementById('toast') || {}).textContent || '';
      o.test0 = TESTS[0].id;
      o.bench = TESTS[0].bench;
      o.cap = maxPlausible(TESTS[0].id);

      /* Guard: this really is the plank test, and the ceiling really is above
         any number a person types on purpose. */
      put(o.cap + 1); assessNav(1);
      await new Promise(z => setTimeout(z, 150));
      o.refusedIdx = assessState.idx;
      o.refusedStored = assessState.results[o.test0];
      o.refusedToast = toastText();
      o.refusedRest = !!document.querySelector('#arRing');
      /* GUARD BEFORE THE FIRST LINE THAT ASSUMES THE REFUSAL HELD. A mutant that
         drops the guard advances the battery onto a rest screen with no input
         box, and every line below would throw — the suite then reports "the file
         itself threw" instead of naming the check that caught it. Return the
         partial result and let the named assertions report. */
      if (assessState.idx !== 0 || !document.querySelector('#assess-val')) { o.escaped = true; return o; }

      /* FLOOR — a number one under the ceiling is absurd-looking and is still a
         result the athlete typed, so it is accepted. A guard that clips a
         legitimate input is the mirror-image defect. */
      put(o.cap); assessNav(1);
      await new Promise(z => setTimeout(z, 150));
      o.atCapStored = assessState.results[o.test0];
      if (typeof _ar !== 'undefined' && _ar) skipAssessRest();
      await new Promise(z => setTimeout(z, 150));

      /* Back to test 0, and an ordinary result must be silent. */
      assessNav(-1);
      await new Promise(z => setTimeout(z, 150));
      o.backIdx = assessState.idx;
      document.getElementById('toast').textContent = '';
      put(75); assessNav(1);
      await new Promise(z => setTimeout(z, 150));
      o.realStored = assessState.results[o.test0];
      o.realToast = toastText();
      if (typeof _ar !== 'undefined' && _ar) skipAssessRest();
      await new Promise(z => setTimeout(z, 150));
      assessNav(-1);
      await new Promise(z => setTimeout(z, 150));

      /* FLOOR — a measured zero is data and must still be accepted. */
      put(0); assessNav(1);
      await new Promise(z => setTimeout(z, 150));
      o.zeroStored = assessState.results[o.test0];
      assessQuit();
      return o;
    });

    t.ok('guard: the refusal left the battery on the test, not on a rest screen',
      !r.escaped, r);
    t.eq('guard: the first test is the plank', r.test0, 'plank');
    t.eq('guard: and its ceiling is 50x its benchmark', r.cap, r.bench * 50);
    t.eq('a result past the ceiling is refused rather than recorded',
      r.refusedStored, undefined, r);
    t.eq('and the battery does not advance', r.refusedIdx, 0, r);
    t.ok('and it does not cost a two-minute rest', !r.refusedRest, r);
    t.ok('the refusal names the benchmark, so the athlete knows what is expected',
      r.refusedToast.indexOf(String(r.bench)) >= 0, r.refusedToast);
    t.eq('FLOOR: a value on the ceiling is still the athlete\'s own answer',
      r.atCapStored, r.cap, r);
    t.eq('guard: stepping back really returned to the first test', r.backIdx, 0, r);
    t.eq('FLOOR: an ordinary result is recorded', r.realStored, 75, r);
    t.eq('and says nothing at all — a note that always fires is a note nobody reads',
      r.realToast, '', r);
    t.eq('FLOOR: a measured zero is data and is recorded', r.zeroStored, 0, r);

    errors.forEach(e => t.fail('a page error fired during the typed-max checks', e));
    await browser.close();
  }

  srv.close();
  return t.finish();
}
