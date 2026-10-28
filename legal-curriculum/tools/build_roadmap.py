"""Rebuild legal-curriculum/SYLLABUS.html, the pinned roadmap page.

Reads the 56 lessons from SYLLABUS.md and every delivered lesson from the
front matter of lessons/NN-*.md. A delivered lesson gets a row in the
"Delivered lessons" table and a link in its topic list. Run it after a
lesson is written, then republish SYLLABUS.html to the same artifact URL.

Usage: python3 -I legal-curriculum/tools/build_roadmap.py
"""
import html, pathlib, re, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
syl = (ROOT / "SYLLABUS.md").read_text(encoding="utf-8")
tpl = (ROOT / "template" / "lesson.html").read_text(encoding="utf-8")
style = re.search(r"<style>.*?</style>", tpl, re.S).group(0)

def front(text):
    m = re.match(r"---\n(.*?)\n---", text, re.S)
    out = {}
    if m:
        for line in m.group(1).splitlines():
            k, _, v = line.partition(":")
            out[k.strip()] = v.strip().strip('"')
    return out

delivered = {}
for p in sorted((ROOT / "lessons").glob("[0-9][0-9]-*.md")):
    f = front(p.read_text(encoding="utf-8"))
    try:
        n = int(f.get("number", ""))
    except ValueError:
        continue
    url = f.get("artifact", "")
    if not re.fullmatch(r"https://claude\.ai/artifact/[A-Za-z0-9]+", url):
        url = ""
    delivered[n] = {"title": f.get("title", ""), "date": f.get("date", ""), "url": url}

def nice_date(iso):
    try:
        d = datetime.date.fromisoformat(iso)
        return d.strftime("%B ") + str(d.day) + d.strftime(", %Y")
    except ValueError:
        return html.escape(iso)

topics = re.findall(r"### Topic (\d+) — (.+?) \((.+?)\)\n((?:\d+\..*\n)+)", syl)
assert len(topics) == 14, len(topics)
sections = ""
for n, name, _rng, body in topics:
    items = ""
    for m in re.finditer(r"(\d+)\. (.+)", body):
        num, title = int(m.group(1)), html.escape(m.group(2))
        d = delivered.get(num)
        if d and d["url"]:
            label = f'<a href="{d["url"]}">{title}</a><span class="ready">Ready</span>'
        else:
            label = title
        items += f"<li><span class='n'>{num}</span><span class='t'>{label}</span></li>"
    sections += f"<section><h2><span class='tnum'>Topic {n}</span>{html.escape(name)}</h2><ol>{items}</ol></section>\n"

count = len(delivered)
nxt = count + 1 if count < 56 else None
rows = ""
for num in sorted(delivered, reverse=True):
    d = delivered[num]
    title = html.escape(d["title"])
    link = f'<a href="{d["url"]}">{title}</a>' if d["url"] else title
    rows += f"<tr><td class='num'>{num}</td><td>{nice_date(d['date'])}</td><td>{link}</td></tr>"
if not rows:
    rows = "<tr><td colspan='3'>No lessons yet. The first one arrives at 8:30 PM Mountain.</td></tr>"
next_line = (f"Next: lesson {nxt}, tonight or tomorrow at 8:30 PM Mountain." if nxt
             else "All 56 lessons are delivered.")
pct = round(count / 56 * 100)

page = f"""<title>Think Like a Lawyer</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
{style}
<style>
.panel,section{{background:var(--paper);border:1px solid var(--rule);border-radius:12px;padding:6px 18px 14px;margin:14px 0}}
.panel h2,section h2{{font-family:var(--display);font-weight:600;font-size:22px;margin:14px 0 6px;padding-bottom:4px;border-bottom:2px solid var(--brass);text-wrap:balance}}
.tnum{{display:block;font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--brass);margin-bottom:2px}}
section ol{{list-style:none;margin:6px 0 0;padding:0}}
section li{{display:flex;gap:12px;align-items:baseline;padding:5px 0;border-top:1px solid var(--rule)}}
section li:first-child{{border-top:0}}
.n,.num{{font-family:var(--mono);font-size:13px;color:var(--ink-2);min-width:2.2em;font-variant-numeric:tabular-nums}}
.t{{min-width:0;flex:1}}
a{{color:var(--ink);font-weight:500;text-decoration:underline;text-decoration-color:var(--brass);text-decoration-thickness:2px;text-underline-offset:3px}}
a:hover{{color:var(--brass)}}
a:focus-visible{{outline:3px solid var(--brass);outline-offset:2px;border-radius:2px}}
.ready{{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--good);margin-left:auto;padding-left:8px;white-space:nowrap}}
section li .t{{display:flex;gap:8px;align-items:baseline}}
.progress{{height:8px;background:var(--rule);border-radius:4px;overflow:hidden;margin:10px 0 4px}}
.progress span{{display:block;height:100%;width:{pct}%;background:var(--brass)}}
.count{{font-family:var(--mono);font-size:13px;color:var(--ink-2);font-variant-numeric:tabular-nums}}
.tablewrap{{overflow-x:auto}}
table{{width:100%;border-collapse:collapse;font-size:15px}}
th{{text-align:left;font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);font-weight:500;padding:6px 8px 6px 0;border-bottom:1px solid var(--rule)}}
td{{padding:7px 8px 7px 0;border-bottom:1px solid var(--rule);vertical-align:baseline}}
td:nth-child(2){{white-space:nowrap;color:var(--ink-2)}}
tr:last-child td{{border-bottom:0}}
.rules ul{{margin:8px 0 0 20px;padding:0}} .rules li{{margin:5px 0}}
</style>
<div class="wrap">
<header>
  <div class="eyebrow">A private daily course · 56 lessons · 14 topics</div>
  <h1>Think Like a Lawyer</h1>
  <div class="meta"><span>One lesson a day, about 10 minutes</span><span>Delivered at 8:30 PM Mountain</span><span>Started October 27, 2026</span></div>
</header>
<div class="panel">
  <h2>Delivered lessons</h2>
  <div class="progress" role="progressbar" aria-label="Course progress" aria-valuemin="0" aria-valuemax="56" aria-valuenow="{count}"><span></span></div>
  <div class="count">{count} of 56 delivered · {next_line}</div>
  <div class="tablewrap"><table>
    <thead><tr><th>#</th><th>Date</th><th>Lesson</th></tr></thead>
    <tbody>{rows}</tbody>
  </table></div>
</div>
<div class="panel rules">
  <h2>How each lesson is built</h2>
  <ul>
    <li>Plain English first. Then the professional framework. Then one worked example.</li>
    <li>One beginner mistake. One checklist. One self-test. One task to apply today.</li>
    <li>Round hypothetical numbers only. No project figures. No retired facts.</li>
    <li>Any law, rate or treaty is cited to a primary source or tagged "unverified".</li>
    <li>Every lesson names the licensed professional who must sign off before you act.</li>
    <li>Every page has a Listen button that reads the lesson aloud.</li>
    <li>Delivered lessons are in the table above and linked in each topic below. Tap a title to open it.</li>
  </ul>
</div>
{sections}
<footer>Education only. This course teaches how to think about a problem. It is not legal, tax or financial advice, and it does not replace a licensed professional.</footer>
</div>
"""
(ROOT / "SYLLABUS.html").write_text(page, encoding="utf-8")
print(f"SYLLABUS.html rebuilt: {count} delivered, next {nxt}")
