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
conditioning slots and `hasTrainer()` gates the bike work, both off that key,
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
