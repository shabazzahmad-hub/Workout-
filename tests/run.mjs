/* Test runner. Exits non-zero if anything fails, so CI can gate on it.

   Run everything:      npm test
   Run one file:        npm test -- 03
   Keep going on fail:  npm test -- --all   (default is to run all anyway;
                        this flag exists so `--bail` can be the opposite) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportLive } from './lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const bail = args.includes('--bail');
const filter = args.find(a => !a.startsWith('--'));

const files = fs.readdirSync(HERE)
  .filter(f => f.endsWith('.test.mjs'))
  .filter(f => !filter || f.includes(filter))
  .sort();

if (!files.length) {
  console.error('no test files matched' + (filter ? ` "${filter}"` : ''));
  process.exit(1);
}

console.log(`CoreForge — running ${files.length} test file${files.length === 1 ? '' : 's'}\n`);
const started = Date.now();
let failed = 0;
const broken = [];

for (const f of files) {
  const t0 = Date.now();
  try {
    const mod = await import(path.join(HERE, f));
    const n = await mod.default();
    if (n > 0) { failed += n; broken.push(f); }
  } catch (e) {
    failed++; broken.push(f);
    console.log(`\n✗ ${f} — the test file itself threw`);
    console.log('    ' + String(e.stack || e).split('\n').slice(0, 6).join('\n    '));
    /* Print the checks the file had already failed on its way to the throw.
       Without this a throw discards them, and the check that named the defect
       is the one you never see. */
    try { failed += reportLive(); } catch (e2) {}
  }
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (bail && failed) break;
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log('\n' + '─'.repeat(56));
if (failed) {
  console.log(`FAILED — ${failed} check${failed === 1 ? '' : 's'} in ${broken.length} file${broken.length === 1 ? '' : 's'} (${secs}s)`);
  broken.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
console.log(`All checks passed in ${secs}s`);
