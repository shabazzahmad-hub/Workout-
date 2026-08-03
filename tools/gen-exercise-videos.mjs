/**
 * CoreForge — warm-up / cool-down looping demo video generator (fal.ai · Seedance 2.0 Mini)
 * =========================================================================================
 * Turns each existing warm-up / cool-down PHOTO into a ~5s, 720p looping demo clip using
 * fal.ai's ByteDance Seedance 2.0 Mini (image-to-video). Run it ONCE on your own machine;
 * it writes .mp4 files you hand back to be wired into the app.
 *
 * WHY LOCAL: your fal key carries billing — keep it on your machine, never in the app/repo.
 *
 * ── SETUP ────────────────────────────────────────────────────────────────────────────────
 *   1) Node 18+ (has fetch + Blob built in).
 *   2) In this folder:   npm init -y  &&  npm i @fal-ai/client
 *   3) Get your key:     fal.ai → Dashboard → Keys  (starts with a long token)
 *   4) Run (from the repo root so it can find the wu-*.jpg / cd-*.jpg photos):
 *        FAL_KEY=your_key_here  node tools/gen-exercise-videos.mjs
 *
 *   Options (env vars):
 *      FAL_KEY       (required) your fal.ai API key
 *      FAL_MODEL     override the model id (default below) — VERIFY it on the model page,
 *                    fal.ai/models/bytedance/seedance-2.0  → pick the Mini image-to-video
 *                    route and copy the exact id shown in its API/"View code" tab.
 *      IMG_DIR       where the source photos live (default: repo root ".")
 *      OUT_DIR       where clips are written (default: "./exercise-videos")
 *      ONLY          comma list to limit, e.g. ONLY=wu-march,cd-cobra
 *
 * Re-running skips clips already in OUT_DIR, so you can stop/resume safely.
 * When done, put the whole OUT_DIR into a Drive folder (e.g. "exercise videos") and say so —
 * the clips get integrated exactly like the photos were.
 * ──────────────────────────────────────────────────────────────────────────────────────────
 */
import { fal } from "@fal-ai/client";
import fs from "node:fs";
import path from "node:path";

const KEY = process.env.FAL_KEY;
if (!KEY) { console.error("✗ Set FAL_KEY (fal.ai → Dashboard → Keys). Aborting."); process.exit(1); }
fal.config({ credentials: KEY });

// Seedance 2.0 Mini, image-to-video. If fal returns "model not found", open the model page,
// switch to the Mini image-to-video route, and paste its exact id into FAL_MODEL.
const MODEL = process.env.FAL_MODEL || "fal-ai/bytedance/seedance/v2/mini/image-to-video";
const IMG_DIR = process.env.IMG_DIR || ".";
const OUT_DIR = process.env.OUT_DIR || "./exercise-videos";
const ONLY = (process.env.ONLY || "").split(",").map(s => s.trim()).filter(Boolean);

const LOOP = "Same person, outfit and plain studio background as the image. Smooth, realistic, " +
  "controlled motion at a steady pace. The movement returns to the exact starting position by the " +
  "end so the clip loops seamlessly. Fixed camera, no zoom, no text or captions.";

// name = output basename (matches the app's wu-*/cd-* keys) · img = source photo · prompt = motion
const MOVES = [
  { name: "wu-march",      img: "wu-march.jpg",      prompt: "Marches in place, driving alternating knees up to hip height, arms swinging naturally in rhythm." },
  { name: "wu-armcircles", img: "wu-armcircles.jpg", prompt: "Makes large slow circles with both arms extended straight out to the sides." },
  { name: "wu-torsotwist", img: "wu-torsotwist.jpg", prompt: "Rotates the torso gently side to side with feet planted, arms relaxed and swinging across the body." },
  { name: "wu-hipcircles", img: "wu-hipcircles.jpg", prompt: "Hands on the hips, circles the hips smoothly in one direction." },
  { name: "wu-glutebridge",img: "wu-glutebridge.jpg",prompt: "Lying on the back with knees bent, lifts the hips into a glute bridge and lowers, one smooth rep." },
  { name: "wu-birddog",    img: "wu-birddog.jpg",    prompt: "On hands and knees, extends the opposite arm and leg to level, holds briefly, then returns." },
  { name: "wu-catcow",     img: "wu-catcow.jpg",     prompt: "On hands and knees, slowly arches then rounds the spine through one cat-cow cycle." },
  { name: "wu-kneehug",    img: "wu-kneehug.jpg",    prompt: "Standing tall, pulls one knee up and hugs it to the chest, then releases, balancing." },
  { name: "cd-childs",     img: "cd-childs.jpg",     prompt: "Rests in child's pose, breathing gently — subtle rise and fall of the back, mostly still." },
  { name: "cd-cobra",      img: "cd-cobra.jpg",      prompt: "Lying face down, presses the chest up into a gentle cobra stretch and lowers slightly." },
  { name: "cd-twistleft",  img: "cd-twistleft.jpg",  prompt: "Lying on the back with both knees dropped to the left, arms out wide, breathing gently in the supine twist." },
  { name: "cd-twistright", img: "cd-twistright.jpg", prompt: "Lying on the back with both knees dropped to the right, arms out wide, breathing gently in the supine twist." },
  { name: "cd-catcow",     img: "cd-catcow.jpg",     prompt: "On hands and knees, gentle slow cat-cow — belly drops then the spine rounds." },
  { name: "cd-knees",      img: "cd-knees.jpg",      prompt: "Lying on the back, hugs both knees into the chest and gently rocks." },
  { name: "cd-breathing",  img: "cd-breathing.jpg",  prompt: "Lying on the back fully relaxed, slow deep breathing — the chest and belly rise and fall." },
];

// EXERCISE-LIBRARY MODE: set GEN_EXERCISES=1 to also turn every ex-*.jpg photo in
// IMG_DIR into a looping ex-*.mp4 demo. Uses a generic "smooth controlled reps,
// return to start so it loops" motion prompt — no per-exercise prompt needed.
function exerciseMoves() {
  let files = [];
  try { files = fs.readdirSync(IMG_DIR).filter(f => /^ex-.+\.jpg$/i.test(f)); } catch (e) {}
  return files.map(f => ({
    name: f.replace(/\.jpg$/i, ""),
    img: f,
    prompt: "Performs this exercise with smooth, controlled, realistic reps at a steady pace.",
  }));
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = (process.env.GEN_EXERCISES === "1") ? MOVES.concat(exerciseMoves()) : MOVES;
  const list = ONLY.length ? base.filter(m => ONLY.includes(m.name)) : base;
  console.log(`CoreForge video gen · model=${MODEL} · ${list.length} clips → ${OUT_DIR}\n`);
  let ok = 0, skip = 0, fail = 0;
  for (const m of list) {
    const outPath = path.join(OUT_DIR, m.name + ".mp4");
    if (fs.existsSync(outPath)) { console.log(`• ${m.name}  (already exists, skipping)`); skip++; continue; }
    const imgPath = path.join(IMG_DIR, m.img);
    if (!fs.existsSync(imgPath)) { console.log(`✗ ${m.name}  source photo missing: ${imgPath}`); fail++; continue; }
    try {
      process.stdout.write(`• ${m.name}  uploading…`);
      const buf = fs.readFileSync(imgPath);
      const imageUrl = await fal.storage.upload(new Blob([buf], { type: "image/jpeg" }));
      process.stdout.write(" generating…");
      const res = await fal.subscribe(MODEL, {
        input: {
          image_url: imageUrl,
          prompt: `${m.prompt} ${LOOP}`,
          resolution: "720p",   // Mini 720p
          duration: "5",         // ~5 seconds
        },
        logs: false,
      });
      const data = res && (res.data || res);
      const vurl = data && (data.video?.url || (Array.isArray(data.videos) && data.videos[0]?.url));
      if (!vurl) throw new Error("no video url in response: " + JSON.stringify(data).slice(0, 200));
      const vid = await fetch(vurl);
      if (!vid.ok) throw new Error("download failed: HTTP " + vid.status);
      fs.writeFileSync(outPath, Buffer.from(await vid.arrayBuffer()));
      console.log(` ✓ saved ${outPath}`);
      ok++;
    } catch (e) {
      console.log(`\n✗ ${m.name}  ${e.message || e}`);
      fail++;
    }
  }
  console.log(`\nDone. ${ok} generated · ${skip} skipped · ${fail} failed.`);
  if (ok) console.log(`Next: upload the .mp4 files in ${OUT_DIR} to a Drive folder and let me know — I'll wire them in.`);
}
run().catch(e => { console.error(e); process.exit(1); });
