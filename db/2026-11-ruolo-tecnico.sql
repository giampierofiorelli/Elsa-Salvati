-- Ruolo «tecnico» (verifica di conformità, ricerca 26): modifica il sito, vede le impostazioni, le statistiche
-- aggregate e il registro, ma non vede mai recapiti, nomi, note né agende. Migrazione idempotente.
do $$ begin
  alter table users drop constraint if exists users_role_check;
  alter table users add constraint users_role_check check (role in ('admin', 'professionista', 'tecnico'));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on all tables in schema %I from anon, authenticated', current_schema());
  end if;
end $$;
