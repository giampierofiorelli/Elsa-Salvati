// Admin API for the studio. Several accounts:
// - "admin": manages services, professionals, accounts and sees every agenda;
// - "professionista": sees and edits only their own agenda, hours and profile.
// Login: email + password + 6-digit code from an authenticator app (TOTP).
// New accounts get a one-time invitation link: the person chooses a password
// and scans a QR code with the authenticator app.
// Session: signed HttpOnly cookie, SameSite=Strict, 8 hours.
// Every write also needs the "x-agenda: 1" header (blocks cross-site requests).

import {
  verifyPassword, hashPassword, verifyTotp, signSession, readSession, randomToken, sha256, base32Encode,
} from './crypto.mjs';
import { randomBytes } from 'node:crypto';
import { addDays, assertDate, assertTime, zonedToUtc, zonedParts, timeToMinutes } from './time.mjs';
import { normalizeSettings } from './slots.mjs';
import { templates } from './email.mjs';
import {
  HttpError, json, readJson, subPath, clientIp, guard,
  cleanText, cleanEmail, cleanPhone, cleanMultiline, oneOf,
} from './http.mjs';

export const COOKIE = '__Host-agenda';
const SESSION_HOURS = 8;
const INVITE_DAYS = 7;
const KINDS = ['primo_colloquio', 'seduta', 'blocco'];
const ID_RE = /^\d{1,12}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'voce';
}

export function createAdminApi({ store, vault, mailer, site, env, now = () => new Date(), fetchImpl = globalThis.fetch }) {
  const sessionSecret = env.SESSION_SECRET;
  const siteUrl = (site.siteUrl || '').replace(/\/$/, '');
  const issuer = env.TOTP_ISSUER || 'Blooming';

  let dummy;
  const dummyHash = () => (dummy ||= hashPassword(randomToken()));

  function cookie(value, maxAge) {
    return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
  }

  function startSession(user) {
    const exp = now().getTime() + SESSION_HOURS * 3600000;
    const token = signSession({ uid: user.id, exp, sid: randomToken(12) }, sessionSecret);
    return { exp, header: cookie(token, SESSION_HOURS * 3600) };
  }

  async function requireSession(req) {
    const token = parseCookies(req.headers.get('cookie'))[COOKIE];
    const session = readSession(token, sessionSecret, now().getTime());
    if (!session || !session.uid) throw new HttpError(401, 'unauthorized', 'Sessione scaduta: accedi di nuovo');
    const user = await store.getUser(session.uid);
    if (!user || !user.active || !user.enrolled_at) throw new HttpError(401, 'unauthorized', 'Account non attivo');
    if (req.method !== 'GET') {
      if (req.headers.get('x-agenda') !== '1') throw new HttpError(403, 'forbidden', 'Richiesta non consentita');
      const origin = req.headers.get('origin');
      if (origin && origin !== new URL(req.url).origin) throw new HttpError(403, 'forbidden', 'Origine non consentita');
    }
    return { user, exp: session.exp, isAdmin: user.role === 'admin' };
  }

  function requireAdmin(s) {
    if (!s.isAdmin) throw new HttpError(403, 'forbidden', 'Funzione riservata all\'amministratore');
  }

  function parseId(v, field) {
    const s = String(v ?? '');
    if (!ID_RE.test(s)) throw new HttpError(400, 'invalid', `${field} non valido`);
    return s;
  }

  /**
   * Which professional's agenda a request may touch.
   * A professional is always limited to their own; an admin may choose (or "all").
   */
  function scopeFor(s, requested, { allowAll = false } = {}) {
    if (!s.isAdmin) {
      if (!s.user.professional_id) throw new HttpError(403, 'forbidden', 'Account non collegato a un professionista');
      return s.user.professional_id;
    }
    if (requested === 'all' && allowAll) return null;
    if (requested) return parseId(requested, 'Professionista');
    if (s.user.professional_id) return s.user.professional_id;
    if (allowAll) return null;
    throw new HttpError(400, 'invalid', 'Scegli un professionista');
  }

  function assertOwns(s, proId) {
    if (!s.isAdmin && String(proId) !== String(s.user.professional_id)) {
      throw new HttpError(404, 'not_found', 'Appuntamento non trovato');
    }
  }

  function contactOf(row) {
    try { return vault.decrypt(row.contact_enc) || {}; } catch { return {}; }
  }

  function viewEvent(row, tz) {
    const c = contactOf(row);
    const s = zonedParts(new Date(row.start_at), tz);
    const e = zonedParts(new Date(row.end_at), tz);
    return {
      id: row.id, kind: row.kind, status: row.status, source: row.source, mode: row.mode,
      professionalId: row.professional_id, professionalName: row.professional_name,
      serviceId: row.service_id, serviceName: row.service_name || '',
      start: new Date(row.start_at).toISOString(), end: new Date(row.end_at).toISOString(),
      date: s.date, time: s.time, endDate: e.date, endTime: e.time,
      seriesId: row.series_id, title: row.block_title || '',
      name: c.name || '', email: c.email || '', phone: c.phone || '', note: c.note || '',
      cancelledBy: row.cancelled_by, reminderSent: !!row.reminder_sent_at,
    };
  }

  function viewUser(u) {
    return {
      id: u.id, email: u.email, name: u.name, role: u.role, professionalId: u.professional_id,
      professionalName: u.professional_name || null, active: u.active,
      enrolled: !!u.enrolled_at, invitePending: !u.enrolled_at && !!u.invite_expires_at && new Date(u.invite_expires_at) > now(),
    };
  }

  function readContact(body) {
    return {
      name: cleanText(body.name, { field: 'Nome', max: 80 }),
      email: cleanEmail(body.email),
      phone: cleanPhone(body.phone),
      note: cleanMultiline(body.note, { field: 'Nota', max: 300 }),
    };
  }

  function duration(body, settings) {
    const d = body.durationMinutes === undefined ? settings.sessionMinutes : Number(body.durationMinutes);
    if (!Number.isInteger(d) || d < 5 || d > 600) throw new HttpError(400, 'invalid', 'Durata non valida');
    return d;
  }

  async function blockRange(body, tz) {
    assertDate(body.startDate);
    const endDate = body.endDate || body.startDate;
    assertDate(endDate);
    let start, end;
    if (body.allDay) {
      start = zonedToUtc(body.startDate, '00:00', tz);
      end = zonedToUtc(addDays(endDate, 1), '00:00', tz);
    } else {
      assertTime(body.startTime);
      assertTime(body.endTime);
      start = zonedToUtc(body.startDate, body.startTime, tz);
      end = zonedToUtc(endDate, body.endTime, tz);
    }
    if (end <= start) throw new HttpError(400, 'invalid', 'La fine deve essere successiva all\'inizio');
    if (end - start > 366 * 86400000) throw new HttpError(400, 'invalid', 'Blocco troppo lungo');
    return { start, end };
  }

  async function sendSafe(fn) {
    try { await fn(); return true; } catch (err) { console.error('[email]', err.message); return false; }
  }

  async function newInvite(userId) {
    const token = randomToken();
    await store.updateUser(userId, {
      invite_token_hash: sha256(token),
      invite_expires_at: new Date(now().getTime() + INVITE_DAYS * 86400000),
      totp_pending_enc: null,
    });
    return `${siteUrl}/admin/#invito=${token}`;
  }

  function otpauthUri(email, secret) {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  }

  async function userFromInvite(t) {
    if (typeof t !== 'string' || t.length < 20 || t.length > 100) throw new HttpError(404, 'not_found', 'Invito non valido o scaduto');
    const user = await store.getUserByInvite(sha256(t));
    if (!user || !user.active) throw new HttpError(404, 'not_found', 'Invito non valido o scaduto');
    return user;
  }

  // ---------- catalogue validation ----------

  function readService(body, { partial = false } = {}) {
    const out = {};
    if (!partial || body.name !== undefined) out.name = cleanText(body.name, { field: 'Nome del servizio', min: 2, max: 80, required: true });
    if (!partial || body.slug !== undefined || body.name !== undefined) {
      const slug = body.slug ? String(body.slug) : slugify(out.name || '');
      if (!SLUG_RE.test(slug)) throw new HttpError(400, 'invalid', 'Indirizzo della pagina non valido');
      if (!partial || body.slug !== undefined) out.slug = slug;
    }
    if (!partial || body.categoryId !== undefined) out.category_id = parseId(body.categoryId, 'Area');
    if (!partial || body.description !== undefined) out.description = cleanMultiline(body.description, { field: 'Descrizione', max: 1500 });
    if (!partial || body.durationMinutes !== undefined) {
      const d = Number(body.durationMinutes ?? 50);
      if (!Number.isInteger(d) || d < 15 || d > 240) throw new HttpError(400, 'invalid', 'Durata tra 15 e 240 minuti');
      out.duration_minutes = d;
    }
    if (!partial || body.price !== undefined) out.price_text = cleanText(body.price, { field: 'Tariffa', max: 60 });
    if (!partial || body.sort !== undefined) out.sort = Number.isInteger(Number(body.sort)) ? Number(body.sort) : 0;
    if (!partial || body.active !== undefined) out.active = body.active !== false;
    return out;
  }

  function readProfessional(body, { partial = false, self = false } = {}) {
    const out = {};
    const take = (k) => !partial || body[k] !== undefined;
    if (!self && take('name')) out.name = cleanText(body.name, { field: 'Nome', min: 2, max: 80, required: true });
    if (!self && (take('slug') || out.name)) {
      const slug = body.slug ? String(body.slug) : slugify(out.name || '');
      if (!SLUG_RE.test(slug)) throw new HttpError(400, 'invalid', 'Indirizzo della pagina non valido');
      if (!partial || body.slug !== undefined) out.slug = slug;
    }
    if (take('title')) out.title = cleanText(body.title, { field: 'Titolo', max: 80 });
    if (take('bio')) out.bio = cleanMultiline(body.bio, { field: 'Presentazione', max: 1500 });
    if (!self && take('albo')) out.albo = cleanText(body.albo, { field: 'Iscrizione all\'Albo', max: 120 });
    if (!self && take('photo')) {
      const photo = String(body.photo || '');
      if (photo && !/^[a-z0-9-]{1,60}$/.test(photo)) throw new HttpError(400, 'invalid', 'Nome della foto non valido');
      out.photo = photo;
    }
    if (take('notifyEmail')) out.notify_email = cleanEmail(body.notifyEmail);
    if (!self && take('sort')) out.sort = Number.isInteger(Number(body.sort)) ? Number(body.sort) : 0;
    if (!self && take('active')) out.active = body.active !== false;
    return out;
  }

  function duplicateToHttp(err, what) {
    if (err && err.code === 'duplicate') throw new HttpError(409, 'duplicate', `${what} già esistente: scegli un nome o indirizzo diverso`);
    throw err;
  }

  const routes = [
    // ---------- authentication ----------
    ['POST', /^\/login$/, async (req, context) => {
      const body = await readJson(req, 2048);
      const email = cleanEmail(body.email, { required: true });
      const ipKey = vault.lookupHash(`ip:${clientIp(req, context)}`);
      const emailKey = vault.lookupHash(`login:${email}`);
      if (await store.countRate('login', ipKey, 15, { onlyFailures: true }) >= 5
        || await store.countRate('login', emailKey, 15, { onlyFailures: true }) >= 5
        || await store.countRate('login', 'all', 15, { onlyFailures: true }) >= 30) {
        throw new HttpError(429, 'rate_limited', 'Troppi tentativi. Attendi 15 minuti e riprova.');
      }
      if (!sessionSecret) throw new HttpError(503, 'not_configured', 'Accesso non ancora configurato (vedi README)');
      const user = await store.getUserByEmail(email);
      let ok = false;
      if (user && user.active && user.enrolled_at && user.password_hash && user.totp_secret_enc) {
        const passwordOk = verifyPassword(String(body.password || ''), user.password_hash);
        let secret = null;
        try { secret = vault.decrypt(user.totp_secret_enc).secret; } catch { /* unreadable */ }
        const counter = secret ? verifyTotp(secret, body.code, now().getTime()) : null;
        ok = passwordOk && counter !== null && await store.useTotpStep(user.id, counter); // each code works once
      } else {
        verifyPassword('x', dummyHash()); // similar response time for unknown users
      }
      await store.recordRate('login', ipKey, ok);
      await store.recordRate('login', emailKey, ok);
      if (!ok) {
        await store.recordRate('login', 'all', false);
        throw new HttpError(401, 'bad_credentials', 'Email, password o codice non corretti');
      }
      const { exp, header } = startSession(user);
      return json(200, { ok: true, expiresAt: new Date(exp).toISOString() }, { 'set-cookie': header });
    }],

    ['POST', /^\/logout$/, async () => json(200, { ok: true }, { 'set-cookie': cookie('', 0) })],

    // Invitation: show the QR code data (no session yet).
    ['POST', /^\/invite\/info$/, async (req, context) => {
      const body = await readJson(req, 1024);
      const ipKey = vault.lookupHash(`ip:${clientIp(req, context)}`);
      if (await store.countRate('invite', ipKey, 15, { onlyFailures: true }) >= 10) throw new HttpError(429, 'rate_limited', 'Troppi tentativi. Riprova più tardi.');
      let user;
      try { user = await userFromInvite(body.t); } catch (err) { await store.recordRate('invite', ipKey, false); throw err; }
      let secret;
      try { secret = user.totp_pending_enc && vault.decrypt(user.totp_pending_enc).secret; } catch { secret = null; }
      if (!secret) {
        secret = base32Encode(randomBytes(20));
        await store.updateUser(user.id, { totp_pending_enc: vault.encrypt({ secret }) });
      }
      return json(200, { name: user.name, email: user.email, otpauth: otpauthUri(user.email, secret), secret });
    }],

    // Invitation: choose password + confirm the first code, then log in.
    ['POST', /^\/invite\/accept$/, async (req, context) => {
      const body = await readJson(req, 2048);
      const ipKey = vault.lookupHash(`ip:${clientIp(req, context)}`);
      if (await store.countRate('invite', ipKey, 15, { onlyFailures: true }) >= 10) throw new HttpError(429, 'rate_limited', 'Troppi tentativi. Riprova più tardi.');
      let user;
      try { user = await userFromInvite(body.t); } catch (err) { await store.recordRate('invite', ipKey, false); throw err; }
      const password = String(body.password || '');
      if (password.length < 12 || password.length > 200) throw new HttpError(400, 'weak_password', 'La password deve avere almeno 12 caratteri');
      let secret = null;
      try { secret = vault.decrypt(user.totp_pending_enc).secret; } catch { /* missing */ }
      if (!secret) throw new HttpError(400, 'invalid', 'Ricarica la pagina e inquadra di nuovo il QR code');
      const counter = verifyTotp(secret, body.code, now().getTime());
      if (counter === null) {
        await store.recordRate('invite', ipKey, false);
        throw new HttpError(400, 'bad_code', 'Il codice non è corretto. Controlla l\'ora del telefono e riprova con il codice nuovo.');
      }
      await store.updateUser(user.id, {
        password_hash: hashPassword(password),
        totp_secret_enc: vault.encrypt({ secret }), totp_pending_enc: null, totp_last: counter,
        invite_token_hash: null, invite_expires_at: null, enrolled_at: now(),
      });
      const { exp, header } = startSession(user);
      return json(200, { ok: true, expiresAt: new Date(exp).toISOString() }, { 'set-cookie': header });
    }],

    ['GET', /^\/me$/, async (req) => {
      const s = await requireSession(req);
      const settings = await store.getSettings();
      const pros = await store.listProfessionals();
      return json(200, {
        ok: true, expiresAt: new Date(s.exp).toISOString(), timezone: settings.timezone,
        today: zonedParts(now(), settings.timezone).date,
        user: { id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role, professionalId: s.user.professional_id },
        professionals: (s.isAdmin ? pros : pros.filter((p) => p.id === s.user.professional_id)).map((p) => ({ id: p.id, name: p.name, active: p.active })),
      });
    }],

    // Personal calendar feed: a new secret link each time (the old one stops working).
    ['POST', /^\/me\/calendar$/, async (req) => {
      const s = await requireSession(req);
      const token = randomToken(24);
      await store.updateUser(s.user.id, { ics_token_hash: sha256(token) });
      return json(200, { url: `${siteUrl}/api/calendar.ics?k=${token}` });
    }],

    // ---------- agenda ----------
    ['GET', /^\/events$/, async (req) => {
      const s = await requireSession(req);
      const url = new URL(req.url);
      const settings = await store.getSettings();
      const tz = settings.timezone;
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      assertDate(from);
      assertDate(to);
      if (to < from) throw new HttpError(400, 'invalid', 'Intervallo non valido');
      const proId = scopeFor(s, url.searchParams.get('professional'), { allowAll: true });
      const rows = await store.eventsBetween(
        zonedToUtc(from, '00:00', tz), zonedToUtc(addDays(to, 1), '00:00', tz),
        { professionalId: proId, includeCancelled: url.searchParams.get('cancelled') === '1' },
      );
      return json(200, { events: rows.map((r) => viewEvent(r, tz)) });
    }],

    ['POST', /^\/events$/, async (req) => {
      const s = await requireSession(req);
      const body = await readJson(req);
      const settings = await store.getSettings();
      const tz = settings.timezone;
      const proId = scopeFor(s, body.professionalId);
      const kind = oneOf(body.kind, KINDS, 'Tipo');

      if (kind === 'blocco') {
        const { start, end } = await blockRange(body, tz);
        const title = cleanText(body.title, { field: 'Titolo', max: 60 }) || 'Non disponibile';
        try {
          const evId = await store.insertEvent({ professional_id: proId, kind, source: 'manuale', start_at: start, end_at: end, block_title: title });
          return json(201, { created: [evId], skipped: [] });
        } catch (err) {
          if (err.code === 'conflict') {
            const rows = await store.eventsBetween(start, end, { professionalId: proId });
            return json(409, { error: 'conflict', message: 'Nel periodo ci sono appuntamenti: spostali o annullali prima di bloccarlo.', conflicts: rows.map((r) => ({ id: r.id, start: new Date(r.start_at).toISOString() })) });
          }
          throw err;
        }
      }

      assertDate(body.date);
      assertTime(body.time);
      const minutes = duration(body, settings);
      const mode = body.mode ? oneOf(body.mode, ['studio', 'online'], 'Modalità') : null;
      const serviceId = body.serviceId ? parseId(body.serviceId, 'Servizio') : null;
      const contact = readContact(body);
      if (!contact.name) throw new HttpError(400, 'invalid', 'Indica almeno un nome o delle iniziali');
      let count = 1, interval = 1;
      if (body.repeat) {
        count = Number(body.repeat.count);
        interval = Number(body.repeat.intervalWeeks || 1);
        if (!Number.isInteger(count) || count < 1 || count > 104) throw new HttpError(400, 'invalid', 'Numero di ripetizioni non valido (1–104)');
        if (!Number.isInteger(interval) || interval < 1 || interval > 8) throw new HttpError(400, 'invalid', 'Intervallo non valido');
      }
      const seriesId = count > 1 ? await store.createSeries(interval) : null;
      const contactEnc = vault.encrypt(contact);
      const contactHash = contact.email ? vault.lookupHash(`email:${contact.email}`) : null;
      const created = [];
      const skipped = [];
      for (let i = 0; i < count; i++) {
        const date = addDays(body.date, i * 7 * interval);
        const start = zonedToUtc(date, body.time, tz);
        const end = new Date(start.getTime() + minutes * 60000);
        try {
          created.push(await store.insertEvent({
            professional_id: proId, service_id: serviceId, kind, source: 'manuale', mode,
            start_at: start, end_at: end, series_id: seriesId, contact_enc: contactEnc, contact_hash: contactHash,
          }));
        } catch (err) {
          if (err.code !== 'conflict') throw err;
          skipped.push({ date, time: body.time, reason: 'sovrapposizione' });
        }
      }
      if (!created.length) return json(409, { error: 'conflict', message: 'L\'orario si sovrappone a un altro impegno.', skipped });
      let emailSent = false;
      if (body.sendEmail && contact.email) {
        const first = await store.getEvent(created[0]);
        emailSent = await sendSafe(() => mailer.send({
          to: contact.email,
          ...templates.confirmation({ ev: first, name: contact.name, manageUrl: null, tz, site: { ...site, cancelHours: settings.cancelHours } }),
        }));
      }
      return json(201, { created, skipped, seriesId, emailSent });
    }],

    ['PATCH', /^\/events\/(\d+)$/, async (req, _c, [evId]) => {
      const s = await requireSession(req);
      const body = await readJson(req);
      const settings = await store.getSettings();
      const tz = settings.timezone;
      const ev = await store.getEvent(evId);
      if (!ev || ev.status !== 'confermato') throw new HttpError(404, 'not_found', 'Appuntamento non trovato');
      assertOwns(s, ev.professional_id);
      const patch = {};
      if (ev.kind === 'blocco') {
        if (body.startDate) {
          const r = await blockRange(body, tz);
          patch.start_at = r.start;
          patch.end_at = r.end;
        }
        if (body.title !== undefined) patch.block_title = cleanText(body.title, { field: 'Titolo', max: 60 }) || 'Non disponibile';
      } else {
        if (body.date || body.time || body.durationMinutes !== undefined) {
          const cur = zonedParts(new Date(ev.start_at), tz);
          const date = body.date || cur.date;
          const time = body.time || cur.time;
          assertDate(date);
          assertTime(time);
          const minutes = body.durationMinutes !== undefined
            ? duration(body, settings)
            : Math.round((new Date(ev.end_at) - new Date(ev.start_at)) / 60000);
          patch.start_at = zonedToUtc(date, time, tz);
          patch.end_at = new Date(patch.start_at.getTime() + minutes * 60000);
          patch.reminder_sent_at = null;
        }
        if (body.mode !== undefined) patch.mode = body.mode ? oneOf(body.mode, ['studio', 'online'], 'Modalità') : null;
        if (body.serviceId !== undefined) patch.service_id = body.serviceId ? parseId(body.serviceId, 'Servizio') : null;
        if (['name', 'email', 'phone', 'note'].some((k) => body[k] !== undefined)) {
          const merged = { ...contactOf(ev), ...readContact({ ...contactOf(ev), ...body }) };
          patch.contact_enc = vault.encrypt(merged);
          patch.contact_hash = merged.email ? vault.lookupHash(`email:${merged.email}`) : null;
        }
      }
      try {
        await store.updateEvent(evId, patch);
      } catch (err) {
        if (err.code === 'conflict') throw new HttpError(409, 'conflict', 'Il nuovo orario si sovrappone a un altro impegno');
        throw err;
      }
      return json(200, { ok: true, event: viewEvent(await store.getEvent(evId), tz) });
    }],

    ['POST', /^\/events\/(\d+)\/cancel$/, async (req, _c, [evId]) => {
      const s = await requireSession(req);
      const body = await readJson(req);
      const settings = await store.getSettings();
      const ev = await store.getEvent(evId);
      if (!ev || ev.status !== 'confermato') throw new HttpError(404, 'not_found', 'Appuntamento non trovato');
      assertOwns(s, ev.professional_id);
      const cancelled = body.scope === 'following' && ev.series_id
        ? await store.cancelSeriesFrom(ev.series_id, ev.start_at)
        : ((await store.cancelEvent(evId, 'studio')) ? 1 : 0);
      let emailSent = false;
      const c = contactOf(ev);
      if (body.notify && c.email && new Date(ev.start_at) > now()) {
        emailSent = await sendSafe(() => mailer.send({
          to: c.email,
          ...templates.cancelled({ ev, name: c.name, tz: settings.timezone, site, bookUrl: `${siteUrl}/prenota/` }),
        }));
      }
      return json(200, { ok: true, cancelled, emailSent });
    }],

    ['GET', /^\/rules$/, async (req) => {
      const s = await requireSession(req);
      const proId = scopeFor(s, new URL(req.url).searchParams.get('professional'));
      return json(200, { professionalId: proId, rules: await store.getRules(proId) });
    }],

    ['PUT', /^\/rules$/, async (req) => {
      const s = await requireSession(req);
      const body = await readJson(req, 16384);
      const proId = scopeFor(s, body.professionalId);
      if (!Array.isArray(body.rules) || body.rules.length > 50) throw new HttpError(400, 'invalid', 'Regole non valide');
      const rules = body.rules.map((r) => {
        const weekday = Number(r.weekday);
        if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new HttpError(400, 'invalid', 'Giorno non valido');
        assertTime(r.start_time);
        assertTime(r.end_time);
        if (timeToMinutes(r.end_time) <= timeToMinutes(r.start_time)) throw new HttpError(400, 'invalid', 'L\'orario di fine deve seguire l\'inizio');
        return {
          weekday, start_time: r.start_time, end_time: r.end_time,
          mode: oneOf(r.mode || 'entrambi', ['studio', 'online', 'entrambi'], 'Modalità'),
          public: r.public !== false, active: r.active !== false,
        };
      });
      return json(200, { professionalId: proId, rules: await store.replaceRules(proId, rules) });
    }],

    ['GET', /^\/settings$/, async (req) => {
      await requireSession(req);
      return json(200, { settings: await store.getSettings() });
    }],

    ['PUT', /^\/settings$/, async (req) => {
      const s = await requireSession(req);
      requireAdmin(s);
      const body = await readJson(req);
      const current = await store.getSettings();
      return json(200, { settings: await store.saveSettings(normalizeSettings({ ...current, ...body.settings })) });
    }],

    ['GET', /^\/requests$/, async (req) => {
      const s = await requireSession(req);
      const rows = await store.listRequests({ professionalId: s.isAdmin ? null : scopeFor(s) });
      return json(200, {
        requests: rows.map((r) => {
          let c = {};
          try { c = vault.decrypt(r.contact_enc) || {}; } catch { /* unreadable */ }
          return {
            id: r.id, mode: r.mode, category: r.category, createdAt: r.created_at, handledAt: r.handled_at,
            professionalName: r.professional_name, serviceName: r.service_name, ...c,
          };
        }),
      });
    }],

    ['POST', /^\/requests\/(\d+)$/, async (req, _c, [reqId]) => {
      const s = await requireSession(req);
      const body = await readJson(req);
      const r = await store.getRequest(reqId);
      if (!r) throw new HttpError(404, 'not_found', 'Richiesta non trovata');
      if (!s.isAdmin) assertOwns(s, r.professional_id);
      await store.markRequest(reqId, !!body.handled);
      return json(200, { ok: true });
    }],

    ['DELETE', /^\/requests\/(\d+)$/, async (req, _c, [reqId]) => {
      const s = await requireSession(req);
      const r = await store.getRequest(reqId);
      if (!r) throw new HttpError(404, 'not_found', 'Richiesta non trovata');
      if (!s.isAdmin) assertOwns(s, r.professional_id);
      await store.deleteRequest(reqId);
      return json(200, { ok: true });
    }],

    ['GET', /^\/export$/, async (req) => {
      const s = await requireSession(req);
      const settings = await store.getSettings();
      const proId = s.isAdmin ? null : scopeFor(s);
      const rows = await store.eventsBetween(new Date('2000-01-01'), new Date('2100-01-01'), { professionalId: proId, includeCancelled: true });
      return json(200, {
        exportedAt: now().toISOString(),
        settings,
        rules: await store.getRules(proId),
        events: rows.map((r) => viewEvent(r, settings.timezone)),
      }, { 'content-disposition': `attachment; filename="agenda-${zonedParts(now(), settings.timezone).date}.json"` });
    }],

    // ---------- catalogue (services and professionals) ----------
    ['GET', /^\/catalog$/, async (req) => {
      const s = await requireSession(req);
      const [categories, services, professionals, offerings] = await Promise.all([
        store.listCategories(), store.listServices(), store.listProfessionals(), store.listOfferings(),
      ]);
      const visiblePros = s.isAdmin ? professionals : professionals.filter((p) => p.id === s.user.professional_id);
      return json(200, {
        categories,
        services: services.map((x) => ({
          id: x.id, categoryId: x.category_id, category: x.category, slug: x.slug, name: x.name, description: x.description,
          durationMinutes: x.duration_minutes, price: x.price_text, sort: x.sort, active: x.active,
        })),
        professionals: visiblePros.map((p) => ({
          id: p.id, slug: p.slug, name: p.name, title: p.title, bio: p.bio, albo: p.albo, photo: p.photo,
          notifyEmail: p.notify_email, sort: p.sort, active: p.active,
          offerings: offerings.filter((o) => o.professional_id === p.id)
            .map((o) => ({ serviceId: o.service_id, inStudio: o.in_studio, online: o.online })),
        })),
      });
    }],

    ['PATCH', /^\/categories\/(\d+)$/, async (req, _c, [catId]) => {
      const s = await requireSession(req);
      requireAdmin(s);
      const body = await readJson(req);
      const patch = {};
      if (body.name !== undefined) patch.name = cleanText(body.name, { field: 'Nome', min: 2, max: 60, required: true });
      if (body.intro !== undefined) patch.intro = cleanMultiline(body.intro, { field: 'Introduzione', max: 600 });
      if (body.active !== undefined) patch.active = body.active !== false;
      await store.updateCategory(catId, patch);
      return json(200, { ok: true });
    }],

    ['POST', /^\/services$/, async (req) => {
      const s = await requireSession(req);
      requireAdmin(s);
      const body = await readJson(req, 8192);
      try {
        return json(201, { id: await store.insertService(readService(body)) });
      } catch (err) { return duplicateToHttp(err, 'Servizio'); }
    }],

    ['PATCH', /^\/services\/(\d+)$/, async (req, _c, [serviceId]) => {
      const s = await requireSession(req);
      requireAdmin(s);
      const body = await readJson(req, 8192);
      try {
        await store.updateService(serviceId, readService(body, { partial: true }));
      } catch (err) { return duplicateToHttp(err, 'Servizio'); }
      return json(200, { ok: true });
    }],

    ['POST', /^\/professionals$/, async (req) => {
      const s = await requireSession(req);
      requireAdmin(s);
      const body = await readJson(req, 8192);
      try {
        return json(201, { id: await store.insertProfessional(readProfessional(body)) });
      } catch (err) { return duplicateToHttp(err, 'Professionista'); }
    }],

    ['PATCH', /^\/professionals\/(\d+)$/, async (req, _c, [proId]) => {
      const s = await requireSession(req);
      if (!s.isAdmin) assertOwns(s, proId);
      const body = await readJson(req, 8192);
      try {
        await store.updateProfessional(proId, readProfessional(body, { partial: true, self: !s.isAdmin }));
      } catch (err) { return duplicateToHttp(err, 'Professionista'); }
      return json(200, { ok: true });
    }],

    // Which services a professional offers, in studio and/or online.
    // Professionals may change the modes of their own services; only the admin adds or removes services.
    ['PUT', /^\/professionals\/(\d+)\/services$/, async (req, _c, [proId]) => {
      const s = await requireSession(req);
      if (!s.isAdmin) assertOwns(s, proId);
      const body = await readJson(req, 16384);
      if (!Array.isArray(body.offerings) || body.offerings.length > 100) throw new HttpError(400, 'invalid', 'Elenco non valido');
      const next = body.offerings.map((o) => ({
        service_id: parseId(o.serviceId, 'Servizio'), in_studio: !!o.inStudio, online: !!o.online,
      }));
      if (next.some((o) => !o.in_studio && !o.online)) throw new HttpError(400, 'invalid', 'Per ogni servizio scegli almeno una modalità (studio o online)');
      if (new Set(next.map((o) => o.service_id)).size !== next.length) throw new HttpError(400, 'invalid', 'Servizio ripetuto');
      if (!s.isAdmin) {
        const current = (await store.listOfferings()).filter((o) => o.professional_id === String(proId)).map((o) => o.service_id).sort();
        const wanted = next.map((o) => o.service_id).sort();
        if (current.join() !== wanted.join()) throw new HttpError(403, 'forbidden', 'Solo l\'amministratore può aggiungere o togliere servizi');
      }
      const known = new Set((await store.listServices()).map((x) => x.id));
      if (next.some((o) => !known.has(o.service_id))) throw new HttpError(400, 'invalid', 'Servizio inesistente');
      await store.replaceOfferings(proId, next);
      return json(200, { ok: true });
    }],

    // ---------- accounts (admin only) ----------
    ['GET', /^\/users$/, async (req) => {
      const s = await requireSession(req);
      requireAdmin(s);
      return json(200, { users: (await store.listUsers()).map(viewUser) });
    }],

    ['POST', /^\/users$/, async (req) => {
      const s = await requireSession(req);
      requireAdmin(s);
      const body = await readJson(req);
      const email = cleanEmail(body.email, { required: true }).toLowerCase();
      const name = cleanText(body.name, { field: 'Nome', min: 2, max: 80, required: true });
      const role = oneOf(body.role, ['admin', 'professionista'], 'Ruolo');
      const proId = body.professionalId ? parseId(body.professionalId, 'Professionista') : null;
      if (role === 'professionista' && !proId) throw new HttpError(400, 'invalid', 'Collega l\'account a un professionista');
      if (proId && !(await store.getProfessional(proId))) throw new HttpError(400, 'invalid', 'Professionista inesistente');
      let userId;
      try {
        userId = await store.insertUser({ email, name, role, professional_id: proId, invite_token_hash: null, invite_expires_at: null });
      } catch (err) { return duplicateToHttp(err, 'Account con questa email'); }
      const inviteUrl = await newInvite(userId);
      return json(201, { id: userId, inviteUrl, expiresInDays: INVITE_DAYS });
    }],

    // New invitation link: resets password and authenticator for that account.
    ['POST', /^\/users\/(\d+)\/invite$/, async (req, _c, [userId]) => {
      const s = await requireSession(req);
      requireAdmin(s);
      const user = await store.getUser(userId);
      if (!user) throw new HttpError(404, 'not_found', 'Account non trovato');
      if (user.id === s.user.id) throw new HttpError(400, 'invalid', 'Non puoi reimpostare il tuo stesso accesso da qui');
      await store.updateUser(userId, { password_hash: null, totp_secret_enc: null, enrolled_at: null, totp_last: -1 });
      return json(200, { inviteUrl: await newInvite(userId), expiresInDays: INVITE_DAYS });
    }],

    ['PATCH', /^\/users\/(\d+)$/, async (req, _c, [userId]) => {
      const s = await requireSession(req);
      requireAdmin(s);
      const body = await readJson(req);
      const user = await store.getUser(userId);
      if (!user) throw new HttpError(404, 'not_found', 'Account non trovato');
      const patch = {};
      if (body.name !== undefined) patch.name = cleanText(body.name, { field: 'Nome', min: 2, max: 80, required: true });
      if (body.role !== undefined) patch.role = oneOf(body.role, ['admin', 'professionista'], 'Ruolo');
      if (body.professionalId !== undefined) patch.professional_id = body.professionalId ? parseId(body.professionalId, 'Professionista') : null;
      if (body.active !== undefined) patch.active = body.active !== false;
      const role = patch.role || user.role;
      const proId = 'professional_id' in patch ? patch.professional_id : user.professional_id;
      if (role === 'professionista' && !proId) throw new HttpError(400, 'invalid', 'Collega l\'account a un professionista');
      if (user.id === s.user.id && (patch.active === false || patch.role === 'professionista')) {
        throw new HttpError(400, 'invalid', 'Non puoi disattivare o declassare il tuo stesso account');
      }
      await store.updateUser(userId, patch);
      return json(200, { ok: true });
    }],

    // Rebuild the public site so new services and professionals appear on the pages.
    ['POST', /^\/publish$/, async (req) => {
      const s = await requireSession(req);
      requireAdmin(s);
      if (!env.BUILD_HOOK_URL) throw new HttpError(503, 'not_configured', 'Aggiornamento automatico non configurato (BUILD_HOOK_URL)');
      const res = await fetchImpl(env.BUILD_HOOK_URL, { method: 'POST' });
      if (!res.ok) throw new HttpError(502, 'publish_failed', 'Aggiornamento non riuscito, riprova più tardi');
      return json(200, { ok: true });
    }],
  ];

  return function handle(req, context) {
    return guard(async () => {
      const path = subPath(req, '/api/admin');
      for (const [method, re, fn] of routes) {
        const m = path.match(re);
        if (m && req.method === method) return fn(req, context, m.slice(1));
      }
      throw new HttpError(404, 'not_found', 'Risorsa non trovata');
    });
  };
}
