-- Testi delle email modificabili dall'amministrazione. Migrazione idempotente: si può eseguire più volte.
-- Le stesse istruzioni sono in fondo a schema.sql.
-- I testi originali restano nel codice (lib/email-texts.mjs): qui solo quelli personalizzati.
-- Se un testo salvato non passa più i controlli, il sito invia quello originale.
create table if not exists email_texts (
  key        text not null,
  lang       text not null check (lang in ('it', 'en')),
  subject    text not null,
  body       jsonb not null,
  button     text not null default '',
  updated_by bigint references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (key, lang)
);
alter table email_texts enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on all tables in schema %I from anon, authenticated', current_schema());
  end if;
end $$;
