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
