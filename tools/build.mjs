/* The publish build (v517).

   index.html carries the whole app in one inline <script>, and about 40% of
   that file is developer comments — the record of why each rule exists. A
   phone downloads every byte of it on first install and every update, and the
   comments do nothing there. They also pushed the install tier against its
   2 MB budget every few versions.

   So the SOURCE keeps every comment and the PUBLISHED copy drops them. The
   build is deliberately the smallest change that does that:

   - compress:false  — no expression is rewritten, so no behaviour can change.
   - mangle:false    — no name is shortened. The markup calls handlers by name
                       (onclick="openSettings()"), so a renamed function would
                       be a dead button.
   - comments:false  — the one thing removed.

   Whitespace goes too, because terser re-prints the code; template literals
   and string contents are left exactly as written.

   - quote_style:3   — every string keeps the quote it was written with. This
                       one is load-bearing, not cosmetic: selfUpdate() fetches
                       the live index.html and finds the version with the
                       pattern APP_VERSION='NNN' — single quotes. terser's
                       default re-prints that as "517", so every phone already
                       installed (carrying the old pattern) would never have
                       seen an update. The syntax tree is identical either way,
                       which is exactly why the tree proof could not catch it;
                       suite 25 pins it on the published text.

   EVERY BUILD PROVES IT CHANGED NOTHING BUT THE COMMENTS. Each script is
   parsed before and after, and the two syntax trees must be identical once
   positions and the raw spelling of literals are set aside (25000 prints as
   25e3; a quote style can change; redundant brackets and a `{tab:tab}` written
   out long have no node of their own). If anything else differs the build
   throws and nothing is published. Everything outside the scripts — the
   markup and the stylesheet — must come out byte-identical.

   Usage:  node tools/build.mjs [outDir]     (default: dist)
   The test suite imports buildIndex() and serves the built copy, so what is
   checked is what is published. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {minify} from 'terser';
import {parse} from 'acorn';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Everything at the root is published as before, except what only development
   needs. A file left off this list is a file a phone asks for and gets a 404. */
const SKIP = new Set(['.DS_Store', '.git', '.github', 'node_modules', 'tests', 'tools', 'dist',
  'package.json', 'package-lock.json', '.gitignore']);

/* A plain inline <script> — not one with a src, and not a data block such as
   type="application/json", which terser cannot parse and must not touch. */
const SCRIPT_RE = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;

/* The syntax tree with everything a re-print may legitimately change removed.
   A property key written as a string ('a') and one written bare (a) are the same
   key when it is not computed, and `{tab}` is `{tab:tab}`. */
function fixTree(n) {
  if (n && typeof n === 'object') {
    for (const k in n) fixTree(n[k]);
    if ((n.type === 'Property' || n.type === 'PropertyDefinition' || n.type === 'MethodDefinition')
        && !n.computed && n.key && n.key.type === 'Literal') n.key = {type: 'Identifier', name: String(n.key.value)};
    delete n.shorthand;
  }
  return n;
}
const DROP = new Set(['start', 'end', 'raw', 'loc', 'range']);
function tree(src, module) {
  return JSON.stringify(fixTree(parse(src, {ecmaVersion: 'latest', sourceType: module ? 'module' : 'script'})),
    (k, v) => DROP.has(k) ? undefined : (typeof v === 'bigint' ? v + 'n' : v));
}
export function sameProgram(a, b, module = false) {
  return tree(a, module) === tree(b, module);
}
const stripScripts = h => h.replace(/<script(\s[^>]*)?>[\s\S]*?<\/script>/g, '<script$1></script>');
const scriptsOf = h => [...h.matchAll(SCRIPT_RE)].map(m => ({attrs: m[1] || '', code: m[2]}));
const isCode = attrs => !/\bsrc=/.test(attrs) && !(/\btype=/.test(attrs) && !/\btype=["']?(text\/javascript|module)/.test(attrs));

/* The proof, run on the FINAL page rather than on each script as it comes out
   of terser — a step between the two could otherwise change what is written
   after it was checked. Every script must be the same program as its source
   counterpart (a data block byte-identical), and everything outside the
   scripts byte-identical. Throws, so a failed proof publishes nothing. */
export function verifyBuilt(src, built) {
  const a = scriptsOf(src), b = scriptsOf(built);
  if (a.length !== b.length) throw new Error('the build changed how many scripts the page has');
  a.forEach((x, i) => {
    const y = b[i];
    if (x.attrs !== y.attrs) throw new Error('the build changed a script tag');
    if (!isCode(x.attrs)) { if (x.code !== y.code) throw new Error('the build changed a data block'); return; }
    if (!sameProgram(x.code, y.code, /type=["']?module/.test(x.attrs)))
      throw new Error('the built script is not the same program as the source — refusing to publish it');
  });
  if (stripScripts(built) !== stripScripts(src)) throw new Error('the build changed something outside a script — refusing to publish it');
  return true;
}

export async function buildIndex(html) {
  const parts = [];
  let last = 0, m, count = 0;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(html))) {
    const attrs = m[1] || '';
    if (!isCode(attrs)) continue;
    const out = await minify(m[2], {
      compress: false, mangle: false, module: /type=["']?module/.test(attrs),
      ecma: 2022, format: {comments: false, inline_script: true, quote_style: 3},
    });
    if (typeof out.code !== 'string' || !out.code.length) throw new Error('terser produced no code');
    parts.push(html.slice(last, m.index), `<script${attrs}>`, out.code, '</script>');
    last = m.index + m[0].length;
    count++;
  }
  if (!count) throw new Error('no inline script found — this is not the app');
  parts.push(html.slice(last));
  const built = parts.join('');
  verifyBuilt(html, built);
  return built;
}

export async function build(outDir = path.join(ROOT, 'dist')) {
  fs.rmSync(outDir, {recursive: true, force: true});
  fs.mkdirSync(outDir, {recursive: true});
  for (const name of fs.readdirSync(ROOT)) {
    if (SKIP.has(name) || /^mut/.test(name) || /\.mjs$/.test(name)) continue;
    fs.cpSync(path.join(ROOT, name), path.join(outDir, name), {recursive: true});
  }
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const built = await buildIndex(src);
  fs.writeFileSync(path.join(outDir, 'index.html'), built);
  return {outDir, srcBytes: Buffer.byteLength(src), builtBytes: Buffer.byteLength(built)};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await build(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`index.html ${Math.round(r.srcBytes / 1024)} KB -> ${Math.round(r.builtBytes / 1024)} KB  (${r.outDir})`);
}
