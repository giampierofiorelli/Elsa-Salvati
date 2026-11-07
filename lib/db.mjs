// Database access. One small driver ("postgres"), plain SQL.
// Production: Supabase Postgres in an EU region, via its connection pooler.

import postgres from 'postgres';
import { DEFAULT_SETTINGS, normalizeSettings } from './slots.mjs';


/** Lazily create one connection pool per function instance. */
export function createSql(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL mancante');
  return postgres(env.DATABASE_URL, {
    max: 1,
    prepare: false, // required by the Supabase transaction pooler
    max_pipeline: 1, // the pooler stalls on pipelined queries; send one at a time
    ssl: env.DATABASE_SSL === 'disable' ? false : 'require',
    idle_timeout: 20,
    connect_timeout: 10,
    types: { bigint: postgres.BigInt },
    transform: { undefined: null },
  });
}

export class ConflictError extends Error {
  constructor(message = 'Orario non più disponibile') {
    super(message);
    this.code = 'conflict';
  }
}

function mapConflict(err) {
  if (err && err.code === '23P01') throw new ConflictError();
  if (err && err.code === '23503') throw new RangeError('Elemento collegato inesistente (servizio, professionista o area)');
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
  e.block_title, e.contact_enc, e.reminder_sent_at, e.cancelled_at, e.cancelled_by, e.created_at, e.lang, e.assigned,
  e.notify_client, e.client_confirmed_at, e.reminder2_sent_at, e.approved_at, e.confirm_nudge_sent_at, e.cancel_reason,
  p.name as professional_name, p.notify_email as professional_email, s.name as service_name, s.name_en as service_name_en,
  s.price_text as service_price, s.price_text_en as service_price_en`;
const EVENT_FROM = `events e join professionals p on p.id = e.professional_id left join services s on s.id = e.service_id`;

const USER_COLS = `id::text as id, email, name, role, professional_id::text as professional_id, password_hash,
  totp_secret_enc, totp_pending_enc, totp_last, invite_expires_at, active, enrolled_at, created_at, session_epoch, can_edit_site`;

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
      return sql`select id::text as id, slug, name, name_en, intro, intro_en, sort, active from categories order by sort, id`;
    },
    async updateCategory(catId, patch) {
      const cols = ['name', 'name_en', 'intro', 'intro_en', 'sort', 'active'].filter((k) => patch[k] !== undefined);
      if (cols.length) await sql`update categories set ${sql(patch, cols)} where id = ${id(catId)}`;
    },
    async listServices({ onlyActive = false } = {}) {
      return sql`select s.id::text as id, s.category_id::text as category_id, c.slug as category, s.slug, s.name, s.name_en,
          s.description, s.description_en, s.duration_minutes, s.price_text, s.price_text_en, s.first_meeting, s.sort, s.active
        from services s join categories c on c.id = s.category_id
        ${onlyActive ? sql`where s.active and c.active` : sql``}
        order by c.sort, s.sort, s.id`;
    },
    async getService(serviceId) {
      const [row] = await sql`select id::text as id, category_id::text as category_id, slug, name, name_en, description,
        description_en, duration_minutes, price_text, price_text_en, first_meeting, active from services where id = ${id(serviceId)}`;
      return row || null;
    },
    async insertService(s) {
      try {
        const [row] = await sql`insert into services (category_id, slug, name, name_en, description, description_en,
            duration_minutes, price_text, price_text_en, first_meeting, sort, active)
          values (${s.category_id}, ${s.slug}, ${s.name}, ${s.name_en ?? ''}, ${s.description}, ${s.description_en ?? ''},
            ${s.duration_minutes}, ${s.price_text}, ${s.price_text_en ?? ''}, ${s.first_meeting ?? false}, ${s.sort}, ${s.active})
          returning id::text as id`;
        return row.id;
      } catch (err) { return mapConflict(err); }
    },
    async updateService(serviceId, patch) {
      const cols = ['category_id', 'slug', 'name', 'name_en', 'description', 'description_en', 'duration_minutes', 'price_text', 'price_text_en', 'first_meeting', 'sort', 'active'].filter((k) => patch[k] !== undefined);
      if (!cols.length) return;
      try { await sql`update services set ${sql(patch, cols)} where id = ${id(serviceId)}`; } catch (err) { mapConflict(err); }
    },

    async listProfessionals({ onlyActive = false } = {}) {
      return sql`select id::text as id, slug, name, title, title_en, bio, bio_en, albo, photo, languages, notify_email, sort, active
        from professionals ${onlyActive ? sql`where active` : sql``} order by sort, id`;
    },
    async getProfessional(proId) {
      const [row] = await sql`select id::text as id, slug, name, title, title_en, bio, bio_en, albo, photo, languages, notify_email, sort, active
        from professionals where id = ${id(proId)}`;
      return row || null;
    },
    async insertProfessional(p) {
      try {
        const [row] = await sql`insert into professionals (slug, name, title, title_en, bio, bio_en, albo, photo, languages, notify_email, sort, active)
          values (${p.slug}, ${p.name}, ${p.title}, ${p.title_en ?? ''}, ${p.bio}, ${p.bio_en ?? ''}, ${p.albo}, ${p.photo},
            ${sql.array(p.languages ?? ['it'])}, ${p.notify_email}, ${p.sort}, ${p.active})
          returning id::text as id`;
        return row.id;
      } catch (err) { return mapConflict(err); }
    },
    async updateProfessional(proId, patch) {
      const cols = ['slug', 'name', 'title', 'title_en', 'bio', 'bio_en', 'albo', 'photo', 'languages', 'notify_email', 'sort', 'active'].filter((k) => patch[k] !== undefined);
      if (!cols.length) return;
      const p = { ...patch };
      if (p.languages) p.languages = sql.array(p.languages);
      try { await sql`update professionals set ${sql(p, cols)} where id = ${id(proId)}`; } catch (err) { mapConflict(err); }
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
          u.active, u.can_edit_site, u.enrolled_at, u.invite_expires_at, u.created_at, p.name as professional_name
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
    async getUserByInvite(hash, at = new Date()) {
      const [row] = await sql.unsafe(`select ${USER_COLS} from users where invite_token_hash = $1 and invite_expires_at > $2`, [hash, at]);
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
        'invite_token_hash', 'invite_expires_at', 'ics_token_hash', 'active', 'enrolled_at', 'can_edit_site'];
      const cols = Object.keys(patch).filter((k) => allowed.includes(k));
      if (!cols.length) return;
      const p = { ...patch };
      if ('professional_id' in p) p.professional_id = id(p.professional_id);
      try { await sql`update users set ${sql(p, cols)} where id = ${id(userId)}`; } catch (err) { mapConflict(err); }
      // Changing access, role or credentials ends every open session of that account.
      if (cols.some((c) => ['password_hash', 'totp_secret_enc', 'active', 'enrolled_at', 'role', 'can_edit_site'].includes(c))) {
        await sql`update users set session_epoch = session_epoch + 1 where id = ${id(userId)}`;
      }
    },
    async endSessions(userId) {
      await sql`update users set session_epoch = session_epoch + 1 where id = ${id(userId)}`;
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
        where professional_id = ${id(proId)} and status in ('confermato', 'in_attesa') and start_at < ${to} and end_at > ${from}`;
    },
    async eventsBetween(from, to, { professionalId = null, includeCancelled = false } = {}) {
      return sql.unsafe(
        `select ${EVENT_COLS} from ${EVENT_FROM}
         where e.start_at < $2 and e.end_at > $1
           ${professionalId ? 'and e.professional_id = $3' : ''}
           ${includeCancelled ? '' : "and e.status in ('confermato', 'in_attesa')"}
         order by e.start_at`,
        professionalId ? [from, to, id(professionalId)] : [from, to],
      );
    },
    async getEvent(eventId, tx = sql) {
      const [row] = await tx.unsafe(`select ${EVENT_COLS}, e.manage_token_hash, e.contact_hash from ${EVENT_FROM} where e.id = $1`, [id(eventId)]);
      return row || null;
    },
    async findByTokenHash(hash) {
      const [row] = await sql.unsafe(`select ${EVENT_COLS}, e.contact_hash, e.heard_from from ${EVENT_FROM} where e.manage_token_hash = $1`, [hash]);
      return row || null;
    },
    async insertEvent(e, tx = sql) {
      try {
        const [row] = await withAgendaLock(sql, tx, (t) => t`insert into events
          (professional_id, service_id, kind, status, source, mode, start_at, end_at, series_id, block_title, contact_enc, contact_hash, manage_token_hash, created_at, lang, assigned, privacy_version, notify_client, heard_from)
          values (${id(e.professional_id)}, ${id(e.service_id)}, ${e.kind}, ${e.status ?? 'confermato'}, ${e.source}, ${e.mode ?? null}, ${e.start_at}, ${e.end_at},
                  ${id(e.series_id)}, ${e.block_title ?? null}, ${e.contact_enc ?? null}, ${e.contact_hash ?? null}, ${e.manage_token_hash ?? null},
                  ${e.created_at ?? new Date()}, ${e.lang ?? null}, ${e.assigned ?? false}, ${e.privacy_version ?? null}, ${e.notify_client ?? false}, ${e.heard_from ?? null})
          returning id::text as id`);
        return row.id;
      } catch (err) {
        return mapConflict(err);
      }
    },
    async updateEvent(eventId, patch, tx = sql) {
      const allowed = ['mode', 'service_id', 'start_at', 'end_at', 'block_title', 'contact_enc', 'contact_hash', 'manage_token_hash', 'reminder_sent_at', 'reminder2_sent_at', 'notify_client', 'client_confirmed_at', 'lang', 'confirm_nudge_sent_at', 'professional_id', 'assigned'];
      const cols = Object.keys(patch).filter((k) => allowed.includes(k));
      if (!cols.length) return;
      const p = { ...patch };
      if ('service_id' in p) p.service_id = id(p.service_id);
      if ('professional_id' in p) p.professional_id = id(p.professional_id);
      try {
        await withAgendaLock(sql, tx, (t) => t`update events set ${t(p, cols)} where id = ${id(eventId)}`);
      } catch (err) {
        mapConflict(err);
      }
    },
    async cancelEvent(eventId, by, tx = sql, reason = null) {
      const rows = await tx`update events set status = 'annullato', cancelled_at = now(), cancelled_by = ${by}, cancel_reason = ${reason}
        where id = ${id(eventId)} and status in ('confermato', 'in_attesa') returning id`;
      return rows.length > 0;
    },
    async cancelSeriesFrom(seriesId, from, tx = sql) {
      const rows = await tx`update events set status = 'annullato', cancelled_at = now(), cancelled_by = 'studio'
        where series_id = ${id(seriesId)} and status = 'confermato' and start_at >= ${from} returning id`;
      return rows.length;
    },
    /** The professional approves a request: it becomes a confirmed appointment. */
    async approveEvent(eventId, userId) {
      const rows = await sql`update events set status = 'confermato', approved_at = now(), approved_by = ${id(userId)}
        where id = ${id(eventId)} and status = 'in_attesa' returning id`;
      return rows.length > 0;
    },
    /** A request is declined by the professional ('studio') or expires ('sistema'): the time is free again. */
    async declineEvent(eventId, by) {
      const rows = await sql`update events set status = 'rifiutato', cancelled_at = now(), cancelled_by = ${by}, manage_token_hash = null
        where id = ${id(eventId)} and status = 'in_attesa' returning id`;
      return rows.length > 0;
    },
    async pendingEvents({ professionalId = null } = {}) {
      return sql.unsafe(`select ${EVENT_COLS} from ${EVENT_FROM} where e.status = 'in_attesa' ${professionalId ? 'and e.professional_id = $1' : ''} order by e.start_at`,
        professionalId ? [id(professionalId)] : []);
    },
    /** Requests still waiting for appointments before `until` (the job checks each one's deadline). */
    async pendingBefore(until) {
      return sql.unsafe(`select ${EVENT_COLS} from ${EVENT_FROM}
        where e.status = 'in_attesa' and e.start_at <= $1 order by e.start_at limit 200`, [until]);
    },
    async createSeries(intervalWeeks, tx = sql) {
      const [row] = await tx`insert into series (interval_weeks) values (${intervalWeeks}) returning id::text as id`;
      return row.id;
    },
    /** Upcoming confirmed appointments per professional (used to share out "help me choose" bookings). */
    async upcomingLoad(proIds, now) {
      if (!proIds.length) return new Map();
      const rows = await sql`select professional_id::text as id, count(*)::int as n from events
        where status in ('confermato', 'in_attesa') and kind <> 'blocco' and end_at > ${now}
          and professional_id in ${sql(proIds.map(id))}
        group by professional_id`;
      return new Map(rows.map((r) => [r.id, r.n]));
    },
    async countActiveFirstByContact(contactHash, now) {
      const [row] = await sql`select count(*)::int as n from events
        where contact_hash = ${contactHash} and status in ('confermato', 'in_attesa') and kind = 'primo_colloquio' and end_at > ${now}`;
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
      const [row] = await sql`insert into contact_requests (contact_enc, mode, category, service_id, professional_id, lang, contact_hash, privacy_version)
        values (${r.contact_enc}, ${r.mode}, ${r.category}, ${id(r.service_id)}, ${id(r.professional_id)}, ${r.lang ?? null},
                ${r.contact_hash ?? null}, ${r.privacy_version ?? null}) returning id::text as id`;
      return row.id;
    },
    async listRequests({ professionalId = null } = {}) {
      return sql`select r.id::text as id, r.contact_enc, r.mode, r.category, r.lang, r.created_at, r.handled_at,
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

    // ---------- editable pages ----------
    async listSitePages() {
      return sql`select id::text as id, key, lang, path, nav, noindex, draft->>'title' as title,
          draft_updated_at, published_at, (published is null or published <> draft) as has_changes
        from site_pages order by key, lang`;
    },
    async getSitePage(pageId) {
      const [row] = await sql`select id::text as id, key, lang, path, nav, noindex, draft, published, draft_updated_at, published_at,
          (select name from users u where u.id = draft_updated_by) as draft_updated_by_name,
          (select name from users u where u.id = published_by) as published_by_name
        from site_pages where id = ${id(pageId)}`;
      return row || null;
    },
    async getSitePageByPath(path) {
      const [row] = await sql`select id::text as id, key, lang, path, nav, noindex, draft, published from site_pages where path = ${path}`;
      return row || null;
    },
    async allSitePages() {
      return sql`select id::text as id, key, lang, path, nav, noindex, draft, published from site_pages`;
    },
    /** First content of a page (from the files in content/pages): only if the page is not there yet. */
    async seedSitePage(pg) {
      const content = { title: pg.title, description: pg.description || '', blocks: pg.blocks };
      const rows = await sql`insert into site_pages (key, lang, path, nav, noindex, draft, published, published_at)
        values (${pg.key}, ${pg.lang}, ${pg.path}, ${pg.nav || ''}, ${!!pg.noindex}, ${sql.json(content)}, ${sql.json(content)}, now())
        on conflict do nothing returning id::text as id`;
      if (rows.length) await sql`insert into site_page_versions (page_id, content, kind) values (${rows[0].id}, ${sql.json(content)}, 'iniziale')`;
      return rows.length > 0;
    },
    /** Save the draft only if nobody saved it in the meantime (expected = the time the editor loaded). */
    async saveSiteDraft(pageId, content, userId, expected) {
      const rows = await sql`update site_pages set draft = ${sql.json(content)}, draft_updated_at = now(), draft_updated_by = ${id(userId)}
        where id = ${id(pageId)} ${expected ? sql`and date_trunc('milliseconds', draft_updated_at) = date_trunc('milliseconds', ${expected}::timestamptz)` : sql``}
        returning draft_updated_at`;
      return rows[0] ? rows[0].draft_updated_at : null;
    },
    async publishSitePage(pageId, userId) {
      return sql.begin(async (tx) => {
        const [row] = await tx`update site_pages set published = draft, published_at = now(), published_by = ${id(userId)}
          where id = ${id(pageId)} returning id, key, lang, path, published`;
        if (!row) return null;
        await tx`insert into site_page_versions (page_id, content, kind, created_by) values (${row.id}, ${tx.json(row.published)}, 'pubblicazione', ${id(userId)})`;
        return { key: row.key, lang: row.lang, path: row.path };
      });
    },
    async listSiteVersions(pageId) {
      return sql`select v.id::text as id, v.kind, v.created_at, u.name as user_name, v.content->>'title' as title
        from site_page_versions v left join users u on u.id = v.created_by
        where v.page_id = ${id(pageId)} order by v.created_at desc limit 50`;
    },
    async restoreSiteVersion(pageId, versionId, userId) {
      return sql.begin(async (tx) => {
        const [v] = await tx`select content from site_page_versions where id = ${id(versionId)} and page_id = ${id(pageId)}`;
        if (!v) return null;
        const [row] = await tx`update site_pages set draft = ${tx.json(v.content)}, draft_updated_at = now(), draft_updated_by = ${id(userId)}
          where id = ${id(pageId)} returning draft_updated_at`;
        return row.draft_updated_at;
      });
    },
    async listSiteGlobals() {
      return sql`select scope, draft, published, draft_updated_at, published_at,
          (select name from users u where u.id = draft_updated_by) as draft_updated_by_name from site_globals`;
    },
    async seedSiteGlobals(scope, data) {
      await sql`insert into site_globals (scope, draft, published, published_at) values (${scope}, ${sql.json(data)}, ${sql.json(data)}, now())
        on conflict (scope) do nothing`;
    },
    async saveGlobalsDraft(scope, data, userId, expected) {
      const rows = await sql`update site_globals set draft = ${sql.json(data)}, draft_updated_at = now(), draft_updated_by = ${id(userId)}
        where scope = ${scope} ${expected ? sql`and date_trunc('milliseconds', draft_updated_at) = date_trunc('milliseconds', ${expected}::timestamptz)` : sql``}
        returning draft_updated_at`;
      return rows[0] ? rows[0].draft_updated_at : null;
    },
    async publishGlobals(scope, userId) {
      const rows = await sql`update site_globals set published = draft, published_at = now(), published_by = ${id(userId)} where scope = ${scope} returning scope`;
      return rows.length > 0;
    },
    async saveImage(imageId, files, userId) {
      for (const f of files) {
        await sql`insert into site_images (id, variant, mime, width, height, bytes, created_by)
          values (${imageId}, ${f.variant}, ${f.mime}, ${f.width}, ${f.height}, ${f.bytes}, ${id(userId)})
          on conflict (id, variant) do nothing`;
      }
    },
    async getImage(imageId, variant) {
      const [row] = await sql`select mime, bytes from site_images where id = ${imageId} and variant = ${variant}`;
      return row || null;
    },

    // ---------- people's rights (find, export, erase) ----------
    async eventsByContact(hashes) {
      return sql.unsafe(`select ${EVENT_COLS}, e.privacy_version from ${EVENT_FROM} where e.contact_hash = any($1) order by e.start_at`, [hashes]);
    },
    async requestsByContact(hashes) {
      return sql`select r.id::text as id, r.contact_enc, r.mode, r.category, r.lang, r.created_at, r.handled_at, r.privacy_version,
          p.name as professional_name from contact_requests r left join professionals p on p.id = r.professional_id
        where r.contact_hash = any(${hashes}) order by r.created_at`;
    },
    async forgetContact(hashes) {
      const ev = await sql`update events set contact_enc = null, contact_hash = null, manage_token_hash = null, heard_from = null
        where contact_hash = any(${hashes}) returning id`;
      const rq = await sql`delete from contact_requests where contact_hash = any(${hashes}) returning id`;
      return { events: ev.length, requests: rq.length };
    },
    async audit(userId, action, detail = '') {
      await sql`insert into audit_log (user_id, action, detail) values (${id(userId)}, ${action}, ${String(detail).slice(0, 200)})`;
    },
    // ---------- texts of the emails (only the ones changed from the admin) ----------
    async getEmailText(key, lang) {
      const [row] = await sql`select key, lang, subject, body, button from email_texts where key = ${key} and lang = ${lang}`;
      return row || null;
    },
    async listEmailTexts() {
      return sql`select t.key, t.lang, t.subject, t.body, t.button, t.updated_at, u.name as updated_by_name
        from email_texts t left join users u on u.id = t.updated_by`;
    },
    async saveEmailText(key, lang, { subject, body, button }, userId) {
      await sql`insert into email_texts (key, lang, subject, body, button, updated_by, updated_at)
        values (${key}, ${lang}, ${subject}, ${sql.json(body)}, ${button}, ${id(userId)}, now())
        on conflict (key, lang) do update set subject = excluded.subject, body = excluded.body, button = excluded.button,
          updated_by = excluded.updated_by, updated_at = now()`;
    },
    async deleteEmailText(key, lang) {
      const rows = await sql`delete from email_texts where key = ${key} and lang = ${lang} returning key`;
      return rows.length > 0;
    },
    async listAudit(limit = 200) {
      return sql`select a.at, a.action, a.detail, u.name as user_name from audit_log a left join users u on u.id = a.user_id
        order by a.at desc limit ${limit}`;
    },

    // ---------- scheduled jobs ----------
    async dueReminders(now, hours) {
      return sql.unsafe(
        `select ${EVENT_COLS} from ${EVENT_FROM}
         where e.status = 'confermato' and e.kind <> 'blocco' and e.contact_enc is not null
           and (e.source = 'sito' or e.notify_client)
           and e.reminder_sent_at is null
           and e.start_at > $1 and e.start_at <= $1::timestamptz + make_interval(hours => $2::int)
           and e.created_at < $1::timestamptz - interval '1 hour'
           -- An appointment arranged with the person less than a day ahead needs no confirmation (research 22).
           and e.created_at <= e.start_at - interval '24 hours'
         order by e.start_at limit 100`,
        [now, hours],
      );
    },
    /** The person confirms they'll attend (once; later clicks keep the first time). */
    /** via: which invitation led to the confirmation ('48h' | '24h' | 'manuale'), kept for the statistics. */
    async confirmByClient(eventId, at, via = null) {
      const [row] = await sql`update events set client_confirmed_at = coalesce(client_confirmed_at, ${at}),
          confirmed_via = coalesce(confirmed_via, ${via})
        where id = ${id(eventId)} and status = 'confermato' returning client_confirmed_at`;
      return row ? row.client_confirmed_at : null;
    },
    /** Short informative reminder a few hours before; not for appointments booked at the last minute. */
    async dueSecondReminders(now, hours) {
      return sql.unsafe(
        `select ${EVENT_COLS} from ${EVENT_FROM}
         where e.status = 'confermato' and e.kind <> 'blocco' and e.contact_enc is not null
           and (e.source = 'sito' or e.notify_client)
           and e.reminder2_sent_at is null
           and e.start_at > $1::timestamptz + interval '15 minutes' and e.start_at <= $1::timestamptz + make_interval(hours => $2::int)
           and e.created_at <= e.start_at - interval '3 hours'
         order by e.start_at limit 100`,
        [now, hours],
      );
    },
    /** Second invitation to confirm: asked already, not confirmed yet, a while after the first request. */
    async dueNudges(now, hours) {
      return sql.unsafe(
        `select ${EVENT_COLS} from ${EVENT_FROM}
         where e.status = 'confermato' and e.kind <> 'blocco' and e.contact_enc is not null
           and (e.source = 'sito' or e.notify_client)
           and e.reminder_sent_at is not null and e.reminder_sent_at < $1::timestamptz - interval '1 hour'
           and e.client_confirmed_at is null and e.confirm_nudge_sent_at is null
           and e.start_at > $1::timestamptz + interval '3 hours' and e.start_at <= $1::timestamptz + make_interval(hours => $2::int)
         order by e.start_at limit 100`,
        [now, hours],
      );
    },
    /** Appointments in a time range whose attendance was asked and not confirmed (the professional's 18:00 notice). */
    async unconfirmedBetween(from, to) {
      return sql.unsafe(
        `select ${EVENT_COLS} from ${EVENT_FROM}
         where e.status = 'confermato' and e.kind <> 'blocco' and e.contact_enc is not null
           and (e.source = 'sito' or e.notify_client)
           and e.reminder_sent_at is not null and e.client_confirmed_at is null
           and e.start_at >= $1 and e.start_at < $2
         order by e.professional_id, e.start_at`,
        [from, to],
      );
    },
    async markSecondReminderSent(eventId) {
      await sql`update events set reminder2_sent_at = now() where id = ${id(eventId)}`;
    },
    async markReminderSent(eventId) {
      await sql`update events set reminder_sent_at = now() where id = ${id(eventId)}`;
    },
    async applyRetention(now, months, requestMonths) {
      // Contacts go a set number of months after the person's LAST appointment (as the privacy notice says).
      const ev = await sql`update events e set contact_enc = null, contact_hash = null, manage_token_hash = null, heard_from = null
        where e.contact_enc is not null
          and (case when e.contact_hash is null then e.end_at
                    else (select max(x.end_at) from events x where x.contact_hash = e.contact_hash) end)
              < ${now}::timestamptz - make_interval(months => ${months})
        returning e.id`;
      const rq = await sql`delete from contact_requests
        where created_at < ${now}::timestamptz - make_interval(months => ${requestMonths}) returning id`;
      const rt = await sql`delete from rate_events where at < ${now}::timestamptz - interval '7 days' returning id`;
      return { events: ev.length, requests: rq.length, rate: rt.length };
    },
  };
}

/** What the mailer needs to find the texts changed from the admin. */
export function emailTextsFrom(sql) {
  return { async get(key, lang) { const [row] = await sql`select subject, body, button from email_texts where key = ${key} and lang = ${lang}`; return row || null; } };
}
