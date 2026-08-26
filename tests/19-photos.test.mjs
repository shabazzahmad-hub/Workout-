/* Progress photos: three views, and comparisons that compare like with like.

   The panel used to hold one rule — earliest photo on the left, latest on the
   right — which is only ever correct when every photo is of the same thing.
   Adding a back view made that assumption visible: a front shot captioned
   "before" beside a back shot captioned "now" is not a comparison, it is two
   unrelated pictures. Every check below is written so that restoring
   `ps[0]` / `ps[ps.length-1]` turns it red.

   The pose repair is asserted on STATE, never through poseOf(). poseOf()
   sanitises its own read, so a check on what it returns passes whether or not
   normalizeState() still repairs the field — the exact trap CLAUDE.md
   describes for parqDone() and cueVolPref(). */
import { serve, launch, suite, waitForBoot, seedAthlete } from './lib/harness.mjs';

// 1×1 PNG. Small enough to be free, real enough for Image + canvas to decode.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

/* Photos straight into STATE. The bytes are irrelevant to every assertion here
   — captions, panel presence and pose selection are all rendered synchronously
   from the metadata, while the images hydrate from IndexedDB afterwards. */
const seedPhotos = list => page => page.evaluate(ps => {
  STATE.photos = ps.map(([date, pose]) => ({ id: date + '-' + pose + '-0', date, pose }));
  save(); go('progress'); setProgressTab('body'); renderProgress();
}, list);

/* The two captions under the Before → Now pair, e.g. "2026-01-01 · front". */
const readPair = page => page.evaluate(() => {
  const v = document.querySelector('#v-progress');
  const lbl = [...v.querySelectorAll('.section-label')]
    .find(e => /Before . Now/.test(e.textContent));
  if (!lbl) return { shown: false, heading: '', caps: [] };
  const grid = lbl.nextElementSibling;
  return { shown: true, heading: lbl.textContent.trim(),
    caps: [...grid.querySelectorAll('.tiny')].map(e => e.textContent.trim()) };
});

export default async function run() {
  const t = suite('progress photos');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await waitForBoot(page);
  await seedAthlete(page);

  /* ---- the back view exists, and it survives the round trip -------------- */
  {
    const r = await page.evaluate(() => {
      go('progress'); setProgressTab('body'); renderProgress();
      const html = document.querySelector('#v-progress').innerHTML;
      return { front: html.includes("capturePhoto('front')"),
        side: html.includes("capturePhoto('side')"),
        back: html.includes("capturePhoto('back')") };
    });
    t.ok('the Progress tab offers a front shot', r.front, r);
    t.ok('and a side shot', r.side, r);
    t.ok('and a back shot — where lat width and flank fat actually show', r.back, r);
  }
  {
    // through the real capture path: the button sets the pose, the input saves it
    await page.evaluate(() => { STATE.photos = []; save(); capturePhoto('back'); });
    await page.setInputFiles('#photoInput', { name: 'b.png', mimeType: 'image/png', buffer: PIXEL });
    await page.waitForFunction(() => (STATE.photos || []).length === 1, null, { timeout: 5000 });
    const r = await page.evaluate(async () => {
      const p = STATE.photos[0];
      return { pose: p.pose, date: p.date, bytes: !!(await idbGet('ph_' + p.id)) };
    });
    t.eq('capturing a back shot stores it as a back shot', r.pose, 'back');
    t.ok('and the bytes land in IndexedDB', r.bytes, r);
    await page.evaluate(async () => {
      for (const p of STATE.photos) await idbDel('ph_' + p.id);
      STATE.photos = []; save();
    });
  }

  /* ---- Before → Now compares one pose against itself --------------------- */
  {
    // earliest photo is a front, latest is a back: the old rule paired them
    await seedPhotos([['2026-01-01', 'front'], ['2026-02-01', 'front'], ['2026-03-01', 'back']])(page);
    const r = await readPair(page);
    t.ok('a mixed library still shows a Before → Now panel', r.shown, r);
    t.ok('both sides are the same pose', /front/.test(r.caps[0] || '') && /front/.test(r.caps[1] || ''), r);
    t.ok('and it spans the two dates of that pose, not the library',
      /2026-01-01/.test(r.caps[0] || '') && /2026-02-01/.test(r.caps[1] || ''), r);
    t.ok('the heading names the pose being compared', /front/i.test(r.heading), r);
  }
  {
    // only the back view has two shots — the panel must follow the data
    await seedPhotos([['2026-01-01', 'front'], ['2026-01-02', 'back'], ['2026-03-01', 'back']])(page);
    const r = await readPair(page);
    t.ok('with only the back view repeated, the back view is compared',
      /back/.test(r.caps[0] || '') && /back/.test(r.caps[1] || ''), r);
    t.ok('across the back shots\' own dates',
      /2026-01-02/.test(r.caps[0] || '') && /2026-03-01/.test(r.caps[1] || ''), r);
  }
  {
    // widest span wins: front spans 2 months, side spans 2 days
    await seedPhotos([['2026-01-01', 'front'], ['2026-01-01', 'side'], ['2026-01-03', 'side'],
      ['2026-03-01', 'front']])(page);
    const r = await readPair(page);
    t.ok('the pose with the longest span is the one shown',
      /front/.test(r.caps[0] || '') && /front/.test(r.caps[1] || ''), r);
  }
  {
    // three photos, three poses, nothing repeated — there is no comparison yet
    await seedPhotos([['2026-01-01', 'front'], ['2026-01-01', 'side'], ['2026-01-01', 'back']])(page);
    const r = await readPair(page);
    t.ok('three different poses produce no Before → Now panel at all', !r.shown, r);
    const hint = await page.evaluate(() =>
      /same/i.test(document.querySelector('#v-progress').innerText));
    t.ok('and the athlete is told a second shot of one pose is what unlocks it', hint, { hint });
  }

  /* ---- the compare sheet opens on the same pair -------------------------- */
  {
    await seedPhotos([['2026-01-01', 'front'], ['2026-02-01', 'front'], ['2026-03-01', 'back']])(page);
    const r = await page.evaluate(() => {
      openCompare();
      const a = document.querySelector('#cmpA'), b = document.querySelector('#cmpB');
      const txt = s => s.options[s.selectedIndex].textContent;
      const out = { a: txt(a), b: txt(b) };
      closeSheet();
      return out;
    });
    t.ok('Compare opens on two shots of one pose', /front/.test(r.a) && /front/.test(r.b), r);
  }

  /* ---- a stale renderCompare() call must not win the race ---------------- */
  {
    // Real sheet, real <option>s — fabricated #cmpA/#cmpB/#cmpImgs elements hit
    // a DUPLICATE id: #cmpImgs already exists inside the (possibly still-mounted,
    // per this app's "views never clear innerHTML" rule) sheet markup from the
    // earlier openCompare() block above, so document.querySelector('#cmpImgs')
    // silently returned that stale node instead of the throwaway one — the
    // first version of this check read back an empty string forever, on both
    // the clean code and a seeded defect alike.
    await seedPhotos([['2026-01-01', 'front'], ['2026-01-02', 'front'],
      ['2026-01-03', 'front'], ['2026-01-04', 'front']])(page);
    const r = await page.evaluate(async () => {
      const ids = STATE.photos.slice().sort((a, b) => a.id < b.id ? -1 : 1).map(p => p.id);
      // four distinct ids, each with distinguishable "bytes" (a plain marker
      // string is enough — renderCompare() just drops it into an <img src>).
      // idbPut() is fire-and-forget, so give the writes a moment to land.
      idbPut('ph_' + ids[0], 'MARK-OLD-A'); idbPut('ph_' + ids[1], 'MARK-OLD-B');
      idbPut('ph_' + ids[2], 'MARK-NEW-A'); idbPut('ph_' + ids[3], 'MARK-NEW-B');
      await new Promise(z => setTimeout(z, 100));

      openCompare();
      const a = document.querySelector('#cmpA'), b = document.querySelector('#cmpB');

      const realIdbGet = idbGet;
      let calls = 0;
      // the FIRST render's lookups are slow; the SECOND (newer selection) resolves first
      idbGet = async k => { calls++; if (calls <= 2) await new Promise(z => setTimeout(z, 150)); return realIdbGet(k); };

      a.value = ids[0]; b.value = ids[1];
      const first = renderCompare();
      a.value = ids[2]; b.value = ids[3];
      const second = renderCompare();
      await Promise.all([first, second]);
      idbGet = realIdbGet;

      const html = document.querySelector('#cmpImgs').innerHTML;
      closeSheet();
      for (const id of ids) idbDel('ph_' + id);
      return { html };
    });
    t.ok('the newer selection is what actually renders', r.html.includes('MARK-NEW-A') && r.html.includes('MARK-NEW-B'), r);
    t.ok('the stale (slower-resolving) selection never overwrites it', !r.html.includes('MARK-OLD-A') && !r.html.includes('MARK-OLD-B'), r);
  }

  /* ---- a photo with no pose is repaired, not dropped and not fatal ------- */
  {
    await page.evaluate(() => {
      const cur = JSON.parse(localStorage.getItem('coreforge.v1') || '{}');
      cur.photos = [{ id: '2026-01-01-x-0', date: '2026-01-01' },          // no pose at all
        { id: '2026-01-02-x-0', date: '2026-01-02', pose: '' },            // empty pose
        { id: '2026-01-03-x-0', date: '2026-01-03', pose: 7 },             // wrong type
        { id: '2026-01-04-x-0', date: '2026-01-04', pose: 'side' }];       // untouched
      localStorage.setItem('coreforge.v1', JSON.stringify(cur));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBoot(page);
    // assert the junk is GONE FROM STATE — not that poseOf() papered over it
    const r = await page.evaluate(() => {
      go('progress'); setProgressTab('body'); renderProgress();
      return { kept: (STATE.photos || []).length,
        poses: (STATE.photos || []).map(p => p.pose),
        types: (STATE.photos || []).map(p => typeof p.pose),
        boundary: /went wrong drawing/i.test(document.body.innerText) };
    });
    t.eq('no photo is discarded for a bad pose — the bytes are irreplaceable', r.kept, 4);
    t.eq('every stored pose is a non-empty string', r.types, ['string', 'string', 'string', 'string']);
    t.eq('the missing ones are repaired to front, the good one left alone',
      r.poses, ['front', 'front', 'front', 'side']);
    t.ok('and Progress renders instead of hitting the error boundary', !r.boundary, r);
  }

  /* ---- photos already on the phone can be added --------------------------
     The only input had capture="environment", which is exactly what makes a
     phone open the camera — and exactly what stops the athlete reaching a
     photo they already took. Someone who shot their three poses with the
     normal camera app had no way to get them in. A second input without
     capture, and with multiple, so a catch-up is one trip to the gallery. */
  {
    const r = await page.evaluate(() => {
      go('progress'); setProgressTab('body'); renderProgress();
      const cam = document.querySelector('#photoInput');
      const pick = document.querySelector('#photoPickInput');
      const html = document.querySelector('#v-progress').innerHTML;
      return {
        camExists: !!cam, camForcesCamera: cam && cam.hasAttribute('capture'),
        pickExists: !!pick,
        pickAvoidsCamera: pick && !pick.hasAttribute('capture'),
        pickMultiple: pick && pick.hasAttribute('multiple'),
        pickAccepts: pick && pick.getAttribute('accept'),
        buttons: POSE_KEYS.every(k => html.includes(`pickPhotos('${k}')`)),
      };
    });
    t.ok('the camera input still forces the camera', r.camForcesCamera, r);
    t.ok('a second input exists for the gallery', r.pickExists, r);
    t.ok('and it does NOT carry capture, so the phone offers the library', r.pickAvoidsCamera, r);
    t.ok('it accepts more than one file at a time', r.pickMultiple, r);
    t.eq('and only images', r.pickAccepts, 'image/*');
    t.ok('every pose has a gallery button, not just front', r.buttons, r);
  }
  {
    // three files in one go, all landing on the chosen pose
    await page.evaluate(async () => {
      for (const p of STATE.photos) await idbDel('ph_' + p.id);
      STATE.photos = []; save(); go('progress'); setProgressTab('body'); renderProgress();
      pickPhotos('back');
    });
    await page.setInputFiles('#photoPickInput', [
      { name: 'a.png', mimeType: 'image/png', buffer: PIXEL },
      { name: 'b.png', mimeType: 'image/png', buffer: PIXEL },
      { name: 'c.png', mimeType: 'image/png', buffer: PIXEL },
    ]);
    await page.waitForFunction(() => (STATE.photos || []).length === 3, null, { timeout: 8000 });
    const r = await page.evaluate(async () => {
      const ps = STATE.photos;
      const bytes = await Promise.all(ps.map(p => idbGet('ph_' + p.id)));
      return { n: ps.length, poses: ps.map(p => p.pose),
        uniqueIds: new Set(ps.map(p => p.id)).size,
        allStored: bytes.every(Boolean) };
    });
    t.eq('all three files are added, not just the first', r.n, 3);
    t.eq('each lands on the pose that was chosen', r.poses, ['back', 'back', 'back']);
    t.eq('and each gets a distinct id', r.uniqueIds, 3);
    t.ok('with bytes stored for every one', r.allStored, r);
    await page.evaluate(async () => {
      for (const p of STATE.photos) await idbDel('ph_' + p.id);
      STATE.photos = []; save();
    });
  }

  /* ---- Progress photos sits right under the goal picker (v248) -------------
     Moved at the athlete's own request: both cards answer the same question —
     what does my body look like, and how is it changing — and there was no
     data reason keeping them apart (the goal card's body-fat estimate reads
     weight/height/age, never the waist chart that used to sit between them).
     Asserted on real DOM order, not proximity in the source string — the two
     can differ if a helper renders more than its own section-label. */
  {
    const order = await page.evaluate(() => {
      go('progress'); setProgressTab('body'); renderProgress();
      const labels = [...document.querySelectorAll('#v-progress .section-label')].map(e => e.textContent.trim());
      const idx = name => labels.findIndex(l => l.includes(name));
      const o = { labels, transformation: idx('Your transformation'), photos: idx('Progress photos'),
        bodyComp: idx('Body composition') };
      /* Strength and Consistency moved to their own panes in v312, so they are
         no longer on this one at all — which is a stronger statement than
         "photos come first", and is asserted as such. */
      setProgressTab('strength');
      o.strengthElsewhere = [...document.querySelectorAll('#v-progress .section-label')]
        .some(e => /Strength test/.test(e.textContent));
      setProgressTab('summary');
      o.consistencyElsewhere = [...document.querySelectorAll('#v-progress .section-label')]
        .some(e => /Consistency/.test(e.textContent));
      setProgressTab('body');
      return o;
    });
    t.ok('both section labels are present', order.transformation >= 0 && order.photos >= 0, order.labels);
    t.eq('Progress photos is the very next section after Your transformation', order.photos, order.transformation + 1, order);
    t.ok('and it comes BEFORE body composition, not five sections after it',
      order.photos < order.bodyComp, order);
    t.ok('the strength test is on its own pane now', order.strengthElsewhere, order);
    t.ok('and consistency on the summary', order.consistencyElsewhere, order);
  }

  /* ---- getting the photos out as real pictures ---------------------------
     exportData() already embeds them, but a backup restores all-or-nothing:
     an athlete keeping the photos while deliberately abandoning the run had
     no way to take one without the other. Photos are the only thing in the
     app that genuinely cannot be re-created later, so the way out is checked
     on what it actually WRITES — the download's filename and its bytes — not
     on the button existing. */
  {
    const r = await page.evaluate(async () => {
      const o = {};
      // three real photos with distinct bytes, plus a row whose blob is GONE —
      // the silent case the gallery renders as a broken tile
      const mk = tint => { const c = document.createElement('canvas'); c.width = c.height = 8;
        const g = c.getContext('2d'); g.fillStyle = tint; g.fillRect(0, 0, 8, 8);
        return c.toDataURL('image/jpeg', 0.8); };
      /* Two DIFFERENT ways a photo goes bad, because they are caught by
         different halves of the guard: a4's blob is absent entirely (deleted,
         or a row that outlived its bytes), while a5's blob is present but is
         not an image — the shape a corrupted or hand-edited import leaves
         behind. Testing only the absent case lets a guard that checks nothing
         but `!data` pass, and that guard would hand the browser a download of
         raw junk named .jpg. */
      STATE.photos = [
        { id: 'a1', date: '2026-06-01', pose: 'front' },
        { id: 'a2', date: '2026-06-01', pose: 'side' },
        { id: 'a3', date: '2026-08-01', pose: 'back' },
        { id: 'a4', date: '2026-08-01', pose: 'front' },   // blob deliberately absent
        { id: 'a5', date: '2026-08-01', pose: 'side' },    // blob present but NOT an image
      ];
      await idbPut('ph_a1', mk('#a33'));
      await idbPut('ph_a2', mk('#3a3'));
      await idbPut('ph_a3', mk('#33a'));
      await idbDel('ph_a4');
      await idbPut('ph_a5', 'not-an-image-at-all');
      save();

      // capture what savePhotoFiles() actually hands the browser
      const grabbed = [];
      const realCreate = document.createElement.bind(document);
      document.createElement = tag => {
        const el = realCreate(tag);
        if (tag === 'a') { const realClick = el.click.bind(el);
          el.click = () => { grabbed.push({ name: el.download, href: el.href }); }; }
        return el;
      };
      await savePhotoFiles();
      document.createElement = realCreate;

      o.names = grabbed.map(g => g.name);
      o.allRealImages = grabbed.every(g => g.href.startsWith('data:image/'));
      o.distinctBytes = new Set(grabbed.map(g => g.href)).size;
      o.toast = (document.querySelector('#toast') || {}).textContent || '';

      // a pose that an import could have corrupted must not reach the filename raw
      o.junkPose = photoFileName({ date: '2026-06-01', pose: '../../etc/passwd' });
      o.junkDate = photoFileName({ date: 'not-a-date', pose: 'side' });

      // and the empty case says so rather than silently doing nothing
      STATE.photos = []; save();
      await savePhotoFiles();
      o.emptyToast = (document.querySelector('#toast') || {}).textContent || '';
      return o;
    });
    t.eq('every readable photo is written out, and the unreadable one is not', r.names.length, 3, r);
    t.eq('named by date and pose, so the files sort and read on their own',
      r.names, ['coreforge-2026-06-01-front.jpg', 'coreforge-2026-06-01-side.jpg', 'coreforge-2026-08-01-back.jpg']);
    t.ok('each download carries real image bytes, not a placeholder', r.allRealImages, r);
    t.eq('and they are three DIFFERENT pictures, not the same one three times', r.distinctBytes, 3, r);
    t.ok('the athlete is told the ones it could not read, rather than them vanishing',
      /3 photos/.test(r.toast) && /2 could not be read/.test(r.toast), r.toast);
    t.ok('and nothing that is not an image is ever handed out as a .jpg',
      !r.names.some(n => /a5|2026-08-01-side/.test(n)), r.names);
    t.eq('a corrupt pose falls back to a known one instead of reaching the filename',
      r.junkPose, 'coreforge-2026-06-01-front.jpg');
    t.eq('a malformed date is labelled undated rather than written raw', r.junkDate, 'coreforge-undated-side.jpg');
    t.ok('with no photos at all it says so instead of appearing to work',
      /No progress photos/.test(r.emptyToast), r.emptyToast);
  }

  /* The button is only worth anything if it is reachable from the screen the
     athlete is on when they are about to wipe the device. */
  {
    const r = await page.evaluate(() => {
      STATE.photos = [{ id: 'b1', date: '2026-06-01', pose: 'front' }]; save();
      go('guide'); render();
      const html = document.querySelector('#v-guide').innerHTML;
      const withPhotos = { offered: html.includes('savePhotoFiles()'),
        nearReset: html.indexOf('savePhotoFiles()') < html.indexOf('hardReset()'),
        counted: /Save my 1 progress photo\b/.test(html) };
      STATE.photos = []; save(); render();
      const without = document.querySelector('#v-guide').innerHTML.includes('savePhotoFiles()');
      return { withPhotos, offeredWithNoPhotos: without };
    });
    t.ok('Settings offers the way out', r.withPhotos.offered, r);
    t.ok('and offers it ABOVE "Reset all data", where it can still be acted on', r.withPhotos.nearReset, r);
    t.ok('the label counts the real photos rather than guessing', r.withPhotos.counted, r);
    t.ok('and it stays hidden when there are none to save', !r.offeredWithNoPhotos, r);
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
