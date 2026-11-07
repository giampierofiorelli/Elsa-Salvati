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
        pages = rows.map((r) => ({ id: r.id, key: r.key, lang: r.lang, path: r.path, nav: r.nav, noindex: r.noindex, content: r[which] || r.published || r.draft }));
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
export function buildSite({ kit, createSite, catalog, globals, pages, demo, siteUrl = '' }) {
  const site = createSite({ config: kit.config, layouts: kit.layouts, catalog, demo, hashes: kit.hashes, specials: kit.specials, globals, year: romeYear(), siteUrl });
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

  const pg = pages.find((p) => p.path === path);
  const fixed = !pg && (kit.fixedPages || []).find((p) => p.path === path);
  if (!pg && !fixed) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY } });

  let catalog;
  try { catalog = loadCatalog ? await loadCatalog() : null; } catch { catalog = null; }
  if (!catalog) catalog = demoCatalog(kit.config);
  const site = buildSite({ kit, createSite, catalog, globals, pages, demo: env.SITE_DEMO === 'true', siteUrl: env.SITE_URL || '' });

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
