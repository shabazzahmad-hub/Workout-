# Military Calisthenics Command — V3.4 Shred Edition
## Install it as a real app on your phone (one-time, ~5 minutes)

Your app package has 5 files. All of them must go in the same folder of the repository:

- `index.html` — the entire app
- `sw.js` — offline engine (service worker)
- `manifest.webmanifest` — makes it installable as an app
- `icon-192.png`, `icon-512.png` — home-screen icons

## Step 1 — Put the files on GitHub (from your phone)

1. Open **github.com** in your phone browser and sign in.
2. Tap **+** (top right) → **New repository**.
3. Name it `workout` (or anything). Set it to **Public** (required for free GitHub Pages). Tap **Create repository**.
4. On the new repo page tap **uploading an existing file** (or **Add file → Upload files**).
5. Select all 5 files you downloaded from Claude, then tap **Commit changes**.

## Step 2 — Turn on GitHub Pages

1. In the repo, tap **Settings** (you may need the ⋯ menu) → **Pages**.
2. Under **Branch**, choose `main` and `/ (root)`, then **Save**.
3. Wait 1–2 minutes. Your app is now live at:
   `https://YOUR-USERNAME.github.io/workout/`

## Step 3 — Install to your home screen

1. Open that address in **Chrome** (or Samsung Internet) on your phone.
2. Complete the quick personalization interview.
3. Chrome menu (⋮) → **Add to Home screen** → **Install**.
4. Open it from the icon like any other app. It works fully offline.

## Why your progress is now solid (4 layers)

1. **Installed app storage** — an installed PWA on a real https address gets far more durable browser storage than a loose HTML file, and the app automatically requests "persistent storage" protection from Android.
2. **Mirror backup** — every save is also copied into a second database (IndexedDB). If the main storage is ever cleared, the app detects it on next launch and restores your progress automatically.
3. **In-app backups** — the Progress tab still has JSON export / Portable HTML backup. Do one after each PT test (the app reminds you).
4. **Offline cache** — the service worker keeps the whole app cached, so it opens with no signal.

## Updating the app later

Upload a new `index.html` over the old one in the repo (Add file → Upload files → Commit). Your progress is NOT in the file — it's stored on the phone — so updates never erase it.

## Note

The repository is public, so don't add personal files to it. The app file itself contains only the workout program (your name appears as the default in the setup screen — you can blank it there if you prefer). Your training data, weights, photos and measurements never leave your phone.
