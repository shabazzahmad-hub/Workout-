/* Suite 16 — you have to be able to SEE the exercise while you do it.

   The guided player showed a 120px thumbnail above a 232px timer, and the HIIT
   player showed no photograph at all — only a background image at .16 opacity,
   which on a phone is nothing. The report was blunt: "it's like there is no
   view of that exercise."

   The artwork now fills the countdown ring, so these checks are about the thing
   on the glass: is it there, is it big, is it the RIGHT movement, and can the
   timer still be read on top of it. */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

const PHONE = { width: 412, height: 690 };   // S-class with browser chrome showing

export default async function run() {
  const t = suite('exercise media');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await page.setViewportSize(PHONE);
  await seedAthlete(page);

  /* Drive the player to the work phase on a named exercise. plEnterWork() only
     rewrites text — plBodyWork() is what builds the ring — so the body has to
     be rebuilt or the media never changes and every exercise looks identical. */
  const workOn = key => page.evaluate(async k => {
    if (!window.PLAYER) { openPlayer(); await new Promise(z => setTimeout(z, 400)); }
    if (k) PLAYER.items[PLAYER.i].exId = k;
    plEnterReady(false);
    await new Promise(z => setTimeout(z, 200));
    plClear(); plEnterWork();
    await new Promise(z => setTimeout(z, 600));
  }, key || null);

  const readRing = () => page.evaluate(() => {
    const box = document.querySelector('.pl-ringmedia');
    const el = box && box.querySelector('img,video');
    const rb = box && box.getBoundingClientRect();
    const ring = document.querySelector('.pl-ring').getBoundingClientRect();
    const num = document.querySelector('.pl-num').getBoundingClientRect();
    const body = document.querySelector('#plBody') || document.querySelector('#ivBody');
    return {
      has: !!el, tag: el ? el.tagName : null, src: el ? el.getAttribute('src') : null,
      painted: el ? (el.tagName === 'VIDEO' ? true : el.naturalWidth > 0) : false,
      media: rb ? { w: Math.round(rb.width), h: Math.round(rb.height), cx: rb.x + rb.width / 2, cy: rb.y + rb.height / 2 } : null,
      ring: { w: Math.round(ring.width), h: Math.round(ring.height) },
      num: { cx: num.x + num.width / 2, cy: num.y + num.height / 2 },
      overflow: body.scrollHeight - body.clientHeight,
      exName: EX[plCur().exId].name, exImg: EX[plCur().exId].img,
    };
  });

  /* ---- the movement is on screen, and it is the one being performed ----- */
  {
    await workOn('plank');
    const r = await readRing();
    t.ok('the exercise artwork is in the player', r.has, r);
    t.eq('and it is the exercise being performed', r.src, r.exImg);
    t.ok('and it actually decoded, not a broken image', r.painted, r);
    /* The old thumbnail was 120px. Anything in that range is the defect this
       suite exists for, so the floor is set well above it. */
    t.ok('it is big enough to read form from (>=190px)', r.media && r.media.w >= 190,
      { got: r.media && r.media.w, wasBefore: 120 });
    t.ok('the media is round, filling the ring', r.media && Math.abs(r.media.w - r.media.h) <= 2, r.media);
  }

  /* ---- the ring can no longer be squashed by the column it sits in ------ */
  {
    /* `.pl-ring` was a fixed 232x232 box in a flex column: on a 690px-tall
       phone flex shrank its HEIGHT to 153px while the SVG kept drawing a full
       circle, so the ring spilled over "SET 1 OF 3" and the coach cue. */
    const r = await readRing();
    t.ok('the ring is a circle, not an ellipse', Math.abs(r.ring.w - r.ring.h) <= 1, r.ring);
    t.ok('and the work screen fits the phone without scrolling', r.overflow <= 0,
      { overflowPx: r.overflow });
  }

  /* ---- the timer sits on the artwork, not next to it -------------------- */
  {
    const r = await readRing();
    const inside = r.media && Math.hypot(r.num.cx - r.media.cx, r.num.cy - r.media.cy) < r.media.w / 2;
    t.ok('the countdown is centred on the exercise', !!inside, { num: r.num, media: r.media });
  }

  /* ---- rest previews what is coming, not what just finished ------------- */
  {
    const r = await page.evaluate(async () => {
      const cur = plCur().exId;
      const nextId = PLAYER.items[PLAYER.i + 1] && PLAYER.items[PLAYER.i + 1].exId;
      plClear(); plEnterRest(45, 'ex');
      await new Promise(z => setTimeout(z, 400));
      const el = document.querySelector('.pl-ringmedia img,.pl-ringmedia video');
      const body = document.querySelector('#plBody');
      const m = document.querySelector('.pl-ringmedia').getBoundingClientRect();
      return { shown: el && el.getAttribute('src'), curImg: EX[cur].img, nextImg: nextId && EX[nextId].img,
        overflow: body.scrollHeight - body.clientHeight,
        media: Math.round(m.width), pct: Math.round(m.height / body.clientHeight * 100),
        name: document.querySelector('.pl-name').textContent.trim(),
        nextName: nextId && EX[nextId].name };
    });
    t.eq('an exercise rest previews the NEXT movement', r.shown, r.nextImg);
    t.ok('which is not the one just finished', r.shown !== r.curImg, r);
    t.ok('and the rest screen fits too', r.overflow <= 0, { overflowPx: r.overflow });
    /* Rest gets the same treatment as an effort, not a shrunken preview: the
       movement is named up top and shown at full size, rather than "Recover"
       over a chip below the fold. */
    t.eq('the next movement is named, not "Recover"', r.name, r.nextName);
    t.ok('and shown at effort size (>=290px)', r.media >= 290, r);
    t.ok('taking half the screen like an effort does', r.pct >= 45, r);
  }
  {
    const r = await page.evaluate(async () => {
      plClear(); plEnterRest(30, 'set');
      await new Promise(z => setTimeout(z, 400));
      const el = document.querySelector('.pl-ringmedia img,.pl-ringmedia video');
      return { shown: el && el.getAttribute('src'), curImg: EX[plCur().exId].img,
        name: document.querySelector('.pl-name').textContent.trim(), curName: EX[plCur().exId].name };
    });
    t.eq('a rest between sets keeps showing the movement you are on', r.shown, r.curImg);
    t.eq('and names it', r.name, r.curName);
  }

  /* ---- HIIT had no photograph of the movement whatsoever ---------------- */
  {
    const r = await page.evaluate(async () => {
      playerQuit();
      await new Promise(z => setTimeout(z, 250));
      startHiit(Object.keys(HIIT_FORMATS)[0]);
      await new Promise(z => setTimeout(z, 700));
      const step = INTV.seq[INTV.i];
      const el = document.querySelector('.pl-ringmedia img,.pl-ringmedia video');
      const body = document.querySelector('#ivBody');
      const ring = document.querySelector('.pl-ring').getBoundingClientRect();
      return { shown: el && el.getAttribute('src'), want: (EX[step.exId] || {}).img,
        overflow: body.scrollHeight - body.clientHeight,
        square: Math.abs(ring.width - ring.height) <= 1, w: Math.round(ring.width) };
    });
    t.ok('the HIIT player shows a movement at all', !!r.shown, r);
    t.eq('and it is the movement in this interval', r.shown, r.want);
    t.ok('its ring is a circle as well', r.square, r);
    t.ok('and it fits the phone', r.overflow <= 0, { overflowPx: r.overflow });
  }

  /* ---- degrade quietly when the art is missing -------------------------- */
  {
    const r = await page.evaluate(async () => {
      hiitQuit();
      await new Promise(z => setTimeout(z, 250));
      openPlayer();
      await new Promise(z => setTimeout(z, 400));
      const out = {};
      const was = EX.plank.img;
      // file declared but not on disk: no broken-image icon, the disc stays
      EX.plank.img = 'ex-nope-not-here.jpg';
      PLAYER.items[PLAYER.i].exId = 'plank';
      plEnterReady(false); await new Promise(z => setTimeout(z, 200));
      plClear(); plEnterWork(); await new Promise(z => setTimeout(z, 700));
      out.brokenLeavesDisc = !!document.querySelector('.pl-ringmedia');
      out.brokenHasNoImg = !document.querySelector('.pl-ringmedia img');
      out.brokenStillTimes = !!document.querySelector('.pl-num');
      // no artwork declared at all
      delete EX.plank.img;
      plEnterReady(false); await new Promise(z => setTimeout(z, 200));
      plClear(); plEnterWork(); await new Promise(z => setTimeout(z, 400));
      out.noneMeansNoBox = !document.querySelector('.pl-ringmedia');
      out.noneStillTimes = !!document.querySelector('.pl-num');
      EX.plank.img = was;
      return out;
    });
    t.ok('a missing file leaves the plain disc, not a broken icon',
      r.brokenLeavesDisc && r.brokenHasNoImg, r);
    t.ok('and the timer still works', r.brokenStillTimes, r);
    t.ok('an exercise with no artwork renders no empty frame', r.noneMeansNoBox, r);
    t.ok('and still times', r.noneStillTimes, r);
  }

  /* ---- a clip is preferred where one exists, with a still behind it ------ */
  {
    /* Asserted on the markup, not the live element: headless Chromium ships
       without the H.264 decoder, so every .mp4 fails to load here and the
       onerror fallback swaps in the photo — which is correct behaviour, and
       would hide whether the video path is wired up at all. */
    const r = await page.evaluate(() => {
      const k = Object.keys(EX).find(x => EX[x].vid);
      const html = plRingMediaHTML(EX[k]);
      return { k, vid: EX[k].vid, img: EX[k].img, html,
        isVideo: /<video[\s>]/.test(html), hasClip: html.includes(EX[k].vid),
        fallsBack: html.includes(EX[k].img), loops: /\bloop\b/.test(html) };
    });
    t.ok('a movement with a clip renders a video', r.isVideo, r);
    t.ok('pointing at the clip', r.hasClip, r);
    t.ok('and it loops', r.loops, r);
    t.ok('with the still photo as the fallback', r.fallsBack, r);
  }

  /* ---- the photograph is unobstructed, the clock gives way -------------- */
  {
    /* The brief, verbatim: "the image of the exercise should be 100% clear to
       see and up front, the timer should sit at the back and translucent".
       That inverts the usual priority, so it needs a check that a scrim cannot
       creep back into. Rendered pixels are compared against the source file:
       anything laid over the photo shows up as a luminance shift. */
    await workOn('plank');
    const geom = await page.evaluate(() => {
      const box = document.querySelector('.pl-ringmedia').getBoundingClientRect();
      // a square well inside the circular mask, so the crop cannot skew it
      const side = Math.round(box.width * 0.42);
      return { x: Math.round(box.x + (box.width - side) / 2), y: Math.round(box.y + (box.height - side) / 2),
        side, w: Math.round(box.width), src: document.querySelector('.pl-ringmedia img').getAttribute('src') };
    });
    await page.evaluate(() => { document.querySelector('.pl-center').style.visibility = 'hidden'; });
    const shot = await page.screenshot({ clip: { x: geom.x, y: geom.y, width: geom.side, height: geom.side } });
    await page.evaluate(() => { document.querySelector('.pl-center').style.visibility = ''; });
    const delta = await page.evaluate(async ([b64, g]) => {
      const mean = async src => {
        const im = new Image(); im.src = src; await im.decode();
        const c = document.createElement('canvas'); c.width = c.height = 32;
        const ctx = c.getContext('2d');
        return { im, ctx, c };
      };
      // what the page actually painted
      const a = await mean('data:image/png;base64,' + b64);
      a.ctx.drawImage(a.im, 0, 0, 32, 32);
      const A = a.ctx.getImageData(0, 0, 32, 32).data;
      // the same patch of the source file, at the same scale
      const b = await mean(g.src);
      const s = b.im.naturalWidth, side = s * 0.42, off = (s - side) / 2;
      b.ctx.drawImage(b.im, off, off, side, side, 0, 0, 32, 32);
      const B = b.ctx.getImageData(0, 0, 32, 32).data;
      const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      let la = 0, lb = 0;
      for (let i = 0; i < A.length; i += 4) { la += lum(A, i); lb += lum(B, i); }
      const n = A.length / 4;
      return { painted: la / n, source: lb / n, drop: (lb - la) / n };
    }, [shot.toString('base64'), geom]);
    /* A veil at the old .57 pulled ~90 points of luminance out of the middle of
       the frame. Nothing should now pull more than a rounding error. */
    t.ok('nothing is laid over the photograph', Math.abs(delta.drop) < 10,
      { paintedLuma: Math.round(delta.painted), sourceLuma: Math.round(delta.source), drop: Math.round(delta.drop) });
  }

  /* ---- the rest clock is the one that still has to be readable ---------- */
  {
    /* With the veil gone, solid white digits over the brightest artwork
       measured 1.00:1 in light theme — the rest clock was invisible. A halo
       fixes it without touching the frame, but that only shows up if the
       digits are actually PAINTED in the sample: measuring the photo behind
       them with `.pl-center` hidden cannot see a text-shadow at all, and read
       exactly the same with the halo and without it.

       So this compares the darkest and lightest bands of the painted box: one
       of them is the glyph, the other is the halo or the photo. Removing the
       halo takes it from 12.3:1 to 2.1:1. */
    const extremes = await page.evaluate(async () => {
      const keys = Object.keys(EX).filter(k => EX[k].img); const out = [];
      for (const k of keys) {
        const im = new Image(); im.src = EX[k].img;
        try { await im.decode(); } catch (e) { continue; }
        const c = document.createElement('canvas'); c.width = c.height = 48;
        const g = c.getContext('2d'); g.drawImage(im, 0, 0, 48, 48);
        const d = g.getImageData(14, 14, 20, 20).data; let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        out.push([k, s / (d.length / 4)]);
      }
      out.sort((a, b) => a[1] - b[1]);
      return { darkest: out[0][0], brightest: out[out.length - 1][0] };
    });
    const nextWas = await page.evaluate(() => PLAYER.items[PLAYER.i + 1].exId);
    const rel = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = ([r, g, b]) => 0.2126 * rel(r) + 0.7152 * rel(g) + 0.0722 * rel(b);
    let worst = 99, at = null;
    for (const theme of ['dark', 'light']) {
      await page.evaluate(th => document.documentElement.setAttribute('data-theme', th), theme);
      for (const key of [extremes.darkest, extremes.brightest]) {
        const box = await page.evaluate(async k => {
          PLAYER.items[PLAYER.i + 1].exId = k;
          plClear(); plEnterRest(45, 'ex');
          await new Promise(z => setTimeout(z, 550));
          const r = document.querySelector('.pl-num').getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        }, key);
        const shot = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
        const px = await page.evaluate(async b64 => {
          const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
          const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
          c.getContext('2d').drawImage(im, 0, 0);
          return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
        }, shot.toString('base64'));
        const lums = [];
        for (let i = 0; i < px.length; i += 4) lums.push(L([px[i], px[i + 1], px[i + 2]]));
        lums.sort((a, b) => a - b);
        const q = Math.max(1, Math.floor(lums.length * 0.15));
        const lo = lums.slice(0, q).reduce((a, v) => a + v, 0) / q;
        const hi = lums.slice(-q).reduce((a, v) => a + v, 0) / q;
        const c = (hi + 0.05) / (lo + 0.05);
        if (c < worst) { worst = c; at = `${theme}/${key}`; }
      }
    }
    await page.evaluate(([k]) => {
      document.documentElement.setAttribute('data-theme', 'dark');
      PLAYER.items[PLAYER.i + 1].exId = k;      // put the preview back
    }, [nextWas]);
    t.ok('the rest clock stays legible over any artwork, in either theme',
      worst >= 7, { worst: Number(worst.toFixed(2)), at });
  }

  /* ---- the clock is a watermark during an effort, solid during rest ------ */
  {
    const r = await page.evaluate(async () => {
      const read = () => {
        const c = document.querySelector('.pl-center');
        const body = document.querySelector('#plBody');
        const m = document.querySelector('.pl-ringmedia').getBoundingClientRect();
        const num = document.querySelector('.pl-num').getBoundingClientRect();
        return { op: Number(getComputedStyle(c).opacity), media: Math.round(m.width),
          pct: Math.round(m.height / body.clientHeight * 100),
          numW: Math.round(num.width), numH: Math.round(num.height) };
      };
      /* plEnterWork() only rewrites text. Without rebuilding the body first
         this read whatever the previous block left on screen — it was passing
         on the back of block ordering, not on the work screen. */
      plEnterReady(false); await new Promise(z => setTimeout(z, 200));
      plClear(); plEnterWork(); await new Promise(z => setTimeout(z, 450));
      const work = read();
      plClear(); plEnterRest(45, 'ex'); await new Promise(z => setTimeout(z, 400));
      const rest = read();
      return { work, rest };
    });
    t.ok('the effort clock is translucent, around 40%',
      r.work.op >= 0.3 && r.work.op <= 0.5, r.work);
    /* Rest deliberately has no ten-second cue — only a 3-2-1 — so it is the one
       timer with nothing behind it and it stays solid. */
    t.eq('the rest clock stays solid', r.rest.op, 1);
    t.ok('the movement dominates the screen (>=50% of the player body)', r.work.pct >= 50, r.work);
    t.ok('and is at least 300px across', r.work.media >= 300, r.work);
    t.ok('the picture is far bigger than the clock printed on it',
      (r.work.media * r.work.media) > 6 * (r.work.numW * r.work.numH),
      { media: r.work.media, num: [r.work.numW, r.work.numH] });
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
