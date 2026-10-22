// Hourly: email reminders for upcoming appointments.
import { getDeps } from '../../lib/app.mjs';
import { runReminders } from '../../lib/jobs.mjs';

export default async () => {
  const result = await runReminders(getDeps());
  console.log('[reminders]', JSON.stringify(result));
};

export const config = { schedule: '@hourly' };
