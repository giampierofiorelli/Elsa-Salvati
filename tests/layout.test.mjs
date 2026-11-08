// Every public page fits the phone screen: no horizontal scroll at 320, 375 and 390 px (WCAG 1.4.10 reflow).
// Builds the site into a temporary folder, serves it locally and opens each page in Chromium (Playwright).
// Skipped where Playwright and its browser are not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

let chromium = null;
for (const from of [import.meta.url, '/opt/node-tools/package.json']) {
  try { ({ chromium } = createRequire(from)('playwright')); break; } catch { /* not here */ }
}

const PAGES = ['/', '/accessibilita/', '/aziende/', '/coaching/', '/contatti/', '/cookie/', '/differenze/', '/orientamento-carriera/', '/prenota/', '/prenota/gestisci/',
  '/privacy/', '/psicoterapia/', '/servizi/', '/sostegno-psicologico/', '/tariffe-e-prenotazioni/', '/team/', '/404.html',
  '/en/', '/en/accessibility/', '/en/book/', '/en/book/manage/', '/en/career-guidance/', '/en/contact/', '/en/cookies/', '/en/differences/', '/en/fees/',
  '/en/how-we-can-help/', '/en/organisations/', '/en/privacy/', '/en/psychological-support/', '/en/psychotherapy/', '/en/team/',
  '/en/workplace-coaching/', '/en/404.html'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };

test('no horizontal scroll on any public page at 320, 375 and 390 px', { skip: !chromium && 'Playwright not installed', timeout: 300000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'layout-'));
  const env = { ...process.env, CONTEXT: 'production', BUILD_OUT: dir };
  delete env.DATABASE_URL;
  execFileSync(process.execPath, ['scripts/build.mjs'], { env, stdio: 'pipe' });
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(dir, p);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
    const wide = [];
    for (const width of [320, 375, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      for (const path of PAGES) {
        const page = await ctx.newPage();
        await page.goto(base + path, { waitUntil: 'load' });
        await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (over > 0) wide.push(`${path} at ${width}px: ${over}px too wide`);
        await page.close();
      }
      await ctx.close();
    }
    assert.deepEqual(wide, [], wide.join('\n'));
  } finally {
    if (browser) await browser.close();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
