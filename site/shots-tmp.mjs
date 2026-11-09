import { chromium } from 'playwright';
const out = '/home/user/tex-thesis/site/test-screenshots';
const root = 'http://127.0.0.1:4500/overfull/';
const only = process.argv[2];
const b = await chromium.launch();
for (const w of [1280, 375]) for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: w, height: w === 1280 ? 900 : 812 }, deviceScaleFactor: 1, colorScheme: scheme });
  for (const [name, path] of [['home', ''], ['rule', 'rules/overfull-box/'], ['rule2', 'rules/missing-dollar/'], ['templates', 'templates/'], ['docs', 'docs/install/'], ['check', 'check/']]) {
    if (only && !only.split(',').includes(name)) continue;
    const p = await ctx.newPage();
    await p.goto(root + path, { waitUntil: 'networkidle' });
    if (name === 'check') {
      await p.uncheck('#online');
      await p.click('[data-sample="bib"]');
      await p.waitForSelector('#sheet-view .sheet');
    }
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${out}/${name}-${w}-${scheme}.png`, fullPage: true });
    await p.close();
  }
  await ctx.close();
}
await b.close();
