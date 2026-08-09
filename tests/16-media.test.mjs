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

/* Straight WCAG. Kept here rather than imported so a change to the app's own
   colour maths cannot quietly redefine what "readable" means. */
const rel = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * rel(r) + 0.7152 * rel(g) + 0.0722 * rel(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

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
      return { shown: el && el.getAttribute('src'), curImg: EX[cur].img, nextImg: nextId && EX[nextId].img,
        overflow: body.scrollHeight - body.clientHeight };
    });
    t.eq('an exercise rest previews the NEXT movement', r.shown, r.nextImg);
    t.ok('which is not the one just finished', r.shown !== r.curImg, r);
    t.ok('and the rest screen fits too', r.overflow <= 0, { overflowPx: r.overflow });
  }
  {
    const r = await page.evaluate(async () => {
      plClear(); plEnterRest(30, 'set');
      await new Promise(z => setTimeout(z, 400));
      const el = document.querySelector('.pl-ringmedia img,.pl-ringmedia video');
      return { shown: el && el.getAttribute('src'), curImg: EX[plCur().exId].img };
    });
    t.eq('a rest between sets keeps showing the movement you are on', r.shown, r.curImg);
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

  /* ---- the timer has to stay readable on top of a photograph ------------ */
  {
    /* The veil is the whole trick, and getting it wrong is silent: too dark
       and the exercise is a smudge, too light and the clock disappears
       against a bright frame. Measured against the brightest and the darkest
       artwork in the library, in both themes — nothing else proves it. */
    const extremes = await page.evaluate(async () => {
      const keys = Object.keys(EX).filter(k => EX[k].img);
      const score = async k => {
        const img = new Image(); img.src = EX[k].img;
        try { await img.decode(); } catch (e) { return null; }
        const c = document.createElement('canvas'); c.width = c.height = 48;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, 48, 48);
        const d = g.getImageData(14, 14, 20, 20).data;   // where the digits land
        let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        return [k, s / (d.length / 4)];
      };
      const out = []; for (const k of keys) { const r = await score(k); if (r) out.push(r); }
      out.sort((a, b) => a[1] - b[1]);
      return { darkest: out[0][0], brightest: out[out.length - 1][0], n: out.length };
    });
    t.ok('there is artwork to measure', extremes.n > 100, extremes);

    let worst = 99, worstAt = null;
    for (const theme of ['dark', 'light']) {
      await page.evaluate(th => document.documentElement.setAttribute('data-theme', th), theme);
      for (const key of [extremes.darkest, extremes.brightest]) {
        await workOn(key);
        for (const sel of ['.pl-num', '.pl-sub']) {
          const m = await page.evaluate(s => {
            const el = document.querySelector(s), r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
              color: getComputedStyle(el).color };
          }, sel);
          await page.evaluate(() => { document.querySelector('.pl-center').style.visibility = 'hidden'; });
          const shot = await page.screenshot({ clip: { x: m.x, y: m.y, width: m.w, height: m.h } });
          await page.evaluate(() => { document.querySelector('.pl-center').style.visibility = ''; });
          const px = await page.evaluate(async b64 => {
            const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
          }, shot.toString('base64'));
          const fg = m.color.match(/\d+/g).slice(0, 3).map(Number);
          for (let i = 0; i < px.length; i += 4) {
            const c = ratio(fg, [px[i], px[i + 1], px[i + 2]]);
            if (c < worst) { worst = c; worstAt = `${theme}/${key}${sel}`; }
          }
        }
      }
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    t.ok('the timer clears 4.5:1 over the hardest artwork in both themes',
      worst >= 4.5, { worst: Number(worst.toFixed(2)), at: worstAt });
  }

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
