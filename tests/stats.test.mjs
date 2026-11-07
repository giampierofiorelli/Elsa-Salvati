import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beaconRows, isBot } from '../lib/stats.mjs';

test('site beacon: only known fields and fixed values become counters', () => {
  const rows = beaconRows({ page: '/team/', src: 'instagram', device: 'computer', cta: { 'header-prenota': 3, 'Not A Key': 1, 'hero-prenota': 999 }, form: { 'contatto:avviato': 1, 'contatto:hack': 1 } });
  assert.deepEqual(rows, [
    { page: '/team/', metric: 'view', key: '', n: 1 },
    { page: '/team/', metric: 'entry', key: 'instagram', n: 1 },
    { page: '*', metric: 'device', key: 'computer', n: 1 },
    { page: '/team/', metric: 'cta', key: 'header-prenota', n: 3 },
    { page: '/team/', metric: 'cta', key: 'hero-prenota', n: 20 },
    { page: '/team/', metric: 'form', key: 'contatto:avviato', n: 1 },
  ]);
  // Internal visits are not entries; a repeated message counts no view.
  assert.deepEqual(beaconRows({ page: '/', src: 'interno', again: 1, cta: { 'footer-whatsapp': 1 } }), [{ page: '/', metric: 'cta', key: 'footer-whatsapp', n: 1 }]);
  // Unknown sources become "altro"; pages with tokens become "gestione"; bad pages are refused.
  assert.equal(beaconRows({ page: '/', src: 'evil.example' })[1].key, 'altro');
  assert.equal(beaconRows({ page: '/prenota/gestisci/' })[0].page, 'gestione');
  assert.equal(beaconRows({ page: '/prenota/?t=abc' }), null);
  assert.equal(beaconRows({ page: 'https://x.y/' }), null);
  assert.equal(beaconRows({ page: '/admin/' })[0].page, 'gestione');
  // A goal is counted on the previous page, with the button label, never with anything else.
  const g = beaconRows({ page: '/prenota/', src: 'interno', goal: 'prenotazione', prev: '/psicoterapia/', da: 'hero-prenota', steps: [1, 2, 3, 4, 5, 5, 7] });
  assert.deepEqual(g.filter((r) => r.metric !== 'view'), [
    { page: '/prenota/', metric: 'step', key: '1', n: 1 }, { page: '/prenota/', metric: 'step', key: '2', n: 1 },
    { page: '/prenota/', metric: 'step', key: '3', n: 1 }, { page: '/prenota/', metric: 'step', key: '4', n: 1 },
    { page: '/prenota/', metric: 'step', key: '5', n: 1 },
    { page: '/psicoterapia/', metric: 'goal', key: 'prenotazione|hero-prenota', n: 1 },
  ]);
});

test('bots and empty user agents are not counted', () => {
  assert.ok(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)'));
  assert.ok(isBot(''));
  assert.ok(isBot('curl/8.1'));
  assert.ok(!isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'));
});

import { wilson, suppressRows, heardGroup } from '../lib/stats.mjs';

test('Wilson interval matches the research table; small groups and secondary suppression', () => {
  const w = wilson(6, 10);
  assert.equal(Math.round(w.lo * 100), 31);
  assert.equal(Math.round(w.hi * 100), 83);
  const w2 = wilson(1, 20);
  assert.equal(Math.round(w2.hi * 100), 24);
  // A row showing its total with one hidden cell gets a second hidden cell: no subtraction possible.
  const rows = suppressRows([{ n: 20, a: 3, b: 9, c: 8 }, { n: 3, a: 1, b: 2 }, { n: 12, a: 0, b: 12 }], ['a', 'b', 'c'], 'n');
  assert.deepEqual(rows[0], { n: 20, a: -1, b: 9, c: -1 });
  assert.deepEqual(rows[1], { n: -1, a: -1, b: -1 }, 'a group under 5 is hidden entirely');
  assert.deepEqual(rows[2], { n: 12, a: 0, b: 12 }, 'zeros say nothing about anyone and stay');
  assert.equal(heardGroup('instagram'), 'internet');
  assert.equal(heardGroup(null), 'altro');
});
