-- Agenda dello studio: schema PostgreSQL (Supabase, regione UE).
-- Eseguire una sola volta nell'SQL editor di Supabase o con `npm run db:setup`.
-- Nessun dato clinico: solo ciò che serve a organizzare gli appuntamenti.
-- Nome, email, telefono e note sono cifrati dall'applicazione (AES-256-GCM)
-- prima di arrivare qui.

create table if not exists kv (
  key   text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Fasce orarie settimanali in cui lo studio lavora.
-- public = true: i nuovi pazienti possono prenotare il primo colloquio in questa fascia.
create table if not exists availability_rules (
  id         bigserial primary key,
  weekday    smallint not null check (weekday between 1 and 7), -- 1 = lunedì (ISO)
  start_time time not null,
  end_time   time not null,
  mode       text not null default 'entrambi' check (mode in ('studio', 'online', 'entrambi')),
  public     boolean not null default true,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

-- Serie di appuntamenti ricorrenti (es. ogni martedì alle 17).
-- Le singole occorrenze sono righe di "events": si possono spostare
-- o annullare una per una senza toccare il resto della serie.
create table if not exists series (
  id             bigserial primary key,
  interval_weeks smallint not null default 1 check (interval_weeks between 1 and 8),
  created_at     timestamptz not null default now()
);

create table if not exists events (
  id                bigserial primary key,
  kind              text not null check (kind in ('primo_colloquio', 'seduta', 'blocco')),
  status            text not null default 'confermato' check (status in ('confermato', 'annullato')),
  source            text not null check (source in ('sito', 'manuale')),
  mode              text check (mode in ('studio', 'online')),
  start_at          timestamptz not null,
  end_at            timestamptz not null,
  series_id         bigint references series(id) on delete set null,
  block_title       text,          -- solo per i blocchi (es. "Ferie"), mai dati di pazienti
  contact_enc       text,          -- {name,email,phone,note} cifrato
  contact_hash      text,          -- HMAC dell'email: limita le prenotazioni multiple senza salvarla in chiaro
  manage_token_hash text unique,   -- SHA-256 del link personale di gestione
  reminder_sent_at  timestamptz,
  cancelled_at      timestamptz,
  cancelled_by      text check (cancelled_by in ('paziente', 'studio')),
  created_at        timestamptz not null default now(),
  check (end_at > start_at),
  check (kind <> 'blocco' or contact_enc is null),
  -- Garanzia atomica: due eventi confermati non possono sovrapporsi,
  -- nemmeno se due persone confermano lo stesso orario nello stesso istante.
  constraint events_no_overlap exclude using gist (
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status = 'confermato')
);

create index if not exists events_start_idx on events (start_at);
create index if not exists events_contact_idx on events (contact_hash) where status = 'confermato';
create index if not exists events_series_idx on events (series_id);

-- Richieste di ricontatto (chi non trova un orario adatto o preferisce essere richiamato).
create table if not exists contact_requests (
  id          bigserial primary key,
  contact_enc text not null,
  mode        text check (mode in ('studio', 'online', 'da_definire')),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);

-- Contatori per limitare abusi (tentativi di accesso, prenotazioni ripetute).
-- La chiave è un HMAC: nessun indirizzo IP in chiaro.
create table if not exists rate_events (
  id       bigserial primary key,
  key_hash text not null,
  action   text not null,
  ok       boolean not null default false,
  at       timestamptz not null default now()
);
create index if not exists rate_events_idx on rate_events (action, key_hash, at);

-- Nessun accesso diretto dal browser: tutte le operazioni passano dalle
-- funzioni server con la connessione privata al database.
alter table kv enable row level security;
alter table availability_rules enable row level security;
alter table series enable row level security;
alter table events enable row level security;
alter table contact_requests enable row level security;
alter table rate_events enable row level security;
