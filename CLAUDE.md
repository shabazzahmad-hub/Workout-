# CoreForge — working notes

## Read only what you were pointed at

**Only read files I explicitly name or point to.**

Do not read additional files to "get context", "understand the project", or
"see how things connect" unless I ask you to. If you think reading more files
would help, **ask first** — one sentence, *"Want me to also read X?"* — then
wait for my answer.

This is not a ban on reading. It is a ban on reading **silently**. Ask, and
the answer is usually yes; the cost is one line of dialogue instead of a
context window.

Why this rule is here, in numbers:

| File | Size | Cost to read whole |
|---|---|---|
| `index.html` | 14,852 lines · 1.09 MB | ~279k tokens — larger than the context window |
| `tests/*.mjs` | 14,294 lines · 781 KB | ~200k tokens across 24 suites |
| `CLAUDE-HISTORY.md` | 4,171 lines · 255 KB | ~65k tokens |

So a reflexive "let me look around first" on this repo is not a small tax. It
is most of the budget, spent before any work starts.

**How to find something instead of reading toward it:**

- `grep -n "functionName" index.html` — the whole app is one inline `<script>`,
  so grep is the index. Read the ~40 lines around the hit, not the file.
- `grep -n '^  [a-z0-9]*:{' index.html` — walks the `EX` exercise literal by
  definition line.
- `grep -rn "pattern" tests/` — find the suite that covers a behaviour before
  opening any suite.
- `## ` headings in `CLAUDE-HISTORY.md` — every past round is one section,
  version-tagged. Read the one section, never the file.

**One exception, and it is narrow.** When a change is about to ship, the
`Shipping` checklist below is mandatory and its steps read what they must.
Verification is not exploration.

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
| `tests/` | 24 suites, run by `npm test` |
| `CLAUDE-HISTORY.md` | The round-by-round record. Read one `## ` section, never the file |
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

## Subsystem map

Every subsystem below has its full story — why it exists, what shipped broken,
which mutants escaped — in `CLAUDE-HISTORY.md`, one `## ` section per round.
**Read the one section, not the file.** What is here is the rule that must hold
whether or not you have read the story.

### Progression

- **Bodyweight ladders → loaded progression** (`atLadderCeiling`,
  `prescribeCeiling`, `loadProgression`). Three conditions gate the ceiling, not
  one: top of ladder, calendar has scheduled it there, and the REAL prescription
  (after safe mode, deload, readiness) lands AT the ceiling. `LOAD_STEP_KG` is a
  flat 1 kg and **never auto-decreases** — a silent regression would stack a
  second deload on the one already applied. Effort not recorded reads as "no
  room", never "assume room". The recommendation is a labelled hint next to an
  editable field, never fed into `target` math. *(v221, v226)*
- **Format progression** (`PROGRESSION_GROUPS`, `rateFormat`,
  `formatSuggestion`). Only `skip`, `grip`, `box` have a real volume order.
  `HIIT_FORMATS` and `ENDURANCE_FORMATS` are distinct **stimuli**, not rungs —
  they get a time-at-format mirror, never a "go harder" suggestion. Group order
  is an explicit array read from itself, not object-key order. *(v279)*
- **Bike level** (`BIKE_LEVELS`, `bikeLevelSuggestion`). Three easy rides at the
  SAME level suggest the next up. Switching levels resets the streak. *(v228)*

### Load, easing and safety

- **Deload has three independent triggers** — calendar week, `readinessSlump()`
  (self-reported), and `loadSpike()`/`acwr()` (objective volume). `acwr()`
  needs 3 of 4 trailing weekly buckets to have volume before it computes at all,
  and builds its date index ONCE per call — a per-lookup rebuild was a 20-million-
  iteration regression the Progress render budget caught. *(v227)*
- **`readinessMult()` scales `prescribe()`'s target directly** and cuts a set
  below 0.85. Slump test data must use the real minimum score (25), never 0 —
  `readinessSlump()` filters on `score>0`. *(v228)*
- **A flagged joint is avoided AND strengthened.** `safeSwap()` only subtracts;
  `correctiveBonus()` (`CORRECTIVE_POOL`) adds one light joint-specific movement
  on top, never in place of anything. Wrist and elbow are deliberately silent —
  no genuinely targeted movement exists for them in the library. *(v227)*
- **`jointAwareWarmup()` runs BEFORE `safeFlow()`**, and its added item's NAME
  must not appear in `FLOW_RISK` — otherwise `safeFlow()` strips the very item
  just added. One bonus item, first flagged joint wins. *(v228)*
- **`mobilityFlow()`** gives a `'low'` mobility answer 25% longer holds in both
  warm-up and cool-down, including the joint-aware addition. `'ok'`/`'good'` are
  untouched. *(v251)*
- **`safeSwap()` has been forgotten by five sibling paths** — the weights
  circuit, the focus bonus, Special HIIT, the custom builder, and the baseline
  assessment. `jointRisky(exId, lims)` is now the one place the test lives. Any
  new path that picks an exercise calls it. *(v267)*
- **The baseline battery calls `safeSwap()` too**, and says so on screen. It is
  the one place asking for a maximal effort, so silent substitution is wrong
  there even though it is right everywhere else. *(v251)*

### The baseline battery

- **Ten tests** (`TESTS`), read by `id` everywhere and never by position, so
  reordering is safe — but ORDER is part of the measurement. Jump Squats sits
  second (most fatigue-sensitive); Burpees sits last (the fatiguer). No more
  than two trunk tests run back to back. *(v247, v252)*
- **Adding a test means updating four hand-kept places, and three have drifted
  before**: `TESTS`, `TEST_DEFAULTS`, `estimateMaxes()`'s internal defaults, and
  `skipBaseline()`'s literal. `validateData()` now checks the lockstep both
  directions. *(v247, v249, v252)*
- `TEST_PROTOCOL` is stamped on every recorded assessment — a v1 baseline and a
  v2 re-test were not taken under the same conditions.

### Nutrition

- **`todayKcalBudget()` is the only number a LIVE "today" surface reads.**
  Movement earns room on the **surplus only** — falling short of the step target
  credits nothing, not a negative. Clamped. The meal plan, Reference's scaled
  days, the 7-day trend and the settings summary all stay on the UNadjusted
  target on purpose. *(v220)*
- **`kcalTargetPreview()` is the predictor and the setter asked one question.**
  A floored athlete is told so, never offered a cut the app will not prescribe.
  *(v264)*
- **`calorieCheck()` derives its verdict from a RATIO**, so a gain goal and a cut
  goal cannot drift apart. Maintenance returns null — there is no prescribed rate
  to measure against. The safety floor exists only on the way DOWN. *(v265)*
- **`REF_TOPUP` adds food rather than resizing it**, fat-first (the days are
  already on their protein target), two passes, and skips an item rather than
  overshoot protein. *(v265)*
- **A logged zero macro on a real-calorie row is a FAILED READING, not a
  measurement** (`macrosUncaptured`, `_macrosMissing`). The 50 kcal floor keeps
  black coffee out of it. *(v260, v266)*
- **Open Food Facts answers in four shapes** — kcal or kJ, per 100 g or per
  serving. The per-serving branch must NOT apply the serving multiplier. A name
  with no numbers is a SUCCESSFUL lookup: open the sheet pre-filled with the
  name and **blank** numbers, never zeros. *(v274)*

### Anything that leaves the phone

**`npm run check` enforces this as a build gate**, because every one of these
was a real failure on a real device that a green suite did not object to:

- No bare `fetch()` outside `fetchWithTimeout()`.
- `_geminiCall`'s default bound ≥ 15s (8000 was what killed image uploads).
- `AI_TOTAL_BUDGET_MS` must exist — 3 models × 25s with no ceiling is 75 seconds
  of silence.
- `_transientAIStatus` must include status **0** (a stalled connection — the
  commonest transient failure) and **503**.
- `FOOD_AI_MODELS` must lead with a floating alias, not a pinned id. Pinned ids
  rot: Google retired two of them mid-flight.
- An on-device diagnostic (`runAIDiagnostic`) and self-test (`_importSelfTest`)
  must exist and be called.

**This sandbox cannot reach any of the three external services** — Gemini and
Azure return 403 through the agent proxy, Open Food Facts refuses the
connection. So every test for them mocks the network and proves the WIRING,
never the result. **A green suite plus a real-device confirmation is the ship
gate, not the suite alone.** *(v238–v266, v272, v274)*

### Voice

- **`LOCAL_PITCH_FLOOR` 1.18 and ceiling 1.45**, and nothing goes outside —
  not a tone base, not a persona offset, not the manual slider, not "Deep". A
  device voice is pitch-SHIFTED, not resynthesised, so moving away from 1.0 in
  EITHER direction produces artifacts. Depth of character comes from the voice
  hint, the rate and the script. *(v269–v271)*
- **The neural path is real synthesis and does not have that failure mode.** Its
  semitone shifts are untouched by the local band. `_azRegionNorm()` strips ALL
  whitespace — the Azure portal shows "East US" and `"east us"` is not a region.
  Normalise at the READ site as well as in `normalizeState()`. *(v272)*

### Data safety

- **`importData()` confirms once** (quoting the backup's own `_saved` date) and
  snapshots the STATE it is about to overwrite into `PREIMPORT_KEY` — one step
  back, not a history. **`hardReset()` must clear that snapshot**, or "this
  cannot be undone" is false and both API keys survive in plain text. *(v229,
  v264)*
- **`hardReset()` keeps `azureKey`, `foodAiKey` and `azureRegion`** — device
  credentials, never in a backup either way — by reading them off the old STATE
  and writing them back onto a genuine `DEFAULT_STATE()`. The region travels
  WITH the key. *(v276)*
- **`normalizeState()` diff + `validateData()` on the REAL loaded STATE** drive
  `dataHealthNoteHTML()`. The diff is gated on `STATE.onboarded` — routine
  first-boot bootstrapping is not a repair. *(v229)*

### Adding an exercise or a gear category

The checklist, learned across nine rounds of additions *(v224, v232–v234,
v243–v244, v267, v281)*:

1. **Search the roster by MOVEMENT, not by name substring.** "Standing Oblique
   Twists" read as missing because the entry is called "Standing Obliques".
2. **Calibrate `hardness` against the nearest existing sibling**, and set `base`
   too — for an unanchored exercise only `base` decides whether the prescription
   reaches its own `repCap`.
3. **`JOINT_RISK` per joint it actually loads**, matched to mechanics, not to the
   category sounding risky. A `SAFE_SWAP` that stays in the same equipment
   family. Escalate or drop a flag deliberately — never copy a sibling's set.
4. **Confirm what the kit physically IS before mapping it to a gear key.** 9.6"
   push-up bars are not a "Dip bar / station"; the feet reach the floor.
5. **A generic "flagged joints don't leak" sweep cannot prove a new entry was
   ever flagged** — it never enters the `risky` bucket if nothing asked. Assert
   `JOINT_RISK` membership directly, per exercise.
6. **Ship a real photo or the 800×800 grey "PHOTO PENDING" placeholder** — never
   a missing file; the precache list is asset-existence-checked at test time. Add
   it to a `sw.js` tier.
7. **One image generation per exercise, never a grid.** "No collage" repeated
   twice did not stop it. Spell out the equipment's SHAPE. House style is a
   three-quarter side angle, olive tee, camo cargo pants, black boots, black
   mat, grey studio backdrop.
8. **A photo that cannot be generated twice is evidence about the EXERCISE**, not
   the prompt. `psupport` shipped and was dropped one version later for exactly
   this.

## A balance trainer is not a stability ball (v283)

"I now have a balance ball", one round after "I now have an exercise ball" —
and they are different implements. The stability ball is a large sphere you
lie on or roll; this is a rigid-based half-dome you stand ON. Confirming that
from the photo before mapping it to a gear key is the same discipline the
9.6-inch push-up bars taught: **what the kit physically IS decides the key,
not what it is called.** Two things that are one word apart in conversation
got separate keys and shape-bearing labels — `Stability ball (large)` and
`Balance trainer (half-dome)` — because a mis-ticked box silently prescribes
work the athlete cannot do.

Four exercises, all trading on the one demand nothing else in the library
places: an unstable base. `btbalance` is the one with no relative at all —
pure single-leg proprioception, which is also the highest-carryover item here
for an athlete in their fifties.

**Every flag is an escalation reasoned from mechanics, and the check proves
the escalation by asserting the FLOOR version stays unflagged.** Plain `squat`
and plain `sideplank` carry no joint flags; the dome versions carry knee, and
shoulder+wrist, because the base moves and — for the side plank — because
bodyweight goes through a straight arm rather than a forearm. Asserting only
"the dome version is flagged" would pass just as well if someone had blanket-
flagged the whole family, so each check pins its floor sibling's empty flag
list beside it. `btpushup` inherits `pushup`'s wrist flag and adds shoulder;
the joint angle is the same, the stabiliser demand is not.

**The cross-contamination check is the one that matters most here**, and it
runs both directions: owning the sphere must not unlock the dome work, owning
the dome must not unlock the sphere work, and each must still unlock its own.
A single `equip` typo would otherwise hand an athlete four exercises they have
no equipment for, and the generic "flagged joints don't leak" sweep cannot
see that at all.

Five mutants seeded — gear crossover, a dropped knee escalation, a dropped
shoulder flag, a focus-pool omission, and a revert to the ambiguous picker
labels; all five caught.

**The real photos, and one more datapoint for the no-batching rule.** The
athlete asked for a single copy-pasteable prompt covering all four exercises,
against the standing advice to send them one at a time. It was written to
demand four separate images in the strongest terms available — "generate them
one at a time", "never combine", an explicit list of the words *grid, collage,
contact sheet, split panel* — and the model **still returned a 2x2 collage**,
with three correct panels and one EMPTY fourth cell. The squat, sent as its
own prompt in the same session, came back clean and standalone.

So the rule survives its most careful test yet: **the failure is not weak
prompt wording, and it cannot be fixed by strengthening the instruction.** The
count of exercises per request is the variable that matters. What batching
buys is one paste; what it costs is a crop-out-of-a-grid step and a wasted
generation slot. The panels cropped cleanly here — gutters detected by
scanning for near-white rows/columns rather than assuming the midpoint, since
the two rows were NOT equal height — so the round still shipped real artwork,
but that is salvage, not success.

## Progress photos can leave without the run leaving with them (v282)

`exportData()` has always embedded every progress photo in the backup, and the
round trip is real — seeded photos survive export → `hardReset()` → import
byte-for-byte identical, verified by driving it. But a backup restores
**all or nothing**. An athlete who wants a clean slate and wants to keep the
photos had no move: restoring the file to get the pictures back also restores
the run they were deliberately walking away from.

**Progress photos are the only thing in this app that genuinely cannot be
re-created.** A missed weigh-in can be typed in from memory. Week 1 of your own
body cannot be re-photographed in week 30. That asymmetry is what justifies a
second way out that no other data type has.

`savePhotoFiles()` writes each one as a real `.jpg` the athlete keeps, named
`coreforge-<date>-<pose>.jpg` so the files sort and read on their own. Both
halves of that name come from stored data an import could have shaped, so both
go through the same guards the gallery uses — `poseOf()` for membership, a
format test for the date. One file at a time with a gap between saves: no
archive library exists here, and a burst of downloads gets collapsed into one
by mobile browsers.

**The button sits ABOVE "Reset all data", and a check enforces that.** A rescue
route below the destructive button is a rescue route nobody reaches in time.

**Two ways a photo goes bad, and only testing one let a real defect through.**
The first mutation seeded here — weakening the guard to `if(!data)` — escaped,
because the only bad row in the check was a blob that was *absent*, which both
versions catch. A blob that is *present but not an image* (what a corrupted or
hand-edited import leaves) walked straight past the weak guard and got handed
to the browser as a download named `.jpg`, with the toast cheerfully reporting
it as saved. The fix was in the CHECK, not the code: seed both failure shapes.
This is the same lesson as the escaped `formatFeel()` mutant one version
earlier — a check that exercises one instance of a class proves nothing about
the class.

## A container check has to test the container's real shape (v284)

Found by a pre-flight audit, not by a suite — the athlete asked for the seams
to be checked before committing to a real training block, so the probe drove
information ACROSS subsystems rather than asking whether screens render:
does a measured max reach the prescription, does 40 honest sessions actually
raise the target, does rating EASY differ from HARD, does a flagged joint
propagate into every path including the focus bonus, does the meal plan
rebuild when the target moves, does everything survive a reload.

All of that held. What did not:

```js
if(!STATE.logs||typeof STATE.logs!=='object')STATE.logs={};
```

**`typeof [] === 'object'`, so an ARRAY walks straight through** — and `logs`
and `prs` are keyed maps, never lists. The repair for ARCHIVED runs forty
lines above already rejects exactly this shape
(`...&&!Array.isArray(r.logs)`); the live maps carried only half the same
guard. The codebase already knew the shape was illegal and checked for it in
one place and not the other.

It is not cosmetic, which is why the fix is asserted on SIZE and not only on
type. `logs` is keyed by `progressPtr`, so an athlete 300 sessions in whose
logs arrived as an array from a corrupted import serialises **sparse**:
measured at **1,573 bytes carrying 300 `null`s** where the object shape is
**79 bytes**. Those nulls then travel in every backup and come back on the
next import. Same family as "truthiness is not a membership test" and
"`!= null` is not is-absent" — the guard tested the wrong property of the
value.

Three mutants, all caught, and the third is the one worth keeping: replacing
the guard with an unconditional `STATE.logs={}` fails a check that a genuine
object map of real training history is left UNTOUCHED. A repair that always
wipes would satisfy every "is it an array now?" assertion while destroying
the data it exists to protect.

**Four of the five things the audit first flagged were the probe, not the
app**, and separating them was most of the work: `commitSession()` returns
`undefined` on success AND refusal (read the log it wrote, not its return
value); `sessionWork()` counts `st.sets` as an ARRAY of marked sets, so a
faked `sets:3` reads as zero work and the completion gate correctly refused;
`exAdapt` is written only by `rateExercise()`, a chip the athlete taps, so
zero entries after 40 unattended sessions is correct; and total session
volume is not comparable across session TYPES — a HIIT day against a
strength day against a deload week says nothing, so progression has to be
read from one anchored movement over time. Every one of those looked like an
app bug in the first run.

## Fixing one instance is not fixing the class (v285)

v284 hardened `logs` and `prs` after measuring the damage a keyed map left as
an ARRAY does to a backup. It fixed the two fields the probe happened to
touch. A 360 audit immediately afterwards fuzzed all 33 top-level fields and
found **the identical half-guard on eight more** — `swaps`, `restDays`,
`_opens`, `reassess`, `weekFeel`, `achievements`, `settings`, `profile`,
`nutrition`, `formatFeel`, plus `baseline`, and `_opens` had no guard at all.

**The lesson is not about arrays.** It is that a fix aimed at one instance of
a bug leaves the class alive, and the next probe finds it again. The tell was
right there in v284's own commit: the archived-runs repair already carried
`!Array.isArray(r.logs)`, so the codebase knew the shape was illegal — the
question was never "is this shape wrong" but "where else did we write the
same half-guard", and that question was not asked.

The measured cost, on the three keyed by an integer: `swaps` 1,515 bytes,
`restDays` 1,506, `_opens` 1,503 — each carrying **300 `null`s** where the
object shape is a few dozen bytes.

**Severity was established by impact, not by type purity.** A companion probe
fuzzed 33 fields x 6 junk values — 198 corrupted-state combinations — and
every single one still rendered, built a session, and left `validateData()`
clean. Nothing here crashes; the harm is entirely in what gets written to a
backup and read back on the next import. Fields whose only sin is a wrong
primitive type (`version`, `onboarded`, `_saved`) were deliberately left
alone rather than padded with repairs that buy nothing.

The check is now written against the CLASS: it walks every keyed map in one
loop and asserts none survives as an array and none serialises sparse. Five
mutants — four reverted guards plus an over-eager always-wipe — all caught.

### Four false alarms the same audit raised, and why each was the probe

Worth recording because each looked exactly like a bug:

- **61 "wrist leaks."** The probe asserted on raw `JOINT_RISK` membership.
  That ignores `wristRelieved()` — the v267 parallettes relief, where owning
  push-up bars makes specific presses safe again because the handles keep the
  wrist neutral. `jointRisky(exId, lims)` exists precisely so this cannot be
  applied on one path and forgotten on another; a check that bypasses it is
  re-implementing the rule badly. **Assert through the app's own predicate,
  never re-derive it.**
- **`ivTick` and `runFlow` "do not call countdownCue".** `indexOf('function
  ivTick')` matches `ivTickLead` first — the same substring trap this file
  documents for pistol/boxpistol — and a fixed 2,600-character window does
  not reach line 63 of a function in a file with 200-character lines. Anchor
  on `function NAME(` and take the body to the next top-level function.
- **`plRingMediaHTML` "missing", then "the player ring does not reuse it".**
  First from picking the wrong inline `<script>` element, then from guessing
  the helper was called `plBodyWork` when it is `plRingHTML`.
- **Unresolvable onclick targets `call` and `progCall`.** Both are
  template-local arrows evaluated at build time, and they only appeared
  because `document.body.innerHTML` **contains the app's own source** — the
  same trap already recorded for `document.body.textContent` and `NaN`.

Every one of those cost more time to disprove than the real bug cost to fix.
That is the normal ratio for an audit written from outside the code, and it
is the argument for asserting through the app's own predicates wherever one
exists.

## A 360-point inspection, and the range check that was a type check (v286)

Asked for a genuine top-to-bottom inspection rather than another targeted
probe — the observation being that every previous check had found something,
which is evidence of narrow coverage, not of a rotten app. 365 individually
named checkpoints across thirteen sections: exercise library, program engine,
injury safety, progression, baseline, nutrition targets, meal planning, food
logging, state, data safety, player and timers, special training, UI and
security.

**351 passed. 14 failed. Three were real, and one of those mattered.**

### The one that mattered

```js
if(typeof STATE.adapt!=='number')STATE.adapt=1;
```

`rateSession()` clamps every increment to **0.9-1.30**. This repair only ever
checked `typeof` — so a value outside that band survived every boot, and
`prescribe()` reads it **RAW**. Measured on a Beginner whose tested plank is
75 seconds:

| stored `adapt` | plank | jacks | crunch |
|---|---|---|---|
| 1 (normal) | 45s | 25s | 8 |
| 99 | **150s** | **150s** | **30** |
| -50 | **15s** | **15s** | **3** |

Nothing crashes — `prescribeCeiling()` caps the blow-up at 150s, which is
exactly why no suite ever noticed. But 150-second planks AND 150 seconds of
jumping jacks, on every movement of every session, is a badly wrong
prescription that persists across relaunches with nothing on screen to
explain it. Reachable from a corrupted or hand-edited import — the same
threat model `importData()` already guards everywhere else.

This is the mirror image of the `progressPtr` defect already recorded here: a
**range test doing a type test's job**, run the other way round. The clamp now
matches the band the incrementer itself enforces, and the check pins both
ends plus an in-band value that must survive untouched.

Two smaller ones alongside it: `nutrition.weightKg` accepted a string, which
does not crash (`latestWeightKg()` reads `n.weightKg>0`, a string fails that,
and it silently falls through to null) — but "silently produces no calorie
target" is a field the athlete filled in going missing, so a non-number is
dropped and the app asks again. And `logFood()` rounded a negative straight
through, where one -500 row cancels a real meal out of the day's total.

### Eleven of the fourteen were the inspection, not the app

Recorded because each cost more to disprove than the real bug cost to fix,
and every one is a trap this file already names:

- **`week` is 1-based** (1..6 against `WEEKS_PER_CYCLE` 6); the check asserted
  0-based.
- **Warm-up items are plain strings, cool-down items are objects keyed `n`** —
  the check demanded `.name` on both.
- **`computeAssessment()` does not stamp protocol/testCount** — the assessment
  FLOW does, when it writes the record. Checked the wrong function.
- **The goal key is `gain`, not `build`** — so "a bulk exceeds maintenance"
  compared maintenance against itself.
- **The meal plan rebuilds on a diet change via `_planStillValid()`, not via
  the stamp** — the stamp exists for inputs that leave the recipes legal, like
  a calorie target. The recipes genuinely changed; only the stamp did not.
- **A reference day is literally named "halal / no pork"** — a substring search
  for pork matched the label promising its absence.
- **`cueVol` is clamped by `cueVolPref()`, which also writes the clamped value
  back** — the stored 99 is never read raw, so there is nothing to fix.
- And the harness itself: serialising each check with `fn.toString()` to run it
  in the page **destroys closures**, so 85 checks that captured a loop variable
  reported "j is not defined" and looked like 85 failures.

**The ratio is the point.** Eleven false alarms to three real findings is
normal for an audit written from outside the code, and it is the argument for
asserting through the app's own predicates — `jointRisky()`, `cueVolPref()`,
`_planStillValid()` — rather than re-deriving each rule in the probe.

### And one bad mutant worth recording

The over-eager mutant for the adapt clamp (`STATE.adapt=1` replacing only the
`if` line) left an `else` with no `if`, so the page never parsed and the suite
crashed instead of reporting checks — which a grep for failure lines counted
as **zero failures, i.e. an escape**. Read the mutant back: a mutant that
breaks the parse tests nothing. Replacing the whole two-line block instead
produced a valid over-eager mutant, and it was caught by all three checks.

## A standing default is an athlete CHOICE, not a DEFAULT_STATE field (v287)

"Make 165 g of protein my default." The obvious implementation —
`proteinTarget:165` in `DEFAULT_STATE().nutrition` — is wrong twice, and the
second way is the one that bites.

`proteinTargetSet()` reads **absent** as "the athlete has not chosen", so a
default value makes that test true for everybody forever and `proteinTargetCalc()`
becomes dead code. That is `voicePitch` verbatim. But worse: `loadState()` does
`Object.assign(DEFAULT_STATE().nutrition, p.nutrition)`, so the key that
`clearProteinTarget()` deletes **comes straight back on the next load**. The
"↺ Use calculated" chip would work until you closed the app.

So it is seeded ONCE by `normalizeState()` behind `_protSeed`, the `_toneFix`
shape: seed when absent, set the flag in **every** branch, and let the flag
travel in a backup — a file that re-seeds over a deliberate clear is the same
bug one import later. The flag-in-every-branch half is not theoretical: the
mutant that set it only inside the branch that wrote a value escaped four
checks, because everyone who already had a target stayed unflagged and got
re-seeded the first time they cleared it.

### Raising a target exposed a substitution that had never been right

At 165 g the reference days missed by 19 g on one diet, and chasing it found
the real defect. `scaleDay()` picked a substitute by **closest
protein-per-calorie, same category first, then anywhere**. For a vegan with
soy, tree-nut, peanut and gluten allergies the whole meat category is unsafe,
so it fell through to "anywhere" and served **Spinach in place of Turkey mince
— and in place of Salmon** — because spinach's ratio (13.3 g per 100 kcal)
sits nearer turkey's (17.2) than any pulse's (7.8). Twelve safe pulses were
sitting there unreachable.

**It could not self-correct, which is what made it worse than a poor choice of
food.** Spinach is cat `veg`, so the day ended with NO anchor, `scaleDay()`'s
`anchorP>0` test failed, and `sp` — the one dial that moves protein — stayed
pinned at 1. The day therefore fell further behind the harder the target got:
9 g short at 155 g, 19 g at 165 g, 29 g at 175 g. A miss that grows with the
target is the signature of a dead dial, not a tight day.

The fix is one tier in the sort: **an anchor must be replaced by an anchor.**
Ratio stays the tiebreak, but only among foods that can carry the protein.

**The trade is real and worth stating.** Across 10 diet combos x 4 target bars
x 28 days, the worst protein miss went 36 g → 9 g (bar is 12) and the worst
calorie miss went 400 → 642 (bar is 150); total failures 168 → 169. The
restrictive-diet problem is **pre-existing and large**, and this does not
shrink it — it changes its character from an invisible protein shortfall to a
visible calorie overshoot, which `renderRef()` already reports. For a soy-free
vegan, 150 g of protein costs ~1,900 kcal from pulses alone; no code fixes
that, and a day that quietly serves spinach instead is not a fix either.

**Day 15 needed a real trim, and it was already the tightest day going down.**
`Chickpea and chicken` carried 943 kcal of starch at 1x — at the 0.5 floor
still 471, against 295 kcal of fixed food and 120 of oil — so an **omnivore**
already landed 85 kcal over on the 120 g / 1700 kcal bar, spending 85 of a
150 kcal allowance before any substitution. Honest plant anchors cost 83 more
and tipped it over. Rice 250→200 g and potato 400→300 g gave the floor
somewhere to go; the 1.6x cap still reaches the 2,800 kcal bar.

**One mutant was equivalent, and that was measured rather than assumed.**
Dropping the `wantAnchor` guard (promoting anchors for *every* want, not just
anchor wants) changed **0 of 162 real substitutions across 814 food x diet
pairs** — every non-anchor category always has a safe same-category member, so
that tier is never consulted. The guard is kept as intent and as cover for a
future food-library change, but no check can catch its removal today. Read the
mutant back before rewriting the check.

## Drawn is not the same as shown (v288)

"Add a category called macros so it shows protein, fats and carbs, not just
calories." The macros were **already on screen** — three `_macroBar`s in the
food card, and every logged row and every food-search result already printed
`46g P · 0g C · 5g F`. Two things were actually wrong, and neither was
"the data is missing":

- **The bars show what you have EATEN.** Before anything is logged they read
  0, so the numbers to *aim for* were nowhere on Fuel. "Today's targets"
  answered calories and protein and said nothing about the other two thirds of
  the plate.
- **Three unlabelled bars under a calorie figure read as decoration.** A
  heading is what turns them into a section someone can look for. Same lesson
  as the player photograph at 120px: present is not the same as legible.

So `Today's targets` became a 2x2 — Calories, Protein, Carbs, Fat — and the
bars got `MACROS EATEN TODAY` over them. **Carbs and fat are labelled
`calculated`, never `yours`**: only calories and protein are settable, and a
derived number wearing the label of a control that does not exist is the same
class of lie as a UI promise with no code behind it. With no calorie target
there is nothing to derive from, so they show a dash — a `0 g` carb target is
a prescription, not a blank.

**Reordering a stat grid broke a positional check, and that is the finding
worth keeping.** The existing repaint check read `v.querySelector('.stat .n')`
— the FIRST stat — assuming it was protein. Moving Calories to the front made
it read a figure that correctly never changes, so it would have passed with
the repaint deleted. It now finds the stat whose label starts `Protein`. Any
assertion that indexes a list by position is one layout change away from
passing on nothing.

Five mutants, all caught: dropping the carbs stat, zero instead of a dash,
dropping the heading, labelling a derived number `yours`, and painting the
carbs stat with fat's value.

## A range is not an explanation (v289)

The first defect a real athlete hit, on the first screen. He is 5'10" and
typed **178** into a box set to inches — his height in centimetres. The app
refused it, correctly, and said *"Add your height in inches (47–91)."*

That message restates the rule and names nothing. The number he needed was
**70** and nothing on screen said so. The app has both units, both ranges and
the conversion factor; it had everything required to say "178 looks like
centimetres" and said the range instead.

`unitMixupHint()` adds that suffix when — and only when — the entered number
is a plausible height in the OTHER unit. **A wrong number that is not a unit
mix-up must not be told it is one**, so 12 still gets the bare range. Both
validation sites call it: the wizard and the calorie-target sheet, which are
twins and had already been caught drifting once. The second site's own comment
described the mirror-image mistake (inches typed while set to cm, giving a
TDEE of 1591 instead of 2570) and still only printed the range.

### The sibling that does not error at all is worse

Height at least fails loudly. **Weight does not.** The imperial range is
66–550 lb, so an athlete typing kilograms lands *inside* it — 86 reads as
86 lb, or 39 kg — and every calorie number downstream is built from it with
nothing on screen to say so. Neither figure is implausible alone; **the pair
is.** 86 lb at 5'10" is a BMI of 12.4, which is not a lean person, it is a
wrong unit. `bmiImplausible()` gates at 13/60, far outside the human range in
both directions, so it can only ever catch an error.

### Two escaped mutants, both the same trap, and it is this repo's oldest one

Raising the BMI floor to 20 and lowering the ceiling to 40 both survived —
mutants that would **reject real lean and heavy athletes**. The first reason
was a weak check: the only "real body" case was 190 lb at 5'10" (BMI 27),
nowhere near either edge. **A guard earns its keep only if a check proves it
cannot fire on a legitimate input**, so the edges are now pinned at BMI 18.9
and 43.0.

The second reason was worse and had already been recorded: **a tap that PASSES
advances the wizard**, and step 1 is the only step that validates these
fields. So every case after the first success was silently gating step 2,
produced no toast, and satisfied each negative assertion on nothing. The first
version of this block failed the same way and its guard only covered the cases
that ran *before* the first success. Every case now walks back to step 1, and
the guard asserts every case was taken on the same step. `plEnterReady(false)`
first, then the thing you mean to test — the wizard is the same rule with a
different button.

## The player has SIX twins, not three (v290)

"Still encountering exercises with timers that prioritise the timer over
showing me the exercise" — reported from the phone, mid-baseline-battery. The
existing note said a timed effort is rendered in three places. It is rendered
in **six**, and only two of them had ever had the treatment:

| surface | function | photo | clock |
|---|---|---|---|
| guided player | `plRingHTML` | yes | veiled |
| HIIT | `ivRingHTML` | yes | veiled |
| warm-up / cool-down | `flowHTML` | yes | **solid** |
| hold / rest timer | `timerHTML` | **none** | solid |
| rep cadence | `repHTML` | **none** | solid |
| **baseline test** | `baselineTimerHTML` | **none, no ring at all** | solid |

The baseline sheet was a label, an 80px number and a hint. The exercise photo
sits on the step *behind* it, so tapping Start replaced the form reference with
a bare number — at the one moment the athlete is actually holding the position.
That is the same "it's like there is no view of that exercise" report as v236,
two years of versions later, on a surface nobody had counted.

**The veil is now one custom property, `--plveil` (.37), defined in both
themes.** Six copies of a number is how this drifted three separate ways; the
check fails on a hardcoded opacity in the base rule rather than on the effect,
because the effect is identical right up until someone edits one copy.

The rest exception survives and is pinned by its own check: **rest keeps a
solid clock** because it has no ten-second spoken cue, so it is the one timer
with nothing behind it. `.timerring.solid` carries the same halo the player's
rest clock uses. A 3-2-1 into position is solid for the same reason.

**A `const` arrow read by a function called ABOVE it is a temporal dead zone
error**, and it took the whole baseline timer down the first time it ran.
`paintReady()` is invoked on the line before the helper definitions, so
`btRing` had to be a function *declaration*. Nothing about the diff looked
wrong; driving the real path is what found it in seconds.

### The same test trap, three times in one session

Every one of these blocks first passed on nothing, for the same reason:

- **Suite 10**: a wizard tap that PASSES advances the step, and step 1 is the
  only step that validates. Every case after the first success gated step 2.
- **Suite 16**: the block above ends at **667x320 landscape** to prove the ring
  shrinks under height pressure, and never restores it — so the new block
  inherited a 154px ring and measured the photo as a 134px thumbnail, which is
  the exact defect it exists to rule out. **The viewport is part of the state a
  block has to build.**
- And the CSS-text assertion matched `.pl-ring.rest .pl-center{opacity:1}`
  twice — a bare `.pl-center{` prefix still matches inside a longer descendant
  selector. Anchor on a declaration only the base rule has.

## Auto changes coach every EFFORT, not every session (v291)

Asked how often Auto switches. The answer is per timed effort, and it was a
surprise worth writing down: `autoRoll()` fires at **six** call sites — the
guided player's work start, HIIT, the hold/rest timer, the rep cadence, quick
workouts, and (until this round) every baseline test. `rollAutoPersona()` is a
shuffle bag over **38** coaches: all 38 play once before any repeat, and the
bag reshuffles with a swap that prevents a back-to-back repeat across the seam.

So a ten-test baseline battery met **ten different personas** — during the one
session where the athlete is holding maximal form and listening for a count.
That is the single place a changing voice costs something, so the battery now
pins one: `ASSESS_COACH` (`wrestle`).

**An explicit pick still wins.** `assessCoachId()` only fills in for `'auto'`,
the same shape as a hand-set protein target outranking the calculation. The
mutant that made the override unconditional is caught by a check that picks a
coach in Settings and asserts the battery uses it.

**`assessState` is the obvious signal and it is WRONG.** Nothing ever sets it
back to null — it is assigned once when the battery opens and stays truthy for
the life of the app, so keying the override off it pins the wrestling coach on
every screen forever. `_bt` is the correct one: non-null exactly while a
baseline timer runs, which is exactly when the battery speaks. A check asserts
`assessState` is *still truthy* after the battery, so a future refactor back to
it fails immediately.

**Speak before you clear the flag.** `stopBaselineTimer()` nulls `_bt`, and the
sign-off line (`'Time. Strong hold.'`) ran after it — so the last line of each
test came out in a different voice from the nine that preceded it. The order in
`baselineStop()` is load-bearing, not cosmetic.

## The prompt contradicted itself, and the model obeyed the wrong half (v292)

"The app is not recognizing the macros even though it is clearly in the
screenshot." It was — as **percentages**: `58% Fat · 3% Carbs · 39% Protein`
under the calorie ring, which is all Lose It ever prints. v262 added
`_macrosFromPct()` for exactly this and the arithmetic was correct. The reading
still came back empty.

**The prompt told the model two incompatible things.** It described the
percentage fields in an aside, then set the return contract as *"whole-number
GRAMS for protein, carbs and fat"* and closed with *"if a number is genuinely
not shown anywhere, return 0 for that ONE field."* Grams genuinely were not
shown. So the model did as it was told: `protein:0, carbs:0, fat:0`, and never
filled `proteinPct` at all. `_macrosFromPct()` needs all three slices, got
none, and returned null.

Both halves had to go. The split is now stated as a **COMPLETE answer** inside
the return contract, and a number that cannot be read is **omitted, never
zeroed** — which is also the honest instruction, since `!p` already treats
absent and 0 alike and v260 established that a zero macro on a real-calorie row
is a failed reading, not a measurement. The prompt also now says `kcal` is what
was **eaten**, not the remaining budget: that screen showed 1,784 / 517 / 1,267
and only one of them is the answer.

**A prompt fix cannot be verified from here**, so the percentage path got a
route that does not depend on the model at all: three `% P / % C / % F` boxes in
the macros-missing warning, feeding the same `_macrosFromPct()`. One
implementation, whether the split arrives from the model or from the athlete's
fingers.

### Two escaped mutants, both measuring the input instead of the route

- Deleting the **Convert button** escaped, because the check queried for the
  input boxes and then called `applyPctSplit()` directly. The boxes survived,
  the button did not, and the feature was unusable. **Click the control the
  athlete taps.**
- Making a bad split fail **silently** escaped, because the check only asserted
  the gram value was unchanged — which is equally true of doing nothing. The
  toast is the behaviour; assert the toast.

Seven mutants, all caught after that. And one check failure that was the check:
handing `p:0` to `openQuickAdd()` shows `0` in the box, but the real import path
blanks the fields first (`{p:undefined,c:undefined,f:undefined}`) precisely so
the athlete types a real number. The block now mirrors that path.

## One missing macro was invisible; three were not (v293)

"The fat was not imported." It was — fat and protein both came through. It was
**carbs** that arrived as 0, and the reason nothing said so is the finding:
`macrosUncaptured()` and `_macrosMissing()` both require **all three** macros to
be zero. A reading that dropped exactly one sailed through with no warning at
all, and the tab printed `Carbs 0/198g` as though the athlete had eaten none.
That is the same lie v260 named, one macro at a time instead of three.

**Calories are not an independent number.** `kcal = 4p + 4c + 9f`, and when a
tracker's own figures are on the glass that identity holds to within rounding —
so a large shortfall means a macro was not read. On the reading that prompted
this: 102 g protein and 50 g fat account for **858 of 1,141 kcal**, leaving
**283 — which is 71 g of carbs against the 72.9 g the screenshot showed.**

`macroEnergyGap()` fires only when **exactly one** macro is zero: with two
unknowns the gap cannot be split between them, and with none it is rounding,
fibre or alcohol. It is offered on a button rather than filled in silently,
because a derived number the athlete never saw on their own screen should be
theirs to accept.

**A guard needs a check that proves it cannot fire on a legitimate input, and
the case has to actually REACH the guard.** The first "ordinary rounding is not
a missing macro" case passed all three macros, so it returned null on the
miss-count before the size guard was ever consulted — and a mutant deleting
both the 40 kcal floor and the 12% share escaped clean. The floor and the share
are now pinned by one legitimately carb-free food each: three eggs (420 kcal, a
6 kcal gap — floor) and a big fatty meal (1000 kcal, a 94 kcal gap — share).
Nine mutants, all caught after that.

**A warning that lingers after the problem is fixed reads as broken**, which
matters more here than usual because this one is itself a bug report. It
repaints on every keystroke through `updQtyTotal()`, and on sheet OPEN — an
import that dropped a macro has to say so before Save is tapped, not after.

## A ruck is not a bike, and the difference is the whole model (v294)

"I just bought a GORUCK Rucker 5.0 (25L)" with 25, 30 and 45 lb plates.
Rucking is now the third way to pay the step target, beside jumping jacks and
the bike — and it is deliberately NOT modelled like either.

**On a trainer, intensity is a dial**, so `BIKE_LEVELS` can be a fixed table of
METs. **Under a ruck, intensity is the load RELATIVE TO the athlete** — 45 lb
is a moderate ruck for a 250 lb man and a hard one for a 150 lb one — so the
MET has to be computed from their own bodyweight, not looked up. The energy
cost of walking scales close to linearly with TOTAL mass moved, which is the
dominant term for back-carried loads under about a third of bodyweight:

```
gross = pace.gross x (bodyweight + load) / bodyweight
net   = gross - 1.0        <- resting cost, same convention as BIKE_LEVELS
```

Net, because `stepKcal()` is calibrated net; a gross ruck figure would credit
~20% more than was earned, which is the exact mistake the bike's own comment
exists to prevent. The check that pins this is **"the same plate is worth LESS
to a heavier athlete"** — a property a fixed table cannot express at all.

Sanity against the world, which is what stops the arithmetic drifting: brisk
under a 25 lb plate lands at **115 steps/min**, and real rucking cadence at
3.2 mph is 110-120.

**The load share is computed, because it is the number nobody works out for
themselves.** 45 lb on a 190 lb athlete is 24%; the usual guidance is to start
near 10% and build toward a third over months. It warns past 20% and does not
block — the athlete is holding the plate.

**Per-minute distance is meaningless for walking.** The bike covers 0.23-0.4 km
in a minute; a ruck covers 0.086, which renders as "0.1 km a minute" and tells
nobody anything. The card shows the SPEED instead.

### Two checks that were testing themselves

- `setCardioMode('helicopter')` then reading `cardioMode()` passes whether or
  not the junk was stored, because that getter sanitises its own read — and the
  junk would then travel in every backup. **Assert on `STATE`.** The mutant
  that dropped the membership test escaped until that changed.
- Suite 07 compared `JSON.stringify(movement())` against a hardcoded literal,
  so a third mode adding three fields broke it — and it compared key ORDER too.
  Assert the property (nothing undefined, every counter a real zero), not the
  serialisation.

And one setup bug worth the same note as the rest: the additivity check SET
walked steps to 3000 on a seeded athlete who already had more, so the delta
came back negative. Zero it first, then add.

## Four loaded ruck movements, chosen by MOVEMENT not by name (v295)

The roster search came first, and it changed the list. **There was no step-up
anywhere in the library** — not one, in 155 exercises — and **no back-loaded
hinge**: all four `hinge` movements are front-loaded or single-leg. Those two
gaps decided two of the four. The squat and the bear-hug carry earn their
places on load POSITION: a goblet squat is carried anteriorly, a ruck sits on
the spine; a farmer's carry is one-sided, a bear hug is symmetrical and in
front.

**Ruck March was already in the library and is deliberately NOT gear-gated** —
any bag with books is fine for WALKING, which is what its own steps say. The
four new ones are gated on `ruck`, and that is a considered line rather than an
inconsistency: a satchel that shifts is a nuisance on a walk and genuinely
unsafe under a loaded hinge. A check pins the exception so nobody "tidies" it.

**Every flag is reasoned from mechanics, and the discriminating check is the
one that must NOT fire.** `ruckstepup` takes knee (loaded single-leg, the same
as the flagged `bulgarian` and `splitsquat`); `rucksquat` and `ruckgm` take
lowback (axial spinal load, where every other loaded hinge already is);
**`ruckcarry` takes nothing at all**. Blanket-flagging everything with 'ruck'
in the name satisfies every other assertion and fails that one. The floors are
pinned beside it — plain `squat`, `kbgoblet` and `kbcarry` all stay unflagged,
which is what proves the escalation is reasoned rather than a family flag.

`equip` is an AND (`e.equip.every(...)`), so the step-up asks for `['ruck',
'bench']` and is the one movement the pack alone does not unlock.

### A comment that quotes code breaks the duplicate-key check

Two checks failed on prose. The `SAFE_SWAP`/`JOINT_RISK` duplicate-key guard
scans the **source text** for anything shaped like `word:` — so a comment
containing `btsquat:'squat'` reported a duplicate `btsquat`, and one containing
`ABSENT:` reported a duplicate `ABSENT`. That guard has caught real shadowed
keys (`boxpistol`'s two `repCap`s), so **reword the comment, never weaken the
check**. Write prose that does not look like code.

And the substring trap again, caught by the assert rather than by a defect:
`'btsquat','btbalance'` is the tail of BOTH `JOINT_RISK.knee` and
`FOCUS_POOL.legs`. Anchor on the KEY (`knee:['pistol'`), not on the tail.

**The photos came back right, one prompt at a time.** Four separate requests,
four separate images, no collage — against v283, where a single carefully
worded combined prompt returned a 2x2 grid with an empty cell. The variable is
the count per request, and nothing else.

## The instruction was on the screen and nothing enforced it (v296)

The battery's own guidance says, in bold, *"Rest 2 minutes between tests —
these are maximal efforts, and a short rest measures your recovery instead of
your strength."* `assessNav()` went straight to the next test. **A promise in
UI text is a specification** — this is the fourth entry under that rule, after
`safeMode()`, the restart confirm and the finish screen.

The athlete found it the way the others were found: by using the app. He took
thirty or forty seconds between some efforts because nothing on screen was
counting, and his two lowest scores were the two tests that follow another
trunk test. **The numbers this battery produces anchor every prescription for a
year**, which is why an unenforced rest here costs more than an unenforced rest
anywhere else in the app.

`startAssessRest()` opens a 2:00 countdown between tests. Three properties are
reasoned rather than incidental:

- **The clock is SOLID.** Rest has no ten-second spoken cue, so it is the one
  timer with nothing behind it — the same exception `.timerring.solid` already
  carries in the player. Every other timed surface veils at `--plveil`.
- **It previews the movement COMING**, with `plRingMediaHTML(ex)` behind the
  clock, so the two minutes are spent getting set rather than waiting. The
  discriminating check is that it names the NEXT test, not the one just
  finished — a page-wide substring search passes on either.
- **Stepping BACK does not cost a rest.** Re-entering a number you mistyped is
  not a maximal effort. `if(dir>0)` is the whole of it, and the mutant that
  drops the direction test is caught by a check that walks back one step.

**A skip records the seconds actually TAKEN, not a zero.** The athlete who
tapped Skip at 0:40 did rest, just not fully, and a re-test comparison wants the
real number. The record stamps `restsTaken`, `restsFull` and `restMedian` beside
`TEST_PROTOCOL`, for exactly the reason the protocol stamp exists: a v1 and a v2
run under different rest are not the same measurement, and the app should be
able to say so instead of reading the gap as progress.

### Two test lessons, both already in this file

**`innerText` returns the RENDERED text, and `.tt` is uppercased in CSS.** The
preview check asserted `/Up next/` against `innerText` and failed on a screen
that was perfectly correct — the DOM says `Up next`, the glass says `UP NEXT`.
Read `textContent`, scoped to the element, and require the next test's name.

**A guard has to sit before the first line that assumes the thing exists.** The
"no rest at all" mutant killed the block with a TypeError on `_ar.left`, so the
suite reported *"the test file itself threw"* rather than naming a failed check.
That is still red, so it is still a catch — but a throw hides which property
broke, and the same shape one step further along **hung** a suite in v267. Guard
immediately, return the partial result, and let the named assertions report.

## Every beat of the drill, and not the drill (v297)

"Do we have the 8-count push-ups?" No — and the roster search is what made
that answer interesting. The library had **every beat of it separately**:
`squatthrust` (squat, kick out, kick in, stand), `burpee` (that plus a jump),
`burpeetuck`, and `plankjack` (the legs-out-and-in beat, in a plank). The
drill that chains them was nowhere.

**What earns it its own entry is one word in the burpee's own steps.** The
burpee offers its push-up as optional — *"add a push-up to make it harder"*.
In an 8-count the push-up is counts 5 and 6; it is not a variation, it is the
movement. That is a real pressing demand inside a conditioning movement, which
nothing else in the cardio region has.

`hardness` 0.65 is calibrated against the two nearest siblings, not guessed:
harder than a plain burpee (0.7) because the push-up is mandatory, easier than
a maximal tuck-jump burpee (0.6). That places it after the burpee in both
cardio ladders and between the two in `hiitFinL`, all three of which stay
non-increasing.

**The discriminating flag is the one that is ABSENT.** Wrist and shoulder are
obvious — bodyweight through the hands for the plank, the leg spread and a full
push-up. Knee is the interesting call: `burpee` and `burpeetuck` both carry it,
and copying a sibling's flag set is exactly what the checklist warns against.
**An 8-count has no jump and no landing — you stand up on the eighth count.**
`squatthrust`, the one sibling that also has no jump, carries wrist and nothing
else, and that is the shape this matches. The check pins all three: the new
entry has no knee flag, the burpee does, and the squat thrust is wrist-only.
Blanket-flagging the family satisfies every other assertion in the block.

Eight mutants, all caught. Two are worth keeping as a pair: copying the
burpee's knee flag, and copying the burpee's `hardness` — the second one is
caught not by a check about the exercise at all but by the ladder-monotonicity
assertion, because 0.7 after 0.7 stops the descent. A calibration mistake shows
up as a structural failure one map away from where it was made.

**A still of an eight-position movement is a CHOICE, and it has to be made
deliberately.** Every other photo in the library shows the one shape its
exercise has. This one has eight, they are numbered, and the obvious failure is
a prompt that asks for a step-by-step strip — the highest collage risk yet, for
exactly the reason v283 identified. The frame picked is the **top of the
push-up, feet together**, because that position is *both* count 2 (the plank
after the feet kick back) and count 6 (the press-up), so one image carries two
of the eight. The bottom of the push-up would have carried only one, and the
wide-feet plank is already what `plankjack` shows. One request, one image, no
collage — the count per request is still the only variable that matters.

## A goal whose success is a flat line (v298)

"I've changed one of my goals from weight loss to recomposition — losing fat
and building muscle, and trying to maintain the body weight." The goal already
existed. It was called **Tone up**, its note promised fat loss *"at the same
time"*, and it prescribed **0.9 x maintenance** — a ~250 kcal deficit the
athlete never chose. That contradiction reached them three ways, and each way
is a rule already in this file.

- **A promise in UI text is a specification.** `recomp` had no tip line of its
  own, so it fell through to the fat-loss copy promising a *"~300-500 kcal/day
  deficit"* on the one goal whose entire point is that the scale holds.
- **`calorieCheck()` read a held line as stalled.** It derives the expected
  rate from target-vs-TDEE, saw a deficit, expected half a pound a week off,
  and told an athlete doing exactly the right thing to **cut further**.
- **The weight chart painted a flat line grey.** `goodDirection` was
  `goal==='gain' ? change>=0 : change<=0` — down is green for everyone else.
  Same blind spot v239 fixed for bulking, one goal over.

The fix is one list. `STABLE_GOALS` (`recomp`, `maintain`) is read by all three
consumers, and it **takes the goal as an argument** so the chart keeps reading
`profile.goal` and the target keeps reading `nutrition.goal` while the
membership test exists once — `normalizeState()` already syncs the two with
profile as the source of truth.

**The target moving to maintenance is what makes the other two honest.** With
`recomp` at 1.0x TDEE, `calorieCheck()`'s existing maintenance bail fires on
its own — no second rule. Fixing the check without the target would have left
the app prescribing a deficit and then refusing to measure it.

### Switching a check off is not fixing it

That bail is exactly where this nearly shipped broken. With `expected` read off
the target, a recomp athlete gets `null` in **both** directions: held is silent
(correct) and drifting up by 2 kg is *also* silent (a disable dressed as a fix).

**A weight-stable goal has an intended rate and it is exactly zero, which is
measurable.** So `expected` is forced to 0, `STABLE_DRIFT_KG_WK` (0.1 kg/week)
is the deadband that makes "held" a real answer rather than a coin flip, and
the verdict is `drift` — not `stalled`, because *"the scale is barely moving"*
is **praise** on this goal and the stalled copy would say the opposite of what
it means.

**The hold band is symmetric, and that is a decision.** A sustained drop is not
a recomposition either; it is an accidental cut, and on the goal that exists to
protect muscle the athlete is better off knowing. The band is 1% of the
starting weight, which carries its own units and so works in kilograms and
pounds alike.

**Colour alone does not say what it means**, so `· held` / `· drifting` is on
the glass beside the number.

Eight mutants, all caught. The two worth keeping: making **every** goal stable
satisfies every assertion about recomp and fails the floors (a cutting athlete
losing weight must stay green, a bulking athlete gaining must stay green); and
the **one-sided** hold band passes every "flat is green" check while reading a
runaway cut as success. Both are why each stable-goal check has its
already-correct sibling pinned beside it.

### The protein request that needed no code

Asked in the same breath to "increase the protein to 1.8 g/kg". The app was
**already** at 1.8 for this goal — `proteinTargetCalc()` uses 2.2 only for
`shred` — and the Fuel tab already renders the calculated figure inside the
`↺ Use calculated (NNN g)` chip. What was in effect was the athlete's own
hand-set 165 g, which outranks the calculation by design (v287). One tap, no
change. Worth recording because the instinct was to write code for it: **read
what the app does before changing what it does**, and a request to change a
number is not evidence the number is wrong.

## A multiplier the ceiling had been erasing for years (v299)

"Raise it to 2.2 for recomp." One line in `proteinTargetCalc()`, and the change
would have shipped doing **nothing at all**.

The multiplier is only one of two inputs. A lean-mass ceiling sits underneath
it — `g=Math.min(g, lean*2.4)` — and 2.4 g/kg of LEAN beats 2.2 g/kg of TOTAL
for anyone above about **8% body fat** (2.2 > 2.4x(1−bf) only while bf < 8.3%).
So the ceiling was deciding the answer for every real athlete, and the goal
multiplier was decoration. Measured at 86 kg and 28% body fat, before the fix:

| goal | multiplier | prescribed |
|---|---|---|
| lose | 1.8 | **150 g** |
| shred | 2.2 | **150 g** |
| recomp | 1.8 | **150 g** |

**`shred` has carried a 2.2 for many versions and it has never once reached an
athlete.** Same shape as the `voicePitch` trap: a guard that is true for
everybody forever, killing the code behind it. Nothing threw, nothing looked
wrong in the diff, and the number on screen was defensible — which is exactly
why it survived.

So the ceiling moves with the multiplier. The goals that earn more protein earn
a correspondingly higher ceiling (2.8 g/kg lean), both stay inside the evidence
band for a cut (~2.3–3.1 g/kg lean), and the guard still bites everywhere: at
86 kg / 28% it allows 175 g against an uncapped 189, and at 110 kg / 36% it
allows 195 g against an uncapped 242 — the overshoot it was written for.

**The lesson is where to point the check.** The first version of this block
asserted `calc / weight === 2.2`, which is a statement about the *multiplier*,
not about the athlete. It failed on correct code — and it would have passed on
a 2.2 that the ceiling was quietly discarding. **Assert the number that reaches
the athlete**, and exercise BOTH mechanisms: an ordinary athlete where the
ceiling binds, and a lean one where the multiplier does. A check at only one of
them passes on half the code.

**And do not pin a floor to its siblings.** The first floors read
`lose === core === maintain === gain`, which stays true when every goal rises
together — two mutants escaped through exactly that gap (`perKg=2.2` and
`leanCap=2.8` unconditionally). The floors now derive from the app's own
constants, and the constants themselves are pinned, because they are the
specification rather than an implementation detail.

**The tip names the aim, not a number it cannot always hit.** "~2.2 g/kg" is
false precision once the ceiling binds — the athlete at 28% gets 2.03. It says
*"toward 2.2 g/kg, bounded by your lean mass"*, and the Fuel chip shows the
real figure beside it.

Eight mutants, all caught after the floors were rewritten.

## A check that only runs on the way IN (v300)

"The app is still not polling the carbs from the screenshot." It was not the
import. `macroEnergyGap()` was correct and would have fired on the exact row —
102 g protein and 50 g fat account for 858 of 1,141 kcal, leaving 283, which is
71 g of carbs. **It just never ran on a row that was already saved.**

v293 wired the gap check into `updQtyTotal()` and into the add sheet's open. Both
are on the way IN. The Fuel tab's own ⚠️ on a logged row is gated on
`macrosUncaptured()`, which requires **all three** macros at zero — so a row that
dropped exactly one had no badge, no day-level warning, and a bar reading
`Carbs 0/196g` as though the athlete had eaten none. Same lie the gap check
exists to stop, one screen further along.

**A check belongs wherever the bad state can be OBSERVED, not only where it can
be created.** A row can arrive already broken — saved before the check existed,
restored from a backup, or saved anyway because the athlete tapped past the
warning. The route in is not the only route.

`foodMacroGap(f)` asks `macroEnergyGap()` about a stored row rather than
re-deriving the rule, so the 40 kcal floor and the 12% share that keep it off a
legitimately carb-free food live in exactly one place. The two states stay
separate everywhere — badge, wording and count — because they need different
fixes: all three missing means the macros were never recorded, while one missing
means the calories already name the answer.

**The badge names the grams, and that is the point of it.** "Carbs missing" is a
nag; "carbs missing — tap to add ~71 g" is the fix, and the row's tap already
reached `editFood()` → `openQuickAdd()` → `faGapPaint()`, so the offer was
waiting there the whole time. The mutant that strips the grams is caught.

Seven mutants, all caught. The floors are what make it honest: a complete row, a
genuinely carb-free row (three eggs, 420 kcal, a 6 kcal gap) and an all-three-
missing row that must keep its own different warning and must not be
double-counted.

## Read the number; do not compute it (v301)

"Why do I have to enter it manually? This defeats the purpose of importing the
screenshot." It did, and the complaint is the fix.

The prompt was not at fault — it says plainly to OMIT a number it cannot read
and never to return zero. The model dropped carbs anyway. What was wrong is
what the app did next: `foodScreenshot()` branched on **all three** macros
missing (blank the fields, warn) and did **nothing at all** for exactly one —
the case the calorie identity solves outright. So the reading arrived with a
zero in the box and the athlete was asked to tap an offer, on the one feature
whose entire purpose is not typing numbers in.

This is the third version of the same one-versus-three asymmetry: v293 fixed it
in the add sheet, v300 on a logged row, and it was still sitting on the import.
**Fixing one instance is not fixing the class** — and the class here is not
"macros", it is *every branch written for all-three that never got its
exactly-one sibling*.

**It is not a guess.** `kcal = 4p + 4c + 9f`; the model read two of the three
and the calories it read name the third. 102 g protein and 50 g fat account for
858 of 1,141 kcal, leaving 283 — the 71 g of carbs the athlete's own tracker
was showing on screen.

**Screenshot path only, and that is the point of the identity.** A screenshot
carries numbers another tracker already computed, so kcal and the macros agree
by construction. A food PHOTO estimates all four independently and the identity
says nothing there, so deriving one from the others would invent precision that
never existed. A check pins `foodPhoto()` NOT calling it.

**A derived figure has to be visible as one.** It is stamped `macroDerived`, the
sheet says where the number came from and what gap it closed, and Save is still
the athlete's tap — which is what keeps v293's "a number the athlete never saw
should be theirs to accept" true while removing the work.

### The arithmetic was still the wrong answer

The first version of this shipped the derivation as THE fix. The athlete pushed
back, and was right: *"The number is already given. It should just take what
it's given from the screenshot. It needs not do arithmetic."*

The identity is exact, but it is a workaround for a **reading** failure. The
figure was on the glass; the model did not return it. So one missing macro now
buys a second, NARROW look at the same image — one that knows exactly what is
absent and what was already read, so it can say where to look. The derivation
is what happens when that fails too.

**Why a second call rather than a better single prompt.** The first pass has to
describe every layout a tracker might use, so no part of it can be emphatic
about one number. The re-read has one job. It runs only when exactly one macro
is missing, so the ordinary import still costs one call — and two missing gets
no second look at all, because there is nothing specific to go and find.

**The response schema is enforced** (`responseMimeType` plus `responseSchema`),
so a wider set of key aliases would have fixed nothing: the model cannot return
`carbohydrates` when the schema declares `carbs`. It returned nothing at all,
and `required` is only `name` and `kcal`. Worth checking before theorising
about the parse.

**The image is hoisted for the same reason.** Whichever downscale actually
reached the model is what the second look must re-read — re-encoding at a
different size asks about a different picture.

The discriminating check gives the re-read a value the identity would NOT
produce: the mock returns **73 g** where the derivation computes **71**. A check
asserting only `carbs > 0` passes on either, and the entire point is which one
wins.

### Two escapes, and only one was a weak check

**Calling the helper is not driving the route.** The mutant that deleted
`est=_fillMacroFromKcal(est)` from `foodScreenshot()` walked straight through,
because the check called `_fillMacroFromKcal` directly. Four more escaped the
same way on the re-read round — including one that reordered the two so the
arithmetic won anyway — so the ORDER is asserted on the source too. The caller is a
file-picker callback nothing can drive, so the wiring is asserted on the
SOURCE — `foodScreenshot.toString()` calls it, and after the all-three branch.
Same family as the v292 Convert button: exercise the route, not the input.

**The other was an equivalent mutant.** Removing `_macrosMissing` from
`_fillMacroFromKcal` changes nothing: `macroEnergyGap()` already returns null
unless exactly one macro is absent, so an all-three reading can never reach the
fill. The guard is kept as intent and the comment says no check can catch its
removal — the same call as v287's `wantAnchor`. **Read the mutant back before
rewriting the check.**

**And a mock that does not count is a check that counts nothing.** Two
"spends no second call" checks passed on a mock with no counter in it at all,
so a mutant that re-read on EVERY import was invisible. Both now count what
the resolver spends, with the first pass excluded and a guard asserting the
case really was the shape it claims.

## Two countdowns of the same three seconds (v302)

Reported mid-session, day four: *"when it's time to rest there is a 3, 2, 1 and
then again it repeats 2, 1."* Every timed surface spoke `'Three. Two. One.'` at
`remain===3` **and** fired the per-second cue at 3, 2 and 1. The spoken line
takes about a second and a half, so it runs across seconds 3 and 2 while the
beeps tick cleanly underneath. Two countdowns of the same three seconds, out of
step.

**It was on all five surfaces, not one** — the guided player's hold and its
rest, HIIT, the hold/rep timer and the warm-up flow. Reported on rest because
that is where it is most exposed: rest has no ten-second marker, so the last
three seconds are the only sound in it.

**The beeps win.** They are per-second and exact; they carry the ten-second
marker and the 9-4 ticks that a voice line cannot; and the last three include a
buzz so a silenced phone still gets them. A second countdown on top of one that
already works is noise. The check pins both halves — no surface speaks a second
countdown, and every surface still cues the last three seconds — because
deleting *both* satisfies every "no double" assertion and leaves silence.

## A voice picker that silently retires the whole cast (v302)

*"I'm only hearing a female voice, I'm not hearing any of the other coaches."*
The rotation was not the suspect: 38 personas play through a shuffle bag before
any repeat, and that has its own check. What a persona SOUNDS like is, and two
things collapse the cast onto one voice:

- **A picked voice in Settings.** `coachVoiceFor()` returns it for EVERY coach,
  by design — and the copy under the picker said *"leave on Auto to use the
  deepest one your phone has"*, which describes a preference, not an override of
  all 38. **A control whose real effect is not the one its label describes is
  the same defect class as a promise in UI text with no code behind it.**
- **A device with one usable English voice.** `assignCoachVoices()` splits the
  pool by name and hands them round; with nothing to spread across, everyone
  shares one.

Neither is visible from this sandbox, so the app measures it on the device and
says which one it is — the same reason `runAIDiagnostic()` exists. The forced
case names the voice and offers one tap to hand the coaches back their own.

**Order the branches by what is KNOWABLE, not by what is convenient.** The first
version checked the voice list first and returned "tap Test voice" before ever
reaching the forced-voice warning — so the one explanation that is knowable from
a stored setting alone was hidden in exactly the state an athlete is in when
they open Settings to ask why. The probe caught it because headless Chromium has
zero voices; a check now pins it.

**And the healthy case must stay quiet.** A guard that always fires makes the
two real explanations worthless, so a phone with six voices gets a count and no
warning at all. Eight mutants, all caught, including one that warns on
everything.

### The warm-up videos were never made

Same report: *"we've made all of the videos for the warm up but the warm-up
session only has the very first one."* Not a bug. `ls *.mp4` — **only
`wu-march.mp4` exists**; the other seven warm-up moves carry `img` and no `vid`,
and `showFlowMedia()` correctly falls back to the photo. Twelve `ex-*.mp4` files
exist, none of them warm-up. Check the assets before reading the code: the code
was doing exactly the right thing with the data it had.

## Three attempts at one video, and what the failures measured (v303)

The 8-count push-up is the strongest case in the library for a video: eight
numbered positions, and the still can only carry two of them. Three
generations, and **not one contained a push-up**. Measured at full resolution
each time — the elbows never bend, in any frame, in any attempt.

**Position in the prompt beat emphasis in the prompt, and that was measurable.**
Attempt one put "one person only" in a DO NOT list at the end and got a
duplicate man standing beside the mat for the whole clip. Attempt two moved it
to the top and the duplicate vanished for seven of ten seconds. Attempt three
kept it at the top and the duplicate was gone entirely. Meanwhile "THE MOST
IMPORTANT PART OF THIS VIDEO", in capitals, in the middle, was ignored three
times running.

**The model substitutes a movement it knows for the one described.** Squat,
hands down, kick the feet back, stand is a burpee-shaped motion with thousands
of training examples behind it, and it is retrieved as ONE unit. The push-up and
the lateral leg spread sit inside that unit's window and are simply not in the
retrieved pattern. Removing the name, removing the standing, and calling it "a
push-up video" did not dislodge it — attempt three produced a plank with the
knees tucking forward, which is a mountain climber.

So: **stop and keep the still.** The frame chosen for `ex-count8.jpg` is the top
of the push-up with the feet together, because that position is both count 2 and
count 6, and the app reads all eight counts aloud during the set.

### The salvage, and the control that stopped a false alarm

Attempt two's first 4.4 seconds are a clean single-person **squat thrust** —
stand, squat, hands down, feet back to plank, feet in, stand — which is exactly
`squatthrust`'s four steps, and that exercise had no video. Cropped 720x720 from
x=150 (which also crops out the generator's watermark), scaled to the house
640x640/24fps/silent, and wired up.

**The video would not load in the harness, and the control is what proved that
was not the video.** `canPlayType('video/mp4; codecs="avc1.42E01E")` returns
EMPTY in this sandbox's headless Chromium, and the known-good `ex-burpee.mp4`
fails to load identically. Without loading an existing asset as a control, the
obvious next move is to re-encode a file that was never broken. **When a new
asset fails a check, run the check against an old asset before touching the new
one.**

## The derived number stopped being visibly derived (v304)

"The carbs tab stated 91 grams, the app saw 86, why the difference?" 86 was not
a misreading. It was v301's fallback doing exactly what it was built for:

| | |
|---|---|
| protein 82 x 4 | 328 kcal |
| fat 37 x 9 | 333 kcal |
| accounted | 661 of 1,005 |
| left over | 344 kcal = **86 g** |

**It is 5 g light because the TRACKER's own numbers do not balance.**
81.6 + 91.3 + 37.2 comes to 1,026 kcal against the 1,005 Lose It reports — a
21 kcal gap, which is 5.3 g of carbs. Real trackers never balance to the gram:
fibre, rounding, and per-food values more precise than the ones they print. That
error is the built-in cost of deriving, and it is the whole argument for reading
the number instead.

**So the athlete has to be able to SEE that a figure was derived — and after
saving, he could not.** v301 stamped `macroDerived` on the estimate and the
sheet said where the number came from, but `saveFood()` writes only
`name/kcal/p/c/f/meal/at/portion` and dropped the stamp on the floor. One tap
later the calculated 86 was indistinguishable from a measured one, and the row
read `82p · 86c · 37f` with nothing to question. **A note that lives only in the
sheet is not a record.**

The marker now travels onto the row, and three properties are reasoned:

- **It clears if the athlete corrects the number.** A hand-typed value is a
  measurement again, and the marker would be a lie. Compared per SERVING,
  before the quantity multiplier, because that is the number the fill wrote.
- **A fully-read import carries nothing.** A marker on every row means nothing.
- **Membership, not truthiness**, in both the store and the render: `calc`
  reaches `innerHTML` and `importData()` accepts arbitrary JSON.

### The prompt was describing the wrong version of the athlete's own screen

The failing layout is the coloured bar under the calorie ring with
`37.2g Fat · 91.3g Carbs · 81.6g Protein` in it. The prompt described that exact
bar — **in capitals** — as the PERCENTAGE case, and gave grams one short
sentence. The model was pattern-matching the loudest description of the layout
it could see, and it is always the **middle** value that goes missing while the
two at the ends come through. So the grams form now leads, names all three
numbers, calls out the middle one, and states the rounding.

**Two mutants escaped first, and both were defence-in-depth blind spots.**
Deleting `logFood()`'s membership test survived, because the junk check wrote
`d.food` directly and only ever exercised the RENDER guard — junk stored there
still travels in every backup, which is the harm v285 measured. And nothing
asserted the prompt's content at all, so the whole grams instruction could be
removed silently. Two guards mean two checks.

## The video was right and the words were wrong (v305)

The Inchworm Walkout generated cleanly on the first attempt — one person, no
jump, legs straight, hands walking out one at a time to a real plank. After
three failures on the 8-count that is worth recording: **the movement the model
could not render was the one with a push-up buried inside a conditioning
sequence.** An inchworm has no push-up, it is a common movement with plenty of
training footage behind it, and it came back right immediately.

What did not match was the app. Its step 4 read *"Walk the hands back to the
feet and stand tall."* Both the athlete's own reference clip and the generated
video walk the **FEET in** toward the planted hands — which is the travelling
inchworm, the form the exercise is named for.

**The words moved to match the picture, not the other way round.** A video
sitting beside a contradicting instruction is the same defect as a promise in UI
text with no code behind it, and here the picture was the more standard form.
The check pins both halves: the steps must say the feet walk in, and must still
say the hands walk out — losing either describes half a movement.

**The no-jump cue is what stops it being a burpee**, so it is pinned too. That
is the single line separating this from `squatthrust`, and it is the instruction
the generator most wanted to ignore.

### The bonus pass that could cost nine calls

"I do not have much token for Gemini." The v301 re-read was given a time budget
and nothing else, so it inherited `_visionEstimate`'s full **3 models x 3 rounds**
loop: on a flaky connection one bonus look could spend **nine** calls against a
metered key. Measured at 9 uncapped, 1 capped.

It now passes `backoff:[0]` and a single model — the one that just answered.
**There is nothing to retry FOR:** if the second look comes back empty the
derivation catches it, so a retry storm buys nothing and costs everything. The
FIRST pass keeps its retries, and a check pins that, because capping it would
trade a quota saving for imports that fail on a bad connection.

**A time budget is not a call budget.** `budget`/`ms` bound how long a pass may
take; neither bounds how many requests it makes inside that time. On a metered
API the second number is the one that matters.

And the fix shipped a temporal dead zone on its first attempt: `const models=
(o_.models…)` was placed ABOVE `const o_=opts||{}`, which throws on **every**
import, not only on a re-read. Caught in seconds by a probe that actually called
the function — the same trap as v290's `btRing`, and the same lesson: driving
the real path finds what reading the diff does not.

### What made three prompts fail and this one work

Position beat emphasis every time (v303), and that held here — "one man, alone"
first, the anti-jump rule second. But the deciding variable was the movement
itself. Ranked by how much the model fought back:

| movement | push-up inside it? | result |
|---|---|---|
| 8-count push-up | yes, mandatory | 3 failures, never rendered |
| squat thrust | no | correct, salvaged from a failed 8-count run |
| inchworm walkout | no | correct first time |

**Before writing another video prompt, ask whether the movement contains a
press.** If it does, expect the model to substitute the pattern it knows and
budget for the still instead.

## A dashboard is a running total, not a meal (v306)

Reported after a real training day. Lose It's dashboard was imported once
after breakfast and again after lunch:

| import | tracker showed | app logged |
|---|---|---|
| after breakfast | 1,005 kcal | 1,005 |
| after lunch | 1,235 kcal (breakfast **included**) | +1,235 |
| day total | **1,235** | **2,240** |

The second screenshot already contained the first, because that is what a
tracker's dashboard IS. Logging both counted breakfast twice and pushed the
athlete over budget on food he had not eaten.

**The evidence was on the row the whole time and nothing read it.** Both
imports came in named *"Mon, Aug 24"* — a DATE, not a meal — because the
dashboard is the whole day. The app had no idea a row came from a screenshot:
`logFood()` stored name, calories, macros and meal, and nothing said where the
number came from. So `src:'shot'` is now stored, by MEMBERSHIP not truthiness,
and a second import of the same day **replaces** the first.

**A deliberately-separate import must NOT carry the marker, and that was a real
defect the check caught.** A per-meal screenshot is a genuine thing, so there is
an escape hatch — but the first version marked the separate row as a running
total too, and `prevShotIdx()` takes the LAST one. The next import therefore
replaced the *meal* and left the real day total standing beside it: measured at
**2,635 kcal where 1,800 was eaten**, which is worse than the bug being fixed.
A separate import is a food, not a total.

**Say what Save is about to do, before it is tapped.** A silent replace is the
same defect in the other direction — one row where two were logged, with nothing
on screen to explain it. The first import of a day says nothing at all, because
a note that fires every time is a note nobody reads.

**The choice does not stick, and the leak path is an ABANDONED toggle.**
`saveFood()` already clears the flag, so the check that asserted "the flag
survives" right after a save was measuring nothing — the mutant that deleted the
reset in `foodScreenshot()` escaped clean. The real path is tapping *Add as a
separate entry* and then closing the sheet: the flag is still armed, and every
import after it stacks silently. The block now drives that, and the reset is
asserted on the SOURCE and on its ORDER, because `foodScreenshot()` is a
file-picker callback nothing can drive and a reset placed after the sheet is
built arms the wrong one.

**`src` is carried across an edit.** Correcting a number on an imported row does
not stop it being the day's running total, and dropping the marker would let the
next screenshot stack on top of it — the same bug, one tap further along.

Ten mutants, all caught. The floors are what make it honest: a hand-typed food,
a quick pick and a barcode must always add a row, and an import on a new day must
leave yesterday's total alone.

## A voice line and a per-second job cannot share the same second (v307)

Seven reports from one training session, and five of them are one defect wearing
different clothes. `_deviceSpeak()` calls `speechSynthesis.cancel()` on **every**
utterance, so any line spoken one second after another kills it mid-word — and
starting an utterance on Android stalls the main thread long enough that the
next timer tick arrives late.

- *"after one exercise it goes straight into the other exercise without even
  announcing the name"* — `enterTransition()` said *"Next up. Arm Circles. Get
  into position."* and the spoken 3-2-1 cancelled it **one second later**. It
  never once played to the end.
- *"before the exercise starts, the exercise should be announced also"* — the
  player named the movement only on the FIRST set of each exercise, so sets two
  and three arrived as a bare "Go!".
- *"it is skipping some numbers"*, in the warm-up **and** in the working sets.
  Two separate causes, below.

**The beeps are the countdown; a voice on top of them is not a second opinion,
it is an interruption.** That was already the v302 call and it had only been
applied to one surface. The spoken digits are gone from the warm-up transition
and from the player's get-ready — both still beep every second, and the get-ready
still says "Go!".

### A late tick is paid for out of the display

`plTickHold()` and the flow tick FLOOR `remain` at what the wall clock says is
really left, which is correct — real time really did pass. Measured: a tick
arriving 1.6 s late printed **11, 10, 8**. The 9 was simply gone, and so was its
beep.

The fix is not to remove the floor, it is to stop spending the second inside the
tick. `plSay()`/`plHype()` defer the utterance so the tick finishes — number
painted, ring moved, beep fired — before the synthesiser is touched, and
`plTickHold()` now paints **before** it coaches rather than after.

**A source assertion could not catch this.** A mutant that made `plSay()`
synchronous escaped four checks, because they all asserted the ticks call
`plSay` rather than `coachSpeak` — which stays true. The name changing is not
the fix. The block now stubs `coachSpeak`, calls `plSay`, and asserts nothing
was spoken **synchronously**.

### The other skipped numbers were not timing at all

Coaching *replaced* the count. Every 4th rep spoke a form cue instead of the
number and the halfway rep spoke a hype line instead, so a 20-rep set was
counted aloud as `1 2 3 _ 5 6 7 _ 9 _ 11 _ 13 14 15 _ 17 18 19 20` — **five of
twenty missing**. The number now goes FIRST in one utterance with the coaching
after it, because the next rep's `cancel()` will cut whatever is still playing:
the count always lands and only the coaching can be clipped.

## The pointer gate could defer a callback for ever (v307)

*"After the rest period it just shuts off rather than going into the next set."*
It had not shut off. `plRestDone()` was sitting in a queue nothing would ever
drain.

`whenPointerFree()` holds a timer-driven DOM swap until the finger lifts, so a
tap is never destroyed mid-press. A touch takes **implicit pointer capture** on
whatever it landed on — and when a timer replaces that element (`plAfterSet()`
rewrites `#plBody` with no gate of its own), the `pointerup` fires at a node that
is **no longer in the document** and never reaches a `document` listener.
`_ptrDown` stuck `true` permanently, and every later `whenPointerFree()` call —
`plRestDone`, every `ivStep`, `ivDone` — queued a callback that never ran.

Three independent ways to flush now, and the **watchdog** is the one that cannot
be defeated by a detached element: a finger resting on the glass for 900 ms is
not mid-tap. A fresh `pointerdown` also flushes, because a new tap proves the
old one is over whatever became of its `pointerup`.

**The floors are what keep it a deferral rather than a disable**: with no finger
down the callback runs immediately, and an ordinary completed tap still defers
and then runs on the `pointerup` — not on the watchdog. A gate that always
waited out the watchdog would satisfy every "it eventually ran" assertion while
adding most of a second to every phase change in the app.

## A one-sided movement balances INSIDE the set (v307)

*"The kettlebell bent-over row has three sets and it doesn't tell you to switch
hands — you'll do two sets on one hand and one on the other. It needs to be
either two sets or four sets."*

Right about the imbalance, and the set count is the wrong lever: `prescribe()`
owns it for real reasons and forcing it even here would distort volume
everywhere else. **The SET is what has to balance**, which is how the other
fifteen one-sided movements already worked — *"Count each side as a rep"*,
*"Switch legs halfway through the time"*.

Three said nothing at all (`kbrow`, `kbcp`, `kbwindmill`) and two said it only in
prose the coach never read (`btbalance`, `kbhalo`). `side:'switch'` is now the
single place the rule lives, so the steps, the session card and the guided player
cannot drift apart — and `validateData()` checks the pairing **both directions**,
because either half alone is a lie.

**The discriminating check is the one that must NOT fire.** `dbrow` holds a bell
in each hand, `dbcp` cleans both, `kbgoblet` is two hands on one bell — a blanket
family flag satisfies every "the row is flagged" assertion and fails those.

**The call is not only spoken.** A phone on silent in a gym hears nothing and the
athlete is looking at the ring, so the switch also gets a rising two-tone cue and
a line on the coach row. The mutant that deleted both left every spoken assertion
green — count the tones by FREQUENCY (660 Hz is unique to the switch cue; the rep
engine's own count tone is 880), and wait past the 140 ms that separates the pair.

## One cadence for every movement was the whole problem (v307)

*"It is clocked at the same pace for all exercises and many exercises require
more than the same pace — squats, push-ups, V-ups and crawls are compound
movements and therefore take more time."*

Measured: of **124** rep-based movements, **121 paced at exactly 3.0 s** and the
other three at 2.0 s. A Turkish get-up and a crunch were the same rep. Two
separate faults sat behind that.

**The athlete's own Rep cadence setting never reached the player.**
`plEnterWork()` passed `PLAYER.tempo`, and nothing in this file has ever
*assigned* `PLAYER.tempo` — so `tempo||3` collapsed to 3 for everybody, forever.
That is `voicePitch` again: a control that stores a value nothing reads. Worse,
`plBudgetMin()` and `sessionStats()` DID read the setting, so the session clock
was priced against a cadence the pacing ignored.

**And a dial cannot express a sequence.** A get-up is not a slow rep, it is five
positions; a man-maker is a burpee plus two rows plus a clean plus a press.
`repSec` on the exercise is a **floor the dial cannot undercut** — a fast cadence
is a preference about tempo lifts, not permission to do a get-up in three
seconds. 31 movements declare one; the spread is now 2 / 3 / 4 / 4.5 / 5 / 8 / 22
seconds instead of two values.

A declared movement also counts at its **midpoint** rather than the 3:1 eccentric
split a tempo lift uses — at 22 s a get-up would otherwise be called at second 16
and then stand in silence.

**The floor that makes it honest: an ordinary controlled rep is unchanged at 3 s.**
A mutant that simply slowed everything down (`dial=6`) satisfies every
"compound movements are slower" assertion and fails that one.

**Two edits nearly went in on a bad anchor.** `pistol:{` matches in `EX` *and* in
the progression-target map at the same indentation — the same pistol/boxpistol
family this file already documents. The patch script's `assert count==1` turned
it into a clean no-op instead of a half-applied edit, and the fix was to require
`region:` on the line. And a comment naming the dead field failed a check that
scans that function's source for it: **reword the prose, never weaken the check.**

Twenty mutants across the seven fixes, all caught.

## The same defect on the surfaces the last round did not touch (v308)

A sweep for more of what v307 had just fixed, run by scanning for the SHAPE of
each defect rather than by using the app again. Four more, and the first is the
one the athlete had already asked for.

**`if(!motivate(...))X` makes the hype line REPLACE X**, and `motivate()` returns
true whenever voice and hype are on — which is the default. v307 fixed that for
the rep count in `plTickRep()`. It was still live in two places:

- **HIIT never named the exercise.** Measured over 12 rounds: the movement was
  named **0 times out of 12**. The athlete had asked, one round earlier, for the
  exercise to be announced before it starts; the guided player was fixed and its
  interval twin was not.
- **The standalone rep-cadence timer dropped the halfway count** — `plTickRep()`'s
  twin, with the identical defect, one function away.

Both now put the information FIRST in one utterance with the coaching after it,
the same call v307 made: the next line's `synth.cancel()` can only clip the
flavour.

**The baseline battery spoke a digit over its own announcement on EVERY second.**
Every other countdown in the app guards its spoken digits with `<=3`; this one
had no guard at all, so `'Get ready.'` was cancelled a second later and again
and again. The beeps already mark those seconds. And while it was there, the
battery now names the test it is about to measure — the announcement is kept
**synchronous** on purpose, because v291 keys the battery's coach off `_bt` being
non-null and a deferred utterance is one more place that ordering could drift.

**A failing check with no detail crashed the reporter.** `JSON.stringify(undefined)`
returns `undefined`, not a string, so `.slice()` threw and the run was reported as
*"the test file itself threw"* rather than naming the check. Two of six mutants
were caught that way — still red, but you could not see which check caught them.
`t.finish()` now prints `(no detail)`. The lesson is the same one this file
already records about a throw hiding which property broke: **red is not enough,
it has to say what.**

Six mutants, all caught. Two floors carry the weight: HIIT must still coach
after the name (an over-eager fix that deleted the hype passes every "is it
named?" assertion), and the hype must not come first (which satisfies "both
are spoken" while putting the information back where a cancel eats it).

## Blaming safety for a limit safety did not set (v309)

*"This is predicting I reach 165 lb by January 2028 — isn't it possible to do
this in 6 months, since that is one of the questions when setting up your
goals?"*

Yes, and the app said otherwise in a sentence that was simply false:

> Your 24-week target needs a faster pace than is safe — this is the quickest
> healthy route.

25 lb in 24 weeks is **~1.0 lb/week — 0.55% of bodyweight**, and
`projectionHTML()`'s OWN safety cap (`byRate = kg*0.01`) allows **1.9 lb/week**.
Safety was never the binding constraint. What bound was `byDeficit`: the
athlete's calorie target sat about **170 kcal below maintenance**, which
supports 0.34 lb/week — so the date slid from June to **January 2028**.

Three caps compete and the code kept only the winner's VALUE, never its
identity. `projBind` now records which one bound, and the note says so. This is
the v289 lesson again in a new place: **the app had everything it needed to name
the real reason and printed a different one**, leaving the athlete nothing to
act on. The new copy names the deficit it actually has, states that the pace
they want IS safe, and gives the number to change.

**The floor that keeps it honest: a pace that really is unsafe must still say
so.** An 8-week target needs 3.1 lb/week, and that sentence is correct there —
so safety is tested FIRST, and a check pins the crash-diet case. A fix that
deleted the safety wording passes every assertion about the reported case.

**And the calories it would take may themselves be unsafe.** If the required
deficit would put the athlete below `kcalTargetPreview()`'s floor, the note says
that instead of offering a target the app would refuse to prescribe — the same
rule the setter already follows. `floor` and `bmr` are now returned from that
function so the projection can tell the two failures apart.

### A weight-stable goal is not an under-prescribed cut

`recomp` and `maintain` sit AT maintenance by design (v298), so the deficit is
~0 and the arithmetic produced **"4158 wk" and a date in the year 2106** — which
reads as broken, not deliberate. Worse, the new explanation would have told a
recomp athlete to *eat less*, contradicting the goal they deliberately chose.

A stable goal now projects **no date at all** and says why: the aim is to change
shape while the scale holds, and the physique pictures are the measure. The
switch to Fat loss is offered, never prescribed.

**One week of `Math.ceil` rounding is not a missed date.** An exact 24-week plan
lands on 25 and complained about itself; the tolerance is `tlw+1`, because a
line that cries wolf is a line the athlete learns to skip.

Seven mutants, all caught. The two that matter are the over-eager pair: never
saying "unsafe" fails the 8-week crash target, and treating a stable goal as a
cut fails the recomp checks.

## The timeframe was a label, not a plan (v310)

*"You should be able to dynamically adjust macros, goals, exercise among
everything based on those questions of whether you're doing a 12 week program,
6 months or a 1 year program."*

`profile.timelineWeeks` — "~12 weeks / ~6 months / ~1 year" in the quiz — had
**exactly one consumer in the whole app**: the projection chart. It never
reached the calorie target, the protein target, the conditioning volume or the
step goal. Two athletes who picked opposite ends of that question were
prescribed **byte-identical nutrition and byte-identical training**, and the
projection then told the one in a hurry that their own date was unsafe — because
nothing had been adjusted to make it.

That is `voicePitch` and `PLAYER.tempo` for the third time: a control the
athlete sets that almost nothing reads. Its label, *"sets your projection
pace"*, was honest about the code and wrong about the product.

Measured at 190 lb → 165 lb, 27% body fat, goal *lose*:

| timeframe | kcal | protein | steps | conditioning | cardio volume |
|---|---|---|---|---|---|
| 12 weeks | 1890 | 175 g | 12,000 | high | 9,526 |
| 6 months | 1970 | 175 g | 12,000 | high | 9,526 |
| 1 year | 2250 | 150 g | 10,000 | moderate | 8,284 |
| none | 1990 | 150 g | 10,000 | moderate | 8,284 |

**The timeframe REPLACES the goal's stock deficit rather than adding to it, and
it moves in both directions on purpose.** A year means a gentler cut, not the
same cut with a longer chart. The goal still decides protein tier, rep ranges
and whether there is a deficit at all.

Three rules outrank it, and each has its own check:

- **Never faster than 1% of bodyweight a week** — the same cap the projection
  uses, so the two can never disagree about what is possible.
- **Never below the calorie floor.** At 12 weeks the floor is what binds, and
  the projection then says so honestly instead of pretending the date is met.
- **Never at all on a weight-stable goal.** recomp and maintain eat at
  maintenance BY DESIGN (v298); a date does not change that.

**Protein follows the cut the athlete is actually on, not the word they picked.**
A 12-week timeline on a *lose* goal runs a deeper deficit than *shred* does by
default, so it earns the same protection — and v299's warning applies directly:
the lean-mass ceiling decides for most bodies, so the ceiling moves with the
multiplier or the change does nothing at all.

**Conditioning moves ONE notch, and never from 'low'.** Cardio volume is the one
training lever that can safely carry a deadline — strength progression is
already auto-regulated by `adapt()` and readiness, and forcing it is how people
get hurt. *"Just starting"* is a statement about what this body can take right
now, and a date does not change that: the same call `safeSwap()` makes about a
flagged joint. Measured, the beginner's program stays at 6,953 against 9,526.

### The escaped mutant: a cap the floor was hiding

Deleting the 1%/week safety cap **escaped every check**, because at an ordinary
activity level the calorie floor bites first — so removing the cap changed
nothing anyone could see. The floor is `BMR x 1.1` and TDEE is `BMR x activity`,
so the headroom is `BMR x (activity − 1.1)`: at 1.45 that is ~600 kcal against a
946 kcal safe deficit, and the floor always wins. The cap only becomes the
binding limit on a **very active** athlete. The check now sets activity to 1.75
and pins two guards first — that the raw pace really is above the cap, and that
the floor is *not* what is binding — before asserting the capped number.

**A guard that cannot fire in the case you tested is not tested.** Same family
as v289's BMI edges and v293's size guard reached only after a miss-count.

### Two things the change broke in its own checks, both real

The v309 projection checks were written against the OLD behaviour, where a
timeline could not reach the calorie target. Picking 24 weeks now lands on 24
weeks — so the under-prescribed explanation had to be re-aimed at the state
where it can still arise: an athlete who has **hand-set** their calories
shallower than their own date needs.

And **a flat one-week rounding tolerance was too tight for a long plan.** The
calorie target is rounded to the nearest 10, which on a 60-week plan costs two
weeks before anything has gone wrong — so a correctly-paced year-long plan
complained about itself. The slack now scales at 5%.

Eight mutants, all caught.

## A thing you DO, filed under what you EAT (v311)

*"Why is this section under fuel, since this is part of the workout I should be
doing? It is not intuitive."*

The Movement block — a step target, a jumping-jack make-up, a bike, a ruck and a
guided timer — sat on the **Fuel** tab. It was put there for a real reason:
movement earns calorie room on the surplus (v220), so the number feeds the food
budget. But that is where the number GOES, not what the athlete DOES, and the
tab an athlete reaches for is the one that matches the verb.

Split by verb, and the split is what makes it work:

| where | what |
|---|---|
| **Today ▸ Workout** | every control — steps, mode, intensity, the timer |
| **Progress** | `todayActivityHTML()` — the day reviewed, no controls |
| Fuel | nothing new; its food card already prices the earned calories |

**AFTER the session button, not before it.** Above it would read as something
you must finish before the session counts as done, and it is separate work with
its own target.

**Twelve controls hardcoded `renderFuel()`**, which is exactly how a block
becomes welded to the tab it was first written for. They repaint through
`repaintMovement()` now — one place, three views, and moving it again is one
edit rather than a hunt.

**The review holds no controls, so there is nothing to drift.** That is the
whole reason the second surface is safe: Progress reads the same
`movement()`/`jackWork()`/`bikeRide()`/`ruckWork()` functions and offers one
button, which navigates. A mutant that mounts the real block on Progress as
well is caught by a check asserting the review has no inputs of its own.

### The empty-state hint matched the check looking for the rows

*"With nothing logged, nothing is listed"* searched the page for
`Jumping jacks` — and the empty-state hint says *"Jumping jacks, the bike, a
ruck and quick workouts all show up here once you log them."* The guard failed
on correct code.

The fix is the one this file already prescribes for `SAFE_SWAP` comments and for
`document.body.innerHTML` containing the app's own source: **ask whether the
ROW exists, not whether the word appears.** Each row now carries
`data-act="jacks"`, and the check queries the element.

Nine mutants, all caught. The two that matter are the placement pair: putting
the block back on Fuel fails thirteen checks, and mounting it on BOTH fails the
one that says the review has no controls.

## A repair that names a value by hand goes stale when the set grows (v312)

A full re-audit — every previous probe re-run against the six versions shipped
that day, plus new ones. The suite was green and the validator clean throughout.
**Three real bugs, and two of them were the same mistake in two places.**

### The markers that vanished when the app closed

`normalizeState()`'s food repair rebuilds each row from a hand-written field
list. It predates `calc` (v304 — this macro was worked out, not read) and `src`
(v306 — this row is a tracker's running total), so **both were erased on every
boot**.

Measured end to end: log a dashboard import, close the app, reopen, import the
day's new total — `prevShotIdx()` found nothing, no warning appeared, and the
rows stacked to **3,035 kcal on a day 1,800 was eaten.** v306's whole fix worked
only until the app was closed, which is every real day.

### The cardio mode that could not be kept

```js
if(STATE.nutrition.cardioMode!=='bike' && ...!=null)
  STATE.nutrition.cardioMode='jacks';
```

Written when jacks and the bike were the only two modes. v294 added rucking to
`CARDIO_MODES` and never came back here, so **'ruck' was rewritten to 'jacks' on
every boot** — tap Ruck, close the app, reopen, and the choice is gone. It never
survived a backup either, because the repair runs on the way in.

**Both are one class: a repair that names its legal values, or its legal
FIELDS, by hand.** The legal set already lived in one place; the repair just was
not asking it. A scan of `normalizeState()` found exactly one other
hand-written-value repair (`profile.unit`, a genuine two-value set) and no other
hand-written field list.

### And truthiness where membership belongs, again

`if(!STATE.profile.conditioning)` caught `''` and `null` and nothing else, so an
array or an object from a hand-edited backup walked through and then travelled
in every backup after it — the harm v285 measured. `timelineWeeks` and
`goalWeightLb` had no shape repair at all. Nothing crashed; the cost is entirely
in what a backup carries.

### The validator must not mutate

Both drift guards were written into `validateData()` first, and both had to call
`normalizeState()` to drive the real repair. That **cleared `dietRepaired`** —
a flag other code owns — and nine checks in suite 20 went red. `validateData()`
runs at boot on the athlete's own device: it READS, it does not repair.

The guards moved to the suites (05-state, 07-movement), which is where a
mutation test can prove they actually fail. Nine mutants, all caught.

## Progress gets sub-tabs, because a seventh bottom tab does not fit (v312)

*"This should have its own tab, I think"* — about Achievements, which sat at the
bottom of a very long scroll.

**Measured before choosing:** a seventh bottom tab would be **59px wide at
412px** (46px at 320px) and the word *Achievements* needs **71px**. It does not
fit at any phone width without renaming it.

So Progress carries its own strip — Summary · Body · Strength · Awards — the
pattern Today already uses for Brief / Warm-up / Workout / Cool-down. Each pane
shows only its own sections, which is what makes it a split rather than a
scroll, and `progressTab()` is a membership test because the value reaches
`innerHTML`.

**Three suites broke, and every one was a check that had gone looking on the
whole tab**: the strength-trend chips (01), the Re-test button (09) and the
photo inputs (19). Each now selects its pane. Suite 19's ordering check was
re-aimed rather than patched: *"photos come before the strength test"* became
*"the strength test is on its own pane"*, which is the stronger statement.

## The pointer the ENGINE uses is not the one TODAY should show (v313)

*"Today's tab is currently showing me a workout for tomorrow even though today
I have completed the workout already. Nowhere under the Today tab am I seeing
that I have completed today's workout."*

Two defects, and the second is the one that made the first invisible.

**`STATE.progressPtr` is a QUEUE position, and it advances the moment a session
is committed.** That is correct for the engine — the program is consumed in
order, not by date. But `todayWorkoutHTML()` read it directly, so the instant
the athlete finished, Today rendered the NEXT session under the word TODAY,
with a Start button and a **Mark Session Complete** button. That is not merely
silent: it is how you accidentally burn the next session.

`todayPtr()` is now Today's own pointer. It stays on the session that BELONGS
to today — the one just finished, while it was finished today — and the queue
pointer is untouched. **The fix is entirely in what is rendered.** Gating the
queue on a date would trade a display bug for a data-model bug, and this repo
already learned that lesson the hard way when `restartProgram()` reset a
pointer that keys a map.

**And the one acknowledgement that existed could not fire on its own.**
`doneForTodayHTML()` was gated on `minimumDayMet()` — `trainedToday() && two
HABIT ticks` from protein / water / sleep / steps. **Two different facts had one
banner**, so finishing the session did not earn the line saying you had
finished it. The habits are a day floor; the session is the session. The done
card now fires on the log alone, and `minimumDayMet()` keeps only the job it
was written for.

**A finished session is not an offer.** Once today's is done the exercise list
and the completion button are replaced by the RECORD of it, and the next
session appears last, labelled `Next session · not today's`, with a priced
confirm behind *"Train again anyway"*. The queue genuinely permits a second
session and hiding it would cost the honest cases more than it saves — what is
not permitted is dressing it as the day's prescribed work.

**A pain stop is never congratulated.** `commitSession()` records
`stoppedForPain` and NOT done, so the card says so, claims no completion, and
states out loud that the program moved on — because that surprise is exactly
what produced this report.

**The done state is DERIVED, never a flag** (`log.completedAt === todayISO()`),
so a re-render, a tab switch, a reload and midnight all land on the right
screen with nothing scheduled.

### The check had to walk into two traps this file already names

`seedAthlete` starts at pointer 0, which IS day zero of a week — so the block
runs from a **mid-week** pointer. And ticking any habit would hide the mutant
that restores the `minimumDayMet()` gate, so it ticks **none**. Both are
asserted as guards before anything else, because a block that silently lost
either would pass on nothing.

Nine mutants, all caught. The floors carry the weight: an untrained day must
still show a live, startable session, and the next session must stay reachable.

### And a v311 regression the review found

v311 moved the Movement block from Fuel to Today ▸ Workout and left **two
sentences on Reference** pointing at *"Fuel → Movement"* — a screen that no
longer exists. The athlete follows the instruction and hits a dead end. A
check was pinning the old destination too, so the suite was holding the
regression in place rather than catching it: it now asserts BOTH that the copy
names where Movement is and that it does not name where it is not.

**When a block moves, grep the copy for the old address.** A promise in UI text
is a specification, and a stale pointer is a broken one.

## Things live where you would go looking for them (v314)

"Look at the app from an amateur athlete's perspective and his intuitive
reasoning — where things should be. Things should not just be placed in places
just to make use of space."

Four things were in the wrong place. A fifth reported problem was not real, and
separating them was most of the work — the usual ratio for an audit written from
outside the code.

**The exercise library was inside Settings.** 138 movements, the third section
of that tab, above the settings themselves — a reference work filed under
"change my preferences". Reference is the look-it-up tab, so Reference now has
two panes (`REF_TABS`: Food, Moves), the same shape Progress got in v312.

**A block that moves behind a tab needs every route into it to name the tab.**
`openMealPlan()` did `go('ref')` and scrolled to a `#mealplan` anchor. With two
panes, landing on the tab is no longer the same as landing on the content: an
athlete who last left Reference on Moves got a library and a scroll to nothing.
That is precisely the dead end v245's own fix closed, one layer further in.
`REF_TAB='food'` before `go('ref')`, and a check drives the route rather than
reading the function.

**The five alternate-session tiles were on Program.** Weights, Special, Quick,
Recover, Rest day are choices about TODAY — "not the planned session, something
else instead" — and Program is the 54-week calendar. Nobody opens a year-long
plan looking for a five-minute substitute.

They were on Today until v246 removed them **at the athlete's request** as
clutter. That request was about POSITION, and it still holds, so they come back
BELOW the session and below Movement rather than above it — where they answer a
question the athlete has already asked instead of standing in front of the
answer. The check is therefore about ORDER, not presence: every one of the five
handlers must sit after `id="finishSession"`. A bare "the tiles are on Today"
assertion passes on exactly the layout v246 rejected.

**And the v246 comment asserting they live on Program had to be rewritten, not
left.** A comment claiming an invariant is not the invariant — this file already
records a case where the previous fix's own comment was the thing that made the
next bug survive.

### Two numbers that agree are not reassurance

Progress ▸ Summary printed **Sessions twice, the streak twice and the Core Score
twice** — once in the grid at the top, once again twenty lines below, the score
as a full ring and the streak under a second label ("Streak" / "Day streak").
Nothing was wrong with any of the figures. A reader seeing the same number in
two places with two labels does not feel doubly informed; they wonder which one
is the real one.

Each figure now has one home: the top grid is *where you are* (week, this week,
streak) plus three tappable shortcuts, the ring is the score, and a Lifetime grid
carries the totals. The prose line that restated the volume grid is gone.

**Count the rendered labels, do not name the three that were wrong.** A check
that knows about Sessions passes on the next duplicate somebody adds. It walks
every `.stat .l` and asserts none appears twice — with a floor under it for each
figure that must survive, because a de-dup that deletes satisfies every
"printed once" assertion. The mutant that dropped the Lifetime Sessions tile is
caught by that floor and by nothing else.

### The badge asked for the one habit the app had stopped asking for

Fuel counts `Daily habits · n/4` — `habitsRequired()`, the calorie habit being
deliberately optional since restriction was dropped as a streak condition.
Perfect Day counted **all five** and its description said *"All 5 daily habits"*.
So an athlete who did everything the screen says matters read **4/4 with a green
tick on the day and never unlocked it**.

The description is now a **function**, not a string, so its number comes from
`habitsRequired()` rather than being restated. Two reasons it cannot be a
template literal: `HABITS` is declared thousands of lines below `ACHIEVEMENTS`,
so evaluating one at parse time is a temporal dead zone error — the v290 `btRing`
trap — and a literal is a second copy of a number that will drift.

**Calling the resolver is not driving the route, and that escaped a mutant.**
The check read `achDesc(badge)` and stayed green with a read site reverted to
`a.desc`, which prints the function's own source onto the glass. It now renders
the Awards grid and asserts no cell contains `=>`, across **every** badge — the
resolver exists so any future badge may compute its text, and a check aimed at
Perfect Day proves nothing about the site that renders the other forty.

**The discriminating check is the one that must not fire.** A badge that unlocks
on any old day satisfies every "it unlocks on the required set" assertion, so a
day one habit short is pinned beside it — and a day one short *plus the optional
habit*, which is the exact state the old code rewarded.

### The one that was not real

*"Mid-session, Today defaults to the Brief sub-tab and the resume offer is
nowhere."* Measured on a real reload with a live `_plResume`: `TODAY_TAB` is a
script-scope `let` initialised to `'workout'`, so a relaunch lands on the
workout, and the header prints `0/5 exercises · 2/13 sets · 15%` on all four
sub-tabs. The earlier reading came from a probe that set `TODAY_TAB='brief'`
itself and then reported the value back.

Same for *"Quick is a dead end reading 'No quick workout selected'"* — that
string is reachable only from a stale `QUICK_ID`, and a reload lands on Today.

**Two lazy mutants, and reading them back is what caught it.** `hidden` on a
grid leaves every element in the DOM, so a check that counts `.stat .l` is
correct to ignore it; the real over-eager fix deletes the tile, and re-seeding it
that way was caught immediately. Eleven mutants, all caught after those two
rewrites.

## When a block moves, its copy does not (v315)

v313 fixed two sentences on Reference still pointing at "Fuel → Movement". That
was one instance. A sweep of every tab name in user-facing copy found **four
more**, and two of them the coach READS ALOUD every morning — which is the worst
version of this, because an athlete cannot double-check a spoken address by
looking at it.

| the copy said | where the thing actually is |
|---|---|
| *"The full recipes are in the Fuel tab"* | Reference — v245 removed the plan card from Fuel |
| *"Log your weight in the Fuel tab"* | Progress — Fuel has **no** weight control at all |
| *"already on your live total in Fuel above"* | a tab away — v311 moved that block to Today |
| *"Open the Progress tab and pick a goal weight"* | nowhere: no such control existed |

**Each is asserted BOTH ways**: the copy names the tab, and the destination
really has the thing. Checking only the wording passes on a sentence naming a
tab for a feature that was deleted; checking only the feature passes while the
sentence still points elsewhere. That is exactly how the v311 regression
survived — a check was pinning the OLD address.

### The goal weight had no setter outside the setup wizard

`profile.goalWeightLb` is what `projTargetKg()` and `timelineRateKgWk()` are
built on, and what the coach reads out every morning. To change it the athlete
had to reopen the profile quiz and walk its steps, for one number, on a screen
that is not the one with the weight chart on it. Two sentences in the brief
already told them to set it on Progress. **A promise in UI text is a
specification**, and this one had no code behind it at all.

`setGoalWeight()` now sits on Progress ▸ Body beside the chart, with the same
`plausibleKg()` clamp every other writer uses — it shipped once as the only
writer without one, and a fat-fingered value here sets the pace for a year.

**A hand-set goal outranks the derived one, and that needs an explicit delete.**
`recomputeTargetWeight()` writes `goalWeightLb` FROM `goalBodyFat`, so leaving
the body-fat target in place would let the next body-level tap silently
overwrite the athlete's own answer. Same call as a hand-set protein target
beating the calculation. The check proves it by calling
`recomputeTargetWeight()` after the save and asserting the number survives.

### Two escaped mutants, both the traps this file already names

- **A page-wide search matched the WAIST goal's own "to go"**, so deleting the
  weight goal's gap text passed. `[data-goalwt="set"]` scopes it to the row that
  changed. Same shape as the v267 warning icon that existed in two places and
  was asserted in one.
- **In imperial the unit conversion is its own inverse** — 165 lb typed, 165 lb
  stored — so a mutant that ignored the unit entirely was *equivalent* there.
  Only a metric case tells them apart: 75 kg must store as 165. **Exercise both
  mechanisms, or the check passes on half the code.**

### And the harness had been calling the app booted while a splash covered it

CI went red on one check with `hit: "sgrad"` — the splash's own gradient
element, named in the failure detail. `.splash` is a full-screen `z-index:400`
overlay dismissed 850 ms after the first draw; `waitForBoot` resolved on a
rendered view at about **626 ms**. Measured at the moment it handed back:
`splashExists:true, hidden:false`.

So **every check that hit-tests, clicks or screenshots was racing a timer it did
not know about.** Nothing that reads TEXT could tell, which is why it survived —
and an unrelated change shifting the timing by a few milliseconds was enough to
lose the race about one run in three.

**Re-running proves nothing about a load-dependent race** (0 of 8 red on one
attempt, 1 of 3 on another). Demonstrated deterministically instead: with the
splash present the lift input hit-tests as `sgrad` and reads unreachable; with
it dismissed the same code hits `lf-l-0` and reads reachable.

Fixed in `waitForBoot`, not in the one check that noticed — the overlay covers
every view, so a fix in one check leaves the class alive.

**The first pin was worthless and a mutant proved it.** It sat where the failure
happened, four seconds in, by which time the splash is gone whatever
`waitForBoot` does — so the mutant deleting the wait walked straight through. It
now measures the contract on a fresh page at the moment boot resolves. And the
rendered-view condition is kept as intent with **no check able to catch its
removal**: boot schedules `hideSplash` on the line after `render()`, so a hidden
splash already implies a drawn app. An equivalent mutant, recorded as one.

## The flag said WHEN, and the question was WHICH (v316)

An audit of the three versions shipped that day. Two mechanical sweeps came
back empty — **275 handler names in the source, none dead**, and **139 element
ids read, none missing** — and the real finding came from driving state across
a boundary instead.

`_trainAgain` records "today's session is done; show me the next one anyway".
v313 stored it as a bare **date string**, and a date cannot say whether the
session the athlete was looking at is still the one behind the pointer. Two
functions move that pointer and neither cleared the flag:

- **`undoSession()`** rewinds it. Undo a session and re-do it the same day, and
  Today showed the NEXT one under the word TODAY with a **Mark Session
  Complete** button on it — the v313 defect exactly, which is how you burn the
  next session by accident.
- **`restartProgram()`** resets it to 0 and archives the run.

**Nulling it in each writer works until the next writer forgets**, and that is
this repo's most-repeated shape. It stamps the pointer it was granted from
instead — `{date, from}` — so any pointer move voids the request with no writer
involved. Same fix as `_planStamp`, one subsystem over.

**A stamp cannot cover the undo, and finding that out cost a red suite.**
Re-doing the session puts the pointer back to the *same value*, so the stamp
matches again and resurrects a request made about a completion the athlete
erased. Un-logging is an explicit "that did not happen" — the one signal a
stamp cannot infer — so `undoSession()` deletes the flag outright.

**The legacy shape has to fail closed.** Every phone is carrying a v313 date
string right now. `trainAgainAsked()` accepts only the object, so a string reads
as no request — at worst one extra tap of a button still on screen, and the
screen it lands on is the session actually finished.

### The mutant that proved a guard was doing nothing

With undo and restart both *deleting* the flag, nothing exercised the stamp
comparison at all: a mutant that stored `from` and never read it walked
straight through. The case only the stamp can catch is **train again, then
really train again** — the request was about the first completion, and a
date-only test says yes forever, offering a THIRD session with a Complete
button. That check now exists, and it is the only thing that catches the mutant.

### `restartProgram()` was the one reset that never asked the list

`TRANSIENT_KEYS` already names every key describing a live session; the export
and the import both ask it. This function reset `logs`, `baseline`, `reassess`,
`weekFeel` and `swaps` by hand and asked nothing — so a `_plResume` left
pointing at slot 0 matched the NEW block's slot 0 and offered to resume a
session out of the run that had just been archived.

The floor beside it: a restart **archives** the run, it does not delete it. An
over-eager clear that also dropped `STATE.runs` satisfies every "the scratch is
gone" assertion and breaks the confirm's own promise that history stays saved.

### A block that destroys shared state has to put it back

`restartProgram()` nulls the baseline, so the three checks after this new block
rendered the assessment gate instead of a workout and failed on correct code.
"Each block builds the state it asserts on" has a second half nobody had needed
until now: a block that *breaks* what the others rely on re-seeds before it ends.

### Four false alarms, three of them on the same surface

The usual ratio, and every one is a trap this file already names:

- **"Set 2 never announces the exercise."** The name belongs to
  `plEnterReady()`, and the probe called `plEnterWork()` directly. Driven
  properly, the movement is named before every set.
- **"The first announcement is spoken twice."** `openPlayer()` already calls
  `plEnterReady(true)`; the probe called it again. Once, in the real path.
- **"Today shows a live session one before the end of the program."** A
  300-character slice cut off the done card, and a stale flag from an earlier
  block was still set.
- **"Four dead handlers."** `Math.round`, `.trim()`, `.toFixed()`, `.click()` —
  method calls, not functions.

## One countdown was fixed and its four siblings were not (v317)

v302 settled the rule — **the beeps ARE the countdown, and a voice on top of
them is not a second opinion, it is an interruption** — and v307 applied it to
the guided player's own get-ready. An audit found it had reached exactly one of
**five** get-ready countdowns:

| surface | announces | then spoke |
|---|---|---|
| guided player (`plTickReady`) | the movement and the target | *(fixed v307)* |
| HIIT lead-in (`ivTickLead`) | the round | 3, 2, 1 |
| hold / rest timer | *"Get ready."* / *"Rest. 45 seconds."* | 3, 2, 1 |
| rep cadence | *"Guided set. 13 reps. Get ready."* | 3, 2, 1 |
| warm-up / cool-down flow | *"Warm-up. Get ready."* | 3, 2, 1 |

**Measured rather than argued.** On the rep cadence the announcement is spoken
at 47 ms and needs until 2,355 ms; the spoken *"3"* lands at **2,047 ms**, and
`_deviceSpeak()` cancels — so the last **308 ms**, the word *"ready"*, never
played. The athlete hears *"Guided set. Thirteen reps. Get—"* then *"three,
two, one."*

The flow is the sharpest case: its **transition** phase carries a comment
explaining this exact rule, three lines below the `ready` branch that still had
the defect. Same function.

### A check was pinning the old behaviour, again

`t.eq('and the transition speaks no digits at all', flow.spokenDigits, 3)` —
the label says *no digits* and the assertion demands **three**, under a comment
claiming *"the 5-4-3-2-1 at the very start of the flow keeps its digits:
nothing competes there."* The disagreement between the label and the number is
how it survived, and the comment's claim is the thing that was measured false.

That is the third time this session: a check holding a defect in place rather
than catching it (v313's `Fuel → Movement` pointer, v314's tiles-on-Program,
this). **When a rule changes, grep the suite for checks that assert the old
one.**

### Both halves, or the fix is a mute button

Deleting the beeps as well satisfies every "no spoken digits" assertion and
leaves a silent countdown. Each surface is pinned twice — no digits AND every
second still cued — and a sixth check sweeps the whole source so a future
get-ready written in the old shape fails here rather than reaching a phone.
Six mutants, all caught, including the two over-eager ones (beeps deleted, and
the announcement itself deleted).

## The no-press rule holds, and the crop is the real work (v317)

The Cossack Squat came back **correct on the first attempt** — one man, no
jump, the straight leg genuinely straight with the toes up, both heels down,
chest tall. That is the third datapoint for the rule v305 established:

| movement | press inside it? | attempts |
|---|---|---|
| 8-count push-up | yes, mandatory | 3, never rendered |
| squat thrust | no | correct |
| inchworm walkout | no | correct first time |
| **Cossack squat** | **no** | **correct first time** |

**Before writing a video prompt, ask whether the movement contains a press.**
Nothing else has predicted the outcome as reliably.

Two things the prompt got right and should be kept: *"one man, alone"* as the
FIRST line (position beats emphasis), and the movement spelled out as numbered
MECHANICS rather than named — naming it invites the model to retrieve the
pattern as one unit, which is exactly how the 8-count failed.

### What still has to be fixed by hand, every time

The generation was clean and the FILE was not. Two faults, both at the right
edge, and neither visible until a frame is read at full resolution:

- the generator's **sparkle watermark**, bottom right;
- a **rope hanging in the studio**, top right — background clutter no prompt
  line had excluded.

`crop=720:720:280:0` removed both, then `scale=640:640,fps=24`, audio dropped.
The prompt now carries *"nothing hanging or visible in the background — an
empty grey wall only"*, but **expect to crop regardless**: the watermark has
appeared on every generation so far and asking for its absence has never once
worked.

**Read frames at full resolution before accepting a clip.** A contact sheet is
enough to judge the MOVEMENT and useless for judging the FILE — at tile size
both faults are a few grey pixels.

### And the patch script's assert earned its keep again

The first attempt anchored on `cossack:{name:'Cossack Squat'`, and the real
line is `cossack:{repSec:4,name:…` — v307 added the cadence field in front of
the name. The `assert count==1` turned a bad anchor into a clean no-op instead
of a half-applied edit, which is the whole reason that rule exists.

## A bulk is not an under-prescribed cut either (v318)

An audit of the numbers rather than the screens — the class of defect that
produces a defensible-looking figure and never throws, which is where this
app's worst bugs have lived.

Two sweeps came back clean and are worth recording as coverage: **all 378
sessions build** (97 distinct movements, 16-37 minutes, no target over its own
`repCap`, no bad unit, every one with a warm-up), and **60 nutrition
combinations** — five goals x four timelines x three body sizes — hold every
invariant: no target below the safety floor beyond rounding, no bulk running a
deficit, no cut running a surplus, protein always inside 1.2-3.2 g/kg, and the
pace never above the 1%/week cap.

The third sweep found it. `projWhyHTML()` is written entirely in the language
of a CUT, and every branch of it was reaching a bulking athlete:

| what the athlete set | what the line under the chart said |
|---|---|
| Gain, no timeline | *"A realistic pace at a moderate **deficit**."* |
| Gain, 24-week timeline | *"**Paced to the ~24-week timeline** you picked."* |

Measured on 190 lb bulking toward 205 lb: the target is **2,740** against a
TDEE of **2,490** — a 250 kcal **surplus** — described as a deficit.

**v298 fixed exactly this for recomp and maintain** by giving weight-stable
goals their own answer. `gain` was left reading the cut's copy. That is the
"fixing one instance is not fixing the class" shape again, and the fix that
introduced `STABLE_GOALS` is the one that should have caught it.

**And the timeline claim was false on that goal.** `timelineRateKgWk()` returns
null for `gain` on purpose (v310), so nothing is paced by it — the target is
2,740 at 12 weeks, at 24 and at 52. The sentence appeared only because the
projected weeks happened to land near the number the athlete picked, which is a
coincidence of the rate cap rather than a prescription. The check pins that
directly: the guard asserts `timelineDeficit()` is null and the 24- and 52-week
targets are identical, *then* asserts the copy does not claim otherwise.

### The two settings can disagree, and nothing noticed

The goal weight decides which way the CHART points. The Fuel goal decides which
way the FOOD points. Set Gain and leave a goal weight below your current weight
— one tap apart in the quiz, and easy to leave behind after changing your mind
— and the chart projected **down** at 1.3 lb/wk while the target prescribed a
**surplus**, each perfectly confident and neither aware of the other.

Name the contradiction rather than drawing a line through it: the app has both
numbers and can say which one to change. Same call as v289's unit mix-up and
v309's binding cap — a confident wrong answer leaves the athlete nothing to act
on.

Five mutants, all caught. The two that matter are the over-eager pair: making
EVERY goal read as a surplus, and letting the contradiction check swallow the
ordinary cut. Both satisfy every assertion about bulking and fail the floor
that a real cut is unchanged — which is the goal most athletes are actually on.

## The no-press rule was not the whole rule (v319)

The Windmill came back wrong and the Kneeling Ab Rollout came back right, and
the pair together corrects the video guidance.

**The Windmill contains no press, and it still failed.** What came back was a
**Cossack squat** under an overhead bell — one leg extended, the other in a
deep squat, chest dropping between them — with the bell lowered to the rack at
seconds 7 and 9. The overhead arm bending is the one thing the prompt named as
critical, in capitals. He also looked at the floor rather than up at the bell,
which is the app's own first cue.

So the model substituted **the movement it had rendered one request earlier**.

The rule from v305 said to ask whether a movement contains a press. That is
necessary and not sufficient. The better question is: **does a more common
movement sit next door?** A windmill's neighbour — a deep lateral squat under
an overhead load — is far better represented than the windmill itself, so that
is what was retrieved.

| movement | press inside? | close common neighbour? | result |
|---|---|---|---|
| Cossack squat | no | no | correct, first time |
| Inchworm walkout | no | no | correct, first time |
| Squat thrust | no | no | correct |
| 8-count push-up | **yes** | burpee | 3 failures |
| Kettlebell windmill | no | **Cossack squat** | failed |
| **Kneeling ab rollout** | **no** | **none** | **correct, first time** |

The ab rollout is the cleanest datapoint for the fix: the wheel is
**unmistakable equipment** and nothing else in the world is kneeling and
rolling one, so there is no neighbour to retrieve. Twenty frames read at full
resolution — arms straight in every one, back flat, knees on the mat, two
complete cycles.

**Describe the equipment PHYSICALLY, not by name.** "A single small rubber
wheel with a straight metal handle passing through its centre" is the same
discipline that established the athlete's 9.6-inch push-up bars are not a dip
station. And name the substitution you fear: *"he does not do a push-up"*
belongs in any prompt where a press could plausibly be grafted in.

**The watermark and the studio clutter are now four for four.** Every clip has
carried the generator's sparkle bottom-right, and three have carried a rope
hanging top-right — including this one, despite the prompt gaining an explicit
"nothing hanging in the background, an empty grey wall only". Asking has never
once worked. Locate them rather than guessing: scanning for the rope's dark
column put it at x=1014, which is what set `crop=720:720:280:0` instead of a
centred crop that would have kept it.

## A change of RULER is not a change of strength (v320)

`safeSwap()` protects a flagged joint during the baseline battery — correctly,
and v251 added it for exactly that reason. What nothing recorded is that the
number coming back then measures a **different exercise**.

Seven swaps are reachable in the battery. Three of them do not preserve the
capacity the test exists to measure:

| swap | flagged | capacity |
|---|---|---|
| `invertedrow → towelrow` | shoulder | preserved |
| `burpee → squatthrust` | shoulder, knee | preserved |
| `pushup → fistpushup` | wrist | preserved |
| `revcrunch → deadbug` | lowback | preserved |
| **`jumpsquat → squat`** | knee | explosive becomes non-explosive |
| **`bicycle → deadbug`** | lowback | dynamic becomes static |
| **`burpee → march`** | wrist | maximal conditioning becomes marching |

And the notice said, of every one of them, *"this tests the same capacity
without the risk."*

**Measured end to end.** A wrist-flagged athlete records `stamina` **40** on the
substitute; six weeks later the wrist is better and real burpees give **18**.
The athlete improved and their stamina number more than halved, with nothing on
the glass to say the ruler had changed.

That is precisely what `TEST_PROTOCOL` already exists to prevent, one variable
down: a v1 and a v2 taken under different conditions are not the same
measurement, and the app should say so rather than read the gap as progress.
`subs` is now stamped on every record and both consumers ask it —
`retestDrop()`, which already made the same guard on `testCount` (*"a
like-for-like comparison only"*), and the strength trend, which withholds the
▲/▼ verdict while still plotting both real points.

**A legacy record fails closed.** Every phone is carrying a baseline with no
`subs` at all. Unknown is not equal, so `sameMovement()` returns false and the
comparison is skipped rather than trusted.

### Two collisions, and the one-joint cases are the common ones

15 of 37 realistic flag combinations land two tests on the same movement.
A **knee** alone makes `power` and `squat` both the Bodyweight Squat; a
**lowback** alone makes `lower` and `dyn` both the Dead Bug. The protocols
still differ (20 seconds versus open), so the numbers are not identical — but
the athlete does the same exercise twice and the second is measured tired.

### The marker that lived only in the record

`assessSeries()` builds the chart's points as `{date, maxes}` and dropped
`subs`, so on the first attempt EVERY metric read as not-comparable and the
trend withheld every verdict. Same shape as the `macroDerived` stamp
`saveFood()` used to drop in v304: **a marker that survives only in storage is
not a record.** The floor check — a test that was never substituted keeps its
verdict — is what caught it.

### And the mutant that proved four checks tested nothing

Deleting `subs:assessSubs()` from the record literal walked straight through,
because every check hand-built its records and exercised `sameMovement()` and
the trend but never the WRITER. `finishAssessment()` is what an athlete's last
tap reaches, and driving it is what catches this. Calling the helper is not
driving the route — the fifth time this file has recorded that.

Five mutants, all caught after that rewrite.

## The swap changed the RULER and the app kept prescribing from it (v321)

v320 stopped the app COMPARING two baselines taken on different movements. It
was still PRESCRIBING from one, and the comment that let it ship said so in as
many words:

> The score still saves under the test's own id (t.id), so every downstream
> anchor/maxes read is **unaffected**; only which movement earns that number
> changes.

It is affected. `prescribe()` does `maxes[anchor] * frac * ex.hardness`, and
**`hardness` is DEFINED as a fraction of the anchor test's max** — so a count
recorded on a substitute is on a different scale entirely. **A comment claiming
an invariant is not the invariant**, for the third time in this file, and this
one was written by the fix that introduced the defect.

Measured, one body, one true capacity, week 1 of block 1:

| flag | test measured on | Dead Bug | Crunch | Toe Touch |
|---|---|---|---|---|
| none | Reverse Crunch (h 1.0) | 10 | 10 | 8 |
| lowback | Dead Bug (h 1.4) | **15** | **15** | **12** |

**Flagging a joint made the app prescribe 40-50% MORE work in the flagged
region** — the one place it should have prescribed less. The shoulder case is
the same shape, +38% on the Towel Door Row that **all eight** pull movements
land on. And the pull test's own instruction warns about exactly this hazard —
*"this number scales every row and pull-up you will be given, so a back
extension like the Superman would badly over-prescribe them"* — while the app
went and substituted an easier movement itself.

`hardness` IS the conversion factor: `recorded * hardness(orig) / hardness(sub)`.

**The guard is the point, and it is what stops this being a universal
converter.** Only a substitute measuring the SAME quantity in the SAME units is
re-scaled. `dyn` (bicycle, TIME → dead bug, REPS) and `power` (jump squat →
squat) are left alone: a jump squat and a squat are **both hardness 1.0** and
are not the same measurement at all, because explosive power is a quality
`hardness` cannot express. Declining costs nothing — measured, **0 of 3
power-anchored and 0 of 1 dyn-anchored movements survive their own flag's
swap**, so neither anchor is ever read for the athlete whose test was swapped.

**The record stays RAW**, because v320 needs it raw to plot a real point and an
athlete who did 20 dead bugs did 20 dead bugs. The conversion happens on the way
to `prescribe()`, never on the way to storage. **A record with no `subs` is not
converted** — nothing is known about it, and converting would be inventing.

**The Core Score converts too, and that is not a display nicety.** `t.bench` is
calibrated for the original movement, and the score sets `level`, which scales
every UNANCHORED exercise through `LEVEL_FACTOR`. Same defect, one consumer over
— the class, not the instance.

### And a third consumer: a personal record on a movement never performed

`commitAssessment()` writes a PR for every test result, keyed on **`t.ex`** —
the test's nominal exercise, not the one performed. Measured on an athlete with
a flagged wrist and shoulder:

| performed | recorded as |
|---|---|
| 20 Fist Push-Ups | **Push-Up 20** |
| 20 Towel Door Rows | **Inverted Row 20** |
| 20 Single-Leg Dead Bugs | **Burpee 20** |

Three personal bests on three movements the athlete had not done, feeding
`strengthLevel()` and the Strength Standards rating. Same class as the anchor
and the score — **fixing one instance is not fixing the class**, and this round
found the class had three members, not one.

**The floor is what keeps the fix honest.** This block exists so the plank, side
plank, squat and dead hang can be rated at all — nothing ever prescribes them as
working sets. A fix that simply skipped substituted tests satisfies every "no
false PR" assertion and silently kills the four rows the block was written for,
so each of those is pinned beside it. Four mutants; three caught, and the fourth
(dropping the `typeof rec.subs` test) is **equivalent** — `_subs[t.id]||t.ex`
already falls back for every non-object, so no check can catch its removal. Read
the mutant back before rewriting the check.

### Two escaped mutants, and only one was a weak check

- **Dropping the ANCHOR guard escaped**, because both cases I had pinned were
  blind to it: `dyn` is still caught by the unit guard, and `power` is
  `jumpsquat(1.0) → squat(1.0)`, so the ratio is 1 and the mutant is
  *equivalent there*. The one reachable swap that can tell them apart is
  `stamina`: `burpee(0.7, time) → squatthrust(0.95, time)` — same unit,
  different anchor, ratio 0.737. A weak check, not a bad mutant.
- **Dropping the UNIT guard is unreachable on today's library.** `validateData()
  already enforces that an anchored exercise carries its anchor test's unit
  (measured: 0 mismatches across all 155), so "same anchor" implies "same unit".
  It is kept as cover for a future `EX` edit and exercised directly by flipping
  a unit in the check — the same technique the hardness-band guard uses.

**And a mutation harness that greps for `FAILED — N checks` misses a single
failure**, which prints `check` singular. Two mutants read as escapes until the
detector was rewritten to test for *"All checks passed"* instead. Same family as
the v286 mutant that broke the parse and counted as zero failures: **read the
run, not a pattern you hoped would match it.**

Eight mutants, all caught.

### The class is now swept, and the one-time step was measured, not assumed

Six places read a test result or a max. All six are accounted for:
`currentMaxes()`, `computeAssessment()`, the PR writer and
`testBreakdownHTML()` (v321); `retestDrop()` and `assessSeries()`/the strength
trend (v320). A grep for `.results[` and `.maxes` returns nothing else.

**Correcting a number creates a step in the athlete's own history, and the
honest thing is to measure it rather than hope.** A flagged athlete's stored
Core Score was computed the old way; their next one is computed the new way, so
a genuine like-for-like re-test reads as a small drop. Measured across every
flag combination, at 80% of every benchmark:

| flagged | swaps | old score | new score | step |
|---|---|---|---|---|
| lowback | lower, dyn | 80 | 78 | **3%** |
| shoulder | pull, stamina | 80 | 78 | **3%** |
| wrist | push, stamina | 80 | 80 | 0% |
| knee | power, stamina | 80 | 80 | 0% |
| all four | six tests | 80 | 76 | **5%** |

`retestDrop()` fires at **25%**, so the step cannot raise a false "was it an off
day?" prompt on anyone. Wrist and knee are unmoved because their swaps are the
two the app declines to re-scale, and `push` converts *upward* — the fist
push-up is the harder movement. Accepted and recorded rather than fixed: the
step is toward the true number, and it is an order of magnitude below the guard
that would misread it.

### The fourth consumer, and the one the athlete reads first (v321)

`testBreakdownHTML()` is the screen shown the second the battery ends. Before
this it printed, to an athlete who had just done 40 Single-Leg Dead Bugs:

> **Burpees (max reps in 60s) — 40 reps · +22 · 133% of the 30 reps benchmark ·
> past it**

Named after a movement they did not do, scored against its benchmark, and
congratulated on a **+22** whose 18 was a real burpee. That is v320's own defect,
on the most prominent surface it has, and v320 fixed `retestDrop()` and the
strength trend and never came here. **The class had four members, not one.**

**Two states were not enough, and the first attempt shipped the error.** A swap
the app can re-scale (`push`, `pull`, `lower`) gets the equivalent share and says
it is scaled. A swap it CANNOT (`stamina`, `power`, `dyn`) must get **no share at
all** — printing "133% · past it · an estimate" invents precisely the number
`anchorRescale()` just declined to compute. The rule now lives in one place and
answers both questions: the ratio when a re-scale is honest, `0` when it is not.

**A withheld delta needs a sentence, and the two reasons are different
sentences.** A silent blank where a number used to be is the same defect facing
the other way. A prior with no `subs` stamp *(every phone is carrying one)*
cannot be checked; a prior measured on a different movement genuinely is not
comparable. Saying "not comparable" to the first is wrong, and a note that fires
on a clean like-for-like re-test is a note nobody reads — so the floor pins that
an ordinary improvement still shows `+4` and carries no explanation at all.

**And a check in suite 21 failed on correct code.** It built its prior record
before `subs` existed, so the fail-closed rule withheld the delta it asserted.
The record was incomplete, not the rule — a **like-for-like prior is one that
says it substituted nothing** (`subs:{}`), which is what that block always meant.
Ten mutants across the row and the note, all caught.

## A published standard is a fact with a date on it (v322)

"I am preparing to join the army reserve" — the Canadian one, FORCE Evaluation,
three to six months out, with a 20 kg sandbag and somewhere to sprint.

**The roster search by MOVEMENT is what shaped the round.** Across 155
exercises there was no drag, no shuttle, no rush and no floor-to-shelf lift.
The nearest relatives were a suitcase carry and a bear-hug carry, and neither
asks for what these ask for. So four new movements, one per FORCE task.

**The figures are stamped with a date and the screen says whose job it is to
confirm them.** This is the honest handling of a number the app cannot check: a
published fitness standard moves — the US Army replaced the ACFT's event list
mid-2025 — and a figure shown with confidence that is a year stale is *worse*
than no figure, because the athlete trains to it. `FORCE_ASOF` is on the glass
beside the numbers, with "this app has no internet access and cannot check them
for you". Same discipline as `TEST_PROTOCOL`: state the conditions rather than
implying there are none.

**Absent is "not measured", which is not "failed".** `forceVerdict()` returns
null for an event never logged, and the row says so. A mutant that read absent
as a fail is caught by the check that all four start unmeasured.

**Warn, do not swap — and the check that proves it needed a FLAG.** These are
four named test events; substituting one leaves the athlete unprepared for the
thing they will actually be asked to do, so `startForceTrain()` builds the real
four and `forceRiskHTML()` names what is flagged. The mutant that routed them
through `safeSwap()` **escaped**, because the block ran with no limitations
set — `safeSwap` is the identity there and the mutant was equivalent. Only a
flagged athlete can tell the two behaviours apart. A weak check, not a bad
mutant, and the third time this session.

**The safety gate is the baseline battery's, for the battery's reason.** Four
maximal efforts under load is the one other place in the app that asks for a
true max, so a flagged-and-uncleared health screen is sent to the clearance
screen instead. It fails closed, and the floor pins that a cleared athlete
still gets the session.

### The gear list had drifted, and the missing entry was load-bearing

Found on the way to adding `sandbag`. The kit list existed as **two hand-written
literals** — onboarding offered 13 items, Settings offered 12 — and the missing
one was `bike`. That is not cosmetic: `bikeSwap()` substitutes the trainer into
conditioning slots off that key,
and `toggleGear()` is the only writer after setup. **Buy a trainer after
onboarding and you could never tell the app; sell one and you could never
untell it.** Picking "Bike" on the Movement card does not set it either — that
is `nutrition.cardioMode`, a different fact.

Same shape as the five-diets drift, same fix: one `GEAR_OPTS`, each picker
still rendering its own markup.

**The old check could not see it, and that is the lesson.** It counted the ruck
entry twice — asking whether ONE entry appeared in both copies, not whether the
two copies AGREED. The replacement drives the Settings picker and compares what
it offers against `GEAR_KEYS`.

### A dead-control sweep that found nothing, and six probe bugs on the way

`voicePitch`, `PLAYER.tempo` and `timelineWeeks` were all the same defect — a
control the athlete sets that almost nothing reads — so the class is worth
sweeping rather than waiting for a fourth. The method is the one this file
prescribes: **set A, fingerprint the program, set B, fingerprint again, assert
they differ.**

**Six controls flagged dead on the first pass. All six were the probe.** In
order of discovery:

- **`kcalTarget` and `buildWarmup` do not exist.** The probe called both inside
  a `try/catch`, so the calorie target and the warm-up were silently absent
  from every fingerprint — which is why `timelineWeeks`, `nutrition.activity`
  and `profile.mobility` all read as dead. The real names are
  `kcalTargetPreview()` and `mobilityFlow(jointAwareWarmup(WARMUP_FLOW))`.
- **`profile.daysPerWeek` does not exist.** The field is `profile.days`, an
  ARRAY of weekday numbers, and writing a number there made `goalSlots()` throw
  on an undefined session — a crash that looked like a real bug and was entirely
  self-inflicted.
- **`nutrition.cardioMode` is absent from `DEFAULT_STATE` on purpose**, so a
  field-existence guard flags it. Absent means "the athlete has not chosen" and
  `cardioMode()` falls back to jacks — a legitimate shape, not a missing field,
  and the distinction has to be encoded in the guard rather than argued with.
- **`cardioMode` reads on the RENDER**, not in any of the builders the
  fingerprint covered.
- **`timelineDeficit()` needs a current weight AND a goal weight below it.**
  The seeded athlete has neither, so the probe never reached the code. A guard
  that cannot fire in the case you tested is not tested — for the third time
  this session.

Given a real 86 kg athlete with a 165 lb goal, the timeline is very much alive:
**1950 kcal / 180 g at 12 weeks, 2060 / 180 at 24, 2330 / 155 at 52.**

**The fix that generalises is a guard on the probe, not on the app**: assert
every field path exists in `DEFAULT_STATE()` and every function name is a
function, and bail naming what is missing, before measuring anything. Half of
the first dead-control probe's findings were the same mistake, and writing that
down did not stop it happening again — a guard does.

### The fourth sibling path to skip the gear check, and it was mine

Also found by auditing my own change. `startForceTrain()` built its items from
raw `EX[k]` and never asked `hasGearFor()`. Measured: an athlete with no
sandbag tapping **"Train the four tasks"** was handed **all four**, three of
which they physically cannot do.

Every other path that picks a movement asks — `builderPool()`, `gearSwap()`,
`weightsPool()` — and this one did not. That is the exact shape this file
already records for `safeSwap()` being forgotten by five sibling paths, one
subsystem over: **a new path that picks an exercise has to ask every question
the old ones ask.**

**It names what is missing rather than substituting**, for the same reason the
joint case does: a bodyweight squat in place of a sandbag lift leaves the
athlete unready for the thing they will actually be asked to do. The rushes
need no kit, so a bagless athlete still gets real work.

**Two of the five mutants escaped, and both were floors I had already written
down elsewhere.** A note that always fires is a note nobody reads — nothing
asserted the kit note is ABSENT with the bag owned. And the "nothing available
at all" refusal is unreachable on today's library, because the rushes need no
kit; it is now exercised directly by giving them an `equip` inside the check,
the same technique the hardness-band and unit guards use.

### Presence is not membership, in a VALIDATOR rule this time

Found by auditing my own change, an hour after writing it. `pattern` was given
the invented values `carry` and `sprint` for the new work — and both passed
`validateData()`, because its rule is

```js
if(e.equip&&e.equip.length&&!e.pattern)errs.push(k+': has equip but no pattern — unreachable in the Weights circuit');
```

The rule's own message names the harm exactly, and it tests that a pattern
EXISTS rather than that it is one the circuit asks for. The circuit asks from
an explicit list, so **a pattern outside that list is exactly as unreachable as
no pattern at all.** Measured: `sbagshuttle` and `sbagdrag` appeared **0 times
in 400 circuits**, having satisfied every check.

That is this file's most-repeated shape — truthiness for membership, `!= null`
for absent, a range test doing a type test's job — reaching a validator rule
rather than a repair. The list is now `WEIGHTS_PATTERNS`, read by the builder
AND the validator, and the rule tests membership for every exercise rather
than only geared ones.

**Every carry already in the library is `pattern:'core'`.** Inventing a
taxonomy value when the app already has one for the job is the same mistake as
inventing a gear key: look at what the siblings do first.

**And the check for it needed the builder to READ the list, not merely for the
list to exist.** The mutant that reverted the builder to its own inline literal
walked straight through a check counting the declaration — the declaration
still stands, and the two-hand-kept-copies drift is back. Four mutants, all
caught after that rewrite.

### Three harness bugs in one session, all the same shape

- A mutation detector greping `FAILED — N checks` misses a single failure,
  which prints `check` (v321).
- **`node tests/run.mjs 01 09` runs ONE file.** Three mutants read as escapes
  because suite 09 never ran at all — the runner says "running 1 test file"
  and the loop did not read it.
- A `re.sub` rewriting the mutant table wrote a literal newline into a Python
  string and broke every subsequent seed. Loudly, which is the only reason it
  cost minutes rather than a false all-clear.

**Read the run, not the pattern you hoped would match it.**

### Two more traps this file already names, hit again

- **A comment that quotes code breaks the duplicate-key check.** Four comments
  reading `FORCE:` were counted as a duplicate key named `FORCE`. Reword the
  prose, never weaken the check.
- **Each block builds the state it asserts on.** The tile check failed because
  an earlier block in suite 09 leaves the athlete un-onboarded, so Today
  rendered the welcome screen and no tiles at all. It now sets `onboarded`,
  guards that the tile row rendered, and asserts the tile sits BELOW the
  session — a bare "it is on Today" passes on exactly the layout v246 rejected.

**Deferred, and stated rather than quietly dropped:** there is still no running
in this app — no run mode, no pace, no distance — and it is the aerobic base
every one of these standards rests on. Rucking, jacks and the bike are the
three cardio modes; a fourth is the next round, and the endurance programme
depends on it.

## Running is a dial, so it is modelled like the BIKE (v323)

The fourth way to pay the step target, and the mirror of the ruck's own
reasoning. **Under a pack the intensity is the load RELATIVE TO the athlete**,
so `ruckMET()` computes it from bodyweight. **On a run the intensity is PACE**,
which is a dial the athlete sets — so a fixed table is right here, exactly as it
is for the trainer.

**The level is defined by the EFFORT, not by the speed.** The km/h figure is
nominal and exists to turn minutes into a distance estimate. Which band an
athlete is in is decided by the talk test and the RPE in the cue, because
8 km/h is an easy jog for one person and a tempo effort for another and this app
has no run test to tell them apart. Same convention `BIKE_LEVELS` already uses.

**And the property that makes DISTANCE the right input.** Running costs about
the same per kilometre however fast you go, and the table respects that:
measured, the same 5 km prices at **412 / 410 / 400 / 378 kcal** across the four
paces — a **9% spread**. So an athlete who picks the wrong band barely moves the
number, provided they log the distance. Minutes are the one input the pace
really does change, and the card says so.

That is now a pinned invariant, with a floor under it: the MINUTES must still
differ across the four paces, or the table has no pace in it at all and the
spread is trivially zero. The mutant that flattened `intervals` to 8 km/h is
caught by exactly that pair.

**Sanity against the world, which is what stops the arithmetic drifting.** 30
minutes steady covers 4.85 km at 6:11/km and prices at 397 kcal for an 86 kg
athlete — running costs ~1 kcal per kg per km, so ~400 net is right.

**The step figure is an ENERGY equivalent, not a footfall count**, and the card
says so. At these METs it lands near 300/min against a real running cadence of
~170, so a runner seeing "9,240 steps" for half an hour would rightly distrust
it. Steps in this app have always been a calorie proxy — `MET x 35` is
calibrated so the currency and `stepKcal()` agree — and the ruck simply happened
to land on real walking cadence too. Running is where the difference becomes
visible, so it gets stated rather than hidden.

### Army running, and a standard the app refuses to invent

The FORCE Evaluation has no run in it. Running is still the aerobic base
underneath everything else a reserve athlete is being asked to do, so it sits
beside the four tasks rather than inside them: six sessions — base, long,
tempo, 6x400, the 2.4 km time trial, and a run-into-ruck brick — plus the time
trial as a measured event.

**The timed run has NO pass figure baked in, and that is a stronger position
than v322 took.** The FORCE figures are stamped with a date and a "confirm with
your unit" note because a published standard moves. For the run the honest
answer is weaker still: **the required time depends on the trade, the age band
and which test the unit uses**, none of which this app can know. So it measures
the run and lets the athlete type in the target they were actually given, and
says on screen why there is no number there. A figure invented here is one that
would be trained to.

Three consequences the checks pin:

- **A best time with NO target is still not a verdict.** Measuring is not
  passing, and the mutant that reads "no target" as "passed" is caught by it.
- **The explanation stops firing once a target is set** — a note that always
  fires is a note nobody reads.
- **Offered is not done.** `startRunSession()` sets the mode and the pace and
  hands the athlete back to Today; it logs nothing on their behalf. That is the
  completion gate's rule applied one surface over, and the mutant that
  pre-fills the minutes is caught.

### An existing check hardcoded the count, which is the defect it was written for

`t.eq('and all of them are checked', modes.survived.length, 3)` — the v312 block
that exists *because* a hand-written repair went stale when `CARDIO_MODES` grew
had a hand-written **3** in its own assertion, and a fourth mode failed it on
correct code. It now compares against `CARDIO_MODES` itself, with a floor so it
cannot pass on an empty list.

Ten mutants, all caught.

## How you eat lives on FUEL (v324)

"This is related to food, so this should be under the fuel tab." The diet
picker and the whole-foods toggle sat in **Settings**, filed under "change my
preferences" — and they are about FOOD. Fuel is the tab an athlete reaches for
when the verb is eating.

Third time this call has been made: v311 moved Movement off Fuel (it was there
because of where its NUMBER went, not what the athlete DID), v314 moved the
exercise library out of Settings. **The tab that matches the verb wins.**

It sits between **My goal** and **Today's targets**, because the diet shapes
what those targets are spent on.

**ONE repaint helper, because that is the half v311 had to fix afterwards.**
Twelve controls hardcoded `renderFuel()` and had to be hunted down when the
block moved; `setDiet()` called `renderGuide()` and `toggleWholeFood()` called
both by hand. `repaintDiet()` repaints the surface the control is ON, so moving
it again is one edit.

**A pointer, not a stale address**, and the check asserts BOTH halves — that
Settings names Fuel, and that Fuel actually holds the controls. Checking only
the wording passes on a sentence naming a tab for a feature that was deleted;
checking only the feature passes while a stale pointer sends the athlete
somewhere else. That is exactly how the v311 regression survived.

### And a check that pinned WHERE the picker was, not what the prompt is for

Suite 20: `t.ok('and so does the picker in Settings', r.settings)`. The block's
own comment says *"the prompt appears where the athlete can act on it"* — and
the assertion had hardened that into a claim about which tab the picker lived
on. It failed on correct code.

The real requirement is that the unrecognised-diet prompt sits **beside the
picker**; on a surface with no picker it is a dead end. It now asserts that,
with guards pinning where the picker actually is. Five mutants, all caught.

## A date nothing schedules against is a countdown, not a plan (v325)

`prep.date` was stored and shown as "10 weeks to go" and **nothing scheduled
against it**. That is `timelineWeeks` verbatim, one round after writing the
lesson down: a control the athlete sets that almost nothing reads.

**THE 10% RULE IS THE WHOLE POINT.** Running volume that climbs faster than
about a tenth a week is how people arrive at selection injured rather than fit,
and it is the one number a plan can get wrong without anyone noticing until it
hurts. The ramp is capped, the cap is pinned, and **the plan will take longer
rather than climb faster.**

**It starts from what the athlete is actually doing.** `trailingRunKm()` reads
their real weekly distance out of the logged days — the same "read the DATA,
not a flag" discipline the safety predicates follow. With nothing logged it
opens at a deliberately low floor **and says so**, because guessing high is the
failure that costs a tendon.

**Every fourth week is a down week**, and that is part of the plan rather than
a rest from it. A block with no down weeks ends in a deload the athlete did not
choose.

### The rule governs the CURVE, not the bounce out of a down week

Measured across eight weeks: `16.7 → 18.3 → 20.2 → 15.5 → 24.4 → …`. Week on
week that reads **+10, +10, −23, +57**, and the +57 is not a violation — it is
the return to the underlying curve, which is 10% per week compounded against
the last week that was **not** cut (20.2 × 1.1² = 24.4, exactly on the cap).

**A naive week-on-week assertion fails here on correct code**, and the obvious
way to "fix" it is to delete the down weeks — which is the opposite of what the
plan needs. So the check states the real rule: the curve is capped, a down week
is a genuine cut, and the bounce is capped against the last uncut week.

### Three escaped mutants, and every one is a lesson already in this file

- **The floor check compared the app to itself.** `t.eq(km, PREP_FLOOR_KM)`
  passes however high the floor is raised — a mutant moving it from 8 km to
  **40 km a week** walked straight through. Pin the VALUE, not the identity.
  Same shape as v299's "do not pin a floor to its siblings".
- **Setting the field is not driving the route.** The stamp that stops a
  changed test date restarting a trained block lives in `saveForceDate()`, and
  the check assigned `STATE.prep.date` by hand. It now opens the sheet and
  drives the save. Sixth time.
- **Measure the payload, not the container.** Every ramp assertion read
  `curve`, which is the number the screen EXPLAINS. A mutant that flattened
  `km` — the distance the athlete actually runs — left `curve` climbing and
  passed everything.

Ten mutants, all caught after those three rewrites.

## Distance or load, never both in the same week (v326)

v325 scheduled the running and left the rucking as a **sentence** — *"build the
distance or the load, never both"* — with nothing scheduling it. Same
countdown-not-a-plan gap `prep.date` had, one variable over.

**A ruck is carried by the same tissue that absorbs every step**, so the two
variables are raised one at a time and the screen says which one is moving.
A four-week cycle: distance, distance, LOAD with the distance held, down week.

Measured across sixteen weeks from a standing start:

```
w1  5.0km 10lb distance     w9   7.3km 20lb distance
w2  5.5km 10lb distance     w10  8.1km 20lb distance
w3  5.5km 15lb LOAD         w11  8.1km 25lb LOAD
w4  5.5km 15lb DOWN         w12  8.1km 25lb DOWN
```

**Zero weeks where both climbed.** 5 km → 9.7 km and 10 lb → 30 lb over the
block, which is the "build toward a third of bodyweight over MONTHS" rate
rather than a number arrived at.

**Both ceilings are live, and a check at one passes on half the code.** The
bodyweight ceiling (a third) binds for a lighter athlete — 55 kg gives 40 lb —
and `RUCK_LB_MAX` binds for a heavier one. With no bodyweight on file it falls
back to the plate maximum, which is the conservative direction: a fixed number
cannot be wrong about a body it does not know.

### The escaped mutant found a double writer in my own code

`down` was set inside the loop AND re-derived after it. The mutant that removed
the loop's down branch left the trailing writer setting the flag anyway — so
week 4 **climbed the distance and still rendered as a rest week**, and the check
counting flags saw nothing wrong.

Two fixes, and the code one matters more: `down` is now owned by the loop and
nowhere else, and the check asserts the DISTANCE does not climb rather than
that a flag is set. **Measure the payload, not the container** — third time this
session, and the first where the redundant writer was the actual defect rather
than the check's blind spot.

**The floors are what keep "never both" from being satisfied by nothing ever
climbing**: the distance must climb across the block, the load must climb, there
must really be load weeks and down weeks in sixteen, and the distance must HOLD
on a load week. Ten mutants, all caught.

## The timer knew two of the four cardio modes (v327)

*"Is this timer linked to the exercises here — jumping jacks, bike, rucking and
running?"* Measured: **no**. The guided timer had exactly two callers,
`openMakeupTimer('bike')` and `openMakeupTimer('jacks')`, and the ruck and run
cards had no timer button at all — so the honest answer to the question was that
two of the four modes were never wired to it.

Underneath that, three functions were `bike ? … : jacks` branches whose ELSE
swallowed **everything that was not the bike**:

```js
const isBike = mode==='bike';
… isBike ? bikeRide() : jackWork()
```

So a ruck or a run reaching that timer would have been credited as **jumping
jacks**. Measured on a 30-minute ruck at 45 lb: 154 kcal of real work read back
as 271 — a **76% over-credit**, spent straight into the food budget, because
movement earns calorie room on the surplus.

**A two-way branch is a membership test with one member.** `MAKEUP_CREDIT` is
now a table keyed by mode and `makeupCredit(mode)` reads it, falling back to
jacks only for a value `CARDIO_MODES` does not contain. That is the same shape
as `DIET_OPTS`, `GEAR_OPTS`, `CARDIO_MODES` and `WEIGHTS_PATTERNS` — the legal
set in one place, asked rather than restated — and it is the fourth time this
session that a hand-written two-value branch went stale when the set grew.

**Rucking and running get the stopwatch and NOT the work/rest block.** Jacks are
intervals and the bike has ride durations; a ruck and a run are one continuous
effort, and offering a 30-on/30-off block for them would be prescribing a
session shape neither wants. The card says so rather than leaving an empty
panel — a screen with a control missing and no sentence explaining it reads as
broken.

**The floor is what stops the fix being "give everything a stopwatch".** A
mutant that hands every mode the work/rest block satisfies every "the ruck can
be timed" assertion and is caught by the pair of checks pinning that only jacks
get the block and that the continuous efforts say why they do not.

Nine mutants, all caught. One of them first read as an escape and was a **bad
mutant** — it left an `else` with no `if`, so the page never parsed and the
suite crashed instead of reporting checks. Re-seeded as `const isJacks=true;`
it was caught by name. **Read the mutant back**, for the second time in this
file.

## The card gave two different answers to the same question (v328)

The audit that followed v327 found the identical defect one function over, and
three times in `movementHTML()`. The card answers three questions and two of
them were `bike ? … : jacks`:

| the note | what it did |
|---|---|
| "N steps to go — here is what closes it" | the ELSE told a **ruck or run** athlete to do jumping jacks |
| "Target met. X carried N of it" | gated on `work.min\|\|ride.min` — jacks or the bike, nothing else |
| "Also logged today" | two hardcoded pairs out of twelve |

**The first one printed a contradiction on a single screen.** A ruck athlete
8,000 steps short read *"Steady jumping jacks, that is 39 min"* at the top of
the card and, four lines down inside their own ruck block, *"You are 8,000
steps short — about 70 min under that plate at this pace."* Same card, same
gap, two modes and two numbers.

**Two designs had collided and nobody reconciled them.** Jacks and the bike
answer the gap in the TOP note and their blocks say nothing about it; the ruck
(v294) and the run (v323) answer it in their OWN blocks and nobody came back to
the top note. So the top note's else-branch fell through to jacks for both.

The gap is now answered **once**, at the top, for whichever mode is picked —
and the ruck and run blocks lost their duplicate sentence. Two labels on one
number is what v314 cleaned off Progress.

**The second was silence where an acknowledgement belonged.** Measured against
an 8,000-step target: a 120-minute ruck carrying **13,800** steps and a
60-minute run carrying **18,480** both produced no "Target met" line at all,
while 200 minutes of jacks produced one.

`CARDIO_INFO` — v327's credit table — is now the ONE per-mode table, carrying
the label, the phrase, the work reader and the gap advice. A second table
restating these four names is how the five diets came to exist as three
separate literals.

### Three escaped mutants, and only one was a weak check in the ordinary sense

- **The minutes check compared the app to itself.** `r.mins.ruck` was read out
  of `ruckNeed()` — the same helper the note calls — so a mutant that made
  `ruckNeed()` return **jacks** minutes moved both sides of the assertion and
  passed. The expected figure is now derived from `ruckStepsPerMin()`, with a
  guard that the four rates genuinely differ. **Pin the value, not the
  identity** — v325's lesson, in a new place.
- **`CARDIO_INFO[mode]||CARDIO_INFO.jacks` looks equivalent to the membership
  test and is not.** For an unknown string it really is equivalent, which is
  why `cardioInfo('helicopter')` could not tell them apart. An **inherited**
  key can: `CARDIO_INFO['constructor']` is truthy, so the `||` fallback hands
  back `Object.prototype.constructor` while the membership test refuses it.
  The check now exercises that, with a guard asserting the inherited key really
  is truthy first.
- **Naming both modes is not crediting both.** `carried=done[0].steps` passed
  every "two modes are named" assertion while reporting one mode's steps. The
  check now asserts the credited figure is the SUM and is larger than either
  mode alone.

Ten mutants, all caught after those three rewrites. The floors carry the usual
weight: a day walked off on your own feet claims no mode carried it, the mode
you are looking at is never "also" logged, and the jacks and bike advice must
still name jacks and the trainer — an over-eager fix that advised jacks
everywhere satisfies every "the note exists" assertion.

**And five check failures on correct code, both traps already in this file.** A
fixed 200-character window ran past the note into the "Make it up with" picker,
which names every mode on every card — so *"the ruck advice does not mention
jumping jacks"* failed on a screen that was right. **Scope the assertion to
where the change was made.** And the cross-note quotes each mode's `did` phrase
(*"of running"*), not its `short` one (*"the run"*), because *"20 min on
jumping jacks"* is not English.

## The conditioning bar reported nothing for the one athlete it was built for (v329)

Found by sweeping for the SHAPE of v327 and v328 rather than by using the app:
every function that knows jacks AND the bike but not the ruck or the run.
Four hits, three real.

**`ridesThisWeek()` read `day.bikeVal` and `day.jackVal` and nothing else.**
Measured against the 2 x 35 min "Easy conditioning" target:

| the week | the bar reads |
|---|---|
| 2 x 45 min riding | 2/2 · 90 min |
| 2 x 45 min jacks | 2/2 · 90 min |
| **2 x 45 min rucking** | **0/2 · 0 min** |
| **2 x 40 min running** | **0/2 · 0 min** |

**Its own comment records this being fixed once already.** It counted rides
only, until an athlete doing the same work with jumping jacks saw a
permanently empty bar. Then the ruck (v294) and the run (v323) arrived and
nobody came back — so the fix for one instance left the class alive, for the
third time in three versions. And the week it fails on is precisely the week
the army-prep programme prescribes.

**A walk counted for nothing, and the card said it counted.** *"Jumping jacks,
a walk or the bike all count"* — `ridesThisWeek()` never read `day.steps` at
all, so 24,000 steps over two days read 0/2. Fifth entry under **a promise in
UI text is a specification**.

The copy now names what really counts AND says where walking does count
instead — the step target, one card up. Deleting the false half without
answering the question it raises just moves the dead end.

**The energy was priced at one mode's rate for all of them.** The card showed
`r.mins * jackKcalPerMin('easy')`, so 90 minutes under a 45 lb plate was
charged at the jumping-jack rate. Each mode now prices its own minutes — the
same defect v327 fixed one number over.

**`validateData()` checked two of the four cardio ladders.** `BIKE_LEVELS` and
`JACK_LEVELS` get MET ordering, speed sanity and a "does this really cover
10,000 steps" test in all three currencies; `RUCK_PACES` and `RUN_PACES` got
nothing. The ruck is the one that needed it most: its MET is **computed from
bodyweight and load** rather than looked up, so a bad figure moves with the
athlete and never looks obviously wrong. Two properties are pinned that a
fixed table could not express at all — that the carried load really raises the
MET, and that running costs about the same per kilometre across all four paces,
which is the claim the run card makes on screen.

### `_dv()` and the escaped mutant that was ALMOST equivalent

`+v||0` in place of the `typeof`/`isFinite`/`>0` test escaped, and reading it
back is what found the real difference. `'lots'` is `NaN` either way. A
negative is refused downstream by the `if(!(m>0))return` guard. But a numeric
**string** coerces: `'45'` would be counted as 45 minutes in the weekly total
while `movement()` — which reads today's number with `typeof v==='number'` —
scores the same stored row as nothing. **The two readers have to agree**, or
one day is worth 45 minutes in the weekly bar and zero on the card. The check
now pins both sides, with a guard asserting today's reader really does refuse
it.

Eleven mutants, all caught after that. The floors are what keep the fix from
being "count everything": 24,000 walked steps is still not two cardio sessions,
and two 10-minute efforts still do not meet a 35-minute target.

### And a check in another suite that read a field, not a requirement

Suite 11 asserted `r.weekly.jackMin >= 14`. The per-mode map replaced
`jackMin`/`rideMin` — two named fields can only ever describe two of four
modes — so it failed on correct code. Re-aimed rather than patched: it now
reads `perMode.jacks` **and** pins that the other three are zero, which is what
makes it a statement about jacks rather than about the total.

### The false alarm, recorded so nobody "fixes" it

`ivDone()` is bike-scoped on purpose and its own comment says why: the
`specialcardio` intervals are the one session with a real intensity dial
(`BIKE_LEVELS`) behind them. Not every two-way branch over this set is a bug.

## Three constants that were declared and never read (v331)

A sweep of every top-level ALLCAPS `const` against how often it is actually
READ. Three were never read once, and each was a different failure:

- **`RUN_TT_M`** carried a comment naming it as the time trial's distance, and
  the distance was spelled out by hand in **three** places instead — the
  session row, the Progress card and the entry sheet. Editing the constant
  moved nothing; editing one string left the other two disagreeing with it.
  That is the five-diets shape exactly. `runTTLabel()` is now the only copy.
- **`PREP_TAPER_DAYS`** was not merely unread, it was **wrong**. It said 10
  days; `prepPhase()` tapers at two WEEKS. A number that looks like a setting,
  disagrees with the behaviour it names, and changes nothing when edited is the
  `voicePitch` trap in its purest form. It is now `PREP_TAPER_WEEKS`, in the
  unit the phase model works in, and it is the only place the boundary lives.
- **`RUN_SESSION_IDS`** was dead outright — `runSession()` already does the
  membership test it existed for.

**And v330's own `prepClimbWeeks()` had introduced a second copy of the sharpen
boundary** beside `prepPhase()`'s. Fixing one instance is not fixing the class,
including when the instance is the one you shipped an hour earlier.

### Five of eight mutants escaped first, and both reasons are already in this file

- **The first inline `<script>` on this page is two characters long.** The
  source scan used `querySelector('script:not([src])')` and read it, so four
  mutants that hardcoded the distance back walked straight through. Take the
  BIGGEST script, and guard that the text really contains the app.
- **A top-level `const` is not a `window` property.** `typeof
  window.PREP_TAPER_DAYS === 'undefined'` is true whether or not the constant
  exists, so the "the dead constants are gone" check passed on nothing. Scan
  the source for the DECLARATION.

A rendered-text check could not have caught any of the four either: a hardcoded
string that happens to match today's constant is indistinguishable on screen.
The counts are what discriminate — three call sites, and the derivation itself
reading `RUN_TT_M`.

**And the fix's own comment broke two of its own checks**, which is the trap
this file records for `SAFE_SWAP` prose: a comment quoting the literal it
forbids is counted by the scan that forbids it. Reword the prose, never weaken
the check. The declaration `function runTTLabel()` also matches a
`runTTLabel()` call-site pattern, so the count subtracts it.

Eight mutants, all caught after those rewrites.

## Two plans, each obeying the rule, that nobody added together (v332)

Found by driving the army-prep athlete ACROSS subsystems rather than by another
static sweep — the method that found the v284 container bug. Most of it held:
the plan builds from what is actually logged, the ruck ladder raises distance
or load but never both, the conditioning bar counts it, nothing rendered wrong.

What did not: the endurance plan ramps from what was logged RUNNING and the
ruck ladder from what was logged RUCKING. Each caps its own curve at 10% a
week, and each has a floor for an athlete with nothing logged IN THAT MODE.
Neither reads the other — and **a rucked kilometre and a run kilometre are
absorbed by the same tissue.** Measured:

| the athlete | logged/wk | prescribed week 1 | step |
|---|---|---|---|
| rucks and runs | 21 km | 31 km over 6 weeks | 6.7%/wk — legal |
| **rucks 25 km, never runs** | 25 km | 27.5 ruck + 8.8 run = **36.3** | **+45% in one week** |
| **runs 25 km, never rucks** | 25 km | 27.5 run + 5.5 ruck = **33.0** | **+32% in one week** |

And **no surface showed the combined figure at all** — 27.5 on one card, 8.8 on
another, and 36.3 nowhere.

### Four measured wrong turns, and the arithmetic that made three of them moot

**Two series that each climb no more than 10% a week sum to a series that
climbs no more than 10% a week.** Both plans already cap their own curve, so the
combined RATE never needed policing at all. Three fixes were built and measured
before that sank in:

- **A flat cap on the trailing total** cut a legal 6.7%/wk plan's running from
  12.4 km to **4.5**, and by week 12 the ruck alone had outgrown the cap anyway
  — the total went 18% over while the run had already been cut to nothing.
- **A compounding cap** was no constraint whatever: 43 km against a 72 km cap.
- **Proportional scaling under a one-week cap** was arithmetically correct and
  worse in practice. "Is the other mode on its floor?" stays true FOREVER for an
  athlete who never takes that mode up, so a runner who does not ruck had their
  running held at 14 km while their own curve climbed to 32. It suppressed the
  plan being followed because of a plan being ignored.
- **Comparing the combined plan against the 4-week trailing average** warns
  EVERYBODY, because each plan's curve compounds FROM that average — by week
  seven the plan is trailing x 1.1^6, +77% for every athlete alive including one
  who has kept up perfectly.

The real step is narrow: **a mode with NO history at all, opening at its floor,
beside a mode the athlete is already doing.** That is `footNewMode()`, and it is
the whole condition.

**And the fix WARNS rather than resizing.** The athlete decides which sessions
they do; the same call the custom builder makes for a flagged joint and the
FORCE session makes for missing kit — name it, never silently substitute. The
note says how much is new, what it lands on top of, and what to do about it.

### The `hidden` mutant, again

A mutant that rendered the combined total with a `hidden` attribute escaped,
because `strip()` keeps the text of a hidden element. v314 already recorded
`hidden` as a lazy mutant and re-seeded as a deletion; the deletion is caught,
and the check now also refuses a hidden note outright, so both shapes fail.

Eleven mutants, all caught. The floors carry the weight: a legal plan keeps
every kilometre and is not warned, the total is free to grow across a block, a
beginner with nothing in either mode is not told anything is new, and an athlete
merely BEHIND their plan is not warned either — nothing is landing on top of
them.

## The standard he asked about had already been replaced (v333)

"What military training can you research and implement as it relates to the
Canadian Armed Forces soldier first course?"

The Canadian Army's soldier-first fitness standard **used to be the Battle
Fitness Test** — 13 km carrying 24.5 kg in 2:26:20 — and **FORCE Combat has
replaced it**. Finding that out was most of the value of the round: building
the BFT would have been building a retired requirement, and an athlete would
have trained to it for months with nothing on screen saying it had stopped
being the standard. That is precisely the hazard `FORCE_ASOF` exists for, and
`COMBAT_ASOF` now sits beside it for the same reason.

**The research also confirmed the figures already shipped.** The official
CFMWS manual gives the four events as 51 s, 3:30, 5:21 and pass/fail; v322's
`FORCE_EVENTS` carries 51, 210, 321 and null. Exact match. A round that only
verified existing numbers would still have been worth running.

### What FORCE Combat is, and why it is not a second copy of a screen

The same four events as the annual evaluation — **run as one continuous circuit,
in a fixed order, in full fighting order (25 kg), against a single clock, under
15 minutes.** Plus a 5 km march under 35 kg in 50-60 minutes.

**The rest between events is the whole difference**, so the card says that in
as many words, and a check pins the sentence. Without it this is a duplicate of
a screen the athlete already has.

`combatOrder()` maps the order onto `FORCE_EVENTS` rather than restating four
times, because a second copy of a number is a second place for it to drift —
and the mutant that gave the circuit its own times is caught by an assertion
that the two are the SAME objects, not merely equal.

### The load the app refuses to train, said out loud

**35 kg is 77 lb. `RUCK_LB_MAX` is 60, and the ruck ladder's own ceiling is a
third of bodyweight — 63 lb at 86 kg.** So the march standard sits ABOVE
anything this app will progress an athlete to, deliberately.

The tempting move is to clamp the number to what the app can express. That is
the worst available option: the athlete trains to a figure that is not the
standard and does not know it. `combatMarchGap()` states both numbers and says
the last stretch is short, deliberate exposure near the date rather than
weekly volume — and points at the unit's own preparation for it. The mutant
that clamps `combatMarchLb()` to `RUCK_LB_MAX` is caught.

### Two throws where named failures belonged

Both are traps already recorded here and both were hit again in one round:

- **A top-level `const` is not on `window`, and is not visible in Node
  either.** Referencing `COMBAT_FFO_KG` from an assertion made the block
  report *"the test file itself threw"* rather than naming a check. Carry page
  constants out in the payload.
- **Guard before the first line that dereferences.** Two mutants — clamping
  the load, and never returning a gap — were caught by a `TypeError` on
  `cb.gap.need` rather than by name. Still red, but a throw hides which
  property broke. The guard now sits immediately before the dereference and
  both mutants fail by name.

Eleven mutants, all caught. The floors: a result never entered is **not** a
fail, exactly on the standard **is** a pass, a real time survives the repair
that drops junk, and a heavier athlete whose own ceiling cleared the load
would not be warned at all.

## Auditing my own change an hour after shipping it (v334)

Two defects in v333, both of them lessons already in this file, both written
the same evening.

### The kit note was on one card and not its twin

`forceKitHTML()` returns real content and `openForcePrep()` renders it.
`openCombat()` did not reference it at all — so an athlete with no sandbag saw
the whole FORCE Combat standard and a **Run the circuit** button, with nothing
saying three of the four events need kit they do not own.

That is v322's own finding — *a new path has to ask every question the old ones
ask* — repeated one card over, an hour later. The fix uses the SAME renderer
rather than a second note, so the two cards cannot say different things, and
the mutant that drops it is caught by that as well as by the text.

### The card named a window and the verdict enforced half of it

The march card printed **"In 50–60 minutes"** and `combatVerdict()` only ever
checked the upper end. Measured: a **20-minute** entry read as a **PASS**. Five
kilometres in twenty minutes is **15 km/h**, and the window is 5–6 km/h — under
**77 lb**. A one-second circuit passed the same way.

A promise in UI text with no code behind it, in code shipped an hour earlier.

**It is NOT reported as a failure**, and that restraint is the point. Whether
arriving inside 50 minutes fails the real evaluation is something this app does
not know. What it does know is that the number sits outside the window it
printed, which in practice means a short course, a light bag or a slip of the
thumb. So it says exactly that, names the implied speed — *"15 km/h under 77
lb"* — and leaves the verdict alone. The mutant that turns implausible into
`'fail'` is caught.

**The circuit's floor is DERIVED, not invented: half the sum of the individual
event standards.** Beating every event by more than half its allowed time is
not a performance. Because it reads `FORCE_EVENTS`, it moves if those figures
ever do — and the mutant that replaces it with a hardcoded 120 is caught by an
assertion that compares it against the sum, not against a number restated in
the check.

Ten mutants, all caught. The floors carry the usual weight: a time exactly ON
the floor is accepted, a slow time is a failure rather than an impossibility, a
result never entered is neither, and a legitimate pair of results produces no
note at all.

**The ratio worth recording.** v331 found that v330's own new code had
introduced a second copy of a boundary. v334 found two defects in v333. Three
rounds running, the audit's best finding was in the round immediately before
it — which is an argument for auditing the change you just shipped before
looking anywhere else.

## A rebuild inside a walk, and the four sweeps that found nothing (v335)

"Keep cleaning it up so that it functions like a professional application."
Six axes swept. Five came back clean, and recording that is the point of
running them:

| swept | result |
|---|---|
| every screen with NOTHING logged | all 13 explain themselves; no blanks, no `NaN`, no `undefined` |
| accessible names on every control | zero unnamed, every tab |
| horizontal overflow at 320px and 412px | none |
| tap targets — 67 controls under 40px, hit-tested | all reachable across 40x40 |
| hostile input — a 132-char name, an XSS payload, a 300-char food name, 999,999,999 steps | escaped, capped, no overflow |
| twelve rapid tab switches mid-render | no throw, still renders |

**The tap-target sweep is the one worth keeping as method.** `ex-check` is a
30x30 box and the first probe reported it as too small — `button.ex-check::after`
paints an invisible 44x44 hit area over it, which `getBoundingClientRect()`
cannot see. The fix was to hit-test `elementFromPoint` at the corners of a 40x40
box, **with `ex-check` itself as the guard**: if the control that is known to
have the expansion does not pass, the technique is broken and every finding is
the probe. It failed that guard twice — once measuring boxes, once measuring
elements below the fold — before it measured anything real.

### The finding, and why it is conditional

Progress ▸ Summary took **123 ms** with a year of history. Every other screen
was 1-10 ms.

`commitSession()` stores the session's item list on the log. A log written
BEFORE it did has to be rebuilt from the program engine to be counted at all —
and Progress walks every session three times over: `totalVolume()`, and
`totalTUTSplit()` **twice**, because `totalTUT()` and `estCalories()` each ask
for it independently.

| logs | Progress renders in |
|---|---|
| carrying `items` (written by current code) | **1 ms** |
| without it (written by an older version) | **123 ms** |

`allDonePairs()` is 0.07 ms and one `logItemsFor()` is 0.15; three hundred of
them is 37.9. **It is the rebuild inside the walk** — the same shape as the
`acwr()` regression already recorded here.

Measured exactly, by counting `buildSession` calls rather than milliseconds:
**120 calls, 40 distinct, 80 duplicates** for three walks over forty sessions.
A render-scoped memo takes it to **40 calls and zero duplicates**, and 123 ms
to 40.

**It is 3x, not 100x, and saying so matters.** The first walk still rebuilds
every session; the memo only collapses the second and third. Backfilling
`items` onto old logs would remove the last of it and was rejected: rendering
must not write to stored data — v312's "the validator must not mutate", one
subsystem over.

### The floor that makes a cache over lifetime totals acceptable

A memo that changed a lifetime figure would be far worse than a slow tab. So
the check pins every one of them identical with the memo live and dead —
reps, holds, sets, minutes and calories — with a guard that they are real
figures rather than zeroes agreeing with zeroes.

**Count duplicates, not calls.** The first version of this check counted raw
`buildSession` calls and reported **203 for 40 sessions**, because today's own
session is legitimately built once per paint and because switching tab inside
the counted block triggers extra renders. The same session built twice in one
paint is the waste, and nothing else is.

### And one equivalent mutant, recorded rather than papered over

`finally{_clearItemsMemo()}` versus a trailing call after the try/catch: the
error boundary swallows everything, so both run on exactly the same paths.
**No check can catch the removal of the `finally`.** It is kept against a
future change that lets the boundary rethrow — the same call as v287's
`wantAnchor` and v301's `_macrosMissing`.

Seven mutants, all caught once that one was re-seeded as something a check
could see.

### The invariant the memo rests on, asserted rather than assumed

A self-audit of this very change asked the obvious question: `buildSession(p)`
reads `adapt`, the baseline, the limitations and the swaps, so caching it
within a paint is only safe if **nothing a renderer calls writes any of them**.
The comment said so. *A comment claiming an invariant is not the invariant* —
this file has recorded that three times.

Measured across all six tabs: **zero writes**, and the baseline, limitations
and swaps untouched. So the premise holds, and it is now a check rather than a
sentence: a future renderer that writes one of them makes the memo silently
stale, and that is what says so.

**Record every ASSIGNMENT, not every change.** The first version watched for a
changed value, and a mutant that had `renderProgress()` write the value already
in place escaped it. The violation is the write, not the delta. A guard beside
it proves the watcher can see an assignment that changes nothing — without it,
"no renderer writes these" is a sentence that passes on any codebase at all.

Two further mutants, both caught: a renderer writing `adapt`, and a renderer
moving `progressPtr`.

## The key survived the erase and died on the restore (v336)

Found by driving a full backup round trip — export, `hardReset()`, import —
rather than by asking whether a screen renders. The athlete data came back
byte-identical, including v333's two new `prep` fields. **The device
credentials did not.**

`exportData()` STRIPS `azureKey` and `foodAiKey`, which is correct and is the
whole point: a backup is a shareable file and a key is not athlete data. So a
backup file holds **no opinion** about them. `importData()` then did

```js
STATE.settings=Object.assign(DEFAULT_STATE().settings, p.settings);
```

and `DEFAULT_STATE()`'s blanks won. That is not restoring anything — it is
deleting a key the file never carried.

**Measured on a device with a Gemini key restoring its OWN backup:**
`foodAIReady()` goes true to false, the AI food import silently stops working,
and the only thing on screen is *"Backup restored"*.

`hardReset()` has carried both keys across since v276 — with a nine-line
comment explaining exactly why. So **the app protected the key against the MORE
destructive action (erase everything) and erased it on the LESS destructive one
(put a backup back).** Fixing one instance is not fixing the class, and the
class here has two members, not one: the rule now lives in `carryDeviceCreds()`
and both paths ask it.

**The region travels WITH the key, and on the import path that is a real
decision rather than a restatement.** After a reset there is nothing but the
default to fall back to; after an import the FILE carries a region of its own.
So the device's region wins only when the device's key wins — otherwise a new
phone, which has no key at all, would lose the region it was exported with.

**Four floors, because "keep the keys" is satisfiable in several wrong ways.**
The backup must STILL carry neither key — putting them in the file passes every
survives-a-restore assertion and is the one thing this app promises never to
do. The restore must still genuinely replace athlete data — a fix that kept
everything passes too, so the backup's diet and personal records are pinned as
having landed. And the blank-device case is what catches the two over-eager
mutants: keeping the region unconditionally, and keeping the device's whole
settings object.

Seven mutants, all caught.

**And one reading that was the probe, not the app.** The first pass reported
Settings still showing `🔒 Saved` after the keys were erased. `#view-guide`
does not exist, so the probe fell back to `document.body` — whose `innerHTML`
**contains the app's own source**, the trap this file already records twice for
`textContent` and `NaN`. Both badges are correctly gated on the key.

`neuralOn` staying true with no key behind it is NOT a defect and was left
alone: `neuralReady()` requires the key, so the voice fails closed, and the
Settings panel renders the key input whenever the toggle is on — the screen
asks for the missing half rather than failing silently.


## The label respected the unit setting and the number never did (v337)

Found by asking one question of every surface added since v294: **what does an
imperial athlete actually see?** The ruck card converts. The bike card
converts. The run card's advice line converts. The Progress activity rows
convert. The endurance and ruck **plans** did not — and they were the newest.

They wrote the two halves of a figure as separate expressions:

```js
`${w.km} ${distUnit()}`
```

`distUnit()` reads `profile.unit`; `w.km` is raw kilometres. So the plan's
**8 km** was printed to an imperial athlete as **"8 mi"**.

| the plan means | it printed | the truth |
|---|---|---|
| 8 km running | **8 mi** | 5.0 mi |
| 5 km rucking | **5 mi** | 3.1 mi |
| 13 km on your feet | **13 mi** | 8.1 mi |

**That is 61% more running than prescribed, in week 1, on the one plan in this
app whose entire purpose is to cap weekly growth at 10%** — the injury the plan
exists to prevent, delivered by the plan itself. Nothing threw, the number was
plausible, and the label was the only thing that had been thought about.

`distShow(km)` converts and labels in **one expression**, because two halves of
one figure written as two expressions is exactly how they came to disagree.

### The run card printed `/km` above its own `MI` box

Same round, same class. `runPaceLabel()` returned minutes per kilometre for
everybody, while the input box three lines below it is labelled with
`distUnit()`. The athlete read *"About 6:11 /km"* and then typed a distance
into a box that says **MI**. The ruck card one block down has converted its
speed through `kmToShow()` since it was written.

The prose went with it: *"Running costs about the same per kilometre … the same
5 km comes out within 9%"* is a sentence, and a converted number above an
unconverted word is half a fix.

### What deliberately does NOT convert

**A published standard keeps the unit it was published in.** The CAF's own test
is a **2.4 km** time trial, its shuttle is **20 m**, its sandbag is **20 kg**
and the march is **5 km under 35 kg**. Converting a named standard to "1.5 mi"
would satisfy every assertion about the athlete's units and is the wrong
answer — the athlete is training toward the figure their own unit will quote at
them. `runTTLabel()` is pinned in both units for exactly this reason, and it is
the check that catches the over-eager "convert everything" mutant.

`6 × 400 m` stays too: a lap is 400 m on every track in the world.

### Two check lessons, both already in this file

**The seconds carry could not fire on today's data.** None of the four real
paces rounds to a 60th second, so a mutant deleting `if(ss===60){mm++;ss=0;}`
walked through a sweep of all eight labels. Exercised directly instead — a
synthetic pace chosen so `60/kmh` comes to 7.996 minutes — the same technique
the hardness-band and anchor-unit guards use. **A guard that cannot fire in the
case you tested is not tested.**

**And one mutant escaped by measuring the label instead of the payload.** The
combined-foot-volume check asked `/together: [\d.]+ mi on your feet/`, which is
satisfied by the raw kilometre number wearing a mile label — which IS the
defect. Reverting that one site passed clean. It now pins the converted VALUE,
with the raw figure explicitly refused beside it. Third time this session:
**measure the payload, not the container.**

### Sweeping the class found one more, which is the point of sweeping

The two sites that prompted the round were the plans. A scan of **every**
remaining `${distUnit()}` site — asking of each whether a conversion was in
reach — turned up Reference's bike-levels table printing a raw `${b.kmh} km/h`
with the unit hardcoded into the sentence. Honest, in that the number and the
label agreed, but the bike CARD two screens away shows the same table in
`mi/h`: one table described in two units is the "same number, two labels" the
Progress summary was cleaned of.

Every other `${distUnit()}` site was already correct, and confirming that by
MEASUREMENT rather than by reading is what made the scan worth running —
`bikeNeed()`, `ruckNeed()`, `runNeed()` and `bikeRide()` all convert at source,
so the four `.dist` call sites that look bare are not.

**And the check for it failed first on `#view-ref`, which does not exist.** The
guard caught it — the same `#view-guide` slip made twice in one session, and
the reason `document.body` is never the fallback: its `innerHTML` contains the
app's own source. Reference has had two panes since v314, so the check sets the
pane as well as the tab.

Twelve mutants, all caught after that rewrite. The floor throughout is the
metric athlete: every assertion about conversion has its unchanged sibling
pinned beside it, so a `distShow()` that converted for everybody fails four
checks.


## A date in the PAST is not a date that was never set (v338)

Found by driving the army-prep surfaces at six points either side of the test
date — the state every probe so far had skipped, because they all used a date
in the future.

Nothing threw, nothing printed `NaN`, and the weeks-remaining figure clamped at
zero rather than going negative. What was wrong was the sentence:

> **Set your test date and this becomes a plan.**

…shown to an athlete who **had** set one. `prepWeeksLeft()` folds two different
facts into one `null` — *no date was ever set* and *the date has gone by* — and
the plan reported the first for both.

**The sibling that already knew is in the same file.** `openForcePrep()` has
said *"Your test date has passed"* since it was written, from the same
`forceWeeksLeft()`, and its button already reads *Change my test date*. Only
the endurance plan never learned it.

Naming the wrong reason leaves the athlete nothing to act on, which is the same
defect as blaming safety for a limit safety did not set and as printing a range
where the answer was a unit mix-up. So the notice names the date, says there is
no block left to schedule, and carries the one control that fixes it.

**The floors are what stop the fix being "say passed for everybody."** No date
at all must keep the original message, and a date still ahead must still build
a real week — including one landing THIS week, so the notice cannot fire early.
The boundary is real: a date one day gone still shows the taper, because the
test may be that week.

### An equivalent mutant, converted into a catchable one

`prepDatePassed()` is consulted ONLY inside the no-plan branch, so a version
answering "passed" for a date still **ahead** changes nothing any rendered
check can see — the branch is never entered while a plan exists. A mutant
moving the threshold from `w<0` to `w<20` escaped every screen assertion.

Rather than record it as equivalent, the predicate's own contract is pinned
directly — false for a future date, true for a past one — the same technique
the seconds carry uses. A guard consulted in one narrow branch still has to
mean what it is named.

**And one escape that was a bad mutant.** Dropping `passed` from the
`{noDate:true}` literal appeared to escape; the seed had landed on the FIRST of
two identical lines, which is `ruckLadderWeek()` — and that renderer returns an
empty string on no-date regardless, so nothing observable changed. Seeded
against `enduranceWeek()` it is caught by five checks. **Read the mutant back**,
and when a line appears twice, anchor on the function.

Six mutants, all caught after those two rewrites.


## A runless week the athlete WAS logging is a measured zero (v339)

Found by driving an athlete who trains, stops for a while, and comes back — a
state every previous probe had skipped, because they all seeded steady history.

`trailingRunKm()` averaged `buckets.filter(b => b > 0)`, which throws every
runless week away. Measured, three very different athletes landed on the
**identical 20 km prescription**:

| the athlete | the plan said |
|---|---|
| ran 20 km every week for four weeks | 20 km |
| ran 20 km **once**, three weeks ago, using the app daily since | **20 km** |
| ran 20 km once and never opened the app again | 20 km |

The middle row is the defect. Three weeks detrained, then 20 km climbing to 22
— **the injury the 10% rule exists to prevent, arriving through the plan.**

This is the `actualRatio()` defect one subsystem over, and the rule this file
already states: **a skipped session is not a completed one, and a measured zero
is not a missing answer.** The comment beside the filter even said so about the
whole window (*"nothing logged is not zero — it is unknown"*) and then applied
the opposite reasoning week by week.

**The distinction the app can actually make is the one it already makes about
food.** A week with NO day entries at all is unknown and skipped — an athlete
who runs and does not open the app must not be punished for it. A week the
athlete WAS using the app and did not run is a zero, and it counts. After the
fix the three rows read 20 / **5** / 20.

**The base can drop a long way, so the card says why**: *"3 of the last 4 weeks
had no runs at all, counted as the zero they were rather than skipped."* It
fires only when there is something to say — a note that always fires is a note
nobody reads, and a mutant that always fires it is caught by the consistent
runner.

`_trailingWeeks(readKm)` is now the one reader, because the running plan and the
ruck ladder ask the same question of different data — and two copies of that
question had already drifted into the same defect.

### The escaped mutant was my own lesson, landing on me

Reverting only the RUCK half escaped every check, because the block exercised
running alone. **Fixing one instance is not fixing the class — and neither is
checking one.** The ruck sibling now has its own three cases beside the run's,
and the mutant is caught by name.

Six mutants, all caught after that.


## Two training paths, and the safety rules that outrank them (v340)

From a selection-prep program the athlete pointed at. Most of what it describes
the app already had — phased periodisation (`prepPhase()`), capped running and
ruck progressions, assessments, conditioning, recovery. **Three things were
genuinely missing, and the structural one is this: the block knew how to ramp
running and rucking and had no way to say which of the two the athlete was
training FOR.** The bias was accidental rather than chosen.

`PREP_PATHS` is the one legal set — **Operator** (load carriage, durability)
and **Assaulter** (running speed) — asked rather than restated, the same shape
as `DIET_OPTS`, `CARDIO_MODES` and `GEAR_OPTS`.

**THE BIAS IS THE MIX, NEVER THE VOLUME.** That is the whole safety argument.
Measured across a real 16-week block:

| | Operator | Assaulter |
|---|---|---|
| interval weeks | **4** | **12** |
| total running | **217 km** | **217 km** |
| down weeks | 4 | 4 |
| plate steps | 4 | 4, one week later |
| weeks raising distance AND load | **0** | **0** |

Same distance, same recovery, same ceiling, same "distance or load, never
both". What changes is what the athlete does inside that week, and when the
plate goes up. A path that moved volume would be a way around the 10% cap,
which is the one rule this plan exists to enforce — so every one of those rows
is a pinned floor, not a description.

`loadSlot` is which week of the four-week ruck cycle raises the plate. Slot 4
is the down week and can never be it, so exactly one slot in four raises load
and exactly one is a down week — **"never both" is structural and survives any
legal slot** rather than needing its own guard per path.

### Giving one path a different plan brought v330's defect straight back

The shared build note promised *"one tempo and one interval session"*. Operator
deliberately runs no track intervals until sharpen. **A promise in UI text is a
specification**, and the suite caught it within a minute of the change — two
existing checks went red naming exactly that. The notes are now per-path, and
each path's note describes that path's own plan.

**The check for it was wrong twice before it was right.** A bare `/interval/i`
test cannot tell *"runs an interval session"* from *"track intervals WAIT for
the sharpen phase"* — the Operator note says the second and the check read it
as the first, failing on correct copy. It now pins what each note actually
specifies.

### Two guards mean two checks, again

The mutant that deleted the `normalizeState()` repair for `prep.path` escaped
everything, because the block drove `setPrepPath()` — the setter — and nothing
drove the boot path. `importData()` accepts arbitrary JSON and writes STATE
directly, so the repair is the only thing standing there. The check now writes
junk straight into `STATE.prep` and calls `normalizeState()`, and asserts the
junk is gone from **STATE** rather than from `prepPath()`, which sanitises its
own read and would pass either way.

Its floor is the over-eager twin: a repair that deletes EVERY path satisfies
every "junk is gone" assertion and silently discards the athlete's choice on
every boot.

**And `PREP_PATHS` referenced `PREP_PHASE_NOTE` 73 lines before its
declaration** — a temporal dead zone that would have thrown on every load.
`npm run check` only parses; it cannot see it. The same `btRing` trap, caught
by driving the page.

### Auditing it an hour later found the check, not the code

The routes all held when driven — clicking the picker stores the path, the
sheet repaints with the new one selected, and `prep.path` travels in a backup
and comes back on a restore. **The CHECK was the weak part**: it searched the
markup for `setPrepPath(` rather than tapping the button, so a picker rendered
with a dead handler would have kept the string and done nothing. Same lesson as
v292's Convert button, and the fifth time this file has recorded it.

Four more mutants once it clicked instead of scanning — a dead handler, a store
with no repaint, every button rendered as selected, and the new field stripped
from the backup. **A new STATE field gets a round-trip check of its own**,
because that is precisely how v336 was found.

### Switching path mid-block, an edge the paths themselves created

The ladder recomputes rather than remembering, so an athlete who changes their
mind sees the plate move. Measured: the two ladders are offset by exactly one
slot, so the gap is **never more than a single 5 lb step** and closes again
within two weeks — bounded, self-correcting and in the conservative direction.

**No note, and that is the finding.** A note firing on a rare action with a
self-correcting effect is a note nobody reads. What is worth protecting is the
BOUND: a future path pair two slots apart would drop the plate 10 lb with
nothing on screen to explain it. So the bound is pinned rather than assumed,
against the app's own `PREP_RUCK_STEP_LB` rather than a number restated in the
check, with a guard that the ladders really do diverge somewhere — otherwise
"never more than one step" passes on two identical paths.

Twenty mutants, all caught. The default is **Operator**, because everything
else this app knows about the Canadian standards is load carriage — FORCE's
sandbag and shuttle, FORCE Combat's 25 kg fighting order and 35 kg march.

**The midpoint assessment shipped as v341** — see the section below.

**Swimming was considered and DECLINED by the athlete, and it is not an open
item.** Neither FORCE nor FORCE Combat has a swim, so the app would measure it
and have no published standard to prescribe against — it would be a currency
with nothing to convert into, which is the opposite of what every other cardio
mode here earns its place by doing. Do not re-propose it.


## A block is worth measuring more than once (v341)

The second of the three things the selection-prep program had that this app did
not. It already recorded FORCE results — what it had no way to say is **WHEN a
result was taken relative to the block**, so every re-test overwrote the last
one and the athlete could not see whether sixteen weeks of training had moved
anything.

**The checkpoint is DERIVED from the date, never stored as a flag.** Before the
halfway point is `initial`, from halfway until the test is `mid`, on or after
the test date is `final`. Deriving it means a re-render, a tab switch, a reload
and midnight all land on the right answer with nothing scheduled — the same
reason the done-for-today card is derived rather than stored.

**It fails closed, and that is the floor that matters most.** With no test date,
or no `planFrom` stamp, there is no block and therefore no checkpoint: results
record exactly as before and nothing new appears, so an athlete who is not
running a prep block sees no change at all.

`results` still holds the LATEST figure every existing reader uses. The
checkpoint is a dated record BESIDE it, not a replacement — which is what keeps
`forceVerdict()`, the prep card and the FORCE Combat sheet untouched.

### One writer, because the stamp can only go in one place

`setForceResult()` repeated `setForceResultQuiet()`'s body inline, so a result
logged from the tile and one logged from the sheet reached the same field by
different code paths. Adding the checkpoint stamp to both is how the two would
have drifted. It now calls the quiet one, which is the only writer.

### Only the four events, deliberately

The timed run keeps a single BEST with no date on it, so it cannot say which
checkpoint it was set in. Dating it is its own change; inventing a checkpoint
for an undated number would be v304's "a marker that survives only in storage
is not a record" facing the other way.

### The comparison is the point of the prompt

`prepMidDue()` stops the moment ANY of the four is recorded in the window — a
note that keeps firing after the athlete has acted is a note they learn to
skip, and the card itself shows what is still blank. **An event never re-run
reads "not re-tested"**, not `0:00` and not a failure, the same call
`forceVerdict()` already makes about an unlogged event.

These are TIMES, so **lower is better**, and the delta carries its direction on
the glass rather than only a colour: *"was 3:10 · 2:52 · −18s faster"*.

### Three traps hit again in one round

- **A comment that quotes a literal breaks the scan that forbids it.** Naming
  the run's distance in a comment tripped v331's hardcoded-distance check.
  Reword the prose, never weaken the check — fourth time.
- **Calling the helper is not driving the route.** Every assertion read
  `prepMidHTML()` directly, so a mutant that stopped rendering it on the prep
  sheet walked straight through. The check now opens `openForcePrep()` and
  reads `#sheet` — the same escape v292, v301 and v340 each produced.
- **Guard before the first line that dereferences.** The over-eager repair
  mutant left `mid` undefined and the assertions THREW instead of naming which
  property broke.

### Auditing it found the edge the feature itself created

**Rescheduling the evaluation moves the midpoint**, which puts the athlete back
in the initial window — and the first version returned the countdown there and
nothing else, so an assessment they had **already recorded vanished from the
card**. Measured by driving it: record at the midpoint, push the date out three
months, and the record was gone from the screen while still sitting in STATE.

A dated record is HISTORY. It renders whenever it exists; only the PROMPT above
it depends on where the block is now. The record itself keeps its own label and
date — relabelling it would be rewriting what the athlete actually did, and
discarding it would lose a real measurement.

And `saveForceTimes()` incremented its `wrote` counter unconditionally, so the
"Logged ✅" toast could claim a save the writer had declined. Unreachable today
— every value is validated two lines up and every id comes from `FORCE_EVENTS`
— so **no check can catch its removal**; kept as intent, the same call as
v287's `wantAnchor`.

Fifteen mutants, all caught after three check rewrites. The third: a mutant
labelling every record "Midpoint" escaped because nothing reached the FINAL
window with a record in it.


## The offline tier had drifted from what a first run meets (v342)

Found by driving the app's oldest promise: install, go offline, reload. It
works — the worker activates, the pack tops up 55 → 169 → 235 → **251** and
plateaus, and an offline reload boots with every tab rendering. Booting is not
the same as being USABLE, though, and the tier that decides what arrives FIRST
had gone stale.

`FIRST_RUN` is the batch that lands before the other 144 files. It is a **FIFTH
hand-kept place that has to move when a baseline test is added**, and it had
drifted exactly the way `TESTS`, `TEST_DEFAULTS`, `estimateMaxes()` and
`skipBaseline()` each did before it:

| missing from the early tier | what it is |
|---|---|
| `ex-burpee.jpg` | the **tenth baseline test**, added in v252 |
| `ex-fistpushup.jpg` | what a **wrist-flagged** athlete does instead of a push-up |
| `ex-legraise.jpg` | the **lowback** substitute |
| `ex-squatthrust.jpg` | the **shoulder/knee** substitute |
| four more | photos a beginner meets in the first fortnight |

**The flagged athlete — the one this app takes the most care with — met MORE
missing photos than an unflagged one.** Three of the five substitutes a
baseline swap can hand out were at the back of the queue.

**Moving a file between tiers costs no download.** The same 251 files are
fetched either way; the tier only decides what arrives first. So there is no
trade here at all — the fix is strictly better.

### The check has to DERIVE the requirement, not restate it

A second hand-written list would drift the same way the first did, so the check
reads `TESTS`, `SAFE_SWAP` and a real beginner's first fourteen sessions out of
the running app and asserts every one of those photos lands in an early tier.

**And it found a ninth file the hand fix had missed.** The first version pinned
ONE beginner, `targets:['abs']` — but the first fortnight is not a fixed set, it
depends on the focus areas the quiz collected. Sweeping five target
combinations immediately turned up `ex-swimmer.jpg`, which a back-and-shoulders
beginner meets in week one. A check that pins a single athlete quietly excuses
everything the other athletes meet.

**The floor is the one that keeps the tiering meaningful**: the early tiers must
stay a fraction of the whole pack. A "fix" that promoted all of `EXTRA` into
`FIRST_RUN` satisfies every assertion above while restoring the very download
the tiers exist to avoid — and it is caught.

### Read the mutant back, again

The first four mutants DELETED a file rather than moving it, so they were caught
by the pre-existing "every shipped asset is in some tier" check and proved
nothing about the new ones. Re-seeded as a **move into EXTRA**, they were then
caught by the video-ordering checks instead, because appending lands after the
tail. Only a move inserted BEFORE the first video isolates the new checks — and
seeded that way, each of the five fails exactly one, by name.


## The third surface never got the fix its twins already had (v343)

Found by driving pause, resume, skip and +15s for real — a set of controls no
probe had ever pressed. The guided player held up everywhere: pausing banks
the time and the hold does not lose a second (58 → paused two minutes → 58 →
57), rest is pushed out by exactly the time away, +15s and skip-rest are
no-ops outside rest, and every mid-session control taken while paused —
swap, skip, set-done, the swap menu, the pain panel — leaves the player
paused, timerless and correctly labelled.

**HIIT did not.** `ivRenderStep()` rebuilds the whole body and hardcoded
`>Pause<`, and `hiitSkip()` reaches it while paused. Measured:

| | button | INTV.running | timer |
|---|---|---|---|
| paused | Resume | false | none |
| **then skip** | **Pause** | **false** | **none** |
| then tap it | Pause | true | running |

So a frozen round showed a button saying *Pause*, and tapping it **resumed**
and re-labelled to *Pause* again — the same word either side of the tap,
saying nothing about what just happened. The clock sat still at 10s with the
screen claiming it was live.

**Both of the guided player's twins had already fixed this.**
`plEnterReady()` ends with `if(!PLAYER.running){plS('#plToggle','Resume');
return;}` and `plEnterRest()` carries the same else-branch. `ivStep()` is the
third surface and never got it — *the player has twins and they drift*, for
the fourth time in this file.

**The PAUSED line is the second signal**, because a state that rests on one
word is one forgotten re-render away from lying again. It carries no total:
the player banks paused seconds because its session clock is an
accountability figure, and HIIT has no session clock — `INTV.workElapsed`
only advances inside a running tick, so paused time is already excluded from
the credit. A count here would be bookkeeping with no consumer.

**The floor is a skip that was never paused**, which must still read Pause,
show no paused line and still be ticking. A label that always said Resume, or
a PAUSED line that always showed, satisfies every other assertion and is
worse than the defect.

### Two false alarms, both the probe

- **"The stopwatches credit paused time as work."** `swSecs()` read 60 s, then
  0 after a pause. The probe had moved `pausedAt` five minutes into the past
  while leaving `at` where it was, which is not a state real time can reach —
  the correct simulation of five minutes passing is to move **every** stored
  timestamp back. Redone that way all three stopwatches read 60 / 60 / 60.
- **"A deferred callback throws after its surface is torn down."**
  `whenPointerFree('iv', ivDone)` passes `ivDone` bare while the sibling one
  line below is guarded (`()=>{if(INTV)ivStep();}`), and `ivDone` dereferences
  `INTV.phase`. It cannot throw: `_ptrFlush()` runs every queued callback
  inside its own `try/catch`. The guard is central, not per-callback.

## A key that no backup can bring back, cleared by one tap (v343)

`clearAzureKey()` asks first. The Gemini key was cleared by a bare
`setFoodAiKey('')` on a chip sitting a few pixels from the password field,
with **no confirm at all** and a toast reading *"Cleared"*.

**Both are DEVICE credentials, and that is exactly why this one needed
asking.** `exportData()` strips `azureKey` and `foodAiKey` on purpose, so a
backup holds no opinion about either and a restore cannot undo the tap. An
athlete who thinks *"I have a backup"* is wrong about this one field, and
nothing on screen said so — so **both** confirms now say it, and name where
the replacement comes from (Google AI Studio, the Azure portal).

Same asymmetry class as v336, pointed the other way: there the key survived
the destructive action and died on the gentle one; here one of a pair
confirmed and its twin did not. **Fixing one instance is not fixing the
class**, and the class is two members wide.

**The floor is that SAVING a key asks nothing.** A confirm bolted onto the
setter satisfies every assertion about clearing and turns entering a key into
a two-tap chore. And the check clicks the CHIP rather than calling
`clearFoodAiKey()` — the difference the v292 Convert button was made of, and
the sixth time this file has recorded it.

The row deletions were checked alongside and deliberately left alone:
`removeFood`, `removeAct` and `removeSkip` drop one log row each, and a row
can be typed back. A key cannot.

Ten mutants, all caught.

## "Logged" for a Save that erased two measured times (v343)

Third instance of the same shape in one round. `saveRunTT()` toasted
**`Logged ✅` unconditionally**, in all three states:

| the tap | what happened | what it said |
|---|---|---|
| Save on an untouched sheet | nothing written | **Logged ✅** |
| a real time typed | both stored | Logged ✅ |
| both boxes cleared | **both times erased** | **Logged ✅** |

Blank-means-delete is deliberate and stays: `openRunTT()` pre-fills from what
is stored, so an empty box is the athlete taking a value away, and it is the
only way to unset a target they were never given. **The sentence was the bug,
not the delete.**

`saveForceTimes()` — the sibling sheet **340 lines below**, on the same prep
screen — already counted what its writer accepted and said *"Nothing to
save"* when it accepted none, with a comment explaining exactly why. This one
never got it.

**A write beside a clear reports the write.** That is the thing the athlete
came to do, and the cleared value shows on the card they land back on.

### Fixing that one found the class, which had three members

A sweep of every `save*()` that DELETES on a blank field turned up
`saveCombat()` with the identical shape — `toast('Saved')` unconditionally,
so an untouched Save claimed one and a cleared Save erased two measured
FORCE Combat results while claiming one. Three savers on the same prep
screen: `saveForceTimes()` guarded, `saveRunTT()` and `saveCombat()` not.

The rest of the sweep is coverage worth recording: `saveForceDate()`,
`saveGoalWeight()`, `saveWaistGoal()` and `removeMeasure()` all validate or
count before they speak, and `saveGoalWeight()` already carries a separate
*"Goal weight cleared"*. **The class is three wide and all three are now
correct** — checked by sweep rather than by fixing what happened to be in
front of me.

Eleven mutants, all caught. Two are the pair that matter: always `Logged ✅`
(the original), and always `Nothing to save` — which satisfies both
untouched-sheet assertions and breaks the only case anybody uses.

### The false alarm the same sweep raised

`mealPlanHTML()` carries *"Add a protein anchor — see the Reference tab"* on
a card that RENDERS on Reference — a pointer at the tab the reader is standing
on, left behind when v245 moved the plan off Fuel. It is not athlete-
reachable: the function has **no caller**, kept deliberately (its comment says
so) because suite 02 drives it as the safety surface for the meal generator.
The live `renderRef()` day card reports the same gap in far more detail, with
concrete grams and no tab pointer at all — so v287's claim that the overshoot
is *"visible, which renderRef() already reports"* still holds. Checked rather
than assumed.

## The brief SPOKE the session the screen called "not today's" (v344)

Found by driving the guided day end to end — brief → warm-up → workout →
cool-down — which no probe had ever run. The flow itself held: every hand-off
fires, `TODAY_TAB` follows it, and the day-complete sheet lands.

What did not is v313's own finding, on the surface v313 did not reach.
`STATE.progressPtr` advances the moment a session is committed — correct for
the engine, wrong for anything that says the word *today* — and
`briefSegments()` reads it raw. Measured on the day an athlete finished
session 2:

| surface | reads | says |
|---|---|---|
| header | `todayPtr()` | Full-Body Burn · SESSION 2 |
| Workout pane | `todayPtr()` | ✅ Session done · *"NEXT SESSION · NOT TODAY'S: Obliques"* |
| **morning brief** | **`progressPtr`** | ***"Today is Obliques & Love Handles."*** |

Two surfaces on one screen disagreeing about what today is — and the brief is
the half that is **read aloud**, which is the worst version of it. v315 already
recorded the reason: *a spoken address is the one nobody can double-check by
looking.*

**Pointing it at `todayPtr()` is only half a fix, because five of the segments
are written in the future tense.** *"We open with a warm-up… Then the main
work… Finish with…"* prescribes, and on a day already trained that describes
work the athlete has behind them. So on a finished day those five collapse to
two: the record, and the next session labelled as next. The sign-off goes with
them — *"Warm up, lock in, and let's get to work"* is false on the same day.

**A pain stop gets its own line and is never congratulated** — v313's rule, and
`todayStoppedForPain()` already separates the two states.

**`trainAgainAsked()` composes for free.** `todayPtr()` already folds it in, so
an athlete who chose a second session gets a brief that correctly calls it
today's, with no second rule.

### The route in was the other half

Step 3 of the guided day is `openPlayer()`, which opens the QUEUE session. So
on a day already trained, **"Start my day" walked straight into the session the
pane a few lines below labels "not today's"** — bypassing the priced confirm
v313 put on the direct route. Same question, same words, one place: once they
have asked, `trainAgainAsked()` is true and the whole flow, brief included,
correctly describes the new session as today's.

**The floor is that an ordinary day asks nothing.** A confirm on every "Start
my day" satisfies every assertion about the trained day and turns the app's
primary button into a two-tap chore.

## Two of the three deliberate exits from the guided day said nothing (v344)

`startMyDay()` toasts *"Sarge takes it from here"*. Three of the four ways out
are cancels, and `dayflowCancel(silent)` already had the sentence — *"Daily
flow ended — you can finish the rest anytime"* — wired to exactly **one** of
them, the "Exit daily flow" button.

| path | tap | said |
|---|---|---|
| "Exit daily flow" | deliberate | yes |
| **Stop on the warm-up** | **deliberate** | **nothing** |
| **quitting the player** | **deliberate** | **nothing** |
| `closeSheet()` / Back | incidental | nothing (correct) |

So an athlete who tapped Stop on a warm-up they had already done finished their
session and no cool-down ever came, with nothing on screen having said the flow
had ended.

**The silent half stays silent on purpose**, and that is the floor:
`closeSheet()` fires on ANY sheet dismissal during the flow, so a toast there
is noise rather than news. A cancel that always spoke satisfies both of the
checks above and fails that one.

The fix is two call sites dropping their `true`. The default already speaks —
which is the shape that should have made this impossible, and did not, because
both sites passed the flag explicitly.

### Three false alarms, and the first cost the most to disprove

- **"A log row with no `ex` map kills the Today tab for ever."** It reproduces
  — `log.ex[m.exId]` throws in `todayWorkoutHTML()`, the boundary retries
  *through* `normalizeState()`, and `ensureLog()` hands a present-but-broken row
  straight back to every writer. But `normalizeState()` already repairs it:
  `else if(!L[k].ex||typeof L[k].ex!=='object')L[k].ex={}`. Fuzzed the whole
  container as well — string, array, number, boolean, null, a nested
  non-object, a frozen object — **nothing throws and every shape ends as a
  clean map.** The throw was my probe writing a row and rendering without the
  boot path.
- **`runFlow()` matches on the DISPLAY TITLE** to pick which step to advance
  (`title==='Warm-up'?'warmup':…`), and it has a third caller, `startMobility()`,
  whose titles are neither. Unreachable: `startMobility()` calls `closeSheet()`
  first, which cancels the day, so the `null` never reaches `dayflowAdvance()`.
  Brittle, not broken.
- **A rest day in the program.** There is none — rest is a logged CHOICE
  (`restDays`), not a program slot, so the flow cannot walk into one.

### And a self-comparing guard I wrote and caught on re-reading

`t.eq('…Today stays on the session just done', r.doneState.ptr, r.doneState.ptr)`
passes on any value at all. It now pins `todayPtr()` against the finished
pointer and the queue pointer against `finished + 1`, so the two really are
different numbers before anything is asserted about which one the brief used.

Twelve mutants, all caught.

## A blank box is "about to retype", not "I have no age" (v345)

Found by driving the setup wizard end to end, then its twin — the profile
editor `OB_EDIT` reuses the same seven steps from Settings or Today. The
first-run path is clean: step 1 blocks bad input with the v289 unit hint, the
day picker blocks below five, the label and the final button track the step,
and everything commits. The health screen says in as many words *"Tap anything
that applies to you. If none do, leave them all off"*, so walking through it
untouched is a real answer and `safeMode()` correctly clears.

**The editor is where it bites.** `obBlocked()` guards the Next button, but two
routes reach `obReadForm()` without it: tapping **Done** — which is what the
step-1 Back button says in edit mode — and **switching tabs mid-edit**, which
commits on the way out. Neither validates.

Every body metric on that form reads a blank box as "keep what is stored":

```js
const ht=parseFloat($('#ob-height').value); if(ht>0)P.heightCm=...
let kg=null; if(wtOk){kg=wtKg; N.weightKg=kg;}
const gwt=parseFloat($('#ob-goalwt').value); if(okKg(k))P.goalWeightLb=...
```

Age did not:

```js
{const _a=parseInt($('#ob-age').value);P.age=(_a>0)?clamp(_a,10,100):null;}
```

Measured: clear the age and the height together, tap Done — **the height came
back 178 and the age came back null**, with a toast reading *"Saved ✓ · waist
96 cm"*. One field out of six on one form, and it is the one every calorie
number is built from. `kcalTargetPreview()` then returns null, so *"Calculate
my targets"* quietly stops working until the athlete notices the empty box.

The stored target itself survives — `recalcKcalFromStored()` bails on a null
preview — so this is a one-way door rather than data loss, which is why it had
never been reported. **`timelineWeeks` nulling on blank is NOT the same shape**
and was left alone: its picker carries an explicit *No deadline* button, so
null there is a chosen answer rather than a lost one.

## The field that multiplies every calorie had no repair at all (v345)

Found one line later, by asking why a profile edit moved an unrelated athlete's
target. `normalizeState()` had **no test on `nutrition.activity` or
`profile.activity`** — not membership, not type — and the four multipliers the
wizard offers existed in exactly one place: the markup.

The picker highlights by exact match, so an out-of-set value leaves the
activity row with **nothing selected**, and `obReadForm()`'s hand-written
`1.45` fallback then rewrites it on the next Done. Measured on an 86 kg
athlete, with values `importData()` accepts from any hand-edited backup:

| stored | picker | target | after one profile edit |
|---|---|---|---|
| 1.2 / 1.375 / 1.45 / 1.6 | selected | — | unchanged |
| **1.55** | **nothing selected** | 2720 | **2540** |
| **1.9** | nothing selected | 3330 | **2540** |
| **`'brisk'`** | nothing selected | **null** | 2540 |
| **−3** | nothing selected | 1930 | 2540 |

A string activity makes `kcalTargetPreview()` return null outright — the same
symptom as the lost age, from a different direction — and a negative one prices
a lower TDEE with no complaint.

`ACTIVITY_OPTS` is now the one list, asked by the picker and by the repair.
**A number snaps DOWN into the set rather than to the nearest**, because the
two ways of being wrong are not symmetrical: over-stating activity silently
stalls a cut, under-stating it costs a little food. Anything that is not a
number carries no intent at all, so it takes the app's own default — the value
a fresh install gets.

**And `mobility` was the truthiness-for-membership shape one line above it.**
`if(!STATE.profile.mobility)` caught `''` and `null` and let every other string
past, so an unrecognised value read as "not low" and `mobilityFlow()` skipped
the 25% longer holds a stiff athlete asked for. `MOBILITY_LEVELS` now decides.

**The picker normalises what it highlights**, not only what it stores, so even
before the repair has run there is always exactly one option selected — which
is the state that let the silent rewrite happen. A mutant that drops that and
keeps everything else is caught by it.

Eleven mutants, all caught. The floors carry the weight: every value the
wizard actually offers survives untouched, a real new age is still written,
and a repair that always overwrites fails four checks.

## A sibling writer that skipped the habit, and a habit that outlived its target (v346)

Two sweeps came back clean and are worth recording as coverage: **all 197
exercise info sheets** render with steps, a photo, no throw and no `undefined`;
and **every route that can move the step total** — `setSteps` and
`creditMakeup` across all four cardio modes, above and below the target —
keeps the step habit exactly in step.

The food side did not.

### The reference meals never ticked the protein habit

There are two writers into `nutToday().food`. `logFood()` is the guarded one.
`logRefMeal()` — *"Log this meal"* on a Reference day — pushed its rows
straight in and never called `syncProteinHabit()`. Measured against a 165 g
target:

| how the protein was logged | protein | habit ticked |
|---|---|---|
| typed by hand | 200 g | **yes** |
| logged from the app's own reference meals | 166 g | **no** |

And it never heals — not on `renderFuel()`, not on a full render, because a
renderer must not mutate (v312). So an athlete who hit their protein using the
meal plan the app built for them was not credited for it, and Perfect Day
stayed locked.

**Folding the sync INTO the push is what stops a third writer forgetting it.**
`pushFoodRow()` is now the one place a row is written and the one place the
habit is kept in step — the same call `setForceResultQuiet()` made for the
checkpoint stamp. `foodRow()` holds the shape, so the zero floor, the name cap
and the membership tests on `calc` and `src` exist once.

### A derived habit is a verdict against a target, and the target moves

Three of the five habits are derived — protein, water, steps — and each was
kept in step with its own NUMBER and never with its TARGET.

Measured: eat 165 g against a 165 g target (ticked), raise the target to 220,
and the tick stays on at 165/220 with Fuel reporting **"Daily habits · 1/4"**.
The water goal moves with **bodyweight**, so logging a heavier weight after
drinking the old goal does the same — and that is a routine sequence, not a
rare one. A wrong tick is not cosmetic: it extends the nutrition streak by a
day and can unlock Perfect Day.

`syncDerivedHabits()` runs all three, and every setter that moves one of these
targets calls it rather than remembering which habit it touched. **It is
guarded on today's day entry already existing** — with nothing logged there is
no derived habit to correct, and creating the entry here would add an empty row
to every backup.

**The floor is that lowering the target ticks it again.** A fix that only ever
un-ticked would satisfy every assertion about the raise.

## Fixing one instance is not fixing the class, and the missed one made my own repair destructive (v346)

v345 hoisted the activity multipliers out of the **wizard's** picker into
`ACTIVITY_OPTS` and taught `normalizeState()` to snap to it. There was a THIRD
copy: the calorie-target sheet's `<select>`, hand-written, offering **five**
options — including *Extremely active* (1.75), which the wizard has never
offered.

So the repair shipped one round earlier was **silently snapping a stored 1.75
down to 1.6** — about 260 kcal on a 1750 BMR — for every athlete who had picked
it on that screen, with nothing to say so. Worse, a `<select>` with no matching
option displays its FIRST entry, so an out-of-set athlete opening that sheet saw
*"Mostly sitting"* and saving it wrote **1.2**.

**Keeping 1.75 legal is the non-destructive resolution**: nobody loses a stored
choice, and the wizard gains a level the app already priced on another screen.
Both controls now render from the one list, so a fourth copy cannot be written
by hand.

**And one equivalent mutant, recorded rather than papered over.** Replacing
`activityLevel(parseFloat($('#td-act').value))` with `||1.45` changes nothing a
check can see, because the select now renders only legal values — the same call
as v287's `wantAnchor` and v301's `_macrosMissing`. It is kept so a future
control that offers something else cannot write it raw.

Nine mutants caught, one equivalent.

## A rest day is not a missed session (v347)

Reported from the phone, off a screenshot of the athlete's own schedule:
*"Wednesday is set as one of my rest days, however it says it has been 2 days
since I trained."* It had. He trained Tuesday, rested Wednesday because
Wednesday is a day **he picked off**, and Thursday morning the app opened with
**"Welcome back — it's been 2 days."** He had missed nothing.

Both banners counted **calendar days**:

| function | read | never asked |
|---|---|---|
| `catchUpBanner()` | `daysSinceTrained()` | `profile.days`, `STATE.restDays` |
| `driftBanner()` | `driftingDays()` | the same two |

**The app had both halves of the answer and neither banner asked for either.**
`profile.days` is the schedule the wizard collected; `STATE.restDays` is the
day he tapped *Take a rest day*. `isTrainingDay()` already read the first —
in **one** place, the evening reminder.

`gapSince()` measures the gap in **sessions**, not days, and returns
`{missed, off, days}` so the banner can name what it is NOT counting. A rest
day the athlete actually rested is not a debt, so the line only appears when
there were some: *"Your 1 rest day does not count against you."*

**Today is never a missed session.** The day is not over. `if(d>=t)break;` is
the whole of it, and the mutant that drops the `=` is caught by six checks.

### Drift: a rest day is transparent, and it must not BREAK the run either

`driftingDays()` walks back from today and stopped on the first day the app was
not opened. Nobody opens the app on a day they picked off — so a rest day now
neither counts nor breaks. The discriminating check seeds opens on every day
**except** the rest day: the old code stopped at 1, the new one reaches 6.

**Trained wins over rested, and the order is load-bearing.** The mutant that
puts the rest test first passes every "a rest day is skipped" assertion and
fails the one case that matters — training on a rest day must still clear the
drift. It is caught by exactly one check.

### armComeback() reads the calendar gap too, and was deliberately left alone

The instinct is the class rule — *fixing one instance is not fixing the class*.
Measured first, and the class has two members, not three: `comebackGap()`
already scales its threshold to the schedule, and the longest **legitimate**
gap stays under it on every schedule the app offers — 5 days a week gives a
2-day gap against a 5-day threshold, 3 days a week a 3-day gap against 5, and
2 days a week a 6-day gap against 7. **There is no false arm to fix**, and
re-tuning the ease moves training load nobody asked to move. v298's rule:
*read what the app does before changing what it does.*

### The existing drift check passed or failed by the weekday it ran on

`seedAthlete` trains five days a week (`days:[1,2,4,5,6]`), so a **three**-day
window straddles one of his two rest days on two weekdays in seven. The v190
check seeded exactly three opens. With rest days honoured it went red on
correct code — on a Thursday, not on a Monday. Seven days of opens, so the
window covers five training days whatever day the suite runs.

Same family as `seedAthlete` starting at pointer 0: **the calendar is part of
the state a block has to build.** Write the schedule relative to TODAY rather
than hardcoding weekdays.

Thirteen mutants, all caught. The floors carry the weight: the same two-day gap
with **no** rest day in it must still fire, a genuine two-session lay-off must
still be named, and a banner that never mentions rest days when none were
rested — a note that always fires is a note nobody reads.

## 54 weeks was true for nobody who took the default (v348)

Two screenshots, one question: *"why is one section starting week one of 54
even in another section I just secured the 6 months to goal?"* Two separate
findings, and only one of them is a wrong number.

### The wrong number

`SESSIONS_PER_WEEK` is **7**, so `WEEKS_PER_CYCLE * TOTAL_CYCLES` is 54 weeks
**only if you train seven days a week**. The wizard's own floor is **five**, and
its copy says so — *"Five days is the floor"*. Measured on the reporting
athlete's own schedule:

| pace | 378 sessions takes |
|---|---|
| 7 a week | 54 weeks |
| 6 a week | 63 weeks |
| **5 a week** | **75.6 weeks — 17.4 months** |

The Program tab said **"54-week journey"** and **"54-week progress"** with no
qualification at all, the pre-baseline note promised a *"year-long program"*,
and the onboarding hero promised *"a full year of full-body training"*. Nothing
threw and the number was plausible, which is why it survived.

**The program is a QUEUE of sessions; how long it takes is set by how often you
train, and the app already knew.** `programWeeks()` derives it from
`weeklyTarget()`. Same class as v347's calendar-day gap, one subsystem over: a
duration claimed without asking the schedule.

**The subtitle names the pace it was computed from** — *"about 76 weeks at your
5 sessions a week"* — because that is what makes the figure checkable. A bare
number gives a reader no way to tell a right one from a wrong one, and the
mutant that strips the pace is caught by its own check.

**The floor is the seven-day athlete, who really is on 54 weeks.** A fix that
deleted the number, or one that printed 76 for everybody, satisfies every
assertion about the reporting athlete and fails there. Six days a week is
pinned at 63 beside it, so the count tracks the pace rather than being two
hardcoded cases.

**`/54` on Progress ▸ Summary was deliberately left alone.** That tile counts
PROGRAM weeks, derived from the pointer — there really are 54 weeks of
curriculum, and the header chip reads the same way. The defect was only ever a
program length restated as a CALENDAR duration.

### The second finding: two clocks, and nothing reconciled them

Measured: the Program tab mentioned the timeframe **not once**. They are
genuinely different things — v310 has `timelineWeeks` setting calories,
protein, steps and conditioning and deliberately **not** strength progression,
because that is auto-regulated by `adapt()` and readiness and forcing it is how
people get hurt. So the goal date is a **nutrition** deadline and the program is
the **training** underneath it, which does not end when the scale does.

Neither screen said so, so the pair read as a contradiction. `programVsGoalHTML()`
says it, and it **points at Progress ▸ Body rather than restating the date** —
`projectionHTML()` owns that arithmetic and a second copy is a second place for
it to drift. It fires only when a timeframe is set: this one is a whole
paragraph, and a note that always fires is a note nobody reads.

### The label rule already existed twice

`~12 weeks / ~6 months / ~1 year` was hand-written in the quiz picker **and**
re-derived as a ternary in the Fuel pacing note — the five-diets drift one step
from happening. `TIMELINE_OPTS` is the one list and `timelineLabel()` the one
reader, with a derived fallback because an imported backup can carry an
off-list value.

**The check drives the picker rather than counting the declaration.** A mutant
that reverts to hand-written buttons leaves the list standing, so a check on
`TIMELINE_OPTS` alone passes on exactly the drift it exists to stop. Same escape
v322 recorded for `WEIGHTS_PATTERNS`.

**And the editor pins itself to the ACTIVE view.** Only Today and Settings host
it, so `openProfileEdit()` called from Program mounts nothing and the check read
an empty list — a failure on correct code. Go to Today first.

Thirteen mutants, all caught.

## The transition was there and nobody could hear it (v349)

Reported from the phone after a real warm-up: *"there is a five seconds
countdown to the end of an exercise, and it goes straight into the next
exercise... you need to change position whether it's come off the floor, go on
the mat, whether it's from standing to downward dog."*

`runFlow()` has had a `TRANSITION=4` bridge since it was written. **Driving the
real warm-up is what explained the report** — the transition existed and was
inaudible:

```
35s beep  36s beep  37s beep  38s beep  39s beep
40s beep "Five seconds."   41s beep  42s beep  43s beep  44s beep
45s beep "Next up. Arm Circles. Get into position."   <- the transition
46s beep  47s beep  48s beep   49s GO GO
```

**Fifteen identical 1000 Hz beeps from second 35 to second 48**, with nothing
in that run marking where the stretch ended and the repositioning began. The
one signal that said "move now" was a spoken line laid over an unbroken beep
train. Reading the code says there is a transition; listening to it says there
is not.

### Three things, and the gap is the one that matters

**A GAP IS WHAT MAKES IT A SEPARATE PHASE.** The window now opens with its own
cue, goes SILENT while the athlete is actually moving, and only counts in over
the last three seconds. Beeping every second is what put it inside the run.

**The cue FALLS, and that is why it is audible.** Every other paired cue in the
app rises — `beepGo` 1320→1760, the ten-second marker 520→880, the side-switch
660→880. A falling pair (880→520) is the one shape none of them can be confused
with. The check records tones by FREQUENCY, because "a beep happened" cannot
tell a countdown tick from a reposition cue and telling them apart is the whole
fix.

**THE REPOSITION TIME IS A PROPERTY OF THE CHANGE, NOT A CONSTANT.** Four flat
seconds is fine for arm circles into torso twists and nowhere near enough to
get from Hip Circles down onto your back. Every flow move now declares the
position it is performed in (`pos`), and `transSecs()` gives 4 for no change
and 7 for a real one. The warm-up makes three such changes; the cool-down three
more.

**An UNKNOWN position on either side reads as a CHANGE and gets the longer
window.** Over-waiting costs four seconds; under-waiting starts the next move
on the floor while the athlete is still standing. The mutant that made
`a===b` (so two `undefined`s match) is caught by exactly that check.

**Naming the position is the point of having the data.** *"Get into position"*
tells a man lying on his back nothing; *"Lie on your back"*, *"Onto your hands
and knees"*, *"Come up to standing"* tell him what to do without looking at the
phone. A handover with no position change must NOT claim one — the mutant that
sets `moved=true` unconditionally is caught by the standing-to-standing floor.

**And the handover fired two GO tones 0 ms apart** — `startItem()` calls
`beepGo()` itself and the transition branch called it again. That reads as a
stutter, not emphasis.

### The check found a move I had missed

The sweep asserting *every* shipped flow move carries a `pos` failed on
**Child's Pose** — my hand-tagging pass had covered the other sixteen. A check
written against the CLASS catches what a hand edit forgets; one written against
the three moves I happened to think about would not have.

Thirteen mutants, all caught. The floors carry the weight: standing to standing
must stay at four seconds, two moves in the same tagged position must stay
short, and an over-eager fix that made every gap seven seconds fails both.

## The tick is not a contract, and the player was treating it as one (v350)

Reported from the phone mid-session: *"after one set of the exercise, the rest
timer comes down and then the exercise does not start the second set — you
manually have to press to start the second set again. That defeats the purpose
of resting and completing all the sets as one unit."*

**NOT REPRODUCED, and that is worth recording rather than inventing a root
cause.** Driven end to end with a fake clock, the chain
`work -> rest -> ready -> work` completes with **no tap** — on a timed hold and
on a rep-counted set alike — and the v307 stuck-pointer case is rescued by its
own 900 ms watchdog (measured: `_ptrDown` true, rest expires, phase still
`rest`, one queued callback, then `ready` after the watchdog).

So the fix does not chase the cause. It removes the **dependency**.

Every phase in the player is anchored to a wall-clock deadline, so a tick that
fires LATE catches up the moment it fires — that is the throttling case
`plTickRest()`'s floor already exists for. A tick that **never fires again**
catches up never, and a backgrounded tab, a locked screen or an OS that
reclaims the interval leaves the rest sitting at zero with nothing to advance
it. The wake lock is re-acquired on `visibilitychange`; the TIMER was not.

`plResync()` re-arms on every return to the page and runs one tick
immediately, which reconciles against the deadline already stored. Measured:
kill the interval mid-rest, jump 20 s past its end — still `rest`, no timer —
then one `visibilitychange` and it is `ready`, ticking, and in `work` on set 2
four seconds later.

**Only the deadline-anchored phases are force-ticked.** `plTickReady()` counts
TICKS and `plTickRep()` accumulates elapsed milliseconds, so forcing either
steals time the athlete has not had. Two mutants that force them are caught by
a source assertion, because the theft is invisible in a phase snapshot.

**The floors are what stop it becoming a skip button.** A rest with time still
on it must not be cut short — coming back to the phone is not skipping the rest
— and it must count only the real seconds that passed (five, not the whole
rest). A PAUSED player must stay paused: re-arming one would restart a workout
the athlete deliberately stopped.

### The escaped mutant was a guard reachable only through another guard

Removing `!PLAYER.running` from `plArmTick()` escaped every check, because
`plResync()` returns early on a paused player and `playerToggle()` only reaches
`plArmTick()` on its resume branch. Rather than record it as equivalent, the
function's own contract is pinned directly — call `plArmTick()` on a paused
player and assert it arms nothing, with the running case beside it. Same
technique as v338's `prepDatePassed()`: **a guard consulted in one narrow
branch still has to mean what it is named.**

Seven mutants, all caught after that.

## Two kinds of one-sided, and they need opposite fixes (v351)

Reported from the phone: *"the first exercise was side plank, and they only
have three sets. Therefore you'll work on two sides and the other side you'll
only work on once. Any exercise whereby it's on a side, it has to be four sets,
not three."*

**v307 answered almost exactly this request with the opposite fix, and v307 was
right — about the kettlebell row.** There the set is what balances:
`side:'switch'` speaks *"Switch sides now."* halfway through, and the set count
stays where `prescribe()` put it.

**That is wrong for a side plank, and the reason is the anchor.** `sideplank`
is anchored to the `side` baseline test, which measures ONE side to failure, and
the single-leg squats are calibrated per leg. So the prescribed number is a
PER-SIDE number — switching halfway would hand back half the hold against a
benchmark taken on one, under-prescribing the very movement the number came
from. The athlete's own instinct was the correct model and my first
recommendation was wrong.

| kind | flag | what balances | example |
|---|---|---|---|
| target covers BOTH sides | `side:'switch'` | the SET, mid-way | Kettlebell Halo |
| target is PER SIDE | `side:'perSet'` | the set COUNT, even | Side Plank |

Twelve movements are `perSet` — the five side-plank variants, the four
single-leg squats, single-leg glute bridge, single-leg calf raise and Warrior
III. `kbsuitcase` joined the switchers: a one-handed carry whose own steps
already said *"switch hands partway through"*.

**The discriminator is in the steps and it is clean.** *"Count each side as a
rep"* means the movement alternates within the set and needs nothing —
`march`, `slrdl`, `sideplankreach`, the lunges, the twists, the climbers.
*"Switch sides"* / *"Finish one side, then switch"* means one side per set. 55
candidates came out of a name-and-prose sweep; reading the steps cut it to
thirteen.

### The direction of the rounding is the decision

`evenSets()` rounds UP by default — 3 to 4, which is what was asked for — and
**DOWN whenever an easing rule is in force**. Safe mode, deload, a readiness
slump and the comeback ease all exist to take work away, and none of them
should be handed a set back by a rounding rule. Measured: a flagged athlete's
side plank goes to **two** sets, not four, and clearing the flag puts it back
to four.

It never drops below **two** — one set cannot be balanced at all — and it is
applied LAST in `prescribe()`, after every modifier, because a rule applied
earlier is one a later clamp can quietly make odd again.

**An even count balances nothing if the athlete does not know to alternate**,
so the player names the side on every set — spoken and on the ring
(`LEFT SIDE` / `RIGHT SIDE`). The mutant that names the same side every set
passes every "it says a side" assertion and is caught by set 2.

### The sweep is the check, not the side plank

"Side plank is 4" passes on a hardcoded special case. The check walks **all 378
sessions** and asserts no `perSet` movement is ever odd or below two — with a
guard that the sweep actually met some (measured: 8 distinct movements, 226
appearances). The floors are a squat and a push-up, unchanged at 3: the mutant
that rounds EVERY movement to even satisfies every side-plank assertion and
fails there.

### Three traps, all already in this file

- **`sideplank:{` matches TWICE** — the `EX` literal and the progression-target
  map, at the same indentation. The patch script's `assert count == 1` turned it
  into a clean no-op; the fix was to require `region:` on the line.
- **`validateData()` LOGS**, and the harness counts a console error as a page
  failure, so the check that seeds a junk side value has to mute
  `console.error` around it.
- **`seedAthlete` starts at pointer 0**, which is week-1 core work and carries
  no per-side movement at all. The guard caught it; the block now walks the
  program for a session holding both a per-side and a two-sided movement, so the
  floor has something to stand on — and puts the pointer back afterwards.

And the membership rule for `side` **already existed**; widening that one copy
was the fix, not adding a second. `SIDE_MODES` is the legal set.

Twelve mutants, all caught.

## Reading a watch screenshot into Movement (v352)

*"I am not sure what activities I will do from day to day but I want the
flexibility to upload a screenshot and allow that information to be received in
our app."*

**The FLEXIBILITY is the requirement**, so nothing here is keyed to one watch or
one layout. The model reports what it SEES — a name, a distance, a duration
string — and every judgement that can be made in code is made in code.

### One vision path, not a sibling

`_visionEstimate()` already carries the model list, the per-call timeout,
`AI_TOTAL_BUDGET_MS`, the transient-status classifier and the on-device
diagnostic. A second vision route would have had to reinvent all of it, which
is exactly how five sibling paths in this app came to forget a question the
original asks. **The caller passes a SCHEMA and shares the rest** — the one
thing a second kind of screenshot genuinely needs to change.

`o0` has to be declared ABOVE the body literal that reads it. A const read
before its declaration is a temporal dead zone error that throws on EVERY
import, which is precisely how the v305 re-read shipped broken.

### What is decided in code, and why

**The activity NAME is a place, not a type.** The real screen reads *"Carstairs
Running"* and *"Jump Rope 34"*, so `activityKind()` matches on the movement WORD
inside the name — the same discipline that makes the roster searched by movement
rather than by name substring.

**Durations are parsed here, not by the model.** `"25:44"` is what the screen
shows; `hmsToMin()` converts it. Asking a language model for minutes is the same
mistake as asking it for the 4/4/9 macro split — exact in code, a coin flip in a
model. A per-part negative check is load-bearing: `'3:-30'` comes out POSITIVE
(2.5) if only the total is guarded, so the final `min>0` cannot catch it.

**Rows are summed by mode**, because a day is routinely two runs — his own
screenshot was 2.23 mi and 1.07 mi — and the Movement card has one box per mode.

**An activity with no slot is NAMED, never filed under the nearest mode.** A
wrong home credits work in a currency that feeds the food budget. That is also
what makes this general: the next activity he tries lands in the same honest
bucket, with one button to count it as jacks if he wants it there. The mutant
that files it under jacks and the mutant that drops it silently are both caught.

**The band is set from the measured pace.** `RUN_PACES` is defined by the talk
test and a screenshot cannot know how it felt — but it carries distance AND
time, so the measured speed beats leaving 3.3 real miles priced at whatever band
was left from last week. With no distance or no time there is nothing to measure
and it is left alone.

**Nothing is written until Save**, and the read is CONSUMED on the way out.
Leaving it in the buffer means a second tap credits the day twice — a mutant
that dropped `_actRead=null` escaped until a check drove a second save.

### Two gates fired on this round, and both were right

**The duplicate-field guard.** `activities:{type:'ARRAY',items:{type:'OBJECT'…}}`
carries `type:` twice on one line, which reads to the source scan exactly like a
shadowed key. Reformat across lines; never weaken the check.

**The 2 MB install-tier budget.** The new code took `CORE + SHELL_MIN` to exactly
2048 KB. The 512px launcher icon moved to `FIRST_RUN` — an install-time asset,
not a first-paint one, and moving a file between tiers costs no download.

**And the tier lists are parsed by pulling every quoted string between the
brackets**, so one apostrophe in a comment INSIDE the array opens a quote and
swallows the whole tier. Nine checks went red on prose. Same class as a comment
quoting code breaking the duplicate-key guard: keep prose outside the array.

Fifteen mutants, all caught. Three escaped first — one was a no-op mutant of my
own, and reading it back is what showed the other two were weak checks rather
than bad mutants.

## Skipping, and calibrating against the athlete's own watch (v353)

The fifth cardio mode, asked for after a real session the app had nowhere to
put: 35 minutes of jump rope on the watch, and four modes none of which was it.

### The MET table came from his watch, not a textbook

Published tables put continuous rope work at **11-12 METs**. A real session is
not continuous — it has trips, rests and rope changes in it. His measured
**35:21 burned 405 kcal**, which at 86 kg is 11.5 kcal/min and therefore about
**7.6 net METs**. `steady` is set there and the other two are reasoned around
it. The result prices his session at **399 kcal against the watch's 405 —
1.5% out**.

A textbook number would have over-credited every session by nearly half, and
this figure feeds the food budget. **Where the athlete has measured the thing,
the measurement beats the table.**

Every level sits ABOVE its jumping-jack sibling (6.0/7.5/10.0 against
4.5/6.0/7.5), which is the one relationship the athlete can feel directly: a
rope is harder than a jack at the same effort.

### Adding the fifth mode was mostly free, and that was the point

v327-v329 replaced the two-value branches with `CARDIO_MODES` and
`CARDIO_INFO`. So `creditMakeup()`, `cardioDone()`, `ridesThisWeek()` and the
weekly bar all picked skipping up with **no per-mode change at all**. Three
places still held hand-written lists and every one of them was a drift waiting
to happen:

- **`stepEquivalent()`** was a hand-written sum — the same line that once left
  the ruck and the run out of the weekly bar for two versions. It reads the
  registry now.
- **The mode picker and its one-line pitch** were a list of four and a
  four-branch ternary. A fifth mode is exactly when those come apart: the
  buttons would have gained skipping while the note silently described running.
  The pitch moved into `CARDIO_INFO[k].note`.
- **The day-field repair covered `jackVal`/`jackLvl`/`jackUnit` and nothing
  else.** Bike, ruck and run had none, so a hand-edited backup could put a
  string in `runVal` and it survived every boot and travelled in every backup
  after it. Driven from `CARDIO_MODES` now, with each mode naming its own
  fields (`valKey`, `lvlKey`, `unitKey`) — the v285 lesson: a fix aimed at one
  instance leaves the class alive.

### FIVE hand-written per-mode maps in the test suite, and all five THREW

Every loop in suite 07 already read `CARDIO_MODES`; the setters beside them did
not. So a fifth mode did not fail a named check — it threw, and the suite
reported *"the test file itself threw"* rather than saying what broke. `clear()`,
the `met` seeds, `cross`, `set` and `mins` all now build from
`CARDIO_INFO`'s own field names.

**A check that loops the registry but writes through a hand-written map is only
half converted**, and the half that lags is invisible until the set grows.

### The v352 checks pinned the OLD behaviour, correctly, and had to move

v352 asserted the jump rope was unplaceable and NAMED. v353 gives it a home, so
those checks failed on correct code. The unplaceable path still has to work, so
it is proved with a **swim** — something the app genuinely has no slot for.
*When a requirement changes, the check is part of the change*; pinning the rope
as orphaned would have held the old behaviour in place.

### Two escaped mutants, both mine

`display:none` on the impact warning escaped because `strip()` keeps the text
of a hidden element — the lazy-mutant trap already recorded in v314 and v332.
Re-seeded as a deletion, it then escaped again: the check matched
`/High impact/`, which the mode's own one-line pitch **also** contains. Anchored
on `calves and Achilles`, a phrase only the warning carries, it is caught.

**Take a mutation anchor VERBATIM from the file.** Two seeds read as bad
because a `\b` in a hand-retyped regex did not match; reading the line out of
the source and using it as the anchor fixed both immediately.

Eleven mutants, all caught.

## The membership rule stopped at the READ site (v354)

A full audit with a free hand to fix. Two sweeps came back clean and are worth
recording as coverage: **all 13 screens and panes render** loaded and fresh
with no `NaN`, no `undefined` and no throw; and every registry added this
session — `CARDIO_MODES`, `SIDE_MODES`, `TIMELINE_OPTS`, `ACTIVITY_OPTS`,
`MOBILITY_LEVELS` — is asked rather than restated at every consumer.

The finding is that this file's most-repeated rule had only ever been applied
where a value is READ BACK. **Nine `set*()` writers took whatever they were
handed.** `normalizeState()` is a boot repair, so a value written by a tap and
read on the same render never passes through it at all.

**Two of them put a live DOM node on the page.** `setNutGoal()` writes
`nutrition.goal`, which reaches `innerHTML` on **all six tabs**; `setPersona()`
on two. `importData()` accepts arbitrary JSON, so this is a real injection path
and not self-XSS — the same reasoning that made `_saved` and an achievement
date user content.

**Two others threw on anything but their own control's value.**
`setBodyLevel()` does `PHYS_LEVELS[clamp(level,1,5)-1].bf` and `clamp(NaN)` is
`NaN`; `setFoodAiKey()` did `(v||'').trim()`.

And `setSwap()` accepted a swap target that is not an exercise, which then
reaches `prescribe()` and the session card.

### Two boot repairs that were never written

- **`sex` had no repair at all.** It feeds Mifflin-St Jeor, and every reader
  tests for `'female'` — so **any junk reads as male**. Measured on one body:
  BMR 1793 against 1627, a calorie target of **2280 against 2020**. A corrupted
  profile silently prices a woman as a man, 260 kcal a day, with nothing on
  screen to say so. **Absent stays absent**: the wizard asks for it, and
  inventing a sex is worse than knowing it is missing.
- **`focusPrimary` was guarded by truthiness**, so every other string survived
  and `focusBonus()` looked it up in `FOCUS_POOL` and found nothing. Measured:
  **41 distinct exercises across a cycle with a real focus, 40 with junk.** The
  program really does differ and nothing says why. It falls back to the
  athlete's own first target rather than to `abs`, because their answer is
  better evidence than a default.

### The fix that stopped the page loading

`const FOCUS_KEYS=Object.keys(FOCUS_POOL)` was placed ~35 lines ABOVE
`FOCUS_POOL`'s own declaration — a temporal dead zone error that **stopped the
app booting outright**. `npm run check` only parses and cannot see it; the
first driven run found it in seconds. They are functions. Same trap as v290's
`btRing`, and the same lesson: **driving the real path finds what reading the
diff does not.**

### Three probe errors, and each looked exactly like a dead control

The usual ratio for an audit written from outside the code:

- **`settings.tone` does not exist** — the field is `settings.voiceTone`, so
  junk written to the invented key changed nothing and read as a dead control.
- **`experience` junk is harmless because the MEASURED level wins.** It had to
  be tested on a **Beginner** baseline; the seeded athlete is Advanced, where
  the two agree and the input is genuinely inert.
- **`sex` needed `'male'`/`'female'`, not `'m'`/`'f'`.** With the wrong values
  both readings came back male, and the control looked dead when it was the
  probe that was wrong. **Confirm the control's real shape before believing
  the result** — third time this file has recorded it.

### Two sweeps that came back clean, recorded as coverage

- **74 writers driven with a hostile payload**, every tab rendered looking for
  the injected ELEMENT: no injection, no page error. `toast()` uses
  `textContent`, and every picker renders from its registry rather than from
  stored values, so neither is an injection path.
- **Render cost with a year of history** — 300 sessions, 365 food days, 52
  weigh-ins, every tab and pane. Everything is 0-28 ms except Progress ▸
  Summary, and that is v335's known legacy-log path: **2 ms** with the `items`
  current code writes, ~120 ms without. The memo holds — measured the way v335
  prescribes, by counting DUPLICATES rather than calls: **301 `buildSession`
  calls for 300 logs, zero duplicates.** v335 measured the legacy cost and
  declined to backfill because a renderer must not write to stored data, and
  that decision stands.
- **Every tab pointer in rendered copy, read off the real screens** rather than
  grepped out of the source — six of them, all naming the right destination.
  Grepping the source instead reports mostly comments; one of those was stale
  (a header saying "jump to the Fuel tab" three lines above the comment
  explaining that it goes to Reference) and was reworded.

### The container was checked and its MEMBERS were not

Sweeping the whole writer surface afterwards — 74 `set*`/`toggle*`/`pick*`
functions driven with a hostile payload, every tab rendered looking for the
injected ELEMENT — found **no injection left and no page error**. What it did
find is three keyed sets carrying a container check and nothing below it:
`profile.gear`, `profile.limitations` and the day's `habits`.

**A junk member changes no behaviour**, and that was measured rather than
assumed: the built session is byte-identical, `hasGearFor()` does an `every()`
that never matches, and a junk joint matches nothing in `JOINT_RISK`. The harm
is that **every picker renders from the REGISTRY** and marks each key it finds
— so a stored key outside the registry is **invisible and cannot be un-ticked**,
and it travels in every backup and comes back on the next import. An
unreachable entry in the safety array is one lookup change away from being
live.

The legal set already existed in one place for all three. The repair just was
not asking it — the same shape as v312's hand-written cardio mode and v285's
half-guard, one layer further down: **the container was the right thing to
check and the wrong level to stop at.**

**`false` is a value, not an absence.** An unticked habit is a real answer, so
the filter drops keys outside `HABITS` and leaves `false` alone — the mutant
that deletes a falsy tick is caught by its own check.

Nineteen mutants across the round, all caught, including all six over-eager
twins: a repair that always wipes satisfies every "the junk is gone" assertion
while clearing a flagged joint, the athlete's kit and their ticks.

### The escaped mutant tested the branch that cannot fail

Deleting `setBodyLevel()`'s type guard escaped, because the check drove
`'cur'` — and only the **`'goal'`** branch reaches `levelBF()`. The `'cur'`
branch has its own harm, which nothing asserted: junk stored there travels in
every backup, the cost v285 measured. Both branches, the range as well as the
type, and the STORED value rather than the absence of a throw. Twelve mutants,
all caught after that, including the three over-eager twins — refusing every
goal, every body level and every sex satisfies every "junk is refused"
assertion and breaks the controls outright.

## The goal sync had four siblings and only it was ever written (v355)

`normalizeState()` has reconciled `profile.goal` against `nutrition.goal` for
many versions, with a comment saying exactly why: *"They are meant to be one
value; repair either side if a backup or a partial write left them out of
step."* **Age, height, sex and activity live in both objects too, and none of
them ever got it.**

The split is not cosmetic. The **profile** copies are what the wizard and the
profile editor SHOW — `value="${dv(P.age)}"`, the sex chips, the height box.
Every **calculation** reads the nutrition copies: `kcalTargetPreview()`,
`estBodyFat()`, `isFemale()`. Both writers set both, so nothing ever repaired a
divergence — and `importData()` accepts arbitrary JSON.

Measured on one 86 kg body, profile 25 against nutrition 52: **the editor
renders 25 and the calorie target is computed from 52.** The gap is not small,
and activity is the worst of the four:

| diverged | target used | what the shown value gives | gap |
|---|---|---|---|
| activity 1.45 / 1.75 | 2490 | 3010 | **520 kcal** |
| sex male / female | 2490 | 2250 | **240 kcal** |
| age 52 / 25 | 2490 | 2690 | **200 kcal** |
| height 178 / 160 | 2490 | 2330 | **160 kcal** |

**The absent case is worse than the disagreeing one.** With the nutrition copy
missing and the profile holding the answer, `kcalTargetPreview()` bails on
`!(n.sex&&n.age&&n.heightCm&&n.weightKg)` and returns null — so *"Calculate my
targets"* silently does nothing while the number is on the screen beside it.
That is v345's lost age reached from the other side.

**One loop, so a sixth field cannot be forgotten.** Profile wins a genuine
disagreement — it is what the athlete last typed and what they are looking at
— but a value present on only ONE side is copied across rather than dropped,
which is the direction that matters for an older backup. Absent on both stays
absent: there is no sensible default age, height or sex, and v354 already made
that call for sex.

Seven mutants, all caught. The three that matter are the direction pair —
mirroring only one way leaves half the class alive — and the two over-eager
twins: inventing a default when both are absent, and overwriting copies that
already agree.

### And clearance was a truthy value, not a tap

The same round, found by fuzzing the safety predicates rather than the screens.
`safeMode()` is `!parqDone() || (parqFlagged() && !medCleared())`. This file
OPENS with the story of `parqDone()` being `!!STATE.profile.parqDone` — a
boolean read with no check that the answers behind it existed — and its fix.
**`medCleared()` is the other half of the same gate and was never touched:**

```js
function medCleared(){try{return !!(STATE.profile&&STATE.profile.medCleared);}catch(e){return false;}}
```

Measured on an athlete who had declared a **heart condition**, with `parqDone`
true and a valid `parq` array — so the boot repair's only branch
(`if(!Array.isArray(P.parq))`) never fired:

| stored `medCleared` | reads as cleared | safe mode |
|---|---|---|
| `'false'` | **yes** | **off** |
| `'x'`, `1`, `{}`, `[]`, `-1`, `[0]` | **yes** | **off** |
| `true` | yes | off |
| `false`, `0`, `''`, `null` | no | on |

**The string `'false'` is the one that actually happens** — a hand-edited or
foreign export serialises the flag as text — and it is truthy.

It is not cosmetic. Safe mode changes the prescription, measured on the same
pointer: plank rotation **14s → 19s**, vertical crunch **16 → 22**, nordic
**4 → 6** — 25-40% more work, in the flagged region, for someone the screen
exists to protect.

**Clearance is a deliberate tap, so only the boolean `true` is one.** Both
flags are now coerced at the boot AND tested strictly at the read site, because
two guards mean two checks — and the first mutation run proved it: reverting
`medCleared()` to bare truthiness **escaped every check**, since all of them
booted first and the repair had already scrubbed the junk. The read site now
has its own block that hands it junk with no boot behind it.

Eight mutants, all caught after that. Three are the over-eager twins — never
accepting a clearance, forcing every athlete into safe mode, and a repair that
wipes a real one — each caught by a floor: the confirm button still clears, the
clearance survives a boot, and an athlete with no declared condition is never
put into safe mode at all.

**Two false alarms from the same fuzz, and both were the probe.** `parq:[]` with
a done flag read as "cleared with no answers" — but an empty array IS the
answer; the screen says *"if none apply, leave them all off"*. And
`jointRisky()` **throws** on a string `lims` — which is correct fail-closed
design, not a leak: `safeSwap()` guards its own read
(`Array.isArray(...)?...:[]`), and `offerable()` and `swapStillValid()` both
catch into `false`, the restrictive answer. Making it return `false` silently
would fail OPEN, which is strictly worse.

### The check has to drive the BOOT path

The first version set the divergence, rendered, and asserted the editor and the
calculation agreed. It failed on correct code: the mirror lives in
`normalizeState()`, not in a renderer. That is the right place and the only one
needed — both writers write both copies, so **only an import can create a
divergence, and `importData()` calls `normalizeState()`.**

### Five sweeps that came back clean, recorded as coverage

- **The end of the program.** All 378 sessions build with no unknown exercise
  and nothing empty; Today shows PROGRAM COMPLETE at the last pointer and past
  it; the Program calendar shows the current block's six weeks with one marked.
  The engine's `posOf()` does roll into a tenth block past the end, but Today
  never renders it — the completion screen is reached first.
- **A full backup round trip on a rich athlete** — 20+ set fields, export →
  `hardReset()` → import. Nothing lost, no key in the file, both device
  credentials still on the phone after the reset.
- **38 sheets driven, zero throws**, no `NaN`, no `undefined`, none empty. The
  six "empty" hits were the probe: three browser APIs (`showSaveFilePicker`)
  and three tab-navigation functions that are not sheets at all.
- **Every promise sentence on every screen and sheet**, extracted by pattern
  (*never / always / will / keeps / stays / counts / does not*) and checked
  against the code. The two testable ones — *"Bonus only; won't affect your
  program"* and its custom-builder twin — hold: `plEnterDone()`'s
  `if(PLAYER.free)` branch returns before any program commit, and the lift log
  credits the day (`quickLog`) rather than consuming a session.
- **Every registry member is reachable in a picker** — 13 registries, the
  inverse of the v322 drift where onboarding offered 13 gear items and Settings
  offered 12.

### The complete injection sweep, and the class the clearance bug belonged to

Two more, both clean, both worth recording because they close a gap the earlier
sweeps could not see:

- **The IMPORT path, not the writers.** v354 drove 74 `set*()` writers with a
  hostile payload; `importData()` writes STATE directly and never touches one
  of them. So the payload went into **every string an import can carry** across
  **37 top-level fields** — names, dates, poses, exercise ids, diet, gear,
  limitations, coach, region, meal plan, swaps, achievements, the baseline and
  its `subs` — then a boot, then every screen, pane and sheet. **No injection,
  no throw, no page error.**
- **The class `medCleared` belonged to.** A source scan for a function whose
  whole body is a truthiness read of a stored flag returns exactly three:
  `medCleared` (fixed), `parqDone` (already checks the array behind it) and
  `tightSpace` — which is repaired at boot AND whose junk reads *restrictively*
  (a tight room removes movements), so it fails closed already. `return
  !!STATE.x` appears nowhere else. The class is three wide and all three are
  correct.

### Four more sweeps, all clean, and the numbers they cover

Run after the fix, on axes no probe had swept:

- **972 sessions across 18 athlete configurations** — six limitation sets x
  three experience levels, every seventh pointer of the program. Zero problems
  against six invariants: no flagged joint reaches the athlete, no movement
  needs kit they do not own, every target and set count is a finite positive
  number, nothing exceeds its own `repCap`, every `perSet` movement gets an
  even count of at least two, and no hold falls outside 5-150 s.
- **480 nutrition combinations** — five goals x four timelines x four bodies x
  five activity levels. The only 16 hits were **one** athlete (45 kg, 150 cm,
  70, sedentary) whose TDEE is 1052 against a 1200 floor, so a "lose" goal
  really does sit above maintenance. That is the safety floor doing its job,
  and Fuel says so on the glass: *"raised to a safe minimum"*. Two further
  readings were the probe — `openTDEE()` is an input FORM with no prediction on
  it, so there is nothing there to contradict, and the 3.67 g/kg protein was a
  hand-set target surviving a weight change, which v287 makes deliberate.
- **All 30 achievements.** None throws on a fresh athlete or a maximal one,
  every one is reachable, and no description renders as a function's source.
  The first pass reported **thirteen unreachable** and all thirteen were the
  probe: `waistDrop()` reads `measurements` not `measures`, `scoreGain()` reads
  `scoreHistory` not `reassess`, `prs[k]` is a NUMBER not an object, the skip
  badges read a dedicated `skipLog`, and a photo row without an `id` is
  correctly filtered by the repair. **Confirm the control's real shape before
  believing the result** — five times in one session.
- **Cross-subsystem flow.** All five cardio modes credit different energy for
  the same 30 minutes and all five reach the weekly conditioning bar; the step
  habit ticks and un-ticks with the target; a logged 175 g against a 165 g
  protein target ticks the habit, raising the target to 265 clears it, and
  lowering it back ticks it again (v346's derived habits, both directions).

### Four false alarms, and every one is a trap this file already names

- **The end-of-program probe read the WELCOME screen.** It never seeded an
  athlete, so all three pointers rendered onboarding step 1.
- **Four food controls read as dead** because the fingerprint asked
  `kcalTargetPreview()` and `proteinTargetCalc()` — the *predictor* and the
  *calculation*. The effective readers are `todayKcalBudget()` and
  `proteinTargetSet()`, and a hand-set target outranking the calculation is the
  designed behaviour (v287).
- **The meal plan read as dead** because the fingerprint was
  `JSON.stringify(plan).length`. Two different plans can be the same number of
  characters. **Measure the payload, not the container** — my own entry, landing
  on me.
- **The custom-workout probe never ran the player**, calling `plMarkSet`,
  `plNext` and `plFinish`, none of which exist. The real one is
  `playerSetDone()`, and the player then parks in `rest` until the clock moves.

Two more copies of `hasGearFor()`'s body were found inline in `weightsPool()`
and `builderPool()`. Measured equivalent on today's library and left alone
rather than refactored blind — recorded here so the next reader knows the rule
has three homes.

## A week bucket built from millisecond arithmetic (v356)

`_weekKeyOf()` and `weekKey()` both computed a week from
`Math.floor(((d - Jan1) / 86400000 + Jan1.getDay()) / 7)`. Two copies of one
rule, and **the right algorithm was already sitting in the same file**:
`weekStartD()` takes the Monday of a date's week from local date parts, with no
millisecond arithmetic at all.

Measured across three whole calendar years in the athlete's own timezone:

- **The year boundary splits one real week into up to THREE buckets.** Monday
  30 Dec 2024 to Sunday 5 Jan 2025 is exactly one Monday-Sunday week. Fifteen
  minutes of skipping on each of its seven days is 105 minutes, and
  `bestSkipWeek()` reported **60**. The athlete does the work and the *"90+
  minutes of skipping in one week"* badge never unlocks.
- **The spring DST week holds EIGHT calendar dates** — 2024-W10, 2025-W10 and
  2026-W10 all did, because springing forward loses an hour and the floor keeps
  one extra day. That error favours the athlete, but it makes "in one week"
  false in the other direction.

**The severity is small and stated as such.** No reminder was ever missed:
measured across the same three years, no two Saturdays and no two Fridays ever
shared a bucket, so `weekKey()`'s de-duplication of the weekly weigh-in never
suppressed one. The undercount on a badge is the only athlete-visible cost.
`weekKey()` is unified anyway, so a future consumer cannot inherit the defect
the other copy already had.

After the fix every bucket spans exactly seven days across all three years, and
no seven-day window touches more than two of them.

**`weekStartD()` is a function DECLARATION further down the file**, so calling
it from `_weekKeyOf()` above is hoisted and safe — the same distinction the
v290 `btRing` trap turns on, this time working in our favour.

Six mutants, all caught, including the two over-eager twins: bucketing by month
(too wide) and by day (too narrow) both satisfy "the New Year week counts every
day" and fail the floors beside it.

### And a row with no usable date is not a record of anything

Found by auditing the week-bucket change an hour after making it — the ratio
this file already records, where the best finding is in the round immediately
before. `_weekKeyOf()` returns the raw string when it cannot parse a date, so
**a junk-dated row forms its OWN week bucket and can beat a real week.**
Measured: a row dated `'not-a-date'` worth 30 minutes against a genuine week
worth 20, and `bestSkipWeek()` reported **30**.

The four activity logs (`skipLog`, `ruckLog`, `gripLog`, `boxLog`) repaired
`mins` and never looked at `date` — while the `liftLog` repair forty lines up
already required one. **One instance guarded, four siblings not**, for the
fourth time in three rounds.

And `liftLog`'s own test was `typeof r.date === 'string'`, which `'not-a-date'`
passes. `isDateISO()` is now the one predicate all five ask.

**The round trip is what makes it right, and it subsumes the shape test.**
`localISO()` can only ever emit `YYYY-MM-DD`, so `localISO(d) === v` forces the
shape as well as the parse — `'2025-13-45'` matches the pattern and is not a
day, `'2025-02-29'` is not a day in 2025, and `'2025-6-2'` never round-trips.

**Which makes the regex an EQUIVALENT guard, and that was measured rather than
assumed.** Across sixteen inputs — `'2025-6-2'`, `' 2025-06-02'`,
`'02025-06-02'`, `'2025-06-02T10:00'`, `'2025-02-29'` and the rest — dropping it
changes **nothing**, so no check can catch its removal. Kept as a cheap
early-out and as intent, the same call as v287's `wantAnchor`. **Read the mutant
back before rewriting the check** — it was the only escape of the round and it
was a bad mutant, not a weak check.

Six more mutants, all caught, including both over-eager twins: dropping every
log row, and a predicate that refuses every date.

### Five sweeps that came back clean

- **The exercise library's own data**, 197 entries: no `SAFE_SWAP` or
  `LOWBACK_SWAP` cycle, every chain terminates (longest 4), every swap target is
  a real exercise, every `safeSwap()` lands somewhere genuinely unflagged, every
  ladder is non-increasing in `hardness`, every anchored exercise shares its
  anchor test's unit, every `equip` key is in `GEAR_KEYS`, every `side` is in
  `SIDE_MODES`, and `FOCUS_POOL`/`CORRECTIVE_POOL` name only real exercises.
- **Eight real clock boundaries**, driven with the clock faked before page load
  in `America/Denver`: either side of New Year midnight, month end, both spring
  forward hours, the repeated fall-back hour, leap day and the day after. 13
  panes each — **104 renders, zero problems**, no `NaN`, no `Invalid Date`, and
  `todayISO()` correct at every one.
- **The coach subsystem**: 38 personas, no duplicate ids, none malformed, none
  throws or returns an empty line on any of eight line types, `coachVoiceFor()`
  answers for every one, and every neural pitch shift sits inside the band
  `validateData()` enforces. The shuffle bag plays **all 38 before any repeat**,
  with **zero back-to-back repeats across three full bags**.
- **The food and macro pipeline**: a day's totals are the exact sum of its
  rows; a negative row cannot cancel a real meal (600 kcal stays 600);
  `macroEnergyGap()` gives **71 g** on the real reported case and correctly
  returns null for two missing, none missing, a legitimately carb-free meal and
  a big fatty one — all four floors hold. 95 foods and 33 recipes, every diet
  and allergen tag legal.
- **Layout at five phone widths in both themes** — 320, 360, 412, 430 and 768,
  13 panes each: **130 renders, zero horizontal overflow**, no element sticking
  out past the viewport, no throw.
- **Every feedback loop that decides how hard tomorrow is**, driven rather than
  read: the `adapt` band is repaired at BOTH ends and in-band values are left
  alone (99 → 1.3, −50 → 0.9, 1.3 and 0.9 and 1 untouched, `'1.2'`/`null`/`{}`
  → 1); adapt reaches the prescription monotonically (61 / 68 / 76 across
  0.9 / 1.0 / 1.3); a readiness slump EASES (69 → 48); deload eases
  (138 → 116); safe mode eases (68 → 50); **every ease at once is the easiest
  of all** (32); and nothing drives a target to zero or a hold under 5 s.

  **Four probe errors in that one axis**, which is the usual ratio: there is no
  `rateSession()` — the increment lives inside `commitSession()`; pointer 40 is
  week 6 of 6 and therefore ALREADY a deload week, so the flag correctly
  changed nothing there; and `JSON.stringify(1.30)` is `"1.3"`, so two lookups
  read `undefined` and reported a defect in code that was right.

**And one false alarm worth recording, because it was 65 findings.** The library
sweep first asserted that a `safeSwap()` substitute must measure the same UNIT
as the movement it replaces, and reported 65 violations. That rule holds only
for the BASELINE BATTERY, where the score is recorded under the test's own id
(v320, v321). On the progression path `safeSwap()` runs BEFORE `prescribe()`, so
the target is computed for the substitute's own unit and nothing is ever
mismatched — which the 972-session sweep had already proved. Narrowed to
`TESTS`, the count is zero.

**The rotation read as completely broken and was the probe**: `rollAutoPersona()`
RETURNS the id and keeps it in a script-scope `let`, so reading a stored field
gave `'auto'` 114 times. Sixth time this session. **Confirm the control's real
shape before believing the result.**

## A first install never filled its own offline pack (v357)

The app's oldest promise, and it was only half-kept for anyone who installed it
and did not open it twice.

The top-up ping was guarded on `navigator.serviceWorker.controller` **at the
instant `ready` resolves**. Those are two different moments, and on a genuine
first install `ready` wins. Measured at that exact instant: **`reg.active`
exists (state `activating`) and `controller` is NULL.** The guard skips, the
`catch(e){}` swallows it, and nothing ever re-sends.

Measured on a brand-new profile that was never reloaded:

| | files cached |
|---|---|
| after install | **12 of 251** |
| after 40 seconds | **12** |
| after the fix, 14 seconds | **251** |

The athlete installs the app, uses it once, closes it, goes offline — and has
the shell and **no exercise photographs at all**. Only opening it a SECOND time
started the top-up (12 → 37 → 79 → 121 → 169 → 211 → 252), which is exactly why
every earlier probe missed it: **they all reloaded.** Suite 12's own checks post
`cf-topup` by hand, so they proved the worker's side and never the page's.

The fix posts to `reg.active` — the registration `ready` resolves with, whose
active worker is guaranteed to exist at that point — plus a one-shot
`controllerchange` re-send, plus the controller for the ordinary second load.

**Which of the three is load-bearing was measured, not assumed.** `activate`
calls `clients.claim()`, so control arrives after about **250 ms** — too fast
for the pack to grow in between. So `controllerchange` alone is enough today,
and two mutants that leave only it **escape every check**. There is no
observable window to discriminate on, so they are recorded as equivalent rather
than papered over with a check that cannot fail. `reg.active` is kept because it
is the EARLIER and spec-guaranteed signal: delete `clients.claim()` from the
worker and it becomes the only mechanism left. Same call as v287's `wantAnchor`.

**The check must never reload, and it has to prove it did not.** A fresh
persistent context, one navigation, and `performance.getEntriesByType(
'navigation').length === 1` asserted — otherwise the check passes on exactly
the behaviour it exists to rule out. Its floor is the install tier staying a
small fraction of the pack, so "fix" cannot become "download everything at
install", which is the regression the tiers were built to prevent.

**And the install is ASYNC.** Reading the cache count the instant the view
paints gives 0 and fails on correct code; the check polls for the tier to land.

### And the level before the baseline was whatever was stored

Found by driving the pipeline every session is built on: does a measured number
reach the prescription? Nine of the ten baseline tests move the program.
Chasing the tenth found something else.

`levelOf()` has one branch that returns the quiz answer RAW —
`else return (STATE.profile.experience)||'Intermediate'` — and it is the branch
a brand-new athlete lives on **until they take the baseline**, which is exactly
when a true beginner is most at risk. `profile.experience` had **no repair in
`normalizeState()` at all**, so any value survived every boot.

Both consumers fall back to the MIDDLE tier:
`LEVEL_FACTOR[level]||1` and `LEVEL_TIER[lv]??1`. So an out-of-set string is
silently promoted. Measured with no baseline on file:

| stored | level used | factor | ladder rungs |
|---|---|---|---|
| `'Beginner'` | Beginner | **0.8** | beginner |
| `'beginner'` | beginner | **1.0** | **intermediate** |
| `'expert'`, `'zzz'`, `42` | as stored | **1.0** | **intermediate** |

A lowercase `'beginner'` out of an imported backup is prescribed as an
Intermediate — the +25% on every unanchored target that `levelOf()`'s own
comment already describes, arriving by a different door.

**Junk falls to Beginner, not to the middle.** The two ways of being wrong are
not symmetrical: under-prescribing costs one tap to fix, over-prescribing hands
a true novice an intermediate ladder. `levelName()` is the one membership test,
asked by `levelOf()` and by the boot repair.

**Two guards mean two checks, for the second time in three rounds.** Reverting
`levelOf()` to the raw return escaped every check, because all of them booted
first and the repair had already scrubbed the junk. The read site now has its
own block that hands it junk with no boot behind it. Eight mutants, all caught
after that — including the case-insensitive match that would let `'beginner'`
straight back through, and the two over-eager twins.

### The class that bug belonged to, swept

`TABLE[x] || default` and `TABLE[x] ?? default` both hide an out-of-set key, and
the danger is entirely in WHAT the default is. A scan of every ALLCAPS table
indexed by a variable found **28** such lookups. Twenty-four fall back to `[]`,
`{}` or `''` — neutral, and fail closed, which is right.

Four fall back to a value that is itself a REAL member, so an unknown key is
silently treated as that member:

| lookup | falls back to | covered by |
|---|---|---|
| `LEVEL_FACTOR[level] \|\| 1` | Intermediate | `levelName()` upstream |
| `LEVEL_TIER[level] ?? 1` | Intermediate | `levelName()` upstream |
| `LEVEL_TIER[lv] \|\| 0` | Beginner (safe direction) | `levelName()` upstream |
| `STEP_TARGETS[g] \|\| 8000` | a real target | `profile.goal`'s boot repair |

All four are now unreachable, three of them by the fix above and the fourth by
the goal membership repair that already existed. **The one-instance fix would
have left three siblings alive**; the scan is what showed there were none left
after it.

And the scan hit this file's own oldest trap: the regex matched **the comment I
had just written**, because it quotes `LEVEL_FACTOR[level]||1` verbatim. A
probe reading source is subject to the same rule as `validateData()`'s
duplicate-key guard — write prose that does not look like code.

### The false alarm this round, and why the notes are what settled it

The tenth test, `stamina`, moves nothing in the program — halving and doubling
a recorded burpee count leaves 30 sessions byte-identical, and **no exercise in
the library anchors to it**. That reads exactly like the `voicePitch` trap.

It is not one. v252 scoped it deliberately and wrote down why: `EX.burpee` is
`unit:'time'` because HIIT circuits and cardio finishers are always prescribed
as timed rounds, and anchoring it to a `unit:'reps'` test would require changing
that unit and silently altering every one of those call sites. `maxes.stamina`
is recorded for the Core Score, the level and the Strength Trends chart, and
not for a prescription.

**Its own claim was then checked rather than taken on trust**: changing ONLY
stamina moves the Core Score (92 → 100), the max is stored, and it is in
`STRENGTH_METRICS`. The recorded intent is accurate. **Read the notes before
calling a design a defect — and then check what the notes claim.**

### Two more sweeps, and one that would be a real bug in most apps

- **A comma-decimal phone.** Driven in `de-DE`, `fr-FR`, `ar-EG` and `hi-IN`:
  every screen renders, nothing prints `NaN`, and — the thing that matters —
  **all 30 numeric fields in the app are `type="number"`, not one is a text
  field with a numeric keyboard.** The browser normalises a `type=number` value
  to a dot whatever the locale, and measured directly, setting `"86,5"` on one
  leaves it **empty** rather than silently truncating: the app's own "enter a
  number" validation then catches it. A German athlete's 86,5 kg cannot become
  86. That is the right design and it holds.

  **The first pass reported seven problems and all seven were the probe.** It
  asserted that a number the app PRINTS can be read back by `parseFloat` —
  which fails on `en-US` too (`(12345).toLocaleString()` is `"12,345"`, and
  `parseFloat` gives 12). Formatting for display and parsing input are
  different paths and the app never round-trips between them. **Assert the
  route, not a property you assumed it had.**

- **The whole onboarding wizard, from a genuinely fresh install** — no seeded
  athlete, nothing in storage. All seven steps advance, each accepts what it
  asks for, it ends on the Baseline Test screen, `onboarded` is set, all six
  tabs render, and the first session builds sensibly for a beginner
  (`kneeplank 3x30`). It also confirms the profile/nutrition mirror through the
  REAL path rather than a poked field: age 41/41, height 178/178, sex
  male/male in both copies.

  `obNext()` does not exist — the step counter and the Next handler are CLOSURE
  LOCALS inside `obMount()`. The only way in is to click `#ob-next`, which is
  what the athlete does and what this file's own rule prescribes anyway.

### Four sweeps that came back clean

- **The destructive paths, driven with the confirm answered.** Undo rewinds the
  pointer and clears the stale `_trainAgain` (v316); restart archives all 20
  logs, resets the pointer, clears live-session scratch and keeps photos,
  records and measurements, with `allDoneLogs()` still reading the archive;
  `hardReset()` clears everything except the three device credentials and
  leaves no pre-import snapshot. **Three probe errors first**: all three are
  gated behind `confirm()`, which returns FALSE in a headless page, and
  `undoSession()` needs the `_undo` snapshot `commitSession()` writes — without
  it, it correctly toasts "Nothing to undo".
- **Every validator rule actually FIRES.** Ten rules broken one at a time — a
  bad anchor, a unit mismatch, a base over its own `repCap`, an unknown
  `pattern`, a ladder that climbs, a swap to a non-exercise, an illegal `side`,
  a persona below the pitch floor, a reference day with no meals, a test missing
  from `TEST_DEFAULTS` — all ten complained with a specific message and all ten
  restored to zero. A clean validator says nothing about whether a rule exists.
- **Real names, not attack payloads**: an apostrophe, a double quote, an
  ampersand, an accent, an emoji, a 58-character name, angle brackets, a
  backslash, only spaces and a newline — across four panes at 360px. No raw
  HTML entity ever reached the glass, nothing overflowed, nothing threw.
- **The offline promise itself**: the worker reaches `activated`, the pack
  plateaus rather than looping, an offline reload boots and renders all six
  tabs, and **a neighbouring app's cache and service-worker registration both
  survive a CoreForge update** — the origin-wide rule still holds.
- **The player's three TWINS, each driven to its own end.** HIIT runs
  `lead → work/rest x13 → done` on its own ticks with no spoken digits (v302
  and v317 hold) and the movement named (v308). The warm-up flow completes all
  eight moves to `✓ Done`, fires **seven reposition cues** (the v349 falling
  880→520 pair, the one shape no other cue uses) and **stops the beat**. The
  baseline battery walks all ten tests, 0 through 9, with the v296 two-minute
  rest between each and no timer left armed.

  **Five probe errors in that one axis.** `startWarmup` and `startAssessment`
  do not exist; `runFlow` keeps its whole state in CLOSURE LOCALS so there is
  nothing to poke — its interval has to be pumped instead; the flow names its
  move in `#flowName`, not `.pl-name`; `autoClose()` uses setTimeout, so
  pumping only intervals made the beat look stuck for ever when
  `closeSheet()` stops it; and **`assessNav()` reads the DOM input
  `#assess-val`, not `assessState.results`** — setting the state directly
  leaves the field empty and the battery correctly refuses to advance.

- **Nothing leaks across repeated open-and-close cycles**, which is what drains
  a phone left running for days. Measured with Chromium's own
  `Performance.getMetrics` and collection forced before every reading: opening
  and closing all 38 sheets twelve times over holds at **519 listeners and
  11,088 nodes, flat from the third cycle on**, with the heap at 3.5 MB; and
  the player, HIIT and the flow add **exactly zero**. No interval timer is ever
  left armed.

  **The measurement is the whole finding here.** An adds-minus-removes tally
  reported "+11 listeners per cycle, climbing" and a node-identity probe
  reported "the same node accumulates" — both wrong, because a listener on an
  element that gets REPLACED is collected with it, and neither counter can see
  collection. A raw live count is wrong too: it climbs for four cycles and then
  DROPS, which is GC, not a fix. Only forcing collection before each reading
  measures what the browser genuinely cannot reclaim. My own crude verdict line
  printed "a real leak" three times and the data said otherwise every time.

- **A whole session driven through the player**, by firing its own ticks rather
  than sleeping: 6 movements, 15 sets, the cycle `ready → work → rest` fifteen
  times and then `done`, with **14 rest phases — correctly none after the last
  set — and ZERO taps.** Every phase hands over on its own, which is the v350
  report ("after the rest timer the next set does not start") confirmed fixed
  on the real mechanism. `PLAYER` is a script-scope `let`, so `window.PLAYER`
  is undefined and the bare identifier is what works — the same trap as `STATE`.

## The prep block changed the program not at all (v358)

"Remember we are gearing a section of the program to prepare for military
training, therefore endurance and stamina and mental toughness is very
important." Measured first, and the measurement is the finding: **setting a
test date changed the daily program by nothing.**

| the athlete | movements | cardio slots |
|---|---|---|
| no test date | 92 | 81 of 441 |
| 16 weeks out | **identical** | **identical** |
| 4 weeks out | **identical** | **identical** |
| Operator vs Assaulter path | **identical** | **identical** |

`prepPhase()` had exactly **one** reader in the whole app — `ruckLadderWeek()`.
The running plan, the ruck ladder and the checkpoint all knew about the block;
the session builder did not. That is `timelineWeeks` for the fourth time: a
control the athlete sets that almost nothing reads.

**THE EMPHASIS MOVES, THE VOLUME DOES NOT.** That is the athlete's own call and
it is also the safety argument — the same one `PREP_PATHS` rests on. Adding
minutes near a test date is how people arrive at selection injured, and the
10% cap exists precisely so a deadline cannot buy volume. So `sharpenFinisher()`
**swaps** the conditioning finisher for a test-specific movement and adds
nothing: the slot count, the finisher count and the session length are pinned
identical across every phase.

**Only in `sharpen`, never in base or taper.** Base is where the aerobic
foundation is built and rehearsing the test there costs the base; the taper is
for arriving fresh. The check pins both — no-date, base and taper must produce
a **byte-identical** finisher distribution, so a mutant that widens the phase
gate fails on the phase that was supposed to be untouched.

**It asks every question the other picking paths ask.** `hasGearFor()`,
`safeSwap()` and `spaceSwap()` — the fifth sibling path in this app that picks
an exercise, and the first one written already knowing that. Measured: a
bagless athlete gets rushes and lateral shuffles and no sandbag work at all; an
athlete with four joints flagged gets march, dead bug and fist push-ups and
**no risky rehearsal**. Rehearsing the test on a flagged joint is the one place
this could have hurt someone.

### The escaped mutant measured the container

Dropping `e.unit===cur.unit` escaped, because the check asserted the finisher
still HAD a unit — which is true of every exercise in the library. The swap was
silently turning a timed burnout into a rep count and back, six times across the
program. The check now captures the finisher's unit **per pointer** and asserts
the sharpen map matches the no-date map exactly. **Measure the payload, not the
container** — fourth time this file has recorded it, and the first where the
payload was a property of the thing rather than the thing itself.

Seven mutants, all caught after that rewrite. The floors carry the weight: the
volume must not move, the no-kit athlete must still get real work, and a flagged
athlete must get no rehearsal at all.

## Being told to try harder is not being told it is meant to hurt (v359)

"Endurance and stamina and MENTAL TOUGHNESS is very important." Measured the
corpus before writing anything: **190 `push` lines across 38 coaches, and
exactly two of them name what the effort feels like.** Every other one is
exhortation — *"final push"*, *"empty the tank"*, *"do not quit on me"*.

Those are different messages. Being told to try harder adds pressure; being
told that burning legs are the set working removes the suspicion that
something is wrong. The second is what keeps somebody in a plank, and the app
had almost none of it.

**Shared, not per-persona, and that is a decision.** What a grind line carries
is a FACT about the effort — the fatigue really is the point of the set,
whichever coach is speaking. 38 hand-written copies of one fact is 38 places
for it to drift, and the persona flavour already lives in the `push` and
`during` pools either side of it.

**They name EFFORT and never a symptom**, which is the line `npm run check`
already draws across the whole corpus: burn and fatigue may be coached, pain
may not. They also never argue against stopping — the stop-for-pain button is
one tap away and acknowledging the grind is not the same as talking somebody
out of a stop.

### The last third is a property of the effort, not a fixed ten seconds

The existing marker fires at `remain===10`. Measured over all **1,700 timed
holds** the program prescribes: that is **22% of the average hold and 10.5% of
the longest**, so a 95-second plank got one line at second 85 and nothing at
all through the part that decides it. `grindAt()` returns the two-thirds mark
— 24s on a 36-second hold, 63s on a 95-second one.

**The open-ended baseline hold is the sharpest case and had no late coaching
at all.** It has no total, so its last third cannot be computed — and it is the
one effort where the athlete's own decision to stop IS the measurement. So the
hard part is relative to THIS athlete: `grindAtOpen()` takes two thirds of
their own best on that test, falling back to two thirds of the published
benchmark. Same reasoning as the ruck MET being computed from bodyweight
rather than looked up — a fixed number cannot be right about a body it does not
know. Measured: a 150-second plank names it at 100, a 60-second one at 40.

### A voice line and a per-second job cannot share a second, again

Driving it found the defect the code review would not have. On a 50-second hold
the form cue lands at 32 and the grind line at 33; on a 95-second one the grind
line at 63 is cut by the breathing cue at 64. `_deviceSpeak()` cancels, so one
of the two is lost mid-word every time — v307's defect in new clothes.

The periodic cues now yield the second either side (`nearGrind`), and the check
**measures the clash rather than the presence**: before the guard, both lines
were still spoken and an assertion that the grind line exists would have passed
on a line the athlete never heard.

### Who gets it, and who deliberately does not

Four surfaces: the guided player's hold, the standalone hold timer, HIIT
**work**, and the baseline battery. **HIIT rest gets nothing** — rest has no
hard part, and saying it has costs the ear the difference between the phases,
the same reason `countdownCue()` is kept off it. **The warm-up and cool-down
flow gets nothing** — a stretch is not a grind, and calling one hard would be
the app lying about the effort in front of it.

### One equivalent mutant, measured rather than assumed

`grindAt()` guards `(total-el)>11` so the line can never sit one second before
the ten-second marker. Swept across 5,000 totals: **behind the 36-second floor,
no total gives remain 11 at all**, so `>11` and `>10` are the same program. It
is kept as cover for a lowered floor and recorded as uncatchable — the same
call as v287's `wantAnchor`. The floor itself is pinned by its own mutant.

**Two escapes were real weak checks, and both are entries already in this
file.** The open hold's `at>=12` floor was invisible because both cases tested
sat far above it — *a guard that cannot fire in the case you tested is not
tested* — so a 15-second plank max is now pinned. And the standalone hold timer
was asserted **wired** by a source scan for the function name, which stays true
with the neighbour guard deleted; a 36-second effort cannot be driven inside a
suite, so its guard is read as the whole EXPRESSION, not the name.

Fourteen mutants, thirteen caught, one equivalent.

## Every session in this app had rest built into it (v360)

"An unbroken-effort session type." Measured before building anything: across
**60 prescribed sessions, all 274 sets carry at least 25 seconds of rest**, and
of the seventeen interval formats that existed the only one with no rest was
`gripmax` — **one** hang, one movement, one round. Nothing ran unbroken across
several movements.

That gap is the point of the feature. Every other session here is a
prescription you execute; a grinder is a QUESTION — will you still be moving at
the end. So the record stores **whether you finished**, not how long you moved,
and the streak counts consecutive finishes.

### It is a sequence with no rest step, not a session that hides its rests

`buildIntervals()` emits work steps and returns. "No rest prompts" is therefore
a property of the DATA, and the four surfaces that can render a rest have
nothing to remember. Suppressing rests at each renderer is four places to
forget — the shape this file records five times over.

Everything else comes free: the ring, the photograph, the countdown cue, the
wake lock, the pause, and v359's grind line now firing once per station.

**The floor is that every other format is untouched.** Deleting rest from
`buildIntervals()` outright satisfies every "the grinder has no rest"
assertion and silently rewrites Tabata, EMOM and every skipping block. Each is
pinned with its own rest count beside the grinder's zero.

### Skip is gone and Stop is not, and the split is the safety argument

Skipping a station is the one thing that breaks an unbroken effort, so that
button has no place here. **Stopping is never removed from any surface in this
app** — it stays, it is named *Stop* rather than *End*, and it writes a record
marked `done:false` that the streak breaks on. A session that claimed a finish
nobody made would be the completion gate's own defect, one surface over.

**A flagged athlete matters more here than anywhere**, because there is no Skip
— a station they cannot safely do is one they could only escape by ending the
session. `startGrinder()` runs `safeSwap`, `spaceSwap` and `hasGearFor`, the
same questions the four sibling paths that forgot them eventually learned.

### One clock, because the number that decides it is how much is LEFT

With no rests to count the stations down by, the remaining time is otherwise
nowhere on screen. `grinderLeft()` sums the current station's remainder and
every station after it.

### Four escaped mutants, and every one is an entry already in this file

- **Stop removed, and the check passed.** `o.chrome.stop` searched the whole
  `#hiit` markup for `hiitQuit()` — and the header ✕ calls it too, so the
  assertion was satisfied by a button that was never in question. **Scope the
  assertion to where the change was made**: `#hiit .pl-actions`.
- **The total clock's repaint deleted, and the check passed.** It read the
  label after a tick that ENDED a station — and a station change re-renders the
  whole body, writing the label fresh. Only a tick INSIDE a station can tell
  the per-tick repaint from its absence, so the check now ticks 60 to 59 and
  requires `5:59 LEFT`.
- **The gear check is unreachable on today's pool.** Measured: all 12
  `HIIT_POOL` movements are bodyweight and need no kit at all, so
  `hasGearFor()` is the identity there. Rather than record it equivalent it is
  exercised directly — one pool movement is given an `equip` inside the check —
  the same technique the hardness-band and anchor-unit guards use.
- **Nothing exercised the 200-row cap**, so a log that grows for ever inside
  every backup was invisible. That is the cost v285 measured, one field over.

**And a repair that dropped every row was caught by a THROW rather than by
name**, because the assertions after it dereference `repaired[0]`. Guard
immediately before the first dereference, and let the named checks report.

Seventeen mutants, all caught after those rewrites.

## The only standalone max effort was capped at three minutes (v361)

"A hold-to-failure test and tracker." Measured before building it: the baseline
battery measures **four** to-failure holds — and taking one means taking a
**ten**-test battery whose numbers anchor every prescription for a year.
Outside it, `gripmax` was the app's only standalone max effort: **one movement
(dead hang), and `w:3, r:0, n:1` — a three-minute COUNTDOWN**, so it cannot
record anything past 3:00.

So there was no way to ask *how long can I hold this today* and watch the
answer move. `HOLD_TESTS` is five holds — plank, dead hang, wall sit, side
plank, hollow — on a clock that counts UP with no cap.

### It does not touch the baseline or the prescription, and that is the design

`TEST_PROTOCOL` exists because a number taken under different conditions is not
the same measurement: the battery is taken rested, in a fixed order, with two
minutes between efforts. **A plank done on an ordinary Tuesday is a real number
and is not that one.** So `holdLog` is its own record with its own trend, and
nothing on the prescription path reads it — pinned by a check that every max
the program is built from is byte-identical before and after four holds, one of
them 400 seconds.

### Fresh and fatigued are kept apart, and the app reads the DATA

A hold done fresh and a hold done after a session are not comparable, and the
log already knows which this was — the athlete is never asked. `holdFreshNow()`
is `!trainedToday()`.

**Only a fresh hold sets the best, and only fresh holds enter the trend.** The
discriminating case is a LONGER fatigued hold: a tracker taking the maximum of
everything reports a personal best the athlete never set fresh, and then shows
it falling for months. Measured: 400 seconds after training leaves the best at
250 and the trend untouched.

**But the fatigued effort is kept.** Throwing it away satisfies every "it does
not set the best" assertion and discards work that was really done. And **why a
number is not moving is worth saying** — a hold only ever tested after training
has no best at all, and a blank with no explanation reads as broken.

**One point is not a trend.** Reporting a direction from a single number is
inventing one.

### The hard part is named at THIS athlete's own point

v359's `grindAtOpen()` rule is hoisted into `grindAtBest(best)` so the tracker
asks the same question of a different bar: two thirds of their own best on that
hold. A 150-second best names it at 100, a 60-second best at 40 — **a property
a constant cannot express**, which is exactly what the check requires by
driving both and demanding that second 40 is silent for the 150-second athlete.

### Five escaped mutants, and every one is an entry already in this file

- **The check re-implemented `htTick()`'s grind branch** instead of driving it,
  so a constant substituted into the app was invisible. `htTick` is a closure
  local driven by an interval, so the only way in is to park the clock one
  second before the point and let ONE real tick cross it — suite 04's own
  technique on the baseline timer. **Calling the helper is not driving the
  route**, for the seventh time.
- **The fatigued-only NOTE was untested**, because the ROW for the same hold
  also says *after training* and a page-wide search was satisfied by the row.
  **Scope the assertion to where the change was made.**
- **`safeSwap()` was not exercised at all**, with the floor beside it: an
  unflagged athlete must still hold the real movement, or a build that
  substituted everybody passes.
- **A zero-second hold**, and **the 200-row cap**, had nothing pointed at them.

**And two mutants were caught by a THROW rather than by name** — the assertions
after them dereference a row the mutant removed. Guard immediately before the
first dereference. A third broke the parse outright: removing an `if` line left
its `else` orphaned, which tests nothing. **Read the mutant back.**

Twenty-three mutants, all caught after those rewrites.

## A grinder is one effort, not six (v362)

Found by auditing v360 an hour after shipping it — for the fourth round running
the best finding was in the round immediately before, which is the argument for
auditing the change you just shipped before looking anywhere else.

Reusing the HIIT engine brought its **per-round** semantics with it, and a
grinder has no rest: it is one continuous piece of work. Two consequences,
both measured:

- `INTV.grindSaid` was cleared at every station, so v359's acknowledgement was
  spoken **six times in a six-minute grinder** — a nag, and a direct
  contradiction of that round's own "one per effort" rule.
- The point was two thirds of a **station** (40 seconds into whichever minute
  it was in) rather than two thirds of the **effort**, which for a grinder is
  the whole session. That is v359's own headline lesson landing on v360.

`ivSessionSecs()` gives the whole sequence, and the grinder's point is 240 of
360 seconds. **The floor beside it is that HIIT rounds keep their own** — they
really are separate efforts with rest between, so a fix that reset once
globally would silence five rounds of a Tabata.

### And its minutes went nowhere

Special HIIT's finish screen offers *"✅ Log N min to my record"* through
`isTrackedNoOrder`; the grinder's replaced the stats and never joined it. So a
finished grinder wrote its own record — whether you finished — and the work
itself was not logged anywhere, while the sibling session one branch away
offered exactly that.

Measured and NOT a defect, recorded so nobody "fixes" it: **neither** session
moves `ridesThisWeek()`. That bar counts cardio modes, not bonus sessions, and
Special HIIT has always behaved the same way.

### The equivalent mutant, measured rather than assumed

Restoring the per-station flag reset **escaped every check**, and reading it
back explains why: once the point is session-scoped, session-elapsed runs
1..360 monotonically and equals the point exactly **once**, so the reset cannot
change the outcome. The point moving is what fixes the bug; the guard is cover
against a future change that makes the point station-scoped again. Kept as
intent, with no check able to catch its removal — the same call as v287's
`wantAnchor`.

Six mutants, five caught and one equivalent.

## The measurement corrected the request (v363)

*"Is it possible to increase the exercise rep sets like in Tone up but drop
belly fat like the Shred option?"*

Measured across all 378 sessions on an 86 kg body before writing a line, and
**the premise was backwards in the athlete's favour: Tone up already gives MORE
reps than Shred** — 14,147 against 13,192. What Shred actually buys is not reps
at all:

| | reps | hold | rest | cardio slots | kcal | protein |
|---|---|---|---|---|---|---|
| Tone up | **14,147** | 464 min | 54s | 20% | 2,570 | 180 g |
| Shred | 13,192 | **689 min** | **41s** | **31%** | **1,950** | 180 g |

Protein was already identical (v299's work). So the rep half was never the gap.

**The gap is that Tone up is DEFINED by the scale holding** (v298) — it eats at
maintenance on purpose, and giving it a deficit would contradict its own copy
and break the three consumers `STABLE_GOALS` drives. Meanwhile **Shred at 1,950
sits exactly ON the safety floor** for this body, so it cannot go lower. Between
them was a **620 kcal chasm** with only `core` at 2,440 inside it — and core
drops protein to 155 g and cuts the rep volume.

`leanrecomp` is that gap: Tone up's rep multiplier and its 2.2 g/kg protein, a
~12% deficit, shorter rest and the 10,000-step target. Measured after:
**14,147 reps — byte-identical to Tone up** — at 2,260 kcal with 48s rest.

### The first build promised the rep volume and delivered the LOWEST in the app

It was given Shred's cardio slot, on the reasoning that cardio is a fat-loss
lever. Driving the whole program showed why that is wrong: **a cardio ladder
replaces a REP accessory with a TIMED movement**, so the reps fell to
**12,053 — below every other goal, Shred included** — on the one goal whose
entire purpose is keeping Tone up's 14,147. Hold time rose 464 → 658 minutes.

And the tip, written an hour earlier, said *"the same rep volume Tone up gives
you"*. A promise in UI text with no code behind it, in code that had not
shipped yet. The fix is that lean recomp keeps Tone up's split entirely: the
fat comes off the deficit, the rest and the steps.

**Reading the diff would not have found it.** The slot swap looks obviously
right until you count what it costs.

### The nested ternary became a table, because a seventh goal is when it bites

`kcalTargetPreview()` had
`gain?1.1 : stable?1 : core?0.95 : shred?-shredDef : -loseDef` — a hand-written
per-goal branch whose ELSE swallowed every goal it did not name. That is the
cardio-mode repair and the five diets exactly. `GOAL_KCAL` is now the one
table, asked by membership so an **inherited** key cannot read as a rule, with
the unknown case landing where the old else landed. The check that matters
most is that **all six existing goals are byte-identical** afterwards: a table
refactor is precisely the change that silently reprices a goal nobody was
looking at.

### The escaped mutant reverted one half of a two-part fix

Removing `leanrecomp` from the early return alone made it match *no* branch,
so nothing was swapped — an equivalent mutant, not an escape. The shipped
defect had both halves, and seeded that way it is caught by four checks.
**Read the mutant back**: a fix with two edits needs a mutant with two.

Thirteen mutants, all caught.

## A derived habit is a verdict against a target, and the target moves (v364)

Two findings, and the first was in the round shipped an hour earlier — the
fifth time running that the audit's best finding was the previous round.

### A map whose fallback is SILENCE must be complete

v363 added a seventh goal. The picker renders from `GOALS`, so the button
appeared correctly. **`GOAL_NOTE` is a hand-written map read as
`GOAL_NOTE[g]||''`** — and it stayed at six entries, so tapping *Lean recomp*
in the setup wizard showed the goal selected with **nothing under it**
explaining what it does. Nothing threw; nothing looked wrong in the diff.

A registry sweep across eleven registries found exactly one gap, and the
distinction is what makes it worth writing down: **`PROT_PER_KG` is
deliberately sparse** — its fallback is `PROT_PER_KG_BASE`, a real tier — while
`GOAL_NOTE`'s fallback is an empty string. *A per-goal map whose fallback is a
real DEFAULT may be partial; one whose fallback is silence must be complete.*
`validateData()` now enforces the lockstep **both directions**, the same shape
`TESTS`/`TEST_DEFAULTS` has: a missing note is a blank explanation, and an
orphaned note is dead copy nobody will ever see.

### Three writers moved a derived target and only the wizard synced

v346 established the rule — *every setter that moves one of these targets calls
`syncDerivedHabits()` rather than remembering which habit it touched* — and
wired the setters that move a target's NUMBER. It did not sweep the writers
that move a target **indirectly**, and there are three:

| writer | what it moves | synced? |
|---|---|---|
| `setNutGoal` | `STEP_TARGETS[goal]` and the protein tier | **no** |
| `saveGoalWeight` | the PACE, which flips `timelineIsAggressive()` | **no** |
| `recomputeTargetWeight` | the same field, from a body-LEVEL tap | **no** |
| `obReadForm` (the wizard) | both | yes |

Measured: 7,500 steps on Maintain (7,000) is a legitimate tick; switching to
Lean recomp raises the bar to 10,000 and **the tick stayed on**. Protein the
same — 160 g logged against 155 g, switch to a goal wanting 180 g, still
ticked. And the goal weight is the writer nobody would think of, because it
names neither a habit nor a target: on a 24-week timeline, **185 lb gives
10,000 steps and 155 g while 150 lb gives 12,000 and 180 g**, and both ticks
survived the change.

It is not cosmetic, which v346 already measured: a wrong tick extends the
nutrition streak by a day and can unlock Perfect Day.

**Fixing the sheet alone would have left half the class alive** — a body-level
tap reaches the same field through `recomputeTargetWeight()`, a different door.

The floors carry the usual weight: the fix must work **both directions**
(lowering the bar ticks it again — a fix that only un-ticks passes every
assertion about the raise), a setter that moves nothing must leave a real tick
alone, and the sync must not create a day row out of nothing, which would put
an empty entry in every backup.

### And a FOURTH writer, found by sweeping rather than reading

Fixing those three left `clearGoalWeight()` — the mirror of the twin fixed in
the same round. Clearing the goal weight makes `timelineRateKgWk()` null, so
both targets drop back (12,000 → 10,000 steps, 180 → 155 g), which LOWERS the
bar: the habits should tick ON and stayed off. **Fixing one instance is not
fixing the class**, landing inside the round that quotes it.

It was found by driving all **48 zero-argument writers** in the app and asking
of each whether any derived habit was left disagreeing with its own target —
not by reading the diff. So the shipped check is written against the CLASS:
seven writers, each driven, each asserted to leave the habit agreeing.

**The class check was wrong twice before it was right, and both are entries in
this file.** Its first version used ONE setup for all seven, which left the
protein habit already OFF — so a mutant deleting `setProteinTarget()`'s sync
changed nothing observable and escaped: *a guard that cannot fire in the case
you tested is not tested.* Each case now builds a state where its own move
crosses the athlete's logged value, and **the FLIP is the guard** — a case
whose tick does not change cannot catch a missing sync at all. And the failure
detail had to be narrowed to the failing cases: dumping all seven truncated
past the one that mattered, so red did not say what.

### Three false alarms, and every one is a trap already in this file

- **"The projection prints the stable-goal copy for lean recomp."** It does
  not. Views never clear `innerHTML`, so a page-wide text search over Progress
  matched a **stale pane** painted before the goal changed. Driven per goal
  through `projectionHTML()` directly, every goal gets the right copy.
- **"`MAKEUP_CREDIT` is a missing map."** There is no such constant — I
  invented the name in the probe. The real one is `CARDIO_INFO`, and it is
  complete. *Confirm the control's real shape before believing the result.*
- **"The backup round trip is lossy."** The only delta was `normalizeState()`
  adding `prep.results:{}` — a legitimate container repair. The probe compared
  a pre-normalize snapshot against a post-normalize one.

Fifteen mutants, all caught. Three were **bad mutants**: two seeds
PREPENDED a dead `if(0)sync()` instead of removing the real call, so the
program was unchanged; and renaming
`syncProteinHabit` breaks its callers, so the suite threw rather than naming a
check — that tests nothing, and the real over-eager case is the one that makes
the step sync always answer false.

## The diet-break clock knew two of the three cuts (v365)

`noteGoalPhase()` counts how long an athlete has been eating at a deficit, so
the twelve-week diet-break guardrail can fire. It was a hand-written
`g==='shred'||g==='lose'`, and it went stale the moment a seventh goal arrived.

Measured against maintenance for one body:

| goal | under maintenance | clock ran |
|---|---|---|
| shred | 24.1% | yes |
| lose | 19.5% | yes |
| **leanrecomp** | **12.1%** | **no** |
| core | 5.1% | no (deliberate) |
| recomp / maintain | 0% | no |
| gain | −10.1% | no |

**The second half is worse than the first.** The `else` branch nulls the stamp,
so switching from a cut TO lean recomp — still a cut — **wiped the clock**: an
athlete ten weeks in read **zero**, and the guardrail was pushed indefinitely
into the future while they carried on eating at a deficit. The function's own
comment describes exactly this hazard, one goal over.

`core` stays out at 5.1%, which is today's behaviour and a deliberate line: its
own copy calls it *"just under maintenance so your abs work is fuelled"*, and
the guardrail exists for a sustained MEANINGFUL cut, not for any number below
TDEE.

### Two lists that coincide are not one list

`goalSlots()` also tests `shred||lose`, and the tempting move is to give both
sites `DEFICIT_GOALS`. That would be wrong and would silently undo the previous
round: lean recomp is excluded THERE on purpose, because the cardio slot swap
replaces a rep accessory with a timed movement and costs it the rep volume it
exists to keep (v363).

So they stay separate, and the floor is pinned: lean recomp keeps Tone up's 25%
cardio share rather than the fat-loss goals' 35%, and a check asserts
`goalSlots()` does not read the deficit list at all. The mutant that merges
them is caught by exactly that.

**The membership list is drawn from measured deficits, and the checks pin those
percentages** — a goal silently repriced would move which side of the line it
belongs on, and a list restated from opinion could not notice.

Seven mutants, all caught, including both over-eager twins: counting every
non-stable goal as a cut, and never clearing the clock (which makes the banner
unclearable — the defect the function's own comment records).

### And the break it offers dropped the protein it exists to protect

The same banner had a second per-goal assumption baked in: its button switched
everybody to `maintain`. **A diet break exists to keep the muscle**, and
`maintain` sits on the 1.8 g/kg tier — so a shred or lean-recomp athlete went
from **180 g to 155 g at exactly the moment protein matters most.** Backwards.

Both candidates are weight-stable, so either clears the clock. The one that
KEEPS the tier is the right offer: `recomp` for the 2.2 g/kg goals, `maintain`
otherwise — which already held the tier for `lose` and `core`, so those two do
not move. Measured, protein is now preserved on all four:

| break from | offers | protein |
|---|---|---|
| lean recomp | Tone up | 180 → 180 |
| shred | Tone up | 180 → 180 |
| lose | Maintain | 155 → 155 |
| core | Maintain | 155 → 155 |

**And the copy had to change, because it was promising something no goal
delivered.** "Same training, more food" is false wherever the rep multipliers
differ — which is every pair except lean recomp to Tone up. It now claims only
what the switch actually delivers (*keep training, keep the protein, add the
food*) and the button names the goal it is switching to, so a fix that changed
the destination and left the label saying "maintenance" fails its own check.

The floors are the two goals that were never wrong: sending everybody to Tone
up satisfies every assertion about shred and lean recomp and moves `lose` and
`core` for no reason. Thirteen mutants across the round, all caught.

### Four axes swept clean in the same round

- **The destructive paths against the session's new logs.** `restartProgram()`
  archives the run, clears `logs`, resets the pointer, and correctly KEEPS
  `grindLog`, `holdLog`, `skipLog`, `liftLog`, the personal records, the
  measurements and the prep block — they are lifetime records, not the block.
  `hardReset()` clears all of it and keeps only the three device credentials.
- **140 nutrition combinations** — seven goals x five bodies x four timelines.
  No `NaN`, no target below 1,000 kcal, no protein outside 1.0-3.2 g/kg, no
  cut above TDEE, no bulk below it; 38 correctly floored.
- **Re-entrancy on the new controls.** Starting a grinder twice leaves one
  sequence and one timer; double-tapping Stop writes one row; the hold test
  clears its old interval on a restart and writes one row on a double stop; no
  timer is left armed.
- **A bonus session cannot clobber a paused program session.** `_plResume` is
  written on reaching WORK, survives untouched through a whole grinder and a
  hold test, and is cleared only by a deliberate quit.

### Three false alarms, and two are traps this file already names

- **`confirm()` returns FALSE in a headless page**, so the first destructive
  sweep reported that nothing changed on either path. `addInitScript` did not
  hold it; setting `window.confirm` INSIDE the evaluate did.
- **`_plResume` "is never written."** It is written by `plEnterWork()`, and
  `openPlayer()` starts in the READY phase — the probe never drove the ready
  countdown down, so it measured a state the resume does not exist in.
- **"Saving a goal weight twice stores 364."** The seeded athlete is METRIC and
  the probe typed 165 meaning pounds, so 165 kg round-trips to 364 lb. The
  writer is idempotent. *Confirm the control's real shape before believing the
  result.*

## The one test the app refuses to give you, given by another door (v366)

The baseline battery's own screen has promised for many versions, in bold,
that a test to failure "is the most demanding thing this app will ever ask of
you, so it stays locked until you have spoken to a doctor". Measured on an
athlete who declared a **heart condition** and was never cleared:

| surface | what it asks for | in safe mode |
|---|---|---|
| baseline battery | ten maximal efforts | **locked** |
| six-week re-test | the same ten | **locked** |
| FORCE / FORCE Combat | four maximal efforts under load | **locked** |
| **Hold to failure** (v361) | five **open-ended** holds, no clock ceiling | **started** |
| **`gripmax`** | "one all-out hang" | **started** |

Five live rows, a clock that counts up and does not stop you, and nothing on
the screen mentioning the health check.

**`startHoldTest()` already called `safeSwap()`** — it asked one of the two
questions the battery asks and not the other. That is the exact shape
`safeSwap()` itself was forgotten by five sibling paths in, and the shape
`startForceTrain()` skipped `hasGearFor()` in: **a new path that asks for a max
has to ask every question the old ones ask.**

**Three paths had copied the same five lines by hand and two never got them**,
so the rule now lives in `maxEffortBlocked()` and every entry point asks it. It
has a side effect on purpose — the athlete lands on the screen that unlocks the
thing they just tapped, not on a dead toast — and it **fails closed**: if the
check throws, the answer is blocked, never fine. The check that catches that is
the one that makes `parqDone()` throw.

**A format that asks for a true max declares it.** `gripmax` carries
`max:true`, so `startSpecialFormat()` gates on the property rather than on a
name, and the next max format is covered the day it is added rather than the
day somebody remembers. It is bounded at three minutes, which is why it reads
as a format rather than a test — and it is still a named maximal effort on the
very movement the battery gates.

**A locked button with no sentence is a dead end**, so the sheet says why and
carries the one control that unlocks it. The past numbers still render: history
is history, and hiding it would punish the athlete for answering the screen
honestly. The rows are replaced rather than greyed out — a disabled *look* over
a live `onclick` sends them to the clearance screen with no idea what they just
did.

**The floors are what keep this a gate rather than a deletion.** An ordinary
timed hang (`grip30`, five 30-second hangs with rest) is not a max effort and
is never blocked; a cleared athlete gets all five holds and the max hang back.
The mutant that blocks everybody satisfies every assertion about the flagged
athlete and breaks the app for the athletes it is not for, and the mutant that
locks every grip format does the same one picker over.

### The same sheet had skipped the other question too

Found by asking, of the same five rows, what ELSE every picking path asks.
**The Dead Hang needs a pull-up bar** and the other four holds need nothing —
so the one that does sat in the menu unmarked. Measured on an athlete with an
empty gear list: the row rendered and the timer **started** on a movement they
cannot perform. `startHoldTest()` ran `safeSwap()` and never `hasGearFor()`,
which is `startForceTrain()`'s v322 defect one picking path over.

**It NAMES the kit rather than substituting**, for the reason v320 established:
a hold test measures ONE movement, and a stand-in measures a different capacity
under the same label. There is no honest substitute for a dead hang.

`holdMovement(t)` is now the one place that decides which movement a hold test
performs, so the row and the starter cannot disagree about what is being asked
for — including about whether the athlete owns the kit for it.

**The floor is the athlete who owns a bar.** A fix that simply dropped the row
satisfies every assertion about the athlete without one and deletes a real
test; a `holdKitMissing()` that answers yes for everything satisfies them too
and deletes all five. Both are caught.

**The Grinder was measured and deliberately NOT gated.** It is a prescribed
circuit of 60-second stations — the same family as Special HIIT, which has
never been gated — not a test taken to failure. Safe mode already eases every
prescribed session; a gate here would be over-reach, and over-gating is its own
harm.

**And the re-derivation check had to anchor on the ROUTING line, not on a bare
`safeMode()` read.** `prescribe()` reads it to ease the session and the fasting
card reads it to add a warning; counting those flagged correct code. The
assertion is that `if(!parqDone())openHealthCheck(); else openClearance();`
exists exactly once.

Fifteen mutants across the round, all caught.

## A change of ruler, in the tracker written after that lesson (v367)

v320 established it for the baseline battery and v321 for the prescription:
**`safeSwap()` protects a flagged joint, and the number coming back then
measures a DIFFERENT movement.** v361's hold tracker calls `safeSwap()` for
exactly that reason — its own comment cites the battery — and then recorded
only the test id. Two of the five holds are reachable and neither preserves
the capacity the test exists to measure:

| flagged | test | performs |
|---|---|---|
| shoulder | Dead Hang | **Bird Dog** |
| knee | Wall Sit | **Glute Bridge** |

Measured end to end. A shoulder-flagged athlete held a Bird Dog for **5:00**;
six weeks later, cleared, they held a real **45-second Dead Hang** — a good
dead hang — and the row read:

> **Dead Hang · Best 5:00 · last 45s · −255s on the one before**

A best they never set, on a movement they had not done, and a real result
reported as a large regression. Nothing threw.

**The record stamps the movement and both readers ask it.** `holdBest()` and
`holdTrend()` compare like for like only; the record stays RAW and the
COMPARISON is what is withheld — the same split `subs` uses on a baseline.

**Which movement is "the same" is the one this test performs for THIS athlete
today.** A flagged athlete's bar is their best Bird Dog; a cleared one's bar is
their best Dead Hang. Both are honest, and mixing them is the defect. The
tracker names the movement the number was set on rather than the test's
nominal one — printing "Dead Hang" over a bird-dog best is the lie in one
word.

**Unknown is not equal.** Every record written before this carries no movement
at all, so it is kept as history, shown, and left out of the comparison rather
than guessed at the nominal movement — v320's call about a baseline with no
`subs` stamp. **A withheld number needs a sentence**, so the row says how many
earlier holds are on a different movement and that they are kept, not compared.

**The floors are what stop the fix being a delete.** Both athletes must still
get a best and a real trend on their own movement, driven through
`stopHoldTest()` rather than by calling `logHold()` — the writer bug that
survived four checks in v320. A `holdSameMovement()` that answers false for
everything satisfies every assertion about the mixed case and deletes the
feature; a repair that drops the incomparable rows satisfies them too and
destroys real history. Both are caught.

### Two existing checks failed on correct code, and the record was what was wrong

`driveHold()` seeded a prior with no movement on it, so the same-movement rule
correctly refused to treat it as this athlete's bar and the grind-line point
never fired. **The record was incomplete, not the rule** — a like-for-like
prior is one that says which movement it was held on, exactly as v321's prior
needed `subs:{}`.

**And a `\n` inside a template literal is a real newline**, so a
`replace(/\n/g,' ')` written into a function-as-a-string broke the regex and
the suite reported *"the test file itself threw"* rather than naming a check.
Escape it as `\\n` when the helper is carried into the page as text.

### And the two cards v366 did not reach

Found by asking the same question of every screen the gate protects: v366 gave
the hold sheet a locked note, and **the FORCE and FORCE Combat cards still
showed a live "Train the four tasks" and "Run the circuit" with no mention of
the health check.** `maxEffortBlocked()` correctly refuses on the tap, so the
athlete tapped and landed on the clearance screen with no idea what they had
just done. *A locked button with no sentence is a dead end*, one round after
writing that down — and the gate has been on those two cards since v322.

`maxLockNoteHTML()` is the one renderer, for the reason `forceKitHTML()` is
one: three surfaces saying the same thing, and two of them said nothing.

**The rest of each card survives.** Logging a past result is not a maximal
effort and is never taken away — a note that ate the screen would satisfy
every "it says why" assertion.

**One escaped mutant was fixed by pinning the renderer's own contract**, and
one is genuinely equivalent:

- Every caller already guards on `safeMode()`, so the renderer's internal
  guard is consulted in no branch a screen can reach — v338's
  `prepDatePassed()` shape. It is pinned directly instead: silent for a clean
  athlete and for a cleared one, routing to the health check when unscreened
  and to clearance when flagged, and **silent when the check throws** — the
  GATE is what fails closed, so the note's own failure mode is saying nothing.
- `_ve(what)` cannot be caught. Every caller passes a literal, so no reachable
  route feeds it user content; it is kept as cover for a future caller. Read
  the mutant back before rewriting the check — the same call as v287's
  `wantAnchor`.

Seventeen mutants across the round, sixteen caught and one equivalent.

## The last two hand-written lists over CARDIO_MODES (v368)

`movementHTML()` chose the per-mode block with a five-branch chain, and
`openMakeupTimer()` chose its shape with `mode==='jacks'||mode==='skip'`. Both
have an ELSE that swallows everything they do not name — the shape that
credited a ruck as jumping jacks (v327), told a runner to do jacks (v328) and
left the ruck and the run out of the weekly bar (v329), three rounds running.
A sixth mode would have rendered the **jacks block, inputs and all**, under
its own label.

**Nothing here is a live defect today**, and saying so matters: `cardioMode()`
is a membership test, so no out-of-set value reaches either surface. This is a
latent-class fix, and the honest way to make one is to prove it changes
nothing — every mode's card and make-up sheet is **byte-identical** to what
the chain produced, measured before and after.

**The lockstep is enforced in `validateData()`**, so an incomplete registry
fails at boot rather than on a phone: every mode declares a `block` builder
and a `timer` shape, no two modes share a builder, and no registry key is
missing from `CARDIO_MODES`.

### Reverting either consumer is byte-identical, so only the source can see it

Two mutants escaped every rendered assertion — putting the chain back, and
putting the 2-of-5 test back — because on today's five modes they produce
exactly the same output. That is v322's `WEIGHTS_PATTERNS` lesson: **the check
needed the consumer to READ the list, not merely for the list to exist.** The
declaration still stands with the consumer hand-written, which is the drift
the registry exists to stop. Both are now asserted on the source.

### Three more escapes, all of them lessons already here

- **Measure the payload, not the container.** Every timer-shape assertion read
  `CARDIO_INFO[k].timer` — the input. A mutant hardcoding every sheet to the
  work/rest shape left those values untouched and escaped. The check now drives
  `openMakeupTimer()` and counts the controls the sheet really renders, with
  the two modes that must NOT have them pinned beside it.
- **A rule that cannot fire on today's data is not tested.** The orphan rule
  (`CARDIO_INFO.x` not in `CARDIO_MODES`) is unreachable, so it is exercised
  directly by adding a junk key and requiring the specific complaint — the same
  technique the hardness-band and anchor-unit guards use.
- **A validator rule needs the data broken in front of it.** The shared-builder
  rule passed on nothing until a check pointed two modes at one builder.

**And `validateData()` LOGS**, so every deliberate break has to mute
`console.error` — the harness counts a console error as a page failure. Hit
again, for the third time in this file.

### The finisher slot went to whichever pattern was first in a two-item array

Found by the sweep that asks the opposite question: **which exercises can no
path ever reach?** Across 378 sessions x five athlete configurations, plus
every pool, ladder and swap map, eleven of 197 came back unreached. Three
(`sprint`, `ruck`, `skip`) are cardio-mode entries the probe could not see and
`warriorthree` is reachable in the custom builder — but the other seven were
real, and the cause is one line.

Seven base patterns fill seven slots, `items.slice(0,8)` is the cap, so the
finisher loop added `WEIGHTS_PATTERNS_EXTRA[0]` and broke. **`cardio` has
exactly ONE member in the whole library and `power` has nine.** Measured over
200 circuits:

| athlete | cardio | power |
|---|---|---|
| owns every piece of kit | **200** | **0** |
| owns kettlebell, dumbbell, medball | 0 | 200 |

So the snatch, the get-up, the thruster, the man-maker, the devil press and
the slams were unreachable **for the athlete who owns the most kit** — and
buying a battle rope is what took them away. That is v322's `pattern` defect
(0 appearances in 400 circuits) one line over, with the ORDER of a two-item
array as the cause instead of a value outside the list.

The finisher is now drawn from every conditioning movement the athlete owns,
shuffled, rather than from whichever pattern sorts first. Measured after: all
ten appear 26-36 times in 300 circuits, and the circuit is still eight slots.

**"More kit must never mean fewer movements" is the check that states the real
property.** A fix that merely reversed the order passes every "power is
reachable" assertion and hands 100% of the slot to a different movement; that
mutant is caught by the "no one finisher takes more than half the slot" check
beside it.

**And one equivalent mutant, measured rather than assumed.** Lifting the
`items.length>=8 || added>=2` guard changes nothing: extras are appended AFTER
the base patterns and `items.slice(0,8)` is the operative cap, so only the
first two can ever survive whatever the loop does. Kept as intent and as the
expression of the "at most two finishers" rule.

Thirteen mutants across the round, twelve caught and one equivalent.

## The screen instructed what the gate refused (v369)

v366 locked the FORCE tasks for an uncleared athlete and v367 gave the card a
note saying so. The **midpoint prompt four lines above it** still read:

> Midpoint assessment due. You are halfway to your test date. **Re-run the
> four tasks** and log the times.

So one screen told the athlete to do a thing and, a few lines down, told them
they may not. That is *a promise in UI text is a specification* facing the
other way — the app instructing an action it blocks — and it is the same
family as the health screen that promised safe mode while `prescribe()` never
called it.

**The checkpoint is still DUE and the prompt still fires**, which is the part
that makes the fix right rather than a deletion. **The FORCE evaluation is
administered by a unit, not by this app**, so an athlete tested elsewhere has
a real number to type in and `Log a result` was never taken away. Only the
half the app hosts is withheld, and the prompt says which half and why.

**Fixing one instance is not fixing the class**: `prepMidHTML()` says the same
sentence twice — once when the assessment is due and once as a countdown in
the window before it. The countdown had to move too, and the mutant that
reverts only it is caught by its own check.

**The floors carry the weight.** A cleared athlete's copy is byte-for-byte
what it was; the mutant that gives everybody the locked wording fails there.
And hiding the midpoint prompt for a locked athlete satisfies every "they are
not told to re-run them" assertion while losing the checkpoint the whole block
is built on — caught by a check that the prompt still appears and the log
button still works.

Five mutants, all caught.

## The prompt asked for four maximal efforts during the taper (v370)

The same card v369 fixed, one question further on: **when does the midpoint
window close?** It did not. `prepMidDue()` was `checkpoint==='mid'`, and the
mid checkpoint runs from halfway to the test date — so the prompt fired
through the sharpen phase, through the taper, and **on the day before the
evaluation**.

`PREP_PHASE_NOTE.taper` says, in the app's own words:

> Volume comes down and the intensity stays... **You cannot gain fitness now —
> you can only arrive tired, so do not.**

And four lines away the card said *"Re-run the four tasks"* — four maximal
efforts under load. Two sentences the app owns, on one block, in flat
contradiction. **A note in `PREP_PHASE_NOTE` is a specification**, which that
map's own comment already says.

**The window closes when the taper opens, and that is the taper's rule rather
than a new one.** It is also honest on the prompt's own terms: a midpoint
assessment is what *"turns the second half of the block into a correction"*,
and inside the taper there is no second half left to correct.

### And its first sentence was simply false

> **You are halfway to your test date.**

True on the first day of the window and nowhere else. Measured: it said that
**three weeks out on a twelve-week block**, and the day before the evaluation.
It now names the window it is in and how long is left to use it — true, and
actionable, which the old line was not.

**A window that closed with nothing in it says so.** Silence would read as the
earlier prompt having been a glitch, and keeping the prompt asks for the one
thing the taper exists to prevent. The note names the taper length from
`PREP_TAPER_WEEKS` rather than restating it, and logging the evaluation itself
is never taken away.

**Three floors carry the round.** The build and sharpen phases must still be
asked for the assessment — a window that is never open satisfies every
"the taper is not asked" assertion and deletes the checkpoint. An athlete who
DID record a midpoint must see no missed note and keep their record. And the
window must not close a phase early, which the sharpen floor catches.

### The check failed on correct code, on a trap already in this file

`.section-label` is uppercased in CSS, and **`innerText` returns the RENDERED
text** — so `/Midpoint/` failed on a screen that was perfectly right. Read
`textContent`. That is v296's finding verbatim, hit again three-quarters of a
suite later.

And two guards were wrong before they were right: 13 weeks left is `base`, not
`build` (`build` is `left<=12`), and 6 weeks left is already `sharpen`
(`PREP_SHARPEN_WEEKS` is 6). **A guard that asserts the wrong phase boundary
fails on correct code and tells you nothing about the defect.**

Seven mutants, all caught.

## Two cards on one screen, disagreeing about the same week (v371)

v370 closed the midpoint window at the taper. The next question of the same
block — *does anything else prescribe against the taper?* — found the ruck
card doing it in one sentence.

`climbing` is computed from the four-week cycle slot, which knows nothing
about the phase. Measured at two weeks out:

| card | says |
|---|---|
| running | *"Volume comes down and nothing gets sharper."* |
| **rucking** | *"What moves this week: **The distance**. The load holds."* |

…while the ruck distance was cut **10.7 km → 7.1 km**, a third of it. The
running card was already honest; the ruck card, on the same screen and the
same week, claimed the opposite.

**Set in `ruckLadderWeek()` rather than in the renderer**, so a future
consumer gets the truth instead of only this one card — the same call
`side:'switch'` makes for the steps, the session card and the player.

**The down week keeps its own answer.** *"Nothing — this is the down week"* is
accurate inside the taper too, so `climbing` stays `'neither'` there and the
mutant that relabels it is caught.

**Three floors carry the round.** A distance week must still say the distance
is moving and a load week the load — a fix that said "nothing is being built"
everywhere satisfies every taper assertion and deletes the plan's whole point.
And the oldest rule of this plan still holds through the taper: the load holds
while the distance falls, never both moving.

### And the same question of the NUMBER found a real one

The label fix broke a v340 check — *"both paths raise the plate the same
number of times"* — and that failure was the finding. The two ladders are
offset by one slot, so:

| path | fourth plate step |
|---|---|
| operator | 3 weeks out — sharpen |
| **assaulter** | **2 weeks out — inside the taper** |

**30 lb → 35 lb, a fortnight before the evaluation**, on the path whose own
note says *"you want to arrive fresh under load"*. Nothing caught it because
every check counted the STEPS and none asked WHEN — and the check that finally
went red did so because the LABEL moved, not because it was looking at timing.

**The step is not dropped.** Dropping it leaves the assaulter 5 lb lighter for
the whole block, which is a bias in VOLUME — the one thing v340 says the two
paths may never differ in. It is taken at the last working week before the
taper instead, so both paths reach the same plate under the same ceiling and
neither adds load in the fortnight that exists to shed it. Measured after:
four steps each, 35 lb each, zero steps in the taper.

**And the boundary was off by one on the first attempt.** Week `w` has
`left = totalWk - w`, so the taper opens at `totalWk - TAPER_WEEKS`, not one
later. The wrong version let the assaulter's step through unchanged — caught
by measuring the ladder path by path, not by any assertion about the
arithmetic. **Drive the plan and read the plate.**

Eleven mutants across the round, all caught.

## The taper eased two of the three training streams (v372)

v370 and v371 fixed the taper contradiction in WORDS. This is the place it
cost real freshness.

The running plan cuts volume in the last fortnight. The ruck ladder cuts
distance and holds the plate. **The strength program ran at full volume
through both** — measured at 12 weeks out, 3 weeks out and the day before the
evaluation: 5 movements, 10 sets, byte-identical every time.

`PREP_PHASE_NOTE.taper` is a specification, and it says *"you cannot gain
fitness now — you can only arrive tired, so do not."* The app applied that to
two streams out of three.

**A FOURTH AUTOMATIC DELOAD TRIGGER, not a new mechanism.** `deloadOn()` is
already a composite — manual flag, calendar week 6, readiness slump, load
spike — and the taper joins it, so it eases exactly as the other three do.
Measured: **12 sets and 390 units of work become 8 and 218.**

**v310's rule is untouched.** A deadline may never ADD work; that is why the
timeline never moved strength progression. This only ever removes it, in the
fortnight the taper exists for, and the floors pin that nothing outside the
taper changes at all: no test date, build and sharpen are byte-identical.

**A quiet 44% cut reads as a bug**, so the banner names the taper as the
reason — and the taper copy must not swallow the others, which the calendar
floor catches.

**An athlete who turned automatic deloads off keeps that choice.** The taper
is a fourth automatic trigger, not an override of one; the mutant that lets it
through the opt-out is caught.

### It fails closed, and that matters more than it looks

`deloadOn()` catches for the WHOLE composite, so a throw from the new trigger
would discard the calendar week and the readiness slump with it — turning a
REAL deload off. Nothing reachable exercises that path, so the contract is
pinned directly (the v338 `prepDatePassed()` shape): the trigger answers no on
a throw, and a genuine calendar deload survives it.

### And the probe walked into a trap this file already records

The first measurement used pointer 40 and reported that the deload flag
changed nothing. **Pointer 40 is week 6 of 6 and therefore already a deload
week**, so both readings agreed — recorded in v365 as a probe error and hit
again here. The check now picks a pointer that is not one, and a guard asserts
it.

### And the brief never mentioned the evaluation at all

Measured across every phase — no date, build, sharpen, taper, the day before:
**silent every time**, while the prep card counted down beside it and, after
the fix above, the session quietly eased underneath it.

The brief is the segment the coach **reads aloud**, and v315's rule is that a
spoken line is the one an athlete cannot double-check by looking. For sixteen
weeks the evaluation IS the mission, so the segment sits beside it.

**It says something different per phase**, because one line repeated satisfies
every "it is mentioned" assertion and tells the athlete nothing: the build
says the volume still climbs, the sharpen says it stops, and the taper says
the sessions ease and why — *"you can only arrive tired, so we do not"*, the
plan's own words, now spoken on the morning it applies.

**It says nothing at all when no block is running**, and the countdown is a
real number rather than a fixed phrase. Both mutants are caught.

Twelve mutants across the round, all caught.

## The watch import wrote minutes without saying they were minutes (v373)

`saveActivityRead()` sets the unit for the run, the ruck and skipping. For the
bike and the jacks it wrote a bare number — and the readers priced it in
whatever unit the athlete had last left the field on. Measured on a real
import:

| mode | field left on | imported | read back as |
|---|---|---|---|
| bike | distance | 30 min | **30 km = 100 min = 893 kcal**, against ~268 |
| jacks | reps | 20 min | **20 REPS = 0.4 min = 3 kcal** |

**Over-crediting is the worse direction**, because movement earns calorie room
on the surplus — so 893 kcal goes straight into the food budget for a ride
worth 268.

Same shape as v337's label and number written as two expressions: **the pair
has to move together.** Three of the five modes already did it; these were the
two that did not.

**The floors are the three that were already right**, and they are what stops
the fix being "force minutes everywhere": a run that carries a DISTANCE must
still store a distance, and the mutant that forces `min` there is caught.

Five mutants, all caught.

### Three false alarms in the same sweep, and all three were the probe

The round began with the dead-control sweep — *is there a control the athlete
sets that the program never reads?* Ten controls, fingerprinted across 60
built sessions plus the warm-up, calorie target, meal plan and both prep
plans. Three came back dead and **every one was the probe**:

- **`settings.repTempo`** — the fingerprint covered the session BUILDER and
  not the player. It moves `plBudgetMin()` from 21 minutes to 28.
- **`profile.timelineWeeks`** — `kcalTargetPreview()` reads the PROFILE copies
  of height, age and sex, and the probe had set only the nutrition ones. Given
  both, it is very much alive: **1950 / 2240 / 2510 kcal** at 12 / 24 / 52
  weeks.
- **`nutrition.meals`** — fed a `5`, which the app never offers, without
  calling `normalizeState()`. The boot repair coerces it (`>=4 ? 4 : 3`) and
  the picker offers only two values. With 3 and 4 the plan really changes.

A guard written first — *every field path must exist in `DEFAULT_STATE()` and
every function must be a function* — also caught **three invented field
names** before any measurement ran. That guard is the one thing that keeps
this sweep honest; v322 recorded the same lesson after half of a dead-control
probe's findings turned out to be its own bad key names.

## The photo repair used truthiness where membership belonged (v374)

The same pair v356 fixed for the five activity logs, never applied to the one
record this app calls irreplaceable. Measured:

| stored | survived the repair | what it did |
|---|---|---|
| `pose:'helicopter'` | yes | the gallery groups by `POSE_KEYS`, so the photo was **invisible in every group** while still travelling in every backup |
| `date:'not-a-date'` | yes | printed **"not-a-date · front"** on the glass, and `photoPair()` picked it as the **NOW** — a 90-day transformation shown against an undated shot instead of against today's real one |

`poseOf()` already existed as the membership test and `isDateISO()` as the date
test. The repair was asking neither.

**THE BYTES ARE NEVER DROPPED, and that is this repair's own stated rule.** Its
comment already says so — *"the bytes are the one thing in the whole state that
cannot be re-created, so a missing view is worth guessing at and a missing
photo never is"* — which is exactly why the fix here is the OPPOSITE of v356's:
an activity row with a junk date is deleted, a photo with one is repaired.

- The **pose** is repaired to a legal one, so the photo becomes visible again.
- The **date** is blanked rather than invented. The row keeps its picture, the
  gallery caption says *no date*, and `photoPair()` leaves it out of a
  comparison it cannot honestly make. Unknown is not equal (v320).
- `photoFileName()` already guarded both halves and names it
  `coreforge-undated-front.jpg` — that path was correct and stays.

**Two over-eager mutants carry the round.** Deleting the junk row satisfies
every "the comparison is honest" assertion and destroys the irreplaceable
thing; forcing every pose to `front` satisfies every "a junk pose is repaired"
assertion and destroys the back and side shots. Both are caught, and a clean
gallery is asserted byte-identical.

### And a page-wide match let one mutant through

`/no date/i` over the whole view also matches the projection copy, so the
mutant that printed a blank caption escaped. **Scope the assertion to where
the change was made** — the check now finds the tile by its `data-pid` and
reads that caption. Same lesson as the v267 warning icon that existed in two
places and was asserted in one.

Seven mutants, all caught.

## The rescue existed and it cost the athlete their position (v375)

Reported from the phone for the SECOND time: *"after one set followed by the
rest time, everything stops and I am forced to press [the] hold timer to start
the other set... sometimes I am already in the exercise position thinking I am
starting the next set only to realize after the rest countdown everything stops
and I am forced to leave my exercise position, get to the phone."*

v350 investigated the first report, **could not reproduce the stall**, and
removed a dependency rather than chasing a cause: `plResync()` on
`visibilitychange` re-arms the tick and reconciles against the stored deadline.
That was right and it was not enough. **It is still a rescue that needs the
athlete at the phone**, which is the whole of the complaint.

Measured this time, with the interval killed and no `visibilitychange` fired:

| state | what happens |
|---|---|
| tick alive | rest ends, the next set starts. No tap. |
| **tick reclaimed** | **phase stays `rest` for ever — `tid` null, `remain` frozen at 3** |
| the athlete wakes the phone | it recovers instantly |

**One rescue path, and it is the one that costs the position.** The three rest
buttons measure **123 x 52** and neither the ring nor the photo is tappable, so
when it does stall the athlete must walk over AND hit a small target.

### The heartbeat owns its own interval

`plClear()` is what the phase code uses to drop a tick, and it is also what a
frozen page effectively does. So the guard cannot live on `PLAYER.tid`. It is
its own 2-second interval that nothing in the phase code touches.

**A phase change legitimately leaves `tid` null for an instant**, so a missing
tick only counts once the phase has been settled for `PL_STALL_MS`. Without
that, the guard would fire between `plClear()` and the next `setInterval` and
re-arm the phase that is being LEFT. `phaseAt` is stamped at all four phase
assignments for exactly this.

**It is armed once at boot, not by each opener.** Arming per surface is how a
third surface gets forgotten, and this file records that shape five times over.
The cost with nothing open is two null tests every two seconds.

### Tap anywhere — but only while it is actually stuck

Making the whole screen skip the rest would be worse than the bug: one stray
touch would cost the athlete their whole rest. The screen advances only while
`timerStalled()` is true, which is a state a working session never reaches. The
listener is on the bubble phase so a real button still acts first. The mutant
that drops the stall test is caught by the floor: a tap during a working rest
must not skip it.

### HIIT is the twin v350 did not reach

The guided player got a resync on every return to the page. **Its interval
sibling got nothing at all** — no `visibilitychange` listener, no re-arm — so a
HIIT round whose tick the OS reclaimed sat frozen with no rescue whatever. Same
hole, one surface over, and the fourth time the player's twins have drifted.

One predicate answers for both. `PLAYER` and `INTV` are different objects with
the same four fields that matter, and two copies of the test is two places for
it to drift. `hiitToggle()` now shares `ivArmTick()` with the resync instead of
repeating which tick each phase needs.

### The deadline a phase does not own

`plEnterRest()` sets `PLAYER.deadline`; the get-ready and a rep set never
cleared it, so both opened holding a deadline that had **already passed**.
Harmless until something read it — and the heartbeat reads it, so a perfectly
healthy set would have been declared stuck on its first beat. Both clear it
now, and two checks pin that a fresh get-ready and a fresh rep set never read
as stalled.

### The contract is pinned directly

`timerStalled()` is consulted from three narrow branches, so its own contract is
asserted rather than only its effects — the shape v338's `prepDatePassed()`
needed. Nine cases: nothing open, paused, done, healthy, a phase that just
switched, a tick that vanished, a deadline long gone, a deadline a moment gone,
and a surface with no phase yet.

The floors carry the round, and every over-eager mutant fails one of them: a
paused player must stay paused (resuming one restarts a session the athlete
deliberately stopped), an ordinary rest must still count down and must survive
a tap, and an ordinary HIIT round must be left alone.

## Say "continue", and the next set starts (v376)

Asked for immediately after v375: *"so I can just say continue and the new set
starts."* v375 removed the STALL. This removes the TAP — the athlete holds
their position and never reaches for the phone at all.

**ONE WORD, AND IT ONLY EVER MOVES FORWARD.** That is the whole safety
argument, and it is a deliberate limit rather than an unfinished feature. A
misheard *"stop"* would end a session; a misheard *"continue"* costs at most an
early rest, and the `+15s` button puts it straight back. So there is no voice
command that stops, pauses, quits or skips an exercise: the stop-for-pain
button stays a deliberate tap, which is this app's oldest safety rule and not
something a microphone gets a vote in. The check for it is a source assertion,
because the absence of a route cannot be driven.

**It listens only where the word can act** — the player's rest, and either
surface while `timerStalled()`. Listening through a working set would spend the
microphone and the battery on a phase where the word does nothing, and every
extra second of listening is another chance to mishear.

### The app talks itself forward, and that is not hypothetical

The coach names the next movement during rest. The library carries steps
reading *"Continue alternating, walking forward."* Anything heard while the
synthesiser is speaking — plus a 900 ms tail — is thrown away, and without that
guard the app walks itself into the next set. The mutant that drops it is
caught by a check that primes the tail and asserts the rest survives, with the
floor beside it: once the tail has passed, the athlete is heard again.

**A guard that always refused would satisfy every "the coach cannot trigger
it" assertion** and make the feature do nothing at all. That floor is what
catches it.

### Absent, not off

`settings.voiceCmd` is **absent** until the athlete taps it — the `voicePitch`
rule, and a microphone is the last thing in this app that should open by
default. The mutant that flips the test to `!==false` opens the microphone for
everybody and is caught.

It reaches a chip and a rest screen and `importData()` accepts arbitrary JSON,
so it is repaired at boot: **`!== undefined`, not `!= null`**, because absent is
the contract and a stored `null` is a junk key that travels in every backup.

### Armed by the heartbeat, for the heartbeat's own reason

v375's guard already knows which surface is open, so it opens and closes the
recogniser too. Arming per opener is how a third surface gets forgotten — the
shape this file records five times over — and it means the microphone
**closes** when the session ends rather than depending on a teardown
remembering. A recogniser left running is a battery and privacy cost with
nothing on screen to explain it, and the mutant that never stops it is caught.

**A refused microphone turns the setting off** rather than retrying for ever:
Chrome's `onend` fires immediately against a denied permission, so an
unconditional restart is a spin loop the athlete cannot see.

### The confirmation is heard, not seen

A rising two-tone (700 → 1050 Hz) fires **only when the word actually moved
something**, so it can never confirm a word that did nothing. It is distinct
from the falling reposition pair (880 → 520) and the flat rep count (880) —
this app has three paired cues and each has to be tellable apart by ear alone,
because that is the whole point of a hands-free signal.

The rest screen names the word it is listening for. A feature the athlete
cannot see is one they will not use, and the rest screen is where it acts.

Twelve mutants, all caught, including both over-eager twins: a word that can
act in any phase, and a repair that wipes a real choice.

## A tick is not a second, and five surfaces treated it as one (v377)

v375 gave the guided player and HIIT a wall-clock anchor and a heartbeat.
**There are SEVEN timed surfaces in this app, not two.** Found by sweeping for
the SHAPE of v375's own defect rather than by using the app — which is the
fifth round running where the best finding was in the round immediately
before.

| surface | wall-clock anchor | recovers a dead tick |
|---|---|---|
| guided player | yes | yes *(v375)* |
| HIIT | yes | yes *(v375)* |
| warm-up / cool-down flow | **yes** | **none** |
| baseline test | **none** | **none** |
| hold test | **none** | **none** |
| assessment rest | **stored and never read** | **none** |
| hold / rep timer | **none** | **none** |

`plTickHold()` has carried the floor since it was written, with a comment
naming exactly this hazard — Chrome throttles a hidden tab to about one tick a
minute, and an OS can reclaim the interval outright. The count-UP timers did
`elapsed++` and nothing else.

**Measured, ticks stopped for six real seconds:**

| | before | after |
|---|---|---|
| hold test | **8 seconds lost**, no recovery | 1 s (rounding), recovers |
| baseline test | **7 seconds lost**, no recovery | **0 s**, recovers |
| warm-up flow | frozen for ever | recovers |
| an ordinary uninterrupted hold | — | **zero drift** |

**These two are the worst place in the app for it, and that is the argument
for the round.** They measure a MAXIMAL EFFORT: one anchors every prescription
for a year, the other sets a personal best. A silently short number is worse
than a frozen screen, because a frozen screen is visible and this is not.

### The floor is a floor, in both directions

`tickUp()` is `Math.max(elapsed+1, realSeconds)` — the same shape the
count-down floor has always used. It can never run slower than the wall and
can never be wound *backwards* by a clock jump. The mutant that returns bare
real time escapes every "it counts real seconds" assertion and is caught by
the check pinning that it never winds a counter back.

**And the floor must not distort a normal run**, which is the floor under the
floor: an ordinary uninterrupted hold counts 4 real seconds as 4. A fix that
merely made the clock run fast would satisfy every "no seconds lost" assertion.

### The rescue lives in one registry, not five call sites

The five surfaces keep their tick in a closure, so each hands its own function
to the object the heartbeat can see (`S.tick`) rather than the heartbeat
guessing at names. `timedSurfaces()` is the one list; a sixth surface joins by
adding a line there rather than by remembering to write a resync.

### The anchor was already stored and never read

`startAssessRest()` has written `started:Date.now()` since v296 and nothing
ever read it. A rest counted in dropped ticks runs LONG, which is the harmless
direction — but the two minutes between maximal efforts is the whole point of
that screen, and the value it needed was sitting in the object.

### Two anchors that were byte-identical, and the assert earned its keep

`function tick(){ if(phase==='ready'){ ready--;` appears **twice** — the
hold/rep timer and the warm-up flow, comment and all. The patch script's
`assert count == 1` turned a bad anchor into a clean no-op instead of a
half-applied edit, and reading it back showed both sites genuinely needed the
same edit. The count is deliberately 2, with a comment saying so.

## The note was dynamic, and it still read as leftover (v378)

Reported from the phone with a screenshot: *"I selected lean recomp, but the
writing below the tabs is still referring to tone up selection from earlier.
it is not dynamic, but it should be based on what is selected above."*

**It IS dynamic, and the report was still right.** Driven on the real Fuel
picker: `setNutGoal('recomp')` paints Tone up's note, `setNutGoal('leanrecomp')`
paints lean recomp's, and both `profile.goal` and `nutrition.goal` follow. The
text on his screen was genuinely `leanrecomp`'s own note.

The defect is the WORDING. It opened with the words **"Tone up"** — which is a
button sitting directly above it in the same picker — so it could not be read
as an answer about the goal just chosen. His reaction is the proof, and no
amount of correct wiring fixes it.

### Its own name is fine; another option's name is not

That distinction is the whole rule. `gain`'s note opens *"Build muscle on a
slight surplus"*, which is the goal naming **itself** — helpful, and it must
stay legal. Only a note that opens with a DIFFERENT option's label collides,
because the reader has that label in front of them as a button.

**A first pass called this three instances and the measurement said two.**
`gain` was counted as a third and it is not one. Recorded because the
correction came from sweeping rather than from reading.

### The class, swept rather than assumed

Every registry in the app that carries per-member copy — **7 registries, 68
members**:

| registry | members with copy | notes opening with another option's label |
|---|---|---|
| **GOAL_NOTE** | 7 | **2** |
| ACHIEVEMENTS | 30 | 0 |
| TESTS | 10 | 0 |
| SPECIAL_FORMATS | 7 | 0 |
| CARDIO_INFO | 5 | 0 |
| HOLD_TESTS | 5 | 0 |
| PREP_PATHS | 2 | 0 |

Four more registries — diet, timeline, activity, gear — carry **no per-member
copy at all**, so an empty result there proves nothing and is not counted as
coverage. Saying which registries the sweep could not speak for is the
difference between a measurement and a reassurance.

### The rule lives in the validator, not in two hand-edits

Two rewritten strings fix today. A `validateData()` rule fixes the class: no
`GOAL_NOTE` value may open with any OTHER goal's button label, emoji stripped.
A future note written the same way fails at boot rather than on a phone.

**A clean validator proves nothing about a validator rule** — it stays clean
whether the rule exists or not. So the check breaks one note in front of it,
requires the specific complaint *and* that the complaint names the label it
collided with, then restores. `validateData()` logs, so `console.error` is
muted across the break or the harness counts it as a page failure.

The floors carry the round, and both over-eager mutants fail one: a rule that
also rejects a note opening with its own label kills `gain`'s perfectly good
copy, and a rule that rejects everything satisfies every "the bad note is
caught" assertion while making the validator useless.

## A rescue is the wrong place to be optimistic (v379)

Found by fuzzing the code shipped one round earlier — the fifth round running
where the best finding was in the round immediately before, and the second in
a row where the finding was in my own new code.

Both of v377's helpers failed OPEN, in a subsystem whose rule is to fail
closed.

### tickUp() could return NaN

```
tickUp({elapsed:'x'})            -> NaN
tickUp({startedAt:'y',elapsed:3}) -> NaN
```

A junk `elapsed` CONCATENATES (`'x'+1` is `'x1'`, and `Math.max('x1',0)` is
NaN); a junk `startedAt` makes the subtraction NaN. **This number is written
into the record, not merely shown** — it is the count of a maximal effort, one
of which anchors every prescription for a year and the other of which sets a
personal best.

**The two ways of being wrong are not symmetrical.** One second short is a
rounding error. A NaN is a lost test, and it travels into `holdLog` and the
baseline record.

### tickResync() left a runaway armed

The forced tick sat inside the function's single `try/catch`, so a tick that
threw was swallowed, `tickResync()` returned **false** as though nothing had
happened — and the interval armed one line above kept firing and throwing
**once a second, for ever**.

Measured: **4 throws in 3.5 seconds, 3 page errors**, with the caller told it
did nothing.

That is worse than not rescuing at all. A rescue that cannot run must clear
what it armed and say so.

### Neither is reachable, and both are kept

On today's five surfaces `startedAt` and `elapsed` are only ever set to real
numbers, and all five ticks guard themselves. So no route feeds either one
junk — which is exactly why both contracts are **exercised DIRECTLY** rather
than through a screen, the technique this file already uses for the
hardness-band and anchor-unit guards.

**The floors are what stop the fix being a deletion.** `tickUp` must still be
a floor (nine real seconds beat two counted ticks) and must still never wind a
counter backwards; a healthy tick must still be re-armed and must still keep
ticking. The over-eager twins fail exactly there: a `tickUp` that always
returns `elapsed+1` kills the floor v377 exists for, and a `tickResync` that
tears down every tick makes the rescue useless while satisfying every
"the runaway is gone" assertion.

### The measurement corrected me on one escape and confirmed the other

Two mutants escaped the first run, and reading them back — by running three
variants of `tickUp()` over 18 junk shapes and diffing — split them:

- **The final NaN backstop is EQUIVALENT.** Zero differences in 18 cases: with
  the two upstream guards in place `out` can never be NaN. No check can catch
  its removal. Kept as intent, the same call as v287's `wantAnchor`.
- **The `startedAt` guard is NOT equivalent, and my check was weak.** Two
  differences, and they exposed a hole in the guard itself. **An ARRAY is
  TRUTHY and coerces to 0**, so `startedAt:[]` made the subtraction
  `Date.now()-0` and reported **1,787,973,936 seconds** as the length of a
  hold — a huge FINITE number that no `isFinite()` layer can see. A stored
  `0` did the same through my own guard, because zero is finite.

The check had tested only a STRING `startedAt`, which the `isFinite(real)`
layer already caught. **Assert a PLAUSIBLE value, not merely a number**: no
hold in this app runs past a day, so anything beyond 86,400 is a coerced
timestamp leaking through. The guard now requires `startedAt > 0`, and three
re-seeded mutants — the original escape, a zero timestamp, and "anything
truthy" — are each caught by name.

Ten mutants: nine caught, one equivalent.

### Five axes swept clean in the same round

Recorded as coverage, because a clean measurement is a result:

- **Memory and listeners across 30 open-and-close cycles** of all four timed
  surfaces, with collection forced before every reading: nodes **365 flat**
  and listeners **33 flat** from cycle 1 to cycle 30; the heap climbs 0.23 MB
  over the first ten and 0.07 MB over the next twenty, so it plateaus, and it
  drops back when idle. A leak cannot have flat node and listener counts.
- **The tick rate with the heartbeat live** — the risk `tickResync()` created.
  The player's rest clock counts **exactly 12 seconds in 12**. No double-arming.
- **A full backup round trip** of everything v375-v378 added: `settings.voiceCmd`
  restores, the file carries NEITHER API key, both keys survive `hardReset()`
  AND the import, and no live-session scratch travels.
- **A real training week** — five sessions committed, the pointer moved five,
  `adapt` moved +0.03, the lifetime count read five, a rest day recorded, and
  no screen printed NaN.
- **Tab-pointer copy**, read off the real screens rather than grepped: 6
  pointers across 51,724 rendered characters, and all 6 destinations verified
  to hold the thing they name.

### Two false alarms, and both are traps this file already records

- **"Movement is missing from Today ▸ Workout."** The probe never seeded a
  baseline, so Today correctly rendered the Baseline Test screen. With one
  seeded, Movement is there with 27 tappable rows. Same shape as the
  end-of-program probe that read the welcome screen.
- **"`todayKcalBudget()` returns undefined."** It returns the stored value
  unchanged when there is no usable target — its own comment says so, and no
  screen printed it.

## A duration must not be measured with the wall clock (v380)

Found by fuzzing v379 — the sixth round running where the best finding was in
the round immediately before, and the third in a row where it was in my own
new code.

`Date.now()` moves when the phone corrects itself, which Android and iOS do in
the background. v377 made the count-up timers read real time and v379 stopped
them returning NaN. **Both used `Date.now()`.** Measured on a 3-second hold
with the clock shoved forward mid-effort:

| the clock jumps | recorded for a 3-second hold |
|---|---|
| **+1 hour** | **3,602 seconds** |
| **+1 minute** | **62 seconds** |
| −1 hour | 3 — the floor already covered backwards |
| no jump | 3 |

**That number is WRITTEN INTO THE RECORD.** A 60-minute plank becomes the bar
`holdBest()` and `grindAtBest()` read, and on the battery it anchors a year of
prescriptions.

**I guarded the backwards direction and the junk types, and forwards — the
direction that INFLATES — was wide open.** v379 added a floor so a backwards
jump could not wind the count back, and never asked the mirror question.

### performance.now() is the right primitive, and that was measured

It is monotonic: it counts forward at real speed and nothing can move it.
Against the same +1 hour jump it advanced **1,000 ms while `Date.now()`
advanced 3,601,000** — and it still tracked 2.5 real seconds exactly, so
v377's throttle recovery is untouched.

`monoNow()` falls back to `Date.now()` where `performance` is missing, throws,
or returns NaN. It is consulted on every tick of a maximal effort, so it must
never throw; four checks pin that contract directly.

### The failing check found a real hole beside its own bug

Three checks went red on the first run, and splitting them mattered:

- **Two were mine.** They fed a `Date.now()`-based `startedAt` to a function
  that now reads the monotonic clock — two different time bases, which looks
  exactly like a code defect. A synthetic timestamp must come from the same
  clock the code under test reads.
- **One was real.** A negative `elapsed` returned a NEGATIVE count. The old
  wall clock had masked it, purely because `real` happened to be larger.
  A count of seconds is never below zero, so `prev` is clamped at 0.

### The clamp's own mutant escaped, and it is the same trap a third time

Removing `Math.max(0, ...)` walked through, because the case tested it with
`startedAt` in the PAST — so `real` was positive and `Math.max()` hid the
negative count. **A guard is only visible when the value beside it in the same
expression cannot supply the answer.** A `startedAt` in the FUTURE makes `real`
negative, so only the clamp can keep the result at or above zero.

That is the third time in one session a guard was masked by its neighbour: the
floor hidden by the rescue's catch-up (v379), the `startedAt` type guard hidden
by the `isFinite` layer (v379), and now the clamp hidden by `real`. The tell is
always the same — the mutant changes the program and the check does not move.

Eight mutants, all caught, including the over-eager twin that makes `monoNow()`
always return the wall clock.

### The count-DOWN half, and four rounds of reading the mutant back

I first called the count-down exposure *"annoying rather than corrupting"*.
**The measurement corrected that.** On a two-minute rest with the clock shoved
forward: +1 minute left 58 seconds of it, and **+1 hour ended it instantly**,
dropping straight into the next set. v296 exists so the two minutes between
maximal efforts are REAL, so that is a corrupted measurement, not a mood. It
was folded into this version rather than shipped as a documented half-fix.

**Moving the deadlines and leaving the stall detector behind broke seven
checks.** `performance.now()` is a few thousand and `Date.now()` is ~1.78
trillion, so every surface read as permanently stalled. **One clock for every
timer stamp** — deadline, `phaseAt` and `lastTick` all monotonic — is the rule
that came out of it, and the same rule applies to a synthetic timestamp in a
check.

Then the mutants, and each escape taught a different lesson:

- **A defect that lives in two places needs a mutant in two places.** Flipping
  only the deadline WRITE left the read monotonic, so the remaining time was
  astronomically large, `byTick` always won and the countdown merely ticked —
  a different bug entirely. Paired write+read mutants are caught at once.
- **`remain` can never increase.** `Math.min(byTick, …)` means the deadline
  only ever makes the countdown catch UP. So a `held` that is far too large and
  a correct one both tick down by one, and mutant 7 was invisible through
  `remain` no matter how tight the tolerance.
- **A check that OVERWRITES the state under test erases the defect.** The
  catch-up check set `PLAYER.deadline` itself, wiping exactly what a wall-clock
  `held` had corrupted. The fix is to assert on the deadline the pause LEFT:
  a deadline is consistent when the time it has left matches the seconds on
  screen, and an hour of swallowed clock jump shows up immediately.
- **Read the value after the thing that changes it.** The pause check read
  `remain` 200 ms after resume, before any tick had run, so "never push the
  deadline out" changed nothing it could see.

Seven count-down mutants, all caught after those four rewrites.


## The 10% rule caps the RATE and nothing capped the TOTAL (v381)

The plan's own comment has said for many versions that the ramp is capped and
the cap is pinned by a check. It caps the **rate**. Measured on a legitimate
54-week block from a 19.3 km/week base, with no stale stamp and nothing else
wrong:

| week | phase | running | rucking |
|---|---|---|---|
| 1 | base | 19.3 km | 9.6 km |
| 21 | base | 129.7 km | 25.0 km |
| 31 | base | 336.5 km | 40.3 km |
| 41 | base | **872.9 km** | 64.9 km |
| 51 | sharpen | **1,871 km** | **95.0 km** |

A marathon a day, every day, prescribed by the plan whose whole purpose is to
stop somebody arriving at selection injured.

**`PREP_PLATEAU_PHASES` is `['sharpen','taper']`**, so the volume held once the
hard sessions arrived — and a long BASE phase compounded unopposed for as many
weeks as the athlete had. Two series each capped at 10% a week sum to a series
capped at 10% a week, which is true and was the only question anyone asked.
Nobody asked what the number reaches.

**TWO CEILINGS, because each covers what the other cannot.** A multiple of the
athlete's OWN start protects the one who opened at the 8 km floor, for whom a
flat 60 km would be a sevenfold jump. An absolute ceiling protects the one who
opened high, for whom 2.5x a big base is far past anything these standards ask
— FORCE has no run in it at all, and the app's own time trial is 2.4 km.

**It is a MAX against `start`, never a cut.** An athlete already running more
than the ceiling is left where they are rather than prescribed less than they
already do: a plan that tells you to run less than you did last month is not a
cap, it is a different bug. That is the floor two mutants fail on, and the
check pins it against the app's **own computed start** — the trailing average
is taken over ISO weeks, so 28 days of a 90 km seed comes to 86.8, and a check
restating 90 fails on correct code.

**`km` and `curve` are two halves of one figure**, so the clamp is one
expression read twice. Writing it into only one is how a card comes to print a
number the plan does not use — v337's lesson, one subsystem over.

### A reschedule keeps the stamp; a new block does not

`planFrom` was stamped once and never again. That is right for moving a date
still ahead — the plan keeps running from when the athlete started — and wrong
the moment the previous evaluation has been and gone. The next one is a **new
block**, and `prepWeekNo()` counts from the stamp, so a stamp a year old opened
it at **week 53**: measured, **2,739 km of running a week and a 60 lb plate on
day one**.

`clearForceDate()` now drops the stamp with the date, because leaving it behind
is the same defect by a second door.

The test is `todayISO()>=prevDate`, read BEFORE the new date overwrites it —
the same day-exact compare `prepCheckpoint()` already uses for `final`, rather
than `prepDatePassed()`, which is week-rounded and answers a different question.

### A quiet cap reads as a bug

`plateaued` was already returned and **no renderer read it**. The two reasons
the volume stops climbing are different sentences, so they are different flags:
`plateaued` is the sharpen phase holding it, `atPeak` is the build having
reached its ceiling. The ruck card's load-cap note promised *"from here the
distance carries the progression"* — false once the distance is capped too, so
it says the true thing instead. A promise in UI text is a specification, and
this round would have created one.

**The floors carry the round.** A cap satisfied by never climbing is not a cap,
so an ordinary 16-week block must still build (19.3 to 26.3 km by week 8,
unchanged) and week 8 must be nowhere near the ceiling. The beginner's ceiling
must be a multiple of THEIR start (20 km, not 60). And the note must say
nothing at all on a block still climbing.


## The container was checked and the members were not — in four more places (v382)

v354 filtered `profile.limitations` against `JOINTS` and wrote the reason in a
comment three lines above `profile.parq`. **Four siblings in the same file
never got it** — `parq`, `nutrition.allergens`, `profile.targets` and
`profile.troubleZones` each had the CONTAINER checked and nothing below it.
Fixing one instance is not fixing the class, and the class was five wide.

**The reason it stayed hidden is where the legal sets lived.** `FAREAS` and
`TROUBLE` were function-local consts INSIDE `obMount()`, so nothing outside
that one renderer could ask what a legal focus area or trouble zone is. A
repair cannot filter against a list it cannot see. Same shape as the five diets
existing as three literals, one layer down. They are hoisted to `FOCUS_AREAS`
and `TROUBLE_AREAS`, and `validateData()` pins `TROUBLE_AREAS` against
`TROUBLE_POOL` **both directions** — a zone in one and not the other is either
a button that steers nothing or a steer with no button, and both are silent.

### The measured harm is on the array the whole safety gate rests on

A junk key in `parq` — the shape any hand-edited or foreign backup arrives in:

| | |
|---|---|
| `parqFlagged()` | **true, for ever** |
| chips ticked on the health screen | **0** — the row renders from `PARQ`, so there is nothing to untick |
| session volume | **62 units against 82 — 24% lighter, permanently** |
| `validateData()` | **clean throughout** |

Safe mode on, with nothing on screen to explain a permanently easier session
and no way to clear it.

**IT FAILS CLOSED, and that is why the flags go with it.** Dropping an
unrecognised key means the app no longer knows what the athlete answered, so
the screen is not answered and a clearance given against answers it cannot
reconstruct does not apply. `parqDone` and `medCleared` are both cleared and
the athlete re-answers in two taps. The alternative is silently clearing a
declared heart condition.

**The allergen filter deliberately does NOT do that**, and the asymmetry is the
point: an allergen the library does not know matches no food, so it already
restricts nothing and dropping it cannot make the app less safe. The harm there
is only that it is invisible, un-untickable and travels in every backup.

**An inherited key is truthy**, so `TROUBLE_POOL[z]` passed a truthiness test
and `troubleZones:['constructor']` survived into the trouble list.
`troubleZoneKey()` is a membership test — v328's lesson, one map over.

### The floors are what stop each fix being a delete

- A clean `parq:['heart']` with a clearance survives **untouched**, flags
  intact, safe mode off — the mutant that always resets sends a clean athlete
  back to the health screen on every boot.
- `parq:[]` with `parqDone:true` stays done. The screen says *"if none apply,
  leave them all off"*, so an empty answer is a real answer.
- A list of nothing but junk `targets` falls back to `['abs','full']`, never
  empty — `focusBonus()` reads `targets[0]`, and an empty list is a different
  defect from a junk one.
- Real allergens, real zones and a real focus pair are all byte-identical.

**And a clean validator proves nothing about a validator rule.** The lockstep
rule is exercised by breaking `TROUBLE_AREAS` and `TROUBLE_POOL` in front of
it, one at a time, requiring the specific complaint, then restoring — with
`console.error` muted, because `validateData()` logs and the harness counts a
console error as a page failure.


## A range test's job, done by a type test — three more fields (v383)

```js
if(typeof STATE.settings.repTempo!=='number')STATE.settings.repTempo=3;
```

That is the v286 `adapt` defect verbatim, one field over. `setRepTempo()`
clamps to 1-6 and the boot repair only ever checked the TYPE, so a stored 999
survived every boot. The PLAYER clamps at its own read sites, which is why the
pacing stays right and nothing crashes — and `totalTUTSplit()` reads it **RAW**.
Measured over 40 logged sessions:

| stored cadence | lifetime work |
|---|---|
| 3 (normal) | **168 min** |
| 999 | **28,354 min** |

**And `age` and `heightCm` had no shape repair at all**, while v355's mirror
copies whichever side holds a value into the half every calculation reads.
Measured on one 86 kg / 178 cm / 59-year-old body, with values `importData()`
accepts from any hand-edited backup:

| stored | calorie target |
|---|---|
| `age:59` (real) | 1950 |
| `age:true` | **2360** — `5*true` is 5, so 59 prices as 1 |
| `age:'zzz'` | **NaN** on a populated athlete, `null` on a partial one |
| `heightCm:true` | **1500** |

**The repair has to run BEFORE the mirror.** With junk on one side only, a
repair that ran after would copy it across rather than drop it — and that is
the check that proves the ordering, not any assertion about the values.

**Dropped rather than clamped**, which is v345's rule: "silently produces no
target" is a field the athlete filled in going missing, so the app asks again.
The bounds are the ones the app already enforces on a typed value (age 10-100,
height 120-230 cm), so a stored number the athlete could never have entered is
not kept — and both edges are pinned, because a guard that clips a legitimate
value is the mirror-image defect.

`settings.coach` was truthiness-only. `coachFor()` falls back to `COACHES[0]`
for an unknown id so nothing breaks, but the junk survived every boot, travelled
in every backup, and left the picker with nothing selected.

### The self-correction: the destructive path takes the SAFER list

v382's own `troubleZoneKey()` required membership in **both** `TROUBLE_POOL` and
`TROUBLE_AREAS`. Identical today — `validateData()` pins them equal — and the
wrong test for a repair that **deletes** stored athlete data, because the two
failure directions are not symmetrical:

| future mismatch | asking both lists | asking the pool alone |
|---|---|---|
| zone in the POOL, no picker button | **the athlete's real answer is erased** | kept; the validator complains |
| zone in the picker, not in the pool | erased | erased — it was inert anyway |

The repair asks the map that actually steers the program; the validator is what
catches a picker that has drifted. Found by auditing my own change an hour after
shipping it — the sixth round running where the best finding was in the round
immediately before.

### Three checks failed on correct code, and one of them was informative

- **The base calorie target is not a universal number.** The check hardcoded
  1950 from a fresh-install probe; the seeded athlete carries their own goal and
  timeline. Assert that there IS a target to move, not what it is.
- **The holds do not scale with rep cadence.** The check asserted the repaired
  lifetime total was exactly twice the tempo-3 figure. It is not: the clamp
  lands on 6, and only the rep half doubles. Measure the expected figure at the
  clamped cadence rather than deriving it from the default.
- **A string age gives NaN, not null** — and that was worth knowing. On a
  partial athlete `kcalTargetPreview()` bails and returns null; on a fully
  populated one it computes, and the string lands in the arithmetic. NaN is the
  worse of the two: `null` is caught by the `!p` guards downstream, and a NaN
  prints.


## The two prep paths ended on different plates (v384)

`wantSteps` counted THIS path's slot occurrences over the WHOLE block, and the
two paths are offset by one slot — so how many land inside a block depends on
`totalWk % 4`, and the owed remainder was taken all at once at the last working
week. Traced week by week on an athlete opening at the bottom plate:

| block | operator | assaulter |
|---|---|---|
| 11 weeks | 10 → 15 → 20 → **25** | 10 → 15 → **20** |
| 23 weeks | … → 35 → **40** | … → **35** |

Swept across 8 to 30 weeks: **the operator ended 5 lb heavier at 12 of 23 block
lengths.** A bias in LOAD is the one thing v340 says the two paths may never
differ in.

**Nothing caught it because every existing check counts steps at a hardcoded
16-week block** — one of the lengths where it happens to hold. That is "a guard
that cannot fire in the case you tested is not tested", applied to the block
LENGTH rather than to a value.

### Three attempts, and the two wrong ones are the lesson

**A re-derivation agreed with a wrong claim and was itself wrong.** The finding
arrived from an audit whose own table contradicted its own explanation, so it
had to be checked. Checking it by transcribing the ladder into Python got the
right conclusion from bad arithmetic — the sim used a starting plate the app
never uses. This file already says to **assert through the app's own predicates,
never re-derive them**; the same applies to disproving a claim.

**The first sweep probe reported "identical before and after".** It ran on an
athlete already near the 60 lb ceiling, which absorbs the entire difference.
Only an athlete opening at the bottom plate can show it at all — the guard
`startLb <= 15` is now the first assertion in the block.

**The first fix introduced something the app never had.** Letting the catch-up
fire on a path's own slot achieves parity and produces **six weeks that raise
the plate 10 lb at once** across the same 23 lengths, where today no week ever
raises more than 5.

### What shipped, and what it costs

The block affords as many steps as the TIGHTER path over the WORKING weeks, and
each path takes them at its own slot, one a week. Path-independent by
construction.

**That removes the catch-up, and v371's reason for it goes with it.** v371 kept
owed steps rather than dropping them because dropping left one path *"5 lb
lighter for the whole block, which is a bias in VOLUME"* — a statement about the
paths differing FROM EACH OTHER. With a shared count neither can be lighter than
the other, so the bias it guarded against cannot arise.

**The trade is real and is the conservative direction.** Every block now ends one
step below the operator's old figure — 16 weeks goes 30 lb to 25 — because the
steps that used to be dragged out of the taper are no longer taken at all.
Nobody is raised. A lighter plate is never an injury and a 10 lb week can be.

| | before | after |
|---|---|---|
| lengths where the paths differ | **12 of 23** | **0 of 23** |
| weeks raising more than one step | 0 | **0** |
| 54-week block | 60 lb (ceiling) | 60 lb (ceiling) |

### Three existing checks failed on correct code, and each pinned an assumption

- **Two hardcoded WHICH week is a load week.** With a shared count the
  operator's fifth slot no longer raises, so week 3 is correctly a distance
  week now. The requirement is that a week's CARD and its `climbing` agree,
  whichever week it happens to be — so the block FINDS a load week and a
  distance week rather than assuming them, with a guard that both exist.
- **One demanded exactly FOUR steps.** The number is a property of the block
  length, not a constant. What has to hold is that the plate still climbs, and
  that the two paths agree.

**And pinning only the final plate is not enough**, which is how this survived:
the ceiling absorbs the difference on any long block. The agreement assertion
now covers the STEP COUNT as well as the plate.


## Three promises the code did not keep (v385)

### The coach read out an address that was empty

The morning brief says, aloud, every morning:

> *"Your meal plan today: Steak & Eggs Skillet, Chicken Shawarma Wrap and
> Baked Salmon & Sweet Potato. The full recipes are on the Reference tab,
> under Food."*

Measured on that pane: **0 of the 3 names, no INGREDIENTS heading, no METHOD
heading**, and nothing bound to `toggleRecipe()` or `openGrocery()`.
`_recipePlanHTML()` is the only renderer of `r.ing` and `r.steps` in the whole
file, and it had **no caller** — v245 removed the plan card from Fuel at the
athlete's request and the recipes went with it, leaving the sentence behind.

**v315 already fixed this sentence once.** It used to name the Fuel tab; v315
moved the tab NAME and the destination still did not hold the thing. v315's own
rule is to assert BOTH ways, and only one half had ever been done. A spoken
address is the one an athlete cannot double-check by looking.

**It goes on Reference, not back on Fuel.** The athlete's v245 request was
about a prescribed menu standing in front of their own food diary, and that
decision stands — a floor check pins that Fuel stays clean.

### Two datasets on one pane, so each says which it is

Putting the recipes there created the very defect this round exists to fix.
The recipe card can legitimately say *"Multiply each quantity by 1.4"* —
recipes are cookable dishes at FIXED portions — while the worked days below it
say *"weighed out for your targets, no multiplying required"*. Adjacent and
unlabelled, one screen contradicts itself.

A line above them now names which is which. **This was caught by a suite-09
check going red, not by reading the diff** — and the check was right: its
subject is the weighed month, and a page-wide search could not tell the two
datasets apart. It is scoped to the worked days now, with a guard that the
slice really landed there.

**And the anchor had to become a parameter.** `_recipePlanHTML()` hardcoded
`id="mealplan"`, which the worked days already own — two elements with one id
is a standing rule here. Defaulting it keeps every existing caller and check
byte-identical.

### A data zero meant "one second", not "none"

`plEnterRest()` does `Math.max(1,dur|0)`, so a session built with `rest:0` got
a one-second REST screen — with a REST tag, a +15s button and a **Skip** — in
front of every movement. The FORCE Combat circuit is the only caller that
passes 0, and **the absence of the rest IS its difference from the annual
evaluation**, which its own card and its own comment both state.

Measured: `ready > work > rest` on the first handover, against
`ready > work > ready > work > …` and **zero rest phases** after.

Safe to scope narrowly, and that was checked rather than assumed: every other
`openPlayer()` caller passes `ex.rest||45` or `||60`, and `prescribe()` clamps
the program path to 20-120, so nothing else can reach the branch. The floor is
an ordinary custom session, which must still rest between sets.

### The window figure counted to the wrong event

The midpoint prompt says *"N weeks before the taper starts"* and N was
`prepWeeksLeft()` — weeks to the TEST DATE. The taper opens `PREP_TAPER_WEEKS`
earlier, so the figure was overstated by exactly that, every time: five weeks
out it said **five** when the answer was **three**.

### The check that failed on correct code was reading a rebuilt plan

`currentMealPlan()` rebuilds when the stored plan is stale, so reading the
names BEFORE the first render captured a plan the render then legitimately
replaced — 1 of 3 matched and it looked like the fix had failed. Render first,
read the plan that is actually on the glass, then ask the brief about that one.
**The real requirement is that the two agree**, which is what the check now
says.


## A reschedule destroyed the baseline and inverted the verdict (v386)

`prepMidISO()` is derived from `planFrom` and the date, so pushing the test date
out moves the midpoint and can put TODAY back inside the `initial` window. The
next result then landed in the block's BASELINE slot and overwrote it — and the
card, which orders by checkpoint SLOT rather than by date, read the newest
figure as *"was"*.

Driven end to end on a real 200 → 190 → 180 improvement:

| | initial | mid | the card says |
|---|---|---|---|
| before | **180** — the 200 destroyed | 190 | **"+10s slower"** |
| after | 200 kept | 180 | **"−20s faster"** |

Twenty seconds of progress reported as a ten-second regression, with the
baseline gone.

**A measurement taken later can never belong to an earlier checkpoint than one
already recorded**, so the write slot never goes backwards. And the reader
**fails closed on an out-of-order pair** — every phone is carrying records
written before the guard, and comparing them would report progress as a
regression, so an unknown or inverted ordering withholds the delta rather than
inventing one. That is v320's call about a baseline with no `subs` stamp.

### Two probes disagreed, and one of them was wrong

The first probe reproduced it. A second, written to measure the fix, reported
**before and after as identical** — which would have meant shipping a fix for
nothing. Neither could be trusted while they disagreed.

What settled it was a third probe that **deep-copies the state after every
step** and prints the checkpoint it wrote into. The defect reproduces cleanly
that way, and the second probe was the faulty one. Reading a live object at the
end of a sequence shows the FINAL state at every point you thought you had
captured — the same aliasing trap, one layer up from the app.

### The floored-cut finding did not reproduce, and a CONTROL is what proved it

An audit reported that `calorieCheck()` reads a floored cut as a bulk: the
safety floor can raise a small sedentary athlete's target above maintenance
(measured, TDEE 1052 against a 1200 floor), which makes `expected` positive on
a fat-loss goal.

The arithmetic is right and the behaviour is not there. Driven on exactly that
athlete, `calorieCheck()` returns **null** on the unfixed code — no verdict, no
advice, no button. **A control is what makes that trustworthy**: the same
harness on an ordinary 86 kg athlete returns `{verdict:'stalled', step:-300}`,
so the setup reaches the code and the floored athlete genuinely produces
nothing.

A fix was written and **reverted**. Shipping it would have been a change with
no defect behind it, and this file's own rule for a mutant applies to a fix:
read it back before believing it.

**Two probe bugs on the way**, both this file's own traps: `trendKgPerWeek()`
reads `m.weight` and the seed wrote `m.kg`, so the trend was null and every
reading downstream was measuring nothing; and the aliasing above. Confirm the
control's real shape before believing the result.


## A comment asserting a gate that had been removed (v387)

`hasTrainer()` had **no caller anywhere in the app**, and a comment beside the
gear list said, in the present tense:

> `bikeSwap()` substitutes the trainer into conditioning slots and
> `hasTrainer()` gates the bike work, both off this key

The gate was taken out deliberately, and `rideTargetHTML()`'s own comment says
why — *"Shown to everyone now. The gate was hasTrainer(), which hid the whole
conditioning target from any athlete without a bike; the people with the fewest
options were the ones told nothing."* Two comments in one file, one describing
the removal and the other still asserting the thing removed.

That is this file's most-repeated shape — **a comment claiming an invariant is
not the invariant** — and it is exactly what makes the next reader trust a
function that does nothing. The stale half is corrected in the code, in the
suite that quoted it, and here.

### And I deleted a function that was not dead

`logFoodFromList()` also has no caller in `index.html`, so it went out in the
same pass. **Suite 06 drives it** as the bad-index guard — `logFoodFromList(9999)`
must be a no-op rather than a thrown render — and the full run caught it
immediately.

**The suite is a call site.** A dead-code sweep that counts references in
`index.html` alone will delete every defensive helper the checks exist to
exercise; `mealPlanHTML()` is kept for precisely the same reason and says so.
It is restored with the reason written beside it, and the deletion of
`hasTrainer()` stands only because the suites were grepped for it too.

### What v385 un-orphaned

Worth recording as the measurement that prompted the sweep. Before v385 the
recipe view was unreachable from every screen in the app:

| function | call sites before | after |
|---|---|---|
| `toggleRecipe` | 0 | 2 |
| `openGrocery` | 0 | 3 |
| `regenPlan` | 0 | 1 |
| `mealGapHTML` | 0 | 2 |


## Every function is reachable from a root, and now a check says so

v385 found that `_recipePlanHTML()` — the only renderer of a recipe's
ingredients and method in the whole file — had **no caller**, so the recipe view
was unreachable from every screen while the morning brief read its address
aloud. Nothing noticed for many versions.

**A direct-caller count could not have caught it.** `_recipePlanHTML` HAD a
caller: `mealPlanHTML()`, which itself had none. The head went dark and took
the cluster with it — `toggleRecipe`, `openGrocery`, `regenPlan` and
`mealGapHTML` all had 0 reachable call sites. It takes TRANSITIVE reachability
from the real roots.

**The roots are three, and missing any one of them breaks the answer:**

- **the page's own markup** — `onclick="openSettings()"` in the body is a call
  site the script never mentions;
- **the top-level code**, which is where the registries live: `CARDIO_INFO`
  names its per-mode builders as bare identifiers;
- **`boot()`**, reached from the load listener.

Measured on the app today: **1,137 of 1,140 top-level functions reachable, 3
orphans, and all three are kept on purpose** — `mealPlanHTML` is suite 02's
safety surface for the meal generator, `todaysWorkedDay` is its helper, and
`logFoodFromList` is suite 06's bad-index guard. The allowlist is checked in
both directions, so an entry that gains a real caller has to come off it.

### The guards matter more than the result

Every wrong version of this analysis reported **hundreds** of orphans, not a
handful — a broken traversal looks exactly like a rotten app, and the four
wrong ones each looked plausible:

- **`async function` was not matched**, so `boot` was not in the roster at all
  and reachability came back as **1**.
- **The body ran to the next declaration**, which attributed every top-level
  registry between two functions to the one above it. A dozen live builders
  read as unreachable.
- **A line-anchored `^}` search ran past a one-liner.** `_dv()` is a single
  line, so its span swallowed `CARDIO_INFO` whole and `bikeBlockHTML` looked
  dead. Brace matching, skipping strings and template literals, is what fixed
  it.
- **The static markup was not read**, so `openSettings` — called only from a
  button in the page body — read as an orphan.

So the check asserts `boot()` was found, that the roster is over 900 functions,
that the script it parsed is the app's, and that **over 90% of the roster is
reachable** before it trusts the orphan list at all.

Three mutants, all caught: a live renderer losing its only caller (the v385
shape exactly), a handler losing its only `onclick`, and a whole cluster head
going dark.


## Two writers of one field, and a stale safety argument (v388)

Found by sweeping three source-level classes at once. **Three of the four came
back clean**, and recording that is the point of running them:

| swept | result |
|---|---|
| renderers that assign to `STATE` | **0** of 1,140 functions (265 assignments, all in real writers) |
| renderers that call a mutating helper | **3**, every one documented and deliberate |
| functions that mutate `STATE` with no caller persisting it | **0** — 12 candidates, all lazy-init accessors or saved by their callers |
| `STATE.x.y` paths with 3+ distinct writers | **4**, and two were span mis-attributions |

**A guard is what makes a clean sweep trustworthy.** Every one of these
analyses first reported an implausible number — 0 paths with many writers, 0
renderers assigning — and the guards (how many assignments were found at all,
who the top writers are) are what separated "the app is clean" from "the regex
matched nothing".

### The trap: two writers, one of which skipped the source of truth

`hasBar`/`hasBench` are a legacy mirror of `gear[]`. `toggleGear()` and
`normalizeState()` both derive them FROM gear. `toggleSetting()` flipped the
flag and left gear alone — so a control wired to either branch would have
**appeared to work and been silently reverted on the next boot**, which is the
`cardioMode` defect exactly.

Nothing reaches those branches today, and that is precisely when it is cheap to
make them correct rather than delete them or leave the trap: they route to the
one writer now.

### The stale safety argument was in code I had just written

`_recipePlanHTML()`'s comment named `renderFuel()` as the caller that primes the
plan before any markup is built — the whole justification for calling a
generator that `save()`s from an HTML builder. `renderFuel()` stopped priming
when v245 removed the only markup on Fuel that read the plan, and its own
comment eleven hundred lines below says so. v385 made `renderRef()` the primer
and did not update the argument.

### The mutant that proved the check was reading a comment

The first version asserted that the named caller really calls
`currentMealPlan(` — by searching the function's source. **`renderFuel()`'s own
comment contains that exact text**, explaining that its priming call was
REMOVED. So the scan said it primes when it is the function that stopped, and
the mutant naming `renderFuel()` escaped clean.

A comment that quotes code breaks a scan for that code — already recorded here
for the duplicate-key guard and for `document.body.innerHTML`. The check strips
comments first now, with a guard that the stripper has not simply deleted
everything.


## A target board that scores four rows and refuses two (v389)

From a Reserve Infantry preparation package the athlete sent over. The first
question was whether it deserved a tab, and the measurement said no: about 60%
of what it describes was already built — the FORCE events, the ruck ladder, the
running plan, the phase model — and a seventh bottom tab was measured at
**59px against the 71px a word needs** back in v312. Two sources of truth for
one standard is this repo's most-repeated drift, so it went **inside** the prep
sheet the athlete already opens.

**THE ROW THAT REFUSES TO SCORE IS THE POINT OF THE BOARD.** Six targets, and
two of them are measured by this app with a different ruler:

| target | the app measures | scored |
|---|---|---|
| 5 km run | a shorter time trial (`runTTLabel()`) | **no** |
| Pull-ups | Inverted Rows (the `pull` test) | **no**, unless a real pull-up record exists |
| Push-ups | push-ups | yes |
| Plank | the fresh hold best | yes |
| Ruck | the longest single outing | yes |
| Frequency | sessions this week | yes |

Converting either would be the change-of-ruler defect v320 and v321 exist to
stop — a number taken on one movement, printed under another movement's name.
An inverted row is not a pull-up and 2.4 km is not 5 km. **A withheld score
needs a sentence**, so each of those two rows says which movement or distance
the app actually measured and why the comparison is not made. The inverted-row
figure is still SHOWN: it is a real number, and hiding it would punish the
athlete for the app testing a different movement.

**A real `STATE.prs.pullup` record IS scored**, and that floor is what stops
the fix being "never score the hard rows" — the mutant that scores nothing at
all is caught by it.

**The best SINGLE ruck, not the weekly total.** "10-12 km at 18-20 kg" is a
statement about one outing; summing a week to meet it would report a target met
by three short walks. And the distance goes through `distShow()` — the v337
lesson, where a plan printed `8 km` as `8 mi` because the label and the number
were two expressions.

**The caveat is on the glass and stamped.** The package says itself that it
does not replace CAF orders and that joining instructions control, so the board
says exactly that and carries `DAY90_ASOF`. Same discipline as `FORCE_ASOF` and
`COMBAT_ASOF`: a published figure is a fact with a date on it, and one shown
with confidence a year stale is worse than none, because the athlete trains to
it.

### Adding to a shared sheet broke four checks that were reading the whole page

Every one is a trap already in this file, and all four were the CHECK:

- **Two "not measured" counts were page-wide.** The board legitimately renders
  its own `not measured` tags, so counting them across `#sheet` reported six
  where four was correct. Scoped to `#sheet [data-force]`, with a guard that
  the four event rows were really found. *Scope the assertion to where the
  change was made* — the v267 warning icon, again.
- **A label count was pinned at exactly 3.** The board adds a fifth call to the
  same label helper, so `t.eq(...,3)` failed on correct code. The requirement
  was always *at least* three.
- **My own comment contained the literal `2.4 km time trial`**, which v331's
  hardcoded-distance scan counts. Reword the prose, never weaken the check —
  the fifth time.

## The fields DEFAULT_STATE never declares (v390)

v285 fuzzed *"all 33 top-level fields"* and v284 before it fixed `logs` and
`prs`. Both enumerated **`Object.keys(DEFAULT_STATE())`** — and eight top-level
fields are created **on demand** rather than declared there, so two separate
class sweeps walked straight past every one of them and **none had a repair**.

`importData()` accepts arbitrary JSON. **"Not declared" is not "not
reachable."**

| field | measured before the fix |
|---|---|
| `opsPR` as an ARRAY | `arr['sprintdrag']=42` reads back **42** in memory and `JSON.stringify` gives **`[]`** — the personal record is silently **lost on every save** |
| `customFav` junk | `openBuilder()` **threw** on a string and on a row with no `items`, so the custom builder was a **dead button** with nothing on screen saying why |
| `customFav` naming a missing exercise | threw inside `startCustom()` on `ex.unit` — the tap did nothing |
| `comeback.left` | a stored **99999** eased every session by `target x0.8` and `sets-1` **for ever** — still **99,949 to go after fifty sessions** |

The `opsPR` one is the v284 keyed-map-as-a-list defect exactly, on a field that
sweep could not see. The `comeback` one is the v286 `adapt` shape: **a band
that only the writer enforced** — `armComeback()` clamps to 2..8 and the repair
never checked — so the repair now asks `COMEBACK_MIN`/`COMEBACK_MAX` rather
than restating them.

**A courtesy is dropped; a record is repaired.** The whole `comeback` goes
rather than being clamped, because the worst a delete costs is an ease the
athlete never asked for. A favourites list is **not** dropped for one bad move:
the names are hand-typed and the rest of the list is real work, so the bad
move goes and the favourite stays. Both over-eager twins fail their own floor.

**Two guards mean two checks — and the second one hid the first.** `startFav()`
also filters to real exercises, and its check runs with the boot repair
deliberately **not** run. It still **escaped**, because `startCustom()` carries
its own filter one function later: with `startFav()`'s guard reverted the junk
key is stripped there and **nothing throws either way**, so a check asking only
whether it survived proved nothing. What differs is what the athlete is TOLD —
*"that favorite has no moves left"* names the favourite, while
`startCustom()`'s *"add some moves first"* points at a builder they are not
looking at. **Assert the message, not the absence of a throw.** Same family as
v380's clamp hidden by its neighbour: a guard is only visible when the value
beside it cannot supply the answer.

**And the board reads the pull-up record through `bestFor()`**, the app's own
accessor with its own type guard, rather than reaching into `STATE.prs`
directly. Found by auditing v389 an hour after writing it: re-deriving a read
the app already owns is the same mistake as a probe that bypasses
`jointRisky()`.

### Absent stays absent, or every athlete is told their data was repaired

Caught by auditing my own repair before it shipped. The first version created
`opsPR` unconditionally, which buys nothing — `opBest()` guards its own read and
the writer creates it — and costs two things. It puts an empty object in every
backup from then on; and boot flags `_dataRepaired` on **any** diff across
`normalizeState()`, so the first launch after this shipped would have shown a
*"we repaired your data"* note to **every athlete who has never run an ops
challenge**, about nothing.

Measured by diffing a settled state either side of the repair: `opsPR` was the
one key that appeared out of nowhere. `comeback` and `customFav` were already
guarded with `!== undefined`; this one was not.

**The wider question was then measured rather than assumed: does the note fire
spuriously today?** No. A returning athlete on the same version diffs to
**nothing**, and 33 containers are created only when genuinely absent — which
for a returning athlete they are not. A one-time diff on the first launch after
an upgrade is exactly what the note is for; what `opsPR` would have added was a
diff on that launch for *every* athlete, over a field none of them use.

So the invariant is pinned rather than the instance: **`normalizeState()` leaves
a settled state alone.** A repair that changes it fires the note on every boot,
for ever, for everybody — which is the worst version of this and the one no
per-field check would catch.

**And the check for it had to settle the state first.** Its first version ran
where earlier blocks in the same page had left junk in `STATE`, so the second
`normalizeState()` legitimately changed something and the check failed on
correct code. It reports WHAT appeared and what moved, so a failure says which.

### The check is derived from the source, because the hand-written list is what failed

The existing class check walks a **hand-written list of twelve maps**. That list
is exactly what let these eight through. The new one reads the app's own script
in the page, takes every `STATE.x=` assignment plus every `DEFAULT_STATE` key,
subtracts what `normalizeState()`'s body mentions, and requires the remainder to
be empty — so the **ninth** on-demand field fails here the day it is added.

**The detector is asserted BOTH ways**, or an empty gap list proves nothing: a
field known to be repaired must report repaired, and a field that does not exist
must report unrepaired. Plus the v331 guard — **the first inline `<script>` on
this page is two characters long**, and reading it reports every field as
unrepaired.

**One documented exception, on an allowlist checked both directions.**
`version` is declared and has **no reader anywhere in the app**, so a repair for
it is padding — the call v285 already made and wrote down. It is listed rather
than quietly excluded, and a second check fails if anything on the list later
gains a repair, so nobody sits on it for ever.

### Auditing v389 an hour later found two more, both mine

For the sixth round running the best finding was in the round immediately
before. Both are rules already in this file, applied to two of the six rows and
not to a third:

- **The push row printed a scaled estimate as a measurement.** A flagged
  **wrist** swaps that battery test for Fist Push-Ups, and `currentMaxes()`
  converts it through `anchorEquiv()` — so the figure is honest to score and
  dishonest to call *"your baseline max"*. A derived number that stopped being
  visibly derived, which is v304 exactly. It now says *"scaled from your Fist
  Push-Up"*, the same three-state model `testBreakdownHTML()` already uses, and
  the third state — a swap the app declines to convert — is refused rather than
  scored.

  **Measured rather than assumed, and the measurement narrowed the fix.** Eight
  joints against ten tests: `push` is substituted by **wrist alone**, and
  `plank` is **never substituted at all** — so the plank row needed nothing.
  The unconvertible state is unreachable on today's library, so it is
  **exercised directly** in the check rather than recorded as equivalent.

- **The ruck "close" tag ignored the load.** `near: bestKm>=8` called a **9 km
  walk with an empty bag** close to *10-12 km at 18-20 kg* — and the load is
  the half that makes it a ruck. Both halves now, at 80% each.

- **And the same shape a third time, found by applying that lesson to the other
  rows.** The frequency target reads *"5 useful days a week, **no persistent
  pain**"* and the row scored the days alone — so an athlete was called *on
  target* while their own logs carried a pain pattern the app was, on another
  screen, already prompting them about. The app's own rule — *"twice is a
  pattern, not a bad day"* — was stated inline inside `painPromptHTML()`, so it
  is hoisted to `painPattern()` and both ask it rather than a second copy
  drifting. **A joint the athlete has already FLAGGED is not an unaddressed
  pattern**: adopting the swap is the fix, and a row that kept punishing them
  for it would punish the athlete for doing what the app asked.

**A target that names two things is scored on two things, or the tag lies.**
That is the rule the three of them share, and it is worth stating once.

### And a brand-new athlete was shown the app's own assumptions as their results

Found by driving the board with **nothing on file** — the state every probe so
far had skipped, because they all seeded an athlete first. `currentMaxes()`
runs `estimateMaxes()`, which fills in **starting assumptions** when no
baseline exists, so the board read:

> **Push-ups — 8 reps · your baseline max · below**
> **Plank — 40s · your best fresh hold · below**

for tests the athlete had **never taken**, and marked them short of the target
on it. The plank row was two lies in one: the number came from the baseline
defaults and the label named the hold tracker.

**A default presented as a measurement** is the defect v260 named, and this is
the worst place in the app for it — the board's entire job is to say what has
been measured against a standard. Absent is *not measured*, which is not
*failed*, exactly as `forceVerdict()` already answers for an unlogged event.
Each blank row now says why it is blank and what fills it in.

**Three floors keep it from becoming "show nothing".** A **guard** asserts
`estimateMaxes()` really is still handing out a number, or "the board shows
nothing" passes on nothing. A **measured zero is still data** — sessions this
week reports `0`, it does not go blank with the rest. And a **real pull-up
record survives having no baseline**, because it is a measurement rather than a
default: without that floor, a board that blanked a number the athlete really
set would pass every assertion above.

### Two sweeps that came back clean, recorded as coverage

- **The prep surfaces at legal extremes.** The military-prep code is the newest
  in the app (v322-v341, v381-v389) and had never been driven at the edges. 48
  combinations — three bodies (45 kg / 140 cm / age 70, 150 kg / 200 cm / age
  17, and an ordinary athlete), eight test dates from tomorrow to four years
  **past**, both prep paths — across eight sheets plus Today and Progress, and
  both plan builders. **Zero NaN, zero Infinity, zero absurd figures, zero
  throws.** The guard that made it worth running: every sheet name is asserted
  to be a real function first. The first pass reported 40 failures and all of
  them were one invented name, `openEndurancePlan`, drowning everything else —
  the real one is `openEndurance`.
- **No duplicate live element id anywhere.** Four ids appear twice in the
  SOURCE (`mealplan`, `plCoach`, `plLiftPanel`, `plToggle`), which is the class
  this file records as a long-running source of stale elements shadowing live
  ones. Measured across 33 surfaces — six tabs, all four Today panes, all four
  Progress panes, both Reference panes, fifteen sheets and the player's ready,
  work and rest phases: **zero**. Only one of each pair is ever mounted.

  **And the first run of that sweep proved nothing.** It reported zero with a
  detector that could not see a duplicate at all — the id it injected,
  `view-today`, does not exist; the real one is `v-today`. A clean sweep with
  no both-ways guard on its own detector is not a result. Fixed, the detector
  sees the injected duplicate and the zero stands.
- **The board at its widest.** Six rows each carrying their longest
  explanation — a fresh athlete with a flagged wrist, so every row has a note —
  at 320, 360 and 412px in both themes: **no element past the viewport, no
  horizontal body scroll**, 36 renders.
- **The custom builder driven end to end**, through real taps rather than by
  poking `_custom` — which is what v355's probe did, with invented function
  names. Three chips tapped, saved as a favourite through its own button,
  started through its own button: 3 moves, `free:true`, a live program
  `_plResume` **untouched**, the pointer unmoved and no log written (a bonus
  session does not consume a program session), and the favourite survives a
  boot. One reading was the probe: the session's name lives at
  `PLAYER.sess.session.name`, not `PLAYER.title`.
- **`save()` under a full phone.** Already handled and worth recording rather
  than re-fixing: a quota failure sets `_lsOk=false`, warns once, and `load()`
  then picks whichever copy is genuinely **newer** rather than preferring
  localStorage — both behaviours carry comments explaining the defect they were
  written for.

**Twenty-four mutants across v389 and v390, all caught** — after three checks
were rewritten. Two are recorded above: the stamp satisfied by a stamp that was
never in question, and the two guards that masked each other so nothing threw
either way. The third is below. Every fix has its over-eager twin seeded beside
it, and each of those is caught by a floor rather than by the check the fix was
written for — the defaults leaking back in is caught by one check, and *no
athlete ever having a baseline* by a different one.

### And the v389 stamp check was satisfied by a stamp that was never in question

The mutant dropping `DAY90_ASOF` from the board **escaped**. `FORCE_ASOF`,
`COMBAT_ASOF` and `DAY90_ASOF` are all the string `August 2026`, and the FORCE
card prints its own on the same sheet — so a page-wide `indexOf` passed with the
board's stamp deleted. The board's caveat note now carries `data-d90note` and
the check reads that element. **Scope the assertion to where the change was
made** — the third page-wide match in two rounds.

## One of a pair guarded, its twin not — one level down (v391)

v390 fixed the top-level fields no repair covered. Taking the same question one
level down — **nested fields the app writes that no repair covers** — found 14,
and two of them are this file's most-quoted lesson landing again.

### The one that bricks a screen

`profile.bodyCur` and `profile.bodyGoal` are written by the same picker and
**neither had a repair**. `levelBF()` did

```js
const L=PHYS_LEVELS[clamp(level,1,5)-1];return isFemale()?L.bfF:L.bf;
```

and `clamp('abc',1,5)` is `NaN`, so `PHYS_LEVELS[NaN-1]` is `undefined` and
`.bf` **throws** — inside `transformationHTML()`, which is a RENDERER.

Measured: **Progress ▸ Body died on the error boundary, and the boundary
retries THROUGH `normalizeState()`** — which had nothing for this field, so the
retry produced the identical error and the tab **never came back across
relaunches**. That is the `nutrition.days` defect of v284 exactly, on a field
reachable from any hand-edited or corrupted import.

`nutrition.allergies` is the second: the free-text box sitting beside the
allergens **list**, which is repaired. A non-string threw on `.replace()`
rendering the profile form and on `.toLowerCase()` in the food filter. Two
fields one line apart, one guarded and one not.

### Two guards, two checks, and the read site is the one that matters

`levelBF()` fails closed — a level outside the set returns **null**, not a
throw — because it is on a render path and the boot repair cannot help a value
that arrives mid-session. `physLevel()` is the membership test, asked by the
repair and by `levelBF()` rather than `clamp(x,1,5)` restated at each site: a
clamp is what turned an illegal value into a *different* illegal value in the
first place, and the check pins that `physLevel(99)` is **0**, not 5.

**`goalBodyFat` is DERIVED, so it is re-derived rather than guessed.** It is
written from `bodyGoal` by `levelBF()`, so when the level survives the repair
recomputes it, and when the level goes it goes too. Keeping a stale derived
number beside a repaired level is the v304 shape one field over.

### The floors, and the one that catches the over-eager twin

A repair that always wipes satisfies every "the junk is gone" assertion and
throws away the athlete's own physique answers, which they set by tapping a
picture of a body. So a real level 2 and level 4 survive untouched, the free
text survives, the derived figure matches what `levelBF()` computes, and
**absent stays absent** — the rule v390 had just paid for.

### The deficit clock printed NaN to the athlete

The third field the same sweep turned up, and the harm runs both ways.
`shredWeeks()` did `new Date(todayISO()) - new Date(stamp)`, and
`new Date('abc')` is Invalid Date — so the result was `NaN`. **`NaN < 12` is
FALSE**, so the guardrail did not skip, it FIRED:

> 🍽️ **You have been in a deficit for NaN weeks.**

| stored `_shredStart` | weeks | the banner |
|---|---|---|
| a real 14-week cut | 14 | correct |
| `'abc'` / `{}` / `[]` / `'2025-13-45'` | **NaN** | **"for NaN weeks"** |
| `12345` | **2956** | "for 2956 weeks" |
| `'1900-01-01'` | **6608** | "for 6608 weeks" |
| a date in the FUTURE | **−29** | **silent — the guardrail is disabled** |

All of it survived every boot. The silent case is the one that matters most: it
is exactly the harm v365 measured from the other direction, arriving through an
import instead of a goal switch.

**The repair clears the junk and `noteGoalPhase()` then re-seeds from
evidence**, which is why the check asserts *no junk survives* rather than *the
field is null* — the first version demanded null and failed on correct code.

**And the bound on an ancient stamp was tried two ways.** Keying it to
`profile.createdAt` is principled — a cut cannot predate the account — and was
**reverted after it failed a floor**: `loadState()` fills a missing `createdAt`
with TODAY, so a restored backup would have had its genuine months-old stamp
dropped. Dropping a real stamp pushes the guardrail 12 weeks out; keeping a
silly one only shows a silly number, so the two failures are not symmetrical.
The gate is now far outside any real cut the way `bmiImplausible()`'s 13/60
gates are far outside any real body, and **a check pins that a three-year cut
survives it** — a guard earns its keep only if it provably cannot fire on a
legitimate input.

### The setter coerces and the reader was bare truthiness

The fourth instance of this version's own theme, found by driving the ten
remaining nested fields through their real readers rather than reading them.
Nine were fine — `beatTempoPref()` clamps, `skipLevel` does a membership test,
the booleans read truthy — and one was not:

```js
function foodAIReady(){return !!(STATE.settings&&STATE.settings.foodAiKey);}
```

`setFoodAiKey()` does `String(v).trim()`, so every key the athlete **types** is
a string. **A key from an imported FILE never meets the setter**, and
`carryDeviceCreds()` only overrides it when this device already holds one — so
on a phone with no key, a file's `{}`, `[]`, `42` or `true` lands, Settings
shows the saved badge, `foodAIReady()` says yes, and every call fails.
`neuralReady()` had the identical shape for the Azure key AND its region.

**Dropped at boot, never coerced: a mangled key is not a key.** And the floor
here matters more than most, because these are **the one thing no backup can
restore** — `exportData()` strips them on purpose — so a repair that dropped a
real key would be the worst over-eager twin in the app. A real key surviving
the boot is pinned, and so is the backup still carrying neither.

### And the scan that found it had a false negative of its own

Its "is this field mentioned in `normalizeState()`?" heuristic reported
`bodyGoal` as repaired. It is not: the name appears only inside a **migration
condition** (`!STATE.profile.bodyGoal`). The scan was reading a mention, not a
repair — the same trap as a comment that quotes code breaking the scan for that
code. Read what the mention actually is before believing it.

**Twenty-two mutants across the four fixes, all caught** — after one rewrite,
below. Every fix has its over-eager twin seeded beside it, and the credential
one is the sharpest in the app: a repair that dropped a REAL key destroys the
only thing a backup cannot restore.

### The promise sweep, re-run across the newest surfaces

v355 swept every promise sentence once; v381-v391 added a lot of copy since.
Re-run: **39 promise sentences across 27 surfaces** (six tabs, all four Today
panes, all four Progress panes, both Reference panes, twelve sheets), extracted
by pattern — *never / always / will / won't / keeps / stays / counts / does
not / cannot*. **Every testable one is backed.**

The two worth recording, because both are claims a check can make:

- *"Special training ▸ Hold to failure…"* is a tab POINTER, this repo's
  recurring stale-address class. Asserted BOTH ways: the button really is
  inside `openSpecial()`.
- *"Bonus conditioning… it won't affect your plan or streak."* Driven: a
  Special format run to completion on its own ticks leaves the pointer, the
  training streak, the nutrition streak, the trained-today flag, the log count
  and the live resume all identical.

**And the first run of that second measurement proved nothing** — the seeded
athlete's streak was **0** before and after, so "unchanged" was two zeroes
agreeing. Seeded with five real training days and five logged food days it
reads **5 before and 5 after**, with a guard that the figures are non-zero and
a control that the snapshot sees a change when one is made.

Two probe errors on the way, the usual ratio: `streakDays()` and
`openHoldTest()` do not exist — the real names are `computeStreak()` and
`openHoldTests()`.

### The class is now closed at all three levels

- **Level 1**, top-level fields — v390, eight fixed.
- **Level 2**, nested fields — this round, four fixed and nine measured safe.
- **Level 3**, the entries INSIDE those containers — **288 cases, zero
  problems**: every field of a day entry (including all five cardio modes'
  value/level/unit triples), a food row, a session log, a measurement, a
  score-history row, a hold record and the prep block, each fuzzed with six
  junk shapes, then booted and rendered across five tabs. Already covered by
  v353's per-mode day repair, v356's log dates, v346's food row and v374's
  photos.

**And that sweep's detector was proven both ways before the zero was
believed** — a renderer was stubbed to throw, the sweep reported the boundary,
and it cleared when the stub was removed. An id sweep earlier the same day
reported zero with a detector that could not see a problem at all, which is why
this is the standing rule rather than a note.

**And nine of the fourteen nested fields were driven and are genuinely safe**,
which is the other half of the sweep: `beatTempoPref()` clamps its own read,
`skipLevel` does a membership test at its read site, and the booleans
(`vibrate`, `neuralOn`, `autoDeload`, `deload`, `foodAiModelOk`,
`_everDeficit`) read truthy or falsy with nothing to break. Left alone rather
than padded with repairs that buy nothing — the call v285 already made and
wrote down.

### The escaped mutant set the value to the answer it then asserted

The re-derivation check wrote `goalBodyFat = levelBF(4)` before calling
`normalizeState()` and then asserted the field equalled `levelBF(4)`. A mutant
that never re-derived left it equal and walked straight through. It seeds a
**wrong** figure beside a valid level now, and requires the repair to correct
it.

## Feet are part of the standard, and the ladder was not reading them (v392)

From the athlete's own preparation package, section 5 — *"RUCKING, FEET & BOOT
READINESS"*. Its weekly self-check asks *"Any blister/hotspot not resolving
before next ruck?"*, and its readiness table grades rucking **green only when
the distance is achieved with feet intact**; *"distance achieved with
hotspots/aches"* is amber and *"pain, limp, recurrent blisters"* is red.

**Measured before building any of it.** Across **619k characters** of
athlete-visible copy the app said:

| word | occurrences |
|---|---|
| blister, hot spot, insole, toenail, chafe, break-in | **0** |
| boot | 8 — every one the software boot path |
| sock | 1 — a WebSocket comment |
| lace | 2 — hands laced behind the head |

The app schedules rucks up to 25 km a week and said nothing about the one thing
that ends a march.

### The point is the ladder, not the checklist

A kit list would have been a wall of text. What makes this a feature is that
**v326's ruck ladder raises distance or load every week and read nothing about
the athlete's feet.** An unresolved hot spot now holds it — the same shape
`painPattern()` already gives the day-90 frequency row, and the same
conservative direction as the 10% cap.

Measured on a real block, mid-way:

| week | free | held |
|---|---|---|
| a LOAD week | 35 lb | **30 lb** — the step is skipped |
| a DISTANCE week | 13.3 km | **12.1 km** — the ramp is skipped |

**Both kinds of week had to be driven.** The first week the probe found was a
load week, where the hold skipping the load step proves nothing about the
distance — a hold that stopped only one of them would pass every assertion
about the first. The check walks the block until a distance week turns up and
holds that one too, with a guard that it really found one.

### Positive evidence only, and the floor that says so

**Silence is not a blister.** An athlete who has never opened this must not have
their plan held for it, so the hold requires the latest check to say hot spot or
blister — the same call `painPattern()` makes about pain reports, and the
opposite of this file's usual fail-closed rule for a reason: the cost of
wrongly holding is a plan that never climbs for everybody.

**No invented staleness window either.** The latest check counts, full stop; an
athlete who logged a blister and stopped logging is one tap from releasing it,
and the card says exactly that. The mutant that never releases on a clear check
is caught, and so is the one that reads silence as a blister.

**The latest is by DATE, not by position.** Rows are appended and a backup can
carry them in any order, so a check pins that a file listing them backwards
still reads the newest.

**It holds only the CURRENT week.** The loop walks the history the athlete has
already done; rewriting that would be a different bug. The mutant that applies
the hold to every week is caught.

### Auditing it an hour later found the placement wrong

The first version put the whole thing — prompt, picker and hold note — on the
ruck LADDER card. That card renders inside `enduranceHTML()`, which is the
**prep sheet**. The athlete logs a ruck in **Today ▸ Workout ▸ Movement** and
has no reason to open that sheet afterwards, so the prompt was sitting on a
screen nobody would be looking at.

**And it was worse than misplaced.** `ruckLadderWeek()` returns `noDate` with
no test date, so `ruckLadderHTML()` renders **nothing at all** — an athlete who
rucks without preparing for FORCE would never have seen any of it, and blisters
are not prep-specific.

Split the way v311 split the Movement block from its Progress review: **every
control on the ruck block**, where the ruck is logged and where every rucking
athlete sees it, and **a note with no controls of its own** on the plan,
explaining why the week is not climbing. One surface owns the picker, so the
two can never disagree about what was logged.

**The note names Movement, so the pointer is asserted BOTH ways** — the plan
names the destination and the destination really carries the control, which is
the v315 rule. And a floor pins that an athlete with no test date gets an empty
ladder and a working check.

**Twenty-one mutants, all caught** — after the check rewrite below. Every fix
has its over-eager twin beside it: silence read as a blister, a clear check
that never releases, the hold applied to every week, the note shown to
everyone, and a repair that drops every row.

### The escaped mutant, and the axis the check was searching

One mutant escaped: **the hold stops the load and lets the distance climb** —
the half-working version of the whole feature. The check aimed at exactly that
existed and did not catch it, for two compounding reasons.

**It was walking the wrong axis.** `prepWeekNo()` counts forward from
`planFrom`, so moving `prep.date` changes how much time is LEFT and never
advances the week. The search moved the date, found one week labelled
`'distance'` by an accident of the taper boundary, and stopped there.

**And that week's slot happened to BE the load slot.** `climbing==='distance'`
does not imply the slot is not the load slot: a load-slot week falls through to
the distance branch once the steps are spent. So on the one week it tested, the
mutant was equivalent.

Walking twenty real weeks by `planFrom` makes it unmistakable — every distance
week climbs unheld under the mutant:

```
1 wk distance 11->11 distance     3 wk distance 12.1->12.1 distance
5 wk distance 13.3->13.3 distance 7 wk distance 14.6->14.6 distance
```

**One week is not enough, so the check now requires EVERY distance week to be
held and every load week too** — which is the property the feature claims, and
the mutant now fails it by name.

### And a mutation driver running in the background overwrote every manual seed

Half an hour was spent on a mutant that appeared to be equivalent, because
`mut400.py` was still copying its own clean file over `mut-run/index.html`
between runs while manual seeds were being written there. The seed printed
"seeded", the grep afterwards showed the clean line, and the suite result
belonged to whichever mutant the driver had just written. **Stop the driver
before seeding by hand**, or seed in a different directory.

### Every unit a ruck can be logged in

`footPromptDue()` reads `_dayRuckKm()`, which converts **minutes and calories**
as well as distance — a version that only looked at `ruckUnit==='dist'` would
leave an athlete who logs in minutes with no prompt at all, and nothing else
here would have noticed. Measured: 8 km, 75 min and 600 kcal all prompt; a day
with no ruck and a zero-value ruck row both correctly stay silent.

**And the check for it broke a later one, in a way worth recording.** It cleared
the day map with `STATE.nutrition.days = {}` while the block's own `D` still
held the OLD object, so every later write landed somewhere detached and the
prompt check further down failed on correct code. Clear a captured container
**in place**.

**One deliberate scope line.** `EX.ruck` (Ruck March) exists in the library and
can appear inside a session, where no `ruckVal` is written and so no prompt
fires. That is intended: the prompt is tied to a logged ruck with real distance
or time, which is where foot risk lives, and a ruck march inside a circuit is
bounded by the session length.

### And the check for it was reading the builder, not the screen

Every assertion in the first block read `ruckBlockHTML()`'s **output**, which
stays true even if the block is never mounted — the escape this file records
for the v292 Convert button and four times since. Driving it properly is what
found the placement defect in the first place: a real tap on a real screen
returned **0 buttons**.

The block now renders Today, finds the button, **clicks it**, and reads the
screen back: the row is written, the prompt disappears and the hold note takes
its place; tapping clear releases it on the same day's row.

**And that probe first measured the WELCOME screen** — the in-page seed does
not onboard, so the view was 1,098 characters of onboarding step 1. The trap is
already in this file from the end-of-program probe; the fix is to seed through
the harness's own `ATHLETE`.

### The two resets, and the half that matters

`restartProgram()` is the path v365 records as *"the one reset that never asked
the list"*, so a new lifetime field is exactly what it forgets — or wrongly
clears. Driven: a restart **keeps** the foot log and the hold, and `hardReset()`
clears both.

**The hold is the consequential half.** A restart that released it would start
the ladder climbing again over an unresolved blister — the same failure as a
backup restore that lost it, by a different door. Both are pinned.

### The prompt fires where the package says to inspect

*"Inspect after every ruck"* — so `footPromptDue()` fires on a day a ruck was
actually logged and stops once it is answered. A prompt that appears every day
is a prompt nobody reads, and both mutants (always fire, never stop) are caught.

The foot-care kit is the package's own eight items, stamped with `DAY90_SRC`
and `DAY90_ASOF` for the same reason every other figure from it is: a published
list shown with confidence that has gone stale is worse than none.

## One fact, one place — and a check that pinned the duplication (v393)

Found by rendering every surface with every new feature active at once and
reading the notes, rather than by asking whether a screen renders. The
endurance sheet printed **the identical sentence twice**.

`footLoadHTML()` is called from the running plan AND from the ruck ladder, and
both live in the SAME sheet — `ruckLadderHTML()` renders inside
`enduranceHTML()`. Both read the same global answer from `footNewMode()`, which
**v332 made deliberate so they could never disagree**. The consequence nobody
measured is that they then rendered the same sentence twice, a few lines apart.

Measured, and it hits **every athlete with a prep block**, not only the warned
one:

| athlete | before | after |
|---|---|---|
| history in both modes | *"together: 25.4 km on your feet"* **x2** | x1 |
| rucker taking up running | the new-mode warning **x2** | x1 |
| runner taking up rucking | the new-mode warning **x2** | x1 |

**A reader seeing the same number twice with two labels does not feel doubly
informed, they wonder which one is real** — v314's lesson, one sheet over. The
caller now says which card it is: the combined total goes on the running card,
which renders first, and the warning goes on the card of the mode that is
actually NEW, because that is the plan its advice is about.

### The check asserted "and on the rucking card too"

Two v332 checks pinned the duplication in place — the fourth time this session
a check has held old behaviour rather than caught it. They were not stale
copy-paste: they encoded a real intent, *the total is on both cards so whichever
one you read you see it*. What nobody had measured is that both cards are
**always co-rendered in one sheet**, so "whichever one you read" was never the
situation.

Re-aimed rather than deleted, to the requirement underneath: the fact appears
**exactly once in the sheet**, and the warning sits on the card for the mode
that is actually new. That is stronger than "on both" — it catches a future
third caller as well.

**And `card` was already the whole sheet.** The probe builds it as
`strip(enduranceHTML())`, which contains `ruckLadderHTML()`, so counting
occurrences in `card` is a count over the whole screen. Reading what the probe
actually collected is what made the re-aim exact instead of a guess.

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
2. `npm test` — all 24 suites green, zero page errors, validator clean.
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

## The history file

`CLAUDE-HISTORY.md` holds the round-by-round record — 60 sections, ~4,200
lines. It used to be the back half of this file, which meant every session in
this folder paid ~67k tokens for it whether or not the round in question was
relevant.

It is now read on demand. The rules it produced are above and binding on their
own; the file is the evidence, not the law.

```
grep -n '^## ' CLAUDE-HISTORY.md                        # the index
sed -n '/^## Parallettes/,/^## /p' CLAUDE-HISTORY.md    # one section
grep -n 'acwr\|loadSpike' CLAUDE-HISTORY.md             # find the round
```

Sections, in the order they shipped:

- Loaded progression past the bodyweight ceiling
- Feeding the logged load back in (v226)
- Corrective work for a flagged joint, and objective training load (v227)
- VO2max and anaerobic-capacity work
- Full-body compound loading (dumbbell + kettlebell)
- Movement earns room, but only the surplus
- Daily readiness (sleep, soreness, energy auto-regulation)
- Joint-aware warm-up, and the bike's missing memory (v228)
- Data safety and serviceability (v229)
- App-store listing quality (v230)
- Functional quality pass (v231)
- Three new core exercises (v232)
- Five new kettlebell exercises (v233)
- Two more roster gaps: standing ab-wheel rollout, battle-rope plank (v234)
- Real photos landing after the fact (v235)
- The library goes fully photographed (v236)
- Extended Arm Plank (v237)
- A full QA audit, and seven fixes (v238)
- A second audit pass: goal direction, and the twins the first pass missed (v239)
- A third audit pass, and a shipped fix that didn't actually fix anything (v240)
- A fourth audit, scoped to what a client-only app actually has (v241)
- A real in-app timer for the step-makeup jacks/bike blocks (v242)
- Eight more exercises from a screenshot roster comparison (v243)
- The v243 roster's real photos land as one collage, cropped by hand
- A follow-up gap search finds one real addition: Dumbbell Bench Press (v244)
- The photo estimate learns portions, and Fuel loses its suggested menu (v245)
- Today is today's workout, and nothing else (v246)
- Auditing the two changes that had just shipped (v246, same round)
- A ninth baseline test: Jump Squats, and re-anchoring explosive power (v247)
- Progress photos moves next to the goal picker (v248)
- Strength Trends covers all nine tests, and an audit finds two more (v249)
- A pre-launch pass finds a real drift check broken by its own arithmetic (v250)
- The baseline test never checked a flagged joint, and "tunes warm-up" was a sentence, not a number (v251)
- A tenth baseline test: Burpees, for stamina the battery never measured (v252)
- Importing a screenshot from another tracker (v253)
- The Gemini timeout was too short, and the athlete found it within minutes (v254)
- The screenshot never reached the model legible (v255)
- The audit the athlete had to ask for, and the silent-coach bug it found (v256)
- A 503 is advice, and the app was not taking it (v257)
- The retry that could not fire, and the 75-second wait (v258)
- Diagnosing instead of guessing again (v259)
- Calories without macros is a MISSING answer, not a zero (v260)
- The model list had rotted, and the diagnostic is what found it (v261)
- The macros were always on screen — as percentages (v262)
- Self-defence: the app tests itself on the phone I cannot reach (v263)
- Four parallel senior audits, and the twenty fixes they found (v264)
- The four deliberately-deferred items, closed (v265)
- A logged zero macro is not a measured zero (v266)
- Parallettes, and a wrist flag that means "change the implement" (v267)
- The pitch bases were tuned on a desktop, and a phone said so (v269)
- Setting up the neural voice: the third call this sandbox cannot reach (v272)
- The barcode scanner read only half of Open Food Facts (v274)
- An audit that found no bug, and the coverage gap it did find (v275)
- API keys now survive "Reset all data" (v276)
- Day 1 says what a normal day looks like, not just the test (v277)
- The first Week-1 video, salvaged from a generation that ignored its own instruction (v280)
- The rest of the "hard to visualize" video request, and a genuine success (v280, cont'd)
- Nine controls had no name a screen reader could read (v269)
- Progression for the formats that never had any (v279)
- A stability ball, and three genuinely new exercises (v281)
