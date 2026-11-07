// Scheduled jobs (reminders, data retention) and the read-only calendar feed.

import { templates } from './email.mjs';
import { randomToken, sha256 } from './crypto.mjs';
import { approvalDeadlineFor } from './slots.mjs';

export async function runReminders({ store, vault, mailer, site, now = () => new Date() }) {
  const settings = await store.getSettings();
  const base = String(site.siteUrl || '').replace(/\/$/, '');

  // Requests nobody approved in time free their time again; the person is told to choose another.
  let expired = 0;
  const t = now();
  for (const ev of await store.pendingBefore(new Date(t.getTime() + 3 * 86400000))) {
    if (approvalDeadlineFor(ev.start_at, settings).getTime() > t.getTime()) continue;
    if (!(await store.declineEvent(ev.id, 'sistema'))) continue;
    expired++;
    let c = {};
    try { c = vault.decrypt(ev.contact_enc) || {}; } catch { /* unreadable */ }
    try {
      if (c.email && new Date(ev.start_at) > now()) {
        await mailer.send({ to: c.email, ...templates.declined({ ev, name: c.name, tz: settings.timezone, site, bookUrl: `${base}${ev.lang === 'en' ? '/en/book/' : '/prenota/'}`, lang: ev.lang, expired: true }) });
      }
      for (const to of [...new Set([site.notifyEmail, ev.professional_email].filter(Boolean))]) {
        await mailer.send({ to, ...templates.studioNotice({ ev, action: 'expired', tz: settings.timezone, adminUrl: `${base}/admin/` }) });
      }
    } catch (err) {
      console.error('[expiry]', ev.id, err.message);
    }
  }
  // The request to confirm attendance (confirmHours before; 24 by default, can become 48 from the settings).
  const due = await store.dueReminders(now(), settings.confirmHours);
  const sentNow = new Set();
  let sent = 0;
  for (const ev of due) {
    let c = {};
    try { c = vault.decrypt(ev.contact_enc) || {}; } catch { /* unreadable */ }
    if (!c.email) { await store.markReminderSent(ev.id); continue; }
    try {
      if (ev.source === 'sito' || ev.notify_client) {
        // A new personal link (only its fingerprint is stored): earlier links stop working.
        const token = randomToken();
        await store.updateEvent(ev.id, { manage_token_hash: sha256(token) });
        const base = String(site.siteUrl || '').replace(/\/$/, '');
        const manageUrl = `${base}${ev.lang === 'en' ? '/en/book/manage/' : '/prenota/gestisci/'}#t=${token}`;
        await mailer.send({ to: c.email, ...templates.reminderConfirm({ ev, name: c.name, manageUrl, tz: settings.timezone, site: { ...site, cancelHours: settings.cancelHours }, lang: ev.lang }) });
      } else {
        await mailer.send({ to: c.email, ...templates.reminder({ ev, name: c.name, manageUrl: null, tz: settings.timezone, site, lang: ev.lang }) });
      }
      await store.markReminderSent(ev.id);
      sentNow.add(ev.id);
      sent++;
    } catch (err) {
      console.error('[reminder]', ev.id, err.message);
    }
  }
  // Second reminder a couple of hours before (information only). Never two emails in the same run:
  // if the first reminder has just gone out (late booking), it counts as this one too.
  let sent2 = 0;
  let due2 = [];
  if (settings.reminder2Hours > 0) {
    due2 = await store.dueSecondReminders(now(), settings.reminder2Hours);
    for (const ev of due2) {
      let c = {};
      try { c = vault.decrypt(ev.contact_enc) || {}; } catch { /* unreadable */ }
      if (!c.email || sentNow.has(ev.id)) { await store.markSecondReminderSent(ev.id); continue; }
      try {
        await mailer.send({ to: c.email, ...templates.reminderSoon({ ev, name: c.name, tz: settings.timezone, site, lang: ev.lang }) });
        await store.markSecondReminderSent(ev.id);
        sent2++;
      } catch (err) {
        console.error('[reminder2]', ev.id, err.message);
      }
    }
  }
  const unconfirmed = await handleUnconfirmed({ store, settings, now });
  return { expired, due: due.length, sent, due2: due2.length, sent2, unconfirmed };
}

/**
 * Appointments whose confirmation was requested but not given. What to do is still to be decided
 * (research in progress): for now nothing happens beyond the "In attesa di conferma" badge in the agenda
 * and the short reminder two hours before. A later rule (tell the professional, a second nudge, free the
 * time) goes here, so the reminders job keeps running it every 15 minutes.
 */
async function handleUnconfirmed() {
  return 0;
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
