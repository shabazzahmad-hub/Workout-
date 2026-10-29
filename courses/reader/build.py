#!/usr/bin/env python3
"""Build a course page: python3 -I courses/reader/build.py <elite|lawyer|finance>
Writes courses/dist/<course>/index.html and data/wNNN.json. Reports missing weeks."""
import json, os, re, sys, glob, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = open(os.path.join(ROOT, 'reader', 'template.html'), encoding='utf-8').read()

THEMES = {
 'elite': dict(
  fonts='https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Sans+3:wght@400;600&display=swap',
  light='--bg:#EFF2F5;--paper:#FFFFFF;--paper-2:#E7ECF0;--ink:#141C25;--ink-2:#4A5A6A;--ink-3:#6E7C89;--rule:#CBD4DC;--rule-2:#A6B3BF;'
        '--accent:#0E6B5C;--accent-soft:#DCEFEA;--on-accent:#FFFFFF;--now:#FFF3C4;--good:#0E6B5C;--shadow:rgba(20,28,37,.08);'
        '--display:Archivo,system-ui,sans-serif;--body:"Source Sans 3",system-ui,-apple-system,sans-serif;'
        '--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;--dw:700;--r:3px;',
  dark='--bg:#0E141A;--paper:#171F27;--paper-2:#1F2A34;--ink:#E3E9ED;--ink-2:#A2B0BC;--ink-3:#7D8B98;--rule:#2A3642;--rule-2:#3B4A58;'
       '--accent:#46B9A4;--accent-soft:#12302B;--on-accent:#0E141A;--now:#3A3415;--good:#46B9A4;--shadow:rgba(0,0,0,.4);'),
 'lawyer': dict(
  fonts='https://fonts.googleapis.com/css2?family=EB+Garamond:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap',
  light='--bg:#F4F5F7;--paper:#FFFFFF;--paper-2:#EEF0F3;--ink:#1A222C;--ink-2:#4A5664;--ink-3:#6B7684;--rule:#D8DCE2;--rule-2:#B9C0C9;'
        '--accent:#8C6D1F;--accent-soft:#F1E9D2;--on-accent:#FFFFFF;--now:#FFF6D6;--good:#2F6B3A;--shadow:rgba(26,34,44,.08);'
        '--display:"EB Garamond",Georgia,serif;--body:"IBM Plex Sans",system-ui,-apple-system,sans-serif;'
        '--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;--dw:600;--r:8px;',
  dark='--bg:#121820;--paper:#1A222C;--paper-2:#202A35;--ink:#E9ECF0;--ink-2:#A9B3BF;--ink-3:#8590A0;--rule:#2C3744;--rule-2:#3D4A59;'
       '--accent:#D6B35B;--accent-soft:#2A2A1F;--on-accent:#1A222C;--now:#2E2A16;--good:#8FD19A;--shadow:rgba(0,0,0,.4);'),
 'finance': dict(
  fonts='https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@600;700&family=Public+Sans:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap',
  light='--bg:#F1F4F8;--paper:#FFFFFF;--paper-2:#E9EEF5;--ink:#132033;--ink-2:#45556B;--ink-3:#69788C;--rule:#CFD8E3;--rule-2:#A9B6C6;'
        '--accent:#1F4FA3;--accent-soft:#DDE7F7;--on-accent:#FFFFFF;--now:#FFF2C2;--good:#1F7A4A;--shadow:rgba(19,32,51,.08);'
        '--display:"Zilla Slab",Georgia,serif;--body:"Public Sans",system-ui,-apple-system,sans-serif;'
        '--mono:"JetBrains Mono",ui-monospace,Menlo,monospace;--dw:700;--r:6px;',
  dark='--bg:#0D1520;--paper:#152131;--paper-2:#1B2A3D;--ink:#E6ECF4;--ink-2:#A6B3C4;--ink-3:#7F8DA0;--rule:#26364A;--rule-2:#374960;'
       '--accent:#7FA8F0;--accent-soft:#16294A;--on-accent:#0D1520;--now:#3A3415;--good:#6FCF97;--shadow:rgba(0,0,0,.4);'),
}

def esc(s): return html.escape(s, quote=False)

def elite():
    d = os.path.join(ROOT, 'elite-developer')
    cur = open(os.path.join(d, 'CURRICULUM.md'), encoding='utf-8').read()
    titles, groups, g = {}, [], None
    for line in cur.splitlines():
        m = re.match(r'^P(\d+) (.+)$', line)
        if m:
            g = {'label': m.group(2).title().replace("'S", "'s"), 'from': None, 'to': None}; groups.append(g); continue
        m = re.match(r'^W(\d+) (.+)$', line)
        if m:
            w = int(m.group(1)); t = m.group(2)
            t = re.sub(r';\s*[^;]*$', '', t) if ';' in t else t
            titles[w] = t.replace(' (checkpoint for', ' — Checkpoint (').rstrip()
            if g['from'] is None: g['from'] = w
            g['to'] = w
    for w, t in titles.items():
        if t.startswith('CP'): titles[w] = 'Checkpoint' + t[2:]
        if t.startswith('FINAL CP'): titles[w] = 'Final checkpoint' + t[8:]
    weeks = {}
    for f in sorted(glob.glob(os.path.join(d, 'lessons', 'w*.json'))):
        w = int(re.search(r'w(\d+)\.json', f).group(1)); weeks[w] = json.load(open(f, encoding='utf-8'))
    # rules so far, and recorded audio for the first two lessons
    rules = {}
    for w, ls in weeks.items():
        for L in ls:
            if L.get('rule'): rules[w] = L['rule']
    for w, ls in weeks.items():
        for L in ls:
            if L['n'] in (1, 2): L['audio'] = 'audio/lesson-%02d.mp3' % L['n']
            if L.get('checklist') == ['RULES_SO_FAR'] or 'RULES_SO_FAR' in (L.get('checklist') or []):
                L['checklist'] = [rules[k] for k in sorted(rules) if k <= w] or ['No rules recorded yet.']
                L['head'] = 'Rules I will not break'
    cfg = dict(key='elite', short='Elite Developer', pad=3, groups=groups, weekTitles=titles)
    meta = dict(
        title='Elite Developer', eyebrow='592 Marathon · Developer and wealth builder',
        sub='131 weeks, 917 lessons. Open any week, any day, in any order. Read the full lesson, or tap Listen and the phone reads it aloud.',
        about='<p>Every week has one subject and seven seats. Day 1 first principles. Day 2 failure forensics, ending with one rule for your list, Rules I Will Not Break. Day 3 the money. Day 4 the rules. Day 5 the numbers. Day 6 the room. Day 7 Kema&rsquo;s quiz, recap, red pen and boardroom drill. Each phase ends with a checkpoint week.</p>'
              '<p>Choose a phase, then a week, then a day. Your place and the lessons you have opened are kept on this phone. Tick &ldquo;Keep playing the next lesson&rdquo; to listen straight through a long session.</p>'
              '<p>Lessons 1 and 2 also have their original recorded audio. Every lesson can be read aloud by the phone&rsquo;s own voice; pick the voice you like best from the list.</p>',
        footer='Elite Developer · a private course. Education only. Nothing here is legal, tax, engineering, accounting or financing advice. Ratios, lending terms and contract percentages are commercial practice, not rules; lessons name the professional whose sign-off a real decision needs.')
    return weeks, cfg, meta, 'elite'

def lawyer():
    d = os.path.join(ROOT, 'think-like-a-lawyer')
    weeks, topics = {}, {}
    for f in sorted(glob.glob(os.path.join(d, 'lessons', 't*.json'))):
        for L in json.load(open(f, encoding='utf-8')):
            L['w'] = (L['n'] - 1) // 7 + 1; L['d'] = (L['n'] - 1) % 7 + 1
            L['angle'] = 'Topic %d · %s' % (L.get('tnum', 0), L.get('topic', ''))
            weeks.setdefault(L['w'], []).append(L)
            topics.setdefault(L['w'], [])
            if L.get('topic') and L['topic'] not in topics[L['w']]: topics[L['w']].append(L['topic'])
    for w in weeks: weeks[w].sort(key=lambda L: L['n'])
    titles = {w: ' · '.join(t) for w, t in topics.items()}
    cfg = dict(key='lawyer', short='Think Like a Lawyer', pad=3, groups=None, weekTitles=titles)
    meta = dict(
        title='Think Like a Lawyer', eyebrow='A 56-lesson course · 14 topics',
        sub='Eight weeks, one lesson a day, about ten minutes each. Open any lesson in any order. Read it, or tap Listen to hear it read aloud.',
        about='<p>The order runs from foundations to structure, then tax, money, land and estate. Each lesson teaches in plain English first, then the framework, one worked example with hypothetical numbers, the beginner mistake, a checklist, a self-test with a model answer, and one task to apply today.</p>'
              '<p>Any statute, rate or treaty named carries its source or is tagged <em>unverified — confirm independently</em>. Where a licensed professional must act, the lesson says which one.</p>',
        footer='Think Like a Lawyer · a private course. This teaches how to think about a problem. It is not legal, tax or financial advice, and it does not replace a licensed professional.')
    return weeks, cfg, meta, 'lawyer'

def finance():
    d = os.path.join(ROOT, 'dev-finance')
    weeks = {}
    for f in sorted(glob.glob(os.path.join(d, 'lessons', 'w*.json'))):
        w = int(re.search(r'w(\d+)\.json', f).group(1)); weeks[w] = json.load(open(f, encoding='utf-8'))
    titles = {1: 'Development economics', 2: 'Profit versus cash', 3: 'The pro forma', 4: 'The capital stack',
              5: 'Stress-testing', 6: 'Guarantees, concentration and structure, plus review'}
    cfg = dict(key='finance', short='Development Finance', pad=2, groups=None, weekTitles=titles,
               dayNames=['Tuesday', 'Wednesday', 'Thursday'])
    meta = dict(
        title='Development Finance', eyebrow='A six-week course · 18 lessons',
        sub='Real estate development finance, three lessons a week. Each lesson teaches one idea, then sets a drill with full worked answers you open after you try.',
        about='<p>Week 1 development economics. Week 2 profit versus cash. Week 3 the pro forma. Week 4 the capital stack and the waterfall. Week 5 stress-testing. Week 6 guarantees, concentration and structure, with a mixed review.</p>'
              '<p>Every deal is hypothetical, with round numbers. Try each problem before you open its answer; each answer names the usual error and gives a rule to remember. The roommate question links the idea to grid operations.</p>',
        footer='Development Finance · a private course. Education only; not financial, tax or legal advice. Ratios such as a 1.20 debt service coverage ratio are common lender practice, not law.')
    return weeks, cfg, meta, 'finance'

def build(name):
    weeks, cfg, meta, theme = {'elite': elite, 'lawyer': lawyer, 'finance': finance}[name]()
    out = os.path.join(ROOT, 'dist', name); os.makedirs(os.path.join(out, 'data'), exist_ok=True)
    idx = []
    for w in sorted(weeks):
        ls = sorted(weeks[w], key=lambda L: L['n'])
        for L in ls:
            idx.append({k: v for k, v in dict(n=L['n'], w=w, d=L['d'], t=L['title'], a=L.get('angle', ''),
                        who=L.get('who', ''), role=L.get('role', '')).items() if v not in ('', None)})
        json.dump(ls, open(os.path.join(out, 'data', 'w%0*d.json' % (cfg['pad'], w)), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    T = THEMES[theme]
    js = lambda o: json.dumps(o, ensure_ascii=False).replace('</', '<\\/')
    page = (TEMPLATE.replace('__FONTS__', T['fonts']).replace('__LIGHT__', T['light']).replace('__DARK__', T['dark'])
            .replace('__TITLE__', esc(meta['title'])).replace('__EYEBROW__', esc(meta['eyebrow'])).replace('__SUB__', esc(meta['sub']))
            .replace('__ABOUT__', meta['about']).replace('__FOOTER__', esc(meta['footer']))
            .replace('__CONFIG__', js(cfg)).replace('__INDEX__', js(idx)))
    open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(page)
    print(name, 'weeks:', len(weeks), 'lessons:', len(idx), 'page KB:', len(page.encode()) // 1024)
    return weeks

if __name__ == '__main__':
    build(sys.argv[1])
