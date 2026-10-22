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

// Services and professionals come from the database (managed in /admin/).
// Without DATABASE_URL (local build) the demo catalogue in the config is used.
async function readCatalog() {
  if (!process.env.DATABASE_URL) return { source: 'demo', ...config.demoCatalog, professionals: proList(config.demoCatalog) };
  const { createSql, createStore } = await import('../lib/db.mjs');
  const { loadCatalog } = await import('../lib/public-api.mjs');
  const sql = createSql();
  try {
    // A stuck connection must not hang the build: give up after 30 s.
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout dopo 30 s')), 30000).unref());
    return { source: 'database', ...(await Promise.race([loadCatalog(createStore(sql)), timeout])) };
  } catch (err) {
    // Keep the site online with the demo catalogue; the cause is in the build log.
    console.error(`Catalogo dal database non disponibile: ${err.code || ''} ${err.message}`);
    return { source: 'demo (database non raggiungibile)', ...config.demoCatalog, professionals: proList(config.demoCatalog) };
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}
function proList(cat) {
  const map = new Map();
  for (const c of cat.categories) for (const sv of c.services) for (const p of sv.professionals) {
    if (!map.has(p.id)) map.set(p.id, { ...p, services: [] });
    map.get(p.id).services.push({ id: sv.id, name: sv.name, category: sv.category, slug: sv.slug });
  }
  return [...map.values()];
}
const catalog = await readCatalog();
const allServices = catalog.categories.flatMap((c) => c.services);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isPlaceholder = (s) => typeof s === 'string' && /\[[^\]]+\]/.test(s);

function get(path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), config);
}

// ---------- components available in pages as {{@name}} ----------

const arrow = '<svg class="icon" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M4.5 11.5l7-7M6 4.5h5.5V10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const arrowRight = '<svg class="icon" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const MODE_LABEL = { studio: 'In studio', online: 'Online' };

function avatar(p, sizes = '(min-width: 900px) 280px, 100vw') {
  return p.photo
    ? `<picture>
          <source type="image/webp" srcset="/assets/img/${esc(p.photo)}-480.webp 480w, /assets/img/${esc(p.photo)}-800.webp 800w" sizes="${sizes}">
          <img src="/assets/img/${esc(p.photo)}-800.jpg" alt="${esc(p.name)}" width="800" height="1067" loading="lazy">
        </picture>`
    : `<div class="person-placeholder" aria-hidden="true"><img src="/assets/img/logo-icon.webp" alt="" width="147" height="112"></div>`;
}

function modeTags(modes) {
  return modes.map((m) => `<span class="tag tag-${m}">${MODE_LABEL[m]}</span>`).join(' ');
}

function personCard(p, { service } = {}) {
  const services = service
    ? `<p class="person-meta">${modeTags(p.modes)}</p>`
    : `<ul class="person-services" role="list">${p.services.map((sv) => `<li><a href="/servizi/${esc(sv.slug)}/">${esc(sv.name)}</a></li>`).join('')}</ul>`;
  const cta = service
    ? `<a class="btn btn-primary btn-small" href="/prenota/?servizio=${esc(service.id)}&amp;professionista=${esc(p.id)}">Prenota con ${esc(p.name.split(' ').slice(-1)[0])}</a>`
    : '';
  return `<li class="person" id="${esc(p.slug)}">
      <div class="person-photo">${avatar(p)}</div>
      <div class="person-body">
        <h3>${esc(p.name)}</h3>
        <p class="person-role">${esc(p.title)}</p>
        ${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
        ${services}
        ${p.albo ? `<p class="person-albo">${esc(p.albo)}</p>` : ''}
        ${cta}
      </div>
    </li>`;
}

function serviceCard(sv) {
  const pros = sv.professionals.map((p) => esc(p.name)).join(', ');
  const modes = [...new Set(sv.professionals.flatMap((p) => p.modes))];
  return `<li class="svc-card">
      <a href="/servizi/${esc(sv.slug)}/">
        <h3>${esc(sv.name)}</h3>
        <p>${esc(sv.description)}</p>
        <p class="svc-meta">${esc(sv.durationMinutes)} minuti${sv.price ? ` · ${esc(sv.price)}` : ''}</p>
        <p class="svc-meta">${modeTags(modes)}</p>
        ${pros ? `<p class="svc-pros">Con ${pros}</p>` : '<p class="svc-pros">Professionisti in arrivo</p>'}
        <span class="card-more">Scopri il servizio ${arrowRight}</span>
      </a>
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
  categoryCards: () => `<ul class="services" role="list">${catalog.categories.map((c) => `
    <li class="service-card">
      <h3>${esc(c.name)}</h3>
      <p>${esc(c.intro)}</p>
      <ul class="service-areas" role="list">${c.services.map((sv) => `<li><a href="/servizi/${esc(sv.slug)}/">${esc(sv.name)}</a></li>`).join('') || '<li>Servizi in arrivo</li>'}</ul>
      <a class="btn btn-ghost btn-small" href="/servizi/#${esc(c.slug)}">Tutti i servizi di ${esc(c.name.toLowerCase())} ${arrowRight}</a>
    </li>`).join('')}
  </ul>`,
  servicesByCategory: () => catalog.categories.map((c) => `
    <section class="cat-block" id="${esc(c.slug)}" aria-labelledby="cat-${esc(c.slug)}">
      <div class="cat-head">
        <h2 id="cat-${esc(c.slug)}">${esc(c.name)}</h2>
        <p class="lead">${esc(c.intro)}</p>
      </div>
      ${c.services.length ? `<ul class="svc-grid" role="list">${c.services.map(serviceCard).join('')}</ul>` : '<p class="hint">Servizi in arrivo.</p>'}
    </section>`).join(''),
  team: () => `<ul class="team" role="list">${catalog.professionals.map((p) => personCard(p)).join('')}</ul>`,
  serviceDetail: (ctx) => {
    const sv = ctx.service;
    const paras = String(sv.description || '').split(/\n{2,}/).map((t) => `<p>${esc(t)}</p>`).join('');
    return paras;
  },
  serviceFacts: (ctx) => {
    const sv = ctx.service;
    const modes = [...new Set(sv.professionals.flatMap((p) => p.modes))];
    return `<dl class="summary">
        <dt>Durata</dt><dd>${esc(sv.durationMinutes)} minuti</dd>
        ${sv.price ? `<dt>Tariffa</dt><dd>${esc(sv.price)}</dd>` : ''}
        <dt>Dove</dt><dd>${modes.map((m) => (m === 'studio' ? `In studio a ${esc(config.city)}` : 'Online')).join(' · ') || '—'}</dd>
      </dl>`;
  },
  serviceTeam: (ctx) => ctx.service.professionals.length
    ? `<ul class="team" role="list">${ctx.service.professionals.map((p) => personCard(p, { service: ctx.service })).join('')}</ul>`
    : '<p class="hint">I professionisti per questo servizio saranno presto disponibili. Puoi comunque chiederci di ricontattarti.</p>',
  serviceBook: (ctx) => `/prenota/?servizio=${esc(ctx.service.id)}`,
  practical: () => `<dl class="practical">
      <div><dt>Durata</dt><dd>${esc(config.fees.sessionMinutes)}–60 minuti, secondo il servizio</dd></div>
      <div><dt>Tariffe</dt><dd>Indicate nella pagina di ciascun servizio</dd></div>
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
  categoryOptions: () => catalog.categories.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join(''),
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
  const people = catalog.professionals.filter((m) => !isPlaceholder(m.name)).map((m) => ({ '@type': 'Person', name: m.name, jobTitle: m.title }));
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
    for (const service of allServices) {
      const path = `/servizi/${service.slug}/`;
      const cat = catalog.categories.find((c) => c.slug === service.category);
      const fill = (t) => t.replaceAll('{{svc.name}}', esc(service.name)).replaceAll('{{svc.category}}', esc(cat ? cat.name : ''))
        .replaceAll('{{svc.categorySlug}}', esc(service.category));
      const title = render(fill(meta.title));
      write(path, page({ ...meta, title, description: String(service.description).slice(0, 155) }, fill(body), path, { service }));
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
const versioned = ['/assets/css/style.css', '/assets/js/site.js', '/assets/js/booking.js', '/admin/admin.css', '/admin/admin.js', '/admin/vendor/qrcode.js'];
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
console.log(`Sito generato in dist/ (${urls.length} pagine indicizzabili, catalogo: ${catalog.source}).`);
if (pending.length) {
  console.log(`Attenzione: ${pending.length} dati segnaposto da completare in src/site.config.json:\n  ${pending.join('\n  ')}`);
}
