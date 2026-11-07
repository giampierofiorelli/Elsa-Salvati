// Transactional email. Content is deliberately neutral: no clinical details,
// no reason for the visit. Providers: Brevo (EU servers) or Resend.
// Without a configured provider emails are skipped: bookings stay valid anyway.

import { formatItalian, formatEnglish } from './time.mjs';


export function createMailer(env = process.env, fetchImpl = globalThis.fetch) {
  const provider = (env.EMAIL_PROVIDER || '').toLowerCase();
  const from = env.EMAIL_FROM || '';
  const fromName = env.EMAIL_FROM_NAME || 'Blooming';
  const sent = [];

  async function send({ to, subject, text, html }) {
    if (!to) return { skipped: 'no-recipient' };
    if (provider === 'test') { sent.push({ to, subject, text, html }); return { ok: true }; }
    if (!provider || !from) return { skipped: 'no-provider' };
    let res;
    if (provider === 'brevo') {
      res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.EMAIL_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: from, name: fromName }, to: [{ email: to }], subject, textContent: text, htmlContent: html,
        }),
      });
    } else if (provider === 'resend') {
      res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, text, html }),
      });
    } else {
      return { skipped: 'unknown-provider' };
    }
    if (!res.ok) throw new Error(`invio email non riuscito (${res.status})`);
    return { ok: true };
  }

  return { send, sent };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wrap(lines, { linkLabel, linkUrl } = {}) {
  const text = [...lines, linkUrl ? `\n${linkLabel}: ${linkUrl}` : ''].join('\n').trim();
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.55;color:#183B38;max-width:560px">
${lines.map((l) => (l ? `<p style="margin:0 0 12px">${escapeHtml(l)}</p>` : '')).join('\n')}
${linkUrl ? `<p style="margin:20px 0"><a href="${escapeHtml(linkUrl)}" style="background:#205A54;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;display:inline-block">${escapeHtml(linkLabel)}</a></p>` : ''}
</div>`;
  return { text, html };
}

// Patient emails are written in the language of the booking (ev.lang): Italian
// by default, British English for bookings made on the English site.
// Texts: testi-prenotazione-catalogo-IT-v2 §6/§6b and -EN-v2 §8 (drafts for the client to review).
// A value can be a string or a function: arguments are listed where it is used (see `say`).
// p = the psychologist's first name (null for a "help me choose" request still waiting); m = meeting/session.
const L = {
  it: {
    date: formatItalian,
    emergency: 'Questa email e il sistema di prenotazione non sono servizi di emergenza. In caso di pericolo immediato chiama il 112 o il 118.',
    when: 'Quando', length: 'Durata', minutes: 'minuti', with: 'Con', mode: 'Modalità', address: 'Indirizzo',
    anyPro: 'una delle nostre professioniste',
    modes: { studio: 'in studio', online: 'online' },
    onlineNote: 'Riceverai le istruzioni per il collegamento prima dell\'appuntamento.',
    dear: (n) => `Gentile ${n},`,
    confirmedFirst: 'il tuo primo colloquio è fissato.', confirmed: 'la tua professionista ha fissato un appuntamento.',
    fee: 'Tariffa',
    canManage: (h) => `Puoi annullare o spostare il colloquio dal link qui sotto fino a ${h} ore prima.`,
    contactToChange: 'Per spostare o annullare l\'appuntamento contatta lo studio.',
    manage: 'Gestisci l\'appuntamento', manageSession: 'Gestisci l\'appuntamento',
    subjConfirmed: 'Appuntamento fissato', subjMoved: 'Appuntamento spostato', subjCancelled: 'Appuntamento annullato', subjReminder: 'Promemoria',
    moved: 'il tuo appuntamento è stato spostato. Ecco il nuovo orario.',
    movedManage: '',
    movedReplaces: 'Il link qui sotto sostituisce quelli ricevuti prima.',
    cancelled: (d, pending) => (pending ? `la tua richiesta di ${d} è annullata, come ci hai chiesto.` : `l'appuntamento di ${d} è annullato, come ci hai chiesto.`),
    rebook: 'Se vuoi, puoi prenotare un altro orario dal sito.', rebookLink: 'Prenota un altro orario', rebookAlways: true,
    pickLink: 'Scegli un altro orario',
    reminder: 'ti ricordo il nostro appuntamento.',
    reminderChange: 'Se devi annullarlo, usa il link dell\'ultima email ricevuta oppure rispondi a questa email.',
    canCancel: (h) => `Puoi annullarlo dal link qui sotto fino a ${h} ore prima; per spostarlo scrivi alla tua professionista.`,
    willAskConfirm: 'Due giorni prima ti chiediamo di confermare la presenza.',
    subjConfirmAsk: 'Conferma la presenza',
    confirmAsk: 'tra due giorni c\'è il nostro appuntamento: ci sarai? Basta un clic. Se non riesci a venire, dalla stessa pagina puoi dircelo.',
    confirmCantCome: '',
    confirmReplaces: 'Il link in questa email sostituisce quelli ricevuti prima.',
    confirmCta: 'Confermo',
    nudge: 'ti scriviamo di nuovo per sapere se domani ci sarai: basta un clic. Se non riesci a venire, dalla stessa pagina puoi dircelo.',
    nudgeCantCome: '',
    subjNudge: 'Ci sarai?',
    subjCancelledByStudio: 'Appuntamento annullato',
    cancelledByStudio: (d) => `la professionista ha dovuto annullare l'appuntamento di ${d}. Ci dispiace.`,
    freedUnconfirmed: (d) => `non avendo ricevuto la tua conferma, l'orario di ${d} è stato liberato.`,
    whatToDoFirst: 'Se non avevi confermato per errore e vuoi venire, rispondi a questa email o chiamaci: se l\'orario è ancora libero lo rimettiamo per te. Altrimenti puoi sceglierne un altro dal sito.',
    whatToDoSession: 'Se non avevi confermato per errore e vuoi venire, rispondi a questa email o scrivi alla tua professionista: se l\'orario è ancora libero lo rimette per te, altrimenti ne fissate un altro.',
    whatToDoGeneric: 'Per fissare un altro orario rispondi a questa email o contatta lo studio.',
    whatToDoGenericFirst: 'Per fissare un altro orario rispondi a questa email o contatta lo studio. Se vuoi, puoi prenotare un altro orario dal sito.',
    subjSoon: 'Tra poco il tuo appuntamento',
    soon: 'ti ricordo che il nostro appuntamento è tra poco.',
    soonCantCome: 'Se non riesci a esserci, rispondi a questa email o contatta lo studio.',
    subjRequest: 'Richiesta ricevuta',
    requestReceived: 'abbiamo ricevuto la tua richiesta di primo colloquio.',
    requestNext: 'L\'orario resta riservato per te finché la professionista risponde: ti scriviamo appena la accetta.',
    cancelRequestHint: '',
    spamHint: '',
    cancelRequest: 'Annulla la richiesta',
    subjApproved: 'Richiesta accettata',
    approved: 'la professionista ha accettato la tua richiesta: il primo colloquio è fissato.',
    confirmAskSoon: 'Ci sarai? Conferma la presenza con un clic. Se non riesci a venire, dalla stessa pagina puoi dircelo.',
    approvedConfirmManage: '',
    willAskConfirmDay: 'Due giorni prima ti chiediamo di confermare la presenza.',
    subjApprovedConfirm: 'Richiesta accettata: conferma la presenza',
    subjDeclined: 'Scegli un altro orario',
    declined: 'la professionista non è disponibile nell\'orario che avevi chiesto.',
    expired: 'la professionista non è riuscita a rispondere in tempo, quindi l\'orario non è più riservato.',
    declinedWhen: true,
    pickAnother: 'Puoi sceglierne un altro dal sito.',
  },
  en: {
    date: formatEnglish,
    emergency: 'Blooming isn\'t an emergency service. If you or someone else is in danger, call 112 or 118.',
    when: 'When', length: 'Length', minutes: 'minutes', with: 'With', mode: 'Format', address: 'Address',
    anyPro: 'one of our psychologists',
    modes: { studio: 'in person', online: 'online, by video call' },
    onlineNote: 'You\'ll receive the details for joining the call before the appointment.',
    dear: (n) => `Dear ${n},`,
    confirmedFirst: 'Your free first meeting is booked:',
    confirmed: (p) => `As you agreed, ${p || 'your psychologist'} has booked your next session:`,
    fee: 'Fee',
    canManage: (h) => `You can move or cancel the meeting here, up to ${h} hours before.`,
    contactToChange: 'To move or cancel the appointment, please contact the practice.',
    manage: 'Move or cancel', manageSession: 'Cancel',
    subjConfirmed: 'Your session', subjMoved: (first) => (first ? 'Meeting moved' : 'Session moved'),
    subjCancelled: (first, pending) => (pending ? 'Your request' : 'Cancelled'), subjReminder: 'Reminder',
    moved: (first) => (first ? 'Your free first meeting has been moved to:' : 'Your session has been moved to:'),
    movedManage: (h, first) => (first ? `You can move or cancel it again here, up to ${h} hours before.` : ''),
    movedReplaces: 'From now on, please use the link in this email: the links in our earlier emails no longer work.',
    cancelled: (d, pending, m) => (pending ? `You've cancelled your request for ${d}. The time is free again.` : `Your ${m} on ${d} has been cancelled, as you asked.`),
    rebook: (first, p) => (first ? 'If you\'d like another time, you can choose one here:' : `For a new time, please contact ${p || 'your psychologist'}.`),
    rebookLink: 'Choose another time', rebookAlways: false,
    pickLink: 'Choose another time',
    reminder: 'Just a reminder of your upcoming appointment.',
    reminderChange: 'If you need to cancel it, please use the link in our most recent email, or contact the practice.',
    canCancel: (h, p) => `If you need to cancel it, you can do it here. To move it to another time, please contact ${p || 'your psychologist'}.`,
    willAskConfirm: 'About two days before, we\'ll email you to ask you to confirm you\'re coming.',
    subjConfirmAsk: (m) => `Please confirm your ${m}`,
    confirmAsk: (p, m) => `Your ${m} with ${p || 'your psychologist'} is coming up. Please let us know you're coming. One click on our website is enough.`,
    confirmCantCome: 'If you can\'t make it, the same page has an "I can\'t make it" link, so the time can go to someone else.',
    confirmReplaces: 'From now on, please use the link in this email: the links in our earlier emails no longer work.',
    confirmCta: 'Confirm I\'m coming',
    nudge: (p, m) => `Just checking in: your ${m} with ${p || 'your psychologist'} is tomorrow. If you're coming, a click here lets her know.`,
    nudgeCantCome: 'If your plans have changed, that\'s fine: use "I can\'t make it" on the same page.',
    subjNudge: (m) => `Your ${m} tomorrow`,
    subjCancelledByStudio: (m) => `About your ${m}`,
    cancelledByStudio: (d, p, m) => `${p || 'Your psychologist'} has cancelled your ${m} on ${d}.`,
    freedUnconfirmed: (d, p, m) => `We hadn't heard back from you about your ${m} on ${d}, so the time has been freed.`,
    whatToDoFirst: 'If that was a mistake and you\'d like to come, please call us: if the time is still free, we\'ll put it back for you. If it isn\'t, or you\'d rather change it, you can choose another time here:',
    whatToDoSession: (p) => `If that was a mistake and you'd like to come, please call us: if the time is still free, we'll put it back for you. If it isn't, please contact ${p || 'your psychologist'} for a new time.`,
    whatToDoGeneric: (p) => `Please contact ${p || 'your psychologist'} for a new time.`,
    whatToDoGenericFirst: 'If you\'d like another time, you can choose one here:',
    subjSoon: 'See you soon',
    soon: (p, m) => `Just a reminder that your ${m} with ${p || 'your psychologist'} is today, online, by video call.`,
    soonCantCome: 'If you can\'t make it, please call or message us.',
    subjRequest: 'Request received',
    requestReceived: 'Thank you for your request for a free first meeting.',
    requestNext: (p) => `We're holding this time for you. ${p || 'The psychologist'} will reply by 6 pm (Italian time) the day before at the latest, and we'll email you as soon as she accepts. If she hasn't by then, the request expires and we'll let you know.`,
    cancelRequestHint: 'Changed your mind? You can cancel the request here.',
    spamHint: 'If you can\'t find our next email, please check your spam folder.',
    cancelRequest: 'Cancel the request',
    subjApproved: 'Request accepted',
    approved: (p) => `${p || 'The psychologist'} has accepted your request. Your free first meeting is booked:`,
    confirmAskSoon: 'As it\'s soon, please let us know now that you\'re coming.',
    approvedConfirmManage: (h) => `The same page lets you move or cancel the meeting up to ${h} hours before, and after that has an "I can't make it" link.`,
    willAskConfirmDay: 'About two days before, we\'ll email you to ask you to confirm you\'re coming.',
    subjApprovedConfirm: 'Request accepted: please confirm you\'re coming',
    subjDeclined: 'About your request',
    declined: (p, d) => `Thank you for your request. Unfortunately ${p || 'the psychologist'} can't make ${d}.`,
    expired: (p, d) => `${p || 'The psychologist'} wasn't able to reply to your request in time, so ${d} is no longer held for you. Sorry about that.`,
    declinedWhen: false,
    pickAnother: (expired) => (expired ? 'You can choose another time here:' : 'You\'re welcome to choose another time:'),
  },
};
const pick = (lang, ev) => L[lang || (ev && ev.lang)] || L.it;
// A table value is a string or a function of the given arguments.
const say = (v, ...args) => (typeof v === 'function' ? v(...args) : v);
const firstName = (ev) => (ev && ev.professional_name ? String(ev.professional_name).split(' ')[0] : null);
// Before acceptance a "help me choose" request may still pass to the colleague: don't name anyone.
const proOf = (ev) => (ev && ev.assigned && ev.status === 'in_attesa' ? null : firstName(ev));
const meetingOf = (ev, lang) => (lang === 'en' || (ev && ev.lang === 'en')
  ? (ev && ev.kind === 'primo_colloquio' ? 'meeting' : 'session')
  : (ev && ev.kind === 'primo_colloquio' ? 'colloquio' : 'appuntamento'));

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

export const templates = {
  confirmation({ ev, name, manageUrl, tz, site, lang, manual = false }) {
    const t = pick(lang, ev);
    const first = ev.kind === 'primo_colloquio';
    const price = t === L.en ? (ev.service_price_en || ev.service_price || site.priceTextEn) : (ev.service_price || site.priceText);
    return {
      subject: `${say(first && !manual ? t.subjApproved : t.subjConfirmed)} – ${brand(site)}`,
      ...wrap([
        t.dear(name),
        first ? t.confirmedFirst : say(t.confirmed, firstName(ev)),
        ...details(ev, tz, site, t),
        first && price ? `${t.fee}: ${price}` : '',
        manageUrl ? (manual ? say(t.canCancel, site.cancelHours, firstName(ev)) : say(t.canManage, site.cancelHours)) : t.contactToChange,
        manual && manageUrl ? t.willAskConfirm : '',
        t.emergency,
        site.professionalName,
      ], manageUrl ? { linkLabel: manual ? t.manageSession : t.manage, linkUrl: manageUrl } : {}),
    };
  },
  rescheduled({ ev, name, manageUrl, tz, site, lang }) {
    const t = pick(lang, ev);
    const first = ev.kind === 'primo_colloquio';
    return {
      subject: `${say(t.subjMoved, first)} – ${brand(site)}`,
      ...wrap([t.dear(name), say(t.moved, first), ...details(ev, tz, site, t), say(t.movedManage, site.cancelHours, first),
        manageUrl ? t.movedReplaces : '', t.emergency, site.professionalName],
      { linkLabel: first ? t.manage : t.manageSession, linkUrl: manageUrl }),
    };
  },
  cancelled({ ev, name, tz, site, bookUrl, lang }) {
    const t = pick(lang, ev);
    const first = ev.kind === 'primo_colloquio';
    const pending = ev.status === 'in_attesa';
    const link = first || pending || t.rebookAlways;
    return {
      subject: `${say(t.subjCancelled, first, pending)} – ${brand(site)}`,
      ...wrap([t.dear(name), say(t.cancelled, t.date(new Date(ev.start_at), tz), pending, meetingOf(ev, lang)),
        say(t.rebook, first || pending, firstName(ev)), t.emergency, site.professionalName],
      link ? { linkLabel: t.rebookLink, linkUrl: bookUrl } : {}),
    };
  },
  reminder({ ev, name, manageUrl, tz, site, lang }) {
    const t = pick(lang, ev);
    return {
      subject: `${say(t.subjReminder)} – ${brand(site)}`,
      ...wrap([t.dear(name), t.reminder, ...details(ev, tz, site, t), manageUrl ? '' : t.reminderChange, t.emergency, site.professionalName],
        manageUrl ? { linkLabel: t.manage, linkUrl: manageUrl } : {}),
    };
  },
  // About two days before (nudge: the day before, only if not confirmed yet): please confirm you're coming (new personal link).
  reminderConfirm({ ev, name, manageUrl, tz, site, lang, nudge = false }) {
    const t = pick(lang, ev);
    const m = meetingOf(ev, lang);
    return {
      subject: `${nudge ? say(t.subjNudge, m) : say(t.subjConfirmAsk, m)} – ${brand(site)}`,
      ...wrap([t.dear(name), nudge ? say(t.nudge, firstName(ev), m) : say(t.confirmAsk, firstName(ev), m), ...details(ev, tz, site, t),
        nudge ? t.nudgeCantCome : t.confirmCantCome, t.confirmReplaces, t.emergency, site.professionalName],
      { linkLabel: t.confirmCta, linkUrl: manageUrl }),
    };
  },
  // Request received (first meeting requested on the website, waiting for the professional to accept it).
  requestReceived({ ev, name, manageUrl, tz, site, lang }) {
    const t = pick(lang, ev);
    const view = { ...ev, status: ev.status || 'in_attesa' };
    return {
      subject: `${say(t.subjRequest)} – ${brand(site)}`,
      ...wrap([t.dear(name), t.requestReceived, ...details(view, tz, site, t), say(t.requestNext, proOf(view)), t.spamHint, t.cancelRequestHint, t.emergency, site.professionalName],
        { linkLabel: t.cancelRequest, linkUrl: manageUrl }),
    };
  },
  // askConfirm: the appointment is already close (inside the confirmation window), so this email also asks to confirm.
  approved({ ev, name, manageUrl, tz, site, lang, askConfirm = false }) {
    const t = pick(lang, ev);
    const price = t === L.en ? (ev.service_price_en || ev.service_price) : ev.service_price;
    return {
      subject: `${askConfirm ? say(t.subjApprovedConfirm) : say(t.subjApproved)} – ${brand(site)}`,
      ...wrap([t.dear(name), say(t.approved, firstName(ev)), ...details(ev, tz, site, t), price ? `${t.fee}: ${price}` : '',
        askConfirm ? t.confirmAskSoon : t.willAskConfirmDay,
        askConfirm ? say(t.approvedConfirmManage, site.cancelHours) : say(t.canManage, site.cancelHours),
        t.emergency, site.professionalName],
      askConfirm ? { linkLabel: t.confirmCta, linkUrl: manageUrl } : { linkLabel: t.manage, linkUrl: manageUrl }),
    };
  },
  declined({ ev, name, tz, site, bookUrl, lang, expired = false }) {
    const t = pick(lang, ev);
    const d = t.date(new Date(ev.start_at), tz);
    const p = ev.assigned ? null : firstName(ev);
    return {
      subject: `${say(t.subjDeclined)} – ${brand(site)}`,
      ...wrap([t.dear(name), say(expired ? t.expired : t.declined, p, d), t.declinedWhen ? `${t.when}: ${d}` : '', say(t.pickAnother, expired),
        t.emergency, site.professionalName],
      { linkLabel: t.pickLink, linkUrl: bookUrl }),
    };
  },
  // A couple of hours before: information only, nothing to click.
  reminderSoon({ ev, name, tz, site, lang }) {
    const t = pick(lang, ev);
    return {
      subject: `${say(t.subjSoon)} – ${brand(site)}`,
      ...wrap([t.dear(name), say(t.soon, firstName(ev), meetingOf(ev, lang)), ...details(ev, tz, site, t), t.soonCantCome, t.emergency, site.professionalName]),
    };
  },
  // The professional cancelled, or freed the time because attendance wasn't confirmed: the person always
  // learns what happened and what to do if it was a mistake.
  cancelledByStudio({ ev, name, tz, site, bookUrl, lang, unconfirmed = false }) {
    const t = pick(lang, ev);
    const d = t.date(new Date(ev.start_at), tz);
    const first = ev.kind === 'primo_colloquio';
    const p = firstName(ev);
    const m = meetingOf(ev, lang);
    const what = unconfirmed ? (first ? t.whatToDoFirst : say(t.whatToDoSession, p)) : (first ? t.whatToDoGenericFirst : say(t.whatToDoGeneric, p));
    return {
      subject: `${say(t.subjCancelledByStudio, m)} – ${brand(site)}`,
      ...wrap([t.dear(name), unconfirmed ? say(t.freedUnconfirmed, d, p, m) : say(t.cancelledByStudio, d, p, m), what, t.emergency, site.professionalName],
        first ? { linkLabel: t.pickLink, linkUrl: bookUrl } : {}),
    };
  },
  // To the professionals: no personal data, only day, time and a pointer to the protected agenda.
  // 18:00 the day before: the professional's list of tomorrow's appointments not confirmed yet.
  unconfirmedNotice({ list, tz, adminUrl }) {
    const n = list.length;
    return {
      subject: 'Appuntamenti di domani da confermare – Blooming',
      ...wrap([
        n === 1 ? 'Per domani c\'è 1 appuntamento per cui la persona non ha ancora confermato la presenza:' : `Per domani ci sono ${n} appuntamenti per cui la persona non ha ancora confermato la presenza:`,
        ...list.map((ev) => `• ${formatItalian(new Date(ev.start_at), tz)}`),
        'Dall\'agenda puoi scriverle o liberare l\'orario. Se lo liberi, la persona riceve un\'email che le dice cosa fare.',
      ], { linkLabel: 'Apri l\'agenda', linkUrl: adminUrl }),
    };
  },
  studioNotice({ ev, action, tz, adminUrl }) {
    const when = ev ? formatItalian(new Date(ev.start_at), tz) : '';
    const changed = (how) => [`Un appuntamento di ${when} è stato ${how}.`, 'I dettagli sono nell\'agenda.'];
    const deadline = 'Accettala o rifiutala dall\'agenda entro le 18 del giorno prima';
    const msg = {
      requested: ['Nuova richiesta da accettare', [`C'è una nuova richiesta di primo colloquio per ${when}.`, `${deadline}: dopo decade da sola.`,
        ev && ev.assigned ? 'Ti è stata assegnata in automatico. Se è meglio la collega, usa «Passa alla collega».' : '']],
      reassigned: ['Richiesta passata a te', [`La collega ti ha passato una richiesta di primo colloquio per ${when}.`, `${deadline}.`]],
      expired: ['Richiesta decaduta', [`La richiesta di primo colloquio per ${when} è decaduta senza risposta: l'orario è di nuovo libero e la persona ha ricevuto un'email.`]],
      booked: ['Nuovo appuntamento dal sito', [`C'è un nuovo appuntamento per ${when}.`, 'I dettagli sono nell\'agenda.']],
      confirmed: ['Un appuntamento è cambiato', changed('confermato dalla persona')],
      cancelled: ['Un appuntamento è cambiato', changed('annullato dalla persona')],
      lateCancelled: ['Un appuntamento è cambiato', changed('annullato all\'ultimo momento')],
      rescheduled: ['Un appuntamento è cambiato', changed('spostato dalla persona')],
      request: ['Nuova richiesta di ricontatto', ['C\'è una nuova richiesta di ricontatto.', 'I dettagli sono nell\'agenda.']],
    }[action];
    return {
      subject: `${msg[0]} – Blooming`,
      ...wrap(msg[1], { linkLabel: 'Apri l\'agenda', linkUrl: adminUrl }),
    };
  },
};
