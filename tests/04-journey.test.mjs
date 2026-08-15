/* The athlete's journey, driven through the real UI: the wizard, the baseline
   battery, the four Today panes, the guided player, and every button on every
   tab. Nothing here injects state that the app would not have produced itself. */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

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
      const ENTER = { plank: 150, side: 95, hollow: 70, lower: 30, push: 48, pull: 22, squat: 62, dyn: 55, power: 14 };
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
        await page.evaluate(() => assessNav(1));
        await page.waitForTimeout(120);
      }
      t.eq('all 9 tests are walked', walked.length, 9);
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
      t.eq('the record stamps how many tests it used', res.testCount, 9);
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
      while (TESTS[assessState.idx].id !== 'pull') {
        const el = document.querySelector('#assess-val');
        el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true }));
        assessNav(1);
        await new Promise(r => setTimeout(r, 30));
      }
      const s = document.querySelector('#sheet');
      return { hasSwapNote: /Swapped to/.test(s.innerText), infoBtn: (s.innerHTML.match(/openExerciseInfo\('([a-z0-9]+)'\)/) || [])[1] };
    });
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

  srv.close();
  return t.finish();
}
