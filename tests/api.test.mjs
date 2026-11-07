import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbAvailable, freshDb, testDeps, request, PASSWORD, createEnrolledUser, totpCode } from './helpers.mjs';
import { createPublicApi } from '../lib/public-api.mjs';
import { createAdminApi, COOKIE } from '../lib/admin-api.mjs';
import { runReminders, runRetention, buildIcs } from '../lib/jobs.mjs';
import { readKitFiles, withCatalog } from '../lib/site-kit.mjs';
import { pageResponse } from '../lib/page-server.mjs';
import { createSite } from '../lib/site.mjs';

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
  assert.deepEqual(cat.body.categories.map((c) => c.slug), ['carriera', 'coaching', 'psicologia', 'psicoterapia']);
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
// Website requests wait for the professional's approval; tests about other things approve them directly.
const approvePending = () => sql`update events set status = 'confermato', approved_at = now() where status = 'in_attesa'`;

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
  await approvePending();
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
  await approvePending();
  const before = deps.mailer.sent.length;
  const r = await runReminders(deps);
  assert.ok(r.sent >= 1);
  assert.match(deps.mailer.sent[before].subject, /Conferma il tuo appuntamento/, 'the day before, the person is asked to confirm');

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

// ---------- v4: two languages, free first meeting, "help me choose" ----------

test('v4: first meeting with "help me choose", interview language and fair assignment', opts, async () => {
  clock.now = new Date('2026-11-05T09:00:00Z'); // Thursday; next Monday is 9 November
  const r0 = await login(adminUser.email, adminUser.secret);
  assert.equal(r0.status, 200);
  cookies.admin = cookieOf(r0);

  const cat = await as('admin')('GET', '/catalog');
  const carriera = cat.body.categories.find((c) => c.slug === 'carriera');
  assert.ok(carriera, 'career area exists');
  assert.equal(carriera.name_en, 'Career coaching & guidance');

  let r = await as('admin')('POST', '/services', {
    categoryId: carriera.id, name: 'Primo colloquio conoscitivo', nameEn: 'Free first meeting',
    durationMinutes: 30, price: 'Gratuito', priceEn: 'Free', firstMeeting: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const first = r.body.id;

  const mkPro = async (body) => {
    const res = await as('admin')('POST', '/professionals', body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.id;
  };
  const anna = await mkPro({ name: 'Anna Prova', title: 'Psicologa', titleEn: 'Psychologist', languages: ['it', 'en'] });
  const bea = await mkPro({ name: 'Bea Prova', title: 'Psicologa', languages: ['it'] });
  r = await as('admin')('POST', '/professionals', { name: 'Zeta Prova', languages: ['fr'] });
  assert.equal(r.status, 400, 'only Italian and English');

  for (const [pro, start, end] of [[anna, '09:00', '11:00'], [bea, '10:00', '12:00']]) {
    r = await as('admin')('PUT', `/professionals/${pro}/services`, { offerings: [{ serviceId: first, inStudio: false, online: true }] });
    assert.equal(r.status, 200);
    r = await as('admin')('PUT', '/rules', { professionalId: pro, rules: [{ weekday: 1, start_time: start, end_time: end, mode: 'online', public: true }] });
    assert.equal(r.status, 200);
  }

  // Public catalogue carries the English fields and the languages.
  r = await pubCall('GET', '/catalog');
  const svc = r.body.categories.find((c) => c.slug === 'carriera').services.find((s) => s.id === first);
  assert.equal(svc.firstMeeting, true);
  assert.equal(svc.nameEn, 'Free first meeting');
  assert.deepEqual(svc.professionals.find((p) => p.id === anna).languages, ['it', 'en']);

  // "Help me choose": the union of everyone's free times; in English, only who speaks English.
  const times = (res) => res.body.days.find((d) => d.date === '2026-11-09').slots.map((s) => s.time);
  r = await pubCall('GET', `/slots?service=${first}&professional=any&mode=online`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(times(r), ['09:00', '10:00', '11:00']);
  r = await pubCall('GET', `/slots?service=${first}&professional=any&mode=online&lang=en`);
  assert.deepEqual(times(r), ['09:00', '10:00']);
  r = await pubCall('GET', `/slots?service=${first}&professional=${bea}&mode=online&lang=en`);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'lang_unavailable');

  // Booking with "help me choose": assigned at confirmation, the less busy professional first.
  const start = '2026-11-09T09:00:00.000Z'; // Monday 10:00 in Rome: both are free
  const book = (email, extra = {}) => pubCall('POST', '/book', {
    start, mode: 'online', service: first, professional: 'any', name: 'Persona Prova', email, privacy: true, ...extra,
  });
  r = await book('uno@example.it');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.booking.assigned, true);
  assert.equal(r.body.booking.lang, 'it');
  const firstAssigned = r.body.booking.professional.id;
  r = await book('due@example.it');
  assert.equal(r.status, 201, 'the other professional is still free');
  assert.notEqual(r.body.booking.professional.id, firstAssigned);
  r = await book('tre@example.it');
  assert.equal(r.status, 409, 'nobody left at that time');

  // English booking goes only to someone who speaks English.
  r = await book('quattro@example.it', { start: '2026-11-09T08:00:00.000Z', lang: 'en' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.booking.professional.id, anna);
  r = await book('cinque@example.it', { start: '2026-11-09T10:00:00.000Z', lang: 'en' });
  assert.equal(r.status, 409, 'at 11:00 only Bea is free, and she works in Italian');

  const rows = await sql`select lang, assigned from events where professional_id = ${anna} and status in ('confermato', 'in_attesa') order by start_at`;
  assert.deepEqual(rows.map((x) => [x.lang, x.assigned]), [['en', true], ['it', true]]);

  // Requests accept the career area and the language.
  r = await pubCall('POST', '/request', { name: 'Persona Prova', email: 'sei@example.it', category: 'carriera', lang: 'en', privacy: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

test('v4: the management link follows the booking language', opts, async () => {
  const svc = (await pubCall('GET', '/catalog')).body.categories.find((c) => c.slug === 'carriera').services[0];
  const r = await pubCall('POST', '/book', {
    start: '2026-11-16T08:00:00.000Z', mode: 'online', service: svc.id, professional: 'any', lang: 'en',
    name: 'Persona Prova', email: 'sette@example.it', privacy: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.manageUrl, /\/en\/book\/manage\/#t=/);
});

// ---------- security and privacy (verification of 7 November 2026) ----------

test('logout ends the session on the server, so a copied cookie stops working', opts, async () => {
  const r = await login(adminUser.email, adminUser.secret);
  const copied = cookieOf(r);
  const headers = { cookie: `${COOKIE}=${copied}`, 'x-agenda': '1' };
  assert.equal((await call(admin, 'GET', '/api/admin/me', undefined, { headers })).status, 200);
  await call(admin, 'POST', '/api/admin/logout', {}, { headers });
  assert.equal((await call(admin, 'GET', '/api/admin/me', undefined, { headers })).status, 401);
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
});

test('failed logins from one address do not lock the account for everyone', opts, async () => {
  const attacker = { ip: '203.0.113.7' };
  for (let i = 0; i < 6; i++) {
    tick();
    await call(admin, 'POST', '/api/admin/login', { email: adminUser.email, password: 'sbagliata', code: '000000' }, { context: attacker });
  }
  tick();
  const blocked = await call(admin, 'POST', '/api/admin/login', { email: adminUser.email, password: PASSWORD, code: totpCode(adminUser.secret, Math.floor(clock.now.getTime() / 30000)) }, { context: attacker });
  assert.equal(blocked.status, 429, 'the guessing address is slowed down');
  const r = await login(adminUser.email, adminUser.secret); // another address
  assert.equal(r.status, 200, 'the real user still gets in');
  cookies.admin = cookieOf(r);
});

test('names with links and emails that change a mailto link are refused', opts, async () => {
  let r = await pubCall('POST', '/request', { name: 'Vinci un premio su https://truffa.example', email: 'a@example.it', category: 'coaching', privacy: true });
  assert.equal(r.status, 400);
  r = await pubCall('POST', '/request', { name: 'Persona Prova', email: 'a@example.it?bcc=x@evil.example', category: 'coaching', privacy: true });
  assert.equal(r.status, 400);
});

test('the administrator finds, exports and erases one person\'s data, and it is logged', opts, async () => {
  let r = await pubCall('POST', '/request', { name: 'Giulia Verdi', email: 'Giulia.Verdi@Example.it', category: 'psicologia', privacy: true });
  assert.equal(r.status, 201);
  r = await as('admin')('GET', '/people?email=giulia.verdi@example.it');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.requests.length, 1, 'found whatever the capital letters');
  assert.equal(r.body.requests[0].name, 'Giulia Verdi');
  assert.ok(r.body.requests[0].privacyVersion, 'the notice version is saved');
  assert.equal((await as('marco')('GET', '/people?email=giulia.verdi@example.it')).status, 401, 'only administrators (Marco is deactivated here)');
  assert.equal((await as('admin')('POST', '/people/forget', { email: 'giulia.verdi@example.it' })).status, 400, 'needs confirmation');
  r = await as('admin')('POST', '/people/forget', { email: 'giulia.verdi@example.it', confirm: true });
  assert.equal(r.body.requests, 1);
  r = await as('admin')('GET', '/people?email=giulia.verdi@example.it');
  assert.equal(r.body.requests.length, 0);
  const log = (await as('admin')('GET', '/audit')).body.entries.map((e) => e.action);
  assert.ok(log.includes('cancellazione dati di una persona'));
  assert.ok(log.includes('ricerca dati di una persona'));
});

test('the personal link stops working a day after the appointment', opts, async () => {
  const svc = (await pubCall('GET', '/catalog')).body.categories.find((c) => c.slug === 'carriera').services[0];
  const r = await pubCall('POST', '/book', {
    start: '2026-11-16T09:00:00.000Z', mode: 'online', service: svc.id, professional: 'any', lang: 'it',
    name: 'Persona Prova', email: 'otto@example.it', privacy: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const token = new URL(r.body.manageUrl).hash.slice(3);
  assert.equal((await pubCall('POST', '/manage', { t: token })).status, 200);
  const saved = clock.now;
  clock.now = new Date('2026-11-18T10:00:00Z');
  assert.equal((await pubCall('POST', '/manage', { t: token })).status, 404);
  clock.now = saved;
});

test('the confirmation email states the fee of the booked service, and reminders say how to change', opts, async () => {
  const svc = (await pubCall('GET', '/catalog')).body.categories.find((c) => c.slug === 'carriera').services[0];
  const before = deps.mailer.sent.length;
  const r = await pubCall('POST', '/book', {
    start: '2026-11-16T10:00:00.000Z', mode: 'online', service: svc.id, professional: 'any', lang: 'it',
    name: 'Persona Prova', email: 'nove@example.it', privacy: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const request = deps.mailer.sent.slice(before).find((m) => m.to === 'nove@example.it');
  assert.match(request.subject, /Abbiamo ricevuto la tua richiesta/);
  const pending = (await as('admin')('GET', '/events/pending')).body.events.find((e) => e.email === 'nove@example.it');
  assert.equal((await as('admin')('POST', `/events/${pending.id}/approve`, {})).status, 200);
  const mail = deps.mailer.sent.slice(before).find((m) => m.to === 'nove@example.it' && /approvata/.test(m.subject));
  assert.match(mail.text, /Tariffa: Gratuito/);
  assert.match(mail.subject, /Blooming/);
  assert.doesNotMatch(mail.subject, /psicolog/i, 'the subject does not reveal a psychology practice');
});

test('references to things that do not exist are refused with 400, not a server error', opts, async () => {
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  const r = await as('admin')('POST', '/services', { categoryId: '999999', name: 'Prova', durationMinutes: 30 });
  assert.equal(r.status, 400, JSON.stringify(r.body));
});

// ---------- page editor ----------

const editorKit = () => {
  const files = readKitFiles(new URL('..', import.meta.url).pathname);
  const hero = (title) => ({ type: 'page-hero', data: { eyebrow: 'Prova', title } });
  return withCatalog({
    ...files,
    content: [
      { key: 'prova', lang: 'it', path: '/prova/', nav: 'servizi', title: 'Pagina di prova', description: 'Descrizione', blocks: [hero('Titolo iniziale'), { type: 'closing-cta', data: { title: 'Chiusura', buttons: [{ label: 'Vedi la versione inglese', to: { kind: 'page', key: 'prova' }, style: 'light' }] } }] },
      { key: 'prova', lang: 'en', path: '/en/test/', nav: 'help', title: 'Test page', description: 'Description', blocks: [hero('First title')] },
    ],
  });
};

test('page editor: only administrators and accounts allowed to edit the site can use it', opts, async () => {
  const purged = [];
  const kit = editorKit();
  const ed = createAdminApi({ ...deps, kit, purge: async (tags) => { purged.push(...tags); } });
  const call2 = (who, method, path, body) => call(ed, method, `/api/admin${path}`, body, { headers: { cookie: `${COOKIE}=${cookies[who]}`, 'x-agenda': '1' } });
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));

  // A professional without the permission is refused; with it, she can edit.
  const anna = await createEnrolledUser(deps, { email: 'redattrice@example.it', name: 'Redattrice', role: 'professionista', professionalId: ids.elsa });
  cookies.anna = cookieOf(await login(anna.email, anna.secret));
  assert.equal((await call2('anna', 'GET', '/site/pages')).status, 403);
  await as('admin')('PATCH', `/users/${anna.id}`, { canEditSite: true });
  assert.equal((await call2('anna', 'GET', '/site/pages')).status, 401, 'changing permissions ends open sessions');
  cookies.anna = cookieOf(await login(anna.email, anna.secret));
  const list = await call2('anna', 'GET', '/site/pages');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.pages.length, 2, 'starting content added once');
  assert.equal((await call2('anna', 'GET', '/people?email=x@example.it')).status, 403, 'editing the site gives no access to people\'s data');

  const it = list.body.pages.find((p) => p.lang === 'it');
  const pageRes = await call2('anna', 'GET', `/site/pages/${it.id}`);
  assert.equal(pageRes.status, 200);
  const { page, library, linkTargets } = pageRes.body;
  assert.ok(library.find((b) => b.type === 'rows'), 'block library for the forms');
  assert.ok(linkTargets.find((t) => t.key === 'prova' && t.it && t.en), 'pages to link to, by key');

  // Save a draft: change the title and add a block; the server cleans what it receives.
  const blocks = [...page.draft.blocks];
  blocks[0] = { ...blocks[0], data: { ...blocks[0].data, title: 'Titolo nuovo' } };
  blocks.splice(1, 0, { type: 'text-columns', data: { eyebrow: 'Sezione', title: 'Aggiunta', body: [{ kind: 'p', text: { p: [[{ t: 'Testo ' }, { t: 'grassetto', b: true, onclick: 'x' }]] } }] } });
  let r = await call2('anna', 'PUT', `/site/pages/${it.id}`, { title: page.draft.title, description: '', blocks, expected: page.draftUpdatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body.draft.blocks[1].data.body[0].text.p[0][1]).sort(), ['b', 't']);
  const savedAt = r.body.draftUpdatedAt;

  // Someone else saving from an old copy is told, instead of overwriting.
  r = await call2('admin', 'PUT', `/site/pages/${it.id}`, { title: 'Altro titolo', description: '', blocks, expected: page.draftUpdatedAt });
  assert.equal(r.status, 409);
  // Invalid content gets a precise message.
  r = await call2('anna', 'PUT', `/site/pages/${it.id}`, { title: 'Pagina', blocks: [{ type: 'steps', data: { items: [] } }], expected: savedAt });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /Passi numerati/);

  // Preview: draft with internal notes, links in the right language.
  r = await call2('anna', 'POST', '/site/preview', { pageId: it.id, title: 'Pagina di prova', blocks: [...blocks, { type: 'rows', note: 'nota per Elsa', data: { eyebrow: 'Voci', items: [{ title: 'Una' }] } }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.html, /Titolo nuovo/);
  assert.match(r.body.html, /02 · Voci/);
  assert.match(r.body.html, /class="draft-note">nota per Elsa/);
  assert.match(r.body.html, /href="\/en\/test\/"/);

  // The public page (production) still shows the published version until "Pubblica".
  const serve = (path, env) => pageResponse(new Request(`https://studio.example.it/.netlify/functions/page?p=${encodeURIComponent(path)}`), {
    kit, env, store: deps.store, loadCatalog: () => kit.loadCatalog(), createSite,
  });
  let pub1 = await serve('/prova/', { CONTEXT: 'production' });
  let html = await pub1.text();
  assert.match(html, /Titolo iniziale/);
  assert.equal(pub1.headers.get('netlify-cache-tag').split(',')[0], `page-${it.id}`);
  assert.match(pub1.headers.get('netlify-cdn-cache-control'), /durable/);
  assert.doesNotMatch(html, /draft-note/);
  const staging = await serve('/prova/', { CONTEXT: 'branch-deploy' });
  assert.match(await staging.text(), /Titolo nuovo/, 'staging shows the draft');
  assert.equal(staging.headers.get('cache-control'), 'no-store');

  r = await call2('anna', 'POST', `/site/pages/${it.id}/publish`, {});
  assert.equal(r.status, 200);
  assert.deepEqual(purged, [`page-${it.id}`], 'only that page leaves the cache');
  pub1 = await serve('/prova/', { CONTEXT: 'production' });
  assert.match(await pub1.text(), /Titolo nuovo/);
  assert.equal((await serve('/non-esiste/', { CONTEXT: 'production' })).status, 404);

  // History: restore the starting version as a draft.
  r = await call2('anna', 'GET', `/site/pages/${it.id}/versions`);
  assert.deepEqual(r.body.versions.map((v) => v.kind), ['pubblicazione', 'iniziale']);
  r = await call2('anna', 'POST', `/site/pages/${it.id}/versions/${r.body.versions[1].id}/restore`, {});
  assert.equal(r.status, 200);
  const again = await call2('anna', 'GET', `/site/pages/${it.id}`);
  assert.equal(again.body.page.draft.blocks[0].data.title, 'Titolo iniziale');
  assert.equal(again.body.page.hasChanges, true);
  const log = (await as('admin')('GET', '/audit')).body.entries.map((e) => e.action);
  assert.ok(log.includes('pagina pubblicata'));
});

test('page editor: images are checked from their bytes; fakes and oversized files are refused', opts, async () => {
  const kit = editorKit();
  const ed = createAdminApi({ ...deps, kit, purge: async () => {} });
  const call2 = (method, path, body) => call(ed, method, `/api/admin${path}`, body, { headers: { cookie: `${COOKIE}=${cookies.admin}`, 'x-agenda': '1' } });
  // Minimal headers with the size inside: what the server reads to check type and dimensions.
  const jpeg = (w, h) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255]), Buffer.alloc(200)]).toString('base64');
  const webp = (w, h) => {
    const b = Buffer.alloc(40);
    b.write('RIFF', 0); b.writeUInt32LE(32, 4); b.write('WEBPVP8X', 8); b.writeUInt32LE(10, 16);
    b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
    return b.toString('base64');
  };
  let r = await call2('POST', '/site/images', { '480.webp': webp(480, 640), '800.webp': webp(800, 1067), '800.jpg': jpeg(800, 1067) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.id, /^[a-f0-9]{24}$/);
  const media = (await import('../lib/site-api.mjs')).createMediaHandler({ store: deps.store });
  const img = await media(new Request(`https://studio.example.it/media/${r.body.id}-800.jpg`));
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.match(img.headers.get('cache-control'), /immutable/);
  // A script renamed as an image, an SVG, or a file wider than declared: refused.
  r = await call2('POST', '/site/images', { '480.webp': Buffer.from('<svg onload=alert(1)>').toString('base64'), '800.webp': webp(800, 1067), '800.jpg': jpeg(800, 1067) });
  assert.equal(r.status, 400);
  r = await call2('POST', '/site/images', { '480.webp': webp(2000, 1500), '800.webp': webp(800, 1067), '800.jpg': jpeg(800, 1067) });
  assert.equal(r.status, 400);
  assert.equal((await media(new Request('https://studio.example.it/media/../../etc/passwd'))).status, 404);
});

// ---------- media library ----------

const fakeJpeg = (w, h, pad = 200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255]), Buffer.alloc(pad)]).toString('base64');
const fakeWebp = (w, h) => {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0); b.writeUInt32LE(32, 4); b.write('WEBPVP8X', 8); b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b.toString('base64');
};

test('media library: upload once, see where it is used, delete only when unused; PDFs served safely', opts, async () => {
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  const media = (await import('../lib/media-api.mjs')).createMediaDelivery({ store: deps.store, mediaStore: deps.mediaStore });

  // An image in the "content" role: WebP 480/800/1200 + JPEG 800, made in the browser.
  let r = await as('admin')('POST', '/site/media', {
    role: 'content', name: 'C:\\Foto\\elsa<script>.jpg', alt_it: 'Elsa Salvati', alt_en: 'Elsa Salvati',
    files: { '480.webp': fakeWebp(480, 640), '800.webp': fakeWebp(800, 1067), '1200.webp': fakeWebp(1200, 1600), '800.jpg': fakeJpeg(800, 1067) },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const img = r.body.media;
  assert.equal(img.name, 'elsascript.jpg', 'no path, no markup in the name');
  assert.deepEqual(img.value.variants, [480, 800, 1200]);
  assert.equal(img.value.format, 'webp');
  assert.equal(img.value.fallback, 800);
  let f = await media(new Request(`https://studio.example.it/media/${img.id}-1200.webp`));
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'image/webp');
  assert.match(f.headers.get('cache-control'), /immutable/);

  // Wrong width, wrong type, unknown version, mixed proportions, no JPEG fallback: refused.
  const bad = async (files, role = 'content') => (await as('admin')('POST', '/site/media', { role, name: 'x.jpg', files })).status;
  assert.equal(await bad({ '800.webp': fakeWebp(790, 1067), '800.jpg': fakeJpeg(800, 1067) }), 400);
  assert.equal(await bad({ '800.webp': fakeJpeg(800, 1067), '800.jpg': fakeJpeg(800, 1067) }), 400);
  assert.equal(await bad({ '333.webp': fakeWebp(333, 400), '800.jpg': fakeJpeg(800, 1067) }), 400);
  assert.equal(await bad({ '480.webp': fakeWebp(480, 480), '800.jpg': fakeJpeg(800, 1067) }), 400);
  assert.equal(await bad({ '800.webp': fakeWebp(800, 1067) }), 400);
  assert.equal(await bad({ '1200x630.jpg': fakeJpeg(1200, 700) }, 'social'), 400);
  assert.equal(await bad({ '800.jpg': fakeJpeg(800, 1067, 1_600_000) }), 413);

  // Social image: one JPEG 1200×630.
  r = await as('admin')('POST', '/site/media', { role: 'social', name: 'condivisione.jpg', files: { '1200x630.jpg': fakeJpeg(1200, 630) } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.media.value.w, r.body.media.value.h, r.body.media.value.social], [1200, 630, true]);

  // PDF: checked from its bytes, served inline with a safe name.
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n').toString('base64');
  r = await as('admin')('POST', '/site/media', { kind: 'pdf', name: 'Modulo consenso è.pdf', data: pdf });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const doc = r.body.media;
  assert.equal(doc.url, `/media/${doc.id}.pdf`);
  f = await media(new Request(`https://studio.example.it${doc.url}`));
  assert.equal(f.headers.get('content-type'), 'application/pdf');
  assert.equal(f.headers.get('x-content-type-options'), 'nosniff');
  assert.match(f.headers.get('content-disposition'), /^inline; filename="Modulo consenso _\.pdf"; filename\*=UTF-8''Modulo%20consenso%20%C3%A8\.pdf$/);
  assert.equal((await as('admin')('POST', '/site/media', { kind: 'pdf', name: 'finto.pdf', data: Buffer.from('<html>not a pdf</html>').toString('base64') })).status, 400);
  assert.equal((await as('admin')('POST', '/site/media', { kind: 'pdf', name: 'tronco.pdf', data: Buffer.from('%PDF-1.4 no end').toString('base64') })).status, 400);

  // Used in a page draft: the list says where, and deleting is refused until it is removed.
  await sql`update site_pages set draft = jsonb_set(draft, '{seo}', ${sql.json({ image: { id: img.id } })}) where key = 'prova' and lang = 'it'`;
  r = await as('admin')('GET', '/site/media');
  assert.equal(r.status, 200);
  const listed = r.body.media.find((m) => m.id === img.id);
  assert.deepEqual(listed.usedIn.map((u) => [u.key, u.lang, u.draft]), [['prova', 'it', true]]);
  assert.match(listed.thumb, new RegExp(`/media/${img.id}-480\\.webp`));
  r = await as('admin')('DELETE', `/site/media/${img.id}`);
  assert.equal(r.status, 409);
  assert.equal(r.body.usedIn[0].key, 'prova');
  await sql`update site_pages set draft = draft - 'seo' where key = 'prova' and lang = 'it'`;
  r = await as('admin')('DELETE', `/site/media/${img.id}`);
  assert.equal(r.status, 200);
  assert.equal((await media(new Request(`https://studio.example.it/media/${img.id}-800.jpg`))).status, 404);

  // Rename and default alt text; an account without the editor permission cannot touch the library.
  r = await as('admin')('PATCH', `/site/media/${doc.id}`, { name: 'Modulo.pdf', alt_it: 'Modulo' });
  assert.equal(r.body.media.name, 'Modulo.pdf');
  const log = (await as('admin')('GET', '/audit')).body.entries.map((e) => e.action);
  assert.ok(log.includes('immagine caricata') && log.includes('immagine cancellata') && log.includes('PDF caricato'));
});

test('header, footer and studio details: edited once, shown on every page after publishing', opts, async () => {
  const purged = [];
  const kit = editorKit();
  const ed = createAdminApi({ ...deps, kit, purge: async (tags) => { purged.push(...tags); } });
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  const call2 = (method, path, body) => call(ed, method, `/api/admin${path}`, body, { headers: { cookie: `${COOKIE}=${cookies.admin}`, 'x-agenda': '1' } });
  const serve = (path, env) => pageResponse(new Request(`https://studio.example.it${path}`), { kit, env, store: deps.store, loadCatalog: () => kit.loadCatalog(), createSite });

  let r = await call2('GET', '/site/globals');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.schema.header && r.body.schema.footer && r.body.schema.studio);
  const it = r.body.scopes.it;
  assert.ok(it.draft.header.items.length >= 5, 'menu items from the current layout');

  // Move the last menu item to the top and rename it; change the studio's phone.
  const items = [...it.draft.header.items];
  const last = { ...items.pop(), label: 'Scrivici' };
  r = await call2('PUT', '/site/globals/it', { data: { ...it.draft, header: { ...it.draft.header, items: [last, ...items] } }, expected: it.draftUpdatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call2('PUT', '/site/globals/studio', { data: { ...r.body.data, phone: '+39 051 123456', email: 'info@blooming.example', whatsapp: '393331234567', legalName: 'Blooming', vat: '01234567890' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call2('PUT', '/site/globals/studio', { data: { phone: '+39', email: 'a@b.it?bcc=x@y.it' } });
  assert.equal(r.status, 400, 'invalid email refused');

  // Production keeps the published header until "Pubblica"; staging shows the draft.
  let html = await (await serve('/prova/', { CONTEXT: 'production' })).text();
  assert.doesNotMatch(html, />Scrivici<\/a><\/li>\s*<li><a href="\/servizi\/"/);
  html = await (await serve('/prova/', { CONTEXT: 'branch-deploy' })).text();
  assert.match(html, /<ul role="list">\s*<li><a href="[^"]*" data-roll>Scrivici<\/a><\/li>/, 'renamed item first in the menu');
  assert.match(html, /tel:\+39051123456/);

  r = await call2('POST', '/site/globals/it/publish', {});
  assert.equal(r.status, 200);
  await call2('POST', '/site/globals/studio/publish', {});
  assert.deepEqual([...new Set(purged)], ['pages'], 'the whole site leaves the cache');
  html = await (await serve('/prova/', { CONTEXT: 'production' })).text();
  assert.match(html, /data-roll>Scrivici<\/a>/);
  assert.match(html, /P\.IVA 01234567890/);
  assert.match(html, /© <span data-year data-since="2026">20\d\d(–20\d\d)?<\/span>/);

  // Hand-written pages (privacy) get the same header and footer through the page function.
  const privacy = await serve('/privacy/', { CONTEXT: 'production' });
  assert.equal(privacy.status, 200);
  const ph = await privacy.text();
  assert.match(ph, /data-roll>Scrivici<\/a>/);
  assert.match(ph, /Informativa/);
  const manage = await serve('/prenota/gestisci/', { CONTEXT: 'production' });
  assert.equal(manage.headers.get('referrer-policy'), 'no-referrer');
});

test('SEO of a page: title, description, sharing image and "not in search engines"', opts, async () => {
  const kit = editorKit();
  const ed = createAdminApi({ ...deps, kit, purge: async () => {} });
  const call2 = (method, path, body) => call(ed, method, `/api/admin${path}`, body, { headers: { cookie: `${COOKIE}=${cookies.admin}`, 'x-agenda': '1' } });
  const list = (await call2('GET', '/site/pages')).body.pages;
  const it = list.find((p) => p.key === 'prova' && p.lang === 'it');
  const page = (await call2('GET', `/site/pages/${it.id}`)).body.page;
  let r = await call2('PUT', `/site/pages/${it.id}`, {
    title: 'Titolo per Google', description: 'Descrizione breve', blocks: page.draft.blocks, expected: page.draftUpdatedAt,
    seo: { image: { id: 'abcdef0123456789abcdef01', alt: 'Lo studio', w: 1200, h: 630 }, noindex: true },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.draft.seo.noindex, true);
  const html = await (await pageResponse(new Request('https://studio.example.it/prova/'), { kit, env: { CONTEXT: 'branch-deploy', SITE_URL: 'https://blooming.example' }, store: deps.store, loadCatalog: () => kit.loadCatalog(), createSite })).text();
  assert.match(html, /<title>Titolo per Google<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/blooming\.example\/media\/abcdef0123456789abcdef01-1200x630\.jpg">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/blooming\.example\/prova\/">/);
  assert.doesNotMatch(html, /rel="alternate" hreflang/, 'a page hidden from search engines has no language alternates');
  r = await call2('PUT', `/site/pages/${it.id}`, { title: 'Titolo', blocks: page.draft.blocks, seo: { image: { id: 'abcdef0123456789abcdef01' } } });
  assert.equal(r.status, 400, 'the sharing image needs a description');
});

// ---------- requests approved by the professional, confirmation by the person, reminders (7 November 2026) ----------

async function annaAndService() {
  const cat = (await pubCall('GET', '/catalog')).body;
  const svc = cat.categories.find((c) => c.slug === 'carriera').services.find((s) => s.firstMeeting && s.professionals.some((p) => p.name === 'Anna Prova'));
  const anna = svc.professionals.find((p) => p.name === 'Anna Prova').id;
  return { svc, anna };
}
const tokenIn = (mail) => (mail.text.match(/#t=([A-Za-z0-9_-]+)/) || [])[1];
const mailsTo = (to, since) => deps.mailer.sent.slice(since).filter((m) => m.to === to);

test('a first meeting booked online is a request: it holds the time until the professional approves or declines it', opts, async () => {
  clock.now = new Date('2026-11-26T09:00:00Z'); // Thursday; Monday 30 November is bookable
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  const { svc, anna } = await annaAndService();
  const since = deps.mailer.sent.length;
  const book = (email, start, extra = {}) => pubCall('POST', '/book', { start, mode: 'online', service: svc.id, professional: anna, lang: 'it', name: 'Persona Prova', email, privacy: true, ...extra });

  let r = await book('richiesta1@example.it', '2026-11-30T08:00:00.000Z');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.booking.pending, true);
  const t1 = new URL(r.body.manageUrl).hash.slice(3);
  assert.match(mailsTo('richiesta1@example.it', since)[0].subject, /Abbiamo ricevuto la tua richiesta/);
  assert.ok(deps.mailer.sent.slice(since).some((m) => /Nuova richiesta di primo colloquio da approvare/.test(m.subject)), 'the professional is asked to approve');
  // The time is held while the request waits.
  assert.equal((await book('altra@example.it', '2026-11-30T08:00:00.000Z')).status, 409);
  // The person sees a request (cancel only).
  r = await pubCall('POST', '/manage', { t: t1 });
  assert.equal(r.body.booking.pending, true);
  assert.equal(r.body.booking.canMove, false);
  assert.equal((await pubCall('POST', '/manage/reschedule', { t: t1, start: '2026-11-30T09:00:00.000Z', mode: 'online' })).status, 400);
  // It shows in the agenda with "to approve".
  let pending = (await as('admin')('GET', '/events/pending')).body.events;
  const ev1 = pending.find((e) => e.email === 'richiesta1@example.it');
  assert.equal(ev1.pending, true);

  // Declined: the time is free again and the person is invited to choose another.
  r = await as('admin')('POST', `/events/${ev1.id}/decline`, {});
  assert.equal(r.status, 200);
  assert.match(mailsTo('richiesta1@example.it', since).at(-1).subject, /Scegli un altro orario/);
  assert.equal((await pubCall('POST', '/manage', { t: t1 })).status, 404, 'the link of a declined request no longer works');
  r = await book('richiesta2@example.it', '2026-11-30T08:00:00.000Z');
  assert.equal(r.status, 201, 'the time is free again');
  const t2 = new URL(r.body.manageUrl).hash.slice(3);

  // Approved: confirmation email with a new personal link; the request link stops working.
  pending = (await as('admin')('GET', '/events/pending')).body.events;
  const ev2 = pending.find((e) => e.email === 'richiesta2@example.it');
  r = await as('admin')('POST', `/events/${ev2.id}/approve`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.event.pending, false);
  const approvedMail = mailsTo('richiesta2@example.it', since).at(-1);
  assert.match(approvedMail.subject, /La tua richiesta è stata approvata/);
  const t2b = tokenIn(approvedMail);
  assert.equal((await pubCall('POST', '/manage', { t: t2 })).status, 404);
  r = await pubCall('POST', '/manage', { t: t2b });
  assert.equal(r.body.booking.status, 'confermato');
  assert.equal(r.body.booking.canMove, true, 'website bookings can still be moved within the limit');
  assert.equal((await as('admin')('POST', `/events/${ev2.id}/approve`, {})).status, 404, 'cannot approve twice');

  // The person can cancel a request: the time is free again.
  r = await book('richiesta3@example.it', '2026-11-30T09:00:00.000Z');
  const t3 = new URL(r.body.manageUrl).hash.slice(3);
  assert.equal((await pubCall('POST', '/manage/cancel', { t: t3 })).status, 200);
  assert.equal((await book('richiesta4@example.it', '2026-11-30T09:00:00.000Z')).status, 201);
});

test('requests not approved in time expire; reminders never go to requests', opts, async () => {
  clock.now = new Date('2026-11-26T09:00:00Z');
  const { svc, anna } = await annaAndService();
  const since = deps.mailer.sent.length;
  let r = await pubCall('POST', '/book', { start: '2026-12-07T08:00:00.000Z', mode: 'online', service: svc.id, professional: anna, lang: 'en', name: 'Late Request', email: 'scade@example.it', privacy: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // 23 hours before: within the day-before reminder, but a request gets none.
  clock.now = new Date('2026-12-06T09:00:00Z');
  await runReminders(deps);
  assert.equal(mailsTo('scade@example.it', since).length, 1, 'only the "request received" email');
  // 11 hours before (expiry: 12): the request expires and the time is free.
  clock.now = new Date('2026-12-06T21:00:00Z');
  r = await runReminders(deps);
  assert.ok(r.expired >= 1);
  const last = mailsTo('scade@example.it', since).at(-1);
  assert.match(last.subject, /Please choose another time/);
  assert.match(last.text, /wasn't confirmed in time/);
  const [row] = await sql`select status, cancelled_by from events where start_at = '2026-12-07T08:00:00Z' and professional_id = ${anna}`;
  assert.deepEqual([row.status, row.cancelled_by], ['rifiutato', 'sistema']);
});

test('appointments set by the professional: email to the person, confirmation the day before, no moving', opts, async () => {
  clock.now = new Date('2026-11-26T09:00:00Z');
  const { anna } = await annaAndService();
  const since = deps.mailer.sent.length;
  let r = await as('admin')('POST', '/events', { professionalId: anna, kind: 'seduta', date: '2026-12-02', time: '10:00', durationMinutes: 50, mode: 'online', name: 'Sam', email: 'manuale@example.it', sendEmail: true, emailLang: 'en' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.emailSent, true);
  const first = mailsTo('manuale@example.it', since)[0];
  assert.match(first.subject, /Appointment confirmed/);
  assert.match(first.text, /\/en\/book\/manage\/#t=/);
  assert.match(first.text, /To move it, please contact the practice/);
  const tok1 = tokenIn(first);
  r = await pubCall('POST', '/manage', { t: tok1 });
  assert.equal(r.body.booking.canMove, false);
  assert.equal(r.body.booking.needsConfirmation, true);
  assert.equal((await pubCall('POST', '/manage/slots', { t: tok1, mode: 'online' })).status, 400);
  assert.equal((await pubCall('POST', '/manage/reschedule', { t: tok1, start: '2026-12-02T10:00:00.000Z', mode: 'online' })).status, 400);

  // Without the tick: no email now, no reminders later.
  r = await as('admin')('POST', '/events', { professionalId: anna, kind: 'seduta', date: '2026-12-02', time: '12:00', durationMinutes: 50, name: 'Nina', email: 'senzaemail@example.it' });
  assert.equal(r.body.emailSent, false);

  // The day before: a new link asking to confirm; the old one stops working.
  clock.now = new Date('2026-12-01T12:00:00Z');
  await runReminders(deps);
  const ask = mailsTo('manuale@example.it', since).at(-1);
  assert.match(ask.subject, /Please confirm your appointment/);
  assert.match(ask.text, /replaces any earlier ones/);
  const tok2 = tokenIn(ask);
  assert.notEqual(tok2, tok1);
  assert.equal((await pubCall('POST', '/manage', { t: tok1 })).status, 404);
  assert.equal(mailsTo('senzaemail@example.it', since).length, 0);

  const beforeConfirm = deps.mailer.sent.length;
  r = await pubCall('POST', '/manage/confirm', { t: tok2 });
  assert.equal(r.status, 200);
  assert.ok(r.body.confirmedAt);
  assert.equal((await pubCall('POST', '/manage/confirm', { t: tok2 })).status, 200, 'confirming twice is fine');
  assert.equal(deps.mailer.sent.slice(beforeConfirm).filter((m) => /confermato dalla persona/.test(m.subject)).length, 1, 'the professional is told once');
  r = await pubCall('POST', '/manage', { t: tok2 });
  assert.equal(r.body.booking.needsConfirmation, false);
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  const agenda = (await as('admin')('GET', '/events?from=2026-12-02&to=2026-12-02&professional=all')).body.events.find((e) => e.email === 'manuale@example.it');
  assert.ok(agenda.clientConfirmedAt);
  assert.equal(agenda.notifyClient, true);

  // Cancelling from the link (far enough ahead) notifies the professional.
  r = await as('admin')('POST', '/events', { professionalId: anna, kind: 'seduta', date: '2026-12-09', time: '10:00', durationMinutes: 50, name: 'Leo', email: 'annulla@example.it', sendEmail: true });
  const tok3 = tokenIn(mailsTo('annulla@example.it', since)[0]);
  const beforeCancel = deps.mailer.sent.length;
  assert.equal((await pubCall('POST', '/manage/cancel', { t: tok3 })).status, 200);
  assert.ok(deps.mailer.sent.slice(beforeCancel).some((m) => /annullato/.test(m.subject) && m.to !== 'annulla@example.it'));
});

test('a short reminder two hours before, with nothing to click; once only, never for cancelled or last-minute bookings', opts, async () => {
  clock.now = new Date('2026-11-26T09:00:00Z');
  const { anna } = await annaAndService();
  const since = deps.mailer.sent.length;
  const mk = (time, email) => as('admin')('POST', '/events', { professionalId: anna, kind: 'seduta', date: '2026-12-03', time, durationMinutes: 50, mode: 'online', name: 'Persona', email, sendEmail: true });
  await mk('10:00', 'duore@example.it');
  const cancelled = (await mk('12:00', 'annullato2h@example.it')).body.created[0];
  await as('admin')('POST', `/events/${cancelled}/cancel`, {});
  // Day-before reminder done for the first one.
  clock.now = new Date('2026-12-02T10:00:00Z');
  await runReminders(deps);
  // 1 h 50 min before 10:00 Rome (09:00 UTC).
  clock.now = new Date('2026-12-03T07:10:00Z');
  let r = await runReminders(deps);
  const soon = mailsTo('duore@example.it', since).filter((m) => /tra poco/.test(m.subject));
  assert.equal(soon.length, 1);
  assert.doesNotMatch(soon[0].text, /#t=|https?:\/\//, 'nothing to click');
  assert.match(soon[0].text, /Se non riesci a esserci, rispondi a questa email/);
  r = await runReminders(deps);
  assert.equal(mailsTo('duore@example.it', since).filter((m) => /tra poco/.test(m.subject)).length, 1, 'sent once');
  assert.equal(mailsTo('annullato2h@example.it', since).filter((m) => /tra poco/.test(m.subject)).length, 0);

  // Booked at the last minute (less than 3 hours before): no second reminder, and never two emails in one run.
  clock.now = new Date('2026-12-03T10:30:00Z');
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  await mk('14:00', 'ultimo@example.it'); // 13:00 UTC, 2 h 30 min ahead
  clock.now = new Date('2026-12-03T11:15:00Z');
  await runReminders(deps);
  const late = mailsTo('ultimo@example.it', since);
  assert.equal(late.filter((m) => /tra poco/.test(m.subject)).length, 0);

  // Setting 0 turns it off.
  clock.now = new Date('2026-12-03T11:20:00Z');
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  assert.equal((await as('admin')('PUT', '/settings', { settings: { reminder2Hours: 0 } })).status, 200);
  await mk('16:00', 'spento@example.it'); // 15:00 UTC, booked 3 h 40 min ahead
  clock.now = new Date('2026-12-03T13:10:00Z');
  await runReminders(deps);
  assert.equal(mailsTo('spento@example.it', since).filter((m) => /tra poco/.test(m.subject)).length, 0);
  await as('admin')('PUT', '/settings', { settings: { reminder2Hours: 2 } });
});

test('times too close to the approval deadline cannot be requested; a late approval sends one email that asks to confirm', opts, async () => {
  const { svc, anna } = await annaAndService();
  // Booked on Thursday 10 December for Monday 14 December, 10:00 Rome.
  clock.now = new Date('2026-12-10T09:00:00Z');
  const since = deps.mailer.sent.length;
  let r = await pubCall('POST', '/book', { start: '2026-12-14T09:00:00.000Z', mode: 'online', service: svc.id, professional: anna, lang: 'it', name: 'Persona Tardi', email: 'tardi@example.it', privacy: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // Approved on Sunday at 11:00 Rome (before the 18:00 deadline, already within the day-before window).
  clock.now = new Date('2026-12-13T10:00:00Z');
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  const ev = (await as('admin')('GET', '/events/pending')).body.events.find((e) => e.email === 'tardi@example.it');
  assert.equal((await as('admin')('POST', `/events/${ev.id}/approve`, {})).status, 200);
  const mail = mailsTo('tardi@example.it', since).at(-1);
  assert.match(mail.subject, /Richiesta approvata: conferma la tua presenza/);
  const tok = tokenIn(mail);
  assert.equal((await pubCall('POST', '/manage', { t: tok })).body.booking.needsConfirmation, true);
  await runReminders(deps);
  assert.equal(mailsTo('tardi@example.it', since).filter((m) => /Conferma il tuo appuntamento/.test(m.subject)).length, 0, 'no second email the same day');

  // With no minimum notice, on Sunday 20 December at 16:30 Rome (deadline 18:00 in 1 h 30 min), Monday morning is closed.
  await as('admin')('PUT', '/settings', { settings: { minNoticeHours: 0 } });
  clock.now = new Date('2026-12-20T15:30:00Z');
  const mondaySlots = async () => ((await pubCall('GET', `/slots?service=${svc.id}&professional=${anna}&mode=online`)).body.days.find((d) => d.date === '2026-12-21') || { slots: [] }).slots;
  assert.equal((await mondaySlots()).length, 0);
  r = await pubCall('POST', '/book', { start: '2026-12-21T08:00:00.000Z', mode: 'online', service: svc.id, professional: anna, lang: 'it', name: 'Persona Sera', email: 'sera@example.it', privacy: true });
  assert.equal(r.status, 409);
  // At 14:00 Rome (four hours before the deadline) the same morning is still open.
  clock.now = new Date('2026-12-20T13:00:00Z');
  assert.ok((await mondaySlots()).length > 0);
  clock.now = new Date('2026-12-20T16:00:00Z');
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  await as('admin')('PUT', '/settings', { settings: { minNoticeHours: 24 } });
});
