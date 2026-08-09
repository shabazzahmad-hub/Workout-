/* Suite 15 — voice tone.

   Every coach spoke at pitch 0.6 no matter which persona was talking, because
   DEFAULT_STATE shipped `voicePitch:0.6` and the "has the athlete tuned this by
   hand?" test was just `typeof === 'number'` — true for everybody, forever. So
   the per-persona pitches were dead code and the whole cast sat at a depth
   where Web Speech voices buzz. */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

export default async function run() {
  const t = suite('voice tone');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  /* ---- the three tones move the whole set, in the right direction ------- */
  {
    const r = await page.evaluate(() => {
      const out = { tones: VOICE_TONES.map(x => x[0]) };
      const persona = { pitch: 0.6 };
      delete STATE.settings.voicePitch;
      const at = k => { STATE.settings.voiceTone = k; return localPitchFor(persona); };
      out.deep = at('deep'); out.mid = at('mid'); out.bright = at('bright');
      out.ordered = out.deep < out.mid && out.mid < out.bright;
      /* The complaint was robotic-sounding depth. Below ~0.5 Web Speech voices
         buzz, so even the deepest preset has to stay clear of it. */
      out.deepAboveBuzz = out.deep >= 0.65;
      out.midNearNatural = out.mid >= 0.9 && out.mid <= 1.1;
      // junk falls back rather than throwing
      STATE.settings.voiceTone = 'sideways';
      out.junkKey = voiceToneKey();
      STATE.settings.voiceTone = 'mid';
      return out;
    });
    t.eq('three tones are offered', r.tones, ['deep', 'mid', 'bright']);
    t.ok('deep < mid < bright', r.ordered, r);
    t.ok('even Deep stays out of the buzzing range', r.deepAboveBuzz, r);
    t.ok('Mid sits in a voice\'s natural range', r.midNearNatural, r);
    t.eq('a junk tone falls back to mid', r.junkKey, 'mid');
  }

  /* ---- personas keep their character; the tone moves the baseline ------- */
  {
    const r = await page.evaluate(() => {
      delete STATE.settings.voicePitch;
      const drill = { pitch: 0.5 }, light = { pitch: 0.8 };
      const out = {};
      ['deep', 'mid', 'bright'].forEach(k => {
        STATE.settings.voiceTone = k;
        out[k] = { drill: localPitchFor(drill), light: localPitchFor(light) };
      });
      out.drillAlwaysDeeper = ['deep', 'mid', 'bright'].every(k => out[k].drill < out[k].light);
      out.spread = out.mid.light - out.mid.drill;
      /* An unknown persona must not throw or land somewhere odd. */
      STATE.settings.voiceTone = 'mid';
      out.noPersona = localPitchFor(null);
      out.emptyPersona = localPitchFor({});
      return out;
    });
    t.ok('a drill sergeant still reads deeper than a lighter coach in every tone',
      r.drillAlwaysDeeper, r);
    t.ok('but the difference is a colour, not a chasm', r.spread > 0 && r.spread < 0.35, r);
    t.ok('a missing persona still yields a sane pitch',
      r.noPersona >= 0.5 && r.noPersona <= 1.6, r);
    t.ok('so does an empty one', r.emptyPersona >= 0.5 && r.emptyPersona <= 1.6, r);
  }

  /* ---- the migration: this is what fixes it for an existing install ----- */
  {
    const r = await page.evaluate(() => {
      const out = {};
      // exactly what every phone has stored right now
      STATE.settings.voicePitch = 0.6;
      delete STATE.settings._toneFix; delete STATE.settings.voiceTone;
      normalizeState();
      out.staleCleared = !('voicePitch' in STATE.settings);
      out.nowMid = voiceToneKey() === 'mid';
      out.pitchAfter = localPitchFor({ pitch: 0.6 });
      out.louderThanBefore = out.pitchAfter > 0.6;

      // a pitch the athlete actually chose is left alone
      STATE.settings.voicePitch = 0.45;
      delete STATE.settings._toneFix;
      normalizeState();
      out.chosenKept = STATE.settings.voicePitch === 0.45;
      out.chosenWins = Math.abs(localPitchFor({ pitch: 0.6 }) - 0.45) < 1e-9;

      // and the migration only runs once
      delete STATE.settings.voicePitch;
      STATE.settings.voicePitch = 0.6;
      normalizeState();
      out.secondRunLeavesIt = STATE.settings.voicePitch === 0.6;

      delete STATE.settings.voicePitch; normalizeState();
      return out;
    });
    t.ok('the stale 0.6 default is cleared', r.staleCleared, r);
    t.ok('and the athlete lands on Mid', r.nowMid, r);
    t.ok('so the voices come up out of the robotic range', r.louderThanBefore, r);
    t.ok('a deliberately chosen pitch is not touched', r.chosenKept, r);
    t.ok('and it still overrides the tone', r.chosenWins, r);
    t.ok('the migration runs once, not on every boot', r.secondRunLeavesIt, r);
  }

  /* ---- picking a tone must actually take effect ------------------------- */
  {
    const r = await page.evaluate(() => {
      STATE.settings.voicePitch = 0.45;          // a stale hand-tuned value
      setVoiceTone('bright');
      const out = {
        overrideCleared: !('voicePitch' in STATE.settings),
        tone: voiceToneKey(),
        pitch: localPitchFor({ pitch: 0.6 }),
      };
      setVoiceTone('nonsense');
      out.junkIgnored = voiceToneKey() === 'bright';
      setVoiceTone('mid');
      return out;
    });
    t.ok('choosing a tone clears a stale manual override', r.overrideCleared, r);
    t.eq('the tone is stored', r.tone, 'bright');
    t.ok('and the pitch follows it', r.pitch > 1, r);
    t.ok('a junk tone is ignored rather than stored', r.junkIgnored, r);
  }

  /* ---- what the athlete actually hears, through the real speak path ----- */
  {
    const r = await page.evaluate(async () => {
      const spoken = [];
      const RealU = window.SpeechSynthesisUtterance;
      window.SpeechSynthesisUtterance = function (txt) {
        const u = new RealU(txt);
        setTimeout(() => spoken.push({ pitch: u.pitch, rate: u.rate }), 0);
        return u;
      };
      const realSpeak = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = () => {};
      STATE.settings.voice = true; delete STATE.settings.voicePitch;
      const heard = {};
      for (const k of ['deep', 'mid', 'bright']) {
        STATE.settings.voiceTone = k;
        spoken.length = 0;
        try { coachSpeak('Ten seconds.'); } catch (e) {}
        await new Promise(z => setTimeout(z, 60));
        heard[k] = spoken.length ? spoken[spoken.length - 1].pitch : null;
      }
      window.SpeechSynthesisUtterance = RealU;
      speechSynthesis.speak = realSpeak;
      STATE.settings.voiceTone = 'mid';
      return heard;
    });
    const got = ['deep', 'mid', 'bright'].map(k => r[k]);
    if (got.some(v => v === null)) t.fail('the speak path did not produce an utterance', r);
    else {
      t.ok('the tone reaches the utterance the athlete hears', r.deep < r.mid && r.mid < r.bright, r);
      t.ok('and none of it lands in the buzzing range', got.every(v => v >= 0.5), r);
    }
  }

  /* ---- the neural path means the same thing by "Deep" ------------------- */
  {
    const r = await page.evaluate(() => {
      const out = {};
      ['deep', 'mid', 'bright'].forEach(k => {
        STATE.settings.voiceTone = k;
        out[k] = { fromMinus2: neuralPitchFor('-2st'), fromNone: neuralPitchFor(null) };
      });
      STATE.settings.voiceTone = 'mid';
      out.midOnNeutralIsOmitted = neuralPitchFor(null) === null;   // "0st" is invalid SSML
      /* Read the SSML the request actually sends, not just neuralPitchFor() in
         isolation — checking only that the string "builds" let a mutation that
         bypassed the shift entirely go unnoticed. */
      STATE.settings.voiceTone = 'deep';
      out.ssmlDeep = neuralSSML('go', { v: 'x', pitch: '-2st' });
      STATE.settings.voiceTone = 'bright';
      out.ssmlBright = neuralSSML('go', { v: 'x', pitch: '-2st' });
      STATE.settings.voiceTone = 'mid';
      out.ssml = neuralSSML('go', { v: 'x', pitch: '-2st' });
      return out;
    });
    t.eq('Deep pushes a -2st persona further down', r.deep.fromMinus2, '-4st');
    t.eq('Mid leaves it where the persona put it', r.mid.fromMinus2, '-2st');
    t.eq('Bright brings it back to neutral, and omits the tag', r.bright.fromMinus2, null);
    t.ok('a neutral persona is omitted rather than emitting an invalid 0st',
      r.midOnNeutralIsOmitted, r);
    t.ok('the SSML still builds', /<speak/.test(r.ssml) && /<voice/.test(r.ssml), r.ssml);
    t.ok('and the SSML that gets SENT carries the Deep shift',
      /pitch="-4st"/.test(r.ssmlDeep), r.ssmlDeep);
    t.ok('Mid sends the persona\'s own value', /pitch="-2st"/.test(r.ssml), r.ssml);
    t.ok('Bright drops the prosody pitch entirely rather than sending 0st',
      !/pitch=/.test(r.ssmlBright), r.ssmlBright);
  }

  /* ---- and it is reachable in Settings ---------------------------------- */
  {
    const r = await page.evaluate(async () => {
      STATE.settings.voice = true;
      go('guide'); render();
      await new Promise(z => setTimeout(z, 150));
      const v = document.querySelector('#v-guide');
      const grp = v.querySelector('#voiceTone');
      return {
        present: !!grp,
        buttons: grp ? [...grp.querySelectorAll('button')].map(b => b.textContent.trim()) : [],
        oneSelected: grp ? grp.querySelectorAll('button.on').length === 1 : false,
        stillHasFineTune: /Fine-tune depth/.test(v.textContent),
      };
    });
    t.ok('Settings offers the tone control', r.present, r);
    t.eq('with all three options', r.buttons, ['Deep', 'Mid', 'Bright']);
    t.ok('and exactly one is selected', r.oneSelected, r);
    t.ok('the hand slider is still available for anyone who wants it', r.stillHasFineTune, r);
  }

  /* ---- only the A.I. Trainer may sound synthetic ------------------------ */
  {
    const r = await page.evaluate(() => {
      const belowLine = COACHES.filter(c => c.id !== 'robot'
        && typeof c.pitch === 'number' && c.pitch < 0.42).map(c => [c.id, c.pitch]);
      const neuralDeep = Object.keys(COACH_NEURAL).filter(k => {
        if (k === 'robot') return false;
        const m = /(-?\d+(?:\.\d+)?)\s*st/.exec((COACH_NEURAL[k] || {}).pitch || '');
        return m && parseFloat(m[1]) < -2;
      });
      delete STATE.settings.voicePitch; STATE.settings.voiceTone = 'mid';
      const strongman = COACHES.find(c => c.id === 'strongman');
      return {
        belowLine, neuralDeep,
        robotExempt: (COACHES.find(c => c.id === 'robot') || {}).pitch < 0.42,
        strongmanHeard: localPitchFor(strongman),
        strongmanNeural: (COACH_NEURAL.strongman || {}).pitch,
        validator: validateData().length,
      };
    });
    /* Asserting "the validator is clean" proves nothing about the rule — it
       stays clean whether the rule exists or not. Put an offending persona in
       front of it and require a complaint. */
    const guard = await page.evaluate(() => {
      /* validateData() logs its own complaints, and the harness treats a console
         error as a page failure — so mute it while we are deliberately breaking
         the data. */
      const _err = console.error; console.error = () => {};
      const hit = re => validateData().filter(m => re.test(m));
      const g = COACHES.find(c => c.id === 'gunny');
      const localWas = g.pitch, neuralWas = COACH_NEURAL.strongman.pitch;
      const robot = COACHES.find(c => c.id === 'robot');
      try {
        g.pitch = 0.3;
        const local = hit(/COACHES\.gunny.*robotic/);
        g.pitch = localWas;
        COACH_NEURAL.strongman.pitch = '-4st';
        const neural = hit(/COACH_NEURAL\.strongman.*processed/);
        COACH_NEURAL.strongman.pitch = neuralWas;
        // the exemption is a real carve-out, not an accident of ordering
        const robotNoise = hit(new RegExp('COACHES\\.robot|COACH_NEURAL\\.robot'));
        return { local, neural, robotNoise, robotPitch: robot.pitch, clean: validateData().length };
      } finally {
        g.pitch = localWas; COACH_NEURAL.strongman.pitch = neuralWas;
        console.error = _err;
      }
    });
    t.eq('the validator catches a persona dropped into the robotic range',
      guard.local.length, 1, guard);
    t.eq('and catches a neural pitch pushed past -2st', guard.neural.length, 1, guard);
    t.eq('the A.I. Trainer is exempt from both', guard.robotNoise, []);
    t.eq('and everything is put back', guard.clean, 0);
    t.eq('no real-voice persona sits in the robotic range', r.belowLine, []);
    t.eq('and none is deeper than -2st on the neural path', r.neuralDeep, []);
    t.ok('the A.I. Trainer is still deliberately synthetic', r.robotExempt, r);
    t.ok('Strongman now speaks in a human range',
      r.strongmanHeard >= 0.85 && r.strongmanHeard <= 1.05, r);
    t.eq('and its neural pitch is in line with the other deep coaches', r.strongmanNeural, '-2st');
    t.eq('the validator is clean', r.validator, 0);
  }

  /* ---- the beat tempo presets have to show which one is on -------------- */
  {
    const r = await page.evaluate(async () => {
      STATE.settings.beat = true;
      setBeatTempo(78);
      go('guide'); render();
      await new Promise(z => setTimeout(z, 150));
      const chips = () => [...document.querySelectorAll('#v-guide button.chip')]
        .filter(b => /Chill 70|Classic 78|Hype 92/.test(b.textContent));
      const state = () => chips().map(b => [b.textContent.trim(), b.classList.contains('on')]);
      const bpmLabel = () => {
        const e = document.querySelector('#beatTempoLbl');
        return e ? e.textContent.trim() : null;
      };
      const out = { at78: state(), label78: bpmLabel() };
      /* Tap the chip the way a thumb does, and read the UI back — the bug was
         that the tempo DID change while every visible control kept showing the
         old value, so a check on STATE alone would have passed. */
      const hype = chips().find(b => /Hype 92/.test(b.textContent));
      /* Read back SYNCHRONOUSLY. loadCoachVoices() parks a deferred renderGuide()
         600ms after voiceschanged, and waiting even 200ms here let that unrelated
         repaint land and paint the correct state — the check passed with the
         re-render deleted from setBeatTempo. The tap must repaint on its own. */
      clearTimeout(loadCoachVoices._t);
      hype.click();
      out.at92 = state();
      out.label92 = bpmLabel();
      out.stored = beatTempoPref();
      const slider = [...document.querySelectorAll('#v-guide input[type=range]')]
        .find(i => (i.getAttribute('onchange') || '').includes('setBeatTempo'));
      out.sliderValue = slider ? +slider.value : null;
      setBeatTempo(78);
      return out;
    });
    const on = arr => arr.filter(([, sel]) => sel).map(([n]) => n);
    t.eq('exactly one preset reads as selected at 78', on(r.at78), ['🎧 Classic 78']);
    t.eq('the label agrees', r.label78, '78 BPM');
    t.eq('tapping Hype moves the selection', on(r.at92), ['🔥 Hype 92']);
    t.eq('and the label follows', r.label92, '92 BPM');
    t.eq('and the slider follows', r.sliderValue, 92);
    t.eq('and it is actually stored', r.stored, 92);
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
