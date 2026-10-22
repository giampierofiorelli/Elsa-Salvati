// Date and time helpers for a single studio time zone (Europe/Rome by default).
// Wall-clock values are strings: dates "YYYY-MM-DD", times "HH:MM".

const partsCache = new Map();

function formatter(tz) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(date, tz) {
  const out = {};
  for (const p of formatter(tz).formatToParts(date)) out[p.type] = p.value;
  return {
    date: `${out.year}-${out.month}-${out.day}`,
    time: `${out.hour}:${out.minute}`,
    year: +out.year, month: +out.month, day: +out.day,
    hour: +out.hour, minute: +out.minute, second: +out.second,
  };
}

/** Offset of the zone from UTC at an instant, in minutes (Rome: +60 or +120). */
export function offsetMinutes(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * Instant for a wall-clock date and time in a zone.
 * A time skipped by the spring DST change moves forward by the gap;
 * a repeated autumn time resolves to its first occurrence.
 */
export function zonedToUtc(dateStr, timeStr, tz) {
  assertDate(dateStr);
  assertTime(timeStr);
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const candidates = new Set();
  for (const probe of [naive - 36e5 * 3, naive, naive + 36e5 * 3]) {
    candidates.add(naive - offsetMinutes(new Date(probe), tz) * 60000);
  }
  const exact = [...candidates]
    .filter((c) => {
      const p = zonedParts(new Date(c), tz);
      return p.date === dateStr && p.time === timeStr;
    })
    .sort((a, b) => a - b);
  if (exact.length) return new Date(exact[0]);
  // Skipped wall time (spring forward): apply the pre-gap (smaller) offset,
  // which lands just after the gap, e.g. 02:30 -> 03:30 summer time.
  return new Date(Math.max(...candidates));
}

export function assertDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new TypeError('invalid date');
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new TypeError('invalid date');
  }
}

export function assertTime(s) {
  if (typeof s !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new TypeError('invalid time');
}

/** Add days to a calendar date string. */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** ISO weekday of a calendar date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Monday of the week containing a date. */
export function mondayOf(dateStr) {
  return addDays(dateStr, 1 - isoWeekday(dateStr));
}

export function timeToMinutes(t) {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Parse "YYYY-MM-DDTHH:MM" local wall time. */
export function parseLocalDateTime(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) throw new TypeError('invalid datetime');
  const [date, time] = s.split('T');
  assertDate(date);
  assertTime(time);
  return { date, time };
}

const itFormats = new Map();
/** Italian human date, e.g. "martedì 27 ottobre 2026, ore 17:00". */
export function formatItalian(date, tz, { withTime = true } = {}) {
  let f = itFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('it-IT', {
      timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    itFormats.set(tz, f);
  }
  return withTime ? `${f.format(date)}, ore ${zonedParts(date, tz).time}` : f.format(date);
}
