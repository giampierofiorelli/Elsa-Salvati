// Header, footer and studio details: shown on every page, edited once in the admin.
// One record per language (menu labels and footer texts differ) plus one for the studio details
// (phone, email, WhatsApp, company name, VAT), used by both languages and by the contact blocks.

import { cleanData } from './blocks.mjs';
import { richInline, escapeHtml as esc, linkKind } from './richtext.mjs';

const txt = (name, label, o = {}) => ({ name, label, type: 'text', max: 120, ...o });

export const GLOBALS_SCHEMA = {
  header: [
    { name: 'items', label: 'Voci del menu (in quest\'ordine)', type: 'links', max: 8 },
    { name: 'cta', label: 'Pulsante in alto', type: 'button', styles: ['primary'] },
    txt('menuLabel', 'Titolo del menu sul telefono', { max: 40 }),
    txt('skip', 'Link «vai al contenuto» (lettori di schermo)', { max: 60 }),
    txt('brandAria', 'Descrizione del logo (lettori di schermo)', { max: 160 }),
    txt('menuOpen', 'Pulsante del menu: «apri»', { max: 20 }),
    txt('menuClose', 'Pulsante del menu: «chiudi»', { max: 20 }),
  ],
  footer: [
    txt('sign', 'Firma', { max: 80 }),
    { name: 'about', label: 'Frase dello studio', type: 'rich', max: 300, multiline: false },
    { name: 'button', label: 'Pulsante', type: 'button', styles: ['light'] },
    {
      name: 'columns', label: 'Colonne', type: 'list', min: 1, max: 4, itemLabel: 'Colonna',
      fields: [
        txt('title', 'Titolo della colonna', { max: 40 }),
        { name: 'kind', label: 'Tipo', type: 'select', options: [['links', 'Solo link'], ['contacts', 'Recapiti dello studio + link'], ['info', 'Link + cambio lingua']] },
        { name: 'links', label: 'Link', type: 'links', max: 10 },
      ],
    },
    { name: 'emergency', label: 'Avviso: non è un servizio di emergenza', type: 'rich', max: 500, multiline: false, required: true },
    txt('cookieLine', 'Riga sui cookie', { max: 200 }),
  ],
  studio: [
    txt('phone', 'Telefono (come si legge)', { max: 40 }),
    txt('email', 'Email', { max: 120 }),
    txt('whatsapp', 'WhatsApp (numero con prefisso, solo cifre)', { max: 20 }),
    txt('legalName', 'Ragione sociale', { max: 120 }),
    txt('vat', 'Partita IVA', { max: 40 }),
  ],
};

/** Studio details as they are in the settings file before anyone edits them. */
export function defaultStudio(config) {
  return {
    phone: config.contact.phone || '', email: config.contact.email || '', whatsapp: config.contact.whatsapp || '',
    legalName: config.studioLegal || '', vat: config.vat || '',
  };
}

// ---------- reading the starting values from a layout ----------

/**
 * Header and footer of a language as written in its layout file, so the editor starts from
 * exactly what the site shows. `keyOf(path)` turns an internal path into a page key.
 */
export function globalsFromLayout(html, keyOf, render = (s) => s) {
  const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const linkOf = (href, label) => {
    if (href.startsWith('/')) {
      const [path, anchor] = href.split('#');
      if (path === '/prenota/' || path === '/en/book/') return { label, to: { kind: 'book' } };
      const key = keyOf(path);
      if (key) return { label, to: anchor ? { kind: 'page', key, anchor } : { kind: 'page', key } };
    }
    if (linkKind(href) === 'external') return { label, to: { kind: 'url', href } };
    return null;
  };
  const links = (block) => [...block.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .filter((m) => !/^(tel|mailto):/.test(m[1]))
    .map((m) => linkOf(m[1], strip(m[2]))).filter(Boolean);
  const pick = (re) => { const m = html.match(re); return m ? m[1] : ''; };
  // Rich text with bold and links, from a small piece of HTML (only <strong> and <a> appear there).
  const rich = (frag) => {
    const runs = [];
    for (const m of frag.matchAll(/<strong>([\s\S]*?)<\/strong>|<a href="([^"]+)">([\s\S]*?)<\/a>|([^<]+)/g)) {
      if (m[1] !== undefined) runs.push({ t: strip(m[1]), b: true });
      else if (m[2] !== undefined) runs.push({ t: strip(m[3]), href: m[2] });
      else if (m[4] && m[4].trim()) runs.push({ t: m[4].replace(/\s+/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&') });
    }
    return { p: runs.length ? [runs] : [] };
  };
  const nav = pick(/<nav id="menu"[\s\S]*?<ul role="list">([\s\S]*?)<\/ul>/);
  const cta = html.match(/<a class="hdr-cta" href="([^"]+)">([^<]+)</);
  const footer = pick(/<footer[\s\S]*?>([\s\S]*?)<\/footer>/);
  const columns = [...footer.matchAll(/<(nav|div) class="footer-v4-col"[^>]*>\s*<p class="footer-v4-label">([^<]+)<\/p>([\s\S]*?)<\/\1>/g)].map((m) => {
    const body = m[3];
    const kind = /tel:|mailto:/.test(body) ? 'contacts' : /langswitch/.test(body) ? 'info' : 'links';
    return { title: strip(m[2]), kind, links: links(body) };
  });
  const btn = footer.match(/<a class="btn btn-light" href="([^"]+)">([^<]+)</);
  return {
    header: {
      items: links(nav),
      cta: cta ? { ...linkOf(cta[1], strip(cta[2])), style: 'primary' } : null,
      menuLabel: strip(pick(/<p class="eyebrow hdr-nav-label">([^<]*)</)),
      skip: strip(pick(/<a class="skip" href="#contenuto">([^<]*)</)),
      brandAria: pick(/<a class="brand" href="[^"]*" aria-label="([^"]*)"/).replace(/&#39;/g, "'"),
      menuOpen: pick(/data-open="([^"]*)"/), menuClose: pick(/data-close="([^"]*)"/),
    },
    footer: {
      sign: strip(pick(/<p class="footer-v4-sign">([\s\S]*?)<\/p>/)),
      about: { p: [[{ t: strip(render(pick(/<p class="footer-v4-sign">[\s\S]*?<\/p>\s*<p>([\s\S]*?)<\/p>/))) }]] },
      button: btn ? { ...linkOf(btn[1], strip(btn[2])), style: 'light' } : null,
      columns,
      emergency: rich(pick(/<p class="emergency">([\s\S]*?)<\/p>/)),
      cookieLine: strip(pick(/<div class="footer-v4-bottom">[\s\S]*?<\/p>\s*<p>([\s\S]*?)<\/p>/)),
    },
  };
}

// ---------- validation ----------

export function cleanGlobals(scope, data) {
  if (scope === 'studio') {
    const s = cleanData(GLOBALS_SCHEMA.studio, data || {}, 'Dati dello studio');
    if (s.email && !/^[^\s@<>"?&]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.email)) throw new RangeError('Dati dello studio – Email non valida');
    if (s.whatsapp && !/^\d{6,15}$/.test(s.whatsapp)) throw new RangeError('Dati dello studio – WhatsApp: solo cifre, con il prefisso (es. 39333…)');
    return s;
  }
  const d = data || {};
  return {
    header: cleanData(GLOBALS_SCHEMA.header, d.header || {}, 'Intestazione'),
    footer: cleanData(GLOBALS_SCHEMA.footer, d.footer || {}, 'Piè di pagina'),
  };
}

// ---------- rendering (into the layout) ----------

const extAttrs = (to) => (to.kind === 'url' ? ' target="_blank" rel="noopener noreferrer"' : '');

/** ctx: { lang, href(to) -> url, navKeyOf(to) -> data-nav key, nav (current key), langSwitch (html) } */
export function renderHeader(g, ctx) {
  const h = g.header;
  const items = h.items.map((l) => {
    const navKey = ctx.navKeyOf(l.to);
    const current = navKey && navKey === ctx.nav ? ' aria-current="page"' : '';
    return `<li><a href="${esc(ctx.href(l.to))}"${extAttrs(l.to)}${current} data-roll>${esc(l.label)}</a></li>`;
  }).join('\n        ');
  return {
    skip: esc(h.skip || ''),
    brandAria: esc(h.brandAria || ''),
    menuLabel: esc(h.menuLabel || ''),
    items,
    cta: h.cta ? `<a class="hdr-cta" href="${esc(ctx.href(h.cta.to))}"${extAttrs(h.cta.to)}>${esc(h.cta.label)} <svg class="hdr-cta-icon" aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a>` : '',
    menuOpen: esc(h.menuOpen || 'Menu'),
    menuClose: esc(h.menuClose || ''),
  };
}

export function renderFooter(g, studio, ctx) {
  const f = g.footer;
  const link = (l) => `<li><a href="${esc(ctx.href(l.to))}"${extAttrs(l.to)}>${esc(l.label)}</a></li>`;
  const phoneHref = String(studio.phone || '').replace(/[^\d+]/g, '');
  const columns = f.columns.map((c) => {
    const before = c.kind === 'contacts' ? [
      studio.phone ? `<li><a href="tel:${esc(phoneHref)}">${esc(studio.phone)}</a></li>` : '',
      studio.email ? `<li><a href="mailto:${esc(studio.email)}">${esc(studio.email)}</a></li>` : '',
    ].join('') : '';
    const after = c.kind === 'info' ? `<li>${ctx.langSwitch}</li>` : '';
    return `<div class="footer-v4-col">
      ${c.title ? `<p class="footer-v4-label">${esc(c.title)}</p>` : ''}
      <ul role="list">${before}${c.links.map(link).join('')}${after}</ul>
    </div>`;
  }).join('\n    ');
  const vatLabel = ctx.lang === 'en' ? 'VAT no.' : 'P.IVA';
  return `<div class="wrap footer-v4-grid">
    <div class="footer-v4-brand">
      ${f.sign ? `<p class="footer-v4-sign">${esc(f.sign)}</p>` : ''}
      ${f.about.p.length ? `<p>${richInline(f.about)}</p>` : ''}
      ${f.button ? `<a class="btn btn-light" href="${esc(ctx.href(f.button.to))}"${extAttrs(f.button.to)}>${esc(f.button.label)}</a>` : ''}
    </div>
    ${columns}
  </div>
  <div class="wrap">
    <p class="emergency">${richInline(f.emergency)}</p>
    <div class="footer-v4-bottom">
      <p>© ${ctx.year || new Date().getFullYear()} ${esc(studio.legalName || '')}${studio.vat ? ` · ${vatLabel} ${esc(studio.vat)}` : ''}</p>
      ${f.cookieLine ? `<p>${esc(f.cookieLine)}</p>` : ''}
    </div>
  </div>`;
}
