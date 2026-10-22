// Database access. One small driver ("postgres"), plain SQL.
// Production: Supabase Postgres in an EU region, via its connection pooler.

import postgres from 'postgres';
import { DEFAULT_SETTINGS, normalizeSettings } from './slots.mjs';

let shared;

/** Lazily create one connection pool per function instance. */
export function getSql(env = process.env) {
  if (shared) return shared;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL mancante');
  shared = postgres(env.DATABASE_URL, {
    max: 1,
    prepare: false, // required by the Supabase transaction pooler
    ssl: env.DATABASE_SSL === 'disable' ? false : 'require',
    idle_timeout: 20,
    connect_timeout: 10,
    types: { bigint: postgres.BigInt },
    transform: { undefined: null },
  });
  return shared;
}

export class ConflictError extends Error {
  constructor(message = 'Orario non più disponibile') {
    super(message);
    this.code = 'conflict';
  }
}

function mapConflict(err) {
  if (err && err.code === '23P01') throw new ConflictError();
  throw err;
}

// All agenda writes take one transaction-scoped lock. Concurrent inserts into a
// GiST exclusion constraint can otherwise deadlock; with one studio the
// serialisation costs nothing and every loser gets a clean "conflict".
const AGENDA_LOCK = 724100;

async function withAgendaLock(sql, tx, fn) {
  if (tx !== sql) {
    await tx`select pg_advisory_xact_lock(${AGENDA_LOCK})`;
    return fn(tx);
  }
  return sql.begin(async (t) => {
    await t`select pg_advisory_xact_lock(${AGENDA_LOCK})`;
    return fn(t);
  });
}

const EVENT_COLS = `id::text as id, kind, status, source, mode, service, start_at, end_at, series_id::text as series_id,
  block_title, contact_enc, reminder_sent_at, cancelled_at, cancelled_by, created_at`;

export function createStore(sql) {
  return {
    sql,

    async getKv(key) {
      const [row] = await sql`select value from kv where key = ${key}`;
      return row ? row.value : null;
    },
    async setKv(key, value) {
      await sql`insert into kv (key, value) values (${key}, ${sql.json(value)})
        on conflict (key) do update set value = excluded.value, updated_at = now()`;
    },

    async getSettings() {
      const stored = await this.getKv('settings');
      try {
        return normalizeSettings(stored || {});
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    },
    async saveSettings(input) {
      const s = normalizeSettings(input);
      await this.setKv('settings', s);
      return s;
    },

    async getRules({ onlyActive = false } = {}) {
      const rows = await sql`select id::text as id, weekday, to_char(start_time, 'HH24:MI') as start_time,
        to_char(end_time, 'HH24:MI') as end_time, mode, public, active
        from availability_rules ${onlyActive ? sql`where active` : sql``}
        order by weekday, start_time`;
      return rows.map((r) => ({ ...r, weekday: Number(r.weekday) }));
    },
    async replaceRules(rules) {
      await sql.begin(async (tx) => {
        await tx`delete from availability_rules`;
        for (const r of rules) {
          await tx`insert into availability_rules (weekday, start_time, end_time, mode, public, active)
            values (${r.weekday}, ${r.start_time}, ${r.end_time}, ${r.mode}, ${r.public}, ${r.active})`;
        }
      });
      return this.getRules();
    },

    /** Confirmed events overlapping [from, to). */
    async busyBetween(from, to) {
      return sql`select start_at, end_at from events
        where status = 'confermato' and start_at < ${to} and end_at > ${from}`;
    },

    async eventsBetween(from, to, { includeCancelled = false } = {}) {
      return sql.unsafe(
        `select ${EVENT_COLS} from events
         where start_at < $2 and end_at > $1 ${includeCancelled ? '' : "and status = 'confermato'"}
         order by start_at`,
        [from, to],
      );
    },

    async getEvent(id, tx = sql) {
      const [row] = await tx.unsafe(`select ${EVENT_COLS}, manage_token_hash from events where id = $1`, [String(id)]);
      return row || null;
    },

    async findByTokenHash(hash) {
      const [row] = await sql.unsafe(`select ${EVENT_COLS} from events where manage_token_hash = $1`, [hash]);
      return row || null;
    },

    async insertEvent(e, tx = sql) {
      try {
        const [row] = await withAgendaLock(sql, tx, (t) => t`insert into events
          (kind, source, mode, service, start_at, end_at, series_id, block_title, contact_enc, contact_hash, manage_token_hash)
          values (${e.kind}, ${e.source}, ${e.mode ?? null}, ${e.service ?? null}, ${e.start_at}, ${e.end_at}, ${e.series_id ?? null},
                  ${e.block_title ?? null}, ${e.contact_enc ?? null}, ${e.contact_hash ?? null}, ${e.manage_token_hash ?? null})
          returning id::text as id`);
        return row.id;
      } catch (err) {
        return mapConflict(err);
      }
    },

    async updateEvent(id, patch, tx = sql) {
      const allowed = ['mode', 'service', 'start_at', 'end_at', 'block_title', 'contact_enc', 'contact_hash', 'manage_token_hash', 'reminder_sent_at'];
      const cols = Object.keys(patch).filter((k) => allowed.includes(k));
      if (!cols.length) return;
      try {
        await withAgendaLock(sql, tx, (t) => t`update events set ${t(patch, cols)} where id = ${String(id)}`);
      } catch (err) {
        mapConflict(err);
      }
    },

    async cancelEvent(id, by, tx = sql) {
      const rows = await tx`update events set status = 'annullato', cancelled_at = now(), cancelled_by = ${by}
        where id = ${String(id)} and status = 'confermato' returning id`;
      return rows.length > 0;
    },

    async cancelSeriesFrom(seriesId, from, tx = sql) {
      const rows = await tx`update events set status = 'annullato', cancelled_at = now(), cancelled_by = 'studio'
        where series_id = ${String(seriesId)} and status = 'confermato' and start_at >= ${from} returning id`;
      return rows.length;
    },

    async createSeries(intervalWeeks, tx = sql) {
      const [row] = await tx`insert into series (interval_weeks) values (${intervalWeeks}) returning id::text as id`;
      return row.id;
    },

    async countActiveFirstByContact(contactHash, now) {
      const [row] = await sql`select count(*)::int as n from events
        where contact_hash = ${contactHash} and status = 'confermato' and kind = 'primo_colloquio' and end_at > ${now}`;
      return row.n;
    },

    // ----- rate limiting -----
    async countRate(action, keyHash, sinceMinutes, { onlyFailures = false } = {}) {
      const [row] = await sql`select count(*)::int as n from rate_events
        where action = ${action} and key_hash = ${keyHash}
          and at > now() - make_interval(mins => ${sinceMinutes})
          ${onlyFailures ? sql`and not ok` : sql``}`;
      return row.n;
    },
    async recordRate(action, keyHash, ok = false) {
      await sql`insert into rate_events (action, key_hash, ok) values (${action}, ${keyHash}, ${ok})`;
    },

    // ----- contact requests -----
    async insertRequest(contactEnc, mode, service = null) {
      const [row] = await sql`insert into contact_requests (contact_enc, mode, service)
        values (${contactEnc}, ${mode}, ${service}) returning id::text as id`;
      return row.id;
    },
    async listRequests() {
      return sql`select id::text as id, contact_enc, mode, service, created_at, handled_at
        from contact_requests order by handled_at nulls first, created_at desc limit 200`;
    },
    async markRequest(id, handled) {
      await sql`update contact_requests set handled_at = ${handled ? sql`now()` : null} where id = ${String(id)}`;
    },
    async deleteRequest(id) {
      await sql`delete from contact_requests where id = ${String(id)}`;
    },

    // ----- scheduled jobs -----
    async dueReminders(now, hours) {
      return sql.unsafe(
        `select ${EVENT_COLS} from events
         where status = 'confermato' and kind <> 'blocco' and contact_enc is not null
           and reminder_sent_at is null
           and start_at > $1 and start_at <= $1::timestamptz + make_interval(hours => $2::int)
           and created_at < $1::timestamptz - interval '1 hour'
         order by start_at limit 100`,
        [now, hours],
      );
    },
    async markReminderSent(id) {
      await sql`update events set reminder_sent_at = now() where id = ${String(id)}`;
    },
    async applyRetention(now, months, requestMonths) {
      const ev = await sql`update events set contact_enc = null, contact_hash = null, manage_token_hash = null
        where end_at < ${now}::timestamptz - make_interval(months => ${months}) and contact_enc is not null
        returning id`;
      const rq = await sql`delete from contact_requests
        where created_at < ${now}::timestamptz - make_interval(months => ${requestMonths}) returning id`;
      const rt = await sql`delete from rate_events where at < ${now}::timestamptz - interval '7 days' returning id`;
      return { events: ev.length, requests: rq.length, rate: rt.length };
    },
  };
}
