/* Suite 14 — the last ten seconds of a timed effort.

   A plank at second 40 of 60 is exactly when you cannot look at the phone, and
   the app was silent until three seconds left. These checks spy on the tone
   generator, because the only thing that matters is what the athlete HEARS —
   how many tones, at which second, and whether work and rest still sound
   different from each other. */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

export default async function run() {
  const t = suite('countdown cue');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  /* Record every tone instead of playing it. Returns one entry per beep with
     the frequency, so a two-tone marker is distinguishable from a plain tick. */
  const spy = `(()=>{ window.__tones=[]; if(!window.__realBeep)window.__realBeep=beep;
    beep=function(f,d,v,ty){ window.__tones.push({f:Math.round(f||880),v:v||0}); };
  })()`;

  /* ---- a long hold: marker at ten, ticks down to one -------------------- */
  {
    const r = await page.evaluate(async (spySrc) => {
      eval(spySrc);
      STATE.settings.sound = true;
      const seq = [];
      for (let remain = 12; remain >= 1; remain--) {
        window.__tones = [];
        countdownCue(remain, 60);
        await new Promise(z => setTimeout(z, 200));   // the 10s marker's second tone is deferred
        seq.push({ remain, tones: window.__tones.slice() });
      }
      return seq;
    }, spy);
    const at = n => r.find(x => x.remain === n);
    t.eq('nothing at twelve seconds', at(12).tones.length, 0);
    t.eq('nothing at eleven', at(11).tones.length, 0);
    t.eq('a two-tone marker at exactly ten', at(10).tones.length, 2, at(10));
    t.ok('and it rises, low then high', at(10).tones[0].f < at(10).tones[1].f, at(10));
    [9, 8, 7, 6, 5, 4].forEach(n =>
      t.eq(`a single tick at ${n}`, at(n).tones.length, 1, at(n)));
    t.ok('the ticks are quieter than the marker',
      at(9).tones[0].v < at(10).tones[1].v, { tick: at(9).tones[0], marker: at(10).tones[1] });
    [3, 2, 1].forEach(n =>
      t.eq(`the louder beep at ${n}`, at(n).tones.length, 1, at(n)));
    t.ok('and the last three are louder than the ticks',
      at(3).tones[0].v > at(9).tones[0].v, { three: at(3).tones[0], nine: at(9).tones[0] });
    t.ok('the last three are a different pitch from the ticks',
      at(3).tones[0].f !== at(9).tones[0].f, { three: at(3).tones[0], nine: at(9).tones[0] });
  }

  /* ---- a short hold keeps the plain 3-2-1 ------------------------------- */
  {
    const r = await page.evaluate(async (spySrc) => {
      eval(spySrc);
      /* Await after each call: the ten-second marker's second tone is deferred
         by 110ms, so a synchronous read counts one and reports a missing
         marker that is actually there. */
      const count = async total => {
        const out = {};
        for (let remain = 10; remain >= 1; remain--) {
          window.__tones = [];
          countdownCue(remain, total);
          await new Promise(z => setTimeout(z, 180));
          out[remain] = window.__tones.length;
        }
        return out;
      };
      return { short: await count(12), boundaryBelow: await count(14), boundaryAt: await count(15) };
    }, spy);
    t.eq('a 12s hold is silent at ten', r.short[10], 0);
    t.eq('and silent at six', r.short[6], 0);
    t.eq('but still beeps at three', r.short[3], 1);
    t.eq('14s is still treated as short', r.boundaryBelow[10], 0);
    t.eq('15s gets the marker', r.boundaryAt[10], 2);
  }

  /* ---- silence means silence -------------------------------------------- */
  {
    const r = await page.evaluate(async () => {
      // the REAL beep this time — it must gate itself on the sound setting
      if (window.__realBeep) beep = window.__realBeep;
      STATE.settings.sound = false;
      let played = 0;
      const AC = window.AudioContext || window.webkitAudioContext;
      const orig = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function () { played++; return orig.apply(this, arguments); };
      for (let remain = 10; remain >= 1; remain--) countdownCue(remain, 60);
      await new Promise(z => setTimeout(z, 250));
      AC.prototype.createOscillator = orig;
      STATE.settings.sound = true;
      return { played };
    });
    t.eq('sound off produces no tones at all', r.played, 0);
  }

  /* ---- work and rest must not sound the same ---------------------------- */
  {
    const r = await page.evaluate(async (spySrc) => {
      eval(spySrc);
      STATE.settings.sound = true;
      const drive = async (fn) => {
        const seq = {};
        for (let remain = 10; remain >= 1; remain--) {
          window.__tones = [];
          fn(remain);
          await new Promise(z => setTimeout(z, 40));
          seq[remain] = window.__tones.length;
        }
        return seq;
      };
      // the guided player's timed work
      const work = await drive(remain => {
        PLAYER = { phase: 'work', remain, total: 60, running: true, s: 0, i: 0, items: [], sess: {} };
        countdownCue(PLAYER.remain, PLAYER.total);
      });
      /* ...against the REAL rest ticks. An earlier version simulated rest with
         an inline `if (remain<=3) beep(...)`, which cannot notice the app
         changing — removing the work-only guard on the HIIT tick survived it.
         Drive the actual functions. */
      const playerRest = await drive(remain => {
        PLAYER = { phase: 'rest', remain: remain + 1, total: 60, running: true, deadline: null,
                   s: 0, i: 0, items: [{}], sess: {}, pendingNext: false };
        plTickRest();
      });
      const hiitRest = await drive(remain => {
        INTV = { phase: 'rest', remain: remain + 1, total: 60, i: 0, seq: [{}, {}], workElapsed: 0 };
        ivTick();
      });
      const hiitWork = await drive(remain => {
        INTV = { phase: 'work', remain: remain + 1, total: 60, i: 0, seq: [{}, {}], workElapsed: 0 };
        ivTick();
      });
      PLAYER = null; INTV = null;
      return { work, rest: playerRest, hiitRest, hiitWork };
    }, spy);
    t.ok('work is audible from ten seconds out', r.work[10] > 0 && r.work[7] > 0, r.work);
    t.eq('player rest stays silent at ten', r.rest[10], 0, r.rest);
    t.eq('player rest stays silent at seven', r.rest[7], 0, r.rest);
    t.eq('but player rest still signs off at three', r.rest[3], 1, r.rest);
    t.eq('HIIT rest stays silent at ten', r.hiitRest[10], 0, r.hiitRest);
    t.eq('HIIT rest stays silent at five', r.hiitRest[5], 0, r.hiitRest);
    t.eq('but HIIT rest still signs off at three', r.hiitRest[3], 1, r.hiitRest);
    t.ok('HIIT work does get the countdown', r.hiitWork[10] > 0 && r.hiitWork[5] > 0, r.hiitWork);
    t.ok('so work and rest are distinguishable by ear',
      JSON.stringify(r.work) !== JSON.stringify(r.rest)
      && JSON.stringify(r.hiitWork) !== JSON.stringify(r.hiitRest), r);
  }

  /* ---- driven through the real player, not just the helper -------------- */
  {
    const r = await page.evaluate(async (spySrc) => {
      eval(spySrc);
      STATE.settings.sound = true;
      openPlayer();
      await new Promise(z => setTimeout(z, 200));
      // find a timed exercise in the session and force the hold phase onto it
      const idx = PLAYER.items.findIndex(m => m.unit === 'time');
      if (idx < 0) return { skip: 'no timed exercise in this session' };
      PLAYER.i = idx; PLAYER.s = 0;
      PLAYER.phase = 'work'; PLAYER.total = 60; PLAYER.remain = 11;
      const seen = {};
      for (let k = 0; k < 8; k++) {
        window.__tones = [];
        plTickHold();
        await new Promise(z => setTimeout(z, 180));
        seen[PLAYER.remain] = window.__tones.length;
        if (PLAYER.remain <= 3) break;
      }
      const out = { seen, unit: PLAYER.items[idx].unit };
      try { playerQuit(); } catch (e) {}
      return out;
    }, spy);
    if (r.skip) t.fail('no timed exercise available to drive', r);
    else {
      t.eq('the real hold tick fires the marker at ten', r.seen[10], 2, r);
      t.eq('and a tick at nine', r.seen[9], 1, r);
      t.eq('and at five', r.seen[5], 1, r);
      t.ok('a timed exercise was actually used', r.unit === 'time', r);
    }
  }

  /* ---- and each second is cued exactly once ----------------------------- */
  {
    const r = await page.evaluate(async (spySrc) => {
      eval(spySrc);
      STATE.settings.sound = true;
      window.__tones = [];
      // one full pass, as a real 60s hold would run it
      for (let remain = 10; remain >= 1; remain--) countdownCue(remain, 60);
      await new Promise(z => setTimeout(z, 250));
      return { total: window.__tones.length };
    }, spy);
    // 10s marker = 2, ticks 9-4 = 6, beeps 3-1 = 3  →  11
    t.eq('a full ten-second countdown is eleven tones, no doubles', r.total, 11, r);
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
