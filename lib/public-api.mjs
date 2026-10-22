// Public API: catalogue (categories, services, professionals), available slots
// for one professional and service, instant booking of the first appointment,
// self-service cancel/reschedule through a personal link, call-back requests.

import { availableSlots, isSlotBookable } from './slots.mjs';
import { randomToken, sha256 } from './crypto.mjs';
import { templates } from './email.mjs';
import {
  HttpError, json, readJson, subPath, clientIp, guard,
  cleanText, cleanEmail, cleanPhone, cleanMultiline, oneOf,
} from './http.mjs';

const MODES = ['studio', 'online'];
const ID_RE = /^\d{1,12}$/;

/** Active catalogue with which professional offers which service in which mode. */
export async function loadCatalog(store) {
  const [categories, services, professionals, offerings] = await Promise.all([
    store.listCategories(), store.listServices({ onlyActive: true }),
    store.listProfessionals({ onlyActive: true }), store.listOfferings(),
  ]);
  const proById = new Map(professionals.map((p) => [p.id, p]));
  const publicPro = (p) => ({ id: p.id, slug: p.slug, name: p.name, title: p.title, bio: p.bio, albo: p.albo, photo: p.photo });
  const serviceView = (s) => {
    const pros = offerings
      .filter((o) => o.service_id === s.id && proById.has(o.professional_id))
      .map((o) => ({
        ...publicPro(proById.get(o.professional_id)),
        modes: [o.in_studio && 'studio', o.online && 'online'].filter(Boolean),
      }));
    return {
      id: s.id, slug: s.slug, name: s.name, description: s.description,
      durationMinutes: s.duration_minutes, price: s.price_text, category: s.category, professionals: pros,
    };
  };
  const svc = services.map(serviceView);
  return {
    categories: categories.filter((c) => c.active).map((c) => ({
      slug: c.slug, name: c.name, intro: c.intro,
      services: svc.filter((s) => s.category === c.slug),
    })),
    professionals: professionals.map((p) => ({
      ...publicPro(p),
      services: svc.filter((s) => s.professionals.some((x) => x.id === p.id)).map((s) => ({ id: s.id, name: s.name, category: s.category, slug: s.slug })),
    })),
  };
}

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

  function parseId(v, field) {
    const s = String(v ?? '');
    if (!ID_RE.test(s)) throw new HttpError(400, 'invalid', `${field} non valido`);
    return s;
  }

  /** Validate that the professional offers the service in that mode; return service + professional. */
  async function offering(serviceId, proId, mode) {
    const [service, pro, off] = await Promise.all([
      store.getService(serviceId), store.getProfessional(proId), store.getOffering(proId, serviceId),
    ]);
    if (!service || !service.active || !pro || !pro.active || !off) {
      throw new HttpError(404, 'not_offered', 'Questo servizio non è disponibile con il professionista scelto.');
    }
    if (mode && !((mode === 'studio' && off.in_studio) || (mode === 'online' && off.online))) {
      throw new HttpError(400, 'mode_unavailable', mode === 'online'
        ? 'Questo servizio non è disponibile online con il professionista scelto.'
        : 'Questo servizio non è disponibile in studio con il professionista scelto.');
    }
    return { service, pro, off };
  }

  async function loadAvailability(proId, mode, duration, excludeEvent) {
    const settings = await store.getSettings();
    const rules = await store.getRules(proId, { onlyActive: true });
    const t = now();
    const from = new Date(t.getTime() - 86400000);
    const to = new Date(t.getTime() + (settings.horizonDays + 2) * 86400000);
    let busy = await store.busyBetween(proId, from, to);
    if (excludeEvent) {
      const s0 = new Date(excludeEvent.start_at).getTime();
      const e0 = new Date(excludeEvent.end_at).getTime();
      busy = busy.filter((b) => !(new Date(b.start_at).getTime() === s0 && new Date(b.end_at).getTime() === e0));
    }
    return { settings, rules, busy, t, slots: availableSlots({ rules, busy, settings, now: t, mode, duration }) };
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
      professional: { id: ev.professional_id, name: ev.professional_name },
      service: ev.service_id ? { id: ev.service_id, name: ev.service_name } : null,
      canChange: canChange(ev, settings),
      cancelHours: settings.cancelHours,
    };
  }

  function parseStart(v) {
    const d = new Date(typeof v === 'string' ? v : '');
    if (Number.isNaN(d.getTime())) throw new HttpError(400, 'invalid', 'Orario non valido');
    return d;
  }

  function proNotifyTargets(ev) {
    return [...new Set([site.notifyEmail, ev.professional_email].filter(Boolean))];
  }

  const routes = {
    'GET /catalog': async () => json(200, await loadCatalog(store), { 'cache-control': 'public, max-age=60' }),

    'GET /slots': async (req) => {
      const url = new URL(req.url);
      const serviceId = parseId(url.searchParams.get('service'), 'Servizio');
      const proId = parseId(url.searchParams.get('professional'), 'Professionista');
      const mode = oneOf(url.searchParams.get('mode'), MODES, 'Modalità');
      const { service } = await offering(serviceId, proId, mode);
      const { settings, slots } = await loadAvailability(proId, mode, service.duration_minutes);
      const days = new Map();
      for (const s of slots) {
        if (!days.has(s.date)) days.set(s.date, []);
        days.get(s.date).push({ start: s.start.toISOString(), time: s.time });
      }
      return json(200, {
        timezone: settings.timezone,
        durationMinutes: service.duration_minutes,
        cancelHours: settings.cancelHours,
        days: [...days.entries()].map(([date, list]) => ({ date, slots: list })),
      });
    },

    'POST /book': async (req, context) => {
      const body = await readJson(req);
      if (body.website) throw new HttpError(400, 'invalid', 'Richiesta non valida'); // honeypot
      const mode = oneOf(body.mode, MODES, 'Modalità');
      const serviceId = parseId(body.service, 'Servizio');
      const proId = parseId(body.professional, 'Professionista');
      const start = parseStart(body.start);
      const name = cleanText(body.name, { field: 'Nome', min: 2, max: 80, required: true });
      const email = cleanEmail(body.email, { required: true });
      const phone = cleanPhone(body.phone);
      if (body.privacy !== true) throw new HttpError(400, 'privacy', 'Per prenotare è necessario prendere visione dell\'informativa privacy');

      const { service, pro } = await offering(serviceId, proId, mode);
      await rateLimit(req, context, 'book', 6, 60);
      const duration = service.duration_minutes;
      const { settings, rules, busy, t } = await loadAvailability(proId, mode, duration);
      if (!isSlotBookable({ rules, busy, settings, now: t, mode, start, duration })) {
        throw new HttpError(409, 'slot_unavailable', 'Questo orario non è più disponibile. Scegline un altro.');
      }
      const contactHash = vault.lookupHash(`email:${email}`);
      if (await store.countActiveFirstByContact(contactHash, t) >= settings.maxActivePerContact) {
        throw new HttpError(409, 'already_booked', 'Risulta già un primo colloquio in programma con questa email. Puoi spostarlo dal link ricevuto via email.');
      }
      const token = randomToken();
      const ev = {
        professional_id: proId, service_id: serviceId,
        kind: 'primo_colloquio', source: 'sito', mode,
        start_at: start, end_at: new Date(start.getTime() + duration * 60000),
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
      const mailEv = { ...ev, professional_name: pro.name };
      const s = siteFor(settings);
      await notify(() => mailer.send({ to: email, ...templates.confirmation({ ev: mailEv, name, manageUrl: manageUrl(token), tz: settings.timezone, site: s }) }));
      for (const to of proNotifyTargets({ professional_email: pro.notify_email })) {
        await notify(() => mailer.send({ to, ...templates.studioNotice({ ev: mailEv, action: 'booked', tz: settings.timezone, adminUrl }) }));
      }
      return json(201, {
        ok: true,
        booking: {
          start: ev.start_at.toISOString(), end: ev.end_at.toISOString(), mode, durationMinutes: duration,
          professional: { id: pro.id, name: pro.name }, service: { id: service.id, name: service.name },
        },
        manageUrl: manageUrl(token),
      });
    },

    'POST /manage': async (req) => {
      const body = await readJson(req);
      const ev = await eventFromToken(body.t);
      const settings = await store.getSettings();
      const off = ev.service_id ? await store.getOffering(ev.professional_id, ev.service_id) : null;
      const modes = off ? [off.in_studio && 'studio', off.online && 'online'].filter(Boolean) : ['studio', 'online'];
      return json(200, { booking: { ...publicEvent(ev, settings), modes } });
    },

    // Slots for moving an existing booking (same professional and service).
    'POST /manage/slots': async (req) => {
      const body = await readJson(req);
      const ev = await eventFromToken(body.t);
      const mode = oneOf(body.mode, MODES, 'Modalità');
      if (ev.service_id) await offering(ev.service_id, ev.professional_id, mode);
      const duration = Math.round((new Date(ev.end_at) - new Date(ev.start_at)) / 60000);
      const { settings, slots } = await loadAvailability(ev.professional_id, mode, duration, ev);
      const days = new Map();
      for (const s of slots) {
        if (!days.has(s.date)) days.set(s.date, []);
        days.get(s.date).push({ start: s.start.toISOString(), time: s.time });
      }
      return json(200, { timezone: settings.timezone, durationMinutes: duration, days: [...days.entries()].map(([date, list]) => ({ date, slots: list })) });
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
      for (const to of proNotifyTargets(ev)) {
        await notify(() => mailer.send({ to, ...templates.studioNotice({ ev, action: 'cancelled', tz: settings.timezone, adminUrl }) }));
      }
      return json(200, { ok: true });
    },

    'POST /manage/reschedule': async (req) => {
      const body = await readJson(req);
      const ev = await eventFromToken(body.t);
      const mode = oneOf(body.mode, MODES, 'Modalità');
      const start = parseStart(body.start);
      if (ev.service_id) await offering(ev.service_id, ev.professional_id, mode);
      const duration = Math.round((new Date(ev.end_at) - new Date(ev.start_at)) / 60000);
      const { settings, rules, busy, t } = await loadAvailability(ev.professional_id, mode, duration, ev);
      if (!canChange(ev, settings)) {
        throw new HttpError(409, 'too_late', `L'appuntamento non può più essere spostato online (meno di ${settings.cancelHours} ore). Contatta lo studio.`);
      }
      if (!isSlotBookable({ rules, busy, settings, now: t, mode, start, duration })) {
        throw new HttpError(409, 'slot_unavailable', 'Questo orario non è più disponibile. Scegline un altro.');
      }
      const token = randomToken();
      const newEv = {
        professional_id: ev.professional_id, service_id: ev.service_id,
        kind: ev.kind, source: ev.source, mode,
        start_at: start, end_at: new Date(start.getTime() + duration * 60000),
        contact_enc: ev.contact_enc, contact_hash: ev.contact_hash,
        manage_token_hash: sha256(token),
      };
      try {
        await store.sql.begin(async (tx) => {
          const [locked] = await tx`select status from events where id = ${ev.id} for update`;
          if (!locked || locked.status !== 'confermato') throw new HttpError(409, 'not_active', 'L\'appuntamento non è più attivo');
          await store.cancelEvent(ev.id, 'paziente', tx);
          await tx`update events set manage_token_hash = null where id = ${ev.id}`;
          await store.insertEvent(newEv, tx);
        });
      } catch (err) {
        if (err.code === 'conflict') throw new HttpError(409, 'slot_unavailable', 'Questo orario è appena stato prenotato. Scegline un altro.');
        throw err;
      }
      const contact = vault.decrypt(ev.contact_enc) || {};
      const mailEv = { ...newEv, professional_name: ev.professional_name };
      const s = siteFor(settings);
      await notify(() => mailer.send({ to: contact.email, ...templates.rescheduled({ ev: mailEv, name: contact.name, manageUrl: manageUrl(token), tz: settings.timezone, site: s }) }));
      for (const to of proNotifyTargets(ev)) {
        await notify(() => mailer.send({ to, ...templates.studioNotice({ ev: mailEv, action: 'rescheduled', tz: settings.timezone, adminUrl }) }));
      }
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
      const category = oneOf(body.category || 'da_definire', ['coaching', 'psicologia', 'psicoterapia', 'aziende', 'da_definire'], 'Area');
      const preference = cleanText(body.preference, { field: 'Preferenze orarie', max: 200 });
      const organization = cleanText(body.organization, { field: 'Organizzazione', max: 120 });
      const message = cleanMultiline(body.message, { field: 'Messaggio', max: 600 });
      if (body.privacy !== true) throw new HttpError(400, 'privacy', 'È necessario prendere visione dell\'informativa privacy');
      let pro = null;
      if (body.professional) {
        pro = await store.getProfessional(parseId(body.professional, 'Professionista'));
        if (!pro || !pro.active) pro = null;
      }
      await rateLimit(req, context, 'request', 5, 60);
      await store.insertRequest({
        contact_enc: vault.encrypt({ name, email, phone, preference, message, ...(organization ? { organization } : {}) }),
        mode, category, professional_id: pro ? pro.id : null,
      });
      const settings = await store.getSettings();
      for (const to of [...new Set([site.notifyEmail, pro && pro.notify_email].filter(Boolean))]) {
        await notify(() => mailer.send({ to, ...templates.studioNotice({ action: 'request', tz: settings.timezone, adminUrl }) }));
      }
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
