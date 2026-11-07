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
