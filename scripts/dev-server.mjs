// Local preview: serves dist/ and the API against a local PostgreSQL.
// Usage: DATABASE_URL=postgres://... node scripts/dev-server.mjs [--demo]
// With --demo it creates sample hours and appointments, and prints a login
// code generator so the admin agenda can be tried locally.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createStore } from '../lib/db.mjs';
import { createVault, hashPassword, base32Encode, totpCode } from '../lib/crypto.mjs';
import { createMailer } from '../lib/email.mjs';
import { createPublicApi } from '../lib/public-api.mjs';
import { createAdminApi } from '../lib/admin-api.mjs';
import { siteFromEnv } from '../lib/app.mjs';
import { addDays, zonedParts, zonedToUtc, mondayOf } from '../lib/time.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT || 8888);
const demo = process.argv.includes('--demo');
const password = process.env.DEV_PASSWORD || 'prova-locale-123';

const env = {
  DATA_KEY: randomBytes(32).toString('base64'),
  SESSION_SECRET: randomBytes(32).toString('base64url'),
  ADMIN_PASSWORD_HASH: hashPassword(password),
  ADMIN_TOTP_SECRET: base32Encode(randomBytes(20)),
  EMAIL_PROVIDER: 'test',
  EMAIL_FROM: 'studio@example.it',
  SITE_URL: `http://localhost:${port}`,
  ...process.env,
};

const sql = postgres(env.DATABASE_URL || 'postgres://postgres@127.0.0.1:54329/agenda_dev', {
  max: 4, prepare: false, onnotice: () => {}, types: { bigint: postgres.BigInt },
});
await sql.unsafe(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));

const deps = { store: createStore(sql), vault: createVault(env.DATA_KEY), mailer: createMailer(env), site: siteFromEnv(env), env };
const pub = createPublicApi(deps);
const admin = createAdminApi(deps);

if (demo) await seed();

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml' };

createServer(async (nodeReq, res) => {
  const url = new URL(nodeReq.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of nodeReq) chunks.push(c);
    const req = new Request(url, {
      method: nodeReq.method,
      headers: Object.entries(nodeReq.headers).filter(([, v]) => typeof v === 'string'),
      body: ['GET', 'HEAD'].includes(nodeReq.method) ? undefined : Buffer.concat(chunks),
    });
    const handler = url.pathname.startsWith('/api/admin') ? admin : pub;
    const r = await handler(req, { ip: nodeReq.socket.remoteAddress });
    // Browsers drop "Secure" cookies on plain http except on localhost; fine for preview.
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let file = join(root, decodeURIComponent(url.pathname));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(root, '404.html')).catch(() => 'Not found'));
  }
}).listen(port, () => {
  console.log(`Anteprima: http://localhost:${port}`);
  console.log(`Agenda:    http://localhost:${port}/admin/  (password: ${password})`);
  console.log('Codice di accesso attuale (cambia ogni 30 s): esegui con --code per vederlo, oppure guarda qui sotto.');
  const show = () => console.log(`  codice: ${totpCode(env.ADMIN_TOTP_SECRET, Math.floor(Date.now() / 30000))}`);
  show();
  setInterval(show, 30000).unref();
});

// Writes the current TOTP code to a file so automated checks can log in.
if (process.env.DEV_CODE_FILE) {
  const { writeFileSync } = await import('node:fs');
  const write = () => writeFileSync(process.env.DEV_CODE_FILE, totpCode(env.ADMIN_TOTP_SECRET, Math.floor(Date.now() / 30000)));
  write();
  setInterval(write, 5000).unref();
}

async function seed() {
  await sql.unsafe('truncate events, series, availability_rules, contact_requests, rate_events, kv restart identity');
  const s = deps.store;
  await s.replaceRules([
    { weekday: 1, start_time: '09:00', end_time: '13:00', mode: 'entrambi', public: true, active: true },
    { weekday: 1, start_time: '15:00', end_time: '19:00', mode: 'studio', public: false, active: true },
    { weekday: 2, start_time: '14:00', end_time: '19:00', mode: 'online', public: true, active: true },
    { weekday: 3, start_time: '09:00', end_time: '13:00', mode: 'entrambi', public: true, active: true },
    { weekday: 4, start_time: '10:00', end_time: '18:00', mode: 'studio', public: false, active: true },
    { weekday: 5, start_time: '09:00', end_time: '12:00', mode: 'entrambi', public: true, active: true },
  ]);
  await s.saveSettings({ minNoticeHours: 12 });
  const tz = 'Europe/Rome';
  const mon = mondayOf(zonedParts(new Date(), tz).date);
  const add = (day, time, minutes, extra) => {
    const start = zonedToUtc(addDays(mon, day), time, tz);
    return s.insertEvent({ start_at: start, end_at: new Date(start.getTime() + minutes * 60000), ...extra }).catch(() => {});
  };
  const enc = (name) => deps.vault.encrypt({ name, email: '', phone: '' });
  for (let w = 0; w < 3; w++) {
    await add(w * 7, '09:00', 50, { kind: 'primo_colloquio', source: 'sito', mode: 'studio', contact_enc: enc('Giulia B.') });
    await add(w * 7 + 1, '17:00', 50, { kind: 'seduta', source: 'manuale', mode: 'online', contact_enc: enc('M. R.') });
    await add(w * 7 + 3, '11:00', 50, { kind: 'seduta', source: 'manuale', mode: 'studio', contact_enc: enc('L. V.') });
    await add(w * 7 + 3, '15:00', 50, { kind: 'seduta', source: 'manuale', mode: 'studio', contact_enc: enc('A. C.') });
  }
  await add(2, '10:00', 50, { kind: 'primo_colloquio', source: 'sito', mode: 'online', contact_enc: enc('Sara P.') });
  await add(2, '14:00', 120, { kind: 'blocco', source: 'manuale', block_title: 'Formazione' });
  await s.insertRequest(deps.vault.encrypt({ name: 'Paolo', phone: '+39 333 0000000', preference: 'sabato mattina', message: '' }), 'studio');
  console.log('Dati dimostrativi creati.');
}
