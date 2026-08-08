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
