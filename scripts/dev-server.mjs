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
import { createVault, hashPassword, base32Encode, totpCode, randomToken, sha256 } from '../lib/crypto.mjs';
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
  EMAIL_PROVIDER: 'test',
  EMAIL_FROM: 'studio@example.it',
  SITE_URL: `http://localhost:${port}`,
  ...process.env,
};
const adminSecret = base32Encode(randomBytes(20));

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
  console.log(`Agenda:    http://localhost:${port}/admin/  (admin@example.it / ${password})`);
  console.log('Codice di accesso attuale (cambia ogni 30 s): esegui con --code per vederlo, oppure guarda qui sotto.');
  const show = () => console.log(`  codice: ${totpCode(adminSecret, Math.floor(Date.now() / 30000))}`);
  show();
  setInterval(show, 30000).unref();
});

// Writes the current TOTP code to a file so automated checks can log in.
if (process.env.DEV_CODE_FILE) {
  const { writeFileSync } = await import('node:fs');
  const write = () => writeFileSync(process.env.DEV_CODE_FILE, totpCode(adminSecret, Math.floor(Date.now() / 30000)));
  write();
  setInterval(write, 5000).unref();
}

async function seed() {
  await sql.unsafe('truncate events, series, availability_rules, contact_requests, rate_events, kv, users, professional_services, professionals, services restart identity cascade');
  const s = deps.store;
  const cats = Object.fromEntries((await s.listCategories()).map((c) => [c.slug, c.id]));
  const svc = {
    coaching: await s.insertService({ category_id: cats.coaching, slug: 'business-coaching-individuale', name: 'Business coaching individuale', description: 'Per chi vuole cambiare lavoro o vive difficoltà sul lavoro: conflitti, mobbing, stress e ansia legati al lavoro.', duration_minutes: 60, price_text: '€80', sort: 1, active: true }),
    imprese: await s.insertService({ category_id: cats.coaching, slug: 'consulenza-per-le-imprese', name: 'Consulenza per le imprese', description: 'Benessere organizzativo, gestione dello stress, percorsi per responsabili e team.', duration_minutes: 60, price_text: 'Preventivo su misura', sort: 2, active: true }),
    genitori: await s.insertService({ category_id: cats.psicologia, slug: 'sostegno-alla-genitorialita', name: 'Sostegno alla genitorialità', description: 'Le fatiche e i dubbi dell\'essere genitori, dalla nascita all\'adolescenza dei figli.', duration_minutes: 50, price_text: '€60', sort: 1, active: true }),
    terapia: await s.insertService({ category_id: cats.psicoterapia, slug: 'psicoterapia-individuale', name: 'Psicoterapia individuale', description: 'Per ansia, depressione e momenti difficili della vita, con professionisti di diversi orientamenti.', duration_minutes: 50, price_text: '€70', sort: 1, active: true }),
  };
  const pro = {
    elsa: await s.insertProfessional({ slug: 'elsa-salvati', name: 'Dott.ssa Elsa Salvati', title: 'Psicologa · Business coach', bio: 'Business coaching individuale e consulenza per le imprese.', albo: 'Ordine degli Psicologi dell\'Emilia-Romagna n. [numero]', photo: 'elsa-salvati', notify_email: 'elsa@example.it', sort: 1, active: true }),
    giulia: await s.insertProfessional({ slug: 'giulia-rossi', name: 'Dott.ssa Giulia Rossi', title: 'Psicologa', bio: 'Sostegno alla genitorialità e consulenza psicologica.', albo: 'Ordine degli Psicologi dell\'Emilia-Romagna n. [numero]', photo: 'professionista-psicologia', notify_email: '', sort: 2, active: true }),
    marco: await s.insertProfessional({ slug: 'marco-neri', name: 'Dott. Marco Neri', title: 'Psicologo psicoterapeuta', bio: 'Orientamento cognitivo-comportamentale. Ansia e depressione.', albo: 'Ordine degli Psicologi dell\'Emilia-Romagna n. [numero]', photo: 'professionista-psicoterapia', notify_email: '', sort: 3, active: true }),
  };
  await s.replaceOfferings(pro.elsa, [{ service_id: svc.coaching, in_studio: true, online: true }, { service_id: svc.imprese, in_studio: true, online: true }]);
  await s.replaceOfferings(pro.giulia, [{ service_id: svc.genitori, in_studio: true, online: true }]);
  await s.replaceOfferings(pro.marco, [{ service_id: svc.terapia, in_studio: true, online: false }]);
  const rules = (spec) => spec.map(([weekday, start_time, end_time, mode, pub]) => ({ weekday, start_time, end_time, mode, public: pub, active: true }));
  await s.replaceRules(pro.elsa, rules([[1, '09:00', '13:00', 'entrambi', true], [3, '14:00', '18:00', 'entrambi', true], [5, '09:00', '12:00', 'online', true]]));
  await s.replaceRules(pro.giulia, rules([[2, '09:00', '13:00', 'entrambi', true], [4, '14:00', '19:00', 'studio', true]]));
  await s.replaceRules(pro.marco, rules([[1, '14:00', '19:00', 'studio', true], [3, '09:00', '13:00', 'studio', true], [4, '09:00', '18:00', 'studio', false]]));
  await s.saveSettings({ minNoticeHours: 12 });
  const tz = 'Europe/Rome';
  const mon = mondayOf(zonedParts(new Date(), tz).date);
  const add = (proId, serviceId, day, time, minutes, extra) => {
    const start = zonedToUtc(addDays(mon, day), time, tz);
    return s.insertEvent({ professional_id: proId, service_id: serviceId, start_at: start, end_at: new Date(start.getTime() + minutes * 60000), ...extra }).catch(() => {});
  };
  const enc = (name) => deps.vault.encrypt({ name, email: '', phone: '' });
  for (let w = 0; w < 3; w++) {
    await add(pro.elsa, svc.coaching, w * 7, '09:00', 60, { kind: 'primo_colloquio', source: 'sito', mode: 'online', contact_enc: enc('Luca B.') });
    await add(pro.marco, svc.terapia, w * 7 + 2, '10:00', 50, { kind: 'seduta', source: 'manuale', mode: 'studio', contact_enc: enc('M. R.') });
    await add(pro.marco, svc.terapia, w * 7 + 3, '11:00', 50, { kind: 'seduta', source: 'manuale', mode: 'studio', contact_enc: enc('L. V.') });
    await add(pro.giulia, svc.genitori, w * 7 + 1, '10:00', 50, { kind: 'seduta', source: 'manuale', mode: 'online', contact_enc: enc('A. C.') });
  }
  await add(pro.elsa, null, 2, '14:00', 120, { kind: 'blocco', source: 'manuale', block_title: 'Formazione' });
  await s.insertRequest({ contact_enc: deps.vault.encrypt({ name: 'Paolo', phone: '+39 333 0000000', preference: 'sabato mattina', message: '' }), mode: 'studio', category: 'psicoterapia', professional_id: pro.marco });
  // Admin account (already activated) and a pending invitation for Marco.
  const adminId = await s.insertUser({ email: 'admin@example.it', name: 'Direzione', role: 'admin', professional_id: pro.elsa, invite_token_hash: null, invite_expires_at: null });
  await s.updateUser(adminId, { password_hash: hashPassword(password), totp_secret_enc: deps.vault.encrypt({ secret: adminSecret }), enrolled_at: new Date() });
  const marcoUser = await s.insertUser({ email: 'marco@example.it', name: 'Marco Neri', role: 'professionista', professional_id: pro.marco, invite_token_hash: null, invite_expires_at: null });
  const inviteToken = randomToken();
  await s.updateUser(marcoUser, { invite_token_hash: sha256(inviteToken), invite_expires_at: new Date(Date.now() + 7 * 86400000) });
  console.log(`Dati dimostrativi creati. Invito di prova: http://localhost:${port}/admin/#invito=${inviteToken}`);
  if (process.env.DEV_INVITE_FILE) (await import('node:fs')).writeFileSync(process.env.DEV_INVITE_FILE, inviteToken);
}
