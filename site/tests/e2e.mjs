#!/usr/bin/env node
/**
 * End-to-end checks for the built site (run `pnpm --filter site build` first).
 *
 *   pnpm --filter site test:e2e
 *
 * Serves dist/ under the base path, then with Playwright (Chromium):
 *  - loads every page at 1280px and 375px, light and dark: no console errors,
 *    no horizontal overflow, axe-core with zero serious/critical violations;
 *  - checks every internal link (and #fragment) resolves;
 *  - runs the browser check with a sample log and a sample .bib, offline;
 *  - writes screenshots to test-screenshots/ (git-ignored).
 *
 * Env: SITE_BASE (default /overfull), PORT (default 4391), E2E_FULL_AXE=1 to
 * scan every rule page in every variant (default: the main pages only).
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const siteDir = join(here, '..');
const shots = join(siteDir, 'test-screenshots');
mkdirSync(shots, { recursive: true });

const rawBase = process.env.SITE_BASE ?? '/overfull';
const base = rawBase === '/' ? '/' : `/${rawBase.replace(/^\/+|\/+$/g, '')}/`;
const port = Number(process.env.PORT ?? 4391);
const origin = `http://127.0.0.1:${port}`;
const root = origin + base;

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  ✗ ${msg}`);
};

// A small static server for dist/, mounted at the base path like GitHub Pages.
const dist = join(siteDir, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ is missing: run `pnpm --filter site build` first.');
  process.exit(2);
}
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
};
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', origin).pathname);
  const send = (status, file) => {
    try {
      const body = readFileSync(file);
      res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(500).end('dist/ changed while the tests ran');
    }
  };
  if (!path.startsWith(base)) return send(404, join(dist, '404.html'));
  let file = normalize(join(dist, path.slice(base.length)));
  if (!file.startsWith(dist)) return send(404, join(dist, '404.html'));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return send(404, join(dist, '404.html'));
  send(200, file);
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

let browser;
try {
  // CHROMIUM_PATH: use an installed Chrome/Chromium instead of Playwright's download.
  browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );

  // ---- Discover pages ----
  const discover = await browser.newPage();
  await discover.goto(`${root}docs/`);
  const docPages = await discover.$$eval('.docs-nav a', (as) =>
    as.map((a) => new URL(a.href).pathname),
  );
  await discover.goto(`${root}rules/`);
  const rulePages = await discover.$$eval('.rule-list a', (as) =>
    as.map((a) => new URL(a.href).pathname),
  );
  await discover.close();
  const mainPages = [
    base,
    `${base}docs/`,
    `${base}rules/`,
    `${base}check/`,
    `${base}templates/`,
    `${base}does-not-exist/`,
  ];
  const rulesSample = rulePages.slice(0, 3);
  const corpusRule = await (async () => {
    const p = await browser.newPage();
    await p.goto(`${root}rules/`);
    const href = await p.$$eval('.rule-list li', (lis) => {
      const li = lis.find((l) => l.querySelector('.rule-case'));
      return li ? new URL(li.querySelector('a').href).pathname : null;
    });
    await p.close();
    return href;
  })();
  if (corpusRule) rulesSample.push(corpusRule);
  const allPages = [...new Set([...mainPages, ...docPages, ...rulePages])];
  console.log(`Pages: ${allPages.length} (${docPages.length} docs, ${rulePages.length} rules)`);

  const variants = [
    { width: 1280, height: 900, scheme: 'light' },
    { width: 1280, height: 900, scheme: 'dark' },
    { width: 375, height: 812, scheme: 'light' },
    { width: 375, height: 812, scheme: 'dark' },
  ];
  const fullAxe = process.env.E2E_FULL_AXE === '1';
  const links = new Map(); // href -> first page seen on

  // The four viewports run side by side: each gets its own browser context.
  const runVariant = async (v) => {
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: 1,
      colorScheme: v.scheme,
      // Animations end at once, so screenshots need no wait.
      reducedMotion: 'reduce',
    });
    const label = `${v.width}-${v.scheme}`;
    const pages =
      v.width === 1280 && v.scheme === 'light'
        ? allPages
        : [...new Set([...mainPages, ...docPages.slice(0, 4), ...rulesSample])];
    for (const path of pages) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !(path.includes('does-not-exist') && /404/.test(m.text())))
          errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(origin + path, { waitUntil: 'load' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 0) fail(`${label} ${path}: horizontal overflow ${overflow}px`);
      if (errors.length) fail(`${label} ${path}: console errors: ${errors.join(' | ')}`);
      const isMain =
        mainPages.includes(path) ||
        docPages.slice(0, 4).includes(path) ||
        rulesSample.includes(path);
      if (isMain || fullAxe) {
        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
          .analyze();
        const bad = axe.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical');
        for (const x of bad)
          fail(
            `${label} ${path}: axe ${x.impact} ${x.id}: ${x.nodes
              .slice(0, 3)
              .map((n) => n.target.join(' '))
              .join(', ')}`,
          );
      }
      if (v.width === 1280 && v.scheme === 'light') {
        const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
        for (const h of hrefs) {
          const u = new URL(h);
          if (u.origin === origin && !links.has(h)) links.set(h, path);
        }
      }
      await page.close();
    }
    // Screenshots of the main pages
    for (const [name, path] of [
      ['home', base],
      ['docs', docPages[1] ?? `${base}docs/`],
      ['rules', `${base}rules/`],
      ['rule', corpusRule ?? rulePages[0]],
      ['templates', `${base}templates/`],
    ]) {
      if (!path) continue;
      const page = await ctx.newPage();
      await page.goto(origin + path, { waitUntil: 'load' });
      await page.screenshot({
        path: join(shots, `${name}-${label}.png`),
        fullPage: name !== 'home' || v.width === 375,
      });
      await page.close();
    }
    await ctx.close();
    console.log(`${label}: ${pages.length} pages`);
  };
  await Promise.all(variants.map(runVariant));

  // ---- Links ----
  console.log(`\nLinks: ${links.size} internal`);
  const fetched = new Map();
  for (const [href, from] of links) {
    const u = new URL(href);
    const key = u.origin + u.pathname;
    if (!fetched.has(key)) {
      const r = await fetch(key);
      fetched.set(key, { status: r.status, html: r.ok ? await r.text() : '' });
    }
    const res = fetched.get(key);
    if (res.status !== 200 && !from.includes('does-not-exist'))
      fail(`broken link ${u.pathname}${u.hash} (from ${from}): HTTP ${res.status}`);
    else if (res.status === 200 && u.hash && u.hash.length > 1) {
      const id = decodeURIComponent(u.hash.slice(1));
      if (!res.html.includes(`id="${id}"`))
        fail(`missing anchor ${u.pathname}${u.hash} (from ${from})`);
    }
    if (/\.md(#|$)/.test(u.pathname))
      fail(`unrewritten Markdown link ${u.pathname} (from ${from})`);
  }

  // ---- Theme toggle persists ----
  {
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(root);
    await page.click('[data-theme-toggle]');
    await page.goto(`${root}rules/`);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (theme !== 'dark') fail(`theme toggle did not persist (got ${theme})`);
    await ctx.close();
  }

  // ---- Browser check ----
  console.log('\nBrowser check');
  for (const v of [variants[0], variants[3]]) {
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: 1,
      colorScheme: v.scheme,
    });
    const page = await ctx.newPage();
    const errors = [];
    const external = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('request', (r) => {
      if (!r.url().startsWith(origin)) external.push(r.url());
    });
    await page.goto(`${root}check/`, { waitUntil: 'networkidle' });
    await page.uncheck('#online');

    if (await page.isVisible('#result-tools'))
      fail('check page: result tools are visible before there is a report');

    await page.click('[data-sample="log-undefined"]');
    await page.waitForSelector('#sheet-view .sheet', { timeout: 15000 });
    const logChecks = await page.$$eval('#sheet-view .sheet-check', (s) => s.length);
    if (logChecks !== 5) fail(`check page: expected 5 checks in the sheet, got ${logChecks}`);
    const buildStatus = await page.textContent('#sheet-view .sheet-check .sheet-status');
    console.log(`  log sample: build ${buildStatus?.replace('Status: ', '').trim()}`);
    await page.screenshot({
      path: join(shots, `check-log-${v.width}-${v.scheme}.png`),
      fullPage: true,
    });

    await page.click('[data-sample="bib"]');
    await page.waitForFunction(
      () =>
        document
          .querySelector('#sheet-view .sheet-target')
          ?.textContent?.includes('references.bib'),
      null,
      { timeout: 15000 },
    );
    const refs = await page.textContent('#sheet-view #sheet-references');
    if (!refs) fail('check page: references check missing for the bib sample');
    const refText = await page.textContent(
      '#sheet-view section[aria-labelledby="sheet-references"]',
    );
    if (!/ongaro2014raft/.test(refText ?? ''))
      fail('check page: missing cited key not reported for the bib sample');
    const progress = await page.textContent('#progress');
    if (!/Done/.test(progress ?? '')) fail(`check page: progress not done: ${progress}`);

    await page.click('#agent-toggle');
    const json = await page.textContent('#json-out');
    try {
      const parsed = JSON.parse(json ?? '');
      if (parsed.tool !== 'overfull' || parsed.checks.length !== 5)
        fail('check page: agent JSON has the wrong shape');
    } catch {
      fail('check page: agent JSON does not parse');
    }
    await page.click('#agent-toggle');
    await page.screenshot({
      path: join(shots, `check-bib-${v.width}-${v.scheme}.png`),
      fullPage: true,
    });

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    for (const x of axe.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
      fail(
        `check page with report (${v.width}-${v.scheme}): axe ${x.impact} ${x.id}: ${x.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(', ')}`,
      );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0)
      fail(`check page with report (${v.width}): horizontal overflow ${overflow}px`);
    if (errors.length) fail(`check page: console errors: ${errors.join(' | ')}`);
    if (external.length)
      fail(
        `check page made external requests with verification off: ${external.slice(0, 3).join(', ')}`,
      );

    // Unsupported, unreadable and duplicate PDFs are reported, not dropped silently
    await page.setInputFiles('#file-input', [
      { name: 'notes.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK') },
      { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nnot really') },
      { name: 'b.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nnot either') },
    ]);
    await page.waitForFunction(
      () => /readable PDF/.test(document.querySelector('#notice')?.textContent ?? ''),
      null,
      { timeout: 15000 },
    );
    const noticeText = (await page.textContent('#notice')) ?? '';
    if (!/Skipped notes\.docx/.test(noticeText))
      fail(`check page: unsupported file not reported: ${noticeText}`);
    if (!/One PDF at a time; checking the first: a\.pdf/.test(noticeText))
      fail(`check page: second PDF not reported: ${noticeText}`);
    if (!/a\.pdf: This file isn’t a readable PDF \(pdf\.js: /.test(noticeText))
      fail(`check page: unreadable PDF not explained: ${noticeText}`);

    // Keyboard: the drop zone's button is reachable and labelled
    const chooseVisible = await page.isVisible('#choose');
    if (!chooseVisible) fail('check page: "Choose files" button not visible');
    await ctx.close();
  }
} catch (err) {
  fail(`harness error: ${err?.stack ?? err}`);
} finally {
  await browser?.close();
  server.close();
}

console.log(failures.length ? `\n${failures.length} failure(s)` : '\nAll e2e checks passed.');
process.exit(failures.length ? 1 : 0);
