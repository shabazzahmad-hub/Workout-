/* The app is one inline <script> in a single HTML file, so a syntax error is
   invisible to every other tool. Extract it and parse it before anything else
   runs — a broken parse means every browser test would fail with the same
   unhelpful message. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const open = src.indexOf('<script>');
const close = src.lastIndexOf('</script>');
if (open < 0 || close < 0) { console.error('no inline <script> found in index.html'); process.exit(1); }
const js = src.slice(open + 8, close);

try {
  new vm.Script(js, { filename: 'index.html <script>' });
} catch (e) {
  console.error('✗ index.html inline script does not parse');
  console.error('  ' + e.message);
  process.exit(1);
}
console.log(`✓ index.html inline script parses (${js.split('\n').length} lines)`);

const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
try { new vm.Script(sw, { filename: 'sw.js' }); }
catch (e) { console.error('✗ sw.js does not parse\n  ' + e.message); process.exit(1); }
console.log('✓ sw.js parses');

/* APP_VERSION and the service-worker CACHE are the update mechanism. Out of step
   means phones either never see a new version or serve a stale cache against new
   code, so this is a build-breaking mismatch rather than a warning. */
const ver = (js.match(/APP_VERSION\s*=\s*'(\d+)'/) || [])[1];
const cache = (sw.match(/const CACHE\s*=\s*'([^']+)'/) || [])[1];
if (!ver || !cache) { console.error('✗ could not read APP_VERSION or CACHE'); process.exit(1); }
if (cache !== 'coreforge-v' + ver) {
  console.error(`✗ APP_VERSION (${ver}) and sw.js CACHE (${cache}) are out of step`);
  console.error('  Bump both together or the update mechanism breaks.');
  process.exit(1);
}
console.log(`✓ APP_VERSION ${ver} matches CACHE ${cache}`);

/* ---- safety lexicon -------------------------------------------------------
   The app tells the athlete, in the player and on the health screen, that sharp
   pain means stop. Six coach lines said the opposite — "Pain is just weakness
   leaving", "March through the pain", "When it hurts, that is the one that
   counts" — so the same product gave mutually exclusive instructions at the
   exact moment someone is deciding whether what they feel is normal effort or a
   warning. Motivation may push effort, burn and fatigue. It may never use pain,
   or a symptom, as the thing to push through.

   A build gate rather than a test because it costs nothing and the failure mode
   is a well-meant line added months from now, in a persona nobody re-reads. */
const BANNED = [
  [/pain is (just )?weakness/i, 'frames pain as weakness'],
  [/(march|push|power|fight|train|work)(ing)? (on |right )?through the pain/i, 'says to push through pain'],
  [/no pain,? no gain/i, 'the "no pain no gain" framing'],
  [/when it hurts/i, 'treats hurting as the goal'],
  [/steal from the pain|embrace the pain|love the pain|welcome the pain/i, 'romanticises pain'],
  [/suffer (well|in silence|more)/i, 'frames suffering as the objective'],
  [/ignore the (pain|dizziness|chest)/i, 'tells the athlete to ignore a symptom'],
];
/* Quoted strings only: prose in comments explaining this rule must not trip it,
   and neither must the code that HANDLES pain (hurtStop, painCount, the "sharp
   pain means stop" cue, which are the messages we want). */
const strings = js.match(/"(?:[^"\\\n]|\\.){2,300}"/g) || [];
const offenders = [];
for (const raw of strings) {
  for (const [re, why] of BANNED) {
    if (re.test(raw)) offenders.push(`${why}: ${raw.slice(0, 100)}`);
  }
}
if (offenders.length) {
  console.error(`✗ ${offenders.length} coach line(s) conflict with the stop-for-pain rule`);
  offenders.forEach(o => console.error('  ' + o));
  console.error('  Coach effort, burn and fatigue — never pain or a symptom.');
  process.exit(1);
}
console.log(`✓ no coach line contradicts the stop-for-pain rule (${strings.length} strings scanned)`);

/* ---- External-integration contract ---------------------------------------
   Every failure the athlete hit on a real phone in one day — an 8s timeout on
   an image upload, a 503 the app refused to retry, a stalled connection with
   no total bound, two retired model ids tried first on every import — was the
   same shape: a call leaving the phone without the defences a call leaving
   the phone needs. Each was found by the athlete, one at a time, because
   nothing here objected.

   A build gate rather than a test, for the same reason the coach-line rule is
   one: the failure mode is a plausible-looking line added months from now, by
   someone who has not read this file, and the cost of checking is nothing. */
const EXT = [];

/* 1. No bare fetch(). fetchWithTimeout is the ONLY way out, because a
      connection that associates and then hangs never rejects on its own. */
{
  const stripped = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const bare = (stripped.match(/[^a-zA-Z_.]fetch\s*\(/g) || []).length;
  const wrapped = (stripped.match(/fetchWithTimeout\s*\(/g) || []).length;
  // fetchWithTimeout's own single internal fetch() is the one legitimate call
  if (bare > 1) EXT.push(`${bare} bare fetch() calls — every outbound call must go through fetchWithTimeout()`);
  if (!wrapped) EXT.push('fetchWithTimeout() is never called — the timeout wrapper exists but nothing uses it');
}

/* 2. A vision/AI call must be bounded by something far larger than the small JSON
      default, and the whole operation must have a ceiling. Both were learned
      the hard way: 8000ms killed image uploads, and 3 models x 25s with no
      total budget meant 75 seconds before the athlete saw anything. */
{
  if (!/AI_TOTAL_BUDGET_MS\s*=\s*\d{4,}/.test(js))
    EXT.push('no AI_TOTAL_BUDGET_MS — a retrying multi-model call needs a hard ceiling on the whole operation');
  const m = js.match(/_geminiCall\s*\([^)]*\)\s*\{[\s\S]{0,400}?ms\s*\|\|\s*(\d+)/);
  if (!m) EXT.push('_geminiCall has no default timeout');
  else if (+m[1] < 15000) EXT.push(`_geminiCall default timeout is ${m[1]}ms — too short for an image upload plus inference`);
}

/* 3. Transient failures must be retried, and a timeout (status 0) is the most
      common transient failure there is — leaving it out is what made the
      retry added in v257 unable to fire for the case it was built for. */
{
  const t = js.match(/_transientAIStatus\s*\([^)]*\)\s*\{\s*return([^;]+);/);
  if (!t) EXT.push('no _transientAIStatus classifier — transient and permanent failures must be told apart');
  else {
    if (!/s\s*===\s*0/.test(t[1])) EXT.push('_transientAIStatus omits status 0 — a timeout is retryable and is the most common one');
    if (!/503/.test(t[1])) EXT.push('_transientAIStatus omits 503 — the status whose own body says to try again');
  }
}

/* 4. The model list must contain a floating alias. Pinning every id is what
      rotted: Google retired two of three for newer keys, and the app kept
      trying them first on every single import. */
{
  const m = js.match(/FOOD_AI_MODELS\s*=\s*\[([^\]]+)\]/);
  if (!m) EXT.push('FOOD_AI_MODELS not found');
  else {
    const ids = m[1].match(/'([^']+)'/g) || [];
    if (!ids.some(x => /latest/.test(x))) EXT.push('FOOD_AI_MODELS pins every id — keep a "-latest" alias so the list cannot rot');
    if (!/latest/.test(ids[0] || '')) EXT.push('FOOD_AI_MODELS does not lead with the floating alias — a retired pin costs a dead round-trip on every call');
  }
}

/* 5. Anything the athlete can be blocked by needs a diagnostic they can run
      themselves. Six rounds were spent inferring from one line of toast text
      because there was no way to see a status code from here. */
{
  if (!/function runAIDiagnostic/.test(js)) EXT.push('no runAIDiagnostic() — an external integration needs an on-device diagnostic');
  /* Anchored on the DEFINITION and a real CALL, not a bare substring: a
     substring match is satisfied by any longer name that merely starts the
     same way, so renaming the function to _importSelfTestX walked straight
     through the first version of this gate. */
  if (!/function _importSelfTest\s*\(/.test(js))
    EXT.push('no _importSelfTest() — the diagnostic must exercise the real pipeline, not only reachability');
  if (!/await _importSelfTest\s*\(/.test(js))
    EXT.push('_importSelfTest() is defined but never run by the diagnostic');
}

if (EXT.length) {
  console.error(`✗ ${EXT.length} external-integration contract violation(s)`);
  EXT.forEach(o => console.error('  ' + o));
  console.error('  Every call that leaves the phone needs: a timeout, a total budget,');
  console.error('  a transient/permanent classifier, a non-rotting model list, and a');
  console.error('  diagnostic the athlete can run without me.');
  process.exit(1);
}
console.log('✓ external calls carry their timeouts, budget, retry classifier and diagnostic');
