// Page blocks: the library of components a page is made of, their editable fields,
// validation of what the editor saves, and rendering to the site's HTML.
// A page in one language = an ordered list of blocks:
//   { id, type, bg?, anchor?, note?, numbered?, data: { …fields of that type… } }
// Italian and English pages have separate lists (two texts, never a translation).

import { cleanRich, richInline, richBlocks, richText, escapeHtml as esc, linkKind } from './richtext.mjs';

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
      { name: 'width', label: 'Larghezza', type: 'select', options: [['wide', 'Normale'], ['narrow', 'Stretta']] },
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

function cleanImage(v, where) {
  if (v == null || v === '' || !v.id) return null;
  if (typeof v.id !== 'string' || !/^[a-z0-9-]{8,64}$/.test(v.id)) fail(`${where}: immagine non valida`);
  const decorative = v.decorative === true;
  const alt = cleanText(v.alt, { max: 200 }, `${where} (testo alternativo)`);
  if (!decorative && !alt) fail(`${where}: scrivi il testo alternativo, o segna l'immagine come decorativa`);
  const out = { id: v.id, alt: decorative ? '' : alt, decorative };
  if (Number.isInteger(v.w) && Number.isInteger(v.h) && v.w > 0 && v.h > 0 && v.w < 10000 && v.h < 10000) { out.w = v.w; out.h = v.h; }
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
const extAttrs = (to) => (to.kind === 'url' ? ' target="_blank" rel="noopener noreferrer"' : '');
const label = (s) => esc(s).replace(/ (\d+) min\b/g, ' $1&nbsp;min');

function btn(b, ctx, extra = '') {
  return `<a class="btn btn-${b.style}${extra}" href="${esc(href(b.to, ctx))}"${extAttrs(b.to)}>${label(b.label)}</a>`;
}
function rollLink(l, ctx, cls = '') {
  return `<a${cls ? ` class="${cls}"` : ''} href="${esc(href(l.to, ctx))}"${extAttrs(l.to)} data-roll>${esc(l.label)}</a>`;
}
const noteHtml = (n, ctx, tag = 'p') => (n && ctx.notes ? `<${tag} class="draft-note">${esc(n)}</${tag}>` : '');

function flow(els, ctx, { pCls = '' } = {}) {
  return (els || []).map((el) => {
    if (el.kind === 'arrow') return rollLink(el.link, ctx, 'link-arrow');
    if (el.kind === 'stat') return `<p class="stat${pCls ? ` ${pCls}` : ''}">${richInline(el.text)}${el.source ? ` <span class="mono">${esc(el.source)}</span>` : ''}</p>`;
    const cls = [el.kind === 'lead' ? 'lead' : '', pCls].filter(Boolean).join(' ');
    return richBlocks(el.text, cls);
  }).join('\n');
}

const eyebrow = (text, num) => (text ? `<p class="eyebrow">${num ? `${num} · ` : ''}${esc(text)}</p>` : '');

function section(block, ctx, inner, { extraClass = '', attrs = '' } = {}) {
  const bg = block.bg === 'soft' ? ' section-soft' : block.bg === 'dark' ? ' section-dark' : '';
  const theme = block.bg === 'dark' ? 'dark' : 'light';
  const id = block.anchor ? ` id="${esc(block.anchor)}"` : '';
  return `<section class="section${bg}${extraClass}"${id} data-theme-section="${theme}"${attrs}>\n${noteHtml(block.note, ctx)}${inner}\n</section>`;
}

function picture(img, ctx, { sizes = '(min-width: 960px) 420px, 92vw' } = {}) {
  const w = img.w || 800;
  const h = img.h || Math.round(w * 4 / 3);
  return `<picture>
  <source type="image/webp" srcset="${esc(ctx.imageUrl(img.id, 480))} 480w, ${esc(ctx.imageUrl(img.id, 800))} 800w" sizes="${esc(sizes)}">
  <img src="${esc(ctx.imageUrl(img.id, 800, 'jpg'))}" alt="${esc(img.alt)}" width="800" height="${Math.round(h * 800 / w)}" loading="lazy">
</picture>`;
}

const RENDER = {
  'home-hero'(b, d, ctx) {
    return `<section class="hero-v4" data-theme-section="light">
  <div class="hero-v4-bg" data-gradient aria-hidden="true"></div>
  <div class="wrap hero-v4-inner">
    <div class="hero-v4-text">
      ${d.descriptor ? `<p class="eyebrow" data-reveal="fade"><span data-descriptor>${esc(d.descriptor)}</span></p>` : ''}
      <h1 data-reveal="lines">${esc(d.title)}</h1>
      ${d.subtitle ? `<p class="hero-v4-sub" data-reveal="lines">${esc(d.subtitle)}</p>` : ''}
      ${d.intro.p.length ? `<p class="lead" data-reveal="fade">${richInline(d.intro)}</p>` : ''}
      ${d.buttons.length ? `<div class="cta-row" data-reveal="fade">${d.buttons.map((x) => btn(x, ctx)).join('\n')}</div>` : ''}
      ${noteHtml(b.note, ctx)}
    </div>
  </div>
  <p class="giant-word" aria-hidden="true" data-giant>Blooming</p>
</section>`;
  },
  'page-hero'(b, d, ctx) {
    const narrow = d.width === 'narrow';
    return `<section class="section page-v4-hero"${b.anchor ? ` id="${esc(b.anchor)}"` : ''} data-theme-section="light">
  <div class="wrap${narrow ? ' narrow' : ''}">
    ${d.eyebrow ? `<p class="eyebrow" data-reveal="fade">${esc(d.eyebrow)}</p>` : ''}
    <h1${narrow ? '' : ' class="h-wide"'} data-reveal="lines">${esc(d.title)}</h1>
    ${d.subtitle ? `<p class="hero-v4-sub" data-reveal="lines">${esc(d.subtitle)}</p>` : ''}
    ${richBlocks(d.intro, narrow ? 'lead' : 'lead page-v4-lead')}
    ${d.buttons.length ? `<div class="cta-row" data-reveal="fade">${d.buttons.map((x) => btn(x, ctx)).join('\n')}</div>` : ''}
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
    for (const it of d.items) {
      if (it.group) { if (open) html += `</${tag}>`; html += `<h3 class="rows-group">${esc(it.group)}</h3>`; open = false; }
      if (!open) { html += openList(); open = true; }
      n += 1;
      const mark = links ? '' : `<span class="row-num mono">${d.marker === 'letters' ? String.fromCharCode(64 + n) : String(n).padStart(2, '0')}</span>`;
      html += `<li class="row"${it.anchor ? ` id="${esc(it.anchor)}"` : ''}>${mark}<div class="row-body">
${it.title ? `<h3>${esc(it.title)}</h3>` : ''}${it.who ? `<p class="area-who mono">${esc(it.who)}</p>` : ''}
${flow(it.body, ctx)}
${it.links.length ? `<p class="row-links">${it.links.map((l) => rollLink(l, ctx)).join(' ')}</p>` : ''}${noteHtml(it.note, ctx)}
</div></li>`;
    }
    if (open) html += `</${tag}>`;
    return section(b, ctx, `<div class="wrap">
${eyebrow(d.eyebrow, num)}
${d.title ? `<h2 class="h-wide" data-reveal="lines">${esc(d.title)}</h2>` : ''}
${richBlocks(d.intro, 'lead page-v4-aside')}
${html}
${flow(d.after, ctx, { pCls: 'note-wide page-v4-aside' })}
</div>`);
  },
  steps(b, d, ctx, num) {
    const items = d.items.map((s, i) => {
      const n = `<span class="mono">${String(i + 1).padStart(2, '0')}</span>`;
      if (!s.title) return `<li>${n}${richBlocks(s.text)}${noteHtml(s.note, ctx)}</li>`;
      return `<li>${n}<div><h3>${esc(s.title)}</h3>${richBlocks(s.text)}${noteHtml(s.note, ctx)}</div></li>`;
    }).join('\n');
    const after = (d.after || []).length ? `\n<div class="wrap">${flow(d.after, ctx, { pCls: 'note-wide page-v4-aside' })}</div>` : '';
    return section(b, ctx, `<div class="wrap two-col-v4">
<div>${eyebrow(d.eyebrow, num)}<h2 data-reveal="lines">${esc(d.title)}</h2>${richBlocks(d.intro, 'lead')}</div>
<ol class="steps" role="list">${items}</ol>
</div>${after}`);
  },
  'text-columns'(b, d, ctx, num) {
    return section(b, ctx, `<div class="wrap two-col-v4">
<div>${eyebrow(d.eyebrow, num)}<h2 data-reveal="lines">${esc(d.title)}</h2>${richBlocks(d.intro, 'lead')}</div>
<div class="prose-v4">${flow(d.body, ctx)}</div>
</div>`);
  },
  'term-list'(b, d, ctx, num) {
    const prices = d.variant === 'prices';
    const items = d.items.map((it) => {
      if (prices) return `<li><strong>${esc(it.term)}</strong><span${it.tbd ? ' class="price-tbd"' : ''}>${richInline(it.text)}</span>${noteHtml(it.note, ctx, 'span')}</li>`;
      return `<li>${it.term ? `<strong>${esc(it.term)}</strong> ` : ''}${richInline(it.text)}${noteHtml(it.note, ctx, 'span')}</li>`;
    });
    if (d.link && !prices) items.push(`<li>${rollLink(d.link, ctx, 'link-arrow')}</li>`);
    const list = `<ul class="cover-list${prices ? ' price-list' : ''}" role="list">${items.join('\n')}</ul>`;
    const right = prices
      ? `<div class="prose-v4">${list}${flow(d.after, ctx)}${d.link ? rollLink(d.link, ctx, 'link-arrow') : ''}</div>`
      : `${list}${(d.after || []).length ? `<div class="prose-v4">${flow(d.after, ctx)}</div>` : ''}`;
    return section(b, ctx, `<div class="wrap two-col-v4">
<div>${eyebrow(d.eyebrow, num)}<h2 data-reveal="lines">${esc(d.title)}</h2>${richBlocks(d.intro, 'lead')}</div>
${right}
</div>`);
  },
  people(b, d, ctx, num) {
    const people = d.people.map((p) => `<article class="person-v4">
${p.name ? `<h3>${esc(p.name)}</h3>` : ''}${noteHtml(p.note, ctx)}${richBlocks(p.text)}
${p.tag ? `<p class="mono">${esc(p.tag)}</p>` : ''}
${p.button ? btn(p.button, ctx, ' btn-small') : ''}
${p.link ? `<p class="row-links">${rollLink(p.link, ctx)}</p>` : ''}
</article>`).join('\n');
    const why = d.why.length ? `<ul class="why" role="list">${d.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
    return section(b, ctx, `<div class="wrap two-col-v4">
<div>${eyebrow(d.eyebrow, num)}<h2 data-reveal="lines">${esc(d.title)}</h2></div>
<div class="people">${people}${why}</div>
</div>`, { attrs: d.dots ? ' data-dots' : '' });
  },
  profile(b, d, ctx, num) {
    const photo = d.photo
      ? `<figure class="profile-photo">${picture(d.photo, ctx)}</figure>`
      : '<figure class="profile-photo profile-photo-empty" aria-hidden="true"><img src="/assets/img/logo-icon.webp" alt="" width="240" height="240" loading="lazy"></figure>';
    const items = d.items.length ? `<ul class="cover-list" role="list">${d.items.map((it) => `<li>${it.term ? `<strong>${esc(it.term)}</strong> ` : ''}${richInline(it.text)}${noteHtml(it.note, ctx, 'span')}</li>`).join('\n')}</ul>` : '';
    return section(b, ctx, `<div class="wrap profile-v4">
${photo}
<div class="profile-body">
${eyebrow(d.eyebrow, num)}<h2 data-reveal="lines">${esc(d.title)}</h2>
${d.languages ? `<p class="area-who mono">${esc(d.languages)}</p>` : ''}
${items}
${d.button ? btn(d.button, ctx, ' btn-small') : ''}
${d.links.length ? `<p class="row-links">${d.links.map((l) => rollLink(l, ctx)).join(' ')}</p>` : ''}
</div>
</div>`);
  },
  trio(b, d, ctx, num) {
    return section(b, ctx, `<div class="wrap">
${eyebrow(d.eyebrow, num)}<h2 class="h-wide" data-reveal="lines">${esc(d.title)}</h2>
<ul class="trio" role="list">${d.items.map((it) => `<li><h3>${esc(it.title)}</h3><p>${richInline(it.text)}</p></li>`).join('\n')}</ul>
${d.after.p.length ? `<p class="note-wide">${richInline(d.after)}</p>` : ''}
</div>`);
  },
  'text-narrow'(b, d, ctx, num) {
    const text = d.style === 'light'
      ? `<p class="light-up" data-reveal="light">${richInline(d.text)}</p>`
      : `<p class="lead">${richInline(d.text)}</p>`;
    return section(b, ctx, `<div class="wrap narrow-v4">
${eyebrow(d.eyebrow, num)}<h2 data-reveal="lines">${esc(d.title)}</h2>
${d.text.p.length ? text : ''}
${d.link ? rollLink(d.link, ctx, 'link-arrow') : ''}
</div>`);
  },
  faq(b, d, ctx, num) {
    // A question with no published answer is left out (the editor says so).
    const items = d.items.filter((it) => it.a.p.length || (ctx.notes && it.note))
      .map((it) => `<details><summary>${esc(it.q)}</summary><div class="answer">${richBlocks(it.a)}${noteHtml(it.note, ctx)}</div></details>`).join('\n');
    return section(b, ctx, `<div class="wrap">
${eyebrow(d.eyebrow, num)}<h2 class="h-wide" data-reveal="lines">${esc(d.title)}</h2>
<div class="faq-v4">${items}</div>
</div>`);
  },
  'closing-cta'(b, d, ctx) {
    return section(b, ctx, `<div class="wrap">
<h2 class="h-wide" data-reveal="lines">${esc(d.title)}</h2>
${richBlocks(d.text, 'lead')}
${d.buttons.length ? `<div class="cta-row">${d.buttons.map((x) => btn(x, ctx)).join('\n')}</div>` : ''}
${d.more.p.length ? `<p class="closing-v4-more">${richInline(d.more)}</p>` : ''}
</div>`, { extraClass: ' closing-v4' });
  },
  'booking-widget'(b, d, ctx) { return `${noteHtml(b.note, ctx)}${ctx.render ? ctx.render('booking-widget', b) : ''}`; },
  'request-form'(b, d, ctx, num) { return ctx.render ? ctx.render('request-form', b, num) : ''; },
  'contact-channels'(b, d, ctx) { return ctx.render ? ctx.render('contact-channels', b) : ''; },
};

/** HTML of a page's blocks. Eyebrow numbers ("01 · ") follow the block order. */
export function renderBlocks(blocks, ctx) {
  let counter = 0;
  return blocks.map((b) => {
    const def = BLOCKS[b.type];
    if (!def) return '';
    let num = '';
    if (def.numbered && b.numbered !== false && b.data.eyebrow) {
      counter += 1;
      num = String(counter).padStart(2, '0');
    }
    return RENDER[b.type](b, b.data, ctx, num);
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
