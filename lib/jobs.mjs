// Scheduled jobs (reminders, data retention) and the read-only calendar feed.

import { templates } from './email.mjs';
import { randomToken, sha256 } from './crypto.mjs';
import { approvalDeadlineFor } from './slots.mjs';
import { bookingTargets } from './notify.mjs';
import { zonedParts, zonedToUtc, addDays } from './time.mjs';

// Emails that ask the person to do something are not sent at night (Rome time): they wait for 08:00.
const DAY_FROM = 8;
const DAY_TO = 21;
function daytime(at, tz) {
  const h = Number(zonedParts(at, tz).time.slice(0, 2));
  return h >= DAY_FROM && h < DAY_TO;
}

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
      for (const to of await bookingTargets(store, ev.professional_email)) {
        await mailer.send({ to, ...templates.studioNotice({ ev, action: 'expired', tz: settings.timezone, adminUrl: `${base}/admin/` }) });
      }
    } catch (err) {
      console.error('[expiry]', ev.id, err.message);
    }
  }
  // The request to confirm attendance (confirmHours before, 48 by default), only in the daytime.
  const day = daytime(now(), settings.timezone);
  const due = day ? await store.dueReminders(now(), settings.confirmHours) : [];
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
  // A second, kind invitation to confirm (confirmNudgeHours before), only to those who haven't yet.
  let nudged = 0;
  if (day && settings.confirmNudgeHours > 0) {
    for (const ev of await store.dueNudges(now(), settings.confirmNudgeHours)) {
      if (sentNow.has(ev.id)) continue;
      let c = {};
      try { c = vault.decrypt(ev.contact_enc) || {}; } catch { /* unreadable */ }
      if (!c.email) { await store.updateEvent(ev.id, { confirm_nudge_sent_at: now() }); continue; }
      try {
        const token = randomToken();
        await store.updateEvent(ev.id, { manage_token_hash: sha256(token), confirm_nudge_sent_at: now() });
        const manageUrl = `${base}${ev.lang === 'en' ? '/en/book/manage/' : '/prenota/gestisci/'}#t=${token}`;
        await mailer.send({ to: c.email, ...templates.reminderConfirm({ ev, name: c.name, manageUrl, tz: settings.timezone, site: { ...site, cancelHours: settings.cancelHours }, lang: ev.lang, nudge: true }) });
        sentNow.add(ev.id);
        nudged++;
      } catch (err) {
        console.error('[nudge]', ev.id, err.message);
      }
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
  const unconfirmed = await handleUnconfirmed({ store, mailer, site, settings, now });
  return { expired, due: due.length, sent, nudged, due2: due2.length, sent2, unconfirmed };
}

/**
 * Appointments whose confirmation was asked and not given (decision of 7/11, research 22): nothing is cancelled
 * automatically. At 18:00 (Rome) the day before, each professional gets one email listing tomorrow's
 * unconfirmed appointments; in the agenda she can write to the person or free the time.
 */
async function handleUnconfirmed({ store, mailer, site, settings, now }) {
  const t = now();
  const tz = settings.timezone;
  const local = zonedParts(t, tz);
  const [hh, mm] = settings.approvalDeadline.split(':').map(Number);
  const minutes = Number(local.time.slice(0, 2)) * 60 + Number(local.time.slice(3, 5));
  if (minutes < hh * 60 + mm || minutes >= DAY_TO * 60) return 0;
  const tomorrow = addDays(local.date, 1);
  const rows = await store.unconfirmedBetween(zonedToUtc(tomorrow, '00:00', tz), zonedToUtc(addDays(tomorrow, 1), '00:00', tz));
  const byPro = new Map();
  for (const ev of rows) {
    if (!byPro.has(ev.professional_id)) byPro.set(ev.professional_id, []);
    byPro.get(ev.professional_id).push(ev);
  }
  const base = String(site.siteUrl || '').replace(/\/$/, '');
  let sent = 0;
  for (const [proId, list] of byPro) {
    const key = `unconfirmed-notice:${proId}:${tomorrow}`;
    if (await store.getKv(key)) continue;
    const targets = await bookingTargets(store, list[0].professional_email);
    try {
      for (const to of targets) await mailer.send({ to, ...templates.unconfirmedNotice({ list, tz, adminUrl: `${base}/admin/` }) });
      await store.setKv(key, { sentAt: t.toISOString(), count: list.length });
      sent++;
    } catch (err) {
      console.error('[unconfirmed]', proId, err.message);
    }
  }
  return sent;
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
