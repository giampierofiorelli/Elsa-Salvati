// Wires real dependencies (database, encryption, email, site data) for the
// Netlify functions. Tests build the same pieces with a local database.

import { getSql, createStore } from './db.mjs';
import { createVault } from './crypto.mjs';
import { createMailer } from './email.mjs';
import siteConfig from '../src/site.config.json' with { type: 'json' };

export function siteFromEnv(env = process.env, config = siteConfig) {
  return {
    siteUrl: env.SITE_URL || env.URL || config.siteUrl || '',
    professionalName: config.professionalName,
    address: config.studio && config.studio.address,
    priceText: config.fees && config.fees.firstSession,
    notifyEmail: env.NOTIFY_EMAIL || config.contact.email || '',
  };
}

let deps;
export function getDeps(env = process.env) {
  if (!deps) {
    deps = {
      store: createStore(getSql(env)),
      vault: createVault(env.DATA_KEY),
      mailer: createMailer(env),
      site: siteFromEnv(env),
      env,
    };
  }
  return deps;
}
