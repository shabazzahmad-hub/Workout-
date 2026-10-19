/* Suite 26 — the problem report (v518).

   Settings had a bare link to the GitHub issues page, so a report arrived with
   no version, no device and no error message. The button now fills those in.

   THE ISSUES ON THIS REPOSITORY ARE PUBLIC, which makes the privacy half of this
   suite the important half. The athlete is seeded with distinctive values in
   every place a careless report could reach — a name, a body weight, a food,
   both API keys — and none of them may appear in the preview OR in the address
   the browser is sent to. The address is checked separately because it is what
   actually leaves: a preview that is clean over a URL that is not would pass a
   check that only read the screen. */
import { serve, launch, suite, seedAthlete } from './lib/harness.mjs';

export default async function run() {
  const t = suite('problem report');
  const { srv, port } = await serve();
  const { browser, page, errors } = await launch(port);
  await seedAthlete(page);

  const SECRETS = ['Zqxname Quill', 'ZQXFOOD', '123.4', 'AZKEY-ZQX-123', 'GEMKEY-ZQX-456'];

  /* ---- the route: Settings has a button, and it opens the sheet ---------- */
  const route = await page.evaluate(async (SECRETS) => {
    const out = {};
    STATE.profile.name = SECRETS[0];
    STATE.nutrition.weightKg = 123.4;
    STATE.measurements = [{ date: todayISO(), weight: 123.4 }];
    { const d = nutToday(); d.food = d.food || []; } nutToday().food.push({ name: SECRETS[1], kcal: 500, p: 30, c: 40, f: 20, meal: 'l', at: Date.now() });
    STATE.settings.azureKey = SECRETS[3];
    STATE.settings.foodAiKey = SECRETS[4];
    save();
    _appErrors = [];
    go('guide');
    const btn = [...document.querySelectorAll('#v-guide button')].find(b => /Report a problem/.test(b.textContent));
    out.hasBtn = !!btn;
    out.noBareLink = !document.querySelector('#v-guide a[href$="/issues"]') ||
      !/Report a problem/.test(document.querySelector('#v-guide a[href$="/issues"]').textContent);
    /* Guard before the first dereference: with no button there is no sheet,
       and every field below must still exist so the checks fail BY NAME
       rather than the file throwing. */
    if (!btn) return Object.assign(out, { title: '', previewStart: '', previewTyped: '', url: '', urlBody: '', urlTitle: '', ver: APP_VERSION, state: JSON.stringify(STATE) });
    btn.click();
    const sh = document.querySelector('#sheet');
    out.title = (sh.querySelector('h3') || {}).textContent || '';
    const ta = sh.querySelector('#rpWhat');
    out.labelled = !!(ta && sh.querySelector('label[for="rpWhat"]'));
    out.previewStart = (sh.querySelector('#rpPreview') || {}).textContent || '';
    out.saysPublic = /issues are public/i.test(sh.textContent);
    if (ta) { ta.value = 'The timer froze on set 2'; ta.dispatchEvent(new Event('input')); }
    /* read back synchronously — a check that a keystroke repaints must not await */
    out.previewTyped = (sh.querySelector('#rpPreview') || {}).textContent || '';
    let opened = null; const _o = window.open;
    window.open = (u) => { opened = u; return null; };
    try { [...sh.querySelectorAll('button')].find(b => /Open on GitHub/.test(b.textContent)).click(); }
    finally { window.open = _o; }
    out.url = opened || '';
    out.urlBody = (() => { try { return new URL(opened).searchParams.get('body') || ''; } catch (e) { return ''; } })();
    out.urlTitle = (() => { try { return new URL(opened).searchParams.get('title') || ''; } catch (e) { return ''; } })();
    out.ver = APP_VERSION;
    out.state = JSON.stringify(STATE);
    return out;
  }, SECRETS);

  t.ok('Settings carries a Report a problem button', route.hasBtn, route);
  t.ok('and it is no longer a bare link to the issues list', route.noBareLink, route);
  t.eq('the button opens the report sheet', route.title, 'Report a problem', route.title);
  t.ok('the description box has a label a screen reader reads', route.labelled, route);
  t.ok('the sheet says GitHub issues are public before anything is sent', route.saysPublic, route);
  t.ok('the preview names the app version', route.previewStart.includes('v' + route.ver), route.previewStart.slice(0, 300));
  t.ok('typing repaints the preview at once', route.previewTyped.includes('The timer froze on set 2'), route.previewTyped.slice(0, 200));
  t.ok('Open on GitHub sends the browser to a NEW issue on this repository',
    route.url.startsWith('https://github.com/shabazzahmad-hub/Workout-/issues/new?'), route.url.slice(0, 120));
  t.ok('and the issue body carries what the athlete typed', route.urlBody.includes('The timer froze on set 2'), route.urlBody.slice(0, 200));
  t.ok('and the title names the version', route.urlTitle.includes('v' + route.ver), route.urlTitle);
  t.eq('the body that leaves is the body the preview showed', route.urlBody, route.previewTyped, 'preview vs address');

  /* GUARD: the secrets really are in the athlete's data, or "absent from the
     report" is satisfied by a seed that never landed. */
  SECRETS.slice(0, 2).forEach(sv => t.ok('guard: the seeded value is really stored: ' + sv, route.state.includes(sv), sv));
  t.ok('guard: both API keys are really on this device', route.state.includes(SECRETS[3]) && route.state.includes(SECRETS[4]), '');
  SECRETS.forEach(sv => {
    t.ok('the preview does not carry ' + sv, !route.previewTyped.includes(sv), sv);
    t.ok('and the address the browser is sent to does not carry it either', !decodeURIComponent(route.url).includes(sv), sv);
  });

  /* ---- errors: caught, kept in memory only, capped, newest kept ----------- */
  const errs = await page.evaluate(async () => {
    const out = {};
    _appErrors = [];
    out.noneWord = /Errors caught this session:\*\* none/.test(problemReportText(''));
    /* A REAL uncaught error, through the real window listener — not a call to
       noteAppError(), which would prove the helper and not the wiring. */
    setTimeout(() => { throw new Error('ZQX-uncaught-boom'); }, 0);
    await new Promise(r => setTimeout(r, 60));
    Promise.reject(new Error('ZQX-promise-boom'));
    await new Promise(r => setTimeout(r, 60));
    const txt = problemReportText('');
    out.caughtThrow = /\[error\] ZQX-uncaught-boom/.test(txt);
    out.caughtPromise = /\[promise\] ZQX-promise-boom/.test(txt);
    out.notInState = !JSON.stringify(STATE).includes('ZQX-uncaught-boom');
    for (let i = 0; i < 20; i++) noteAppError('t', 'msg-' + i);
    out.capped = _appErrors.length;
    out.newest = _appErrors[_appErrors.length - 1].msg;
    out.oldestGone = !_appErrors.some(x => x.msg === 'msg-0');
    _appErrors = [];
    /* the render boundary records what it caught and offers the report */
    const real = _render;
    let n = 0;
    _render = () => { n++; throw new Error('ZQX-render-boom-' + n); };
    try { render(); } finally { _render = real; }
    const v = document.querySelector('.view.active');
    out.boundaryBtn = !!(v && [...v.querySelectorAll('button')].some(b => /Report this problem/.test(b.textContent) && /openReport/.test(b.getAttribute('onclick') || '')));
    out.boundaryLogged = _appErrors.filter(x => x.where === 'render').map(x => x.msg);
    render();
    /* the data check is counted with console.error muted, so asking for a
       report never puts noise in the console the harness counts */
    let logged = 0; const ce = console.error; console.error = () => { logged++; };
    const _vd = validateData; validateData = () => { console.error('noise'); return ['a', 'b']; };
    try { out.countLine = (problemReportText('').match(/Data check: [^\n]*/) || [''])[0]; }
    finally { validateData = _vd; console.error = ce; }
    out.loggedDuring = logged;
    out.oneLine = (() => { const _v = validateData; validateData = () => ['a']; try { return (problemReportText('').match(/Data check: [^\n]*/) || [''])[0]; } finally { validateData = _v; } })();
    /* a very long description is cut so the address stays openable */
    /* THE WORST CASE: the longest description, eight errors at the longest
       message. The address must stay short enough to open. */
    for (let i = 0; i < 8; i++) noteAppError('worst-case-x', 'e'.repeat(400));
    const worst = problemReportURL('w'.repeat(5000));
    out.worstLen = worst.length;
    out.worstDescCapped = (new URL(worst).searchParams.get('body').match(/w+/) || [''])[0].length;
    out.worstErrCapped = Math.max(..._appErrors.map(x => x.msg.length));
    _appErrors = [];
    return out;
  });
  t.ok('FLOOR: a session with no errors says none', errs.noneWord, errs);
  t.ok('an uncaught error is caught by the real window listener', errs.caughtThrow, errs);
  t.ok('and an unhandled promise rejection too', errs.caughtPromise, errs);
  t.ok('caught errors are never stored in STATE, so no backup can carry them', errs.notInState, errs);
  t.eq('the error list is capped', errs.capped, 8, errs);
  t.ok('and keeps the NEWEST, not the oldest', errs.newest === 'msg-19' && errs.oldestGone, errs);
  t.ok('the render error screen offers the report', errs.boundaryBtn, errs);
  t.ok('and records both the first error and the retry', errs.boundaryLogged.length === 2 &&
    errs.boundaryLogged.every(m => /ZQX-render-boom/.test(m)), errs.boundaryLogged);
  t.eq('the data check reports a count, never the problems themselves', errs.countLine, 'Data check: 2 problems found', errs.countLine);
  t.eq('one problem takes the singular', errs.oneLine, 'Data check: 1 problem found', errs.oneLine);
  t.eq('and asking for a report puts nothing in the console', errs.loggedDuring, 0, errs);
  t.eq('a description is held to 1500 characters', errs.worstDescCapped, 1500, errs);
  t.eq('an error message is held to 160 characters', errs.worstErrCapped, 160, errs);
  t.ok('so even the worst case is an address a browser opens', errs.worstLen < 7000, errs.worstLen);

  /* The errors above were thrown ON PURPOSE, and the harness counts every page
     error. Only the deliberate ones are removed — each carries ZQX — so a real
     error in this suite still fails it. */
  const deliberate = errors.filter(e => /ZQX/.test(e)).length;
  t.ok('guard: the deliberate errors really reached the page', deliberate >= 3, errors);
  for (let i = errors.length - 1; i >= 0; i--) if (/ZQX/.test(errors[i])) errors.splice(i, 1);

  srv.close();
  const failed = t.finish(errors);
  await browser.close();
  return failed;
}
