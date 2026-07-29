# CoreForge — 4-Week Abs & Core
## Install it as a real app on your phone (one-time, ~5 minutes)

CoreForge is a home-based abs, core and oblique training program. Day one runs a
baseline assessment, then it auto-builds a 4-week program that gets harder every
week (repeatable to 12 weeks) and saves every rep for you — fully offline.

Your app package has 5 core files plus the exercise photos. All of them must go in
the same folder of the repository:

- `index.html` — the entire app
- `sw.js` — offline engine (service worker)
- `manifest.webmanifest` — makes it installable as an app
- `icon-192.png`, `icon-512.png` — home-screen icons
- `ex-*.jpg` — exercise reference photos

## Step 1 — Put the files on GitHub (from your phone)

1. Open **github.com** in your phone browser and sign in.
2. Tap **+** (top right) → **New repository**.
3. Name it `workout-` (or anything). Set it to **Public** (required for free GitHub Pages). Tap **Create repository**.
4. On the new repo page tap **uploading an existing file** (or **Add file → Upload files**).
5. Select all the files, then tap **Commit changes**.

## Step 2 — Turn on GitHub Pages

1. In the repo, tap **Settings** (you may need the ⋯ menu) → **Pages**.
2. Under **Branch**, choose `main` and `/ (root)`, then **Save**.
3. Wait 1–2 minutes. Your app is now live at:
   `https://YOUR-USERNAME.github.io/workout-/`

## Step 3 — Install to your home screen (Samsung S26)

1. Open that address in **Chrome** (or Samsung Internet) on your phone.
2. Complete the quick setup and your day-1 baseline assessment.
3. Chrome menu (⋮) → **Add to Home screen** → **Install**.
4. Open it from the **CoreForge** icon like any other app. It works fully offline.

## Why your progress is solid (3 layers)

1. **Installed app storage** — an installed PWA on a real https address gets far more durable browser storage than a loose HTML file, and the app automatically requests "persistent storage" protection from Android.
2. **Mirror backup** — every save is also copied into a second database (IndexedDB). If the main storage is ever cleared, the app detects it on next launch and restores your progress automatically.
3. **In-app backup** — the Guide tab has JSON export / import. Do one after each re-test for extra safety.

Offline: the service worker keeps the whole app cached, so it opens with no signal.

## Updating the app later

Upload a new `index.html` over the old one in the repo (Add file → Upload files → Commit). Your progress is NOT in the file — it's stored on the phone — so updates never erase it.

## Note

The repository is public, so don't add personal files to it. The app file itself
contains only the workout program. Your training data, weights and measurements
never leave your phone.
