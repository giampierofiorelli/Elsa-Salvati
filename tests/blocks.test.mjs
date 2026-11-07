import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBlocks, renderBlocks, BLOCKS } from '../lib/blocks.mjs';

const ctx = (lang = 'it', notes = false) => ({
  lang, notes,
  pathOf: (key, l) => ({ coaching: { it: '/coaching/', en: '/en/workplace-coaching/' } }[key] || {})[l] || null,
  imageUrl: (id, w, f = 'webp') => `/media/${id}-${w}.${f}`,
});

const page = [
  { type: 'page-hero', data: { eyebrow: 'Coaching', title: 'Per il lavoro che hai già.', buttons: [{ label: 'Prenota con Elsa', to: { kind: 'book', pro: 'elsa-salvati' }, style: 'primary' }] } },
  { type: 'rows', note: 'da confermare', data: { eyebrow: 'Situazioni', title: 'Quando serve', items: [{ title: 'Uno', body: [{ kind: 'p', text: { p: [[{ t: 'Testo' }]] } }], links: [{ label: 'Coaching', to: { kind: 'page', key: 'coaching' } }] }, { title: 'Due' }] } },
  { type: 'text-columns', data: { eyebrow: 'Cosa comprende', title: 'Titolo', body: [{ kind: 'arrow', link: { label: 'Garante', to: { kind: 'url', href: 'https://www.garanteprivacy.it' } } }] } },
  { type: 'closing-cta', data: { title: 'Inizia', buttons: [{ label: 'Scrivici', to: { kind: 'page', key: 'contatti' }, style: 'outline-light' }] } },
];

test('a page is validated and rendered with automatic eyebrow numbers and language paths', () => {
  const blocks = cleanBlocks(page);
  const it = renderBlocks(blocks, ctx('it'));
  assert.match(it, /<p class="eyebrow">01 · Situazioni<\/p>/);
  assert.match(it, /<p class="eyebrow">02 · Cosa comprende<\/p>/);
  assert.match(it, /href="\/prenota\/\?professionista=elsa-salvati"/);
  assert.match(it, /<a href="\/coaching\/" data-roll>Coaching<\/a>/);
  assert.match(it, /class="link-arrow" href="https:\/\/www\.garanteprivacy\.it" target="_blank" rel="noopener noreferrer"/);
  assert.match(renderBlocks(blocks, ctx('en')), /href="\/en\/workplace-coaching\/"/);
  assert.match(renderBlocks(blocks, ctx('en')), /href="\/en\/book\/\?professionista=elsa-salvati"/);
});

test('internal notes appear only when asked (staging and editor), never on the public site', () => {
  const blocks = cleanBlocks(page);
  assert.doesNotMatch(renderBlocks(blocks, ctx('it', false)), /draft-note/);
  assert.match(renderBlocks(blocks, ctx('it', true)), /<p class="draft-note">da confermare<\/p>/);
});

test('moving a block renumbers the eyebrows', () => {
  const blocks = cleanBlocks([page[0], page[2], page[1], page[3]]);
  const html = renderBlocks(blocks, ctx());
  assert.match(html, /01 · Cosa comprende/);
  assert.match(html, /02 · Situazioni/);
});

test('bad input is refused: unknown blocks, duplicates of single blocks, scripts in links, missing required fields', () => {
  assert.throws(() => cleanBlocks([{ type: 'script' }]), /sconosciuto/);
  assert.throws(() => cleanBlocks([page[0], page[0]]), /una volta sola/);
  assert.throws(() => cleanBlocks([{ type: 'closing-cta', data: { title: 'x', buttons: [{ label: 'a', to: { kind: 'url', href: 'javascript:alert(1)' } }] } }]), /esterno non valido/);
  assert.throws(() => cleanBlocks([{ type: 'steps', data: { items: [{ text: { p: [[{ t: 'a' }]] } }] } }]), /Titolo: campo obbligatorio/);
  assert.throws(() => cleanBlocks([{ type: 'profile', data: { title: 'x', photo: { id: 'abcdef0123456789' } } }]), /testo alternativo/);
});

test('every block type renders with empty optional fields', () => {
  for (const [type, def] of Object.entries(BLOCKS)) {
    const data = {};
    for (const f of def.fields) {
      if (f.required) data[f.name] = 'Testo';
      if (f.type === 'list' && f.min) data[f.name] = Array.from({ length: f.min }, () => Object.fromEntries(f.fields.filter((x) => x.required).map((x) => [x.name, 'X'])));
    }
    const html = renderBlocks(cleanBlocks([{ type, data }]), ctx());
    assert.equal(typeof html, 'string', type);
  }
});

test('library images: every version in srcset, sizes by role, the first picture loads at once', () => {
  const photo = (id, extra) => ({ type: 'profile', data: { title: 'Elsa', photo: { id, alt: 'Elsa Salvati', w: 1200, h: 1600, role: 'content', variants: [480, 800, 1200], format: 'webp', fallback: 800, ...extra } } });
  const blocks = cleanBlocks([photo('a'.repeat(24)), photo('b'.repeat(24))]);
  const html = renderBlocks(blocks, ctx());
  assert.match(html, /srcset="\/media\/a{24}-480\.webp 480w, \/media\/a{24}-800\.webp 800w, \/media\/a{24}-1200\.webp 1200w"/);
  assert.match(html, /sizes="\(min-width: 960px\) 420px, 92vw"/);
  assert.match(html, /<img src="\/media\/a{24}-800\.jpg" alt="Elsa Salvati" width="800" height="1067" fetchpriority="high">/);
  assert.match(html, /<img src="\/media\/b{24}-800\.jpg" alt="Elsa Salvati" width="800" height="1067" loading="lazy">/);
  // A JPEG-only upload (browser without any WebP encoder): srcset of JPEGs, no <source>.
  const jpg = renderBlocks(cleanBlocks([photo('c'.repeat(24), { format: 'jpg' })]), ctx());
  assert.match(jpg, /<img src="\/media\/c{24}-800\.jpg" srcset="\/media\/c{24}-480\.jpg 480w, \/media\/c{24}-800\.jpg 800w, \/media\/c{24}-1200\.jpg 1200w"/);
  assert.doesNotMatch(jpg, /<source/);
  // Invented versions are refused.
  assert.throws(() => cleanBlocks([photo('d'.repeat(24), { variants: [333] })]), /versioni dell'immagine non valide/);
  assert.throws(() => cleanBlocks([photo('d'.repeat(24), { role: 'hero' })]), /uso dell'immagine non valido/);
});

// ---------- editor marks (data-edit-*): only in the editor's preview ----------
import { readdirSync, readFileSync } from 'node:fs';

/** The field definition a data-edit path points to, or null. */
function fieldAt(fields, path) {
  const parts = path.split('.');
  let list = fields;
  let f = null;
  for (let i = 0; i < parts.length; i++) {
    f = list && list.find((x) => x.name === parts[i]);
    if (!f) return null;
    if (i === parts.length - 1) return f;
    const idx = parts[i + 1];
    if (!/^\d+$/.test(idx)) return null;
    i += 1;
    if (i === parts.length - 1) return { ...f, item: true };
    if (f.type === 'list') list = f.fields;
    else if (f.type === 'flow') list = [{ name: 'text', type: 'rich' }, { name: 'source', type: 'text' }, { name: 'link', type: 'link' }];
    else return null;
  }
  return f;
}
const KIND_OK = {
  text: (f) => f.type === 'text' || (f.item && f.type === 'textlist'),
  rich: (f) => f.type === 'rich',
  inline: (f) => f.type === 'rich',
  link: (f) => f.item ? (f.type === 'buttons' || f.type === 'links') : (f.type === 'link' || f.type === 'button'),
  image: (f) => f.type === 'image',
  item: (f) => f.item && f.type === 'list',
};

test('editor marks: every data-edit path in every site page points to a field of the right kind', () => {
  let checked = 0;
  for (const lang of ['it', 'en']) {
    for (const file of readdirSync(new URL(`../content/pages/${lang}/`, import.meta.url))) {
      const pg = JSON.parse(readFileSync(new URL(`../content/pages/${lang}/${file}`, import.meta.url), 'utf8'));
      if (!Array.isArray(pg.blocks)) continue;
      const blocks = cleanBlocks(pg.blocks);
      const html = renderBlocks(blocks, { ...ctx(lang, true), editor: true });
      // Each block's first element carries its index.
      const idx = [...html.matchAll(/data-edit-block="(\d+)"/g)].map((m) => Number(m[1]));
      blocks.forEach((b, i) => { if (!BLOCKS[b.type].special) assert.ok(idx.includes(i), `${file}: block ${i} (${b.type}) not marked`); });
      // Walk the blocks in order and check every mark against that block's fields.
      const parts = html.split(/(?=<[a-zA-Z][^>]*data-edit-block=")/);
      for (const part of parts) {
        const m = part.match(/data-edit-block="(\d+)"/);
        if (!m) continue;
        const def = BLOCKS[blocks[Number(m[1])].type];
        for (const e of part.matchAll(/data-edit="([^"]+)" data-edit-kind="(\w+)"/g)) {
          const f = fieldAt(def.fields, e[1]);
          assert.ok(f, `${file}: ${blocks[Number(m[1])].type} has no field ${e[1]}`);
          assert.ok(KIND_OK[e[2]] && KIND_OK[e[2]](f), `${file}: ${e[1]} marked ${e[2]} but is ${f.type}`);
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} marks checked`);
});

test('editor marks never reach published pages', () => {
  for (const lang of ['it', 'en']) {
    for (const file of readdirSync(new URL(`../content/pages/${lang}/`, import.meta.url))) {
      const pg = JSON.parse(readFileSync(new URL(`../content/pages/${lang}/${file}`, import.meta.url), 'utf8'));
      if (!Array.isArray(pg.blocks)) continue;
      const blocks = cleanBlocks(pg.blocks);
      assert.doesNotMatch(renderBlocks(blocks, ctx(lang, false)), /data-edit/, file);
      assert.doesNotMatch(renderBlocks(blocks, ctx(lang, true)), /data-edit/, `${file} (staging, with notes)`);
    }
  }
});
