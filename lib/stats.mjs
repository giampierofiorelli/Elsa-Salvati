// Statistics as counters only (research 23): no person, no identifier, no IP, no free text.
// Writes add +1 to a row of a counter table; reads compute indicators for the admin's "Statistiche".

import { zonedParts, zonedToUtc, addDays } from './time.mjs';
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
      const cohorts = await freezeCohorts(sql, now);
      return { continuity: frozen[0].base, cohorts, siteRolled: rolled.length };
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
  // Booking steps reached in this page view (1 area … 5 sent), each at most once.
  if (Array.isArray(msg.steps)) {
    [...new Set(msg.steps.map((x) => clampN(x, 5)).filter(Boolean))].slice(0, 5).forEach((st) => rows.push({ page, metric: 'step', key: String(st), n: 1 }));
  }
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
  return { start: zonedToUtc(from, '00:00', STATS_TZ), end: zonedToUtc(addDays(to, 1), '00:00', STATS_TZ) };
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
  // Contact requests and sources belong to the studio, not to one professional: only in the studio's totals.
  counters.forEach((r) => {
    if (pro && r.metric !== 'passata') return;
    if (r.metric === 'contatto') contacts[r.area || 'da_definire'] = (contacts[r.area || 'da_definire'] || 0) + r.n;
    else if (r.metric === 'passata') passed += r.n;
    else { const k = r.metric.slice(6); heard[k] = (heard[k] || 0) + r.n; }
  });
  const perPro = pro ? null : await sql`select professional_id::text as id, count(*)::int as requests, count(*) filter (where assigned)::int as assigned
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

// ======================================================================
// Statistics v2 (research 25): alerts, crossings, demand × capacity, mature cohorts.
// Fixed tables only, at most 2 dimensions besides time, 12-month windows for outcomes.
// ======================================================================

const DAY = 86400000;
// "Come ci hai conosciuto?" grouped in 4 macro-answers, so groups are not too small (research 25, I3).
export function heardGroup(code) {
  if (code === 'passaparola' || code === 'professionista') return 'passaparola';
  if (code === 'ricerca' || code === 'instagram' || code === 'linkedin') return 'internet';
  if (code === 'azienda') return 'azienda';
  return 'altro';
}
const LEAD_BANDS = [[0, 3, '0-3'], [4, 7, '4-7'], [8, 14, '8-14'], [15, Infinity, '15+']];
const leadBand = (days) => (LEAD_BANDS.find(([a, b]) => days >= a && days <= b) || LEAD_BANDS[3])[2];
const respBand = (h) => (h < 4 ? '<4' : h <= 24 ? '4-24' : '>24');

/**
 * Small groups in shared views: 1–4 → -1 ("meno di 5"). Secondary suppression: when a row shows its total
 * and exactly one cell is hidden, the next smallest cell is hidden too, so nothing can be worked out by subtraction.
 */
export function suppressRows(rows, cells, base) {
  rows.forEach((r) => {
    if (r[base] > 0 && r[base] < 5) { [base].concat(cells).forEach((k) => { if (r[k] !== null && r[k] !== undefined) r[k] = r[k] > 0 ? -1 : r[k]; }); return; }
    cells.forEach((k) => { if (r[k] > 0 && r[k] < 5) r[k] = -1; });
    const hidden = cells.filter((k) => r[k] === -1);
    if (hidden.length === 1 && r[base] > 0) {
      const next = cells.filter((k) => r[k] > 0).sort((a, b) => r[a] - r[b])[0];
      if (next) r[next] = -1;
    }
  });
  return rows;
}

async function firstMeetingsWindow(sql, { from, to, pro }) {
  return sql`select e.id, e.created_at, e.approved_at, e.start_at, e.status, e.cancelled_by, e.cancel_reason, e.source,
      e.contact_hash, e.heard_from, coalesce(e.lang, 'it') as lang, coalesce(c.slug, '') as area,
      date_trunc('month', e.start_at at time zone ${STATS_TZ})::date as month,
      (select min(x.start_at) from events x where e.contact_hash is not null and x.contact_hash = e.contact_hash and x.kind = 'seduta'
         and x.status in ('confermato', 'non_presentata') and x.start_at > e.start_at and x.start_at <= e.start_at + interval '90 days') as next_session
    from events e left join services s on s.id = e.service_id left join categories c on c.id = s.category_id
    where e.kind = 'primo_colloquio' and e.start_at >= ${from} and e.start_at < ${to}
      and (e.status in ('confermato', 'non_presentata') or (e.status = 'annullato' and (e.approved_at is not null or e.source = 'manuale')))
      ${pro ? sql`and e.professional_id = ${pro}` : sql``}`;
}

function contFlags(r, now) {
  const start = new Date(r.start_at).getTime();
  const next = r.next_session ? new Date(r.next_session).getTime() : null;
  const out = {};
  [30, 60, 90].forEach((h) => {
    out[`m${h}`] = start + h * DAY <= now.getTime();
    out[`c${h}`] = !!(next && next - start <= h * DAY);
  });
  return out;
}

/** Everything new of the Studio tab. `shared`: small groups suppressed (primary and secondary). */
export async function studioInsights(sql, { pro = null, now = new Date(), store = null, shared = false, isAdminView = false }) {
  const yearAgo = new Date(now.getTime() - 365 * DAY);
  const firsts = await firstMeetingsWindow(sql, { from: yearAgo, to: now, pro });

  // I2 · lead time × outcome (first meetings that have taken place or were cancelled, last 12 months)
  const lead = LEAD_BANDS.map(([, , k]) => ({ band: k, n: 0, presented: 0, absent: 0, cancelled: 0, freed: 0, contBase: 0, cont: 0 }));
  for (const r of firsts) {
    const row = lead.find((x) => x.band === leadBand(Math.floor((new Date(r.start_at) - new Date(r.created_at)) / DAY)));
    row.n += 1;
    if (r.status === 'confermato') {
      row.presented += 1;
      const f = contFlags(r, now);
      if (f.m60) { row.contBase += 1; if (f.c60) row.cont += 1; }
    } else if (r.status === 'non_presentata') row.absent += 1;
    else if (r.cancel_reason === 'non_confermato') row.freed += 1;
    else if (r.cancelled_by === 'paziente') row.cancelled += 1;
  }

  // I1 · response time × outcome (online requests of the last 12 months)
  const reqs = await sql`select e.created_at, e.approved_at, e.cancelled_at, e.status, e.cancelled_by, e.start_at, e.contact_hash,
      (select min(x.start_at) from events x where e.contact_hash is not null and x.contact_hash = e.contact_hash and x.kind = 'seduta'
         and x.status in ('confermato', 'non_presentata') and x.start_at > e.start_at and x.start_at <= e.start_at + interval '90 days') as next_session
    from events e where e.kind = 'primo_colloquio' and e.source = 'sito' and e.created_at >= ${yearAgo} and e.created_at < ${now}
      ${pro ? sql`and e.professional_id = ${pro}` : sql``}`;
  const resp = ['<4', '4-24', '>24'].map((k) => ({ band: k, n: 0, accepted: 0, pastBase: 0, presented: 0, contBase: 0, cont: 0 }));
  let expired = 0;
  for (const r of reqs) {
    if (r.status === 'rifiutato' && r.cancelled_by === 'sistema') { expired += 1; continue; }
    const answeredAt = r.approved_at || (r.status === 'rifiutato' && r.cancelled_by === 'studio' ? r.cancelled_at : null);
    if (!answeredAt) continue;
    const row = resp.find((x) => x.band === respBand((new Date(answeredAt) - new Date(r.created_at)) / 3600000));
    row.n += 1;
    if (!r.approved_at) continue; // a decline for a full agenda says nothing about speed
    row.accepted += 1;
    if (new Date(r.start_at) <= now && (r.status === 'confermato' || r.status === 'non_presentata')) {
      row.pastBase += 1;
      if (r.status === 'confermato') {
        row.presented += 1;
        const f = contFlags(r, now);
        if (f.m60) { row.contBase += 1; if (f.c60) row.cont += 1; }
      }
    }
  }

  // I6 · which invitation led to the confirmation × attendance (all appointments asked to confirm, last 12 months)
  const asked = await sql`select status, cancel_reason, confirmed_via, client_confirmed_at, confirm_nudge_sent_at from events
    where kind in ('primo_colloquio', 'seduta') and reminder_sent_at is not null and start_at >= ${yearAgo} and start_at <= ${now}
      and status in ('confermato', 'non_presentata', 'annullato') ${pro ? sql`and professional_id = ${pro}` : sql``}`;
  const conf = ['48h', '24h', 'mai', 'liberato'].map((k) => ({ group: k, n: 0, held: 0, absent: 0, late: 0 }));
  for (const r of asked) {
    let g;
    if (r.cancel_reason === 'non_confermato') g = 'liberato';
    else if (!r.client_confirmed_at) g = 'mai';
    else g = r.confirmed_via === '24h' || (!r.confirmed_via && r.confirm_nudge_sent_at && new Date(r.client_confirmed_at) >= new Date(r.confirm_nudge_sent_at)) ? '24h' : '48h';
    const row = conf.find((x) => x.group === g);
    row.n += 1;
    if (r.status === 'confermato') row.held += 1;
    else if (r.status === 'non_presentata') row.absent += 1;
    else if (r.cancel_reason === 'tardivo') row.late += 1;
  }

  // Mature cohorts: first meetings of each month, followed by a session within 30/60/90 days.
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 10));
  }
  const frozen = await sql`select month, area, metric, sum(n)::int as n from stats_monthly
    where metric like 'coorte-%' and month >= ${months[0]}::date ${pro ? sql`and professional_id = ${pro}` : sql``} group by 1, 2, 3`;
  const mkey = (m) => (m instanceof Date ? m.toISOString().slice(0, 10) : String(m));
  const frozenMonths = new Set(frozen.filter((r) => r.area === 'tutti').map((r) => mkey(r.month)));
  const cohorts = months.map((m) => {
    const end = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1));
    const row = { month: m, base: 0, presented: 0, c30: 0, c60: 0, c90: 0, mature30: end.getTime() + 30 * DAY <= now.getTime(), mature60: end.getTime() + 60 * DAY <= now.getTime(), mature90: end.getTime() + 90 * DAY <= now.getTime() };
    if (frozenMonths.has(m)) {
      frozen.filter((r) => mkey(r.month) === m && r.area === 'tutti').forEach((r) => {
        const k = r.metric.slice(7);
        if (k === 'base') row.base = r.n; else if (k === 'presentata') row.presented = r.n; else row[`c${k}`] = r.n;
      });
      row.frozen = true;
      return row;
    }
    for (const r of firsts.filter((x) => mkey(x.month) === m && x.status !== 'annullato')) {
      row.base += 1;
      if (r.status !== 'confermato') continue;
      row.presented += 1;
      const f = contFlags(r, now);
      if (f.c30) row.c30 += 1;
      if (f.c60) row.c60 += 1;
      if (f.c90) row.c90 += 1;
    }
    return row;
  });
  // Continuity at 60 days over 12 months, by area or by source (never both together).
  const byDim = (dimOf, prefix) => {
    const map = {};
    for (const r of firsts.filter((x) => x.status !== 'annullato' && !frozenMonths.has(mkey(x.month)))) {
      const k = dimOf(r);
      const row = map[k] = map[k] || { key: k, base: 0, presented: 0, contBase: 0, cont: 0 };
      row.base += 1;
      if (r.status !== 'confermato') continue;
      row.presented += 1;
      const f = contFlags(r, now);
      if (f.m60) { row.contBase += 1; if (f.c60) row.cont += 1; }
    }
    frozen.filter((r) => r.area.startsWith(prefix)).forEach((r) => {
      const k = r.area.slice(prefix.length);
      const row = map[k] = map[k] || { key: k, base: 0, presented: 0, contBase: 0, cont: 0 };
      const m = r.metric.slice(7);
      if (m === 'base') row.base += r.n; else if (m === 'presentata') { row.presented += r.n; row.contBase += r.n; } else if (m === '60') row.cont += r.n;
    });
    return Object.values(map);
  };
  const byArea = byDim((r) => r.area || 'altro', 'area:');
  const bySource = byDim((r) => heardGroup(r.heard_from), 'fonte:');

  // Demand × capacity per area: requests of the last 8 weeks against first-meeting times offered.
  const capacity = await demandCapacity(sql, { pro, now, store });

  // "Cosa richiede attenzione": operative counts, and trends only with enough cases.
  const alerts = [];
  const [w] = await sql`select count(*)::int as n from events where status = 'in_attesa' and created_at < ${new Date(now.getTime() - DAY)}
    ${pro ? sql`and professional_id = ${pro}` : sql``}`;
  if (w.n) alerts.push({ kind: 'act', text: w.n === 1 ? '1 richiesta aspetta risposta da più di 24 ore.' : `${w.n} richieste aspettano risposta da più di 24 ore.` });
  for (const lang of capacity.langs) {
    if (lang.free14 === 0) alerts.push({ kind: 'act', text: `Nelle prossime 2 settimane non ci sono orari da primo colloquio ${lang.lang === 'en' ? 'in inglese' : 'in italiano'}.` });
  }
  for (const a of capacity.areas) {
    if (a.free14 >= 10 && a.requests4w <= 2) alerts.push({ kind: 'idea', text: `${a.name}: molti orari liberi nelle prossime 2 settimane (${a.free14}) e poche richieste nelle ultime 4 settimane (${a.requests4w}). Può valere la pena farla conoscere.` });
    if (a.free14 <= 2 && a.leadMedian != null && a.leadN >= 5 && a.leadMedian >= 10) alerts.push({ kind: 'act', text: `${a.name}: quasi nessun orario libero e l'anticipo è di circa ${Math.round(a.leadMedian)} giorni. Meglio aprire orari che farla conoscere.` });
  }
  const recent = firsts.filter((r) => new Date(r.start_at) >= new Date(now.getTime() - 30 * DAY));
  const leads30 = recent.map((r) => (new Date(r.start_at) - new Date(r.created_at)) / DAY);
  const lm = median(leads30);
  if (leads30.length >= 10 && lm >= 14) alerts.push({ kind: 'trend', text: `L'anticipo mediano dei primi colloqui è salito a ${Math.round(lm)} giorni (ultimi 30 giorni, ${leads30.length} colloqui).` });
  const last90 = await sql`select count(*) filter (where status = 'non_presentata')::int as a, count(*)::int as n from events
    where kind in ('primo_colloquio', 'seduta') and status in ('confermato', 'non_presentata') and end_at <= ${now} and start_at >= ${new Date(now.getTime() - 90 * DAY)}
      ${pro ? sql`and professional_id = ${pro}` : sql``}`;
  if (last90[0].n >= 30 && wilson(last90[0].a, last90[0].n).lo > 0.1) alerts.push({ kind: 'trend', text: `Le assenze senza avviso sono più del solito: ${last90[0].a} su ${last90[0].n} negli ultimi 90 giorni.` });
  if (isAdminView) {
    const [b] = await sql`select coalesce(sum(hard_bounce + blocked), 0)::int as n from stats_email_daily where day >= ${dayOf(new Date(now.getTime() - 7 * DAY))}::date`;
    if (b.n) alerts.push({ kind: 'act', text: `${b.n === 1 ? '1 email non è stata consegnata' : `${b.n} email non sono state consegnate`} negli ultimi 7 giorni (indirizzo sbagliato o bloccato).` });
  }

  // Continuity over the year, before any suppression (a total of many cases).
  const contTotal = { k: lead.reduce((t, r) => t + r.cont, 0), n: lead.reduce((t, r) => t + r.contBase, 0) };
  if (contTotal.n > 0 && contTotal.n < 5 && shared) { contTotal.k = -1; contTotal.n = -1; }
  if (shared) {
    suppressRows(lead, ['presented', 'absent', 'cancelled', 'freed'], 'n');
    suppressRows(lead, ['cont'], 'contBase');
    suppressRows(resp, ['accepted'], 'n');
    suppressRows(resp, ['presented'], 'pastBase');
    suppressRows(resp, ['cont'], 'contBase');
    suppressRows(conf, ['held', 'absent', 'late'], 'n');
    suppressRows(cohorts, ['presented'], 'base');
    suppressRows(cohorts, ['c30', 'c60', 'c90'], 'presented');
    suppressRows(byArea, ['presented'], 'base');
    suppressRows(byArea, ['cont'], 'contBase');
    suppressRows(bySource, ['presented'], 'base');
    suppressRows(bySource, ['cont'], 'contBase');
    if (expired > 0 && expired < 5) expired = -1;
  }
  return { alerts: alerts.slice(0, 6), lead, resp, expired, conf, cohorts, byArea, bySource, capacity, contTotal };
}

/** Wilson score interval (95%) for k successes out of n. */
export function wilson(k, n, z = 1.96) {
  if (!n) return { p: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { p, lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}

/** Demand × capacity per area, and free first-meeting times per language. */
async function demandCapacity(sql, { pro, now, store }) {
  const offers = await sql`select ps.professional_id::text as pro, s.id::text as service, s.duration_minutes as minutes, c.slug, c.name, p.languages
    from professional_services ps join services s on s.id = ps.service_id join categories c on c.id = s.category_id join professionals p on p.id = ps.professional_id
    where s.first_meeting and s.active and p.active ${pro ? sql`and ps.professional_id = ${pro}` : sql``}`;
  const reqs = await sql`select e.created_at, e.start_at, e.approved_at, c.slug from events e join services s on s.id = e.service_id join categories c on c.id = s.category_id
    where e.kind = 'primo_colloquio' and e.source = 'sito' and e.created_at >= ${new Date(now.getTime() - 56 * DAY)} ${pro ? sql`and e.professional_id = ${pro}` : sql``}`;
  const areas = {};
  offers.forEach((o) => { areas[o.slug] = areas[o.slug] || { slug: o.slug, name: o.name, pros: new Set(), minutes: o.minutes }; areas[o.slug].pros.add(o.pro); });
  let settings = null;
  const slotsCache = {};
  async function freeSlots(proId, minutes, until) {
    const k = `${proId}:${minutes}`;
    if (!slotsCache[k]) {
      settings = settings || await store.getSettings();
      const horizon = new Date(now.getTime() + (settings.horizonDays || 60) * DAY);
      const rules = await store.getRules(proId, { onlyActive: true });
      const busy = await store.busyBetween(proId, new Date(now.getTime() - DAY), new Date(horizon.getTime() + DAY));
      const set = new Map();
      for (const mode of ['online', 'studio']) {
        for (const s of availableSlots({ rules, busy, settings, now, mode, duration: minutes })) if (s.start <= horizon && requestOpen(s.start, settings, now)) set.set(s.start.getTime(), s.start);
      }
      slotsCache[k] = [...set.values()];
    }
    return slotsCache[k].filter((d) => d <= until).length;
  }
  const out = [];
  if (store) {
    const in14 = new Date(now.getTime() + 14 * DAY);
    for (const a of Object.values(areas)) {
      let free14 = 0;
      let freeAll = 0;
      for (const p of a.pros) { free14 += await freeSlots(p, a.minutes, in14); freeAll += await freeSlots(p, a.minutes, new Date(8.64e15)); }
      const mine = reqs.filter((r) => r.slug === a.slug);
      const weeks = Array.from({ length: 8 }, (_, i) => mine.filter((r) => { const age = (now - new Date(r.created_at)) / DAY; return age >= i * 7 && age < (i + 1) * 7; }).length);
      const rate = weeks.reduce((s, x) => s + x, 0) / 8;
      const leads = mine.filter((r) => r.approved_at).map((r) => (new Date(r.start_at) - new Date(r.created_at)) / DAY);
      out.push({ slug: a.slug, name: a.name, free14, freeAll, horizonDays: (settings && settings.horizonDays) || 60, rate: Math.round(rate * 10) / 10, weekMin: Math.min(...weeks), weekMax: Math.max(...weeks),
        requests4w: weeks.slice(0, 4).reduce((s, x) => s + x, 0), leadMedian: median(leads), leadN: leads.length, weeksCovered: rate > 0 ? Math.round(freeAll / rate * 10) / 10 : null });
    }
  }
  // Free first-meeting times in the next 14 days per language (pros who work in it).
  const langs = [];
  if (store) {
    const in14 = new Date(now.getTime() + 14 * DAY);
    for (const lang of ['it', 'en']) {
      const who = offers.filter((o) => (o.languages || ['it']).includes(lang));
      if (!who.length) continue;
      const seen = new Set();
      let free = 0;
      for (const o of who) { const k = `${o.pro}:${o.minutes}`; if (seen.has(k)) continue; seen.add(k); free += await freeSlots(o.pro, o.minutes, in14); }
      langs.push({ lang, free14: free });
    }
  }
  return { areas: out.sort((a, b) => a.name.localeCompare(b.name)), langs };
}

/**
 * Retention, statistics v2: once a month's first meetings are 90 days old, their cohort counts (by area and by
 * grouped source) go into stats_monthly, and the source answer is erased from the appointments.
 */
export async function freezeCohorts(sql, now) {
  const cutoff = new Date(now.getTime() - 90 * DAY);
  const due = await sql`select distinct date_trunc('month', start_at at time zone ${STATS_TZ})::date as month from events
    where kind = 'primo_colloquio' and start_at < date_trunc('month', ${cutoff}::timestamptz at time zone ${STATS_TZ}) at time zone ${STATS_TZ}
      and (heard_from is not null or not exists (select 1 from stats_monthly m where m.metric = 'coorte-base' and m.area = 'tutti'
        and m.month = date_trunc('month', events.start_at at time zone ${STATS_TZ})::date))
      and start_at >= ${new Date(now.getTime() - 24 * 31 * DAY)}`;
  let frozenRows = 0;
  for (const { month } of due) {
    const m = month instanceof Date ? month.toISOString().slice(0, 10) : String(month);
    const from = zonedToUtc(m, '00:00', STATS_TZ);
    const nextMonth = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 10);
    const to = zonedToUtc(nextMonth, '00:00', STATS_TZ);
    const exists = await sql`select 1 from stats_monthly where metric = 'coorte-base' and area = 'tutti' and month = ${m}::date limit 1`;
    if (!exists.length) {
      const rows = await sql`select e.professional_id, e.status, e.start_at, e.heard_from, coalesce(c.slug, 'altro') as area,
          (select min(x.start_at) from events x where e.contact_hash is not null and x.contact_hash = e.contact_hash and x.kind = 'seduta'
             and x.status in ('confermato', 'non_presentata') and x.start_at > e.start_at and x.start_at <= e.start_at + interval '90 days') as next_session
        from events e left join services s on s.id = e.service_id left join categories c on c.id = s.category_id
        where e.kind = 'primo_colloquio' and e.status in ('confermato', 'non_presentata') and e.start_at >= ${from} and e.start_at < ${to}`;
      const acc = {};
      const add = (pro, dim, metric) => { const k = `${pro}|${dim}|${metric}`; acc[k] = (acc[k] || 0) + 1; };
      for (const r of rows) {
        const dims = ['tutti', `area:${r.area}`, `fonte:${heardGroup(r.heard_from)}`];
        const f = contFlags(r, new Date(8.64e15));
        for (const d of dims) {
          add(r.professional_id, d, 'coorte-base');
          if (r.status !== 'confermato') continue;
          add(r.professional_id, d, 'coorte-presentata');
          [30, 60, 90].forEach((h) => { if (f[`c${h}`]) add(r.professional_id, d, `coorte-${h}`); });
        }
      }
      // An empty month still gets its marker, so it is not computed again.
      if (!rows.length) acc['0|tutti|coorte-base'] = 0;
      for (const [k, n] of Object.entries(acc)) {
        const [pro, dim, metric] = k.split('|');
        await sql`insert into stats_monthly (month, professional_id, area, lang, metric, n) values (${m}::date, ${pro}, ${dim}, '', ${metric}, ${n})
          on conflict (month, professional_id, area, lang, metric) do nothing`;
        frozenRows += 1;
      }
    }
    await sql`update events set heard_from = null where kind = 'primo_colloquio' and heard_from is not null and start_at >= ${from} and start_at < ${to}`;
  }
  return frozenRows;
}
