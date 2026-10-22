// Hourly: email reminders for upcoming appointments.
import { withDeps } from '../../lib/app.mjs';
import { runReminders } from '../../lib/jobs.mjs';

export default async () => {
  const result = await withDeps((deps) => runReminders(deps));
  console.log('[reminders]', JSON.stringify(result));
};

export const config = { schedule: '@hourly' };
