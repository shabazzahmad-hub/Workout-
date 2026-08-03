# CoreForge — Image Art Direction (STANDARD)

CoreForge is a **military-style elite calisthenics** program. Every image we generate
(ChatGPT / image models) must reflect that. This file is the canonical spec — use it
for **all** future image prompts.

## The athlete (keep consistent)
- The **same African American man** used throughout the exercise library: athletic,
  muscular build, short dark hair, clean-shaven or light stubble.
- Same face/body across every image. (A separate female athlete was used for an early
  warm-up/cool-down set — see Backlog; those will be brought into standard later.)

## Wardrobe — MILITARY FATIGUES (the standard, as of this note)
- **Full-length military fatigue trousers** — camouflage or solid tactical.
- **Fitted military training shirt or tank.**
- **Palette:** disciplined military only — **army / OD green, navy, or black
  (Navy SEAL style)**.
- **Footwear:** plain black athletic training shoes (or tan/black combat boots if a
  prompt specifically calls for them).
- Elite, disciplined, military-fit look. No insignia, unit patches, flags, or text
  on the clothing (avoids impersonating a real unit).

## Style & composition
- Photorealistic, clean and bright, premium fitness-app look with a strong elite
  military tone.
- Plain, softly-lit neutral studio background; **only** the equipment named for that
  exercise is present — nothing else.
- **No text, logos, captions, or insignia inside the image.**
- Full body visible and in frame; 3/4 or side angle that best shows the movement;
  correct, safe form.
- **Square (1:1).**

## Generation workflow
- **One exercise per message.** After each image, print the exercise **name in bold**
  below it, then wait for "Next".
- If the model drifts, reply: *"keep the exact same man and same military outfit as the
  previous image."*
- For **looping demo videos**, feed the finished photo into fal.ai Seedance 2.0 Mini
  (720p, ~5s) via `tools/gen-exercise-videos.mjs`; prompt for return-to-start so it
  loops cleanly.

## Filenames
- Exercise photos: `ex-<key>.jpg` (square, resized to ~640–720px, JPEG q≈82).
- Warm-up / cool-down: `wu-<key>.jpg` / `cd-<key>.jpg` (+ `.mp4` for demo clips).
- Identification is done by eye on integration — descriptive filenames help but aren't required.

## Backlog — COMPLETE ✅
The entire image set is now in the military-fatigues standard (same male athlete,
OD-green tee/tank + camo fatigues):
- ✅ The 15 home-gym equipment exercises (ab roller, medicine ball, kettlebells,
  battle rope, dip bar, pull-up bar).
- ✅ The full exercise library (core, chest, shoulders, back, arms, legs, cardio,
  plyometrics) — regenerated in 8 batches.
- ✅ Warm-up / cool-down set (was a female athlete in mauve; now the male athlete
  in fatigues).
- ✅ Hero / icon / splash — the coach "Sergeant Forge" portrait (OD-green tee +
  camo fatigues, arms crossed, neutral studio) drives `hero.jpg` and, as a
  head-and-shoulders crop, `icon-192.png` / `icon-512.png`. Same shot as
  `coach-sarge.jpg` (the Morning Brief avatar).

Any future images must follow the wardrobe + style spec above.
