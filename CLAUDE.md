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
| `tests/` | 22 suites, ~1,907 checks, run by `npm test` |
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

## Feeding the logged load back in (v226)

Two gaps named explicitly as future work when loaded progression shipped
(v221): the logged load never fed back into a real recommendation, and the
Weights track ran on its own clock — no deload, no readiness — while the
main program eased both. v226 closes both, narrowly.

**`loadProgression(exId, pos)` is classic double progression, nothing
fancier.** Last set met the exercise's own rep ceiling (`prescribeCeiling`)
with real room (RIR ≥ 2) → aim `LOAD_STEP_KG` (1 kg, ~2 lb) heavier next
time. Anything short of that — fewer reps, no room, or effort not even
recorded — repeats the same load. **It never auto-decreases.** A silent
regression here would be a second, uncoordinated deload sitting on top of
the one `deloadOn()`/`readinessMult()` already apply — worse than leaving
the number alone. Effort not recorded reads as "no room," not as "assume
room" — the same restrictive-default instinct as everywhere else in this
file. The recommendation is a labeled hint next to an editable field
(`aim for 11kg 📈`), never a value fed silently into `target` math — the
athlete is still logging what they *did*, not confirming a plan.

**A tiny flat step is deliberate, not a placeholder for something smarter.**
Scaling the increment to %bodyweight or a computed "value of a kilogram in
hardness terms" was the exact automation v221 declined to build, calling it
"a worse mistake than leaving the athlete to read their own log." A fixed
1 kg step keeps the same posture: cheap to be wrong about, easy to override,
never presented as a computed prescription.

**Both easing signals gate the SAME recommendation, and had to be proven
independently, not just "a deload week happened to also show it eased."**
The first version of the loadCeilingNote()/openLiftLog() integration check
reused the skill-tree block's own ceiling-maxed setup (`progressPtr` at the
final position) — which for `dragonflag` is *only* ever ceiling-maxed at
week 6, and week 6 is unconditionally the calendar deload week. That
coupling made "climbing" unreachable by construction, not by the code being
wrong — every attempt at that scenario silently landed on "repeat." Fixed by
decoupling the two: `currentRung()` reads `STATE.progressPtr` directly and
ignores whatever `pos` is passed to `atLadderCeiling`/`prescribe`, so the
real maxed position can be kept for the rung check while a copy of that same
`pos` with an earlier week is handed to the ceiling/deload check — a
position object built by hand, exactly like every other block in this file
already does.

**A check on `sets` proves nothing about whether the underlying `target`
moved.** `buildWeightsSession()`'s deload/readiness cut lives in two places:
`sets` (computed once per session) and each item's own `weightsRepsFor()`
call (computed once per exercise). A mutant that deleted the deload
multiplier from `weightsRepsFor()` — leaving only the readiness one — passed
every existing assertion, because all of them checked `sets`, never the rep
count itself. Fixed with a direct before/after comparison of
`weightsRepsFor('dbgoblet')` under an isolated deload (score high today,
slump from two earlier days only) versus an isolated readiness cut (poor
score today, no slump) — proving each signal moves the NUMBER, not just the
set count each signal happens to also share.

**Both signals are independent and must be shown stacking, not just each
individually correct.** `deloadOn()` (slump) and `readinessMult()<0.85`
(today's own score) can both be true at once and both cut a set, same as
`prescribe()`'s own two separate `if` statements. A test data slip caught
this by accident first: using `score: 0` for the "bad" days in a synthetic
slump silently produced `readinessSlump()===false`, because that function
filters on `r.score>0` — a logged 0 is not a real answer the UI can ever
produce, so the filter is correct, but it means slump test data has to use
the real minimum (25), not an arbitrarily low placeholder.

**Timed weights-track items (`kbswing`, `kbcarry`…) bypassed easing
entirely before this — not a new gap `weightsTargetFor()` introduced, but a
pre-existing one it was the natural place to close.** The old code path
computed a rep target only through `weightsRepsFor()`; anything with
`unit==='time'` fell through to `ex.base||30` raw, with no goal, deload, or
readiness adjustment. Since deload/readiness were being wired in anyway,
routing both branches through the same easing logic cost nothing extra and
closed a gap that would otherwise have shipped invisibly next to the one
this session was actually asked to fix.

## Corrective work for a flagged joint, and objective training load (v227)

Two more program-effectiveness gaps, both scoped narrowly on purpose.

**A flagged joint was only ever avoided, never strengthened.** `safeSwap()`
routes a flagged shoulder/knee/lowback around anything risky, and had done
so since the beginning — but nothing ever added anything back. Avoidance
protects a joint from getting WORSE; it does nothing to make it stronger, so
an athlete who flags a shoulder in week 1 is still only avoiding it,
unchanged, in week 54. `correctiveBonus()` adds one light, joint-specific
stability movement on top of the session (never in place of anything),
reusing `focusBonus()`'s own machinery — same `safeSwap`/`spaceSwap` chain,
same deterministic per-session rotation, same session-object shape
(`slot:'corrective'`).

**Scoped to joints where the library has a real, non-flagged, genuinely
targeted movement — not a generic "safe" filler wearing a corrective
label.** `CORRECTIVE_POOL` is `{shoulder:['superman'], knee:['glutebridge'],
lowback:['birddog','deadbug']}`. Wrist and elbow have no such movement in
the catalogue (the closest candidates are all themselves flagged, or are
generic stability holds with no real claim to that specific joint) and are
deliberately left silent rather than offer a mismatched filler — the same
"when a repair has to guess, prefer the restrictive answer" instinct as
everywhere else in this file. `scappull` looked like an obvious shoulder
pick and turned out to be IN `JOINT_RISK.shoulder` itself (a dead hang under
load) — reachable only by actually reading the risk lists, not by the
exercise's name.

**Two checks were vacuous on the first draft, both for the same underlying
reason: the exercise pool used here is small and every entry is
`region:'stability'`.** `prescribe()` already caps `region:'stability'`
sets at 2 regardless of any cap `correctiveBonus()` applies on top, so
asserting the real prescribed item's `sets<=2` never exercised the code's
OWN `Math.min(rx.sets,2)` — fixed by temporarily overriding `prescribe`
to hand back `sets:5` and confirming the cap still clamps it. And a
duplicate-exercise check used fabricated `{done:false, abandonedAt:...}`
log rows with no `completedAt` field at all — in REAL data `completedAt`
is only ever set alongside `done:true` (confirmed by reading `hurtStop()`
and the abandoned-session path in `commitSession()`), so a fixture missing
it passed whether or not the `done` guard existed. Both fixes follow the
same shape: force the specific state the mutation targets, don't rely on
data that happens to look right.

**A real collision needed a real scenario to prove it wasn't happening.**
`glutebridge` sits in both `FOCUS_POOL.glutes` and `CORRECTIVE_POOL.knee` —
a knee-flagged athlete whose focus area is glutes is the one real case
where the focus bonus and the corrective bonus could pick the identical
exercise on the same day. `used.add(bonus.exId)` after the focus-bonus push
(previously absent — `buildSession()` tracked every OTHER slot in `used`
except its own focus bonus) closes it; the test forces `focusPrimary:
'glutes'` with `limitations:['knee']` rather than trusting the seeded
athlete's defaults not to collide by chance.

**Training load tracked as a number, not just felt.** `readinessMult()`/
`readinessSlump()` are both self-reported — exactly the signal a driven,
"tough it out" athlete under-reports right up until they get hurt. `acwr()`
computes the classic Acute:Chronic Workload Ratio (Gabbett et al., 2016):
this week's total logged sets against the trailing 4-week weekly average,
flagging a spike (`>=1.5`, the commonly-cited high-risk cutoff) even on a
day the athlete swears they feel great. `loadSpike()` folds into `deloadOn()`
as a third OR condition, alongside the calendar week and the readiness
slump — an athlete who is objectively overreaching gets the same easing as
one who is subjectively burnt out.

**Same caution as `readinessSlump()`, for the same reason.** A ratio
computed from mostly-empty weeks means nothing — a brand-new athlete in
week 1, or one a couple of sessions back from a layoff (already eased by
`comebackEaseActive()`), must read as "not enough history," never as a
false spike purely for lack of a chronic baseline. `acwr()` requires at
least 3 of the trailing 4 weekly buckets to have SOME logged volume before
it will compute a ratio at all.

**"Training load" was already a UI label, for a completely different
number.** The Progress tab shows `Training load +X% vs start` — `STATE.adapt`
expressed as a percentage, a slow cumulative multiplier nudged ±2-3% per
session. Reusing the same phrase for the new spike banner would read as the
same metric contradicting itself. The banner says "Weekly volume spiked"
instead — different number, different word for it.

**A mutant exposed a real, catastrophic performance regression, and it
was in the check itself, not just the mutation harness.** `deloadOn()` runs
on EVERY exercise of EVERY `prescribe()` call, including historical
sessions the Progress tab reconstructs for its charts — potentially
thousands of calls in one render. The first `acwr()` scanned the whole of
`STATE.logs` once per day queried (28 scans per call): invisible at a
handful of sessions, over 20 million iterations at a year of history, and
the pre-existing 400ms performance budget on the Progress tab caught it
immediately (629-705ms). That budget's own fabricated soak-test data
uses a `date` field, not `completedAt`, so it never actually matched
anything in `acwr()`'s lookup — it only caught the regression because the
SCAN cost was independent of match count. Fixed by building the
date→sets index ONCE per `acwr()` call (`_setsByDateIndex()`) and sharing
it across all 28 day lookups — O(N) instead of O(28×N). A second, direct
benchmark was added alongside it: 300 `deloadOn()` calls against a year of
REAL `completedAt`-matching history, under a 200ms budget — mutation-tested
by reverting to the un-shared per-lookup index rebuild, which pushed a
single test run to 443ms. Relying on the generic performance budget alone
would have caught this by luck twice, not by design.

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

## Full-body compound loading (dumbbell + kettlebell)

The weights library had exactly one genuine full-body compound per implement
— `dbthruster`, `kbcp` — sitting among a set of single-pattern isolation and
regional moves (goblet squat, RDL, row, curl, twist). v224 added `dbcp`,
`dbmanmaker`, `dbdevil`, `dbcarry`, `kbsnatch`, `kbtgu` and `kbthruster`: real
ground-to-overhead and loaded-hinge chains, plus `dbcarry` to close a plain
coverage gap — a dumbbell-only athlete had no loaded carry at all, only
`kbcarry` did.

**A new heavy compound needs the same joint-risk treatment as the rest of the
library, not a pass because it is new.** `dbpress` and `kbcp` shipped
unflagged once and came through 153 and 147 contraindicated weights circuits
before `safeSwap` covered this track (see the weights-circuit note above).
Every one of the seven new entries is flagged in `JOINT_RISK` for whatever it
actually loads — shoulder for anything locked overhead, lowback for anything
hinging or cleaning off the floor under load, wrist for anything gripping the
implement from a plank — and carries a `SAFE_SWAP` entry that lands on
`dbgoblet` / `kbgoblet`: a squat pattern in the same equipment family, so a
flagged athlete keeps training on the kit they own instead of losing the slot
to a bodyweight fallback. `dbcarry` carries no flag at all, matching
`kbcarry`'s existing precedent — a loaded carry is close to self-limiting and
was never on the list.

**The generic "flagged joints don't leak" sample proves the swap mechanism;
it cannot prove new content was ever flagged in the first place.** That
suite's assertion is `risky.length === 0` over whatever `buildWeightsSession()`
returns — an exercise nobody added to `JOINT_RISK` simply never enters the
`risky` bucket, not because it is safe but because `risky()` was never asked
about it. It would pass whether or not any of the seven new movements carried
a flag at all. The check that actually catches a missing flag asserts
`JOINT_RISK` membership directly, per exercise, independent of the sample —
and it earned its keep in mutation testing: dropping `dbmanmaker` from the
wrist list crashed the FIRST version of that check instead of failing it, because
a `sameFamily` assertion read `EX[k].equip.length` without guarding a
possible `undefined` — the same "guard immediately after computing the value
the rest of the block depends on" lesson as the builder-pool hang, this time
caught before shipping rather than after.

**Not every escaped mutant is a check defect.** Pointing `SAFE_SWAP.dbcp` at
`dbpress` (itself shoulder-flagged) did not fail the "lands somewhere safe"
check, because `safeSwap`'s own chain resolved it in a second hop —
`dbpress`'s existing swap to `dbfloor` absorbed the injected defect. The
athlete still lands somewhere safe on kit they own either way, so the
non-catch is correct: it is testing the outcome that matters (does the
athlete end up safe) rather than the specific hop that produces it. A
*self-referencing* swap (`dbcp:'dbcp'`) is a different animal — `safeSwap`
breaks its chain the moment a hop returns the same id, falls through to the
equipment-FREE regional fallback, and hands a dumbbell-owning athlete a
bodyweight substitute for a movement they have the kit to do safely. That one
the "stays in family" check catches directly; the pre-existing "no swap needs
equipment its source lacked" check does not, because a self-loop declares no
extra equipment at all.

**The images do not exist yet.** All seven exercises shipped in v224 with a
placeholder JPEG (`800×800`, grey studio backdrop matching the real photo
set, name + "PHOTO PENDING" centered) rather than a missing file — `sw.js`'s
precache list is asset-existence-checked at test time (`01-data.test.mjs`),
so referencing a file that is not on disk is a shipping-blocker, not a
runtime-only concern the `onerror` fallback quietly absorbs. v225 (same
session) replaced all seven with the real generated photos, same filenames,
no code change — confirming the drop-in worked as designed.

**A ChatGPT grid of several exercises in one image needs the same
equipment-identity discipline as the data it illustrates.** The first
generation put the kettlebell thruster shot in a 7-pose contact sheet where
every other pose used dumbbells — it rendered hex dumbbells instead of
kettlebells, because nothing in the prompt anchored the equipment's SHAPE
against the surrounding context bleeding in. The fix was not a stronger
"kettlebell" keyword; it was spelling out the object itself ("a solid round
cast-iron ball with a single thick curved handle... NOT a hex-head
dumbbell") and regenerating that one pose standalone, outside the mixed-kit
grid. Splitting a multi-exercise photo request into one generation per
exercise — rather than one grid covering several — removes the cross-pose
bleed entirely and was the actual fix used here.

**Extracting individual exercise photos from a contact-sheet grid needs the
same care as any other image edit.** The seven-pose sheet had two different
internal grids (4 columns on top, 3 wider columns on the bottom), found by
scanning for nearly-white, nearly-uniform gutter columns/rows rather than
assuming a fixed cell size — a fixed guess would have sliced through a
photo's edge on the wider bottom row. And a naive flat-color pad to square
the narrower crops up to 800×800 left a visible rectangular seam against the
backdrop's vignette (brighter center, darker corners); the first fix
(bluring the whole padded strip) made it worse, smearing directional
streaks from single-pixel edge colors. What worked: sample the backdrop tone
near each edge, then feather a ~50px blend from that flat tone into the
real edge pixels — matching the vignette's gradient instead of fighting it.

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

## Daily readiness (sleep, soreness, energy auto-regulation)

`readinessMult()` reads today's 3-question check (sleep/soreness/energy,
averaged to one score) and scales `prescribe()`'s target directly —
`s>=80?1.05:(s>=60?1.0:(s>=40?0.82:0.7))` — and cuts a set on top when the
multiplier drops below 0.85. `readinessSlump()` persists the signal: three
sub-55 days in a row folds into `deloadOn()` as a real unload, not three
independent 18% trims. This already existed as a full feature (not a gap) —
a separate "sleep tracking" feature proposed in the same session would have
been a second, parallel system next to it.

**An audit of an existing feature is not the same question as "was it ever
verified."** `readinessSlump()` had real coverage (the timezone bug, the
corrupt-record repair); `readinessMult()`, `saveReadiness()`, `openReadiness()`
and `readinessCardHTML()` had none. Reading the code was not enough to know
that — this is exactly the `focusBonus()` shape (CLAUDE.md above): a control
that looks wired in can still be a dead input in the actual output. Verified
by fingerprinting `prescribe()`'s real target across a spread of readiness
scores at a real calendar position, in both directions — the multiplier
does move the number, and moves it monotonically the right way.

**A percentage swing on a small integer rounds away.** The first version of
that check compared `great (95, ×1.05)` against `no-readiness (×1.0)` — only
a 5% gap — on a freshly-booted, unseeded test context where `prescribe()`'s
raw numbers were small enough (target ~4) that `Math.round()` collapsed the
difference to the same integer for both. It escaped as a **false failure**
(a real behavior, wrongly asserted as absent) rather than a false pass — the
mechanism is the same one CLAUDE.md keeps naming for the opposite direction:
a check needs a scenario engineered to discriminate, and "compare against a
5% swing on an un-seeded athlete" doesn't have the power to. Calling
`seedAthlete()` (which every other block in this test file already assumed
implicitly by reusing the top-level page, but this block opened its own
fresh browser context and never called it) put the raw numbers back in a
range where a 5% swing survives rounding.

**A DOM-scraping check has to match the actual attribute order, not the
order in your head.** `opt()` renders
`` `<button class="chip ${on?'on':''}" onclick="...">${emoji} ${label}</button>` ``
— `onclick` sits between the class and the closing `>`. A regex written as
`/class="chip on">🥱 Poor/` assumes `class` is the last attribute and can
never match against the real markup; it needs `/class="chip on"[^>]*>🥱 Poor/`.
Both of this check's assertions (chip shows selected before save, chip
pre-fills on reopen) silently read as "chip never on" until the pattern was
fixed — caught by mutation-testing a "the chip never marks on" defect and
finding the check passed on BOTH the clean file and the mutant.

**`closeSheet()` clears `#sheet`'s markup on a 400ms `setTimeout`, not
synchronously** — the DOM read this file already used a moment earlier
(`document.body.textContent`/scan patterns) would read stale content if
checked immediately after a save-and-close. What clears synchronously is
the scrim's `open` class, which is what "the sheet is closed" should assert
on. Reading the sheet's own re-render *is* safe synchronously, because
`openReadiness()`'s `openSheet()` call sets `innerHTML` directly with no
timer involved — only the teardown path is deferred.

## Joint-aware warm-up, and the bike's missing memory (v228)

Two gaps, both the same shape: a system that had one half of a loop and not
the other.

**`safeFlow()` only SUBTRACTS.** It strips Arm Circles for a flagged
shoulder and Glute Bridges for a flagged knee and adds nothing back, so the
athlete who most needs prep got *less* warm-up than an unflagged one. That
is backwards, and it is the same principle `correctiveBonus()` (v227) had
already established for the session itself: avoidance is not enough, add
real prep. `jointAwareWarmup()` runs BEFORE `safeFlow()` in `runWarmup()`
and inserts one joint-specific item.

**The added item must not be a name `FLOW_RISK` already knows.** Flow items
carry a NAME, not an exId — that is the whole reason `FLOW_RISK` is
name-keyed — so naming the low-back addition `'Glute Bridges'` or the
shoulder one `'Arm Circles'` would let `safeFlow()`, running immediately
afterwards, strip the very item just added for that exact joint. The
distinct names (`'Spine Stability Prep'`, `'Shoulder Activation'`,
`'Knee Prep — Glute Bridge'`) are load-bearing, not cosmetic, and the check
that proves it asserts the added item **survives `safeFlow()`** rather than
merely that `jointAwareWarmup()` returned it. Mutating the low-back entry's
name to `'Standing Torso Twists'` (a real `FLOW_RISK` lowback entry) is what
demonstrates that check can fail.

**One bonus item, first flagged joint wins** — matching `correctiveBonus()`
exactly. A warm-up that grows by one item per flag is a warm-up that gets
longer the more limitations an athlete declares, which is the wrong
direction for the athlete least able to sustain it.

**`nutToday()` is a brand-new object every day, so a per-day field is not a
setting.** `BIKE_LEVELS` had a real intensity dial stored only in
`nutToday().bikeLvl` — so it silently reset to `'steady'` every single
morning. Nobody noticed because the reset looks exactly like a fresh day.
`setBikeLvl()` now also writes `STATE.profile.bikeLevel` and `movement()`
falls back to it before defaulting. **Any dial the athlete sets that is
stored in `nutToday()` needs to ask whether it is today's data or the
athlete's preference** — the former belongs there, the latter does not.

**And the dial had no memory of how any ride went.** `rateBikeRide()` /
`bikeLevelSuggestion()` give it the same double-progression rule
`loadProgression()` (v226) gave loaded work: three easy rides in a row at
the SAME level suggest the next one up. Suggestion only, never applied —
same posture as `loadCeilingNote()`'s "aim for" hint. Rating anything other
than easy resets the streak to zero, and *switching levels* resets it too
(`cur.level===lvl?cur.streak:0`), because three easy rides spread across
three different intensities is not evidence about any one of them.

**The rating only appears where the level system exists.** `ivDone()` gates
it on `INTV.seq[0].exId==='bike'` — a sprint or a rope session has no
`BIKE_LEVELS` behind it, and offering a dial-progression prompt for one
would be a control wired to nothing. That gate needs mutants in **both**
directions: forcing it false and forcing it true each kill a different
check, and a suite that only proves the bike shows it would pass on a
version that shows it to everybody.

**A behaviour change that makes a value persist breaks tests that assumed
it did not, and the failure looks like a bug in the new feature.** A
pre-existing check in `07-movement.test.mjs` — "a day with nothing logged
reads as zero" — cleared `nutToday()`'s per-day fields and asserted
`movement()` read `lvl:'steady'`. It broke, but not because persistence is
wrong: an *earlier block in the same file* iterates
`BIKE_LEVELS.map(b => (setBikeLvl(b.k), …))` and leaves the last one
(`'intervals'`) persisted. "Empty day" now spans two layers — the daily
override and the carried-forward default — and the check has to clear both.
Sequential `page.evaluate()` blocks in one suite share persistent `STATE`,
so a new persistence layer is a new way for block N to reach block N+10.
Every new block added here saves and restores what it touches
(`const keep = JSON.stringify({…})`) for exactly this reason.

## Data safety and serviceability (v229)

Three gaps, none touching the exercise engine — the app's only copy of an
athlete's progress lives in one browser's storage, and nothing helped the
athlete protect or diagnose it.

**`importData()` was the one destructive action with no guardrail.**
`hardReset()` asks TWICE and tells the athlete to back up first; restoring a
backup is equally destructive — it fully replaces `STATE` — and asked
nothing. The wrong file (an old export, a friend's) silently erased
everything since, with no warning and no way back. It now confirms once
(quoting the backup's own `_saved` date so the athlete knows what they are
about to load), and snapshots the STATE it is about to overwrite into a
separate, un-mirrored `localStorage` key (`PREIMPORT_KEY`) first — one step
back, not a history, matching this file's other narrow safety nets
(`loadProgression()`'s flat 1kg step, `bikeLevelSuggestion()`'s "aim for"
hint): cheap to be right about, consumed after one `undoImport()`, no undo of
an undo.

**`validateData()`'s findings only ever reached `console.error`**, which no
real athlete ever opens — and the ORIGINAL boot-time call was never even
checking their data. `boot()` runs `validateData()` before `load()` resolves,
against `DEFAULT_STATE()`'s own nutrition object, not the athlete's real diet
or allergens — a smoke test on the shipped data tables, unconditional of who
is using the app, not a check on this athlete's own STATE. `boot()` now also
diffs `normalizeState()`'s before/after JSON and re-runs `validateData()`
against the REAL loaded STATE, and `dataHealthNoteHTML()` surfaces either
signal in Settings — the same "clear on every boot branch, not only where it
was set" discipline `dietRepaired` already established, so a flag from a
past repair cannot outlive the athlete acknowledging it (or a later boot that
finds nothing left to fix).

**A "was anything repaired" diff has a real false-positive mode: routine
bootstrapping is not a repair.** The first version fired on literally every
fresh install, before onboarding — `normalizeState()` legitimately adds
scaffolding beyond what `DEFAULT_STATE()`'s own literal pre-populates, which
is normal first-boot behavior, not evidence anything about an athlete's data
was wrong. Gating the whole diff on `STATE.onboarded` already being true
*before* that boot's `normalizeState()` call scopes it to what it is
actually meant to catch: an already-onboarded athlete's stored data needing
a real repair.

**Building the diff check surfaced a live, currently-shipped regression of
the exact bug it already fixed once.** `normalizeState()` had
`if(typeof STATE.settings.voicePitch!=='number')STATE.settings.voicePitch=0.6;`
running near the TOP of the function, unconditionally, on every call where
the field is absent — and the one-time `_toneFix` migration that clears a
legacy `voicePitch:0.6` runs much later, gated on `if(!_s._toneFix)`. On an
athlete's first-ever boot this looked fine: the unconditional line sets
`0.6`, then `_toneFix` immediately clears it and marks itself done. But on
**every boot after that**, the unconditional line still fires (the field is
absent again), re-adding `voicePitch:0.6` — and the one-time guard is now
`true`, so nothing removes it a second time. Net effect: every athlete's
SECOND app open, forever, silently re-broke the exact "every coach speaks in
the same voice" bug the `_toneFix` migration exists to fix, and nothing in
the existing suite caught it because no check called `normalizeState()`
across two separate real boots — a fresh install runs it once, and every
`seedAthlete()`-based test evaluates the SAME loaded session rather than
reloading. The fix deletes the unconditional default outright: every reader
(`localPitchFor()`, the Settings slider) already treats "absent" as "no
manual override," which was the entire point of `_toneFix` in the first
place — restoring a default was the bug.

**No reminder existed to export a backup at all.** `backupNudgeHTML()`
mirrors `driftBanner()`'s exact posture — rendered above the
`dayInWeek===0` branch in `renderToday()`, per the rule below. It reads
three signals: account age (a brand-new athlete gets time to ramp up before
being nagged), days since `STATE._lastExport` (written by `exportData()`
itself, so a real export always clears it — no separate "I did it" flag to
forget to set), and a dismiss timestamp. All three use the exact
`Math.round((new Date(todayISO())-new Date(iso))/86400000)` idiom
`daysSinceTrained()` already uses beyond its own 90-day scan — both sides
parsed from a bare `YYYY-MM-DD` land on UTC midnight, which is what makes
the subtraction immune to the local DST shift that bit `readinessSlump()`.

**`_dataRepaired`, `_lastExport` and `_backupNudgeDismissed` all needed the
same TRANSIENT_KEYS judgment call `_undo`/`_plResume` already established.**
A repair flag or a nag-dismiss timestamp describes what happened on THIS
device, not a fact about the athlete — restoring an old backup onto a fresh
phone should not import a stale "I already saw that repair note" from
wherever the backup was made. `_lastExport` is the opposite case and was
kept: like `_saved`/`_savedAt`, it is informational device history that a
restored backup carrying it forward is harmless, even mildly correct.

**Testing a `confirm()`-gated action broke an existing test that called it
directly**, the same trap this file has now hit for `restartProgram()` and
`clearAzureKey()`: `13-feedback.test.mjs` called `importData()` to prove a
legacy backup's transient keys get stripped, and the new confirm gate made
every assertion after it read the PRE-import state, since `confirm()`
defaults to declining in headless Playwright. Same fix as always — stub
`window.confirm = () => true` around the call, restore after.

**Two of the fourteen mutants seeded against this round's new checks escaped
on the first pass, both for the same reason: a test that only exercises the
ACCEPT path of a confirm-gated action never proves the DECLINE path does
anything.** Every check in the import-undo test used `window.confirm = ()
=> true` throughout except the one dedicated decline scenario for
`importData()` itself — `undoImport()`'s own confirm was never declined, so
deleting its `if(!confirm(...))return;` passed clean. And the voicePitch
regression fix (above) had no check calling `normalizeState()` across a
genuinely absent value more than once — the existing "migration runs once"
test always re-set `voicePitch` to `0.6` before the second call, which tests
a *different* invariant (an athlete's deliberate `0.6` is not clobbered
twice), not the one that broke (an absent value must stay absent). Both
fixes follow the same shape as the rest of this section: find the specific
scenario the passing suite never actually constructed, not just add another
assertion next to the ones that already pass.

## App-store listing quality (v230)

Prompted by "what would Apple/Google Play check before listing this" —
narrowed, on the user's explicit steer, to genuine functional/store-quality
gaps rather than legal paperwork the user does not want time spent on.

**A privacy blurb that omits a real outbound call is worse than no blurb.**
`privacyNoteHTML()` named two opt-in, key-gated third parties (Azure, Gemini)
and stopped there — but packaged-food search and barcode scanning hit the
free Open Food Facts database with **no key and no opt-in gate at all**,
and the note never said so. Fixed by naming it explicitly (search term or
barcode only, never anything about the athlete) and linking to a full
policy page (`privacy.html`) and terms page (`terms.html`) — both static,
outside the single inline `<script>`, since they are legal documents rather
than application logic and the user does not want them touched again absent
a specific ask.

**A maskable icon that reuses the "any" icon file usually is not actually
maskable.** The manifest pointed `purpose:"maskable"` at the exact same
512×512 photographic portrait used for `purpose:"any"` — full-bleed, with
the subject's crossed arms running to the frame edges. An OS that crops a
maskable icon to a circle or squircle would cut into the elbows/hands,
because nothing in the source image left room for that crop. Fixed by
generating a real maskable variant: the subject scaled to 80% (the
conventional maskable safe zone) and centered on a canvas filled with the
photo's own backdrop tone — sampled from the source image's corners, not
guessed — so the safe zone survives any OS mask shape. A naive hard paste
of the scaled photo onto the flat fill left the exact rectangular seam this
file's contact-sheet extraction note already documents; the fix was the
same one used there — feather the paste mask with a Gaussian blur so the
boundary blends into the flat fill instead of fighting it, rather than
trying to match the fill color more precisely.

**`manifest.webmanifest`'s `screenshots` array has to be real screenshots
of the real app, not a placeholder.** Generated via the existing Playwright
test harness (`seedAthlete()` + `waitForBoot()`), at the app's actual mobile
viewport, of Today/Fuel/Progress with a fully-seeded athlete so they show
real content rather than an empty onboarding state. Caught one thing the
manual approach could not have skipped past silently: the branded launch
splash (`#splash`, dismissed by `hideSplash()` ~850ms after boot, then a
600ms fade-out) was still fully opaque in the first attempt's screenshots
because the script screenshotted before it cleared — the fix is to wait
past that window (or call `hideSplash()` directly) before capturing, the
same "read back synchronously, do not let an unrelated timer land inside
your wait" lesson this file's tap-repaints-the-UI note already draws,
just on the other side: here the wait was too SHORT, not accidentally too
long.

**Every shipped asset must be in some precache tier, and that invariant
caught its own violator immediately.** Adding the new icon and screenshot
files without also adding them to `sw.js`'s tiers failed suite 12's
"every shipped asset is in some tier" check on the first run — exactly the
gap that check exists to catch. The three screenshots went in `EXTRA`
(least essential — they're read only by the browser's own install-prompt
UI, never fetched by the running app) rather than `SHELL_MIN`.

**A comment placed INSIDE a tracked `sw.js` array literal can break the
test that parses it, for a reason that has nothing to do with the code
being wrong.** Suite 12 extracts each tier's contents with a regex that
scans between single quotes (`/'([^']+)'/g`) — a first attempt put an
explanatory comment inline inside `EXTRA`'s array literal, and the comment
contained the word "browser's". That stray apostrophe paired with a later
quote to fake a matched "string," corrupting the parsed asset list and
producing two unrelated-looking failures (a bogus "asset appears in two
tiers" and a bogus "references a file that does not exist") from one typo.
Comments belong **outside** array literals that a test's own naive parser
walks, not folded in as an inline aside — the array's plain-text contract
with its own test is as real as the array's contract with the service
worker.

## Functional quality pass (v231)

The user redirected mid-audit: not interested in store paperwork, wanted
crashes/dead-ends/broken-functionality checked instead — the actual thing
Apple/Google review for beyond the listing metadata. A dedicated pass
(driven live with Playwright, both fresh-onboarding and seeded) found two
real defects; a static cross-reference of every `onclick`/`onchange`
handler against defined functions, and a broad interactive sweep of all
six tabs, found none.

**A promise printed in the onboarding copy had no code behind it — the
exact shape CLAUDE.md already names ("write a reassurance into the UI,
grep for the code that enforces it").** The day-picker's own label reads
"Five days is the floor... keep at least five," and nothing checked it:
`obStepError(n)` only ever validated step 1 (`if(n!==1)return null;`), so
1-4 selected days sailed through both first-run onboarding AND the
identical edit-profile path (`openProfileEdit()` reuses the same wizard).
Downstream, `weeklyTarget()` reads `STATE.profile.days.length` directly,
so the Progress tab's own weekly target silently shrank to whatever was
picked instead of holding the floor the athlete was told about.

Fixed at the step-5 gate (`obStepError`, mirroring step 1's existing
age/height/weight pattern) so the wizard's own "Next" button blocks
advancing — plus, independently, hardened `obReadForm()` itself (the
actual write path into `STATE.profile.days`) to refuse persisting fewer
than 5 regardless of how it's reached. **Two mutants exercised exactly why
both layers earned their keep**: an off-by-one (`chosen<4` instead of
`chosen<5`) escaped a check that only ever tried 2 days and 5 days — it
needed the boundary itself, exactly 4, tested directly; and reverting
`obReadForm()`'s floor escaped every check driven through the wizard's own
UI, because the UI gate is unreachable-in-practice defense for that second
layer — it needed a check that calls `obReadForm()` directly, bypassing
`obBlocked()` entirely, to prove the write path holds the line on its own
rather than trusting a caller already validated it.

**`runFlow()`/`flowHTML()` — warm-up, cool-down, and all three mobility
flows — is the guided player's "third twin" CLAUDE.md already names as the
one that keeps drifting behind the other two, and it had drifted on the
exact overflow rule the other two were fixed against.** It stacked a
separate `max-width:260px` image ABOVE a separate fixed `220×220` ring —
the guided player's own pre-consolidation layout, from before
`plRingMediaHTML()` moved the photo inside the ring. Measured overflow: 127px
past the fold at 375×667, 106px at 412×690 — Stop/Done and the cue text
were below the visible screen on ordinary phone sizes, for a feature whose
whole design premise is hands-free.

Fixed the same way `.pl-ring` was: the media moved inside the ring
(reusing `.pl-ringmedia` directly rather than inventing a parallel class),
and `.timerring` went from a fixed square to `height:min(220px,72vw,40vh)`.
**One of those two changes turned out to do almost all the actual work, and
mutation testing is what caught it.** Reverting `.timerring` to a fixed
220px alone produced ZERO measurable regression at 375×667, 412×690, or even
320×568 — moving the media inside the ring had already reclaimed enough
vertical space to fix the reported bug on its own, so a check built only
against portrait phone sizes could not tell a responsive ring apart from a
fixed one. It took a genuinely constrained real scenario — landscape
orientation, where `manifest.webmanifest`'s `orientation:"portrait-primary"`
declares the app does not target the case but a phone rotated mid-session
still happens — to find where the responsive sizing is load-bearing: 175px
of overflow with a fixed ring, 85px with the responsive one. The check
does not claim landscape is fixed (it visibly isn't), only that the
responsive sizing measurably helps where it can, which is what the CSS
change actually does. **An escaped mutant that reveals a change never had
observable effect at the sizes tested is not automatically a bad mutant to
discard** — before concluding that (per CLAUDE.md's own "an escaped mutant
is sometimes a bad mutant" note), it is worth searching harder for a real
scenario where the change *does* matter, the way this one did.

## Three new core exercises (v232)

Requested directly: "3 of the most effective core and abdominal exercises."
A survey of the existing ~50-entry core/ab roster (`anterior`, `oblique`,
`lower`, `stability` regions) found nearly every commonly-cited "most
effective" movement already present — dead bug, hollow hold, hanging leg
raise, ab wheel rollout, V-up, reverse crunch, the full plank family. Two
genuine gaps: a Pallof press (loaded anti-rotation) and a true standing
woodchopper (loaded diagonal rotational power) — neither existed under any
name. The third, `dragonflagfull`, isn't a new movement pattern so much as
the missing top rung: the roster had only the bent-knee Dragon Flag,
never the full straight-leg version that's the *actual* famous exercise.

**Neither the Pallof press nor the woodchopper could ship as their
textbook cable/band versions — this app's gear list has no cable or
band category, and adding one for a single exercise each didn't clear the
bar.** Both are standard, real trainer-taught variations using equipment
already in the picker: `dbpallof` (Dumbbell Pallof Press, standing,
anti-rotation) and `mbchop` (Medicine Ball Woodchopper, standing, loaded
diagonal chop) — `equip:['dumbbell']` and `['medball']` respectively,
`pattern:'core'` matching every other gear-based core entry (`dbtwist`,
`mbtwist`, `kbhalo`). No new equipment category, no new gear-picker UI.

**An anti-rotation press and a loaded rotation move are opposite risk
profiles, and the joint-risk flags say so.** Pallof presses are what
physical therapists actually prescribe FOR a flagged low back — the whole
point is resisting rotation, not moving through it — so `dbpallof` carries
no `JOINT_RISK` flag at all, matching `dbtwist`'s own precedent. The
woodchopper is a ballistic, loaded, standing rotation — mechanically the
same risk as the seated `mbtwist`/`russiantwist` family already flagged
`lowback` — so `mbchop` got the same flag, with no explicit `SAFE_SWAP`
entry needed, falling through to the same generic regional fallback
`mbtwist`/`mbsitup` already rely on without one.

**`dragonflagfull` inherits every flag and swap target the bent-knee rung
already carries — same movement pattern, same risks, just harder.**
`equip:['bar']`, `optional:true`, both `shoulder` and `lowback` in
`JOINT_RISK`, `SAFE_SWAP.dragonflagfull:'hollow'`,
`LOWBACK_SWAP.dragonflagfull:'plank'`, and the same hardcoded gear-fallback
override (`if(exId==='dragonflagfull'&&!hasBar){exId='hollowrock';}`) the
bent-knee rung already has — added rather than left to the generic
ladder-walk fallback (which would have landed on `lsit` instead), so the
two rungs of the same movement don't quietly diverge to different
substitutes for no reason. It sits ABOVE `dragonflag` in `hollowL`, making
`dragonflag` a middle rung for the first time since it shipped.

**That reordering broke two pre-existing, passing tests, and both breaks
were correct — the tests had hardcoded an assumption that was only ever
true by construction, not by contract.** `22-loaded.test.mjs` had two
blocks built around "`dragonflag` is the ceiling-maxed top of `hollowL`
for the seeded athlete" — true right up until a harder rung existed above
it. Swapping the test subject to `dragonflagfull` surfaced a real
calibration gap: its raw `prescribe()` target (unanchored, since
`anchor:null` — the unanchored branch scales off `base`, not `hardness`,
which only matters for the anchored branch and the ladder-monotonicity
check) came in at 7 against a `repCap` ceiling of 8, one short. `base`
went from 4 to 5 to actually clear it. **Hardness alone does not predict
whether an unanchored exercise's prescription reaches its own explicit
repCap — only `base` does, for that branch — and tuning it needs the real
number probed, not inferred from the anchored-branch mental model that
governs most of the roster.**

**A third, unrelated pre-existing test failure surfaced by chance, in the
full-suite run only — never in isolation.** `21-integrity.test.mjs`'s junk
liftLog-row test planted `localStorage` and reloaded immediately, racing
`save()`'s 120ms IndexedDB mirror exactly the way CLAUDE.md's own state
durability notes already describe — the full-suite run apparently
schedules just differently enough for the race to lose reliably, while
100 isolated runs never lost it once. Confirmed against the CLEAN
pre-exercises baseline before touching anything, so it was clearly not a
regression from this round — fixed anyway (beating the mirror with
`idbPut()`, the same technique `05-state.test.mjs` already uses) since a
suite that only passes in isolation is not the green the ship gate
actually requires.

**A generic joint-safety sweep already existed and already covered the
new exercises for free** (`02-safety.test.mjs`'s "safeSwap always lands
clear across all 31 joint combinations" walks every key in `EX`), which
is exactly why the new dedicated block in `01-data.test.mjs` mutation-tested
clean on the first pass for eight of nine seeded mutants. **The ninth
mutant is a legitimate non-catch, the same shape CLAUDE.md's own
`SAFE_SWAP.dbcp` note already documents**: routing a flagged low back's
`mbchop` to the also-flagged `mbtwist` didn't fail the "lands somewhere
safe" check, because `safeSwap()` resolved it in a second hop to something
genuinely safe. The check tests the outcome (does the athlete end up
somewhere safe), not the specific hop that produces it — and the outcome
was correct, so the non-catch is correct too.

Images shipped as the same 800×800 grey-backdrop "PHOTO PENDING"
placeholders v224 established, added to `EXTRA` (least essential — none of
the three are core-program staples; they only surface through the focus
bonus with the right gear owned). ChatGPT prompts for the real photos were
handed to the user rather than generated in-session, matching the
established equipment-identity discipline (one generation per exercise,
explicit shape description, never a mixed-equipment grid).

**The first generated Dragon Flag photo revealed exactly what the prompt
was missing, and it was a real lesson in how to brief an image model.**
The athlete had just bought a 25lb and a 31lb kettlebell and asked for a
prompt fix. The first attempt (floor mat + pull-up rig) rendered as a
hanging row — feet planted on the mat, torso reclined at an angle, nothing
actually suspended, because a floor scene gives the model no reference
plane to show a body floating in open air. The fix wasn't more adjectives
about straight legs; it was giving the model a *surface to hover above* —
switching to a flat bench and demanding, twice, a visible gap of empty air
between the body and the bench. Composition beats description: the model
needed something to show absence *against*, not just instructions to
"suspend" a body in a void.

## Five new kettlebell exercises (v233)

Requested directly, in the same breath as the Dragon Flag prompt fix: "I
now have a 25lb and a 31lb kettlebell — give me more core and compound
full-body kettlebell exercises." A survey of the existing 12-entry `kb*`
roster found swing, goblet squat, Turkish get-up, snatch, clean & press,
RDL, farmer's carry, thruster and halo all already present — genuinely
missing: windmill, suitcase carry, figure-8, renegade row, and sumo
deadlift high pull. Three core-focused, two compound full-body, matching
the two categories asked for.

**Kettlebell load tracking already existed and needed nothing new.**
`liftLog`/`loadKg`/`loadToKg`/`loadProgression()` are keyed by `exId`, not
by equipment type — a kettlebell exercise flows through the exact same
double-progression pipeline a dumbbell one does. The athlete owning two
*specific* bell weights (25lb, 31lb) doesn't need a `KB_LEVELS`-style
dial the way `BIKE_LEVELS` needed one — that dial existed because
`nutToday()` reset the chosen intensity to `'steady'` every single
morning with no data behind it. A kettlebell's weight is a number the
athlete types into the lift-log once and the app remembers it verbatim;
there was no missing mechanism to build, only exercises to add to the
one that already runs everything else.

**The two new core movements deliberately do NOT share a joint-risk
profile, and calibrating each against its nearest existing sibling is
what got both right.** `kbwindmill` — a locked-out overhead hold combined
with a loaded hip hinge — is flagged both `shoulder` (same reasoning as
`kbsnatch`/`kbtgu`, which also lock a bell overhead) and `lowback` (same
reasoning as `kbswing`/`kbrdl`, both loaded hinges), landing on
`kbgoblet` like every other flagged kb overhead/hinge movement.
`kbsuitcase` (a single-arm carry) and `kbfigure8` (a light circling
pass-around) are deliberately left **unflagged**, matching their closest
siblings — `kbcarry` (bilateral carry) and `kbhalo` (circling around the
head) — neither of which carries a flag either. A single-arm carry is, if
anything, closer to what a physical therapist prescribes for a weak low
back than a risk to it.

**`kbrenegade` inherits `dbrenegade`'s exact risk profile and swap
target, not a fresh guess.** Same plank-row pattern, same `wrist` flag
(the off-center load stresses the wrist in a plank identically regardless
of which implement is doing the loading), same landing spot (`kbrow`,
mirroring `dbrenegade:'dbrow'`). The one deliberate difference: a
kettlebell's rounded bottom makes the balance demand more honest than a
hex dumbbell's flat one, which the `why` field says outright rather than
copying the dumbbell version's copy verbatim.

**Three of ten mutants seeded against the new checks survived, and all
three are legitimate — the same non-catch shape this file already
documents for `SAFE_SWAP.dbcp` and `mbchop`, just doubled up.** Dropping
the explicit `SAFE_SWAP` entries for `kbwindmill` and `kbrenegade`
independently escaped the "lands somewhere safe" check both times,
because `safeSwap()`'s own generic same-region/same-unit fallback finds
an equally safe landing spot even with no map entry at all — the outcome
the check actually cares about held regardless of the specific mechanism
producing it. A third mutant (adding an unused `SAFE_SWAP.kbsuitcase`
entry to an exercise that was never flagged in the first place) was a
weak mutant on this file's own part, not a real gap: an unused map entry
for an unflagged exercise is dead code, and the check correctly has
nothing to say about dead code.

## Two more roster gaps: standing ab-wheel rollout, battle-rope plank (v234)

Asked directly, after the kettlebell round: "are there any more effective core
workout you would like to add to this program?" Two genuine marginal gaps
after three heavy rounds of additions — a harder progression above the
existing kneeling ab rollout, and a core-region move for the battle rope the
athlete already owns (`ropeslam`/`ropewave` are power/cardio, not core).

**`abrollstand` inherits `abroll`'s ENTIRE risk profile, not a fresh guess.**
Removing the knee anchor doesn't remove any of the three ways the kneeling
version already stresses the body — it makes all three more honest, since the
whole body (not just the torso) now has to control the fall and the return.
Same `shoulder`/`wrist`/`lowback` flags, same `SAFE_SWAP`/`LOWBACK_SWAP`/
`GEAR_FALLBACK` landing spot (`plank`), same standalone status — `abroll`
was never in a `LADDERS` array, reached only through the focus bonus, and
`abrollstand` follows the identical shape rather than inventing a two-rung
ladder for a pair that was never meant to be one.

**`ropeplank` is a controlled isometric hold, not a slam, and the flag has to
say so.** The rope library's existing entries (`ropeslam`, `ropewave`) are
both `shoulder`+`lowback`-flagged ballistic movements. A plank that adds
small wrist-driven waves is mechanically much closer to `bearhold`/
`isoclimber` — the two existing plank-family holds, both flagged `wrist`
only, neither `shoulder` nor `lowback` — than to a rope slam. Flagging it
like its rope siblings rather than its plank siblings would have been the
easy, wrong copy-paste.

**One mutant was a legitimate non-catch, the same shape this file has now
documented four separate times.** Dropping `ropeplank`'s explicit
`SAFE_SWAP` entry didn't fail the "lands somewhere safe" check, because
`safeSwap()`'s own generic same-region/same-unit fallback finds `plank`
without it. The outcome the check cares about — does a wrist-flagged
athlete end up somewhere real and unflagged — held regardless of the
specific map entry, so the non-catch is correct and the entry stays for
clarity, not because the check needs it.

Images shipped as the same 800×800 grey-backdrop "PHOTO PENDING" placeholders
established in v224, added to `sw.js`'s `EXTRA` tier. ChatGPT prompts for the
real photos were handed to the user rather than generated in-session.

## Real photos landing after the fact (v235)

Six real photos the athlete had already generated and reviewed earlier in
the same session — `dbpallof`, `mbchop`, `dragonflagfull` (the corrected
bench version), `kbwindmill`, `kbsuitcase`, `kbrenegade` — had been shown
and approved in chat but never actually written into the repo. Chat images
are not a durable handoff: viewing and approving an image in the
conversation does not put a file on disk anywhere the build can reach.
Asked directly "do we need any more images," the actual answer required
checking disk state, not memory of what was discussed — the uploaded
originals were still sitting in the session's upload directory, confirmed
against the corrections history (kbfigure8 and kbhighpull's FIRST attempts
are also there, and are the ones already documented as flawed — figure-8
read as a static hold, high pull read as a static upright row — so those
two stay on placeholders pending a v2 generation, not swapped in wrongly).
Resized 1254×1254 → 800×800, same JPEG quality as the rest of the library.

**Still on placeholders after this round:** `kbfigure8`, `kbhighpull`
(corrected prompts already sent, not yet regenerated), `abrollstand`,
`ropeplank` (prompts sent same day, not yet generated at all).

## The library goes fully photographed (v236)

The last four — `kbfigure8` and `kbhighpull` regenerated from the v2
prompts (v235's note above), plus `abrollstand` and `ropeplank` generated
for the first time — landed within the hour. All ten exercises added this
session (v232–v234) now ship a real photo; none are left on the grey
"PHOTO PENDING" placeholder. Same drop-in path as v235: resize
1254×1254 → 800×800, same JPEG quality, same filenames, no code change.

## Extended Arm Plank (v237)

The athlete sent a reference photo of a straight-arm plank — hands walked
out ahead of the shoulders, arms locked, no elbows on the floor — and asked
for a prompt. Checking it against the roster first (the same discipline as
every addition this session) found it was neither a duplicate nor a reshoot:
the existing `longplank` ("Long-Lever Plank") is the FOREARM version — walk
the elbows forward, weight stays on the forearms. Nothing in the library
covered the straight-arm, hand-contact version. Asked directly which it
should be — a fresh exercise, or a replacement photo for `longplank` — the
athlete chose fresh.

**`extplank` is a harder RUNG of the same ladder `longplank` already
occupies, not a new standalone.** Both are calibrated against the same
`anchor:'plank'` baseline test, and walking the hands forward is a further
point on the exact continuum walking the elbows forward already started —
so it belongs directly after `longplank` in `plankL`, with a lower
`hardness` (0.6 vs 0.7) reflecting the added difficulty, not beside the
ladder as its own thing.

**The risk profile is an ESCALATION, not a copy.** `longplank` carries only
`lowback` (anti-extension risk from walking the lever out) — no `wrist`,
because forearm contact puts no load through the wrist at all. `extplank`
keeps that same `lowback` risk (if anything, greater, with an even longer
lever) and adds `wrist` on top, because switching to hand contact is
exactly what every other hand-plank in the library (`bearhold`,
`isoclimber`, the `pushup` family) is already flagged for. Getting this
right needed a check that verifies `longplank` stays wrist-FREE, not just
that `extplank` is wrist-flagged — the mutant that incorrectly added a
wrist flag to `longplank` too would have passed a check that only looked
at `extplank`'s side of the comparison.

Photo was already in hand — the athlete generated and confirmed it before
asking for the build, so this shipped with a real photo from the start,
no placeholder.

## A full QA audit, and seven fixes (v238)

Asked directly for a Principal-Engineer-style audit across bugs, data
fetching, core workflows and completeness — not a build request, a review.
Four parallel research passes, each independently verified against the
actual current source (not just trusted) before anything shipped: this repo
has 230+ versions of prior bug-fixing behind it, so the risk was rediscovering
already-fixed defects, not missing real ones. All seven verified findings
were then implemented, tested, and mutation-tested in one round.

**The pattern repeats: a fix applied to one twin, never carried to the
other.** `plTickHold()` (the work-phase timed hold — planks, hollow holds,
`extplank`) never got the wall-clock anchor `plTickRest()` was explicitly
given specifically because Chrome's intensive throttling drops timers to
~1/min after five minutes hidden. The fix comment for rest even says so
("a 90s rest could read 85s after four real minutes") — that reasoning
applies identically to a hold, and nobody carried it over. Same shape as
this file's own "player has twins" rule for rendering, just for timer logic
instead of markup. Fixed by giving `plEnterWork()`/`plTickHold()` the exact
same `deadline`-anchored `Math.min(byTick, wallClockRemaining)` treatment,
which — because `playerToggle()`'s pause/resume already adjusts
`PLAYER.deadline` generically, not per-phase — required no changes there at
all.

**A permission-gated toggle set the state before the permission was known,
right next to the ONE that does it correctly.** `toggleReminders()`
correctly sets `reminderOn` only inside `requestPermission().then(p=>...)`.
Its sibling `toggleWeekly()`, six lines away, set `weeklyOn=true` and
toasted "on" unconditionally, fired `requestPermission()`, and threw the
result away (`.then(()=>{})`). A denial left the setting silently stuck on
forever, with no notification ever able to fire and nothing on screen
saying so. Fixed by mirroring the correct sibling exactly.

**`renderCompare()` was the one repeatable async lookup in the file with no
generation-token guard.** Every other one (`searchOnline()`→`_fsSeq`,
`startScan()`→`_bcGen`, `estimateFoodFromImage()`→`_sheetGen`) has one.
Two overlapping calls (either `<select>` changed twice, or A then B before
the first `idbGet` resolves) let IndexedDB's unordered resolution paint a
stale photo pair over a fresh one. The mutation test for this one is worth
noting: reverting just the `if(gen!==_cmpGen)return;` line reproduced the
exact failure mode from a cold read — the OLDER, slower-resolving selection
visibly won over the newer one, not a coincidence or a flaky timing
artifact.

**No network call in the file had a timeout.** `offSearch()`, `offBarcode()`
(Open Food Facts) and `_geminiCall()` (food-photo AI) all `await fetch(...)`
with no bound. `sw.js` already races page navigation against a 2.5s timer for
the documented reason that a connection which *associates* and then hangs —
gym wifi, a dead hotspot — never rejects on its own; the app's own network
calls had no equivalent. Fixed with `fetchWithTimeout(url,opts,ms)`, an
`AbortController` wrapper with `ms` as a real parameter (not a hardcoded
8000) specifically so a test can pass a short one. **The mutation test for
this one doesn't fail — it hangs.** Reverting the fix and driving the check
against a route that never responds doesn't produce a red assertion; the
whole check never returns, and only a wall-clock `timeout` around the test
runner kills it. That non-outcome — hang instead of clean failure — IS the
bug this fix closes, demonstrated more convincingly than a normal red would.

**`saveLiftLog()` had a floor but no ceiling — and the first fix used the
WRONG ceiling.** `load>0` was checked, but nothing stopped `999999`. The
obvious reuse was `plausibleKg()` (already used for bodyweight/waist entry,
25–350kg) — and it broke `21-integrity.test.mjs` immediately: a real,
already-tested 22.5kg dumbbell load is *below* `plausibleKg()`'s 25kg
floor, because that floor is calibrated for a human's bodyweight, not a
loaded implement. A 2.5kg dumbbell set is a completely legitimate logged
entry. Fixed with a dedicated `plausibleLoadKg(kg){return kg>0&&kg<=400;}`
— ceiling only, no floor, since `load>0` already guards that. **Reusing a
plausibility check from an adjacent domain is not free** — the two
quantities looked similar enough (both "a weight in kg") to reach for the
same guard, and weren't.

**Two `sw.js` `cache.put()` calls and one `serviceWorker.register()` chain
were unhandled-rejection risks — fixed with `.catch(()=>{})`, verified with
a static source check, not a live behavioural one.** There is no reliable
way to force a real IndexedDB-quota-style failure from this harness, so
each check greps the actual source for the `.catch(` rather than observing
an effect. The `cache.put()` check had to be anchored on the specific call
shape (`` `c => c.put(` ``, the real arrow-function usage), not a bare
`c.put(` substring match — a source COMMENT in the same file mentions
`c.put()` in prose, and a naive substring check would have counted that
comment as an uncaught call site and failed on entirely correct code.

Images unaffected — this round touched no exercise data, only timer logic,
a permission toggle, a race guard, network resilience, an input clamp, and
two defensive `.catch()`s.

## A second audit pass: goal direction, and the twins the first pass missed (v239)

Asked for the same audit again, immediately after v238, under a generic
"cloud fitness app" template that assumed a backend this app doesn't have
(no cloud functions, no database, no auth, no server — everything is
client-only). Confirmed the mismatch with the athlete first rather than
either fabricating findings for infrastructure that doesn't exist or
silently re-running the exact same four dimensions v238 already covered.
Redirected to the angles v238 didn't touch — best practices, performance,
and a targeted sweep of goals/progress/notifications — then fixed and
shipped every verified finding.

**A goal can point in two directions, and half this app's "progress"
language only ever checked one of them.** `goal:'gain'` (Build muscle) is a
first-class, fully-wired option — it already drives the calorie surplus and
the rep/rest multipliers — but the two places that put that number in front
of the athlete never asked which direction it meant:

- `briefSegments()`'s morning mission read `toGo=lb-goalW` and treated a
  negative value (current weight below a gain target) as "you're under
  goal — outstanding," the exact sentence written for a LOSS goal being
  cleared. A bulking athlete ten pounds short of their target got
  congratulated for it every single morning.
- `weightChartHTML()`'s trend color was `change<=0?green:muted`, unconditionally
  — a rising trend (real progress toward a gain goal) rendered neutral,
  and losing weight (moving away from a gain goal) rendered green.

Both are fixed by branching on `STATE.profile.goal==='gain'`, not by
re-deriving direction from the numbers the way `projectionHTML()` does
(`losing=tkg<kg`) — that pattern answers "which way do I need to move
from HERE," which is right for a timeline projection but wrong for
describing the athlete's actual intent, since it flips the moment they
cross the target rather than staying anchored to why they set the number
in the first place. Two different questions, two different sources of
truth — using the wrong one silently for either would have been the bug in
a different shape, not a fix.

**A validated boundary in one entry point does not mean the value is
validated everywhere it can be written.** Onboarding's waist-goal field
already enforced `okCm(v)=>v>=40&&v<=250`, and Progress's own in-app
"edit goal" sheet — a completely separate write path — enforced only
`g>0`. A mistyped `9999` sailed through, `goalETAHTML()` immediately read
it as `toGoCm` deeply negative and fired a false "🎉 Goal reached" banner.
Fixed by having the second entry point call the same `plausibleWaistCm()`
the rest of the file already uses, rather than inventing a second bound
that could drift from the first.

**The performance finding worth fixing now, and the one worth naming but
not touching yet, split on the same question `acwr()`'s own fix already
answered: is anyone currently paying for it.** `sessionHistoryHTML()`
called the expensive `sessionStats()` — a full `buildSession()` rebuild:
ladder walks, `gearSwap`/`safeSwap` chains, a `prescribe()` per exercise —
for all 25 rows of the history list, then discarded the `sess` object it
returned; only `openSessionDetail()`'s single call actually reads it.
`sessionStats(p,full)` now skips the rebuild unless `full` is true, and the
list gets a session's exercise/set counts from data already sitting in the
log. `renderProgress()`'s own redundant rescans of `STATE.logs` (~8 separate
full walks in one render, the same *shape* of waste `acwr()` had before its
fix) are a real but NOT a currently-paid-for cost — still inside the
documented 400ms render budget — so it's named here as known debt rather
than risked as a same-round refactor across eight call sites with no
demonstrated regression driving it.

**Two functions with byte-for-byte identical bodies under different names
is the exact shape this file's own drift warnings are about, even with
zero current disagreement between them.** `loadToKg`/`loadShow` duplicated
`weightToKg`/`weightShow` exactly — same `0.453592` constant, same
imperial/metric branch — while the raw literal is ALSO inlined at another
~14 call sites. Consolidated the two function pairs into aliases
(`const loadToKg=weightToKg`); left the 14 inline literal sites alone —
they all currently agree, and a sweep across that many hand-maintained
call sites for a value that isn't wrong yet is a bigger diff than the
verified risk justifies, so it's named as debt rather than touched this
round, the same call as `renderProgress()`'s scan duplication above.

**Two more unbounded network calls than the previous round's sweep caught.**
`selfUpdate()`'s own version-check fetch was the one remaining bare `fetch`
after `fetchWithTimeout()` shipped in v238 for the other three — now routed
through it. And `sw.js`'s `cf-precache-status` handler ran the identical
shape of work as `cf-topup` right above it (an async loop the comment on
`cf-topup` explains an idle worker can be reclaimed mid-task) without the
`e.waitUntil()` that same comment argues for — the second branch was added
after the first and the reasoning just wasn't re-applied.

Images unaffected — this round touched no exercise data, only goal-direction
logic, one input clamp, one performance split, a small dedup, and two more
network-timeout fixes.

## A third audit pass, and a shipped fix that didn't actually fix anything (v240)

A full 20-phase production-readiness audit, requested directly, with an
explicit instruction not to just confirm the app loads but to prove it
behaves correctly. Rather than re-deriving the whole architecture a third
time (239 prior versions, 22 suites, two just-completed audit rounds already
cover most of this ground), the new research was aimed specifically at
territory v238/v239 hadn't touched, and every agent finding was verified
against real source and, where practical, a real running browser before
being trusted — not just read and believed.

**One reported accessibility finding was a false positive, and the reason
it looked real is worth naming.** An agent flagged `.ex-check`'s 30×30px
visual box as under the 40×40 touch-target floor. A first empirical
Playwright probe agreed — clicking 6px outside the box did nothing — but
that probe had two bugs of its own: it never scrolled the button into view
(so `elementFromPoint` was correctly returning null for an off-screen
coordinate, not proving the target was missing) and it ran before
`#splash`'s 850ms-delay-plus-600ms-fade removal, so `elementFromPoint` was
hitting the launch splash's decorative `.sgrad` overlay, not the button.
Once both were fixed, a real click 6px outside the visual box correctly
toggled `aria-pressed` — `button.ex-check::after`'s 44×44 invisible tap
zone was already working exactly as designed. Filed as a finding worth
recording precisely because it shows the SAME discipline this file already
demands of test-writing applies to verifying an audit agent's own report:
trust but verify, and a flawed verification script can manufacture a
defect that was never there. (`.gearbtn` at 34×34px with no `::after`
compensation is a real, separate, low-priority gap — noted below as a
deferred enhancement, not fixed this round.)

**`selfUpdate()`'s forced reload only checked `_sessionLive()` once, at
entry — several `await`s and up to ~6.4s before the reload actually
fires** (the version-check fetch alone allows up to 6s under
`fetchWithTimeout`). An athlete who started a set in that window still got
yanked out from under them. Fixed by moving the check to fire immediately
before `location.reload()` itself: `setTimeout(()=>{if(_sessionLive())return;location.reload();},400);`.
The regression test has to find `_sessionLive()` specifically inside the
reload's own scheduling, not just anywhere in the function — an entry-only
check would make a naive "does the function call _sessionLive" assertion
pass on the buggy version too.

**`estimateMaxes()` had the exact falsy-zero mistake `computeAssessment()`
was already fixed for, one function downstream — twice in the same
function.** The sanitiser filter was `v>0` (dropping a genuine "couldn't
hold the plank at all" 0 as if it were a data-quality gap, not a real
result), and the very next line's `clean.plank||40` would have re-broken
it even with the filter fixed, since `0||40` is `40`. Both needed fixing
together — fixing only the filter would leave the fallback still treating
an honest zero as absent. **Building the regression test surfaced a second
bug in the test itself, caught by mutation testing rather than by
inspection:** the first draft's baseline included `push:0` alongside
`plank:0` — since `Object.assign(defaults, clean)` lets any present input
key pass straight through untouched, `r.m.push` was reading the INPUT
value, never the value `estimateMaxes()` actually derives from the
plank-anchored scale. Reverting only the `||40` fallback (leaving the
`v>=0` filter intact) passed clean against that first draft — a real
escaped mutant, not a false pass on a already-broken check. Fixed by
omitting push/pull/squat from the test's input baseline entirely, so the
scale formula is what's actually exercised, and asserting the exact
floor-clamped value (`push===6`) rather than a loose inequality.

**The `_ve()` single-quote fix looked like a real security fix, passed its
own test, and did not actually close the hole — verified empirically, not
assumed.** `removeMeasure`'s delete button was `onclick="removeMeasure('${_ve(date)}')"`,
and escaping `'` to `&#39;` in `_ve()` looks like it should stop a crafted
measurement date (STATE.measurements carries no schema validation on
import) from breaking out of the single-quoted JS string and injecting
code. It does not, because **the browser HTML-decodes an inline event
handler's attribute value BEFORE compiling it as JS** — confirmed with a
standalone Playwright probe reading `element.getAttribute('onclick')` back
decoded, then confirmed end-to-end with a real click: `&#39;` turns back
into a literal `'` right before the handler runs, and the string still
breaks out exactly as if it had never been escaped. **A regex-based test
of the rendered markup can't catch this at all** — the first draft of the
regression check extracted the onclick argument with
`/onclick="removeMeasure\(([^)]*)\)"/` and asserted it looked like a
single clean argument, and that regex is fooled by the exact same
first-`)` ambiguity the exploit relies on, so it read as "safe" on BOTH
the vulnerable and the intended-fixed code. The only test that actually
proves anything here injects the rendered HTML into a real DOM element and
fires a real click, then checks whether the injected side effect ran.

The real fix replaces the hand-wrapped single-quoted JS string with one
built by `JSON.stringify()` — `onclick="removeMeasure(${_ve(JSON.stringify(date))})"`
— which produces its own correctly backslash-escaped, double-quoted JS
string literal; `_ve()` then only has to protect the HTML *attribute*
boundary (escaping the JSON string's own `"` delimiters to `&quot;`),
which is a job it does correctly, since that escaping is consumed once by
HTML decoding and never asked to also survive a second JS-parse pass. The
`_ve()` single-quote addition itself is still kept — harmless, and real
protection for any *other*, differently-shaped call site that embeds
output inside a single-quoted HTML attribute — but the comment on it and
on `measureListHTML()` now says plainly what it does and does not
protect, since the original phrasing ("escaping `'` everywhere is the safe
default") is precisely the claim that turned out to be false for the one
call site it was written for. **`measureListHTML()`'s existing
`String(m.date).slice(0,10)` truncation also shapes the real attack
surface** — the regression test's payload is built to fit a complete
breakout (closing quote, closing paren, injected statement, `//` comment)
inside exactly 10 characters, matching what an attacker actually has to
work with, not an unbounded string that would never survive to the
vulnerable code path intact.

**The `importData()` prototype-pollution guard's first regression test
was checking the wrong object, and a standalone probe was needed to find
the right one.** `Object.assign(target, JSON.parse(untrustedJson))` — the
mechanism a comment already correctly described — does NOT touch the
global `Object.prototype`: `JSON.parse` without a reviver produces an own
"`__proto__`"-named *data* property (it does not trigger the accessor at
parse time), and it's the later `Object.assign` that triggers a real
property `[[Set]]` on `target.__proto__`, reassigning *that specific
object's own* `[[Prototype]]` link — confirmed with a standalone probe
comparing `Object.getPrototypeOf(target)` and a leaked property read
through the hijacked chain, with and without the reviver. The first draft
of the test asserted on `Object.prototype.polluted`, which is `undefined`
whether the guard exists or not, and it mutation-tested clean against a
seeded mutant that deleted the reviver entirely — a check that cannot
fail. Fixed by driving the real `importData()` through a real `File` (the
same pattern `13-feedback.test.mjs`'s legacy-backup check already uses,
including the `window.confirm` stub for the now-gated confirm), and
asserting `Object.getPrototypeOf(STATE) === Object.prototype` afterward.
**The completion-polling signal needed its own second fix**: the first
version polled for a sentinel written to `STATE._saved`, which `save()` —
called unconditionally at the very end of `importData()` — immediately
overwrites with `todayISO()` before the polling loop's first tick can ever
observe it. Switched to `STATE.profile.name`, deep-merged from the backup
and untouched by `save()`.

**Every fix in this round shares one shape**: the thing that looked like
verification (a regex over rendered HTML, an assertion on the wrong
global, a loose inequality a pass-through value could satisfy by
coincidence) had to be replaced with something that actually drives the
real code path and reads the real effect, and in three of the four cases
that only became visible by mutation-testing the check against the exact
defect it claimed to guard.

`.gearbtn`'s 34×34px touch target (no `::after` compensation, unlike
`.ex-check`) is a real, low-priority, deliberately-deferred gap — noted
here rather than fixed, since it's cosmetic-adjacent rather than a
behavioral defect and this round's fixes were scoped to verified
correctness/security issues.

## A fourth audit, scoped to what a client-only app actually has (v241)

Same generic "Senior Full-Stack Engineer and QA Expert" audit template as
before, this time asking specifically about User Auth, protected routes,
and database queries — none of which this app has. Flagged the mismatch
inline (single-file client-only PWA, no backend/accounts/database) rather
than re-asking via `AskUserQuestion` a second time in the same session, and
scoped the five requested categories to what's real: the actual network
calls (Open Food Facts, the AI food-photo estimator, the update checker),
the math/logic engine, workout-logging state management, and completeness.
Four parallel research passes, each verified against real source (and in
one case a standalone empirical probe) before anything shipped — same
discipline as v238-v240, aimed at territory those hadn't covered rather
than re-deriving ground already audited.

**A missing `.catch()` was real, but the obvious behavioural test for it is
provably impossible in this harness — same shape as three `.catch()` fixes
in v238.** `sw.js`'s cache-first static-asset handler
(`caches.match(req).then(hit=>hit||fetch(req)...)`) had a `.catch()` on the
`cache.put()` write right next to it, but none on the `fetch(req)` READ
itself — an uncached asset whose network fetch genuinely rejects (offline,
device DNS failure) left an unhandled rejection inside the worker instead
of a graceful fallback. The reason this needed a *static* source check
(`tests/12-precache.test.mjs`, anchored on the exact call-shape text) rather
than a live one: `fetch()` only REJECTS on a network-level failure, and this
harness's only fault injection (`srv.fail500`) fakes an HTTP status code —
which RESOLVES `fetch()` with `res.ok===false`, a case the code already
handled correctly without this fix. There is no way to force a genuine
connection-level failure from this harness, the same limitation CLAUDE.md
already documents for the `cache.put()`/`register()` catches.

**Two "proper functionality" findings were the same shape: a toast that
claimed more success than the code underneath it actually delivered.**
`playerSwap()`'s in-session exercise swap (`m.exId=exId`) always applies —
but the swap is also supposed to persist via `setSwap()` so it survives
leaving the player, and that call was wrapped in a bare `try{}catch(e){}`
with an unconditional `toast('Swapped to '+nEx.name)` right after,
regardless of which branch ran. `plAfterSet()` had the identical shape
twice in one function: `markSetFromTimer()` and the block that records a
timed hold's or cut-short rep set's `actual` count were each wrapped in a
silent `catch(e){}`, so a genuine logging failure (rare, but not
impossible) left the athlete believing a set was recorded when it wasn't,
with nothing on screen saying so. Both fixed the same way: track whether
the risky part actually succeeded, and only change the athlete-facing
message when it didn't — never adding a toast to the common, successful
path, since a hands-free session screen that toasts on every ordinary set
would be worse than the silence it replaces.

**Testing both required forcing a specific internal function to throw, not
just asserting the surrounding code "looks wired up."** Monkey-patching
`window.setSwap`/`window.markSetFromTimer` to throw for one isolated
`openPlayer()`/`plAfterSet()` run, and leaving them real for a second,
proves the toast text actually depends on the outcome — a check that only
drove the success path (which is what "does the swap work" superficially
tests) would pass whether or not the failure branch said anything at all.

**A cosmetic finding got a cosmetic fix, at the size the finding earned.**
`removeMeasure(date)` said "Deleted" even when the date matched nothing in
`STATE.measurements` — harmless (a no-op filter), but misleading. Fixed
with a length-before/length-after comparison and a "Not found" toast;
correctly scoped as a UX nit, not treated as a data-integrity bug, since
nothing was actually at risk.

**One numeric field had no ceiling anywhere in the codebase, and it was
the one field that took free-typed input from the athlete rather than a
validated picker.** `_faNum()`, backing the manual "add food" macro entry
(kcal/protein/carbs/fat), floored at 0 but never capped — every other
numeric input in the file (`plausibleKg`, `plausibleWaistCm`,
`plausibleLoadKg`) has a sanity ceiling matched to what it measures. Capped
at 9999, generously above any real single food entry, matching this file's
existing pattern of a loose but real bound rather than a precisely-tuned
one for a field that only ever feeds the athlete's own displayed/logged
totals.

**One completeness finding was deliberately left unfixed.** No way exists
to edit or correct a past logged workout (`openSessionDetail()` renders
history read-only). Flagged in the audit report as a genuine gap but
possibly intentional — an immutable training log is defensible for an app
built around honest self-reporting (see this file's own "zero is data, say
zero" completion-integrity rules) — and left for the athlete's own call
rather than building an edit feature nobody explicitly asked for.

Also confirmed clean this round, with agents independently verifying
against real source rather than assumed from the doc history above: the
falsy-zero trap (already closed in `estimateMaxes`/`computeAssessment`),
duplicate-log prevention (`STATE.logs` is dictionary-keyed and `PLAYER` is
nulled before `commitSession` to block a double-tap), delete-by-missing-key
safety (`Array.filter`/`delete` are both no-op-safe), the zero-set/partial/
pain-stop completion gate, every body-metric input's bounds-checking, the
settings screen, and the absence of hardcoded placeholder data.

## A real in-app timer for the step-makeup jacks/bike blocks (v242)

Requested directly: "the days I have to make up my steps with jumping jacks
or the bike... I should be able to select start timer and stop it as a
stopwatch, or set a timer for 10 minutes followed by rest, followed by 10
minutes again... same for the bike... right from the same Fuel tab." Before
this, `jackBlockHTML()`/`bikeBlockHTML()` had no timing mechanism at all —
the athlete self-timed on an external clock and typed the result in after
(the card's own copy said so: *"Set the timer, do a block, add it here"*).

**Reused the existing interval engine rather than building a second one.**
`_runHiit`/`buildIntervals`/`INTV`/`ivDone` already run HIIT circuits,
skip-rope blocks, grip hangs and shadow-boxing rounds as a full-screen
guided timer — work/rest rings, audio cues, wall-clock-anchored countdowns
that survive the phone sleeping, wake lock. `startJackMakeup()`/
`startBikeMakeup(mins)` register a runtime-built entry into
`ENDURANCE_FORMATS` (the exact reserved-key pattern `startSkipCustom()`
already established for `SKIP_FORMATS.skipcustom`) and hand it to the same
`_runHiit()` every other interval session uses. A plain stopwatch
(`openMakeupStopwatch`/`MUT`) is a near-verbatim copy of the existing
`openSkipTimer()`/`SKIPT` shape, because that's already exactly "count up,
Stop & log."

**A dedicated session key, not a shared one — discovered a real, separate
gap in the process and deliberately did not fix it here.** The obvious
reuse for the bike duration picker was `startSpecialCardio('bike',format)`,
the exact function the pre-existing "Special training → Bike trainer" menu
already calls. Reading `ivDone()` to see how that session finishes revealed
it credits *nothing* to movement/step-equivalent today — `rateBikeAndClose()`
only updates the `BIKE_LEVELS` streak-suggestion state, never touches
`bikeVal`. A bike interval run from Special training has always given zero
step credit for real, measurable effort. Tempting to fix both flows at
once since it's the same code path, but this feature is scoped to the
Fuel tab; changing `startSpecialCardio`'s finish behavior risks the
existing, tested Special-training UX for entry points nobody asked to
change. `cardiomakeup` is a new session key precisely so this feature's
crediting logic (`creditMakeup`/`creditMakeupAndClose`) only ever fires
for sessions this feature itself started, leaving `specialcardio`/`isBike`
completely untouched — verified with a check that runs the OLD path start
to finish and asserts it *still* credits zero, proving no leakage in
either direction. The old gap is named here, not fixed.

**Additive, not overwriting — matching the manual +/- buttons' own
contract, and the one place mutation-testing caught a real coverage
hole.** A timed block stacks on top of whatever was already logged
(`addJackVal`/`addBikeVal`, not `setJackVal`/`setBikeVal`), the same as
the existing nudge buttons and the "close it" quick-fill. The bike side of
this mutated clean on the FIRST pass: a single stopwatch run starting from
a zero baseline can't distinguish `add` from `set` (0+20 and just-set-to-20
are the same number), so the check needed a SECOND stacked run — the
identical shape of gap CLAUDE.md's own "under a minute" note describes
elsewhere in this file, just for a different property. Currency
re-expression is reused too: crediting always switches the unit to `min`
via `setJackUnit`/`setBikeUnit` first if it wasn't already, so a session
logged in reps or distance is correctly re-expressed into minutes before
the timer's own minutes are added on top — not clobbered.

**`Math.round(secs/60)` rounds a half-minute UP, not down — a real
implementation detail inherited from `skipTimerStop()`/`actTimerStop()`,
not a new bug.** The first draft of the "under a minute" guard check used
30 seconds and failed, because `Math.round(0.5)` is `1` in JS: a 30-second
block already clears the guard and gets logged as 1 minute, exactly as
`skipTimerStop()` has always done. That's consistent behavior across every
stopwatch in the file, not something this round needed to fix — the check
was wrong, not the code, and got moved to a genuinely sub-threshold value
(20 seconds) to actually exercise the guard.

**Verified live in a real browser, not just via `page.evaluate()`.** Real
`.click()`s through Fuel → "Time it" → Stopwatch → Stop & log confirmed the
toast and the credited minutes end to end, and the rendered sheets
(chooser, stopwatch) were screenshotted to confirm the UI actually looks
right — no overlap, correct button states, consistent with the rest of the
app's styling.

## Eight more exercises from a screenshot roster comparison (v243)

The athlete shared several screenshots of another app's exercise library and
asked which ones CoreForge was missing, for core/chest strength and
endurance/stamina. Chest turned out to already be saturated (16 push-up
variants, dips, presses) — nothing added there. Cross-referencing roughly 80
named exercises across the screenshots against the real ~160-entry `EX`
library (not memory) found the large majority already present, several
under a name that doesn't share a substring with the screenshot's own
label — the exact trap this file's own "the pattern repeats" notes warn
about.

**One initially-flagged "gap" was a false positive caught on a second pass,
specifically because the first pass searched for the wrong substring.**
"Standing Oblique Twists" looked absent because the search for `.*Twist`
never matched `standingoblique`'s actual name, "Standing Obliques" — the
same movement, already in the library and already wired into
`FOCUS_POOL.obliques`. Corrected before anything was built, not after — the
lesson generalises past this one miss: a substring match on a claimed gap
proves the search term was absent, not that the movement was.

**Eight genuine, non-overlapping gaps survived the cross-reference:** Sit
Thrust, Knee Kicks, Warrior III, Skater Jumps With Ground Touch, Quick
Punches, Toe Touches, Hanging Knee-to-Elbow, Seated Leg Circles. Two are new
ladder rungs (`kneetoelbow` inserted into `lowerL` between `kneeraise` and
`hanglegraise`; `skaterground` appended above `skater` in `cardioAL`, same
"harder rung above the existing top" pattern as `dragonflagfull`/`extplank`);
the other six are standalone accessories reached through `FOCUS_POOL`, same
as `dbpallof`/`mbchop`/`ropeplank`.

**Warrior III deliberately carries no joint-risk flag, which is not the
same as "no risk was considered."** A single-leg balance hold is the kind of
move that invites an automatic knee flag on the assumption that "balance =
risky," but the standing leg in this pose stays nearly straight — it is
mechanically far closer to a plank or hollow hold (both unflagged) than to
`wallsit` (bent-knee, sustained load, correctly flagged). Forcing a flag
onto a move because the category sounds risky, when the actual mechanical
load doesn't support one, would be the same dishonesty as under-flagging a
genuinely risky move — this file's "prefer the restrictive answer" instinct
is about resolving real ambiguity, not manufacturing risk that isn't there.
A mutation test confirms the check can tell the difference: seeding a knee
flag onto `warriorthree` fails the specific assertion that it stays
unflagged, proving the check isn't just trivially passing on an empty list.

**Adding `kneetoelbow` to `lowerL` surfaced that the hardcoded no-bar
override pattern (`kneeraise`→`legraise`, `hanglegraise`→`vup`) is not
actually needed for every optional, equipment-gated rung — only the ones
where the generic mechanism would land somewhere WORSE than the deliberate
choice.** `gearSwap()`'s own ladder-walk already checks the immediately-
easier rung first; since `kneetoelbow`'s neighbour (`kneeraise`) needs no
equipment, `gearSwap()` finds it on its own, making a hardcoded
`kneetoelbow→kneeraise` override redundant — confirmed by mutation-testing
the removed line and finding zero behavioural change across a 400-session
sweep. This is NOT true for `hanglegraise`, whose override deliberately
sends it to `vup` instead of the `gearSwap()`-natural `kneeraise` — a real,
intentional divergence from the generic mechanism, which is exactly why
that one earns the hardcoded line and `kneetoelbow` doesn't. Same
reasoning extends to `GEAR_FALLBACK.kneetoelbow`: also unreachable via the
one real call site (`gearSwap()`'s ladder-walk resolves first), but kept —
matching this file's own established precedent (`kneeraise:'legraise'` is
equally redundant and was already there) — as a documentation/defense-in-
depth entry, not because any current path needs it.

**A container-only assertion on `GEAR_FALLBACK.kneetoelbow`'s literal value
doesn't prove the entry is ever consulted — a real behavioural sweep does.**
Reading the object's own property and asserting it equals `'legraise'`
passes whether or not anything actually reads that property (confirmed:
deleting it still made the direct assertion fail, but that only proves the
data changed, not that behaviour did). The real proof is a sweep of 400
built sessions with no bar owned, asserting `kneetoelbow` never appears and
its fallback (`kneeraise`) does — the latter half matters as much as the
former, because an absent `kneetoelbow` with an ALSO-absent `kneeraise`
would mean the ladder region was simply never reached, proving nothing.

**The first version of that sweep used too short a range and failed for a
reason that had nothing to do with the code being wrong.** A 60-session
sweep never saw `kneeraise` appear at all when run inside the real test
file, though a standalone probe against a freshly seeded athlete found it
at session 28. The difference: earlier blocks in the same test file mutate
shared `STATE.baseline` fields before this block runs, shifting exactly
where the level curve reaches each ladder rung — the same "every block
builds the state it asserts on, not what the block before it left behind"
lesson this file already names elsewhere, just for a numeric threshold
instead of a UI state. Widened to 400 sessions (covering essentially the
full 54-week program) rather than pinned to a specific number, so the
check is robust to exactly where in the file it runs.

Images shipped as the same 800×800 grey-backdrop "PHOTO PENDING"
placeholders established in v224. ChatGPT prompts for the real photos were
handed to the athlete rather than generated in-session, each specifying the
same house style (olive tee, camo cargo pants, black boots, black mat, grey
studio backdrop) used throughout the library, one generation per exercise.

## The v243 roster's real photos land as one collage, cropped by hand

The individual-prompt handoff from v243 (eight separate ChatGPT calls) got
consolidated into a single combined prompt at the athlete's request, with
explicit "eight separate images, no collage" instructions repeated twice.
The image model merged them into one 1254×1254 contact sheet anyway — the
exact failure mode this file's own v224 note already warned about, and the
one this session flagged as a real possibility before the athlete generated
it. No amount of "do not collage" phrasing prevented it once eight subjects
were requested inside one message; the documented fix (one generation per
exercise, submitted separately) is a workaround for the model's behavior, not
something a stronger prompt reliably avoids.

**Extraction reused the established contact-sheet technique verbatim, not a
new one.** Grid gutters were found by scanning for near-white, near-uniform
column/row bands (4 columns × 2 rows, confirmed rather than assumed) instead
of guessing a fixed cell size. Each portrait-oriented cell (~307×621px) was
padded to a square canvas using its OWN backdrop tone, sampled from its own
corners rather than a flat guess — the source collage carries a vignette, so
a single global grey would have mismatched every cell differently. The pad
seam was feathered with a Gaussian-blurred copy of the padded canvas,
composited through a distance-based mask, then the sharp subject re-pasted
on top — the same fix this file's v224 note already reached for after a flat
pad first left a visible rectangular seam.

**All eight came out usable — visually verified per-image, not assumed from
the crop math succeeding.** Each of the eight extracted photos was read back
and checked against its intended exercise (the collage's own 4×2 order
matched the prompt order exercise-for-exercise) before overwriting the
placeholder — matching the standing rule that a crop landing without an
exception is not the same as a crop landing on the right content. No image
needed a re-crop or was left on its placeholder this round.

**No version bump.** Same drop-in path as v235/v236: same filenames, real
JPEGs replacing placeholder JPEGs, no code change. `npm run check` and the
full `npm test` (22 suites, including the asset-existence and dimension
checks in the exercise-media suite) both stayed green with zero diff to
`index.html` or `sw.js`.

## A follow-up gap search finds one real addition: Dumbbell Bench Press (v244)

Asked directly, after the photo round: "are there any more exercises we
should add?" A full survey of the (by then) 177-entry `EX` library across
every region and equipment type found it heavily saturated — nine prior
rounds (v224, v232–v234, v243) had already covered nearly every commonly
cited bodyweight/dumbbell/kettlebell/medicine-ball/ab-roller/battle-rope
movement. Two narrow candidates survived the survey; offered to the
athlete, who chose one.

**The athlete's own "Bench / chair" gear checkbox powered exactly one
exercise in the whole library before this.** `benchdip` uses `equip:
['bench']` alone; the only other loaded chest press, `dbfloor`, is done
lying on the floor and needs no bench (its own `why` text says so
explicitly — "no bench needed"). No exercise anywhere required a dumbbell
and a bench together, so an athlete who owns both had that combination
sitting unused. `dbbench` (Dumbbell Bench Press, `equip:['dumbbell',
'bench']`) is the first.

**The declined candidate, for the record.** A `kbsuitcase`-style single-arm
Dumbbell Suitcase Carry — the same asymmetry v224 already fixed once for
the bilateral farmer's carry (kettlebell had one, dumbbell didn't;
`dbcarry` closed it) — was raised alongside the bench press and the
athlete chose bench-press-only. Left unbuilt; not a rejected idea so much
as an unscoped one, worth revisiting if a future round asks the same
question again.

**A fuller range of motion is a real, not cosmetic, difference from the
floor press — and the risk flag has to say so.** A bench lets the dumbbells
descend below the torso plane; the floor stops the descent early. That
extra stretch at the bottom is exactly the mechanism fitness literature
points to when it calls a floor press "shoulder-friendlier" than a bench
press — which is also, word for word, the reasoning `dbfloor`'s own `why`
text already gives for existing as a no-bench alternative. So `dbbench`
carries `shoulder` in `JOINT_RISK`; `dbfloor` deliberately does not.
`SAFE_SWAP.dbbench:'dbfloor'` is the natural, already-documented-in-app
landing spot for a flagged shoulder — not a generic same-region pick.

**`GEAR_FALLBACK.dbbench` is genuine defense-in-depth, not a working
mechanism — traced, not assumed.** `GEAR_FALLBACK` is read from exactly one
place, `gearSwap()`, which `resolve()` calls only when walking a `LADDERS`
rung. `dbbench` is not in any ladder — it is reached the same way
`dbfloor`/`dbpallof`/`mbchop` are, through `FOCUS_POOL` and `focusBonus()`'s
own `has()` gate, which checks `e.equip.every(g=>gear.includes(g))`
directly and never calls `gearSwap()` at all. The entry is kept, matching
this file's own `kneeraise:'legraise'` precedent, but the test proves the
REAL path — a swept `focusBonus()` call across a full 54-week range with
only a dumbbell owned never offers `dbbench`, while `dbfloor` (needing only
a dumbbell) genuinely does, proving the chest pool was actually reached and
not just silently skipped.

**All five mutations seeded against the new checks were caught on the
first pass** — the shoulder flag, `SAFE_SWAP`, `GEAR_FALLBACK`, the
equipment gate (dropping the bench requirement), and the `FOCUS_POOL`
membership, each independently, each by the specific check aimed at it.

Image shipped as the same 800×800 grey-backdrop "PHOTO PENDING" placeholder
established in v224, added to `sw.js`'s `EXTRA` tier.

## The photo estimate learns portions, and Fuel loses its suggested menu (v245)

Two Fuel-tab changes, both driven by the athlete directly.

**The AI food photo estimated calories and macros but never said how much food
it thought it was looking at.** Asked whether a snap of a salmon fillet would
report the portion in ounces or grams, the honest answer was no — the prompt
asked for a name, `kcal`, and three macro grams, nothing else. `portion` is now
a free-text field ("about 6 oz (170 g)", "1 cup cooked", "2 slices"), one string
rather than a number, because the useful unit genuinely differs by food and
forcing everything into grams would be a worse answer for a banana than for a
steak.

**It is deliberately NOT in the schema's `required` list.** A model that omits
the portion must still produce a usable calorie estimate — no portion is
strictly better than no estimate, and the absent case degrades exactly to the
pre-v245 behaviour. Same restrictive-default instinct as everywhere else in this
file, pointed at a different failure.

**The portion is stored only when there IS one.** The first draft wrote
`portion:''` onto every repaired row, which grew every backup by a dead key for
every meal ever logged and broke `20-diet`'s "a well-formed day survives the
repair byte for byte" check. That break was the right signal: a manual add has no
portion, and the fix (`...(cleanPortion(x)?{portion:…}:{})`) leaves untouched
rows genuinely untouched, which is what that check exists to prove.

**`cleanPortion()` is one function called from four sites, not four copies of the
rule** — the parser, `logFood()`, `saveFood()`'s edit path and
`normalizeState()`. It rejects non-strings rather than coercing them: `String({})`
is the literal `"[object Object]"`, which would render as a portion beside a real
meal, and the first draft did exactly that before the mutation caught it. It also
collapses whitespace, because the diary row is one line and a stored newline
breaks it.

**A portion is user-controlled content in the `importData()` sense, even though a
language model wrote it** — it reaches `innerHTML` at two sites (the log sheet and
the diary row) and both escape with `_ve()`. The check queries for the injected
**element** rather than scanning for a substring, per this file's own note about
the 126 legitimate `onerror` thumbnails that made a substring assertion useless.

**Fuel's "Today's plan" card is gone at the athlete's request.** It suggested a
breakfast/lunch/dinner/snack with a "Log this meal" button on each. Nothing was
ever auto-logged — every meal needed a deliberate tap — but a prescribed menu
sitting above the athlete's own diary read as clutter on the one screen where
they record what they actually ate. The GENERATOR is kept, not deleted:
`currentMealPlan`/`_planStillValid`/`_planStamp` are still directly covered by
suite 20, and the same worked days still power the Reference tab, which is
opt-in browsing rather than something that greets you on the log screen.

**Removing a card breaks the checks that asserted it renders, and deleting them
would be the wrong repair.** Three checks in `09-audit` read the plan out of
`#v-fuel`. Their DAY-level invariants (the worked day hits the calorie and protein
targets, and does not reshuffle) are unchanged and still matter, because
Reference and the shopping list both still serve those days — so the markup
assertions were re-pointed at the Reference tab, where a worked day still
renders, rather than dropped. Left aimed at Fuel they would have passed on an
empty tab, which is worse than deleting them outright: a check that cannot fail
reads as coverage and is not. `showsBothTargets` also needed its phrasing
updated — `'of ' + kcal` belonged to the removed card's own header; Reference
states them as "Weighed out for X g protein and Y kcal".

**The source-scan check for the removed call hit this file's own documented
comment trap on the first run.** The explanatory block comment left where
`h+=mealPlanHTML();` used to be names the function in prose, and
`/mealPlanHTML\(\)/` over `renderFuel.toString()` matched the explanation — the
same false positive a comment mentioning `c.put()` once produced in the `sw.js`
check. Fixed by stripping comments before searching, not by removing the word
from the comment: the comment has to name what it is explaining.

All eight mutants seeded against the new checks were caught, each by its own
dedicated check — the coercing `cleanPortion`, the unescaped diary render, the
hidden sheet row, a dropped `logFood` portion, an always-written empty key, a
stale portion leaking into the next sheet, the schema field, and re-adding the
plan card to Fuel.

## Today is today's workout, and nothing else (v246)

Asked directly, twice: *"Today's tab of the app is the main page. It should not
be clustered with a lot of various stuff. It should be focused on the exercises
of the day."* Two grids came off it, and both MOVED rather than died.

- Six alternate-session tiles (Weights, Special, Meal plan, Quick, Recover, Rest
  day) → the **Program** tab, which is already the "what else can I train"
  screen and already carried its own Quick Workouts button. That button folded
  INTO the grid rather than sitting beside a near-identical tile, which would be
  the clutter the move exists to undo.
- The six-stat summary (`homeSummaryHTML`: Week, Streak, Sessions, Core Score,
  Waist, Badges) → the **Progress** tab, which exists to report exactly those
  numbers.

**The HIIT tile stays on Today, and that distinction is the whole point of the
split.** It converts THIS session's circuit into intervals, so it is about today
in a way none of the others were. The Meal plan tile was not carried over at
all: v245 had removed the card `openMealPlan()` scrolls to, so it was already a
dead link — a tile that navigates to a `#mealplan` anchor which no longer
exists, degrading silently thanks to its own `if(el)` guard.

**Moving the Rest day tile meant two screens needed the same flag, so it became
a function.** `renderToday()` computed `restedToday` into a local; Program now
needs it too. `restedTodayFlag()` is one read of `STATE.restDays` rather than
two hand-kept copies — the first draft did inline the second copy, and the
comment written to justify it was itself the argument against it.

**The moved tile broke suite 04's click-every-button sweep, and the fix was in
the harness, not the app.** `startWeights()` legitimately opens the full-screen
player; `.pl` is z-index 75 and covers the tab bar, so the next real
`page.click('[data-tab=…]')` times out and every later tab renders 0 chars —
three tabs failing with "tab is not clickable" and a fourth failing the
controls-exercised count. The sweep already recovered from a click with
`closeSheet()`, for exactly this reason; it just never had to handle a
full-screen surface, because every player-opening button used to live on
`today`, the FIRST tab in the loop, where nothing came after it to block.
Verified rather than assumed: a probe against the pre-change file confirmed the
Today sweep ends with no full-screen surface open and the next tab click
succeeding. `playerTeardown()`/`hiitTeardown()` joined the recovery step, which
also cut that block's runtime from ~120s to ~29s — the old number was mostly
Playwright timing out on covered elements.

**A `.grid3` probe on Progress passed on nothing, and only a mutant found it.**
`renderProgress()` has grids of its own, so `!!prg.querySelector('.grid3')`
stayed true whether or not the summary moved there — the "never moved to
Progress" mutant sailed past that assertion and was caught only by an unrelated
text check. Re-anchored on markup unique to `homeSummaryHTML()`: its waist stat
is the only `logMeasure()` button, and its week tile the only one carrying the
`/54` programme denominator. Same family as the ⚠️-icon and 🎒-badge checks this
file already documents — a page-wide selector that other content also satisfies
is not evidence about the thing you changed.

**Two of the new assertions failed on first run for a reason that was not the
code**: `.section-label` and the stat labels are uppercased by CSS
`text-transform`, and `innerText` reflects that, so `includes('Main work')` and
`includes('Badges')` both read as missing. The finisher check passed only
because it happened to be written lowercased. Match case-insensitively, or an
assertion reads "the section is gone" when the section is merely shouting.

All six mutants seeded against the move were caught, each by its own check —
tiles restored to Today, stats restored to Today, stats never added to Progress,
tiles never added to Program, the Quick button duplicated beside its own tile,
and the dead Meal plan tile carried over.

## Auditing the two changes that had just shipped (v246, same round)

Asked for a review and audit immediately after v245/v246 were pushed. Four
things were checked against the real running app rather than re-read from the
diff, and one of them was a genuine regression introduced an hour earlier.

**Removing a card orphaned two buttons on OTHER screens, and its own defensive
guard is what hid it.** v245 deleted Fuel's "Today's plan" card. `openMealPlan()`
still ran `go('fuel')` and scrolled to `#mealplan` — an anchor that no longer
existed — and its `if(el)` guard turned that into a silent no-op rather than an
error. Two live callers survived the removal: "See today's meals" on the
day-complete sheet and "Today's meals" on the rest-day sheet. Both became dead
ends that promise food and show none, which is precisely the "a promise in UI
text is a specification" defect this file already names. Found by counting real
call sites (`grep -c 'openMealPlan('` → 3, one being the definition), not by
reading the diff, which showed nothing wrong because the breakage was in files
the diff never touched. **When a render site is deleted, grep for every caller of
the navigation helper that pointed at it** — the helper is the thing that
outlives the markup.

The fix moves the anchor to where the content went (Reference still renders the
worked days) rather than deleting the buttons, and relabels both to "Meal ideas"
so the label matches the destination. The check drives `openMealPlan()` for real
and asserts the destination tab *contains meals* — a source scan for `'ref'`
would pass just as happily with the anchor deleted, and the anchor-only mutant
proves it: it fails the "the anchor actually exists" assertion alone.

**A `.grid3` moved onto Progress needed its performance verified, not assumed.**
`renderProgress()` carries a documented 400ms budget, and this round added
`homeSummaryHTML()` (which walks `computeStreak`, `sessionsDoneCount`,
`waistDropShow`) to the top of it. Measured against the suite's own year-of-
history soak data: Progress worst-of-five at **134ms**, and `homeSummaryHTML()`
itself ~0.2ms per call. Comfortable, but the point is that the number was read
rather than guessed — the `acwr()` regression in v227 was exactly this shape and
only the budget caught it.

**A parameter left dead by a UI removal.** `workoutTabHTML(…,restedToday)` lost
its only consumer when the Rest day tile moved to Program — `todayWorkoutHTML()`
computes its own copy for its own banner, so the argument was still being passed
and never read. Confirmed by brace-matching the function's real span rather than
eyeballing it, then dropped from both the signature and the call site.

**`STATE.nutrition.plan` had become write-only, and that one IS worth fixing.**
`renderFuel()` kept a `currentMealPlan()` priming call whose comment explained it
ran "before any markup is built" — but v245 deleted the only markup that read the
plan, so every Fuel render generated recipes and `save()`d them for a value
nothing displays. Removed. The generator is untouched and still covered directly
by suite 20.

**Removing it broke a check that asserted the RENDERER rebuilds a stale plan**,
which was only ever true because Fuel displayed one. Same repair as the three
`09-audit` checks above: the invariant (a stale plan rebuilds, a fresh one does
not) is real and still worth having, so it was re-pointed at `currentMealPlan()`
itself rather than deleted. Asserting it through `renderFuel()` now would be
asserting it through nothing — the render path no longer touches the plan, and
reading `STATE.nutrition.plan` back after a render finds `null`.

**The dead chain left behind is deliberate and was traced, not assumed.**
`mealPlanHTML` → `_recipePlanHTML` → `regenPlan`/`openGrocery`/`todaysWorkedDay`
are all unreachable from app code now. They are kept because suite 20 drives the
generator directly and the shopping list the grocery sheet duplicated still
renders inline on Reference — so nothing user-facing was lost. Verified by
counting real call sites per function rather than trusting the diff, which is
also how the `openMealPlan()` dead end above was found.

## A ninth baseline test: Jump Squats, and re-anchoring explosive power (v247)

Asked directly, after a review of whether the baseline test was still
comprehensive given how far the program had grown: "is our initial fitness
test still comprehensive?" That review found the 8-test battery still doing
its real job correctly — every one of the (by then) 178 exercises traces back
to it, either directly (anchored) or through the athlete's overall level tier
— but explosive leg power had never had its own test. `jumpsquat` was anchored
to the `squat` test as a proxy, because that was the closest number available,
not because a squat rep max is actually what predicts jump-squat capacity. The
athlete confirmed they have both the app's own built-in stopwatch and a tape
measure, and asked for the jump squat test specifically.

**Placed SECOND, not appended at the end.** Every existing test is a hold or a
max-effort rep set — local muscular endurance, which tolerates some prior
fatigue and still gives a usable number. A jump squat test measures
neuromuscular power, the single most fatigue-sensitive quality of the eight
(now nine). Running it last, after six-plus other maximal efforts, would have
measured a tired athlete's ceiling, not a fresh one's. It goes right after
Plank — gentle enough to open on, nothing explosive attempted before the body
is warm — and this file's own prior note already established that `TESTS` is
read by id everywhere, never by position, so reordering it is safe. The
trunk-fatigue-run check (`21-integrity.test.mjs`, "no more than two trunk
tests run back to back") already reads `TESTS` generically rather than a
hand-kept id list, so the reorder didn't need a second copy of that rule
updated by hand — it just had to stay under the same limit, and it does.

**A fixed 20-second countdown, using a timer mechanism that had shipped but
never actually been used.** `startBaselineTimer()` has supported a `t.dur`
countdown-then-enter-your-reps mode since the file's own comment described "the
60s bicycle test counts DOWN" — but no test had ever actually set `dur`
(bicycle counts UP, to failure, same as every other timed test). The mechanism
was fully built and completely dead code. Jump Squats is the first test to use
it, with `dur:20` — long enough for a meaningful rep count, short enough to
stay dominated by explosive/anaerobic-alactic output rather than becoming a
conditioning test.

**That dead code hid a real, if harmless-until-now, bug.** The reps-entry
label read `` `Good reps in the 60 seconds` `` unconditionally whenever `t.dur`
was set — a hardcoded number with no test to ever exercise it. Fixed to read
the test's real `t.dur`. This shipped as part of the same round precisely
because touching the only code path that could ever trigger it is what
surfaced it — the same shape as this file's other "reading a mutant back"
lessons: a latent defect that looks harmless only because nothing had ever
called it.

**`jumpsquat` becomes the power test's own anchor exercise, matching the
self-anchor convention every other test's exercise already uses.** `pushup`
anchors to `push` at `hardness:1`, `squat` anchors to `squat` at `hardness:1`,
and so on — the exercise that IS the test always sits at 1.0. `jumpsquat` was
re-anchored from `squat` (hardness 0.35, a borrowed proxy) to `power`
(hardness 1, its own real number). `splitjump` and `broadjump`, the harder
rungs above it in `legPowerL`, keep their ORIGINAL relative spacing rebased
onto the new 1.0 ceiling (0.3/0.35 and 0.2/0.35 of the old squat-anchored
values → 0.85 and 0.6), rather than being left proportional to a test that no
longer has anything to do with them.

**`TEST_DEFAULTS` was hoisted out of `computeAssessment()` to module scope,
and a validator check now keeps it and `TESTS` in lockstep, both
directions.** It was a local literal keyed to exactly the original 8 ids —
adding a 9th test without a matching default would have left `maxes.power`
`undefined` for anyone who skips the battery (or whose stored result is
corrupt), silently un-anchoring `jumpsquat`/`splitjump`/`broadjump` for them
specifically, the exact "a repair on a field with a fixed set of legal values
needs a membership test" shape this file already names elsewhere. Hoisted
alongside `TESTS` itself (same reasoning as `DIET_OPTS`: the same set existing
as two copies is a drift waiting to happen), with `validateData()` now
checking both directions — every `TESTS` id has a default, and no default
names a test that no longer exists.

**"validateData() is clean" proved nothing about that specific rule**, so it
needed its own dedicated check, not just a read of the overall problem count.
`TEST_DEFAULTS` and `TESTS` already agreed in real data, so deleting the two
lines that compare them produced no new problems — the mutation escaped
completely silently against every other check in this round. Caught only by a
check that breaks the data live (deletes a real entry, adds a fake one),
requires the SPECIFIC error message by name for both directions, then
restores — muting `console.error` around it the same way this file's other
live `validateData()` breaks already do.

**Backward compatibility was verified directly against `prescribe()`, not
inferred from `buildSession()` happening to pick the exercise.** An athlete
whose baseline predates this change has no `maxes.power` at all.
`prescribe()`'s existing `anchorUsable` guard already handles a missing anchor
value by falling through to the unanchored base/level formula — true for any
exercise, not something this round had to build — so nothing crashes or goes
NaN; they simply lose `jumpsquat`'s newly-precise calibration until their next
6-week re-test, the cadence the app already recommends. The first version of
this check called `buildSession(0)` and looked for a `jumpsquat` item in the
result, which depends on that ladder actually being reached at that calendar
position — a fact about session composition, not about the anchor fallback
under test, and exactly the "every block builds the state it asserts on"
trap this file keeps naming. Fixed by calling `prescribe('jumpsquat', pos)`
directly.

**Mutation-tested against seven seeded defects. Six were caught on the first
pass** — a missing `TEST_DEFAULTS` entry, the anchor left on `squat`,
`jumpsquat`'s hardness left below 1, a broken ladder ordering, the stale "60
seconds" label, and a countdown that never stops itself. All six also
cascaded into unrelated failures elsewhere in the same suite run, which is
the expected shape when a real safety net is removed rather than a
test-only assertion. **The seventh — deleting the `TEST_DEFAULTS`/`TESTS`
lockstep check itself — is the one described two paragraphs up**: it escaped
every existing assertion cleanly, because the data those two lines compare
was already correct. It only started failing once a dedicated live-break
check existed for it specifically.

## Progress photos moves next to the goal picker (v248)

Asked directly, with a screenshot of each section: "should these two be
closer together." "Your transformation" (the physique-goal picker with
generic reference images) and "Progress photos" (the athlete's own before/now
shots) used to sit five sections apart — a stat grid, body composition,
logged measurements, a strength-test card, and a consistency heatmap in
between. Both cards answer the same question, one as an aspirational
reference and one as real proof, and there was no reason found to keep them
apart: the goal card's `~27%` body-fat estimate reads `latestWeightKg()` plus
height and age, never the waist chart that used to sit between them —
confirmed by reading `estBodyFat()` before proposing the move, not assumed.

**Moved photos up to the goal picker, not the goal picker down to photos.**
Real photos of yourself are the most motivating thing on the tab; they now
render immediately after the Core Score ring and the goal card, ahead of the
numeric detail sections (stats, body composition, strength test, consistency)
rather than after them.

**Asserted on real DOM order, not proximity in the source string.** A helper
can render more section-labels than the one line that calls it, so the check
walks `#v-progress .section-label` and confirms Progress photos is the
element immediately after Your transformation, and that it now sits before
Body composition/Strength test/Consistency rather than after all three.
Mutation-tested by reverting the move: both assertions caught it, and neither
needed a fixture change since nothing else on the tab reads photos by
position.

## Strength Trends covers all nine tests, and an audit finds two more (v249)

Asked directly to add all nine tests to the Strength Trends chart, and
separately to audit that the baseline test is properly interlinked to every
week of the program — a broader ask than the chart alone. The chart itself
was the reported symptom; auditing every consumer of `TESTS`/`maxes` (not
just re-reading the chart) surfaced two more real gaps, both the exact
"a hand-kept list drifts behind `TESTS`" defect `TEST_DEFAULTS` was hoisted
in v247 to prevent — in two places that hoist did not reach, because neither
is a simple flat literal `TEST_DEFAULTS` could stand in for.

**`STRENGTH_METRICS` was its own five-test literal**, hand-curated to
core-only movements (Plank, Side Plank, Hollow, Rev. Crunch, Bicycle) since
before `power` existed. Now derived from `TESTS` directly —
`TESTS.map(t=>({k:t.id,label:STRENGTH_LABELS[t.id]||t.name,unit:t.unit}))` —
so a future test gets a chip automatically. `STRENGTH_LABELS` is the one
place worth keeping hand-written: `TESTS[].name` is built for the assessment
flow ("Bicycle Crunches (max time)"), too long for a chip, and an id with no
override falls back to the full name rather than silently disappearing.
The caption ("the truest measure of core strength") no longer matched its
own content once Push-Ups, Squats and Jump Squats — none of them
core-specific — joined the chart, so it changed too: a promise in the UI is
a specification, pointed at this file's own copy for once.

**`estimateMaxes()` had no `power` entry in its own internal defaults
literal — found by audit, not reported.** It is the LAST gate every stored
`maxes` object passes through before `prescribe()` ever sees it, and every
other field degrades to a plank-scaled estimate when missing or corrupt
(`push:Math.round(12*s)`, etc.) so an athlete keeps SOME anchored precision
through a bad backup or a skipped question. `power` had nothing to fall
back to, so it alone dropped all the way through to the generic unanchored
branch — safe (`prescribe()`'s `anchorUsable` guard prevents a crash or a
NaN), but a real, silent loss of the calibration the other eight fields
keep. Fixed with the same `10*s` scaling the other seven already use.

**`skipBaseline()` had the identical gap, and its own comment already
named this exact defect class once before.** "All EIGHT anchors, not
five... left push/pull/squat undefined, so every Phase-2 exercise fell
through to the generic branch and ignored the athlete entirely" — that was
the 5→8 fix. v247's 8→9 change never touched this literal, so it recurred
for the identical reason: a hand-kept maxes object, not read from `TESTS`.
An athlete who skips the whole battery got estimates for eight lifts and
none for Jump Squats specifically — invisible in `prescribe()` (the missing
`estimateMaxes()` default covered for it) but visible on Strength Trends,
which reads `s.maxes[k]` directly and would show "no data" for Jump Squats
alone while every other lift had a number.

**A `validateData()` check on `estimateMaxes()` closes the class, not just
the instance.** Static comparison against a list was not possible — the
defaults are computed inline (`Math.round(12*s)`), not stored in an
inspectable map the way `TEST_DEFAULTS` is — so the check calls the real
function with `{}` and confirms every `TESTS` id comes back finite and
positive. Same "the validator is clean proves nothing about the rule
itself" trap as the `TEST_DEFAULTS` lockstep check: the current data is
correct, so deleting the two lines that verify it produced no new problems
and the mutation escaped silently on the first pass. Caught only by a
dedicated check that monkey-patches `estimateMaxes()` itself for the
duration of one `validateData()` call, deletes `power` from its output,
and requires the specific complaint by name — muting `console.error`
around it the same way this file's other live `validateData()` breaks
already do.

**Everything else audited came back clean, and is recorded here as
evidence, not assumption.** `commitAssessment()`'s PR-seeding and
`retestDrop()`'s big-score-drop comparison both already iterate `TESTS`
generically rather than a hand-kept list, so both picked up `power`
automatically with no change needed. `reassessGate()`/`currentMaxes()`'s
cycle-keyed reassessment lookup is untouched by test count and continues to
work. `STANDARDS` (the separate Strength Standards benchmark screen) is a
deliberately curated list of well-known movements, most of which are not
baseline tests at all (Pull-Up, Chin-Up, Dips, Pistol Squat, Dead Hang) —
not required to mirror `TESTS`, and left alone; adding a Jump Squats row
there is a real option but needs its own Novice→Elite tier values chosen
thoughtfully, not a drive-by addition.

## A pre-launch pass finds a real drift check broken by its own arithmetic (v250)

Asked directly, with the program about to see real use, to run everything —
the full suite, the validator, and confirmation the whole chain holds
together end to end. The 22-suite battery was already green; what it could
not catch was a check that only fails for SOME real athletes depending on
their exact bodyweight, because the suite's own seeded fixture happened to
sit on a value where the bug is invisible. Found by driving a full
onboarding → 9-test baseline → multi-week session sweep → nutrition → every
tab, at an ordinary 85kg, not by re-reading code already covered.

**`validateData()` compared `kcalPerStep()` (unrounded) against
`stepKcal(1000)/1000` (built by rounding to a whole kcal *then* dividing by
1000) with a `0.0002` tolerance — a comparison that fails purely from the
rounding step for roughly 60% of realistic bodyweights (checked across every
0.1kg from 40–150kg), with nothing actually wrong.** The project's own
seeded test athlete (88kg) happened to land on one of the exact weights
where `0.5×kg` is a whole number, so the identical comparison duplicated in
`07-movement.test.mjs` had been passing by coincidence of the fixture
weight, not because the check was sound — confirmed by testing a handful of
other weights (85kg among them) and watching it fail for a reason that had
nothing to do with the code being wrong.

Fixed by checking the actual promise `stepKcal()` makes —
`stepKcal(1000)===Math.round(1000*kcalPerStep())`, exact integer equality —
which is immune to the rounding the old comparison tripped over, confirmed
clean across the same 40–150kg sweep in both the app's own validator and the
test file's duplicate of it. Mutation-tested by drifting the two constants
apart for real: both catch it immediately.

Everything else audited clean on this pass: the full 22-suite battery,
`validateData()` on a real freshly-built athlete's data, a 9-test baseline
walked through the real sheet, a sweep of `buildSession()` targets across 12
weeks confirming every prescribed target is finite and positive, the guided
player opening without error, food logging with a photo portion rendering
correctly on Fuel, every one of the six tabs free of placeholder text and
broken images, and a real `exportData()` run against this session's own
state completing without throwing.

## The baseline test never checked a flagged joint, and "tunes warm-up" was a sentence, not a number (v251)

Asked directly to confirm the onboarding quiz is comprehensive and actually
wired into program design, the initial core test, and strength/endurance
work — not just collected. Auditing every `STATE.profile` field the wizard
writes against every place it is read (the same method `focusBonus()`'s
audit used) found two real gaps, both the same shape this file keeps
finding: a control that looks connected and isn't.

**`renderAssessStep()` read `EX[t.ex]` straight through, with no `safeSwap()`
call at all — the ONE place in the app that asks for a genuinely maximal
effort had never been taught about a flagged joint.** Five of the nine
baseline tests use an exercise `JOINT_RISK` already flags: `pushup` (wrist),
`invertedrow` (shoulder), `jumpsquat` (knee), `revcrunch` and `bicycle`
(lowback). `prescribe()` routes every ordinary session away from a flagged
joint's risky moves; the baseline battery — which asks for reps or a hold
"until it breaks," harder than anything `prescribe()` ever assigns — was
routing an athlete straight at the same moves the rest of the app exists to
protect them from. A shoulder-flagged athlete opening the "pull" test got
told to row to failure on the exact movement `JOINT_RISK.shoulder` lists.

Fixed by calling the SAME `safeSwap()` every other flagged-joint
substitution in the app already uses: `renderAssessStep()` computes
`exId=safeSwap(t.ex)` and shows, times, and photographs the substitute
instead. The score still saves under the test's own id (`t.id`), so every
downstream `maxes`/anchor read is untouched — only which movement earns
that number changes, exactly like any other safe-swap substitution
elsewhere. **Silent substitution was the wrong call here even though
`prescribe()` itself is silent everywhere else** — a maximal-effort test is
the one place the athlete needs to know their number reflects a different
movement than the one named on screen, so the sheet now shows an explicit
note ("Swapped to X — you flagged your shoulder…") and the exercise-info
button points at the real tested movement, not the original.

**Onboarding's mobility question is labelled "tunes warm-up & cool-down,"
and until this round nothing it wrote ever reached a number.** `mobility`
was read in exactly two places, both banner text above the flow ("Hold each
stretch a little longer — building mobility is one of your goals" /
"move slowly and take the full range") — never the actual hold duration a
flagged-low-mobility athlete was given. A promise in the UI is a
specification this file has named before; this one had been sitting unmet
since the field was added. `mobilityFlow()` makes it true: a `'low'`
answer now gives 25% longer holds in both `runWarmup()` and
`runCooldown()`, including the joint-aware addition `jointAwareWarmup()`
inserts, since that item is built from the same durations and would
otherwise be the one thing in the flow the promise still didn't cover.
Scoped to exactly what the banner already claims — `'ok'`/`'good'` are
left at the original durations, since nothing in the copy promises them
anything different.

**Everything else the wizard collects was traced and confirmed already
wired, not assumed clean from prior rounds.** `goal`, `days`, `gear`,
`tightSpace`, `limitations`, `focusPrimary`/`targets`/`troubleZones`,
`experience`, `activity`, `diet`/`allergens`/`meals` all resolve to a real
downstream read, most already covered by earlier rounds' own audits
(`focusBonus()`'s dead-input fix, the corrective-work and joint-aware
warm-up additions, `todayKcalBudget()`). `conditioning` (labelled "scales
your HIIT & finishers") is read exactly once, to multiply the target of
any `cardio`/`dynamic` exercise — a legitimate, if coarse, scaling knob,
left alone. The free-text "anything else to avoid" field is documented
elsewhere in this file as deliberately not a filter, which is not a defect.

**No dedicated cardiovascular endurance/stamina test exists in the
baseline battery** — all nine tests measure strength or local muscular
endurance (holds and max-rep sets); "conditioning" is self-reported only,
never objectively tested the way every other capacity in the battery is.
Named here rather than built this round: adding a tenth test is the same
scale of change as the Jump Squats addition (v247) — a new ladder anchor,
a calibrated `hardness`, a `TEST_DEFAULTS` entry, `validateData()`
coverage — and, unlike the two fixes above, it is a real product decision
(what movement, what duration) rather than a defect with one correct
answer, so it is left for the athlete to decide rather than assumed.

Both fixes driven live through the real sheet, not asserted on function
output alone: `tests/04-journey.test.mjs` drives `openAssessment()` with a
shoulder flag set, walks to the "pull" test, and confirms the swap note,
the substituted photo/instructions, and the info button all show the
substitute — then repeats with no flags set and confirms nothing changed.
`tests/09-audit.test.mjs` confirms `mobilityFlow()` scales `'low'`
correctly (including the joint-aware addition), leaves `'ok'`/`'good'`
alone, and does not mutate the shared `WARMUP_FLOW`/`COOLDOWN_FLOW`
arrays. Both mutation-tested: reverting the assessment swap to
`exId=t.ex` fails all four of the new swap-note checks; reverting
`mobilityFlow()` to a no-op fails all three of the new scaling checks.

## A tenth baseline test: Burpees, for stamina the battery never measured (v252)

v251's audit named a real gap and deliberately didn't build it: nine tests
measure strength or local muscular endurance, and none measure
cardiovascular stamina — "conditioning" is self-reported only, never
checked against a real number. Asked directly whether to build it now
rather than leave it open, and told yes.

**Placed LAST, the opposite reasoning from Jump Squats.** Every other test
in the battery is a hold or a max-effort rep set that tolerates some prior
fatigue; Jump Squats (v247) went second specifically because IT couldn't
tolerate any. A 60-second near-maximal full-body/cardio effort is the
reverse case — it is the fatiguer, not the fatigue-sensitive one, so it has
to run after everything else or it would leave its mark on every number
that follows it, the exact plank→side→hollow→crunch problem `TEST_PROTOCOL
2` already fixed once, just for the whole body instead of one region.
`{id:'stamina', unit:'reps', ex:'burpee', dur:60, bench:30}` — reuses the
existing `t.dur` countdown-then-enter-reps mechanic Jump Squats already
proved out, not a new one.

**`EX.burpee` itself is deliberately untouched.** Every other test's
exercise self-anchors (`anchor` equals the test's own id, `hardness:1`) —
but burpee is `unit:'time'`, like every cardio/dynamic exercise in the
library, because HIIT circuits and cardio finishers are always prescribed
as timed rounds, never rep counts, and it is already used that way at
several existing call sites. Anchoring it to a `unit:'reps'` test would
require changing its own `unit`, which would silently change what every
one of those existing circuits prescribes — the anchor-usability check
(`_at.unit===ex.unit` in `prescribe()`) exists precisely to keep an
exercise's unit and its anchor test's unit in agreement, and fighting that
check to force a mismatch was the wrong call. `TESTS[i].ex` only points at
burpee for display — photo, instructions, `openExerciseInfo()` — the same
role `t.ex` already plays for every test; it does not require the
underlying `EX` entry to be anchored to it at all. `maxes.stamina` is
recorded, drives Core Score/level and the Strength Trends chart (both
already fully generic since `TEST_DEFAULTS`/`STRENGTH_METRICS` were hoisted
in v247/v249), but does not feed back into any live prescription — the
same deliberately-scoped posture v226 already took for logged load
("a worse mistake than leaving the athlete to read their own log"),
applied here to a second kind of objective measurement.

**The v251 baseline-safety fix generalised to this test for free, and that
was worth proving rather than assuming.** Burpee is flagged BOTH `shoulder`
and `wrist` in `JOINT_RISK` — a shoulder- or wrist-flagged athlete taking
the new stamina test is routed to a safe substitute by the exact same
`safeSwap()` call `renderAssessStep()` already makes for every test, with
zero new code. `tests/01-data.test.mjs` calls `safeSwap('burpee')` directly
under each flag and confirms it lands somewhere else, which is the real
claim — not that the test SHOWS a swap note (already proven generically in
v251), but that THIS specific exercise, safety-flagged on two joints,
actually triggers the mechanism.

**All ten anchors, not nine — the same drifting-literal defect this file
has now named three times.** `TEST_DEFAULTS`, `estimateMaxes()`'s internal
defaults, and `skipBaseline()`'s literal all needed the new id added by
hand; `validateData()`'s existing lockstep checks (hoisted generic in
v247/v249) caught a real, deliberately-seeded omission in
`estimateMaxes()` immediately — 13 assertions failed from one missing
field, cascading exactly the way a real safety net is supposed to.
`TESTS.length`/count assertions in `tests/04-journey.test.mjs` and
`tests/21-integrity.test.mjs` were hardcoded tripwires (9 → 10), updated
by hand on purpose rather than derived, matching this file's own
established call on when a literal count is worth keeping as a deliberate
"did anyone forget to update this" check rather than a tautology.

**A mutation harness sharing a live test run is exactly the hazard this
file already named once, and it recurred.** Swapping `index.html` on disk
for mutation testing while a separate, already-running full-suite process
was still reading that same file from disk produced a real-looking failure
in an unrelated suite (`estimateMaxes({}) has no usable default for test
"stamina"`, surfacing in `15-voice.test.mjs`) — the mutant's missing field,
picked up mid-run by a suite that had nothing to do with the change being
tested. Confirmed the working file was clean (byte-identical to a saved-
clean copy) and re-ran the full suite in isolation, which passed cleanly.
The fix is procedural, not code: never mutate the shared `index.html` while
another test process might still be reading it, full stop — not just
"restore before the next mutation," which was already being done and
still wasn't enough.

## Importing a screenshot from another tracker (v253)

Asked directly: the athlete tracks macros in a separate app (Lose It) every
day and wants that number carried into CoreForge without retyping it. A
live account-to-account sync isn't possible — CoreForge has no server, and
Lose It has no open API for a hobbyist integration to plug into — but the
app already had almost everything needed for the honest alternative: a
screenshot of the numbers Lose It already computed, read straight into the
log, rather than re-estimated.

**`foodPhoto()` ESTIMATES from a photo of food; `foodScreenshot()`
TRANSCRIBES numbers that are already on screen — same model, same key, a
different job.** Reusing `estimateFoodFromImage()`'s exact prompt on a
screenshot would ask Gemini to *guess* the calories in a photo of a
calorie-tracking app, which throws away the one advantage a screenshot has
over a food photo: the number is already computed and correct. The new
prompt says so explicitly — "read the exact numbers shown... do NOT
estimate, recalculate, or round beyond what is already displayed."

**One shared pipeline, not two.** The model-fallback loop, JSON-schema
parsing, error surfacing and the physiological macro clamp (`protein*4`
can never exceed `kcal`) all lived inside `estimateFoodFromImage()`, so
adding a second entry point the naive way would have meant copying all of
it — and this file's own history is full of exactly that kind of copy
drifting apart. Pulled into `_visionEstimate(dataUrl, promptText)`, with
`estimateFoodFromImage()` and `estimateFoodFromScreenshot()` now both thin
wrappers that supply only the prompt. Refactoring it broke a PRE-EXISTING
test — `20-diet.test.mjs`'s portion-schema check read
`estimateFoodFromImage.toString()` for the schema literal, which no longer
lives there — caught immediately by the suite, not shipped and found later.

**`foodPhoto()` forces the camera open (`capture:'environment'`) because
the athlete is standing over a plate; `foodScreenshot()` must not, since
the screenshot already exists in the photo library.** Same `<input
type=file>` shape, one attribute different — get it backwards and the
screenshot button demands a live camera photo of your phone's own screen.

**A reply of `kcal:0` AND `protein:0` from the screenshot path is not a
real zero-calorie food — it is the model doing exactly what the prompt
asked ("if you cannot clearly find numbers, do not guess").** Opening the
log sheet pre-filled with two zeros looks identical to a deliberate
zero-calorie entry, which is worse than the toast-and-fall-back-to-manual
pattern every other failure in this flow already uses. `_screenshotUnusable(est)`
is named and factored out on purpose, matching this file's own established
reasoning for `dietOk()`/`parqFlags()`/every other fail-closed predicate:
a control worth trusting has to be provable on its own, not only inferable
from driving the full UI around it — which for a dynamically-created,
never-DOM-attached `<input type=file>` has no working pattern in this
suite at all. The guard function is unit-tested directly; a SEPARATE
source check confirms `foodScreenshot()` actually calls it on the estimate
it received, since the first draft of this round proved the guard correct
in isolation and then shipped a version that never called it — mutation-
tested by deleting the call site, which the isolated-guard checks alone
did not catch and the wiring check does.

**The privacy note is a specification for what leaves the phone, and this
adds a second thing over the same wire the old sentence didn't name.**
`privacyNoteHTML()` said "the food-photo lookup sends **that photo** to
Google Gemini" — technically still true, but a screenshot is also a photo
sent to the same place, and the old wording read as if only food photos
qualified. Reworded to name both rather than leaving the second one to be
inferred, the same "a privacy blurb that omits a real outbound call is
worse than no blurb" instinct this file already applied to Open Food
Facts (v230).

**Five mutants seeded, five caught** — the two functions sharing one
pipeline (collapsed `estimateFoodFromScreenshot` onto
`estimateFoodFromImage` directly), the button missing from Fuel, the
privacy note reverted, the physiological clamp disabled (proving the
screenshot path exercises the SAME clamp code, not a copy that only the
photo path runs through), and the wiring gap described above.

## The Gemini timeout was too short, and the athlete found it within minutes (v254)

v253 shipped, and the first real use of the new screenshot-import button
failed with "Screenshot import failed — timed out — check your connection."

**`_geminiCall()` was using `fetchWithTimeout()`'s bare 8000ms default —
sized for `offSearch()`'s small JSON request, never adjusted for a call
that uploads an image and waits on model inference.** That undersized bound
already applied to the food-photo estimate (`foodPhoto()`) too; v253 just
made it easy to hit, because a screenshot needs more resolution to keep
small on-screen digits legible (1280px vs. 768px for a food photo), and a
bigger base64 payload takes longer to upload on an ordinary connection.
Bumped to 25s — real headroom, not a shrug; a genuinely dead connection
still gives up. `ms` is a real parameter on `_geminiCall(model,body,ms)`,
not a hardcoded 25000, for the exact reason `offSearch(q,ms)`'s already is:
so a test can pass a short one instead of waiting out the real default.

**Found and fixed inside the hour, by the person the fix is for.** Nothing
about this needed a new audit method — it's the same "no network call had a
timeout" gap `fetchWithTimeout()` itself was built to close in v238, just
under-sized on one specific call site. The regression test is the same
shape as `offSearch()`'s own hang test one section above it: a route that
never fulfills, a short `ms`, and an assertion that the rejection lands
close to the requested timeout rather than the browser's own TCP ceiling —
plus a second check reading the real production default's value back out
of the source, so a future edit can't quietly shrink it to 8000 again
without a check noticing.

## The screenshot never reached the model legible (v255)

v254 fixed the timeout and the next real attempt got further and then
failed differently: "could not find clear numbers in that screenshot." The
model was not the problem. The image was destroyed before it was ever sent.

**`_downscale()` bounds the LONG edge, which is right for a plate and wrong
for a portrait screenshot.** A 1179×2556 phone capture sent at max 1280
arrives **590 wide** — the horizontal resolution the text actually lives in
is halved, and small digits stop being legible. The food-photo path never
noticed because a plate has no small text on it. Raised to 2048 for the
screenshot path only, which keeps a typical capture ~945 wide.

**JPEG quality 0.8 lays its ringing artifacts exactly on sharp edges, which
is the entire visual content of a digit.** `_downscale(dataUrl,max,q)` grew
a `q` parameter; the screenshot path passes 0.92. Both parameters default
to the original values, so the food-photo path is byte-for-byte unchanged
— the point is that a text-reading job and a plate-estimating job have
genuinely different encoding needs, not that the old numbers were wrong for
what they were chosen for.

**The prompt also said "if you cannot clearly find calorie and protein
numbers... return kcal:0 and protein:0" — an AND that invites bailing
entirely when only one number is visible.** Rewritten to say where the
numbers might be (totals rows, summary headers, progress rings, budget
rows, per-item lists), that macro labels are often abbreviated, and that a
PARTIAL reading is useful: return 0 for the one field genuinely absent and
still return everything else found. Only a picture with no nutrition
numbers at all should come back empty.

**The dimension checks are measured on a real canvas, not asserted from the
source.** A canvas painted with actual text (a flat fill would compress
identically at any quality and prove nothing about `q`), downscaled at both
the old and new settings, then read back through an `Image` to get real
pixel dimensions and payload size. What that catches: the old cap really
did crush the width, the new one really does keep more, and `q` is honoured
rather than an ignored argument.

**A source check on the wiring is still needed alongside them**, and the
mutants show why the split is the right one: reverting `foodScreenshot()`
to `_downscale(rd.result,1280)` fails ONLY the wiring check, because the
dimension checks call `_downscale()` directly with explicit arguments and
are therefore blind to what any caller passes. Ignoring the `q` parameter
inside `_downscale()` fails only the behavioural quality check, which the
source check cannot see. Neither alone covers the fix.

**A pre-existing check broke on the prompt rewrite, and the check was the
thing that was wrong.** `o.shotSaysRead` matched the literal string
`do NOT estimate`; the reworded prompt says "READ them, not to estimate
them — do NOT recalculate," which is the same rule in different words. A
check pinned to one phrasing of a prompt fails every time the prompt is
improved, for a reason that has nothing to do with the rule still holding.
Re-pointed at the property: it must tell the model to READ, and it must
forbid estimating.

## The audit the athlete had to ask for, and the silent-coach bug it found (v256)

The screenshot import failed twice in a row on first real use (v254 timeout,
v255 image fidelity) and the athlete pushed back on the whole premise: how
does a feature ship "clean and ready" through 22 green suites and then break
on the first tap. The answer is specific and worth writing down rather than
answering with more tests.

**Every test written for the v253 screenshot feature mocked `_geminiCall`.**
They proved the plumbing — the right function is called, a junk reply is
handled, the button renders, the guard fires. Not one sent a real image to a
real model. Both shipped bugs lived precisely in the gap a mocked test cannot
see: how long the call may take, and what the image looks like by the time it
arrives. A green suite said the wiring was connected; it never said the
feature worked, and it was reported as though it had.

**And that gap cannot be closed from this sandbox.** Verified rather than
assumed: `world.openfoodfacts.org` is unreachable (connection refused) and
`generativelanguage.googleapis.com` returns 403 through the agent proxy. So
two of the app's three external integrations are structurally unverifiable
here, by any method. The honest posture when shipping one of them is to say
so plainly, not to list the suite count. Real-device confirmation by the
athlete is part of the ship, not a formality after it.

**Auditing that defect CLASS — an unbounded external call whose failure mode
is silence — found a worse instance than the one reported.** `loadSpeechSDK()`
injects a `<script>` from `aka.ms` with `onload`/`onerror` and no timer. A
request that STALLS rather than fails fires neither handler, so `_sdkPromise`
never settles, so `_sdkSynthesize()` never settles, so `neuralSpeak()`'s
`.catch` never runs and `onFail()` — the device-voice fallback — never fires.
`_sdkPromise` is memoised, so it is not one lost cue: the coach goes silent
for the REST of the session, in the one feature whose entire premise is
hands-free. `speakSsmlAsync()` has the same shape over a WebSocket and needed
the same bound. Both now take a real `ms` parameter, same as `offSearch(q,ms)`
and `_geminiCall(model,body,ms)`, so a check can pass a short one.

**Two of the four mutants did not fail the suite — they HUNG it**, which is
the same non-outcome `fetchWithTimeout()`'s own mutation produced in v238 and
is the most direct possible demonstration: removing either bound turns a
bounded rejection into an unbounded wait, and only a wall-clock kill ends it.

**The third mutant escaped, and the check was the defect.** "A timeout that
does not clear `_sdkPromise` leaves the session wedged" was tested by calling
`loadSpeechSDK()` twice and asserting the second call also rejected — which
is true either way, because **an already-rejected promise rejects again the
instant it is awaited**. The discriminator is TIME, not outcome: a cleared
promise makes a genuinely new attempt and sits out the bound again, a wedged
one returns the dead promise in ~0ms. Re-pointed at elapsed time, it caught
the mutant immediately. Same family as every other entry in the "tests that
pass for the wrong reason" section, found the only way this class ever gets
found — by seeding the exact defect and watching the check not care.

**A rejection nothing listens to is the same silence with better logging**, so
the fallback itself is driven end to end: a stubbed SDK that fails fast, the
real `neuralSpeak()`, and an assertion that `onFail()` actually ran. The
stall-based checks prove the bound exists; this one proves the bound buys the
athlete a working voice.

## A 503 is advice, and the app was not taking it (v257)

Third distinct failure of the same feature on a real phone: Google returned
**503** with a body that literally reads *"Spikes in demand are usually
temporary. Please try again later"* — and `_visionEstimate()` tried each model
once and gave up. Earlier in the same session this exact toast was waved off
to the athlete as "nothing to fix, that is Google being busy." **That was the
wrong call.** A 503 is the textbook retryable status; every serious API client
retries it. Dismissing it as external was treating the symptom's origin as a
reason not to handle it.

**Retry the whole model list, not the individual model.** The pre-existing
fallback loop already covers "this one model is unavailable" — a per-model
retry would just hammer a sick model before moving on. Three passes at
0 / 1.2s / 3s adds at most ~4s to the failure case and converts the common
brief spike into a slower success. Deliberately short: a genuine outage must
still fail fast enough that the athlete falls back to typing the numbers
rather than watching a spinner.

**Only spend the backoff on something a wait can fix.** `_transientAIStatus()`
is 429/500/502/503/504. A 404 on every model, or a reply the parser could not
use, reads identically three times running — retrying it just makes the
athlete wait longer for the same message, so the loop breaks out when no
transient status was seen. 400/401/403 still throw on the FIRST call without
finishing the list, since a key problem repeats everywhere.

**A silent four-second pause reads as frozen**, so the retry is visible
(`onRetry` → "Google's AI is busy — retrying (1/2)…"). A fix that makes the
app appear to hang longer is not obviously an improvement over failing fast;
the toast is what makes it one.

**Once the app retries on its own, the raw upstream prose is the wrong thing
to show.** `slice(0,120)` cut Google's paragraph mid-word — the athlete's
screenshot shows the toast ending "Please try again late". By the time the
message renders the app has already tried three times, so the useful text is
what to DO now. `_aiErrText()` gives transient failures a written answer,
distinguishes 429 (quota — a different fix) from overload, and trims genuine
diagnosable errors at a WORD boundary instead of mid-token.

**Two of the four mutants initially failed by throwing the whole test file
rather than by name.** Removing the retry makes `_visionEstimate()` reject,
and an uncaught rejection inside the `page.evaluate` fails the FILE with a
stack — which hides every assertion after it and says nothing about which
property broke. Wrapping the recovery call in its own try/catch turned both
into four cleanly-named failures. A check that detects the defect is not the
same as a check that REPORTS it, and the difference only shows up under
mutation.

## The retry that could not fire, and the 75-second wait (v258)

Fourth failure of the screenshot import on a real phone, fourth distinct
cause: "timed out — check your connection". **Measured before changing
anything, and the first hypothesis was wrong.** v255 had raised the
screenshot to 2048px/q0.92, so the obvious suspicion was that the upload had
grown too big for the 25s bound — but a realistic flat-UI screenshot encodes
to about **197 KB**, which is not a slow upload on any usable connection.
Payload size was not the cause; guessing would have produced a fix aimed at
nothing.

**`fetchWithTimeout()` stamps `status:0`, and v257's `_transientAIStatus()`
did not include it.** So the retry added one version earlier — specifically
to stop transient failures costing the athlete the import — could never fire
for the single most common transient failure of all. A stalled connection is
exactly what a second attempt fixes.

**But making timeouts retryable without a total budget multiplies the wait
instead of bounding it.** Three models at 25s each already meant a
connection-level stall burned up to **75 seconds** before showing anything;
retrying that three times over would be minutes. Two changes make it safe:
`AI_TOTAL_BUDGET_MS` (55s) is a hard ceiling on the WHOLE operation, and each
individual call is granted only `min(perCall, remaining)` so the total cannot
overrun however the passes fall. And `_connectionLevel(0)` short-circuits the
model loop — a dead connection is not a model problem, so trying the other
two costs a full timeout each and cannot help.

**Two of this round's bugs were in the new code and were caught by its own
tests, not by inspection.** The budget guard first compared the REQUESTED
per-call `ms` against the floor rather than the remaining budget, so a small
`ms` skipped the call entirely and returned a timeout without ever trying.
And a second, fixed `left()<=2000` guard — redundant with the round-start
check — was larger than any small test budget, cutting the retry to one
attempt. Both surfaced as failing assertions immediately.

**The mutant that escaped is the one that matters, and the check was too weak
to see it.** Deleting the total budget outright passed everything: the mock
`_geminiCall` failed in 60ms, which finishes inside any budget, so removing
the clamp changed no timing at all. A budget can only be observed when the
call is slow RELATIVE to it — the mock had to sleep for the slice it was
granted (`ms`), so that with the clamp the first call is capped to the 500ms
remaining and without it runs its full 3000ms. Same family as every other
"passes for the wrong reason" entry here: the scenario has to be engineered
to discriminate, not merely to look right.

**"Check your connection" was also the wrong thing to say.** A timeout is as
often Google being slow under the same load that produces the 503s, and that
wording sends the athlete to fix something that may be fine. It now allows
both, and says it already retried.

## Diagnosing instead of guessing again (v259)

Fifth failure of the screenshot import on a real phone, and the point at
which patching blind stopped being defensible. Four fixes had each been
diagnosed from ONE line of toast text — because nothing in the app reports
what actually happened, and this sandbox cannot reach Google at all. Each
fix was real, but the loop was: guess from a symptom, ship, wait for the
next symptom.

**`runAIDiagnostic()` turns that into numbers the athlete can read out.**
Staged smallest-first on purpose: a text-only ping (a few hundred bytes,
6s bound) isolates key validity and reachability, and only if that passes
does it spend an image. Each stage reports the model, HTTP status, elapsed
ms and payload size, so "the key is wrong" / "the network is slow" /
"Google is overloaded" / "images specifically fail" are four different
readings instead of one indistinguishable toast. The 6s first bound matters:
a dead connection reports in six seconds rather than sitting on the real
25s bound before saying anything.

**The screenshot path stops retrying the identical payload.** v255 raised
it to 2048/q0.92 because a portrait screenshot loses its digits at anything
smaller, and that stays the first choice. But when the failure is
connection-level, the one variable worth changing is bytes on the wire —
~197 KB down to ~104 KB, still 646px wide, comfortably above the 590px that
made v253 unreadable. Preferring legibility and falling back to
deliverability beats failing with a perfect image nobody received. Gated on
`_connectionLevel()` specifically: shrinking the image cannot help a 403 or
a 429, and doing it anyway would be cargo-culting.

**A mutant escaped because the check matched the right word in the wrong
sentence.** "A rejected key is diagnosed as the key" was tested with a bare
`/key/i` — which also matches the generic fallback's own text ("not your
phone or your key"), so deleting the entire 400/401/403 branch passed
clean. Re-pointed at the SPECIFIC diagnosis (`rejected the` plus the
aistudio link) and at the absence of the wrong one (`overloaded`). Same
family as every other entry in the "tests that pass for the wrong reason"
section: a substring that appears in both the correct and the incorrect
output is not evidence of which one was produced.

## Calories without macros is a MISSING answer, not a zero (v260)

The screenshot import finally worked — and the first successful run exposed
a defect worse than any of the five failures before it, because it failed
*silently*. It read "Breakfast · 897 kcal" off a Lose It **meal-summary
row**, which shows no macro breakdown at all, and logged protein, carbs and
fat as **0**. The Fuel bars then sat at 0/165 g protein against a real
897-kcal meal, and nothing on screen said the numbers were never found.

**This is the exact mirror of a rule this file already states.**
`computeAssessment()` was fixed because it treated a measured 0 as absent
(`+results.plank||30`) — a real zero is data and must be kept. The inverse
is just as wrong and lands harder: an ABSENT answer recorded as a measured
zero, on the one number the whole plan is built around. A logged 0 g protein
is not "we could not read it", it is a claim about the meal.

**Keep the calories, blank the macros, say why.** The 897 was really read and
is worth keeping; the macros were not, so `_macrosMissing()` hands those
three fields over as `undefined` rather than `0`, and the sheet replaces its
green "here is your estimate" box with a warning that says the boxes are
**blank, not zero**. Pre-filling zeros and merely warning would be worse than
either: it reads as a complete entry and saves without a second thought.

**The condition is calories-present AND all three macros absent**, not "any
macro is zero" — a real meal genuinely can have 0 g fat or 0 g carbs, and
flagging those would train the athlete to dismiss the warning. Mutation-
tested in both directions: a version that never fires and a version that
fires on every reading with calories are both caught, the second by three
separate checks (protein-only, carbs-only, fat-only readings).

**Detection and presentation needed separate checks, and the mutants prove
it.** Flagging the case correctly but still passing the zeros through to the
sheet fails only the "blanks the macro fields" check; dropping the warning
text fails only the sheet check. Neither alone covers the fix — the athlete
needs both the empty box and the sentence explaining it.

## The model list had rotted, and the diagnostic is what found it (v261)

Six failures of the screenshot import across one day, each with a real and
different cause, each fixed. The v259 diagnostic — built specifically because
patching from one line of toast text had stopped being defensible — found the
root cause underneath several of them on its first real run:

```
❌ gemini-2.5-flash   404 — "no longer available to new users"
❌ gemini-2.0-flash   404 — "no longer available"
✅ gemini-flash-latest  works (2095 ms)
```

**Google retired both pinned model ids for keys created after some cutoff.**
`FOOD_AI_MODELS` led with them, so every import spent two dead round-trips
before reaching the only model that answers — and then handed it whatever was
left of the budget, which after a timeout on the way through was often a
couple of seconds. The timeouts were real, the retries were real, and they
were all downstream of a stale list.

**The fix leads with an ALIAS, not a pinned version.** `gemini-flash-latest`
always resolves to whatever the current flash model is, so it cannot rot the
same way the pinned ids did. The pinned ids stay behind it for older keys
that still have access — this is a reordering plus one addition, not a
replacement, because a key that CAN reach `gemini-2.5-flash` should still be
able to.

**A 404 for a given key is permanent, so re-paying for it on every import is
pure waste.** `foodAiModelOk` remembers the model that actually answered and
leads with it, while still keeping the full list behind — a remembered model
that later breaks costs one wasted call, not a dead end. It is validated
against the list on read (`list.includes(good)`), so a stored id that is
itself later retired is ignored rather than trusted; the mutant that dropped
that guard is caught.

**The diagnostic records it too.** A diagnostic that identifies the one
working model and then lets the app keep leading with a dead one has told the
athlete something true and changed nothing — so both `runAIDiagnostic()`'s
success paths call `_rememberGoodModel()`, and the report says plainly that
it has been saved.

**The lesson is about instrumentation, not about Gemini.** Five rounds of
inference from a symptom produced five real fixes and never reached the
cause. One round of *measurement* did, immediately. When a failure is
happening somewhere the developer structurally cannot reach — a user's phone,
an external API this sandbox is blocked from — the highest-value change is
the one that makes the invisible legible, and it should come first rather
than sixth.

## The macros were always on screen — as percentages (v262)

The import kept logging a real 897-kcal day with 0 g protein, and v260's
warning correctly said "no macros found". Both were wrong about WHY, and the
answer only appeared when the athlete sent the actual screenshot: Lose It's
daily summary shows the split as a coloured bar — **"25% Fat · 34% Carbs ·
41% Protein"** — with no grams anywhere on screen.

**The prompt demanded grams, so the model correctly refused to invent them.**
Worse, `protein` was in the schema's `required` list, which pushed it toward
answering 0 rather than omitting the field. The data was always there; the
app was asking for it in a form the screenshot never contained. Two rounds
were spent telling the athlete their screenshot might not have the numbers.
It did. **When a reading comes back empty, the question is not only "did the
model fail" but "did we ask for the form the data is actually in."**

**The conversion is done in CODE, never asked of the model.** `_macrosFromPct()`
takes the percentages and the calorie total and applies 4/4/9 — exact
arithmetic in four lines of JS, and a coin flip inside a language model. The
prompt says so explicitly ("do NOT try to convert them yourself, the app does
that exactly"). Grams still win when both are shown, so nothing double-converts.

**A partial ring must invent nothing.** All three slices have to be present
and land near 100 together (80–120, loose because trackers round each slice
independently and printed splits often sum to 99 or 101). One slice read as
"41% Protein" alone degrades to the honest macros-missing path rather than
fabricating two thirds of a meal.

**A mutant escaped, and fixing the check found a real bug in the guard.**
"A partly-read ring invents nothing" passed against a version that only
validated protein — because 41 alone is under the 80 floor, so the SUM check
was doing the work and the null check was never exercised. The discriminating
case is a partial ring whose visible slices happen to land in range
(`50, 50, null`). Adding it failed against the CLEAN code too: `n()` coerced
with `+v` first, and **`+null` is 0, not NaN**, so a null slice became a
perfectly valid 0% and sailed through. `undefined` was rejected, `null` was
not. The guard now rejects `v==null` before coercing. Same family as this
file's other "`!= null` is not is-absent" note, from the opposite direction.

## Self-defence: the app tests itself on the phone I cannot reach (v263)

Asked, after seven rounds of the screenshot import failing on a real device,
what separates this from a well-produced fitness app. The honest answer is
not craft or care — this repo has 262 versions of documented reasoning — it
is that a real product team **uses the app on the device it ships to**. Every
test written for the import mocked the network, which proves the wiring and
nothing about the result, and the sandbox structurally cannot reach Google or
Open Food Facts. So the athlete was the integration test, one failure at a
time. Two defences close that, and both are build-time or on-device rather
than another promise to be careful.

**1. The diagnostic now runs the REAL import end to end, on the athlete's
phone, against images whose answer is known in advance.** `_importSelfTest()`
draws a synthetic tracker card — dark background, a calorie total, and either
a gram row or a percentage bar — and pushes it through the actual
`estimateFoodFromScreenshot()`, then compares against `SELFTEST_EXPECT`.
Both layouts are covered because both are common: **MyFitnessPal shows macros
as percentages on its free tier and Lose It locks grams behind Premium**, so
the percentage ring that logged a 897-kcal day with 0 g protein is the
DEFAULT presentation for most users of the two biggest trackers, not an edge
case. Drawn to look like a real card rather than text on white, so it
exercises the same reading problem a real capture does; tolerance is ±3 g or
12%, because rounding is not a failure.

**2. `npm run check` now enforces the external-call contract as a build
gate.** Every failure the athlete hit in one day was the same shape — a call
leaving the phone without the defences such a call needs — and nothing in the
repo objected to any of them. The gate refuses: a bare `fetch()` anywhere but
inside `fetchWithTimeout()`; a `_geminiCall` default under 15s (8000 was what
killed image uploads); a missing `AI_TOTAL_BUDGET_MS` (3 models × 25s with no
ceiling is 75 seconds of silence); a `_transientAIStatus` that omits status 0
or 503 (omitting 0 is what made v257's retry unable to fire for the commonest
transient failure); a `FOOD_AI_MODELS` that pins every id or does not lead
with a floating alias (pinning is what rotted); and a missing on-device
diagnostic or self-test.

**A build gate, not a test, for the same reason the coach-line rule is one:**
the failure mode is a plausible-looking line added months from now by someone
who has not read this file, and the cost of checking is nothing.

**Mutation-tested like any other check, and the sixth seed escaped.** The
self-test requirement was a bare `/_importSelfTest/`, which a rename to
`_importSelfTestX` satisfies — a substring is matched by any longer name that
merely starts the same way. Re-anchored on the definition
(`function _importSelfTest\s*\(`) AND a real call site
(`await _importSelfTest\s*\(`), so a version that defines it and never runs
it is caught too. Same family as every other "passes for the wrong reason"
entry here, this time in the gate rather than the suite.

**The rule this leaves behind: instrumentation before features, for anything
that leaves the phone.** Five rounds of inference from a symptom produced
five real fixes and never reached the cause; one round of measurement did,
immediately. A feature that cannot be verified where it runs is not finished
when its tests are green — it is finished when it can verify itself there.

## Four parallel senior audits, and the twenty fixes they found (v264)

Asked to test every other aspect of the app as thoroughly as the food import
had just been tested, then to fix everything the audits returned. Four
Principal-Engineer passes ran in parallel — workout engine, state/data safety,
UI and the guided player, nutrition math and the service worker. Every finding
was re-verified against real source (and, for the high-severity ones, in a real
browser) before anything shipped. Twenty fixes, nineteen mutants seeded, nineteen
caught.

**The audits found the same defect CLASSES this file already documents, in the
places the documentation had not yet reached.** That is the honest summary:
almost nothing here is a new kind of mistake. It is the known kinds, one
function over from where they were last fixed.

**`onclick="viewPhoto('${p.id}')"` is the `removeMeasure()` breakout of v240,
unfixed one function away.** `normalizeState()` only ever required a photo's
`id` to be truthy, and a restored backup carries them verbatim — so an id
containing a quote closed the JS string and ran what followed. Verified with a
real click setting a real global. Fixed the same way v240 fixed its twin, with
`JSON.stringify()` building the argument. **The check has to inject the rendered
markup into a real element and fire a real click**: the browser HTML-decodes an
inline handler before compiling it, so asserting on the escaped attribute proves
nothing, exactly as v240 already recorded.

**Three more fields reached `innerHTML` with a truthiness "repair" behind them,
and two of them have a fixed legal set — so the fix is a MEMBERSHIP test, not
three escapes.** `profile.unit` (six sinks on the Progress path, two legal
values), `photos[].pose` (five sinks, three legal poses, and the existing repair
only ever guessed at a MISSING pose, never a hostile one), and
`settings.reminderTime` (inside `value="…"`, and a clock time has a shape).
Constraining the value closes every sink at once and cannot be forgotten at a
sink added later — which is the whole argument `DIET_OPTS` already made.

**`hardReset()` said "This cannot be undone" and left a complete, un-stripped
copy of STATE behind — including both API keys in plain text.** The pre-import
snapshot is not a backup file: `exportData()` strips the keys, this does not.
The Undo button was still offered on the freshly-erased app and handed the whole
account back. One `removeItem` — and the check reads the raw localStorage key
rather than `hasPreImportSnapshot()`, so it cannot pass on a getter that answers
no while the bytes are still on the device.

**`restartProgram()`'s confirm says "Your history stays saved" and it destroyed
every session that was logged but never completed.** It archived only when a
`done` session existed, then cleared the map unconditionally — so a run made
entirely of part-finished and pain-stopped work went on the floor. That is
precisely the work an athlete cannot re-create. Same "a promise in UI text is a
specification" class this file names, on the same function that has now produced
three separate defects.

**`nutrition.kcalTarget` had no type repair, and `todayKcalBudget()`
CONCATENATED.** A stored `'2400'` rendered "24000 kcal left today" on Fuel while
Settings two rows down still said 2400. Nothing threw. This is `progressPtr:'12'`
printing "SESSION 121" verbatim, on the number every food surface is measured
against. Repaired in `normalizeState()` **and** made to add in the reader, and
the two halves are checked separately because a mutant reverting either one is
caught by only one of them.

### The service worker was serving another app

**`req.mode === 'navigate'` is true for EVERY same-origin navigation, so opening
the sibling app published from the same GitHub Pages origin wrote ITS page into
`./index.html` — and CoreForge then served that other app offline.** Measured:
1,050,064 bytes of CoreForge replaced by 286,583 bytes of Command, its images
landing in `coreforge-v263` by the same route. This is the documented
`caches.keys()` origin-scoping bug pointed the other way — not deleting a
neighbour's cache, but ingesting its page as your own. The worker now identifies
its OWN shell and its OWN directory explicitly and declines everything else.

**Forcing it in a test needed no fabricated second app**: `/privacy.html` is a
real same-origin page that is not the shell, and under the old rule it was "a
page". The check reads the CACHED BYTES back afterwards, absolutely rather than
relatively — a relative `'./index.html'` read from the sibling page resolves to
the sibling's own path and comes back empty, which reads as a false clean.

**`SHELL_MIN` installed once, non-atomically, and was never topped up.** The
top-up queue was `[...FIRST_RUN, ...EXTRA]`; `SHELL_MIN` went in only at install
via `Promise.allSettled`, whose rejections are logged and dropped. So the brand
font, every icon, the manifest and both legal pages were missing from the
offline pack FOREVER if they failed once. Suite 12's own resume check only ever
evicted EXTRA entries, so it could not see this. Every entry is skip-if-cached,
so adding the tier costs one cache lookup each on a clean install.

### The guided player's third twin, again — and a button wired to nothing

**"Log what you lifted" opened a sheet BEHIND the player, so the app's only
route for recording added load had no input path at all.** `.scrim` is z-index
60 and `.pl` is 75 — the rule this file already states. The sheet built
correctly, set the scrim, and was painted underneath; the button looked dead and
Android Back silently popped an invisible sheet. The whole v221/v226 loaded-
progression feature was therefore unreachable from the finish screen.

Tearing the player down first would have been worse on the program branch — the
feel buttons beside it are what commit the session, and they would go too. It
mounts as an in-player panel next to `#plSwapMenu`/`#plHurtMenu`, the pattern
this file already prescribes, and falls back to a sheet when no player is up.
**The check uses `elementFromPoint` on the input the athlete has to type into**,
not on the panel existing: a panel mounted somewhere unreachable satisfies a
`querySelector` and is the same bug.

**v238's wall-clock anchor was given to `plTickHold()` and never carried to
either twin.** `ivTick()` and `runFlow()`'s own `tick()` were both a bare
`remain--`, which counts CALLBACKS — and Chrome throttles a hidden tab to
roughly one a minute. Measured: six real seconds moved the HIIT clock by two.
A Tabata round or a stretch hold silently ran long every time the phone dimmed,
on the two surfaces most likely to be left unattended. Same `Math.min(byTick,
wallClockRemaining)` floor, and pause re-anchors the deadline the way
`playerToggle()` already does.

**The check STARVES the tick rather than sleeping.** Firing one callback after
real time has passed is what throttling actually does; letting an unthrottled
interval run normally proves nothing, because it is accurate either way.

**Every count-up stopwatch under-counted, and one of them writes a personal
record.** Benchmark Ops recorded 6 s where 10 really elapsed and wrote that
straight into `STATE.opsPR` as a best time. `swStart`/`swSecs`/`swPause` derive
elapsed from the wall clock and subtract only time actually spent paused — one
helper for all four, rather than four copies of the same arithmetic.

**HIIT's rest clock never got the `rest` treatment because `ivRingHTML()` had no
`cls` parameter at all.** So `.pl-ring.rest` never applied: 40% watermark
opacity, no halo, over a full-brightness photo. Measured 1.65:1 against the
guided player's 14.52:1 on comparable artwork — and rest is the ONE phase with
no ten-second `countdownCue`, which is exactly the reason this file gives for
making the player's rest clock solid and haloed.

### Two engine gaps, and a test that had encoded one of them

**`loadProgression()`'s double progression was unreachable for every loaded
exercise.** It compared the last logged set against `prescribeCeiling()` — the
bodyweight ladder's clamp, a flat 40 reps for anything without an explicit
`repCap` — while the Weights track prescribes 6-20 through `weightsTargetFor()`.
The gate could never open, on the only track the feature was built for.

**Suite 22 had hardcoded that same unreachable number, so it passed by measuring
against it.** The break was correct and is the second time this has happened
here (v232's `dragonflag` reordering was the first): a check written around a
value that is only true by construction fails the moment the construction is
fixed. It now asserts the ceiling is the one the track really prescribes AND
that it sits below the bodyweight clamp — a guard, so the check cannot quietly
go back to measuring an unreachable threshold.

**The first version of the fix used the wrong discriminator, and the suite
caught it.** Keying on "does it need equipment" routed `dragonflagfull` — a
pull-up bar movement prescribed by the bodyweight ladder — to the weights
formula. Owning kit is not the question; which track set the number is. Anything
in a `LADDERS` array came from `prescribe()`; everything else needing equipment
is reached only through `buildWeightsSession()`.

**Quick Workouts ran `safeSwap()` inside `quickPlay()` only, so the CARD showed
the movement the swap exists to avoid** — name, region, target and How-to all
naming the contraindicated exercise while Play quietly substituted. And a swap
can cross units: the card said "Russian Twist 2 × 20 reps" and Play ran "Side
Plank 20 SECONDS", the rep count carried straight across as a duration.
`quickTarget()` falls back to the substitute's own base when the units differ,
and the card and the player now read the same number from the same place.

### Four "zero is data" call sites the rule had never reached

`saveActual()` discarded a typed `0`; `recordPRFromActual()` then read that
absence as "use the target" and stamped a personal record nobody set;
`actualRatio()` skipped zeros, so an all-zero session read as "no opinion" and
tapping *Easy* RAISED the load; and `plAfterSet()` — the primary logging path —
recorded the full prescribed target for a set with zero counted reps. All four
are `||` where an explicit `isFinite`/`>=0` belongs, which is the exact defect
`computeAssessment()` was fixed for and `estimateMaxes()` was fixed for again in
v240. Writing a rule down does not apply it to code the writer did not look at.

### Three habit ticks that only ever went on

`syncStepHabit()`'s own comment says the tick and the number must never
contradict each other. Water never got the treatment (13 cups undone still read
"Hit water goal" above a card showing 0/13), protein never got it (an emptied
diary is 0 g — a measured zero, not a missing answer), and the step guard was
blind to `jackVal` — jumping jacks, the DEFAULT cardio mode, so an hour of hard
jacks credited 15,780 step-equivalents and 342 kcal and left the habit unticked,
costing a nutrition-streak day.

### The calorie button promised a number the code refused to deliver

`applyKcalAdj()` routes through the BMR/absolute floor, which can swallow the
whole correction — so a 52-year-old, 158 cm, 56 kg athlete already sitting on
the 1200 kcal floor was offered "Drop to 1130 kcal", tapped it, and nothing
moved. The adjustment was still stamped, so the check went quiet for three weeks
and repeated the same no-op forever. **A second copy of the floor in the label
would just be a second thing to drift**, so `kcalTargetPreview()` was extracted
and `recalcKcalFromStored()` now delegates to it: the predictor and the setter
are the same code asked a different question. A floored athlete is told so
instead of being offered a cut this app will not prescribe.

**Two scenarios were needed, not one** — a floored athlete must NOT be offered
a cut and an unfloored one must still be offered a real one. A fix that simply
deleted the button passes the first alone.

### Still open, deliberately

- The 28 reference days cannot reach a calorie target above ~2,800, and every
  documented bar (`validateData()`'s three, suite 06's five) is calibrated
  exactly at that ceiling — so an ordinary 78 kg very-active athlete on a gain
  goal misses the bar on 28 days out of 28. `renderRef()` does disclose each gap
  in words, so it is not silent, but the tab and the shopping list stop being
  usable for a whole class of athlete. Needs either a wider starch clamp or a
  surplus dial, plus a validator bar above the ceiling — a real content decision,
  not a defect with one answer.
- `calorieCheck()` returns null unless a deficit is prescribed, so the feedback
  loop never runs for a gain or maintenance goal. v239 fixed goal DIRECTION in
  the brief and the weight chart and did not reach here.
- The warm-up/cool-down flow still has no Pause and no wake lock, and its photo
  is fixed at 191px against the player's 331px.
- The baseline assessment sheet pushes "Next test →" ~91px below the fold at
  375×667 on all ten tests.

## The four deliberately-deferred items, closed (v265)

v264 shipped twenty audit fixes and named four things it had deliberately not
built, each because it needed a decision rather than a one-line change. Asked
to fix those too. All four are now closed, and the interesting part is that
three of them punished guessing.

**The reference days could not reach a gain-goal calorie target, and no clamp
change fixes that.** The starch dial clamps at 1.6x for a documented reason —
closing a gap on starch alone put 700 g of potato on one plate — so the obvious
move is to widen it, and the obvious move is wrong twice over. Widening the
starch clamp reintroduces the exact volume problem it exists to prevent; and
raising the FAT clamp, measured, moved the ceiling by 20 kcal, because at a
fixed protein target the anchor dial is pinned by the protein and several days
simply do not contain enough calorie-dense MASS to scale into the gap. Day 11
tops out at 2,491 kcal however far the dials are opened.

So the third lever adds food rather than resizing it, which is what a person
actually does: `REF_TOPUP` appends up to four calorie-dense items, capped at
two normal portions each, spread rather than piled, allergen- and diet-checked
like everything else, and only reached once the dials have genuinely saturated
— so every day that already lands on its target is untouched.

**Ordered fat-first, and that ordering is load-bearing.** The days are already
ON their protein target when the top-up runs, so reaching for a protein-bearing
food first pushes protein past a target the anchors were just dialled to hit —
measured at +17 g on a 3,500 kcal day. Olive oil, avocado and chocolate carry
almost none.

**Adding food and re-solving protein pull against each other, and one pass is
not enough.** A top-up carries protein, so re-solving the anchors to hit the
protein target takes calories back out: a single pass corrected the 17 g
overshoot and landed 240 kcal short. Two passes settle it. And a guard was
still needed on top — `sp` bottoms at 0.5, so once the non-anchor protein alone
exceeds `targetP - anchorP*0.5` the day is stuck OVER its protein target with
no way down. REF_DAYS[13] landed at 154 g against 140 g exactly this way, and
`validateData()` caught it. The top-up now skips an item rather than take the
calories: landing short on calories is disclosed on screen, landing over on
protein was not.

**The failing day moved every time a number was tuned, which is the tell that
tuning is the wrong tool.** Day 2, then day 8, then day 1 — each one 100-300
kcal short at a bar that had been picked by aspiration rather than measurement.
The fix was to stop guessing and measure the real ceiling, then set the bar to
it. At 140 g protein: omnivore now reaches 3,300 (it was 2,420), halal 3,300,
pescatarian-minus-dairy 3,280, vegan 3,020, and the worst real combination —
vegan with a tree-nut allergy — 2,860.

**Which is why the new bar is split in two, the same way the three existing
bars already are.** `validateData()` runs whenever it is called, including
while a suite has a restrictive diet set, so its bar has to clear AFTER
substitution and sits at 140 g / 2,800 kcal. Suite 06 runs omnivore and carries
the ambitious 140 g / 3,200 kcal bar. A bar calibrated at exactly the old
ceiling is what let 28 days out of 28 miss without anything objecting; a bar
only ever probed from the inside cannot show the range shrinking again, so the
check asserts a measured RANGE rather than "the new bar passes".

**`calorieCheck()` bailed on anything that was not a deficit.** So an athlete
bulking for three months and gaining nothing, or gaining a kilo a week of
mostly fat, got no check and no correction — the very failure the function's
own header calls the commonest way a diet app fails somebody. v239 fixed goal
DIRECTION in the brief and the weight chart and never reached here.

**The two verdicts are derived from a RATIO, not duplicated per goal.** On a
cut, "stalled" is observed above expected and "fast" is below; on a bulk both
comparisons flip, because `expected` is positive. `observed/expected` is
under-delivering below 0.4 and over-delivering above 1.75 either way, which
keeps the two goals from drifting apart — the same argument as `DIET_OPTS` and
`kcalTargetPreview()`. Maintenance still returns null: there is no prescribed
rate to measure against. The safety floor only exists on the way DOWN, so a
bulk that needs more food is never blocked by it.

**Four scenarios, because a fix that simply deleted the guard would pass a
check that only tests one.** Bulk-stalled must say eat MORE, bulk-too-fast must
say eat less, the cut path must still behave, and maintenance must still opt
out.

**The warm-up/cool-down flow was the only hands-free surface that let the
screen sleep, and the only one with no Pause.** It talks you through each
stretch exactly as the player and HIIT do; the only way to answer the door
mid-flow was to abandon it or falsely mark it Done. `wakeOn()` on entry,
`wakeOff()` in `flowStop()` (the single exit), and `flowToggle()` re-anchors the
deadline on resume so a pause is not counted as elapsed time — the same thing
`playerToggle()` and `hiitToggle()` already do. Its photo went from a fixed
191px to `min(330px,88vw,48vh)`, measured at 279px against the player's 295px
at 375x667, with the sheet still fitting the fold at 320x568.

**Shrinking the assessment photo was not enough, and "better" is not the
requirement.** "Next test →" sat ~91px below the fold at 375x667 on all ten
tests. A height-responsive `.exphoto` took that to 61px, and 61px hidden is
still a primary action the athlete cannot see. The nav row is now
`position:sticky;bottom:0` inside the sheet's own scroll box, so it is
reachable whatever a test's content does — verified visible at 375x667 and at
320x568, where six of ten tests previously clipped "← Back" as well. The
secondary "ⓘ How to do this move" moved above it, since a secondary action is
what should be scrolled to, not the primary one.

**A geometry probe that reads synchronously measures the sheet mid-animation.**
The first version of the fold check reported the CTA off-screen at every size
INCLUDING after the fix, because `#sheet` slides up on a transition and its
`getBoundingClientRect().top` was still 673 on a 667px viewport — the sheet had
not arrived yet. `scrollHeight - clientHeight` is position-independent and was
fine; every absolute coordinate was meaningless. Same family as this file's
tap-repaints-the-UI note, from the other side: there the wait was accidentally
too long, here there was no wait at all.

Five mutants seeded against the four fixes, five caught: the top-up removed,
the gain guard restored, the Pause button deleted, the sticky nav and
responsive photo both reverted, and `wakeOn()` dropped from `runFlow()`.

**A check that measures an `<img>`'s own rect measures whether the photo has
DECODED, not whether the CSS sized it.** The flow-photo check read
`#flowImg.getBoundingClientRect().width`, passed locally at 279px, and failed
CI at **0** — `showFlowMedia()` leaves the element `display:none` until the
image loads, and a CI runner is slower than the machine the check was written
on. Re-pointed at `.pl-ringmedia`, the box the CSS actually sizes, which is
there whether or not a photo ever arrives; still catches the reverted
`.timerring` height under mutation. Same family as the geometry-before-the-
animation slip above: both measured something real, and neither measured the
thing under test.

## A logged zero macro is not a measured zero (v266)

Reported from a real phone with two screenshots side by side: an imported
897 kcal meal sitting above three macro bars reading 0/165 g, 0/180 g and
0/60 g, next to the Lose It summary that plainly showed
"24% Fat · 36% Carbs · 40% Protein".

**The percentage path itself was fine.** v262's prompt already asks for
`proteinPct`/`carbsPct`/`fatPct` and `_macrosFromPct()` already converts them
at 4/4/9 — that row predates v262 and was stored with hard zeros. The
temptation was to answer "your entry is old, re-import it", which is true and
is not the bug.

**The bug is that a saved row of zeros is indistinguishable from a real
measurement, and v260 only fixed the INPUT side.** That round blanks the macro
fields in the sheet and warns that they are blank rather than zero — but the
moment the athlete saves, the row is `{kcal:897,p:0,c:0,f:0}` and every surface
downstream reads it as a meal with no protein in it. Three empty bars then say
"you ate no protein today" about a day that contained an 897 kcal breakfast.

**The predicate is arithmetic, not a guess.** Calories come from protein, carbs
and fat and nothing else, so a row with real calories and all three macros at
zero cannot be a measurement — it is a reading that failed.
`macrosUncaptured(f)` is `kcal>=50 && !(p>0) && !(c>0) && !(f>0)`, and the
50 kcal floor is what keeps black coffee and a diet drink out of it: those are
genuinely near-zero on every axis and nobody is missing anything. A real
zero-carb steak, a spoon of oil and a sugar drink all have at least one macro
above zero, so none of them trip it.

This is the same rule this file states everywhere else, applied in the
direction it had not yet reached. `computeAssessment()` and `estimateMaxes()`
were fixed because they treated a measured 0 as absent. This is the inverse and
it lands on the number the whole nutrition plan is built around.

**Detection and presentation needed separate checks, and the mutants prove
it.** Marking the row but leaving the bars silent fails only the bar-note
check; noting it above the bars but leaving the row unmarked fails only the row
check. And loosening the predicate to `!(p>0)` alone — dropping the calorie
floor and the carb/fat halves — fails a third, because black coffee and a
zero-protein sugar drink then read as broken data. Neither of the first two
alone covers the fix, and the third is the one that keeps it from crying wolf.

**The guard that matters most is the QUIET case.** A day of real macros must
say none of this — without it, every assertion above would pass just as
happily on markup rendered unconditionally for everybody, which is exactly the
"a page-wide selector other content also satisfies" trap this file already
documents for the ⚠️ icon and the 🎒 badge.

**Confirmed working on the athlete's own phone, and that is the entry that
matters most in this whole sequence.** Nine rounds (v253-v266) went out against
a feature this sandbox structurally cannot exercise — Gemini returns 403
through the agent proxy, so every test for it mocked the network and proved the
wiring rather than the result. The percentage path (v262) had therefore never
been shown to WORK, only shown to be wired. Re-importing the Lose It daily
summary on v266 populated protein, carbs and fat correctly from the
"24% Fat · 36% Carbs · 40% Protein" bar.

Two things follow for anything else that leaves the phone. A green suite plus a
real-device confirmation is the ship gate, not the suite alone — and the
confirmation is worth writing down, because the next session reading this file
should not have to re-litigate whether percentages work. The on-device
self-test (`_importSelfTest`, v263) exists precisely so that check does not
depend on the athlete noticing.

## Parallettes, and a wrist flag that means "change the implement" (v267)

The athlete bought 9.6" push-up bars and said they can now do L-sits and leg
raises from the ground. Checking the roster before building anything found two
things worth separating.

**The L-Sit was never gated.** `lsit` has no `equip` at all, sits in `hollowL`
between `vsit` and `dragonflag`, and its own `steps` text already names
parallettes as one way to do it. Nothing was blocked; the bars make it better,
not newly possible. Saying so was more useful than adding an exercise.

**And the "Dip bar / station" box would have been the wrong answer.** It is the
obvious tick — the Amazon listing itself says "Dip Bar" — and it unlocks `dips`
(Parallel-Bar Dips) and `dipknee` (Dip-Bar Knee Raise), both of which assume a
station tall enough to hang under. At 9.6 inches the feet reach the floor. The
listing's own marketing is not an equipment spec, and mapping new kit onto the
nearest existing gear key is how an athlete gets programmed something they
cannot perform.

**The real gap was that a wrist flag could not be answered by equipment.** A
bent-back wrist under load is the entire reason `JOINT_RISK.wrist` exists, and
gripping a bar removes it — parallettes are the standard clinical answer to
wrists that hurt on push-ups. `safeSwap()` had no way to know that, so a
wrist-flagged athlete who owned the fix was still routed away from the push-up
and the L-Sit. `wristRelieved()` closes it, and three properties are
load-bearing:

- **Gated on actually owning them.** Nothing changes for anyone else, which is
  what makes it safe to add to a shipped risk map.
- **Only the WRIST dimension is relieved**, applied per-joint rather than as a
  blanket exemption — `lsit` is flagged for the shoulder too, and a bar does
  nothing for a shoulder. The mutant that drops the `j==='wrist'` guard is
  caught by a check that flags the shoulder and expects the L-Sit to still go.
- **Scoped to planted-hand movements that fit on two fixed bars.** Bear crawls,
  mountain climbers, inchworms and wall walks are deliberately absent: you
  cannot do them on parallettes, so "relieving" them would reinstate a real risk
  under cover of a fix. Checked explicitly, not left to the list's contents.

**One shared predicate, because this repo has now watched four separate paths
forget `safeSwap()`.** The weights circuit, the focus bonus, Special HIIT and
the custom builder each skipped it in turn. `jointRisky(exId, lims)` is now the
one place the test lives, and the two existing inline copies were re-pointed at
it rather than a third being written.

**`tucklsit` is a ladder fix, not a parallettes feature, and it carries no
equipment requirement.** `hollowL` went `vsit` (0.6) straight to `lsit` (0.18)
— a jump most athletes cannot make. The Tuck L-Sit at 0.35 is the standard rung
between them and works on the floor, so every athlete gets it whether or not
they own bars. The three genuinely bar-dependent additions (`psupport`,
`plegraise`, `ppushup`) are `equip:['parallettes']` and flagged shoulder-only —
wrist-flagging them would be both wrong and self-defeating, since it would swap
the athlete away from the very thing the bars fix.

**A guard caught a real defect in this round's own check, exactly as designed.**
The "a bar-free athlete is never offered a parallette movement" sweep walked
`buildSession(i).items` — a property that does not exist; the session exposes
`main`/`finisher` plus its bonus slots. Every iteration threw into the `catch`,
`seen` stayed empty, and the assertion `offered.length === 0` passed on
nothing. The `total > 20` guard failed instead and named it. This is the
third time in this file's history that an emptiness assertion needed a
companion guard proving the collection was ever populated.

Images shipped as the same 800x800 grey-backdrop "PHOTO PENDING" placeholders
v224 established, added to `sw.js`'s `EXTRA` tier. Six mutants seeded, six
caught.

**A photo that cannot be generated twice is evidence about the EXERCISE, not
the prompt (v268).** `psupport` (Parallette Support Hold) shipped in v267 and
was dropped one version later, and the route there is the point.

The first generated photo showed a man standing next to some bars. Reading the
entry back to find out why exposed a real defect: the steps said "arms straight
down beside the hips" and "the legs together and toes pointed" on bars about
10 inches high. Legs hanging straight down put the feet on the floor, so the
hold as described was not hard, it was undoable. **Nothing in the suite could
have caught that** — the entry was well-formed, its swaps resolved, the ladder
stayed monotonic and `validateData()` was clean. A rendering is an independent
reader of your instructions: it has no idea what you meant, so it shows the gap
between what the prose says and what the movement is. Worth reaching for
deliberately whenever an exercise is added for equipment with a real physical
constraint — height, length, clearance — that the text has to respect.

The text was corrected (knees bent, shins tucked BACK, and naming the 10-inch
constraint so the next reader does not straighten the legs again) and the
SECOND generation still put the boots on the mat. That is the part worth
generalising: two independent failures to depict a position, after the
description was fixed, is a signal that the movement itself is marginal. It
overlapped heavily with `tucklsit` — both static, straight-arm, feet off the
floor, differing only in which way the knees point — while `tucklsit` is
harder, trains compression as well as support, and needs no equipment at all.
Dropping it left no gap, because the whole `hollowL` ladder sits below it.

**"I cannot photograph this clearly" is a legitimate reason to question a
feature**, and a cheaper signal than shipping it and finding out that nobody
can follow it from a phone screen. The instruction fix was written, tested and
mutation-tested before the second photo arrived — all of it correct, all of it
deleted. That is the right outcome and not wasted work: it is what proved the
entry was undoable, which is what made the removal obvious.

Left in place: `tucklsit` (no equipment, the ladder rung `hollowL` was missing),
`plegraise` and `ppushup`. Three movements, three distinguishable photos.

**House style for exercise photography: a three-quarter angle, not a flat side
profile.** Stated by the athlete after seeing both of the same movement side by
side — the isometric view reads better. It shows depth, both arms and the gap
under the body at once, where a pure side profile flattens the subject and
hides the far limb. Every generation prompt should ask for "three-quarter side
angle"; reserve a straight side profile for the rare case where a single joint
angle IS the point and the extra dimension would obscure it. `ex-plegraise.jpg`
was installed as a side profile and swapped to the three-quarter frame the same
morning for exactly this reason.

## The pitch bases were tuned on a desktop, and a phone said so (v269)

The athlete listed eight coaches that sounded ROBOTIC — Master Sergeant, Iron
Temple, The Relentless, Strongman, Viking Jarl, Legion Commando, Spartan
Warrior, Sergeant Major — with the tone set to Mid.

**The authored numbers did not explain the list, and saying so is what got the
right answer.** All eight sit in the deepest band, but so do Ultra Beast (0.42,
identical to Master Sergeant) and Marine Gunnery Sgt (0.44, identical to
Strongman), and neither was reported. Pitch was the prime suspect and not a
proven cause, so the honest move was to ask for ONE discriminating test rather
than raise numbers on a hunch: switch to Bright and re-listen. Bright fixed
every one of them, which rules out voice SELECTION and confirms pitch.

**A device's Web Speech voice is pitch-SHIFTED, not resynthesised.** Push it far
enough down and it produces artifacts before it produces depth. The old bases
(deep 0.74 / mid 0.98 / bright 1.18) were tuned by ear against desktop voices,
where the artifact floor is lower. Mid is the DEFAULT, so Mid is what the app
gets judged on: bases are now 0.88 / 1.08 / 1.24, and the per-persona offset
multiplier drops from 0.5 to 0.35 so the deepest coaches cannot drag themselves
back into the zone the base was just raised out of. Measured result: the lowest
non-robot coach at Mid goes from 0.89 to 1.02, ordering intact, and the A.I.
Trainer stays the lowest because sounding synthetic IS its character.

**v269 raised the bases and it was STILL the wrong lever — the athlete's own
data is what proved it (v270).** Coaches with IDENTICAL authored pitch and rate
sat on opposite sides of the "sounds robotic" list: Strongman 0.44/0.98
reported, Marine Gunnery Sgt 0.44/0.97 not; Spartan 0.48/1.00 reported,
Wrestling Coach 0.48/1.02 not; Sergeant Major 0.50/1.06 reported, Staff Sergeant
0.50/1.04 not. **Parameters that cannot separate the two groups cannot be the
cause.** Every coach in the deep band buzzes on that device; the nine reported
are simply the ones with hard-sounding names, so they are the ones that got
played. Chasing the list persona-by-persona would have been chasing a sampling
artifact.

So the answer is not a better number, it is a FLOOR. `LOCAL_PITCH_FLOOR` is
1.10 and nothing goes under it — not a tone base, not a persona offset, not the
manual fine-tune slider, and not Deep. Deep now means "as low as this device
manages cleanly", which is honest, rather than a promise of depth a resampled
phone voice cannot keep. The slider's own `min` moved to 1.10 as well, because a
control that stores a value the app then clamps away is a control that lies.

**The mutation that escaped is the one worth keeping.** Deleting the floor from
the MANUAL override passed clean, because the slider can no longer ask for a
value under it — so nothing in the suite ever fed `localPitchFor` a low one. An
install from before the floor existed carries exactly that, though, and the
check now plants a legacy `voicePitch:0.45` and requires it to be raised. The
new range protects new choices; only that case protects stored ones.

**Raising the floor is not a direction you can keep going in (v271).** Pitch
1.0 is NO shift — the voice exactly as recorded — and artifacts come from moving
away from it in EITHER direction. A floor that keeps climbing trades a buzz for
a chipmunk, so the band now has a ceiling (1.45) as well as a floor (1.18), and
a check pins both. The per-persona spread narrowed again to 0.15 because the
whole usable band is only ~0.27 wide; character has to live somewhere else.

**The fine-tune slider is the real answer to "adjust even more".** Its range is
the usable band exactly (1.18–1.45, step 0.01) and it previews on change, so the
athlete can settle this in ten seconds instead of waiting on a release. A
shipped constant is a guess about someone else's speaker; a slider they can hear
is not. Any future report of this shape should reach for the slider first and
the constants second.

**Depth of character has to come from the voice HINT, the rate and the script —
not from dragging the shifter down until it buzzes.** That is the same
conclusion the Strongman note above reached ("still read as processed after the
tone fix landed") and it is now enforced: the check pins a FLOOR at the default
tone across the whole cast rather than pinning individual numbers, which would
be a restatement of the table and would break on any deliberate re-voicing. The
neural path is untouched — that is real synthesis, and its semitone shifts do
not have this failure mode.

## Setting up the neural voice: the third call this sandbox cannot reach (v272)

Asked to set up the neural voice. The path was already fully built — 38
`COACH_NEURAL` entries, SDK loading, SSML, caching, device fallback — and all
nine coaches reported as robotic have a real neural voice with genuine depth,
which is exactly the point: **neural is real synthesis, so the semitone shifts
there do not have the resampling failure mode the local pitch band spent v269
through v271 fighting.** What was missing was not the feature. It was
everything that makes a feature the athlete cannot debug from the outside
actually settable.

**Azure is the third external integration this sandbox structurally cannot
verify, and that was measured rather than assumed.** Both `aka.ms` (the voice
engine CDN) and `<region>.tts.speech.microsoft.com` return `CONNECT tunnel
failed, 403` through the agent proxy — alongside the already-documented Gemini
403 and Open Food Facts connection refused. So this is the same position the
food import was in for six rounds: the athlete's phone is the only place it can
ever be measured, and the honest response is instrumentation, not another
careful guess.

**`testNeural()` answers one question — did a cue come out — and every way it
can fail collapses into one line.** `runNeuralDiagnostic()` is three stages,
smallest first, and **the staging IS the diagnosis**:

1. **Load the voice engine.** Nothing has been sent to Microsoft yet, so a
   failure here is the connection or a blocked CDN — provably not the key and
   not the region. Work and school wifi blocks this CDN, which is a real and
   otherwise invisible cause.
2. **Speak one word with the PLAIN default voice**, no style and no pitch. The
   narrowest thing that still needs the key and the region, so a failure here
   is one of those two and nothing else.
3. **Speak with the current coach's real config** — voice name, express-as
   style, pitch shift. Passing 2 and failing 3 produces the one verdict the old
   single-shot button could never reach: *your credentials are fine, this is our
   bug*, which is the difference between an athlete re-typing a key for an hour
   and reporting a defect.

**Merging any two stages destroys the whole point, so a check guards exactly
that.** Stage 2 is only diagnostic BECAUSE it is plain — the mutant that hands
it the coach's `cfg` (the natural "simplification") is caught by asserting the
stage-2 SSML contains no `prosody` and no `express-as`. Each of the other
verdicts has its own check requiring it to name its own cause AND not the
others': the blocked-CDN case must say "not your key", the 401 case must say
the key was rejected, the 1006 case must point at the region and must *not*
claim the key was rejected.

**The region field had a real defect, and the test scenario I first wrote for
it was wrong in a way that exposed a second one.** The Azure portal shows the
Location as **"East US"**, and `.trim().toLowerCase()` — what `setAzureRegion()`
did — leaves the interior space. `"east us"` is not a region; its only symptom
is an opaque WebSocket failure from deep inside the SDK, naming nothing. An
Azure region id IS the display name lowercased with spaces removed, so
`_azRegionNorm()` stripping ALL whitespace is a deterministic transform, not a
guess. `AZ_SPEECH_REGIONS` warns on an unrecognised value but **never blocks** —
Microsoft adds regions, and refusing a real new one would break the app for
whoever is in it.

Then the check written as "an unrecognised region is called out" using
`'east us'` **failed, correctly**: the diagnostic normalises first, so the
portal spelling resolves to a real region and must run clean or the warning
cries wolf at the single commonest way that field gets filled in. Fixing the
scenario to a genuinely invented region surfaced the real gap underneath —
**`_sdkSynthesize()` reads `STATE.settings.azureRegion` directly with only
`.trim()`, so a legacy stored `"east us"` still fails to speak.** Repairing the
write path alone leaves every existing install broken. The fix normalises at
the read site (where the value is actually spent, so it cannot be forgotten by
a caller added later) **and** repairs it in `normalizeState()` so the junk stops
travelling in backups. Two separate mutants prove both halves are load-bearing:
reverting the read site fails only the "a legacy value still reaches Azure as a
real region" check, and deleting the `normalizeState()` repair fails only its
own.

**That legacy check reads the region handed to the SDK, not the one held in
`STATE`** — measuring the payload rather than the container, the same rule this
file already states for the SSML `pitch` attribute and the audio-graph gain.
Asserting on `STATE.settings.azureRegion` would have passed on the version that
still hands `"east us"` to Azure.

Eight mutants seeded, eight caught.

**Confirmed working on the athlete's own phone: all three stages passed.** That
is the entry that matters, for the same reason the v266 percentage-import
confirmation does. Azure is unreachable from this sandbox, so every check
written for the neural path drives a stubbed SDK — it proves the staging, the
branching and the wording, and it can never prove a real key synthesises real
audio. The green suite was not the ship gate; this was.

Two consequences worth carrying forward. The neural path is now **verified end
to end**, so the v269–v271 local pitch band (floor 1.18, ceiling 1.45) only
governs the DEVICE-voice fallback — which, with a key installed, is reached
only offline. And the nine coaches originally reported as robotic were a
local-resampling artifact all along: the same personas over real synthesis
needed no re-voicing at all, which is what the "depth of character has to come
from the voice HINT, the rate and the script" note above was already arguing.

**Instructions for a job already done are clutter (v273).** The six setup steps
rendered unconditionally, filling the screen for an athlete whose key was
already saved and working — the same complaint that drove the Today-tab split
in v246, on a smaller surface. They now collapse behind a `<details>` once a
key exists and stay open when there is none. **ONE copy of the text either
way**: a saved-vs-unsaved pair of blocks would be two places for the same six
steps to drift, so the `open` attribute is the only difference between them.
Folded, never deleted — a key can be removed, and the steps have to come back
for whoever needs them next.

**A source scan cannot tell "collapsed" from "deleted", so the check reads the
rendered `<details>` and its `open` property.** Three mutants prove all three
states are distinguished: always-open, never-open, and removed-entirely each
fail different assertions, and the last one fails the "still there to open"
check that exists precisely because deleting them would look like a fix.

**A backtick inside an HTML comment ends the template literal it sits in.**
The first draft of that comment wrote the attribute name as `` `open` `` in
prose, which closed the surrounding template string and produced
`Unexpected identifier 'open'` from `npm run check` — a parse error whose
message points at the attribute rather than at the comment. Same family as
this file's own `sw.js` note about an apostrophe in a comment corrupting a
test's naive parser: **prose inside a code literal is still inside the code
literal.** The comment now says so explicitly, since the next person to edit
that block will not otherwise know.

## The barcode scanner read only half of Open Food Facts (v274)

Reported from a real phone: *"Barcode lookup failed — no nutrition data for
that product."* That wording is diagnostic and was worth reading before
guessing — it is the branch where `j.status===1` and `j.product` both hold, so
the network worked, the barcode resolved, and `_offItem()` rejected what came
back. Not a scanner problem and not a connection problem.

**`_offItem()` read the per-100g nutriments and nothing else.** Energy arrives
from Open Food Facts in four shapes — kcal or kilojoules, per 100 g or per
serving — and a great many entries, especially non-EU ones, carry the serving
pair only. Those all returned `null`, so a product the database answers
perfectly well came back as "no nutrition data". `kcalAt(suffix)` now tries
kcal then kJ at whichever suffix it is handed, and the per-100g branch is tried
first so nothing that already worked changes.

**The per-serving branch must NOT apply the serving multiplier.** The per-100g
path multiplies by `servingGrams/100`; applying that to a value which is
already per serving is the classic scale-what-is-already-scaled bug, and it
silently under-reports (240 kcal → 144 on a 60 g serving). It has its own
mutant for exactly that, because the two branches look similar enough to
"tidy up" into one.

**Its ceiling is looser but still a ceiling.** 900 kcal/100 g is the per-100g
sanity bound (pure fat is 884). A serving is a whole portion rather than a
fixed 100 g, so that bound does not transfer — 5000 kcal in one serving is
still bad third-party data, not a big meal.

**A crowd-sourced database that answers with a name and no numbers is a
SUCCESSFUL lookup, and it was being treated as a failure.** Open Food Facts is
full of entries that are a photograph and a product name with the nutrition
panel never filled in. The old path threw, `lookupBarcode()` toasted, the toast
vanished, and the athlete was left holding the box with the label on it and
nowhere to type it. `offBarcode()` now carries the product name out ON the
error (`e.productName`) and `lookupBarcode()` opens the add sheet pre-filled
with it — numbers deliberately **blank, not zero**, which is the v260 rule
applied to a second input path: an absent reading stored as a measured one is
worse than no reading. A barcode that is genuinely not in the database opens a
blank sheet too, quoting the number it could not find.

**Two of nine mutants escaped on the first pass, both for the same reason, and
it is a reason this file has already recorded once.** The data layer
(`offBarcode`) and the presentation layer (`openQuickAdd`) each had their own
checks, and both mutants lived in `lookupBarcode()` — the function that WIRES
them together, which nothing drove. Reverting the found-but-blank branch to a
dead end passed clean; so did pre-filling zeros instead of blanks. Same shape
as v253's `_screenshotUnusable`: a guard proven correct in isolation and then
shipped never being called. Fixed with a block that drives `lookupBarcode()`
for real against a mocked route and reads the sheet's actual input values back
— after which all nine were caught.

**The quiet case is the guard that matters most here**, as everywhere else in
this file: a successful barcode must fill the numbers in and show none of the
warning text, or every assertion above would pass just as happily against a
version that blanked everything for everybody.

Not fixed, and worth naming: nothing distinguishes *the scanner misread the
barcode* from *this barcode is genuinely not in the database*. Both produce the
same "not in the database", because a misread is a well-formed number for a
product that does not exist. The blank sheet is the same right answer either
way, so this is a gap in the DIAGNOSIS, not in the outcome.

## An audit that found no bug, and the coverage gap it did find (v275)

Asked to trace onboarding scores, exercise generation, assessments,
progression, state sync and UI refresh, and to fix what was broken. **Nothing
in those areas reproduced.** Recorded here because "we measured it and it
works" is a result, and the next session should not re-derive it:

- Every onboarding control moves the built program — measured by fingerprinting
  all 378 sessions across a spread and comparing.
- A re-test rebuilds its block; `currentMaxes()` reads the re-test rather than
  the baseline; `reassessGate()` fires at 42 and 84 and nowhere else.
- `swapStillValid()` is applied at all three read sites and fails closed, so a
  stored swap dies when gear or a joint flag changes. `recalcKcalFromStored()`
  runs on both the wizard-commit and the profile-edit path.
- `go()` re-renders the tab it switches to, so stale markup cannot survive a
  navigation.
- Fresh install and onboarded-but-baseline-skipped both render all six tabs
  with zero page errors; the full suite ran green twice with no flakes.

**Three "dead input" findings and two "broken" findings were all defects in the
probe, not the app**, which is the entry worth keeping. The probe set
`conditioning`, `experience` and `baseline.level` to values the seeded athlete
ALREADY had, so a perfectly live wire read as dead — the same trap this file
already records ("half the first probe's dead findings were the probe using a
key the app does not have"). Its `restore()` handed back the SAME object every
time, so each mutation wrote onto the saved baseline and every later probe
compared against accumulated junk. And two "failures" were safety gates working
exactly as designed: `openAssessment()` refuses a maximal battery before the
health screen, and `commitSession()` refuses a session with zero logged sets.
**State both ends of a probe explicitly, deep-copy on restore, and check
whether a "failure" is a documented gate before believing it.**

**The real gap was coverage, not behaviour: no suite swept ALL the onboarding
controls and asserted each one reaches the engine.** Individual controls were
checked in several places; the `focusBonus()` dead-input class is precisely a
control that looks wired and is not, so `tests/24-wiring.test.mjs` now sweeps
them together.

**Two mutants had to be chased before that suite could fail honestly.** The
first version compared lose-vs-gain over a fingerprint that included targets,
so deleting `rungIndex()`'s `+1` rung for 'gain' passed clean — `goal` also
moves every target through `gMul`. Narrowing the fingerprint to exercise IDS
alone STILL passed, because goal reaches the names through more than one path.
Only a direct assertion on `rungIndex()` itself isolates it — measure the thing
under test, not a downstream aggregate that several inputs feed. It carries a
headroom guard, because at the top of a ladder `clamp()` would swallow the +1
and the check would prove nothing.

**`rel2.mjs` and `rel3.mjs` were committed probe scripts**, against this file's
own rule ("Delete them afterwards and leave `git status` clean"). They were
being published to GitHub Pages with every deploy. Removed.

## API keys now survive "Reset all data" (v276)

Requested directly, reversing a deliberate v229 stance: `hardReset()` used to
wipe `settings.azureKey` and `settings.foodAiKey` along with everything else,
on the reasoning that "erase ALL data" should mean all of it. Asked to change
that specifically — the keys should not be erased.

**A key is a device credential, not athlete data, and it never left the device
either way.** `exportData()` already strips both keys from every backup file —
so the key was never something that got backed up or restored, only something
typed once into this specific browser. Re-typing a Gemini or Azure key from
scratch after wiping a season of training logs is real cost with no safety
benefit; the v229 reasoning was about a DIFFERENT leak (the un-stripped
pre-import snapshot silently surviving the wipe and being restorable via the
Undo button), not about the keys the athlete is actively using.

**Carried across explicitly, not by skipping the wipe.** `STATE` still becomes
a genuine, complete `DEFAULT_STATE()` first — the three fields are read off the
old STATE before that line and written back on afterward. A version that
skipped the wipe to preserve the keys would leave the profile, baseline and
logs behind too, which is exactly the regression the dedicated test proves
does NOT happen alongside the keys surviving.

**`azureRegion` travels WITH `azureKey`, not on its own.** A key with no
region, or the wrong one, is the identical "opaque WebSocket failure naming
nothing" defect v272 already fixed once — keeping the key and losing its
region would silently reintroduce that failure on the very next premium-voice
attempt. Re-normalised (`_azRegionNorm`) on the way back in, for the same
reason every other read site normalises it: a region carried from before that
fix existed must not skip it.

**The confirm text is part of the change, not a cleanup afterthought.** The
old wording ("Erase ALL your data") became false the instant keys started
surviving — the exact "a promise in the UI is a specification" class this file
already names repeatedly, this time introduced and caught in the SAME round
rather than found in old code later. Reworded to name what is actually erased
and say plainly that the keys are kept.

**One mutant needed a second look at the test data, not the fix.** The first
draft of the region-survives check planted `azureRegion:'eastus'` before
resetting — which is `DEFAULT_STATE()`'s own default, so a version that
silently skipped the carry-forward produced the identical value by
coincidence and the check passed on nothing. Fixed by seeding a region that
is NOT the default (`'westeurope'`), the same "the discriminating scenario
must not be indistinguishable from doing nothing" lesson this file states
for readiness/pitch swings elsewhere.

Four checks added to `tests/23-hardening.test.mjs`: both keys and the region
survive; a legacy unnormalised region is repaired on the way back in; the
rest of STATE is genuinely wiped alongside the keys surviving; the confirm
text says what the button now does. Six mutants seeded, six caught.

## Day 1 says what a normal day looks like, not just the test (v277)

A field report on a 100M-download competitor named a real gap: the Day-1 hero
promises "~15 minutes," and that number describes only the baseline TEST —
nothing on that screen says what a normal training day looks like afterward,
which is exactly the anxiety a mass-market competitor's "just 5-10 minutes a
day" framing is built to prevent.

**Reused rather than guessed.** `typicalSessionMin()` calls `plBudgetMin()` —
the guided player's own real per-session estimate — against `buildSession(0)`,
the athlete's actual first day, and prices warm-up/cool-down at the exact
35s/33s-per-move `sessionStats()` already uses for the history list. Two
existing numbers, not a third invented one that could drift from either.
Confirmed safe to call before a baseline exists — `prescribe()`'s own
`anchorUsable` fallback already covers a null `STATE.baseline`, the same
guarantee every other pre-baseline read in this file relies on.

**Session 0, not an average.** The question the sentence answers is "what does
MY first day look like," so it is built from the exact session the athlete is
about to do, carrying whatever gear/goal/limitations they already entered in
onboarding — not a generic figure that could disagree with what they actually
see ten minutes later.

**The sentence is omitted entirely rather than risking a broken number.** If
`typicalSessionMin()` throws for any reason, it returns `null` and the
template renders nothing — never `~null minutes` or an empty fragment. Proven
by monkey-patching `buildSession` to throw and reading the rendered HTML back.

**A companion check proves the number is actually computed, not a static
string that happens to look dynamic.** Flipping `experience`/`conditioning`/
`goal` and re-reading `typicalSessionMin()` requires the two values to differ
— the exact "dead input" shape this file has now named for `focusBonus()`,
`conditioning`, and the onboarding-wiring sweep in v275, checked again here on
a smaller, newer surface before it could become a fourth instance.

Three mutants seeded, three caught: the sentence deleted, the sentence forced
to render unconditionally (risking the null case), and the estimate hardcoded
to a fixed number regardless of input.

**The video half of the same report could not ship as code.** The report also
named "extend the existing `vid:` field to a few Week-1 exercises" as
worth doing — checking which exercises a first-time athlete's Week 1 actually
reaches (a sweep across Beginner/Intermediate/Advanced starting levels, no
baseline yet, matching the real onboarding-to-Day-1 path) found **42 distinct
exercises, zero of which already have video** — the ten existing clips are all
harder or equipment-gated movements a brand-new athlete's first week never
reaches. That is a real, useful, and much larger finding than "a handful,"
worth recording exactly because the original report's phrasing undersold it.

There was still no code to write. `plRingMediaHTML()` already falls back
cleanly from a missing/failed video to the real photo — adding `vid:` fields
with no file behind them would fail the asset-existence check this repo
already enforces at test time (the same gate that made "PHOTO PENDING"
placeholders necessary for new exercises in v224), and a placeholder VIDEO
autoplaying filler text in the guided ring would be a regression against the
photo fallback already working correctly, not an improvement. The one honest
deliverable available without real footage was the identification pass itself
plus ready-to-use, house-style generation prompts for the highest-exposure
exercises — handed to the athlete the same way every photo prompt in this
library's history has been, to come back as real files through the same
drop-in process suite 12 and the exercise-media suite already cover.

## The first Week-1 video, salvaged from a generation that ignored its own instruction (v280)

The athlete generated a video from one of the v277 house-style prompts and sent
it back. It could not be dropped in as-is, and finding out why — by actually
decoding and inspecting the file, not trusting the filename — is the point of
this entry.

**The clip contained two exercises, not one.** Ten seconds, cut cleanly at
4.9s: Dead Bug lying down, then a hard cut to Jumping Jacks standing up. The
prompt said "one exercise per generation — never combine several moves into
one clip," and the model did it anyway. This is the video-generation instance
of the exact failure this file already documents for images — v243's contact
sheet, generated despite "no collage" being repeated twice. **A model ignoring
an explicit instruction is not a one-off; it is a known failure mode for this
class of tool, and the fix is procedural (inspect the output, split what
needs splitting) rather than a stronger prompt.**

**The Dead Bug half was unusable on its own terms, not just for being spliced
in.** The app's own `steps` for `deadbug` describe a contralateral movement —
one arm and the OPPOSITE leg lower together, then switch. The generated clip
kept both arms locked together overhead the entire time and moved only the
legs — a different, incorrect movement that would teach the wrong form if
shipped. It also carried a one-frame wardrobe flicker (the shirt disappears
for a single frame) and was shot in flat side profile rather than the
requested three-quarter angle. No amount of cropping fixes an incorrect
movement; this half was discarded, not salvaged.

**The Jumping Jacks half was genuinely usable, and was verified rather than
assumed.** Extracted at 4fps into a contact sheet first — checking for the
same class of defect (flicker, wardrobe glitches, inconsistent framing) that
had just been found in the other half. None appeared. Confirmed against a
real point of comparison: `ex-burpee.mp4`, an existing shipped file, is itself
a full multi-phase rep cycle (jump → squat → plank → push-up → stand → jump),
not a static hold — so a dynamic, multi-second Jumping Jacks clip is
consistent with what this library already ships, not a stretch of the format.

**The loop point was found by measurement, not by eye.** All 118 frames of
the candidate segment were exported as 64×64 grayscale thumbnails and diffed
against frame 0 with a plain mean-absolute-pixel-difference — the same
measure-the-actual-pixels instinct this file states for a scrim or a contrast
ratio, applied to motion instead of colour. The best match was unambiguous
(diff 1.35 against a next-best of 1.59+), landing on a 3.0s loop. **Read back
honestly rather than oversold**: the true first and last frames of the
resulting clip are close but not identical — a small catch is visible at the
restart, because this footage was never generated as a loop. Confirmed by
extracting and comparing the exact boundary frames before presenting it, and
disclosed as a real, minor limitation rather than claimed as seamless.

**Processing matched the library's own established convention, not a fresh
guess at one.** The source was 1280×720; the shipped library is uniformly
640×640. A centred square crop (removing the letterboxed sides) happened to
also crop out a small AI-generation watermark sitting in the bottom-right
corner — verified after the fact by reading the cropped frames back, not
assumed from the crop math. Re-encoded to land near the existing files' own
size convention (~100-130KB for a few seconds at 640×640, not a raw
re-mux at several times that), with the audio track stripped — every existing
shipped `.mp4` is video-only, since the player always renders it `muted`.

**The athlete made the ship/hold call, not a default.** Two real options
existed — ship the imperfect-but-clean loop now, or wait for a purpose-made
regeneration — and the tradeoff (small cosmetic seam vs. no video at all for
this exercise) is a product judgment call. Asked directly rather than assumed;
the answer was ship it. Dead Bug stays on its photo until a fresh,
single-exercise generation exists — no placeholder video was fabricated to
fill the gap, consistent with this file's standing rule that a photo fallback
already working correctly is a better outcome than a fake video pretending to
be finished.

`EXTRA`'s own comment counting "the eleven .mp4 files" was updated to twelve
in the same change — a stale count next to a growing list is exactly the kind
of drift this file's own conventions exist to prevent.

## The rest of the "hard to visualize" video request, and a genuine success (v280, cont'd)

Asked directly, after the jumping-jacks salvage, for prompts targeting
exercises a STILL photo genuinely fails at — not just any dynamic move, but
ones where the motion path itself is the content: Turkish Get-Up, kettlebell
swing/snatch/figure-8/windmill, medicine-ball slam/woodchopper, the dumbbell
Man Maker, windshield wipers, squat thrust, skater hops, broad jump. The
template was rewritten first, based on what the jumping-jacks round had just
proven: "one exercise per generation" was not concrete enough to stop a
mid-clip cut to a second, different exercise, so the new wording names the
failure directly — *"do not cut, transition, or change to a different
exercise… at any point."* Equipment shape was spelled out per item
(kettlebell vs. medicine ball vs. dumbbell), the same discipline this file
already states for the kettlebell-vs-dumbbell confusion in `dbthruster`'s own
prompt history.

**The next generation the athlete sent back was the first one to get
everything right.** A single continuous Kettlebell Turkish Get-Up, floor to
standing, matching the app's own `steps` text move for move — bilateral grip
transitioning to one-handed lockout, post to the elbow, sweep the leg
through, rise through a half-kneeling lunge to standing. No scene cut, no
wardrobe flicker, correct kettlebell shape throughout. The no-cut rewrite
held.

**A clean generation still surfaced a real structural mismatch, and it was
found by reasoning about the PLAYER, not the clip.** `plRingMediaHTML()`
always renders `<video … loop>` — unconditionally, for every clip in the
library. A Get-Up is one-directional: it never returns to its start.
Looping it plays the rise once, then snaps instantly back to lying on the
floor — a hard, jarring reset, not the small stutter the jumping-jacks loop
point had. Every clip shipped before this one is either a genuine hold
(`birddog`, first ≈ last frame) or a movement that returns close to its own
starting pose (`burpee`: jump → … → jump). This is the first one that does
neither, and the gap would not have been visible from the clip alone — it
only shows up once you ask what the *player* does with it.

**Named plainly and left for the athlete to decide, the same posture as the
jumping-jacks seam.** Two honest options: ship it and accept the reset (a
slow, deliberate movement, plausibly read as "starting the next rep" rather
than as broken), or hold for a second generation of the reverse — the app's
own `steps` text already describes one ("Reverse the steps back to the floor
under control"), which would make a true loop and a more complete
demonstration in one pass. Asked directly; the answer was ship it.

Cropped 1280×720 → 640×640 exactly as the jumping-jacks clip was — centred,
verified frame-by-frame across the FULL clip (not just start/end) for
clipping at the highest reach and widest lunge, since a multi-position
movement has no single "safe" frame to check the way a repeating cardio move
does. The same crop removed the watermark for free, the same coincidence as
before and for the same reason: the watermark sits in the same corner on
every generation from this tool.

## Nine controls had no name a screen reader could read (v269)

Found in the pre-release sweep, not by a suite: six sliders, two dropdowns, two
API-key fields and three file inputs announced as a bare "slider" or "combo
box". Every one of them HAS a visible caption — it just lives in a SIBLING
element rather than a `<label>`, so nothing associates the two. Reading the page
with your eyes gives no hint at all that anything is missing.

The check asserts on the computed accessible NAME (aria-label, a wrapping
label, a `label[for]`, or a placeholder) rather than on the presence of the
attribute, so a control that later gets a real `<label>` instead still passes.
It sweeps every tab, with a guard that Settings really had controls to find —
an "unnamed length is 0" assertion over an empty list is the emptiness trap
this file has now documented three times.

## Progression for the formats that never had any (v279)

Requested directly: "integrate progressive overload." Bodyweight ladders,
`loadProgression()` (v226, weights double-progression) and
`bikeLevelSuggestion()` (v228) already covered three tracks. Auditing the
rest found a real, specific gap rather than a general one: `SKIP_FORMATS`
and the `grip`/`box` halves of `SPECIAL_FORMATS` each have a genuine volume
order and already log every session, but never asked how it felt or
suggested going harder. `HIIT_FORMATS` (tabata/emom/amrap) and
`ENDURANCE_FORMATS` (vo2max4x4/vo2max3030/sit6x30) had something worse: run
as bonus HIIT (session key `specialhiit`) or as a sprint off the Special
Training bike menu (`specialcardio`, not bike — bike itself already had
`bikeLevelSuggestion()`), they hit `ivDone()` and produced no record of any
kind, not even that the session happened.

**Suggesting a next format only works where a next format actually
exists.** `HIIT_FORMATS` and `ENDURANCE_FORMATS` are each already documented
in their own definitions as distinct STIMULI, not rungs of one ladder — a
Tabata is not an easier AMRAP, and the VO2max 4×4 is not a harder 30/30.
Treating them as one ordered ladder would be inventing an order that isn't
there, the same "distinct stimuli, not three versions of the same thing"
reasoning that already gates `ENDURANCE_FORMATS` out of the bodyweight HIIT
picker. So `PROGRESSION_GROUPS` covers only the three groups with a real
order — `skip`, `grip`, `box` — and the other two get a plain
time-at-format mirror instead ("6 Tabata sessions now · 41 min total"),
never a suggestion to switch.

**The order is real work volume, not object-key order, and box is the
exercise that proves it.** `SPECIAL_FORMATS`' own key order is `box3x3,
box5x3, box6x2`; the real order by total work (`w*n`) is `box3x3` (9 min) <
`box6x2` (12 min) < `box5x3` (15 min) — the fifth entry is easier than the
fourth. `PROGRESSION_GROUPS` stores each group's order as an explicit
array read from nothing but itself, and the regression test deliberately
rates `box3x3` three times easy and asserts the suggestion is `box6x2`,
not `box5x3` — the one scenario that only passes if the order is genuinely
being read and not just iterated in declaration order. `grip`'s `gripmax`
is excluded from its own group's ladder for the same reason
`ENDURANCE_FORMATS` is excluded from HIIT's picker: it's a max-effort
TEST ("sets your Dead Hang standard"), not a volume rung.

**Rating a session and logging it are now the same tap, mirroring how
bike already works.** `rateSkipAndClose()`/`rateActAndClose()` call the
SAME `hiitLogSkip()`/`hiitLogAct()` the old standalone "Log to my record"
button called — no duplicate logging path — then layer
`rateFormat()`/`formatSuggestion()` on top and replace the old button with
the same three-button "how did that feel?" row bike already has. The
separate plain log button is gone for skip/grip/box specifically because
having both would mean two ways to finish a session, one of which silently
skips the rating — exactly the kind of redundant control this file's own
history warns builds a false sense that a feature does more than it does.
Ruck is unaffected: it has no `SPECIAL_FORMATS` entries and so has never
gone through this rating row.

**A getter that validates its input can mask a bug in a completely
different function, and it did here on the first mutation pass.** A
seeded defect made `formatFeel()` always read `STATE.formatFeel.box`
regardless of which group was asked for — a real bug, since it would
silently report every other group's streak as permanently zero. It
escaped every check that only ever rated `box` (the entire ladder
walkthrough above uses `box` throughout, so the mutation is invisible when
the argument happens to already equal `'box'`), and it ALSO escaped a
direct "rating one group doesn't leak into another" check, because that
check read the leaked value back through `formatFeel('grip')` — which
validates the stored `level` against `grip`'s own format list, sees a
`box` format name that isn't in it, and silently falls back to a clean
default. The getter's own defensiveness papered over the exact bug the
check was trying to catch — this file's own "test a repair through a
getter that guards itself" trap, encountered here for the first time on a
brand-new field rather than an old one. Fixed two ways: a second full
ladder walkthrough using `skip` instead of `box` (proving the getter
dispatches on its argument at all), and the leak check re-pointed at the
RAW `STATE.formatFeel.grip` value instead of the getter's return.

**A render check proving the right buttons appear is not the same claim
as a tap doing anything.** Every render-level check here asserts on the
onclick STRING in the produced HTML (`rateActAndClose\('box','easy'`,
etc.) — which is exactly the shape of gap this file's own "wiring" section
warns about: a function proven correct in isolation, wired to a button
that was never actually driven. A separate block calls
`rateActAndClose()`/`rateSkipAndClose()`/`logHiitAndClose()` directly
after a real completed session and reads `STATE.formatFeel`/`boxLog`/
`skipLog`/`hiitLog` back — mutation-tested by deleting the `hiitLogSkip()`
call from inside `rateSkipAndClose()`, which passed every rating/streak
check (the rating still happens) and failed only the one check that reads
`skipLog` back, confirming the render-level checks alone would not have
caught it.

**`STATE.formatFeel`/`STATE.hiitLog` get the same `normalizeState()`
treatment `STATE.bikeLevelFeel` already has, not a lighter one because
they're new.** A wrong-shape or unrecognised-format entry is reset to that
GROUP's own first rung, not deleted — deleting it was the first draft and
it failed its own repair check, because `formatFeel()`'s self-sanitizing
default (`{level:list[0],streak:0}`) made a deleted key and a repaired key
read identically through the getter, so the check couldn't tell a real
repair from the getter merely covering for a gap. Asserting on the raw
`STATE.formatFeel.grip` value directly — the same fix the leak check
above needed — is what told them apart. `hiitLog` rows missing a string
`format` or a finite non-negative `mins` are dropped individually, same
shape as every other activity log's own row-level repair.

Both new fields travel in a backup un-stripped, matching `bikeLevelFeel`
and `skipLog`/`gripLog`/`boxLog`'s own precedent — they describe the
athlete's real training history, not device-local scratch state.

Nine mutants seeded across the engine, the `ivDone()` wiring and the
`normalizeState()` repair; all nine caught, two only after the checks
above were strengthened to stop reading state through a self-sanitizing
getter.

## A stability ball, and three genuinely new exercises (v281)

Requested directly: "I now have an exercise ball." Confirmed which kind
first (stability/Swiss ball, not a slam ball — the app's existing
`medball` gear key already covers that) before building anything, the same
discipline that caught the "Dip bar" trap in the parallettes round —
checking what a piece of kit actually is beats mapping it onto the nearest
existing checkbox. The gear picker had ten categories and none of them
covered it; this is a genuinely new equipment class, not a hidden gap.

**Three additions, each checked against the existing roster for overlap
first.** `sbrollout` (Stability Ball Rollout) is the same anti-extension
mechanism as the existing ab-wheel rollout, with a real difference: the
ball's wobble adds an anti-rotation demand a fixed wheel doesn't have.
`sbhamcurl` (Stability Ball Hamstring Curl) is a genuinely new pattern —
nothing else in the library trains a bridge-and-curl in one rep. `sbstir`
(Stir-the-Pot) is real anti-rotation core work, distinct from the standing
`dbpallof`. Two candidates were deliberately left out as too close to what
already exists: a ball pike/plank (overlaps the hollow-rock family) and a
ball back extension (overlaps `superman`).

**The rollout inherits `abroll`'s entire risk profile rather than a fresh
guess — same mechanism, same risk.** Shoulder, wrist and lowback, same
`SAFE_SWAP`/`LOWBACK_SWAP`/`GEAR_FALLBACK` landing spot (`plank`). The
other two are calibrated against their real closest siblings instead:
`sbhamcurl` is a loaded hip bridge, flagged lowback only — matching
`hipthrust`/`dbrdl`, not the abroll-family shoulder/wrist flags a rollout
carries. `sbstir` is a forearm-plank hold, flagged wrist only — matching
`bearhold`/`isoclimber`/`ropeplank`, not shoulder or lowback. Copying
abroll's flags onto all three would have been the easy, wrong shortcut —
the mechanism has to match, not just the region.

**A behavioural sweep proving the pool is actually reached needed the
seeded athlete's own level pinned explicitly, and finding out why is worth
recording.** The first version of the "genuinely offered once the ball is
owned" sweep failed for all three exercises, despite every flag and
gear-gating check passing. `focusBonus()` gates candidates by a difficulty
tier relative to the athlete's tested level — `[1.0, 0.7, 0.4]` for
Beginner/Intermediate/Advanced — and all three of these are calibrated
below hardness 1.0 (0.9, 0.7, 0.55), unlike every prior gear-round addition
(the kettlebell five and `dbbench` all shipped at hardness >= 1.0, clearing
even the Beginner gate). By the point in `01-data.test.mjs` where this
block runs, an earlier block had already mutated `STATE.baseline` down to
Beginner — the exact "every block builds the state it asserts on, not what
an earlier block left behind" trap this file already names. Setting
`STATE.baseline={level:'Advanced'}` explicitly fixed two of the three, but
`sbstir` (hardness 0.55, needing the Advanced-tier 0.4 threshold) still
failed — `levelOf()` also lets `STATE.profile.experience` nudge the
measured level DOWN by one tier, and that field had also been left at
something below Advanced by the same earlier block. Two separate pieces of
inherited state had to be pinned, not one.

**One mutant was a legitimate non-catch, the fifth time this file has
documented the exact same shape.** Dropping the rollout's explicit
`SAFE_SWAP` entry didn't fail the "lands somewhere safe" check, because
`safeSwap()`'s own generic same-region fallback finds `plank` without it —
matching `dbcp`/`mbchop`/`kbwindmill`/`kbrenegade`/`ropeplank` before it.
The entry stays in the shipped code for clarity, not because the check
needs it.

Images shipped as the same 800×800 grey-backdrop "PHOTO PENDING"
placeholders established in v224, generated locally with Pillow to match
the existing style exactly (sampled backdrop and text colours from a real
shipped placeholder rather than guessing them) since no image-generation
handoff happened this round. Added to `sw.js`'s `EXTRA` tier. Eight
mutants seeded against the new checks, all eight caught.

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
