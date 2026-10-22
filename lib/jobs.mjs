// Scheduled jobs (reminders, data retention) and the read-only calendar feed.

import { templates } from './email.mjs';

export async function runReminders({ store, vault, mailer, site, now = () => new Date() }) {
  const settings = await store.getSettings();
  const due = await store.dueReminders(now(), settings.reminderHours);
  let sent = 0;
  for (const ev of due) {
    let c = {};
    try { c = vault.decrypt(ev.contact_enc) || {}; } catch { /* unreadable */ }
    if (!c.email) { await store.markReminderSent(ev.id); continue; }
    try {
      await mailer.send({ to: c.email, ...templates.reminder({ ev, name: c.name, manageUrl: null, tz: settings.timezone, site }) });
      await store.markReminderSent(ev.id);
      sent++;
    } catch (err) {
      console.error('[reminder]', ev.id, err.message);
    }
  }
  return { due: due.length, sent };
}

export async function runRetention({ store, now = () => new Date() }) {
  const s = await store.getSettings();
  return store.applyRetention(now(), s.retentionMonths, s.requestRetentionMonths);
}

const KIND_TITLE = { primo_colloquio: 'Primo colloquio', seduta: 'Seduta' };

function icsDate(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join('');
}

/**
 * iCalendar feed for the psychologist's phone calendar.
 * Neutral titles by default; initials only if ICS_INCLUDE_INITIALS=true.
 */
export async function buildIcs({ store, vault, env, now = () => new Date() }, { professionalId = null } = {}) {
  const t = now();
  const rows = await store.eventsBetween(new Date(t.getTime() - 30 * 86400000), new Date(t.getTime() + 180 * 86400000), { professionalId });
  const withInitials = env.ICS_INCLUDE_INITIALS === 'true';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agenda studio//IT', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'X-WR-CALNAME:Agenda studio', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  for (const r of rows) {
    let title = r.kind === 'blocco' ? (r.block_title || 'Non disponibile') : KIND_TITLE[r.kind];
    if (r.kind !== 'blocco' && r.mode) title += r.mode === 'online' ? ' (online)' : ' (studio)';
    if (!professionalId) title += ` · ${r.professional_name}`;
    if (withInitials && r.kind !== 'blocco') {
      try { const c = vault.decrypt(r.contact_enc); if (c && c.name) title += ` – ${initials(c.name)}`; } catch { /* ignore */ }
    }
    lines.push(
      'BEGIN:VEVENT',
      `UID:evento-${r.id}@agenda`,
      `DTSTAMP:${icsDate(t)}`,
      `DTSTART:${icsDate(r.start_at)}`,
      `DTEND:${icsDate(r.end_at)}`,
      `SUMMARY:${icsEscape(title)}`,
      'CLASS:PRIVATE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
