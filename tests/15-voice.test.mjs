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
      // Mid must sit at or above the artifact floor, not at 1.0 — a phone voice
      // shifted below ~1.1 buzzes, confirmed twice on a real device.
      out.midNearNatural = out.mid >= LOCAL_PITCH_FLOOR && out.mid <= 1.40;
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
      // The manual fine-tune still wins — within the range its own slider offers.
      // It cannot ask for a value below the floor because the slider no longer
      // goes there, which is what keeps the control honest about what it does.
      STATE.settings.voicePitch = 1.35;
      out.chosenWins = Math.abs(localPitchFor({ pitch: 0.6 }) - 1.35) < 1e-9;
      // and the ceiling holds too — a stored value above the usable band is clamped
      STATE.settings.voicePitch = 3.0;
      out.ceilingHolds = localPitchFor({ pitch: 0.6 }) <= 1.45;
      STATE.settings.voicePitch = 0.45;

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
    t.ok('but never past the usable ceiling', r.ceilingHolds, r);
    t.ok('the migration runs once, not on every boot', r.secondRunLeavesIt, r);
  }

  /* ---- absent must STAY absent across every boot after the first, not just
     the first — the exact regression this migration exists to prevent came
     back once already because a separate "default it if missing" line ran
     BEFORE the one-time migration on every call, re-adding voicePitch:0.6
     right after the migration had just cleared it, with nothing left to
     remove it a second time once _toneFix was already true. A real athlete's
     SECOND app open, forever, is exactly this shape: voicePitch already
     absent, _toneFix already true. */
  {
    const r = await page.evaluate(() => {
      const out = {};
      delete STATE.settings.voicePitch; delete STATE.settings._toneFix;
      normalizeState();                       // boot #1: sets, then migration clears it
      out.absentAfterFirstBoot = !('voicePitch' in STATE.settings);
      normalizeState();                       // boot #2: must not reintroduce it
      out.stillAbsentAfterSecondBoot = !('voicePitch' in STATE.settings);
      normalizeState(); normalizeState();     // and it never comes back, ever
      out.stillAbsentAfterMoreBoots = !('voicePitch' in STATE.settings);
      out.usesToneDerivedPitch = Math.abs(localPitchFor(null) - voiceTone()[3]) < 1e-9;
      return out;
    });
    t.ok('absent right after the one-time migration, as before', r.absentAfterFirstBoot, r);
    t.ok('and still absent on the very next boot', r.stillAbsentAfterSecondBoot, r);
    t.ok('and every boot after that, not just the second', r.stillAbsentAfterMoreBoots, r);
    t.ok('so an untouched athlete keeps reading the tone-derived pitch, not a phantom override',
      r.usesToneDerivedPitch, r);
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
        floor: LOCAL_PITCH_FLOOR,   // read from the page; not in Node scope
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
      r.strongmanHeard >= r.floor && r.strongmanHeard <= 1.40, r);
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

  /* ---- the neural path must never hang the coach into silence (v256) ------
     Found auditing the same defect class as the Gemini timeout the athlete
     hit live: an external call with no bound, whose failure mode is silence.
     Worse here than there. A <script> request that STALLS rather than fails
     fires neither onload nor onerror, so _sdkPromise never settles, so
     _sdkSynthesize never settles, so neuralSpeak()'s .catch never runs and
     onFail() — the device-voice fallback — never fires. And _sdkPromise is
     memoised, so the coach stays silent for the REST of the session, in a
     feature whose entire premise is hands-free. Both bounds are real
     parameters so a check can pass a short one. */
  {
    // a request that never fulfills — a true stall, not a fast rejection
    await page.route('https://aka.ms/**', () => {});
    const r = await page.evaluate(async () => {
      const hadSDK = window.SpeechSDK; delete window.SpeechSDK;
      const t0 = Date.now();
      let out;
      try { await loadSpeechSDK(400); out = { threw: false }; }
      catch (e) { out = { threw: true, ms: Date.now() - t0, msg: String(e.message || e) }; }
      /* It must also be RETRYABLE. The onerror path already cleared
         _sdkPromise for exactly this reason; a timeout that rejected without
         clearing would leave every later call awaiting the same dead promise
         — silence for the rest of the session, which is the actual defect.

         The discriminator is TIME, not outcome. An already-rejected promise
         rejects again the instant it is awaited, so "did it reject twice?"
         is true whether or not _sdkPromise was cleared — that version of
         this check passed against a mutant that deliberately left it wedged.
         A CLEARED promise makes a genuinely new attempt and has to sit out
         the bound again; a wedged one returns the dead promise immediately. */
      const t1 = Date.now();
      try { await loadSpeechSDK(400); } catch (e) {}
      out.secondMs = Date.now() - t1;
      if (hadSDK) window.SpeechSDK = hadSDK;
      return out;
    });
    await page.unroute('https://aka.ms/**');
    t.ok('a stalled Speech SDK load rejects instead of hanging forever', r.threw, r);
    t.ok('close to the requested bound, not the browser\'s own', r.ms < 3000, r);
    t.ok('with a message that reads as a timeout', /timed out/i.test(r.msg || ''), r);
    t.ok('and the dead promise is cleared so a later cue really re-attempts, rather than instantly re-rejecting forever',
      r.secondMs >= 200, r);
  }
  {
    /* The second hang path: the SDK loaded fine, but speakSsmlAsync talks over
       a WebSocket and a stalled socket calls NEITHER callback. Stub the SDK so
       loadSpeechSDK() short-circuits and only the synth bound is under test. */
    const r = await page.evaluate(async () => {
      const hadSDK = window.SpeechSDK;
      let closed = false;
      window.SpeechSDK = {
        SpeechConfig: { fromSubscription: () => ({}) },
        SpeechSynthesisOutputFormat: { Audio24Khz48KBitRateMonoMp3: 1 },
        ResultReason: { SynthesizingAudioCompleted: 1 },
        SpeechSynthesizer: function () {
          this.speakSsmlAsync = () => {};            // never calls back — a stalled socket
          this.close = () => { closed = true; };
        },
      };
      const t0 = Date.now();
      let out;
      try { await _sdkSynthesize('<speak/>', {}, 400); out = { threw: false }; }
      catch (e) { out = { threw: true, ms: Date.now() - t0, msg: String(e.message || e) }; }
      out.closedOnTimeout = closed;
      if (hadSDK) window.SpeechSDK = hadSDK; else delete window.SpeechSDK;
      return out;
    });
    t.ok('a stalled synthesis rejects instead of hanging forever', r.threw, r);
    t.ok('close to the requested bound', r.ms < 3000, r);
    t.ok('with a message that reads as a timeout', /timed out/i.test(r.msg || ''), r);
    t.ok('and the synthesizer is closed rather than leaked', r.closedOnTimeout, r);
  }
  {
    /* The whole point of bounding these is that the DEVICE voice takes over —
       a rejection nothing listens to is the same silence with better logging.
       Drive the real neuralSpeak() and prove onFail actually runs. Uses a
       synth that FAILS immediately rather than one that stalls: the rejection
       path is identical from neuralSpeak's side, and it does not require
       sitting out the production 10s bound to observe. */
    const r = await page.evaluate(async () => {
      const hadSDK = window.SpeechSDK;
      window.SpeechSDK = {
        SpeechConfig: { fromSubscription: () => ({}) },
        SpeechSynthesisOutputFormat: { Audio24Khz48KBitRateMonoMp3: 1 },
        ResultReason: { SynthesizingAudioCompleted: 1 },
        SpeechSynthesizer: function () {
          this.speakSsmlAsync = (ssml, ok, bad) => setTimeout(() => bad('socket closed'), 10);
          this.close = () => {};
        },
      };
      const keep = { on: STATE.settings.neuralOn, k: STATE.settings.azureKey, r: STATE.settings.azureRegion };
      STATE.settings.neuralOn = true; STATE.settings.azureKey = 'test'; STATE.settings.azureRegion = 'eastus';
      let fellBack = false;
      const handled = neuralSpeak('Three. Two. One.', null, () => { fellBack = true; });
      await new Promise(res => setTimeout(res, 400));
      Object.assign(STATE.settings, { neuralOn: keep.on, azureKey: keep.k, azureRegion: keep.r });
      if (hadSDK) window.SpeechSDK = hadSDK; else delete window.SpeechSDK;
      return { handled, fellBack };
    });
    t.ok('neuralSpeak accepts the utterance when a key is configured', r.handled, r);
    t.ok('and a failed synthesis hands the line to the device voice, not to silence', r.fellBack, r);
  }
  {
    // the production defaults are real bounds, read back as values
    const v = await page.evaluate(() => ({
      sdk: (loadSpeechSDK.toString().match(/ms\|\|(\w+)/) || [])[1],
      synth: (_sdkSynthesize.toString().match(/ms\|\|(\w+)/) || [])[1],
      sdkVal: typeof SPEECH_SDK_TIMEOUT_MS === 'number' ? SPEECH_SDK_TIMEOUT_MS : null,
      synthVal: typeof SPEECH_SYNTH_TIMEOUT_MS === 'number' ? SPEECH_SYNTH_TIMEOUT_MS : null,
    }));
    t.ok('the SDK load has a real default bound', v.sdkVal > 0 && v.sdkVal <= 30000, v);
    t.ok('and so does one synthesis', v.synthVal > 0 && v.synthVal <= 30000, v);
    t.ok('both are actually wired to their parameter, not ignored', !!v.sdk && !!v.synth, v);
  }

  /* ---- the default tone must not land any coach in the artifact zone ------
     Reported from a real device: at the old Mid base the eight deepest coaches
     all read as ROBOTIC, and switching to Bright fixed every one of them. That
     A/B is the diagnosis — a device's Web Speech voice is pitch-SHIFTED, not
     resynthesised, so shifting far down produces artifacts before it produces
     depth.

     Mid is the DEFAULT, so Mid is what the app is judged on. The check pins the
     floor there rather than pinning individual numbers, which would just be a
     restatement of the table and would break on every deliberate re-voicing. */
  {
    const r = await page.evaluate(() => {
      const keepTone = STATE.settings.voiceTone, keepPitch = STATE.settings.voicePitch;
      delete STATE.settings.voicePitch;              // no manual override in play
      const at = tone => { STATE.settings.voiceTone = tone;
        return COACHES.map(c => ({ id: c.id, name: c.name, p: localPitchFor(c) })); };
      const mid = at('mid'), deep = at('deep'), bright = at('bright');
      STATE.settings.voiceTone = keepTone;
      if (keepPitch !== undefined) STATE.settings.voicePitch = keepPitch;
      const byId = arr => Object.fromEntries(arr.map(x => [x.id, x.p]));
      const M = byId(mid), D = byId(deep), B = byId(bright);
      return {
        count: mid.length,
        // robot is exempt by design — sounding synthetic IS its character
        lowestNonRobot: Math.min(...mid.filter(x => x.id !== 'robot').map(x => x.p)),
        offenders: mid.filter(x => x.id !== 'robot' && x.p < 1.0).map(x => x.name),
        robotMid: M.robot,
        robotIsLowest: M.robot <= Math.min(...mid.filter(x => x.id !== 'robot').map(x => x.p)),
        // the eight the athlete actually reported
        reported: ['mastersgt','iron','relentless','strongman','viking','commando','spartan','britmajor']
          .map(k => ({ k, p: M[k] })),
        // tone still does something, in the right direction, for every coach
        toneOrderHolds: mid.every(x => D[x.id] < M[x.id] && M[x.id] < B[x.id]),
        // character ordering survives: a deeper-authored coach still sounds deeper
        deepestStillDeeper: M.mastersgt < M.dance && M.iron < M.cheer,
        // every coach x every tone, Deep included
        floorAll: Math.min(...[...mid, ...deep, ...bright].map(x => x.p)),
        ceilAll: Math.max(...[...mid, ...deep, ...bright].map(x => x.p)),
        floor: LOCAL_PITCH_FLOOR,
        /* An install from before the floor existed carries whatever the old
           slider let the athlete pick — the slider's new minimum protects new
           choices, not stored ones. Without this case nothing ever asks
           localPitchFor for a value under the floor, so deleting the clamp on
           the manual override passes clean. It did. */
        storedBelowFloor: (() => {
          const keep = STATE.settings.voicePitch;
          STATE.settings.voicePitch = 0.45;          // a legacy hand-tuned value
          const heard = localPitchFor(COACHES[0]);
          if (keep === undefined) delete STATE.settings.voicePitch;
          else STATE.settings.voicePitch = keep;
          return heard;
        })(),
      };
    });
    t.ok('guard: the whole cast was measured', r.count > 30, r);
    t.eq('no coach but the A.I. Trainer sits in the artifact zone at the default tone',
      r.offenders.length, 0, r.offenders);
    t.ok('the lowest non-robot coach clears natural pitch', r.lowestNonRobot >= 1.0, r);
    /* The floor is the real guarantee and it has to hold on EVERY tone. The
       athlete's question was "what happens when I put them on Deep" — the
       answer has to be a number, not a hope. */
    t.ok('nothing anywhere, on any tone, goes under the artifact floor',
      r.floorAll >= r.floor, r);
    t.ok('and the floor is where a real device said it had to be', r.floor >= 1.18, r);
    /* Both directions away from 1.0 resample. A floor that keeps climbing trades
       a buzz for a chipmunk, so the band has a ceiling as well. */
    t.ok('and nothing is pushed so high it chipmunks', r.ceilAll <= 1.45, r);
    t.ok('a pitch stored by an older install is raised to the floor too',
      r.storedBelowFloor >= r.floor, r);
    r.reported.forEach(x =>
      t.ok(`[${x.k}] the coach reported as robotic now clears it`, x.p >= 1.0, x));
    t.ok('the A.I. Trainer keeps its synthetic character — still the lowest', r.robotIsLowest, r);
    t.ok('Deep < Mid < Bright still holds for every coach', r.toneOrderHolds, r);
    t.ok('and a deeper-authored coach still reads deeper than a bright one',
      r.deepestStillDeeper, r);
  }

  /* ---- the region field, and the space that breaks it ------------------- */
  {
    const r = await page.evaluate(() => {
      const keep = STATE.settings.azureRegion;
      const out = {};
      /* The Azure portal shows "East US". `.trim().toLowerCase()` — what this
         used to do — leaves the interior space, and "east us" is not a region:
         it fails as an opaque WebSocket error with nothing naming the cause. */
      setAzureRegion('East US'); out.portalStyle = STATE.settings.azureRegion;
      setAzureRegion('  westeurope  '); out.padded = STATE.settings.azureRegion;
      setAzureRegion(''); out.emptyFallsBack = STATE.settings.azureRegion;
      out.knownReal = azRegionKnown('eastus');
      out.knownPortalStyle = azRegionKnown('East US');
      out.knownJunk = azRegionKnown('nowhereland');
      // guard: the set is a real list, not an empty one that answers no to all
      out.setSize = AZ_SPEECH_REGIONS.size;
      STATE.settings.azureRegion = keep;
      return out;
    });
    t.ok('guard: the region list is really populated', r.setSize > 20, r);
    t.eq('a region copied from the portal keeps its space out', r.portalStyle, 'eastus', r);
    t.eq('surrounding padding is still stripped', r.padded, 'westeurope', r);
    t.eq('an empty region falls back rather than sticking', r.emptyFallsBack, 'eastus', r);
    t.ok('a real region is recognised', r.knownReal, r);
    t.ok('and recognised through the portal spelling too', r.knownPortalStyle, r);
    t.ok('an invented region is not', r.knownJunk === false, r);
  }

  /* ---- the diagnostic's three stages each blame the right thing ---------
     The value here is entirely in the SEPARATION. A single test button cannot
     tell a blocked CDN from a bad key from a bad voice name, and this sandbox
     cannot reach Azure at all, so the staging is the only diagnosis there is.
     Each block forces exactly one stage to fail and requires the verdict to
     name that stage's cause and NOT the others'. */
  const runDiag = (page, opts) => page.evaluate(async o => {
    const keep = {
      on: STATE.settings.neuralOn, key: STATE.settings.azureKey,
      region: STATE.settings.azureRegion,
      load: window.loadSpeechSDK, synth: window._sdkSynthesize,
      play: window._neuralPlay, online: navigator.onLine,
    };
    STATE.settings.neuralOn = true;
    STATE.settings.azureKey = 'test-key';
    STATE.settings.azureRegion = o.region || 'eastus';
    const seen = [];
    window._neuralPlay = () => {};
    try {
      Object.defineProperty(navigator, 'onLine', { value: !o.offline, configurable: true });
    } catch (e) {}
    window.loadSpeechSDK = () => o.sdkFails
      ? Promise.reject(new Error('SDK load failed'))
      : Promise.resolve({});
    window._sdkSynthesize = (ssml, cfg) => {
      seen.push({ ssml, v: cfg && cfg.v, style: cfg && cfg.style });
      const n = seen.length;
      if (o.failStage === n) return Promise.reject(new Error(o.failMsg || 'boom'));
      return Promise.resolve(new ArrayBuffer(2048));
    };
    try { await runNeuralDiagnostic(); } catch (e) {}
    const el = document.querySelector('#nDiagOut');
    const html = el ? el.innerHTML : '';
    const text = el ? el.innerText : '';
    STATE.settings.neuralOn = keep.on; STATE.settings.azureKey = keep.key;
    STATE.settings.azureRegion = keep.region;
    window.loadSpeechSDK = keep.load; window._sdkSynthesize = keep.synth;
    window._neuralPlay = keep.play;
    /* PUT THE PROPERTY BACK, NOT A VALUE. defineProperty creates an OWN
       property that shadows Navigator.prototype's live getter; writing another
       fixed value leaves the shadow in place, so the page stops tracking the
       real connection for the rest of the suite and offline emulation goes
       unseen. Deleting the own property re-exposes the getter. */
    try { delete navigator.onLine; } catch (e) {}
    try { closeSheet(); } catch (e) {}
    return { html, text, seen, calls: seen.length };
  }, opts);

  {
    const r = await runDiag(page, {});
    t.ok('guard: a clean run really reached all three stages', r.calls === 2, r.seen);
    t.ok('a working setup says so', /working/i.test(r.text), r.text.slice(0, 200));
    /* Stage 2 is only diagnostic BECAUSE it is plain. If it carried the coach's
       style or pitch, a failure there would no longer isolate key/region — the
       exact merge that would quietly destroy the whole point of staging. */
    t.ok('the key/region stage speaks with no style and no pitch',
      !!r.seen[0] && !r.seen[0].style && !/prosody|express-as/.test(r.seen[0].ssml), r.seen[0]);
    t.ok('and the coach stage does carry the coach\'s own voice',
      !!r.seen[1] && !!r.seen[1].v, r.seen[1]);
  }
  {
    const r = await runDiag(page, { sdkFails: true });
    t.ok('a blocked voice engine is blamed on the connection',
      /connection|network/i.test(r.text), r.text.slice(0, 240));
    t.ok('and explicitly NOT on the key or the region',
      /not your key|not the key/i.test(r.text), r.text.slice(0, 240));
    t.eq('nothing is sent to Microsoft when the engine never loaded', r.calls, 0, r.seen);
  }
  {
    const r = await runDiag(page, { failStage: 1, failMsg: '401 Unauthorized' });
    t.ok('a rejected key is named as the key', /key was rejected/i.test(r.text), r.text.slice(0, 240));
    t.eq('and the coach stage is never reached', r.calls, 1, r.seen);
  }
  {
    const r = await runDiag(page, { failStage: 1, failMsg: '1006 websocket closed' });
    t.ok('a refused connection points at the region', /region/i.test(r.text), r.text.slice(0, 240));
    t.ok('and does not claim the key was rejected',
      !/key was rejected/i.test(r.text), r.text.slice(0, 240));
  }
  {
    /* The one verdict the old single-shot test could never produce: the
       athlete's credentials are provably fine and the fault is ours. */
    const r = await runDiag(page, { failStage: 2, failMsg: 'bad voice name' });
    t.eq('the coach stage really was the one that failed', r.calls, 2, r.seen);
    t.ok('a bad coach voice clears the key and region by name',
      /key and region are/i.test(r.text) && /fine/i.test(r.text), r.text.slice(0, 260));
    t.ok('and says it is an app bug rather than something to re-type',
      /app bug/i.test(r.text), r.text.slice(0, 260));
  }
  {
    const r = await runDiag(page, { offline: true });
    t.ok('offline is answered without touching the network', /offline/i.test(r.text), r.text.slice(0, 200));
    t.eq('and nothing is sent', r.calls, 0, r.seen);
  }
  {
    const r = await runDiag(page, { region: 'atlantisnorth' });
    t.ok('an unrecognised region is called out before anything is tried',
      /not one I recognise/i.test(r.text), r.text.slice(0, 240));
  }
  {
    /* The portal spelling is NOT the unrecognised case — it normalises to a
       real region and must run clean, or the warning would cry wolf at the
       single most common way this field gets filled in. */
    const r = await runDiag(page, { region: 'East US' });
    t.ok('the portal spelling is not treated as unknown',
      !/not one I recognise/i.test(r.text), r.text.slice(0, 240));
    t.ok('and still reaches a working verdict', /working/i.test(r.text), r.text.slice(0, 240));
  }

  /* ---- a region stored before the fix must still SPEAK -------------------
     Repairing the write path alone leaves every existing install broken, so
     the value has to be normalised where it is actually spent. This reads the
     region handed to the SDK rather than the one held in STATE — measuring the
     payload, not the container. */
  {
    const r = await page.evaluate(async () => {
      const keep = { region: STATE.settings.azureRegion, key: STATE.settings.azureKey, load: window.loadSpeechSDK };
      STATE.settings.azureKey = 'test-key';
      STATE.settings.azureRegion = 'east us';        // a legacy stored value
      let handed = null;
      window.loadSpeechSDK = () => Promise.resolve({
        SpeechConfig: { fromSubscription: (k, reg) => { handed = reg; return {}; } },
        SpeechSynthesisOutputFormat: { Audio24Khz48KBitRateMonoMp3: 1 },
        SpeechSynthesizer: function () { this.speakSsmlAsync = (s, ok) => ok({ reason: 1, audioData: null }); this.close = () => {}; },
        ResultReason: { SynthesizingAudioCompleted: 99 },
      });
      try { await _sdkSynthesize('<speak/>', { v: 'x' }, 2000); } catch (e) {}
      STATE.settings.azureRegion = keep.region; STATE.settings.azureKey = keep.key;
      window.loadSpeechSDK = keep.load;
      return { handed };
    });
    t.eq('a legacy "east us" still reaches Azure as a real region', r.handed, 'eastus', r);
  }

  /* ---- and normalizeState cleans it out of STATE, so backups stay clean -- */
  {
    const r = await page.evaluate(() => {
      const keep = STATE.settings.azureRegion;
      STATE.settings.azureRegion = 'East US';
      normalizeState();
      const after = STATE.settings.azureRegion;
      STATE.settings.azureRegion = keep;
      return { after };
    });
    t.eq('normalizeState repairs a stored region', r.after, 'eastus', r);
  }

  /* ---- the setup steps get out of the way once the key is saved ---------
     Read the RENDERED <details>, not the source. A source scan cannot tell
     "collapsed" from "deleted", and deleting them would be the wrong fix — a
     key can be removed, and the steps have to come back. */
  {
    const r = await page.evaluate(() => {
      const keep = { on: STATE.settings.neuralOn, key: STATE.settings.azureKey, tab: TAB };
      const read = () => {
        renderGuide();
        const v = document.querySelector('#v-guide');
        const els = [...v.querySelectorAll('details')]
          .filter(d => /portal\.azure\.com/.test(d.innerHTML));
        return {
          found: els.length,
          open: els.length === 1 ? !!els[0].open : null,
          hasSteps: els.length === 1 && /Keys and Endpoint/.test(els[0].innerHTML),
        };
      };
      STATE.settings.neuralOn = true;
      STATE.settings.azureKey = '';
      const noKey = read();
      STATE.settings.azureKey = 'a-saved-key';
      const saved = read();
      STATE.settings.neuralOn = keep.on; STATE.settings.azureKey = keep.key;
      go(keep.tab);
      return { noKey, saved };
    });
    t.eq('guard: the setup steps render exactly once with no key', r.noKey.found, 1, r);
    t.eq('guard: and exactly once with a key too', r.saved.found, 1, r);
    t.ok('with no key the steps are open where they are needed', r.noKey.open === true, r);
    t.ok('once a key is saved they fold away', r.saved.open === false, r);
    /* Folded, not gone — a key can be removed and the steps have to be there
       for the next person who needs them. */
    t.ok('and they are still there to open', r.saved.hasSteps, r);
  }

  /* ---- the baseline battery gets one steady voice ----------------------
     Auto rolls a new coach at every timer start, so a ten-test battery met
     ten different personas during the one session where the athlete is
     holding maximal form and listening for a count. */
  {
    const r = await page.evaluate(async () => {
      STATE.settings.coach = 'auto';
      assessState = { idx: 0, results: {}, reassess: 0 };
      const seen = [];
      /* Run several tests and record who speaks each time. One test proves
         nothing — the defect is that the voice CHANGES between them. */
      for (let i = 0; i < 4; i++) {
        assessState.idx = i;
        renderAssessStep();
        await new Promise(z => setTimeout(z, 60));
        startBaselineTimer();
        await new Promise(z => setTimeout(z, 60));
        seen.push(currentPersona().id);
        stopBaselineTimer();
      }
      /* Outside the battery, auto must still rotate — pinning the voice
         everywhere is the over-eager version of this fix. */
      const outside = [];
      for (let i = 0; i < 6; i++) { autoRoll(); outside.push(currentPersona().id); }
      return { seen, outside, unique: [...new Set(seen)].length,
        outsideUnique: [...new Set(outside)].length };
    });
    t.eq('every baseline test uses the same coach', r.unique, 1);
    t.eq('and it is the Wrestling Coach', r.seen[0], 'wrestle');
    /* Guard: with 38 coaches in a shuffle bag, six rolls landing on one id
       would mean the rotation is broken, not that this check is strict. */
    t.ok('auto still rotates outside the battery', r.outsideUnique > 1, r);
  }
  {
    const r = await page.evaluate(async () => {
      /* An explicit pick outranks the default, the same way a hand-set
         protein target outranks the calculation. */
      STATE.settings.coach = 'viking';
      assessState = { idx: 0, results: {}, reassess: 0 };
      renderAssessStep();
      await new Promise(z => setTimeout(z, 60));
      startBaselineTimer();
      await new Promise(z => setTimeout(z, 60));
      const during = currentPersona().id;
      stopBaselineTimer();
      const after = currentPersona().id;
      /* The trap this fix had to avoid: assessState is NEVER set back to null,
         so keying the override off it would pin the voice for the life of the
         app. assessState is still truthy right here. */
      const stillHasAssessState = !!assessState;
      STATE.settings.coach = 'auto';
      const autoAfter = (autoRoll(), currentPersona().id);
      return { during, after, stillHasAssessState, autoAfter };
    });
    t.eq('a coach the athlete chose is used in the battery too', r.during, 'viking');
    t.eq('and still outside it', r.after, 'viking');
    t.ok('guard: assessState is still set, so the override is not keyed to it',
      r.stillHasAssessState, r);
    t.ok('and auto goes back to rotating once the battery is over',
      typeof r.autoAfter === 'string' && r.autoAfter.length > 0, r);
  }

  /* ---- why every coach sounds the same ---------------------------------
     Reported from the phone: "I'm only hearing a female voice, I'm not
     hearing any of the other coaches." The rotation is not the suspect — 38
     personas play through a shuffle bag before any repeat, and that is
     checked above. What a persona SOUNDS like is, and two things collapse
     the whole cast onto one voice. Neither is visible from here, so the app
     has to measure it on the device and say which one it is. */
  {
    const r = await page.evaluate(() => {
      const o = {}, realName = STATE.settings.voiceName, realVoices = COACH_VOICES;
      const fake = names => { COACH_VOICES = names.map(n => ({ name: n, lang: 'en-US' }));
        assignCoachVoices(); };

      /* 1. A picked voice overrides EVERY coach — by design, and the copy
         under the picker never said so. */
      fake(['Samantha', 'Daniel', 'Karen', 'Alex', 'Moira', 'Fred']);
      STATE.settings.voiceName = 'Samantha';
      const forced = voiceCheckHTML();
      o.forcedNamed = /Every coach is using one voice/.test(forced) && /Samantha/.test(forced);
      o.forcedOffersFix = /setCoachVoice\(''\)/.test(forced);
      o.diagForced = voiceDiag().forced;
      /* It has to say so even BEFORE the device has loaded its voice list —
         which is exactly the state an athlete is in when they open Settings
         to ask why. Ordering this after the list check hid it completely. */
      COACH_VOICES = [];
      o.forcedWithNoList = /Every coach is using one voice/.test(voiceCheckHTML());

      /* 2. A device with one usable English voice. */
      STATE.settings.voiceName = '';
      fake(['Google US English']);
      o.oneVoice = /only offers 1 English voice/.test(voiceCheckHTML());

      /* 3. The healthy case must NOT warn — a guard that always fires is
         noise, and would make the two real explanations worthless. */
      fake(['Samantha', 'Daniel', 'Karen', 'Alex', 'Moira', 'Fred']);
      const good = voiceCheckHTML();
      o.healthyQuiet = !/Every coach is using one voice/.test(good) && !/only offers/.test(good);
      o.healthyCounts = /different voices/.test(good);
      o.distinct = voiceDiag().distinct;

      STATE.settings.voiceName = realName; COACH_VOICES = realVoices; assignCoachVoices();
      return o;
    });
    t.ok('a picked voice is reported as overriding every coach', r.forcedNamed, r);
    t.ok('and names the voice that is doing it', r.forcedNamed, r);
    t.ok('with one tap to hand the coaches back their own voices', r.forcedOffersFix, r);
    t.eq('the diagnostic reads the real setting', r.diagForced, 'Samantha');
    /* The ordering bug this check exists to prevent. */
    t.ok('and it says so even before the voice list has loaded', r.forcedWithNoList, r);
    t.ok('a one-voice phone is reported as a one-voice phone', r.oneVoice, r);
    /* The floors. */
    t.ok('a healthy phone gets no warning at all', r.healthyQuiet, r);
    t.ok('just a count of what is in use', r.healthyCounts, r);
    t.eq('and the coaches really are spread across them', r.distinct, 6);
  }

  /* ---- SAY "CONTINUE": THE THREE WAYS IT WENT SILENTLY DEAD ------------
     Reported from the phone as "the audio continue function is not working",
     and driven with a fake recogniser that behaves the way Chrome does. All
     three faults below were measured on the real routes, and every one of them
     was silent: the switch still read On and the rest screen still promised
     the word.

     This sandbox has no SpeechRecognition at all, so the fake IS the subject —
     hence the guard that the app really saw nothing before it was installed. */
  {
    const r = await page.evaluate(async () => {
      const o = {}; const wait = ms => new Promise(z => setTimeout(z, ms));
      /* This browser has a real webkitSpeechRecognition, so "it has none" is
         the wrong guard. What has to be true is that the app is building OURS —
         voiceCmdSupported() and voiceCmdStart() both read SpeechRecognition
         first, so assigning that name wins. */
      o.guardRealApiExists = typeof window.webkitSpeechRecognition === 'function';

      window.__vr = { made:0, starts:0, errors:0 };
      window.__recs = [];        // exists even if nothing is ever constructed
      window.__throwOnRestart = false;
      class FakeRec {
        constructor(){ window.__vr.made++; this._on=false; window.__recs=(window.__recs||[]); window.__recs.push(this); }
        start(){ window.__vr.starts++;
          if(this._on||window.__throwOnRestart){ const e=new Error('busy'); e.name='InvalidStateError'; throw e; }
          this._on=true; if(this.onstart) this.onstart(); }
        stop(){ this._end(); } abort(){ this._end(); }
        /* Chrome ends FIRST and fires onend on an instance that is already idle. */
        _end(){ if(!this._on) return; this._on=false; if(this.onend) this.onend(); }
        failWith(c){ window.__vr.errors++; if(this.onerror) this.onerror({error:c}); this._end(); }
        say(t){ if(!this._on) return false; if(this.onresult) this.onresult({resultIndex:0,results:[[{transcript:t}]]}); return true; }
      }
      window.SpeechRecognition = FakeRec;
      const listening = () => window.__recs.filter(x => x._on).length;
      const last = () => window.__recs[window.__recs.length - 1];

      STATE.settings.voiceCmd = true; save();
      o.guardSupportedNow = voiceCmdSupported();
      openPlayer(); PLAYER.phase = 'rest';
      voiceCmdSync();
      o.armed = listening() === 1;
      o.guardAppBuiltOurs = window.__vr.made === 1 && (last() instanceof FakeRec);
      /* GUARD BEFORE THE FIRST LINE THAT DEREFERENCES. A mutant that never
         opens the microphone leaves __recs empty, and every last() below then
         throws — which is still red, but a throw hides WHICH check found it
         and the same shape has hung a suite before. Report and stop. */
      if (!(window.__recs && window.__recs.length)) {
        STATE.settings.voiceCmd = false; _vrDown = ''; _vrNetFails = 0;
        voiceCmdStop(); playerQuit(); delete window.SpeechRecognition; save();
        return o;
      }

      /* A CLEAN silence — no throw, no heartbeat — must leave the SAME
         recogniser listening. Chrome ends recognition on every silence, so
         anything that waits for the next beat is a two-second hole in the
         middle of the one phase the word is for. */
      const madeBeforeSilence = window.__vr.made;
      last()._end();
      o.cleanSilenceKeepsListening = listening() === 1;
      o.cleanSilenceReusesIt = window.__vr.made === madeBeforeSilence;
      o.healthyHint = /Say/.test(voiceCmdHintHTML());
      o.healthyNoNote = voiceCmdNote() === '';

      /* 1. A RESTART THAT THROWS. Chrome throws InvalidStateError if asked to
         start again too soon. Swallowing it kept the dead object in _vrec, and
         voiceCmdSync() re-arms only while that is null — so the microphone was
         off for the rest of the session and no heartbeat could bring it back. */
      window.__throwOnRestart = true;
      last()._end(); await wait(10);
      o.deadAfterThrow = listening() === 0;
      window.__throwOnRestart = false;
      const madeBefore = window.__vr.made;
      voiceCmdSync(); await wait(10);
      o.freshAfterThrow = window.__vr.made === madeBefore + 1 && listening() === 1;
      PLAYER.phase = 'rest';
      let b = PLAYER.phase; last().say('continue'); await wait(30);
      o.wordActsAfterThrow = PLAYER.phase !== b;

      /* 2. THE CLOUD SERVICE CANNOT BE REACHED. Chrome's recogniser is a remote
         service and this is an offline-first app. Measured before the fix: 12
         failures, 13 restarts, no toast, the switch still On. */
      PLAYER.phase = 'rest';
      const startsBefore = window.__vr.starts;
      $('#toast').textContent = '';
      let failures = 0;
      for (let i = 0; i < 12 && voiceCmdDownReason() !== 'net'; i++) {
        if (last()._on) { last().failWith('network'); failures++; }
        await wait(4); voiceCmdSync();
      }
      o.netStrikes = VOICE_NET_STRIKES;
      o.netFailuresTolerated = failures;
      /* BOUNDED, not an exact number. The old assertion pinned 2, which was a
         consequence of v422 holding the microphone open for the WHOLE session:
         with v423 closing it when a rest ends, a heartbeat landing between
         phases costs one extra arm and the count is 3. The requirement was
         never the number — it is that the retrying STOPS. Measured before the
         v422 fix: 13 and still climbing. */
      o.netAttempts = window.__vr.starts - startsBefore;
      o.netStoodDown = voiceCmdDownReason() === 'net' && listening() === 0;
      o.netToast = /speech service/.test($('#toast').textContent || '');
      o.netHintSaysWhy = /speech service/.test(voiceCmdHintHTML());
      /* AND OFF THE GLASS, not out of the helper. A Settings tab that dropped
         the reason and kept printing the everyday sentence escaped every
         assertion that read voiceCmdNote() directly. */
      go('guide');
      o.netSettingsOnGlass = /speech service/.test((document.querySelector('.view.active') || {}).innerText || '');
      go('today');
      /* The switch is the athlete's choice and the service may be back next
         session, so a network failure must NOT turn it off. */
      o.netKeptSetting = voiceCmdOn() === true;

      /* And ending the session is a fresh attempt — no 'online' listener needed. */
      playerQuit(); voiceCmdSync();
      o.netClearsWhenSessionEnds = voiceCmdDownReason() === '';

      /* 3. speechSynthesis.speaking STUCK TRUE, which is a real Android shape
         after cancel() — and _deviceSpeak() calls cancel() on every utterance.
         Unbounded, the echo guard discards the word for ever. */
      openPlayer(); PLAYER.phase = 'rest'; voiceCmdSync();
      Object.defineProperty(window.speechSynthesis, 'speaking', { configurable:true, get:()=>true });
      _vrSpeakSince = 0; _vrSpokeAt = 0;
      o.echoBlocksRealLine = voiceCmdEcho();
      PLAYER.phase = 'rest'; b = PLAYER.phase; voiceCmdHeard('continue'); await wait(20);
      o.floorCoachLineIgnored = PLAYER.phase === b;
      _vrSpeakSince = Date.now() - (VOICE_ECHO_MAX_MS + 1000);
      PLAYER.phase = 'rest'; b = PLAYER.phase; voiceCmdHeard('continue'); await wait(30);
      o.stuckStopsBlocking = PLAYER.phase !== b;
      Object.defineProperty(window.speechSynthesis, 'speaking', { configurable:true, get:()=>false });

      /* FLOOR: the hint says nothing at all when the athlete has it off.
         Asserted on the WORDS, not on the markup: v423 made the container
         render always so a stand-down mid-rest has something to write into,
         and `=== ''` was pinning that old structure rather than the
         requirement. An empty container puts nothing on the glass. */
      STATE.settings.voiceCmd = false; save();
      o.floorOffIsSilent = !/\S/.test(voiceCmdHintHTML().replace(/<[^>]*>/g, ''));

      // put the page back the way the next block expects it
      STATE.settings.voiceCmd = false; _vrDown = ''; _vrNetFails = 0;
      _vrSpeakSince = 0; _vrSpokeAt = 0;
      voiceCmdStop(); playerQuit(); delete window.SpeechRecognition; save();
      return o;
    });
    t.ok('guard: this browser has a speech API of its own', r.guardRealApiExists, r);
    t.ok('guard: and the app is building the one the check controls', r.guardAppBuiltOurs, r);
    t.ok('guard: the microphone arms during a rest', r.armed, r);
    t.ok('an ordinary silence keeps listening without waiting for a heartbeat', r.cleanSilenceKeepsListening, r);
    t.ok('and reuses the recogniser rather than churning a new one', r.cleanSilenceReusesIt, r);

    t.ok('a restart that throws leaves nothing listening', r.deadAfterThrow, r);
    t.ok('so the next heartbeat builds a FRESH recogniser', r.freshAfterThrow, r);
    t.ok('and the word acts again', r.wordActsAfterThrow, r);

    t.eq('a run of network failures stands down after three', r.netFailuresTolerated, r.netStrikes, r);
    t.eq('and three is the bound the app states', r.netStrikes, 3);
    t.ok('so the restarts are bounded by the strike count rather than endless',
         r.netAttempts <= r.netStrikes, r);
    t.ok('the retrying stops rather than looping in silence', r.netStoodDown, r);
    t.ok('the athlete is told the speech service could not be reached', r.netToast, r);
    t.ok('and the rest screen names the reason instead of promising the word', r.netHintSaysWhy, r);
    t.ok('and the Settings tab really prints it, not just the helper', r.netSettingsOnGlass, r);
    t.ok('FLOOR: a network failure does not turn the athlete’s switch off', r.netKeptSetting, r);
    t.ok('ending the session clears the stand-down, so the next one retries', r.netClearsWhenSessionEnds, r);

    t.ok('FLOOR: the word is still ignored while the coach is genuinely speaking', r.floorCoachLineIgnored, r);
    t.ok('and the echo guard really did fire on that line', r.echoBlocksRealLine, r);
    t.ok('a speaking flag stuck past any real line stops blocking the word', r.stuckStopsBlocking, r);

    t.ok('FLOOR: a healthy phone gets the plain hint', r.healthyHint, r);
    t.ok('FLOOR: and no explanation it does not need', r.healthyNoNote, r);
    t.ok('FLOOR: the hint is silent when the athlete has it switched off', r.floorOffIsSilent, r);
  }

  /* ---- AND THE OFFLINE BRANCH, DRIVEN WITH THE BROWSER REALLY OFFLINE ----
     One-sided on purpose: navigator.onLine === false means there is no route
     at all, so a cloud recogniser cannot answer. It is never read the other
     way — a captive portal reports true — which is what the strike count
     above is for. */
  {
    const ctx = page.context();
    /* Each block builds the state it asserts on: make sure nothing earlier has
       left an own onLine shadowing the browser's getter. */
    await page.evaluate(() => { try { delete navigator.onLine; } catch (e) {} });
    const install = () => page.evaluate(() => {
      window.__vr2 = { starts: 0 };
      class F { constructor(){ this._on=false; } start(){ window.__vr2.starts++; this._on=true; if(this.onstart) this.onstart(); }
        stop(){ this._on=false; if(this.onend) this.onend(); } abort(){ this.stop(); } }
      window.SpeechRecognition = F;
      STATE.settings.voiceCmd = true; save();
      openPlayer(); PLAYER.phase = 'rest'; voiceCmdSync();
      return { reason: voiceCmdDownReason(), starts: window.__vr2.starts };
    });
    const on = await install();
    /* THE APP'S OWN 2 s HEARTBEAT RE-ARMS THE MICROPHONE, and on a loaded
       runner it wins the race to do so — so the check's own voiceCmdSync()
       below finds it already armed, opens nothing, and "newStarts" reads 0 on
       code that is perfectly correct. Measured deterministically rather than
       re-run: with the guard live, a 0 ms pause gives 1 and a 2.5 s pause
       gives 0; with it stopped, 2.5 s gives 1. Only the restart path may
       answer here — the same fix v423 needed one block away. */
    await page.evaluate(() => { try { clearInterval(_plGuard); _plGuard = null; } catch (e) {} });
    await ctx.setOffline(true);
    await page.waitForFunction(() => navigator.onLine === false, null, { timeout: 5000 });
    const off = await page.evaluate(async () => {
      const before = window.__vr2.starts;
      voiceCmdSync(); await new Promise(z => setTimeout(z, 20));
      return { onLine: navigator.onLine, reason: voiceCmdDownReason(),
               newStarts: window.__vr2.starts - before,
               hint: voiceCmdHintHTML(), note: voiceCmdNote(), stillOn: voiceCmdOn() };
    });
    await ctx.setOffline(false);
    await page.waitForFunction(() => navigator.onLine === true, null, { timeout: 5000 });
    const back = await page.evaluate(async () => {
      /* Sampled BEFORE the sync — reading it afterwards reports the recogniser
         this very call just armed, which is true whatever the heartbeat did. */
      const before = window.__vr2.starts, vrecBefore = !!_vrec, guard = !!_plGuard;
      voiceCmdSync(); await new Promise(z => setTimeout(z, 20));
      const out = { reason: voiceCmdDownReason(), newStarts: window.__vr2.starts - before,
                    vrecBefore, guard, hint: voiceCmdHintHTML() };
      STATE.settings.voiceCmd = false; _vrDown = ''; _vrNetFails = 0;
      voiceCmdStop(); playerQuit(); delete window.SpeechRecognition; save();
      try { plGuardOn(); } catch (e) {}   // each block puts back what it broke
      return out;
    });
    t.eq('guard: online, there is nothing to explain', on.reason, '');
    t.eq('guard: and the microphone armed', on.starts, 1);
    t.eq('a phone with no route at all reports the offline reason', off.reason, 'offline');
    t.eq('and the microphone is not opened for a service that cannot answer', off.newStarts, 0);
    t.ok('the rest screen says it needs a connection', /needs a connection/.test(off.hint), off);
    t.ok('and Settings says the same thing', /needs a connection/.test(off.note), off);
    t.ok('FLOOR: the athlete’s switch is left where they put it', off.stillOn, off);
    t.eq('back in signal it clears itself', back.reason, '');
    t.ok('guard: only this block\'s own sync could have re-armed it',
      back.vrecBefore === false && back.guard === false, JSON.stringify(back));
    t.eq('and the microphone re-arms', back.newStarts, 1);
    t.ok('with the plain hint again', /Say/.test(back.hint), back);
  }

  /* v423 — TWO WAYS THE APP EXPLAINED THE WRONG THING.
     A note about a listener that is not listening means nothing while the
     switch is off, and this is an offline-first app: an athlete in a basement
     gym who has never turned the feature on read an error INSTEAD of the
     sentence that says what it does. And a stand-down repainted TAB==='guide'
     — a screen nobody can be on during a session (TAB is 'today', measured) —
     so the rest screen kept promising the word over a dead microphone. */
  {
    const ctx = page.context();
    await page.evaluate(() => { try { delete navigator.onLine; } catch (e) {} });
    await seedAthlete(page);

    /* GUARD: online there is nothing to explain, so a non-empty note below is
       about being offline and not about some other state. */
    const guard = await page.evaluate(() => {
      _vrDown = ''; _vrNetFails = 0; STATE.settings.voiceCmd = true;
      return { reason: voiceCmdDownReason(), note: voiceCmdNote() };
    });

    await ctx.setOffline(true);
    await page.waitForFunction(() => navigator.onLine === false, null, { timeout: 5000 });
    const off = await page.evaluate(() => {
      _vrDown = ''; _vrNetFails = 0;
      STATE.settings.voiceCmd = true;      const onNote = voiceCmdNote();
      STATE.settings.voiceCmd = undefined; const offNote = voiceCmdNote();
      save(); go('guide');
      const txt = (document.querySelector('.view.active') || {}).innerText || '';
      const i = txt.indexOf('hands-free');
      return { onNote, offNote, reason: voiceCmdDownReason(), settings: txt.slice(i, i + 300) };
    });
    await ctx.setOffline(false);
    await page.evaluate(() => { try { delete navigator.onLine; } catch (e) {} });
    await page.waitForFunction(() => navigator.onLine === true, null, { timeout: 5000 });

    t.eq('guard: online there is nothing to explain', guard.reason, '');
    t.eq('guard: and no note at all', guard.note, '');
    t.eq('guard: offline really is the reason', off.reason, 'offline');
    t.ok('with the switch ON, offline is explained', /needs a connection/.test(off.onNote), off);
    t.eq('FLOOR: with the switch OFF there is nothing to explain', off.offNote, '');
    t.ok('and Settings describes the feature instead of an error',
         /only ever acts on that one word/.test(off.settings), off.settings);
    t.ok('the description says it needs a connection, so the choice is informed',
         /needs a connection/.test(off.settings), off.settings);

    /* A DEVICE that has no recogniser at all is said either way — it explains
       why the switch cannot do anything, which is true with it off. */
    const unsup = await page.evaluate(() => {
      const S = window.SpeechRecognition, W = window.webkitSpeechRecognition;
      delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
      STATE.settings.voiceCmd = undefined;
      const note = voiceCmdNote();
      if (S) window.SpeechRecognition = S; if (W) window.webkitSpeechRecognition = W;
      return { note, supported: voiceCmdSupported() };
    });
    t.ok('guard: the recogniser really was hidden', unsup.note !== undefined, unsup);
    t.ok('an unsupported device is told so even with the switch off',
         /no speech recognition/.test(unsup.note), unsup);

    /* The stand-down, on the surface the athlete is actually looking at —
       DRIVEN THROUGH THE RECOGNISER'S OWN onerror, because calling
       voiceCmdRepaint() by hand leaves the two call sites untested and both
       mutants that delete them walked straight through. */
    const stand = await page.evaluate(async () => {
      const wait = ms => new Promise(z => setTimeout(z, ms));
      window.__recs2 = [];
      class Rec {
        constructor(){ this._on = false; window.__recs2.push(this); }
        start(){ this._on = true; if (this.onstart) this.onstart(); }
        stop(){ this._end(); }
        _end(){ if (!this._on) return; this._on = false; if (this.onend) this.onend(); }
        failWith(c){ if (this.onerror) this.onerror({ error: c }); this._end(); }
      }
      const real = window.SpeechRecognition;
      window.SpeechRecognition = Rec;
      _vrDown = ''; _vrNetFails = 0; STATE.settings.voiceCmd = true; save();
      go('today'); openPlayer(0); plEnterRest(60, 'ex');
      voiceCmdSync(); await wait(10);
      const body = () => (document.querySelector('#plBody') || {}).innerText || '';
      const last = () => window.__recs2[window.__recs2.length - 1];
      const r = { tab: TAB, armed: !!(last() && last()._on),
                  before: /Say .continue./.test(body()), tid: PLAYER.tid };
      for (let i = 0; i < 12 && voiceCmdDownReason() !== 'net'; i++) {
        if (last() && last()._on) last().failWith('network');
        await wait(4); voiceCmdSync();
      }
      r.stoodDown = voiceCmdDownReason() === 'net';
      r.promises = /Say .continue./.test(body());
      r.saysWhy = /speech service/.test(body());
      r.tidAfter = PLAYER.tid;
      voiceCmdStop(); playerQuit();
      STATE.settings.voiceCmd = false; _vrDown = ''; _vrNetFails = 0; save();
      if (real) window.SpeechRecognition = real; else delete window.SpeechRecognition;
      return r;
    });
    t.eq('guard: a session runs on the Today tab, not on Settings', stand.tab, 'today');
    t.ok('guard: the microphone really armed for this rest', stand.armed, stand);
    t.ok('guard: the rest screen was promising the word', stand.before, stand);
    t.ok('guard: the service really stood down', stand.stoodDown, stand);
    t.ok('after the stand-down it no longer promises it', !stand.promises, stand);
    t.ok('and says why, on the screen that made the promise', stand.saysWhy, stand);
    t.eq('and the rest clock is untouched — no second interval', stand.tidAfter, stand.tid);

    /* The refusal path is worse: the app turns the switch off ITSELF. Driven
       through onerror for the same reason. */
    const ref = await page.evaluate(async () => {
      const wait = ms => new Promise(z => setTimeout(z, ms));
      window.__recs3 = [];
      class Rec {
        constructor(){ this._on = false; window.__recs3.push(this); }
        start(){ this._on = true; if (this.onstart) this.onstart(); }
        stop(){ this._end(); }
        _end(){ if (!this._on) return; this._on = false; if (this.onend) this.onend(); }
        failWith(c){ if (this.onerror) this.onerror({ error: c }); this._end(); }
      }
      const real = window.SpeechRecognition;
      window.SpeechRecognition = Rec;
      _vrDown = ''; _vrNetFails = 0; STATE.settings.voiceCmd = true; save();
      go('today'); openPlayer(0); plEnterRest(60, 'ex');
      voiceCmdSync(); await wait(10);
      const body = () => (document.querySelector('#plBody') || {}).innerText || '';
      const last = () => window.__recs3[window.__recs3.length - 1];
      const r = { armed: !!(last() && last()._on), before: /Say .continue./.test(body()) };
      if (last()) last().failWith('not-allowed');
      await wait(10);
      r.switchOff = voiceCmdOn() === false;
      r.promises = /Say .continue./.test(body());
      voiceCmdStop(); playerQuit();
      STATE.settings.voiceCmd = false; _vrDown = ''; _vrNetFails = 0; save();
      if (real) window.SpeechRecognition = real; else delete window.SpeechRecognition;
      return r;
    });
    t.ok('guard: the microphone really armed for this rest', ref.armed, ref);
    t.ok('guard: it was promising the word first', ref.before, ref);
    t.ok('guard: the refusal really turned the switch off', ref.switchOff, ref);
    t.ok('a switch the app turned off stops promising the word', !ref.promises, ref);

    /* FLOOR: an ordinary healthy rest is unchanged.

       EACH BLOCK BUILDS THE STATE IT ASSERTS ON, and "healthy" here means a
       microphone that actually CAME UP: the line reads _vrEverLive, which only
       onstart sets. So this block stubs a recogniser of its own rather than
       inheriting one.
       Without that it passed on residue. voiceCmdStop() and playerQuit() do NOT
       clear _vrEverLive — only voiceCmdSync() does, when nothing is open — so
       the flag survived from the block above and the floor read `true` for a
       microphone this block never opened. The app's own 2 s guard beat calls
       voiceCmdSync(); on a loaded runner one lands in the gap between two
       blocks, the flag clears, and the floor goes red on correct code.
       Measured, with everything else identical: no beat in the gap gives
       promises:true, one beat gives promises:false — which is the CI failure
       byte for byte. */
    const ok = await page.evaluate(async () => {
      const wait = ms => new Promise(z => setTimeout(z, ms));
      window.__recs4 = [];
      class Rec {
        constructor(){ this._on = false; window.__recs4.push(this); }
        start(){ this._on = true; if (this.onstart) this.onstart(); }
        stop(){ this._end(); }
        _end(){ if (!this._on) return; this._on = false; if (this.onend) this.onend(); }
      }
      const real = window.SpeechRecognition;
      window.SpeechRecognition = Rec;
      _vrDown = ''; _vrNetFails = 0; _vrEverLive = false;
      STATE.settings.voiceCmd = true; save();
      go('today'); openPlayer(0); plEnterRest(60, 'ex');
      voiceCmdSync(); await wait(10);
      const body = () => (document.querySelector('#plBody') || {}).innerText || '';
      const last = () => window.__recs4[window.__recs4.length - 1];
      const r = { armed: !!(last() && last()._on), live: _vrEverLive,
                  promises: /Say .continue./.test(body()),
                  quiet: !/speech service|offline/i.test(body()) };
      voiceCmdStop(); playerQuit();
      STATE.settings.voiceCmd = false; _vrDown = ''; _vrNetFails = 0; save();
      if (real) window.SpeechRecognition = real; else delete window.SpeechRecognition;
      return r;
    });
    t.ok('guard: the microphone really armed for this rest', ok.armed, ok);
    t.ok('guard: and really came up — the floor is not reading residue', ok.live, ok);
    t.ok('FLOOR: a healthy rest still promises the word', ok.promises, ok);
    t.ok('FLOOR: and says nothing about a failure', ok.quiet, ok);
  }

  /* v423 — THE COPY SAID ONE THING AND THE MICROPHONE DID ANOTHER.
     Settings promised "Listens only during rest". voiceCmdSync() armed on
     "a session is open", so audio streamed to a cloud recogniser through
     every working set — measured open in ready, work AND rest. A false
     PRIVACY claim is the worst kind of promise in UI text with no code
     behind it, so the code moved to match: the microphone opens where the
     word can act and nowhere else. */
  {
    await seedAthlete(page);
    const mic = await page.evaluate(() => {
      window.__mic = { starts: 0, stops: 0, live: 0 };
      class FakeRec {
        constructor() { this._on = false; }
        start() { if (this._on) throw new Error('InvalidStateError');
                  this._on = true; window.__mic.starts++; window.__mic.live++; if (this.onstart) this.onstart(); }
        stop() { if (!this._on) return; this._on = false; window.__mic.stops++; window.__mic.live--; }
      }
      const real = window.SpeechRecognition;
      window.SpeechRecognition = FakeRec;
      STATE.settings.voiceCmd = true; _vrDown = ''; _vrNetFails = 0; save();
      const beat = () => plGuardTick();
      const r = {};
      go('today'); openPlayer(0);

      plEnterReady(false); beat();
      r.readyPhase = PLAYER.phase; r.ready = window.__mic.live;

      plClear(); plEnterWork(); beat();
      r.workPhase = PLAYER.phase; r.work = window.__mic.live;
      r.actsInWork = voiceCmdActionable();

      plClear(); plEnterRest(60, 'ex'); beat();
      r.restPhase = PLAYER.phase; r.rest = window.__mic.live;
      r.actsInRest = voiceCmdActionable();
      r.builtOurs = !!(_vrec instanceof FakeRec);

      plClear(); plEnterWork(); beat();
      r.afterRest = window.__mic.live;
      plClear(); plEnterRest(60, 'ex'); beat();
      r.secondRest = window.__mic.live;

      playerQuit(); beat();
      r.afterQuit = window.__mic.live;

      r.totals = { starts: window.__mic.starts, stops: window.__mic.stops };
      voiceCmdStop(); STATE.settings.voiceCmd = false; _vrDown = ''; _vrNetFails = 0; save();
      if (real) window.SpeechRecognition = real; else delete window.SpeechRecognition;
      return r;
    });

    /* GUARDS: the phases really are the ones named, and the app built the
       recogniser this block controls — otherwise every count below is zero
       for a reason that has nothing to do with the fix. */
    t.eq('guard: the ready phase was built', mic.readyPhase, 'ready');
    t.eq('guard: the work phase was built', mic.workPhase, 'work');
    t.eq('guard: the rest phase was built', mic.restPhase, 'rest');
    t.ok('guard: the app opened the recogniser this block controls', mic.builtOurs, mic);

    t.eq('the microphone is shut during the 3-2-1 into position', mic.ready, 0);
    t.eq('and shut through the working set', mic.work, 0);
    t.ok('where the word does nothing anyway', !mic.actsInWork, mic);
    t.eq('it opens for the rest', mic.rest, 1);
    t.ok('which is where the word acts', mic.actsInRest, mic);
    t.eq('and shuts again the moment the next set starts', mic.afterRest, 0);
    t.eq('FLOOR: it opens again on the next rest', mic.secondRest, 1);
    t.eq('and is shut once the session ends', mic.afterQuit, 0);
    t.eq('two rests opened it exactly twice', mic.totals.starts, 2);
    t.eq('and closed it exactly twice — nothing left listening', mic.totals.stops, 2);

    /* A STUCK TIMER is the one exception, and the copy names it. */
    const stuck = await page.evaluate(() => {
      window.__mic2 = { live: 0 };
      class FakeRec2 {
        constructor() { this._on = false; }
        start() { this._on = true; window.__mic2.live++; if (this.onstart) this.onstart(); }
        stop() { if (this._on) { this._on = false; window.__mic2.live--; } }
      }
      const real = window.SpeechRecognition;
      window.SpeechRecognition = FakeRec2;
      STATE.settings.voiceCmd = true; _vrDown = ''; _vrNetFails = 0; save();
      go('today'); openPlayer(0); plClear(); plEnterWork();
      const r = {};
      voiceCmdSync(); r.beforeStall = window.__mic2.live;
      /* make the work phase read as stuck: no tick, deadline long gone */
      PLAYER.tid = null; PLAYER.phaseAt = monoNow() - 60000; PLAYER.lastTick = monoNow() - 60000;
      r.stalled = timerStalled(PLAYER);
      voiceCmdSync(); r.afterStall = window.__mic2.live;
      voiceCmdStop(); playerQuit();
      STATE.settings.voiceCmd = false; _vrDown = ''; _vrNetFails = 0; save();
      if (real) window.SpeechRecognition = real; else delete window.SpeechRecognition;
      return r;
    });
    t.eq('guard: a healthy working set leaves it shut', stuck.beforeStall, 0);
    t.ok('guard: the timer really does read as stuck', stuck.stalled, stuck);
    t.eq('a stuck timer opens it, because the word rescues that', stuck.afterStall, 1);

    /* The copy has to describe what the code now does. */
    const copy = await page.evaluate(() => {
      go('guide');
      const txt = (document.querySelector('.view.active') || {}).innerText || '';
      const i = txt.indexOf('hands-free');
      const seg = txt.slice(i, i + 340);
      go('today');
      return seg;
    });
    t.ok('Settings says the microphone is shut during a set',
         /never during a set/.test(copy), copy);
    t.ok('and names the stuck-timer exception rather than glossing it',
         /stuck/.test(copy), copy);
  }

  /* A PAUSED REST IS NOT A REST THE WORD CAN ACT ON (v424).
     v423 shut the microphone outside the phases where the word means
     something. A PAUSED rest still counted as one of them — so a cloud
     recogniser streamed from a phone the athlete had put down, and the word
     half-worked: it advanced the phase and left the player paused, so the next
     set never started and the rest was spent. The rest screen kept promising
     it throughout.
     Every read below is taken on the TAP with no heartbeat in between —
     otherwise the 2-second guard tick supplies the answer and a fix that only
     works by heartbeat passes on a screen that is wrong for two seconds. */
  {
    const pz = await page.evaluate(() => {
      window.__mic3 = { live: 0, starts: 0, stops: 0, ours: false };
      class FakeRec3 {
        constructor() { this._on = false; window.__mic3.ours = true; }
        start() { if (this._on) throw new Error('InvalidStateError');
                  this._on = true; window.__mic3.live++; window.__mic3.starts++; if (this.onstart) this.onstart(); }
        stop() { if (!this._on) return; this._on = false; window.__mic3.live--; window.__mic3.stops++; }
      }
      const real = window.SpeechRecognition;
      window.SpeechRecognition = FakeRec3;
      STATE.settings.voiceCmd = true; _vrDown = ''; _vrNetFails = 0; save();
      const hint = () => ((document.getElementById('plVoiceHint') || {}).textContent || '');
      const r = {};

      go('today'); openPlayer(0);
      plClear(); plEnterRest(60, 'ex'); plGuardTick();
      r.restPhase = PLAYER.phase;
      r.builtOurs = window.__mic3.ours;
      r.hintExists = !!document.getElementById('plVoiceHint');

      /* FLOOR: a rest that is actually running */
      r.micRunningRest = window.__mic3.live;
      r.hintRunningRest = hint();
      const p0 = PLAYER.phase;
      voiceCmdHeard('continue');
      r.wordActsOnRunningRest = PLAYER.phase !== p0;

      /* back to a running rest, then pause it */
      plClear(); plEnterRest(60, 'ex'); plGuardTick();
      r.micBeforePause = window.__mic3.live;
      playerToggle();
      r.micOnPauseTap = window.__mic3.live;
      r.hintOnPauseTap = hint();
      r.pausedPhase = PLAYER.phase;
      r.pausedRunning = PLAYER.running;
      r.actionableWhilePaused = voiceCmdActionable();

      /* the word must do nothing at all here */
      const p1 = PLAYER.phase;
      voiceCmdHeard('continue');
      r.wordActedWhilePaused = PLAYER.phase !== p1;
      r.phaseAfterWord = PLAYER.phase;

      /* and the heartbeat must not re-open it either */
      plGuardTick(); plGuardTick();
      r.micPausedAfterBeats = window.__mic3.live;

      /* FLOOR: resuming brings both back, on the tap */
      playerToggle();
      r.micOnResumeTap = window.__mic3.live;
      r.hintOnResumeTap = hint();
      const p2 = PLAYER.phase;
      voiceCmdHeard('continue');
      r.wordActsAfterResume = PLAYER.phase !== p2;

      voiceCmdStop(); playerQuit();
      STATE.settings.voiceCmd = false; _vrDown = ''; _vrNetFails = 0; save();
      if (real) window.SpeechRecognition = real; else delete window.SpeechRecognition;
      return r;
    });

    /* GUARDS: without these every count below is zero for the wrong reason. */
    t.eq('guard: the rest phase was built', pz.restPhase, 'rest');
    t.ok('guard: the app opened the recogniser this block controls', pz.builtOurs, pz);
    t.ok('guard: the rest screen rendered the voice hint container', pz.hintExists, pz);
    t.ok('guard: the pause really did pause the player', pz.pausedRunning === false, pz);
    t.eq('guard: pausing did not leave the rest phase', pz.pausedPhase, 'rest');

    t.eq('FLOOR: a running rest opens the microphone', pz.micRunningRest, 1);
    t.ok('FLOOR: and promises the word on the glass',
         /Say/.test(pz.hintRunningRest), pz);
    t.ok('FLOOR: where the word really does start the next set',
         pz.wordActsOnRunningRest, pz);

    t.eq('guard: the second rest opened it again', pz.micBeforePause, 1);
    t.eq('pausing shuts the microphone on the tap, not a heartbeat later',
         pz.micOnPauseTap, 0);
    t.eq('and the promise goes with it rather than naming an ignored word',
         pz.hintOnPauseTap, '');
    t.ok('because a paused rest is not a phase the word can act in',
         pz.actionableWhilePaused === false, pz);
    t.ok('so the word does nothing at all there', !pz.wordActedWhilePaused, pz);
    t.eq('and leaves the rest where it was', pz.phaseAfterWord, 'rest');
    t.eq('the guard tick does not re-open it either', pz.micPausedAfterBeats, 0);

    t.eq('FLOOR: resuming re-opens it on the tap', pz.micOnResumeTap, 1);
    t.ok('FLOOR: and puts the promise back', /Say/.test(pz.hintOnResumeTap), pz);
    t.ok('FLOOR: and the word acts again', pz.wordActsAfterResume, pz);
  }

  /* ---------------------------------------------------------------------
     THE REST SCREEN PROMISED THE WORD OVER A CLOSED MICROPHONE (v481)

     Reported: "me just saying continue ... that is not happening."
     plEnterRest() renders voiceCmdHintHTML() -- "Say continue to start the
     next set" -- and never armed anything. The 2 s heartbeat was the only
     opener, so the promise was on the glass over a closed microphone at the
     start of every rest, and again after each silence. Measured before:

       microphone open when the rest screen appears     0
       closed after each Chrome silence-end             884, 1134, 882 ms

     And r.start()'s answer was never observed -- there was no onstart -- so a
     recogniser that never came up left _vrec non-null, voiceCmdSync() saw an
     armed microphone and never retried, and the line kept promising.

     EVERY CASE DRIVES A REAL REST through playerSetDone(). The block above
     hand-sets PLAYER.phase, which is the state the defect could not be seen
     in: a hand-set phase never runs plEnterRest() at all.                 */
  {
    const rq = await page.evaluate(async () => {
      const o = {}; const wait = ms => new Promise(r => setTimeout(r, ms));
      o.guardRealApi = typeof window.webkitSpeechRecognition === 'function';
      window.__recs = []; window.__beats = 0;
      class FakeRec {
        constructor(){ this._on = false; window.__recs.push(this); this._lastEnd = 0; }
        /* Chrome refuses a restart that comes too soon after its own end. */
        start(){ if (this._on) { const e = new Error('busy'); e.name = 'InvalidStateError'; throw e; }
          if (Date.now() - this._lastEnd < 250) { const e = new Error('soon'); e.name = 'InvalidStateError'; throw e; }
          this._on = true; if (this.onstart) this.onstart(); }
        stop(){ this._end(); } abort(){ this._end(); }
        _end(){ if (!this._on) return; this._on = false; this._lastEnd = Date.now(); if (this.onend) this.onend(); }
        failWith(c){ if (this.onerror) this.onerror({ error: c }); this._end(); }
        say(t){ if (!this._on) return false; if (this.onresult) this.onresult({ resultIndex: 0, results: [[{ transcript: t }]] }); return true; }
      }
      window.SpeechRecognition = FakeRec;
      const listening = () => window.__recs.filter(x => x._on).length;
      const last = () => window.__recs[window.__recs.length - 1];
      /* A recogniser that opens and never signals it started -- what a
         permission prompt left hanging, or a hardware conflict, looks like. */
      class DeadRec extends FakeRec { start(){ this._on = true; } }
      const toRest = async () => {
        openPlayer();
        for (let i = 0; i < 40 && PLAYER.phase !== 'work'; i++) { plTickReady(); await wait(3); }
        playerSetDone(); await wait(40);
      };

      STATE.settings.voiceCmd = true; save();
      _vrDown = ''; _vrNetFails = 0; _vrEverLive = false;

      /* 1. ARMED ON THE PHASE CHANGE, with NO heartbeat anywhere near it. */
      await toRest();
      o.phase = PLAYER.phase;
      o.micOnRestOpen = listening();
      o.beatsSoFar = window.__beats;
      o.hintOnRestOpen = (document.getElementById('plVoiceHint') || {}).innerHTML || '';
      o.everLiveNow = _vrEverLive;

      if (!window.__recs.length) {          // guard before the first dereference
        STATE.settings.voiceCmd = false; save(); voiceCmdStop(); playerQuit();
        delete window.SpeechRecognition; o.bailed = true; return o;
      }

      /* 2. A SILENCE COMES BACK ON ITS OWN, WITH THE HEARTBEAT STOPPED. The
            first version of this counted a window.__beats nothing ever
            incremented while the app's own 2 s guard interval ran underneath
            it -- a self-comparing guard, and the mutant that removed the
            prompt retry walked straight through because plGuardTick() brought
            it back inside the wait. Kill the guard, and only the restart path
            itself can answer. */
      const guardWas = _plGuard; try { clearInterval(_plGuard); } catch (e) {}
      _plGuard = null;
      o.guardStopped = !_plGuard;
      const t0 = Date.now();
      last()._end();
      o.closedRightAfterEnd = listening();
      for (let i = 0; i < 120; i++) { if (listening() > 0) break; await wait(10); }
      o.backWithoutBeat = listening();
      o.backInMs = Date.now() - t0;
      _plGuard = guardWas;

      const before = PLAYER.phase; last().say('continue'); await wait(50);
      o.wordWorked = PLAYER.phase !== before;

      /* 3. A MICROPHONE THAT NEVER STARTS MUST NOT BE PROMISED. */
      playerQuit(); voiceCmdStop(); _vrDown = ''; _vrNetFails = 0; _vrEverLive = false;
      window.SpeechRecognition = DeadRec;
      await toRest();
      o.hintBeforeAnyStart = voiceCmdHintInner();

      /* 3b. A NEW SESSION DOES NOT INHERIT THE LAST ONE'S SUCCESS. everLive is
            cleared when nothing is open, so a phone whose microphone has since
            broken is not promised the word on the strength of a rest that
            worked an hour ago. */
      window.SpeechRecognition = FakeRec;
      playerQuit(); voiceCmdStop(); _vrDown = ''; _vrNetFails = 0;
      await toRest();                       // a healthy rest sets everLive
      o.everLiveAfterGoodRest = _vrEverLive;
      playerQuit(); voiceCmdStop(); voiceCmdSync();   // nothing open -> cleared
      o.everLiveAfterSession = _vrEverLive;
      window.SpeechRecognition = DeadRec;
      await toRest();
      o.hintOnNextSession = voiceCmdHintInner();
      window.SpeechRecognition = FakeRec;

      /* 4. audio-capture: no branch at all before, so onend restarted it for
            ever with nothing on screen. */
      window.SpeechRecognition = FakeRec;
      playerQuit(); voiceCmdStop(); _vrDown = ''; _vrNetFails = 0; _vrEverLive = false;
      await toRest();
      let opened = 0;
      for (let i = 0; i < 12; i++) {
        if (!last() || !last()._on) voiceCmdSync();
        if (last() && last()._on) { opened++; last().failWith('audio-capture'); }
        await wait(20);
      }
      o.micOpensBeforeStandDown = opened;
      o.micDown = _vrDown;
      o.micNote = voiceCmdNote();
      o.micHint = voiceCmdHintInner();
      o.switchStillOn = voiceCmdOn();

      /* 5. FLOOR: a refused microphone still turns the switch OFF. */
      _vrDown = ''; _vrNetFails = 0;
      playerQuit(); voiceCmdStop(); STATE.settings.voiceCmd = true; save();
      await toRest();
      if (last() && last()._on) last().failWith('not-allowed');
      await wait(20);
      o.switchOffAfterRefusal = voiceCmdOn();

      STATE.settings.voiceCmd = false; save(); voiceCmdStop(); playerQuit();
      _vrDown = ''; _vrNetFails = 0; _vrEverLive = false;
      delete window.SpeechRecognition;
      return o;
    });

    t.ok('guard: this browser really has a speech API, so the app is building ours',
      rq.guardRealApi, JSON.stringify(rq));
    t.ok('guard: the block reached a real rest', rq.phase === 'rest' && !rq.bailed, JSON.stringify(rq));

    t.eq('the rest screen opens the microphone as it appears', rq.micOnRestOpen, 1, JSON.stringify(rq));
    t.eq('guard: and no heartbeat had run — the rest itself is what armed it',
      rq.beatsSoFar, 0, JSON.stringify(rq));
    t.ok('so the promise on that screen has a listening microphone behind it',
      /Say/.test(rq.hintOnRestOpen), JSON.stringify(rq));

    t.ok('guard: the guard tick really was stopped for this case', rq.guardStopped, JSON.stringify(rq));
    t.eq('guard: a Chrome silence really does close it', rq.closedRightAfterEnd, 0, JSON.stringify(rq));
    t.eq('and it comes back on its own, with no heartbeat to do it',
      rq.backWithoutBeat, 1, JSON.stringify(rq));
    t.ok('the word still acts on a real rest', rq.wordWorked, JSON.stringify(rq));

    t.ok('a microphone that never started is NOT promised',
      !/Say .continue./.test(rq.hintBeforeAnyStart || ''), JSON.stringify(rq));
    t.ok('and the line says what it is doing instead',
      /Starting the microphone/.test(rq.hintBeforeAnyStart || ''), JSON.stringify(rq));

    t.ok('guard: a healthy rest really does record that it started',
      rq.everLiveAfterGoodRest, JSON.stringify(rq));
    t.ok('and the session ending clears it', !rq.everLiveAfterSession, JSON.stringify(rq));
    t.ok('so the next session does not promise the word on the last one\u2019s success',
      !/Say .continue./.test(rq.hintOnNextSession || ''), JSON.stringify(rq));

    t.ok('a microphone that cannot be opened stops retrying',
      rq.micOpensBeforeStandDown > 0 && rq.micOpensBeforeStandDown <= 4, JSON.stringify(rq));
    t.eq('and says so', rq.micDown, 'mic', JSON.stringify(rq));
    t.ok('naming the one thing the athlete can do about it',
      /another app may be using it/i.test(rq.micNote || ''), JSON.stringify(rq));
    t.ok('and the rest screen carries that instead of the promise',
      !/Say .continue./.test(rq.micHint || '') && /microphone/i.test(rq.micHint || ''), JSON.stringify(rq));
    t.ok('FLOOR: a microphone that is merely busy does not turn the switch off',
      rq.switchStillOn, JSON.stringify(rq));
    t.ok('FLOOR: but a REFUSED one still does', !rq.switchOffAfterRefusal, JSON.stringify(rq));
  }


  /* ---- v483: a voice for ONE coach ---------------------------------------
     The Settings picker is all-or-nothing by design — one voice for all 38 —
     so an athlete who installs a voice pack and wants THAT coach on it had no
     way to say so, and the round-robin decides by list order rather than by
     anything they can steer.
     Everything is driven through the real route: speechSynthesis.getVoices()
     reports the pack, so loadCoachVoices() picks it up exactly as a phone
     would, and the voice is read back off the utterance _deviceSpeak() builds
     rather than off the helper. Calling the helper is not driving the route. */
  {
    const r = await page.evaluate(() => {
      const o = {}, realGet = speechSynthesis.getVoices.bind(speechSynthesis),
            realName = STATE.settings.voiceName;
      const fakes = ['Daniel', 'Alex', 'Fred', 'Samantha', 'Karen']
        .map(n => ({ name: n, lang: 'en-US' }));
      speechSynthesis.getVoices = () => fakes;
      loadCoachVoices();
      /* GUARD: without more than one usable voice every reading below is two
         names that happen to agree. */
      o.poolN = englishVoicePool().length;

      const wrestle = COACHES.find(c => c.id === 'wrestle');
      const drill = COACHES.find(c => c.id === 'drill');
      o.autoWrestle = (COACH_VOICE_MAP['wrestle'] || {}).name || null;
      const target = fakes.map(v => v.name).find(n => n !== o.autoWrestle);
      o.target = target;
      o.targetDiffers = target !== o.autoWrestle;

      const RealU = window.SpeechSynthesisUtterance;
      const realSpeak = speechSynthesis.speak.bind(speechSynthesis);
      let last = null;
      window.SpeechSynthesisUtterance = function (txt) { this.text = txt; };
      speechSynthesis.speak = u => { last = u.voice ? u.voice.name : null; };
      const voiceOf = p => { last = null; _deviceSpeak('x', p); return last; };

      delete STATE.settings.coachVoices; STATE.settings.voiceName = '';
      o.beforeWrestle = voiceOf(wrestle);

      o.setOk = setCoachOwnVoice('wrestle', target);
      o.afterWrestle = voiceOf(wrestle);
      o.afterDrill = voiceOf(drill);              // FLOOR: nobody else moves

      /* The per-coach pick is the MOST SPECIFIC choice, so it outranks the
         global one — and everybody else still obeys the global one. */
      STATE.settings.voiceName = (target === 'Karen') ? 'Samantha' : 'Karen';
      o.globalName = STATE.settings.voiceName;
      o.wrestleUnderGlobal = voiceOf(wrestle);
      o.drillUnderGlobal = voiceOf(drill);
      STATE.settings.voiceName = '';

      /* A name this phone no longer offers reads as NO choice, not a broken
         one — voice packs get uninstalled, and a stale name must not mute a
         coach. */
      STATE.settings.coachVoices = { wrestle: 'A Voice This Phone Does Not Have' };
      o.staleWrestle = voiceOf(wrestle);

      /* MEMBERSHIP on both halves, at the writer. */
      delete STATE.settings.coachVoices;
      o.junkCoachRefused = setCoachOwnVoice('not-a-coach', target) === false
        && STATE.settings.coachVoices === undefined;
      o.junkVoiceRefused = setCoachOwnVoice('wrestle', 'nope') === false
        && STATE.settings.coachVoices === undefined;

      /* ABSENT STAYS ABSENT: set then clear leaves no key, so an athlete who
         has never used this gains nothing that travels in a backup. */
      setCoachOwnVoice('wrestle', target);
      setCoachOwnVoice('wrestle', '');
      o.absentAfterClear = STATE.settings.coachVoices === undefined;

      /* Two guards mean two checks: the boot repair, with no writer in front
         of it, because importData() writes STATE directly. */
      STATE.settings.coachVoices = { wrestle: target, 'not-a-coach': target, drill: 42 };
      normalizeState();
      o.repaired = JSON.stringify(STATE.settings.coachVoices || null);
      STATE.settings.coachVoices = 'a string';
      normalizeState();
      o.stringGone = STATE.settings.coachVoices === undefined;
      STATE.settings.coachVoices = ['Alex'];
      normalizeState();
      o.arrayGone = STATE.settings.coachVoices === undefined;
      /* A name this phone does not currently offer SURVIVES the boot: the
         voice list is often not loaded yet at boot, and dropping it there
         would erase the athlete's choice on a launch that simply started
         cold. The stale case is answered at the READ site instead. */
      STATE.settings.coachVoices = { wrestle: 'Some Uninstalled Voice' };
      normalizeState();
      o.staleSurvivesBoot = (STATE.settings.coachVoices || {}).wrestle === 'Some Uninstalled Voice';

      window.SpeechSynthesisUtterance = RealU; speechSynthesis.speak = realSpeak;

      /* The sheet, opened the way the athlete opens it. */
      delete STATE.settings.coachVoices;
      setCoachOwnVoice('wrestle', target);
      openCoachVoices();
      const sh = document.querySelector('#sheet');
      o.rows = sh.querySelectorAll('[data-cv]').length;
      o.coaches = COACHES.length;
      const sel = sh.querySelector('[data-cv="wrestle"] select');
      o.sheetShowsPick = sel ? sel.value : null;
      o.optionCount = sel ? sel.options.length : 0;
      /* "Auto" on its own says nothing about what you are choosing between. */
      o.autoNamed = /Auto · /.test(sh.innerHTML);
      o.labelled = !!sh.querySelector('[data-cv="wrestle"] select[aria-label]');

      /* Drive the CONTROL, not the setter. */
      sel.value = 'Fred';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      o.afterTap = (sh.querySelector('[data-cv="wrestle"] select') || {}).value;
      o.storedAfterTap = (STATE.settings.coachVoices || {}).wrestle;

      const btn = [...sh.querySelectorAll('button')].find(b => /back on Auto/.test(b.textContent));
      o.resetBtn = !!btn; if (btn) btn.click();
      o.clearedAll = STATE.settings.coachVoices === undefined;
      o.resetGoneWhenNoneSet = !/back on Auto/.test(sh.innerHTML);
      closeSheet();

      /* FLOOR: a phone that has not handed over its list says so rather than
         rendering 38 rows with nothing in them. */
      speechSynthesis.getVoices = () => [];
      loadCoachVoices();
      o.noListNote = /has not handed over its voice list/.test(coachVoiceSheetHTML());

      /* And Settings carries the way in. */
      speechSynthesis.getVoices = realGet; loadCoachVoices();
      STATE.settings.voiceName = realName;
      go('guide');
      o.settingsOffersIt = /openCoachVoices\(\)/.test(document.querySelector('#v-guide').innerHTML);
      return o;
    });
    t.ok('GUARD: this browser reports more than one English voice',
      r.poolN >= 2, JSON.stringify(r));
    t.ok('GUARD: the chosen voice is not the one Auto already gave that coach',
      r.targetDiffers, JSON.stringify(r));
    t.ok('a coach can be given its own device voice', r.setOk, JSON.stringify(r));
    t.eq('and speaks in it, through the real speak path', r.afterWrestle, r.target);
    t.ok('FLOOR: every other coach keeps the voice Auto gave it',
      r.afterDrill === r.autoWrestle && r.beforeWrestle === r.autoWrestle, JSON.stringify(r));
    t.eq('the per-coach pick outranks the single voice in Settings',
      r.wrestleUnderGlobal, r.target);
    t.ok('FLOOR: and every other coach still obeys that single voice',
      r.drillUnderGlobal === r.globalName, JSON.stringify(r));
    t.eq('a voice this phone no longer offers reads as Auto, not as silence',
      r.staleWrestle, r.autoWrestle);
    t.ok('the writer refuses an id that is not a coach', r.junkCoachRefused, JSON.stringify(r));
    t.ok('and a name that is not a voice on this phone', r.junkVoiceRefused, JSON.stringify(r));
    t.ok('absent stays absent — set then cleared leaves no key at all',
      r.absentAfterClear, JSON.stringify(r));
    t.eq('the boot repair keeps the real pick and drops the junk key and value',
      r.repaired, JSON.stringify({ wrestle: r.target }));
    t.ok('a string where the map belongs is dropped', r.stringGone, JSON.stringify(r));
    t.ok('and an array, which is also an object', r.arrayGone, JSON.stringify(r));
    t.ok('FLOOR: a name this phone has not loaded yet survives the boot',
      r.staleSurvivesBoot, JSON.stringify(r));
    t.eq('the sheet carries one row per coach', r.rows, r.coaches);
    t.ok('with more than one coach on it', r.coaches > 1, JSON.stringify(r));
    t.eq('the row shows the voice that coach is set to', r.sheetShowsPick, r.target);
    t.ok('and offers Auto plus every voice this phone has',
      r.optionCount === r.poolN + 1, JSON.stringify(r));
    t.ok('Auto names the voice it would use, rather than saying only "Auto"',
      r.autoNamed, JSON.stringify(r));
    t.ok('every row select carries an accessible name', r.labelled, JSON.stringify(r));
    t.ok('tapping the control stores the choice and repaints in place',
      r.afterTap === 'Fred' && r.storedAfterTap === 'Fred', JSON.stringify(r));
    t.ok('one tap puts every coach back on Auto', r.resetBtn && r.clearedAll, JSON.stringify(r));
    t.ok('and that offer is gone once nothing is set', r.resetGoneWhenNoneSet, JSON.stringify(r));
    t.ok('FLOOR: a phone with no voice list says so rather than showing empty rows',
      r.noListNote, JSON.stringify(r));
    t.ok('Settings carries the way in', r.settingsOffersIt, JSON.stringify(r));
  }

  /* ---- v483: a premium voice that has stopped working says so -------------
     coachSpeak() falls back to the device voice and says nothing, so the
     athlete hears a different voice with the switch still reading On — a
     promise in UI text with no code behind it. */
  {
    const r = await page.evaluate(() => {
      const o = {}, realOn = STATE.settings.neuralOn, realKey = STATE.settings.azureKey;
      STATE.settings.neuralOn = true; _neuralFails = 0; _neuralFailMsg = '';
      o.strikes = NEURAL_FAIL_STRIKES;
      o.quietAtZero = neuralDownHTML() === '';
      _neuralFails = NEURAL_FAIL_STRIKES - 1;
      o.quietUnderStrikes = neuralDownHTML() === '';
      _neuralFails = NEURAL_FAIL_STRIKES;
      const gen = neuralDownHTML();
      o.firesAtStrikes = /not answering/.test(gen);
      o.namesTheCount = new RegExp(NEURAL_FAIL_STRIKES + ' tries failed').test(gen);
      o.offersSwitch = /useDeviceVoices\(\)/.test(gen);
      o.genericCause = /expired trial key/.test(gen);
      _neuralFailMsg = 'Quota exceeded for this month (403)';
      const q = neuralDownHTML();
      o.quotaNamed = /free monthly allowance/.test(q) && /do not have to take it/.test(q);
      STATE.settings.neuralOn = false;
      o.silentWhenOff = neuralDownHTML() === '';
      STATE.settings.neuralOn = true; _neuralFails = 9;
      useDeviceVoices();
      o.turnedOff = STATE.settings.neuralOn === false;
      o.countCleared = _neuralFails === 0;
      o.silentAfter = neuralDownHTML() === '';
      o.neuralOffMeansDevice = neuralReady() === false;
      STATE.settings.neuralOn = true; STATE.settings.azureKey = 'x'.repeat(32);
      _neuralFails = NEURAL_FAIL_STRIKES;
      go('guide');
      o.onSettings = /not answering/.test(document.querySelector('#v-guide').innerHTML);
      _neuralFails = 0; _neuralFailMsg = '';
      STATE.settings.neuralOn = realOn; STATE.settings.azureKey = realKey;
      return o;
    });
    /* v487: A SUCCESS RESETS THE STRIKES. Three transient failures early in
       a session, then every line since playing, still showed "not answering"
       on Settings for the rest of the day. Driven through neuralSpeak() with
       the synthesiser stubbed to succeed.

       ITS OWN evaluate, and NOTHING ELSE may touch _neuralFails between the
       arm and the read. The first version armed this inside the block above,
       whose later lines set _neuralFails to 9, then to 0 through
       useDeviceVoices(), then to 0 again in its own teardown — all
       synchronously, BEFORE the stubbed synth's microtask resolved. So the
       count read 0 whether or not the app reset it, and the mutant that
       deleted the reset walked straight through. The neighbour was my own
       teardown supplying the answer. The reset is read here, the payload
       (Settings stays silent) beside it, and the guard pins that the count
       really was at the strike line before the success. */
    const reset = await page.evaluate(async () => {
      const real = { synth: _sdkSynthesize, play: _neuralPlay, on: STATE.settings.neuralOn,
        key: STATE.settings.azureKey, region: STATE.settings.azureRegion };
      const o = {};
      try {
        STATE.settings.neuralOn = true; STATE.settings.azureKey = 'x'.repeat(32);
        STATE.settings.azureRegion = STATE.settings.azureRegion || 'eastus';
        _neuralFails = NEURAL_FAIL_STRIKES; _neuralFailMsg = 'network';
        o.guardAvailable = neuralAvailable();
        o.guardDownBefore = neuralDownHTML() !== '';
        o.guardFailsBefore = _neuralFails; o.strikes = NEURAL_FAIL_STRIKES;
        await new Promise(res => {
          _sdkSynthesize = () => Promise.resolve(new ArrayBuffer(8));
          _neuralPlay = () => { res(); };
          o.handled = neuralSpeak('v487 strike reset ' + Date.now(), COACHES[0], () => {});
          if (!o.handled) res();
          setTimeout(res, 1500);
        });
        o.fails = _neuralFails; o.msg = _neuralFailMsg;
        o.downAfter = neuralDownHTML() !== '';
      } finally {
        _sdkSynthesize = real.synth; _neuralPlay = real.play;
        _neuralFails = 0; _neuralFailMsg = '';
        STATE.settings.neuralOn = real.on; STATE.settings.azureKey = real.key; STATE.settings.azureRegion = real.region;
      }
      return o;
    });
    t.ok('GUARD: the strikes really were at the line before the success',
      reset.guardFailsBefore === reset.strikes && reset.guardDownBefore,
      JSON.stringify(reset));
    t.ok('a working premium voice says nothing at all', r.quietAtZero, JSON.stringify(r));
    t.ok('GUARD: the neural path was available for the strike-reset case', reset.guardAvailable && reset.handled,
      JSON.stringify({ guardAvailable: reset.guardAvailable, handled: reset.handled }));
    t.eq('a successful line RESETS the strike count (v487)', reset.fails, 0);
    t.eq('and clears the remembered failure', reset.msg, '');
    t.ok('and Settings stops saying the premium voice is not answering', reset.downAfter === false, JSON.stringify(reset));
    t.ok('and one or two failures still say nothing — a note that always fires is noise',
      r.quietUnderStrikes, JSON.stringify(r));
    t.ok('it speaks up once the failures reach the strike count',
      r.firesAtStrikes, JSON.stringify(r));
    t.ok('naming how many tries failed', r.namesTheCount, JSON.stringify(r));
    t.ok('and it names the free monthly allowance when that is what the error says',
      r.quotaNamed, JSON.stringify(r));
    t.ok('otherwise it names the causes it cannot tell apart',
      r.genericCause, JSON.stringify(r));
    t.ok('with one tap to the built-in voices', r.offersSwitch, JSON.stringify(r));
    t.ok('that tap turns the premium voices off', r.turnedOff, JSON.stringify(r));
    t.ok('and the coaches then use this phone own voices',
      r.neuralOffMeansDevice, JSON.stringify(r));
    t.ok('the note goes once it is off', r.countCleared && r.silentAfter, JSON.stringify(r));
    t.ok('FLOOR: with the switch off it never fires, however many tries failed',
      r.silentWhenOff, JSON.stringify(r));
    t.ok('and it reaches the Settings tab, not only its own helper',
      r.onSettings, JSON.stringify(r));
  }

  /* A REAL FAILURE, DRIVEN. Every assertion above sets the counter by hand, so
     a neuralSpeak() that never counted a failure would walk straight through
     all of them — calling the helper is not driving the route, in my own
     checks. This one rejects the synth the way an exhausted quota does and
     reads the counter, the message and the fallback back. */
  {
    const r = await page.evaluate(async () => {
      const o = {}, realOn = STATE.settings.neuralOn, realKey = STATE.settings.azureKey,
            realRegion = STATE.settings.azureRegion, realSyn = _sdkSynthesize;
      STATE.settings.neuralOn = true;
      STATE.settings.azureKey = 'x'.repeat(32);
      STATE.settings.azureRegion = 'eastus';
      _neuralFails = 0; _neuralFailMsg = '';
      o.available = neuralAvailable();          // GUARD: the route is reachable
      _sdkSynthesize = () => Promise.reject(new Error('Quota exceeded (403)'));
      let fellBack = 0;
      o.tookIt = neuralSpeak('one', COACHES[0], () => { fellBack++; });
      await new Promise(z => setTimeout(z, 40));
      o.countedOne = _neuralFails;
      o.fellBackOnce = fellBack;
      o.msgKept = /403/.test(_neuralFailMsg || '');
      o.quietAtOne = neuralDownHTML() === '';
      neuralSpeak('two', COACHES[0], () => { fellBack++; });
      await new Promise(z => setTimeout(z, 40));
      neuralSpeak('three', COACHES[0], () => { fellBack++; });
      await new Promise(z => setTimeout(z, 40));
      o.countedThree = _neuralFails;
      o.speaksUp = /not answering/.test(neuralDownHTML());
      o.readsTheQuota = /free monthly allowance/.test(neuralDownHTML());
      _sdkSynthesize = realSyn; _neuralFails = 0; _neuralFailMsg = '';
      STATE.settings.neuralOn = realOn; STATE.settings.azureKey = realKey;
      STATE.settings.azureRegion = realRegion;
      return o;
    });
    t.ok('GUARD: the premium path is actually reachable in this case',
      r.available && r.tookIt, JSON.stringify(r));
    t.eq('a real failure is counted', r.countedOne, 1);
    t.ok('and the coach still speaks, in this phone own voice',
      r.fellBackOnce === 1, JSON.stringify(r));
    t.ok('the error is kept, so the note can name the cause', r.msgKept, JSON.stringify(r));
    t.ok('one failure still says nothing', r.quietAtOne, JSON.stringify(r));
    t.eq('three real failures reach the strike count', r.countedThree, 3);
    t.ok('and the note then speaks up', r.speaksUp, JSON.stringify(r));
    t.ok('naming the monthly allowance, read off the real error',
      r.readsTheQuota, JSON.stringify(r));
  }

  /* ---- ONE SHUFFLE BAG, and the phrase picker now asks it ---------------
     Reported: "the voice is repeating the same phrases for every exercise over
     and over again". motivateLine() drew at RANDOM with only a "not the same as
     last time" guard, which is not the same as dealing every line once.
     Measured on the real app before the fix, one session of 39 during-lines
     from a pool of 14: the most-heard line landed 5-8 times across five runs
     and a line went unheard on two of them. A bag caps it at ceil(39/14)=3. */
  {
    const r = await page.evaluate(() => {
      const out = {};
      const p = COACHES.find(c => c.id === 'drill');
      out.pool = p ? p.during.length : 0;
      out.draws = 39;
      STATE.settings.coach = 'drill';
      const seen = {};
      for (let i = 0; i < 39; i++) { const l = motivateLine('during', true); seen[l] = (seen[l] || 0) + 1; }
      const c = Object.values(seen);
      out.distinct = c.length; out.mostHeard = Math.max.apply(null, c);
      /* THE KEY CARRIES THE PERSONA. Keyed by kind alone, a bag dealt for one
         coach is dealt on against the next coach's pool the moment Auto
         rotates — so the second coach never gets a full pass of its own.
         THE TWO POOLS MUST BE THE SAME SIZE. _bagNext() rebuilds whenever the
         count changes, so a second coach with a different pool gets a fresh bag
         either way and the mutant is invisible — which is how it escaped the
         first version of this check. `relentless` is the one other coach whose
         `during` pool is also 14. */
      const q = COACHES.find(x => x.id === 'relentless');
      out.otherPool = q ? q.during.length : -1;
      let full = 0;
      for (let trial = 0; trial < 20; trial++) {
        Object.keys(_bags).forEach(k => { if (k.indexOf('line|') === 0) delete _bags[k]; });
        STATE.settings.coach = 'drill';
        for (let i = 0; i < 7; i++) motivateLine('during', true);   // part-spend one bag
        STATE.settings.coach = q.id;
        const s2 = {};
        for (let i = 0; i < q.during.length; i++) s2[motivateLine('during', true)] = 1;
        if (Object.keys(s2).length === q.during.length) full++;
      }
      out.fullPasses = full;
      /* The seam guard, exercised DIRECTLY. Over one boundary a missing guard
         collides only 1 time in n, so a single seam cannot tell them apart.
         With a pool of two, every adjacent pair that matches IS a seam repeat:
         the guard makes that exactly 0, and its absence makes it about half. */
      delete _bags['probe|seam'];
      const seq = []; for (let i = 0; i < 40; i++) seq.push(_bagNext('probe|seam', 2));
      let rep = 0; for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) rep++;
      out.seamRepeats = rep; out.seamDraws = seq.length;
      /* FLOOR: the coach rotation this bag was hoisted out of is unchanged.
         EACH BLOCK BUILDS THE STATE IT ASSERTS ON — earlier blocks in this file
         have already drawn coaches, so a bag part-way through spans two passes
         and reads as 31 distinct on correct code. Start from a fresh bag. */
      STATE.settings.coach = 'auto';
      delete _bags['coach'];
      out.bagWasReset = !_bags['coach'];
      const a = []; for (let i = 0; i < 38; i++) a.push(rollAutoPersona());
      const b = []; for (let i = 0; i < 38; i++) b.push(rollAutoPersona());
      out.rot1 = new Set(a).size; out.rot2 = new Set(b).size;
      out.seamOk = a[37] !== b[0];
      /* The helper is consulted from two narrow branches, so its own contract
         is pinned rather than only its effects. */
      out.bagOne = _bagNext('probe|one', 1);
      out.bagOneAgain = _bagNext('probe|one', 1);
      out.bagNone = _bagNext('probe|none', 0);
      return out;
    });
    t.ok('GUARD: a session really draws more lines than the pool holds',
      r.pool > 1 && r.draws > r.pool, JSON.stringify(r));
    t.eq('every line in the pool is heard once a session', r.distinct, r.pool);
    t.ok('and no line is heard more than its fair share',
      r.mostHeard <= Math.ceil(r.draws / r.pool), JSON.stringify(r));
    t.ok('GUARD: the second coach\'s pool is the same size, so a shared bag is reused rather than rebuilt',
      r.otherPool === r.pool, JSON.stringify(r));
    t.eq('a second coach gets a full pass of its OWN pool, every time',
      r.fullPasses, 20);
    t.ok('GUARD: the seam probe really ran 40 draws', r.seamDraws === 40, JSON.stringify(r));
    t.eq('and no bag opens on the item the last one closed with',
      r.seamRepeats, 0);
    t.ok('GUARD: the rotation bag started empty', r.bagWasReset, JSON.stringify(r));
    t.eq('FLOOR: the coach rotation still deals all 38', r.rot1, 38);
    t.eq('FLOOR: and all 38 again in the next bag', r.rot2, 38);
    t.ok('FLOOR: with no repeat across the seam', r.seamOk, JSON.stringify(r));
    t.eq('a pool of one deals that one, every time', r.bagOne, 0);
    t.eq('and again rather than running dry', r.bagOneAgain, 0);
    t.eq('an empty pool asks for nothing', r.bagNone, -1);
  }

  /* ---- the picker listed bare names, so a new voice pack was unfindable --
     "I did download a package with a male voice but I do not know how you seek
     that voice." assignCoachVoices() already sorts the phone's voices into a
     male set and a female set by reading the NAME; the picker printed the name
     alone. It asks _FEMALE_RE, the same predicate the assignment asks. */
  {
    const r = await page.evaluate(() => {
      const out = {};
      const fake = [
        { name: 'Karen', lang: 'en-AU' },
        { name: 'Daniel', lang: 'en-GB' },
        { name: 'Nimbus Pro', lang: 'en-US' }
      ];
      /* Fake the SOURCE, not the cache: openCoachVoices() re-reads getVoices()
         through primeVoice(), which would overwrite an assigned COACH_VOICES. */
      speechSynthesis.getVoices = () => fake;
      loadCoachVoices();
      out.poolN = englishVoicePool().length;
      const html = voiceOptionsHTML();
      out.female = /Karen[^<]*·[^<]*female/.test(html);
      out.male = /Daniel[^<]*·[^<]*male/.test(html);
      /* AND A NAME THAT SAYS NOTHING IS LABELLED NOTHING. This used to read
         "male", which is the v486 defect: most Android voice names carry no
         clue at all and the great majority of them are female. */
      out.unknownUnlabelled = /Nimbus Pro · en-US<\/option>/.test(html);
      out.unknownNotMale = !/Nimbus Pro[^<]*male/.test(html);
      out.noBareSeparator = !/Nimbus Pro[^<]*· *<\/option>/.test(html);
      openCoachVoices();
      const sheet = document.getElementById('sheet');
      const txt = sheet ? sheet.innerHTML : '';
      out.rows = (txt.match(/data-cv=/g) || []).length;
      out.perCoachLabelled = /Daniel · male/.test(txt);
      /* and the sheet must leave an unreadable name unlabelled as well — the
         global picker being right says nothing about its twin. */
      out.perCoachUnknownBare = /<option value="Nimbus Pro"[^>]*>Nimbus Pro<\/option>/.test(txt);
      out.perCoachUnknownNotMale = !/Nimbus Pro[^<]*male/.test(txt);
      closeSheet();
      const g = document.getElementById('v-guide');
      out.saysListenToIt = /Pick one and listen/i.test(g ? g.innerHTML : '');
      out.saysNotGuessed = /left off rather than guessed/i.test(g ? g.innerHTML : '');
      out.saysHowToRefresh = /Voice check/.test(g ? g.innerHTML : '');
      return out;
    });
    t.ok('GUARD: the phone handed over a voice list to label', r.poolN === 3, JSON.stringify(r));
    t.ok('a name the app knows as female says so', r.female, JSON.stringify(r));
    t.ok('a name it treats as male says so', r.male, JSON.stringify(r));
    t.ok('and a name that says nothing carries NO label rather than "male"',
      r.unknownUnlabelled && r.unknownNotMale, JSON.stringify(r));
    t.ok('with no bare separator left where the answer would have gone',
      r.noBareSeparator, JSON.stringify(r));
    t.eq('GUARD: the per-coach sheet rendered a row for every coach', r.rows, 38);
    t.ok('the per-coach rows carry the same label', r.perCoachLabelled, JSON.stringify(r));
    t.ok('and the per-coach rows leave an unreadable name unlabelled too',
      r.perCoachUnknownBare && r.perCoachUnknownNotMale, JSON.stringify(r));
    t.ok('FLOOR: the copy names the reliable route — pick one and listen',
      r.saysListenToIt, JSON.stringify(r));
    t.ok('FLOOR: and says an unreadable name is left unlabelled, not guessed',
      r.saysNotGuessed, JSON.stringify(r));
    t.ok('FLOOR: and points at the refresh for a pack added since the page opened',
      r.saysHowToRefresh, JSON.stringify(r));
  }

  /* ---- "even after selecting male, the default voice is still the female" ---
     The PICK was never the problem: coachVoiceFor() returns exactly the voice
     chosen, and this block pins that as its floor. What lied was the LABEL.
     voiceSexLabel() answered "male" for every name it did not recognise, and
     most Android voice names carry nothing to recognise — "Google US English",
     "English (United States)", "en-us-x-tpf-local" are all FEMALE voices whose
     names say so nowhere. Measured over ten realistic Android names, SEVEN were
     wrong and every one of the seven was a female voice labelled male.
     There is no sex field in the Web Speech API, so the honest answer is three
     ways: female, male, or nothing at all. */
  {
    const r = await page.evaluate(() => {
      const out = {};
      /* Names a real Android phone hands over, and what each voice really is. */
      const cases = [
        ['Google US English', 'female'],
        ['English (United States)', 'female'],
        ['en-us-x-tpf-local', 'female'],
        ['Samsung TTS English (US)', 'female'],
        ['Google UK English Female', 'female'],
        ['Google UK English Male', 'male'],
        ['Microsoft David - English', 'male'],
        ['Daniel', 'male'],
        ['Karen', 'female']
      ];
      /* GUARD: the OLD rule really did answer male for the unreadable ones, or
         every assertion below passes on a rule that was never wrong. */
      const oldRule = n => _FEMALE_RE.test(n) ? 'female' : 'male';
      out.oldWrong = cases.filter(([n, truth]) => oldRule(n) !== truth).length;
      out.oldWrongAllFemale = cases
        .filter(([n, truth]) => oldRule(n) !== truth)
        .every(([, truth]) => truth === 'female');

      /* Never wrong now: it says female, male, or nothing. */
      out.nowWrong = cases.filter(([n, truth]) => {
        const l = voiceSexLabel({ name: n, lang: 'en-US' });
        return l && l !== truth;
      }).length;
      /* FLOOR: and it has not simply stopped answering. */
      out.stillAnswers = cases.filter(([n]) =>
        voiceSexLabel({ name: n, lang: 'en-US' })).length;
      out.readsFemale = voiceSexLabel({ name: 'Karen' }) === 'female';
      out.readsMale = voiceSexLabel({ name: 'Daniel' }) === 'male';
      /* "female" contains "male": a loose male test would call every female
         voice male, which is the reported bug by another route. */
      out.femaleIsNotMale = voiceSexLabel({ name: 'Google UK English Female' }) === 'female';
      /* The male test's OWN contract, asked directly. voiceSexLabel() checks
         female first, so a loose /male/ cannot change today's answer — the
         ORDER is the only thing protecting it, and a guard consulted in one
         narrow branch still has to mean what it is named. "female" ends in
         "male". */
      out.maleReSkipsFemale = !_MALE_RE.test('Google UK English Female')
        && !_MALE_RE.test('female') && !_MALE_RE.test('en-us-female-2');
      out.maleReReadsMale = _MALE_RE.test('Google UK English Male')
        && _MALE_RE.test('Daniel');
      out.suffixBlank = voiceSexSuffix({ name: 'en-us-x-tpf-local' }) === '';
      out.suffixNamed = voiceSexSuffix({ name: 'Daniel' }) === ' · male';
      /* v487: a short male name INSIDE a female one. "Erica" carries "eric",
         "Winifred" carries "fred", "Marketa" carries "mark", and none of them
         is on the female list — so the male test, asked second, still read
         them as male. A wrong label is worse than none. */
      const insideFemale = ['Erica', 'Frederica', 'Winifred', 'Marketa', 'Antonia', 'English (America)'];
      out.noneInsideRead = insideFemale.filter(n => voiceSexLabel({ name: n }) !== '');
      /* FLOOR: the bounded names still read as male on their own. */
      const bare = ['Eric', 'Fred', 'Mark', 'Tony', 'Microsoft Guy Online', 'Mark - English (United States)'];
      out.bareStillMale = bare.filter(n => voiceSexLabel({ name: n }) !== 'male');

      /* FLOOR: the pick itself still reaches the voice — the half that was
         already right, driven through the real control. */
      const fake = [
        { name: 'Google US English', lang: 'en-US' },
        { name: 'Google UK English Male', lang: 'en-GB' },
        { name: 'en-us-x-iom-local', lang: 'en-US' }
      ];
      speechSynthesis.getVoices = () => fake;
      loadCoachVoices();
      const drill = COACHES.find(c => c.id === 'drill');
      const cheer = COACHES.find(c => c.id === 'cheer');
      STATE.settings.voiceName = 'Google UK English Male';
      COACH_V = resolveVoice();
      out.pickedReachesEveryCoach =
        (coachVoiceFor(drill) || {}).name === 'Google UK English Male' &&
        (coachVoiceFor(cheer) || {}).name === 'Google UK English Male';
      /* and a per-coach pick still outranks it */
      setCoachOwnVoice('cheer', 'en-us-x-iom-local');
      out.perCoachStillWins = (coachVoiceFor(cheer) || {}).name === 'en-us-x-iom-local';
      out.otherCoachUnmoved = (coachVoiceFor(drill) || {}).name === 'Google UK English Male';
      try { delete STATE.settings.coachVoices; } catch (e) {}
      STATE.settings.voiceName = '';
      return out;
    });

    t.ok('GUARD: the old rule really did mislabel real Android voice names',
      r.oldWrong >= 4, JSON.stringify(r));
    t.ok('GUARD: and every one it got wrong was a female voice called male',
      r.oldWrongAllFemale, JSON.stringify(r));
    t.eq('no voice is labelled with the wrong sex any more', r.nowWrong, 0);
    t.ok('FLOOR: it still answers wherever the name genuinely says so',
      r.stillAnswers >= 4, JSON.stringify(r));
    t.ok('FLOOR: a known female name still reads female', r.readsFemale, JSON.stringify(r));
    t.ok('FLOOR: a known male name still reads male', r.readsMale, JSON.stringify(r));
    t.ok('"Female" is not read as male, though it contains the word',
      r.femaleIsNotMale, JSON.stringify(r));
    t.ok('and the male test itself refuses "female", whatever order it is asked in',
      r.maleReSkipsFemale, JSON.stringify(r));
    t.ok('FLOOR: while still reading a genuinely male name',
      r.maleReReadsMale, JSON.stringify(r));
    t.ok('an unreadable name renders no suffix at all', r.suffixBlank, JSON.stringify(r));
    t.ok('and a readable one renders the separator with it', r.suffixNamed, JSON.stringify(r));
    t.eq('a male name INSIDE a female one is not read as male (v487)',
      JSON.stringify(r.noneInsideRead), '[]');
    t.eq('FLOOR: the bounded names still read as male on their own',
      JSON.stringify(r.bareStillMale), '[]');
    t.ok('FLOOR: the picked voice still reaches every coach',
      r.pickedReachesEveryCoach, JSON.stringify(r));
    t.ok('FLOOR: and a per-coach pick still outranks it, for that coach only',
      r.perCoachStillWins && r.otherCoachUnmoved, JSON.stringify(r));
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
