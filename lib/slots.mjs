// Public availability: which first-appointment slots a new patient may book.
// Pure functions, no database access, so they are easy to test.

import {
  addDays, isoWeekday, timeToMinutes, minutesToTime, zonedParts, zonedToUtc,
} from './time.mjs';

export const DEFAULT_SETTINGS = Object.freeze({
  timezone: 'Europe/Rome',
  firstSessionMinutes: 50,   // durata del primo colloquio
  sessionMinutes: 50,        // durata predefinita delle sedute inserite a mano
  slotStepMinutes: 60,       // ogni quanto inizia uno slot prenotabile
  bufferMinutes: 10,         // pausa minima tra due appuntamenti
  minNoticeHours: 24,        // anticipo minimo per prenotare online
  horizonDays: 42,           // quanto avanti si può prenotare
  cancelHours: 24,           // fino a quante ore prima si può annullare/spostare dal link
  maxActivePerContact: 1,    // primi colloqui futuri per stessa email
  reminderHours: 24,         // (non più usato: sostituito da confirmHours)
  confirmHours: 48,          // richiesta di conferma della presenza, ore prima dell'appuntamento
  confirmNudgeHours: 24,     // secondo invito a confermare, solo a chi non ha confermato (0 = nessuno)
  reminder2Hours: 2,         // secondo promemoria, solo informativo (0 = nessuno)
  approvalDeadline: '18:00', // le richieste non approvate scadono il giorno lavorativo prima a quest'ora
  approvalWorkdays: [1, 2, 3, 4, 5], // giorni lavorativi per la scadenza (1 = lunedì … 7 = domenica)
  retentionMonths: 24,       // dopo quanto si cancellano i recapiti degli appuntamenti passati
  requestRetentionMonths: 6, // dopo quanto si cancellano le richieste di ricontatto
});

const LIMITS = {
  firstSessionMinutes: [15, 240],
  sessionMinutes: [15, 240],
  slotStepMinutes: [15, 240],
  bufferMinutes: [0, 120],
  minNoticeHours: [0, 24 * 14],
  horizonDays: [1, 180],
  cancelHours: [0, 24 * 7],
  maxActivePerContact: [1, 5],
  reminderHours: [1, 72],
  confirmHours: [2, 120],
  confirmNudgeHours: [0, 72],
  reminder2Hours: [0, 12],
  retentionMonths: [1, 120],
  requestRetentionMonths: [1, 24],
};

/** Merge stored settings over defaults, rejecting out-of-range numbers. */
export function normalizeSettings(input = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (input[k] === undefined || input[k] === null || input[k] === '') continue;
    const n = Number(input[k]);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new RangeError(`${k} deve essere un intero tra ${lo} e ${hi}`);
    out[k] = n;
  }
  if (input.approvalDeadline !== undefined && input.approvalDeadline !== null && input.approvalDeadline !== '') {
    const v = String(input.approvalDeadline);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new RangeError('approvalDeadline deve essere un orario HH:MM');
    out.approvalDeadline = v;
  }
  if (input.approvalWorkdays !== undefined && input.approvalWorkdays !== null) {
    const days = Array.isArray(input.approvalWorkdays) ? input.approvalWorkdays.map(Number) : [];
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new RangeError('approvalWorkdays: scegli almeno un giorno lavorativo');
    out.approvalWorkdays = [...new Set(days)].sort();
  }
  if (input.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }); } catch { throw new RangeError('timezone non valida'); }
    out.timezone = input.timezone;
  }
  return out;
}

function ruleAllowsMode(rule, mode) {
  return rule.mode === 'entrambi' || rule.mode === mode;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Candidate slots generated from the weekly rules, before removing busy times.
 * Returns [{start: Date, end: Date, date, time, modes: ['studio','online']}].
 */
export function candidateSlots({ rules, settings, fromDate, toDate, duration }) {
  const s = settings;
  const minutes = duration || s.firstSessionMinutes;
  const out = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    const wd = isoWeekday(d);
    const byStart = new Map();
    for (const rule of rules) {
      if (!rule.active || !rule.public || rule.weekday !== wd) continue;
      const startMin = timeToMinutes(rule.start_time);
      const endMin = timeToMinutes(rule.end_time);
      for (let m = startMin; m + minutes <= endMin; m += s.slotStepMinutes) {
        const time = minutesToTime(m);
        const modes = byStart.get(time) || new Set();
        for (const mode of ['studio', 'online']) if (ruleAllowsMode(rule, mode)) modes.add(mode);
        byStart.set(time, modes);
      }
    }
    for (const [time, modes] of [...byStart.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const start = zonedToUtc(d, time, s.timezone);
      // Skip wall times that do not exist (DST gap) to avoid odd shifted slots.
      if (zonedParts(start, s.timezone).time !== time) continue;
      const end = new Date(start.getTime() + minutes * 60000);
      out.push({ start, end, date: d, time, modes: [...modes].sort() });
    }
  }
  return out;
}

/**
 * Bookable slots: candidates minus busy events (with buffer), minimum notice and horizon.
 * busy: [{start_at: Date, end_at: Date}] confirmed events.
 */
export function availableSlots({ rules, busy, settings, now, mode, duration }) {
  const s = settings;
  const today = zonedParts(now, s.timezone).date;
  const toDate = addDays(today, s.horizonDays);
  const earliest = new Date(now.getTime() + s.minNoticeHours * 3600000);
  const buffer = s.bufferMinutes * 60000;
  return candidateSlots({ rules, settings: s, fromDate: today, toDate, duration })
    .filter((slot) => slot.start >= earliest)
    .filter((slot) => !mode || slot.modes.includes(mode))
    .filter((slot) => !busy.some((b) => overlaps(
      slot.start.getTime() - buffer, slot.end.getTime() + buffer,
      new Date(b.start_at).getTime(), new Date(b.end_at).getTime(),
    )));
}

/** Is this exact start time currently bookable for this mode? Used to re-verify at confirmation. */
export function isSlotBookable({ rules, busy, settings, now, mode, start, duration }) {
  return availableSlots({ rules, busy, settings, now, mode, duration })
    .some((slot) => slot.start.getTime() === start.getTime());
}

// ---------- requests waiting for approval ----------

/**
 * When a request for `start` must be approved by: the previous working day (settings.approvalWorkdays,
 * Monday–Friday by default) at settings.approvalDeadline, local time. A Monday request lapses on Friday at 18:00.
 */
export function approvalDeadlineFor(start, settings) {
  const tz = settings.timezone;
  const workdays = settings.approvalWorkdays && settings.approvalWorkdays.length ? settings.approvalWorkdays : [1, 2, 3, 4, 5];
  let day = addDays(zonedParts(new Date(start), tz).date, -1);
  for (let i = 0; i < 7 && !workdays.includes(isoWeekday(day)); i++) day = addDays(day, -1);
  return zonedToUtc(day, settings.approvalDeadline || '18:00', tz);
}

/**
 * A first meeting can be requested only if the professional still has time to approve it:
 * at least 2 hours before its deadline (so at 19:00 nobody can request tomorrow morning).
 */
export const REQUEST_MARGIN_MS = 2 * 3600000;
export function requestOpen(start, settings, now) {
  return approvalDeadlineFor(start, settings).getTime() - new Date(now).getTime() >= REQUEST_MARGIN_MS;
}
