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
| `tests/` | 22 suites, ~1,710 checks, run by `npm test` |
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

**A container check is not a type repair, and one map can hold several inputs.**
`nutrition.days` had only `if(!STATE.nutrition.days)days={}` — which a string
and an array both walk straight past — and nothing at all below the container.
Three separate athlete inputs live in there: the food log, the water count and
the habit ticks. A backup carrying `food:'chicken'` threw inside `foodTotals()`,
which is on the Fuel render path, so the tab died on the error boundary — and
the boundary retries *through* `normalizeState()`, so with no repair there the
tab **never came back**. `habits:'all'` was quieter and worse in its way:
`toggleHabit()` threw on every tap, so the ticks were dead for good and nothing
on screen said so. And `kcal:'lots'` needed no bad shape at all — it
concatenated into the day's total and printed "0lots" to the athlete. Repair
the container, the entries, *and* the fields; drop a bad row, zero a bad field.

**A cache is only self-healing against the inputs its validity test can see.**
`_planStillValid()` re-checked every recipe with `dietOk()`, which catches a
diet or an allergen change because those make the stored recipes *illegal*. A
calorie target does not: the recipes stay perfectly edible, they are just sized
to a number the athlete has replaced. So tapping "Calculate my targets" moved
the header from 2020 to 2770 kcal and left the same three meals underneath it —
measured at **+750 kcal with a byte-identical plan** — and switching to four
meals a day kept showing three. The fix is a stamp of every input the generator
read (`_planStamp`), not another writer remembering to null the plan; the class
of bug here is precisely that writers forget. An absent stamp on an old stored
plan reads as stale, which rebuilds it once, correctly.

Its twin: **a second copy of a freshness rule is a second place for it to
drift**, and this one had. `_recipePlanHTML()` re-stated the test as date and
non-empty, with no `_planStillValid()` at all. It survived because
`renderFuel()` primes with `currentMealPlan()` before building any markup — so
the copy is unreachable from the only caller, which is exactly why nobody
noticed. Two consequences for the check: it has to call the builder **directly**
(via `renderFuel()` the mutant is equivalent and the check passes on nothing),
and `Math.random` has to be pinned so `pickRecipe()` takes the closest recipe
rather than one of the closest three — otherwise two different targets can draw
the same plan by luck and the check passes on a coin flip.

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
- **An escaped mutant is sometimes a bad mutant.** Two of the v218 seeds
  survived and neither was the check's fault. `.map(x=>({...x, name:…}))`
  spreads the junk in and then overwrites every field it spread — equivalent to
  the original, so nothing could have caught it. And restoring the weak guard in
  `_recipePlanHTML()` changed code that `renderFuel()`'s priming call makes
  unreachable. Before rewriting a check, read the mutant back and ask whether it
  actually changes the program: the fix for the first was mutating the coercion
  (`kcal:num(x.kcal,20000)` → `kcal:x.kcal`), and for the second, calling the
  builder directly instead of through the caller that primes it.

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
- **A check that mutates a value must guard against the mutation producing
  nothing to test with.** A mutant that made `builderPool()` hide every
  flagged-joint movement (the wrong fix — hide, not warn) left this suite's
  `risky` variable `undefined`. Feeding that straight into `addCustom()`
  threw inside a template literal, and the render error boundary retried the
  throw forever — the check didn't fail, it **hung** the whole suite run
  until the timeout killed it. Guard immediately after computing the value
  the rest of the block depends on, before any code that assumes it exists.
- **Scope a DOM assertion to where the change was made, not the whole
  document.** A warning icon was added in two places — the picker's pool chip
  and the "your session" list the athlete had already built — and a check
  that only asserted `document.body.innerText.includes('⚠️ ' + name)` passed
  whether or not the SECOND one existed, because the first one alone
  satisfied it. `.kv` rows exist in other mounted views too (views never
  clear `innerHTML`), so the fix was `#sheet .kv` scoped to the one row that
  names the movement, not a page-wide substring search.

## The exercise engine

`EX` holds ~151 exercises. `LADDERS` orders them as progressions. `prescribe()`
turns a rung plus a position into sets, target, rest and tempo.

**`hardness` means: what fraction of your anchor-test max one working set of
this movement is. Higher = easier.** A push-up anchored to the push-up test is
`1.0`; a one-arm variant is far below it. Adding an `anchor` without setting a
calibrated `hardness` makes the engine treat that movement as exactly as hard
as the test itself — that shipped once and prescribed 4×40 dips.

**The ORDER of the baseline battery is part of the measurement.** The eight
tests ran plank → side → hollow → reverse crunch: four maximal TRUNK efforts
back to back, so each measured how tired the previous one had left the athlete
as much as it measured capacity — and those numbers anchor every prescription
for a year. The order now alternates domains (`TESTS` is plank, push, side,
squat, hollow, pull, lower, dyn), which holds the longest trunk run to two, and
the guidance asks for two minutes between efforts rather than one. Nothing
indexes `TESTS` by position — consumers use `assessState.idx` or the test `id`
— so reordering is safe, but a check pins the run length so it cannot drift
back.

`TEST_PROTOCOL` is stamped on every recorded assessment. A v1 baseline and a v2
re-test were not taken under the same conditions, and a comparison across them
should be able to say so rather than read as progress.

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

**The custom workout builder was the fourth sibling path to skip `safeSwap()`,
after the focus bonus, the weights circuit and Special HIIT.** `builderPool()`
filters by gear — same as `hasGearFor()` — but never checked whether a
movement was safe for a flagged joint, so an athlete who had declared a
shoulder or wrist issue could tap a dip or a push-up into their own session
and see nothing. Same call as grip/box in v217: warn, do not silently swap,
because the athlete is choosing every movement on purpose — `customRiskHTML()`
names what is flagged in the list they built, and a ⚠️ marks the row.

Worse than the missing warning: **starting a saved favorite skipped the
builder screen entirely** and dropped straight into the guided player —
`startFav()` called `startCustom()` directly, so a favorite saved before a
joint was ever flagged, or built back when it wasn't, could never be seen
before the session started. It now routes through the builder (where the
warning renders) whenever the saved list carries a flagged movement, and
starts in one tap exactly as before when it does not — the fix adds friction
only where there is something to say.

## Loaded progression past the bodyweight ceiling

A ladder runs out of rungs long before the program does. Tempo (from cycle 5)
was the only intensity axis a maxed movement had, and it stops changing after
cycle 7 — cycles 8-9, 12 of the program's 54 weeks, had nothing left to add
for any movement that topped its ladder early. `atLadderCeiling()` (v221)
wires the bodyweight ladders into the SAME `liftLog`/`lastLift`/
`loadToKg`/`loadShow` machinery the Weights track already had, rather than
inventing a second system next to it.

**Three conditions, not one, and getting any single one wrong is a real bug in
either direction.** Top of its ladder, the calendar has actually scheduled
them there (`currentRung`), and the real prescription — safe mode, deload,
readiness, every multiplier `prescribe()` already applies — is landing AT the
ceiling, not under it. Drop the first and an easy early rung that happens to
hit its own low rep cap on a strong athlete's numbers reads as "nothing left
to progress" when a dozen harder bodyweight rungs remain. Drop the third and a
flagged-joint athlete in safe mode at 75% of a max rung gets offered a vest on
top of a session that was eased specifically to be lighter — undoing the
ease. `prescribeCeiling(ex)` is pulled out of `prescribe()`'s own clamp so
this can compare against the exact number being enforced, not a second copy
of the ternary kept in step by hand.

Extended to three surfaces on purpose, and no further for v221: a mid-set note
naming the last logged load (or prompting for a first one), an end-of-session
"log your added load" button scoped to only the ceiling-maxed items in that
session (not the whole session — a core day is mostly bodyweight work with
nothing to load, and offering it for every move would be noise every single
day), and a skill-tree badge. Feeding the logged load back into `prescribe()`'s
own target math — how much a kilogram of vest is worth in "hardness" terms —
was deliberately left alone: that is a real exercise-science judgment call,
not a code-completeness gap, and encoding a guess as automatic prescription
math is a worse mistake than leaving the athlete to read their own log.

**A behavioural check needs a scenario engineered to discriminate, not just
any scenario that happens to produce the right-shaped data.** "A top rung not
yet reached by the calendar is not maxed" passed against a mutant with the
scheduling gate deleted entirely, because at week 1 with the seeded athlete's
ordinary numbers, `prescribe()`'s own arithmetic already falls short of the
ceiling regardless of whether the gate exists — the check was measuring
coincidence, not the gate. Fixed by cranking the anchor maxes up until the RAW
arithmetic hits the ceiling on its own, at a position the calendar has
deliberately not reached yet — the gate is then the only thing that can still
say no, and a guard proves the raw number really would trip it un-gated.

**Two mutants escaped through the same mechanism, in the same test file, from
two different checks.** `prescribe()` is clamped to `prescribeCeiling()`, so
"prescribe's output never exceeds the ceiling" holds no matter what
`prescribeCeiling()` returns — a version quietly returning half the real
number just moves the clamp with it, and the check that only watched the
relationship between the two passed on nothing. Needed a check on
`prescribeCeiling()`'s actual VALUES against the documented formula
(explicit `repCap` first, then a hardness tier, then a flat 150 for a timed
hold), independent of anything `prescribe()` does with them. Likewise a
skill-tree badge check that scanned the whole page for `🎒` passed against a
mutant that dropped the ceiling check entirely, because two OTHER ladders in
the same screen (`rotL`, `legL`) happen to have enough headroom above their
own cap that a 25% safe-mode cut still clamps them at it — the page-wide scan
stayed true from those regardless of whether the mutated ladder's own badge
was gated correctly. Fixed by anchoring on the specific exercise's row
(`openExerciseInfo('dragonflag')` in the markup) rather than the page.

**A mutation harness sharing a working tree with the rest of the session is a
real hazard, not just a style note.** Rebasing a branch after its own PR
squash-merges (see "Never stack new commits on the already-merged history"
below) requires a clean tree, so uncommitted feature work has to be
`git stash`ed first — and a background mutation script's OWN cleanup step
(`cp $CLEAN index.html`) can land in that same window. It worked out this
time because the script had already finished and restored the clean copy
before the stash ran, so the stash captured the intended feature code rather
than a mutant mid-flight — but that was order of operations, not a
guarantee. Confirm a background mutation run has actually finished (check its
log for the "ALL DONE" line, not just that the process exited) before
touching the same file with git.

## VO2max and anaerobic-capacity work

`ENDURANCE_FORMATS` (v222, extended v223) is the other end of the interval
spectrum from `HIIT_FORMATS` — every entry asks for one STEADY effort, hard
or truly maximal, held continuously for the interval, rather than a short
all-out burst inside a rotating circuit. Three distinct stimuli live here on
purpose, not three versions of the same protocol:

- `vo2max4x4` — 4 min hard / 3 min easy × 4 (25 min). The "Norwegian 4×4"
  (Helgerud et al., 2007): hard-but-holdable, and counter-intuitively better
  for raising the aerobic ceiling than either short sprints or slow
  steady-state.
- `vo2max3030` — 30s hard / 30s easy × 16 (~16 min). Targets vVO2max
  directly — the pace that actually elicits max oxygen uptake — with more
  anaerobic bite than the 4×4 while staying repeatable, not maximal.
- `sit6x30` — 30s ALL-OUT / 4 min full recovery × 6 (23 min, only ~3 min of
  it real work). Gibala's sprint-interval protocol: the counter-example to
  "more volume is always better" — minimal work, real anaerobic-capacity
  adaptation, because the long recovery is what keeps the sixth rep as
  maximal as the first.

**A guard belongs on "these are actually different protocols," not just on
each protocol's own numbers.** Two formats can each independently check out —
right round count, right work/rest split — and still turn out to be the same
shape by a copy-paste slip. `new Set([...]).size` on a `work/rest×count`
signature per format is cheap insurance against that, and it is a check that
mutation-testing alone would not have forced into existence: seeding wrong
numbers into ONE format catches that format's own checks fine without ever
proving the two formats remain distinct from each other.

**Gated to where a steady effort actually makes sense.** `specialChooser()`
only merges `ENDURANCE_FORMATS` into the picker when `kind !== 'hiit'` — the
bike and a run can hold one intensity for four minutes straight, the
bodyweight HIIT pool rotates between burpees, mountain climbers and jumping
jacks every round and cannot. Both `specialChooser('hiit')` and
`openHiitChooser()` (converting today's bodyweight circuit into intervals)
stay on the short formats only.

**Reusing `buildIntervals()`'s existing `{w,r,n,exId}` shape for
SKIP_FORMATS/SPECIAL_FORMATS surfaced a real, narrow bug in the exId
fallback, not a hypothetical one.** Grip and box hard-code their movement
(`exId:'deadhang'`), so `sk.exId||'skip'` always won for them regardless of
what list was passed in — correct, because a hang session IS the hang.
Skipping formats carried no `exId` at all and relied entirely on the trailing
`'skip'` literal doing the same job by coincidence. Extending the fallback to
`sk.exId||(list[0]&&list[0].exId)||'skip'` — needed so VO2max 4×4 resolves to
whichever the athlete picked, bike or sprint, since that lives on the list,
not the format — silently broke the coincidence: a caller that ever passed a
list with a different exId would now get THAT instead of the rope. Nothing
in the app does that today, but a check that deliberately does (`buildIntervals([{exId:'irrelevant'}],'skip93x2')`)
caught it immediately. Fixed by giving every `SKIP_FORMATS` entry (including
the one `startSkipCustom()` builds at runtime) its own explicit
`exId:'skip'`, matching the pattern grip and box already used, rather than
leaning on fallback order to do it implicitly.

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

## Movement earns room, but only the surplus

`todayKcalBudget()` (v220) is `kcalTarget + movementKcalAdj()` — the one
number every LIVE "today" surface reads. `recalcKcalFromStored()` prices
activity once, from a fixed onboarding answer, and never looks at it again;
`stepKcal()` already knew almost exactly what a day's real movement was worth
and the food budget never heard about it. This wires it in, deliberately
narrow:

- **Surplus only.** Clearing the step target by 8,000 credits real calories
  back; falling short by 8,000 credits nothing — not a positive number, and
  not a negative one either. Every commercial activity tracker earns
  calories up and never docks them down, for a real reason: the baseline
  already assumes a normal day, and a second penalty on a day that was
  already short is a nudge toward under-eating precisely when it is hardest
  to move. The asymmetry is the point, not an oversight.
- **Clamped**, the same reasoning as `applyKcalAdj()`'s ±500: one freak step
  count should not blow a week's deficit open on a single mis-logged number.
- **Scoped to LIVE displays only.** The meal plan, its freshness stamp,
  Reference's scaled days, the 7-day trend and the settings summary all stay
  on the unadjusted target on purpose — a plan that reshuffled its recipes
  every time a step count changed mid-afternoon would be a worse feature, not
  a more accurate one. Only the Fuel "today" ring and the pre-session voice
  briefing read the credited number.

**A behavioural check can lack the power to fail, even when written
correctly.** The first version of "the meal plan does not move with steps"
compared two `generateMealPlan()` calls, pinned `Math.random`, and passed —
including against a seeded mutant that made the function read the movement
credit. The recipe pool is small enough that a 176–500 kcal gap does not
always cross into a different closest-3 recipe per slot, so the buggy and the
correct code drew the identical plan by the same coincidence. No stronger
kcal gap fixes this in general, because the whole point is the function
should ignore the input regardless of how large it is. The fix was to stop
asserting on behavior and read `generateMealPlan.toString()` for the
dependency's name directly — a case where the source *is* the more reliable
test, because the property under test is "doesn't call X," which behavior can
only demonstrate probabilistically.

**A macro comparison needs a macro that's actually sensitive to the thing
being tested.** A check asserted the rendered protein target didn't shift
with the movement credit — technically true, but for the wrong reason:
`proteinTargetG()` is bodyweight-driven and, for any athlete with a logged
weight, doesn't read `kcalTarget` at all, so the two candidate values were
identical and the assertion would have passed whichever target the code
actually used. A guard (`correctC !== leakedC`) caught it. Carbs, computed as
`(kcal - protein*4 - fat*9)/4`, are the macro that actually moves with a
176 kcal gap — that's what the check needed to read.

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
2. `npm test` — all 22 suites green, zero page errors, validator clean.
   Mutation-test anything newly added.
3. Bump `APP_VERSION` and `CACHE` together.
4. `git fetch origin main && git checkout -B <branch> origin/main`, commit,
   push with `--force-with-lease`.
5. Draft PR → ready → confirm `mergeable_state: "clean"` → squash merge.

   **Never stack new commits on the already-merged history.** A squash merge
   gives `main` a brand-new commit SHA carrying the same content as the PR
   branch's commit — the branch itself still has the pre-squash commit as an
   ancestor. Committing the next version straight on top of that branch (no
   `git fetch`/`checkout -B` in between) leaves two commits with identical
   diffs in the same history: the branch's own pre-squash one and the new
   squashed one it was based on. GitHub reports `mergeable_state: "dirty"`
   for the resulting PR, not a clean conflict — nothing about the message
   says "duplicate ancestor." This happened twice in one session (v219→v220,
   v220→v221), immediately after the exact same fix on the previous round.
   Every version's commit must be rebased onto a **freshly fetched** `main`
   before its own PR is opened, every time — not just after the *previous*
   PR merged, but literally every round, because the previous round's merge
   is what makes the current branch stale:
   `git fetch origin main && git rebase --onto origin/main <old-base> HEAD`,
   then re-point the branch (`git branch -f <branch> HEAD && git checkout
   <branch>`) and force-push. If uncommitted work is in progress when this is
   needed, `git stash push -u` first and pop it back after — rebase requires
   a clean tree.
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
