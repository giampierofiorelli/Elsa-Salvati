// Images uploaded from the page editor, cached for a year (the name changes with the content).
import { createSql, createStore } from '../../lib/db.mjs';
import { createMediaHandler } from '../../lib/site-api.mjs';

export default async (req) => {
  const sql = createSql(process.env);
  try {
    return await createMediaHandler({ store: createStore(sql) })(req);
  } catch (err) {
    console.error('[media]', err.message);
    return new Response('Not available', { status: 503 });
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
};

export const config = { path: '/media/*' };
