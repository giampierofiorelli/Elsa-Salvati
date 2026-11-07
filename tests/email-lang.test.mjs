// Patient emails follow the language of the booking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templates } from '../lib/email.mjs';

const ev = { start_at: '2026-11-10T14:00:00Z', end_at: '2026-11-10T14:30:00Z', kind: 'primo_colloquio', mode: 'online', professional_name: 'Elsa Salvati' };
const site = { professionalName: 'Blooming', cancelHours: 24 };

test('confirmation in English for an English booking', () => {
  const m = templates.confirmation({ ev: { ...ev, lang: 'en' }, name: 'Anna', manageUrl: 'https://x/en/book/manage/?t=1', tz: 'Europe/Rome', site });
  assert.match(m.subject, /^Appointment confirmed/);
  assert.match(m.text, /Dear Anna,/);
  assert.match(m.text, /free first meeting is confirmed/);
  assert.match(m.text, /Tuesday, 10 November 2026, 15:00/);
  assert.match(m.text, /Manage your booking/);
});

test('confirmation in Italian by default', () => {
  const m = templates.confirmation({ ev, name: 'Anna', manageUrl: null, tz: 'Europe/Rome', site });
  assert.match(m.subject, /^Appuntamento confermato/);
  assert.match(m.text, /Gentile Anna,/);
  assert.match(m.text, /martedì 10 novembre 2026, ore 15:00/);
});

test('explicit lang wins over the event', () => {
  const m = templates.cancelled({ ev, name: 'Anna', tz: 'Europe/Rome', site, bookUrl: 'https://x/en/book/', lang: 'en' });
  assert.match(m.subject, /^Appointment cancelled/);
  assert.match(m.text, /Book a new time/);
});
