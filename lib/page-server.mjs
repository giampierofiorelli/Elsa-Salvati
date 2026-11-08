// Serves the editable pages (used by netlify/functions/page.mjs, the local preview server and the tests):
// pages made of blocks, plus the hand-written ones (privacy, cookie, booking management) so that every page
// shows the current header and footer.

import { cleanBlocks } from './blocks.mjs';
import { romeYear } from './globals.mjs';
import { stripDraftNotes } from './draft-notes.mjs';

const SECURITY = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

/**
 * Pages and header/footer data to show. which = 'published' (production) or 'draft' (staging, editor preview).
 * Falls back to the copy in the kit (made at build time) when the database has nothing or can't be reached.
 */
export async function loadSiteState({ kit, store, which }) {
  let pages = null;
  let globals = { ...(kit.globals || {}) };
  let fromDb = false;
  if (store) {
    try {
      const rows = await store.allSitePages();
      if (rows.length) {
        pages = rows.map((r) => ({ id: r.id, key: r.key, lang: r.lang, path: r.path, nav: r.nav, noindex: r.noindex, content: r[which] || r.published || r.draft,
          updatedAt: (which === 'published' ? r.published_at : r.draft_updated_at) || r.published_at || r.draft_updated_at || null }));
        fromDb = true;
      }
      if (store.listSiteGlobals) {
        for (const g of await store.listSiteGlobals()) globals[g.scope] = g[which] || g.published || g.draft;
      }
    } catch (err) {
      console.error('[page] database unavailable, serving the build copy:', err.message);
      pages = null;
      globals = { ...(kit.globals || {}) };
      fromDb = false;
    }
  }
  if (!pages) {
    pages = (kit.content || []).map((p) => ({
      id: `seed-${p.key}-${p.lang}`, key: p.key, lang: p.lang, path: p.path, nav: p.nav, noindex: p.noindex,
      content: { title: p.title, description: p.description, seo: p.seo || null, blocks: cleanBlocks(p.blocks, { where: p.path }) },
    }));
  }
  return { pages, globals, fromDb };
}

/** A site assembler that knows every page address (for links and the language switch) and its menu item. */
export function buildSite({ kit, createSite, catalog, globals, pages, demo, siteUrl = '', noindexAll = false }) {
  const site = createSite({ config: kit.config, layouts: kit.layouts, catalog, demo, hashes: kit.hashes, specials: kit.specials, globals, year: romeYear(), siteUrl, noindexAll });
  for (const p of pages) if (!p.noindex) site.register(p.key, p.lang, p.path, p.nav);
  for (const fp of kit.fixedPages || []) if (fp.meta.key && fp.meta.noindex !== 'true') site.register(fp.meta.key, fp.lang, fp.path, fp.meta.nav);
  for (const [key, paths] of Object.entries(kit.staticPages || {})) for (const [lang, p] of Object.entries(paths)) if (!site.pathOf(key, lang)) site.register(key, lang, p);
  for (const [key, langs] of Object.entries(kit.navOf || {})) for (const [lang, nav] of Object.entries(langs)) if (site.pathOf(key, lang)) site.register(key, lang, site.pathOf(key, lang), nav);
  return site;
}

export function demoCatalog(config) {
  const cat = config.demoCatalog;
  const map = new Map();
  for (const c of cat.categories) for (const sv of c.services) for (const p of sv.professionals) if (!map.has(p.id)) map.set(p.id, { ...p });
  return { ...cat, professionals: [...map.values()] };
}

/**
 * deps: { kit, env, store|null, loadCatalog|null, createSite }
 * The path is the original address (Netlify passes it to a function reached through a rewrite); ?p= is a fallback.
 */
export async function pageResponse(req, { kit, env, store, loadCatalog, createSite }) {
  const url = new URL(req.url);
  let path = url.searchParams.get('p') || url.pathname;
  if (!path.endsWith('/') && !/\.[a-z0-9]+$/i.test(path)) path += '/';
  const production = env.CONTEXT === 'production';
  const { pages, globals, fromDb } = await loadSiteState({ kit, store, which: production ? 'published' : 'draft' });

  const siteUrl = String(env.SITE_URL || env.URL || '').replace(/\/$/, '');

  // Sitemap and llms.txt: built from the pages as they are now, so a publish shows up without a new deploy.
  // They carry the cache tag of every page, so publishing any page refreshes them.
  if (path === '/sitemap.xml/' || path === '/llms.txt/' || path === '/sitemap.xml' || path === '/llms.txt') {
    let catalog;
    try { catalog = loadCatalog ? await loadCatalog() : null; } catch { catalog = null; }
    const site = buildSite({ kit, createSite, catalog: catalog || demoCatalog(kit.config), globals, pages, demo: false, siteUrl });
    const list = indexable({ kit, pages });
    const tags = ['pages', 'sitemap', ...pages.filter((p) => !String(p.id).startsWith('seed-')).map((p) => `page-${p.id}`)].join(',');
    const cache = production
      ? { 'cache-control': 'public, max-age=0, must-revalidate', 'netlify-cdn-cache-control': 'public, durable, max-age=31536000, stale-while-revalidate=86400', 'netlify-cache-tag': tags }
      : { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
    const base = siteUrl || url.origin;
    const body = path.startsWith('/sitemap') ? sitemapXml(list, site, base) : llmsTxt(list, kit.config, base);
    const type = path.startsWith('/sitemap') ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8';
    return new Response(body, { status: 200, headers: { 'content-type': type, 'x-content-type-options': 'nosniff', ...cache } });
  }

  const pg = pages.find((p) => p.path === path);
  const fixed = !pg && (kit.fixedPages || []).find((p) => p.path === path);
  if (!pg && !fixed) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY } });

  let catalog;
  try { catalog = loadCatalog ? await loadCatalog() : null; } catch { catalog = null; }
  if (!catalog) catalog = demoCatalog(kit.config);
  // Only production is indexed: previews, branch deploys and staging say noindex (meta and header).
  const site = buildSite({ kit, createSite, catalog, globals, pages, demo: env.SITE_DEMO === 'true', siteUrl, noindexAll: !production });

  let html;
  let headers = {};
  if (pg) {
    html = site.finalize(site.blockPage({ ...pg, ...pg.content }, { notes: !production }));
  } else {
    const meta = { ...fixed.meta, title: site.render(fixed.meta.title || ''), description: site.render(fixed.meta.description || '') };
    html = site.finalize(site.page(meta, fixed.body, fixed.path, { lang: fixed.lang }));
    // The booking management pages carry a personal link in the address: never indexed, never sent as referrer.
    if (meta.noindex === 'true') headers = { 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };
  }
  if (!production && !headers['x-robots-tag']) headers['x-robots-tag'] = 'noindex';
  // Notes written by hand in pages and partials: staging only, like the notes of the block pages.
  if (production) html = stripDraftNotes(html);

  const tag = pg ? `page-${pg.id},pages` : 'pages';
  const cache = production && fromDb
    ? {
      'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': 'public, durable, max-age=31536000, stale-while-revalidate=86400',
      'netlify-cache-tag': tag,
    }
    // Drafts change at every save; the build copy is a stopgap until the database answers again.
    : { 'cache-control': production ? 'public, max-age=0, must-revalidate' : 'no-store', ...(production ? { 'netlify-cdn-cache-control': 'public, max-age=60', 'netlify-cache-tag': tag } : {}) };
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY, ...headers, ...cache } });
}

/** Pages that search engines may index: published block pages and hand-written ones, without noindex. */
export function indexable({ kit, pages }) {
  const out = [];
  for (const p of pages) {
    const c = p.content || {};
    if (p.noindex || (c.seo && c.seo.noindex)) continue;
    out.push({ key: p.key, lang: p.lang, path: p.path, title: c.title || '', description: c.description || '', lastmod: p.updatedAt || kit.builtAt || null });
  }
  for (const fp of kit.fixedPages || []) {
    if (fp.meta.noindex === 'true' || /404/.test(fp.path) || out.some((x) => x.path === fp.path)) continue;
    out.push({ key: fp.meta.key, lang: fp.lang, path: fp.path, title: fp.meta.title || '', description: fp.meta.description || '', lastmod: kit.builtAt || null });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/** sitemap.xml: every indexable page, with its language alternates (both directions, plus x-default) and last change. */
export function sitemapXml(list, site, base) {
  const rows = list.map((u) => {
    const it = site.pathOf(u.key, 'it'); const en = site.pathOf(u.key, 'en');
    const alts = it && en
      ? `<xhtml:link rel="alternate" hreflang="it" href="${xmlEsc(base + it)}"/><xhtml:link rel="alternate" hreflang="en" href="${xmlEsc(base + en)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${xmlEsc(base + en)}"/>`
      : '';
    const lastmod = u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>` : '';
    return `  <url><loc>${xmlEsc(base + u.path)}</loc>${lastmod}${alts}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join('\n')}\n</urlset>\n`;
}

/** llms.txt (proposal at llmstxt.org): a plain summary of the site and its pages, for AI assistants. */
export function llmsTxt(list, config, base) {
  const plain = (s) => String(s || '').replace(/\{\{studioName\}\}/g, config.studioName).replace(/\s+/g, ' ').trim();
  const section = (lang) => list.filter((u) => u.lang === lang).map((u) => `- [${plain(u.title)}](${base + u.path})${u.description ? `: ${plain(u.description)}` : ''}`).join('\n');
  return [`# ${config.studioFullName}`, '',
    `> ${config.studioTagline}: psicologhe iscritte all'Albo, colloqui online in tutta Italia, in italiano e in inglese. Primo colloquio gratuito di 30 minuti. / ${config.studioTaglineEn || 'Psychology and coaching practice'}: psychologists registered in Italy, online sessions in Italian and English.`,
    '', '## Italiano', '', section('it'), '', '## English', '', section('en'), ''].join('\n');
}
