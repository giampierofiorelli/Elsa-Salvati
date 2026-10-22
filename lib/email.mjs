// Transactional email. Content is deliberately neutral: no clinical details,
// no reason for the visit. Providers: Brevo (EU servers) or Resend.
// Without a configured provider emails are skipped: bookings stay valid anyway.

import { formatItalian } from './time.mjs';

const MODE_LABEL = { studio: 'in studio', online: 'online' };

export function createMailer(env = process.env, fetchImpl = globalThis.fetch) {
  const provider = (env.EMAIL_PROVIDER || '').toLowerCase();
  const from = env.EMAIL_FROM || '';
  const fromName = env.EMAIL_FROM_NAME || 'Studio di psicologia';
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

const EMERGENCY = 'Questa email e il sistema di prenotazione non sono servizi di emergenza. In caso di pericolo immediato contatta il 112 o il 118.';

function details(ev, tz, site) {
  const lines = [
    `Quando: ${formatItalian(new Date(ev.start_at), tz)}`,
    `Durata prevista: ${Math.round((new Date(ev.end_at) - new Date(ev.start_at)) / 60000)} minuti`,
  ];
  if (ev.mode) lines.push(`Modalità: ${MODE_LABEL[ev.mode]}`);
  if (ev.mode === 'studio' && site.address) lines.push(`Indirizzo: ${site.address}`);
  if (ev.mode === 'online') lines.push('Riceverai le istruzioni per il collegamento prima dell\'appuntamento.');
  return lines;
}

export const templates = {
  confirmation({ ev, name, manageUrl, tz, site }) {
    return {
      subject: `Appuntamento confermato – ${site.professionalName}`,
      ...wrap([
        `Gentile ${name},`,
        ev.kind === 'primo_colloquio' ? 'il tuo primo colloquio è confermato.' : 'il tuo appuntamento è confermato.',
        ...details(ev, tz, site),
        ev.kind === 'primo_colloquio' && site.priceText ? `Tariffa: ${site.priceText}` : '',
        manageUrl
          ? `Puoi annullare o spostare l'appuntamento dal link qui sotto fino a ${site.cancelHours} ore prima.`
          : 'Per modificare o annullare l\'appuntamento contatta direttamente lo studio.',
        EMERGENCY,
        site.professionalName,
      ], manageUrl ? { linkLabel: 'Gestisci l\'appuntamento', linkUrl: manageUrl } : {}),
    };
  },
  rescheduled({ ev, name, manageUrl, tz, site }) {
    return {
      subject: `Appuntamento spostato – ${site.professionalName}`,
      ...wrap([
        `Gentile ${name},`,
        'il tuo appuntamento è stato spostato.',
        ...details(ev, tz, site),
        EMERGENCY,
        site.professionalName,
      ], { linkLabel: 'Gestisci l\'appuntamento', linkUrl: manageUrl }),
    };
  },
  cancelled({ ev, name, tz, site, bookUrl }) {
    return {
      subject: `Appuntamento annullato – ${site.professionalName}`,
      ...wrap([
        `Gentile ${name},`,
        `l'appuntamento di ${formatItalian(new Date(ev.start_at), tz)} è stato annullato.`,
        'Se desideri, puoi prenotare un nuovo orario dal sito.',
        site.professionalName,
      ], { linkLabel: 'Prenota un nuovo orario', linkUrl: bookUrl }),
    };
  },
  reminder({ ev, name, manageUrl, tz, site }) {
    return {
      subject: `Promemoria appuntamento – ${site.professionalName}`,
      ...wrap([
        `Gentile ${name},`,
        'ti ricordo il nostro appuntamento.',
        ...details(ev, tz, site),
        EMERGENCY,
        site.professionalName,
      ], manageUrl ? { linkLabel: 'Gestisci l\'appuntamento', linkUrl: manageUrl } : {}),
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
        'I dettagli sono nell\'agenda (accesso protetto).',
      ], { linkLabel: 'Apri l\'agenda', linkUrl: adminUrl }),
    };
  },
};
