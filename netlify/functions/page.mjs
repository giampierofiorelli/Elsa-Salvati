// Editable pages. Production shows what was published and keeps it in Netlify's cache until the
// next "Pubblica" (no new deploy needed); previews and staging show the draft with internal notes.
// If the database can't be reached, the copy saved at build time is served.
import { createSql, createStore } from '../../lib/db.mjs';
import { loadCatalog } from '../../lib/public-api.mjs';
import { createSite } from '../../lib/site.mjs';
import { pageResponse } from '../../lib/page-server.mjs';
import kit from '../../lib/generated/site-kit.json' with { type: 'json' };

export default async (req) => {
  const env = process.env;
  const sql = env.DATABASE_URL ? createSql(env) : null;
  try {
    return await pageResponse(req, {
      kit, env,
      store: sql ? createStore(sql) : null,
      loadCatalog: sql ? () => loadCatalog(createStore(sql)) : null,
      createSite,
    });
  } finally {
    if (sql) await sql.end({ timeout: 2 }).catch(() => {});
  }
};
