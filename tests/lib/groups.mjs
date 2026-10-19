/* Splitting the suite across CI runners (v518).

   One runner took about 16 minutes for all 25 suites. CI now runs them on
   GROUPS of runners at the same time, and this file decides which suite goes
   to which group.

   THE RISK IS A SUITE THAT RUNS NOWHERE. A suite left out of every group
   passes CI by never running, and nothing on the summary page says so. So
   partition() is checked on every `npm run check` (the build gate) and again
   by run.mjs before it runs a group: every suite in exactly one group, no
   group empty. A fixed list per group would be the drift this repo fixes
   everywhere else; the groups are computed from the files on disk.

   The weights are seconds measured on a full local run (v517, 990 s). They
   only affect BALANCE, never correctness — a wrong weight makes one runner
   slower, it never drops a suite. A suite with no weight fails the gate, so a
   new suite is weighed on the day it is added rather than guessed at for ever.

   Suite 23 alone is ~450 s, more than the other 24 together divided by three,
   so it sits in a group of its own and sets the wall-clock time. That is the
   floor this split can reach without splitting a file. */
export const WEIGHTS = {
  '01': 3, '02': 2, '03': 28, '04': 50, '05': 152, '06': 3, '07': 15,
  '08': 5, '09': 37, '10': 31, '11': 4, '12': 61, '13': 8, '14': 26,
  '15': 15, '16': 20, '17': 1, '18': 2, '19': 13, '20': 51, '21': 5,
  '22': 2, '23': 446, '24': 2, '25': 10, '26': 4,
};

export const weightOf = f => WEIGHTS[f.slice(0, 2)];

/* Longest-first, each suite to the lightest group so far. Ties break on the
   file name, so every runner computes the same split from the same files. */
export function partition(files, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error('group count must be a whole number of 1 or more');
  const groups = Array.from({length: n}, () => ({files: [], secs: 0}));
  const order = [...files].sort((a, b) => ((weightOf(b) ?? 0) - (weightOf(a) ?? 0)) || (a < b ? -1 : 1));
  for (const f of order) {
    let best = groups[0];
    for (const g of groups) if (g.secs < best.secs) best = g;
    best.files.push(f);
    best.secs += weightOf(f) ?? 0;
  }
  groups.forEach(g => g.files.sort());
  return groups;
}

/* Every problem with a split, as sentences. Empty means it is safe to run. */
export function partitionProblems(files, n) {
  const out = [];
  for (const f of files) if (weightOf(f) === undefined) out.push(`${f} has no weight in tests/lib/groups.mjs — add its measured seconds`);
  for (const k of Object.keys(WEIGHTS)) if (!files.some(f => f.startsWith(k + '-'))) out.push(`tests/lib/groups.mjs weighs suite ${k}, which does not exist`);
  const groups = partition(files, n);
  const seen = new Map();
  groups.forEach((g, i) => g.files.forEach(f => seen.set(f, (seen.get(f) || []).concat(i + 1))));
  for (const f of files) {
    const at = seen.get(f) || [];
    if (at.length !== 1) out.push(`${f} runs in ${at.length} groups (${at.join(', ') || 'none'}) — every suite must run exactly once`);
  }
  for (const f of seen.keys()) if (!files.includes(f)) out.push(`group lists ${f}, which is not a suite`);
  if (files.length >= n) groups.forEach((g, i) => { if (!g.files.length) out.push(`group ${i + 1} of ${n} is empty`); });
  return out;
}
