// Page editor API (inside /api/admin): list pages, edit drafts, preview, publish, history, images.
// Access: administrators and accounts with "can edit the site". This permission gives no access
// to the people's data (bookings, requests).

import { createHash } from 'node:crypto';
import { BLOCKS, cleanBlocks, cleanImageValue } from './blocks.mjs';
import { GLOBALS_SCHEMA, cleanGlobals, romeYear } from './globals.mjs';
import { buildSite } from './page-server.mjs';
import { createSite } from './site.mjs';
import { HttpError, json, readJson, cleanText } from './http.mjs';

const ID_RE = /^\d{1,12}$/;
const MAX_IMAGE_BYTES = 1_500_000;

/** The block library without the render functions, for the editor's forms. */
export function libraryForEditor() {
  return Object.entries(BLOCKS).map(([type, d]) => ({
    type, label: d.label, help: d.help, fixed: !!d.fixed, once: !!d.once, special: !!d.special,
    numbered: !!d.numbered, bg: d.bg, fields: d.fields,
  }));
}

// ---------- image checks: real file type and size, read from the bytes ----------

function imageInfo(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    // JPEG: walk the segments until a "start of frame" gives the size.
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { mime: 'image/webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { mime: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { mime: 'image/webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

function decodeImage(b64, variant) {
  if (typeof b64 !== 'string' || b64.length > MAX_IMAGE_BYTES * 1.4) throw new HttpError(413, 'too_large', 'Immagine troppo grande');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'too_large', 'Immagine troppo grande (massimo 1,5 MB per formato)');
  const info = imageInfo(buf);
  const wantMime = variant.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
  const wantWidth = Number(variant.split('.')[0]);
  if (!info || info.mime !== wantMime) throw new HttpError(400, 'invalid', 'Formato dell\'immagine non valido');
  if (info.width > wantWidth || info.width < 100 || info.height < 100 || info.height > 4000) throw new HttpError(400, 'invalid', 'Dimensioni dell\'immagine non valide');
  return { variant, mime: info.mime, width: info.width, height: info.height, bytes: buf };
}

// ---------- cache purge after publishing (no new deploy, no credits) ----------

export async function purgePages(tags, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const token = env.NETLIFY_PURGE_API_TOKEN;
  const siteId = (globalThis.Netlify && globalThis.Netlify.context && globalThis.Netlify.context.site && globalThis.Netlify.context.site.id) || env.SITE_ID;
  if (!token || !siteId) return { skipped: true };
  const res = await fetchImpl('https://api.netlify.com/api/v1/purge', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf8', authorization: `Bearer ${token}` },
    body: JSON.stringify({ site_id: siteId, cache_tags: tags }),
  });
  if (!res.ok) throw new Error(`purge ${res.status}`);
  return { ok: true };
}

/**
 * kit: { content: [seed pages], layouts, specials, config, hashes, loadCatalog() }
 * auth: { requireSession, requireAdmin } from the admin API.
 */
export function createSiteRoutes({ store, kit, auth, now = () => new Date(), purge = purgePages }) {
  async function requireEditor(req) {
    const s = await auth.requireSession(req);
    if (!s.isAdmin && !s.user.can_edit_site) throw new HttpError(403, 'forbidden', 'Non hai il permesso di modificare il sito');
    return s;
  }

  // The pages of the editor start from the files in content/pages: missing ones are added once.
  let seeded = false;
  async function ensureSeeded() {
    if (seeded) return;
    for (const pg of kit.content || []) await store.seedSitePage({ ...pg, blocks: cleanBlocks(pg.blocks, { where: pg.path }) });
    seeded = true;
  }

  // Header/footer data start from the files once, like the pages.
  let globalsSeeded = false;
  async function ensureGlobalsSeeded() {
    if (globalsSeeded) return;
    for (const scope of ['it', 'en', 'studio']) if (kit.globals && kit.globals[scope]) await store.seedSiteGlobals(scope, cleanGlobals(scope, kit.globals[scope]));
    globalsSeeded = true;
  }

  // The preview shows drafts everywhere (pages, header, footer), with internal notes.
  async function siteFor(pages, override = {}) {
    await ensureGlobalsSeeded();
    const catalog = await kit.loadCatalog();
    const globals = { ...(kit.globals || {}) };
    for (const g of await store.listSiteGlobals()) globals[g.scope] = g.draft;
    Object.assign(globals, override);
    return buildSite({ kit, createSite, catalog, globals, pages, demo: true });
  }

  function linkTargetsFrom(all) {
    const targets = new Map();
    for (const p of all) {
      if (!targets.has(p.key)) targets.set(p.key, { key: p.key, it: null, en: null, itPath: null, enPath: null });
      const t = targets.get(p.key); t[p.lang] = p.title; t[`${p.lang}Path`] = p.path;
    }
    for (const fp of kit.fixedPages || []) {
      if (fp.meta.noindex === 'true') continue;
      if (!targets.has(fp.meta.key)) targets.set(fp.meta.key, { key: fp.meta.key, it: null, en: null, itPath: null, enPath: null });
      const t = targets.get(fp.meta.key); t[fp.lang] = String(fp.meta.title || '').replace(/\s*[–-]\s*\{\{[^}]+\}\}.*$/, ''); t[`${fp.lang}Path`] = fp.path;
    }
    return [...targets.values()];
  }

  function parseId(v) {
    if (!ID_RE.test(String(v))) throw new HttpError(404, 'not_found', 'Pagina non trovata');
    return String(v);
  }

  async function pageOr404(pageId) {
    const page = await store.getSitePage(parseId(pageId));
    if (!page) throw new HttpError(404, 'not_found', 'Pagina non trovata');
    return page;
  }

  // The editor shows the exact problem ("Blocco 3 (Passi numerati) – Titolo: campo obbligatorio").
  function cleanContent(body) {
    try {
      return {
        title: cleanText(body.title, { field: 'Titolo per Google', min: 3, max: 120, required: true }),
        description: cleanText(body.description, { field: 'Descrizione per Google', max: 300 }),
        seo: {
          image: cleanImageValue(body.seo && body.seo.image, 'Immagine per la condivisione'),
          noindex: !!(body.seo && body.seo.noindex === true),
        },
        blocks: cleanBlocks(body.blocks),
      };
    } catch (err) {
      if (err instanceof RangeError) throw new HttpError(400, 'invalid', err.message);
      throw err;
    }
  }

  return [
    ['GET', /^\/site\/pages$/, async (req) => {
      await requireEditor(req);
      await ensureSeeded();
      const pages = await store.listSitePages();
      return json(200, {
        pages: pages.map((p) => ({
          id: p.id, key: p.key, lang: p.lang, path: p.path, title: p.title,
          draftUpdatedAt: p.draft_updated_at, publishedAt: p.published_at, hasChanges: p.has_changes,
        })),
      });
    }],

    ['GET', /^\/site\/pages\/(\d+)$/, async (req, _c, [pageId]) => {
      await requireEditor(req);
      await ensureSeeded();
      const page = await pageOr404(pageId);
      const all = await store.listSitePages();
      const pros = (await store.listProfessionals({ onlyActive: true })).map((p) => ({ slug: p.slug, name: p.name }));
      return json(200, {
        page: {
          id: page.id, key: page.key, lang: page.lang, path: page.path,
          draft: page.draft, published: page.published,
          draftUpdatedAt: page.draft_updated_at, draftUpdatedBy: page.draft_updated_by_name,
          publishedAt: page.published_at, publishedBy: page.published_by_name,
          hasChanges: JSON.stringify(page.draft) !== JSON.stringify(page.published),
        },
        // Pages to link to: chosen by key, the engine puts the path of the right language.
        linkTargets: linkTargetsFrom(all),
        professionals: pros,
        library: libraryForEditor(),
      });
    }],

    ['PUT', /^\/site\/pages\/(\d+)$/, async (req, _c, [pageId]) => {
      const s = await requireEditor(req);
      const page = await pageOr404(pageId);
      const body = await readJson(req, 400_000);
      const content = cleanContent(body);
      const saved = await store.saveSiteDraft(page.id, content, s.user.id, body.expected || null);
      if (!saved) throw new HttpError(409, 'conflict', 'Nel frattempo questa pagina è stata modificata da un\'altra persona. Ricarica la pagina per vedere la versione aggiornata.');
      return json(200, { ok: true, draftUpdatedAt: saved, draft: content });
    }],

    // Preview of what is on screen (also unsaved), with internal notes, shown inside the editor.
    ['POST', /^\/site\/preview$/, async (req) => {
      await requireEditor(req);
      const body = await readJson(req, 400_000);
      const page = await pageOr404(body.pageId);
      const content = cleanContent(body);
      const all = await store.listSitePages();
      // Unsaved header/footer or studio details can be previewed too.
      const override = {};
      try {
        if (body.globals) override[page.lang] = cleanGlobals(page.lang, body.globals);
        if (body.studio) override.studio = cleanGlobals('studio', body.studio);
      } catch (err) { if (err instanceof RangeError) throw new HttpError(400, 'invalid', err.message); throw err; }
      const site = await siteFor(all.map((p) => (p.id === page.id ? { ...p, nav: page.nav } : p)), override);
      const html = site.finalize(site.blockPage({ ...page, ...content, lang: page.lang }, { notes: true, editor: true }));
      return json(200, { html });
    }],

    ['POST', /^\/site\/pages\/(\d+)\/publish$/, async (req, _c, [pageId]) => {
      const s = await requireEditor(req);
      const page = await pageOr404(pageId);
      const done = await store.publishSitePage(page.id, s.user.id);
      await store.audit(s.user.id, 'pagina pubblicata', `${done.path}`);
      let purged = true;
      try { await purge([`page-${page.id}`]); } catch (err) { purged = false; console.error('[site] purge failed', err && err.message); }
      return json(200, { ok: true, publishedAt: now().toISOString(), purged });
    }],

    ['GET', /^\/site\/pages\/(\d+)\/versions$/, async (req, _c, [pageId]) => {
      await requireEditor(req);
      const page = await pageOr404(pageId);
      const rows = await store.listSiteVersions(page.id);
      return json(200, { versions: rows.map((v) => ({ id: v.id, kind: v.kind, createdAt: v.created_at, by: v.user_name, title: v.title })) });
    }],

    ['POST', /^\/site\/pages\/(\d+)\/versions\/(\d+)\/restore$/, async (req, _c, [pageId, versionId]) => {
      const s = await requireEditor(req);
      const page = await pageOr404(pageId);
      const at = await store.restoreSiteVersion(page.id, parseId(versionId), s.user.id);
      if (!at) throw new HttpError(404, 'not_found', 'Versione non trovata');
      await store.audit(s.user.id, 'versione ripristinata come bozza', page.path);
      return json(200, { ok: true, draftUpdatedAt: at });
    }],

    // ---------- header, footer and studio details ----------
    ['GET', /^\/site\/globals$/, async (req) => {
      await requireEditor(req);
      await ensureSeeded();
      await ensureGlobalsSeeded();
      const rows = await store.listSiteGlobals();
      const scopes = {};
      for (const r of rows) {
        scopes[r.scope] = { draft: r.draft, published: r.published, draftUpdatedAt: r.draft_updated_at, draftUpdatedBy: r.draft_updated_by_name, publishedAt: r.published_at, hasChanges: JSON.stringify(r.draft) !== JSON.stringify(r.published) };
      }
      const all = await store.listSitePages();
      return json(200, {
        scopes, schema: GLOBALS_SCHEMA, year: romeYear(),
        linkTargets: linkTargetsFrom(all),
        professionals: (await store.listProfessionals({ onlyActive: true })).map((p) => ({ slug: p.slug, name: p.name })),
      });
    }],

    ['PUT', /^\/site\/globals\/(it|en|studio)$/, async (req, _c, [scope]) => {
      const s = await requireEditor(req);
      await ensureGlobalsSeeded();
      const body = await readJson(req, 200_000);
      let data;
      try { data = cleanGlobals(scope, body.data); } catch (err) { if (err instanceof RangeError) throw new HttpError(400, 'invalid', err.message); throw err; }
      const saved = await store.saveGlobalsDraft(scope, data, s.user.id, body.expected || null);
      if (!saved) throw new HttpError(409, 'conflict', 'Nel frattempo questa parte è stata modificata da un\'altra persona. Ricarica per vedere la versione aggiornata.');
      return json(200, { ok: true, draftUpdatedAt: saved, data });
    }],

    // Header, footer and studio details appear on every page: publishing refreshes the whole site.
    ['POST', /^\/site\/globals\/(it|en|studio)\/publish$/, async (req, _c, [scope]) => {
      const s = await requireEditor(req);
      await ensureGlobalsSeeded();
      await store.publishGlobals(scope, s.user.id);
      await store.audit(s.user.id, 'intestazione/piè di pagina pubblicati', scope);
      let purged = true;
      try { await purge(['pages']); } catch (err) { purged = false; console.error('[site] purge failed', err && err.message); }
      return json(200, { ok: true, purged });
    }],

    // Images are resized in the browser (WebP 480 and 800, JPEG 800); the server checks every file.
    ['POST', /^\/site\/images$/, async (req) => {
      const s = await requireEditor(req);
      const body = await readJson(req, 6_000_000);
      const files = [decodeImage(body['480.webp'], '480.webp'), decodeImage(body['800.webp'], '800.webp'), decodeImage(body['800.jpg'], '800.jpg')];
      const jpg = files[2];
      const imageId = createHash('sha256').update(jpg.bytes).digest('hex').slice(0, 24);
      await store.saveImage(imageId, files, s.user.id);
      await store.audit(s.user.id, 'immagine caricata', imageId);
      return json(201, { id: imageId, w: jpg.width, h: jpg.height });
    }],
  ];
}

/** Public: uploaded images, cached for a year (the name changes with the content). */
export function createMediaHandler({ store }) {
  return async function handle(req) {
    const m = new URL(req.url).pathname.match(/^\/media\/([a-f0-9]{24})-(480\.webp|800\.webp|800\.jpg)$/);
    if (!m) return new Response('Not found', { status: 404 });
    const img = await store.getImage(m[1], m[2]);
    if (!img) return new Response('Not found', { status: 404 });
    return new Response(img.bytes, {
      status: 200,
      headers: {
        'content-type': img.mime,
        'cache-control': 'public, max-age=31536000, immutable',
        'netlify-cdn-cache-control': 'public, durable, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  };
}
