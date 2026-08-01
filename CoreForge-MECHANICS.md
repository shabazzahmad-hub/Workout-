# CoreForge — Mechanics & Architecture (backup reference)

This document explains how the CoreForge app works so it can be rebuilt or
maintained even without the GitHub repo. The **entire app is `index.html`** — a
single self-contained file (HTML + CSS + vanilla JS, no build step, no
dependencies). The other files are the offline/install shell and assets.

## Files in this backup
- **index.html** — the whole app (UI, logic, data). This is the source of truth.
- **sw.js** — service worker: offline cache. Bump `CACHE` (e.g. `coreforge-v18`) on every change so installed apps update.
- **manifest.webmanifest** — PWA manifest (name, icons, standalone display) → makes it installable to a phone home screen.
- **icon-192.png / icon-512.png** — home-screen icons (the CoreForge logo).
- **ex-*.jpg** — 40 exercise reference photos (one per exercise; filename = exercise key, e.g. `ex-plank.jpg`).
- **README_INSTALL.md** — end-user install steps (GitHub Pages + Add to Home screen).
- **deploy-pages.yml** — GitHub Actions workflow (`.github/workflows/`) that auto-enables GitHub Pages and deploys on every push to `main`.

## How to rebuild / host (no GitHub needed)
Any static host works. Put all files in one folder and serve it:
- Locally: `python3 -m http.server` then open the URL.
- Any static host (Netlify drop, GitHub Pages, S3, etc.): upload the folder; open `index.html`.
- On a phone: open the hosted URL in Chrome → menu → **Add to Home screen**.
Nothing server-side is required; all data is stored on the device.

## Data model (localStorage key `coreforge.v1`, mirrored to IndexedDB)
`STATE` object, saved on every change (localStorage + IndexedDB mirror `kv` store):
- `onboarded`, `profile` {name, days[], unit, startWaist, hasBar, hasBench, createdAt}
- `baseline` {date, results, score, level, maxes} — from the Day-1 assessment
- `reassess` {cycleIndex → same shape} — re-test each 6-week block
- `progressPtr` — index of the next session (0-based, across all blocks)
- `logs` {sessionIndex → {date, ex:{exId:{sets[],done}}, feel, completedAt, done}}
- `weekFeel`, `adapt` (adaptive-overload multiplier, 0.9–1.30)
- `measurements` [{date, waist, weight}]
- `scoreHistory`, `prs` (personal bests), `achievements` {id→date}
- `nutrition` {goal, sex, age, heightCm, activity, weightKg, kcalTarget, days:{date→{water,habits}}}
- `photos` [{id,date,pose}] (image bytes in IndexedDB under `ph_<id>`)
- `settings` {sound, vibrate, voice, voiceName, voicePitch, voiceRate, repTempo, hype, coach, reminderOn, reminderTime}

## Exercise library (`EX`)
Map of exerciseKey → {name, region, unit('time'|'reps'), img, anchor, hardness, base, rest, why, steps[], cues[], mistakes[]}.
- **regions**: anterior, oblique, lower, stability, dynamic, strength, cardio (drive tag colors + emblem fallback).
- `img` = `ex-<key>.jpg` (or null → generated emblem).
- `anchor` = which baseline metric personalizes it (plank/side/hollow/lower) or null (base-scaled).
- 40 exercises total: core/ab moves + compound strength (squat, lunge, push-ups) + cardio (jacks, high knees, burpees, etc.).

## Program structure
- **6-week block × 2 = 12 weeks** (`WEEKS_PER_CYCLE=6`, `TOTAL_CYCLES=2`), **4 sessions/week** (`SESSIONS_PER_WEEK=4`) → 24 sessions/block.
- 4 weekly session types (`SESSIONS`): **Core Crusher** (abs), **Full-Body Burn** (compound + core), **Obliques & Love Handles**, **Metabolic HIIT** (cardio + core). Core days get a cardio finisher.
- Each session = fixed warm-up + 4 main slots + 1 finisher. Slots reference **ladders** (`LADDERS`), easy→hard chains; the rung is chosen by `rungIndex(ladder, cycle, week, level)`.

## Progression engine (the "gets harder" logic) — in `prescribe()`
`target = anchorMax × fraction[week] × hardness × cycleBoost × (1+weekAdjust) × adapt`
(non-anchored exercises use `base × levelFactor × weekMultiplier × … × adapt`).
- **Weekly ramp**: `TIME_FRAC`/`REP_FRAC` and a week multiplier rise across weeks 1–6.
- **Harder variations** unlock at weeks 3 and 5 (rungIndex bonuses); an **extra set** in peak weeks 5–6.
- **Re-test each block**: new maxes rescale everything (`currentMaxes`).
- **Adaptive overload** (`STATE.adapt`): after each session you rate Easy/Just-right/Brutal → `+0.02 / +0.006 / −0.03` (clamped 0.9–1.30); multiplies every target so it climbs as you improve.

## Day-1 baseline assessment
5 tests (`TESTS`): Forearm Plank, Side Plank, Hollow Hold, Reverse Crunches, Bicycle Crunches (max time). Timed tests use a built-in **Start → 3·2·1 → count-up stopwatch**; reps use +/- entry. Produces a **Core Score** (0–100), a **level** (Beginner/Intermediate/Advanced), and personal `maxes` that seed the program.

## Feature systems
- **Voice coach + Motivator** (`coachSpeak`, `motivate`, `COACHES`): 16 personas (Drill Sergeant, Marine, Navy, SWAT, Ultra, Hype, Boxing, Spartan, Coach, British PTI, Zen Sensei, Box Coach, Viking, Mission Control, Cheer, A.I. Trainer). Fires start/during/push/rest/done lines during timers via Web Speech API. **Auto** mode uses a shuffle-bag to rotate through all 16 (one per exercise).
- **Timers** (`runTimer`, `runRepCadence`): hold count-down, rest, and guided rep cadence with beeps/voice.
- **Fuel tab** (`renderFuel`): protein target (~1.8 g/kg), calorie target (Mifflin-St Jeor, deficit by goal), hydration tracker, daily habit checklist + streak.
- **Progress tab**: Core Score ring, streak, measurements chart, progress photos (IndexedDB), personal bests, assessment history, **achievements** (18 badges), **skill-progression trees** live on the Program tab.
- **Quick Workouts** (`QUICKIES`): 8 standalone 5–10 min follow-along sessions; don't affect program progress.
- **Reminders**: opt-in on-device training-day nudge (fires when the app opens; Web Notifications).
- **Back-button**: History API integration so Android Back navigates instead of closing the app.

## Regenerating exercise photos (style reference)
Photos are AI-generated in a consistent style. To recreate: a lean African-American man, early 30s, short black fade + short beard, heather-grey sleeveless tank + charcoal shorts, barefoot; photorealistic studio, full-body side view on a black mat over pale oak floor, plain warm light-grey wall, soft front-upper lighting, vertical 4:5. Generate one exercise per image; resize to ~900px wide, JPEG ~82% quality, save as `ex-<key>.jpg`.

## Versioning / deploy
- On any change to `index.html`, bump `CACHE` in `sw.js` (e.g. v18 → v19) so installed PWAs fetch the update.
- With GitHub: push to `main` → `deploy-pages.yml` publishes to GitHub Pages automatically.
- Without GitHub: re-upload the folder to any static host.
