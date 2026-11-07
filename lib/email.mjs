// Transactional email. Content is deliberately neutral: no clinical details,
// no reason for the visit. Provider: Brevo (EU servers), chosen by the studio (research 17).
// Without a configured provider emails are skipped: bookings stay valid anyway.
// Every email carries its type as a Brevo tag: sends are counted here, deliveries and bounces
// by the webhook (never opens or clicks, never addresses).

import { formatItalian, formatEnglish } from './time.mjs';
import { EMAIL_BY_KEY, checkText, renderText } from './email-texts.mjs';


// texts: { get(key, lang) } returns the override saved from the admin, if any (see email-texts.mjs).
export function createMailer(env = process.env, fetchImpl = globalThis.fetch, stats = null, texts = null) {
  const provider = (env.EMAIL_PROVIDER || '').toLowerCase();
  const from = env.EMAIL_FROM || '';
  const fromName = env.EMAIL_FROM_NAME || 'Blooming';
  const sent = [];

  const count = (type, lang, field) => (stats ? stats.bumpEmail(new Date(), type || 'altro', lang || '', field).catch(() => {}) : null);

  // The texts edited in the admin replace the default just before sending; a broken override never blocks an email.
  async function withOverride(msg) {
    if (!msg.tpl || !texts) return msg;
    try {
      const row = await texts.get(msg.tpl.key, msg.tpl.lang);
      return row ? { ...msg, ...renderOverride(msg.tpl, row) } : msg;
    } catch (err) {
      console.warn(`testo email personalizzato non valido (${msg.tpl.key}/${msg.tpl.lang}), uso quello originale: ${err.message}`);
      return msg;
    }
  }

  async function send(msg) {
    const { to, subject, text, html, type = 'altro', lang = '' } = await withOverride(msg);
    if (!to) return { skipped: 'no-recipient' };
    if (provider === 'test') { sent.push({ to, subject, text, html, type, lang }); await count(type, lang, 'sent'); return { ok: true }; }
    if (!provider || !from) return { skipped: 'no-provider' };
    if (provider !== 'brevo') return { skipped: 'unknown-provider' };
    let res;
    try {
      res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.EMAIL_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: from, name: fromName }, to: [{ email: to }], subject, textContent: text, htmlContent: html,
          // Type and language only: the webhook counts deliveries per type. No tracking pixel, no tracked links.
          tags: [type, `lang-${lang || 'it'}`],
        }),
      });
    } catch (err) {
      await count(type, lang, 'api_errors');
      throw err;
    }
    if (!res.ok) { await count(type, lang, 'api_errors'); throw new Error(`invio email non riuscito (${res.status})`); }
    await count(type, lang, 'sent');
    return { ok: true };
  }

  return { send, sent };
}

// Words and labels used inside the values (the texts themselves are in email-texts.mjs).
// Patient emails are written in the language of the booking (ev.lang): Italian by default,
// British English for bookings made on the English site.
const L = {
  it: {
    date: formatItalian,
    emergency: 'Questa email e il sistema di prenotazione non sono servizi di emergenza. In caso di pericolo immediato chiama il 112 o il 118.',
    when: 'Quando', length: 'Durata', minutes: 'minuti', with: 'Con', mode: 'Modalità', address: 'Indirizzo',
    anyPro: 'una delle nostre professioniste',
    modes: { studio: 'in studio', online: 'online' },
    onlineNote: 'Riceverai le istruzioni per il collegamento prima dell\'appuntamento.',
    fee: 'Tariffa', first: 'colloquio', session: 'appuntamento', free: 'Gratuito',
  },
  en: {
    date: formatEnglish,
    emergency: 'Blooming isn\'t an emergency service. If you or someone else is in danger, call 112 or 118.',
    when: 'When', length: 'Length', minutes: 'minutes', with: 'With', mode: 'Format', address: 'Address',
    anyPro: 'one of our psychologists',
    modes: { studio: 'in person', online: 'online, by video call' },
    onlineNote: 'You\'ll receive the details for joining the call before the appointment.',
    fee: 'Fee', first: 'meeting', session: 'session', free: 'Free',
  },
};
const langOf = (lang, ev) => ((lang || (ev && ev.lang)) === 'en' ? 'en' : 'it');
const firstName = (ev) => (ev && ev.professional_name ? String(ev.professional_name).split(' ')[0] : null);
// Before acceptance a "help me choose" request may still pass to the colleague: don't name anyone.
const proOf = (ev) => (ev && ev.assigned && ev.status === 'in_attesa' ? null : firstName(ev));
const isFirst = (ev) => !!ev && ev.kind === 'primo_colloquio';

function details(ev, tz, site, t) {
  const lines = [
    `${t.when}: ${t.date(new Date(ev.start_at), tz)}`,
    `${t.length}: ${Math.round((new Date(ev.end_at) - new Date(ev.start_at)) / 60000)} ${t.minutes}`,
  ];
  if (ev.professional_name) lines.push(`${t.with}: ${proOf(ev) === null ? t.anyPro : ev.professional_name}`);
  if (ev.mode) lines.push(`${t.mode}: ${t.modes[ev.mode]}`);
  if (ev.mode === 'studio' && site.address) lines.push(`${t.address}: ${site.address}`);
  if (ev.mode === 'online') lines.push(t.onlineNote);
  return lines;
}

const brand = (site) => site.brandName || 'Blooming';

/** Values for an email to the person about an appointment. */
function personValues({ ev, name, tz, site, code, link = null, ...extra }) {
  const t = L[code];
  return {
    nome: name || '', data: t.date(new Date(ev.start_at), tz), dettagli: details(ev, tz, site, t),
    professionista: firstName(ev), tipo: isFirst(ev) ? t.first : t.session,
    ore: site.cancelHours ?? '', tariffa: '', link, ...extra,
  };
}

function optsFor(def, code, site) {
  return def.audience === 'persona'
    ? { brand: brand(site), footer: [L[code].emergency, site.professionalName] }
    : { brand: 'Blooming', footer: [] };
}

// Rendered with the default text; the mailer swaps in the override saved from the admin (see `tpl`).
function build(key, code, v, site = {}) {
  const def = EMAIL_BY_KEY[key];
  const lang = def.langs.includes(code) ? code : 'it';
  const opts = optsFor(def, lang, site);
  return { ...renderText(def, lang, def.defaults[lang], v, opts), tpl: { key, lang, v, opts } };
}

/** An override from the database, checked again (rules may have changed since it was saved). Throws if invalid. */
export function renderOverride(tpl, row) {
  const def = EMAIL_BY_KEY[tpl.key];
  const txt = checkText(def, tpl.lang, { subject: row.subject, body: row.body, button: row.button });
  return renderText(def, tpl.lang, txt, tpl.v, tpl.opts);
}

/** Sample values for the preview in the admin. */
export function sampleValues(def, lang, site = {}) {
  const t = L[lang] || L.it;
  const base = String(site.siteUrl || 'https://www.example.it').replace(/\/$/, '');
  const d = new Date(); d.setUTCDate(d.getUTCDate() + ((9 - d.getUTCDay()) % 7 || 7)); d.setUTCHours(14, 0, 0, 0);
  const minutes = def.kind === 'seduta' ? 50 : 30;
  if (def.audience === 'studio') {
    const later = new Date(d.getTime() + 2 * 3600000);
    return { data: formatItalian(d, 'Europe/Rome'), numero: 2, elenco: [d, later].map((x) => `• ${formatItalian(x, 'Europe/Rome')}`), link: `${base}/admin/` };
  }
  const ev = { start_at: d, end_at: new Date(d.getTime() + minutes * 60000), kind: def.kind === 'seduta' ? 'seduta' : 'primo_colloquio', mode: 'online', professional_name: 'Elsa Salvati', status: 'confermato' };
  const link = def.link === 'book' ? `${base}${lang === 'en' ? '/en/book/' : '/prenota/'}` : `${base}${lang === 'en' ? '/en/book/manage/' : '/prenota/gestisci/'}#t=esempio`;
  return personValues({ ev, name: 'Anna', tz: 'Europe/Rome', site: { cancelHours: 24, ...site }, code: lang === 'en' ? 'en' : 'it', link, tariffa: def.vars.includes('tariffa') ? `${t.fee}: ${t.free}` : '' });
}

/** Preview of a text being edited (checked first: throws a RangeError with the problem). */
export function previewEmail(key, lang, input, site = {}) {
  const def = EMAIL_BY_KEY[key];
  const txt = checkText(def, lang, input);
  return renderText(def, lang, txt, sampleValues(def, lang, site), optsFor(def, lang, site));
}

const rawTemplates = {
  // An appointment booked by the professional, sent only when the person agreed to receive emails.
  confirmation({ ev, name, manageUrl, tz, site, lang }) {
    const code = langOf(lang, ev);
    const price = code === 'en' ? (ev.service_price_en || ev.service_price || site.priceTextEn) : (ev.service_price || site.priceText);
    return build('fissato', code, personValues({ ev, name, tz, site, code, link: manageUrl, tariffa: isFirst(ev) && price ? `${L[code].fee}: ${price}` : '' }), site);
  },
  rescheduled({ ev, name, manageUrl, tz, site, lang }) {
    const code = langOf(lang, ev);
    return build(isFirst(ev) ? 'spostato-primo' : 'spostato-seduta', code, personValues({ ev, name, tz, site, code, link: manageUrl }), site);
  },
  cancelled({ ev, name, tz, site, bookUrl, lang }) {
    const code = langOf(lang, ev);
    const key = ev.status === 'in_attesa' ? 'annullato-richiesta' : (isFirst(ev) ? 'annullato-primo' : 'annullato-seduta');
    return build(key, code, personValues({ ev, name, tz, site, code, link: bookUrl }), site);
  },
  // Appointments entered by hand without the management emails: information only.
  reminder({ ev, name, tz, site, lang }) {
    const code = langOf(lang, ev);
    return build('promemoria', code, personValues({ ev, name, tz, site, code }), site);
  },
  // About two days before (nudge: the day before, only if not confirmed yet): please confirm you're coming (new personal link).
  reminderConfirm({ ev, name, manageUrl, tz, site, lang, nudge = false }) {
    const code = langOf(lang, ev);
    return build(nudge ? 'conferma-24h' : 'conferma-48h', code, personValues({ ev, name, tz, site, code, link: manageUrl }), site);
  },
  // Request received (first meeting requested on the website, waiting for the professional to accept it).
  requestReceived({ ev, name, manageUrl, tz, site, lang }) {
    const code = langOf(lang, ev);
    const view = { ...ev, status: ev.status || 'in_attesa' };
    return build('richiesta-ricevuta', code, personValues({ ev: view, name, tz, site, code, link: manageUrl, professionista: proOf(view) }), site);
  },
  // A new request from an address that already has a first meeting: the details of the one in place.
  alreadyBooked({ ev, name, manageUrl, tz, site, lang }) {
    const code = langOf(lang, ev);
    return build('richiesta-doppia', code, personValues({ ev, name, tz, site, code, link: manageUrl, professionista: proOf(ev) }), site);
  },
  // askConfirm: the appointment is already close (inside the confirmation window), so this email also asks to confirm.
  approved({ ev, name, manageUrl, tz, site, lang, askConfirm = false }) {
    const code = langOf(lang, ev);
    const price = code === 'en' ? (ev.service_price_en || ev.service_price) : ev.service_price;
    return build(askConfirm ? 'richiesta-accettata-conferma' : 'richiesta-accettata', code,
      personValues({ ev, name, tz, site, code, link: manageUrl, tariffa: price ? `${L[code].fee}: ${price}` : '' }), site);
  },
  declined({ ev, name, tz, site, bookUrl, lang, expired = false }) {
    const code = langOf(lang, ev);
    return build(expired ? 'richiesta-scaduta' : 'richiesta-rifiutata', code,
      personValues({ ev, name, tz, site, code, link: bookUrl, professionista: ev.assigned ? null : firstName(ev) }), site);
  },
  // A couple of hours before: information only, nothing to click.
  reminderSoon({ ev, name, tz, site, lang }) {
    const code = langOf(lang, ev);
    return build('promemoria-2h', code, personValues({ ev, name, tz, site, code }), site);
  },
  // The professional cancelled, or freed the time because attendance wasn't confirmed: the person always
  // learns what happened and what to do if it was a mistake.
  cancelledByStudio({ ev, name, tz, site, bookUrl, lang, unconfirmed = false }) {
    const code = langOf(lang, ev);
    const kind = isFirst(ev) ? 'primo' : 'seduta';
    return build(`${unconfirmed ? 'liberato' : 'annullato-studio'}-${kind}`, code, personValues({ ev, name, tz, site, code, link: kind === 'primo' ? bookUrl : null }), site);
  },
  // To the professionals: no personal data, only day, time and a pointer to the protected agenda.
  // 18:00 the day before: the professional's list of tomorrow's appointments not confirmed yet.
  unconfirmedNotice({ list, tz, adminUrl }) {
    return build('studio-non-confermati', 'it', { numero: list.length, elenco: list.map((ev) => `• ${formatItalian(new Date(ev.start_at), tz)}`), link: adminUrl });
  },
  studioNotice({ ev, action, tz, adminUrl }) {
    const key = {
      requested: ev && ev.assigned ? 'studio-richiesta-assegnata' : 'studio-richiesta',
      reassigned: 'studio-passata', expired: 'studio-scaduta', booked: 'studio-prenotato',
      confirmed: 'studio-confermato', cancelled: 'studio-annullato', lateCancelled: 'studio-annullato-tardi',
      rescheduled: 'studio-spostato', request: 'studio-ricontatto',
    }[action];
    return build(key, 'it', { data: ev ? formatItalian(new Date(ev.start_at), tz) : '', link: adminUrl });
  },
};

// The type of each email (counted in the statistics) and the same type on the person's links (`&e=`),
// so an action from a link (confirm, cancel, move) is counted for the email it came from.
const TYPE_OF = {
  confirmation: () => 'fissato',
  rescheduled: () => 'spostato',
  cancelled: () => 'disdetta',
  reminder: () => 'promemoria',
  reminderConfirm: (a) => (a.nudge ? 'conferma-2' : 'conferma'),
  requestReceived: () => 'richiesta-ricevuta',
  alreadyBooked: () => 'richiesta-doppia',
  approved: () => 'accettata',
  declined: (a) => (a.expired ? 'scaduta' : 'rifiutata'),
  reminderSoon: () => 'promemoria-2h',
  cancelledByStudio: (a) => (a.unconfirmed ? 'liberato' : 'annullato-studio'),
  unconfirmedNotice: () => 'studio-non-confermati',
  studioNotice: () => 'studio-avviso',
};
export const templates = Object.fromEntries(Object.entries(rawTemplates).map(([key, fn]) => [key, (args = {}) => {
  const type = (TYPE_OF[key] || (() => 'altro'))(args);
  const manageUrl = args.manageUrl ? `${args.manageUrl}${args.manageUrl.includes('#') ? '&' : '#'}e=${type}` : args.manageUrl;
  return { ...fn({ ...args, manageUrl }), type, lang: args.lang === 'en' ? 'en' : (args.ev || args.lang ? 'it' : '') };
}]));
