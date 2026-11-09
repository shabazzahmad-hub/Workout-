/**
 * CoreForge — exercise demo clips from the existing photos, with Google Veo (Gemini API)
 * ======================================================================================
 * Sibling of gen-exercise-videos.mjs (fal.ai). Same job, different engine: turns each
 * ex-*.jpg / wu-*.jpg / cd-*.jpg that has no .mp4 yet into a 640x640, 24fps, silent,
 * ~5 s looping clip, the house format of the clips already in the repo.
 *
 * STATUS: written without being able to call Veo (no key in the build sandbox), so the
 * model id and the request shape below are UNVERIFIED. Run ONLY=ex-pushup first and read
 * the failure message if there is one. Every id is an env var for that reason.
 *
 *   FAL-free, dependency-free: Node 18+ and ffmpeg on PATH.
 *
 *   GEMINI_API_KEY=your_key node tools/gen-exercise-videos-veo.mjs
 *
 * Env:  GEMINI_API_KEY (required) · VEO_MODEL (default below; check ai.google.dev/gemini-api/docs/video)
 *       ONLY=ex-pushup,ex-squat   limit to these · LIMIT=3   stop after N clips
 *       DRY_RUN=1                 list what would run, call nothing
 *       OUT_DIR=./exercise-videos IMG_DIR=.  PROMPTS=tools/veo-prompts.json (optional {"ex-key":"motion"})
 *
 * COST: Veo bills per second of video. Do the 3-clip test, look at the invoice line, then
 * multiply before launching the batch. Re-runs skip finished clips, so it is safe to stop.
 *
 * LOOK AT EVERY CLIP. The repo notes (CLAUDE.md, "Three attempts at one video") record that
 * image-to-video models swap in a movement they know for the one described. A clip that shows
 * the wrong exercise is worse than the still. Reject and re-run with a sharper prompt.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const KEY = process.env.GEMINI_API_KEY;
const DRY = process.env.DRY_RUN === "1";
if (!KEY && !DRY) { console.error("Set GEMINI_API_KEY (Google AI Studio). Aborting."); process.exit(1); }
const MODEL = process.env.VEO_MODEL || "veo-3.1-fast-generate-preview"; // UNVERIFIED: confirm in the docs
const API = "https://generativelanguage.googleapis.com/v1beta";
const IMG_DIR = process.env.IMG_DIR || ".";
const OUT_DIR = process.env.OUT_DIR || "./exercise-videos";
const ONLY = (process.env.ONLY || "").split(",").map(s => s.trim()).filter(Boolean);
const LIMIT = Number(process.env.LIMIT || 0);
let OVERRIDES = {};
try { OVERRIDES = JSON.parse(fs.readFileSync(process.env.PROMPTS || "tools/veo-prompts.json", "utf8")); } catch (e) {}

const LOOP =
  "The same man, the same military fatigues and the same plain studio background as the image. " +
  "One person only. Fixed camera, no zoom, no cuts, no text. Smooth, controlled, correct form at a steady " +
  "pace, repeating the movement two or three times, and finishing in exactly the starting position so the " +
  "clip loops. No sound.";

const nice = k => k.replace(/^(ex|wu|cd)-/, "").replace(/([a-z])(\d)/g, "$1 $2");

function jobs() {
  const files = fs.readdirSync(IMG_DIR).filter(f => /^(ex|wu|cd)-.+\.jpg$/i.test(f));
  return files
    .map(f => f.replace(/\.jpg$/i, ""))
    .filter(n => !fs.existsSync(path.join(IMG_DIR, n + ".mp4")) && !fs.existsSync(path.join(OUT_DIR, n + ".mp4")))
    .filter(n => !ONLY.length || ONLY.includes(n))
    .sort();
}

/* Veo takes 16:9 or 9:16. The stills are square, so extend the plain studio background sideways
   (edge smear), then crop the middle square back out of the result. */
function widen(img, out) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", img, "-vf",
    "scale=720:720,pad=1280:720:280:0,fillborders=left=280:right=280:mode=smear", "-frames:v", "1", out]);
}
function square(inp, out) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", inp, "-an", "-t", "5",
    "-vf", "crop=720:720:280:0,scale=640:640,fps=24", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-profile:v", "baseline", "-movflags", "+faststart", out]);
}

async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { "x-goog-api-key": KEY, "content-type": "application/json", ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 400)}`);
  return r;
}

async function makeClip(name) {
  const tmp = path.join(OUT_DIR, ".tmp");
  fs.mkdirSync(tmp, { recursive: true });
  const wide = path.join(tmp, name + "-wide.png"), raw = path.join(tmp, name + "-raw.mp4");
  widen(path.join(IMG_DIR, name + ".jpg"), wide);
  const motion = OVERRIDES[name] || `Performs the ${nice(name)} exercise.`;
  const start = await (await api(`${API}/models/${MODEL}:predictLongRunning`, {
    method: "POST",
    body: JSON.stringify({
      instances: [{ prompt: `${motion} ${LOOP}`, image: { bytesBase64Encoded: fs.readFileSync(wide).toString("base64"), mimeType: "image/png" } }],
      parameters: { aspectRatio: "16:9", durationSeconds: 6 },   // UNVERIFIED field names/values
    }),
  })).json();
  let op = start;
  for (let i = 0; i < 90 && !op.done; i++) {
    await new Promise(r => setTimeout(r, 10000));
    op = await (await api(`${API}/${start.name}`)).json();
  }
  if (!op.done) throw new Error("timed out waiting for " + start.name);
  if (op.error) throw new Error(JSON.stringify(op.error).slice(0, 300));
  const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) throw new Error("no video uri: " + JSON.stringify(op).slice(0, 300));
  fs.writeFileSync(raw, Buffer.from(await (await api(uri)).arrayBuffer()));
  square(raw, path.join(OUT_DIR, name + ".mp4"));
  fs.rmSync(wide, { force: true }); fs.rmSync(raw, { force: true });
}

const list = jobs().slice(0, LIMIT || undefined);
console.log(`Veo · ${MODEL} · ${list.length} clip(s) to make → ${OUT_DIR}${DRY ? "  (DRY RUN)" : ""}`);
fs.mkdirSync(OUT_DIR, { recursive: true });
let ok = 0, fail = 0;
for (const n of list) {
  if (DRY) { console.log("  would make", n); continue; }
  try { process.stdout.write(`• ${n} …`); await makeClip(n); console.log(" ✓"); ok++; }
  catch (e) { console.log(" ✗ " + (e.message || e)); fail++; }
}
console.log(`Done. ${ok} made, ${fail} failed. Review every clip for the right movement before wiring it in.`);
