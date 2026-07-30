# Military Calisthenics Command — 1-Year Campaign Edition

A personalized 1-year military calisthenics campaign: reference-photo technique
library, dynamic scheduling, recovery diagnostics, durable saved progress, and
built-in spoken military coaching. Installs to your phone and runs fully offline.

## Where it lives

This app is a self-contained static PWA that lives in the **`command/`** subfolder
of this repository. It is deployed automatically by GitHub Actions on every push to
`main` (see `.github/workflows/deploy-pages.yml`), alongside — but completely
separate from — the CoreForge app at the repository root.

Once deployed, it is live at:

```
https://shabazzahmad-hub.github.io/workout-/command/
```

The CoreForge app stays at the root (`.../workout-/`); this app has its own URL,
its own service-worker scope (`/command/`), and its own installed-app identity, so
the two never collide.

## Install it to your home screen

1. Open the address above in **Chrome** (or Samsung Internet) on your phone.
2. Complete the quick personalization interview.
3. Chrome menu (⋮) → **Add to Home screen** → **Install**.
4. Open it from the icon like any other app. It works fully offline.

## The file package

Everything for this app is in the `command/` folder and must stay together:

- `index.html` — the entire app
- `sw.js` — offline engine (service worker)
- `manifest.webmanifest` — makes it installable as an app
- `icon-192.png`, `icon-512.png` — home-screen icons
- `ex-*.jpg`, `img-*.jpg` — the exercise reference-photo library

## Why your progress is solid (4 layers)

1. **Installed app storage** — an installed PWA on a real https address gets far
   more durable browser storage than a loose HTML file, and the app automatically
   requests "persistent storage" protection from Android.
2. **Mirror backup** — every save is also copied into a second database (IndexedDB).
   If the main storage is ever cleared, the app detects it on next launch and
   restores your progress automatically.
3. **In-app backups** — the Progress tab has JSON export / Portable HTML backup.
   Do one after each PT test (the app reminds you).
4. **Offline cache** — the service worker keeps the whole app cached, so it opens
   with no signal.

## Updating the app later

Edit the files under `command/` and push to `main`. GitHub Actions redeploys
automatically. Your progress is NOT in the files — it's stored on the phone — so
updates never erase it.

## Note

The repository is public, so don't add personal files to it. The app file itself
contains only the workout program (your name appears as the default in the setup
screen — you can blank it there if you prefer). Your training data, weights, photos
and measurements never leave your phone.
