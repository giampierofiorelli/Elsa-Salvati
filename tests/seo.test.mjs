// Search engines and AI readability: robots per context, noindex never in production, canonical and hreflang
// consistent in both directions, structured data valid and without placeholders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { robotsTxt, PRIVATE_PATHS } from '../lib/robots.mjs';

const SITE = 'https://www.example.it';
function build(context) {
  const dir = mkdtempSync(join(tmpdir(), 'seo-'));
  const env = { ...process.env, CONTEXT: context, BUILD_OUT: dir, SITE_URL: SITE };
  delete env.DATABASE_URL; delete env.SITE_DEMO;
  execFileSync(process.execPath, ['scripts/build.mjs'], { env, stdio: 'pipe' });
  return dir;
}
function pages(dir) {
  const out = [];
  (function walk(d) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (f !== 'admin' && f !== 'assets') walk(p); } else if (f === 'index.html') out.push({ path: p.slice(dir.length).replace(/index\.html$/, ''), html: readFileSync(p, 'utf8') });
    }
  })(dir);
  return out;
}

test('robots.txt: production lets everything public be crawled; anything else blocks all', () => {
  const prod = robotsTxt({ production: true, base: SITE });
  for (const p of PRIVATE_PATHS) assert.match(prod, new RegExp(`^Disallow: ${p.replace(/[.]/g, '\\.')}$`, 'm'));
  assert.doesNotMatch(prod, /^Disallow: \/$/m, 'public pages stay crawlable');
  assert.match(prod, /^Sitemap: https:\/\/www\.example\.it\/sitemap\.xml$/m);
  assert.equal(robotsTxt({ production: false }), 'User-agent: *\nDisallow: /\n');
});

test('production build: indexable, absolute canonical, hreflang both ways, valid JSON-LD without placeholders', () => {
  const dir = build('production');
  try {
    assert.ok(!existsSync(join(dir, '_headers')), 'no noindex header in production');
    assert.match(readFileSync(join(dir, 'robots.txt'), 'utf8'), /^Disallow: \/admin\/$/m);
    const list = pages(dir);
    const byUrl = new Map(list.map((p) => [SITE + p.path, p]));
    let checked = 0;
    for (const p of list) {
      const noindex = /<meta name="robots" content="noindex/.test(p.html);
      if (/gestisci|manage/.test(p.path)) { assert.ok(noindex, `${p.path} is private`); continue; }
      assert.ok(!noindex, `${p.path} is indexable in production`);
      assert.match(p.html, new RegExp(`<link rel="canonical" href="${SITE.replace(/[.]/g, '\\.')}${p.path}">`), `${p.path} canonical`);
      const alts = Object.fromEntries([...p.html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]));
      if (Object.keys(alts).length) {
        assert.deepEqual(Object.keys(alts).sort(), ['en', 'it', 'x-default'], p.path);
        assert.ok(Object.values(alts).every((u) => u.startsWith(SITE)), `${p.path}: absolute alternates`);
        for (const l of ['it', 'en']) {
          const other = byUrl.get(alts[l]);
          if (!other) continue; // served only by the page function
          const back = Object.fromEntries([...other.html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]));
          assert.deepEqual(back, alts, `${alts[l]} points back to ${p.path}`);
        }
      }
      const ld = p.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      assert.ok(ld, `${p.path} has structured data`);
      const data = JSON.parse(ld[1]);
      assert.equal(data['@context'], 'https://schema.org');
      assert.ok(data['@graph'].some((x) => x['@type'] === 'Organization'));
      assert.doesNotMatch(ld[1], /\[(P\.IVA|email|dominio|telefono|n\. Albo|Via)[^\]]*\]/, `${p.path}: no placeholders`);
      assert.match(p.html, /<meta property="og:title" content="[^"]+">/);
      assert.match(p.html, /<meta name="twitter:card" content="summary(_large_image)?">/);
      checked += 1;
    }
    assert.ok(checked >= 20, `checked ${checked} pages`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('branch deploy (staging) and previews: never indexable', () => {
  const dir = build('branch-deploy');
  try {
    assert.equal(readFileSync(join(dir, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
    assert.match(readFileSync(join(dir, '_headers'), 'utf8'), /X-Robots-Tag: noindex/);
    for (const p of pages(dir)) assert.match(p.html, /<meta name="robots" content="noindex, nofollow">/, p.path);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
