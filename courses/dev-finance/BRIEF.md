# Development Finance — writer's brief (the "business financial skills" course)

A six-week course in real estate development finance for Mr Shabazz (address him as "Mr Shabazz").
3 lessons a week: Day 1 = Tuesday, Day 2 = Wednesday, Day 3 = Thursday. 18 lessons. n = (week-1)*3 + day.
The reader opens any lesson in any order and reads it or presses Listen (the phone reads it aloud).
Each lesson is a short teaching section followed by a drill, with full worked answers hidden behind
"Show the answer" so he can try first.

Weekly topics:
W1 Development economics: yield on cost, cap rates, value = NOI / cap rate, development spread, residual
   land value, profit on cost.
W2 Profit vs cash: the three financial statements, capitalized development costs, loan principal,
   receivables, monthly construction cash flow, the "cash valley".
W3 The pro forma: hard and soft costs, contingency, draw schedule, interest carry, lease-up, stabilized NOI.
W4 Capital stack: senior debt, mezzanine, preferred and common equity, loan-to-cost, loss order, a 2-tier
   equity waterfall with preferred return.
W5 Stress-testing: sensitivity tables, downside cases, DSCR 1.20x breakpoints, pre-mortem.
W6 Personal guarantees, concentration risk, holding company/SPV structures for wealth protection
   (conceptual only, no jurisdiction-specific tax or legal advice), plus mixed review of all weeks.
Spread each week's topics across its three days sensibly (Day 1 foundations, Day 2 build, Day 3 harder
application). Week 6 Day 3 is a mixed review drill across all six weeks.

Lesson structure (body HTML):
1. <p class="lede">two-sentence bottom line</p>
2. <h3>The idea</h3> plain English, then the formula, with units. 400-700 words of teaching with one
   fully worked hypothetical example step by step.
3. <h3>Tonight's drill</h3> intro line, then three problems, each <h4>Problem 1</h4> etc. Increasing
   difficulty; at least two numeric with round illustrative figures; one conceptual "what would a
   lender ask?" problem. Then <h4>The roommate question</h4>: link the concept to his work as a power-grid
   reliability coordinator (for example N-1 contingency vs stress testing).
4. Answers are NOT in the body. They go in the "answers" field.
Write numbers so they read well aloud ("4.5 million dollars", "a 6 percent cap rate").
Allowed tags: h3, h4, p, ol, ul, li, strong, em, table, tr, th, td. Class: only p.lede.

Rules: hypothetical deals only; never use figures from any real project; never mention Parcel 786,
592 Marathon project figures, a six-storey program, an anchor tenant, CNQC or MEI. Ratios such as DSCR
1.20x are common lender practice, not law; say so. Education only, not financial, tax or legal advice.
Never use the word "delve".

JSON format — one file per week, lessons/wNN.json (NN = 01..06), a JSON array of 3 objects:
{"n": <1-18>, "w": <week>, "d": <1-3>, "dayname": "Tuesday"|"Wednesday"|"Thursday",
 "title": "<plain text>", "summary": "<two plain sentences>", "body": "<HTML string>",
 "answers": [{"label":"Problem 1","html":"<full worked answer HTML: steps, the root-cause of the usual
   error, and a one-line rule to remember>"}, ... for Problem 2, Problem 3 and "The roommate question"],
 "rule": "<one-line rule to remember from the whole lesson>"}
Check every calculation twice. Write each file with a Python script (json.dump, ensure_ascii=False,
indent=1) and validate it: python3 -c "import json;d=json.load(open('FILE'));assert len(d)==3".
