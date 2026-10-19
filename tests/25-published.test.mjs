/* Suite 25 — the PUBLISHED copy (v517).

   Since v517 the site a phone downloads is not the source tree: tools/build.mjs
   strips every developer comment out of index.html (1,863 KB -> 1,059 KB), and
   only that copy is published. Every other suite drives the SOURCE. This one
   builds the published copy exactly the way the deploy does and drives THAT,
   because a check on the source says nothing about a file nobody tested.

   Two layers, and they cover different failures:

   - THE BUILD PROVES ITSELF. buildIndex() refuses to output a script whose
     syntax tree differs from the source's, and markup that is not
     byte-identical. The guard below shows that proof can fail — a proof that
     always passes proves nothing.
   - THE APP IS DRIVEN. A fresh install, every tab and pane, a dozen sheets, a
     whole guided session, the validator, and every inline handler name the
     rendered markup calls. A dead button and a thrown render are both things a
     syntax tree cannot show.

   The 42 checks that read the app's own source TEXT in the page (comment
   positions, spacing, Function.toString()) are left to the source run on
   purpose: they are about how the code is written, and the published copy is
   meant to read differently. */
import { serve, launch, suite, seedAthlete, ROOT } from './lib/harness.mjs';
import { build, buildIndex, sameProgram, verifyBuilt } from '../tools/build.mjs';
import fs from 'node:fs';
import { parse } from 'acorn';
import os from 'node:os';
import path from 'node:path';

const wait = ms => new Promise(r => setTimeout(r, ms));

export default async function run() {
  const t = suite('published copy');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'coreforge-dist-'));
  /* A build that refuses is a pass for the proof and a failure for the
     release — reported by name rather than as a thrown suite. */
  let r = null;
  try { r = await build(out); } catch (e) { t.ok('the build succeeds', false, String(e && e.message)); }
  if (!r) { fs.rmSync(out, { recursive: true, force: true }); return t.finish(); }

  /* ---- the proof the build runs on itself can fail -------------------------
     sameProgram() is the only thing between a terser upgrade that rewrites an
     expression and a phone running it. Pinned against a real change in both
     directions, and against the two re-prints it must allow. */
  {
    t.ok('guard: the same program reads as the same', sameProgram('var a = 25000; f({tab: tab});', 'var a=25e3;f({tab})'));
    t.ok('guard: a changed number is caught', !sameProgram('var a = 25000;', 'var a=2500;'));
    t.ok('guard: a changed operator is caught', !sameProgram('x = a + b * c;', 'x=(a+b)*c;'));
    t.ok('guard: a renamed function is caught', !sameProgram('function openSettings(){}', 'function a(){}'));
    t.ok('guard: a dropped statement is caught', !sameProgram('a(); b();', 'a();'));
    let threw = false;
    try { await buildIndex('<p>no script here</p>'); } catch (e) { threw = true; }
    t.ok('guard: a page with no app script is refused, not published empty', threw);

    /* The final-page proof, exercised directly: each way a published page
       could differ from its source must be refused, and the honest build must
       pass. Without the cases that throw, "the build passed its proof" is a
       statement about a proof that cannot fail. */
    const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const pub = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const refuses = h => { try { verifyBuilt(src, h); return false; } catch (e) { return true; } };
    t.ok('the honest build passes the final-page proof', !refuses(pub));
    t.ok('a changed line of markup is refused', refuses(pub.replace('<title>', '<title>x')));
    t.ok('a statement slipped into the script is refused', refuses(pub.replace('<script>', '<script>;')));
    t.ok('a changed data block is refused', refuses(pub.replace('type="application/json">{}', 'type="application/json">{"x":1}')));
    /* Removing the CALL to the proof changes nothing on an honest build, so
       no output can show it — only the build script's own text can. */
    const bsrc = fs.readFileSync(path.join(ROOT, 'tools', 'build.mjs'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const bodyOf = (code, name) => { const i = code.indexOf('async function ' + name + '(');
      return i < 0 ? '' : code.slice(i, code.indexOf('\nexport', i + 1)); };
    const bi = bodyOf(bsrc, 'buildIndex');
    t.ok('guard: buildIndex was found in the build script', bi.length > 200, { len: bi.length });
    t.ok('and it runs the final-page proof before it hands the page back',
      /verifyBuilt\(html,\s*built\);\s*return built;/.test(bi));
    t.ok('a dropped script is refused', refuses(pub.replace(/<script id="state-data"[^>]*>[\s\S]*?<\/script>/, '')));
  }

  /* ---- what the build produced ------------------------------------------- */
  {
    const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const pub = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    t.ok('the published index.html is at least a third smaller than the source',
      r.builtBytes < r.srcBytes * 0.67, { srcKB: Math.round(r.srcBytes / 1024), builtKB: Math.round(r.builtBytes / 1024) });
    /* Counted by the parser, not by a regex: the app's own strings carry
       `image/*`, which a pattern reads as a comment opening. */
    const comments = code => { let n = 0; parse(code, { ecmaVersion: 'latest', onComment: () => { n++; } }); return n; };
    const appScript = h => [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || '';
    const srcComments = comments(appScript(src)), pubComments = comments(appScript(pub));
    t.ok('guard: the source really carries comments', srcComments > 1000, { srcComments });
    t.eq('and the published script carries none', pubComments, 0);
    t.ok('the data block is left exactly as it was',
      (pub.match(/<script id="state-data"[^>]*>[\s\S]*?<\/script>/) || [''])[0] ===
      (src.match(/<script id="state-data"[^>]*>[\s\S]*?<\/script>/) || ['x'])[0]);

    /* Every other file is published byte-for-byte, and nothing that only
       development needs goes out. */
    for (const f of ['sw.js', 'manifest.webmanifest', 'privacy.html', 'terms.html', 'command/sw.js']) {
      if (!fs.existsSync(path.join(out, f))) { t.ok(`${f} is published unchanged`, false, 'missing'); continue; }
      const a = path.join(ROOT, f), b = path.join(out, f);
      t.ok(`${f} is published unchanged`, fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b)));
    }
    for (const f of ['tests', 'tools', 'node_modules', 'package.json', '.github', '.git'])
      t.ok(`${f} is not published`, !fs.existsSync(path.join(out, f)));

    /* Every asset the service worker precaches exists in the published tree.
       A file the build skipped is a 404 the worker's install dies on. */
    const sw = fs.existsSync(path.join(out, 'sw.js')) ? fs.readFileSync(path.join(out, 'sw.js'), 'utf8') : '';
    const urls = [...sw.matchAll(/'(\.\/[^']+)'/g)].map(m => m[1]).filter(u => u !== './');
    const missing = urls.filter(u => !fs.existsSync(path.join(out, u.slice(2))));
    t.ok('guard: the precache lists were read', urls.length > 200, { urls: urls.length });
    t.eq('every precached asset is in the published tree', missing, []);

    /* The install budget, on the bytes a phone actually downloads. */
    const tier = n => {
      const m = sw.match(new RegExp(n + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
      return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [];
    };
    const kb = list => Math.round(list.filter(u => u !== './')
      .reduce((n, u) => n + (fs.existsSync(path.join(out, u.slice(2))) ? fs.statSync(path.join(out, u.slice(2))).size : 0), 0) / 1024);
    const installKB = kb([...tier('CORE'), ...tier('SHELL_MIN')]);
    t.ok('the published install tier is under 2 MB', installKB > 0 && installKB < 2048, { installKB });
  }

  /* ---- the update check can find the version in what it downloads ---------
     selfUpdate() requests only the first 64 KB of index.html and matches the
     version line in it. The line used to sit ~232 KB in, so on GitHub Pages —
     which honours the Range header — the match never happened and the check
     returned silently for many versions. The harness server ignores Range and
     sends the whole file, which is exactly why no browser check saw it; this
     reads the same 64 KB the phone does.

     Two patterns, because two populations run it: the one in this build, and
     the single-quote-only one every phone ALREADY installed is carrying. The
     second is why the build keeps original quotes — terser's default reprints
     the line with double quotes and every installed phone would miss it. */
  {
    const head = fs.readFileSync(path.join(out, 'index.html')).subarray(0, 65536).toString('latin1');
    const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const ver = (src.match(/const APP_VERSION='(\d+)'/) || [])[1];
    t.ok('guard: the source version was read', /^\d+$/.test(ver || ''), { ver });
    const lit = (src.match(/const m=(\/APP_VERSION=[^\n]*?\/)\.exec\(await r\.text\(\)\)/) || [])[1];
    t.ok('guard: the update check\'s own pattern was found', !!lit, { lit });
    let mine = null; try { mine = (new Function('return ' + lit)()).exec(head); } catch (e) {}
    t.eq('this build\'s update check finds the version in the first 64 KB', mine && mine[1], ver);
    const installed = /APP_VERSION='(\d+)'/.exec(head);
    t.eq('and so does the pattern every installed phone is already running', installed && installed[1], ver);
    const full = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    t.ok('guard: the 64 KB window is a real cut-off for this file', full.length > 65536 * 4, { len: full.length });
  }

  /* ---- drive the published copy ------------------------------------------ */
  const { srv, port } = await serve(out);
  const { browser, page, errors } = await launch(port);
  try {
    const served = await page.evaluate(async () => (await (await fetch('./index.html', { cache: 'no-store' })).text()).length);
    t.eq('the published copy is what the browser was served', served,
      fs.readFileSync(path.join(out, 'index.html'), 'utf8').length);

    /* A fresh install lands on the wizard, not a blank page. */
    t.ok('a fresh install shows the setup wizard',
      await page.evaluate(() => !!document.querySelector('#ob-next')));

    await seedAthlete(page);
    const sweep = await page.evaluate(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms));
      const bad = [], seen = [];
      const look = label => {
        const v = document.querySelector('.view.active');
        const txt = v ? v.textContent : '';
        seen.push(label);
        if (!v || v.innerHTML.length < 300) bad.push(label + ': empty');
        if (/\bNaN\b|\bundefined\b|\[object Object\]|Invalid Date/.test(txt)) bad.push(label + ': ' + (txt.match(/\bNaN\b|\bundefined\b|\[object Object\]|Invalid Date/) || [])[0]);
      };
      for (const tab of ['today', 'program', 'progress', 'fuel', 'ref', 'guide']) { go(tab); await w(60); look(tab); }
      go('today');
      for (const p of ['brief', 'warmup', 'workout', 'cooldown']) { setTodayTab(p); await w(60); look('today:' + p); }
      go('progress');
      for (const [p] of PROGRESS_TABS) { setProgressTab(p); await w(60); look('progress:' + p); }
      go('ref');
      for (const [p] of REF_TABS) { setRefTab(p); await w(60); look('ref:' + p); }

      /* Every handler the rendered markup names must be a function the page
         really has. compress:false and mangle:false mean none can be renamed —
         this is the check that says so on the live page. */
      const names = new Set();
      document.querySelectorAll('.view').forEach(v =>
        v.innerHTML.replace(/on(?:click|change|input)="([A-Za-z_$][\w$]*)\(/g, (_, n) => { names.add(n); return _; }));
      /* Asked the way the markup asks it, so a top-level const arrow ($) counts
         as well as a function declaration; a keyword (if) is not a handler. */
      const dead = [...names].filter(n => {
        if (/^(if|return|this|new|typeof|void)$/.test(n)) return false;
        try { return new Function('return typeof ' + n)() !== 'function'; } catch (e) { return true; }
      });

      const sheets = ['openBuilder', 'openSpecial', 'openHoldTests', 'openMobility', 'openGrocery',
        'openCoachVoices', 'openRestSheet', 'openForcePrep', 'openCombat', 'openEndurance',
        'openSkipping', 'openTDEE', 'openStandards', 'openFoodSearch', 'openQuickAdd'];
      const sheetBad = [];
      for (const s of sheets) {
        try {
          if (typeof window[s] !== 'function') { sheetBad.push(s + ': missing'); continue; }
          window[s]();
          await w(80);
          const el = document.getElementById('sheet');
          const txt = el ? el.textContent : '';
          if (!el || txt.length < 20) sheetBad.push(s + ': empty');
          if (/\bNaN\b|\bundefined\b|\[object Object\]/.test(txt)) sheetBad.push(s + ': bad text');
          closeSheet(); await w(120);
        } catch (e) { sheetBad.push(s + ': ' + e.message); }
      }

      let problems = -1;
      const oe = console.error; console.error = () => {};
      try { problems = validateData().length; } catch (e) { problems = 'threw: ' + e.message; }
      console.error = oe;

      return { bad, seen: seen.length, names: names.size, dead, sheetBad, problems };
    });
    t.ok('guard: the sweep visited every tab and pane', sweep.seen >= 16, sweep);
    t.eq('every tab and pane renders real content', sweep.bad, []);
    t.ok('guard: the rendered markup names real handlers', sweep.names > 40, { names: sweep.names });
    t.eq('every handler the markup calls exists', sweep.dead, []);
    t.eq('every sheet opens with real content', sweep.sheetBad, []);
    t.eq('the validator is clean on the published copy', sweep.problems, 0);

    /* A whole guided session, set by set, to the finish screen. */
    const ses = await page.evaluate(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms));
      openPlayer({ items: [
        { exId: 'pushup', sets: 2, target: 8, unit: 'reps', rest: 30 },
        { exId: 'plank', sets: 2, target: 20, unit: 'time', rest: 30 },
      ], title: 'Published copy', free: true });
      await w(200);
      const phases = [];
      for (let i = 0; i < 40 && PLAYER && PLAYER.phase !== 'done'; i++) {
        phases.push(PLAYER.phase);
        if (PLAYER.phase === 'rest') plRestDone(); else playerSetDone();
        await w(90);
      }
      const done = !!PLAYER && PLAYER.phase === 'done';
      const sets = PLAYER ? PLAYER.setsDone : 0;
      try { playerQuit(); } catch (e) {}
      await w(600);
      return { done, sets, sawRest: phases.includes('rest') };
    });
    t.ok('a guided session runs to its finish screen', ses.done, ses);
    t.eq('and every set was counted', ses.sets, 4, ses);
    t.ok('and it rested between sets', ses.sawRest, ses);

    /* The service worker installs from the published tree. */
    const swState = await page.evaluate(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        for (let i = 0; i < 50 && !(reg && reg.active && reg.active.state === 'activated'); i++)
          await new Promise(r => setTimeout(r, 200));
        return reg && reg.active ? reg.active.state : 'none';
      } catch (e) { return 'threw: ' + e.message; }
    });
    t.eq('the service worker activates from the published copy', swState, 'activated');

    await wait(300);
    t.eq('no page errors on the published copy', errors, []);
  } finally {
    await browser.close();
    srv.close();
    fs.rmSync(out, { recursive: true, force: true });
  }
  return t.finish();
}
