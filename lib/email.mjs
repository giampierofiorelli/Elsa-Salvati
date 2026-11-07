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
const L = {
  it: {
    date: formatItalian,
    emergency: 'Questa email e il sistema di prenotazione non sono servizi di emergenza. In caso di pericolo immediato contatta il 112 o il 118.',
    when: 'Quando', length: 'Durata prevista', minutes: 'minuti', with: 'Con', mode: 'Modalità', address: 'Indirizzo',
    modes: { studio: 'in studio', online: 'online' },
    onlineNote: 'Riceverai le istruzioni per il collegamento prima dell\'appuntamento.',
    dear: (n) => `Gentile ${n},`,
    confirmedFirst: 'il tuo primo colloquio è confermato.', confirmed: 'il tuo appuntamento è confermato.',
    fee: 'Tariffa',
    canManage: (h) => `Puoi annullare o spostare l'appuntamento dal link qui sotto fino a ${h} ore prima.`,
    contactToChange: 'Per modificare o annullare l\'appuntamento contatta direttamente lo studio.',
    manage: 'Gestisci l\'appuntamento',
    subjConfirmed: 'Appuntamento confermato', subjMoved: 'Appuntamento spostato', subjCancelled: 'Appuntamento annullato', subjReminder: 'Promemoria appuntamento',
    moved: 'il tuo appuntamento è stato spostato.',
    cancelled: (d) => `l'appuntamento di ${d} è stato annullato.`,
    rebook: 'Se desideri, puoi prenotare un nuovo orario dal sito.', rebookLink: 'Prenota un nuovo orario',
    reminder: 'ti ricordo il nostro appuntamento.',
  },
  en: {
    date: formatEnglish,
    emergency: 'This email and the booking system are not emergency services. If you are in immediate danger, call 112 or 118.',
    when: 'When', length: 'Expected length', minutes: 'minutes', with: 'With', mode: 'Format', address: 'Address',
    modes: { studio: 'in person', online: 'online, by video call' },
    onlineNote: 'You\'ll receive the details for joining the call before the appointment.',
    dear: (n) => `Dear ${n},`,
    confirmedFirst: 'your free first meeting is confirmed.', confirmed: 'your appointment is confirmed.',
    fee: 'Fee',
    canManage: (h) => `You can cancel or reschedule using the link below, up to ${h} hours before.`,
    contactToChange: 'To change or cancel the appointment, please contact the practice directly.',
    manage: 'Manage your booking',
    subjConfirmed: 'Appointment confirmed', subjMoved: 'Appointment moved', subjCancelled: 'Appointment cancelled', subjReminder: 'Appointment reminder',
    moved: 'your appointment has been moved.',
    cancelled: (d) => `your appointment on ${d} has been cancelled.`,
    rebook: 'If you like, you can book a new time on the website.', rebookLink: 'Book a new time',
    reminder: 'this is a reminder of your upcoming appointment.',
  },
};
const pick = (lang, ev) => L[lang || (ev && ev.lang)] || L.it;

function details(ev, tz, site, t) {
  const lines = [
    `${t.when}: ${t.date(new Date(ev.start_at), tz)}`,
    `${t.length}: ${Math.round((new Date(ev.end_at) - new Date(ev.start_at)) / 60000)} ${t.minutes}`,
  ];
  if (ev.professional_name) lines.push(`${t.with}: ${ev.professional_name}`);
  if (ev.mode) lines.push(`${t.mode}: ${t.modes[ev.mode]}`);
  if (ev.mode === 'studio' && site.address) lines.push(`${t.address}: ${site.address}`);
  if (ev.mode === 'online') lines.push(t.onlineNote);
  return lines;
}

export const templates = {
  confirmation({ ev, name, manageUrl, tz, site, lang }) {
    const t = pick(lang, ev);
    const price = t === L.en ? site.priceTextEn : site.priceText;
    return {
      subject: `${t.subjConfirmed} – ${site.brandName || 'Blooming'}`,
      ...wrap([
        t.dear(name),
        ev.kind === 'primo_colloquio' ? t.confirmedFirst : t.confirmed,
        ...details(ev, tz, site, t),
        ev.kind === 'primo_colloquio' && price ? `${t.fee}: ${price}` : '',
        manageUrl ? t.canManage(site.cancelHours) : t.contactToChange,
        t.emergency,
        site.professionalName,
      ], manageUrl ? { linkLabel: t.manage, linkUrl: manageUrl } : {}),
    };
  },
  rescheduled({ ev, name, manageUrl, tz, site, lang }) {
    const t = pick(lang, ev);
    return {
      subject: `${t.subjMoved} – ${site.brandName || 'Blooming'}`,
      ...wrap([t.dear(name), t.moved, ...details(ev, tz, site, t), t.emergency, site.professionalName],
        { linkLabel: t.manage, linkUrl: manageUrl }),
    };
  },
  cancelled({ ev, name, tz, site, bookUrl, lang }) {
    const t = pick(lang, ev);
    return {
      subject: `${t.subjCancelled} – ${site.brandName || 'Blooming'}`,
      ...wrap([t.dear(name), t.cancelled(t.date(new Date(ev.start_at), tz)), t.rebook, site.professionalName],
        { linkLabel: t.rebookLink, linkUrl: bookUrl }),
    };
  },
  reminder({ ev, name, manageUrl, tz, site, lang }) {
    const t = pick(lang, ev);
    return {
      subject: `${t.subjReminder} – ${site.brandName || 'Blooming'}`,
      ...wrap([t.dear(name), t.reminder, ...details(ev, tz, site, t), t.emergency, site.professionalName],
        manageUrl ? { linkLabel: t.manage, linkUrl: manageUrl } : {}),
    };
  },
  // To the studio: no patient name in the email, only a pointer to the agenda.
  studioNotice({ ev, action, tz, adminUrl }) {
    const what = { booked: 'Nuova prenotazione dal sito', cancelled: 'Appuntamento annullato dal paziente', rescheduled: 'Appuntamento spostato dal paziente', request: 'Nuova richiesta di ricontatto' }[action];
    return {
      subject: what,
      ...wrap([
        `${what}.`,
        ev ? `Quando: ${formatItalian(new Date(ev.start_at), tz)}` : '',
        ev && ev.professional_name ? `Professionista: ${ev.professional_name}` : '',
        'I dettagli sono nell\'agenda (accesso protetto).',
      ], { linkLabel: 'Apri l\'agenda', linkUrl: adminUrl }),
    };
  },
};
