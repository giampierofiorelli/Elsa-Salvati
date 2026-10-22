// Daily: delete contact data past the retention period.
import { withDeps } from '../../lib/app.mjs';
import { runRetention } from '../../lib/jobs.mjs';

export default async () => {
  const result = await withDeps((deps) => runRetention(deps));
  console.log('[retention]', JSON.stringify(result));
};

export const config = { schedule: '@daily' };
