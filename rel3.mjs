import { serve, launch, waitForBoot, seedAthlete } from './tests/lib/harness.mjs';
const { srv, port } = await serve();
const { browser, page } = await launch(port);
await waitForBoot(page); await seedAthlete(page);
await page.evaluate(()=>{ if(typeof hideSplash==='function') hideSplash(); });
await page.waitForTimeout(700);
const r = await page.evaluate(() => {
  go('guide');
  const inputs = Array.from(document.querySelectorAll('.view.active input, .view.active select'));
  return inputs.map(i => {
    const lab = i.id ? document.querySelector(`label[for="${i.id}"]`) : null;
    const wrap = i.closest('label');
    const fieldLab = i.closest('.field') ? i.closest('.field').querySelector('label') : null;
    const nearby = i.parentElement ? (i.parentElement.innerText||'').trim().slice(0,40) : '';
    return { tag:i.tagName, type:i.type||'', id:i.id||'(none)',
      aria:i.getAttribute('aria-label')||'', ph:i.getAttribute('placeholder')||'',
      labelFor:!!lab, wrapped:!!wrap, fieldLabel: fieldLab? fieldLab.innerText.trim().slice(0,30):'',
      nearby };
  });
});
const tiny = await page.evaluate(() => {
  go('guide');
  return Array.from(document.querySelectorAll('.view.active button')).map(b=>{
    const x=b.getBoundingClientRect(); return {t:(b.innerText||b.getAttribute('aria-label')||'').trim().slice(0,24), w:Math.round(x.width), h:Math.round(x.height)};
  }).filter(o=>o.w>0&&(o.w<32||o.h<32));
});
console.log(JSON.stringify({inputs:r, tiny}, null, 1));
await browser.close(); srv.close();
