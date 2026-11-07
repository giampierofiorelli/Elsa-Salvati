-- Agenda dello studio associato: schema PostgreSQL (Supabase, regione UE).
-- Eseguire con `npm run db:setup` o nell'SQL editor di Supabase.
-- Nessun dato clinico: solo ciò che serve a organizzare gli appuntamenti.
-- Nome, email, telefono e note dei pazienti sono cifrati dall'applicazione
-- (AES-256-GCM) prima di arrivare qui.

-- Serve per impedire sovrapposizioni "per professionista" (uguaglianza + intervallo).
create extension if not exists btree_gist;

create table if not exists kv (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- catalogo ----------

-- Aree principali: Coaching, Psicologia, Psicoterapia.
create table if not exists categories (
  id     bigserial primary key,
  slug   text not null unique,
  name   text not null,
  intro  text not null default '',
  sort   int not null default 0,
  active boolean not null default true
);

insert into categories (slug, name, intro, sort) values
  ('coaching', 'Coaching', 'Percorsi per la vita professionale: scelte di carriera, difficoltà e stress sul lavoro, consulenza per le imprese.', 1),
  ('psicologia', 'Psicologia', 'Consulenza e sostegno psicologico per affrontare momenti di difficoltà e cambiamento.', 2),
  ('psicoterapia', 'Psicoterapia', 'Percorsi di psicoterapia individuale con professionisti di diversi orientamenti.', 3)
on conflict (slug) do nothing;

create table if not exists services (
  id               bigserial primary key,
  category_id      bigint not null references categories(id),
  slug             text not null unique,
  name             text not null,
  description      text not null default '',
  duration_minutes int not null default 50 check (duration_minutes between 15 and 240),
  price_text       text not null default '',
  sort             int not null default 0,
  active           boolean not null default true
);

create table if not exists professionals (
  id           bigserial primary key,
  slug         text not null unique,
  name         text not null,
  title        text not null default '',  -- es. "Psicologa psicoterapeuta"
  bio          text not null default '',
  albo         text not null default '',  -- es. "Ordine degli Psicologi dell'Emilia-Romagna n. 1234"
  photo        text not null default '',  -- nome del file in /assets/img (senza estensione)
  notify_email text not null default '',  -- dove ricevere gli avvisi di nuove prenotazioni
  sort         int not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Quali servizi offre ogni professionista, e in quali modalità.
create table if not exists professional_services (
  professional_id bigint not null references professionals(id) on delete cascade,
  service_id      bigint not null references services(id) on delete cascade,
  in_studio       boolean not null default true,
  online          boolean not null default false,
  primary key (professional_id, service_id),
  check (in_studio or online)
);

-- ---------- account ----------

create table if not exists users (
  id                bigserial primary key,
  email             text not null unique,
  name              text not null,
  role              text not null check (role in ('admin', 'professionista')),
  professional_id   bigint references professionals(id) on delete set null,
  password_hash     text,
  totp_secret_enc   text,           -- segreto dell'app di autenticazione, cifrato
  totp_pending_enc  text,           -- segreto proposto durante l'attivazione
  totp_last         bigint not null default -1,
  invite_token_hash text unique,    -- link di attivazione (SHA-256)
  invite_expires_at timestamptz,
  ics_token_hash    text unique,    -- calendario personale sul telefono
  active            boolean not null default true,
  enrolled_at       timestamptz,
  created_at        timestamptz not null default now()
);

-- ---------- agenda ----------

-- Fasce orarie settimanali di ciascun professionista.
-- public = true: i nuovi pazienti possono prenotare il primo colloquio in questa fascia.
create table if not exists availability_rules (
  id              bigserial primary key,
  professional_id bigint not null references professionals(id) on delete cascade,
  weekday         smallint not null check (weekday between 1 and 7), -- 1 = lunedì (ISO)
  start_time      time not null,
  end_time        time not null,
  mode            text not null default 'entrambi' check (mode in ('studio', 'online', 'entrambi')),
  public          boolean not null default true,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  check (end_time > start_time)
);

create table if not exists series (
  id             bigserial primary key,
  interval_weeks smallint not null default 1 check (interval_weeks between 1 and 8),
  created_at     timestamptz not null default now()
);

create table if not exists events (
  id                bigserial primary key,
  professional_id   bigint not null references professionals(id),
  service_id        bigint references services(id),
  kind              text not null check (kind in ('primo_colloquio', 'seduta', 'blocco')),
  status            text not null default 'confermato' check (status in ('confermato', 'annullato')),
  source            text not null check (source in ('sito', 'manuale')),
  mode              text check (mode in ('studio', 'online')),
  start_at          timestamptz not null,
  end_at            timestamptz not null,
  series_id         bigint references series(id) on delete set null,
  block_title       text,
  contact_enc       text,
  contact_hash      text,
  manage_token_hash text unique,
  reminder_sent_at  timestamptz,
  cancelled_at      timestamptz,
  cancelled_by      text check (cancelled_by in ('paziente', 'studio')),
  created_at        timestamptz not null default now(),
  check (end_at > start_at),
  check (kind <> 'blocco' or contact_enc is null),
  -- Garanzia atomica: un professionista non può avere due impegni confermati sovrapposti.
  constraint events_no_overlap exclude using gist (
    professional_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status = 'confermato')
);

create index if not exists events_start_idx on events (start_at);
create index if not exists events_pro_idx on events (professional_id, start_at);
create index if not exists events_contact_idx on events (contact_hash) where status = 'confermato';
create index if not exists events_series_idx on events (series_id);

create table if not exists contact_requests (
  id              bigserial primary key,
  contact_enc     text not null,
  mode            text check (mode in ('studio', 'online', 'da_definire')),
  category        text check (category in ('coaching', 'psicologia', 'psicoterapia', 'aziende', 'da_definire')),
  service_id      bigint references services(id) on delete set null,
  professional_id bigint references professionals(id) on delete set null,
  created_at      timestamptz not null default now(),
  handled_at      timestamptz
);

create table if not exists rate_events (
  id       bigserial primary key,
  key_hash text not null,
  action   text not null,
  ok       boolean not null default false,
  at       timestamptz not null default now()
);
create index if not exists rate_events_idx on rate_events (action, key_hash, at);

-- ---------- v4: due lingue, primo colloquio, "aiutami a scegliere" ----------
-- Solo modifiche aggiuntive: il codice precedente continua a funzionare.

alter table categories add column if not exists name_en  text not null default '';
alter table categories add column if not exists intro_en text not null default '';

alter table services add column if not exists name_en        text not null default '';
alter table services add column if not exists description_en text not null default '';
alter table services add column if not exists price_text_en  text not null default '';
-- true = primo colloquio conoscitivo gratuito dell'area (prenotabile con "aiutami a scegliere").
alter table services add column if not exists first_meeting  boolean not null default false;

alter table professionals add column if not exists title_en  text not null default '';
alter table professionals add column if not exists bio_en    text not null default '';
-- Lingue in cui la professionista conduce i colloqui ('it', 'en').
alter table professionals add column if not exists languages text[] not null default '{it}';

-- Lingua del colloquio scelta da chi prenota; assigned = professionista assegnata dal sistema.
alter table events add column if not exists lang text check (lang in ('it', 'en'));
alter table events add column if not exists assigned boolean not null default false;

alter table contact_requests add column if not exists lang text check (lang in ('it', 'en'));

-- Sessioni revocabili: cambia a ogni logout, reset, disattivazione o cambio di ruolo.
alter table users add column if not exists session_epoch integer not null default 0;

-- Diritti delle persone: ritrovare le richieste per email (impronta, non l'email in chiaro).
alter table contact_requests add column if not exists contact_hash text;
create index if not exists contact_requests_contact_idx on contact_requests (contact_hash);
create index if not exists events_contact_idx on events (contact_hash);
-- Versione dell'informativa letta da chi prenota o scrive.
alter table events add column if not exists privacy_version text;
alter table contact_requests add column if not exists privacy_version text;

-- Registro degli accessi ai dati personali (ricerche, esportazioni, cancellazioni).
create table if not exists audit_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  user_id   bigint references users(id) on delete set null,
  action    text not null,
  detail    text not null default ''
);
alter table audit_log enable row level security;

insert into categories (slug, name, name_en, intro, sort) values
  ('carriera', 'Orientamento e carriera', 'Career coaching & guidance',
   'Orientamento professionale: capire che lavoro fare e come arrivarci.', 0)
on conflict (slug) do nothing;
update categories set name_en = 'Workplace coaching' where slug = 'coaching' and name_en = '';
update categories set name_en = 'Psychological support' where slug = 'psicologia' and name_en = '';
update categories set name_en = 'Psychotherapy' where slug = 'psicoterapia' and name_en = '';

do $$ begin
  alter table contact_requests drop constraint if exists contact_requests_category_check;
  alter table contact_requests add constraint contact_requests_category_check
    check (category in ('carriera', 'coaching', 'psicologia', 'psicoterapia', 'aziende', 'da_definire'));
end $$;

-- Nessun accesso diretto dal browser: tutto passa dalle funzioni server.
alter table kv enable row level security;
alter table categories enable row level security;
alter table services enable row level security;
alter table professionals enable row level security;
alter table professional_services enable row level security;
alter table users enable row level security;
alter table availability_rules enable row level security;
alter table series enable row level security;
alter table events enable row level security;
alter table contact_requests enable row level security;
alter table rate_events enable row level security;

-- Il sito usa solo la connessione diretta al database: i ruoli pubblici di Supabase non devono leggere nulla.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on all tables in schema %I from anon, authenticated', current_schema());
    execute format('revoke all on all sequences in schema %I from anon, authenticated', current_schema());
  end if;
end $$;
