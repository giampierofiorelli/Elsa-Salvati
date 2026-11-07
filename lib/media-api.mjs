// Media library API (inside /api/admin) and public delivery of the files (/media/…).
// Images arrive already converted by the editor's browser (the original never leaves the computer):
// the server checks every file from its bytes and keeps only the versions the site delivers.

import { randomBytes } from 'node:crypto';
import { HttpError, json, readJson, cleanText } from './http.mjs';
import { usageOf } from './media-store.mjs';

// Widths per role (research 20): never wider than twice the displayed size.
export const ROLE_WIDTHS = {
  content: [480, 800, 1200],
  wide: [640, 960, 1280, 1920, 2560],
};
export const ROLE_FALLBACK = { content: 800, wide: 1280 };
const MAX_FILE = 1_500_000;      // one version
const MAX_TOTAL = 4_400_000;     // all versions of one upload (Netlify's payload limit is ~6 MB of base64)
const MAX_PDF = 4 * 1024 * 1024;
const ID_RE = /^[a-f0-9]{24}$/;

// ---------- file checks, from the bytes ----------

export function imageInfo(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
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

function decode(b64, max, what) {
  if (typeof b64 !== 'string' || !b64) throw new HttpError(400, 'invalid', `${what}: file mancante`);
  if (b64.length > Math.ceil(max * 1.37) + 8) throw new HttpError(413, 'too_large', `${what}: file troppo grande`);
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > max) throw new HttpError(413, 'too_large', `${what}: file troppo grande`);
  return buf;
}

/** File name shown in the library: no path, no control characters, at most 120 characters. */
export function cleanName(v, fallback) {
  const base = String(v || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>"]/g, '').replace(/\s+/g, ' ').trim();
  return (base || fallback).slice(0, 120);
}

const newId = () => randomBytes(12).toString('hex');

function checkImageUpload(body) {
  const role = ['content', 'wide', 'social'].includes(body.role) ? body.role : null;
  if (!role) throw new HttpError(400, 'invalid', 'Scegli dove verrà usata l\'immagine');
  const files = body.files && typeof body.files === 'object' ? body.files : {};
  const names = Object.keys(files);
  if (!names.length || names.length > 12) throw new HttpError(400, 'invalid', 'Versioni dell\'immagine mancanti');
  const out = [];
  let total = 0;
  let ratio = null;
  for (const name of names) {
    const m = name.match(/^(\d{3,4})\.(webp|jpg)$/) || (name === '1200x630.jpg' ? [name, '1200', 'jpg'] : null);
    if (!m) throw new HttpError(400, 'invalid', `Versione non prevista: ${name.slice(0, 20)}`);
    const width = Number(m[1]);
    const ext = m[2];
    if (role === 'social' ? name !== '1200x630.jpg' : !ROLE_WIDTHS[role].includes(width)) throw new HttpError(400, 'invalid', `Versione non prevista per questo uso: ${name}`);
    const buf = decode(files[name], MAX_FILE, `Versione ${name}`);
    const info = imageInfo(buf);
    if (!info || info.mime !== (ext === 'jpg' ? 'image/jpeg' : 'image/webp')) throw new HttpError(400, 'invalid', `Versione ${name}: il contenuto non è un'immagine ${ext.toUpperCase()}`);
    if (info.width !== width) throw new HttpError(400, 'invalid', `Versione ${name}: larghezza ${info.width} invece di ${width}`);
    if (info.height < 50 || info.height > 6000) throw new HttpError(400, 'invalid', `Versione ${name}: altezza non valida`);
    if (role === 'social' && info.height !== 630) throw new HttpError(400, 'invalid', 'L\'immagine per i social deve essere 1200 × 630');
    // Every version is the same picture: same proportions (rounding allowed).
    const r = info.width / info.height;
    if (ratio && Math.abs(r - ratio) / ratio > 0.02) throw new HttpError(400, 'invalid', 'Le versioni dell\'immagine non hanno le stesse proporzioni');
    ratio = ratio || r;
    total += buf.length;
    out.push({ variant: name, mime: info.mime, width: info.width, height: info.height, bytes: buf });
  }
  if (total > MAX_TOTAL) throw new HttpError(413, 'too_large', 'Le versioni dell\'immagine pesano troppo in totale');
  if (role !== 'social' && !out.some((f) => f.mime === 'image/jpeg')) throw new HttpError(400, 'invalid', 'Manca la versione JPEG di riserva');
  return { role, files: out };
}

function checkPdf(body) {
  const buf = decode(body.data, MAX_PDF, 'PDF');
  if (buf.toString('latin1', 0, 5) !== '%PDF-') throw new HttpError(400, 'invalid', 'Il file non è un PDF');
  if (!buf.toString('latin1', Math.max(0, buf.length - 1024)).includes('%%EOF')) throw new HttpError(400, 'invalid', 'Il PDF sembra incompleto o danneggiato');
  return buf;
}

/** What a block stores for an image: enough to build srcset without asking the database. */
export function imageValue(row, lang = 'it') {
  const variants = row.variants || [];
  if (row.role === 'social') return { id: row.id, w: 1200, h: 630, social: true, role: 'social', alt: (lang === 'en' ? row.alt_en : row.alt_it) || '', decorative: false };
  const webp = variants.filter((v) => v.endsWith('.webp')).map((v) => Number(v.split('.')[0])).sort((a, b) => a - b);
  const jpg = variants.filter((v) => /^\d+\.jpg$/.test(v)).map((v) => Number(v.split('.')[0])).sort((a, b) => a - b);
  const format = webp.length ? 'webp' : 'jpg';
  const widths = format === 'webp' ? webp : jpg;
  const pref = ROLE_FALLBACK[row.role] || 800;
  const fallback = jpg.includes(pref) ? pref : jpg[jpg.length - 1];
  return {
    id: row.id, role: row.role, variants: widths, format, fallback,
    w: row.width, h: row.height, alt: (lang === 'en' ? row.alt_en : row.alt_it) || '', decorative: false,
  };
}

function view(row, sources) {
  const usedIn = usageOf(row.id, sources);
  const base = {
    id: row.id, kind: row.kind, name: row.name, role: row.role, width: row.width, height: row.height,
    altIt: row.alt_it, altEn: row.alt_en, bytes: row.bytes_total, createdAt: row.created_at, createdBy: row.created_by_name,
    variants: row.variants, usedIn,
  };
  if (row.kind === 'pdf') return { ...base, url: `/media/${row.id}.pdf` };
  const v = imageValue(row);
  const thumbW = row.role === 'social' ? null : (v.variants[0] || v.fallback);
  base.thumb = row.role === 'social' ? `/media/${row.id}-1200x630.jpg` : `/media/${row.id}-${thumbW}.${v.format === 'webp' ? 'webp' : 'jpg'}`;
  base.value = v;
  return base;
}

/**
 * Routes for the admin API. auth: { requireSession } from the admin API.
 * Same access as the page editor: administrators and accounts allowed to edit the site.
 */
export function createMediaRoutes({ store, mediaStore, auth }) {
  async function requireEditor(req) {
    const s = await auth.requireSession(req);
    if (!s.isAdmin && !s.user.can_edit_site) throw new HttpError(403, 'forbidden', 'Non hai il permesso di modificare il sito');
    return s;
  }
  async function mediaOr404(id) {
    if (!ID_RE.test(String(id))) throw new HttpError(404, 'not_found', 'File non trovato');
    const row = await mediaStore.getMedia(id);
    if (!row) throw new HttpError(404, 'not_found', 'File non trovato');
    return row;
  }

  return [
    ['GET', /^\/site\/media$/, async (req) => {
      await requireEditor(req);
      const [rows, sources] = await Promise.all([mediaStore.listMedia(), mediaStore.contentSources()]);
      return json(200, { media: rows.map((r) => view(r, sources)), roles: ROLE_WIDTHS });
    }],

    ['POST', /^\/site\/media$/, async (req) => {
      const s = await requireEditor(req);
      const body = await readJson(req, 6_000_000);
      const id = newId();
      const altIt = cleanText(body.alt_it, { field: 'Testo alternativo (italiano)', max: 200 });
      const altEn = cleanText(body.alt_en, { field: 'Testo alternativo (inglese)', max: 200 });
      if (body.kind === 'pdf') {
        const buf = checkPdf(body);
        const name = cleanName(body.name, 'documento.pdf');
        await mediaStore.insertMedia({ id, kind: 'pdf', name, bytes_total: buf.length, created_by: s.user.id }, [{ variant: 'file.pdf', mime: 'application/pdf', bytes: buf }]);
        await store.audit(s.user.id, 'PDF caricato', name);
      } else {
        const { role, files } = checkImageUpload(body);
        const biggest = files.reduce((a, f) => (f.width > a.width ? f : a), files[0]);
        const name = cleanName(body.name, 'immagine');
        await mediaStore.insertMedia({
          id, kind: 'image', name, role, width: biggest.width, height: biggest.height, alt_it: altIt, alt_en: altEn,
          bytes_total: files.reduce((n, f) => n + f.bytes.length, 0), created_by: s.user.id,
        }, files);
        await store.audit(s.user.id, 'immagine caricata', name);
      }
      const row = await mediaStore.getMedia(id);
      return json(201, { media: view(row, []) });
    }],

    ['PATCH', /^\/site\/media\/([a-f0-9]{24})$/, async (req, _c, [id]) => {
      await requireEditor(req);
      const row = await mediaOr404(id);
      const body = await readJson(req, 4096);
      const patch = {};
      if (body.name !== undefined) patch.name = cleanName(body.name, row.name);
      if (body.alt_it !== undefined) patch.alt_it = cleanText(body.alt_it, { field: 'Testo alternativo (italiano)', max: 200 });
      if (body.alt_en !== undefined) patch.alt_en = cleanText(body.alt_en, { field: 'Testo alternativo (inglese)', max: 200 });
      await mediaStore.updateMedia(id, patch);
      return json(200, { media: view(await mediaStore.getMedia(id), await mediaStore.contentSources()) });
    }],

    ['DELETE', /^\/site\/media\/([a-f0-9]{24})$/, async (req, _c, [id]) => {
      const s = await requireEditor(req);
      const row = await mediaOr404(id);
      const usedIn = usageOf(id, await mediaStore.contentSources());
      if (usedIn.length) {
        return json(409, { error: 'in_use', message: 'Questo file è usato in alcune pagine: toglilo da lì prima di cancellarlo.', usedIn });
      }
      await mediaStore.deleteMedia(id);
      await store.audit(s.user.id, row.kind === 'pdf' ? 'PDF cancellato' : 'immagine cancellata', row.name);
      return json(200, { ok: true });
    }],
  ];
}

// ---------- public delivery ----------

const LONG_CACHE = {
  'cache-control': 'public, max-age=31536000, immutable',
  'netlify-cdn-cache-control': 'public, durable, max-age=31536000, immutable',
  'x-content-type-options': 'nosniff',
};

/** /media/<id>-<variant> (images), /media/<id>.pdf (documents); old uploads (site_images) keep working. */
export function createMediaDelivery({ store, mediaStore }) {
  return async function handle(req) {
    const path = new URL(req.url).pathname;
    const pdf = path.match(/^\/media\/([a-f0-9]{24})\.pdf$/);
    if (pdf) {
      const f = await mediaStore.getMediaFile(pdf[1], 'file.pdf');
      if (!f) return new Response('Not found', { status: 404 });
      const name = f.name.toLowerCase().endsWith('.pdf') ? f.name : `${f.name}.pdf`;
      const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      return new Response(f.bytes, {
        status: 200,
        headers: {
          ...LONG_CACHE,
          'content-type': 'application/pdf',
          'content-disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        },
      });
    }
    const img = path.match(/^\/media\/([a-f0-9]{24})-(\d{3,4}\.(?:webp|jpg)|1200x630\.jpg)$/);
    if (!img) return new Response('Not found', { status: 404 });
    let f = await mediaStore.getMediaFile(img[1], img[2]);
    // Uploads made before the library (site_images: 480.webp, 800.webp, 800.jpg).
    if (!f && store && ['480.webp', '800.webp', '800.jpg'].includes(img[2])) f = await store.getImage(img[1], img[2]);
    if (!f) return new Response('Not found', { status: 404 });
    return new Response(f.bytes, { status: 200, headers: { ...LONG_CACHE, 'content-type': f.mime } });
  };
}
