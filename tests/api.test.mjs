import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbAvailable, freshDb, testDeps, request, PASSWORD } from './helpers.mjs';
import { createPublicApi } from '../lib/public-api.mjs';
import { createAdminApi, COOKIE } from '../lib/admin-api.mjs';
import { runReminders, runRetention, buildIcs } from '../lib/jobs.mjs';
import { totpCode } from '../lib/crypto.mjs';

const available = await dbAvailable();
const opts = { skip: available ? false : 'no local PostgreSQL (set TEST_DATABASE_URL)' };

// Thursday 22 October 2026, 12:00 in Rome (summer time).
const clock = { now: new Date('2026-10-22T10:00:00Z') };
let sql, deps, pub, admin, cookie;
const ctx = { ip: '203.0.113.7' };
let ipCounter = 0;
const freshCtx = () => ({ ip: `198.51.100.${++ipCounter}` });

async function call(handler, method, path, body, { headers, context = ctx } = {}) {
  const res = await handler(request(method, path, { body, headers }), context);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const adminHeaders = () => ({ cookie: `${COOKIE}=${cookie}`, 'x-agenda': '1' });
const adminCall = (method, path, body) => call(admin, method, `/api/admin${path}`, body, { headers: adminHeaders() });

before(async () => {
  if (!available) return;
  sql = await freshDb();
  deps = testDeps(sql, clock);
  pub = createPublicApi(deps);
  admin = createAdminApi(deps);
});

after(async () => { if (sql) await sql.end({ timeout: 1 }); });

test('admin login needs password and a fresh TOTP code', opts, async () => {
  const counter = Math.floor(clock.now.getTime() / 30000);
  const code = totpCode(deps.env.ADMIN_TOTP_SECRET, counter);

  let r = await call(admin, 'POST', '/api/admin/login', { password: 'sbagliata', code });
  assert.equal(r.status, 401);
  r = await call(admin, 'POST', '/api/admin/login', { password: PASSWORD, code: '000000' });
  assert.equal(r.status, 401);

  r = await call(admin, 'POST', '/api/admin/login', { password: PASSWORD, code });
  assert.equal(r.status, 200);
  const setCookie = r.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/);
  cookie = setCookie.split(';')[0].split('=').slice(1).join('=');

  // The same code cannot be used twice.
  r = await call(admin, 'POST', '/api/admin/login', { password: PASSWORD, code }, { context: freshCtx() });
  assert.equal(r.status, 401);

  r = await adminCall('GET', '/me');
  assert.equal(r.status, 200);
  assert.equal(r.body.today, '2026-10-22');
});

test('admin endpoints reject missing session and missing CSRF header', opts, async () => {
  let r = await call(admin, 'GET', '/api/admin/events?from=2026-10-26&to=2026-10-30');
  assert.equal(r.status, 401);
  r = await call(admin, 'PUT', '/api/admin/rules', { rules: [] }, { headers: { cookie: `${COOKIE}=${cookie}` } });
  assert.equal(r.status, 403);
  r = await call(admin, 'PUT', '/api/admin/rules', { rules: [] }, { headers: { ...adminHeaders(), origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('login is rate limited after repeated failures', opts, async () => {
  const c = { ip: '192.0.2.99' };
  for (let i = 0; i < 5; i++) {
    const r = await call(admin, 'POST', '/api/admin/login', { password: 'x', code: '123456' }, { context: c });
    assert.equal(r.status, 401);
  }
  const r = await call(admin, 'POST', '/api/admin/login', { password: PASSWORD, code: '123456' }, { context: c });
  assert.equal(r.status, 429);
});

test('studio sets weekly hours; public sees only bookable slots', opts, async () => {
  let r = await adminCall('PUT', '/rules', {
    rules: [
      { weekday: 1, start_time: '09:00', end_time: '13:00', mode: 'entrambi', public: true },
      { weekday: 3, start_time: '14:00', end_time: '18:00', mode: 'online', public: true },
      { weekday: 4, start_time: '09:00', end_time: '18:00', mode: 'studio', public: false },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.rules.length, 3);

  r = await call(pub, 'GET', '/api/public/slots');
  assert.equal(r.status, 200);
  const first = r.body.days[0];
  assert.equal(first.date, '2026-10-26'); // next Monday; Thursday rule is not public
  assert.deepEqual(first.slots.map((s) => s.time), ['09:00', '10:00', '11:00', '12:00']);

  r = await call(pub, 'GET', '/api/public/slots?mode=online');
  assert.ok(r.body.days.some((d) => d.date === '2026-10-28'));
  r = await call(pub, 'GET', '/api/public/slots?mode=studio');
  assert.ok(!r.body.days.some((d) => d.date === '2026-10-28'));
});

let manageToken;

test('patient books a slot instantly and receives a neutral confirmation', opts, async () => {
  const start = '2026-10-26T09:00:00.000Z'; // 10:00 in Rome (winter time from 25 Oct)
  const r = await call(pub, 'POST', '/api/public/book', {
    start, mode: 'studio', name: 'Giulia Bianchi', email: 'giulia@example.it', privacy: true,
  }, { context: freshCtx() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.booking.start, start);
  manageToken = new URL(r.body.manageUrl).hash.slice(3);
  assert.ok(manageToken.length > 30);

  const mails = deps.mailer.sent;
  const toPatient = mails.find((m) => m.to === 'giulia@example.it');
  assert.match(toPatient.subject, /confermato/);
  assert.match(toPatient.text, /lunedì 26 ottobre 2026, ore 10:00/);
  const toStudio = mails.find((m) => m.to === 'studio@example.it');
  assert.ok(!toStudio.text.includes('Giulia'), 'studio notice must not contain patient name');

  // Stored encrypted.
  const [row] = await sql`select contact_enc from events where kind = 'primo_colloquio'`;
  assert.ok(!row.contact_enc.includes('Giulia'));

  const slots = await call(pub, 'GET', '/api/public/slots');
  assert.ok(!slots.body.days[0].slots.some((s) => s.start === start));
});

test('only one of many simultaneous bookings for the same slot succeeds', opts, async () => {
  const start = '2026-10-26T10:00:00.000Z';
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => call(pub, 'POST', '/api/public/book', {
    start, mode: 'online', name: `Persona ${i}`, email: `p${i}@example.it`, privacy: true,
  }, { context: freshCtx() })));
  const codes = results.map((r) => r.status).sort();
  assert.equal(codes.filter((c) => c === 201).length, 1, JSON.stringify(codes));
  assert.ok(codes.filter((c) => c !== 201).every((c) => c === 409));
  const [{ n }] = await sql`select count(*)::int as n from events where start_at = ${start} and status = 'confermato'`;
  assert.equal(n, 1);
});

test('booking validation: unavailable slot, duplicate email, privacy, honeypot', opts, async () => {
  let r = await call(pub, 'POST', '/api/public/book', {
    start: '2026-10-26T09:30:00.000Z', mode: 'studio', name: 'Ada', email: 'ada@example.it', privacy: true,
  }, { context: freshCtx() });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'slot_unavailable');

  r = await call(pub, 'POST', '/api/public/book', {
    start: '2026-10-26T11:00:00.000Z', mode: 'studio', name: 'Giulia', email: 'GIULIA@example.it', privacy: true,
  }, { context: freshCtx() });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'already_booked');

  r = await call(pub, 'POST', '/api/public/book', {
    start: '2026-10-26T11:00:00.000Z', mode: 'studio', name: 'Ada', email: 'ada@example.it',
  }, { context: freshCtx() });
  assert.equal(r.status, 400);

  r = await call(pub, 'POST', '/api/public/book', {
    start: '2026-10-26T11:00:00.000Z', mode: 'studio', name: 'Bot', email: 'b@example.it', privacy: true, website: 'x',
  }, { context: freshCtx() });
  assert.equal(r.status, 400);
});

test('patient reschedules and then cancels from the personal link', opts, async () => {
  let r = await call(pub, 'POST', '/api/public/manage', { t: manageToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.booking.canChange, true);

  r = await call(pub, 'POST', '/api/public/manage/reschedule', { t: manageToken, start: '2026-10-26T11:00:00.000Z', mode: 'online' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const newToken = new URL(r.body.manageUrl).hash.slice(3);

  // Old link no longer works.
  r = await call(pub, 'POST', '/api/public/manage', { t: manageToken });
  assert.equal(r.status, 404);

  r = await call(pub, 'POST', '/api/public/manage/cancel', { t: newToken });
  assert.equal(r.status, 200);
  r = await call(pub, 'POST', '/api/public/manage', { t: newToken });
  assert.equal(r.body.booking.status, 'annullato');

  // Slot is free again.
  r = await call(pub, 'GET', '/api/public/slots');
  assert.ok(r.body.days[0].slots.some((s) => s.start === '2026-10-26T11:00:00.000Z'));
});

test('cancellation is refused inside the notice window', opts, async () => {
  const r = await call(pub, 'POST', '/api/public/book', {
    start: '2026-10-26T08:00:00.000Z', mode: 'studio', name: 'Luca Verdi', email: 'luca@example.it', privacy: true,
  }, { context: freshCtx() });
  assert.equal(r.status, 201);
  const token = new URL(r.body.manageUrl).hash.slice(3);
  const saved = clock.now;
  clock.now = new Date('2026-10-25T20:00:00Z'); // 12 hours before
  const c = await call(pub, 'POST', '/api/public/manage/cancel', { t: token });
  clock.now = saved;
  assert.equal(c.status, 409);
  assert.equal(c.body.error, 'too_late');
});

test('a short-notice booking can still be undone within an hour of booking', opts, async () => {
  const { sha256, randomToken } = await import('../lib/crypto.mjs');
  const saved = clock.now;
  const realNow = new Date();
  clock.now = realNow;
  const token = randomToken();
  const start = new Date(realNow.getTime() + 5 * 3600000);
  await deps.store.insertEvent({
    kind: 'primo_colloquio', source: 'sito', mode: 'online', start_at: start, end_at: new Date(start.getTime() + 50 * 60000),
    contact_enc: deps.vault.encrypt({ name: 'Rita', email: 'rita@example.it' }), manage_token_hash: sha256(token),
  });
  let r = await call(pub, 'POST', '/api/public/manage', { t: token });
  assert.equal(r.body.booking.canChange, true, 'inside the grace hour');
  clock.now = new Date(realNow.getTime() + 2 * 3600000);
  r = await call(pub, 'POST', '/api/public/manage', { t: token });
  assert.equal(r.body.booking.canChange, false, 'after the grace hour and inside the notice window');
  clock.now = saved;
});

test('studio adds a weekly series; conflicts are skipped, not fatal', opts, async () => {
  // Thursday 29 Oct 17:00 weekly for 4 weeks; block 5 Nov first so one occurrence conflicts.
  let r = await adminCall('POST', '/events', { kind: 'blocco', startDate: '2026-11-05', endDate: '2026-11-05', allDay: true, title: 'Formazione' });
  assert.equal(r.status, 201);

  r = await adminCall('POST', '/events', {
    kind: 'seduta', date: '2026-10-29', time: '17:00', durationMinutes: 50, mode: 'studio',
    name: 'M. R.', email: 'mr@example.it', repeat: { count: 4, intervalWeeks: 1 },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.created.length, 3);
  assert.deepEqual(r.body.skipped.map((s) => s.date), ['2026-11-05']);

  r = await adminCall('GET', '/events?from=2026-10-26&to=2026-11-22');
  const series = r.body.events.filter((e) => e.kind === 'seduta');
  assert.deepEqual(series.map((e) => `${e.date} ${e.time}`), ['2026-10-29 17:00', '2026-11-12 17:00', '2026-11-19 17:00']);
  assert.equal(series[0].name, 'M. R.');

  // Move one occurrence only.
  r = await adminCall('PATCH', `/events/${series[1].id}`, { time: '18:00' });
  assert.equal(r.status, 200);
  assert.equal(r.body.event.time, '18:00');

  // Cancel "this and following" from the second occurrence.
  r = await adminCall('POST', `/events/${series[1].id}/cancel`, { scope: 'following' });
  assert.equal(r.body.cancelled, 2);
  r = await adminCall('GET', '/events?from=2026-10-26&to=2026-11-22');
  assert.equal(r.body.events.filter((e) => e.kind === 'seduta').length, 1);
});

test('a block over an existing appointment is refused with the conflicts listed', opts, async () => {
  const r = await adminCall('POST', '/events', { kind: 'blocco', startDate: '2026-10-26', endDate: '2026-10-26', allDay: true, title: 'Ferie' });
  assert.equal(r.status, 409);
  assert.ok(r.body.conflicts.length >= 1);
});

test('manual appointments and blocks remove public slots', opts, async () => {
  let r = await adminCall('POST', '/events', { kind: 'seduta', date: '2026-11-02', time: '09:00', durationMinutes: 50, name: 'A. B.' });
  assert.equal(r.status, 201);
  r = await adminCall('POST', '/events', { kind: 'blocco', startDate: '2026-11-02', startTime: '11:00', endDate: '2026-11-02', endTime: '13:00' });
  assert.equal(r.status, 201);
  r = await call(pub, 'GET', '/api/public/slots');
  const day = r.body.days.find((d) => d.date === '2026-11-02');
  assert.deepEqual(day.slots.map((s) => s.time), ['10:00']);
});

test('call-back request is stored encrypted and visible to the studio', opts, async () => {
  let r = await call(pub, 'POST', '/api/public/request', {
    name: 'Sara', phone: '+39 333 1234567', mode: 'online', preference: 'sera', privacy: true,
  }, { context: freshCtx() });
  assert.equal(r.status, 201);
  r = await call(pub, 'POST', '/api/public/request', { name: 'Sara', privacy: true }, { context: freshCtx() });
  assert.equal(r.status, 400);
  r = await adminCall('GET', '/requests');
  assert.equal(r.body.requests[0].name, 'Sara');
  assert.equal(r.body.requests[0].phone, '+39 333 1234567');
});

test('settings can be changed within safe limits', opts, async () => {
  let r = await adminCall('PUT', '/settings', { settings: { minNoticeHours: 48 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.minNoticeHours, 48);
  r = await adminCall('PUT', '/settings', { settings: { horizonDays: 999 } });
  assert.equal(r.status, 400);
  await adminCall('PUT', '/settings', { settings: { minNoticeHours: 24 } });
});

test('reminders, calendar feed, export and retention', opts, async () => {
  const exp = await adminCall('GET', '/export');
  assert.equal(exp.status, 200);
  assert.ok(exp.body.events.length > 3);

  const saved = clock.now;
  clock.now = new Date('2026-10-28T17:00:00Z'); // the day before Thursday 29 Oct 17:00
  const before = deps.mailer.sent.length;
  const r = await runReminders(deps);
  assert.equal(r.sent, 1);
  assert.match(deps.mailer.sent[before].subject, /Promemoria/);
  assert.equal((await runReminders(deps)).sent, 0, 'reminder is sent once');

  const ics = await buildIcs(deps);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:Seduta \(studio\)/);
  assert.ok(!ics.includes('M. R.'), 'no patient names in the feed by default');

  clock.now = new Date('2029-01-01T00:00:00Z');
  const ret = await runRetention(deps);
  assert.ok(ret.events > 0);
  const [{ n }] = await sql`select count(*)::int as n from events where contact_enc is not null`;
  assert.equal(n, 0);
  clock.now = saved;
});
