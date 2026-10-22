// Creates the first administrator account and prints the activation link.
// Usage: DATABASE_URL="postgres://..." SITE_URL="https://..." node scripts/create-admin.mjs email@example.it "Nome Cognome"
import postgres from 'postgres';
import { randomToken, sha256 } from '../lib/crypto.mjs';

const [email, name] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !email || !name) {
  console.error('Uso: DATABASE_URL=... SITE_URL=... node scripts/create-admin.mjs email "Nome Cognome"');
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require' });
const token = randomToken();
await sql`insert into users (email, name, role, invite_token_hash, invite_expires_at)
  values (${email.toLowerCase()}, ${name}, 'admin', ${sha256(token)}, now() + interval '7 days')
  on conflict (email) do update set invite_token_hash = excluded.invite_token_hash, invite_expires_at = excluded.invite_expires_at,
    password_hash = null, totp_secret_enc = null, totp_pending_enc = null, enrolled_at = null, active = true`;
console.log(`Link di attivazione (valido 7 giorni):\n${(process.env.SITE_URL || '').replace(/\/$/, '')}/admin/#invito=${token}`);
await sql.end();
