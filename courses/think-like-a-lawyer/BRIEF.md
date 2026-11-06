# Think Like a Lawyer — writer's brief

The course: 56 daily lessons for Mr Shabazz (address him as "Mr Shabazz"), about 10 minutes each.
Syllabus and the Standing Rules are in SYLLABUS.md in this folder — follow every Standing Rule.
Week = ceil(n/7), Day = ((n-1) mod 7)+1, so 8 weeks of 7 lessons.
The reader can open any lesson out of order and either read it or press Listen (the phone reads it aloud),
so each lesson must stand alone and sound right read aloud.

Lesson structure (body HTML), in order:
1. <p class="lede"><strong>Bottom line.</strong> ...</p> two or three sentences.
2. <h3>In plain English</h3>
3. <h3>The framework</h3> (an ordered list is fine)
4. <h3>A worked example</h3> round hypothetical numbers, labelled hypothetical. End with
   "Professional Sign-Off Required: <discipline>" where a licensed professional must act.
5. <h3>The beginner mistake</h3>
6. <h3>How you will use it</h3> how a developer uses this.
(The checklist, self-test, apply-today and sources go in separate JSON fields, not the body.)
Length: body 800 to 1,000 words. Plain words, short sentences, define every term the first time, no idioms.
Allowed tags: h3, p, ol, ul, li, strong, em, blockquote, table, tr, th, td. Classes: only p.lede.

Hard rules: never state any 592 Marathon project figure; never mention Parcel 786 facts, a six-storey
program, an anchor tenant, CNQC, or Marathon-Enterprise/MEI. Jurisdictional law (Canada, Alberta, Guyana)
is taught as concepts. Any statute, rate, treaty article, case or threshold named must either be one you
are confident is accurate and cited to its primary source by name (for example the Income Tax Act (Canada)
and the section), or tagged "[unverified — confirm independently]". Never invent a citation. When in doubt,
teach the concept without the number. Education only; no advice.

JSON format — one file per topic, lessons/tNN.json (NN = topic number 01..14), a JSON array of 4 objects:
{"n": <lesson number>, "w": <week>, "d": <day>, "topic": "<topic name>", "tnum": <topic number>,
 "title": "<lesson title, plain text>", "summary": "<two plain sentences>",
 "body": "<lesson HTML string>",
 "checklist": ["<five to seven plain-text items>"],
 "selftest": {"q": "<a scenario question>", "a": "<model answer>"},
 "apply": "<one task to do today, plain text>",
 "sources": "<sources and verification note, plain text>",
 "signoff": "<the professional sign-off line, plain text, or empty string>"}
Write each file with a Python script (json.dump, ensure_ascii=False, indent=1) and validate it with
python3 -c "import json;d=json.load(open('FILE'));assert len(d)==4".
