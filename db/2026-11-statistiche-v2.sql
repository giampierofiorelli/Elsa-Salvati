-- Statistiche v2 (ricerca 25). Migrazione idempotente: si può eseguire più volte.
-- Le stesse istruzioni sono in fondo a schema.sql.

-- «Come ci hai conosciuto?» sul primo colloquio prenotato dal sito: resta sulla riga solo finché il gruppo
-- dei primi colloqui di quel mese è «maturo» (90 giorni), poi va nei contatori mensili e si cancella.
alter table events add column if not exists heard_from text;
do $$ begin
  alter table events drop constraint if exists events_heard_from_check;
  alter table events add constraint events_heard_from_check check (heard_from in ('passaparola', 'professionista', 'ricerca', 'instagram', 'linkedin', 'azienda', 'altro'));
end $$;

-- Quale invito ha portato alla conferma della presenza: 48h (primo invito), 24h (secondo invito), manuale.
alter table events add column if not exists confirmed_via text;
do $$ begin
  alter table events drop constraint if exists events_confirmed_via_check;
  alter table events add constraint events_confirmed_via_check check (confirmed_via in ('48h', '24h', 'manuale'));
end $$;

-- Nota del mese, scritta a mano dall'amministrazione (contesto: ferie, un post, un cambio di orari).
create table if not exists stats_notes (
  month      date primary key,
  note       text not null default '',
  updated_by bigint references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table stats_notes enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on all tables in schema %I from anon, authenticated', current_schema());
  end if;
end $$;
