// Public API: available slots, instant booking of the first appointment,
// self-service cancel/reschedule through a personal link, call-back requests.

import { availableSlots, isSlotBookable } from './slots.mjs';
import { randomToken, sha256 } from './crypto.mjs';
import { templates } from './email.mjs';
import {
  HttpError, json, readJson, subPath, clientIp, guard,
  cleanText, cleanEmail, cleanPhone, cleanMultiline, oneOf,
} from './http.mjs';

const MODES = ['studio', 'online'];
const SERVICES = ['psicoterapia', 'coaching'];

export function createPublicApi({ store, vault, mailer, site, now = () => new Date() }) {
  const siteUrl = (site.siteUrl || '').replace(/\/$/, '');
  const manageUrl = (token) => `${siteUrl}/prenota/gestisci/#t=${token}`;
  const adminUrl = `${siteUrl}/admin/`;
  const bookUrl = `${siteUrl}/prenota/`;

  async function rateLimit(req, context, action, max, minutes) {
    const key = vault.lookupHash(`ip:${clientIp(req, context)}`);
    if (await store.countRate(action, key, minutes) >= max) {
      throw new HttpError(429, 'rate_limited', 'Troppe richieste ravvicinate. Riprova più tardi o contatta lo studio.');
    }
    await store.recordRate(action, key, true);
  }

  async function loadAvailability(mode) {
    const settings = await store.getSettings();
    const rules = await store.getRules({ onlyActive: true });
    const t = now();
    const from = new Date(t.getTime() - 86400000);
    const to = new Date(t.getTime() + (settings.horizonDays + 2) * 86400000);
    const busy = await store.busyBetween(from, to);
    return { settings, rules, busy, t, slots: availableSlots({ rules, busy, settings, now: t, mode }) };
  }

  function siteFor(settings) {
    return { ...site, cancelHours: settings.cancelHours };
  }

  async function notify(fn) {
    try { await fn(); } catch (err) { console.error('[email]', err.message); }
  }

  // Changes are allowed up to cancelHours before the appointment, and always
  // within an hour of booking (so a short-notice booking can still be undone).
  const GRACE_MS = 3600000;
  function canChange(ev, settings) {
    if (ev.status !== 'confermato') return false;
    const t = now().getTime();
    const start = new Date(ev.start_at).getTime();
    if (start <= t) return false;
    return start - t >= settings.cancelHours * 3600000 || t - new Date(ev.created_at).getTime() <= GRACE_MS;
  }

  async function eventFromToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) {
      throw new HttpError(404, 'not_found', 'Link non valido o scaduto');
    }
    const ev = await store.findByTokenHash(sha256(token));
    if (!ev) throw new HttpError(404, 'not_found', 'Link non valido o scaduto');
    return ev;
  }

  function publicEvent(ev, settings) {
    return {
      start: new Date(ev.start_at).toISOString(),
      end: new Date(ev.end_at).toISOString(),
      mode: ev.mode,
      status: ev.status,
      canChange: canChange(ev, settings),
      cancelHours: settings.cancelHours,
    };
  }

  function parseStart(v) {
    const d = new Date(typeof v === 'string' ? v : '');
    if (Number.isNaN(d.getTime())) throw new HttpError(400, 'invalid', 'Orario non valido');
    return d;
  }

  const routes = {
    'GET /slots': async (req) => {
      const url = new URL(req.url);
      const mode = url.searchParams.get('mode') || undefined;
      if (mode) oneOf(mode, MODES, 'Modalità');
      const { settings, slots } = await loadAvailability(mode);
      const days = new Map();
      for (const s of slots) {
        if (!days.has(s.date)) days.set(s.date, []);
        days.get(s.date).push({ start: s.start.toISOString(), time: s.time, modes: s.modes });
      }
      return json(200, {
        timezone: settings.timezone,
        durationMinutes: settings.firstSessionMinutes,
        cancelHours: settings.cancelHours,
        days: [...days.entries()].map(([date, list]) => ({ date, slots: list })),
      });
    },

    'POST /book': async (req, context) => {
      const body = await readJson(req);
      if (body.website) throw new HttpError(400, 'invalid', 'Richiesta non valida'); // honeypot
      const mode = oneOf(body.mode, MODES, 'Modalità');
      const service = oneOf(body.service, SERVICES, 'Servizio');
      const start = parseStart(body.start);
      const name = cleanText(body.name, { field: 'Nome', min: 2, max: 80, required: true });
      const email = cleanEmail(body.email, { required: true });
      const phone = cleanPhone(body.phone);
      if (body.privacy !== true) throw new HttpError(400, 'privacy', 'Per prenotare è necessario prendere visione dell\'informativa privacy');

      await rateLimit(req, context, 'book', 6, 60);
      const { settings, rules, busy, t } = await loadAvailability(mode);
      if (!isSlotBookable({ rules, busy, settings, now: t, mode, start })) {
        throw new HttpError(409, 'slot_unavailable', 'Questo orario non è più disponibile. Scegline un altro.');
      }
      const contactHash = vault.lookupHash(`email:${email}`);
      if (await store.countActiveFirstByContact(contactHash, t) >= settings.maxActivePerContact) {
        throw new HttpError(409, 'already_booked', 'Risulta già un primo colloquio in programma con questa email. Puoi spostarlo dal link ricevuto via email.');
      }
      const token = randomToken();
      const ev = {
        kind: 'primo_colloquio', source: 'sito', mode, service,
        start_at: start, end_at: new Date(start.getTime() + settings.firstSessionMinutes * 60000),
        contact_enc: vault.encrypt({ name, email, phone }),
        contact_hash: contactHash,
        manage_token_hash: sha256(token),
      };
      try {
        await store.insertEvent(ev);
      } catch (err) {
        if (err.code === 'conflict') throw new HttpError(409, 'slot_unavailable', 'Questo orario è appena stato prenotato da un\'altra persona. Scegline un altro.');
        throw err;
      }
      const s = siteFor(settings);
      await notify(() => mailer.send({ to: email, ...templates.confirmation({ ev, name, manageUrl: manageUrl(token), tz: settings.timezone, site: s }) }));
      await notify(() => mailer.send({ to: site.notifyEmail, ...templates.studioNotice({ ev, action: 'booked', tz: settings.timezone, adminUrl }) }));
      return json(201, {
        ok: true,
        booking: { start: ev.start_at.toISOString(), end: ev.end_at.toISOString(), mode, durationMinutes: settings.firstSessionMinutes },
        manageUrl: manageUrl(token),
      });
    },

    'POST /manage': async (req) => {
      const body = await readJson(req);
      const ev = await eventFromToken(body.t);
      const settings = await store.getSettings();
      return json(200, { booking: publicEvent(ev, settings) });
    },

    'POST /manage/cancel': async (req) => {
      const body = await readJson(req);
      const ev = await eventFromToken(body.t);
      const settings = await store.getSettings();
      if (!canChange(ev, settings)) {
        throw new HttpError(409, 'too_late', `L'appuntamento non può più essere annullato online (meno di ${settings.cancelHours} ore). Contatta lo studio.`);
      }
      await store.cancelEvent(ev.id, 'paziente');
      const contact = vault.decrypt(ev.contact_enc) || {};
      const s = siteFor(settings);
      await notify(() => mailer.send({ to: contact.email, ...templates.cancelled({ ev, name: contact.name, tz: settings.timezone, site: s, bookUrl }) }));
      await notify(() => mailer.send({ to: site.notifyEmail, ...templates.studioNotice({ ev, action: 'cancelled', tz: settings.timezone, adminUrl }) }));
      return json(200, { ok: true });
    },

    'POST /manage/reschedule': async (req) => {
      const body = await readJson(req);
      const ev = await eventFromToken(body.t);
      const mode = oneOf(body.mode, MODES, 'Modalità');
      const start = parseStart(body.start);
      const { settings, rules, busy, t } = await loadAvailability(mode);
      if (!canChange(ev, settings)) {
        throw new HttpError(409, 'too_late', `L'appuntamento non può più essere spostato online (meno di ${settings.cancelHours} ore). Contatta lo studio.`);
      }
      // The current appointment does not block its own new time.
      const others = busy.filter((b) => !(new Date(b.start_at).getTime() === new Date(ev.start_at).getTime()
        && new Date(b.end_at).getTime() === new Date(ev.end_at).getTime()));
      if (!isSlotBookable({ rules, busy: others, settings, now: t, mode, start })) {
        throw new HttpError(409, 'slot_unavailable', 'Questo orario non è più disponibile. Scegline un altro.');
      }
      const token = randomToken();
      const newEv = {
        kind: ev.kind, source: ev.source, mode, service: ev.service,
        start_at: start, end_at: new Date(start.getTime() + settings.firstSessionMinutes * 60000),
        contact_enc: ev.contact_enc,
        manage_token_hash: sha256(token),
      };
      try {
        await store.sql.begin(async (tx) => {
          const [locked] = await tx`select status from events where id = ${ev.id} for update`;
          if (!locked || locked.status !== 'confermato') throw new HttpError(409, 'not_active', 'L\'appuntamento non è più attivo');
          await store.cancelEvent(ev.id, 'paziente', tx);
          await tx`update events set manage_token_hash = null where id = ${ev.id}`;
          const contactHash = (await tx`select contact_hash from events where id = ${ev.id}`)[0].contact_hash;
          await store.insertEvent({ ...newEv, contact_hash: contactHash }, tx);
        });
      } catch (err) {
        if (err.code === 'conflict') throw new HttpError(409, 'slot_unavailable', 'Questo orario è appena stato prenotato. Scegline un altro.');
        throw err;
      }
      const contact = vault.decrypt(ev.contact_enc) || {};
      const s = siteFor(settings);
      await notify(() => mailer.send({ to: contact.email, ...templates.rescheduled({ ev: newEv, name: contact.name, manageUrl: manageUrl(token), tz: settings.timezone, site: s }) }));
      await notify(() => mailer.send({ to: site.notifyEmail, ...templates.studioNotice({ ev: newEv, action: 'rescheduled', tz: settings.timezone, adminUrl }) }));
      return json(200, {
        ok: true,
        booking: { start: newEv.start_at.toISOString(), end: newEv.end_at.toISOString(), mode },
        manageUrl: manageUrl(token),
      });
    },

    'POST /request': async (req, context) => {
      const body = await readJson(req);
      if (body.website) throw new HttpError(400, 'invalid', 'Richiesta non valida');
      const name = cleanText(body.name, { field: 'Nome', min: 2, max: 80, required: true });
      const email = cleanEmail(body.email);
      const phone = cleanPhone(body.phone);
      if (!email && !phone) throw new HttpError(400, 'invalid', 'Indica almeno un\'email o un numero di telefono');
      const mode = oneOf(body.mode || 'da_definire', ['studio', 'online', 'da_definire'], 'Modalità');
      const service = oneOf(body.service || 'da_definire', ['psicoterapia', 'coaching', 'aziende', 'da_definire'], 'Servizio');
      const preference = cleanText(body.preference, { field: 'Preferenze orarie', max: 200 });
      const message = cleanMultiline(body.message, { field: 'Messaggio', max: 600 });
      if (body.privacy !== true) throw new HttpError(400, 'privacy', 'È necessario prendere visione dell\'informativa privacy');
      await rateLimit(req, context, 'request', 5, 60);
      await store.insertRequest(vault.encrypt({ name, email, phone, preference, message }), mode, service);
      const settings = await store.getSettings();
      await notify(() => mailer.send({ to: site.notifyEmail, ...templates.studioNotice({ action: 'request', tz: settings.timezone, adminUrl }) }));
      return json(201, { ok: true });
    },
  };

  return function handle(req, context) {
    return guard(async () => {
      const key = `${req.method} ${subPath(req, '/api/public')}`;
      const route = routes[key];
      if (!route) throw new HttpError(404, 'not_found', 'Risorsa non trovata');
      return route(req, context);
    });
  };
}
