// Creates the tables (safe to run more than once).
// Usage: DATABASE_URL="postgres://..." npm run db:setup
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
  console.error('Imposta DATABASE_URL (stringa di connessione di Supabase).');
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, {
  max: 1, prepare: false, onnotice: () => {},
  ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require',
});
await sql.unsafe(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
const [{ n }] = await sql`select count(*)::int as n from information_schema.tables where table_name in ('events','availability_rules','kv','series','contact_requests','rate_events')`;
console.log(`Database pronto (${n}/6 tabelle).`);
await sql.end();
