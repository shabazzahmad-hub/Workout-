/* ONE NOUN LIST FOR ONE CLASS.

   "A count joined onto a plural noun" is the same defect however it is written,
   and this app has three shapes of it and two detectors:

     - a LITERAL            "1 sets"            v459
     - CONCATENATION        n+' reps'           v489, v507 (a source scan)
     - INTERPOLATION        `${n} moves`        this file

   Until now each detector carried its OWN noun list. The rendered sweep in
   suite 09 knew 24 nouns and `points` was among them; the source scan in
   suite 23 knew 18 and it was not. So `arrow(d)+' points'` on Progress >
   Strength was invisible to the source scan for want of a noun — while the
   rendered sweep, which knew the noun perfectly well, had never seeded a score
   delta of 1 and so had nothing to see.

   Two definitions of one rule is two places for it to drift, and this pair had
   already drifted. Both detectors ask this list now: suite 23 builds its regex
   from it, and suite 09 passes it into the page.

   ABBREVIATIONS STAY OUT. "1 kcal", "1 min", "1 kg", "1 lb" are correct
   English, and a detector that reported them would be measuring something it
   was not named for — this file's most-repeated check defect. */
export const PLURAL_NOUNS = [
  'sets', 'exercises', 'moves', 'movements', 'reps', 'rounds', 'sessions',
  'workouts', 'tests', 'blocks', 'weeks', 'months', 'days', 'hours', 'minutes',
  'seconds', 'meals', 'calories', 'grams', 'cups', 'glasses', 'photos',
  'badges', 'entries', 'stretches', 'points', 'holds',
];
export const PLURAL_NOUNS_RE = PLURAL_NOUNS.join('|');
