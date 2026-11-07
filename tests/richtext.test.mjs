import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRich, richBlocks, richInline, linkKind, fromPlain } from '../lib/richtext.mjs';

test('internal links open in the same tab, external ones in a new tab', () => {
  const v = cleanRich({ p: [[{ t: 'Vedi ' }, { t: 'coaching', href: '/coaching/' }, { t: ' e ' }, { t: 'il Garante', href: 'https://www.garanteprivacy.it' }]] });
  const html = richBlocks(v);
  assert.match(html, /<a href="\/coaching\/">coaching<\/a>/);
  assert.match(html, /<a href="https:\/\/www\.garanteprivacy\.it" target="_blank" rel="noopener noreferrer">il Garante<\/a>/);
});

test('only bold, italic and links survive; markup in the text is shown as text', () => {
  const v = cleanRich({ p: [[{ t: '<script>alert(1)</script>', b: true, i: true, style: 'x', onclick: 'y' }]] });
  assert.deepEqual(Object.keys(v.p[0][0]).sort(), ['b', 'i', 't']);
  assert.equal(richInline(v), '<strong><em>&lt;script&gt;alert(1)&lt;/script&gt;</em></strong>');
});

test('dangerous or malformed links are refused', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', 'http://x', 'mailto:a@b.it?bcc=c@d.it', '/a"onmouseover="x']) {
    assert.equal(linkKind(href), null, href);
    assert.throws(() => cleanRich({ p: [[{ t: 'x', href }]] }), RangeError, href);
  }
  assert.equal(linkKind('/en/team/#elsa'), 'internal');
  assert.equal(linkKind('/prenota/?professionista=elsa-salvati'), 'internal');
  assert.equal(linkKind('mailto:info@example.it'), 'external');
});

test('runs with the same format are merged, spaces tidied, empty paragraphs dropped', () => {
  const v = cleanRich({ p: [[{ t: ' Ciao ' }, { t: 'a\ttutti ' }], [], [{ t: '' }]] });
  assert.deepEqual(v, { p: [[{ t: 'Ciao a tutti' }]] });
  assert.deepEqual(fromPlain('uno\n\ndue'), { p: [[{ t: 'uno' }], [{ t: 'due' }]] });
});

test('limits on length and paragraphs', () => {
  assert.throws(() => cleanRich({ p: [[{ t: 'x'.repeat(50) }]] }, { maxChars: 10 }), /massimo 10/);
  assert.throws(() => cleanRich({ p: [[{ t: 'a' }], [{ t: 'b' }]] }, { multiline: false }), /troppi paragrafi/);
  assert.throws(() => cleanRich('<b>html</b>'), /formato/);
});
