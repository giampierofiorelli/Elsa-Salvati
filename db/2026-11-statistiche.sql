-- Statistiche dello studio, delle email e del sito (ricerca 23). Migrazione idempotente:
-- si può eseguire più volte. Le stesse istruzioni sono in fondo a schema.sql.
-- Solo contatori: nessun recapito, nessun identificativo, nessun indirizzo IP.

-- Appuntamento a cui la persona non si è presentata: lo segna la professionista, dopo l'orario.
do $$ begin
  alter table events drop constraint if exists events_status_check;
  alter table events add constraint events_status_check check (status in ('in_attesa', 'confermato', 'annullato', 'rifiutato', 'non_presentata'));
end $$;
alter table events add column if not exists no_show_at timestamptz;

-- Contatori mensili dello studio (richieste di contatto, «Come ci hai conosciuto?», «Passa alla collega»,
-- continuità dopo il primo colloquio). Restano dopo le cancellazioni a 6 e 24 mesi.
-- professional_id 0, area '' e lang '' = non applicabile.
create table if not exists stats_monthly (
  month           date not null,
  professional_id bigint not null default 0,
  area            text not null default '',
  lang            text not null default '',
  metric          text not null,
  n               integer not null default 0,
  primary key (month, professional_id, area, lang, metric)
);

-- Email: inviate ed errori contati dal nostro codice; consegnate, respinte, spam e bloccate dal webhook di Brevo.
create table if not exists stats_email_daily (
  day         date not null,
  email_type  text not null,
  lang        text not null default '',
  sent        integer not null default 0,
  api_errors  integer not null default 0,
  delivered   integer not null default 0,
  soft_bounce integer not null default 0,
  hard_bounce integer not null default 0,
  spam        integer not null default 0,
  blocked     integer not null default 0,
  primary key (day, email_type, lang)
);

-- Azioni dai link delle email (conferma, disdetta, spostamento), per tipo di email.
create table if not exists stats_email_actions_daily (
  day        date not null,
  email_type text not null,
  action     text not null,
  n          integer not null default 0,
  primary key (day, email_type, action)
);

-- Sito: pagine viste, ingressi per fonte, clic sui pulsanti, moduli, passi della prenotazione, obiettivi.
-- metric: view · entry (key = fonte) · device (key) · cta (key = pulsante) · form (key = modulo:stato)
--         · step (key = passo) · goal (page = pagina precedente, key = obiettivo|pulsante) · beacon (tetto giornaliero)
create table if not exists stats_site_daily (
  day    date not null,
  page   text not null,
  metric text not null,
  key    text not null default '',
  n      integer not null default 0,
  primary key (day, page, metric, key)
);
-- Dopo 25 mesi il dettaglio giornaliero diventa un totale mensile.
create table if not exists stats_site_monthly (
  month  date not null,
  page   text not null,
  metric text not null,
  key    text not null default '',
  n      integer not null default 0,
  primary key (month, page, metric, key)
);

alter table stats_monthly enable row level security;
alter table stats_email_daily enable row level security;
alter table stats_email_actions_daily enable row level security;
alter table stats_site_daily enable row level security;
alter table stats_site_monthly enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on all tables in schema %I from anon, authenticated', current_schema());
  end if;
end $$;
