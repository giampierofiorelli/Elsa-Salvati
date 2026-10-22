// Generates the secrets for the Netlify environment variables.
// Usage: npm run setup:secrets   (nothing is written to disk)
import { randomBytes } from 'node:crypto';

console.log(`
Variabili da inserire su Netlify (Site configuration → Environment variables, ambito "All scopes").
Conserva DATA_KEY anche in un gestore di password: senza, i recapiti cifrati non sono più leggibili.

SESSION_SECRET=${randomBytes(32).toString('base64url')}
DATA_KEY=${randomBytes(32).toString('base64')}

Poi crea il primo amministratore con scripts/create-admin.mjs (vedi README).
`);
