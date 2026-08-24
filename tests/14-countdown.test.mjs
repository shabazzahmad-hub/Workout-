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

  /* ============ how loud, and what ducks the music ======================= */
  {
    const r = await page.evaluate(async () => {
      if (window.__realBeep) beep = window.__realBeep;
      STATE.settings.sound = true;
      const out = {};
      // default, and the clamp
      delete STATE.settings.cueVol;
      out.def = cueVolPref();
      STATE.settings.cueVol = 99; out.high = cueVolPref();
      STATE.settings.cueVol = -5; out.low = cueVolPref();
      /* cueVolPref() guards on its own, so asserting its OUTPUT cannot see the
         normalizeState repair at all — that mutation survived. What the repair
         is for is getting the junk out of STATE, so it cannot persist into a
         backup or be read raw. Assert on the field. */
      STATE.settings.cueVol = 'loud'; normalizeState();
      out.repaired = cueVolPref();
      out.junkRemoved = !('cueVol' in STATE.settings);
      STATE.settings.cueVol = NaN; normalizeState();
      out.nanRemoved = !('cueVol' in STATE.settings);
      STATE.settings.cueVol = 0.8; normalizeState();
      out.validKept = STATE.settings.cueVol === 0.8;

      /* Watch the gain actually written to the graph, not the argument we
         passed in — the multiplier and the clip guard both live inside beep(). */
      const AC = window.AudioContext || window.webkitAudioContext;
      const origGain = AC.prototype.createGain;
      let gains = [];
      AC.prototype.createGain = function () {
        const g = origGain.apply(this, arguments);
        const sv = g.gain.setValueAtTime.bind(g.gain);
        g.gain.setValueAtTime = (v, tm) => { gains.push(v); return sv(v, tm); };
        return g;
      };
      const measure = (vol, cue) => {
        STATE.settings.cueVol = cue; gains = [];
        beep(900, .1, vol);
        return gains[0];
      };
      out.atOne = measure(0.7, 1);
      out.atDefault = measure(0.7, 1.25);
      out.scales = out.atDefault > out.atOne;
      out.capped = measure(0.95, 2);          // 1.9 raw → must clip to 1.0
      AC.prototype.createGain = origGain;
      delete STATE.settings.cueVol;
      return out;
    });
    t.eq('the default is louder than the old fixed level', r.def, 1.25);
    t.eq('the setting is clamped at the top', r.high, 2);
    t.eq('and at the bottom', r.low, 0.2);
    t.eq('a corrupt value falls back to the default', r.repaired, 1.25);
    t.ok('and is stripped from STATE, not just ignored', r.junkRemoved, r);
    t.ok('NaN is stripped too', r.nanRemoved, r);
    t.ok('but a valid setting survives normalisation', r.validKept, r);
    t.ok('the multiplier reaches the audio graph', r.scales, r);
    t.ok('and gain never exceeds unity, which would clip', r.capped <= 1.0 + 1e-9, r);
    t.ok('the capped value is actually at the ceiling', Math.abs(r.capped - 1.0) < 1e-9, r);
  }

  /* ---- the music must get out of the way of the cues that matter -------- */
  {
    const r = await page.evaluate(async () => {
      if (window.__realBeep) beep = window.__realBeep;
      STATE.settings.sound = true;
      const realDuck = beatDuck, realBeat = window.BEAT;
      let ducks = 0;
      BEAT = { on: true };
      beatDuck = () => { ducks++; };
      const count = fn => { ducks = 0; fn(); return ducks; };
      const out = {
        marker: count(() => countdownCue(10, 60)),
        tick: count(() => countdownCue(7, 60)),
        lastThree: count(() => countdownCue(2, 60)),
        go: count(() => beepGo()),
      };
      beatDuck = realDuck; BEAT = realBeat;
      return out;
    });
    t.ok('the ten-second marker ducks the beat', r.marker > 0, r);
    t.ok('the last three seconds duck the beat', r.lastThree > 0, r);
    t.ok('and so does GO', r.go > 0, r);
    t.eq('but a soft tick does not, or the music would pump every second', r.tick, 0, r);
  }

  /* ---- and it is adjustable without editing the app --------------------- */
  {
    const r = await page.evaluate(async () => {
      STATE.settings.beat = true;
      go('guide'); render();
      await new Promise(z => setTimeout(z, 150));
      const v = document.querySelector('#v-guide');
      const slider = [...v.querySelectorAll('input[type=range]')]
        .find(i => (i.getAttribute('onchange') || '').includes('setCueVol'));
      return { present: !!slider, min: slider && slider.min, max: slider && slider.max,
        labelled: /Beep .*volume/i.test(v.textContent) };
    });
    t.ok('Settings exposes a cue-volume slider', r.present, r);
    t.ok('and it is labelled', r.labelled, r);
    t.eq('it can go quieter than default', r.min, '0.2');
    t.eq('and louder', r.max, '2');
  }

  /* ---- ONE countdown, not two ------------------------------------------
     Reported from the phone, mid-session: "when it's time to rest there is a
     3, 2, 1 and then again it repeats 2, 1." Every timed surface spoke
     "Three. Two. One." at remain===3 AND fired the per-second cue at 3, 2 and
     1. The spoken line takes about a second and a half, so it runs across
     seconds 3 and 2 while the beeps tick cleanly underneath — two countdowns
     of the same three seconds, out of step. */
  {
    const r = await page.evaluate(() => {
      const fns = { hold: plTickHold, rest: plTickRest, hiit: ivTick, timer: runTimer, flow: runFlow };
      const o = { spoken: {}, cues: {} };
      Object.keys(fns).forEach(k => {
        const src = fns[k].toString();
        o.spoken[k] = /Three\. Two\. One\./.test(src);
        /* ...and the surface must still HAVE a last-three cue. Deleting both
           would satisfy every "no double" assertion and leave the athlete
           with silence. */
        o.cues[k] = /countdownCue\(/.test(src) || /beep\(920/.test(src);
      });
      return o;
    });
    Object.keys(r.spoken).forEach(k => {
      t.ok(`the ${k} timer does not speak a second countdown over the beeps`, !r.spoken[k], r.spoken);
    });
    /* The floor. A cue still has to fire on every one of them. */
    Object.keys(r.cues).forEach(k => {
      t.ok(`the ${k} timer still cues the last three seconds`, r.cues[k], r.cues);
    });
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
