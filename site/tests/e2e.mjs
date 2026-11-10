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
 *  - drops a project .zip (built here from packages/cli/test/fixtures/project)
 *    and a folder, and checks the main file and .bib are found, a choice is
 *    offered when the main file is ambiguous, and bad zips are explained;
 *  - writes screenshots to test-screenshots/ (git-ignored).
 *
 * Env: SITE_BASE (default /overfull), PORT (default 4391), E2E_FULL_AXE=1 to
 * scan every rule page in every variant (default: the main pages only).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
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

// A minimal ZIP writer (deflate), so the tests need no binary fixture.
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function makeZip(entries, flags = 0) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const raw = Buffer.from(data);
    const body = deflateRawSync(raw);
    const nm = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nm.length, 26);
    parts.push(local, nm, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(flags, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(raw), 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(nm.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nm);
    offset += 30 + nm.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}
const projectDir = join(here, '..', '..', 'packages', 'cli', 'test', 'fixtures', 'project');
const projectFiles = () =>
  readdirSync(projectDir)
    .filter((f) => statSync(join(projectDir, f)).isFile())
    .map((f) => [`my-paper/${f}`, readFileSync(join(projectDir, f))]);

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

    // A project .zip (Overleaf "Download source"): offline, so assert on what
    // needs no network: detection of the files, and that the report renders.
    const waitDone = () =>
      page.waitForFunction(
        () => /Done\./.test(document.querySelector('#progress')?.textContent ?? ''),
        null,
        {
          timeout: 20000,
        },
      );
    await page.evaluate(() => {
      document.querySelector('#progress').textContent = '';
    });
    await page.setInputFiles('#file-input', {
      name: 'my-paper.zip',
      mimeType: 'application/zip',
      buffer: makeZip([
        ...projectFiles(),
        ['my-paper/__MACOSX/._main.tex', 'junk'],
        ['my-paper/.git/config', 'junk'],
        ['my-paper/../escape.tex', 'bad'],
      ]),
    });
    await waitDone();
    const zipNotice = (await page.textContent('#notice')) ?? '';
    if (!/main file main\.tex/.test(zipNotice) || !/1 \.bib file/.test(zipNotice))
      fail(`check page zip: main file or .bib not reported: ${zipNotice}`);
    const listed = (await page.$$eval('#files .name', (n) => n.map((x) => x.textContent))).sort();
    for (const want of ['main.tex', 'references.bib', 'thesis.log', 'thesis.pdf', 'thesis.aux'])
      if (!listed.includes(want)) fail(`check page zip: ${want} not listed (got ${listed})`);
    if (listed.some((n) => /escape|MACOSX|\.git/.test(n ?? '')))
      fail(`check page zip: unsafe or hidden file listed: ${listed}`);
    const zipChecks = await page.$$eval('#sheet-view .sheet-check', (c) => c.length);
    if (zipChecks !== 5) fail(`check page zip: expected 5 checks, got ${zipChecks}`);
    const zipTarget = (await page.textContent('#sheet-view .sheet-target')) ?? '';
    if (!/my-paper\.zip/.test(zipTarget) || !/main\.tex/.test(zipTarget))
      fail(`check page zip: report target is ${zipTarget}`);
    const zipRefs =
      (await page.textContent('#sheet-view section[aria-labelledby="sheet-references"]')) ?? '';
    if (!/ghost2020/.test(zipRefs)) fail('check page zip: missing citation ghost2020 not reported');
    await page.screenshot({
      path: join(shots, `check-zip-${v.width}-${v.scheme}.png`),
      fullPage: true,
    });

    // A file dropped after the zip joins the project
    await page.evaluate(() => {
      document.querySelector('#progress').textContent = '';
    });
    await page.setInputFiles('#file-input', {
      name: 'thesis.pdf',
      mimeType: 'application/pdf',
      buffer: readFileSync(join(projectDir, 'thesis.pdf')),
    });
    await waitDone();
    if (!/my-paper\.zip/.test((await page.textContent('#sheet-view .sheet-target')) ?? ''))
      fail('check page zip: a file added after the zip left the project');

    // The same project as a folder (input with webkitdirectory)
    if (await page.evaluate(() => 'webkitdirectory' in document.querySelector('#folder-input'))) {
      if (!(await page.isVisible('#choose-folder')))
        fail('check page: "Choose a folder" button not visible');
      await page.evaluate(() => {
        document.querySelector('#progress').textContent = '';
      });
      await page.setInputFiles('#folder-input', projectDir);
      await waitDone();
      const folderNotice = (await page.textContent('#notice')) ?? '';
      if (!/main file main\.tex/.test(folderNotice) || !/1 \.bib file/.test(folderNotice))
        fail(`check page folder: main file or .bib not reported: ${folderNotice}`);
    }

    // Several candidate main files: the page asks, and runs after the choice
    await page.evaluate(() => {
      document.querySelector('#progress').textContent = '';
    });
    await page.setInputFiles('#file-input', {
      name: 'two-mains.zip',
      mimeType: 'application/zip',
      buffer: makeZip([
        ['a.tex', '\\documentclass{article}\\begin{document}A\\end{document}'],
        ['b.tex', '\\documentclass{article}\\begin{document}B\\end{document}'],
      ]),
    });
    await page.waitForSelector('#main-pick:not([hidden])', { timeout: 10000 });
    const options = await page.$$eval('#main-select option', (o) => o.map((x) => x.value));
    if (options.join() !== ',a.tex,b.tex')
      fail(`check page zip: main file choices are ${options.join('|')}`);
    await page.selectOption('#main-select', 'b.tex');
    await waitDone();
    const chosenTarget = (await page.textContent('#sheet-view .sheet-target')) ?? '';
    if (!/main file: b\.tex/.test(chosenTarget))
      fail(`check page zip: chosen main file not used: ${chosenTarget}`);

    // Encrypted and non-zip archives are explained
    await page.setInputFiles('#file-input', {
      name: 'locked.zip',
      mimeType: 'application/zip',
      buffer: makeZip([['main.tex', 'x']], 1),
    });
    await page.waitForFunction(
      () => /password-protected/.test(document.querySelector('#notice')?.textContent ?? ''),
      null,
      { timeout: 10000 },
    );
    await page.setInputFiles('#file-input', {
      name: 'broken.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('this is not a zip file at all'),
    });
    await page.waitForFunction(
      () => /not a readable \.zip/.test(document.querySelector('#notice')?.textContent ?? ''),
      null,
      { timeout: 10000 },
    );
    const axeZip = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    for (const x of axeZip.violations.filter(
      (x) => x.impact === 'serious' || x.impact === 'critical',
    ))
      fail(`check page zip (${v.width}-${v.scheme}): axe ${x.impact} ${x.id}`);
    if (external.length)
      fail(`check page zip made external requests: ${external.slice(0, 3).join(', ')}`);
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
