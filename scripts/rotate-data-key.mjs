// Re-encrypt every encrypted value with the new DATA_KEY (after a suspected leak, or as routine).
// Usage: DATABASE_URL=… DATA_KEY=<new key> DATA_KEY_OLD=<old key> node scripts/rotate-data-key.mjs [--check]
// Idempotent and resumable: only values not yet on the new key are touched, in small batches, and each row
// is updated only if it hasn't changed meanwhile. Run it again until it reports 0 left. --check only counts.
// The lookup fingerprints (contact_hash) depend on the key too: they are recomputed from the decrypted email.
import postgres from 'postgres';
import { createVault } from '../lib/crypto.mjs';
import { contactKey } from '../lib/http.mjs';

export const COLUMNS = [
  { table: 'events', col: 'contact_enc', hash: 'event' },
  { table: 'contact_requests', col: 'contact_enc', hash: 'request' },
  { table: 'users', col: 'totp_secret_enc' },
  { table: 'users', col: 'totp_pending_enc' },
];

/** Re-encrypt with `vault` (new key + old keys). Returns { done, left, failed: [ids] } per column. */
export async function rotate(sql, vault, { check = false, batch = 200, log = () => {} } = {}) {
  const prefix = `v2.${vault.keyId}.%`;
  const report = {};
  for (const { table, col, hash } of COLUMNS) {
    const r = { done: 0, left: 0, failed: [] };
    const failed = new Set();
    for (;;) {
      const rows = await sql.unsafe(`select id::text as id, ${col} as value${hash ? ', contact_hash' : ''} from ${table}
        where ${col} is not null and ${col} not like $1 ${failed.size ? `and id <> all($2::bigint[])` : ''} order by id limit ${batch}`,
      failed.size ? [prefix, [...failed]] : [prefix]);
      if (!rows.length) break;
      if (check) { r.left = (await sql.unsafe(`select count(*)::int as n from ${table} where ${col} is not null and ${col} not like $1`, [prefix]))[0].n; break; }
      for (const row of rows) {
        let plain;
        try { plain = vault.decrypt(row.value); } catch { failed.add(row.id); continue; }
        const value = vault.encrypt(plain);
        let newHash = row.contact_hash;
        if (hash && row.contact_hash) {
          newHash = hash === 'event' ? (plain.email ? vault.lookupHash(contactKey(plain.email)) : null) : vault.lookupHash(contactKey(plain.email || ''));
        }
        const upd = hash
          ? await sql.unsafe(`update ${table} set ${col} = $1, contact_hash = $2 where id = $3 and ${col} = $4 returning id`, [value, newHash, row.id, row.value])
          : await sql.unsafe(`update ${table} set ${col} = $1 where id = $2 and ${col} = $3 returning id`, [value, row.id, row.value]);
        if (upd.length) r.done += 1;
      }
      log(`${table}.${col}: ${r.done} ricifrati`);
    }
    r.failed = [...failed];
    if (!check) r.left = (await sql.unsafe(`select count(*)::int as n from ${table} where ${col} is not null and ${col} not like $1`, [prefix]))[0].n;
    report[`${table}.${col}`] = r;
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env;
  if (!env.DATABASE_URL || !env.DATA_KEY) { console.error('Servono DATABASE_URL e DATA_KEY (la chiave nuova); DATA_KEY_OLD con la chiave vecchia.'); process.exit(2); }
  const sql = postgres(env.DATABASE_URL, { max: 2, prepare: false, onnotice: () => {} });
  const vault = createVault(env.DATA_KEY, env.DATA_KEY_OLD);
  const report = await rotate(sql, vault, { check: process.argv.includes('--check'), log: (m) => console.log(m) });
  console.log(JSON.stringify(report, null, 2));
  await sql.end();
  const bad = Object.values(report).some((r) => r.failed.length || r.left);
  process.exit(bad ? 1 : 0);
}
