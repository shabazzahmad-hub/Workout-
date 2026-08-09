# CoreForge tests

The app is a single 8,000-line HTML file with one inline `<script>`, deployed
straight to GitHub Pages from `main`. There is no build step and no framework,
so this suite is the only thing standing between a bad commit and an installed
app that updates itself on people's phones.

```
npm install
npx playwright install chromium
npm run check      # parses the inline script, asserts APP_VERSION/CACHE lockstep
npm test           # the full suite
npm test -- 03     # just one file
npm test -- --bail # stop at the first failing file
```

CI runs both on every push and every pull request, and `deploy-pages.yml` will
not publish unless they pass.

## What each file covers

| File | Covers |
|---|---|
| `01-data.test.mjs` | `validateData()`, ladder monotonicity, anchor/unit agreement, duplicate keys in the hand-maintained literals, service-worker shell completeness |
| `02-safety.test.mjs` | PAR-Q gating, injury swaps across all 31 joint combinations, allergen filtering, stored XSS |
| `03-program.test.mjs` | A full 378-session run, load intensity at three levels, goal handling, the athletes most likely to be underserved |
| `04-journey.test.mjs` | The wizard, the 8-test baseline, the four Today panes, the guided player, every button on every tab |
| `05-state.test.mjs` | Hostile saves, upgrades from older builds, idempotence, and the everyday flows that write to storage |
| `06-reference.test.mjs` | The Reference tab: costing an arbitrary amount, the seven days scaled onto a live target, the derived shopping list, and both write paths into the food log |
| `07-movement.test.mjs` | Trading a ride for steps in three currencies, in both unit systems, plus hostile input and the tick agreeing with the number |
| `08-clock.test.mjs` | The session clock: the time budget, pause staying free and honest at every phase, the nudges, and what reaches the log |
| `09-audit.test.mjs` | The v190 audit fixes — asserted under the specific timezone, unit system and training schedule each defect needed to appear |

## Why the checks are shaped the way they are

Nearly every assertion here exists because the thing it checks actually broke
once. A few worth knowing about, because they shape how you should add to this
suite:

**Assert against a derived value, not the bound you are testing.** An earlier
suite asserted `worstReps <= 40` while the bug under test was a rep ceiling
pinning everything at exactly 40. It passed for months. `03-program` now
measures each prescription against `max × hardness` — the athlete's predicted
best set at *that* movement — so an over-prescription cannot hide inside the
clamp.

**Call the function the app calls.** A check on Phase-1 structure read
`SESSIONS[].slots` directly and never called `goalSlots()`, so it was true of
the data table and false of the program for three goals out of six.

**Seed values the app actually writes.** A nutrition check set `sex: 'f'`, which
no code path in the app ever produces — it tested a branch users could not
reach, while the real `'female'` path was broken.

**Escaped text is not a leak.** Reading `innerHTML` back shows `onerror="..."`
inside correctly-escaped content, because quotes need no escaping in a text
node. `02-safety` asserts on *execution* and on live markup reaching the DOM,
not on a substring.

**A tab that writes needs its numbers checked, not just its markup.** The
Reference food list is a write surface — tapping a row costs an amount and logs
it, and "Log this meal" writes several entries at once — so `06-reference`
reconciles every food's protein, derived carbs and fat back against its own
calorie count, and names the specific rows a category-average estimate got
wrong. It found olive oil logging as 20 g of carbohydrate.

**When nothing is hand-typed, assert the relationships.** Every figure on the
Reference tab is computed: a day's header is its meals, a day scaled to a target
lands on that target, the shopping list is the sum of the days. That removes
drift as a failure mode and replaces it with "the arithmetic is confidently
wrong", so the checks assert those identities at five different targets rather
than comparing against a fixture. The same block asserts that no amount the
scaler produces is one nobody would plate — an earlier version closed a calorie
gap by putting 770 g of potato in a single sitting, which was arithmetically
correct and useless as coaching.

**Scope a "does not appear" assertion to the element that owns it.** The first
version of the fish-filter check searched the whole view for `Chicken breast`
and failed on the shopping list further down the page, which legitimately names
it under every filter. It now reads the rendered rows and checks their category.

**A hash-only `page.goto` does not reload.** Navigating from `/` to `/#ref` is a
same-document navigation, so `boot()` never re-runs and the deep-link check
passes against whatever tab was already open. `06-reference` sets the hash and
calls `page.reload()`.

**Wait on the condition, never on a stopwatch.** `boot()` awaits `idbOpen()` and
`load()` before it normalises state and renders, so `domcontentloaded` and
`networkidle` both fire while `STATE` is still the empty default. A 400 ms sleep
after a reload passed on a development machine and failed on a CI runner — which
reads as a broken app rather than as a check measuring the runner. `waitForBoot()`
in the harness waits for a rendered active view instead, and `launch()` calls it
too, because the first load races exactly like a reload does.

**`history.back()` is asynchronous, and `closeSheet()` calls it.** Any block that
opens and closes sheets leaves a back navigation queued. In `06-reference` it
landed *after* `location.hash = 'ref'`, reverted the URL, and the reload came up
on Today with no hash. Nothing was wrong with the app — a real thumb cannot
produce that sequence — but the deep-link check has to be immune to it. It now
navigates out to `about:blank` and back in with an explicit URL, which makes the
destination unambiguous and drops any queued history work. localStorage is
per-origin, so the seeded athlete survives the round trip.

**A guard band can be the only check that sees the bug.** The bike conversion
survives a swap from net METs to the gross compendium values with everything
still looking right: `MET × 35` still holds, every intensity still costs the
same energy, the table still reads sensibly — and roughly 20% more credit is
handed out than was earned. Nothing but the wall-clock time gives it away, so
`07-movement` asserts each intensity's minutes for 10,000 steps against a band
anchored on what walking it would take.

**Watch for a downstream guard masking an upstream one.** `movement()` clamps on
read, so removing the clamp in `setSteps()` changed nothing any behavioural check
could see. The clamp on the way in still matters — it is what `exportData()`
ships and what the history repair has to cope with — so there are now checks
that read the stored value directly, not just the accessor.

**Check the physics before you trust your own expectation.** A check asserting
that "10 km is 10 km at any intensity" failed, and the model was right: covering
the same distance faster costs *more* energy, because the resistance and the
drag are what made it faster. Only calories are genuinely intensity-free, and
that is not a special case — the MET cancels between steps-per-minute and
kcal-per-minute. The checks now assert each currency's actual behaviour, which
is the thing worth pinning down.

**Faking time is fast, and it cannot see the app not setting the clock.** Every
check in `08-clock` moves `PLAYER.t0` and `PLAYER.pauseAt` by hand, which keeps
the file under three seconds. But because the checks set `pauseAt` themselves,
deleting the line in `playerToggle()` that *starts* the pause left the whole
block green — the tests were supplying the very state they were meant to be
verifying. There is now one check that pauses, waits 1.6 s on the real clock,
and asserts nothing moved. It costs the suite two seconds and it is the only
one that proves the promise end to end.

**Moving `t0` back is not the same as time passing.** The first attempt at that
un-faked check moved `t0` while paused, which models the session having started
earlier — not two minutes elapsing during the pause. Both the total and the
paused figure have to grow together, or the assertion is about a scenario that
cannot happen.

**Some defects only exist under conditions the reviewer does not share.** The
five-reviewer audit that produced `09-audit` found bugs that were invisible in
the default test context and perfectly visible one setting away: the readiness
deload worked in UTC and failed west of it after 6pm; the waist-pace verdict
was correct in centimetres and wrong in inches; the comeback ease was fine at
five sessions a week and pinned a two-day-a-week athlete permanently. So this
file deliberately drives a real `America/Denver` browser context with a fixed
clock, flips `profile.unit`, and varies `profile.days` — rather than asserting
everything against one comfortable default.

**Absence needs a check too.** Several findings were things that never
happened: a nudge that could not fire, a button two toasts promised that did
not exist, photo bytes missing from a backup the error boundary tells you to
take. Nothing throws for any of those, so only an assertion that the thing IS
there will catch its removal.
