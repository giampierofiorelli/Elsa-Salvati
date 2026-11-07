// Serves one editable page (used by netlify/functions/page.mjs and by the tests).

import { cleanBlocks } from './blocks.mjs';

const SECURITY = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

/**
 * deps: { kit, env, store|null, loadCatalog|null, createSite }
 * The page path comes from ?p= (set by the rewrite rules the build writes in dist/_redirects).
 */
export async function pageResponse(req, { kit, env, store, loadCatalog, createSite }) {
  const path = new URL(req.url).searchParams.get('p') || '';
  const production = env.CONTEXT === 'production';
  const which = production ? 'published' : 'draft';
  let pages = null;
  let fromDb = false;
  if (store) {
    try {
      pages = (await store.allSitePages()).map((r) => ({ id: r.id, key: r.key, lang: r.lang, path: r.path, nav: r.nav, noindex: r.noindex, content: r[which] || r.published || r.draft }));
      fromDb = pages.length > 0;
    } catch (err) {
      console.error('[page] database unavailable, serving the build copy:', err.message);
      pages = null;
    }
  }
  if (!fromDb) {
    pages = (kit.content || []).map((p) => ({ id: `seed-${p.key}-${p.lang}`, key: p.key, lang: p.lang, path: p.path, nav: p.nav, noindex: p.noindex, content: { title: p.title, description: p.description, blocks: cleanBlocks(p.blocks, { where: p.path }) } }));
  }
  const pg = pages.find((p) => p.path === path);
  if (!pg) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY } });

  let catalog;
  try { catalog = loadCatalog ? await loadCatalog() : null; } catch { catalog = null; }
  if (!catalog) catalog = demoCatalog(kit.config);
  const site = createSite({ config: kit.config, layouts: kit.layouts, catalog, demo: env.SITE_DEMO === 'true', hashes: kit.hashes, specials: kit.specials });
  for (const p of pages) if (!p.noindex) site.register(p.key, p.lang, p.path);
  for (const [key, paths] of Object.entries(kit.staticPages || {})) for (const [lang, p] of Object.entries(paths)) if (!site.pathOf(key, lang)) site.register(key, lang, p);
  const html = site.finalize(site.blockPage({ ...pg, ...pg.content }, { notes: !production }));

  const cache = production && fromDb
    ? {
      'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': 'public, durable, max-age=31536000, stale-while-revalidate=86400',
      'netlify-cache-tag': `page-${pg.id},pages`,
    }
    // Drafts change at every save; the build copy is a stopgap until the database answers again.
    : { 'cache-control': production ? 'public, max-age=0, must-revalidate' : 'no-store', ...(production ? { 'netlify-cdn-cache-control': 'public, max-age=60' } : {}) };
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY, ...cache } });
}

function demoCatalog(config) {
  const cat = config.demoCatalog;
  const map = new Map();
  for (const c of cat.categories) for (const sv of c.services) for (const p of sv.professionals) if (!map.has(p.id)) map.set(p.id, { ...p });
  return { ...cat, professionals: [...map.values()] };
}
