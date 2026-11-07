// Checks that every visible button and secondary link (.row-links a, .link-arrow)
// on the public pages is full width on a phone.
// Usage: serve dist (e.g. `cd dist && python3 -m http.server 8890`), then
//   NODE_PATH=$(npm root -g) node scripts/check-buttons.mjs http://localhost:8890
// Exits with code 1 if a button is narrower than the space it sits in.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const base = process.argv[2] || 'http://localhost:8890';
const pages = ['/', '/servizi/', '/lavoro/', '/aziende/', '/team/', '/costi-e-faq/', '/primo-colloquio/', '/contatti/', '/prenota/',
  '/en/', '/en/how-we-can-help/', '/en/career-guidance/', '/en/contact/', '/en/book/'];

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
const page = await ctx.newPage();
let failed = 0;
for (const path of pages) {
  const res = await page.goto(base + path);
  if (!res || res.status() >= 400) { console.log(path, 'skipped (' + (res && res.status()) + ')'); continue; }
  await page.waitForTimeout(500);
  const narrow = await page.evaluate(() => [...document.querySelectorAll('main .btn, main .row-links a, main .link-arrow')]
    .filter((el) => el.offsetParent && !el.closest('[hidden]'))
    .map((el) => {
      const parent = el.parentElement, cs = getComputedStyle(parent);
      const room = parent.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { text: el.textContent.trim().slice(0, 40), width: Math.round(el.getBoundingClientRect().width), room: Math.round(room) };
    })
    .filter((b) => b.width < b.room - 2));
  if (narrow.length) { failed += narrow.length; console.log(path, 'NOT full width:', JSON.stringify(narrow)); }
  else console.log(path, 'ok');
}
await browser.close();
process.exit(failed ? 1 : 0);
