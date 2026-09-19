# CoreForge — Full-Body Workout
## Install it as a real app on your phone

CoreForge is a home calisthenics and core program that runs fully offline. Day one
runs a baseline assessment, then every session is built from your own numbers and
saved on the phone as you go.

The app is one folder of static files, all at the root of this repository:

- `index.html` — the entire app
- `sw.js` — the offline engine (a service worker)
- `manifest.webmanifest` — what makes it installable as an app
- `icon-192-v2.png`, `icon-512-v2.png`, `icon-192-maskable.png`, `icon-512-maskable.png`, `icon-180-apple.png` — home-screen icons
- `archivo.woff2` — the app font
- `ex-*.jpg`, `wu-*.jpg`, `cd-*.jpg` and `*.mp4` — exercise reference photos and clips
- `privacy.html`, `terms.html` — the legal pages the setup screen links to

## Where it lives

The app is deployed by GitHub Actions on every push to `main`
(`.github/workflows/deploy-pages.yml`). The deploy runs only after the test suite
passes. In the repository, **Settings → Pages → Source** must be set to
**GitHub Actions**.

Once deployed it is live at:

```
https://shabazzahmad-hub.github.io/Workout-/
```

## Install to your home screen

1. Open that address in Chrome (or Samsung Internet) on your phone.
2. Complete the setup and your day-1 baseline assessment.
3. Chrome menu (⋮) → **Add to Home screen** → **Install**.
4. Open it from the **CoreForge** icon like any other app. It works with no signal.

## Why your progress is solid

1. **Installed app storage** — an installed app on a real https address gets far
   more durable browser storage than a loose HTML file, and the app asks Android
   for "persistent storage" protection on first load.
2. **Mirror backup** — every save is also written to a second store (IndexedDB).
   If the main store is ever cleared, the app finds the mirror on the next launch.
3. **In-app backup** — **Settings → Your data** has export and import. Do one after
   each re-test for extra safety. A backup never contains your API keys.

## Updating the app

Push the whole set of files, not `index.html` on its own. `APP_VERSION` in
`index.html` and `CACHE` in `sw.js` move together on every release, and a phone
only sees a new version when both have changed. Your progress is not in the
files — it is stored on the phone — so an update never erases it.

## Note

The repository is public, so do not add personal files to it. The app files
contain only the program. Your training data, weights and measurements never
leave your phone unless you turn on one of the optional online features, which
`privacy.html` lists.
