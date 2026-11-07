// Every 15 minutes: email reminders for upcoming appointments (the day before, and a couple of hours before).
import { withDeps } from '../../lib/app.mjs';
import { runReminders } from '../../lib/jobs.mjs';

export default async () => {
  const result = await withDeps((deps) => runReminders(deps));
  console.log('[reminders]', JSON.stringify(result));
};

export const config = { schedule: '*/15 * * * *' };
