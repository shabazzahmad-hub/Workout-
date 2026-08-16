import { serve, launch, waitForBoot, seedAthlete } from './tests/lib/harness.mjs';
const { srv, port } = await serve();
const { browser, page, errors } = await launch(port);
await waitForBoot(page); await seedAthlete(page);
await page.evaluate(()=>{ if(typeof hideSplash==='function') hideSplash(); });
await page.waitForTimeout(700);
const out = {};

// B. every inline handler resolves to a real function
out.handlers = await page.evaluate(() => {
  const html = document.documentElement.outerHTML;
  const names = new Set();
  for (const m of html.matchAll(/on(?:click|change|input|error|submit)="([a-zA-Z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  const missing = [...names].filter(n => { try { return new Function('return typeof '+n)() !== 'function'; } catch(e){ return true; } });
  return { checked: names.size, missing };
});

// P. render performance on the heaviest tabs
out.perf = await page.evaluate(() => {
  const t = {}; ['today','program','fuel','progress','ref','guide'].forEach(tab => {
    let worst = 0;
    for (let i=0;i<5;i++){ const s=performance.now(); go(tab); worst=Math.max(worst, performance.now()-s); }
    t[tab] = Math.round(worst);
  });
  return t;
});

// Q. accessibility basics on real controls
out.a11y = await page.evaluate(() => {
  go('guide');
  const all = Array.from(document.querySelectorAll('.view.active button, .view.active a[href]'));
  const unnamed = all.filter(b => !(b.innerText||'').trim() && !b.getAttribute('aria-label') && !b.title);
  const inputs = Array.from(document.querySelectorAll('.view.active input, .view.active select'));
  const unlabelled = inputs.filter(i => {
    if (i.getAttribute('aria-label')||i.getAttribute('placeholder')||i.id&&document.querySelector(`label[for="${i.id}"]`)) return false;
    return !i.closest('label') && !(i.closest('.field')||{}).querySelector?.('label');
  });
  return { controls: all.length, unnamed: unnamed.length,
           inputs: inputs.length, unlabelled: unlabelled.length,
           tinyTargets: all.filter(b => { const r=b.getBoundingClientRect();
             return r.width>0 && (r.width<32 || r.height<32); }).length };
});

// R. responsive: no horizontal overflow at three real sizes
out.responsive = {};
for (const [w,h] of [[320,568],[390,844],[768,1024]]) {
  await page.setViewportSize({width:w,height:h});
  out.responsive[`${w}x${h}`] = await page.evaluate(() => {
    const r = {};
    ['today','program','fuel','progress','ref','guide'].forEach(tab => {
      go(tab);
      r[tab] = Math.max(0, Math.round(document.documentElement.scrollWidth - window.innerWidth));
    });
    return r;
  });
}
out.consoleErrors = errors.slice(0,8);
console.log(JSON.stringify(out, null, 1));
await browser.close(); srv.close();
