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
