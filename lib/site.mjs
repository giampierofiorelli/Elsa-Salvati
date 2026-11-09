// Page assembly shared by the static build and the function that serves editable pages:
// the layout of each language, {{…}} placeholders, language switch, hreflang, robots.

import { renderBlocks, scriptsFor } from './blocks.mjs';
import { richBlocks, richInline, richText } from './richtext.mjs';
import { renderHeader, renderFooter } from './globals.mjs';

export const LANGS = ['it', 'en'];
export const LANG_INFO = {
  it: { name: 'Italiano', locale: 'it_IT', switchTo: 'Read in English' },
  en: { name: 'English', locale: 'en_GB', switchTo: 'Leggi in italiano' },
};
// Where the language switch goes when a page has no equivalent: the nearest section
// ("how we can help"), never the home page.
const FALLBACK_KEY = 'servizi';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const isPlaceholder = (s) => typeof s === 'string' && /\[[^\]]+\]/.test(s);
// Localised field of a catalogue item: English if present, else the Italian one.
const tr = (obj, field, lang) => (lang === 'en' && obj[field + 'En']) || obj[field];

const arrowRight = '<svg class="icon" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * config: site.config.json · layouts: { it, en } layout HTML · catalog: areas/services/professionals
 * demo: true = never indexed · hashes: { '/assets/css/style.css': 'abc123', … } for cache busting
 */
/** Settings with the studio details edited in the admin (phone, email, WhatsApp, company name, VAT). */
function withStudio(config, studio) {
  if (!studio) return config;
  const phoneHref = String(studio.phone || '').replace(/[^\d+]/g, '');
  return {
    ...config,
    studioLegal: studio.legalName || config.studioLegal,
    vat: studio.vat || config.vat,
    contact: { ...config.contact, phone: studio.phone || config.contact.phone, phoneHref: phoneHref || config.contact.phoneHref, email: studio.email || config.contact.email, whatsapp: studio.whatsapp || config.contact.whatsapp },
  };
}

/**
 * globals: { it: { header, footer }, en: { header, footer }, studio } — the editable header, footer and studio details.
 * year: the year shown in the footer (today's year in Rome when omitted).
 */
// noindexAll: previews and staging are never indexed (only production is); demo: the same, for local copies.
export function createSite({ config: baseConfig, layouts, catalog, demo = false, hashes = {}, specials = {}, globals = null, year = null, siteUrl = '', noindexAll = false }) {
  const config = withStudio(baseConfig, globals && globals.studio);
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), config);
  const base = (siteUrl || (isPlaceholder(config.siteUrl) ? '' : String(config.siteUrl || ''))).replace(/\/$/, '');
  const abs = (path) => base + path;

  // Components available in hand-written pages and special blocks as {{@name}}.
  const components = {
    needOptions: () => config.needs.map((n) => (n.categories.length
      ? `<button type="button" class="choice" data-need="${esc(n.slug)}" data-cats="${esc(n.categories.join(','))}" aria-pressed="false"><strong>${esc(n.label)}</strong><span>${esc(n.text)}</span></button>`
      : `<a class="choice" href="${esc(n.href)}#contatto"><strong>${esc(n.label)}</strong><span>${esc(n.text)} ${arrowRight}</span></a>`)).join('')
      + '<button type="button" class="choice" data-need="tutti" data-cats="da-scegliere" aria-pressed="false"><strong>Non lo so ancora</strong><span>Un primo colloquio per capire insieme quale percorso fa per te.</span></button>'
      + '<p class="need-alt">Per un\'organizzazione preferisci scriverci? <a href="/aziende/#contatto">Modulo per le organizzazioni</a></p>',
    needOptionsEn: () => config.needs.map((n) => (n.categories.length
      ? `<button type="button" class="choice" data-need="${esc(n.slug)}" data-cats="${esc(n.categories.join(','))}" aria-pressed="false"><strong>${esc(n.labelEn || n.label)}</strong><span>${esc(n.textEn || n.text)}</span></button>`
      : `<a class="choice" href="/en/organisations/#contact"><strong>${esc(n.labelEn || n.label)}</strong><span>${esc(n.textEn || n.text)} ${arrowRight}</span></a>`)).join('')
      + '<button type="button" class="choice" data-need="tutti" data-cats="da-scegliere" aria-pressed="false"><strong>Not sure yet</strong><span>That\'s fine: in the free first meeting we work out together which path to take.</span></button>'
      + '<p class="need-alt">Writing for an organisation and prefer to send a message? <a href="/en/organisations/#contact">Form for organisations</a></p>',
    categoryOptions: (ctx) => catalog.categories.filter((c) => !['da-scegliere', 'aziende'].includes(c.slug)).map((c) => `<option value="${esc(c.slug)}">${esc(tr(c, 'name', ctx.lang))}</option>`).join(''),
  };

  function render(template, extra = {}, ctx = {}) {
    return template
      .replace(/\{\{@(\w+)\}\}/g, (_, name) => {
        if (!components[name]) throw new Error(`componente sconosciuto: ${name}`);
        return components[name](ctx);
      })
      .replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
        const v = key in extra ? extra[key] : get(key);
        if (v === undefined) throw new Error(`valore mancante: ${key}`);
        return esc(v);
      });
  }

  // key -> { it: path, en: path }: which pages are equivalent across the two sites.
  const equivalents = new Map();
  const navs = new Map(); // key -> { it: navKey, en: navKey }: which menu item a page belongs to
  function register(key, lang, path, nav) {
    if (!equivalents.has(key)) equivalents.set(key, {});
    equivalents.get(key)[lang] = path;
    if (nav) { if (!navs.has(key)) navs.set(key, {}); navs.get(key)[lang] = nav; }
  }
  const pathOf = (key, lang) => (equivalents.get(key) || {})[lang] || null;
  function counterpart(key, lang, fallback) {
    const other = lang === 'it' ? 'en' : 'it';
    const eq = equivalents.get(key) || {};
    if (eq[other]) return { path: eq[other], exact: true };
    const fb = equivalents.get(fallback || FALLBACK_KEY) || {};
    return { path: fb[other] || (other === 'en' ? '/en/' : '/'), exact: false };
  }

  // ---------- structured data (schema.org JSON-LD), from the settings, the catalogue and the page ----------
  // Only real values: anything still a placeholder ([P.IVA], [email]…) or empty is left out.
  const real = (v) => v !== undefined && v !== null && v !== '' && !isPlaceholder(v) && !(Array.isArray(v) && !v.length);
  function prune(o) {
    if (Array.isArray(o)) return o.map(prune).filter(real);
    if (o && typeof o === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(o)) { const c = prune(v); if (real(c) && !(typeof c === 'object' && !Array.isArray(c) && !Object.keys(c).length)) out[k] = c; }
      return out;
    }
    return o;
  }
  const shortTitle = (t) => String(t || '').split(/ [–|] /)[0].trim();
  function structuredData(meta, path, lang) {
    const id = (frag) => `${base || ''}/#${frag}`;
    const org = {
      '@type': 'Organization', '@id': id('organization'),
      name: config.studioFullName, alternateName: config.studioName,
      url: base ? abs(lang === 'en' ? '/en/' : '/') : undefined,
      logo: base ? abs(`/assets/img/logos/${config.logo || 'classico'}/icon.webp`) : undefined,
      description: lang === 'en' ? config.studioTaglineEn : config.studioTagline,
      email: config.contact.email, telephone: config.contact.phone, vatID: config.vat,
      areaServed: { '@type': 'Country', name: lang === 'en' ? 'Italy' : 'Italia' },
      knowsLanguage: ['it', 'en'],
    };
    const graph = [org];
    const home = path === '/' || path === '/en/';
    if (home) {
      graph.push({ '@type': 'WebSite', '@id': id(`website-${lang}`), url: base ? abs(path) : undefined, name: config.studioName, inLanguage: lang, publisher: { '@id': org['@id'] } });
    }
    const teamPath = pathOf('team', lang);
    // People are named only on «Chi siamo» (decision 2026-11-09): Person entries only there.
    if (meta.key === 'team') {
      for (const m of catalog.professionals || []) {
        if (!real(m.name)) continue;
        graph.push({
          '@type': 'Person', name: m.name, jobTitle: tr(m, 'title', lang),
          knowsLanguage: m.languages, worksFor: { '@id': org['@id'] },
          url: base && teamPath ? abs(teamPath) : undefined,
          // The register only where the record is filled in with real data.
          memberOf: real(m.albo) ? { '@type': 'Organization', name: m.albo } : undefined,
        });
      }
    }
    if (meta.key === 'servizi') {
      for (const c of catalog.categories || []) {
        if (['da-scegliere'].includes(c.slug)) continue;
        graph.push({ '@type': 'Service', name: tr(c, 'name', lang), description: tr(c, 'intro', lang), provider: { '@id': org['@id'] }, areaServed: org.areaServed, availableChannel: { '@type': 'ServiceChannel', serviceUrl: base ? abs(path) : undefined } });
      }
    }
    if (Array.isArray(meta.faq) && meta.faq.length) {
      graph.push({ '@type': 'FAQPage', mainEntity: meta.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
    }
    if (!home && base) {
      graph.push({ '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: abs(lang === 'en' ? '/en/' : '/') },
        { '@type': 'ListItem', position: 2, name: shortTitle(meta.title), item: abs(path) },
      ] });
    }
    return JSON.stringify({ '@context': 'https://schema.org', '@graph': prune(graph) }).replace(/</g, '\\u003c');
  }

  // Where a link of the header or footer goes, in the page's language.
  function hrefFor(to, lang) {
    switch (to && to.kind) {
      case 'page': return (pathOf(to.key, lang) || (lang === 'en' ? '/en/' : '/')) + (to.anchor ? `#${to.anchor}` : '');
      case 'anchor': return `#${to.anchor}`;
      case 'book': { const b = lang === 'en' ? '/en/book/' : '/prenota/'; return to.pro ? `${b}?professionista=${encodeURIComponent(to.pro)}` : b; }
      case 'url': return to.href;
      default: return '#';
    }
  }

  function fillGlobals(html, lang, nav, langSwitch) {
    const g = globals && globals[lang];
    if (!g) return html;
    const studio = (globals && globals.studio) || {};
    const gctx = { lang, nav, langSwitch, href: (to) => hrefFor(to, lang), navKeyOf: (to) => (to && to.kind === 'page' ? (navs.get(to.key) || {})[lang] || null : null), year };
    const h = renderHeader(g, gctx);
    return html
      .replace('<!--g:skip-->', h.skip)
      .replace('<!--g:brandAria-->', h.brandAria)
      .replace('<!--g:menuLabel-->', h.menuLabel)
      .replace('<!--g:items-->', () => h.items)
      .replace('<!--g:cta-->', () => h.cta)
      .replace(/<!--g:menuOpen-->/g, h.menuOpen)
      .replace('<!--g:menuClose-->', h.menuClose)
      .replace('<!--g:footer-->', () => renderFooter(g, studio, gctx));
  }

  /** Social sharing tags: page address and image (absolute addresses, as the social networks require). */
  function ogTags(meta, path) {
    const tags = [`<meta property="og:site_name" content="${esc(config.studioName)}">`];
    if (base) tags.push(`<meta property="og:url" content="${esc(abs(path))}">`);
    const img = meta.seo && meta.seo.image;
    if (img && base) {
      const url = img.id.startsWith('static-') ? `/assets/img/${img.id.slice(7)}-1200x630.jpg` : `/media/${img.id}-1200x630.jpg`;
      tags.push(`<meta property="og:image" content="${esc(abs(url))}">`, '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">');
      if (img.alt) tags.push(`<meta property="og:image:alt" content="${esc(img.alt)}">`);
      tags.push('<meta name="twitter:card" content="summary_large_image">');
    } else {
      tags.push('<meta name="twitter:card" content="summary">');
    }
    return tags.join('\n');
  }

  /** Full HTML page. `body` is already rendered; `meta` = { title, description, key, nav, noindex, fallback, scripts, seo }. */
  function page(meta, body, path, ctx = {}) {
    const lang = ctx.lang || 'it';
    const other = lang === 'it' ? 'en' : 'it';
    const canonical = base ? `<link rel="canonical" href="${esc(abs(path))}">` : '';
    const alt = counterpart(meta.key, lang, meta.fallback);
    // hreflang only between true equivalents; x-default = the English page.
    const eq = equivalents.get(meta.key) || {};
    const ownNoindex = meta.noindex === 'true' || meta.noindex === true || !!(meta.seo && meta.seo.noindex);
    const noindex = ownNoindex || noindexAll;
    // Alternates describe the production site: kept on previews too (they are not indexed anyway).
    const hreflang = alt.exact && !ownNoindex
      ? [...LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(abs(eq[l]))}">`),
        `<link rel="alternate" hreflang="x-default" href="${esc(abs(eq.en))}">`].join('\n')
      : '';
    // The Italian home is linked as /?lang=it so the browser-language redirect never applies.
    const switchHref = alt.path === '/' ? '/?lang=it' : alt.path;
    const langSwitch = `<a class="lang-switch" href="${esc(switchHref)}" hreflang="${other}" lang="${other}" data-lang-switch="${other}"${alt.exact ? ' data-lang-exact' : ''}>${esc(LANG_INFO[lang].switchTo)}</a>`;
    const scripts = (Array.isArray(meta.scripts) ? meta.scripts : String(meta.scripts || '').split(',')).map((s) => s.trim()).filter(Boolean)
      .map((s) => `<script src="/assets/js/${s}.js" defer></script>`).join('\n');
    const nav = meta.nav || '';
    return fillGlobals(render(layouts[lang], { pageTitle: meta.title, pageDescription: meta.description || '' }), lang, nav, langSwitch)
      .replace('<!--og-->', () => ogTags(meta, path))
      .replace('<!--canonical-->', canonical)
      .replace('<!--hreflang-->', hreflang)
      .replace(/<!--langswitch-->/g, langSwitch)
      .replace('<!--robots-->', noindex || demo ? '<meta name="robots" content="noindex, nofollow">' : '')
      .replace('<!--demo-->', '')
      .replace('<!--jsonld-->', ownNoindex ? '' : `<script type="application/ld+json">${structuredData(meta, path, lang)}</script>`)
      .replace('<!--scripts-->', scripts)
      .replace(/<a ([^>]*)data-nav="([\w-]+)"/g, (all, attrs, key) => (key === nav ? `<a ${attrs}aria-current="page"` : `<a ${attrs}`))
      .replace('<!--content-->', () => (ctx.raw ? body : render(body, {}, ctx)));
  }

  /** Logo of the settings and cache-busting versions (?v=hash) on asset URLs. */
  function finalize(html) {
    const logo = config.logo || 'classico';
    let out = html.replaceAll('/assets/img/logo-icon-light.webp', `/assets/img/logos/${logo}/icon-light.webp`)
      .replaceAll('/assets/img/logo-icon.webp', `/assets/img/logos/${logo}/icon.webp`);
    for (const [u, h] of Object.entries(hashes)) out = out.replaceAll(`"${u}"`, `"${u}?v=${h}"`);
    return out;
  }

  // ---------- pages made of blocks ----------
  // Images: uploaded ones are served from /media/; "static-<name>" ones are files in /assets/img/.
  const imageUrl = (id, w, ext = 'webp') => (id.startsWith('static-')
    ? `/assets/img/${id.slice(7)}-${w}.${ext}`
    : `/media/${id}-${w}.${ext}`);

  // Special blocks come from fixed templates (src/partials/special/*.html): <!--id-->, <!--bg-->,
  // <!--head--> and the like are filled with what the editor saved.
  function special(type, block, num, ctx) {
    const lang = ctx.lang;
    const d = block.data || {};
    const key = type === 'request-form' ? `${type}.${lang}.${d.variant || 'people'}` : `${type}.${lang}`;
    const tpl = specials[key];
    if (!tpl) throw new Error(`modello del blocco speciale mancante: ${key}`);
    const head = [
      d.eyebrow ? `<p class="eyebrow">${num ? `${num} · ` : ''}${esc(d.eyebrow)}</p>` : '',
      d.title ? `<h2 data-reveal="lines">${esc(d.title)}</h2>` : '',
      d.intro ? richBlocks(d.intro) : '',
    ].join('\n');
    const html = tpl
      .replace('<!--id-->', block.anchor ? ` id="${esc(block.anchor)}"` : '')
      .replace('<!--bg-->', block.bg === 'soft' ? ' section-soft' : '')
      .replace('<!--head-->', () => head)
      .replace('<!--whatsapp-->', () => (d.whatsapp ? richInline(d.whatsapp) : ''))
      .replace('<!--after-->', () => (d.after ? richInline(d.after) : ''));
    const note = block.note && ctx.notes ? `<p class="draft-note">${esc(block.note)}</p>` : '';
    return note + render(html, {}, { lang });
  }

  /**
   * Full HTML of a page made of blocks. pg = { lang, key, path, title, description, nav, noindex, fallback, blocks }.
   * notes: show internal notes (staging and the editor's preview only). editor: editing marks (preview only).
   */
  function blockPage(pg, { notes = false, editor = false } = {}) {
    // editor: marks every editable field (data-edit-*) for the editor's preview; never for published pages.
    const ctx = { lang: pg.lang, notes, editor, pathOf, imageUrl };
    ctx.render = (type, block, num) => special(type, block, num, ctx);
    // Only these settings tokens can appear in editable text (e.g. the studio's phone in a link).
    const tokens = { 'contact.phone': config.contact.phone, 'contact.phoneHref': config.contact.phoneHref, 'contact.email': config.contact.email, 'contact.hours': config.contact.hours, studioName: config.studioName };
    const body = renderBlocks(pg.blocks, ctx).replace(/\{\{(contact\.phone|contact\.phoneHref|contact\.email|contact\.hours|studioName)\}\}/g, (_, k) => esc(tokens[k] ?? ''));
    // Questions with a published answer, for the FAQPage structured data.
    const faq = (pg.blocks || []).filter((bl) => bl.type === 'faq').flatMap((bl) => ((bl.data && bl.data.items) || [])
      .filter((it) => it.q && it.a && it.a.p && it.a.p.length).map((it) => ({ q: it.q, a: richText(it.a) })));
    const meta = { title: pg.title, description: pg.description || '', key: pg.key, nav: pg.nav || '', noindex: !!pg.noindex, fallback: pg.fallback, scripts: scriptsFor(pg.blocks), seo: pg.seo || null, faq };
    return page(meta, body, pg.path, { lang: pg.lang, raw: true });
  }

  return { blockPage, render, page, finalize, register, pathOf, counterpart, equivalents, base, abs, get, imageUrl, special, hrefFor };
}
