// Admin API for the studio agenda. Single user (the psychologist).
// Login: password + 6-digit code from an authenticator app (TOTP).
// Session: signed HttpOnly cookie, SameSite=Strict, 8 hours.
// Every write also needs the "x-agenda: 1" header (blocks cross-site requests).

import {
  verifyPassword, verifyTotp, signSession, readSession, randomToken,
} from './crypto.mjs';
import { addDays, assertDate, assertTime, zonedToUtc, zonedParts, timeToMinutes } from './time.mjs';
import { normalizeSettings } from './slots.mjs';
import { templates } from './email.mjs';
import {
  HttpError, json, readJson, subPath, clientIp, guard,
  cleanText, cleanEmail, cleanPhone, cleanMultiline, oneOf,
} from './http.mjs';

export const COOKIE = '__Host-agenda';
const SESSION_HOURS = 8;
const KINDS = ['primo_colloquio', 'seduta', 'blocco'];

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function createAdminApi({ store, vault, mailer, site, env, now = () => new Date() }) {
  const sessionSecret = env.SESSION_SECRET;

  function cookie(value, maxAge) {
    return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
  }

  function requireSession(req) {
    const token = parseCookies(req.headers.get('cookie'))[COOKIE];
    const session = readSession(token, sessionSecret, now().getTime());
    if (!session) throw new HttpError(401, 'unauthorized', 'Sessione scaduta: accedi di nuovo');
    if (req.method !== 'GET') {
      if (req.headers.get('x-agenda') !== '1') throw new HttpError(403, 'forbidden', 'Richiesta non consentita');
      const origin = req.headers.get('origin');
      if (origin && origin !== new URL(req.url).origin) throw new HttpError(403, 'forbidden', 'Origine non consentita');
    }
    return session;
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
      start: new Date(row.start_at).toISOString(), end: new Date(row.end_at).toISOString(),
      date: s.date, time: s.time, endDate: e.date, endTime: e.time,
      seriesId: row.series_id, title: row.block_title || '',
      name: c.name || '', email: c.email || '', phone: c.phone || '', note: c.note || '',
      cancelledBy: row.cancelled_by, reminderSent: !!row.reminder_sent_at,
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

  async function conflictsFor(start, end) {
    const rows = await store.eventsBetween(start, end);
    return rows.map((r) => ({ id: r.id, kind: r.kind, start: new Date(r.start_at).toISOString() }));
  }

  async function sendSafe(fn) {
    try { await fn(); return true; } catch (err) { console.error('[email]', err.message); return false; }
  }

  const routes = [
    ['POST', /^\/login$/, async (req, context) => {
      const body = await readJson(req, 2048);
      const ipKey = vault.lookupHash(`ip:${clientIp(req, context)}`);
      const failures = await store.countRate('login', ipKey, 15, { onlyFailures: true });
      const globalFailures = await store.countRate('login', 'all', 15, { onlyFailures: true });
      if (failures >= 5 || globalFailures >= 20) {
        throw new HttpError(429, 'rate_limited', 'Troppi tentativi. Attendi 15 minuti e riprova.');
      }
      if (!env.ADMIN_PASSWORD_HASH || !env.ADMIN_TOTP_SECRET || !sessionSecret) {
        throw new HttpError(503, 'not_configured', 'Accesso non ancora configurato (vedi README)');
      }
      const passwordOk = verifyPassword(String(body.password || ''), env.ADMIN_PASSWORD_HASH);
      const counter = verifyTotp(env.ADMIN_TOTP_SECRET, body.code, now().getTime());
      const last = (await store.getKv('totp_last')) ?? -1;
      const ok = passwordOk && counter !== null && counter > last;
      await store.recordRate('login', ipKey, ok);
      if (!ok) {
        await store.recordRate('login', 'all', false);
        throw new HttpError(401, 'bad_credentials', 'Password o codice non corretti');
      }
      await store.setKv('totp_last', counter); // each code works only once
      const exp = now().getTime() + SESSION_HOURS * 3600000;
      const token = signSession({ sub: 'admin', exp, sid: randomToken(12) }, sessionSecret);
      return json(200, { ok: true, expiresAt: new Date(exp).toISOString() }, { 'set-cookie': cookie(token, SESSION_HOURS * 3600) });
    }],

    ['POST', /^\/logout$/, async () => json(200, { ok: true }, { 'set-cookie': cookie('', 0) })],

    ['GET', /^\/me$/, async (req) => {
      const s = requireSession(req);
      const settings = await store.getSettings();
      return json(200, {
        ok: true, expiresAt: new Date(s.exp).toISOString(), timezone: settings.timezone,
        today: zonedParts(now(), settings.timezone).date,
        calendarFeed: env.ICAL_TOKEN ? `${(site.siteUrl || '').replace(/\/$/, '')}/api/calendar.ics?k=${env.ICAL_TOKEN}` : null,
      });
    }],

    ['GET', /^\/events$/, async (req) => {
      requireSession(req);
      const url = new URL(req.url);
      const settings = await store.getSettings();
      const tz = settings.timezone;
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      assertDate(from);
      assertDate(to);
      if (to < from) throw new HttpError(400, 'invalid', 'Intervallo non valido');
      const rows = await store.eventsBetween(
        zonedToUtc(from, '00:00', tz), zonedToUtc(addDays(to, 1), '00:00', tz),
        { includeCancelled: url.searchParams.get('cancelled') === '1' },
      );
      return json(200, { events: rows.map((r) => viewEvent(r, tz)) });
    }],

    ['POST', /^\/events$/, async (req) => {
      requireSession(req);
      const body = await readJson(req);
      const settings = await store.getSettings();
      const tz = settings.timezone;
      const kind = oneOf(body.kind, KINDS, 'Tipo');

      if (kind === 'blocco') {
        const { start, end } = await blockRange(body, tz);
        const title = cleanText(body.title, { field: 'Titolo', max: 60 }) || 'Non disponibile';
        try {
          const id = await store.insertEvent({ kind, source: 'manuale', start_at: start, end_at: end, block_title: title });
          return json(201, { created: [id], skipped: [] });
        } catch (err) {
          if (err.code === 'conflict') {
            return json(409, { error: 'conflict', message: 'Nel periodo ci sono appuntamenti: spostali o annullali prima di bloccarlo.', conflicts: await conflictsFor(start, end) });
          }
          throw err;
        }
      }

      assertDate(body.date);
      assertTime(body.time);
      const minutes = duration(body, settings);
      const mode = body.mode ? oneOf(body.mode, ['studio', 'online'], 'Modalità') : null;
      const contact = readContact(body);
      if (!contact.name) throw new HttpError(400, 'invalid', 'Indica almeno un nome o delle iniziali');
      const repeat = body.repeat || null;
      let count = 1, interval = 1;
      if (repeat) {
        count = Number(repeat.count);
        interval = Number(repeat.intervalWeeks || 1);
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
            kind, source: 'manuale', mode, start_at: start, end_at: end, series_id: seriesId,
            contact_enc: contactEnc, contact_hash: contactHash,
          }));
        } catch (err) {
          if (err.code !== 'conflict') throw err;
          skipped.push({ date, time: body.time, reason: 'sovrapposizione' });
        }
      }
      if (!created.length) {
        return json(409, { error: 'conflict', message: 'L\'orario si sovrappone a un altro impegno.', skipped });
      }
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

    ['PATCH', /^\/events\/(\d+)$/, async (req, _c, [id]) => {
      requireSession(req);
      const body = await readJson(req);
      const settings = await store.getSettings();
      const tz = settings.timezone;
      const ev = await store.getEvent(id);
      if (!ev || ev.status !== 'confermato') throw new HttpError(404, 'not_found', 'Appuntamento non trovato');
      const patch = {};
      if (ev.kind === 'blocco') {
        if (body.startDate) Object.assign(patch, Object.fromEntries(Object.entries(await blockRange(body, tz)).map(([k, v]) => [`${k}_at`, v])));
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
        if (['name', 'email', 'phone', 'note'].some((k) => body[k] !== undefined)) {
          const merged = { ...contactOf(ev), ...readContact({ ...contactOf(ev), ...body }) };
          patch.contact_enc = vault.encrypt(merged);
          patch.contact_hash = merged.email ? vault.lookupHash(`email:${merged.email}`) : null;
        }
      }
      try {
        await store.updateEvent(id, patch);
      } catch (err) {
        if (err.code === 'conflict') throw new HttpError(409, 'conflict', 'Il nuovo orario si sovrappone a un altro impegno');
        throw err;
      }
      return json(200, { ok: true, event: viewEvent(await store.getEvent(id), tz) });
    }],

    ['POST', /^\/events\/(\d+)\/cancel$/, async (req, _c, [id]) => {
      requireSession(req);
      const body = await readJson(req);
      const settings = await store.getSettings();
      const ev = await store.getEvent(id);
      if (!ev || ev.status !== 'confermato') throw new HttpError(404, 'not_found', 'Appuntamento non trovato');
      let cancelled = 0;
      if (body.scope === 'following' && ev.series_id) {
        cancelled = await store.cancelSeriesFrom(ev.series_id, ev.start_at);
      } else {
        cancelled = (await store.cancelEvent(id, 'studio')) ? 1 : 0;
      }
      let emailSent = false;
      const c = contactOf(ev);
      if (body.notify && c.email && new Date(ev.start_at) > now()) {
        emailSent = await sendSafe(() => mailer.send({
          to: c.email,
          ...templates.cancelled({ ev, name: c.name, tz: settings.timezone, site, bookUrl: `${(site.siteUrl || '').replace(/\/$/, '')}/prenota/` }),
        }));
      }
      return json(200, { ok: true, cancelled, emailSent });
    }],

    ['GET', /^\/rules$/, async (req) => {
      requireSession(req);
      return json(200, { rules: await store.getRules() });
    }],

    ['PUT', /^\/rules$/, async (req) => {
      requireSession(req);
      const body = await readJson(req, 16384);
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
      return json(200, { rules: await store.replaceRules(rules) });
    }],

    ['GET', /^\/settings$/, async (req) => {
      requireSession(req);
      return json(200, { settings: await store.getSettings() });
    }],

    ['PUT', /^\/settings$/, async (req) => {
      requireSession(req);
      const body = await readJson(req);
      const current = await store.getSettings();
      const next = normalizeSettings({ ...current, ...body.settings });
      return json(200, { settings: await store.saveSettings(next) });
    }],

    ['GET', /^\/requests$/, async (req) => {
      requireSession(req);
      const rows = await store.listRequests();
      return json(200, {
        requests: rows.map((r) => {
          let c = {};
          try { c = vault.decrypt(r.contact_enc) || {}; } catch { /* unreadable */ }
          return { id: r.id, mode: r.mode, createdAt: r.created_at, handledAt: r.handled_at, ...c };
        }),
      });
    }],

    ['POST', /^\/requests\/(\d+)$/, async (req, _c, [id]) => {
      requireSession(req);
      const body = await readJson(req);
      await store.markRequest(id, !!body.handled);
      return json(200, { ok: true });
    }],

    ['DELETE', /^\/requests\/(\d+)$/, async (req, _c, [id]) => {
      requireSession(req);
      await store.deleteRequest(id);
      return json(200, { ok: true });
    }],

    // Full export of the agenda (backup / continuity / data portability).
    ['GET', /^\/export$/, async (req) => {
      requireSession(req);
      const settings = await store.getSettings();
      const rows = await store.eventsBetween(new Date('2000-01-01'), new Date('2100-01-01'), { includeCancelled: true });
      return json(200, {
        exportedAt: now().toISOString(),
        settings,
        rules: await store.getRules(),
        events: rows.map((r) => viewEvent(r, settings.timezone)),
      }, { 'content-disposition': `attachment; filename="agenda-${zonedParts(now(), settings.timezone).date}.json"` });
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
