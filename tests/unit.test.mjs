import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, zonedParts, addDays, isoWeekday, mondayOf } from '../lib/time.mjs';
import { availableSlots, candidateSlots, normalizeSettings, DEFAULT_SETTINGS } from '../lib/slots.mjs';
import {
  createVault, hashPassword, verifyPassword, totpCode, verifyTotp, base32Encode,
  signSession, readSession,
} from '../lib/crypto.mjs';
import { randomBytes } from 'node:crypto';

const TZ = 'Europe/Rome';

test('zonedToUtc handles winter and summer time in Rome', () => {
  assert.equal(zonedToUtc('2026-01-15', '09:00', TZ).toISOString(), '2026-01-15T08:00:00.000Z');
  assert.equal(zonedToUtc('2026-07-15', '09:00', TZ).toISOString(), '2026-07-15T07:00:00.000Z');
});

test('zonedToUtc around DST changes', () => {
  // 29 March 2026: 02:00 -> 03:00. 02:30 does not exist and moves to 03:30.
  assert.equal(zonedToUtc('2026-03-29', '02:30', TZ).toISOString(), '2026-03-29T01:30:00.000Z');
  assert.equal(zonedToUtc('2026-03-29', '10:00', TZ).toISOString(), '2026-03-29T08:00:00.000Z');
  // 25 October 2026: 03:00 -> 02:00. 02:30 happens twice; first occurrence wins.
  assert.equal(zonedToUtc('2026-10-25', '02:30', TZ).toISOString(), '2026-10-25T00:30:00.000Z');
  assert.equal(zonedToUtc('2026-10-25', '10:00', TZ).toISOString(), '2026-10-25T09:00:00.000Z');
});

test('calendar helpers', () => {
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(isoWeekday('2026-10-26'), 1);
  assert.equal(isoWeekday('2026-10-25'), 7);
  assert.equal(mondayOf('2026-10-29'), '2026-10-26');
  assert.equal(zonedParts(new Date('2026-10-22T22:30:00Z'), TZ).date, '2026-10-23');
});

const rules = [
  { weekday: 1, start_time: '09:00', end_time: '12:00', mode: 'entrambi', public: true, active: true },
  { weekday: 1, start_time: '15:00', end_time: '17:00', mode: 'online', public: true, active: true },
  { weekday: 2, start_time: '09:00', end_time: '13:00', mode: 'studio', public: false, active: true },
];
const settings = { ...DEFAULT_SETTINGS };

test('candidate slots follow public rules only', () => {
  const c = candidateSlots({ rules, settings, fromDate: '2026-10-26', toDate: '2026-10-27' });
  assert.deepEqual(c.map((s) => `${s.date} ${s.time} ${s.modes.join('+')}`), [
    '2026-10-26 09:00 online+studio',
    '2026-10-26 10:00 online+studio',
    '2026-10-26 11:00 online+studio',
    '2026-10-26 15:00 online',
    '2026-10-26 16:00 online',
  ]);
});

test('available slots remove busy times, buffer, notice and mode', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const busy = [{ start_at: new Date('2026-10-26T09:00:00Z'), end_at: new Date('2026-10-26T09:50:00Z') }]; // 10:00 local
  const all = availableSlots({ rules, busy, settings, now });
  const times = all.filter((s) => s.date === '2026-10-26').map((s) => s.time);
  assert.deepEqual(times, ['09:00', '11:00', '15:00', '16:00']);
  const studio = availableSlots({ rules, busy, settings, now, mode: 'studio' }).filter((s) => s.date === '2026-10-26');
  assert.deepEqual(studio.map((s) => s.time), ['09:00', '11:00']);
  // 72h notice hides Monday 26 entirely.
  const late = availableSlots({ rules, busy, settings: { ...settings, minNoticeHours: 72 }, now });
  assert.ok(!late.some((s) => s.date === '2026-10-26'));
  // A 30-minute buffer makes the 09:00 slot (ending 09:50) too close to the 10:00 appointment.
  const buffered = availableSlots({ rules, busy, settings: { ...settings, bufferMinutes: 30 }, now });
  assert.ok(!buffered.some((s) => s.date === '2026-10-26' && s.time === '09:00'));
});

test('settings validation', () => {
  assert.equal(normalizeSettings({ horizonDays: '30' }).horizonDays, 30);
  assert.throws(() => normalizeSettings({ horizonDays: 0 }), RangeError);
  assert.throws(() => normalizeSettings({ timezone: 'Nowhere/City' }), RangeError);
});

test('vault encrypts, detects tampering and hashes lookups', () => {
  const v = createVault(randomBytes(32).toString('base64'));
  const enc = v.encrypt({ name: 'Mario Rossi', email: 'm@example.it' });
  assert.ok(!enc.includes('Mario'));
  assert.deepEqual(v.decrypt(enc), { name: 'Mario Rossi', email: 'm@example.it' });
  const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'BB' : 'AA');
  assert.throws(() => v.decrypt(tampered));
  assert.equal(v.lookupHash(' M@Example.it '), v.lookupHash('m@example.it'));
});

test('password hashing', () => {
  const h = hashPassword('segreta lunga 123');
  assert.ok(verifyPassword('segreta lunga 123', h));
  assert.ok(!verifyPassword('sbagliata', h));
});

test('TOTP matches RFC 6238 test vector', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totpCode(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totpCode(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(verifyTotp(secret, '081804', 1111111109 * 1000), Math.floor(1111111109 / 30));
  assert.equal(verifyTotp(secret, '000000', 1111111109 * 1000), null);
});

test('session tokens are signed and expire', () => {
  const t = signSession({ sub: 'admin', exp: 2000 }, 'k');
  assert.equal(readSession(t, 'k', 1000).sub, 'admin');
  assert.equal(readSession(t, 'k', 3000), null);
  assert.equal(readSession(t, 'other', 1000), null);
  assert.equal(readSession(t.replace(/^./, 'x'), 'k', 1000), null);
});

test('IPv6 addresses are grouped by /64 for rate limits', async () => {
  const { ipKey } = await import('../lib/http.mjs');
  assert.equal(ipKey('2001:db8:1:2:aaaa::1'), ipKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
  assert.notEqual(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:3::1'));
  assert.equal(ipKey('198.51.100.4'), '198.51.100.4');
  assert.equal(ipKey('::ffff:198.51.100.4'), '::ffff:198.51.100.4');
});

test('approval deadline: the day before at 18:00 Rome time, also across daylight-saving changes', async () => {
  const { approvalDeadlineFor, requestOpen, DEFAULT_SETTINGS } = await import('../lib/slots.mjs');
  const s = { ...DEFAULT_SETTINGS, approvalWorkdays: [1, 2, 3, 4, 5, 6, 7] };
  // Summer time starts on Sunday 29 March 2026: 18:00 in Rome that day is 16:00 UTC.
  assert.equal(approvalDeadlineFor('2026-03-30T07:00:00Z', s).toISOString(), '2026-03-29T16:00:00.000Z');
  // Winter time is back on Sunday 25 October 2026: 18:00 in Rome is 17:00 UTC.
  assert.equal(approvalDeadlineFor('2026-10-26T08:00:00Z', s).toISOString(), '2026-10-25T17:00:00.000Z');
  // An appointment just after midnight: the deadline is still the evening before (local day).
  assert.equal(approvalDeadlineFor('2026-12-08T23:30:00Z', s).toISOString(), '2026-12-08T17:00:00.000Z');
  // At least two hours to approve: at 19:00 nobody can request tomorrow morning.
  assert.equal(requestOpen('2026-12-08T08:00:00Z', s, '2026-12-07T18:00:00Z'), false);
  assert.equal(requestOpen('2026-12-08T08:00:00Z', s, '2026-12-07T14:59:00Z'), true);
  assert.equal(requestOpen('2026-12-08T08:00:00Z', { ...s, approvalDeadline: '12:00' }, '2026-12-07T10:30:00Z'), false);
});

test('approval deadline skips non-working days: a Monday request lapses on Friday (DST-safe)', async () => {
  const { approvalDeadlineFor, requestOpen, normalizeSettings, DEFAULT_SETTINGS } = await import('../lib/slots.mjs');
  const s = { ...DEFAULT_SETTINGS };
  assert.deepEqual(s.approvalWorkdays, [1, 2, 3, 4, 5]);
  // Monday 30 March 2026 (summer time began Sunday 29): Friday 27 March 18:00 is still winter time, 17:00 UTC.
  assert.equal(approvalDeadlineFor('2026-03-30T07:00:00Z', s).toISOString(), '2026-03-27T17:00:00.000Z');
  // Monday 26 October 2026 (winter time back Sunday 25): Friday 23 October 18:00 is summer time, 16:00 UTC.
  assert.equal(approvalDeadlineFor('2026-10-26T08:00:00Z', s).toISOString(), '2026-10-23T16:00:00.000Z');
  // Saturday and Sunday appointments also lapse on Friday; a Tuesday one on Monday.
  assert.equal(approvalDeadlineFor('2026-11-14T09:00:00Z', s).toISOString(), '2026-11-13T17:00:00.000Z');
  assert.equal(approvalDeadlineFor('2026-11-15T09:00:00Z', s).toISOString(), '2026-11-13T17:00:00.000Z');
  assert.equal(approvalDeadlineFor('2026-11-10T09:00:00Z', s).toISOString(), '2026-11-09T17:00:00.000Z');
  // Monday 9 November 09:00: requestable until Friday 16:00 (2 hours before the deadline), not on Saturday.
  assert.equal(requestOpen('2026-11-09T08:00:00Z', s, '2026-11-06T15:00:00Z'), true);
  assert.equal(requestOpen('2026-11-09T08:00:00Z', s, '2026-11-06T15:01:00Z'), false);
  assert.equal(requestOpen('2026-11-09T08:00:00Z', s, '2026-11-07T09:00:00Z'), false);
  // With Saturday as a working day the deadline moves to Saturday.
  assert.equal(approvalDeadlineFor('2026-11-09T08:00:00Z', { ...s, approvalWorkdays: [1, 2, 3, 4, 5, 6] }).toISOString(), '2026-11-07T17:00:00.000Z');
  // Validation: at least one day, integers 1-7.
  assert.deepEqual(normalizeSettings({ approvalWorkdays: [6, 1, 1] }).approvalWorkdays, [1, 6]);
  assert.throws(() => normalizeSettings({ approvalWorkdays: [] }), RangeError);
  assert.throws(() => normalizeSettings({ approvalWorkdays: [0, 8] }), RangeError);
});

test('booking choices: "Non lo so ancora" opens the shared first meeting; that area stays out of the request forms', async () => {
  const { createSite } = await import('../lib/site.mjs');
  const { readKitFiles } = await import('../lib/site-kit.mjs');
  const kit = readKitFiles(new URL('..', import.meta.url).pathname);
  const catalog = { categories: [{ slug: 'carriera', name: 'Orientamento e carriera', services: [] }, { slug: 'da-scegliere', name: 'Non lo so ancora', services: [] }, { slug: 'aziende', name: 'Per la tua organizzazione', services: [] }], professionals: [] };
  const site = createSite({ config: kit.config, layouts: kit.layouts, catalog, globals: kit.globals });
  const it = site.render('{{@needOptions}}');
  assert.match(it, /data-cats="da-scegliere"[^>]*><strong>Non lo so ancora<\/strong>/);
  assert.doesNotMatch(it, /Non sono sicuro/);
  assert.match(site.render('{{@needOptionsEn}}'), /<strong>Not sure yet<\/strong>/);
  const options = site.render('{{@categoryOptions}}', {}, { lang: 'it' });
  assert.match(options, /carriera/);
  assert.doesNotMatch(options, /da-scegliere/);
  assert.doesNotMatch(options, /value="aziende"/, 'the forms already have their own organisations option');
  assert.match(it, /class="need-alt"[^>]*>[^<]*<a href="\/aziende\/#contatto"/);
});
