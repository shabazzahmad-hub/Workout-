# CoreForge — working notes

## Time

**Report all times in Mountain time, never UTC.** Use the offset actually in
effect on the date in question — MDT (UTC−6) during daylight saving, MST
(UTC−7) otherwise — so timestamps match the clock on the wall.

GitHub and CI report UTC. Convert before quoting anything back:

```
TZ=America/Denver date -d "<utc-timestamp>" '+%Y-%m-%d %I:%M %p %Z'
```

This matters more than it looks: UTC late-evening timestamps land on the
*following* date, so an unconverted "deployed 05:39 on Aug 7" is really
"11:39 PM on Aug 6" — a day off.

## What this is

A single-file offline PWA. A ~54-week military-themed calisthenics and core
program, plus nutrition, progress tracking and a guided workout player.

| File | Role |
|---|---|
| `index.html` | The entire app — markup, styles, and one inline `<script>` |
| `sw.js` | Service worker; `CACHE` name + the precache tiers |
| `manifest.webmanifest` | PWA metadata |
| `tests/` | 21 suites, ~1,380 checks, run by `npm test` |
| `ex-*.jpg`, `wu-*.jpg`, `cd-*.jpg` | Exercise artwork, 800×800 progressive JPEG |

Deployed to GitHub Pages from `main`.

## Conventions that are not optional

**Bump `APP_VERSION` (`index.html`) and `CACHE` (`sw.js`, `coreforge-vNN`) in
lockstep on every ship.** They are the update mechanism. Out of step means
phones either never see the new version or serve a stale cache against new
code.

**Views never clear `innerHTML`.** `go(tab)` toggles `.active` only. Every
view stays mounted. Clearing and re-rendering produced a long-running class of
duplicate-ID bugs where a stale element shadowed the live one.

**API keys live only on the device.** `settings.azureKey` and
`settings.foodAiKey` are stripped by `exportData()` and must never be
committed, logged, or written into a backup file.

**Safety-relevant predicates fail closed, and they check the DATA, not a
flag.** `safeMode()`, `parqFlags()`, `dietOk()`, `swapStillValid()`,
`offerable()`, `foodOk()` — when the check throws or the data is the wrong
shape, the answer is "not safe / not allowed", never "fine". An unanswered
health screen is not the same as a clean one.

> `parqDone()` was `!!STATE.profile.parqDone` — a boolean read with no check
> that the answers behind it existed. A restored backup carrying
> `{parqDone:true}` and no `parq` array satisfied it, `parqFlags()` returned
> `[]`, and the maximal test battery unlocked for someone who never answered
> the screen. A flag asserting that something happened is not evidence that it
> happened.

**Every field added to `STATE` gets type repair in `normalizeState()` — and a
decision about whether it belongs in a backup.** A non-array where an array was
expected has bricked the app (`limitations`), silently disabled allergen
filtering (`allergens`), and unlocked a maximal test battery for someone with a
declared heart condition (`parq`). The render error boundary retries *through*
`normalizeState()`, so anything it does not repair cannot be recovered from.

Live-session scratch (`_undo`, `_plResume`) is listed in `TRANSIENT_KEYS` and
stripped on export **and** on import — a backup describes the athlete, not a
half-finished tap, and old backups already carry these fields.

**A default in `DEFAULT_STATE` can permanently satisfy an "has the user
overridden this?" test, killing the code it guards.** `settings.voicePitch`
shipped as `0.6` and the override test was `typeof === 'number'` — true for
every athlete, forever — so the per-persona voice pitches were dead code and
every coach spoke in the same voice for months. Nothing threw and nothing
looked wrong in the diff. If a field means "the athlete changed this", its
default must be **absent**, not a value.

That also means **changing a default fixes nobody who already installed the
app** — their old value is already saved. A stale default needs a one-time
migration keyed to the exact value, behind a flag, leaving any other value
alone as a deliberate choice. See `_toneFix`.

The other half of that rule: **a check on an absent-by-default field has to run
the boot path.** `delete STATE.x; assert(STATE.x === undefined)` proves nothing
— it passes whether or not `normalizeState()` would install a default. Call
`normalizeState()` first. A mutant that added `proteinTarget = 150` walked
straight through the check that skipped it.

**`!= null` is not "is absent".** It skips `null` as well as `undefined`, so the
repair guarding `nutrition.proteinTarget` left a stored `null` in place — a junk
key that then travels in every backup. Use `!== undefined` when absent is the
contract.

**A repair on a field with a fixed set of legal values needs a MEMBERSHIP test.
Truthiness and range are not substitutes, and both have shipped as one.**

> `if(!STATE.nutrition.diet)` caught `''`, `null` and `undefined` and nothing
> else, so every other string survived — `'kosher'`, `'Vegan'` with a capital V,
> `'omnivore '` with a trailing space, anything an imported backup carried.
> `dietOk()` then asks `r.ok.includes(d)`, which no recipe answers for a diet
> that is not in the list, so an unrecognised diet made **every food in the
> library forbidden**: zero recipes passed the filter, the meal plan scaled to
> 0 g of protein and 0 kcal, `dietLabel()` rendered `undefined`, and
> `validateData()` reported 168 problems. Nothing threw.

> `if(!(STATE.progressPtr>=0))` is a *range* test doing a *type* test's job. It
> let through the fraction `3.7`, the string `'12'`, `true`, `null` and `[]`.
> The fraction was the one that hurt: `progressPtr` indexes
> `sessionsFor(cycle)[dayInWeek]`, a fractional slot is `undefined`, and Today
> died on the error boundary — which retries *through* `normalizeState()`, so a
> stored `3.7` bricked the tab across relaunches. The survivors were wrong more
> quietly: `'12'` reached `Math.min(STATE.progressPtr+1, …)` and
> **concatenated**, printing "SESSION 121 / 378" to an athlete on session 13.

Two things follow. **Keep the legal set in one place** — the five diets existed
as three separate literals (the picker, `dietLabel()`, `validateData()`), which
is a drift waiting to happen; `DIET_OPTS` is now the only copy. And **when a
repair has to guess, prefer the restrictive answer and say so.** An unknown diet
falls back to *vegan*, not omnivore, because the two ways of being wrong are not
symmetrical: an over-restrictive plan is visible and one tap from fixed, while
quietly serving pork to someone whose halal setting failed to load is neither.
`dietRepaired` drives a prompt to re-pick.

**A repair flag has to clear on the boot path, not only where it was set.**
Keying the clear off "the stored value survived" made `dietRepaired` sticky: a
fresh athlete with no diet at all got the default *and* kept a warning left in a
backup they had already replaced. Set the flag in exactly one branch and clear
it in every other. The check that catches this is a boot with a **valid** value
and a stale flag beside it — every other flag check goes through a branch that
clears it for its own reasons, so deleting the clear-on-valid branch entirely
left the suite green.

**Escape every user-controlled string that reaches `innerHTML`** with `_ve()`
— `profile.name`, `baseline.level`, food names, favourite names, **`_saved`,
achievement dates**. `importData()` accepts arbitrary JSON, so these are a real
injection path, not self-XSS. The two that shipped unescaped were both fields
nobody thinks of as user content: a housekeeping timestamp and a badge date,
rendered a line apart from a `profile.name` that *was* escaped. If it can come
out of a backup, it is user content.

**A promise in UI text is a specification.** Three of the worst defects in this
repo were a sentence the athlete could read and no code behind it. The health
screen said an uncleared athlete would be held "well short of failure" while
`prescribe()` never called `safeMode()` — flagged and cleared athletes got
byte-identical sessions. The restart confirm said "history stays saved" while
`restartProgram()` cleared the logs; the fix kept them and created a worse bug
(below). The finish screen said a session was complete when nothing had been
done. **When you write a reassurance into the UI, grep for the code that
enforces it — and if there isn't any, that is the bug.**

**A skipped session is not a completed one, and a measured zero is not a
missing answer.** Both are the same mistake: treating "no work" as "no data".
`computeAssessment()` did `+results.plank||30`, so an athlete who honestly
recorded 0 was prescribed against a 30-second plank. `actualRatio()` returned
`null` when nothing was logged, and `commitSession()` reads `null` as "no
opinion" and raises the load — so skipping every movement and tapping "Easy"
made next week *harder*. Zero is data. Say zero.

The completion gate that came out of it: **zero sets refuses to commit** (the
session stays open), partial work commits but is flagged `partial`, and the
pain-stop path keeps its own rule — it still advances the pointer, because a
button that punishes you for pressing it does not get pressed, but a stop
before any set was logged records `stoppedForPain` instead of `done` so it
never claims a workout that did not happen.

**Resetting a pointer that keys a map is a collision, not a reset.** `logs` is
keyed by `progressPtr`, and `restartProgram()` set that back to 0 while keeping
the rows — so the new block's session 0 *was* the old block's session 0,
already `done:true`. The code comment asserted "the new block writes fresh keys
from progressPtr 0", which was simply false. Archive the whole run into
`STATE.runs` instead; the keys go with it, and every lifetime counter reads both
(`allDoneLogs`, `allDonePairs`). **A comment claiming an invariant is not the
invariant** — this one was written by the fix for the previous bug in the same
function.

**CacheStorage and service-worker registrations are scoped to the ORIGIN, not
to your scope.** `caches.keys()` on `shabazzahmad-hub.github.io` returns the
Command app's caches too, so `keys.filter(k => k !== CACHE)` in `activate` and a
bare `getRegistrations()` loop in `selfUpdate()` deleted another app's offline
pack and unregistered its worker on every CoreForge update. Match on
`/^coreforge-v\d+$/` and take the registration by scope. Never
enumerate-and-delete origin-wide.

**Sanitise before merging over defaults.** `Object.assign({defaults}, stored)`
lets a present-but-invalid value beat the fallback that exists to cover it.
`estimateMaxes` shipped that way: a backup with `{plank:"abc", push:null,
pull:-5}` produced `target:null` and the session card rendered
`~NaN minutes`. Filter to values that are actually valid, *then* merge.

**A correction needs a direction test.** The calorie adjustment was computed as
`observed - expected` instead of `expected - observed`, so a stalled dieter was
told to eat 300 kcal *more* — the opposite of the advice, with a confident
number attached. Any signed nudge gets a check that asserts which way it points,
not merely that it produced a number.

## Tests that pass for the wrong reason

This is the dominant failure mode in this repo — every entry below was found
in code that already had a green suite, and the list keeps growing:

- **The resume banner check** passed while the banner was invisible six days in
  seven, because `seedAthlete` starts at `progressPtr` 0 — which *is* day zero
  of a week, the one day the (accidental) gate let it through.
- **A contrast probe** reported 56 failures that were all its own bug: it did
  not composite alpha (`rgba(255,255,255,.06)` on near-black read as white) and
  parsed `color(srgb 0.64 …)` as 0–255.
- **A player-reachability check** asked whether content overflowed
  (`scrollHeight > clientHeight`) — true even when the parent is
  `overflow:hidden`. It had to actually scroll and re-measure.
- **A precache resume check** proved evicted files come back, which is also
  true of a top-up that blindly re-downloads everything. It had to assert that
  a complete pack does *no work*.
- **An audit check** called `safeFlow()` directly rather than the `runFlow()`
  path that calls it, and indexed `FLOW_RISK` by joint when it is keyed by
  exercise *name* — so it compared against an empty list.
- **A tap-repaints-the-UI check** slept 200 ms before reading the DOM back, and
  `loadCoachVoices()` parks a deferred `renderGuide()` 600 ms after
  `voiceschanged`. That unrelated repaint landed inside the wait and painted the
  correct state, so the check passed with the re-render deleted from the
  handler. **A check that a tap repaints must read back synchronously** — any
  `await` hands the assertion to whatever else is scheduled.
- **"The validator is clean" proves nothing about a validator rule.** It stays
  clean whether the rule exists or not. A new rule needs a check that *breaks
  the data in front of it* and requires the specific complaint, then restores.
  Mute `console.error` while doing so — `validateData()` logs, and the harness
  counts a console error as a page failure.

- **A check can be rigorous and still encode the wrong requirement.** The
  timer-over-photo veil had a real measurement behind it — 4.5:1 against the
  brightest and darkest artwork in the library, in both themes, worst case
  4.58:1 — and the whole thing was aimed at the wrong goal. The athlete wanted
  the *photograph* unobstructed and was content to lose the clock. A green
  suite says the code does what the check says; it does not say the check wants
  the right thing. When a requirement changes, the check is part of the change.
- **Assert on the pixels that were painted, not on the rule that painted
  them.** "There is no scrim" as a CSS assertion passes the moment someone adds
  the scrim somewhere else — a `box-shadow`, a parent `filter`, a second
  overlay. Suite 16 screenshots the middle of the photo and compares its
  luminance against the source file, which catches an overlay as faint as
  `.09` alpha no matter where it came from. Same family as reading the SSML
  actually sent: measure the output, not the instruction.

**Mutation-test every new check: seed the defect back, confirm the suite goes
red, restore.** Nothing else reliably distinguishes "this passes" from "this
cannot fail". Roughly a fifth of new checks survive their first mutant.

- **Three checks written for the v210 audit fixes passed on nothing**, and each
  failed for a different reason. A `currentRung` check ran as the seeded
  *Advanced* athlete, and the bug it was aimed at (`LEVEL_TIER[lvl] || 1`) only
  bites on Beginner, whose tier is the falsy 0 — the mutant walked straight
  through. An XSS check asserted `!/onerror=/.test(html)`, which matched 126
  legitimate exercise thumbnails using `onerror` as a missing-image fallback;
  it had to query for the injected **element**, not the substring. And a
  service-worker 500 check used `page.route` and then `ctx.route` to fake the
  error — **Playwright's route interception never sees a request issued by the
  service worker**, so the real 200 came through and the check passed with the
  defect restored. Only a server that genuinely returns 500 exercises it, hence
  `srv.fail500()` in the harness. Guard clauses are worth their weight here: the
  one that finally caught it was `t.eq('guard: the origin really is failing',
  originStatus, 500)` — and it had to be measured from **Node**, because a
  `fetch()` inside the page goes through the worker and returns the cached 200.
- **`update()` on a byte-identical `sw.js` installs nothing, and `unregister()`
  does not stop a worker while a client is still controlled.** Both leave the
  ORIGINAL activation as the thing being measured, so a cleanup check seeded
  after first load tests an activate that already ran. Register a distinct
  script URL (`./sw.js?probe=1`) to force a real install → activate.
- **Seed each mutant from a clean file.** A mutation harness that patches the
  working copy in a loop stacks the mutants, and the failure counts climb
  monotonically (2, 2, 8, 9, 11, …) whether or not any individual check catches
  anything. Copy the good file back before every seed.

Known traps when writing checks:

- `seedAthlete` starts at pointer 0. Anything about Today's banners must also
  run from a **mid-week** pointer (`posOf(p).dayInWeek !== 0`).
- Clearing `localStorage` does not reset the app — state is mirrored in
  IndexedDB. Delete both, or the "fresh install" you are testing is fully
  onboarded.
- `document.body.textContent` includes the inline `<script>` source, so
  scanning it for `NaN` matches code comments. Scan `.view.active` instead.
- `navigator.serviceWorker.ready` resolves while the worker is still
  `activating`. Wait for the state, not the promise.
- `history.back()` is async; `closeSheet()` leaves a queued navigation that can
  revert `location.hash` after a reload.
- `plEnterWork()` only rewrites text — `plBodyWork()` is what builds the ring.
  A probe that set `PLAYER.items[i].exId` and called `plEnterWork()` never
  changed the media, so the darkest and the brightest photo in the library both
  scored an identical contrast ratio. Two numbers that agree to two decimals
  across inputs that should differ is the tell. This caught a *shipped suite*
  the second time, not just a throwaway probe: a block called `plEnterWork()`
  and read back the rest screen the previous block had left mounted, and it had
  been green on nothing but block order. **Every block builds the state it
  asserts on** — `plEnterReady(false)` first, then `plClear(); plEnterWork()`.
  What the block before you left on screen is not a contract.
- **Do not test a repair through a getter that guards itself.** This has now
  bitten twice: `parqDone()` and `cueVolPref()` both sanitise their own reads,
  so asserting on their OUTPUT passes whether or not `normalizeState()` still
  repairs the field. Assert that the junk is gone from `STATE`. The same shape
  applies to any value transformed on the way out: check the gain written to
  the audio graph rather than the `vol` argument handed to `beep()`, and read
  the `pitch` attribute in the SSML that is actually sent rather than asserting
  the SSML "builds". Three separate mutations have survived a check that
  measured the input or the container instead of the payload.

## The exercise engine

`EX` holds ~151 exercises. `LADDERS` orders them as progressions. `prescribe()`
turns a rung plus a position into sets, target, rest and tempo.

**`hardness` means: what fraction of your anchor-test max one working set of
this movement is. Higher = easier.** A push-up anchored to the push-up test is
`1.0`; a one-arm variant is far below it. Adding an `anchor` without setting a
calibrated `hardness` makes the engine treat that movement as exactly as hard
as the test itself — that shipped once and prescribed 4×40 dips.

**`LADDERS` arrays must be non-increasing in `hardness`.** A rung that climbs
must never get easier.

**A control the athlete sets must be readable in the OUTPUT, not just stored.**
`focusBonus()` walked a priority list and returned on the first key that
yielded a candidate — and the first key virtually always does. Measured across
a full 378-session program: the bonus was chosen by `abs` 306 times out of 306,
and adding chest, arms and thighs as trouble zones changed *nothing*. Every
secondary target and every trouble zone the quiz collected was dead input. The
comment on `focusKey` claimed the opposite ("the only handle that proves the
trouble-zone answers actually steer the selection"), which is how it survived.

The check that finds this class is not "does the setting save" — it is **set A,
fingerprint the program, set B, fingerprint again, assert they differ**. Run it
over a SPREAD of sessions: gear and handstands cannot appear in a week-1
bodyweight core day, so testing there proves nothing. Half the first probe's
"dead" findings were the probe using a key the app does not have — `'db'`
instead of `'dumbbell'`, `STATE.deload` instead of `settings.deload`,
`troubleZones:['knee']` when the pool is keyed `belly/lovehandles/chest/arms/
thighs/posture`. Confirm the control's real shape before believing the result.

**Widening what an engine reaches exposes filters nobody applied there.**
Rotating the bonus across the athlete's other areas immediately produced
`bearcrawl` 15 times for an athlete who had declared a tight room: the bonus ran
`safeSwap` and never `spaceSwap`. The filter existed; that path just never
needed it while it only ever picked one pool.

**Cardio defaults to jumping jacks, not the bike.** `cardioMode()` returns
`'jacks'` unless the athlete has explicitly chosen `'bike'`; owning a trainer is
not consent to be programmed one. Jacks and the bike share the same arithmetic
— net METs, `steps/min = MET × 35` — so the two currencies can never disagree.

## Editing `EX` and the swap maps

These are large hand-maintained object literals, and **regex and substring
edits over them have repeatedly caused real defects**:

- Substring matches: `pistol` matched inside `boxpistol`, `vup` inside
  `tuckvup`, writing one exercise's data onto another's.
- Indentation is a substring too: an anchor of `"  if(x)"` also matches
  `"    if(x)"` elsewhere in the file. **Anchor on the leading newline**
  (`"\n  if(x)"`) when indentation is what distinguishes two sites.
- Duplicate keys in a literal are silent — JS keeps the last one. That is how
  `boxpistol:{repCap:12,repCap:10,…}` shipped, and how a shadowed `SAFE_SWAP`
  entry routed a flagged low back into loaded lumbar flexion.

Always anchor to the start of a definition line:

```python
re.match(r"\s{2}([a-z0-9]+):\{", line)
```

…and check the key is the one you meant before substituting.

**Patch scripts assert before they write.** Every `rep(old, new)` helper should
`assert old in s` *and* `assert s.count(old) == expected` before mutating, with
the file written once at the end. That is what turns a bad anchor into a clean
no-op instead of a half-applied edit.

## Rendering

**`renderToday()` has a `sess.pos.dayInWeek === 0` branch for the weekly
overload note. Do not append to it.** Five per-day banners were added into it
one at a time and inherited a once-a-week gate nobody intended:
`doneForTodayHTML`, `driftBanner`, `resumeBanner`, `painPromptHTML` and
`undoBannerHTML` were invisible six days out of seven. Anything about *today*
goes above that branch.

**The photograph outranks the clock.** The exercise image lives INSIDE the
countdown ring (`plRingMediaHTML`), in both the guided player and HIIT. It was a
120px thumbnail above a 232px timer and read as decoration — *"it's like there
is no view of that exercise"* — while HIIT had no photograph at all.

The priority is deliberate and it is the athlete's: *"the image of the exercise
should be 100% clear to see and up front, the timer should sit at the back and
translucent"*. The picture is the form reference you glance at mid-set. So:

- **Nothing is laid over the photo.** There is no scrim, and suite 16 proves it
  by comparing rendered pixels against the source file — a veil shows up as a
  luminance drop. An earlier version darkened the middle by ~90 points to keep
  the digits crisp; that was the wrong trade.
- **`.pl-center` is 40% opacity during an effort.** What makes that affordable is
  `countdownCue()`: the last ten seconds are audible, so the digits do not have
  to win. **Rest is the exception and stays solid** — rest deliberately has no
  ten-second cue, only a 3-2-1, so it is the one timer with nothing behind it.
  Solid is not the same as legible, though: with the veil gone, white digits
  over the brightest artwork measured **1.00:1** in light theme. The rest clock
  carries a **halo** (`--plhalo`, a layered `text-shadow`), which darkens the
  few pixels around each glyph and leaves the frame alone. A halo is not a
  scrim, and the no-scrim check cannot see one — it hides `.pl-center` before
  sampling, so it read identically with the halo and without it. Legibility is
  measured on the **painted** box instead: 12.3:1 with the halo, 2.1:1 without.
- **Rest is laid out exactly like an effort** — the tag, the movement's *name*,
  the same full-size photograph. It used to say "Recover" over a shrunken
  preview with the useful part, *what you are about to do*, in a chip below the
  fold.
- **Fixed pixel sizes inside `.pl-body` get squashed, silently.** `.pl-ring` was
  `232px × 232px` in a flex column; on a 690px-tall phone flex shrank its
  *height* to 153px while the SVG kept drawing a full circle, so the ring
  spilled over "SET 1 OF 3" and the coach cue. It now takes a `height` and lets
  `aspect-ratio:1` derive the width, so it shrinks to fit a short phone and
  stays a circle while it does. Anything added to the player checks
  `scrollHeight <= clientHeight` at 412×690 — the player is hands-free, so
  content that needs scrolling is content the athlete never sees, and every
  pixel of chrome is a pixel the photograph does not get.

**The player has twins, and they drift.** A timed effort is rendered in three
places: the guided player (`plBodyWork`/`plEnterRest`), HIIT
(`ivRenderStep`/`ivRingHTML`), and the warm-up/cool-down flows (`runFlow`,
`showFlowMedia`). Every treatment that has landed in one has had to be chased
into the others afterwards — four separate copies of the same three-beep line
before `countdownCue()` centralised them, and a photograph in the guided player
while HIIT had none at all and the flows quietly had the biggest image in the
app at 260px. **Anything added to one gets checked against the other two in the
same change**, and shared markup lives in one helper (`plRingMediaHTML` is used
by both rings) rather than being copied.

**Sheets render behind the player.** `.scrim` is z-index 60, `.pl` is 75, so
`openSheet()` from inside a session is invisible. Mid-session UI is an
in-player panel — see `#plSwapMenu` and `#plHurtMenu`.

**Widening what a list can hold breaks the rules that were only correct
because it was narrow.** Progress photos were front and side, and "Before →
Now" was `ps[0]` against `ps[ps.length-1]` — earliest against latest,
whichever views they happened to be. That is defensible with one pose and
merely lucky with two. Adding a back view made it wrong on ordinary data: the
first shot of the oldest session against the last shot of the newest session
is routinely a front captioned "before" beside a back captioned "now". Nothing
threw, the panel still rendered two photographs, and the comparison meant
nothing. `photoPair()` now picks a pose that has at least two shots and shows
the widest span *inside* it. When you add a member to an enumeration, re-read
every place the old set was small enough to index by position.

## Audio

`countdownCue(remain, total)` owns the last ten seconds of a timed effort, and
every timed surface calls it: the guided player's holds, the standalone hold
timer, HIIT work intervals, and warm-up/cool-down moves. Ten seconds is a
two-tone marker (low→high), 9–4 a soft tick each second, 3–1 the louder beep
plus a short buzz so a silenced phone still gives the last three.

Two properties are load-bearing, not decoration:

- **Rest must NOT use it.** Rest keeps its plain 3-2-1, so the ten-second
  marker always means *your effort is ending*. If both phases counted down the
  same way the athlete would lose the ability to tell them apart by ear, which
  is the entire reason the cue exists — you cannot look at the phone at second
  40 of a plank.
- **Efforts of 14s or less are skipped.** A ten-second countdown on a
  twelve-second hold is most of the exercise, and becomes noise.

All of it routes through `beep()`, which returns early when
`settings.sound` is off. Any new timed surface calls `countdownCue` rather
than growing its own beeps — four surfaces had already drifted into four
copies of the same three-beep line before this was centralised.

### Being heard is mostly not about gain

"Make the beeps louder" was three problems, and the smallest of them was
volume:

1. **The beat was never ducked for a beep.** `beatDuck()` had existed for ages
   and was used by coach speech, the briefing and neural audio — but not by
   cues, so a 0.13s square wave competed with music at full level. Turning a
   blip up fights the beat; ducking the beat ends the fight. `beepDuck(ms)`
   does it and auto-releases.
2. **They were too short.** A very brief sound reads as quieter than it is, so
   durations went up with the gains.
3. **The right level depends on the room**, not on the app.

**Only the cues that must land duck the music** — the ten-second marker, the
last three seconds, GO, and the HIIT work start. The one-second ticks
deliberately do not: ducking every second pumps the beat audibly and is worse
than the problem. If you add a cue, decide which of those two lists it is in.

`settings.cueVol` is a single multiplier applied inside `beep()`, so it covers
every tone in the app and the balance between a soft tick and the GO tone
survives someone turning it all up. Default 1.25, clamped 0.2–2, with a slider
in Settings. **Do not raise the per-call volumes to make things louder** —
that is what the multiplier is for, and forty edited call sites is how the
balance gets lost.

Gain into `destination` is capped at **1.0**. A single oscillator driven past
unity clips, which sounds broken rather than loud.

### Voice tone

`VOICE_TONES` is Deep / Mid / Bright, and it sets a **base the personas move
around** — not an absolute pitch. Each persona's own `pitch` is kept as a
character offset from the historical 0.6 baseline, halved, so a drill sergeant
still reads deeper than a coach while the whole cast shifts together. Setting
one absolute value for everybody is what the old code effectively did, and it
made every coach the same person.

Everything clamps to **0.5–1.6**: below about 0.5 a Web Speech voice buzzes
rather than sounding deep, which is what "robotic" meant. Deeper is not the
same as better, and past a point it is strictly worse.

The neural path takes the same shift in semitones (`neuralPitchFor`) so
switching engines does not change what "Deep" means. **A shift that lands on
neutral must omit the `pitch` attribute** — `pitch="0st"` is invalid SSML and
Azure rejects the whole request (0x80045003).

**Only the A.I. Trainer may sound synthetic** — that is its character. Every
other persona is a person, and `validateData()` enforces the floor: local
`pitch` at or above **0.42**, neural shift no deeper than **−2st**, `robot`
exempt. A tone slider does not rescue a persona authored at the bottom of the
range; Strongman shipped at 0.4 / −3st and still read as processed after the
tone fix landed, because Deep shifts *down* from wherever the persona already
sat.

**A control that stores a value must repaint.** `setBeatTempo` saved and
restarted the beat but did not re-render, so the slider, the BPM label and the
preset chips all kept showing the old number — tapping a preset looked like it
did nothing at all. The chips also carried no selected state. Anything with
presets shows which one is on, and re-renders its own surface after storing.

## The service worker

Precache is **tiered**: `CORE` (atomic) and `SHELL_MIN` install — about 1.25 MB
— and `FIRST_RUN` then `EXTRA` are topped up in the background in batches of
six. The install used to await all 191 assets (~11 MB) inside `waitUntil`,
which kept the worker in `installing` for the whole download, competed with the
page's own image fetches, and threw everything away if the tab closed.

Two rules that are easy to get wrong:

- **A URL already in the cache is skipped**, which is what makes the top-up
  resumable. Do not "simplify" that away.
- **The top-up is driven by a message from an open page and pinned with
  `e.waitUntil`.** Work started from `activate` and left detached is terminated
  the moment the worker idles, so it would silently never finish. The page
  re-sends `cf-topup` on every load.

`FIRST_RUN` is derived from what a new athlete actually meets — the eight
baseline tests, every warm-up and cool-down, and a beginner's first fortnight.
Video (`.mp4`) sorts last in `EXTRA`, being heaviest and least necessary.

## The reference days

`REF_DAYS` is **28 worked days** — four weeks, then it repeats — and `shopList()`
totals all of them into one list. No pork on any of them, gluten-free
throughout, fruit on every day.

**A day is not just a menu; it has to land on whatever target it is scaled
to.** `scaleDay()` moves the protein anchors to hit the protein and the
starches (`REF_STARCH`) to close the calories. Everything else — nuts, oil,
avocado, fruit, veg — is **fixed**, and that is what makes days fail:

- **A day with no starch at breakfast cannot stretch upward.** Four of the new
  days landed 160–220 kcal short of a 2,800 kcal athlete with the starch dial
  already at its 1.6× stop. A starch in every meal gives the dial something to
  turn.
- **Stacked fixed items set a calorie floor the scaler cannot get under.**
  Nut butter plus oil plus avocado plus seeds plus fruit on one day put it
  ~190 kcal over a 1,700 kcal target at the 0.5× floor.
- **Plant anchors are calorie-expensive per gram of protein**, so a day has to
  survive *substitution*: for a vegan athlete with soy, nut and gluten
  allergies every anchor becomes a pulse, and three days fell 13–15 g short at
  155 g / 2,170 kcal purely because of it.

Three separate bars, and they are checked in three different places — meeting
one does not mean meeting the others:

| bar | where | what it sweeps |
|---|---|---|
| 3 targets, omnivore | `validateData()` | 150/2170, 190/2600, 120/1700 |
| 5 targets, omnivore | suite 06 | up to 200 g / 2,800 kcal |
| 6 diet+allergen combos | suite 09 | after substitution, ±12 g at 155/2170 |

`validateData()` runs **whenever it is called**, including while a suite has a
restrictive diet set — so a day must clear its three targets *after
substitution* too, not merely for an omnivore.

## `validateData()`

Runs at boot and logs to the console. It checks anchors resolve, anchor units
match the exercise's unit, `base` fits within `repCap`, gear exercises carry a
`pattern`, ladders are monotonic in `hardness`, every swap target exists, every
food is allergen-tagged, and both cardio ladders pay what they claim.

**Keep it at zero problems.** It caught 14 real defects on its first run that
reading the diff had missed. If a change makes it complain, the change is
wrong — not the validator.

## Shipping

Develop on `claude/abs-core-workout-app-3rr2ob`.

1. `npm run check` — parses the inline script and `sw.js`, enforces the
   `APP_VERSION` / `CACHE` lockstep, and lints the coach corpus against the
   stop-for-pain rule (no line may frame pain or a symptom as the thing to
   push through).
2. `npm test` — all 21 suites green, zero page errors, validator clean.
   Mutation-test anything newly added.
3. Bump `APP_VERSION` and `CACHE` together.
4. `git fetch origin main && git checkout -B <branch> origin/main`, commit,
   push with `--force-with-lease`.
5. Draft PR → ready → confirm `mergeable_state: "clean"` → squash merge.
6. Sync `main`, then confirm the **`Deploy to GitHub Pages`** run for the merge
   commit has BOTH jobs green — `test / test` and `deploy`. The `deploy` job is
   `needs: test`, so a red suite on `main` shows up as *deploy skipped*, not as
   a failure: the version ships nowhere and nothing says so. Check the jobs, not
   just the run.

   There is only one workflow to check now. `pages build and deployment` was the
   branch builder and stopped running when Pages Source moved to GitHub Actions.

Probe scripts must live in the repo root to resolve `playwright`. Delete them
afterwards and leave `git status` clean.

## Sandbox and tooling

**`github.io` is not reachable from here** — the agent proxy returns
`CONNECT tunnel failed, 403`, so a `curl` poll against the live site never
succeeds and an `until` loop on one spins forever. Confirm a deploy through the
Actions API instead. "Live" therefore means both jobs went green, not that the
page was fetched — say it that way.

**`$GITHUB_TOKEN` is not set, so NO shell path can poll the GitHub API.**
Unauthenticated `curl` returns a body with no `status` field, which parses
without error and reads as "not finished yet" — so the loop never exits and
burns until timeout. This applies inside `Monitor` exactly as it does in a
plain `until` loop: a Monitor built on `curl` against the API is a fifteen-
minute silence, not a watch. **Use the GitHub MCP tools, on demand.**

Worth stating plainly because writing the rule down did not prevent it: this
note already existed, and a `Monitor` polling the Actions API with
unauthenticated `curl` was started an hour later anyway. If you are about to
watch CI from the shell, that is the tell.

**`list_workflow_runs` returns ~490 KB** and blows the context window. It gets
saved to a file; parse that with `python3 -c`, pulling `head_sha`, `status`,
`conclusion` and `id`. Note `conclusion` is absent while a run is in progress —
use `.get()`.

**Do not pace API polling with fixed `sleep` timers.** Their completion
notifications arrive long after the answer is already in hand, and every one of
them costs a turn to dismiss. Poll on demand.

**The sandbox ships one Chromium build, and `npm install` outruns it.**
`/opt/pw-browsers` carries chromium **1194**; `package-lock.json` resolves
Playwright to a newer release that wants a different revision, so `npm test`
dies with *"Executable doesn't exist"* and tells you to run
`npx playwright install` — which the environment says not to do. Match the
library to the browser instead: `npm i playwright@1.56.0 --no-save`. Revisions
step 1187 → 1194 → 1200 → 1208 per minor, so if the pinned build ever changes,
read `node_modules/playwright-core/browsers.json` rather than guessing. CI
downloads its own browser and is unaffected — do not "fix" this in
`package.json`.

**Check the wall clock before calling something slow.** A CI job was reported
as "seven minutes and needs explaining" when it had run for 88 seconds; the
elapsed time was my polling latency, not the job's. `date -u` first, then
judge.

Never put a model identifier in a commit, PR, code comment, or anything else
pushed to the repository.
