// Page blocks: the library of components a page is made of, their editable fields,
// validation of what the editor saves, and rendering to the site's HTML.
// A page in one language = an ordered list of blocks:
//   { id, type, bg?, anchor?, note?, numbered?, data: { …fields of that type… } }
// Italian and English pages have separate lists (two texts, never a translation).

import { cleanRich, richInline, richBlocks, richText, escapeHtml as esc, linkKind, isDocument } from './richtext.mjs';

// ---------- field types ----------
// text: one line, no formatting · rich: bold/italic/link · flow: paragraphs, highlighted
// paragraph, figure with source, arrow link · button / buttons · link / links · image ·
// select · bool · list (of items with their own fields) · note (internal, never published).

export const BUTTON_STYLES = ['primary', 'ghost', 'light', 'outline-light'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const SLUG_RE = /^[a-z0-9-]{1,60}$/;

const txt = (name, label, o = {}) => ({ name, label, type: 'text', max: 200, ...o });
const rich = (name, label, o = {}) => ({ name, label, type: 'rich', max: 1200, ...o });
const note = { name: 'note', label: 'Nota interna (non pubblicata)', type: 'note', max: 1500 };

const BG2 = ['light', 'soft'];

/**
 * The library. `label`/`help` are what the editor shows. `bg` lists the allowed backgrounds
 * (first = default). `fixed` blocks can be moved but not removed or duplicated. `once` = at most one per page.
 */
export const BLOCKS = {
  'home-hero': {
    label: 'Apertura della home', help: 'Con il gradiente animato e la parola «Blooming». Sempre in cima alla home.',
    fixed: true, once: true, numbered: false, bg: ['light'],
    fields: [
      txt('descriptor', 'Descrittore (sopra il titolo)', { max: 80 }),
      txt('title', 'Titolo', { required: true, max: 120 }),
      txt('subtitle', 'Sottotitolo', { max: 160 }),
      rich('intro', 'Introduzione', { max: 400, multiline: false }),
      { name: 'buttons', label: 'Pulsanti', type: 'buttons', max: 2, styles: ['primary', 'ghost'] },
    ],
  },
  'page-hero': {
    label: 'Apertura di pagina', help: 'Titolo grande in cima alla pagina.',
    once: true, numbered: false, bg: ['light'],
    fields: [
      txt('eyebrow', 'Occhiello', { max: 60 }),
      txt('title', 'Titolo', { required: true, max: 160 }),
      txt('subtitle', 'Sottotitolo', { max: 200 }),
      rich('intro', 'Introduzione', { max: 600 }),
      { name: 'buttons', label: 'Pulsanti', type: 'buttons', max: 3, styles: ['primary', 'ghost'] },
      { name: 'width', label: 'Stile', type: 'select', options: [['wide', 'Normale'], ['narrow', 'Stretta'], ['plain', 'Semplice (titolo più piccolo)']] },
    ],
  },
  rows: {
    label: 'Elenco a righe', help: 'Situazioni, aree o collegamenti, una voce per riga.',
    numbered: true, bg: BG2,
    fields: [
      txt('eyebrow', 'Occhiello', { max: 60 }),
      txt('title', 'Titolo', { max: 200 }),
      rich('intro', 'Introduzione', { max: 600 }),
      { name: 'marker', label: 'Numerazione delle voci', type: 'select', options: [['numbers', 'Numeri (01, 02…)'], ['letters', 'Lettere (A, B…)'], ['links', 'Nessuna (collegamenti)']] },
      {
        name: 'items', label: 'Voci', type: 'list', min: 1, max: 12, itemLabel: 'Voce',
        fields: [
          txt('group', 'Inizia un gruppo con questo titolo', { max: 80 }),
          txt('title', 'Titolo', { max: 200 }),
          txt('who', 'Riga «con chi»', { max: 200 }),
          { name: 'body', label: 'Testo', type: 'flow', max: 10, kinds: ['p', 'stat'] },
          { name: 'links', label: 'Link', type: 'links', max: 3 },
          { name: 'anchor', label: 'Ancora (per link come #coaching)', type: 'anchor' },
          note,
        ],
      },
      { name: 'after', label: 'Nota finale', type: 'flow', max: 3, kinds: ['p', 'stat'] },
    ],
  },
  steps: {
    label: 'Passi numerati', help: 'Titolo a sinistra, passi 01, 02… a destra.',
    numbered: true, bg: BG2,
    fields: [
      txt('eyebrow', 'Occhiello', { max: 60 }),
      txt('title', 'Titolo', { required: true, max: 200 }),
      rich('intro', 'Testo sotto il titolo', { max: 800 }),
      {
        name: 'items', label: 'Passi', type: 'list', min: 1, max: 6, itemLabel: 'Passo',
        fields: [txt('title', 'Titolo del passo', { max: 120 }), rich('text', 'Testo', { max: 1200 }), note],
      },
      { name: 'after', label: 'Nota finale', type: 'flow', max: 3, kinds: ['p'] },
    ],
  },
  'text-columns': {
    label: 'Titolo e testo su due colonne', help: 'Titolo a sinistra, testo a destra.',
    numbered: true, bg: BG2,
    fields: [
      txt('eyebrow', 'Occhiello', { max: 60 }),
      txt('title', 'Titolo', { required: true, max: 220 }),
      rich('intro', 'Testo sotto il titolo', { max: 800 }),
      { name: 'body', label: 'Testo a destra', type: 'flow', max: 14, kinds: ['p', 'lead', 'stat', 'arrow'] },
    ],
  },
  'term-list': {
    label: 'Elenco di voci (o prezzi)', help: 'Voci con un termine in grassetto, oppure voci con il prezzo.',
    numbered: true, bg: BG2,
    fields: [
      txt('eyebrow', 'Occhiello', { max: 60 }),
      txt('title', 'Titolo', { required: true, max: 220 }),
      rich('intro', 'Testo sotto il titolo', { max: 800 }),
      { name: 'variant', label: 'Tipo di elenco', type: 'select', options: [['terms', 'Voci'], ['prices', 'Prezzi']] },
      {
        name: 'items', label: 'Voci', type: 'list', min: 1, max: 16, itemLabel: 'Voce',
        fields: [
          txt('term', 'Termine in grassetto (o nome del servizio)', { max: 120 }),
          rich('text', 'Testo (o prezzo)', { max: 900 }),
          { name: 'tbd', label: 'Prezzo da definire (attenuato)', type: 'bool' },
          note,
        ],
      },
      { name: 'after', label: 'Testo dopo l\'elenco', type: 'flow', max: 6, kinds: ['p', 'arrow'] },
      { name: 'link', label: 'Link finale', type: 'link' },
      { name: 'below', label: 'Link sotto le due colonne', type: 'link' },
    ],
  },
  people: {
    label: 'Sezione scura con le professioniste', help: 'Una o due professioniste, con il pulsante per prenotare.',
    numbered: true, bg: ['dark'],
    fields: [
      txt('eyebrow', 'Occhiello', { max: 60 }),
      txt('title', 'Titolo', { required: true, max: 220 }),
      {
        name: 'people', label: 'Persone', type: 'list', min: 1, max: 3, itemLabel: 'Persona',
        fields: [
          txt('name', 'Nome', { max: 80 }),
          rich('text', 'Testo', { max: 1200 }),
          txt('tag', 'Riga in evidenza', { max: 120 }),
          { name: 'button', label: 'Pulsante', type: 'button', styles: ['light'] },
          { name: 'link', label: 'Link alla scheda', type: 'link' },
          note,
        ],
      },
      { name: 'why', label: 'Punti di forza', type: 'textlist', max: 4, itemMax: 240 },
      { name: 'dots', label: 'Griglia di puntini che segue il mouse', type: 'bool' },
    ],
  },
  profile: {
    label: 'Scheda della professionista', help: 'Foto, titoli e pulsante per prenotare (pagina Team).',
    numbered: true, bg: BG2,
    fields: [
      { name: 'photo', label: 'Foto', type: 'image' },
      txt('eyebrow', 'Occhiello', { max: 60 }),
      txt('title', 'Titolo', { required: true, max: 220 }),
      txt('languages', 'Riga lingue', { max: 120 }),
      {
        name: 'items', label: 'Voci', type: 'list', min: 0, max: 12, itemLabel: 'Voce',
        fields: [txt('term', 'Termine in grassetto', { max: 120 }), rich('text', 'Testo', { max: 900 }), note],
      },
      { name: 'button', label: 'Pulsante', type: 'button', styles: ['primary'] },
      { name: 'links', label: 'Link correlati', type: 'links', max: 4 },
    ],
  },
  trio: {
    label: 'Tre riquadri a confronto', help: 'Tre riquadri affiancati con titolo e testo.',
    numbered: true, bg: BG2,
    fields: [
      txt('eyebrow', 'Occhiello', { max: 60 }),
      txt('title', 'Titolo', { required: true, max: 220 }),
      {
        name: 'items', label: 'Riquadri', type: 'list', min: 3, max: 3, itemLabel: 'Riquadro',
        fields: [txt('title', 'Titolo', { required: true, max: 80 }), rich('text', 'Testo', { max: 300, multiline: false })],
      },
      rich('after', 'Nota finale', { max: 400, multiline: false }),
    ],
  },
  'text-narrow': {
    label: 'Testo centrale', help: 'Titolo e un testo al centro della pagina.',
    numbered: true, bg: BG2,
    fields: [
      txt('eyebrow', 'Occhiello', { max: 60 }),
      txt('title', 'Titolo', { required: true, max: 200 }),
      rich('text', 'Testo', { max: 900, multiline: false }),
      { name: 'style', label: 'Stile del testo', type: 'select', options: [['lead', 'Normale'], ['light', 'Si accende scorrendo']] },
      { name: 'link', label: 'Link con freccia', type: 'link' },
    ],
  },
  faq: {
    label: 'Domande frequenti', help: 'Domande che si aprono con un clic.',
    numbered: true, bg: BG2,
    fields: [
      txt('eyebrow', 'Occhiello', { max: 60 }),
      txt('title', 'Titolo', { required: true, max: 200 }),
      {
        name: 'items', label: 'Domande', type: 'list', min: 1, max: 24, itemLabel: 'Domanda',
        fields: [txt('q', 'Domanda', { required: true, max: 200 }), rich('a', 'Risposta', { max: 1500 }), note],
      },
    ],
  },
  'closing-cta': {
    label: 'Chiusura scura con invito', help: 'Di solito l\'ultimo blocco: titolo e pulsanti.',
    numbered: false, bg: ['dark'],
    fields: [
      txt('title', 'Titolo', { required: true, max: 200 }),
      rich('text', 'Testo', { max: 600 }),
      { name: 'buttons', label: 'Pulsanti', type: 'buttons', max: 3, styles: ['light', 'outline-light'] },
      rich('more', 'Riga finale', { max: 200, multiline: false }),
    ],
  },
  // ---------- special blocks: fixed parts of the site; only the surrounding texts change ----------
  'booking-widget': {
    label: 'Prenotazione online', help: 'Il modulo di prenotazione. Si sposta, ma non si modifica qui.',
    fixed: true, once: true, numbered: false, bg: ['light'], special: true, fields: [],
  },
  'request-form': {
    label: 'Modulo di richiesta', help: 'Il modulo per farsi ricontattare. I campi sono fissi.',
    fixed: true, once: true, numbered: true, bg: BG2, special: true,
    fields: [
      { name: 'variant', label: 'Tipo di modulo', type: 'select', options: [['people', 'Persone'], ['organisations', 'Organizzazioni'], ['callback', 'Ricontatto (pagina di prenotazione)']] },
      txt('eyebrow', 'Occhiello', { max: 60 }),
      txt('title', 'Titolo', { max: 200 }),
      rich('intro', 'Testo', { max: 800 }),
    ],
  },
  'contact-channels': {
    label: 'Recapiti dello studio', help: 'Telefono, email e WhatsApp presi dalle impostazioni.',
    once: true, numbered: false, bg: BG2, special: true,
    fields: [
      rich('whatsapp', 'Testo della voce WhatsApp', { max: 300, multiline: false }),
      rich('after', 'Nota finale', { max: 400, multiline: false }),
    ],
  },
};

export const BLOCK_TYPES = Object.keys(BLOCKS);

// ---------- validation (server side: the editor is never trusted) ----------

function fail(msg) { throw new RangeError(msg); }

function cleanText(v, f, where) {
  if (v == null) v = '';
  if (typeof v !== 'string') fail(`${where}: testo non valido`);
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (f.required && !s) fail(`${where}: campo obbligatorio`);
  if (s.length > (f.max || 200)) fail(`${where}: massimo ${f.max || 200} caratteri`);
  return s;
}

/** Where a button or link goes. Internal pages are stored by key, so the right language path is used. */
function cleanTarget(t, where) {
  if (!t || typeof t !== 'object') fail(`${where}: destinazione mancante`);
  switch (t.kind) {
    case 'page': {
      if (typeof t.key !== 'string' || !SLUG_RE.test(t.key)) fail(`${where}: pagina non valida`);
      const out = { kind: 'page', key: t.key };
      if (t.anchor) { if (!ID_RE.test(t.anchor)) fail(`${where}: ancora non valida`); out.anchor = t.anchor; }
      return out;
    }
    case 'anchor':
      if (!ID_RE.test(String(t.anchor || ''))) fail(`${where}: ancora non valida`);
      return { kind: 'anchor', anchor: t.anchor };
    case 'book': {
      const out = { kind: 'book' };
      if (t.pro) { if (!SLUG_RE.test(t.pro)) fail(`${where}: professionista non valida`); out.pro = t.pro; }
      return out;
    }
    case 'url':
      if (linkKind(t.href) !== 'external') fail(`${where}: indirizzo esterno non valido`);
      return { kind: 'url', href: t.href };
    default: return fail(`${where}: destinazione non valida`);
  }
}

function cleanLink(v, where, { required = false } = {}) {
  if (v == null || v === '' || (typeof v === 'object' && !v.label && !v.to)) {
    if (required) fail(`${where}: obbligatorio`);
    return null;
  }
  const lbl = cleanText(v.label, { required: true, max: 120 }, `${where} (etichetta)`);
  return { label: lbl, to: cleanTarget(v.to, where) };
}

function cleanButton(v, f, where) {
  const link = cleanLink(v, where);
  if (!link) return null;
  const styles = f.styles || BUTTON_STYLES;
  const style = styles.includes(v.style) ? v.style : styles[0];
  return { ...link, style };
}

const FLOW_KINDS = { p: 'Paragrafo', lead: 'Paragrafo in evidenza', stat: 'Dato con fonte', arrow: 'Link con freccia' };

function cleanFlow(v, f, where) {
  if (v == null) return [];
  if (!Array.isArray(v)) fail(`${where}: formato non valido`);
  if (v.length > (f.max || 10)) fail(`${where}: massimo ${f.max} elementi`);
  const kinds = f.kinds || Object.keys(FLOW_KINDS);
  return v.map((el, i) => {
    const w = `${where}, elemento ${i + 1}`;
    if (!el || !kinds.includes(el.kind)) fail(`${w}: tipo non valido`);
    if (el.kind === 'arrow') return { kind: 'arrow', link: cleanLink(el.link, w, { required: true }) };
    const out = { kind: el.kind, text: cleanRich(el.text, { field: w, maxChars: 1500 }) };
    if (el.kind === 'stat') out.source = cleanText(el.source, { max: 120 }, `${w} (fonte)`);
    return out;
  }).filter((el) => el.kind === 'arrow' || el.text.p.length);
}

// Widths the media library creates (research 20): content 480/800/1200, wide 640/960/1280/1920/2560.
const IMAGE_WIDTHS = [480, 640, 800, 960, 1200, 1280, 1920, 2560];
const IMAGE_ROLES = ['content', 'wide', 'social'];
const IMAGE_SIZES = { content: '(min-width: 960px) 420px, 92vw', wide: '(min-width: 1280px) 1280px, 100vw' };

function cleanImage(v, where) {
  if (v == null || v === '' || !v.id) return null;
  if (typeof v.id !== 'string' || !/^[a-z0-9-]{8,64}$/.test(v.id)) fail(`${where}: immagine non valida`);
  const decorative = v.decorative === true;
  const alt = cleanText(v.alt, { max: 200 }, `${where} (testo alternativo)`);
  if (!decorative && !alt && v.social !== true) fail(`${where}: scrivi il testo alternativo, o segna l'immagine come decorativa`);
  const out = { id: v.id, alt: decorative ? '' : alt, decorative };
  if (Number.isInteger(v.w) && Number.isInteger(v.h) && v.w > 0 && v.h > 0 && v.w < 10000 && v.h < 10000) { out.w = v.w; out.h = v.h; }
  // Versions made at upload (media library): which widths exist and in which format, so the page
  // can offer the right file to each screen without asking the database.
  if (v.role !== undefined) {
    if (!IMAGE_ROLES.includes(v.role)) fail(`${where}: uso dell'immagine non valido`);
    out.role = v.role;
  }
  if (v.social === true) { out.social = true; out.role = 'social'; }
  if (v.variants !== undefined) {
    if (!Array.isArray(v.variants) || !v.variants.length || v.variants.length > 6 || v.variants.some((x) => !IMAGE_WIDTHS.includes(x))) fail(`${where}: versioni dell'immagine non valide`);
    out.variants = [...new Set(v.variants)].sort((a, b) => a - b);
  }
  if (v.format !== undefined) {
    if (!['webp', 'jpg'].includes(v.format)) fail(`${where}: formato dell'immagine non valido`);
    out.format = v.format;
  }
  if (v.fallback !== undefined) {
    if (!IMAGE_WIDTHS.includes(v.fallback)) fail(`${where}: versione di riserva non valida`);
    out.fallback = v.fallback;
  }
  return out;
}

function cleanField(f, v, where) {
  const w = `${where} – ${f.label}`;
  switch (f.type) {
    case 'text': return cleanText(v, f, w);
    case 'note': return cleanText(v, f, w);
    case 'anchor': { const s = cleanText(v, { max: 40 }, w); if (s && !ID_RE.test(s)) fail(`${w}: solo lettere minuscole, numeri e trattini`); return s; }
    case 'rich': {
      const r = cleanRich(v, { field: w, maxChars: f.max || 1200, multiline: f.multiline !== false });
      if (f.required && !r.p.length) fail(`${w}: campo obbligatorio`);
      return r;
    }
    case 'flow': return cleanFlow(v, f, w);
    case 'select': { const opts = f.options.map((o) => o[0]); return opts.includes(v) ? v : opts[0]; }
    case 'bool': return v === true;
    case 'link': return cleanLink(v, w);
    case 'links': {
      if (v == null) return [];
      if (!Array.isArray(v) || v.length > (f.max || 3)) fail(`${w}: massimo ${f.max || 3} link`);
      return v.map((l, i) => cleanLink(l, `${w} ${i + 1}`)).filter(Boolean);
    }
    case 'button': return cleanButton(v, f, w);
    case 'buttons': {
      if (v == null) return [];
      if (!Array.isArray(v) || v.length > (f.max || 3)) fail(`${w}: massimo ${f.max || 3} pulsanti`);
      return v.map((b, i) => cleanButton(b, f, `${w} ${i + 1}`)).filter(Boolean);
    }
    case 'textlist': {
      if (v == null) return [];
      if (!Array.isArray(v) || v.length > (f.max || 6)) fail(`${w}: massimo ${f.max || 6} voci`);
      return v.map((s, i) => cleanText(s, { max: f.itemMax || 200 }, `${w} ${i + 1}`)).filter(Boolean);
    }
    case 'image': return cleanImage(v, w);
    case 'list': {
      const arr = v == null ? [] : v;
      if (!Array.isArray(arr)) fail(`${w}: formato non valido`);
      if (arr.length > (f.max || 12)) fail(`${w}: massimo ${f.max} voci`);
      if (arr.length < (f.min || 0)) fail(`${w}: servono almeno ${f.min} voci`);
      return arr.map((item, i) => cleanFields(f.fields, item || {}, `${w}, ${f.itemLabel || 'voce'} ${i + 1}`));
    }
    default: return fail(`${w}: tipo di campo sconosciuto`);
  }
}

function cleanFields(fields, data, where) {
  const out = {};
  for (const f of fields) out[f.name] = cleanField(f, data[f.name], where);
  return out;
}

/** Validate a whole page (one language). Returns the cleaned list. */
export function cleanBlocks(blocks, { where = 'Pagina' } = {}) {
  if (!Array.isArray(blocks)) fail(`${where}: formato non valido`);
  if (blocks.length > 40) fail(`${where}: troppi blocchi (massimo 40)`);
  const seenOnce = new Set();
  const ids = new Set();
  return blocks.map((b, i) => {
    const def = b && BLOCKS[b.type];
    const w = `Blocco ${i + 1}${def ? ` (${def.label})` : ''}`;
    if (!def) fail(`${w}: tipo di blocco sconosciuto`);
    if (def.once) { if (seenOnce.has(b.type)) fail(`${w}: può comparire una volta sola`); seenOnce.add(b.type); }
    let id = typeof b.id === 'string' && /^[a-z0-9]{6,24}$/.test(b.id) ? b.id : null;
    if (!id || ids.has(id)) id = Math.random().toString(36).slice(2, 12).padEnd(8, '0');
    ids.add(id);
    const out = { id, type: b.type, bg: def.bg.includes(b.bg) ? b.bg : def.bg[0], data: cleanFields(def.fields, b.data || {}, w) };
    const anchor = cleanField({ type: 'anchor', label: 'Ancora' }, b.anchor, w);
    if (anchor) out.anchor = anchor;
    const n = cleanText(b.note, { max: 1500 }, `${w} – Nota interna`);
    if (n) out.note = n;
    if (def.numbered && b.numbered === false) out.numbered = false;
    return out;
  });
}

// ---------- rendering ----------

/**
 * ctx: { lang, pathOf(key, lang) -> path|null, notes: boolean (show internal notes: staging/editor only),
 *        imageUrl(id, width) -> url, render(specialType, block, num) -> html }
 */
function href(to, ctx) {
  switch (to.kind) {
    case 'page': {
      const p = ctx.pathOf(to.key, ctx.lang) || (ctx.lang === 'en' ? '/en/' : '/');
      return p + (to.anchor ? `#${to.anchor}` : '');
    }
    case 'anchor': return `#${to.anchor}`;
    case 'book': {
      const base = ctx.lang === 'en' ? '/en/book/' : '/prenota/';
      return to.pro ? `${base}?professionista=${encodeURIComponent(to.pro)}` : base;
    }
    case 'url': return to.href;
    default: return '#';
  }
}
const extAttrs = (to) => (to.kind === 'url' && (/^https?:/i.test(to.href) || isDocument(to.href)) ? ' target="_blank" rel="noopener noreferrer"' : '');
const label = (s) => esc(s).replace(/ (\d+) min\b/g, ' $1&nbsp;min');

// Editor attributes: emitted only for the editor's preview (ctx.editor), never in published pages.
// data-edit = path of the field inside the block (e.g. "items.2.title"), data-edit-kind = how it is edited:
// text (plain), rich (one paragraph of a rich text, data-edit-para = its index), inline (a whole one-line
// rich text), link (button or link: label + destination), image, item (a list item, for selection only).
const ed = (ctx, path, kind) => (ctx.editor && path ? ` data-edit="${esc(path)}" data-edit-kind="${kind}"` : '');
const sub = (path, k) => (path ? `${path}.${k}` : '');

function rblocks(value, cls, ctx, path, offset = 0) {
  if (!ctx.editor || !path) return richBlocks(value, cls);
  const v = value && Array.isArray(value.p) ? value : { p: [] };
  return v.p.map((para, k) => richBlocks({ p: [para] }, cls).replace(/^<p/, `<p${ed(ctx, path, 'rich')} data-edit-para="${k + offset}"`)).join('\n');
}
// A one-line rich text inside an element the template owns: wrapped in a span only in the editor.
const rinline = (value, ctx, path) => (ctx.editor && path ? `<span${ed(ctx, path, 'inline')}>${richInline(value)}</span>` : richInline(value));
const etext = (s, ctx, path) => (ctx.editor && path ? `<span${ed(ctx, path, 'text')}>${esc(s)}</span>` : esc(s));

function btn(b, ctx, extra = '', path = '') {
  return `<a class="btn btn-${b.style}${extra}"${ed(ctx, path, 'link')} href="${esc(href(b.to, ctx))}"${extAttrs(b.to)}>${label(b.label)}</a>`;
}
function rollLink(l, ctx, cls = '', path = '') {
  return `<a${cls ? ` class="${cls}"` : ''}${ed(ctx, path, 'link')} href="${esc(href(l.to, ctx))}"${extAttrs(l.to)} data-roll>${esc(l.label)}</a>`;
}
const noteHtml = (n, ctx, tag = 'p') => (n && ctx.notes ? `<${tag} class="draft-note">${esc(n)}</${tag}>` : '');

function flow(els, ctx, { pCls = '' } = {}, path = '') {
  return (els || []).map((el, i) => {
    const p = sub(path, i);
    if (el.kind === 'arrow') return rollLink(el.link, ctx, 'link-arrow', sub(p, 'link'));
    if (el.kind === 'stat') return `<p class="stat${pCls ? ` ${pCls}` : ''}">${rinline(el.text, ctx, sub(p, 'text'))}${el.source ? ` <span class="mono"${ed(ctx, sub(p, 'source'), 'text')}>${esc(el.source)}</span>` : ''}</p>`;
    const cls = [el.kind === 'lead' ? 'lead' : '', pCls].filter(Boolean).join(' ');
    return rblocks(el.text, cls, ctx, sub(p, 'text'));
  }).join('\n');
}

// First paragraph highlighted, the others plain (titles' intros and closing texts).
const leadFirst = (r, ctx = {}, path = '') => `${rblocks({ p: r.p.slice(0, 1) }, 'lead', ctx, path, 0)}${rblocks({ p: r.p.slice(1) }, '', ctx, path, 1)}`;

const eyebrow = (text, num, ctx = {}, path = 'eyebrow') => (text ? `<p class="eyebrow">${num ? `${num} · ` : ''}${etext(text, ctx, path)}</p>` : '');

function section(block, ctx, inner, { extraClass = '', attrs = '' } = {}) {
  const bg = block.bg === 'soft' ? ' section-soft' : block.bg === 'dark' ? ' section-dark' : '';
  const theme = block.bg === 'dark' ? 'dark' : 'light';
  const id = block.anchor ? ` id="${esc(block.anchor)}"` : '';
  return `<section class="section${bg}${extraClass}"${id} data-theme-section="${theme}"${attrs}>\n${noteHtml(block.note, ctx)}${inner}\n</section>`;
}

function picture(img, ctx, { first = false } = {}) {
  const load = first ? ' fetchpriority="high"' : ' loading="lazy"';
  // Library images: every version made at upload, the right one chosen by the browser.
  if (img.variants && img.variants.length) {
    const sizes = IMAGE_SIZES[img.role] || IMAGE_SIZES.content;
    const fb = img.fallback || img.variants[img.variants.length - 1];
    const ratio = img.w && img.h ? img.h / img.w : 4 / 3;
    const dims = `width="${fb}" height="${Math.round(fb * ratio)}"`;
    const set = (ext) => img.variants.map((w) => `${esc(ctx.imageUrl(img.id, w, ext))} ${w}w`).join(', ');
    if (img.format === 'jpg') {
      return `<img src="${esc(ctx.imageUrl(img.id, fb, 'jpg'))}" srcset="${set('jpg')}" sizes="${esc(sizes)}" alt="${esc(img.alt)}" ${dims}${load}>`;
    }
    return `<picture>
  <source type="image/webp" srcset="${set('webp')}" sizes="${esc(sizes)}">
  <img src="${esc(ctx.imageUrl(img.id, fb, 'jpg'))}" alt="${esc(img.alt)}" ${dims}${load}>
</picture>`;
  }
  // Older uploads and files in /assets/img: WebP 480/800 and JPEG 800.
  const w = img.w || 800;
  const h = img.h || Math.round(w * 4 / 3);
  return `<picture>
  <source type="image/webp" srcset="${esc(ctx.imageUrl(img.id, 480))} 480w, ${esc(ctx.imageUrl(img.id, 800))} 800w" sizes="${esc(IMAGE_SIZES.content)}">
  <img src="${esc(ctx.imageUrl(img.id, 800, 'jpg'))}" alt="${esc(img.alt)}" width="800" height="${Math.round(h * 800 / w)}"${load}>
</picture>`;
}

const RENDER = {
  'home-hero'(b, d, ctx) {
    return `<section class="hero-v4" data-theme-section="light">
  <div class="hero-v4-bg" data-gradient aria-hidden="true"></div>
  <div class="wrap hero-v4-inner">
    <div class="hero-v4-text">
      ${d.descriptor ? `<p class="eyebrow" data-reveal="fade"><span data-descriptor${ed(ctx, 'descriptor', 'text')}>${esc(d.descriptor)}</span></p>` : ''}
      <h1 data-reveal="lines"${ed(ctx, 'title', 'text')}>${esc(d.title)}</h1>
      ${d.subtitle ? `<p class="hero-v4-sub" data-reveal="lines"${ed(ctx, 'subtitle', 'text')}>${esc(d.subtitle)}</p>` : ''}
      ${d.intro.p.length ? `<p class="lead" data-reveal="fade"${ed(ctx, 'intro', 'inline')}>${richInline(d.intro)}</p>` : ''}
      ${d.buttons.length ? `<div class="cta-row" data-reveal="fade">${d.buttons.map((x, i) => btn(x, ctx, '', `buttons.${i}`)).join('\n')}</div>` : ''}
      ${noteHtml(b.note, ctx)}
    </div>
  </div>
  <p class="giant-word" aria-hidden="true" data-giant>Blooming</p>
</section>`;
  },
  'page-hero'(b, d, ctx) {
    const narrow = d.width === 'narrow';
    const plain = narrow || d.width === 'plain';
    return `<section class="section page-v4-hero"${b.anchor ? ` id="${esc(b.anchor)}"` : ''} data-theme-section="light">
  <div class="wrap${narrow ? ' narrow' : ''}">
    ${d.eyebrow ? `<p class="eyebrow" data-reveal="fade"${ed(ctx, 'eyebrow', 'text')}>${esc(d.eyebrow)}</p>` : ''}
    <h1${plain ? '' : ' class="h-wide"'} data-reveal="lines"${ed(ctx, 'title', 'text')}>${esc(d.title)}</h1>
    ${d.subtitle ? `<p class="hero-v4-sub" data-reveal="lines"${ed(ctx, 'subtitle', 'text')}>${esc(d.subtitle)}</p>` : ''}
    ${rblocks(d.intro, plain ? 'lead' : 'lead page-v4-lead', ctx, 'intro')}
    ${d.buttons.length ? `<div class="cta-row" data-reveal="fade">${d.buttons.map((x, i) => btn(x, ctx, '', `buttons.${i}`)).join('\n')}</div>` : ''}
    ${noteHtml(b.note, ctx)}
  </div>
</section>`;
  },
  rows(b, d, ctx, num) {
    const links = d.marker === 'links';
    const tag = links ? 'ul' : 'ol';
    let n = 0;
    let html = '';
    let open = false;
    const openList = () => `<${tag} class="rows${links ? ' links-v4' : ''}" role="list"${!links && n ? ` start="${n + 1}"` : ''}>`;
    d.items.forEach((it, i) => {
      const p = `items.${i}`;
      if (it.group) { if (open) html += `</${tag}>`; html += `<h3 class="rows-group"${ed(ctx, `${p}.group`, 'text')}>${esc(it.group)}</h3>`; open = false; }
      if (!open) { html += openList(); open = true; }
      n += 1;
      const mark = links ? '' : `<span class="row-num mono">${d.marker === 'letters' ? String.fromCharCode(64 + n) : String(n).padStart(2, '0')}</span>`;
      html += `<li class="row"${it.anchor ? ` id="${esc(it.anchor)}"` : ''}${ed(ctx, p, 'item')}>${mark}<div class="row-body">
${it.title ? `<h3${ed(ctx, `${p}.title`, 'text')}>${esc(it.title)}</h3>` : ''}${it.who ? `<p class="area-who mono"${ed(ctx, `${p}.who`, 'text')}>${esc(it.who)}</p>` : ''}
${flow(it.body, ctx, {}, `${p}.body`)}
${it.links.length ? `<p class="row-links">${it.links.map((l, k) => rollLink(l, ctx, '', `${p}.links.${k}`)).join(' ')}</p>` : ''}${noteHtml(it.note, ctx)}
</div></li>`;
    });
    if (open) html += `</${tag}>`;
    return section(b, ctx, `<div class="wrap">
${eyebrow(d.eyebrow, num, ctx)}
${d.title ? `<h2 class="h-wide" data-reveal="lines"${ed(ctx, 'title', 'text')}>${esc(d.title)}</h2>` : ''}
${rblocks(d.intro, 'lead page-v4-aside', ctx, 'intro')}
${html}
${flow(d.after, ctx, { pCls: 'note-wide page-v4-aside' }, 'after')}
</div>`);
  },
  steps(b, d, ctx, num) {
    const items = d.items.map((s, i) => {
      const p = `items.${i}`;
      const n = `<span class="mono">${String(i + 1).padStart(2, '0')}</span>`;
      if (!s.title) return `<li${ed(ctx, p, 'item')}>${n}${rblocks(s.text, '', ctx, `${p}.text`)}${noteHtml(s.note, ctx)}</li>`;
      return `<li${ed(ctx, p, 'item')}>${n}<div><h3${ed(ctx, `${p}.title`, 'text')}>${esc(s.title)}</h3>${rblocks(s.text, '', ctx, `${p}.text`)}${noteHtml(s.note, ctx)}</div></li>`;
    }).join('\n');
    const after = (d.after || []).length ? `\n<div class="wrap">${flow(d.after, ctx, { pCls: 'note-wide page-v4-aside' }, 'after')}</div>` : '';
    return section(b, ctx, `<div class="wrap two-col-v4">
<div>${eyebrow(d.eyebrow, num, ctx)}<h2 data-reveal="lines"${ed(ctx, 'title', 'text')}>${esc(d.title)}</h2>${leadFirst(d.intro, ctx, 'intro')}</div>
<ol class="steps" role="list">${items}</ol>
</div>${after}`);
  },
  'text-columns'(b, d, ctx, num) {
    return section(b, ctx, `<div class="wrap two-col-v4">
<div>${eyebrow(d.eyebrow, num, ctx)}<h2 data-reveal="lines"${ed(ctx, 'title', 'text')}>${esc(d.title)}</h2>${leadFirst(d.intro, ctx, 'intro')}</div>
<div class="prose-v4">${flow(d.body, ctx, {}, 'body')}</div>
</div>`);
  },
  'term-list'(b, d, ctx, num) {
    const prices = d.variant === 'prices';
    const items = d.items.map((it, i) => {
      const p = `items.${i}`;
      if (prices) return `<li${ed(ctx, p, 'item')}><strong${ed(ctx, `${p}.term`, 'text')}>${esc(it.term)}</strong><span${it.tbd ? ' class="price-tbd"' : ''}${ed(ctx, `${p}.text`, 'inline')}>${richInline(it.text)}</span>${noteHtml(it.note, ctx, 'span')}</li>`;
      return `<li${ed(ctx, p, 'item')}>${it.term ? `<strong${ed(ctx, `${p}.term`, 'text')}>${esc(it.term)}</strong> ` : ''}${rinline(it.text, ctx, `${p}.text`)}${noteHtml(it.note, ctx, 'span')}</li>`;
    });
    if (d.link && !prices) items.push(`<li>${rollLink(d.link, ctx, 'link-arrow', 'link')}</li>`);
    const list = `<ul class="cover-list${prices ? ' price-list' : ''}" role="list">${items.join('\n')}</ul>`;
    const right = prices
      ? `<div class="prose-v4">${list}${flow(d.after, ctx, {}, 'after')}${d.link ? rollLink(d.link, ctx, 'link-arrow', 'link') : ''}</div>`
      : `${list}${(d.after || []).length ? `<div class="prose-v4">${flow(d.after, ctx, {}, 'after')}</div>` : ''}`;
    const below = d.below ? `\n<div class="wrap">${rollLink(d.below, ctx, 'link-arrow', 'below')}</div>` : '';
    return section(b, ctx, `<div class="wrap two-col-v4">
<div>${eyebrow(d.eyebrow, num, ctx)}<h2 data-reveal="lines"${ed(ctx, 'title', 'text')}>${esc(d.title)}</h2>${leadFirst(d.intro, ctx, 'intro')}</div>
${right}
</div>${below}`);
  },
  people(b, d, ctx, num) {
    const people = d.people.map((p, i) => {
      const k = `people.${i}`;
      return `<article class="person-v4"${ed(ctx, k, 'item')}>
${p.name ? `<h3${ed(ctx, `${k}.name`, 'text')}>${esc(p.name)}</h3>` : ''}${noteHtml(p.note, ctx)}${rblocks(p.text, '', ctx, `${k}.text`)}
${p.tag ? `<p class="mono"${ed(ctx, `${k}.tag`, 'text')}>${esc(p.tag)}</p>` : ''}
${p.button ? btn(p.button, ctx, ' btn-small', `${k}.button`) : ''}
${p.link ? `<p class="row-links">${rollLink(p.link, ctx, '', `${k}.link`)}</p>` : ''}
</article>`;
    }).join('\n');
    const why = d.why.length ? `<ul class="why" role="list">${d.why.map((w, i) => `<li${ed(ctx, `why.${i}`, 'text')}>${esc(w)}</li>`).join('')}</ul>` : '';
    return section(b, ctx, `<div class="wrap two-col-v4">
<div>${eyebrow(d.eyebrow, num, ctx)}<h2 data-reveal="lines"${ed(ctx, 'title', 'text')}>${esc(d.title)}</h2></div>
<div class="people">${people}${why}</div>
</div>`, { attrs: d.dots ? ' data-dots' : '' });
  },
  profile(b, d, ctx, num) {
    const photo = d.photo
      ? `<figure class="profile-photo"${ed(ctx, 'photo', 'image')}>${picture(d.photo, ctx, { first: ctx.firstImage === b })}</figure>`
      : `<figure class="profile-photo profile-photo-empty" aria-hidden="true"${ed(ctx, 'photo', 'image')}><img src="/assets/img/logo-icon.webp" alt="" width="147" height="112"></figure>`;
    const items = d.items.length ? `<ul class="cover-list" role="list">${d.items.map((it, i) => `<li${ed(ctx, `items.${i}`, 'item')}>${it.term ? `<strong${ed(ctx, `items.${i}.term`, 'text')}>${esc(it.term)}</strong> ` : ''}${rinline(it.text, ctx, `items.${i}.text`)}${noteHtml(it.note, ctx, 'span')}</li>`).join('\n')}</ul>` : '';
    return section(b, ctx, `<div class="wrap profile-v4">
${photo}
<div class="profile-body">
${eyebrow(d.eyebrow, num, ctx)}<h2 data-reveal="lines"${ed(ctx, 'title', 'text')}>${esc(d.title)}</h2>
${d.languages ? `<p class="area-who mono"${ed(ctx, 'languages', 'text')}>${esc(d.languages)}</p>` : ''}
${items}
${d.button ? btn(d.button, ctx, ' btn-small', 'button') : ''}
${d.links.length ? `<p class="row-links">${d.links.map((l, i) => rollLink(l, ctx, '', `links.${i}`)).join(' ')}</p>` : ''}
</div>
</div>`);
  },
  trio(b, d, ctx, num) {
    return section(b, ctx, `<div class="wrap">
${eyebrow(d.eyebrow, num, ctx)}<h2 class="h-wide" data-reveal="lines"${ed(ctx, 'title', 'text')}>${esc(d.title)}</h2>
<ul class="trio" role="list">${d.items.map((it, i) => `<li${ed(ctx, `items.${i}`, 'item')}><h3${ed(ctx, `items.${i}.title`, 'text')}>${esc(it.title)}</h3><p${ed(ctx, `items.${i}.text`, 'inline')}>${richInline(it.text)}</p></li>`).join('\n')}</ul>
${d.after.p.length ? `<p class="note-wide"${ed(ctx, 'after', 'inline')}>${richInline(d.after)}</p>` : ''}
</div>`);
  },
  'text-narrow'(b, d, ctx, num) {
    const text = d.style === 'light'
      ? `<p class="light-up" data-reveal="light"${ed(ctx, 'text', 'inline')}>${richInline(d.text)}</p>`
      : `<p class="lead"${ed(ctx, 'text', 'inline')}>${richInline(d.text)}</p>`;
    return section(b, ctx, `<div class="wrap narrow-v4">
${eyebrow(d.eyebrow, num, ctx)}<h2 data-reveal="lines"${ed(ctx, 'title', 'text')}>${esc(d.title)}</h2>
${d.text.p.length ? text : ''}
${d.link ? rollLink(d.link, ctx, 'link-arrow', 'link') : ''}
</div>`);
  },
  faq(b, d, ctx, num) {
    // A question with no published answer is left out (the editor says so).
    const items = d.items.map((it, i) => ({ it, i })).filter(({ it }) => it.a.p.length || (ctx.notes && it.note))
      .map(({ it, i }) => `<details${ed(ctx, `items.${i}`, 'item')}><summary${ed(ctx, `items.${i}.q`, 'text')}>${esc(it.q)}</summary><div class="answer">${rblocks(it.a, '', ctx, `items.${i}.a`)}${noteHtml(it.note, ctx)}</div></details>`).join('\n');
    return section(b, ctx, `<div class="wrap">
${eyebrow(d.eyebrow, num, ctx)}<h2 class="h-wide" data-reveal="lines"${ed(ctx, 'title', 'text')}>${esc(d.title)}</h2>
<div class="faq-v4">${items}</div>
</div>`);
  },
  'closing-cta'(b, d, ctx) {
    return section(b, ctx, `<div class="wrap">
<h2 class="h-wide" data-reveal="lines"${ed(ctx, 'title', 'text')}>${esc(d.title)}</h2>
${leadFirst(d.text, ctx, 'text')}
${d.buttons.length ? `<div class="cta-row">${d.buttons.map((x, i) => btn(x, ctx, '', `buttons.${i}`)).join('\n')}</div>` : ''}
${d.more.p.length ? `<p class="closing-v4-more"${ed(ctx, 'more', 'inline')}>${richInline(d.more)}</p>` : ''}
</div>`, { extraClass: ' closing-v4' });
  },
  'booking-widget'(b, d, ctx) { return `${noteHtml(b.note, ctx)}${ctx.render ? ctx.render('booking-widget', b) : ''}`; },
  'request-form'(b, d, ctx, num) { return ctx.render ? ctx.render('request-form', b, num) : ''; },
  'contact-channels'(b, d, ctx) { return ctx.render ? ctx.render('contact-channels', b) : ''; },
};

/** HTML of a page's blocks. Eyebrow numbers ("01 · ") follow the block order. */
export function renderBlocks(blocks, ctx) {
  let counter = 0;
  // The first picture of the page loads at once (it is often the largest thing on screen); the others lazily.
  ctx = { ...ctx, firstImage: blocks.find((b) => b.data && b.data.photo && b.data.photo.id) || null };
  return blocks.map((b, i) => {
    const def = BLOCKS[b.type];
    if (!def) return '';
    let num = '';
    if (def.numbered && b.numbered !== false && b.data.eyebrow) {
      counter += 1;
      num = String(counter).padStart(2, '0');
    }
    const html = RENDER[b.type](b, b.data, ctx, num);
    // In the editor's preview the block's first element says which block it is (no wrapper: the page CSS stays the same).
    return ctx.editor ? html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 data-edit-block="${i}"`) : html;
  }).join('\n\n');
}

/** Scripts a page needs because of its special blocks. */
export function scriptsFor(blocks) {
  return blocks.some((b) => b.type === 'booking-widget' || b.type === 'request-form') ? ['booking'] : [];
}

/** Plain-text summary of a block, for the editor's list. */
export function blockSummary(b) {
  const d = b.data || {};
  const first = d.title || d.eyebrow || d.descriptor || (d.items && d.items[0] && (d.items[0].title || d.items[0].q)) || '';
  return typeof first === 'string' ? first : richText(first);
}

export { FLOW_KINDS };

/** Validate a set of fields outside a block (header, footer, studio details, page SEO). */
export function cleanData(fields, data, where) {
  return cleanFields(fields, data || {}, where);
}

/** Validate one image value ({ id, alt, decorative, w, h }); null when empty. */
export function cleanImageValue(v, where = 'Immagine') {
  return cleanImage(v, where);
}
