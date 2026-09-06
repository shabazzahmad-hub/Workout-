import { serve, launch } from './tests/lib/harness.mjs';
const { srv, port } = await serve();
const { browser, page } = await launch(port);
console.log(await page.evaluate(() => {
  const out = {};
  const set = { jacks: ['setJackVal', 'jackVal', 'jackUnit'], bike: ['setBikeVal', 'bikeVal', 'bikeUnit'],
    ruck: ['setRuckVal', 'ruckVal', 'ruckUnit'], run: ['setRunVal', 'runVal', 'runUnit'],
    skip: ['setSkipVal', 'skipVal', 'skipUnit'] };
  STATE.profile.unit = 'cm';
  Object.keys(set).forEach(mode => {
    const [fn, vk, uk] = set[mode];
    (CARDIO_INFO[mode].units()).forEach(([u]) => {
      const d = nutToday(); d[uk] = u;
      window[fn](999999);
      out[mode + '.' + u] = nutToday()[vk];
    });
  });
  return JSON.stringify(out);
}));
await browser.close(); await srv.close();
