// Test helpers: a real local PostgreSQL database, reset before each suite.
// Set TEST_DATABASE_URL, e.g. postgres://postgres@127.0.0.1:54329/agenda_test

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createStore } from '../lib/db.mjs';
import { createVault, hashPassword, base32Encode } from '../lib/crypto.mjs';
export { totpCode } from '../lib/crypto.mjs';
import { createMailer } from '../lib/email.mjs';

export const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:54329/agenda_test';

export async function dbAvailable() {
  const sql = postgres(DB_URL, { max: 1, connect_timeout: 2, onnotice: () => {} });
  try { await sql`select 1`; return true; } catch { return false; } finally { await sql.end({ timeout: 1 }); }
}

export async function freshDb() {
  const sql = postgres(DB_URL, { max: 4, prepare: false, onnotice: () => {}, types: { bigint: postgres.BigInt } });
  await sql.unsafe('drop table if exists events, series, availability_rules, contact_requests, rate_events, kv, users, professional_services, professionals, services, categories cascade');
  await sql.unsafe(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  return sql;
}

export const PASSWORD = 'una-password-di-prova-lunga';

export function testDeps(sql, clock) {
  const env = {
    DATA_KEY: randomBytes(32).toString('base64'),
    SESSION_SECRET: randomBytes(32).toString('base64url'),
    EMAIL_PROVIDER: 'test',
    EMAIL_FROM: 'studio@example.it',
  };
  return {
    env,
    store: createStore(sql),
    vault: createVault(env.DATA_KEY),
    mailer: createMailer(env),
    site: {
      siteUrl: 'https://studio.example.it',
      professionalName: 'Dott.ssa Elsa Salvati',
      address: 'Via Esempio 1, Città',
      priceText: '€70',
      notifyEmail: 'studio@example.it',
    },
    now: () => clock.now,
  };
}

export function request(method, path, { body, headers = {} } = {}) {
  return new Request(`https://studio.example.it${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Create an already-activated account directly in the database (bootstrap). */
export async function createEnrolledUser(deps, { email, name, role, professionalId = null }) {
  const secret = base32Encode(randomBytes(20));
  const id = await deps.store.insertUser({ email, name, role, professional_id: professionalId, invite_token_hash: null, invite_expires_at: null });
  await deps.store.updateUser(id, {
    password_hash: hashPassword(PASSWORD), totp_secret_enc: deps.vault.encrypt({ secret }), enrolled_at: new Date(),
  });
  return { id, email, secret };
}
