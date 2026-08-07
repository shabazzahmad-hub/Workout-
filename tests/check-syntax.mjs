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
