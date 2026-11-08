// Notes written by hand in pages and partials show on staging and previews, never in production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripDraftNotes } from '../lib/draft-notes.mjs';

const PAGES = ['privacy/index.html', 'en/privacy/index.html', 'cookie/index.html', 'en/cookies/index.html',
  'accessibilita/index.html', 'en/accessibility/index.html'];
const NOTES = /da verificare|to be checked|placeholder-note|Nota bozza|Draft note|draft-inline/i;

function build(context) {
  const dir = mkdtempSync(join(tmpdir(), 'build-'));
  const env = { ...process.env, CONTEXT: context, BUILD_OUT: dir };
  delete env.DATABASE_URL;
  execFileSync(process.execPath, ['scripts/build.mjs'], { env, stdio: 'pipe' });
  return dir;
}

test('production build: no internal notes in privacy and cookie pages (IT and EN), nor in the booking page', () => {
  const dir = build('production');
  try {
    for (const p of [...PAGES, 'prenota/index.html']) {
      const html = readFileSync(join(dir, p), 'utf8');
      assert.doesNotMatch(html, NOTES, p);
      assert.match(html, /<h1/, `${p} still has its content`);
    }
    // Blanks still to fill in are content, not notes: they stay until written.
    assert.match(readFileSync(join(dir, 'privacy/index.html'), 'utf8'), /\[data\]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('staging build keeps the notes for the review', () => {
  const dir = build('branch-deploy');
  try {
    for (const p of PAGES) assert.match(readFileSync(join(dir, p), 'utf8'), /placeholder-note/, p);
    assert.match(readFileSync(join(dir, 'privacy/index.html'), 'utf8'), /<span class="draft-inline"> \[da verificare con un vostro consulente\]<\/span>/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('only the marked notes are removed, never other text in brackets', () => {
  const html = '<p>Durata [24] mesi.<span class="draft-inline"> [da verificare]</span></p>\n<p class="placeholder-note">[Bozza <a href="/x">x</a>]</p>\n<p>Ok<!-- Nota bozza: [6] mesi --><!--content--></p>';
  assert.equal(stripDraftNotes(html), '<p>Durata [24] mesi.</p>\n<p>Ok<!--content--></p>');
});
