// Static site build: pages in src/pages (with a small front matter) are wrapped
// in the shared layout and filled with data from src/site.config.json.
// Output: dist/. No framework, no runtime JavaScript besides the booking/admin apps.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const out = join(root, 'dist');
const config = JSON.parse(readFileSync(join(src, 'site.config.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isPlaceholder = (s) => typeof s === 'string' && /\[[^\]]+\]/.test(s);

function get(path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), config);
}

// ---------- components available in pages as {{@name}} ----------

const arrow = '<svg class="icon" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M4.5 11.5l7-7M6 4.5h5.5V10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const arrowRight = '<svg class="icon" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const components = {
  arrow: () => arrow,
  arrowRight: () => arrowRight,
  trustline: () => `<p class="trustline">Iscritta all'Ordine degli Psicologi della ${esc(config.alboRegion)}, n. ${esc(config.alboNumber)} · Colloqui in studio a ${esc(config.city)} e online</p>`,
  areaCards: () => `<ul class="cards" role="list">${config.areas.map((a) => `
    <li class="card">
      <a class="card-link" href="/aree/${a.slug}/">
        <h3>${esc(a.title)}</h3>
        <p>${esc(a.short)}</p>
        <span class="card-more">Approfondisci ${arrowRight}</span>
      </a>
    </li>`).join('')}
  </ul>`,
  areaList: () => config.areas.map((a) => `<li><a href="/aree/${a.slug}/">${esc(a.title)}</a></li>`).join(''),
  education: () => config.education.map((e) => `<li>${esc(e)}</li>`).join(''),
  practical: () => `<dl class="practical">
      <div><dt>Primo colloquio</dt><dd>${esc(config.fees.firstSession)} · ${esc(config.fees.sessionMinutes)} minuti</dd></div>
      <div><dt>Sedute successive</dt><dd>${esc(config.fees.session)} · ${esc(config.fees.sessionMinutes)} minuti</dd></div>
      <div><dt>Dove</dt><dd>In studio a ${esc(config.city)} (${esc(config.studio.neighbourhood)}) e online</dd></div>
      <div><dt>Cancellazioni</dt><dd>${esc(config.fees.cancellation)}</dd></div>
    </dl>`,
  cta: () => `<div class="cta-row">
      <a class="btn btn-primary" href="/prenota/">Verifica disponibilità ${arrow}</a>
      <a class="btn btn-ghost" href="/primo-colloquio/">Come funziona il primo colloquio</a>
    </div>`,
  closing: () => `<section class="closing" aria-labelledby="closing-title">
      <div class="wrap">
        <h2 id="closing-title">Fare il primo passo può essere semplice.</h2>
        <p>Scegli un orario libero per il primo colloquio, oppure chiedimi di ricontattarti: non serve raccontare nulla della tua situazione per prenotare.</p>
        <div class="cta-row">
          <a class="btn btn-light" href="/prenota/">Prenota un primo colloquio ${arrow}</a>
          <a class="btn btn-outline-light" href="/contatti/">Fai una domanda</a>
        </div>
      </div>
    </section>`,
  whatsapp: () => `https://wa.me/${esc(config.contact.whatsapp)}?text=${encodeURIComponent('Buongiorno, vorrei alcune informazioni pratiche.')}`,
};

function render(template, extra = {}) {
  return template
    .replace(/\{\{@(\w+)\}\}/g, (_, name) => {
      if (!components[name]) throw new Error(`componente sconosciuto: ${name}`);
      return components[name]();
    })
    .replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
      const v = key in extra ? extra[key] : get(key);
      if (v === undefined) throw new Error(`valore mancante: ${key}`);
      return esc(v);
    });
}

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

// ---------- structured data (only real values, never placeholders) ----------

function jsonLd() {
  const person = {
    '@type': 'Person',
    name: config.professionalName,
    jobTitle: isPlaceholder(config.titleLong) ? config.title : config.titleLong,
  };
  const business = { '@type': 'LocalBusiness', name: config.professionalName };
  if (!isPlaceholder(config.siteUrl)) business.url = config.siteUrl;
  if (!isPlaceholder(config.contact.phone)) business.telephone = config.contact.phone;
  if (!isPlaceholder(config.studio.address)) business.address = config.studio.address;
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': [person, business] }).replace(/</g, '\\u003c');
}

// ---------- layout ----------

const layout = readFileSync(join(src, 'partials/layout.html'), 'utf8');

function page(meta, body, path) {
  const canonical = isPlaceholder(config.siteUrl) ? '' : `<link rel="canonical" href="${esc(config.siteUrl.replace(/\/$/, '') + path)}">`;
  const scripts = (meta.scripts || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => `<script src="/assets/js/${s}.js" defer></script>`).join('\n');
  const nav = meta.nav || '';
  return render(layout, { pageTitle: meta.title, pageDescription: meta.description || '' })
    .replace('<!--canonical-->', canonical)
    .replace('<!--robots-->', meta.noindex === 'true' ? '<meta name="robots" content="noindex, nofollow">' : '')
    .replace('<!--jsonld-->', path === '/' ? `<script type="application/ld+json">${jsonLd()}</script>` : '')
    .replace('<!--scripts-->', scripts)
    .replace(/<a ([^>]*)data-nav="([\w-]+)"/g, (all, attrs, key) => (key === nav ? `<a ${attrs}aria-current="page"` : `<a ${attrs}`))
    .replace('<!--content-->', render(body));
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

const urls = [];
for (const file of walk(join(src, 'pages')).filter((f) => f.endsWith('.html'))) {
  const { meta, body } = parsePage(readFileSync(file, 'utf8'));
  if (meta.template === 'area') {
    for (const area of config.areas) {
      const path = `/aree/${area.slug}/`;
      const filled = body.replaceAll('{{area.title}}', esc(area.title)).replaceAll('{{area.short}}', esc(area.short));
      const title = render(meta.title.replaceAll('{{area.title}}', area.title));
      write(path, page({ ...meta, title, description: area.short }, filled, path));
      urls.push(path);
    }
    continue;
  }
  const path = meta.path;
  const html = page({ ...meta, title: render(meta.title), description: render(meta.description || '') }, body, path);
  write(path === '/404' ? '404.html' : path, html);
  if (meta.noindex !== 'true' && path !== '/404') urls.push(path);
}

// Admin app: standalone page, not indexed.
cpSync(join(src, 'admin'), join(out, 'admin'), { recursive: true });

const base = isPlaceholder(config.siteUrl) ? '' : config.siteUrl.replace(/\/$/, '');
write('robots.txt', `User-agent: *\nDisallow: /admin/\nDisallow: /prenota/gestisci/\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ''}`);
if (base) {
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.sort().map((u) => `  <url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
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
console.log(`Sito generato in dist/ (${urls.length} pagine indicizzabili).`);
if (pending.length) {
  console.log(`Attenzione: ${pending.length} dati segnaposto da completare in src/site.config.json:\n  ${pending.join('\n  ')}`);
}
