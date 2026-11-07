import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbAvailable, freshDb, testDeps, request, PASSWORD, createEnrolledUser, totpCode } from './helpers.mjs';
import { createPublicApi } from '../lib/public-api.mjs';
import { createAdminApi, COOKIE } from '../lib/admin-api.mjs';
import { runReminders, runRetention, buildIcs } from '../lib/jobs.mjs';
import { readKitFiles, withCatalog } from '../lib/site-kit.mjs';
import { pageResponse } from '../lib/page-server.mjs';
import { createSite } from '../lib/site.mjs';
import { sha256 } from '../lib/crypto.mjs';

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
// «Aiutami a scegliere» hides the name from the person: tests read who got the request from the database.
const assignedTo = async (email) => (await sql`select professional_id::text as id from events where contact_hash = ${deps.vault.lookupHash(`email:${email}`)} order by id desc limit 1`)[0].id;
// The personal link of a booking arrives only by email: the last one sent to that address.
const lastToken = (email) => ((deps.mailer.sent.filter((m) => m.to === email).at(-1) || { text: '' }).text.match(/#t=([A-Za-z0-9_-]+)/) || [])[1];
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
  assert.deepEqual(cat.body.categories.map((c) => c.slug), ['carriera', 'coaching', 'psicologia', 'psicoterapia', 'aziende', 'da-scegliere']);
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
  assert.equal(r.body.manageUrl, undefined, 'the personal link only travels by email');
  manageToken = lastToken('giulia@example.it');
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
  const [old] = await deps.store.sql`update events set heard_from = 'passaparola' where manage_token_hash = ${sha256(manageToken)} returning id::text as id`;
  r = await pubCall('POST', '/manage/reschedule', { t: manageToken, start: '2026-10-26T10:00:00.000Z', mode: 'studio' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const newToken = new URL(r.body.manageUrl).hash.slice(3);
  const [moved] = await deps.store.sql`select id::text as id, heard_from, contact_hash, approved_at from events where manage_token_hash = ${sha256(newToken)}`;
  assert.equal(moved.heard_from, 'passaparola', 'the source answer moves with the appointment');
  assert.ok(moved.approved_at, 'a moved meeting stays an accepted one');
  assert.equal((await deps.store.sql`select heard_from from events where id = ${old.id}`)[0].heard_from, null, 'and is not kept twice');
  r = await pubCall('POST', '/manage/cancel', { t: newToken });
  assert.equal(r.status, 200);
  r = await pubCall('POST', '/manage', { t: newToken });
  assert.equal(r.body.booking.status, 'annullato');
  // «Dimentica» (rights tool) also erases the source answer.
  await deps.store.forgetContact([moved.contact_hash]);
  assert.equal((await deps.store.sql`select heard_from from events where id = ${moved.id}`)[0].heard_from, null);
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
  assert.match(deps.mailer.sent[before].subject, /Conferma la presenza/, 'the day before, the person is asked to confirm');

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
  const firstAssigned = await assignedTo('uno@example.it');
  r = await book('due@example.it');
  assert.equal(r.status, 201, 'the other professional is still free');
  assert.notEqual(await assignedTo('due@example.it'), firstAssigned);
  r = await book('tre@example.it');
  assert.equal(r.status, 409, 'nobody left at that time');

  // English booking goes only to someone who speaks English.
  r = await book('quattro@example.it', { start: '2026-11-09T08:00:00.000Z', lang: 'en' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await assignedTo('quattro@example.it'), String(anna));
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
  assert.match(deps.mailer.sent.filter((m) => m.to === 'sette@example.it').at(-1).text, /\/en\/book\/manage\/#t=/);
  // «Aiutami a scegliere»: the name stays hidden on the confirmation and on the «Gestisci» page until she accepts.
  assert.equal(r.body.booking.professional, null);
  const tok7 = lastToken('sette@example.it');
  let m7 = await pubCall('POST', '/manage', { t: tok7 });
  assert.equal(m7.body.booking.professional, null);
  assert.equal(m7.body.booking.assigned, true);
  assert.doesNotMatch(JSON.stringify(m7.body), /Anna Prova|Bea|Dott/);
  // The request email gives the real deadline: 18:00 of the last working day before (Monday 16 Nov → Friday 13 Nov).
  assert.match(deps.mailer.sent.filter((m) => m.to === 'sette@example.it').at(-1).text, /will reply by Friday, 13 November 2026, 18:00 \(Italian time\) at the latest/);
  await approvePending();
  m7 = await pubCall('POST', '/manage', { t: tok7 });
  assert.ok(m7.body.booking.professional && m7.body.booking.professional.name, 'once accepted, the name shows');
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
  const token = lastToken('otto@example.it');
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
  assert.match(request.subject, /Richiesta ricevuta/);
  const pending = (await as('admin')('GET', '/events/pending')).body.events.find((e) => e.email === 'nove@example.it');
  assert.equal((await as('admin')('POST', `/events/${pending.id}/approve`, {})).status, 200);
  const mail = deps.mailer.sent.slice(before).find((m) => m.to === 'nove@example.it' && /accettata/.test(m.subject));
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
  assert.match(r.body.html, /02 · (<span[^>]*>)?Voci/);
  assert.match(r.body.html, /class="draft-note">nota per Elsa/);
  assert.match(r.body.html, /href="\/en\/test\/"/);
  // The preview marks editable fields for the editor; published and staging pages never do (below).
  assert.match(r.body.html, /data-edit-block="0"/);
  assert.match(r.body.html, /data-edit="title" data-edit-kind="text"/);

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
  assert.doesNotMatch(html, /data-edit/, 'no editor marks on the public page');
  const staging = await serve('/prova/', { CONTEXT: 'branch-deploy' });
  const stagingHtml = await staging.text();
  assert.match(stagingHtml, /Titolo nuovo/, 'staging shows the draft');
  assert.doesNotMatch(stagingHtml, /data-edit/, 'no editor marks on staging either');
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
  assert.doesNotMatch(ph, /placeholder-note|draft-inline|Nota bozza|da verificare/, 'production: no internal notes on hand-written pages');
  assert.match(await (await serve('/privacy/', { CONTEXT: 'branch-deploy' })).text(), /placeholder-note/, 'staging keeps them');
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
  const t1 = lastToken('richiesta1@example.it');
  assert.match(mailsTo('richiesta1@example.it', since)[0].subject, /Richiesta ricevuta/);
  assert.ok(deps.mailer.sent.slice(since).some((m) => /Nuova richiesta da accettare/.test(m.subject)), 'the professional is asked to approve');
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
  const t2 = lastToken('richiesta2@example.it');

  // Approved: confirmation email with a new personal link; the request link stops working.
  pending = (await as('admin')('GET', '/events/pending')).body.events;
  const ev2 = pending.find((e) => e.email === 'richiesta2@example.it');
  r = await as('admin')('POST', `/events/${ev2.id}/approve`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.event.pending, false);
  const approvedMail = mailsTo('richiesta2@example.it', since).at(-1);
  assert.match(approvedMail.subject, /Richiesta accettata/);
  const t2b = tokenIn(approvedMail);
  assert.equal((await pubCall('POST', '/manage', { t: t2 })).status, 404);
  r = await pubCall('POST', '/manage', { t: t2b });
  assert.equal(r.body.booking.status, 'confermato');
  assert.equal(r.body.booking.canMove, true, 'website bookings can still be moved within the limit');
  assert.equal((await as('admin')('POST', `/events/${ev2.id}/approve`, {})).status, 404, 'cannot approve twice');

  // The person can cancel a request: the time is free again.
  r = await book('richiesta3@example.it', '2026-11-30T09:00:00.000Z');
  const t3 = lastToken('richiesta3@example.it');
  assert.equal((await pubCall('POST', '/manage/cancel', { t: t3 })).status, 200);
  assert.equal((await book('richiesta4@example.it', '2026-11-30T09:00:00.000Z')).status, 201);
});

const setWorkdays = async (days) => deps.store.saveSettings({ ...(await deps.store.getSettings()), approvalWorkdays: days });

test('requests not approved in time expire; reminders never go to requests', opts, async () => {
  clock.now = new Date('2026-11-26T09:00:00Z');
  const { svc, anna } = await annaAndService();
  await setWorkdays([1, 2, 3, 4, 5, 6, 7]); // Sunday counts as a working day here
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
  assert.match(last.subject, /About your request/);
  assert.match(last.text, /wasn't able to reply to your request in time/);
  const [row] = await sql`select status, cancelled_by from events where start_at = '2026-12-07T08:00:00Z' and professional_id = ${anna}`;
  assert.deepEqual([row.status, row.cancelled_by], ['rifiutato', 'sistema']);
  await setWorkdays([1, 2, 3, 4, 5]);
});

test('appointments set by the professional: email to the person, confirmation the day before, no moving', opts, async () => {
  clock.now = new Date('2026-11-26T09:00:00Z');
  const { anna } = await annaAndService();
  const since = deps.mailer.sent.length;
  let r = await as('admin')('POST', '/events', { professionalId: anna, kind: 'seduta', date: '2026-12-02', time: '10:00', durationMinutes: 50, mode: 'online', name: 'Sam', email: 'manuale@example.it', sendEmail: true, emailLang: 'en' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.emailSent, true);
  const first = mailsTo('manuale@example.it', since)[0];
  assert.match(first.subject, /Your session/);
  assert.match(first.text, /\/en\/book\/manage\/#t=/);
  assert.match(first.text, /To move it to another time, please contact/);
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
  assert.match(ask.subject, /Please confirm your session/);
  assert.match(ask.text, /links in our earlier emails no longer work/);
  const tok2 = tokenIn(ask);
  assert.notEqual(tok2, tok1);
  assert.equal((await pubCall('POST', '/manage', { t: tok1 })).status, 404);
  assert.equal(mailsTo('senzaemail@example.it', since).length, 0);

  const beforeConfirm = deps.mailer.sent.length;
  r = await pubCall('POST', '/manage/confirm', { t: tok2 });
  assert.equal(r.status, 200);
  assert.ok(r.body.confirmedAt);
  assert.equal((await pubCall('POST', '/manage/confirm', { t: tok2 })).status, 200, 'confirming twice is fine');
  assert.equal(deps.mailer.sent.slice(beforeConfirm).filter((m) => /confermato dalla persona/.test(m.text)).length, 1, 'the professional is told once');
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
  assert.ok(deps.mailer.sent.slice(beforeCancel).some((m) => /annullato/.test(m.text) && m.to !== 'annulla@example.it'));
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
  const soon = mailsTo('duore@example.it', since).filter((m) => /Tra poco/.test(m.subject));
  assert.equal(soon.length, 1);
  assert.doesNotMatch(soon[0].text, /#t=|https?:\/\//, 'nothing to click');
  assert.match(soon[0].text, /Se non riesci a esserci, rispondi a questa email/);
  r = await runReminders(deps);
  assert.equal(mailsTo('duore@example.it', since).filter((m) => /Tra poco/.test(m.subject)).length, 1, 'sent once');
  assert.equal(mailsTo('annullato2h@example.it', since).filter((m) => /Tra poco/.test(m.subject)).length, 0);

  // Booked at the last minute (less than 3 hours before): no second reminder, and never two emails in one run.
  clock.now = new Date('2026-12-03T10:30:00Z');
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  await mk('14:00', 'ultimo@example.it'); // 13:00 UTC, 2 h 30 min ahead
  clock.now = new Date('2026-12-03T11:15:00Z');
  await runReminders(deps);
  const late = mailsTo('ultimo@example.it', since);
  assert.equal(late.filter((m) => /Tra poco/.test(m.subject)).length, 0);

  // Setting 0 turns it off.
  clock.now = new Date('2026-12-03T11:20:00Z');
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  assert.equal((await as('admin')('PUT', '/settings', { settings: { reminder2Hours: 0 } })).status, 200);
  await mk('16:00', 'spento@example.it'); // 15:00 UTC, booked 3 h 40 min ahead
  clock.now = new Date('2026-12-03T13:10:00Z');
  await runReminders(deps);
  assert.equal(mailsTo('spento@example.it', since).filter((m) => /Tra poco/.test(m.subject)).length, 0);
  await as('admin')('PUT', '/settings', { settings: { reminder2Hours: 2 } });
});

test('times too close to the approval deadline cannot be requested; a late approval sends one email that asks to confirm', opts, async () => {
  const { svc, anna } = await annaAndService();
  // Booked on Thursday 10 December for Monday 14 December, 10:00 Rome.
  clock.now = new Date('2026-12-10T09:00:00Z');
  await setWorkdays([1, 2, 3, 4, 5, 6, 7]); // Sunday counts as a working day here
  const since = deps.mailer.sent.length;
  let r = await pubCall('POST', '/book', { start: '2026-12-14T09:00:00.000Z', mode: 'online', service: svc.id, professional: anna, lang: 'it', name: 'Persona Tardi', email: 'tardi@example.it', privacy: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // Approved on Sunday at 11:00 Rome (before the 18:00 deadline, already within the day-before window).
  clock.now = new Date('2026-12-13T10:00:00Z');
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  const ev = (await as('admin')('GET', '/events/pending')).body.events.find((e) => e.email === 'tardi@example.it');
  assert.equal((await as('admin')('POST', `/events/${ev.id}/approve`, {})).status, 200);
  const mail = mailsTo('tardi@example.it', since).at(-1);
  assert.match(mail.subject, /Richiesta accettata: conferma la presenza/);
  const tok = tokenIn(mail);
  assert.equal((await pubCall('POST', '/manage', { t: tok })).body.booking.needsConfirmation, true);
  await runReminders(deps);
  assert.equal(mailsTo('tardi@example.it', since).filter((m) => /Conferma la presenza – /.test(m.subject)).length, 0, 'no second email the same day');

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
  await setWorkdays([1, 2, 3, 4, 5]);
});

// ---------- round 2 (7/11): confirmation 48 h before, second invitation, 18:00 notice, freeing the time,
// "I can't come", "help me choose" for people who don't know yet, notifications only to the professional,
// "Passa alla collega".

test('round 2: help me choose, notifications to the professional, passing a request to a colleague', opts, async () => {
  clock.now = new Date('2027-01-14T09:00:00Z'); // Thursday; Monday 18 January is bookable
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  let r = await as('admin')('PUT', '/settings', { settings: { confirmHours: 48, confirmNudgeHours: 24, reminder2Hours: 2, cancelHours: 24, approvalDeadline: '18:00', minNoticeHours: 24 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.settings.approvalWorkdays, [1, 2, 3, 4, 5]);
  assert.equal((await as('admin')('PUT', '/settings', { settings: { approvalWorkdays: [] } })).status, 400);

  const cats = (await as('admin')('GET', '/catalog')).body.categories;
  const shared = cats.find((c) => c.slug === 'da-scegliere');
  const coachingCat = cats.find((c) => c.slug === 'coaching');
  assert.ok(shared, 'the area for people who don\'t know yet exists');
  const mkSvc = async (categoryId, name) => {
    const res = await as('admin')('POST', '/services', { categoryId, name, nameEn: 'Free first meeting', durationMinutes: 30, price: 'Gratuito', priceEn: 'Free', firstMeeting: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.id;
  };
  const sharedSvc = await mkSvc(shared.id, 'Primo colloquio round2 da scegliere');
  const coachSvc = await mkSvc(coachingCat.id, 'Primo colloquio round2 coaching');
  const mkPro = async (body) => { const res = await as('admin')('POST', '/professionals', body); assert.equal(res.status, 201, JSON.stringify(res.body)); return res.body.id; };
  const rita = await mkPro({ name: 'Rita Prova', title: 'Psicologa', languages: ['it', 'en'], notifyEmail: 'rita@example.it' });
  const sara = await mkPro({ name: 'Sara Prova', title: 'Psicologa', languages: ['it'] }); // no notification email
  await as('admin')('PUT', `/professionals/${rita}/services`, { offerings: [{ serviceId: sharedSvc, inStudio: false, online: true }, { serviceId: coachSvc, inStudio: false, online: true }] });
  await as('admin')('PUT', `/professionals/${sara}/services`, { offerings: [{ serviceId: sharedSvc, inStudio: false, online: true }] });
  for (const pro of [rita, sara]) {
    r = await as('admin')('PUT', '/rules', { professionalId: pro, rules: [{ weekday: 1, start_time: '09:00', end_time: '13:00', mode: 'online', public: true }] });
    assert.equal(r.status, 200);
  }

  // "Non lo so ancora": both professionals, so "help me choose" exists; in English only Rita.
  const cat = (await pubCall('GET', '/catalog')).body.categories.find((c) => c.slug === 'da-scegliere');
  assert.equal(cat.services[0].professionals.length, 2);
  const start = '2027-01-18T09:00:00.000Z'; // Monday 10:00 in Rome
  const book = (email, extra = {}) => pubCall('POST', '/book', { start, mode: 'online', service: sharedSvc, professional: 'any', name: 'Persona Prova', email, privacy: true, ...extra });
  let since = deps.mailer.sent.length;
  r = await book('scelta1@example.it', { lang: 'en' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await assignedTo('scelta1@example.it'), String(rita), 'in English only who works in English');
  // Only Rita is told, at her notification email; never the studio inbox; nothing about the person.
  const notice = deps.mailer.sent.slice(since).filter((m) => m.to !== 'scelta1@example.it');
  assert.deepEqual(notice.map((m) => m.to), ['rita@example.it']);
  assert.match(notice[0].subject, /Nuova richiesta da accettare/);
  assert.doesNotMatch(notice[0].text, /Persona Prova|scelta1@example\.it/);

  since = deps.mailer.sent.length;
  r = await book('scelta2@example.it');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await assignedTo('scelta2@example.it'), String(sara), 'the one with fewer upcoming appointments');
  const toAdmins = deps.mailer.sent.slice(since).filter((m) => m.to !== 'scelta2@example.it').map((m) => m.to);
  assert.ok(toAdmins.includes(adminUser.email) && !toAdmins.includes('studio@example.it'), 'no notification email: the administrators are told, not the studio inbox');

  // "Passa alla collega": a coaching request of Rita goes to Sara through the shared first meeting.
  r = await pubCall('POST', '/book', { start: '2027-01-18T10:00:00.000Z', mode: 'online', service: coachSvc, professional: rita, name: 'Persona Prova', email: 'passa@example.it', privacy: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const pending = (await as('admin')('GET', '/events/pending')).body;
  const req = (pending.events || pending.requests || pending).find((e) => e.start === '2027-01-18T10:00:00.000Z');
  assert.ok(req, JSON.stringify(pending));
  since = deps.mailer.sent.length;
  r = await as('admin')('POST', `/events/${req.id}/reassign`, { professionalId: sara });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(mailsTo('passa@example.it', since).length, 0, 'nothing changes for the person');
  assert.ok(deps.mailer.sent.slice(since).some((m) => /Richiesta passata a te/.test(m.subject)));
  // Sara is busy at 10:00 (scelta2) and doesn't work in English.
  r = await pubCall('POST', '/book', { start: '2027-01-18T11:00:00.000Z', mode: 'online', service: coachSvc, professional: rita, name: 'Persona Prova', email: 'passa2@example.it', privacy: true, lang: 'en' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const req2 = ((await as('admin')('GET', '/events/pending')).body.events || []).find((e) => e.start === '2027-01-18T11:00:00.000Z');
  r = await as('admin')('POST', `/events/${req2.id}/reassign`, { professionalId: sara });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /inglese/);
  const req3 = ((await as('admin')('GET', '/events/pending')).body.events || []).find((e) => e.start === '2027-01-18T09:00:00.000Z' && e.professionalId === rita);
  // Sara has blocked 09:00 in her agenda: an Italian request at that time can't go to her.
  r = await as('admin')('POST', '/events', { professionalId: sara, kind: 'blocco', startDate: '2027-01-18', startTime: '09:00', endTime: '10:00', title: 'Impegno' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await pubCall('POST', '/book', { start: '2027-01-18T08:00:00.000Z', mode: 'online', service: coachSvc, professional: rita, name: 'Persona Prova', email: 'passa3@example.it', privacy: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const req4 = ((await as('admin')('GET', '/events/pending')).body.events || []).find((e) => e.start === '2027-01-18T08:00:00.000Z');
  r = await as('admin')('POST', `/events/${req4.id}/reassign`, { professionalId: sara });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.message, /non è libera/);
  const log = (await as('admin')('GET', '/audit')).body.entries.map((e) => e.action);
  assert.ok(log.includes('richiesta passata a una collega'));
  ids.round2 = { rita, sara, sharedSvc, coachSvc, reqRita: req3.id };
});

test('round 2: confirmation asked 48 h before in the daytime, second invitation, 18:00 notice, freeing the time, "I can\'t come"', opts, async () => {
  const { rita, reqRita } = ids.round2;
  clock.now = new Date('2027-01-14T10:00:00Z');
  let r = await as('admin')('POST', `/events/${reqRita}/approve`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const email = 'scelta1@example.it';

  // 47 h before but at night (22:30 in Rome): nothing; the next morning at 08:30 the request goes.
  clock.now = new Date('2027-01-16T21:30:00Z');
  let since = deps.mailer.sent.length;
  await runReminders(deps);
  assert.equal(mailsTo(email, since).length, 0, 'no emails asking for action at night');
  clock.now = new Date('2027-01-17T07:30:00Z');
  await runReminders(deps);
  const ask = mailsTo(email, since);
  assert.equal(ask.length, 1);
  assert.match(ask[0].subject, /Confirm your appointment|confirm/i);

  // 23.5 h before, not confirmed: one kind second invitation with a new link.
  clock.now = new Date('2027-01-17T09:30:00Z');
  since = deps.mailer.sent.length;
  await runReminders(deps);
  const nudge = mailsTo(email, since);
  assert.equal(nudge.length, 1);
  assert.match(nudge[0].subject, /tomorrow/);
  await runReminders(deps);
  assert.equal(mailsTo(email, since).length, 1, 'only once');

  // 18:05 in Rome the day before: Rita gets the list of tomorrow's unconfirmed appointments, once.
  clock.now = new Date('2027-01-17T17:05:00Z');
  since = deps.mailer.sent.length;
  await runReminders(deps);
  const list = mailsTo('rita@example.it', since).filter((m) => /da confermare/.test(m.subject));
  assert.equal(list.length, 1);
  assert.doesNotMatch(list[0].text, /Persona Prova|scelta1/, 'no personal data in the notice');
  clock.now = new Date('2027-01-17T17:20:00Z');
  await runReminders(deps);
  assert.equal(mailsTo('rita@example.it', since).filter((m) => /da confermare/.test(m.subject)).length, 1);

  // "Libera l'orario": the person is told what to do if it was a mistake.
  clock.now = new Date('2027-01-17T17:30:00Z');
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret)); // the test clock jumped past the session
  since = deps.mailer.sent.length;
  r = await as('admin')('POST', `/events/${reqRita}/cancel`, { scope: 'one', reason: 'non_confermato' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.emailSent, true);
  const freed = mailsTo(email, since)[0];
  assert.match(freed.text, /hadn't heard back|non avendo ricevuto/i);
  assert.match(freed.text, /still free|ancora libero/);

  // The same time given to someone else (set by the professional, with emails): only the new person gets the
  // 2-hour reminder; and inside the cancellation window "I can't come" still works, flagged as late.
  r = await as('admin')('POST', '/events', { professionalId: rita, kind: 'seduta', date: '2027-01-18', time: '10:00', durationMinutes: 50, mode: 'online', name: 'Nuova', email: 'nuova@example.it', sendEmail: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const link = mailsTo('nuova@example.it', since)[0].text.match(/#t=([\w-]+)/)[1];
  clock.now = new Date('2027-01-18T07:05:00Z');
  since = deps.mailer.sent.length;
  await runReminders(deps);
  assert.equal(mailsTo(email, since).length, 0, 'no reminder for a freed appointment');
  assert.equal(mailsTo('nuova@example.it', since).filter((m) => /tra poco|soon/i.test(m.subject)).length, 1);
  r = await pubCall('POST', '/manage', { t: link });
  assert.equal(r.body.booking.canCancel, true);
  assert.equal(r.body.booking.lateCancel, true);
  since = deps.mailer.sent.length;
  r = await pubCall('POST', '/manage/cancel', { t: link });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.late, true);
  assert.ok(mailsTo('rita@example.it', since).some((m) => /ultimo momento/.test(m.text)), 'the professional is told');
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  const ev = (await as('admin')('GET', '/events?from=2027-01-18&to=2027-01-18&cancelled=1')).body.events.find((e) => e.name === 'Nuova');
  assert.equal(ev.cancelReason, 'tardivo');
});

test('round 2: an organisations first meeting can be requested with "help me choose" and is assigned automatically', opts, async () => {
  const { rita, sara, sharedSvc, coachSvc } = ids.round2;
  clock.now = new Date('2027-01-21T09:00:00Z'); // Thursday; Monday 25 January is bookable
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  const aziende = (await as('admin')('GET', '/catalog')).body.categories.find((c) => c.slug === 'aziende');
  assert.ok(aziende, 'the organisations area exists');
  let r = await as('admin')('POST', '/services', { categoryId: aziende.id, name: 'Primo colloquio round2 organizzazioni', nameEn: 'Free first meeting', durationMinutes: 30, price: 'Gratuito', priceEn: 'Free', firstMeeting: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const orgSvc = r.body.id;
  await as('admin')('PUT', `/professionals/${rita}/services`, { offerings: [sharedSvc, coachSvc, orgSvc].map((serviceId) => ({ serviceId, inStudio: false, online: true })) });
  await as('admin')('PUT', `/professionals/${sara}/services`, { offerings: [sharedSvc, orgSvc].map((serviceId) => ({ serviceId, inStudio: false, online: true })) });
  const cat = (await pubCall('GET', '/catalog')).body.categories.find((c) => c.slug === 'aziende');
  assert.equal(cat.services[0].professionals.length, 2);
  r = await pubCall('POST', '/book', { start: '2027-01-25T10:00:00.000Z', mode: 'online', service: orgSvc, professional: 'any', name: 'Referente HR', email: 'hr-round2@example.it', privacy: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.booking.pending, true);
  assert.equal(r.body.booking.assigned, true);
  assert.ok([rita, sara].map(String).includes(await assignedTo('hr-round2@example.it')));
  assert.equal(r.body.booking.professional, null, 'the name stays hidden until she accepts');
});

// ---------- statistics (research 23): counters only ----------
test('statistics: "non presentata" after the time only, with undo; source and contact counters; continuity frozen before deletion', opts, async () => {
  const at = (iso) => new Date(iso);
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  // A first meeting tomorrow cannot be marked yet; one this morning can.
  const mk = async (start, extra = {}) => {
    const id = await deps.store.insertEvent({ professional_id: ids.elsa, service_id: ids.coaching, kind: 'seduta', source: 'manuale', mode: 'online',
      start_at: at(start), end_at: new Date(at(start).getTime() + 3000000), ...extra });
    return id;
  };
  const future = await mk(new Date(clock.now.getTime() + 86400000 * 3).toISOString());
  let r = await as('admin')('POST', `/events/${future}/no-show`, {});
  assert.equal(r.status, 409);
  const pastId = await mk(new Date(clock.now.getTime() - 86400000 * 2 - 7200000).toISOString());
  r = await as('admin')('POST', `/events/${pastId}/no-show`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await deps.store.getEvent(pastId)).status, 'non_presentata');
  r = await as('admin')('POST', `/events/${pastId}/no-show`, { undo: true });
  assert.equal(r.status, 200);
  assert.equal((await deps.store.getEvent(pastId)).status, 'confermato');
  await as('admin')('POST', `/events/${pastId}/no-show`, {});

  // "Come ci hai conosciuto?" on the contact form: counted, never stored with the request.
  r = await pubCall('POST', '/request', { name: 'Anna', email: 'anna.stat@example.it', category: 'aziende', lang: 'it', privacy: true, heard: 'linkedin' });
  assert.equal(r.status, 201);
  r = await pubCall('POST', '/request', { name: 'Bea', email: 'bea.stat@example.it', category: 'psicologia', lang: 'en', privacy: true, heard: '<script>' });
  assert.equal(r.status, 201);
  const m = await sql`select metric, area, lang, n from stats_monthly order by metric, area`;
  assert.ok(m.some((x) => x.metric === 'fonte:linkedin' && x.area === 'aziende' && x.n === 1));
  assert.ok(m.some((x) => x.metric === 'contatto' && x.area === 'psicologia' && x.lang === 'en'));
  assert.ok(!m.some((x) => /script/.test(x.metric)), 'unknown answers are dropped');
  const cols = (await sql`select column_name from information_schema.columns where table_name = 'contact_requests'`).map((x) => x.column_name);
  assert.ok(!cols.some((c) => /heard|source/.test(c)), 'the answer has no column next to the person');

  // Continuity: a first meeting followed by a session within 60 days, frozen once the window closes,
  // and still counted after the contact fingerprints are deleted.
  const hash = deps.vault.lookupHash('contact:cont@example.it');
  const first = await deps.store.insertEvent({ professional_id: ids.marco, service_id: ids.terapia, kind: 'primo_colloquio', source: 'manuale', mode: 'online',
    start_at: at('2026-03-10T09:00:00Z'), end_at: at('2026-03-10T09:30:00Z'), contact_hash: hash, contact_enc: deps.vault.encrypt({ name: 'C', email: 'cont@example.it' }) });
  await deps.store.insertEvent({ professional_id: ids.marco, service_id: ids.terapia, kind: 'seduta', source: 'manuale', mode: 'online',
    start_at: at('2026-03-24T09:00:00Z'), end_at: at('2026-03-24T09:50:00Z'), contact_hash: hash, contact_enc: deps.vault.encrypt({ name: 'C', email: 'cont@example.it' }) });
  assert.ok(first);
  const { createStats } = await import('../lib/stats.mjs');
  await createStats(sql).freezeAndRollup(clock.now);
  const frozen = await sql`select metric, n from stats_monthly where month = '2026-03-01' and metric like 'continuita%' order by metric`;
  assert.deepEqual(frozen.map((x) => [x.metric, x.n]), [['continuita-base', 1], ['continuita-si', 1]]);
  await sql`update events set contact_hash = null, contact_enc = null where contact_hash = ${hash}`;
  await createStats(sql).freezeAndRollup(clock.now);
  const again = await sql`select n from stats_monthly where month = '2026-03-01' and metric = 'continuita-si'`;
  assert.equal(again[0].n, 1, 'frozen counters are never overwritten');
});

test('statistics: emails counted per type and language; Brevo webhook needs the token and never stores addresses; actions from links', opts, async () => {
  const day = (await sql`select to_char((${clock.now}::timestamptz at time zone 'Europe/Rome')::date, 'YYYY-MM-DD') as d`)[0].d;
  const before = await sql`select coalesce(sum(sent), 0)::int as n from stats_email_daily where email_type = 'richiesta-ricevuta' and lang = 'en'`;
  // A booking sends "richiesta ricevuta" to the person (counted) with the type on the manage link.
  const services = (await pubCall('GET', '/catalog')).body;
  assert.ok(services);
  const sentBefore = deps.mailer.sent.length;
  await deps.mailer.send({ to: 'x@example.it', subject: 's', text: 't', html: 'h', type: 'richiesta-ricevuta', lang: 'en' });
  assert.equal(deps.mailer.sent.length, sentBefore + 1);
  const after = await sql`select coalesce(sum(sent), 0)::int as n from stats_email_daily where email_type = 'richiesta-ricevuta' and lang = 'en'`;
  assert.equal(after[0].n, before[0].n + 1);
  const { templates } = await import('../lib/email.mjs');
  const t = templates.reminderConfirm({ ev: { start_at: new Date(), kind: 'seduta', mode: 'online', professional_name: 'X' }, name: 'A', manageUrl: 'https://s/prenota/gestisci/#t=abc', tz: 'Europe/Rome', site: deps.site, lang: 'it', nudge: true });
  assert.equal(t.type, 'conferma-2');
  assert.match(t.text, /#t=abc&e=conferma-2/);

  // Webhook: refused without the token or with a wrong one.
  deps.env.BREVO_WEBHOOK_TOKEN = 'segreto-di-prova-123';
  let r = await pubCall('POST', '/hooks/brevo', { event: 'delivered', email: 'persona@example.it', tags: ['conferma'] });
  assert.equal(r.status, 401);
  r = await call(pub, 'POST', '/api/public/hooks/brevo?token=sbagliato', { event: 'delivered' });
  assert.equal(r.status, 401);
  r = await call(pub, 'POST', '/api/public/hooks/brevo?token=segreto-di-prova-123', [
    { event: 'delivered', email: 'persona@example.it', tags: ['conferma', 'lang-it'] },
    { event: 'hard_bounce', email: 'persona@example.it', tags: ['conferma', 'lang-it'] },
    { event: 'opened', email: 'persona@example.it', tags: ['conferma'] },
    { event: 'click', email: 'persona@example.it', tags: ['conferma'] },
    { event: 'unique_opened', email: 'persona@example.it', tags: ['conferma'] },
    { event: 'proxy_open', email: 'persona@example.it', tags: ['conferma'] },
    { event: 'spam', email: 'p2@example.it', tag: 'accettata' },
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.body.counted, 3, 'opens and clicks are ignored');
  const rows = await sql`select email_type, lang, delivered, hard_bounce, spam from stats_email_daily where day = ${day}::date and email_type in ('conferma', 'accettata') order by email_type`;
  assert.deepEqual(rows.map((x) => [x.email_type, x.lang, x.delivered, x.hard_bounce, x.spam]), [['accettata', '', 0, 0, 1], ['conferma', 'it', 1, 1, 0]]);
  const dump = JSON.stringify(await sql`select * from stats_email_daily`) + JSON.stringify(await sql`select * from stats_email_actions_daily`);
  assert.doesNotMatch(dump, /@/, 'no address anywhere in the counters');

  // An unknown email type sent back from a link is ignored; a known one is counted with the action.
  const { createStats } = await import('../lib/stats.mjs');
  await createStats(sql).bumpEmailAction(clock.now, 'conferma', 'conferma');
  await createStats(sql).bumpEmailAction(clock.now, '<x>', 'conferma');
  const acts = await sql`select email_type, action, n from stats_email_actions_daily`;
  assert.deepEqual(acts.map((x) => [x.email_type, x.action, x.n]), [['conferma', 'conferma', 1]]);
});

test('statistics: the site endpoint writes daily counters only, and drops bots, "do not track", other sites and the over-cap', opts, async () => {
  const beacon = (body, headers = {}) => pub(new Request('https://studio.example.it/api/public/s', {
    method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605', origin: 'https://studio.example.it', ...headers }, body: JSON.stringify(body),
  }), freshCtx());
  const count = async () => (await sql`select coalesce(sum(n), 0)::int as n from stats_site_daily where metric = 'view' and page = '/team/'`)[0].n;
  const v0 = await count();
  let r = await beacon({ page: '/team/', src: 'google', device: 'telefono', cta: { 'header-prenota': 1 } });
  assert.equal(r.status, 204);
  assert.equal(await count(), v0 + 1);
  await beacon({ page: '/team/' }, { 'sec-gpc': '1' });
  await beacon({ page: '/team/' }, { dnt: '1' });
  await beacon({ page: '/team/' }, { 'user-agent': 'Googlebot/2.1' });
  await beacon({ page: '/team/' }, { origin: 'https://altro-sito.example' });
  assert.equal(await count(), v0 + 1, 'nothing counted for GPC, DNT, bots, other sites');
  const cta = await sql`select n from stats_site_daily where metric = 'cta' and page = '/team/' and key = 'header-prenota'`;
  assert.equal(cta[0].n, 1);
  // Daily cap.
  deps.env.STATS_DAILY_CAP = '1';
  await beacon({ page: '/team/' });
  assert.equal(await count(), v0 + 1, 'over the cap nothing is written');
  delete deps.env.STATS_DAILY_CAP;
  // The tables have no column that could hold an address, an IP or an identifier.
  const cols = (await sql`select table_name, column_name from information_schema.columns where table_name like 'stats_%'`).map((x) => x.column_name);
  assert.ok(!cols.some((c) => /^(ip|ip_\w+|user_agent|email|address|session\w*|visitor\w*|\w*_hash|token)$/.test(c)), cols.join(','));
});

test('statistics: the admin sees the studio, site and email tabs with the previous period; a professional only her own studio figures', opts, async () => {
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  const to = clock.now.toISOString().slice(0, 10);
  let r = await as('admin')('GET', `/stats/studio?to=${to}&professional=all`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const dayMs = 86400000;
  assert.equal(r.body.from, new Date(Date.parse(to) - 29 * dayMs).toISOString().slice(0, 10), 'default: the last 30 days');
  assert.equal(r.body.prevTo, new Date(Date.parse(to) - 30 * dayMs).toISOString().slice(0, 10));
  assert.equal(r.body.prevFrom, new Date(Date.parse(to) - 59 * dayMs).toISOString().slice(0, 10));
  assert.equal(r.body.shared, true);
  for (const k of ['requests', 'response', 'lead', 'cancellations', 'noShow', 'continuity', 'occupancy', 'contacts', 'heard']) assert.ok(k in r.body.current, k);
  assert.equal(typeof r.body.current.freeSlots, 'number');
  // Small groups are hidden in the shared view: one LinkedIn answer becomes "meno di 5".
  assert.equal(r.body.current.heard.linkedin, -1);
  r = await as('admin')('GET', '/stats/site?from=2026-10-01&to=2026-10-31');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.current.rows));
  r = await as('admin')('GET', '/stats/email');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.current.types));
  // A professional: her own figures (not the studio's), and no site or email tabs.
  const laura = await createEnrolledUser(deps, { email: 'laura.stat@example.it', name: 'Laura', role: 'professionista', professionalId: ids.laura });
  cookies.laura = cookieOf(await login(laura.email, laura.secret));
  const own = await as('laura')('GET', '/stats/studio?professional=all');
  assert.equal(own.status, 200);
  assert.equal(String(own.body.professional), String(ids.laura));
  assert.equal(own.body.shared, false);
  assert.equal((await as('laura')('GET', '/stats/site')).status, 403);
  assert.equal((await as('laura')('GET', '/stats/email')).status, 403);
  assert.equal((await as('admin')('GET', '/stats/studio?from=2020-01-01&to=2026-10-22')).status, 400, 'periods over about two years are refused');
});

test('statistics v2: source kept on the first meeting until the cohort matures, then frozen and erased; which invitation confirmed; insights with suppression', opts, async () => {
  const { createStats } = await import('../lib/stats.mjs');
  const { sha256 } = await import('../lib/crypto.mjs');
  const at = (iso) => new Date(iso);
  // A first meeting in August with its source, and a session three weeks later (same person).
  const hash = deps.vault.lookupHash('contact:coorte@example.it');
  const firstId = await deps.store.insertEvent({ professional_id: ids.laura, service_id: ids.consulenza, kind: 'primo_colloquio', source: 'sito', mode: 'online',
    start_at: at('2026-08-10T08:00:00Z'), end_at: at('2026-08-10T08:30:00Z'), contact_hash: hash, heard_from: 'instagram', created_at: at('2026-08-01T08:00:00Z') });
  await deps.store.insertEvent({ professional_id: ids.laura, service_id: ids.consulenza, kind: 'seduta', source: 'manuale', mode: 'online',
    start_at: at('2026-08-31T08:00:00Z'), end_at: at('2026-08-31T08:50:00Z'), contact_hash: hash });
  assert.equal((await sql`select heard_from from events where id = ${firstId}`)[0].heard_from, 'instagram');
  await createStats(sql).freezeAndRollup(clock.now);
  const rows = await sql`select area, metric, n from stats_monthly where month = '2026-08-01' and professional_id = ${ids.laura} and metric like 'coorte-%' order by area, metric`;
  const get = (area, metric) => (rows.find((r) => r.area === area && r.metric === metric) || {}).n;
  assert.equal(get('fonte:internet', 'coorte-base'), 1);
  assert.equal(get('fonte:internet', 'coorte-30'), 1);
  assert.equal(get('tutti', 'coorte-presentata'), 1);
  assert.equal((await sql`select heard_from from events where id = ${firstId}`)[0].heard_from, null, 'erased once counted');

  // Confirmation from the second invitation's link: confirmed_via = 24h.
  const token = 'tok-confirm-via-test-0123456789';
  const evId = await deps.store.insertEvent({ professional_id: ids.laura, service_id: ids.consulenza, kind: 'seduta', source: 'manuale', mode: 'online',
    start_at: new Date(clock.now.getTime() + 3 * 86400000), end_at: new Date(clock.now.getTime() + 3 * 86400000 + 3000000), manage_token_hash: sha256(token),
    contact_enc: deps.vault.encrypt({ name: 'V', email: 'via@example.it' }), notify_client: true });
  await sql`update events set reminder_sent_at = ${clock.now}, confirm_nudge_sent_at = ${clock.now} where id = ${evId}`;
  const r = await pubCall('POST', '/manage/confirm', { t: token, e: 'conferma-2' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await sql`select confirmed_via from events where id = ${evId}`)[0].confirmed_via, '24h');

  // The Studio tab carries alerts, crossings, capacity and cohorts; the shared view hides small cells.
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  const s = await as('admin')('GET', '/stats/studio?professional=all');
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const I = s.body.insights;
  assert.ok(Array.isArray(I.alerts) && Array.isArray(I.lead) && Array.isArray(I.resp) && Array.isArray(I.conf) && I.cohorts.length === 12 && Array.isArray(I.capacity.areas));
  const cells = [].concat(...I.lead.map((x) => [x.presented, x.absent, x.cancelled, x.freed, x.cont]));
  assert.ok(!cells.some((v) => v > 0 && v < 5), 'no visible count between 1 and 4 in the shared view');
  // Her own view is complete; the export of the same figures follows the shared rules.
  const laura = await createEnrolledUser(deps, { email: 'laura.v2@example.it', name: 'Laura', role: 'professionista', professionalId: ids.laura });
  cookies.laura2 = cookieOf(await login(laura.email, laura.secret));
  const own = await as('laura2')('GET', '/stats/studio');
  assert.equal(own.body.shared, false);
  const exp = await as('laura2')('GET', '/stats/studio?export=1');
  assert.equal(exp.body.shared, true);
  // Note of the month: admin only.
  assert.equal((await as('laura2')('PUT', '/stats/note', { month: '2026-11-01', note: 'x' })).status, 403);
  const note = await as('admin')('PUT', '/stats/note', { month: '2026-11-01', note: 'Novembre: due settimane di ferie.' });
  assert.equal(note.status, 200);
});

test('email texts: only admins and site editors; checked, used when sending, broken ones ignored, restore; activity log', opts, async () => {
  tick();
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  const no = await createEnrolledUser(deps, { email: 'testi.no@example.it', name: 'Senza permesso', role: 'professionista', professionalId: ids.laura });
  const yes = await createEnrolledUser(deps, { email: 'testi.si@example.it', name: 'Redattrice', role: 'professionista', professionalId: ids.laura });
  const users = (await as('admin')('GET', '/users')).body.users;
  assert.equal((await as('admin')('PATCH', `/users/${users.find((u) => u.email === yes.email).id}`, { canEditSite: true })).status, 200);
  cookies.tno = cookieOf(await login(no.email, no.secret));
  cookies.tsi = cookieOf(await login(yes.email, yes.secret));
  assert.equal((await as('tno')('GET', '/email-texts')).status, 403);
  assert.equal((await as('tno')('PUT', '/email-texts/richiesta-ricevuta/it', {})).status, 403);
  let r = await as('tsi')('GET', '/email-texts');
  assert.equal(r.status, 200);
  assert.ok(r.body.emails.length >= 30 && r.body.groups.length === 5);
  const rr = r.body.emails.find((e) => e.key === 'richiesta-ricevuta');
  assert.deepEqual(rr.overrides, {});
  assert.ok(rr.required.includes('link'));

  const body = { p: [[{ t: 'Ciao ' }, { t: '{nome}', b: true }, { t: ', grazie.' }], [{ t: '{dettagli}' }], [{ t: '{link}' }]] };
  r = await as('tsi')('PUT', '/email-texts/richiesta-ricevuta/it', { subject: 'Abbiamo la tua richiesta', body: { p: body.p.slice(0, 2) }, button: 'Annulla' });
  assert.equal(r.status, 400);
  assert.match(r.body.message || r.body.error || '', /Manca il pulsante \{link\}/);
  assert.equal((await as('tsi')('PUT', '/email-texts/nessuna/it', { subject: 'x' })).status, 404);
  r = await as('tsi')('POST', '/email-texts/preview', { key: 'richiesta-ricevuta', lang: 'it', subject: 'Abbiamo la tua richiesta', body, button: 'Annulla' });
  assert.equal(r.body.ok, true);
  assert.match(r.body.html, /Ciao <strong>Anna<\/strong>, grazie\./);
  r = await as('tsi')('POST', '/email-texts/preview', { key: 'richiesta-ricevuta', lang: 'it', subject: 'Ciao {nome}', body, button: 'Annulla' });
  assert.equal(r.body.ok, false);
  r = await as('tsi')('PUT', '/email-texts/richiesta-ricevuta/it', { subject: 'Abbiamo la tua richiesta – Blooming', body, button: 'Annulla' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await as('admin')('GET', '/email-texts');
  const saved = r.body.emails.find((e) => e.key === 'richiesta-ricevuta').overrides.it;
  assert.equal(saved.subject, 'Abbiamo la tua richiesta');
  assert.equal(saved.valid, true);
  assert.equal(saved.updatedBy, 'Redattrice');

  const { templates } = await import('../lib/email.mjs');
  const ev = { start_at: new Date('2026-12-01T10:00:00Z'), end_at: new Date('2026-12-01T10:30:00Z'), kind: 'primo_colloquio', mode: 'online', professional_name: 'Laura Bianchi', lang: 'it' };
  const send = async () => {
    await deps.mailer.send({ to: 'testi@example.it', ...templates.requestReceived({ ev, name: 'Giada', manageUrl: 'https://s/prenota/gestisci/#t=abc', tz: 'Europe/Rome', site: deps.site, lang: 'it' }) });
    return deps.mailer.sent[deps.mailer.sent.length - 1];
  };
  let m = await send();
  assert.equal(m.subject, 'Abbiamo la tua richiesta – Blooming');
  assert.match(m.text, /^Ciao Giada, grazie\./);
  assert.match(m.html, /<strong>Giada<\/strong>/);
  // An override broken behind the admin's back (the link is gone): the default is sent.
  await sql`update email_texts set body = ${sql.json({ p: [[{ t: 'Senza link' }]] })} where key = 'richiesta-ricevuta'`;
  m = await send();
  assert.equal(m.subject, 'Richiesta ricevuta – Blooming');
  assert.equal((await as('admin')('GET', '/email-texts')).body.emails.find((e) => e.key === 'richiesta-ricevuta').overrides.it.valid, false);
  // Restore the original.
  assert.equal((await as('tsi')('DELETE', '/email-texts/richiesta-ricevuta/it')).status, 200);
  assert.deepEqual((await as('tsi')('GET', '/email-texts')).body.emails.find((e) => e.key === 'richiesta-ricevuta').overrides, {});
  const log = (await as('admin')('GET', '/audit')).body.entries.map((e) => `${e.action}: ${e.detail}`);
  assert.ok(log.includes('testo email modificato: Richiesta ricevuta (IT)'));
  assert.ok(log.includes('testo email originale ripristinato: Richiesta ricevuta (IT)'));
});

test('retention: declined or expired requests lose their contacts after 6 months; monthly totals go after 5 years', opts, async () => {
  const saved = clock.now;
  clock.now = new Date('2031-07-15T03:00:00Z');
  const ago = (months) => new Date(Date.UTC(2031, 6 - months, 15, 10));
  const mk = async (status, months, extra = {}) => deps.store.insertEvent({
    professional_id: ids.laura, service_id: ids.consulenza, kind: 'primo_colloquio', source: 'sito', mode: 'online', status,
    start_at: ago(months), end_at: new Date(ago(months).getTime() + 1800000), created_at: ago(months + 1),
    contact_enc: deps.vault.encrypt({ name: 'R', email: `r${status}${months}@example.it` }), contact_hash: `hash-${status}-${months}`, heard_from: 'ricerca', ...extra,
  });
  const oldDeclined = await mk('rifiutato', 7);
  await sql`update events set cancelled_at = ${ago(7)} where id = ${oldDeclined}`;
  const recentDeclined = await mk('rifiutato', 8);
  await sql`update events set cancelled_at = ${ago(5)} where id = ${recentDeclined}`; // declined 5 months ago (for a time long past)
  const kept = await mk('confermato', 7);
  // Cancelled by the person while still waiting (never accepted): 6 months too. Accepted, then cancelled: 24 months.
  const cancelledWaiting = await mk('annullato', 7);
  await sql`update events set cancelled_at = ${ago(7)}, cancelled_by = 'paziente' where id = ${cancelledWaiting}`;
  const cancelledAccepted = await mk('annullato', 9);
  await sql`update events set cancelled_at = ${ago(7)}, cancelled_by = 'paziente', approved_at = ${ago(10)} where id = ${cancelledAccepted}`;
  for (const [table, extra] of [['stats_monthly', "'m-test'"], ['stats_site_monthly', "'/x/', 'm-test'"]]) {
    const cols = table === 'stats_monthly' ? '(month, metric, n)' : '(month, page, metric, n)';
    await sql.unsafe(`insert into ${table} ${cols} values ('2026-06-01', ${extra}, 1), ('2026-07-01', ${extra}, 2), ('2027-01-01', ${extra}, 3)`);
  }
  await sql`insert into stats_notes (month, note) values ('2026-06-01', 'vecchia'), ('2026-08-01', 'tenuta') on conflict do nothing`;

  const r = await runRetention(deps);
  const row = async (id) => (await sql`select contact_enc, contact_hash, heard_from from events where id = ${id}`)[0];
  assert.deepEqual(await row(oldDeclined), { contact_enc: null, contact_hash: null, heard_from: null }, 'declined 7 months ago: contacts gone');
  assert.ok((await row(recentDeclined)).contact_enc, 'declined 5 months ago: still there');
  assert.ok((await row(kept)).contact_enc, 'an appointment that took place follows the 24-month rule');
  assert.equal((await row(cancelledWaiting)).contact_enc, null, 'request cancelled before acceptance: contacts gone after 6 months');
  assert.ok((await row(cancelledAccepted)).contact_enc, 'accepted then cancelled: 24-month rule');
  assert.ok(r.declined >= 1);
  // 5 years: the month of July 2026 is the oldest kept on 15 July 2031.
  assert.deepEqual((await sql`select to_char(month, 'YYYY-MM') as m from stats_monthly where metric = 'm-test' order by month`).map((x) => x.m), ['2026-07', '2027-01']);
  assert.deepEqual((await sql`select to_char(month, 'YYYY-MM') as m from stats_site_monthly where metric = 'm-test' order by month`).map((x) => x.m), ['2026-07', '2027-01']);
  assert.deepEqual((await sql`select note from stats_notes where month in ('2026-06-01', '2026-08-01')`).map((x) => x.note), ['tenuta']);
  assert.equal(r.totals.stats_monthly >= 1 && r.totals.stats_site_monthly >= 1, true);
  clock.now = saved;
});

test('booking: the page never tells whether an email already has a first meeting; only its owner learns it, by email', opts, async () => {
  const saved = clock.now;
  clock.now = new Date('2026-12-02T09:00:00Z'); // Wednesday; Monday 7 December is bookable
  const { svc, anna } = await annaAndService();
  const book = (email, start, name = 'Persona Prova') => pubCall('POST', '/book', { start, mode: 'online', service: svc.id, professional: anna, lang: 'it', name, email, privacy: true });
  const first = await book('doppia@example.it', '2026-12-07T08:00:00.000Z');
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const oldToken = lastToken('doppia@example.it');
  const notices = deps.mailer.sent.length;
  const second = await book('doppia@example.it', '2026-12-07T09:00:00.000Z', 'Qualcun altro');
  assert.equal(second.status, 201);
  assert.equal(second.body.booking.start, '2026-12-07T09:00:00.000Z');
  const hash = deps.vault.lookupHash('email:doppia@example.it');
  assert.equal((await sql`select count(*)::int as n from events where contact_hash = ${hash}`)[0].n, 1, 'nothing booked the second time');
  // Once a day at most: no flooding someone's inbox through the form.
  const before = deps.mailer.sent.length;
  assert.equal((await book('doppia@example.it', '2026-12-07T09:00:00.000Z')).status, 201);
  assert.equal(deps.mailer.sent.slice(before).filter((m) => m.to === 'doppia@example.it').length, 0);
  // The time stays free: someone else books it, and gets an answer of the same shape.
  const fresh = await book('nuova@example.it', '2026-12-07T09:00:00.000Z');
  assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
  const shape = (b) => JSON.stringify(Object.keys(b).sort()) + JSON.stringify(Object.keys(b.booking).sort());
  assert.equal(shape(second.body), shape(fresh.body), 'same answer for a known and an unknown address');
  // The owner of the address gets the details of the meeting in place, with a new link; the professional is not bothered.
  const dupMail = deps.mailer.sent.slice(notices).filter((m) => m.to === 'doppia@example.it');
  assert.equal(dupMail.length, 1);
  assert.match(dupMail[0].subject, /^La tua richiesta – /);
  assert.match(dupMail[0].text, /Gentile Persona Prova,/, 'the name on file, not the one typed the second time');
  assert.match(dupMail[0].text, /lunedì 7 dicembre 2026, ore 09:00/);
  assert.ok(!deps.mailer.sent.slice(notices).some((m) => /Nuova richiesta/.test(m.subject) && m.text.includes('ore 09:00')), 'no notice to the professional');
  const newToken = tokenIn(dupMail[0]);
  assert.equal((await pubCall('POST', '/manage', { t: newToken })).status, 200);
  assert.equal((await pubCall('POST', '/manage', { t: oldToken })).status, 404, 'earlier links stop working');
  clock.now = saved;
});

test('role "tecnico": site, settings (read), aggregated statistics and log; every personal-data endpoint refused', opts, async () => {
  tick();
  cookies.admin = cookieOf(await login(adminUser.email, adminUser.secret));
  // The admin creates the account in «Account e permessi»; it is never linked to an agenda.
  let r = await as('admin')('POST', '/users', { email: 'tecnico@example.it', name: 'Tecnico Prova', role: 'tecnico', professionalId: ids.laura });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const techId = r.body.id;
  assert.equal((await sql`select professional_id from users where id = ${techId}`)[0].professional_id, null);
  const tech = await createEnrolledUser(deps, { email: 'tecnico2@example.it', name: 'Tecnica', role: 'tecnico' });
  cookies.tech = cookieOf(await login(tech.email, tech.secret));
  const t = as('tech');

  r = await t('GET', '/me');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'tecnico');
  assert.equal(r.body.user.canEditSite, true);
  assert.deepEqual(r.body.professionals, []);
  assert.equal((await t('GET', '/settings')).status, 200);
  assert.equal((await t('GET', '/audit')).status, 200);
  assert.equal((await t('GET', '/email-texts')).status, 200);
  assert.equal((await t('GET', '/site/media')).status, 200, 'site editing (pages and header/footer need the site kit, not loaded here)');
  const cat = await t('GET', '/catalog');
  assert.equal(cat.status, 200);
  assert.ok(cat.body.professionals.every((p) => p.notifyEmail === undefined), 'no staff addresses');
  // Statistics: the studio's totals only, always with small groups hidden, whatever is asked.
  for (const q of ['/stats/studio', `/stats/studio?professional=${ids.laura}`, '/stats/site', '/stats/email']) {
    r = await t('GET', q);
    assert.equal(r.status, 200, q);
    assert.equal(r.body.shared, true, q);
  }
  assert.equal((await t('GET', `/stats/studio?professional=${ids.laura}`)).body.professional, null);

  // Every endpoint with names, contacts, notes, agendas, rights tools, exports or accounts: 403.
  const ev = (await sql`select id::text as id from events where kind <> 'blocco' order by id limit 1`)[0].id;
  const rq = (await sql`select id::text as id from contact_requests order by id limit 1`)[0];
  const refused = [
    ['GET', '/events?from=2026-10-01&to=2026-12-31&professional=all'], ['POST', '/events', {}], ['PATCH', `/events/${ev}`, { note: 'x' }],
    ['GET', '/events/pending'], ['POST', `/events/${ev}/approve`, {}], ['POST', `/events/${ev}/decline`, {}],
    ['POST', `/events/${ev}/cancel`, {}], ['POST', `/events/${ev}/reassign`, {}], ['POST', `/events/${ev}/no-show`, {}],
    ['GET', '/requests'], ['POST', `/requests/${rq ? rq.id : 1}`, {}], ['DELETE', `/requests/${rq ? rq.id : 1}`],
    ['GET', '/people?email=giulia@example.it'], ['POST', '/people/forget', { email: 'giulia@example.it', confirm: true }],
    ['GET', '/export'], ['POST', '/me/calendar', {}],
    ['GET', '/rules'], ['PUT', '/rules', {}], ['PUT', '/settings', { settings: {} }], ['PUT', '/stats/note', { month: '2026-11-01', note: 'x' }],
    ['GET', '/users'], ['POST', '/users', {}], ['PATCH', `/users/${techId}`, { role: 'admin' }], ['POST', `/users/${techId}/invite`, {}],
    ['POST', '/services', {}], ['PATCH', `/professionals/${ids.laura}`, {}], ['PUT', `/professionals/${ids.laura}/services`, {}],
    ['POST', '/publish', {}],
  ];
  for (const [m, p, b] of refused) {
    r = await t(m, p, b);
    assert.equal(r.status, 403, `${m} ${p} → ${r.status}`);
  }
  // An admin turned into a technician loses the phone-calendar link and the agenda link.
  const exAdmin = await createEnrolledUser(deps, { email: 'ex.admin@example.it', name: 'Ex Admin', role: 'admin' });
  await sql`update users set ics_token_hash = 'x', professional_id = ${ids.laura} where id = ${exAdmin.id}`;
  assert.equal((await as('admin')('PATCH', `/users/${exAdmin.id}`, { role: 'tecnico' })).status, 200);
  const row = (await sql`select role, ics_token_hash, professional_id from users where id = ${exAdmin.id}`)[0];
  assert.deepEqual({ ...row }, { role: 'tecnico', ics_token_hash: null, professional_id: null });
});
