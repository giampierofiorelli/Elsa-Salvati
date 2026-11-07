// Rich text for the page editor, stored as data, never as HTML.
// Shape: { p: [ [ { t: 'text', b?: true, i?: true, href?: '/coaching/' | 'https://…' }, … ], … ] }
// One array per paragraph, one object per run of text. Only bold, italic and links exist,
// so pasted markup or scripts have nowhere to go. The server checks every field.

const MAX_RUN = 2000;
const MAX_PARAS = 40;
const MAX_RUNS = 200;

/** Internal links: a site path such as /coaching/ or /en/team/#elsa. External: http(s), mailto:, tel:. */
// Studio contacts written as tokens, filled from the settings when the page is built.
export const CONTACT_LINKS = ['tel:{{contact.phoneHref}}', 'mailto:{{contact.email}}'];

export function linkKind(href) {
  if (typeof href !== 'string' || href.length > 500) return null;
  if (CONTACT_LINKS.includes(href)) return 'external';
  if (/^\/(?!\/)[a-z0-9\-/]*(#[a-z0-9-]+)?(\?[a-z0-9=&_-]+)?$/i.test(href)) return 'internal';
  if (/^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(\/[^\s<>"']*)?$/i.test(href)) return 'external';
  if (/^mailto:[^\s<>"'?&]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(href)) return 'external';
  if (/^tel:\+?[0-9 ]{3,20}$/.test(href)) return 'external';
  return null;
}

/** Validate and normalise. Throws a RangeError with a readable message on bad input. */
export function cleanRich(value, { field = 'Testo', maxChars = 4000, multiline = true } = {}) {
  if (value == null || value === '') return { p: [] };
  if (typeof value !== 'object' || !Array.isArray(value.p)) throw new RangeError(`${field}: formato non valido`);
  if (value.p.length > (multiline ? MAX_PARAS : 1)) throw new RangeError(`${field}: troppi paragrafi`);
  let total = 0;
  const p = value.p.map((para) => {
    if (!Array.isArray(para) || para.length > MAX_RUNS) throw new RangeError(`${field}: formato non valido`);
    const runs = [];
    for (const run of para) {
      if (!run || typeof run !== 'object' || typeof run.t !== 'string') throw new RangeError(`${field}: formato non valido`);
      const t = run.t.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ');
      if (!t) continue;
      if (t.length > MAX_RUN) throw new RangeError(`${field}: testo troppo lungo`);
      total += t.length;
      const out = { t };
      if (run.b === true) out.b = true;
      if (run.i === true) out.i = true;
      if (run.href !== undefined && run.href !== null && run.href !== '') {
        if (!linkKind(run.href)) throw new RangeError(`${field}: link non valido (${String(run.href).slice(0, 60)})`);
        out.href = run.href;
      }
      // Merge with the previous run when the formatting is the same.
      const prev = runs[runs.length - 1];
      if (prev && !!prev.b === !!out.b && !!prev.i === !!out.i && prev.href === out.href) prev.t += out.t;
      else runs.push(out);
    }
    if (runs.length) { runs[0].t = runs[0].t.replace(/^ /, ''); runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/ $/, ''); }
    return runs.filter((r) => r.t);
  }).filter((para) => para.length);
  if (total > maxChars) throw new RangeError(`${field}: massimo ${maxChars} caratteri`);
  return { p };
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function renderRun(run) {
  let html = escapeHtml(run.t);
  if (run.i) html = `<em>${html}</em>`;
  if (run.b) html = `<strong>${html}</strong>`;
  if (run.href) {
    // Only web pages open in a new tab; phone and email links open the phone or mail app.
    const ext = /^https?:/i.test(run.href);
    html = `<a href="${escapeHtml(run.href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${html}</a>`;
  }
  return html;
}

/** Inline HTML of one paragraph (for headings and short fields). */
export function richInline(value) {
  const v = value && Array.isArray(value.p) ? value : { p: [] };
  return v.p.map((para) => para.map(renderRun).join('')).join(' ');
}

/** One <p> per paragraph; `cls` adds a class to each. */
export function richBlocks(value, cls = '') {
  const v = value && Array.isArray(value.p) ? value : { p: [] };
  const attr = cls ? ` class="${escapeHtml(cls)}"` : '';
  return v.p.map((para) => `<p${attr}>${para.map(renderRun).join('')}</p>`).join('\n');
}

/** Plain text (for titles, alt text, search). */
export function richText(value) {
  const v = value && Array.isArray(value.p) ? value : { p: [] };
  return v.p.map((para) => para.map((r) => r.t).join('')).join('\n');
}

/** Build rich text from plain text (one paragraph per line). Used by the migration. */
export function fromPlain(text) {
  return { p: String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((t) => [{ t }]) };
}
