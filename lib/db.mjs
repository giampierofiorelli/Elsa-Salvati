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
  if (err && err.code === '23505') {
    const e = new Error('Valore già in uso');
    e.code = 'duplicate';
    e.detail = err.constraint_name;
    throw e;
  }
  throw err;
}

// All agenda writes take one transaction-scoped lock. Concurrent inserts into a
// GiST exclusion constraint can otherwise deadlock; at a studio's volume the
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

const EVENT_COLS = `e.id::text as id, e.professional_id::text as professional_id, e.service_id::text as service_id,
  e.kind, e.status, e.source, e.mode, e.start_at, e.end_at, e.series_id::text as series_id,
  e.block_title, e.contact_enc, e.reminder_sent_at, e.cancelled_at, e.cancelled_by, e.created_at,
  p.name as professional_name, p.notify_email as professional_email, s.name as service_name`;
const EVENT_FROM = `events e join professionals p on p.id = e.professional_id left join services s on s.id = e.service_id`;

const USER_COLS = `id::text as id, email, name, role, professional_id::text as professional_id, password_hash,
  totp_secret_enc, totp_pending_enc, totp_last, invite_expires_at, active, enrolled_at, created_at`;

const id = (v) => (v === null || v === undefined || v === '' ? null : String(v));

export function createStore(sql) {
  return {
    sql,

    // ---------- settings / kv ----------
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

    // ---------- catalog ----------
    async listCategories() {
      return sql`select id::text as id, slug, name, intro, sort, active from categories order by sort, id`;
    },
    async updateCategory(catId, patch) {
      const cols = ['name', 'intro', 'sort', 'active'].filter((k) => patch[k] !== undefined);
      if (cols.length) await sql`update categories set ${sql(patch, cols)} where id = ${id(catId)}`;
    },
    async listServices({ onlyActive = false } = {}) {
      return sql`select s.id::text as id, s.category_id::text as category_id, c.slug as category, s.slug, s.name,
          s.description, s.duration_minutes, s.price_text, s.sort, s.active
        from services s join categories c on c.id = s.category_id
        ${onlyActive ? sql`where s.active and c.active` : sql``}
        order by c.sort, s.sort, s.id`;
    },
    async getService(serviceId) {
      const [row] = await sql`select id::text as id, category_id::text as category_id, slug, name, description,
        duration_minutes, price_text, active from services where id = ${id(serviceId)}`;
      return row || null;
    },
    async insertService(s) {
      try {
        const [row] = await sql`insert into services (category_id, slug, name, description, duration_minutes, price_text, sort, active)
          values (${s.category_id}, ${s.slug}, ${s.name}, ${s.description}, ${s.duration_minutes}, ${s.price_text}, ${s.sort}, ${s.active})
          returning id::text as id`;
        return row.id;
      } catch (err) { return mapConflict(err); }
    },
    async updateService(serviceId, patch) {
      const cols = ['category_id', 'slug', 'name', 'description', 'duration_minutes', 'price_text', 'sort', 'active'].filter((k) => patch[k] !== undefined);
      if (!cols.length) return;
      try { await sql`update services set ${sql(patch, cols)} where id = ${id(serviceId)}`; } catch (err) { mapConflict(err); }
    },

    async listProfessionals({ onlyActive = false } = {}) {
      return sql`select id::text as id, slug, name, title, bio, albo, photo, notify_email, sort, active
        from professionals ${onlyActive ? sql`where active` : sql``} order by sort, id`;
    },
    async getProfessional(proId) {
      const [row] = await sql`select id::text as id, slug, name, title, bio, albo, photo, notify_email, sort, active
        from professionals where id = ${id(proId)}`;
      return row || null;
    },
    async insertProfessional(p) {
      try {
        const [row] = await sql`insert into professionals (slug, name, title, bio, albo, photo, notify_email, sort, active)
          values (${p.slug}, ${p.name}, ${p.title}, ${p.bio}, ${p.albo}, ${p.photo}, ${p.notify_email}, ${p.sort}, ${p.active})
          returning id::text as id`;
        return row.id;
      } catch (err) { return mapConflict(err); }
    },
    async updateProfessional(proId, patch) {
      const cols = ['slug', 'name', 'title', 'bio', 'albo', 'photo', 'notify_email', 'sort', 'active'].filter((k) => patch[k] !== undefined);
      if (!cols.length) return;
      try { await sql`update professionals set ${sql(patch, cols)} where id = ${id(proId)}`; } catch (err) { mapConflict(err); }
    },
    async listOfferings() {
      return sql`select professional_id::text as professional_id, service_id::text as service_id, in_studio, online
        from professional_services`;
    },
    async getOffering(proId, serviceId) {
      const [row] = await sql`select in_studio, online from professional_services
        where professional_id = ${id(proId)} and service_id = ${id(serviceId)}`;
      return row || null;
    },
    async replaceOfferings(proId, offerings) {
      await sql.begin(async (tx) => {
        await tx`delete from professional_services where professional_id = ${id(proId)}`;
        for (const o of offerings) {
          await tx`insert into professional_services (professional_id, service_id, in_studio, online)
            values (${id(proId)}, ${id(o.service_id)}, ${o.in_studio}, ${o.online})`;
        }
      });
    },

    // ---------- users ----------
    async countUsers() {
      const [row] = await sql`select count(*)::int as n from users`;
      return row.n;
    },
    async listUsers() {
      return sql`select u.id::text as id, u.email, u.name, u.role, u.professional_id::text as professional_id,
          u.active, u.enrolled_at, u.invite_expires_at, u.created_at, p.name as professional_name
        from users u left join professionals p on p.id = u.professional_id order by u.created_at`;
    },
    async getUser(userId) {
      const [row] = await sql.unsafe(`select ${USER_COLS} from users where id = $1`, [id(userId)]);
      return row || null;
    },
    async getUserByEmail(email) {
      const [row] = await sql.unsafe(`select ${USER_COLS} from users where lower(email) = lower($1)`, [email]);
      return row || null;
    },
    async getUserByInvite(hash) {
      const [row] = await sql.unsafe(`select ${USER_COLS} from users where invite_token_hash = $1 and invite_expires_at > now()`, [hash]);
      return row || null;
    },
    async getUserByIcs(hash) {
      const [row] = await sql.unsafe(`select ${USER_COLS} from users where ics_token_hash = $1 and active`, [hash]);
      return row || null;
    },
    async insertUser(u) {
      try {
        const [row] = await sql`insert into users (email, name, role, professional_id, invite_token_hash, invite_expires_at)
          values (${u.email}, ${u.name}, ${u.role}, ${id(u.professional_id)}, ${u.invite_token_hash}, ${u.invite_expires_at})
          returning id::text as id`;
        return row.id;
      } catch (err) { return mapConflict(err); }
    },
    async updateUser(userId, patch) {
      const allowed = ['name', 'role', 'professional_id', 'password_hash', 'totp_secret_enc', 'totp_pending_enc', 'totp_last',
        'invite_token_hash', 'invite_expires_at', 'ics_token_hash', 'active', 'enrolled_at'];
      const cols = Object.keys(patch).filter((k) => allowed.includes(k));
      if (!cols.length) return;
      const p = { ...patch };
      if ('professional_id' in p) p.professional_id = id(p.professional_id);
      try { await sql`update users set ${sql(p, cols)} where id = ${id(userId)}`; } catch (err) { mapConflict(err); }
    },
    /** Atomically accept a TOTP step only if newer than the last one used. */
    async useTotpStep(userId, counter) {
      const rows = await sql`update users set totp_last = ${counter} where id = ${id(userId)} and totp_last < ${counter} returning id`;
      return rows.length > 0;
    },

    // ---------- weekly hours ----------
    async getRules(proId, { onlyActive = false } = {}) {
      const rows = await sql`select id::text as id, professional_id::text as professional_id, weekday,
          to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time, mode, public, active
        from availability_rules
        where ${proId ? sql`professional_id = ${id(proId)}` : sql`true`} ${onlyActive ? sql`and active` : sql``}
        order by professional_id, weekday, start_time`;
      return rows.map((r) => ({ ...r, weekday: Number(r.weekday) }));
    },
    async replaceRules(proId, rules) {
      await sql.begin(async (tx) => {
        await tx`delete from availability_rules where professional_id = ${id(proId)}`;
        for (const r of rules) {
          await tx`insert into availability_rules (professional_id, weekday, start_time, end_time, mode, public, active)
            values (${id(proId)}, ${r.weekday}, ${r.start_time}, ${r.end_time}, ${r.mode}, ${r.public}, ${r.active})`;
        }
      });
      return this.getRules(proId);
    },

    // ---------- events ----------
    /** Confirmed events of one professional overlapping [from, to). */
    async busyBetween(proId, from, to) {
      return sql`select start_at, end_at from events
        where professional_id = ${id(proId)} and status = 'confermato' and start_at < ${to} and end_at > ${from}`;
    },
    async eventsBetween(from, to, { professionalId = null, includeCancelled = false } = {}) {
      return sql.unsafe(
        `select ${EVENT_COLS} from ${EVENT_FROM}
         where e.start_at < $2 and e.end_at > $1
           ${professionalId ? 'and e.professional_id = $3' : ''}
           ${includeCancelled ? '' : "and e.status = 'confermato'"}
         order by e.start_at`,
        professionalId ? [from, to, id(professionalId)] : [from, to],
      );
    },
    async getEvent(eventId, tx = sql) {
      const [row] = await tx.unsafe(`select ${EVENT_COLS}, e.manage_token_hash, e.contact_hash from ${EVENT_FROM} where e.id = $1`, [id(eventId)]);
      return row || null;
    },
    async findByTokenHash(hash) {
      const [row] = await sql.unsafe(`select ${EVENT_COLS}, e.contact_hash from ${EVENT_FROM} where e.manage_token_hash = $1`, [hash]);
      return row || null;
    },
    async insertEvent(e, tx = sql) {
      try {
        const [row] = await withAgendaLock(sql, tx, (t) => t`insert into events
          (professional_id, service_id, kind, source, mode, start_at, end_at, series_id, block_title, contact_enc, contact_hash, manage_token_hash)
          values (${id(e.professional_id)}, ${id(e.service_id)}, ${e.kind}, ${e.source}, ${e.mode ?? null}, ${e.start_at}, ${e.end_at},
                  ${id(e.series_id)}, ${e.block_title ?? null}, ${e.contact_enc ?? null}, ${e.contact_hash ?? null}, ${e.manage_token_hash ?? null})
          returning id::text as id`);
        return row.id;
      } catch (err) {
        return mapConflict(err);
      }
    },
    async updateEvent(eventId, patch, tx = sql) {
      const allowed = ['mode', 'service_id', 'start_at', 'end_at', 'block_title', 'contact_enc', 'contact_hash', 'manage_token_hash', 'reminder_sent_at'];
      const cols = Object.keys(patch).filter((k) => allowed.includes(k));
      if (!cols.length) return;
      const p = { ...patch };
      if ('service_id' in p) p.service_id = id(p.service_id);
      try {
        await withAgendaLock(sql, tx, (t) => t`update events set ${t(p, cols)} where id = ${id(eventId)}`);
      } catch (err) {
        mapConflict(err);
      }
    },
    async cancelEvent(eventId, by, tx = sql) {
      const rows = await tx`update events set status = 'annullato', cancelled_at = now(), cancelled_by = ${by}
        where id = ${id(eventId)} and status = 'confermato' returning id`;
      return rows.length > 0;
    },
    async cancelSeriesFrom(seriesId, from, tx = sql) {
      const rows = await tx`update events set status = 'annullato', cancelled_at = now(), cancelled_by = 'studio'
        where series_id = ${id(seriesId)} and status = 'confermato' and start_at >= ${from} returning id`;
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

    // ---------- rate limiting ----------
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

    // ---------- contact requests ----------
    async insertRequest(r) {
      const [row] = await sql`insert into contact_requests (contact_enc, mode, category, service_id, professional_id)
        values (${r.contact_enc}, ${r.mode}, ${r.category}, ${id(r.service_id)}, ${id(r.professional_id)}) returning id::text as id`;
      return row.id;
    },
    async listRequests({ professionalId = null } = {}) {
      return sql`select r.id::text as id, r.contact_enc, r.mode, r.category, r.created_at, r.handled_at,
          r.professional_id::text as professional_id, p.name as professional_name, s.name as service_name
        from contact_requests r left join professionals p on p.id = r.professional_id left join services s on s.id = r.service_id
        ${professionalId ? sql`where r.professional_id = ${id(professionalId)}` : sql``}
        order by r.handled_at nulls first, r.created_at desc limit 200`;
    },
    async getRequest(reqId) {
      const [row] = await sql`select id::text as id, professional_id::text as professional_id from contact_requests where id = ${id(reqId)}`;
      return row || null;
    },
    async markRequest(reqId, handled) {
      await sql`update contact_requests set handled_at = ${handled ? sql`now()` : null} where id = ${id(reqId)}`;
    },
    async deleteRequest(reqId) {
      await sql`delete from contact_requests where id = ${id(reqId)}`;
    },

    // ---------- scheduled jobs ----------
    async dueReminders(now, hours) {
      return sql.unsafe(
        `select ${EVENT_COLS} from ${EVENT_FROM}
         where e.status = 'confermato' and e.kind <> 'blocco' and e.contact_enc is not null
           and e.reminder_sent_at is null
           and e.start_at > $1 and e.start_at <= $1::timestamptz + make_interval(hours => $2::int)
           and e.created_at < $1::timestamptz - interval '1 hour'
         order by e.start_at limit 100`,
        [now, hours],
      );
    },
    async markReminderSent(eventId) {
      await sql`update events set reminder_sent_at = now() where id = ${id(eventId)}`;
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
