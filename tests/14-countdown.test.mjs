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

  /* ---- Speaking must not eat the seconds it is spoken over ---------------
     Three reports from one session, all of them the same shape: a voice line
     and a per-second job fighting over the same seconds.

       "after one exercise it goes straight into the other exercise after
        counting down, without even announcing the name"
       "while doing the warm-up it is skipping some numbers"
       "while doing the actual exercises it is skipping a few numbers" */
  {
    /* 1. The transition announcement must survive. _deviceSpeak() calls
          synth.cancel() on EVERY line, so a spoken 3-2-1 one second later
          killed the name outright. */
    const flow = await page.evaluate(async () => {
      const said = []; let vnow = 1000000;
      const realNow = Date.now.bind(Date); Date.now = () => vnow;
      const realSpeak = window.coachSpeak;
      window.coachSpeak = txt => { said.push({ s: vnow, t: String(txt) }); return true; };
      const realSI = window.setInterval;
      window.setInterval = (fn, ms) => ms !== 1000 ? realSI(fn, ms)
        : realSI(() => { vnow += 1000; fn(); }, 8);
      runFlow([{ n: 'March', secs: 12, cue: 'Knees up.', img: '' },
               { n: 'Arm Circles', secs: 12, cue: 'Big.', img: '' }], 'Warm-up', 'x');
      await new Promise(r => realSI(r, 700));
      try { flowStop(); } catch (e) {}
      window.setInterval = realSI; Date.now = realNow;
      await new Promise(r => setTimeout(r, 60));
      window.coachSpeak = realSpeak;
      const t0 = said.length ? said[0].s : 0;
      const announce = said.find(x => /Arm Circles/.test(x.t));
      const after = announce ? said.filter(x => x.s > announce.s) : [];
      return {
        announced: !!announce,
        /* THE discriminator: how long the announcement gets before anything
           else speaks over it. A digit one second later is a cancellation. */
        quietFor: after.length ? (after[0].s - announce.s) / 1000 : 99,
        nextLine: after.length ? after[0].t : '',
        spokenDigits: said.filter(x => /^[123]$/.test(x.t.trim())).length,
        all: said.map(x => ((x.s - t0) / 1000) + 's: ' + x.t),
      };
    });
    t.ok('the warm-up announces the move that is coming', flow.announced, flow.all);
    t.ok('and nothing speaks over it for at least three seconds',
      flow.quietFor >= 3, { quietFor: flow.quietFor, nextLine: flow.nextLine });
    /* The transition still BEEPS every second — the beeps are the countdown,
       the same call v302 made. Only the spoken digits went.

       THIS CHECK USED TO EXPECT 3, and its own comment claimed "the 5-4-3-2-1
       at the very start of the flow keeps its digits: nothing competes there."
       That was false, and the label above it ("no digits at all") disagreed
       with the number it asserted — which is how it survived. The flow's
       opening line is spoken at t=0 and the first digit lands at t=2s, so a
       longer title or a slower voice loses the end of it; the same shape on
       the rep cadence was measured losing 308ms of "Guided set. 13 reps. Get
       ready." A check pinning the old behaviour is how a defect stays put. */
    t.eq('and NO digit is spoken anywhere in the flow', flow.spokenDigits, 0, flow.all);

  /* ---- the reposition window between flow moves (v349) --------------------
     Reported from the phone after a real warm-up: "there is a five seconds
     countdown to the end of an exercise, and it goes straight into the next
     exercise... you need to change position whether it's come off the floor,
     go on the mat." The transition existed. Measured, it was inaudible: the
     flow fired FIFTEEN identical 1000 Hz beeps from second 35 to second 48
     with nothing in that run marking where the stretch ended. */
  const repo = await page.evaluate(async () => {
    /* Drive the REAL flow with a fake clock, recording every tone by
       FREQUENCY — "a beep happened" cannot tell a countdown tick from a
       reposition cue, and telling them apart is the entire fix. */
    const drive = (items, ticks) => {
      const log = []; let sec = 0;
      const keep = { speak: window.coachSpeak, beep: window.beep, go: window.beepGo,
                     si: window.setInterval, ci: window.clearInterval, now: Date.now };
      window.coachSpeak = t => { log.push({ sec, ev: 'say', t: String(t) }); return true; };
      window.beep = f => log.push({ sec, ev: 'beep', f });
      window.beepGo = () => log.push({ sec, ev: 'go' });
      let fn = null;
      window.setInterval = f => { fn = f; return 1; };
      window.clearInterval = () => {};
      let virt = 1000000; Date.now = () => virt;
      const frames = [];
      runFlow(items, 'Warm-up', 'x');
      const snap = () => ({ sec, num: ($('#flowNum') || {}).textContent,
                            name: ($('#flowName') || {}).textContent,
                            cue: ($('#flowCue') || {}).textContent });
      frames.push(snap());
      for (let i = 1; i <= ticks; i++) { sec = i; virt += 1000; if (fn) fn(); frames.push(snap()); }
      Object.assign(window, { coachSpeak: keep.speak, beep: keep.beep, beepGo: keep.go,
                              setInterval: keep.si, clearInterval: keep.ci });
      Date.now = keep.now;
      try { flowStop(); } catch (e) {}
      return { log, frames };
    };
    const o = {};

    /* --- the real warm-up, as he ran it ------------------------------------ */
    const real = drive(mobilityFlow(jointAwareWarmup(WARMUP_FLOW)), 200);
    const say = t => real.log.find(x => x.ev === 'say' && new RegExp(t).test(x.t));
    const glute = say('Glute Bridges');            // standing -> on your back
    o.namesTheChange = !!glute && /Lie on your back/.test(glute.t);
    const birddog = say('Bird Dog');               // on your back -> hands and knees
    o.namesTheOtherChange = !!birddog && /hands and knees/.test(birddog.t);
    const arms = say('Arm Circles');               // standing -> standing
    o.sameSpotClaimsNoChange = !!arms && !/Lie on|hands and knees|standing/.test(arms.t);

    if (!glute) return Object.assign(o, { guard: 'no glute transition reached' });

    /* THE MEASUREMENT. From the reposition cue to the GO that starts the move:
       how long, and is any of it SILENT? A gap is what makes it a separate
       phase — beeping every second put it inside an unbroken run. */
    const goAfter = real.log.find(x => x.ev === 'go' && x.sec > glute.sec);
    o.floorWindow = goAfter ? goAfter.sec - glute.sec : 0;
    const between = real.log.filter(x => x.sec > glute.sec && x.sec < goAfter.sec);
    const soundedAt = new Set(between.map(x => x.sec));
    o.silentSeconds = [];
    for (let s = glute.sec + 1; s < goAfter.sec; s++) if (!soundedAt.has(s)) o.silentSeconds.push(s);

    /* The cue that opens it must not be a countdown tick. Every other paired
       cue in the app RISES; this one falls, so it cannot be confused. */
    const opener = real.log.filter(x => x.ev === 'beep' && x.sec === glute.sec).map(x => x.f);
    o.opensWithItsOwnTone = opener.length > 0 && !opener.includes(1000) && !opener.includes(920);

    /* Exactly ONE go tone. startItem() fires beepGo() itself and the transition
       branch fired a second 0 ms later, which reads as a stutter. */
    o.goTonesAtHandover = real.log.filter(x => x.ev === 'go' && x.sec === goAfter.sec).length;

    /* Floor: standing -> standing gets the SHORT window. A fix that simply
       made every gap seven seconds satisfies every assertion above. */
    const armsGo = real.log.find(x => x.ev === 'go' && x.sec > arms.sec);
    o.sameSpotWindow = armsGo ? armsGo.sec - arms.sec : 0;

    // the screen says which position, on the transition frames
    const f = real.frames.find(x => x.sec === glute.sec);
    o.screenSaysHow = !!f && /Lie on your back — Glute Bridges/.test(f.cue || '');
    o.screenShowsTheNextMove = !!f && /Glute Bridges/.test(f.name || '');

    /* --- an UNTAGGED pair must get the long window, not the short one ------- */
    const unknown = drive([{ n: 'A', secs: 6, cue: 'a', img: '' },
                           { n: 'B', secs: 6, cue: 'b', img: '' }], 30);
    const uSay = unknown.log.find(x => x.ev === 'say' && /B/.test(x.t));
    const uGo = uSay && unknown.log.find(x => x.ev === 'go' && x.sec > uSay.sec);
    o.unknownGetsTheLongWindow = (uSay && uGo) ? uGo.sec - uSay.sec : 0;

    /* --- and two moves sharing a tagged position get the short one --------- */
    const same = drive([{ n: 'A', secs: 6, pos: 'fours', cue: 'a', img: '' },
                        { n: 'B', secs: 6, pos: 'fours', cue: 'b', img: '' }], 30);
    const sSay = same.log.find(x => x.ev === 'say' && /B/.test(x.t));
    const sGo = sSay && same.log.find(x => x.ev === 'go' && x.sec > sSay.sec);
    o.taggedSameWindow = (sSay && sGo) ? sGo.sec - sSay.sec : 0;

    // every shipped flow move declares where it is performed
    const tagged = f2 => f2.filter(x => !x.pos).map(x => x.n);
    o.untaggedWarm = tagged(WARMUP_FLOW);
    o.untaggedCool = tagged(COOLDOWN_FLOW);
    o.untaggedJointAdds = Object.keys(WARMUP_JOINT_ADD).filter(k => !WARMUP_JOINT_ADD[k].pos);
    return o;
  });
  t.ok('guard: the warm-up really reached the standing-to-floor change', !repo.guard, repo);
  t.eq('every warm-up move declares the position it is done in', repo.untaggedWarm, [], repo);
  t.eq('and every cool-down move', repo.untaggedCool, [], repo);
  t.eq('and every joint-aware addition', repo.untaggedJointAdds, [], repo);
  t.ok('the coach names the position change, not just "get into position"', repo.namesTheChange, repo);
  t.ok('and names it for the floor-to-floor change too', repo.namesTheOtherChange, repo);
  t.ok('floor: two standing moves claim no position change', repo.sameSpotClaimsNoChange, repo);
  t.eq('a real position change gets seven seconds', repo.floorWindow, 7, repo);
  t.ok('and some of that window is SILENT — a gap is what separates it',
    repo.silentSeconds.length >= 3, repo);
  t.ok('it opens with a tone that is not a countdown tick', repo.opensWithItsOwnTone, repo);
  t.eq('and the handover fires exactly one go tone', repo.goTonesAtHandover, 1, repo);
  t.eq('floor: standing to standing stays short', repo.sameSpotWindow, 4, repo);
  t.eq('two moves in the same tagged position stay short', repo.taggedSameWindow, 4, repo);
  t.eq('an untagged pair fails safe to the long window', repo.unknownGetsTheLongWindow, 7, repo);
  t.ok('the screen names the position too', repo.screenSaysHow, repo);
  t.ok('and shows the move that is coming', repo.screenShowsTheNextMove, repo);

    /* 2. Every rep is counted ALOUD. Coaching used to replace the number. */
    const reps = await page.evaluate(async (exId) => {
      const said = []; const realSpeak = window.coachSpeak;
      window.coachSpeak = txt => { said.push(String(txt)); return true; };
      const keep = { plS: window.plS, plRingSet: window.plRingSet, beep: window.beep,
        haptic: window.haptic, plAfterSet: window.plAfterSet, plClear: window.plClear,
        plCur: window.plCur };
      window.plS = () => {}; window.plRingSet = () => {}; window.beep = () => {};
      window.haptic = () => {}; window.plAfterSet = () => {}; window.plClear = () => {};
      window.plCur = () => ({ exId, target: 20, sets: 3, unit: 'reps', rest: 60 });
      PLAYER = { phase: 'work', repMs: 0, repCounted: false, repN: 0, elapsed: 0,
        ecc: 2, eccMs: 2000, repDurMs: 4000, total: 20,
        cues: ['Elbows in.', 'Brace hard.', 'Full range.'], cueIdx: 0 };
      for (let k = 0; k < 20 * 40; k++) plTickRep();
      await new Promise(r => setTimeout(r, 80));
      Object.assign(window, keep); window.coachSpeak = realSpeak;
      const missing = [];
      for (let n = 1; n <= 20; n++) {
        if (!said.some(x => new RegExp('(^|\\D)' + n + '(\\D|$)').test(x))) missing.push(n);
      }
      return { said, missing, coached: said.filter(x => /Elbows in|Brace hard|Full range/.test(x)).length };
    }, 'pushup');
    /* Measured before the fix: 4, 8, 10, 12 and 16 were never spoken in a
       20-rep set — a fifth of the count, silently replaced by coaching. */
    t.eq('every rep of a 20-rep set is counted aloud', reps.missing.join(','), '', reps.said);
    /* The floor: the coaching did not simply get deleted to make that true. */
    t.ok('and the form cues are still coached', reps.coached >= 3, reps.said);
    t.ok('with the number FIRST, so the next rep cannot cut it off',
      reps.said.every(x => /^(Up! )?\d/.test(x)), reps.said);

    /* 3. A late tick must not be paid for out of the display, so nothing is
          spoken from inside a tick any more. Asserted on the SOURCE: these are
          interval callbacks, and a check that calls them with a stubbed clock
          cannot see where the utterance was started from. */
    const src = await page.evaluate(() => ({
      hold: plTickHold.toString(),
      rep: plTickRep.toString(),
      flow: runFlow.toString(),
      paintsFirst: (() => { const b = plTickHold.toString();
        return b.indexOf("plS('#plNum'") < b.indexOf('plHype('); })(),
    }));
    /* And plSay() really DEFERS. Asserting that the ticks call it instead of
       coachSpeak() proves only the name changed — a synchronous plSay() puts
       the stall straight back on the critical path and every source assertion
       here stays green. Measure the behaviour. */
    const defers = await page.evaluate(async () => {
      const real = window.coachSpeak; let n = 0;
      window.coachSpeak = () => { n++; return true; };
      plSay('probe'); const sync = n;
      await new Promise(r => setTimeout(r, 30)); const later = n;
      /* An empty line must not schedule anything at all. */
      plSay(''); await new Promise(r => setTimeout(r, 20)); const afterEmpty = n;
      window.coachSpeak = real;
      return { sync, later, afterEmpty };
    });
    t.eq('plSay speaks nothing synchronously', defers.sync, 0, defers);
    t.eq('and speaks it once the tick has finished', defers.later, 1, defers);
    t.eq('an empty line is not spoken at all', defers.afterEmpty, 1, defers);
    t.ok('the hold tick starts no utterance of its own', !/[^l]coachSpeak\(/.test(src.hold), src.hold.slice(0, 400));
    t.ok('nor the rep tick', !/[^l]coachSpeak\(/.test(src.rep), src.rep.slice(0, 400));
    t.ok('the hold tick paints the number BEFORE it coaches', src.paintsFirst, src.hold.slice(0, 400));
    t.ok('and the flow tick defers its five-second call', /plSay\('Five seconds\.'\)/.test(src.flow));

    /* 4. The player names the movement before EVERY set, not only the first.
          "Before the exercise start, the exercise should be announced also.
           Not just time and start. Count in time and reps." */
    const ready = await page.evaluate(async () => {
      const said = []; const realSpeak = window.coachSpeak;
      window.coachSpeak = txt => { said.push(String(txt)); return true; };
      const keep = { plClear: window.plClear, plChrome: window.plChrome,
        plBodyWork: window.plBodyWork, plS: window.plS, plRingSet: window.plRingSet,
        beep: window.beep, autoRoll: window.autoRoll, plCur: window.plCur };
      window.plClear = () => {}; window.plChrome = () => {}; window.plBodyWork = () => {};
      window.plS = () => {}; window.plRingSet = () => {}; window.beep = () => {};
      window.autoRoll = () => {};
      const run = async (exId, unit, target, setIdx) => {
        await new Promise(r => setTimeout(r, 60));
        said.length = 0;
        window.plCur = () => ({ exId, target, sets: 3, unit, rest: 55 });
        PLAYER = { phase: 'ready', s: setIdx, i: 0, items: [{ exId }], running: false,
          ready: 3, budget: 20 };
        plEnterReady(setIdx === 0);
        await new Promise(r => setTimeout(r, 60));
        return said.slice();
      };
      const o = {};
      const first = await run('pushup', 'reps', 12, 0);
      o.firstSet = first.join(' | ');
      /* THE ONE THAT WAS BROKEN: the name was only ever said on set 1. */
      const third = await run('pushup', 'reps', 12, 2);
      o.laterSet = third.join(' | ');
      const held = await run('plank', 'time', 45, 1);
      o.timed = held.join(' | ');
      Object.assign(window, keep); window.coachSpeak = realSpeak;
      return o;
    });
    t.ok('the first set is announced by name', /Push-?Up/i.test(ready.firstSet), ready);
    t.ok('and so is the third', /Push-?Up/i.test(ready.laterSet), ready);
    /* Both halves of the ask: the name AND what is being asked for. */
    t.ok('with the reps asked for', /12 reps/.test(ready.laterSet), ready);
    t.ok('a timed movement is named too', /Plank/i.test(ready.timed), ready);
    t.ok('and given its duration, not a rep count', /0?:?45|45/.test(ready.timed) && !/reps/.test(ready.timed), ready);

    /* And the ready countdown speaks no digits over it, for the same reason
       the warm-up transition does not. */
    const readySrc = await page.evaluate(() => plTickReady.toString());
    t.ok('the ready countdown speaks no digits', !/coachSay\(String/.test(readySrc), readySrc);
    t.ok('but still beeps every second', /beep\(/.test(readySrc), readySrc);
    t.ok("and still says 'Go!'", /coachSay\('Go!'\)/.test(readySrc), readySrc);

    /* 5. THE SAME DEFECT ON THE SURFACES v307 DID NOT TOUCH. Fixing one
          instance is not fixing the class — `if(!motivate(...))X` makes the
          hype line REPLACE X, and motivate() returns true whenever voice and
          hype are on, which is the default. */
    const sweep = await page.evaluate(async () => {
      const o = {}; const said = [];
      const real = { speak: window.coachSpeak, hype: window.hypeSpeak };
      window.coachSpeak = txt => { said.push(String(txt)); return true; };
      window.hypeSpeak = txt => { said.push('HYPE:' + txt); return true; };
      const keep = { ivClear: window.ivClear, ivRenderStep: window.ivRenderStep,
        ivS: window.ivS, ivRingSet: window.ivRingSet, autoRoll: window.autoRoll,
        beep: window.beep, beepDuck: window.beepDuck };
      window.ivClear = () => {}; window.ivRenderStep = () => {}; window.ivS = () => {};
      window.ivRingSet = () => {}; window.autoRoll = () => {}; window.beep = () => {};
      window.beepDuck = () => {};
      INTV = { i: 0, seq: [{ exId: 'burpee', type: 'work', secs: 30 }],
        running: false, total: 30, workElapsed: 0 };
      /* TWELVE rounds, not one. The hype line is picked at random, so a single
         round passes on a coin flip — measured at 0 named out of 12 before. */
      let named = 0, hyped = 0;
      for (let k = 0; k < 12; k++) {
        said.length = 0; ivStep(0);
        await new Promise(r => setTimeout(r, 20));
        if (said.some(x => /Burpee/i.test(x))) named++;
        if (said.some(x => /Burpee[.,]\s+\S/i.test(x))) hyped++;
      }
      o.hiitNamed = named; o.hiitStillHypes = hyped;
      Object.assign(window, keep);
      window.coachSpeak = real.speak; window.hypeSpeak = real.hype;
      return o;
    });
    t.eq('HIIT names the movement on every single round', sweep.hiitNamed, 12, sweep);
    /* The floor: the hype was not simply deleted to make that true. */
    t.ok('and still coaches after the name', sweep.hiitStillHypes >= 10, sweep);

    /* The source shape, on the three surfaces where a hype line could still
       swallow information the athlete asked for. */
    const noSwallow = await page.evaluate(() => ({
      hiit: /if\(!motivate\([^)]*\)\)coachSpeak\('Work!/.test(ivStep.toString()),
      baselineDigits: /coachSay\(String\(_bt\.ready\)\)/.test(startBaselineTimer.toString()),
      baselineNames: /coachSay\(t\.name\+/.test(startBaselineTimer.toString()),
    }));
    t.ok('the hype line can no longer replace the HIIT name', !noSwallow.hiit);
    t.ok('the baseline speaks no digit over its own announcement', !noSwallow.baselineDigits);
    t.ok('and names the test that is about to be measured', noSwallow.baselineNames);

    /* The standalone rep-cadence timer is plTickRep()'s twin and had the
       identical defect. Driven for real: the whole set, counted aloud. */
    const cadence = await page.evaluate(async () => {
      const said = []; const real = { speak: window.coachSpeak, hype: window.hypeSpeak };
      window.coachSpeak = txt => { said.push(String(txt)); return true; };
      window.hypeSpeak = txt => { said.push(String(txt)); return true; };
      const realSI = window.setInterval;
      /* Run its two intervals — the 5-second lead-in and the rep step — fast. */
      window.setInterval = (fn, ms) => realSI(fn, 6);
      runRepCadence(20, 'Probe', 0, null, EX.pushup);
      await new Promise(r => realSI(r, 900));
      try { stopTimer(); closeSheet(); } catch (e) {}
      window.setInterval = realSI;
      await new Promise(r => setTimeout(r, 60));
      window.coachSpeak = real.speak; window.hypeSpeak = real.hype;
      const missing = [];
      for (let n = 1; n <= 20; n++) {
        if (!said.some(x => new RegExp('(^|\\D)' + n + '(\\D|$)').test(x))) missing.push(n);
      }
      return { missing, said: said.slice(0, 26) };
    });
    /* GUARD: the timer really ran, or an empty transcript has no missing
       numbers and the check passes on nothing. */
    t.ok('guard: the rep-cadence timer actually ran', cadence.said.length > 5, cadence);
    t.eq('and counted every rep of the set aloud', cadence.missing.join(','), '', cadence);
  }

  /* ---- a get-ready must not talk over its own announcement (v317) --------
     v302 established that the beeps ARE the countdown and a voice on top of
     them is an interruption, and v307 applied it to the guided player's own
     get-ready. FOUR sibling countdowns never got it: HIIT's lead-in, the
     hold/rest timer, the rep cadence, and the warm-up/cool-down flow — whose
     OWN transition phase carries a comment explaining the rule three lines
     below the line that broke it.

     Measured on the rep cadence before the fix: "Guided set. 13 reps. Get
     ready." is spoken at 47ms and needs until 2355ms; the spoken "3" landed at
     2047ms and _deviceSpeak() cancels, so the last 308ms — the word "ready" —
     never played.

     BOTH HALVES ARE PINNED. Deleting the beeps as well satisfies every "no
     spoken digits" assertion and leaves a silent countdown, so each surface is
     asserted to still cue every second. */
  {
    const r = await page.evaluate(async () => {
      const o = {};
      const said = []; const beeps = [];
      let start = 0;
      const rs = window.coachSpeak, ry = window.coachSay, rb = window.beep;
      window.coachSpeak = t => said.push([Date.now() - start, String(t)]);
      window.coachSay = t => said.push([Date.now() - start, String(t)]);
      window.beep = (...a) => beeps.push([Date.now() - start, a[0]]);
      /* ~2.6 words a second at the app's rate — the same arithmetic used to
         measure the defect, so the check and the finding agree. */
      const dur = s => Math.round(String(s).split(/\s+/).filter(Boolean).length / 2.6 * 1000);
      const run = async (fn, ms) => {
        said.length = 0; beeps.length = 0; start = Date.now();
        try { fn(); } catch (e) { return { threw: e.message }; }
        await new Promise(r => setTimeout(r, ms));
        const digits = said.filter(([, x]) => /^\s*[0-9]\s*$/.test(x));
        const collisions = [];
        said.forEach(([t0, txt], i) => {
          if (/^\s*[0-9]\s*$/.test(txt)) return;
          const ends = t0 + dur(txt);
          said.slice(i + 1).forEach(([t1, x1]) => {
            if (/^\s*[0-9]\s*$/.test(x1) && t1 < ends) collisions.push([txt, x1, ends - t1]);
          });
        });
        return { lines: said.map(x => x[1]), digits: digits.map(x => x[1]),
          beepCount: beeps.length, collisions };
      };
      const sess = buildSession(STATE.progressPtr);
      const repMove = [...sess.main, sess.finisher].find(x => x.unit === 'reps');
      o.hadRepMove = !!repMove;
      if (repMove) o.repCadence = await run(() => startGuidedReps(repMove.exId), 4300);
      try { cancelReps(); } catch (e) {}
      o.flow = await run(() => runWarmup(), 4300);
      try { flowStop(false); } catch (e) {} try { closeSheet(); } catch (e) {}
      window.coachSpeak = rs; window.coachSay = ry; window.beep = rb;
      return o;
    });

    t.ok('guard: the session had a rep-based movement to pace', r.hadRepMove, r);
    t.ok('guard: the rep cadence really announced the set',
      (r.repCadence.lines || []).some(x => /reps/i.test(x)), r.repCadence);
    t.eq('the rep-cadence get-ready speaks no digits', r.repCadence.digits, [], r.repCadence);
    t.eq('so nothing cuts off its announcement', r.repCadence.collisions, [], r.repCadence);
    /* THE FLOOR: the seconds are still cued. A fix that deleted the beeps too
       passes every assertion above and leaves the athlete counting silence. */
    t.ok('and every second of it still beeps', r.repCadence.beepCount >= 4, r.repCadence);

    t.ok('guard: the warm-up flow really announced itself',
      (r.flow.lines || []).some(x => /get ready/i.test(x)), r.flow);
    t.eq('the flow get-ready speaks no digits', r.flow.digits, [], r.flow);
    t.eq('so nothing cuts off its announcement', r.flow.collisions, [], r.flow);
    t.ok('and every second of it still beeps', r.flow.beepCount >= 4, r.flow);
  }

  /* The other two surfaces are asserted on the SOURCE: HIIT's lead-in and the
     hold timer's get-ready both need state a check cannot cheaply build, and
     the defect is a single call that either is there or is not. Every
     get-ready in the app is swept at once, so a fifth one added later with the
     old shape fails here rather than reaching a phone. */
  {
    const src = await page.evaluate(() => document.documentElement.innerHTML);
    const spoken = (src.match(/coachSay\(String\(/g) || []).length;
    t.eq('no get-ready anywhere speaks its countdown digits', spoken, 0,
      { found: spoken });
  }

  /* THE WORK TOTAL COUNTED TICKS WHILE THE CLOCK COUNTED SECONDS (v425).

     `INTV.remain` is floored against the wall clock two lines up, for the
     reason its own comment gives — Chrome throttles a hidden tab to about one
     callback a minute. `INTV.workElapsed` was a bare `++` beside it, and that
     figure is what logGrind() stores and what the finish screen offers as
     "Log N min to my record". So the countdown caught up and the work total
     did not.

     Every case drives the REAL grinder rather than a hand-built INTV, because
     the defect lives in how the tick and the deadline interact. */
  {
    const we = await page.evaluate(() => {
      const R = {};
      const runGrinder = (expire) => {
        STATE.grindLog = []; save();
        go('today');
        startGrinder('grind6');                 // six 60-second stations
        if (!INTV) return { phase: 'NO INTV' };
        const started = INTV.phase;
        let g = 0;
        while (INTV && INTV.phase === 'lead' && g++ < 20) ivTickLead();
        const atWork = INTV ? INTV.phase : 'NO INTV';
        ivClear();                              // drive the ticks by hand
        let ticks = 0;
        if (expire) {
          INTV.deadline = monoNow() - expire;   // the station expired while hidden
          ivTick(); ticks = 1;
        } else {
          while (INTV && INTV.phase === 'work' && ticks++ < 400) ivTick();
        }
        const work = INTV ? INTV.workElapsed : null;
        const restBefore = INTV ? INTV.workElapsed : 0;
        let restAdds = null;
        if (INTV && INTV.phase === 'rest') { ivTick(); restAdds = INTV.workElapsed - restBefore; }
        try { hiitQuit(); } catch (e) {}
        const row = (STATE.grindLog || [])[0] || {};
        return { started, atWork, ticks, work, restAdds, logged: row.total };
      };

      R.healthy = runGrinder(0);
      R.throttled = runGrinder(1000);           // one tick, the station one second past its end
      R.wayPast = runGrinder(300000);           // five minutes past — cannot credit more than the station

      /* A GRINDER HAS NO REST AT ALL (v360), so it cannot say whether a rest
         tick credits work. Tabata can: 20s work, 10s rest. */
      go('today');
      startHiit('tabata');
      let g2 = 0;
      while (INTV && INTV.phase === 'lead' && g2++ < 20) ivTickLead();
      ivClear();
      let g3 = 0;
      while (INTV && INTV.phase === 'work' && g3++ < 60) ivTick();
      const restPhase = INTV ? INTV.phase : 'NO INTV';
      const beforeRest = INTV ? INTV.workElapsed : null;
      if (INTV) { INTV.deadline = monoNow() - 1000; ivTick(); }
      R.rest = { phase: restPhase, before: beforeRest,
                 adds: INTV ? INTV.workElapsed - beforeRest : null };
      try { hiitQuit(); } catch (e) {}
      return R;
    });

    /* GUARDS: without these the counts below are zero for the wrong reason. */
    t.eq('guard: the grinder opens on its lead-in', we.healthy.started, 'lead', we);
    t.eq('guard: and reaches the work phase', we.healthy.atWork, 'work', we);
    t.ok('guard: the unthrottled run really ticked a whole session',
         we.healthy.ticks > 300, we);
    t.eq('guard: the throttled run got exactly one tick', we.throttled.ticks, 1, we);

    t.eq('FLOOR: an ordinary grinder still counts every worked second',
         we.healthy.work, 360, we);
    t.eq('FLOOR: and stores that figure on the record', we.healthy.logged, 360, we);

    t.eq('one throttled tick credits the seconds the station really had',
         we.throttled.work, 60, we);
    t.ok('rather than the single tick it counted before',
         we.throttled.work !== 1, we);
    t.eq('and the record carries the real figure too', we.throttled.logged, 60, we);

    t.eq('a tick arriving long after the station ended credits the station and no more',
         we.wayPast.work, 60, we);

    /* The rest floor is what stops the fix becoming "credit every tick". It
       needs a surface that HAS a rest, so it runs Tabata rather than the
       grinder — and it needs the tick to be a throttled one, or a mutant that
       drops the phase test still adds only 1 and looks almost right. */
    t.eq('guard: Tabata really reaches a rest phase', we.rest.phase, 'rest', we);
    t.ok('guard: and had worked seconds on the clock before it',
         we.rest.before > 0, we);
    t.eq('FLOOR: a throttled REST tick credits no work at all',
         we.rest.adds, 0, we);
  }

  /* A CLOCK CATCHES UP; A PACER MUST NOT (v426).

     The interval sweep that closed the stopwatch class found two more timers
     nothing watched: the guided rep cadence's get-ready and its rep step. Both
     carried no `tick` and no `lastTick`, so tickStalled() answered false for
     them and the heartbeat could never see them. A reclaimed tick there is
     worse than a frozen stopwatch — the SET never finishes, so no rest is
     offered, onDone never fires and the sheet never closes.

     It cannot be rescued the way the others are. step() counts `n++` per call,
     so tickResync()'s catch-up tick would credit a rep the athlete never did.
     A pacer arms and waits; that is the honest answer.

     And LATE IS RELATIVE TO THE SURFACE'S OWN PERIOD. Every other surface
     ticks once a second; this one paces at the athlete's tempo, up to 6s. A
     flat 3s threshold reads a healthy 6s pacer as stalled and re-arms it on
     every beat, which resets the interval phase and calls the reps at odd
     times. */
  {
    const rc = await page.evaluate(() => {
      const R = {};
      const realSI = window.setInterval, realCI = window.clearInterval;
      let id = 9000; const armed = [];
      window.setInterval = (fn, ms) => { armed.push(ms); return ++id; };
      window.clearInterval = () => {};
      try {
        runRepCadence(6, 'Probe', 0, null, EX.pushup);

        R.readyWatched = timedSurfaces().indexOf(timer) >= 0;
        R.readyIsPacer = timer.catchUp === false;

        /* FLOOR: a pacer that is genuinely TICKING is not churned. Every case
           below hands the surface a lastTick by hand, so none of them can say
           whether the tick refreshes it — a mutant that stopped stamping
           escaped all of them, and a live pacer would then be re-armed on
           every beat once it was two periods old. Only a REAL tick over an
           old stamp tells them apart. */
        {
          timer.lastTick = monoNow() - 60000;
          const id0 = timer.iv;
          timer.tick();                                  // one real get-ready tick
          R.readyStamped = monoNow() - timer.lastTick < 1500;
          plGuardTick();
          R.readyTickingKept = timer.iv === id0;
        }

        for (let i = 0; i < 4; i++) timer.tick();      // walk the rest of the get-ready out
        R.reachedStep = timer.mode === 'reps' && timer.every > 0;
        R.stepWatched = timedSurfaces().indexOf(timer) >= 0;
        R.stepIsPacer = timer.catchUp === false;

        /* the pacer's tick is taken away, the id left in place */
        const num = () => { const e = document.querySelector('#rcNum'); return e ? e.textContent : 'NO ELEMENT'; };
        R.repBefore = num();
        const deadId = timer.iv;
        timer.lastTick = monoNow() - (timer.every * 2 + 2000);
        plGuardTick();
        R.repAfter = num();
        R.rearmed = timer.iv !== deadId;

        /* FLOOR: a healthy SLOW pacer is not churned. Four seconds is late by
           a flat rule and perfectly on time for a six-second rep. */
        timer.every = 6000;
        const liveId = timer.iv;
        timer.lastTick = monoNow() - 4000;
        plGuardTick();
        R.slowKept = timer.iv === liveId;

        /* the same floor on the rep step, over a stamp two periods old */
        {
          timer.lastTick = monoNow() - 60000;
          const id1 = timer.iv;
          timer.tick();                                  // one real rep call
          R.stepStamped = monoNow() - timer.lastTick < 1500;
          plGuardTick();
          R.stepTickingKept = timer.iv === id1;
        }

        /* the threshold's own contract, pinned directly */
        const t0 = { tick: () => {} };
        R.oneSecStalled    = tickStalled({ ...t0, lastTick: monoNow() - 4000 });
        R.oneSecFresh      = tickStalled({ ...t0, lastTick: monoNow() - 2500 });
        R.slowNotStalled   = tickStalled({ ...t0, lastTick: monoNow() - 4000, every: 6000 });
        R.slowStalledLater = tickStalled({ ...t0, lastTick: monoNow() - 13000, every: 6000 });
      } catch (e) { R.threw = String(e); }
      window.setInterval = realSI; window.clearInterval = realCI;
      try { stopTimer(); closeSheet(); } catch (e) {}
      return R;
    });

    t.ok('guard: the rep cadence ran without throwing', !rc.threw, rc);
    t.ok('guard: and the get-ready was walked all the way to the reps', rc.reachedStep, rc);
    t.ok('the rep-cadence get-ready is a surface the heartbeat can see', rc.readyWatched, rc);
    t.ok('and so is the rep step', rc.stepWatched, rc);
    t.ok('both declare themselves pacers rather than clocks',
         rc.readyIsPacer && rc.stepIsPacer, rc);

    t.ok('a dead pacer is re-armed', rc.rearmed, rc);
    t.eq('and the rescue does not credit a rep the athlete never did',
         rc.repAfter, rc.repBefore, rc);

    t.ok('FLOOR: a healthy slow pacer is not churned by the beat', rc.slowKept, rc);
    t.ok('a real get-ready tick refreshes the stamp', rc.readyStamped, rc);
    t.ok('FLOOR: so a ticking get-ready is left alone', rc.readyTickingKept, rc);
    t.ok('a real rep call refreshes it too', rc.stepStamped, rc);
    t.ok('FLOOR: so a ticking rep step is left alone', rc.stepTickingKept, rc);
    t.ok('guard: a one-second surface still reads stalled at four seconds', rc.oneSecStalled, rc);
    t.ok('FLOOR: and is left alone at two and a half — PL_STALL_MS is still the floor',
         !rc.oneSecFresh, rc);
    t.ok('a six-second pacer does not, at the same four seconds', !rc.slowNotStalled, rc);
    t.ok('but it does once it is late by two of its own periods', rc.slowStalledLater, rc);
  }

  /* ---------- A FINISHED TICK IS NOT A STALLED ONE ----------------------
     v426 registered the benchmark-ops clock with the heartbeat so a reclaimed
     tick could be rescued by name. tickStalled() asks only whether a surface
     carries a tick function and an old lastTick — it cannot tell a reclaimed
     tick from a finished one. Three of swFinal()'s four callers null their
     surface on the very next line, which hid that; opFinish() keeps OP alive
     for the Share / Done panel.

     Measured before the fix, on a 12-minute benchmark: the record said 12:00,
     the heartbeat re-armed opTick three seconds later, and the clock above the
     panel climbed to 12:01, 12:02 and onward for ever. One screen, two times
     for one effort, and a one-second interval running on a finished session.

     Each case builds its own ops session. The guards come first: without them
     "no rescue" is satisfied by a surface the heartbeat never watched at all. */
  {
    const op = await page.evaluate(async () => {
      const R = {};
      const wait = ms => new Promise(r => setTimeout(r, ms));

      /* GUARD + FLOOR: while the benchmark is RUNNING the rescue must work.
         A fix that simply stopped watching OP satisfies every assertion below
         and deletes the thing v426 exists for. */
      startOp('op_forge'); opStart();
      R.runWatched   = timedSurfaces().indexOf(OP) >= 0;
      R.runHasTick   = typeof OP.tick === 'function';
      /* A LIVE INTERVAL ID IS NOT EVIDENCE OF A LIVE INTERVAL: clearInterval
         leaves the id behind, so `!!OP.iv` is truthy on a tick that will never
         fire again — and a floor written that way passes on a heartbeat that
         re-armed nothing. Compare the id instead. */
      const ivBefore = OP.iv;
      clearInterval(OP.iv);            /* the OS reclaims the tick */
      OP.lastTick = monoNow() - 10000;
      R.runStalled  = tickStalled(OP);
      plGuardTick();
      R.runRearmed  = !!OP.iv && OP.iv !== ivBefore;
      opQuit();

      /* The defect: finish, then leave the panel up. */
      startOp('op_forge'); opStart();
      OP.at = monoNow() - 720000;      /* twelve real minutes */
      opFinish();
      R.recorded   = (STATE.opsPR || {}).op_forge;
      R.clockFace  = (document.querySelector('#opClock') || {}).textContent;
      R.panel      = (document.querySelector('#opBtns') || {}).textContent || '';
      R.ivCleared  = !OP.iv;
      OP.lastTick  = monoNow() - 10000;
      R.doneStalled = tickStalled(OP);
      plGuardTick();
      R.doneRearmed = !!OP.iv;
      await wait(1300);
      R.clockLater  = (document.querySelector('#opClock') || {}).textContent;
      opQuit();

      /* FLOOR: swFinal still reports the CLOCK, not the last painted number —
         v425's requirement, which an over-eager teardown would destroy. */
      startOp('op_forge'); opStart();
      OP.at = monoNow() - 300000; OP.secs = 1;
      R.finalReadsClock = swFinal(OP);
      opQuit();
      return R;
    });

    t.ok('guard: a RUNNING benchmark clock is watched by the heartbeat', op.runWatched, op);
    t.ok('guard: and carries a tick it can be rescued by', op.runHasTick, op);
    t.ok('guard: a reclaimed tick on it reads as stalled', op.runStalled, op);
    t.ok('FLOOR: so the beat still rescues a running benchmark', op.runRearmed, op);

    t.eq('the finished time is recorded from the clock', op.recorded, 720, op);
    t.ok('guard: the interval really was cleared at the finish', op.ivCleared, op);
    t.ok('a FINISHED benchmark no longer reads as a stalled tick', !op.doneStalled, op);
    t.ok('so the beat arms nothing on the finish screen', !op.doneRearmed, op);
    t.eq('and the clock does not climb past the recorded time',
         op.clockLater, '12:00', op);
    t.eq('the clock face shows the time that was recorded', op.clockFace, '12:00', op);
    t.ok('and the panel says the same', /12:00/.test(op.panel), op);

    t.eq('FLOOR: swFinal still reads the clock, never the cached number',
         op.finalReadsClock, 300, op);
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
