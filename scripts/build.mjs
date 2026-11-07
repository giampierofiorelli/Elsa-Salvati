// Static site build: pages in src/pages (with a small front matter) are wrapped
// in the shared layout and filled with data from src/site.config.json.
// Output: dist/. No framework, no runtime JavaScript besides the booking/admin apps.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createSite, LANGS, isPlaceholder } from '../lib/site.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const out = join(root, 'dist');
const config = JSON.parse(readFileSync(join(src, 'site.config.json'), 'utf8'));
// Preview mode (SITE_DEMO=true): visible banner, not indexed by search engines.
const demo = process.env.SITE_DEMO === 'true';

// Services and professionals come from the database (managed in /admin/).
// Without DATABASE_URL (local build) the demo catalogue in the config is used.
async function readCatalog() {
  if (!process.env.DATABASE_URL) return { source: 'demo', ...config.demoCatalog, professionals: proList(config.demoCatalog) };
  const { createSql, createStore } = await import('../lib/db.mjs');
  const { loadCatalog } = await import('../lib/public-api.mjs');
  const sql = createSql();
  try {
    // A stuck connection must not hang the build: give up after 30 s.
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout dopo 30 s')), 30000).unref());
    return { source: 'database', ...(await Promise.race([loadCatalog(createStore(sql)), timeout])) };
  } catch (err) {
    // Keep the site online with the demo catalogue; the cause is in the build log.
    console.error(`Catalogo dal database non disponibile: ${err.code || ''} ${err.message}`);
    return { source: 'demo (database non raggiungibile)', ...config.demoCatalog, professionals: proList(config.demoCatalog) };
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}
function proList(cat) {
  const map = new Map();
  for (const c of cat.categories) for (const sv of c.services) for (const p of sv.professionals) {
    if (!map.has(p.id)) map.set(p.id, { ...p, services: [] });
    map.get(p.id).services.push({ id: sv.id, name: sv.name, category: sv.category, slug: sv.slug });
  }
  return [...map.values()];
}
const catalog = await readCatalog();
const layouts = Object.fromEntries(LANGS.map((l) => [l, readFileSync(join(src, `partials/layout.${l}.html`), 'utf8')]));
// Fixed templates of the special blocks (booking, forms, contacts): src/partials/special/<type>.<lang>[.<variant>].html
const specialDir = join(src, 'partials/special');
const specials = statSync(specialDir, { throwIfNoEntry: false })
  ? Object.fromEntries(readdirSync(specialDir).filter((f) => f.endsWith('.html')).map((f) => [f.replace(/\.html$/, ''), readFileSync(join(specialDir, f), 'utf8')]))
  : {};
// Header, footer and studio details: the starting values (the editor keeps its own copy in the database).
const globals = JSON.parse(readFileSync(join(root, 'content', 'globals.json'), 'utf8'));
const site = createSite({ config, layouts, catalog, demo, specials, globals });
const { render, page, register, equivalents, base } = site;

function parsePage(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('front matter mancante');
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2] };
}

function write(path, html) {
  const file = /\.(html|xml|txt)$/.test(path) ? join(out, path) : join(out, path, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// ---------- build ----------

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, 'assets'), join(out, 'assets'), { recursive: true });

// Pass 1: read every page of both sites and register equivalents.
// Pages made of blocks (content/pages/<lang>/*.json, the editor's starting content) replace the
// hand-written page with the same path.
const pages = [];
const contentDir = join(root, 'content', 'pages');
const blockPaths = new Set();
for (const lang of LANGS) {
  const dir = join(contentDir, lang);
  if (!statSync(dir, { throwIfNoEntry: false })) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const pg = { ...JSON.parse(readFileSync(join(dir, file), 'utf8')), lang };
    pages.push({ lang, blockPage: pg, path: pg.path, meta: { key: pg.key, noindex: pg.noindex ? 'true' : undefined } });
    blockPaths.add(pg.path);
    if (!pg.noindex) register(pg.key, lang, pg.path, pg.nav);
  }
}
for (const lang of LANGS) {
  const dir = join(src, 'pages', lang);
  for (const file of walk(dir).filter((f) => f.endsWith('.html'))) {
    const { meta, body } = parsePage(readFileSync(file, 'utf8'));
    meta.key = meta.key || file.slice(dir.length + 1).replace(/\.html$/, '');
    if (blockPaths.has(meta.path)) continue;
    pages.push({ lang, meta, body, path: meta.path });
    if (meta.path !== '/404' && meta.path !== '/en/404') register(meta.key, lang, meta.path, meta.nav);
  }
}

// Pass 2: render.
const urls = []; // { path, key, noindex }
for (const pg of pages) {
  const { lang, meta, body, path } = pg;
  if (pg.blockPage) {
    // Internal notes show on previews and staging, never in production.
    write(path, site.blockPage(pg.blockPage, { notes: process.env.CONTEXT !== 'production' }));
    if (!pg.blockPage.noindex) urls.push({ path, key: meta.key });
    continue;
  }
  const html = page({ ...meta, title: render(meta.title), description: render(meta.description || '') }, body, path, { lang });
  write(path === '/404' ? '404.html' : path === '/en/404' ? 'en/404.html' : path, html);
  if (meta.noindex !== 'true' && path !== '/404' && path !== '/en/404') urls.push({ path, key: meta.key });
}

// Admin app: standalone page, not indexed.
cpSync(join(src, 'admin'), join(out, 'admin'), { recursive: true });

// Logo icon chosen in the settings (site.config.json "logo"): every page and
// script points to that icon's files. Each icon has its own path, so a change
// of logo is never hidden by the browser cache.
const logo = config.logo || 'classico';
if (!statSync(join(out, 'assets/img/logos', logo), { throwIfNoEntry: false })) throw new Error(`Logo "${logo}" non trovato in src/assets/img/logos/`);
for (const file of walk(out).filter((f) => /\.(html|js)$/.test(f) && !f.includes('/vendor/'))) {
  const text = readFileSync(file, 'utf8');
  const next = text.replaceAll('/assets/img/logo-icon-light.webp', `/assets/img/logos/${logo}/icon-light.webp`)
    .replaceAll('/assets/img/logo-icon.webp', `/assets/img/logos/${logo}/icon.webp`);
  if (next !== text) writeFileSync(file, next);
}

// Cache busting: assets are cached for a week, so every CSS/JS reference gets
// ?v=<content hash>. A changed file gets a new URL and phones fetch it at once.
const versioned = ['/assets/css/style.css', '/assets/js/site.js', '/assets/js/booking.js', '/assets/js/motion.js', '/assets/js/effects.js', '/admin/admin.css', '/admin/admin.js', '/admin/vendor/qrcode.js'];
const hashes = Object.fromEntries(versioned.map((u) => [u, createHash('sha256').update(readFileSync(join(out, u))).digest('hex').slice(0, 10)]));
for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
  let html = readFileSync(file, 'utf8');
  for (const [u, h] of Object.entries(hashes)) html = html.replaceAll(`"${u}"`, `"${u}?v=${h}"`);
  writeFileSync(file, html);
}

// Kit for the page function: layouts, special-block templates, starting content, asset versions and
// the addresses of the pages that stay hand-written (privacy, cookie…), so links to them resolve.
{
  const staticPages = {};
  for (const pg of pages) if (!pg.blockPage && pg.meta.key) (staticPages[pg.meta.key] ||= {})[pg.lang] = pg.path;
  // Hand-written pages (privacy, cookie, booking management) are served by the function too, so their header
  // and footer follow the editor; only the 404 page stays static.
  const fixedPages = pages.filter((pg) => !pg.blockPage && !/404$/.test(pg.path)).map((pg) => ({ lang: pg.lang, path: pg.path, meta: pg.meta, body: pg.body }));
  const navOf = {};
  for (const pg of pages) if (pg.meta.key && (pg.meta.nav || (pg.blockPage && pg.blockPage.nav))) (navOf[pg.meta.key] ||= {})[pg.lang] = pg.meta.nav || pg.blockPage.nav;
  const kit = { config, layouts, specials, hashes, staticPages, fixedPages, navOf, globals, content: pages.filter((pg) => pg.blockPage).map((pg) => pg.blockPage) };
  mkdirSync(join(root, 'lib', 'generated'), { recursive: true });
  writeFileSync(join(root, 'lib', 'generated', 'site-kit.json'), JSON.stringify(kit));
}

write('robots.txt', demo ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /admin/\nDisallow: /prenota/gestisci/\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ''}`);
if (base) {
  const entry = (u) => {
    const eq = equivalents.get(u.key) || {};
    const alts = eq.it && eq.en
      ? LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${base}${eq[l]}"/>`).join('') + `<xhtml:link rel="alternate" hreflang="x-default" href="${base}${eq.en}"/>`
      : '';
    return `  <url><loc>${base}${u.path}</loc>${alts}</url>`;
  };
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.sort((a, b) => a.path.localeCompare(b.path)).map(entry).join('\n')}\n</urlset>\n`);
}

// Report placeholders still to fill.
const pending = [];
(function scan(o, prefix) {
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith('_')) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') scan(v, key);
    else if (isPlaceholder(v)) pending.push(key);
  }
})(config, '');
console.log(`Sito generato in dist/ (${urls.length} pagine indicizzabili: ${urls.filter((u) => u.path.startsWith('/en/')).length} in inglese; catalogo: ${catalog.source}).`);
if (pending.length) {
  console.log(`Attenzione: ${pending.length} dati segnaposto da completare in src/site.config.json:\n  ${pending.join('\n  ')}`);
}
