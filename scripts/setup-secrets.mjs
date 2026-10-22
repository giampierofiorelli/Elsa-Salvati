// Generates the secrets for Netlify environment variables.
// Usage: npm run setup:secrets
// Asks for the admin password, prints the variables to paste into
// Netlify → Site configuration → Environment variables.
// Nothing is written to disk.

import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { hashPassword, base32Encode } from '../lib/crypto.mjs';

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}

const password = await ask('Scegli la password per l\'agenda (almeno 12 caratteri): ', { hidden: true });
if (password.length < 12) {
  console.error('La password deve avere almeno 12 caratteri.');
  process.exit(1);
}
const confirm = await ask('Ripeti la password: ', { hidden: true });
if (confirm !== password) {
  console.error('Le password non coincidono.');
  process.exit(1);
}

const totpSecret = base32Encode(randomBytes(20));
const label = encodeURIComponent('Agenda studio');
const otpauth = `otpauth://totp/${label}?secret=${totpSecret}&issuer=${label}&algorithm=SHA1&digits=6&period=30`;

console.log(`
Variabili da inserire su Netlify (Site configuration → Environment variables).
Conservale anche in un gestore di password: senza DATA_KEY i recapiti cifrati non sono più leggibili.

ADMIN_PASSWORD_HASH=${hashPassword(password)}
ADMIN_TOTP_SECRET=${totpSecret}
SESSION_SECRET=${randomBytes(32).toString('base64url')}
DATA_KEY=${randomBytes(32).toString('base64')}
ICAL_TOKEN=${randomBytes(24).toString('base64url')}

App di autenticazione (Google Authenticator, Aegis, 1Password…):
aggiungi un account manualmente con la chiave
  ${totpSecret.match(/.{1,4}/g).join(' ')}
oppure apri/crea un QR code da questo indirizzo:
  ${otpauth}
`);
