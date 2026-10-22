// Daily: delete contact data past the retention period.
import { getDeps } from '../../lib/app.mjs';
import { runRetention } from '../../lib/jobs.mjs';

export default async () => {
  const result = await runRetention(getDeps());
  console.log('[retention]', JSON.stringify(result));
};

export const config = { schedule: '@daily' };
