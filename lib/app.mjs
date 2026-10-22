// Wires real dependencies (database, encryption, email, site data) for the
// Netlify functions. Tests build the same pieces with a local database.

import { createSql, createStore } from './db.mjs';
import { createVault } from './crypto.mjs';
import { createMailer } from './email.mjs';
import siteConfig from '../src/site.config.json' with { type: 'json' };

export function siteFromEnv(env = process.env, config = siteConfig) {
  return {
    siteUrl: env.SITE_URL || env.URL || config.siteUrl || '',
    professionalName: config.studioFullName,
    address: config.studio && config.studio.address,
    priceText: '',
    notifyEmail: env.NOTIFY_EMAIL || config.contact.email || '',
  };
}

// Each request opens its own database connection and closes it at the end.
// A connection kept between requests can be dropped by the pooler while the
// function sleeps, and the next query would then hang until the timeout.
export async function withDeps(fn, env = process.env) {
  const sql = createSql(env);
  try {
    return await fn({
      store: createStore(sql),
      vault: createVault(env.DATA_KEY),
      mailer: createMailer(env),
      site: siteFromEnv(env),
      env,
    });
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}
