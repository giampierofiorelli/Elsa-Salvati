// At midnight of 1 January (Rome time) the cached pages are refreshed, so the footer shows the new year.
// 23:00 UTC on 31 December = 00:00 in Rome (winter time, UTC+1); a second run at 23:05 is a safety net.
import { purgePages } from '../../lib/site-api.mjs';

export default async () => {
  try {
    const r = await purgePages(['pages']);
    console.log('[new-year] cache refreshed', JSON.stringify(r));
  } catch (err) {
    console.error('[new-year] purge failed', err.message);
  }
};

export const config = { schedule: '0,5 23 31 12 *' };
