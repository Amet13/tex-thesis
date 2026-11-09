#!/usr/bin/env node
/**
 * Renders site/scripts/og.html to site/public/og.png (1200×630), the social
 * card for every page. Run after changing the card:
 *   node site/scripts/og.mjs
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(join(here, 'og.html')).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(here, '..', 'public', 'og.png') });
  console.log('wrote site/public/og.png');
} finally {
  await browser.close();
}
