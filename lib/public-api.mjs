// Public API: catalogue (categories, services, professionals), available slots
// for one professional and service, instant booking of the first appointment,
// self-service cancel/reschedule through a personal link, call-back requests.

import { availableSlots, isSlotBookable, requestOpen } from './slots.mjs';
import { randomToken, sha256 } from './crypto.mjs';
import { templates } from './email.mjs';
import { bookingTargets, requestTargets } from './notify.mjs';
import {
  HttpError, json, readJson, subPath, clientIp, guard, contactKey,
  cleanText, cleanEmail, cleanPhone, cleanMultiline, oneOf,
} from './http.mjs';

// Version of the privacy notice shown next to the forms; saved with each booking and request.
export const PRIVACY_VERSION = '2026-11-07';

/** A name only: no links or markup, so nobody can put a message inside the studio's emails. */
function cleanName(v) {
  const name = cleanText(v, { field: 'Nome', min: 2, max: 80, required: true });
  if (/[<>{}\\]|https?:|www\.|\.(com|it|net|org|io|ru|xyz)\b/i.test(name)) throw new HttpError(400, 'invalid', 'Nome non valido');
  return name;
}

const MODES = ['studio', 'online'];
const LANGS = ['it', 'en'];
const ANY = 'any'; // "aiutami a scegliere": the system assigns a professional
const ID_RE = /^\d{1,12}$/;

/** Active catalogue with which professional offers which service in which mode. */
export async function loadCatalog(store) {
  const [categories, services, professionals, offerings] = await Promise.all([
    store.listCategories(), store.listServices({ onlyActive: true }),
    store.listProfessionals({ onlyActive: true }), store.listOfferings(),
  ]);
  const proById = new Map(professionals.map((p) => [p.id, p]));
  const publicPro = (p) => ({
    id: p.id, slug: p.slug, name: p.name, title: p.title, bio: p.bio, albo: p.albo, photo: p.photo,
    titleEn: p.title_en, bioEn: p.bio_en, languages: p.languages || ['it'],
  });
  const serviceView = (s) => {
    const pros = offerings
      .filter((o) => o.service_id === s.id && proById.has(o.professional_id))
      .map((o) => ({
        ...publicPro(proById.get(o.professional_id)),
        modes: [o.in_studio && 'studio', o.online && 'online'].filter(Boolean),
      }));
    return {
      id: s.id, slug: s.slug, name: s.name, description: s.description,
      nameEn: s.name_en, descriptionEn: s.description_en, priceEn: s.price_text_en, firstMeeting: !!s.first_meeting,
      durationMinutes: s.duration_minutes, price: s.price_text, category: s.category, professionals: pros,
    };
  };
  const svc = services.map(serviceView);
  return {
    categories: categories.filter((c) => c.active).map((c) => ({
      slug: c.slug, name: c.name, intro: c.intro, nameEn: c.name_en, introEn: c.intro_en,
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
  const manageUrl = (token, lang) => `${siteUrl}${lang === 'en' ? '/en/book/manage/' : '/prenota/gestisci/'}#t=${token}`;
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

  /** Professionals who offer the service in that mode (and speak the language, if given). */
  async function candidatesFor(serviceId, mode, lang) {
    const service = await store.getService(serviceId);
    if (!service || !service.active) throw new HttpError(404, 'not_offered', 'Questo servizio non è disponibile.');
    const [pros, offerings] = await Promise.all([store.listProfessionals({ onlyActive: true }), store.listOfferings()]);
    const offered = new Map(offerings.filter((o) => o.service_id === String(serviceId)).map((o) => [o.professional_id, o]));
    const list = pros.filter((p) => {
      const o = offered.get(p.id);
      if (!o) return false;
      if (mode === 'studio' && !o.in_studio) return false;
      if (mode === 'online' && !o.online) return false;
      return !lang || (p.languages || ['it']).includes(lang);
    });
    if (!list.length) {
      throw new HttpError(404, 'not_offered', lang === 'en'
        ? 'Nessuna professionista offre questo servizio in inglese con la modalità scelta.'
        : 'Nessuna professionista offre questo servizio con la modalità scelta.');
    }
    return { service, pros: list };
  }

  function speaks(pro, lang) {
    if (lang && !(pro.languages || ['it']).includes(lang)) {
      throw new HttpError(400, 'lang_unavailable', 'La professionista scelta non conduce colloqui in questa lingua.');
    }
  }

  function groupByDay(slots) {
    const days = new Map();
    for (const s of slots) {
      if (!days.has(s.date)) days.set(s.date, []);
      days.get(s.date).push({ start: s.start.toISOString(), time: s.time });
    }
    return [...days.entries()].map(([date, list]) => ({ date, slots: list }));
  }

  // forRequest: a new first meeting (it needs approval, so times too close to the approval deadline are left out).
  async function loadAvailability(proId, mode, duration, excludeEvent, { forRequest = false } = {}) {
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
    let slots = availableSlots({ rules, busy, settings, now: t, mode, duration });
    if (forRequest) slots = slots.filter((sl) => requestOpen(sl.start, settings, t));
    return { settings, rules, busy, t, slots };
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
    // The link only serves to move or cancel: it stops working a day after the appointment.
    if (new Date(ev.end_at).getTime() < now().getTime() - 86400000) throw new HttpError(404, 'not_found', 'Link non valido o scaduto');
    return ev;
  }

  function publicEvent(ev, settings) {
    return {
      start: new Date(ev.start_at).toISOString(),
      end: new Date(ev.end_at).toISOString(),
      mode: ev.mode,
      status: ev.status,
      professional: { id: ev.professional_id, name: ev.professional_name },
      service: ev.service_id ? { id: ev.service_id, name: (ev.lang === 'en' && ev.service_name_en) || ev.service_name } : null,
      canChange: canChange(ev, settings),
      cancelHours: settings.cancelHours,
      // Appointments set by the professional: the person confirms or cancels, but doesn't move them.
      canMove: ev.source !== 'manuale' && ev.status === 'confermato',
      pending: ev.status === 'in_attesa',
      needsConfirmation: (ev.source === 'sito' || !!ev.notify_client) && !ev.client_confirmed_at && ev.status === 'confermato' && new Date(ev.start_at) > now(),
      // "Non riesco a venire" works until the start; inside the cancellation window it counts as a late cancellation.
      canCancel: (ev.status === 'confermato' || ev.status === 'in_attesa') && new Date(ev.start_at) > now(),
      lateCancel: ev.status === 'confermato' && new Date(ev.start_at) > now() && !canChange(ev, settings),
      confirmedAt: ev.client_confirmed_at ? new Date(ev.client_confirmed_at).toISOString() : null,
    };
  }

  function refuseManual(ev) {
    if (ev.source === 'manuale') throw new HttpError(400, 'not_offered', 'Questo appuntamento è stato fissato dalla professionista: per spostarlo contatta lo studio.');
    if (ev.status === 'in_attesa') throw new HttpError(400, 'pending', 'La richiesta è in attesa di approvazione: se l\'orario non va più bene, annullala e scegline un altro.');
  }

  function parseStart(v) {
    const d = new Date(typeof v === 'string' ? v : '');
    if (Number.isNaN(d.getTime())) throw new HttpError(400, 'invalid', 'Orario non valido');
    return d;
  }

  function proNotifyTargets(ev) {
    return bookingTargets(store, ev.professional_email);
  }

  const routes = {
    'GET /catalog': async () => json(200, await loadCatalog(store), { 'cache-control': 'public, max-age=60' }),

    'GET /slots': async (req) => {
      const url = new URL(req.url);
      const serviceId = parseId(url.searchParams.get('service'), 'Servizio');
      const mode = oneOf(url.searchParams.get('mode'), MODES, 'Modalità');
      const lang = url.searchParams.get('lang') ? oneOf(url.searchParams.get('lang'), LANGS, 'Lingua') : null;
      const proParam = url.searchParams.get('professional');
      if (proParam === ANY) {
        // Union of the free times of every suitable professional.
        const { service, pros } = await candidatesFor(serviceId, mode, lang);
        const all = new Map();
        let settings;
        for (const p of pros) {
          const r = await loadAvailability(p.id, mode, service.duration_minutes, null, { forRequest: true });
          settings = r.settings;
          for (const sl of r.slots) if (!all.has(sl.start.getTime())) all.set(sl.start.getTime(), sl);
        }
        const merged = [...all.values()].sort((a, b) => a.start - b.start);
        return json(200, {
          timezone: settings.timezone, durationMinutes: service.duration_minutes, cancelHours: settings.cancelHours,
          days: groupByDay(merged),
        });
      }
      const proId = parseId(proParam, 'Professionista');
      const { service, pro } = await offering(serviceId, proId, mode);
      speaks(pro, lang);
      const { settings, slots } = await loadAvailability(proId, mode, service.duration_minutes, null, { forRequest: true });
      return json(200, {
        timezone: settings.timezone,
        durationMinutes: service.duration_minutes,
        cancelHours: settings.cancelHours,
        days: groupByDay(slots),
      });
    },

    'POST /book': async (req, context) => {
      const body = await readJson(req);
      if (body.website) throw new HttpError(400, 'invalid', 'Richiesta non valida'); // honeypot
      const mode = oneOf(body.mode, MODES, 'Modalità');
      const serviceId = parseId(body.service, 'Servizio');
      const anyPro = body.professional === ANY;
      const lang = oneOf(body.lang || 'it', LANGS, 'Lingua');
      const start = parseStart(body.start);
      const name = cleanName(body.name);
      const email = cleanEmail(body.email, { required: true });
      const phone = cleanPhone(body.phone);
      if (body.privacy !== true) throw new HttpError(400, 'privacy', 'Per prenotare è necessario prendere visione dell\'informativa privacy');

      await rateLimit(req, context, 'book', 6, 60);
      let service;
      let order; // professionals to try, in order
      if (anyPro) {
        const c = await candidatesFor(serviceId, mode, lang);
        service = c.service;
        // Share out bookings: fewest upcoming appointments first, then the studio's order.
        const load = await store.upcomingLoad(c.pros.map((p) => p.id), now());
        order = [...c.pros].sort((a, b) => (load.get(a.id) || 0) - (load.get(b.id) || 0) || a.sort - b.sort || Number(a.id) - Number(b.id));
      } else {
        const o = await offering(serviceId, parseId(body.professional, 'Professionista'), mode);
        speaks(o.pro, lang);
        service = o.service;
        order = [o.pro];
      }
      const duration = service.duration_minutes;
      let settings;
      let t;
      const contactHash = vault.lookupHash(contactKey(email));
      const token = randomToken();
      let ev = null;
      let pro = null;
      let checkedLimit = false;
      for (const candidate of order) {
        const a = await loadAvailability(candidate.id, mode, duration);
        settings = a.settings;
        t = a.t;
        if (!checkedLimit) {
          if (await store.countActiveFirstByContact(contactHash, t) >= settings.maxActivePerContact) {
            throw new HttpError(409, 'already_booked', 'Risulta già un primo colloquio in programma con questa email. Puoi spostarlo dal link ricevuto via email.');
          }
          checkedLimit = true;
        }
        if (!requestOpen(start, settings, t)) throw new HttpError(409, 'slot_unavailable', 'Questo orario è troppo vicino: scegline uno più avanti.');
        if (!isSlotBookable({ rules: a.rules, busy: a.busy, settings, now: t, mode, start, duration })) continue;
        const attempt = {
          professional_id: candidate.id, service_id: serviceId,
          kind: 'primo_colloquio', source: 'sito', mode,
          start_at: start, end_at: new Date(start.getTime() + duration * 60000),
          contact_enc: vault.encrypt({ name, email, phone }),
          contact_hash: contactHash,
          manage_token_hash: sha256(token),
          created_at: t,
          lang,
          assigned: anyPro,
          privacy_version: PRIVACY_VERSION,
          status: 'in_attesa', // the professional approves it from the agenda
        };
        try {
          await store.insertEvent(attempt);
          ev = attempt;
          pro = candidate;
          break;
        } catch (err) {
          if (err.code !== 'conflict') throw err;
          // Taken in the meantime: try the next professional (if any).
        }
      }
      if (!ev) {
        throw new HttpError(409, 'slot_unavailable', 'Questo orario non è più disponibile. Scegline un altro.');
      }
      const mailEv = { ...ev, professional_name: pro.name, service_price: service.price_text || '', service_price_en: service.price_text_en || '' };
      const s = siteFor(settings);
      await notify(() => mailer.send({ to: email, ...templates.requestReceived({ ev: mailEv, name, manageUrl: manageUrl(token, lang), tz: settings.timezone, site: s, lang }) }));
      for (const to of await proNotifyTargets({ professional_email: pro.notify_email })) {
        await notify(() => mailer.send({ to, ...templates.studioNotice({ ev: mailEv, action: 'requested', tz: settings.timezone, adminUrl }) }));
      }
      return json(201, {
        ok: true,
        booking: {
          start: ev.start_at.toISOString(), end: ev.end_at.toISOString(), mode, durationMinutes: duration,
          professional: { id: pro.id, name: pro.name }, service: { id: service.id, name: service.name },
          lang, assigned: anyPro, status: 'in_attesa', pending: true,
        },
        manageUrl: manageUrl(token, lang),
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
      refuseManual(ev);
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

    // The person confirms they'll attend (a real click on the page, never on opening the link).
    'POST /manage/confirm': async (req) => {
      const body = await readJson(req);
      const ev = await eventFromToken(body.t);
      if (ev.status !== 'confermato') throw new HttpError(409, 'not_active', 'L\'appuntamento non è più attivo');
      if (new Date(ev.start_at) <= now()) throw new HttpError(409, 'too_late', 'L\'appuntamento è già passato.');
      const first = !ev.client_confirmed_at;
      const at = await store.confirmByClient(ev.id, now());
      if (!at) throw new HttpError(409, 'not_active', 'L\'appuntamento non è più attivo');
      if (first) {
        const settings = await store.getSettings();
        for (const to of await proNotifyTargets(ev)) {
          await notify(() => mailer.send({ to, ...templates.studioNotice({ ev, action: 'confirmed', tz: settings.timezone, adminUrl }) }));
        }
      }
      return json(200, { ok: true, confirmedAt: new Date(at).toISOString() });
    },

    'POST /manage/cancel': async (req) => {
      const body = await readJson(req);
      const ev = await eventFromToken(body.t);
      const settings = await store.getSettings();
      if (!['confermato', 'in_attesa'].includes(ev.status) || new Date(ev.start_at) <= now()) {
        throw new HttpError(409, 'too_late', 'L\'appuntamento è già passato o non è più attivo.');
      }
      // Telling us is always better than not showing up: inside the window it's recorded as a late cancellation.
      const late = ev.status === 'confermato' && !canChange(ev, settings);
      await store.cancelEvent(ev.id, 'paziente', undefined, late ? 'tardivo' : null);
      const contact = vault.decrypt(ev.contact_enc) || {};
      const s = siteFor(settings);
      await notify(() => mailer.send({ to: contact.email, ...templates.cancelled({ ev, name: contact.name, tz: settings.timezone, site: s, bookUrl: ev.lang === 'en' ? `${siteUrl}/en/book/` : bookUrl, lang: ev.lang }) }));
      for (const to of await proNotifyTargets(ev)) {
        await notify(() => mailer.send({ to, ...templates.studioNotice({ ev, action: late ? 'lateCancelled' : 'cancelled', tz: settings.timezone, adminUrl }) }));
      }
      return json(200, { ok: true, late });
    },

    'POST /manage/reschedule': async (req) => {
      const body = await readJson(req);
      const ev = await eventFromToken(body.t);
      refuseManual(ev);
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
        created_at: t,
        lang: ev.lang,
        assigned: ev.assigned,
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
      await notify(() => mailer.send({ to: contact.email, ...templates.rescheduled({ ev: mailEv, name: contact.name, manageUrl: manageUrl(token, ev.lang), tz: settings.timezone, site: s, lang: ev.lang }) }));
      for (const to of await proNotifyTargets(ev)) {
        await notify(() => mailer.send({ to, ...templates.studioNotice({ ev: mailEv, action: 'rescheduled', tz: settings.timezone, adminUrl }) }));
      }
      return json(200, {
        ok: true,
        booking: { start: newEv.start_at.toISOString(), end: newEv.end_at.toISOString(), mode },
        manageUrl: manageUrl(token, ev.lang),
      });
    },

    'POST /request': async (req, context) => {
      const body = await readJson(req);
      if (body.website) throw new HttpError(400, 'invalid', 'Richiesta non valida');
      const name = cleanName(body.name);
      const email = cleanEmail(body.email);
      const phone = cleanPhone(body.phone);
      if (!email && !phone) throw new HttpError(400, 'invalid', 'Indica almeno un\'email o un numero di telefono');
      const mode = oneOf(body.mode || 'da_definire', ['studio', 'online', 'da_definire'], 'Modalità');
      const category = oneOf(body.category || 'da_definire', ['carriera', 'coaching', 'psicologia', 'psicoterapia', 'aziende', 'da_definire'], 'Area');
      const lang = body.lang ? oneOf(body.lang, LANGS, 'Lingua') : null;
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
        mode, category, professional_id: pro ? pro.id : null, lang,
        contact_hash: vault.lookupHash(contactKey(email)), privacy_version: PRIVACY_VERSION,
      });
      const settings = await store.getSettings();
      for (const to of await requestTargets(store, site, category === 'aziende' ? null : pro)) {
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
