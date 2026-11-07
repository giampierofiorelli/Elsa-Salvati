// Files from the media library (images in several sizes, PDFs), cached for a year:
// the name changes with the content, so a cached copy is never stale.
import { createSql, createStore } from '../../lib/db.mjs';
import { createMediaStore } from '../../lib/media-store.mjs';
import { createMediaDelivery } from '../../lib/media-api.mjs';

export default async (req) => {
  const sql = createSql(process.env);
  try {
    return await createMediaDelivery({ store: createStore(sql), mediaStore: createMediaStore(sql) })(req);
  } catch (err) {
    console.error('[media]', err.message);
    return new Response('Not available', { status: 503 });
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
};

export const config = { path: '/media/*' };
