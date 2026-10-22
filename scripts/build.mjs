// Static site build: pages in src/pages (with a small front matter) are wrapped
// in the shared layout and filled with data from src/site.config.json.
// Output: dist/. No framework, no runtime JavaScript besides the booking/admin apps.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const out = join(root, 'dist');
const config = JSON.parse(readFileSync(join(src, 'site.config.json'), 'utf8'));
// Preview mode (SITE_DEMO=true): visible banner, not indexed by search engines.
const demo = process.env.SITE_DEMO === 'true';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isPlaceholder = (s) => typeof s === 'string' && /\[[^\]]+\]/.test(s);

function get(path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), config);
}

// ---------- components available in pages as {{@name}} ----------

const arrow = '<svg class="icon" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M4.5 11.5l7-7M6 4.5h5.5V10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const arrowRight = '<svg class="icon" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const svcByKey = Object.fromEntries(config.services.map((sv) => [sv.key, sv]));

function personCard(m) {
  const img = m.photo
    ? `<picture>
          <source type="image/webp" srcset="/assets/img/${m.photo}-480.webp 480w, /assets/img/${m.photo}-800.webp 800w" sizes="(min-width: 900px) 280px, 100vw">
          <img src="/assets/img/${m.photo}-800.jpg" alt="${esc(m.name)}" width="800" height="1067" loading="lazy">
        </picture>`
    : `<div class="person-placeholder" aria-hidden="true"><img src="/assets/img/logo-icon.webp" alt="" width="147" height="112"></div>`;
  const tags = m.services.map((k) => `<span class="tag">${esc(svcByKey[k] ? svcByKey[k].title : k)}</span>`).join(' ');
  return `<li class="person">
      <div class="person-photo">${img}</div>
      <div class="person-body">
        <h3>${esc(m.name)}</h3>
        <p class="person-role">${esc(m.role)}</p>
        <p>${esc(m.focus)}</p>
        <p class="person-meta">${tags}</p>
        <p class="person-albo">Iscritta/o all'${esc(config.albo)}, n. ${esc(m.albo)}</p>
      </div>
    </li>`;
}

const components = {
  arrow: () => arrow,
  arrowRight: () => arrowRight,
  heroArt: () => `<div class="hero-art" aria-hidden="true">
        <svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice">
          <rect width="400" height="500" fill="#CDEFE2"/>
          <circle cx="320" cy="90" r="140" fill="#E6F6EF"/>
          <circle cx="60" cy="440" r="170" fill="#8FBFB3" opacity=".45"/>
        </svg>
        <img src="/assets/img/logo-icon.webp" alt="" width="147" height="112">
      </div>`,
  trustline: () => `<p class="trustline">Studio associato a ${esc(config.city)} · Psicologi e psicoterapeuti iscritti all'${esc(config.albo)} · In studio e online</p>`,
  serviceCards: () => `<ul class="services" role="list">${config.services.map((sv) => `
    <li class="service-card">
      <p class="eyebrow">${esc(sv.audience)}</p>
      <h3>${esc(sv.title)}</h3>
      <p>${esc(sv.short)}</p>
      <ul class="service-areas" role="list">${sv.areas.map((a) => `<li>${esc(a.title)}</li>`).join('')}</ul>
      <a class="btn btn-ghost btn-small" href="/servizi/${sv.slug}/">Scopri il percorso ${arrowRight}</a>
    </li>`).join('')}
  </ul>`,
  team: () => `<ul class="team" role="list">${config.team.map(personCard).join('')}</ul>`,
  serviceAreas: (ctx) => `<div class="area-list">${ctx.service.areas.map((a) => `
      <div class="area-item"><h3>${esc(a.title)}</h3><p>${esc(a.short)}</p></div>`).join('')}
    </div>`,
  serviceTeam: (ctx) => `<ul class="team" role="list">${config.team.filter((m) => m.services.includes(ctx.service.key)).map(personCard).join('')}</ul>`,
  serviceFee: (ctx) => esc(config.fees[ctx.service.key]),
  serviceExtra: (ctx) => (ctx.service.key === 'coaching' ? `<h2>Per le imprese</h2>
      <p>Progettiamo interventi su misura per aziende e organizzazioni: benessere organizzativo, gestione dello stress, sportello di ascolto, percorsi di coaching per responsabili e team. Il primo incontro serve a capire bisogni e obiettivi e a preparare un preventivo.</p>
      <p><a class="btn btn-ghost btn-small" href="/contatti/">Richiedi un incontro per la tua azienda ${arrowRight}</a></p>` : `<h2>Orientamenti diversi, un'unica attenzione</h2>
      <p>Nello studio lavorano psicoterapeuti con orientamenti diversi. Durante il primo colloquio capiamo insieme la tua richiesta e, se utile, ti indichiamo il collega più adatto.</p>`),
  practical: () => `<dl class="practical">
      <div><dt>Psicoterapia individuale</dt><dd>${esc(config.fees.psicoterapia)} · ${esc(config.fees.sessionMinutes)} minuti</dd></div>
      <div><dt>Business coaching individuale</dt><dd>${esc(config.fees.coaching)} · ${esc(config.fees.sessionMinutes)} minuti</dd></div>
      <div><dt>Consulenza per le imprese</dt><dd>${esc(config.fees.aziende)}</dd></div>
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
        <p>Scegli un orario libero per il primo colloquio, oppure chiedici di ricontattarti: non serve raccontare nulla della tua situazione per prenotare.</p>
        <div class="cta-row">
          <a class="btn btn-light" href="/prenota/">Prenota un primo colloquio ${arrow}</a>
          <a class="btn btn-outline-light" href="/contatti/">Fai una domanda</a>
        </div>
      </div>
    </section>`,
  whatsapp: () => `https://wa.me/${esc(config.contact.whatsapp)}?text=${encodeURIComponent('Buongiorno, vorrei alcune informazioni pratiche.')}`,
  serviceOptions: () => config.services.map((sv) => `<option value="${sv.key}">${esc(sv.title)}</option>`).join(''),
  serviceButtons: () => config.services.map((sv, i) => `<button type="button" data-service-btn="${sv.key}" aria-pressed="${i === 0}">${esc(sv.title)}</button>`).join(''),
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
  const people = config.team.filter((m) => !isPlaceholder(m.name)).map((m) => ({ '@type': 'Person', name: m.name, jobTitle: m.role }));
  const business = { '@type': 'LocalBusiness', name: config.studioFullName };
  if (!isPlaceholder(config.siteUrl)) business.url = config.siteUrl;
  if (!isPlaceholder(config.contact.phone)) business.telephone = config.contact.phone;
  if (!isPlaceholder(config.studio.address)) business.address = config.studio.address;
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': [business, ...people] }).replace(/</g, '\\u003c');
}

// ---------- layout ----------

const layout = readFileSync(join(src, 'partials/layout.html'), 'utf8');

function page(meta, body, path, ctx = {}) {
  const canonical = isPlaceholder(config.siteUrl) ? '' : `<link rel="canonical" href="${esc(config.siteUrl.replace(/\/$/, '') + path)}">`;
  const scripts = (meta.scripts || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => `<script src="/assets/js/${s}.js" defer></script>`).join('\n');
  const nav = meta.nav || '';
  return render(layout, { pageTitle: meta.title, pageDescription: meta.description || '' })
    .replace('<!--canonical-->', canonical)
    .replace('<!--robots-->', meta.noindex === 'true' || demo ? '<meta name="robots" content="noindex, nofollow">' : '')
    .replace('<!--demo-->', demo ? '<div class="demo-banner" role="note">Anteprima dimostrativa: testi e dati tra [parentesi] sono provvisori, gli appuntamenti sono di prova.</div>' : '')
    .replace('<!--jsonld-->', path === '/' ? `<script type="application/ld+json">${jsonLd()}</script>` : '')
    .replace('<!--scripts-->', scripts)
    .replace(/<a ([^>]*)data-nav="([\w-]+)"/g, (all, attrs, key) => (key === nav ? `<a ${attrs}aria-current="page"` : `<a ${attrs}`))
    .replace('<!--content-->', render(body, {}, ctx));
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
  if (meta.template === 'service') {
    for (const service of config.services) {
      const path = `/servizi/${service.slug}/`;
      const fill = (t) => t.replaceAll('{{svc.title}}', esc(service.title)).replaceAll('{{svc.short}}', esc(service.short)).replaceAll('{{svc.audience}}', esc(service.audience)).replaceAll('{{svc.key}}', esc(service.key));
      const title = render(fill(meta.title));
      write(path, page({ ...meta, title, description: service.short }, fill(body), path, { service }));
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

// Cache busting: assets are cached for a week, so every CSS/JS reference gets
// ?v=<content hash>. A changed file gets a new URL and phones fetch it at once.
const versioned = ['/assets/css/style.css', '/assets/js/site.js', '/assets/js/booking.js', '/admin/admin.css', '/admin/admin.js'];
const hashes = Object.fromEntries(versioned.map((u) => [u, createHash('sha256').update(readFileSync(join(out, u))).digest('hex').slice(0, 10)]));
for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
  let html = readFileSync(file, 'utf8');
  for (const [u, h] of Object.entries(hashes)) html = html.replaceAll(`"${u}"`, `"${u}?v=${h}"`);
  writeFileSync(file, html);
}

const base = isPlaceholder(config.siteUrl) ? '' : config.siteUrl.replace(/\/$/, '');
write('robots.txt', demo ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /admin/\nDisallow: /prenota/gestisci/\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ''}`);
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
