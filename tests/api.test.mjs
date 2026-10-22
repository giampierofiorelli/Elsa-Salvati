import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbAvailable, freshDb, testDeps, request, PASSWORD, createEnrolledUser, totpCode } from './helpers.mjs';
import { createPublicApi } from '../lib/public-api.mjs';
import { createAdminApi, COOKIE } from '../lib/admin-api.mjs';
import { runReminders, runRetention, buildIcs } from '../lib/jobs.mjs';

const available = await dbAvailable();
const opts = { skip: available ? false : 'no local PostgreSQL (set TEST_DATABASE_URL)' };

// Thursday 22 October 2026, 12:00 in Rome (summer time).
const clock = { now: new Date('2026-10-22T10:00:00Z') };
const tick = () => { clock.now = new Date(clock.now.getTime() + 31000); }; // next TOTP step
let sql, deps, pub, admin;
let ipCounter = 0;
const freshCtx = () => ({ ip: `198.51.100.${++ipCounter % 250}` });
const ids = {};      // services and professionals created through the API
const cookies = {};  // session cookies per person

async function call(handler, method, path, body, { headers, context = freshCtx() } = {}) {
  const res = await handler(request(method, path, { body, headers }), context);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0].split('=').slice(1).join('=');
const as = (who) => (method, path, body) => call(admin, method, `/api/admin${path}`, body, {
  headers: { cookie: `${COOKIE}=${cookies[who]}`, 'x-agenda': '1' },
});
const pubCall = (method, path, body) => call(pub, method, `/api/public${path}`, body);

async function login(email, secret, password = PASSWORD) {
  tick();
  return call(admin, 'POST', '/api/admin/login', { email, password, code: totpCode(secret, Math.floor(clock.now.getTime() / 30000)) });
}

let adminUser;

before(async () => {
  if (!available) return;
  sql = await freshDb();
  deps = testDeps(sql, clock);
  pub = createPublicApi(deps);
  admin = createAdminApi(deps);
  adminUser = await createEnrolledUser(deps, { email: 'direzione@example.it', name: 'Direzione', role: 'admin' });
});

after(async () => { if (sql) await sql.end({ timeout: 1 }); });

test('login needs email, password and a fresh authenticator code', opts, async () => {
  let r = await login(adminUser.email, adminUser.secret, 'sbagliata');
  assert.equal(r.status, 401);
  r = await call(admin, 'POST', '/api/admin/login', { email: adminUser.email, password: PASSWORD, code: '000000' });
  assert.equal(r.status, 401);
  r = await login(adminUser.email, adminUser.secret);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  cookies.admin = cookieOf(r);
  // The same code cannot be reused.
  const code = totpCode(adminUser.secret, Math.floor(clock.now.getTime() / 30000));
  r = await call(admin, 'POST', '/api/admin/login', { email: adminUser.email, password: PASSWORD, code });
  assert.equal(r.status, 401);
  r = await as('admin')('GET', '/me');
  assert.equal(r.body.user.role, 'admin');
});

test('admin builds the catalogue: services in three areas and professionals', opts, async () => {
  const cat = await as('admin')('GET', '/catalog');
  assert.deepEqual(cat.body.categories.map((c) => c.slug), ['coaching', 'psicologia', 'psicoterapia']);
  const catId = Object.fromEntries(cat.body.categories.map((c) => [c.slug, c.id]));

  const mk = async (body) => {
    const r = await as('admin')('POST', '/services', body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id;
  };
  ids.coaching = await mk({ categoryId: catId.coaching, name: 'Business coaching individuale', durationMinutes: 60, price: '€80' });
  ids.consulenza = await mk({ categoryId: catId.psicologia, name: 'Consulenza psicologica', durationMinutes: 50 });
  ids.terapia = await mk({ categoryId: catId.psicoterapia, name: 'Psicoterapia individuale', durationMinutes: 50 });
  let r = await as('admin')('POST', '/services', { categoryId: catId.coaching, name: 'Business coaching individuale' });
  assert.equal(r.status, 409, 'duplicate page address is refused');

  const pro = async (body) => {
    const res = await as('admin')('POST', '/professionals', body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.id;
  };
  ids.elsa = await pro({ name: 'Dott.ssa Elsa Salvati', title: 'Psicologa · Business coach', notifyEmail: 'elsa@example.it' });
  ids.marco = await pro({ name: 'Dott. Marco Neri', title: 'Psicoterapeuta', notifyEmail: 'marco@example.it' });
  ids.laura = await pro({ name: 'Dott.ssa Laura Riva', title: 'Psicologa psicoterapeuta' });

  r = await as('admin')('PUT', `/professionals/${ids.elsa}/services`, { offerings: [
    { serviceId: ids.coaching, inStudio: true, online: true },
    { serviceId: ids.consulenza, inStudio: true, online: false },
  ] });
  assert.equal(r.status, 200);
  r = await as('admin')('PUT', `/professionals/${ids.marco}/services`, { offerings: [{ serviceId: ids.terapia, inStudio: true, online: false }] });
  assert.equal(r.status, 200);
  r = await as('admin')('PUT', `/professionals/${ids.laura}/services`, { offerings: [{ serviceId: ids.terapia, inStudio: true, online: true }] });
  assert.equal(r.status, 200);
  r = await as('admin')('PUT', `/professionals/${ids.laura}/services`, { offerings: [{ serviceId: ids.terapia, inStudio: false, online: false }] });
  assert.equal(r.status, 400, 'at least one mode per service');
});

test('admin invites a professional who activates the account with a QR code', opts, async () => {
  let r = await as('admin')('POST', '/users', { email: 'marco@example.it', name: 'Marco Neri', role: 'professionista', professionalId: ids.marco });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const token = new URL(r.body.inviteUrl).hash.split('=')[1];
  assert.ok(token.length > 30);

  r = await call(admin, 'POST', '/api/admin/invite/info', { t: token });
  assert.equal(r.status, 200);
  assert.match(r.body.otpauth, /^otpauth:\/\/totp\/Blooming:marco%40example\.it\?secret=[A-Z2-7]+&issuer=Blooming/);
  const secret = r.body.secret;
  // Re-opening the link shows the same QR (the app may already have scanned it).
  assert.equal((await call(admin, 'POST', '/api/admin/invite/info', { t: token })).body.secret, secret);

  tick();
  r = await call(admin, 'POST', '/api/admin/invite/accept', { t: token, password: 'corta', code: totpCode(secret, Math.floor(clock.now.getTime() / 30000)) });
  assert.equal(r.status, 400);
  r = await call(admin, 'POST', '/api/admin/invite/accept', { t: token, password: 'una-password-lunga-marco', code: '123456' });
  assert.equal(r.status, 400);
  r = await call(admin, 'POST', '/api/admin/invite/accept', { t: token, password: 'una-password-lunga-marco', code: totpCode(secret, Math.floor(clock.now.getTime() / 30000)) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  cookies.marco = cookieOf(r);
  ids.marcoSecret = secret;

  // The link works only once.
  r = await call(admin, 'POST', '/api/admin/invite/info', { t: token });
  assert.equal(r.status, 404);

  r = await as('marco')('GET', '/me');
  assert.equal(r.body.user.role, 'professionista');
  assert.deepEqual(r.body.professionals.map((p) => p.id), [ids.marco]);

  // A professional cannot manage accounts or services.
  assert.equal((await as('marco')('GET', '/users')).status, 403);
  assert.equal((await as('marco')('POST', '/services', { categoryId: '1', name: 'X' })).status, 403);
});

test('each professional sets their own weekly hours', opts, async () => {
  let r = await as('admin')('PUT', '/rules', { professionalId: ids.elsa, rules: [
    { weekday: 1, start_time: '09:00', end_time: '13:00', mode: 'entrambi', public: true },
  ] });
  assert.equal(r.status, 200);
  r = await as('admin')('PUT', '/rules', { professionalId: ids.laura, rules: [
    { weekday: 1, start_time: '09:00', end_time: '12:00', mode: 'entrambi', public: true },
  ] });
  assert.equal(r.status, 200);
  // Marco tries to write Elsa's hours: the request is applied to his own agenda only.
  r = await as('marco')('PUT', '/rules', { professionalId: ids.elsa, rules: [
    { weekday: 1, start_time: '10:00', end_time: '12:00', mode: 'studio', public: true },
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.body.professionalId, ids.marco);
  r = await as('admin')('GET', `/rules?professional=${ids.elsa}`);
  assert.deepEqual(r.body.rules.map((x) => `${x.start_time}-${x.end_time}`), ['09:00-13:00']);
});

test('public catalogue lists areas, services, professionals and modes', opts, async () => {
  const r = await pubCall('GET', '/catalog');
  assert.equal(r.status, 200);
  const coaching = r.body.categories.find((c) => c.slug === 'coaching');
  assert.equal(coaching.services[0].name, 'Business coaching individuale');
  assert.deepEqual(coaching.services[0].professionals.map((p) => [p.name, p.modes.join('+')]), [['Dott.ssa Elsa Salvati', 'studio+online']]);
  const terapia = r.body.categories.find((c) => c.slug === 'psicoterapia').services[0];
  assert.deepEqual(terapia.professionals.map((p) => p.name).sort(), ['Dott. Marco Neri', 'Dott.ssa Laura Riva']);
  assert.ok(!JSON.stringify(r.body).includes('notify'), 'no private fields in the public catalogue');
});

test('slots depend on professional, service duration and allowed modes', opts, async () => {
  let r = await pubCall('GET', `/slots?service=${ids.terapia}&professional=${ids.marco}&mode=online`);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'mode_unavailable');
  r = await pubCall('GET', `/slots?service=${ids.terapia}&professional=${ids.elsa}&mode=studio`);
  assert.equal(r.status, 404, 'Elsa does not offer psychotherapy');
  r = await pubCall('GET', `/slots?service=${ids.terapia}&professional=${ids.marco}&mode=studio`);
  assert.deepEqual(r.body.days[0].slots.map((s) => s.time), ['10:00', '11:00']);
  r = await pubCall('GET', `/slots?service=${ids.coaching}&professional=${ids.elsa}&mode=online`);
  assert.equal(r.body.durationMinutes, 60);
  assert.equal(r.body.days[0].date, '2026-10-26');
});

let manageToken;

test('two professionals can be booked at the same hour; one person cannot be double-booked', opts, async () => {
  const start = '2026-10-26T09:00:00.000Z'; // Monday 10:00 in Rome
  let r = await pubCall('POST', '/book', { start, mode: 'studio', service: ids.terapia, professional: ids.marco, name: 'Giulia Bianchi', email: 'giulia@example.it', privacy: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  manageToken = new URL(r.body.manageUrl).hash.slice(3);
  assert.equal(r.body.booking.professional.name, 'Dott. Marco Neri');

  r = await pubCall('POST', '/book', { start, mode: 'online', service: ids.coaching, professional: ids.elsa, name: 'Paolo Verdi', email: 'paolo@example.it', privacy: true });
  assert.equal(r.status, 201, 'Elsa is free at the same time');
  assert.equal(new Date(r.body.booking.end) - new Date(r.body.booking.start), 60 * 60000, 'coaching lasts 60 minutes');

  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => pubCall('POST', '/book', {
    start: '2026-10-26T10:00:00.000Z', mode: 'studio', service: ids.terapia, professional: ids.laura, name: `Persona ${i}`, email: `p${i}@example.it`, privacy: true,
  })));
  const codes = results.map((x) => x.status);
  assert.equal(codes.filter((c) => c === 201).length, 1, JSON.stringify(codes));
  assert.ok(codes.filter((c) => c !== 201).every((c) => c === 409));

  r = await pubCall('POST', '/book', { start: '2026-10-26T10:00:00.000Z', mode: 'online', service: ids.terapia, professional: ids.marco, name: 'Ada', email: 'ada@example.it', privacy: true });
  assert.equal(r.status, 400, 'Marco does not work online');

  const notices = deps.mailer.sent.filter((m) => m.to === 'marco@example.it');
  assert.ok(notices.length >= 1, 'the professional is notified');
  assert.ok(!notices[0].text.includes('Giulia'), 'without the patient name');
  const toPatient = deps.mailer.sent.find((m) => m.to === 'giulia@example.it');
  assert.match(toPatient.text, /Con: Dott\. Marco Neri/);
});

test('each professional sees only their own agenda', opts, async () => {
  let r = await as('marco')('GET', '/events?from=2026-10-26&to=2026-10-26&professional=all');
  assert.ok(r.body.events.length >= 1);
  assert.ok(r.body.events.every((e) => e.professionalId === ids.marco));
  r = await as('admin')('GET', '/events?from=2026-10-26&to=2026-10-26&professional=all');
  assert.deepEqual([...new Set(r.body.events.map((e) => e.professionalName))].sort(), ['Dott. Marco Neri', 'Dott.ssa Elsa Salvati', 'Dott.ssa Laura Riva']);
  const elsaEvent = r.body.events.find((e) => e.professionalId === ids.elsa);
  assert.equal(elsaEvent.serviceName, 'Business coaching individuale');
  assert.equal((await as('marco')('PATCH', `/events/${elsaEvent.id}`, { time: '12:00' })).status, 404);
  assert.equal((await as('marco')('POST', `/events/${elsaEvent.id}/cancel`, {})).status, 404);
  // Marco adds an appointment: it lands in his agenda whatever he sends.
  r = await as('marco')('POST', '/events', { professionalId: ids.elsa, kind: 'seduta', date: '2026-10-27', time: '15:00', durationMinutes: 50, name: 'M. R.', serviceId: ids.terapia });
  assert.equal(r.status, 201);
  const ev = await deps.store.getEvent(r.body.created[0]);
  assert.equal(ev.professional_id, ids.marco);
});

test('patient reschedules and cancels from the personal link', opts, async () => {
  let r = await pubCall('POST', '/manage', { t: manageToken });
  assert.equal(r.body.booking.professional.name, 'Dott. Marco Neri');
  r = await pubCall('POST', '/manage/slots', { t: manageToken, mode: 'studio' });
  assert.ok(r.body.days[0].slots.some((s) => s.time === '10:00'), 'own current slot is offered again');
  assert.equal((await pubCall('POST', '/manage/slots', { t: manageToken, mode: 'online' })).status, 400);
  r = await pubCall('POST', '/manage/reschedule', { t: manageToken, start: '2026-10-26T10:00:00.000Z', mode: 'studio' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const newToken = new URL(r.body.manageUrl).hash.slice(3);
  r = await pubCall('POST', '/manage/cancel', { t: newToken });
  assert.equal(r.status, 200);
  r = await pubCall('POST', '/manage', { t: newToken });
  assert.equal(r.body.booking.status, 'annullato');
});

test('professionals change modes of their services but cannot add services', opts, async () => {
  let r = await as('marco')('PUT', `/professionals/${ids.marco}/services`, { offerings: [{ serviceId: ids.terapia, inStudio: true, online: true }] });
  assert.equal(r.status, 200);
  r = await pubCall('GET', `/slots?service=${ids.terapia}&professional=${ids.marco}&mode=online`);
  assert.equal(r.status, 200, 'online is now available');
  r = await as('marco')('PUT', `/professionals/${ids.marco}/services`, { offerings: [
    { serviceId: ids.terapia, inStudio: true, online: true }, { serviceId: ids.coaching, inStudio: true, online: false },
  ] });
  assert.equal(r.status, 403);
  r = await as('marco')('PUT', `/professionals/${ids.elsa}/services`, { offerings: [] });
  assert.equal(r.status, 404);
  r = await as('marco')('PATCH', `/professionals/${ids.marco}`, { bio: 'Lavoro con adulti.', name: 'Altro nome' });
  assert.equal(r.status, 200);
  const p = await deps.store.getProfessional(ids.marco);
  assert.equal(p.bio, 'Lavoro con adulti.');
  assert.equal(p.name, 'Dott. Marco Neri', 'name is changed only by the admin');
});

test('call-back requests reach the chosen professional', opts, async () => {
  let r = await pubCall('POST', '/request', { name: 'Sara', phone: '+39 333 1234567', category: 'psicoterapia', professional: ids.marco, privacy: true });
  assert.equal(r.status, 201);
  r = await pubCall('POST', '/request', { name: 'Laura Bianchi', organization: 'Azienda Srl', email: 'hr@azienda.it', category: 'aziende', privacy: true });
  assert.equal(r.status, 201);
  r = await as('marco')('GET', '/requests');
  assert.deepEqual(r.body.requests.map((x) => x.name), ['Sara']);
  r = await as('admin')('GET', '/requests');
  assert.equal(r.body.requests.length, 2);
  const company = r.body.requests.find((x) => x.category === 'aziende');
  assert.equal(company.organization, 'Azienda Srl');
  assert.equal(r.body.requests.find((x) => x.name === 'Sara').organization, undefined);
});

test('deactivated accounts lose access immediately', opts, async () => {
  const users = (await as('admin')('GET', '/users')).body.users;
  const marco = users.find((u) => u.email === 'marco@example.it');
  assert.equal(marco.enrolled, true);
  assert.equal((await as('admin')('PATCH', `/users/${marco.id}`, { active: false })).status, 200);
  assert.equal((await as('marco')('GET', '/me')).status, 401);
  assert.equal((await as('admin')('PATCH', `/users/${adminUser.id}`, { active: false })).status, 400, 'cannot lock yourself out');
  // A new invitation resets the access.
  await as('admin')('PATCH', `/users/${marco.id}`, { active: true });
  const r = await as('admin')('POST', `/users/${marco.id}/invite`, {});
  assert.ok(r.body.inviteUrl.includes('#invito='));
  assert.equal((await login('marco@example.it', ids.marcoSecret, 'una-password-lunga-marco')).status, 401, 'old credentials no longer work');
});

test('reminders, personal calendar feed, export and retention', opts, async () => {
  const saved = clock.now;
  clock.now = new Date('2026-10-25T12:00:00Z'); // the day before Monday's bookings
  const before = deps.mailer.sent.length;
  const r = await runReminders(deps);
  assert.ok(r.sent >= 1);
  assert.match(deps.mailer.sent[before].subject, /Promemoria/);

  const ics = await buildIcs(deps, { professionalId: ids.marco });
  assert.match(ics, /SUMMARY:Seduta/);
  assert.ok(!ics.includes('Elsa'), 'only Marco\'s agenda');
  clock.now = saved;
  tick();
  const feed = await as('admin')('POST', '/me/calendar', {});
  assert.match(feed.body.url, /\/api\/calendar\.ics\?k=/);
  const exp = await as('admin')('GET', '/export');
  assert.equal(exp.status, 200);

  clock.now = new Date('2029-01-01T00:00:00Z');
  const ret = await runRetention(deps);
  assert.ok(ret.events > 0);
  clock.now = saved;
});
