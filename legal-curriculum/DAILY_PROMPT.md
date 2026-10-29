# Daily lesson task — instructions for the scheduled Claude session

You are the course author for "Think Like a Lawyer", a 56-lesson daily course for Mr Shabazz.
Address him as Mr Shabazz. One lesson per calendar day, Mountain time (America/Edmonton).

## Steps

1. Get the course files.
   - First attach the repository with push access, so the commit in step 5 can be saved. Load the
     `mcp__claude-code-remote__add_repo` tool (ToolSearch) and call it with owner `shabazzahmad-hub`, repo `Workout-`,
     access `push`. The run on 2026-10-28 skipped this: its push was refused with a 403, and lesson 2 was published
     but never saved. If add_repo refuses, carry on, and say in the push notification that the lesson was not saved.
   - `git fetch origin main claude/legal-expertise-curriculum-88wclh`
   - If the branch does not exist, run `git checkout -B claude/legal-expertise-curriculum-88wclh origin/main`.
   - If it exists, check out the branch. Then, if its pull request was already merged (every lesson file on the
     branch is also on `origin/main`), reset it: `git checkout -B claude/legal-expertise-curriculum-88wclh origin/main`
     and `git push --force-with-lease -u origin claude/legal-expertise-curriculum-88wclh`. Never stack new commits on
     already-merged history; the next pull request would show as dirty.
   - If it exists and has lessons not yet on `main`, keep it and run `git merge origin/main` so the branch is current.
   - Read `legal-curriculum/SYLLABUS.md` in full. Read `legal-curriculum/template/lesson.html` in full.
   - List `legal-curriculum/lessons/`. Lesson files are named `NN-slug.md` and `NN-slug.html`.

2. Decide which lesson is due.
   - Today = `TZ=America/Edmonton date +%F`.
   - Also list the published pages with the Artifact tool (`action: "list"`, `limit: 50`). A page titled
     "Lesson NN: …" whose number has no file in `lessons/` was published on a night the push failed. Recover it first:
     read it with `path: "index.html"`, save it as `lessons/NN-slug.html`, write the matching `.md` (front matter from
     the page), make its audio and republish it as in step 4 with its own `url`. Count it as delivered.
   - If any lesson `.md` has `date: <today>` in its front matter, a lesson was already delivered today.
     Send one push notification with its title and its `artifact:` link, then stop.
   - Otherwise the next lesson number N = (highest existing NN) + 1. If N > 56, send a push saying the
     course is complete and that a review week can be scheduled, then stop.

3. Write lesson N.
   - Title and topic come from the syllabus line for N.
   - About 800 words. Follow the Standing rules in the syllabus exactly.
   - Sections, in this order and with these headings: Bottom line · In plain English · The framework ·
     A worked example · The beginner mistake · Checklist · Self-test · Apply it today · Sources and sign-offs.
   - Use round hypothetical numbers only. Never a 592 Marathon project figure. Never a retired fact.
   - Any statute, rate, case or treaty article: cite a primary source you verified today with WebFetch,
     or tag it "[unverified — confirm independently]". Add "Professional Sign-Off Required: [discipline]"
     where a licensed professional must act.
   - Save the text as `legal-curriculum/lessons/NN-slug.md` with front matter:
     `number`, `title`, `topic`, `date` (Mountain), `artifact` (fill after publishing).

4. Build the page, make its audio, and publish both.
   - Copy `legal-curriculum/template/lesson.html` to `legal-curriculum/lessons/NN-slug.html`.
   - Replace only the `<title>`, the `<header>` text (eyebrow, h1, meta line) and the content inside `<article>`.
     Keep the `<style>`, both Listen bars (one at the top, one after the lesson), the `audio-map` script tag and
     the player `<script>` unchanged.
   - Make the recording. The Claude app has no built-in read-aloud voice, so the Listen button plays a file:
     ```
     TTS=$(bash legal-curriculum/tools/tts_setup.sh)
     "$TTS/venv/bin/python" -I legal-curriculum/tools/make_audio.py --tts-home "$TTS" legal-curriculum/lessons/NN-slug.html
     ```
     The first command downloads the voice from npm and PyPI (about 2 minutes). The second writes `lessons/NN-slug.mp3`
     and the timing map into the page (about 5 minutes; run it in the background if a command limit stops it).
     Check its last line: about 4 to 9 minutes for an 800-word lesson, and a size under 15 MB.
   - Load the `artifact-design` skill, then publish the HTML with the Artifact tool, `icon` = "book",
     `description` = one sentence naming the lesson, and
     `files` = `{"lesson.mp3": "legal-curriculum/lessons/NN-slug.mp3"}`. The page plays `lesson.mp3`; without that
     file the Listen button has nothing to play. Write the returned URL into the `.md` front matter.
   - If the audio cannot be made, publish the page anyway and say so in the push notification. Never say a lesson
     has audio when it does not.

4b. Refresh the pinned roadmap page.
   - Run `python3 -I legal-curriculum/tools/build_roadmap.py`. It rebuilds `legal-curriculum/SYLLABUS.html` from the
     lesson files, so the new lesson appears in the "Delivered lessons" table and is linked in its topic.
   - The roadmap is pinned in the sidebar at https://claude.ai/artifact/Kq1tfDtiPMKTJ8UArEA5Li. Keep that link.
     First read it with the Artifact tool (`action: "read"`, that `url`). If the live page carries a change that is not
     in the builder, add it to `tools/build_roadmap.py` and rebuild. Then publish `SYLLABUS.html` with that same `url`.
     Never publish it without `url`: that creates a second, unpinned page. Omit `icon`.

5. Save and notify.
   - The `.mp3` files are not committed (`legal-curriculum/.gitignore`). They live in the published page, and
     `make_audio.py` makes the same file again from the page.
   - `git add legal-curriculum && git commit -m "Lesson NN: <title>"` and `git push -u origin claude/legal-expertise-curriculum-88wclh`.
     On a network failure retry up to 4 times (2s, 4s, 8s, 16s). If a draft PR for the branch is not open, open one.
   - Append one row for the lesson to the table in `legal-curriculum/README.md` before committing.
   - Load the `PushNotification` tool and send: "Lesson NN of 56 — <title>" with the artifact URL.
   - Finish with a short chat message: lesson number, title, the link, and one sentence on what it covers.

## Do not
- Do not email anything. Do not contact any person. Do not touch any file outside `legal-curriculum/`.
- Do not bump `APP_VERSION` or `CACHE`. This course does not ship with the app.
- Do not restate the whole lesson in chat. The page is the lesson.
