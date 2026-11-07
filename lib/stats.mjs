// Statistics as counters only (research 23): no person, no identifier, no IP, no free text.
// Writes add +1 to a row of a counter table; reads compute indicators for the admin's "Statistiche".

import { zonedParts, addDays } from './time.mjs';
import { availableSlots, requestOpen } from './slots.mjs';

export const STATS_TZ = 'Europe/Rome';

// "Come ci hai conosciuto?": fixed codes, never free text.
export const HEARD_FROM = ['passaparola', 'professionista', 'ricerca', 'instagram', 'linkedin', 'azienda', 'altro'];

// Email types (tag sent with every email, counted per day). Names follow the templates.
export const EMAIL_TYPES = [
  'richiesta-ricevuta', 'accettata', 'rifiutata', 'scaduta', 'fissato', 'confermato', 'spostato', 'disdetta',
  'promemoria', 'conferma', 'conferma-2', 'promemoria-2h', 'annullato-studio', 'liberato',
  'studio-avviso', 'studio-non-confermati', 'altro',
];
// Events from Brevo's transactional webhook that we count (never opens or clicks).
export const EMAIL_EVENTS = { delivered: 'delivered', soft_bounce: 'soft_bounce', hard_bounce: 'hard_bounce', spam: 'spam', blocked: 'blocked', invalid_email: 'hard_bounce', error: 'blocked' };
export const EMAIL_ACTIONS = ['conferma', 'disdetta', 'disdetta-tardiva', 'spostamento'];

// Site: fixed lists for everything that comes from the browser.
export const ENTRY_SOURCES = ['interno', 'diretto', 'google', 'bing', 'duckduckgo', 'instagram', 'facebook', 'linkedin', 'altro'];
export const FORMS = ['prenotazione', 'contatto', 'aziende', 'ricontatto'];
export const FORM_STATES = ['avviato', 'inviato', 'errore'];
export const GOALS = ['prenotazione', 'contatto', 'aziende', 'ricontatto'];
const PAGE_RE = /^\/(?:[a-z0-9-]+\/){0,4}$/;
const KEY_RE = /^[a-z0-9-]{1,48}$/;
export const DAILY_BEACON_CAP = 5000;

export function dayOf(date) { return zonedParts(date, STATS_TZ).date; }
export function monthOf(date) { return dayOf(date).slice(0, 8) + '01'; }

/** Counter writes. `sql` is the postgres.js client. */
export function createStats(sql) {
  return {
    async bumpMonthly(at, { metric, pro = 0, area = '', lang = '' }, n = 1) {
      await sql`insert into stats_monthly (month, professional_id, area, lang, metric, n)
        values (${monthOf(at)}, ${pro || 0}, ${area || ''}, ${lang || ''}, ${metric}, ${n})
        on conflict (month, professional_id, area, lang, metric) do update set n = stats_monthly.n + excluded.n`;
    },
    async bumpEmail(at, type, lang, field) {
      if (!['sent', 'api_errors', 'delivered', 'soft_bounce', 'hard_bounce', 'spam', 'blocked'].includes(field)) return;
      const t = EMAIL_TYPES.includes(type) ? type : 'altro';
      const l = lang === 'en' || lang === 'it' ? lang : '';
      await sql.unsafe(`insert into stats_email_daily (day, email_type, lang, ${field}) values ($1, $2, $3, 1)
        on conflict (day, email_type, lang) do update set ${field} = stats_email_daily.${field} + 1`, [dayOf(at), t, l]);
    },
    async bumpEmailAction(at, type, action) {
      if (!EMAIL_TYPES.includes(type) || !EMAIL_ACTIONS.includes(action)) return;
      await sql`insert into stats_email_actions_daily (day, email_type, action, n) values (${dayOf(at)}, ${type}, ${action}, 1)
        on conflict (day, email_type, action) do update set n = stats_email_actions_daily.n + 1`;
    },
    /** Daily cap for the site beacon: true while under the cap. */
    async takeBeacon(at, cap = DAILY_BEACON_CAP) {
      const [r] = await sql`insert into stats_site_daily (day, page, metric, key, n) values (${dayOf(at)}, '*', 'beacon', '', 1)
        on conflict (day, page, metric, key) do update set n = stats_site_daily.n + 1 returning n`;
      return r.n <= cap;
    },
    async bumpSite(at, rows) {
      if (!rows.length) return;
      const day = dayOf(at);
      await sql`insert into stats_site_daily (day, page, metric, key, n)
        select ${day}::date, x.page, x.metric, x.key, x.n
        from unnest(${rows.map((r) => r.page)}::text[], ${rows.map((r) => r.metric)}::text[], ${rows.map((r) => r.key || '')}::text[], ${rows.map((r) => r.n)}::int[]) as x(page, metric, key, n)
        on conflict (day, page, metric, key) do update set n = stats_site_daily.n + excluded.n`;
    },
    /**
     * Retention: continuity after the first meeting is frozen into the monthly counters while the
     * contact fingerprints still exist; daily site counters older than 25 months become monthly totals.
     */
    async freezeAndRollup(now) {
      // Months whose 60-day follow-up window has closed and that are not frozen yet.
      const frozen = await sql`
        with firsts as (
          select e.id, e.professional_id, e.contact_hash, e.start_at,
                 date_trunc('month', e.start_at at time zone ${STATS_TZ})::date as month,
                 coalesce(c.slug, '') as area, coalesce(e.lang, 'it') as lang
          from events e left join services s on s.id = e.service_id left join categories c on c.id = s.category_id
          where e.kind = 'primo_colloquio' and e.status = 'confermato' and e.contact_hash is not null
            and (date_trunc('month', e.start_at at time zone ${STATS_TZ}) + interval '1 month' + interval '60 days') < ${now}::timestamptz at time zone ${STATS_TZ}
        ), scored as (
          select f.month, f.professional_id, f.area, f.lang,
                 exists (select 1 from events x where x.contact_hash = f.contact_hash and x.kind = 'seduta' and x.status in ('confermato', 'non_presentata')
                         and x.start_at > f.start_at and x.start_at <= f.start_at + interval '60 days') as cont
          from firsts f
        ), agg as (
          select month, professional_id, area, lang, count(*)::int as base, count(*) filter (where cont)::int as yes from scored group by 1, 2, 3, 4
        ), ins as (
          insert into stats_monthly (month, professional_id, area, lang, metric, n)
          select month, professional_id, area, lang, 'continuita-base', base from agg
          on conflict do nothing returning 1
        ), ins2 as (
          insert into stats_monthly (month, professional_id, area, lang, metric, n)
          select month, professional_id, area, lang, 'continuita-si', yes from agg
          on conflict do nothing returning 1
        ) select (select count(*) from ins)::int as base, (select count(*) from ins2)::int as yes`;
      const limit = addDays(dayOf(now), -25 * 31).slice(0, 8) + '01';
      const rolled = await sql`with old as (
          delete from stats_site_daily where day < ${limit}::date returning day, page, metric, key, n
        ) insert into stats_site_monthly (month, page, metric, key, n)
          select date_trunc('month', day)::date, page, metric, key, sum(n)::int from old group by 1, 2, 3, 4
          on conflict (month, page, metric, key) do update set n = stats_site_monthly.n + excluded.n returning 1`;
      await sql`delete from stats_email_daily where day < ${limit}::date`;
      await sql`delete from stats_email_actions_daily where day < ${limit}::date`;
      return { continuity: frozen[0].base, siteRolled: rolled.length };
    },
  };
}

// ---------- the site beacon: validate, then turn one message into counter rows ----------

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|headlesschrome|lighthouse|python-requests|curl|wget|httpclient|monitor/i;

export function isBot(ua) { return !ua || BOT_RE.test(ua); }

function cleanPage(p) {
  if (p === 'gestione') return p;
  if (typeof p !== 'string' || p.length > 120 || !PAGE_RE.test(p)) return null;
  if (/^\/admin\//.test(p) || /^\/(prenota\/gestisci|en\/book\/manage)\//.test(p)) return 'gestione';
  return p;
}
const clampN = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };

/** Counter rows for one beacon, or null when the message is not valid. Anything unknown is dropped. */
export function beaconRows(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const page = cleanPage(msg.page);
  if (!page) return null;
  const rows = [];
  if (!msg.again) {
    rows.push({ page, metric: 'view', key: '', n: 1 });
    const src = ENTRY_SOURCES.includes(msg.src) ? msg.src : 'altro';
    if (src !== 'interno') rows.push({ page, metric: 'entry', key: src, n: 1 });
    if (msg.device === 'telefono' || msg.device === 'computer') rows.push({ page: '*', metric: 'device', key: msg.device, n: 1 });
  }
  if (msg.cta && typeof msg.cta === 'object') {
    Object.keys(msg.cta).slice(0, 20).forEach((k) => { const n = clampN(msg.cta[k], 20); if (KEY_RE.test(k) && n) rows.push({ page, metric: 'cta', key: k, n }); });
  }
  if (msg.form && typeof msg.form === 'object') {
    Object.keys(msg.form).slice(0, 8).forEach((k) => {
      const [f, st] = k.split(':');
      if (FORMS.includes(f) && FORM_STATES.includes(st) && clampN(msg.form[k], 5)) rows.push({ page, metric: 'form', key: `${f}:${st}`, n: 1 });
    });
  }
  const step = clampN(msg.step, 5);
  if (step) rows.push({ page, metric: 'step', key: String(step), n: 1 });
  if (GOALS.includes(msg.goal)) {
    const prev = cleanPage(msg.prev) || '(nessuna)';
    const da = typeof msg.da === 'string' && KEY_RE.test(msg.da) ? msg.da : '';
    rows.push({ page: prev, metric: 'goal', key: `${msg.goal}|${da}`, n: 1 });
  }
  return rows;
}

// ---------- reading: indicators for the admin ----------

const median = (arr) => {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

function rangeUtc(from, to) {
  // [from 00:00, to+1 00:00) in Rome time
  return { start: `${from} 00:00 ${STATS_TZ}`, end: `${addDays(to, 1)} 00:00 ${STATS_TZ}` };
}

/** Studio indicators for [from, to] (dates), for one professional or the whole studio (pro = null). */
export async function studioIndicators(sql, { from, to, pro = null, now = new Date(), store = null }) {
  const { start, end } = rangeUtc(from, to);
  const proCond = pro ? sql`and e.professional_id = ${pro}` : sql``;
  const reqs = await sql`select e.status, e.cancelled_by, e.approved_at, e.created_at, e.cancelled_at, e.start_at, e.assigned, e.professional_id
    from events e where e.kind = 'primo_colloquio' and e.source = 'sito'
      and e.created_at >= ${start}::timestamptz and e.created_at < ${end}::timestamptz ${proCond}`;
  const requests = {
    total: reqs.length,
    accepted: reqs.filter((r) => r.approved_at).length,
    declined: reqs.filter((r) => r.status === 'rifiutato' && r.cancelled_by === 'studio').length,
    expired: reqs.filter((r) => r.status === 'rifiutato' && r.cancelled_by === 'sistema').length,
    waiting: reqs.filter((r) => r.status === 'in_attesa').length,
    withdrawn: reqs.filter((r) => r.status === 'annullato' && !r.approved_at).length,
    assigned: reqs.filter((r) => r.assigned).length,
  };
  const answered = reqs.filter((r) => r.approved_at || (r.status === 'rifiutato' && r.cancelled_by === 'studio'))
    .map((r) => (new Date(r.approved_at || r.cancelled_at) - new Date(r.created_at)) / 3600000);
  const response = { medianHours: round1(median(answered)), within24: answered.filter((h) => h <= 24).length, answered: answered.length };
  const leads = reqs.filter((r) => r.approved_at).map((r) => (new Date(r.start_at) - new Date(r.created_at)) / 86400000);
  const lead = { medianDays: round1(median(leads)), n: leads.length };

  // Appointments scheduled in the period (first meetings and sessions).
  const appts = await sql`select e.kind, e.status, e.cancelled_by, e.cancel_reason, e.approved_at, e.source, e.start_at, e.end_at
    from events e where e.kind in ('primo_colloquio', 'seduta') and e.start_at >= ${start}::timestamptz and e.start_at < ${end}::timestamptz ${proCond}
      and not (e.status in ('in_attesa', 'rifiutato')) and not (e.status = 'annullato' and e.source = 'sito' and e.approved_at is null and e.kind = 'primo_colloquio')`;
  const past = appts.filter((a) => new Date(a.end_at) <= now);
  const cancellations = {
    scheduled: appts.length,
    byPerson: appts.filter((a) => a.status === 'annullato' && a.cancelled_by === 'paziente').length,
    late: appts.filter((a) => a.status === 'annullato' && a.cancel_reason === 'tardivo').length,
    unconfirmed: appts.filter((a) => a.status === 'annullato' && a.cancel_reason === 'non_confermato').length,
    byStudio: appts.filter((a) => a.status === 'annullato' && a.cancelled_by === 'studio' && a.cancel_reason !== 'non_confermato').length,
  };
  const noShow = { past: past.filter((a) => a.status === 'confermato' || a.status === 'non_presentata').length, absent: past.filter((a) => a.status === 'non_presentata').length };

  // Continuity: frozen months from the counters, the others computed now.
  const frozen = await sql`select month, metric, sum(n)::int as n from stats_monthly
    where metric in ('continuita-base', 'continuita-si') and month >= date_trunc('month', ${from}::date) and month <= ${to}::date
      ${pro ? sql`and professional_id = ${pro}` : sql``} group by 1, 2`;
  const frozenMonths = new Set(frozen.map((r) => String(r.month instanceof Date ? r.month.toISOString().slice(0, 10) : r.month)));
  const live = await sql`select date_trunc('month', f.start_at at time zone ${STATS_TZ})::date as month,
      exists (select 1 from events x where x.contact_hash = f.contact_hash and x.kind = 'seduta' and x.status in ('confermato', 'non_presentata')
              and x.start_at > f.start_at and x.start_at <= f.start_at + interval '60 days') as cont
    from events f where f.kind = 'primo_colloquio' and f.status = 'confermato' and f.contact_hash is not null and f.end_at <= ${now}
      and f.start_at >= ${start}::timestamptz and f.start_at < ${end}::timestamptz ${pro ? sql`and f.professional_id = ${pro}` : sql``}`;
  const liveRows = live.filter((r) => !frozenMonths.has(r.month instanceof Date ? r.month.toISOString().slice(0, 10) : String(r.month)));
  const continuity = {
    base: liveRows.length + frozen.filter((r) => r.metric === 'continuita-base').reduce((s, r) => s + r.n, 0),
    yes: liveRows.filter((r) => r.cont).length + frozen.filter((r) => r.metric === 'continuita-si').reduce((s, r) => s + r.n, 0),
  };

  // Occupancy: booked hours / working hours in the period (minus blocks).
  const pros = pro ? [pro] : (await sql`select id from professionals where active`).map((r) => r.id);
  let avail = 0;
  let booked = 0;
  for (const id of pros) {
    const rules = await sql`select weekday, start_time, end_time from availability_rules where professional_id = ${id} and active`;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const wd = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7 + 1;
      for (const r of rules) {
        if (Number(r.weekday) !== wd) continue;
        const [h1, m1] = String(r.start_time).split(':').map(Number);
        const [h2, m2] = String(r.end_time).split(':').map(Number);
        avail += ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60;
      }
    }
    const [b] = await sql`select coalesce(sum(extract(epoch from (least(end_at, ${end}::timestamptz) - greatest(start_at, ${start}::timestamptz))) / 3600), 0)::float as h
      from events where professional_id = ${id} and kind = 'blocco' and status = 'confermato' and start_at < ${end}::timestamptz and end_at > ${start}::timestamptz`;
    const [k] = await sql`select coalesce(sum(extract(epoch from (end_at - start_at)) / 3600), 0)::float as h
      from events where professional_id = ${id} and kind in ('primo_colloquio', 'seduta') and status in ('confermato', 'non_presentata')
        and start_at >= ${start}::timestamptz and start_at < ${end}::timestamptz`;
    // Blocks only reduce working time on working days: capped so the result never goes negative.
    avail -= Math.min(b.h, avail);
    booked += k.h;
  }
  const occupancy = { bookedHours: round1(booked), availableHours: round1(avail) };

  // Free first-meeting times in the next 14 days.
  let freeSlots = null;
  if (store) {
    const settings = await store.getSettings();
    freeSlots = 0;
    const horizon = new Date(now.getTime() + 14 * 86400000);
    for (const id of pros) {
      const rules = await store.getRules(id, { onlyActive: true });
      const busy = await store.busyBetween(id, new Date(now.getTime() - 86400000), new Date(horizon.getTime() + 86400000));
      const seen = new Set();
      for (const mode of ['online', 'studio']) {
        for (const s of availableSlots({ rules, busy, settings, now, mode, duration: 30 })) {
          if (s.start <= horizon && requestOpen(s.start, settings, now)) seen.add(s.start.getTime());
        }
      }
      freeSlots += seen.size;
    }
  }

  // Monthly counters: contact requests per area, "Come ci hai conosciuto?", "Passa alla collega".
  const counters = await sql`select metric, area, lang, professional_id, sum(n)::int as n from stats_monthly
    where month >= date_trunc('month', ${from}::date) and month <= ${to}::date
      and (metric = 'contatto' or metric like 'fonte:%' or metric = 'passata')
      ${pro ? sql`and (professional_id = ${pro} or metric <> 'passata')` : sql``}
    group by 1, 2, 3, 4`;
  const contacts = {};
  const heard = {};
  let passed = 0;
  counters.forEach((r) => {
    if (r.metric === 'contatto') contacts[r.area || 'da_definire'] = (contacts[r.area || 'da_definire'] || 0) + r.n;
    else if (r.metric === 'passata') passed += r.n;
    else { const k = r.metric.slice(6); heard[k] = (heard[k] || 0) + r.n; }
  });
  const perPro = pro ? null : await sql`select professional_id as id, count(*)::int as requests, count(*) filter (where assigned)::int as assigned
    from events where kind = 'primo_colloquio' and source = 'sito' and created_at >= ${start}::timestamptz and created_at < ${end}::timestamptz group by 1`;

  return { requests, response, lead, cancellations, noShow, continuity, occupancy, freeSlots, contacts, heard, passed, perPro };
}

/** Site indicators for [from, to]. */
export async function siteIndicators(sql, { from, to }) {
  const rows = await sql`select page, metric, key, sum(n)::int as n from stats_site_daily
    where day >= ${from}::date and day <= ${to}::date and metric <> 'beacon' group by 1, 2, 3`;
  const daily = await sql`select day, sum(n)::int as n from stats_site_daily where metric = 'view' and day >= ${from}::date and day <= ${to}::date group by 1 order by 1`;
  return { rows, daily: daily.map((r) => ({ day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day), n: r.n })) };
}

/** Email indicators for [from, to]. */
export async function emailIndicators(sql, { from, to, now = new Date() }) {
  const { start, end } = rangeUtc(from, to);
  const types = await sql`select email_type, sum(sent)::int as sent, sum(api_errors)::int as api_errors, sum(delivered)::int as delivered,
      sum(soft_bounce)::int as soft_bounce, sum(hard_bounce)::int as hard_bounce, sum(spam)::int as spam, sum(blocked)::int as blocked
    from stats_email_daily where day >= ${from}::date and day <= ${to}::date group by 1 order by 2 desc`;
  const actions = await sql`select email_type, action, sum(n)::int as n from stats_email_actions_daily
    where day >= ${from}::date and day <= ${to}::date group by 1, 2`;
  const conf = await sql`select reminder_sent_at, confirm_nudge_sent_at, client_confirmed_at from events
    where kind in ('primo_colloquio', 'seduta') and reminder_sent_at is not null and start_at >= ${start}::timestamptz and start_at < ${end}::timestamptz and start_at <= ${now}`;
  const hours = conf.filter((r) => r.client_confirmed_at).map((r) => (new Date(r.client_confirmed_at) - new Date(r.reminder_sent_at)) / 3600000);
  const confirmations = {
    asked: conf.length,
    first: conf.filter((r) => r.client_confirmed_at && (!r.confirm_nudge_sent_at || new Date(r.client_confirmed_at) < new Date(r.confirm_nudge_sent_at))).length,
    second: conf.filter((r) => r.client_confirmed_at && r.confirm_nudge_sent_at && new Date(r.client_confirmed_at) >= new Date(r.confirm_nudge_sent_at)).length,
    never: conf.filter((r) => !r.client_confirmed_at).length,
    medianHours: round1(median(hours)),
  };
  return { types, actions, confirmations };
}
